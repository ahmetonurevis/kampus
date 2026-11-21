import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  max,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'

import type {
  FixedAssetAssigneeType,
  FixedAssetAssignmentPlan,
  FixedAssetAssignmentState,
  FixedAssetReturnCondition,
} from '@kampus/school-core/lib/finance-fixed-asset-assignments.ts'
import type { FixedAssetCategory } from '@kampus/school-core/lib/finance-fixed-assets.ts'
import { STAFF_ROLES } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { fixedAssetAssignments } from './schema/finance-fixed-asset-assignments.ts'
import { fixedAssets } from './schema/finance-fixed-assets.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Demirbaş zimmeti deposu (DOM-FIN-086; ON-236). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-fixed-asset-assignments.ts`'tedir; depo yalnız okur ve
 * yazar. Personel adı kullanıcı tablosundan okunur; uçlar yalnız yöneticiye açıktır (K-189).
 */

export interface StoredAssignment {
  id: string
  assetId: string
  assetTagNumber: string
  assetName: string
  assetCategory: FixedAssetCategory
  assigneeType: FixedAssetAssigneeType
  membershipId: string | null
  staffName: string | null
  staffRole: string | null
  staffActive: boolean | null
  campusId: string | null
  location: string | null
  assignedDate: string
  note: string | null
  assignedAt: string
  returnDate: string | null
  returnCondition: FixedAssetReturnCondition | null
  returnNote: string | null
  returnedAt: string | null
  version: number
}

const COLUMNS = {
  id: fixedAssetAssignments.id,
  assetId: fixedAssetAssignments.assetId,
  assetTagNumber: fixedAssets.tagNumber,
  assetName: fixedAssets.name,
  assetCategory: fixedAssets.category,
  assigneeType: fixedAssetAssignments.assigneeType,
  membershipId: fixedAssetAssignments.membershipId,
  staffName: users.name,
  staffRole: memberships.role,
  deactivatedAt: memberships.deactivatedAt,
  campusId: fixedAssetAssignments.campusId,
  location: fixedAssetAssignments.location,
  assignedDate: fixedAssetAssignments.assignedDate,
  note: fixedAssetAssignments.note,
  assignedAt: fixedAssetAssignments.assignedAt,
  returnDate: fixedAssetAssignments.returnDate,
  returnCondition: fixedAssetAssignments.returnCondition,
  returnNote: fixedAssetAssignments.returnNote,
  returnedAt: fixedAssetAssignments.returnedAt,
  version: fixedAssetAssignments.version,
}

type Row = Omit<StoredAssignment, 'assignedAt' | 'returnedAt' | 'staffActive'> & {
  assignedAt: Date
  returnedAt: Date | null
  deactivatedAt: Date | null
}
const toAssignment = ({ deactivatedAt, ...row }: Row): StoredAssignment => ({
  ...row,
  staffActive: row.membershipId === null ? null : deactivatedAt === null,
  assignedAt: row.assignedAt.toISOString(),
  returnedAt: row.returnedAt === null ? null : row.returnedAt.toISOString(),
})

const ofInstitution = (institutionId: string) =>
  and(
    eq(fixedAssetAssignments.institutionId, institutionId),
    isNull(fixedAssetAssignments.archivedAt),
  )

const withJoins = (db: Database) =>
  db
    .select(COLUMNS)
    .from(fixedAssetAssignments)
    .innerJoin(
      fixedAssets,
      and(
        eq(fixedAssets.institutionId, fixedAssetAssignments.institutionId),
        eq(fixedAssets.id, fixedAssetAssignments.assetId),
      ),
    )
    .leftJoin(
      memberships,
      and(
        eq(memberships.institutionId, fixedAssetAssignments.institutionId),
        eq(memberships.id, fixedAssetAssignments.membershipId),
      ),
    )
    .leftJoin(users, eq(users.id, memberships.userId))

/** Açık zimmetler önce, sonra yeni zimmet önce; eşitlikte kimlik (deterministik sıra). */
const ORDER = [
  sql`${fixedAssetAssignments.returnedAt} is not null`,
  desc(fixedAssetAssignments.assignedDate),
  desc(fixedAssetAssignments.assignedAt),
  asc(fixedAssetAssignments.id),
]

