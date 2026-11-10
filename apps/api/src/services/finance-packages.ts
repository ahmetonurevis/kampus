import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import {
  packageSaleAlerts,
  type PackageAlert,
} from '@kampus/school-core/lib/finance-package-alerts.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  createPackageSchema,
  extendPackageSaleSchema,
  packageHourBalance,
  packageQuoteSchema,
  packageSaleStatus,
  packageUsedHoursRecorded,
  planPackageCreate,
  planPackageExtension,
  planPackageHourEntry,
  planPackageUpdate,
  planPackageUsedHours,
  quotePackageSale,
  sellPackage,
  sellPackageSchema,
  updatePackageSchema,
  type LessonPackage,
  type PackageCourse,
  type PackageKind,
  type PackageSaleContext,
} from '@kampus/school-core/lib/finance-packages.ts'
import { financeStudentIds } from '@kampus/school-core/lib/scope.ts'

import type { Database } from '../db/client.ts'
import type { CollectionName } from '../db/collections.ts'
import { loadCourses } from '../db/courses.ts'
import { findPublishedTariff } from '../db/fee-tariffs.ts'
import { loadFinanceRecords } from '../db/finance-mirror-store.ts'
import {
  archiveLessonPackage,
  archiveManualHourEntries,
  bumpPackageSaleVersion,
  extendPackageSale,
  findLessonPackage,
  findPackageSale,
  insertLessonPackage,
  insertPackageHourEntry,
  insertPackageSale,
  isPackageNameTaken,
  listAllPackageSales,
  listLessonPackages,
  listPackageSales,
  loadPackageHourEntries,
  updateLessonPackage,
  type StoredPackageSale,
} from '../db/finance-packages.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { institutionSettings } from '../db/schema/institution-settings.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { getInstitutionModules } from './modules.ts'
import {
  FINANCE_TABLE_STORES,
  runCommand,
  runReadOnly,
  type CommandResponse,
  type IdempotencyRequest,
  type LoadScope,
} from './operation-runner.ts'
import { assertReadable, readScope } from './read-scope.ts'
import { auditWork } from './task-work.ts'

/**
 * Dil okulu paket ve ders saati satışı (IST-078; docs/domain/dil-okulu.md DOM-DIL-006, -050, -051;
 * finans.md DOM-FIN-002, -006, -010). Kural core `lib/finance-packages.ts`'tedir. Satış, sözleşme ve
 * taksitler tek transaction'da yazılır (`FINANCE_TABLE_STORES`, ADR 0010); fiyat ve tarife kurum
 * kilidi altında okunur. Bakiye saklanmaz, saat hareketlerinden hesaplanır.
 */

const PACKAGE_ENTITY = 'lesson_packages'
const SALE_ENTITY = 'lesson_package_sales'
const HOUR_ENTITY = 'lesson_package_hour_entries'

const SALE_COLLECTIONS = [
  'students',
  'parents',
  'contracts',
  'invoices',
] as const satisfies readonly CollectionName[]

/** Yeni sözleşme ve taksit sona eklenir; yalnız kardeş sırası öteki sözleşmeleri okur (DOM-FIN-022). */
function saleScope(data: {
  studentId: string
  discounts: readonly string[]
}): Partial<Record<CollectionName, LoadScope>> {
  const sibling = data.discounts.includes('sibling')
  return {
    invoices: { ids: [] },
    ...(sibling
      ? {}
      : {
          students: { ids: [data.studentId] },
          contracts: {
            match: [{ kind: 'equals' as const, field: 'studentId', values: [data.studentId] }],
          },
        }),
  }
}

/** Kurun satışta okunan alanları; arşivli kur da döner, karar core'dadır. */
async function courseOf(
  tx: Database,
  institutionId: string,
  courseId: string | null,
): Promise<PackageCourse | null> {
  if (courseId === null) return null
  const course = (await loadCourses(tx, institutionId)).find((item) => item.id === courseId)
  return course
    ? { id: course.id, level: course.level, totalHours: course.totalHours, status: course.status }
    : null
}

