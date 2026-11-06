import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import {
  packageNameKey,
  type LessonPackage,
  type PackageHourEntry,
  type PackageKind,
  type PackageSaleDraft,
} from '@kampus/school-core/lib/finance-packages.ts'
import type { WithdrawalPackageSale } from '@kampus/school-core/lib/withdrawals.ts'

import type { Database } from './client.ts'
import { foldSearch, foldSql } from './text-search.ts'
import {
  lessonPackageHourEntries,
  lessonPackages,
  lessonPackageSales,
} from './schema/finance-packages.ts'

/**
 * Paket ve satış deposu (IST-078; DOM-DIL-050, -051). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Satış satırı kopyadır; depo yalnız son kullanma gününü güncelleyebilir.
 */

export type StoredPackage = LessonPackage & { version: number }

const PACKAGE_COLUMNS = {
  id: lessonPackages.id,
  kind: lessonPackages.kind,
  name: lessonPackages.name,
  courseId: lessonPackages.courseId,
  level: lessonPackages.level,
  lessonHours: lessonPackages.lessonHours,
  hourlyCents: lessonPackages.hourlyCents,
  validityDays: lessonPackages.validityDays,
  version: lessonPackages.version,
}

const activePackage = (institutionId: string) =>
  and(eq(lessonPackages.institutionId, institutionId), isNull(lessonPackages.archivedAt))

export async function findLessonPackage(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredPackage | null> {
  const [row] = await db
    .select(PACKAGE_COLUMNS)
    .from(lessonPackages)
    .where(and(activePackage(institutionId), eq(lessonPackages.id, id)))
    .limit(1)
  return row ?? null
}

/** Ad başka bir etkin pakette kullanılıyor mu; düzeltmede paketin kendisi dışlanır. */
export async function isPackageNameTaken(
  db: Database,
  institutionId: string,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: lessonPackages.id })
    .from(lessonPackages)
    .where(
      and(
        activePackage(institutionId),
        eq(lessonPackages.nameKey, packageNameKey(name)),
        exceptId === undefined ? undefined : sql`${lessonPackages.id} <> ${exceptId}`,
      ),
    )
    .limit(1)
  return row !== undefined
}

export async function listLessonPackages(
  db: Database,
  institutionId: string,
  query: {
    page: number
    pageSize: number
    q?: string | undefined
    kind?: PackageKind | undefined
    courseId?: string | undefined
  },
): Promise<{ items: StoredPackage[]; total: number }> {
  const where = and(
    activePackage(institutionId),
    query.kind === undefined ? undefined : eq(lessonPackages.kind, query.kind),
    query.courseId === undefined ? undefined : eq(lessonPackages.courseId, query.courseId),
    query.q === undefined
      ? undefined
      : sql`strpos(${foldSql(lessonPackages.name)}, ${foldSearch(query.q)}) > 0`,
  )
  const [totalRow] = await db.select({ total: count() }).from(lessonPackages).where(where)
  const items = await db
    .select(PACKAGE_COLUMNS)
    .from(lessonPackages)
    .where(where)
    .orderBy(asc(lessonPackages.nameKey))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items, total: totalRow?.total ?? 0 }
}

export async function insertLessonPackage(
  tx: Database,
  institutionId: string,
  input: LessonPackage & { now: Date },
): Promise<void> {
  const { now, ...fields } = input
  await tx.insert(lessonPackages).values({
    ...fields,
    institutionId,
    nameKey: packageNameKey(fields.name),
    createdAt: now,
    updatedAt: now,
  })
}

/** Sürüm tutmazsa `false` (409). */
export async function updateLessonPackage(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    changes: Partial<
      Pick<LessonPackage, 'name' | 'level' | 'lessonHours' | 'hourlyCents' | 'validityDays'>
    >
    now: Date
  },
): Promise<boolean> {
  const { name } = input.changes
  const rows = await tx
    .update(lessonPackages)
    .set({
      ...input.changes,
      ...(name === undefined ? {} : { nameKey: packageNameKey(name) }),
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        activePackage(institutionId),
        eq(lessonPackages.id, input.id),
        eq(lessonPackages.version, input.expectedVersion),
      ),
    )
    .returning({ id: lessonPackages.id })
  return rows.length === 1
}

/** Paketi arşivler; geçmiş satışlar kopya olduğundan etkilenmez. Sürüm tutmazsa `false` (409). */
export async function archiveLessonPackage(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(lessonPackages)
    .set({ archivedAt: input.now, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        activePackage(institutionId),
        eq(lessonPackages.id, input.id),
        eq(lessonPackages.version, input.expectedVersion),
      ),
    )
    .returning({ id: lessonPackages.id })
  return rows.length === 1
}

// --- Satış ---------------------------------------------------------------------------------------

export type StoredPackageSale = Omit<PackageSaleDraft, 'soldAt'> & {
  id: string
  soldAt: string
  version: number
}

const SALE_COLUMNS = {
  id: lessonPackageSales.id,
  packageId: lessonPackageSales.packageId,
  packageName: lessonPackageSales.packageName,
  kind: lessonPackageSales.kind,
  courseId: lessonPackageSales.courseId,
  level: lessonPackageSales.level,
  studentId: lessonPackageSales.studentId,
  contractId: lessonPackageSales.contractId,
  tariffId: lessonPackageSales.tariffId,
  tariffVersion: lessonPackageSales.tariffVersion,
  purchasedHours: lessonPackageSales.purchasedHours,
  hourlyCents: lessonPackageSales.hourlyCents,
  grossCents: lessonPackageSales.grossCents,
  netCents: lessonPackageSales.netCents,
  expiresDate: lessonPackageSales.expiresDate,
  soldAt: lessonPackageSales.soldAt,
  version: lessonPackageSales.version,
}

