import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import { resolveEffectiveTariff } from '@kampus/school-core/lib/fee-tariffs.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { renewalCourseOffer } from '@kampus/school-core/lib/renewal-course-offer.ts'
import { renewalPricingSchema } from '@kampus/school-core/lib/renewal-ceiling.ts'
import {
  createPriceIndexSchema,
  planPriceIndexCreate,
  planPriceIndexUpdate,
  outstandingTuitionCents,
  planRenewal,
  quoteRenewal,
  renewalPlanSchema,
  renewalQuoteSchema,
  type RenewalContext,
} from '@kampus/school-core/lib/renewals.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { WORKFLOW_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import { listProgressionDecisions } from '../db/cefr.ts'
import type { Database } from '../db/client.ts'
import { loadCourses } from '../db/courses.ts'
import {
  allPriceIndexes,
  findPriceIndex,
  findPublishedTariff,
  insertPriceIndex,
  listPriceIndexes,
  updatePriceIndex,
} from '../db/fee-tariffs.ts'
import {
  countScholarshipAwards,
  findScholarshipProgram,
  hasStudentScholarshipAward,
  insertScholarshipAward,
} from '../db/finance-scholarships.ts'
import { loadFinanceRecords } from '../db/finance-mirror-store.ts'
import { findReferralReward } from '../db/finance-referrals.ts'
import { loadStudentFamilies } from '../db/finance-renewal-candidates.ts'
import { allocatedForInvoices } from '../db/payments.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { listStudentCourseEnrollments } from '../db/renewal-course-offer.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { getCollectionItem, listCollection, type CollectionItem } from './collection-reads.ts'
import { commandBody } from './command-result.ts'
import { environment } from './commands.ts'
import { getInstitution } from './memberships.ts'
import { withTariffCarryOver } from './fee-tariffs.ts'
import { useReferralReward } from './finance-referrals.ts'
import { openServiceKindsOfYear } from './finance-student-services.ts'
import {
  runCommand,
  runReadOnly,
  type CommandResponse,
  type IdempotencyRequest,
  FINANCE_TABLE_STORES,
} from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Tarifeye bağlı kayıt yenileme servisi (docs/domain/finans.md DOM-FIN-002, -005, -023, -025;
 * kayit-ve-crm.md DOM-KAY-020, -021; IST-100). Kural core `lib/renewals.ts`'tedir. Plan, sözleşme,
 * taksit ve burs ataması tek transaction'da yazılır; ücret ve kontenjan kurum kilidi altında
 * denetlenir. Sınıf geçişi ayrı işlemdir (iş akışı köprüsünün `renewal-activate` çekirdeği). Dil
 * okulunda teklif son kurun kur sonu kararından başlar (dil-okulu.md DOM-DIL-070; core
 * `lib/renewal-course-offer.ts`); karar onaylanmadan plan 422 ile reddedilir.
 */

const SPEC = WORKFLOW_COMMANDS.renewal
const PRICE_INDEX = 'price_index_rates'

/**
 * Dil okulunda öğrencinin son kurundaki kur sonu kararı (DOM-DIL-070): kur kayıtları, kurlar ve
 * kararlar kurum kapsamında okunur; hesap core `renewalCourseOffer`'dadır. Okulda `null`: okul
 * yenilemesi kurdan bağımsızdır.
 */
export async function renewalCourseOfferFor(
  db: Database,
  institutionId: string,
  studentId: string,
) {
  const institution = await getInstitution(db, institutionId)
  if (institution?.type !== 'language_school') return null
  const [enrollments, courses, decisions] = await Promise.all([
    listStudentCourseEnrollments(db, institutionId, studentId),
    loadCourses(db, institutionId),
    listProgressionDecisions(db, institutionId, { learnerId: studentId }),
  ])
  return renewalCourseOffer({ studentId, enrollments, courses, decisions })
}

const debtInvoice = z.object({
  id: z.string(),
  studentId: z.string(),
  amount: z.number().int(),
  paidAt: z.string().nullable().optional(),
  feeKind: z.string().optional(),
  academicYear: z.number().int().optional(),
  dueDate: z.string(),
})