export async function findAssignment(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredAssignment | null> {
  const [row] = await withJoins(db)
    .where(and(ofInstitution(institutionId), eq(fixedAssetAssignments.id, id)))
    .limit(1)
  return row === undefined ? null : toAssignment(row)
}

export interface AssignmentQuery {
  page: number
  pageSize: number
  assetId?: string | undefined
  membershipId?: string | undefined
  state?: FixedAssetAssignmentState | undefined
  q?: string | undefined
}

/** Zimmetler: açıklar önce, yeni zimmet önce. `q` etiket, demirbaş adı, personel adı ve konumda. */
export async function listAssignments(
  db: Database,
  institutionId: string,
  query: AssignmentQuery,
): Promise<{ items: StoredAssignment[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    ofInstitution(institutionId),
    query.assetId === undefined ? undefined : eq(fixedAssetAssignments.assetId, query.assetId),
    query.membershipId === undefined
      ? undefined
      : eq(fixedAssetAssignments.membershipId, query.membershipId),
    query.state === undefined
      ? undefined
      : query.state === 'open'
        ? isNull(fixedAssetAssignments.returnedAt)
        : isNotNull(fixedAssetAssignments.returnedAt),
    search === undefined
      ? undefined
      : or(
          sql`strpos(${foldSql(fixedAssets.tagNumber)}, ${search}) > 0`,
          sql`strpos(${foldSql(fixedAssets.name)}, ${search}) > 0`,
          sql`strpos(${foldSql(sql`coalesce(${users.name}, '')`)}, ${search}) > 0`,
          sql`strpos(${foldSql(sql`coalesce(${fixedAssetAssignments.location}, '')`)}, ${search}) > 0`,
        ),
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(fixedAssetAssignments)
    .innerJoin(
      fixedAssets,
      and(
        eq(fixedAssets.institutionId, fixedAssetAssignments.institutionId),
        eq(fixedAssets.id, fixedAssetAssignments.assetId),
      ),
    )
    .leftJoin(
      memberships,
      and(
        eq(memberships.institutionId, fixedAssetAssignments.institutionId),
        eq(memberships.id, fixedAssetAssignments.membershipId),
      ),
    )
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(where)
  const rows = await withJoins(db)
    .where(where)
    .orderBy(...ORDER)
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toAssignment), total: totalRow?.total ?? 0 }
}

/** Demirbaşların açık zimmetleri (liste ve ayrıntıda "zimmetli" gösterimi). */
export async function loadOpenAssignments(
  db: Database,
  institutionId: string,
  assetIds: readonly string[],
): Promise<Map<string, StoredAssignment>> {
  if (assetIds.length === 0) return new Map()
  const rows = await withJoins(db)
    .where(
      and(
        ofInstitution(institutionId),
        inArray(fixedAssetAssignments.assetId, [...new Set(assetIds)]),
        isNull(fixedAssetAssignments.returnedAt),
      ),
    )
    .orderBy(...ORDER)
  return new Map(rows.map((row) => [row.assetId, toAssignment(row)]))
}

/** Demirbaşın zimmet durumu: açık zimmet var mı ve son iade günü (kurum kilidi altında). */
export async function loadAssignmentState(
  tx: Database,
  institutionId: string,
  assetId: string,
): Promise<{ hasOpenAssignment: boolean; lastReturnDate: string | null }> {
  const [row] = await tx
    .select({
      open: sql<number>`count(*) filter (where ${fixedAssetAssignments.returnedAt} is null)::int`,
      lastReturnDate: max(fixedAssetAssignments.returnDate),
    })
    .from(fixedAssetAssignments)
    .where(and(ofInstitution(institutionId), eq(fixedAssetAssignments.assetId, assetId)))
  return { hasOpenAssignment: (row?.open ?? 0) > 0, lastReturnDate: row?.lastReturnDate ?? null }
}