type SaleRow = Omit<StoredPackageSale, 'soldAt'> & { soldAt: Date }

const toSale = (row: SaleRow): StoredPackageSale => ({ ...row, soldAt: row.soldAt.toISOString() })

const activeSale = (institutionId: string) =>
  and(eq(lessonPackageSales.institutionId, institutionId), isNull(lessonPackageSales.archivedAt))

export async function insertPackageSale(
  tx: Database,
  institutionId: string,
  input: { id: string; sale: PackageSaleDraft; soldByUserId: string; now: Date },
): Promise<void> {
  await tx.insert(lessonPackageSales).values({
    ...input.sale,
    id: input.id,
    institutionId,
    soldAt: new Date(input.sale.soldAt),
    soldByUserId: input.soldByUserId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

export async function findPackageSale(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredPackageSale | null> {
  const [row] = await db
    .select(SALE_COLUMNS)
    .from(lessonPackageSales)
    .where(and(activeSale(institutionId), eq(lessonPackageSales.id, id)))
    .limit(1)
  return row ? toSale(row) : null
}

/** `studentIds` verilirse yalnız o öğrencilerin satışları; boş küme boş sonuç verir. */
export async function listPackageSales(
  db: Database,
  institutionId: string,
  query: {
    page: number
    pageSize: number
    studentIds?: readonly string[] | undefined
    packageId?: string | undefined
  },
): Promise<{ items: StoredPackageSale[]; total: number }> {
  if (query.studentIds?.length === 0) return { items: [], total: 0 }
  const where = and(
    activeSale(institutionId),
    query.studentIds === undefined
      ? undefined
      : inArray(lessonPackageSales.studentId, [...query.studentIds]),
    query.packageId === undefined ? undefined : eq(lessonPackageSales.packageId, query.packageId),
  )
  const [totalRow] = await db.select({ total: count() }).from(lessonPackageSales).where(where)
  const rows = await db
    .select(SALE_COLUMNS)
    .from(lessonPackageSales)
    .where(where)
    .orderBy(desc(lessonPackageSales.soldAt), asc(lessonPackageSales.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toSale), total: totalRow?.total ?? 0 }
}

/** Yalnız son kullanma günü değişir (DOM-DIL-051). Sürüm tutmazsa `false` (409). */
export async function extendPackageSale(
  tx: Database,
  institutionId: string,
  input: { id: string; expiresDate: string; expectedVersion: number; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(lessonPackageSales)
    .set({
      expiresDate: input.expiresDate,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        activeSale(institutionId),
        eq(lessonPackageSales.id, input.id),
        eq(lessonPackageSales.version, input.expectedVersion),
      ),
    )
    .returning({ id: lessonPackageSales.id })
  return rows.length === 1
}

// --- Saat hareketi -------------------------------------------------------------------------------

/** Satışların arşivlenmemiş hareketleri; bakiye bunlardan hesaplanır (DOM-DIL-051). */
export async function loadPackageHourEntries(
  db: Database,
  institutionId: string,
  saleIds: readonly string[],
): Promise<Map<string, PackageHourEntry[]>> {
  const grouped = new Map<string, PackageHourEntry[]>()
  if (saleIds.length === 0) return grouped
  const rows = await db
    .select({
      saleId: lessonPackageHourEntries.saleId,
      kind: lessonPackageHourEntries.kind,
      hours: lessonPackageHourEntries.hours,
      sourceType: lessonPackageHourEntries.sourceType,
      sourceId: lessonPackageHourEntries.sourceId,
    })
    .from(lessonPackageHourEntries)
    .where(
      and(
        eq(lessonPackageHourEntries.institutionId, institutionId),
        isNull(lessonPackageHourEntries.archivedAt),
        inArray(lessonPackageHourEntries.saleId, [...saleIds]),
      ),
    )
  for (const { saleId, ...entry } of rows) {
    const list = grouped.get(saleId)
    if (list) list.push(entry)
    else grouped.set(saleId, [entry])
  }
  return grouped
}

/**
 * Öğrencinin satışları ve tarihli saat hareketleri: ayrılış hesabının girdisi (DOM-FIN-040,
 * DOM-DIL-051). Kurum kilidi altında okunur, sayfalanmaz.
 */
export async function loadWithdrawalPackageSales(
  db: Database,
  institutionId: string,
  studentId: string,
): Promise<WithdrawalPackageSale[]> {
  const sales = await db
    .select({
      id: lessonPackageSales.id,
      contractId: lessonPackageSales.contractId,
      purchasedHours: lessonPackageSales.purchasedHours,
    })
    .from(lessonPackageSales)
    .where(and(activeSale(institutionId), eq(lessonPackageSales.studentId, studentId)))
  if (sales.length === 0) return []
  const rows = await db
    .select({
      saleId: lessonPackageHourEntries.saleId,
      kind: lessonPackageHourEntries.kind,
      hours: lessonPackageHourEntries.hours,
      occurredDate: lessonPackageHourEntries.occurredDate,
    })
    .from(lessonPackageHourEntries)
    .where(
      and(
        eq(lessonPackageHourEntries.institutionId, institutionId),
        isNull(lessonPackageHourEntries.archivedAt),
        inArray(
          lessonPackageHourEntries.saleId,
          sales.map((sale) => sale.id),
        ),
      ),
    )
  return sales.map((sale) => ({
    ...sale,
    entries: rows.filter((row) => row.saleId === sale.id),
  }))
}

export async function insertPackageHourEntry(
  tx: Database,
  institutionId: string,
  input: PackageHourEntry & {
    id: string
    saleId: string
    occurredDate: string
    recordedByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(lessonPackageHourEntries)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}