/**
 * Öğrencilerin önceki yıllardan ödenmemiş öğrenim ücreti (DOM-KAY-025, ON-057): taksitler tablodan,
 * kısmi ödemeler iptal edilmemiş dağılımlardan okunur; hesap core `outstandingTuitionCents`. Toplu
 * yol sayfa başına tek sorguyla okur. Borcu olmayan öğrenci sonuçta yoktur.
 */
export async function tuitionDebts(
  tx: Database,
  ctx: ServiceContext,
  studentIds: readonly string[],
  academicYear: number,
): Promise<Map<string, number>> {
  const rows = await loadFinanceRecords(tx, ctx.institutionId, 'invoices', {
    match: [{ kind: 'equals', field: 'studentId', values: studentIds }],
  })
  const invoices = rows.map((row) => debtInvoice.parse({ ...row.data, id: row.id }))
  const allocated = await allocatedForInvoices(
    tx,
    ctx.institutionId,
    invoices.map((invoice) => invoice.id),
  )
  const byStudent = new Map<string, (typeof invoices)[number][]>()
  for (const invoice of invoices)
    byStudent.set(invoice.studentId, [...(byStudent.get(invoice.studentId) ?? []), invoice])
  const today = dayKey(ctx.now)
  const debts = new Map<string, number>()
  for (const [studentId, own] of byStudent) {
    const debt = outstandingTuitionCents(own, allocated, academicYear, today)
    if (debt > 0) debts.set(studentId, debt)
  }
  return debts
}

/**
 * Öğrenciden bağımsız fiyat girdileri; önizleme, plan ve toplu yol aynısını okur. Süresinde ilan
 * yoksa önceki yılın tarifesi geçerli kalır (DOM-FIN-002, K-11); `previousTariff` tavanın bazı olarak
 * aynen kalır (DOM-FIN-005).
 */
export async function sharedRenewalContext(
  tx: Database,
  ctx: ServiceContext,
  institutionType: InstitutionType,
  input: { academicYear: number; scholarshipProgramId?: string | undefined },
) {
  const [published, previousTariff, priceIndexes] = await Promise.all([
    findPublishedTariff(tx, ctx.institutionId, input.academicYear),
    findPublishedTariff(tx, ctx.institutionId, input.academicYear - 1),
    allPriceIndexes(tx, ctx.institutionId),
  ])
  const programId = input.scholarshipProgramId
  const effective = resolveEffectiveTariff({
    academicYear: input.academicYear,
    institutionType,
    published,
    previousPublished: previousTariff,
    now: ctx.now,
  })
  return {
    tariff: effective?.tariff ?? null,
    tariffCarriedOverFromYear: effective?.carriedOverFromYear ?? null,
    previousTariff,
    priceIndexes,
    ...(programId === undefined
      ? {}
      : {
          scholarshipProgram: await findScholarshipProgram(tx, ctx.institutionId, programId),
          scholarshipAwardedCount: await countScholarshipAwards(tx, ctx.institutionId, programId),
        }),
  }
}

/** Fiyatı etkileyen satırları işlemin içinde okur: önizleme ve plan aynı girdiyle hesaplar. */
async function renewalContext(
  tx: Database,
  ctx: ServiceContext,
  institutionType: InstitutionType,
  input: {
    studentId: string
    academicYear: number
    scholarshipProgramId?: string | undefined
    referralRewardId?: string | undefined
  },
): Promise<RenewalContext> {
  const [shared, debts, courseOffer, openStudentServiceKinds] = await Promise.all([
    sharedRenewalContext(tx, ctx, institutionType, input),
    tuitionDebts(tx, ctx, [input.studentId], input.academicYear),
    renewalCourseOfferFor(tx, ctx.institutionId, input.studentId),
    openServiceKindsOfYear(tx, ctx, input.studentId, input.academicYear),
  ])
  return {
    ...shared,
    outstandingTuitionCents: debts.get(input.studentId) ?? 0,
    openStudentServiceKinds,
    courseOffer,
    ...(input.referralRewardId === undefined
      ? {}
      : {
          referralReward: await findReferralReward(tx, ctx.institutionId, input.referralRewardId),
        }),
    ...(input.scholarshipProgramId === undefined
      ? {}
      : {
          // Öğrenci yılda en çok bir burs alır; kısıta çarpmadan özgül kodla reddedilir.
          scholarshipStudentAwarded: await hasStudentScholarshipAward(
            tx,
            ctx.institutionId,
            input.studentId,
            input.academicYear,
          ),
        }),
  }
}

