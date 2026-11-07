import { createHash } from 'node:crypto'

import { z } from 'zod'

import type { RenewalCourseOffer } from '@kampus/school-core/lib/renewal-course-offer.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import {
  LAST_GRADE,
  previewRenewalBulk,
  renewalBulkPlanSchema,
  renewalBulkPreviewSchema,
  renewalBulkProblem,
  renewalBulkRowPlan,
  renewalBulkSkipped,
  renewalCandidateLines,
  type RenewalBulkProblem,
  type RenewalPlanStatus,
} from '@kampus/school-core/lib/renewal-bulk.ts'
import { WORKFLOW_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import { loadRenewalCandidatePage, loadStudentFamilies } from '../db/finance-renewal-candidates.ts'
import { studentsWithScholarshipAward } from '../db/finance-scholarships.ts'
import { findIdempotentResponse } from '../db/idempotency.ts'
import { loadRecords, loadRecordsByIds } from '../db/records.ts'
import { AppError, MESSAGES } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { loggableError } from '../plugins/error-handler.ts'
import { environment } from './commands.ts'
import {
  planRenewalCommand,
  renewalContractStudents,
  renewalLoadScope,
  renewalCourseOfferFor,
  sharedRenewalContext,
  tuitionDebts,
} from './finance-renewals.ts'
import { requestFingerprint } from './idempotency.ts'
import {
  FINANCE_TABLE_STORES,
  mapOperationError,
  runCommand,
  runReadOnly,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'

/**
 * Yeni yılın toplu yenileme uçları (IST-105, ON-086). Kural core `lib/renewal-bulk.ts` ve tek öğrenci
 * kuralıdır; burada yalnız yükleme ve sıralama vardır. Liste ve önizleme yazmaz, kurum kilidi almaz.
 */

const SPEC = WORKFLOW_COMMANDS.renewal

const classGrade = z.object({ grade: z.number() })

/** Liste satırının gerektirdiği koleksiyonlar: iş akışı kapsamı çalışmaz, kişi listeleri yüklenmez. */
const CANDIDATE_COLLECTIONS = ['students', 'classes', 'contracts', 'renewals'] as const

function nameMaps(state: State) {
  return {
    students: new Map(state.students.map((item) => [item.id, item.name])),
    classes: new Map(state.classes.map((item) => [item.id, item.name])),
  }
}

/**
 * Yenilenecek öğrenciler: etkin, sınıfı etkin ve son düzeyde değil. Sayfa SQL'den gelir; ücret, tavan
 * ve borç yalnız sayfanın öğrencileri için tek görüntüden hesaplanır.
 */
export async function listRenewalCandidatesFor(
  ctx: ServiceContext,
  query: {
    page: number
    pageSize: number
    academicYear: number
    classId?: string | undefined
    planStatus?: RenewalPlanStatus | undefined
    q?: string | undefined
  },
) {
  const classes = await loadRecords(ctx.db, ctx.institutionId, ['classes'], {
    match: [{ kind: 'active', field: 'isActive', active: true }],
  })
  const classIds = classes
    .filter((row) => classGrade.parse(row.data).grade < LAST_GRADE)
    .map((row) => row.id)
    .filter((id) => query.classId === undefined || id === query.classId)
  const { rows, total } = await loadRenewalCandidatePage(ctx.db, ctx.institutionId, {
    academicYear: query.academicYear,
    classIds,
    planStatus: query.planStatus,
    q: query.q,
    offset: (query.page - 1) * query.pageSize,
    limit: query.pageSize,
  })
  const studentIds = rows.map((row) => row.id)
  // Kardeş kaybı (DOM-FIN-023) velinin öteki öğrencisine bakar; onlar da yüklenir.
  const family = await loadStudentFamilies(ctx.db, ctx.institutionId, studentIds)
  const scope = [{ kind: 'equals' as const, field: 'studentId', values: studentIds }]
  const items = await runReadOnly(ctx, {
    action: 'renewal.candidates',
    collections: CANDIDATE_COLLECTIONS,
    stores: FINANCE_TABLE_STORES,
    loadScope: {
      students: { ids: family },
      contracts: { match: scope },
      renewals: { match: scope },
    },
    load: async (tx) => {
      const { session, scalars, institutionType } = await environment(tx, ctx, SPEC)
      const [shared, debts] = await Promise.all([
        sharedRenewalContext(tx, ctx, institutionType, { academicYear: query.academicYear }),
        tuitionDebts(tx, ctx, studentIds, query.academicYear),
      ])
      return {
        scalars,
        run: (state) => {
          const names = nameMaps(state)
          return renewalCandidateLines(
            state,
            session,
            { studentIds, academicYear: query.academicYear },
            { ...shared, debts },
          ).map((line) => ({
            ...line,
            studentName: names.students.get(line.studentId) ?? null,
            className: names.classes.get(line.classId) ?? null,
            targetClassName:
              line.targetClassId === null ? null : (names.classes.get(line.targetClassId) ?? null),
          }))
        },
      }
    },
  })
  return { items, total }
}

/**
 * Toplu önizleme: hiçbir şey yazmaz, tek görüntüden okur (`runReadOnly`). Öğrenci başına değişen
 * girdiler (borç, burs ataması) tek sorguyla yüklenir; satır kararı core `previewRenewalBulk`.
 */
export async function previewRenewalBulkFor(ctx: ServiceContext, input: unknown) {
  const data = renewalBulkPreviewSchema.parse(input)
  const studentIds = data.rows.map((row) => row.studentId)
  const contractStudents = await renewalContractStudents(ctx, studentIds, data.discounts)
  return runReadOnly(ctx, {
    action: 'renewal.bulk_preview',
    collections: SPEC.collections,
    stores: FINANCE_TABLE_STORES,
    loadScope: renewalLoadScope(contractStudents),
    load: async (tx) => {
      const { session, scalars, institutionType } = await environment(tx, ctx, SPEC)
      const [shared, debts, scholarshipStudents] = await Promise.all([
        sharedRenewalContext(tx, ctx, institutionType, data),
        tuitionDebts(tx, ctx, studentIds, data.academicYear),
        data.scholarshipProgramId === undefined
          ? undefined
          : studentsWithScholarshipAward(tx, ctx.institutionId, studentIds, data.academicYear),
      ])
      // Plan satırı kararsız kursiyeri reddeder; önizleme "hazır" demesin (DOM-DIL-070). Üst sınır
      // RENEWAL_BULK_LIMIT; okul kurumunda sorgu yok.
      const courseOffers = new Map<string, RenewalCourseOffer | null>()
      if (institutionType === 'language_school')
        for (const studentId of studentIds)
          courseOffers.set(studentId, await renewalCourseOfferFor(tx, ctx.institutionId, studentId))
      return {
        scalars,
        run: (state, { now, makeId }) => {
          const names = nameMaps(state)
          const rows = previewRenewalBulk(state, session, input, makeId, now, {
            ...shared,
            debts,
            courseOffers,
            ...(scholarshipStudents === undefined ? {} : { scholarshipStudents }),
          }).map((row) => ({
            ...row,
            studentName: names.students.get(row.studentId) ?? null,
            targetClassName: names.classes.get(row.targetClassId) ?? null,
          }))
          return {
            academicYear: data.academicYear,
            tariff:
              shared.tariff === null
                ? null
                : {
                    id: shared.tariff.id,
                    versionNumber: shared.tariff.versionNumber,
                    carriedOverFromYear: shared.tariffCarriedOverFromYear,
                  },
            summary: {
              ready: rows.filter((row) => row.outcome === 'ready').length,
              skipped: rows.filter((row) => row.outcome === 'skipped').length,
              failed: rows.filter((row) => row.outcome === 'failed').length,
            },
            rows,
          }
        },
      }
    },
  })
}

const rowPlanBody = z.object({
  data: z.object({
    entity: z.object({ id: z.string() }),
    contractId: z.string().optional(),
  }),
})

const plannedRenewal = z.object({
  amount: z.number().int(),
  installments: z.array(z.number().int()).default([]),
})

/** Yeniden denemede aynı satır aynı anahtarı üretir: yarıda kalan istek öğrenciyi iki kez planlamaz. */
const rowKey = (key: string, studentId: string) =>
  `bulk_${createHash('sha256').update(`${key}\u001f${studentId}`).digest('base64url')}`

const ROW_REQUEST = 'bulk-plan-row'

type PlanRow =
  | { studentId: string; outcome: 'planned'; renewalId: string; contractId: string | null }
  | { studentId: string; outcome: 'skipped' | 'failed'; problem: RenewalBulkProblem }

/** Satırın kendi transaction'ı: başarısızlığı yalnız bu öğrencinin kaydını geri alır. */
async function planRow(
  ctx: ServiceContext,
  data: z.output<typeof renewalBulkPlanSchema>,
  row: z.output<typeof renewalBulkPlanSchema>['rows'][number],
  key: string,
): Promise<PlanRow> {
  const body = renewalBulkRowPlan(data, row, data.tariffId)
  try {
    const response = await planRenewalCommand(ctx, body, {
      key: rowKey(key, row.studentId),
      fingerprint: requestFingerprint('POST', ROW_REQUEST, body),
    })
    const planned = rowPlanBody.parse(response.body).data
    return {
      studentId: row.studentId,
      outcome: 'planned',
      renewalId: planned.entity.id,
      contractId: planned.contractId ?? null,
    }
  } catch (error) {
    const failure = mapOperationError(error)
    const { code, message } =
      failure instanceof AppError && failure.statusCode < 500
        ? failure
        : { code: 'internal_error', message: MESSAGES.internal_error }
    if (code === 'internal_error')
      ctx.log.error({ event: 'renewal.bulk_row_failed', err: loggableError(error) })
    return {
      studentId: row.studentId,
      outcome: renewalBulkSkipped(code) ? 'skipped' : 'failed',
      problem: renewalBulkProblem(code, message),
    }
  }
}

/** Rapor: tutar ve taksitler kayıttan okunur, tekrarlanan satırda da aynıdır. */
async function bulkPlanReport(ctx: ServiceContext, academicYear: number, rows: readonly PlanRow[]) {
  const plannedIds = rows.flatMap((row) => (row.outcome === 'planned' ? [row.renewalId] : []))
  const [students, renewals] = await Promise.all([
    loadRecordsByIds(
      ctx.db,
      ctx.institutionId,
      'students',
      rows.map((row) => row.studentId),
    ),
    loadRecordsByIds(ctx.db, ctx.institutionId, 'renewals', plannedIds),
  ])
  const names = new Map(students.map((row) => [row.id, row.data.name]))
  const records = new Map(renewals.map((row) => [row.id, plannedRenewal.parse(row.data)]))
  return {
    academicYear,
    summary: {
      planned: rows.filter((row) => row.outcome === 'planned').length,
      skipped: rows.filter((row) => row.outcome === 'skipped').length,
      failed: rows.filter((row) => row.outcome === 'failed').length,
    },
    rows: rows.map((row) => {
      const name = names.get(row.studentId)
      const studentName = typeof name === 'string' ? name : null
      if (row.outcome !== 'planned')
        return {
          studentId: row.studentId,
          studentName,
          outcome: row.outcome,
          problem: row.problem,
          renewalId: null,
          contractId: null,
          netCents: null,
          installments: [],
        }
      const record = records.get(row.renewalId)
      return {
        studentId: row.studentId,
        studentName,
        outcome: row.outcome,
        problem: null,
        renewalId: row.renewalId,
        contractId: row.contractId,
        netCents: record?.amount ?? null,
        installments: record?.installments ?? [],
      }
    }),
  }
}

/**
 * Toplu plan onayı (yönetici). Her öğrenci kendi transaction'ında `planRenewalCommand`'ı çalıştırır:
 * kurum kilidi öğrenci arasında bırakılır, büyük toplu işlem kurumun öteki yazmalarını bekletmez; bir
 * öğrencinin reddi (kontenjan, tavan, borç) ötekilerin hazır sözleşmesini geri almaz, rapor satır
 * satır söyler. İdempotans iki katlıdır: satır anahtarı `Idempotency-Key`'den türer, istek yarıda
 * kalırsa yeniden denemede planlananlar tekrarlanır; rapor en sonda aynı anahtarla saklanır, tamamlanan
 * istek aynı raporu döner, farklı gövde 422 `idempotency_key_reused`. Borç onayı gövdede yoktur:
 * borçlu öğrenci atlanır (DOM-KAY-025).
 */
export async function bulkPlanRenewalsCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest,
): Promise<CommandResponse> {
  const data = renewalBulkPlanSchema.parse(input)
  const stored = await findIdempotentResponse(
    ctx.db,
    ctx.institutionId,
    ctx.actor.userId,
    idempotency.key,
    ctx.now,
  )
  if (stored) {
    if (stored.requestHash !== idempotency.fingerprint)
      throw new AppError(422, 'idempotency_key_reused', MESSAGES.idempotency_key_reused)
    return { statusCode: stored.statusCode, body: stored.body, replayed: true }
  }
  const rows: PlanRow[] = []
  // Sırayla: satırlar aynı kurum kilidine girer, koşut istek yalnız bağlantı tüketirdi.
  for (const row of data.rows) rows.push(await planRow(ctx, data, row, idempotency.key))
  const report = await bulkPlanReport(ctx, data.academicYear, rows)
  // Kaydı olmayan işlem: yanıtı anahtarla saklar; koşut aynı istek bitirmişse onun raporu döner.
  return runCommand(
    ctx,
    {
      action: 'renewal.bulk_plan',
      collections: [],
      entity: { type: 'renewals', id: 'bulk' },
      run: () => null,
    },
    () => ({ statusCode: 200, body: { data: report } }),
    idempotency,
  )
}