/** Zimmet alacak üyelik: rol ve pasifleştirilmemiş mi; kurumda yoksa `null`. */
export async function findAssigneeMembership(
  tx: Database,
  institutionId: string,
  membershipId: string,
): Promise<{ role: string; active: boolean } | null> {
  const [row] = await tx
    .select({ role: memberships.role, deactivatedAt: memberships.deactivatedAt })
    .from(memberships)
    .where(and(eq(memberships.institutionId, institutionId), eq(memberships.id, membershipId)))
    .limit(1)
  return row === undefined ? null : { role: row.role, active: row.deactivatedAt === null }
}

export async function insertAssignment(
  tx: Database,
  institutionId: string,
  input: FixedAssetAssignmentPlan & {
    id: string
    assetId: string
    assignedByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...fields } = input
  await tx.insert(fixedAssetAssignments).values({
    ...fields,
    institutionId,
    assignedAt: now,
    createdAt: now,
    updatedAt: now,
  })
}

/** İade bir kez yazılır; sürüm tutmazsa ya da zaten iade edildiyse `false` (409). */
export async function returnAssignment(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    returnDate: string
    condition: FixedAssetReturnCondition
    note: string | null
    returnedByUserId: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(fixedAssetAssignments)
    .set({
      returnedAt: input.now,
      returnDate: input.returnDate,
      returnCondition: input.condition,
      returnNote: input.note,
      returnedByUserId: input.returnedByUserId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        ofInstitution(institutionId),
        eq(fixedAssetAssignments.id, input.id),
        eq(fixedAssetAssignments.version, input.expectedVersion),
        isNull(fixedAssetAssignments.returnedAt),
      ),
    )
    .returning({ id: fixedAssetAssignments.id })
  return rows.length === 1
}

export interface AssigneeQuery {
  page: number
  pageSize: number
  q?: string | undefined
  status?: 'active' | 'passive' | undefined
  holding?: boolean | undefined
}

export interface StoredAssignee {
  membershipId: string
  name: string
  role: string
  active: boolean
  openAssignmentCount: number
}

/**
 * Kurumun personeli (yönetici, öğretmen, ön büro) ve üzerindeki açık zimmet sayısı. Pasif
 * (pasifleştirilmiş, DOM-YTK-070) personel de listelenir: ayrılan personelin açık zimmetleri
 * ilişik kesmede görünür (K-214). `holding` yalnız açık zimmeti olanları süzer. Ada göre sıralı.
 */
export async function listAssignees(
  db: Database,
  institutionId: string,
  query: AssigneeQuery,
): Promise<{ items: StoredAssignee[]; total: number }> {
  const openCount = sql<number>`(select count(*)::int from ${fixedAssetAssignments}
    where ${fixedAssetAssignments.institutionId} = ${memberships.institutionId}
      and ${fixedAssetAssignments.membershipId} = ${memberships.id}
      and ${fixedAssetAssignments.returnedAt} is null
      and ${fixedAssetAssignments.archivedAt} is null)`
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const filters: (SQL | undefined)[] = [
    eq(memberships.institutionId, institutionId),
    inArray(memberships.role, [...STAFF_ROLES]),
    search === undefined ? undefined : sql`strpos(${foldSql(users.name)}, ${search}) > 0`,
    query.status === undefined
      ? undefined
      : query.status === 'active'
        ? isNull(memberships.deactivatedAt)
        : isNotNull(memberships.deactivatedAt),
    query.holding === true ? sql`${openCount} > 0` : undefined,
  ]
  const where = and(...filters)
  const [totalRow] = await db
    .select({ total: count() })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(where)
  const rows = await db
    .select({
      membershipId: memberships.id,
      name: users.name,
      role: memberships.role,
      deactivatedAt: memberships.deactivatedAt,
      openAssignmentCount: openCount,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(where)
    .orderBy(asc(foldSql(users.name)), asc(memberships.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return {
    items: rows.map(({ deactivatedAt, ...row }) => ({ ...row, active: deactivatedAt === null })),
    total: totalRow?.total ?? 0,
  }
}