/**
 * Sözleşmesi yüklenecek öğrenciler: velinin öteki öğrencileri de okunur. Kardeş indirimi kardeşin o
 * yılki kaydına ve ücretine (DOM-FIN-022, K-22), tavan istisnası kardeşin yenileme yılındaki kaydına
 * bakar (DOM-FIN-023); istisna indirim seçilmese de değerlendirilir. Mezuniyet ücret hesaplamaz.
 */
export const renewalContractStudents = (
  ctx: ServiceContext,
  studentIds: readonly string[],
  priced = true,
): Promise<readonly string[]> =>
  priced ? loadStudentFamilies(ctx.db, ctx.institutionId, studentIds) : Promise.resolve(studentIds)

/**
 * Öğrencinin sözleşmeleri tavanın bazıdır; taksitler okunmaz, yeni kayıtlar sona eklenir. Kurumun
 * bütün finans kaydı her yenilemede yüklenmez.
 */
export const renewalLoadScope = (contractStudentIds: readonly string[]) => ({
  invoices: { ids: [] },
  contracts: {
    match: [{ kind: 'equals' as const, field: 'studentId', values: contractStudentIds }],
  },
})

/** Formun ücret özeti: hiçbir kayıt yazılmaz (DOM-FIN-005). Kapsam ve rol planla aynıdır. */
export async function quoteRenewalFor(ctx: ServiceContext, input: unknown) {
  const data = renewalQuoteSchema.parse(input)
  const contractStudents = await renewalContractStudents(ctx, [data.studentId])
  return runReadOnly(ctx, {
    action: 'renewal.quote',
    collections: SPEC.collections,
    stores: FINANCE_TABLE_STORES,
    loadScope: renewalLoadScope(contractStudents),
    load: async (tx) => {
      const { session, scalars, institutionType } = await environment(tx, ctx, SPEC)
      const context = await renewalContext(tx, ctx, institutionType, data)
      return { scalars, run: (state) => quoteRenewal(state, session, input, context) }
    },
  })
}

/**
 * Yenilemeyi planlar; 201 ve konu yenileme kaydıdır. Burs ataması aynı işlemdedir (öğrenci yılda en
 * çok bir burs alır, kısmi benzersiz indeks). Mezuniyet sözleşme ve taksit açmaz.
 */
export async function planRenewalCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const data = renewalPlanSchema.parse(input)
  const contractStudents = await renewalContractStudents(
    ctx,
    [data.studentId],
    data.mode === 'renew',
  )
  return runCommand(
    ctx,
    {
      action: 'renewal.plan',
      collections: SPEC.collections,
      stores: FINANCE_TABLE_STORES,
      loadScope: renewalLoadScope(contractStudents),
      entity: (result: { renewal: { id: string } }) => ({
        type: 'renewals',
        id: result.renewal.id,
      }),
      load: async (tx) => {
        const { session, scalars, institutionType } = await environment(tx, ctx, SPEC)
        const context = await renewalContext(tx, ctx, institutionType, {
          studentId: data.studentId,
          academicYear: data.academicYear,
          ...(data.mode === 'renew'
            ? {
                scholarshipProgramId: data.scholarshipProgramId,
                referralRewardId: data.referralRewardId,
              }
            : {}),
        })
        return {
          scalars,
          run: (state, { now, makeId }) =>
            planRenewal(state, session, input, makeId, now, {
              ...context,
              approvedByUserId: ctx.actor.userId,
            }),
        }
      },
      after: async (tx, result) => {
        // Tek kullanım aynı işlemdedir; yarışı kaybeden 409 alır, sözleşme de yazılmaz (DOM-FIN-024).
        if (result.referralUse !== null && result.contractId !== null)
          await useReferralReward(tx, ctx, {
            ...result.referralUse,
            contractId: result.contractId,
            studentId: result.renewal.studentId,
          })
        if (result.scholarshipAward === null) return
        const awardId = randomUUID()
        await insertScholarshipAward(tx, ctx.institutionId, {
          id: awardId,
          programId: result.scholarshipAward.programId,
          studentId: result.renewal.studentId,
          academicYear: result.renewal.year,
          amountCents: result.scholarshipAward.amountCents,
          awardedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'scholarship.award', { type: 'scholarship_awards', id: awardId }, [
          'programId',
          'studentId',
          'amountCents',
        ])
      },
    },
    (outcome) =>
      withTariffCarryOver(
        commandBody(
          { collection: 'renewals', id: outcome.result.renewal.id },
          outcome.changes,
          201,
          outcome.result.contractId === null ? {} : { contractId: outcome.result.contractId },
        ),
        outcome.result.renewal.pricing?.tariffCarriedOverFromYear,
      ),
    idempotency,
  )
}