/**
 * Satışın tarife yılı: kurumun etkin eğitim yılı, ayar yoksa bugünün yılı. Satış ve kur yenileme
 * teklif listesi (ON-082) aynı tarifeyi okur.
 */
export async function saleAcademicYear(tx: Database, ctx: ServiceContext): Promise<number> {
  const settings = await tx
    .select({ academicYear: institutionSettings.academicYear })
    .from(institutionSettings)
    .where(eq(institutionSettings.institutionId, ctx.institutionId))
    .limit(1)
  return settings[0]?.academicYear ?? Number(dayKey(ctx.now).slice(0, 4))
}

/** Fiyatı etkileyen satırları işlemin içinde okur: önizleme ve satış aynı girdiyle hesaplar. */
async function saleContext(
  tx: Database,
  ctx: ServiceContext,
  packageId: string,
): Promise<PackageSaleContext> {
  const [institution, academicYear, pkg] = await Promise.all([
    getInstitutionModules(tx, ctx.institutionId),
    saleAcademicYear(tx, ctx),
    findLessonPackage(tx, ctx.institutionId, packageId),
  ])
  const [tariff, course] = await Promise.all([
    findPublishedTariff(tx, ctx.institutionId, academicYear),
    courseOf(tx, ctx.institutionId, pkg?.courseId ?? null),
  ])
  return {
    institutionType: institution?.type ?? 'school',
    package: pkg,
    course,
    tariff,
    academicYear,
    // Personel çocuğu istisnasını yalnız yönetici onaylar (DOM-FIN-021).
    canApproveCapException: ctx.actor.role === 'yonetici',
  }
}

// --- Paket tanımı --------------------------------------------------------------------------------

export const listPackagesFor = (
  ctx: ServiceContext,
  query: {
    page: number
    pageSize: number
    q?: string | undefined
    kind?: PackageKind | undefined
    courseId?: string | undefined
  },
) => listLessonPackages(ctx.db, ctx.institutionId, query)

export async function getPackageFor(ctx: ServiceContext, id: string) {
  const found = await findLessonPackage(ctx.db, ctx.institutionId, id)
  if (found === null) throw new NotFoundError()
  return found
}

