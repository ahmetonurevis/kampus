import { and, asc, count, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'

import type {
  SupplierCategory,
  SupplierFields,
  SupplierType,
} from '@kampus/school-core/lib/finance-suppliers.ts'

import type { Database } from './client.ts'
import { suppliers } from './schema/finance-suppliers.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Tedarikçi deposu (DOM-FIN-070; ON-221). Kurum kapsamlıdır: ilk parametre `institutionId`. Kural
 * core `lib/finance-suppliers.ts`'tedir; depo yalnız okur ve yazar, maskeyi servis uygular.
 */

export type StoredSupplier = SupplierFields & {
  id: string
  isActive: boolean
  version: number
  createdAt: string
}

const COLUMNS = {
  id: suppliers.id,
  name: suppliers.name,
  type: suppliers.type,
  taxNumber: suppliers.taxNumber,
  taxOffice: suppliers.taxOffice,
  categories: suppliers.categories,
  contactName: suppliers.contactName,
  contactPhone: suppliers.contactPhone,
  contactEmail: suppliers.contactEmail,
  address: suppliers.address,
  iban: suppliers.iban,
  documents: suppliers.documents,
  isActive: suppliers.isActive,
  version: suppliers.version,
  createdAt: suppliers.createdAt,
}

type Row = Omit<StoredSupplier, 'createdAt'> & { createdAt: Date }
const toSupplier = (row: Row): StoredSupplier => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
})

const ofInstitution = (institutionId: string) =>
  and(eq(suppliers.institutionId, institutionId), isNull(suppliers.archivedAt))

export async function findSupplier(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredSupplier | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(suppliers)
    .where(and(ofInstitution(institutionId), eq(suppliers.id, id)))
    .limit(1)
  return row === undefined ? null : toSupplier(row)
}

/** Ad ve etkinlik; talep listesinde ve bağlı kayıt denetiminde. */
export async function loadSupplierRefs(
  db: Database,
  institutionId: string,
  ids: readonly string[],
): Promise<Map<string, { id: string; name: string; isActive: boolean }>> {
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({ id: suppliers.id, name: suppliers.name, isActive: suppliers.isActive })
    .from(suppliers)
    .where(and(ofInstitution(institutionId), inArray(suppliers.id, [...new Set(ids)])))
  return new Map(rows.map((row) => [row.id, row]))
}

/** Vergi numarası başka bir tedarikçide (pasif dahil) kullanılıyor mu; düzeltmede kendisi dışlanır. */
export async function isSupplierTaxNumberTaken(
  db: Database,
  institutionId: string,
  taxNumber: string,
  exceptId?: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(
      and(
        ofInstitution(institutionId),
        eq(suppliers.taxNumber, taxNumber),
        exceptId === undefined ? undefined : sql`${suppliers.id} <> ${exceptId}`,
      ),
    )
    .limit(1)
  return row !== undefined
}

export interface SupplierQuery {
  page: number
  pageSize: number
  q?: string | undefined
  status?: 'active' | 'inactive' | undefined
  type?: SupplierType | undefined
  category?: SupplierCategory | undefined
  /** Vergi numarasında arama yalnız tam değeri görebilen rolde (yönetici) açıktır. */
  searchTaxNumber: boolean
}

/** Tedarikçiler, etkinler önce, unvana göre. */
export async function listSuppliers(
  db: Database,
  institutionId: string,
  query: SupplierQuery,
): Promise<{ items: StoredSupplier[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const searchBy: SQL[] =
    search === undefined ? [] : [sql`strpos(${foldSql(suppliers.name)}, ${search}) > 0`]
  if (search !== undefined && query.searchTaxNumber)
    searchBy.push(sql`strpos(${suppliers.taxNumber}, ${search}) > 0`)
  const where = and(
    ofInstitution(institutionId),
    searchBy.length === 0 ? undefined : or(...searchBy),
    query.status === undefined ? undefined : eq(suppliers.isActive, query.status === 'active'),
    query.type === undefined ? undefined : eq(suppliers.type, query.type),
    query.category === undefined
      ? undefined
      : sql`${query.category} = any(${suppliers.categories})`,
  )
  const [totalRow] = await db.select({ total: count() }).from(suppliers).where(where)
  const rows = await db
    .select(COLUMNS)
    .from(suppliers)
    .where(where)
    .orderBy(sql`${suppliers.isActive} desc`, asc(foldSql(suppliers.name)), asc(suppliers.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toSupplier), total: totalRow?.total ?? 0 }
}

export async function insertSupplier(
  tx: Database,
  institutionId: string,
  input: SupplierFields & { id: string; now: Date },
): Promise<void> {
  const { now, ...fields } = input
  await tx.insert(suppliers).values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

/** Sürüm tutmazsa `false` (409). */
export async function updateSupplier(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    changes: Partial<SupplierFields> & { isActive?: boolean }
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(suppliers)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        ofInstitution(institutionId),
        eq(suppliers.id, input.id),
        eq(suppliers.version, input.expectedVersion),
      ),
    )
    .returning({ id: suppliers.id })
  return rows.length === 1
}