// --- Okuma --------------------------------------------------------------------------------------

/** Kayıt alanları; eski (köprü) satırda ücret kararı (`pricing`) ve bazı tutarlar bulunmaz. */
const storedRenewalSchema = z.object({
  studentId: z.string(),
  fromClassId: z.string(),
  targetClassId: z.string(),
  year: z.number(),
  mode: z.enum(['renew', 'graduate']),
  status: z.string(),
  amount: z.number(),
  gross: z.number().optional(),
  discountAmount: z.number().optional(),
  scholarshipAmount: z.number().optional(),
  contractId: z.string().optional(),
  activatedAt: z.string().optional(),
  pricing: renewalPricingSchema.optional(),
})

const nameOf = (row: { data: Record<string, unknown> }) =>
  typeof row.data.name === 'string' ? row.data.name : null

async function namesOf(
  ctx: ServiceContext,
  items: readonly z.output<typeof storedRenewalSchema>[],
) {
  const [students, classes] = await Promise.all([
    loadRecordsByIds(ctx.db, ctx.institutionId, 'students', [
      ...new Set(items.map((item) => item.studentId)),
    ]),
    loadRecordsByIds(ctx.db, ctx.institutionId, 'classes', [
      ...new Set(items.flatMap((item) => [item.fromClassId, item.targetClassId]).filter(Boolean)),
    ]),
  ])
  return {
    students: new Map(students.map((row) => [row.id, nameOf(row)])),
    classes: new Map(classes.map((row) => [row.id, nameOf(row)])),
  }
}

type RenewalNames = Awaited<ReturnType<typeof namesOf>>

function renewalView(
  item: CollectionItem,
  record: z.output<typeof storedRenewalSchema>,
  names: RenewalNames,
) {
  return {
    id: item.id,
    version: item.version,
    createdAt: item.createdAt,
    studentId: record.studentId,
    studentName: names.students.get(record.studentId) ?? null,
    fromClassId: record.fromClassId,
    fromClassName: names.classes.get(record.fromClassId) ?? null,
    targetClassId: record.targetClassId === '' ? null : record.targetClassId,
    targetClassName: names.classes.get(record.targetClassId) ?? null,
    academicYear: record.year,
    mode: record.mode,
    status: record.status,
    netCents: record.amount,
    tuitionCents: record.gross ?? null,
    discountCents: record.discountAmount ?? null,
    scholarshipCents: record.scholarshipAmount ?? null,
    contractId: record.contractId ?? null,
    activatedAt: record.activatedAt ?? null,
    pricing: record.pricing ?? null,
  }
}

const SORT_FIELD = {
  createdAt: 'createdAt',
  studentName: 'studentName',
  status: 'status',
  netCents: 'amount',
} as const
export type RenewalSort = keyof typeof SORT_FIELD

/**
 * Liste core kapsamıyla daralır (`renewals`: yönetici ve ön büro kurum geneli, veli bağlı çocukları);
 * arama öğrenci adını da kapsar. Varsayılan sıra yeni yenileme önce.
 */
export async function listRenewalsFor(
  ctx: ServiceContext,
  query: {
    page: number
    pageSize: number
    q?: string | undefined
    status?: string | undefined
    studentId?: string | undefined
    sort?: RenewalSort | undefined
    descending?: boolean | undefined
  },
) {
  const { items, total } = await listCollection(ctx, 'renewals', {
    page: query.page,
    pageSize: query.pageSize,
    q: query.q,
    filters: {
      ...(query.status === undefined ? {} : { status: [query.status] }),
      ...(query.studentId === undefined ? {} : { studentId: [query.studentId] }),
    },
    sort: [
      query.sort === undefined
        ? { field: 'createdAt', descending: true }
        : { field: SORT_FIELD[query.sort], descending: query.descending === true },
    ],
  })
  const records = items.map((item) => storedRenewalSchema.parse(item.record))
  const names = await namesOf(ctx, records)
  return {
    items: items.flatMap((item, index) => {
      const record = records[index]
      return record ? [renewalView(item, record, names)] : []
    }),
    total,
  }
}