async function reloadPackage(tx: Database, ctx: ServiceContext, id: string) {
  const row = await findLessonPackage(tx, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  return row
}

/** Paket tanımı (DOM-DIL-050); ad etkin paketlerde tekildir. 201. */
export function createPackageCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const data = createPackageSchema.parse(input)
  const id = randomUUID()
  const entity = { type: PACKAGE_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'package.create',
      collections: [],
      entity,
      load: async (tx) => {
        const [course, nameTaken] = await Promise.all([
          courseOf(tx, ctx.institutionId, data.courseId),
          isPackageNameTaken(tx, ctx.institutionId, data.name),
        ])
        return { run: () => planPackageCreate(input, { course, nameTaken }) }
      },
      after: async (tx, plan) => {
        const row: LessonPackage = { ...plan, id }
        await insertLessonPackage(tx, ctx.institutionId, { ...row, now: ctx.now })
        await auditWork(tx, ctx, 'package.create', entity, Object.keys(plan))
        body = { data: await reloadPackage(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Düzeltme yalnız sonraki satışları etkiler; satış satırı kopyadır. */
export function updatePackageCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const { name } = updatePackageSchema.parse(input)
  const entity = { type: PACKAGE_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'package.update',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await reloadPackage(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        const nameTaken =
          name !== undefined && (await isPackageNameTaken(tx, ctx.institutionId, name, id))
        return { run: () => planPackageUpdate(current, input, { nameTaken }) }
      },
      after: async (tx, plan) => {
        const saved = await updateLessonPackage(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes: plan,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'package.update', entity, Object.keys(plan))
        body = { data: await reloadPackage(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Arşivli paket satılamaz; geçmiş satışlar ve bakiyeleri kalır. */
export function archivePackageCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: PACKAGE_ENTITY, id }
  return runCommand(
    ctx,
    {
      action: 'package.archive',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await reloadPackage(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        return { run: () => null }
      },
      after: async (tx) => {
        const saved = await archiveLessonPackage(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'package.archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id } } }),
    idempotency,
  )
}

// --- Satış ---------------------------------------------------------------------------------------

/** Satış formunun ücret özeti (DOM-DIL-050): hiçbir kayıt yazılmaz, kurallar satışla aynıdır. */
export function quotePackageSaleFor(ctx: ServiceContext, input: unknown) {
  const data = packageQuoteSchema.parse(input)
  return runReadOnly(ctx, {
    action: 'package.quote',
    collections: SALE_COLLECTIONS,
    stores: FINANCE_TABLE_STORES,
    loadScope: saleScope(data),
    load: async (tx) => {
      const context = await saleContext(tx, ctx, data.packageId)
      return { run: (state, { now }) => quotePackageSale(state, input, now, context) }
    },
  })
}

function saleView(
  sale: StoredPackageSale,
  entries: Parameters<typeof packageHourBalance>[1],
  today: string,
) {
  const balance = packageHourBalance(sale.purchasedHours, entries)
  const facts = { expiresDate: sale.expiresDate, remainingHours: balance.remainingHours }
  return {
    ...sale,
    ...balance,
    usedHoursRecorded: packageUsedHoursRecorded(entries),
    status: packageSaleStatus(facts, today),
    alerts: packageSaleAlerts({ ...facts, purchasedHours: sale.purchasedHours }, today),
  }
}

async function reloadSale(tx: Database, ctx: ServiceContext, id: string) {
  const row = await findPackageSale(tx, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  return row
}

/**
 * Paketi satar: satış satırı, sözleşme ve taksitler tek işlemde (IST-078). Tutar girdi değildir,
 * tarifeden hesaplanır (DOM-DIL-050). Yanıt yalnız kimlik ve tutar taşır; `Idempotency-Key` kaydına
 * ad yazılmaz. 201.
 */
export function sellPackageCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const data = sellPackageSchema.parse(input)
  const id = randomUUID()
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'package.sell',
      collections: SALE_COLLECTIONS,
      stores: FINANCE_TABLE_STORES,
      loadScope: saleScope(data),
      entity: { type: SALE_ENTITY, id },
      load: async (tx) => {
        const context = await saleContext(tx, ctx, data.packageId)
        return {
          run: (state, { now, makeId }) =>
            sellPackage(state, input, makeId, now, {
              ...context,
              approvedByUserId: ctx.actor.userId,
            }),
        }
      },
      after: async (tx, sale) => {
        await insertPackageSale(tx, ctx.institutionId, {
          id,
          sale,
          soldByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        body = { data: saleView(await reloadSale(tx, ctx, id), [], dayKey(ctx.now)) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

const nameOf = (row: { data: Record<string, unknown> }) =>
  typeof row.data.name === 'string' ? row.data.name : null

async function studentNames(ctx: ServiceContext, ids: readonly string[]) {
  const rows = await loadRecordsByIds(ctx.db, ctx.institutionId, 'students', [...new Set(ids)])
  return new Map(rows.map((row) => [row.id, nameOf(row)]))
}

/** Yönetici ve ön büro ayrılmış kursiyerin satışını da görür; öğrenci kaydı kapsamdan bağımsızdır. */
const institutionWide = (ctx: ServiceContext) =>
  ctx.actor.role === 'yonetici' || ctx.actor.role === 'onburo'

/**
 * Satış satırının yalnız yönetici ve ön büroya giden alanları: tutar ve taksit (K-40, DOM-FIN-058)
 * ile iç kimlikler, yani paket, kur, öğrenci, sözleşme, tarife ve sürümler (K-41).
 */
const STAFF_ONLY_SALE_FIELDS = [
  'hourlyCents',
  'grossCents',
  'netCents',
  'invoices',
  'version',
  'packageId',
  'courseId',
  'studentId',
  'contractId',
  'tariffId',
  'tariffVersion',
] as const
type StaffOnlySaleField = (typeof STAFF_ONLY_SALE_FIELDS)[number]

type FamilySaleView<T> = Omit<T, StaffOnlySaleField> &
  Partial<Pick<T, StaffOnlySaleField & keyof T>>

/**
 * Veli ve öğrenci yanıtı: satış kimliği, paket adı ve türü, saatler, son kullanma ve durum kalır;
 * tutar, taksit (K-40) ve iç kimlik alanları (K-41) silinir. Yalnız şemadan düşmesine güvenilmez,
 * alan yanıtta hiç yoktur.
 */
function forReader<T extends object>(ctx: ServiceContext, sale: T): FamilySaleView<T> {
  const view: FamilySaleView<T> = { ...sale }
  if (institutionWide(ctx)) return view
  for (const field of STAFF_ONLY_SALE_FIELDS) Reflect.deleteProperty(view, field)
  return view
}

/**
 * Kapsam `/finance/students/:id/balance` ile aynıdır: yönetici ve ön büro kurum geneli, veli bağlı
 * çocuğu ve ödeyicisi olduğu öğrenci, öğrenci kendisi (DOM-FIN-052, K-04). Kapsam `studentId`
 * süzgeciyle daraltılır, genişletilmez. Varsayılan sıra yeni satış önce. Veli ve öğrenci satırında
 * tutar (K-40) ve iç kimlik (K-41) alanı yoktur.
 */
export async function listPackageSalesFor(
  ctx: ServiceContext,
  query: {
    page: number
    pageSize: number
    studentId?: string | undefined
    packageId?: string | undefined
    /** Yalnız bu uyarıyı taşıyan satışlar (K-248, K-249). */
    alert?: PackageAlert | undefined
  },
) {
  const scope = await readScope(ctx)
  assertReadable(ctx, scope, 'invoices')
  const permitted = financeStudentIds(scope)
  const wide = institutionWide(ctx)
  const studentIds =
    query.studentId !== undefined
      ? wide || permitted.has(query.studentId)
        ? [query.studentId]
        : []
      : wide
        ? undefined
        : [...permitted]
  const filter = { studentIds, packageId: query.packageId }
  const today = dayKey(ctx.now)
  const { items, total, entries } =
    query.alert === undefined
      ? await pagedSales(ctx, { ...filter, page: query.page, pageSize: query.pageSize })
      : await alertedSales(ctx, filter, query, today, query.alert)
  const names = await studentNames(
    ctx,
    items.map((item) => item.studentId),
  )
  return {
    items: items.map((sale) =>
      forReader(ctx, {
        ...saleView(sale, entries.get(sale.id) ?? [], today),
        studentName: names.get(sale.studentId) ?? null,
      }),
    ),
    total,
  }
}

type SaleListFilter = { studentIds: string[] | undefined; packageId: string | undefined }

async function pagedSales(ctx: ServiceContext, query: SaleListFilter & PageQuery) {
  const { items, total } = await listPackageSales(ctx.db, ctx.institutionId, query)
  const entries = await loadPackageHourEntries(
    ctx.db,
    ctx.institutionId,
    items.map((item) => item.id),
  )
  return { items, total, entries }
}

/** Uyarı süzgeci bakiyeden türer: bütün satışlar hesaplanır, sayfa sonra kesilir (K-248, K-249). */
async function alertedSales(
  ctx: ServiceContext,
  filter: SaleListFilter,
  page: PageQuery,
  today: string,
  alert: PackageAlert,
) {
  const all = await listAllPackageSales(ctx.db, ctx.institutionId, filter)
  const entries = await loadPackageHourEntries(
    ctx.db,
    ctx.institutionId,
    all.map((item) => item.id),
  )
  const matched = all.filter((sale) =>
    saleView(sale, entries.get(sale.id) ?? [], today).alerts.includes(alert),
  )
  const start = (page.page - 1) * page.pageSize
  return { items: matched.slice(start, start + page.pageSize), total: matched.length, entries }
}

type PageQuery = { page: number; pageSize: number }

const storedInvoiceSchema = z.object({
  installment: z.number(),
  amount: z.number(),
  dueDate: z.string(),
  paidAt: z.string().nullable().optional(),
  feeKind: z.string().optional(),
})

/**
 * Satış ayrıntısı: satın alınan, kullanılan ve kalan saat (IST-078), son kullanma günü ve
 * sözleşmenin yalnız kendi taksitleri (DOM-FIN-012). Kapsam listeyle aynı; kapsam dışı 404. Tutar,
 * taksit (K-40) ve iç kimlikler (K-41) yalnız yönetici ve ön büroya döner.
 */
export async function getPackageSaleFor(ctx: ServiceContext, id: string) {
  const scope = await readScope(ctx)
  assertReadable(ctx, scope, 'invoices')
  const sale = await findPackageSale(ctx.db, ctx.institutionId, id)
  if (sale === null) throw new NotFoundError()
  const wide = institutionWide(ctx)
  if (!wide && !financeStudentIds(scope).has(sale.studentId)) throw new NotFoundError()
  const [entries, names] = await Promise.all([
    loadPackageHourEntries(ctx.db, ctx.institutionId, [id]),
    studentNames(ctx, [sale.studentId]),
  ])
  const view = {
    ...saleView(sale, entries.get(id) ?? [], dayKey(ctx.now)),
    studentName: names.get(sale.studentId) ?? null,
  }
  // Veli ve öğrenci taksiti kendi bölümünde görür; sözleşme ve taksit burada hiç yüklenmez (K-40).
  if (!wide) return forReader(ctx, view)
  const [contract] = await loadFinanceRecords(ctx.db, ctx.institutionId, 'contracts', {
    ids: [sale.contractId],
  })
  const invoiceIds = z.array(z.string()).catch([]).parse(contract?.data.invoiceIds)
  const invoices = await loadFinanceRecords(ctx.db, ctx.institutionId, 'invoices', {
    ids: invoiceIds,
  })
  return {
    ...view,
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

/**
 * Son kullanma tarihini uzatır (DOM-DIL-051): kursiyerin seçimi, gerekçesiyle. Saatler zaten
 * silinmemiştir; uzatma yalnız tüketimi yeniden açar. Gerekçe yalnız denetim kaydına yazılır.
 */
export function extendPackageSaleCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const { reason } = extendPackageSaleSchema.parse(input)
  const entity = { type: SALE_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'package.extend',
      collections: [],
      entity,
      load: async (tx) => {
        const sale = await reloadSale(tx, ctx, id)
        if (sale.version !== expectedVersion) throw new ConflictError()
        const entries = await loadPackageHourEntries(tx, ctx.institutionId, [id])
        const { remainingHours } = packageHourBalance(sale.purchasedHours, entries.get(id) ?? [])
        const today = dayKey(ctx.now)
        return {
          run: () =>
            planPackageExtension({ expiresDate: sale.expiresDate, remainingHours }, input, today),
        }
      },
      after: async (tx, plan) => {
        const saved = await extendPackageSale(tx, ctx.institutionId, {
          id,
          expiresDate: plan.expiresDate,
          expectedVersion,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await tx.insert(auditLog).values({
          institutionId: ctx.institutionId,
          actorUserId: ctx.actor.userId,
          actorRole: ctx.actor.role,
          action: 'package.extend',
          entityType: entity.type,
          entityId: entity.id,
          changes: { fields: ['expiresDate'] },
          reason,
          createdAt: ctx.now,
        })
        const entries = await loadPackageHourEntries(tx, ctx.institutionId, [id])
        body = {
          data: saleView(await reloadSale(tx, ctx, id), entries.get(id) ?? [], dayKey(ctx.now)),
        }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Pasif ya da arşivli kursiyerin saati ayrılış hesabına girmiştir (DOM-FIN-041). */
async function studentIsActive(tx: Database, ctx: ServiceContext, studentId: string) {
  const [row] = await loadRecordsByIds(tx, ctx.institutionId, 'students', [studentId])
  return row !== undefined && row.data.isActive !== false
}

/**
 * Kullanılan saati elle yazar (K-21, DOM-DIL-051): yoklama bağı (OG-116, OG-144) yokken ayrılışta
 * fazla iade çıkmasın diye. Eski değer arşivli harekette kalır; gerekçe yalnız denetim kaydındadır.
 *
 * TODO(package-attendance): yoklama bağı gelince bu komut kaldırılabilir.
 */
export function setPackageUsedHoursCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SALE_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'package.used_hours',
      collections: [],
      entity,
      load: async (tx) => {
        const sale = await reloadSale(tx, ctx, id)
        if (sale.version !== expectedVersion) throw new ConflictError()
        const [entries, studentActive] = await Promise.all([
          loadPackageHourEntries(tx, ctx.institutionId, [id]),
          studentIsActive(tx, ctx, sale.studentId),
        ])
        return {
          run: () => planPackageUsedHours(sale, entries.get(id) ?? [], input, { studentActive }),
        }
      },
      after: async (tx, plan) => {
        const saved = await bumpPackageSaleVersion(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await archiveManualHourEntries(tx, ctx.institutionId, { saleId: id, now: ctx.now })
        const today = dayKey(ctx.now)
        await insertPackageHourEntry(tx, ctx.institutionId, {
          id: randomUUID(),
          saleId: id,
          kind: 'consumed',
          hours: plan.manualHours,
          occurredDate: today,
          sourceType: 'manual',
          sourceId: id,
          recordedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await tx.insert(auditLog).values({
          institutionId: ctx.institutionId,
          actorUserId: ctx.actor.userId,
          actorRole: ctx.actor.role,
          action: 'package.used_hours',
          entityType: entity.type,
          entityId: entity.id,
          changes: { fields: ['usedHours'] },
          reason: plan.reason,
          createdAt: ctx.now,
        })
        const entries = await loadPackageHourEntries(tx, ctx.institutionId, [id])
        body = { data: saleView(await reloadSale(tx, ctx, id), entries.get(id) ?? [], today) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Saat hareketi yazar (DOM-DIL-051, IST-078): bakiye kurum kilidi altında denetlenir, sıfırın altına
 * inmez. Aynı kaynak yeniden gelirse yazmaz. HTTP ucu yoktur: yoklama ve özel ders köprüsü (OG-116,
 * OG-144) ile ayrılış bu servisi çağırır. `recorded: false`: bu kaynak zaten yazılmıştı.
 */
export async function recordPackageHours(
  ctx: ServiceContext,
  saleId: string,
  input: unknown,
): Promise<{ recorded: boolean }> {
  const id = randomUUID()
  let recorded = false
  await runCommand(
    ctx,
    {
      action: 'package.hours',
      collections: [],
      entity: { type: HOUR_ENTITY, id },
      load: async (tx) => {
        const sale = await reloadSale(tx, ctx, saleId)
        const entries = await loadPackageHourEntries(tx, ctx.institutionId, [saleId])
        const today = dayKey(ctx.now)
        return { run: () => planPackageHourEntry(sale, entries.get(saleId) ?? [], input, today) }
      },
      after: async (tx, plan) => {
        if (plan === null) return
        await insertPackageHourEntry(tx, ctx.institutionId, {
          ...plan,
          id,
          saleId,
          recordedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'package.hours', { type: HOUR_ENTITY, id }, Object.keys(plan))
        recorded = true
      },
    },
    () => ({ statusCode: 200, body: null }),
    null,
  )
  return { recorded }
}