const storedInvoiceSchema = z.object({
  installment: z.number(),
  amount: z.number(),
  dueDate: z.string(),
  paidAt: z.string().nullable().optional(),
  feeKind: z.string().optional(),
})

/**
 * Yenileme ayrıntısı: sözleşmenin yalnız kendi taksitleri (`invoiceIds`, DOM-FIN-012). Kayıt kapsam
 * dışındaysa 404; taksitler yetki gereği aynı öğrencinin kaydıdır.
 */
export async function getRenewalFor(ctx: ServiceContext, id: string) {
  const item = await getCollectionItem(ctx, 'renewals', id)
  const record = storedRenewalSchema.parse(item.record)
  const names = await namesOf(ctx, [record])
  const [contract] =
    record.contractId === undefined
      ? []
      : await loadFinanceRecords(ctx.db, ctx.institutionId, 'contracts', {
          ids: [record.contractId],
        })
  const invoiceIds = z.array(z.string()).catch([]).parse(contract?.data.invoiceIds)
  const invoices = await loadFinanceRecords(ctx.db, ctx.institutionId, 'invoices', {
    ids: invoiceIds,
  })
  return {
    ...renewalView(item, record, names),
    invoices: invoices
      .map((row) => {
        const invoice = storedInvoiceSchema.parse(row.data)
        return {
          id: row.id,
          installment: invoice.installment,
          amountCents: invoice.amount,
          dueDate: invoice.dueDate,
          paidAt: invoice.paidAt ?? null,
          feeKind: invoice.feeKind ?? null,
        }
      })
      .sort((a, b) => a.installment - b.installment),
  }
}

// --- ÜFE ve TÜFE profili (DOM-FIN-005) ----------------------------------------------------------

export const listPriceIndexesFor = (
  ctx: ServiceContext,
  query: { page: number; pageSize: number },
) => listPriceIndexes(ctx.db, ctx.institutionId, query)

async function reloadPriceIndex(tx: Database, ctx: ServiceContext, academicYear: number) {
  const row = await findPriceIndex(tx, ctx.institutionId, academicYear)
  if (row === null) throw new NotFoundError()
  return row
}

/** Ücret yılına oran girer; yıl başına tek satır (409 `price_index_exists`). 201. */
export function createPriceIndexCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const { academicYear } = createPriceIndexSchema.parse(input)
  const entity = { type: PRICE_INDEX, id: String(academicYear) }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'price_index.create',
      collections: [],
      entity,
      load: async (tx) => {
        const existing = await findPriceIndex(tx, ctx.institutionId, academicYear)
        return {
          run: () => planPriceIndexCreate(input, existing !== null, dayKey(ctx.now)),
        }
      },
      after: async (tx, plan) => {
        await insertPriceIndex(tx, ctx.institutionId, { ...plan, now: ctx.now })
        await auditWork(tx, ctx, 'price_index.create', entity, Object.keys(plan))
        body = { data: await reloadPriceIndex(tx, ctx, academicYear) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Yanlış girilen oranı düzeltir; önceden açılmış plan değişmez (kararı kendi kaydındadır). */
export function updatePriceIndexCommand(
  ctx: ServiceContext,
  academicYear: number,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: PRICE_INDEX, id: String(academicYear) }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'price_index.update',
      collections: [],
      entity,
      load: async (tx) => {
        const row = await reloadPriceIndex(tx, ctx, academicYear)
        if (row.version !== expectedVersion) throw new ConflictError()
        return { run: () => planPriceIndexUpdate(input, dayKey(ctx.now)) }
      },
      after: async (tx, plan) => {
        const saved = await updatePriceIndex(tx, ctx.institutionId, {
          academicYear,
          expectedVersion,
          changes: plan,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'price_index.update', entity, Object.keys(plan))
        body = { data: await reloadPriceIndex(tx, ctx, academicYear) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
