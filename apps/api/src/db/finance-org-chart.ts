import { and, asc, count, eq, gte, isNull, lte, or, sql, type SQL } from 'drizzle-orm'

import type { OrgAssignmentState, OrgUnitKind } from '@kampus/school-core/lib/finance-org-chart.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { orgAssignments, orgPositions, orgUnits } from './schema/finance-org-chart.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Organizasyon şeması deposu (DOM-FIN-129; ON-187). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-org-chart.ts`'tedir; depo yalnız okur ve yazar.
 * Arşivli pozisyon ve atama varsayılan olarak dışlanır. Personel üyelikten yalnız okunur.
 */

const iso = (value: Date) => value.toISOString()

// --- Birimler ---------------------------------------------------------------------------------------

export interface StoredUnit {
  id: string
  name: string
  parentId: string | null
  kind: OrgUnitKind
  isActive: boolean
  createdAt: string
  updatedAt: string
  version: number
}

const UNIT_COLUMNS = {
  id: orgUnits.id,
  name: orgUnits.name,
  parentId: orgUnits.parentId,
  kind: orgUnits.kind,
  isActive: orgUnits.isActive,
  createdAt: orgUnits.createdAt,
  updatedAt: orgUnits.updatedAt,
  version: orgUnits.version,
}
type UnitRow = Omit<StoredUnit, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date }
const toUnit = (row: UnitRow): StoredUnit => ({
  ...row,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
})

/** Kurumun bütün birimleri (en çok `ORG_UNITS_MAX`), ada göre. */
export async function listUnits(db: Database, institutionId: string): Promise<StoredUnit[]> {
  const rows = await db
    .select(UNIT_COLUMNS)
    .from(orgUnits)
    .where(eq(orgUnits.institutionId, institutionId))
    .orderBy(asc(foldSql(orgUnits.name)), asc(orgUnits.id))
  return rows.map(toUnit)
}

export async function findUnit(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredUnit | null> {
  const [row] = await db
    .select(UNIT_COLUMNS)
    .from(orgUnits)
    .where(and(eq(orgUnits.institutionId, institutionId), eq(orgUnits.id, id)))
    .limit(1)
  return row === undefined ? null : toUnit(row)
}

export async function insertUnit(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    name: string
    parentId: string | null
    kind: OrgUnitKind
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...rest } = input
  await tx.insert(orgUnits).values({ institutionId, ...rest, createdAt: now, updatedAt: now })
}

/** Birim alanları; sürüm tutmazsa `false` (409). */
export async function updateUnit(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    values: Partial<{ name: string; parentId: string | null; kind: OrgUnitKind; isActive: boolean }>
  },
): Promise<boolean> {
  const rows = await tx
    .update(orgUnits)
    .set({ ...input.values, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        eq(orgUnits.institutionId, institutionId),
        eq(orgUnits.id, input.id),
        eq(orgUnits.version, input.expectedVersion),
      ),
    )
    .returning({ id: orgUnits.id })
  return rows.length === 1
}

// --- Pozisyonlar ------------------------------------------------------------------------------------

export interface StoredPosition {
  id: string
  unitId: string
  title: string
  headcount: number
  reportsToPositionId: string | null
  createdAt: string
  updatedAt: string
  version: number
}

const POSITION_COLUMNS = {
  id: orgPositions.id,
  unitId: orgPositions.unitId,
  title: orgPositions.title,
  headcount: orgPositions.headcount,
  reportsToPositionId: orgPositions.reportsToPositionId,
  createdAt: orgPositions.createdAt,
  updatedAt: orgPositions.updatedAt,
  version: orgPositions.version,
}
type PositionRow = Omit<StoredPosition, 'createdAt' | 'updatedAt'> & {
  createdAt: Date
  updatedAt: Date
}
const toPosition = (row: PositionRow): StoredPosition => ({
  ...row,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
})
const livePosition = (institutionId: string) =>
  and(eq(orgPositions.institutionId, institutionId), isNull(orgPositions.archivedAt))

/** Kurumun arşivsiz bütün pozisyonları (en çok `ORG_POSITIONS_MAX`), unvana göre. */
export async function listPositions(
  db: Database,
  institutionId: string,
): Promise<StoredPosition[]> {
  const rows = await db
    .select(POSITION_COLUMNS)
    .from(orgPositions)
    .where(livePosition(institutionId))
    .orderBy(asc(foldSql(orgPositions.title)), asc(orgPositions.id))
  return rows.map(toPosition)
}

export async function findPosition(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredPosition | null> {
  const [row] = await db
    .select(POSITION_COLUMNS)
    .from(orgPositions)
    .where(and(livePosition(institutionId), eq(orgPositions.id, id)))
    .limit(1)
  return row === undefined ? null : toPosition(row)
}

export async function insertPosition(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    unitId: string
    title: string
    headcount: number
    reportsToPositionId: string | null
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...rest } = input
  await tx.insert(orgPositions).values({ institutionId, ...rest, createdAt: now, updatedAt: now })
}

/** Pozisyon alanları ya da arşiv; sürüm tutmazsa `false` (409). */
export async function updatePosition(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    values: Partial<{
      unitId: string
      title: string
      headcount: number
      reportsToPositionId: string | null
      archivedAt: Date
    }>
  },
): Promise<boolean> {
  const rows = await tx
    .update(orgPositions)
    .set({ ...input.values, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        livePosition(institutionId),
        eq(orgPositions.id, input.id),
        eq(orgPositions.version, input.expectedVersion),
      ),
    )
    .returning({ id: orgPositions.id })
  return rows.length === 1
}

// --- Atamalar ---------------------------------------------------------------------------------------

export interface StoredAssignment {
  id: string
  positionId: string
  positionTitle: string
  unitId: string
  membershipId: string
  staffName: string
  staffRole: string
  startDate: string
  endDate: string | null
  createdAt: string
  updatedAt: string
  version: number
}

const ASSIGNMENT_COLUMNS = {
  id: orgAssignments.id,
  positionId: orgAssignments.positionId,
  positionTitle: orgPositions.title,
  unitId: orgPositions.unitId,
  membershipId: orgAssignments.membershipId,
  staffName: users.name,
  staffRole: memberships.role,
  startDate: orgAssignments.startDate,
  endDate: orgAssignments.endDate,
  createdAt: orgAssignments.createdAt,
  updatedAt: orgAssignments.updatedAt,
  version: orgAssignments.version,
}
type AssignmentRow = Omit<StoredAssignment, 'createdAt' | 'updatedAt'> & {
  createdAt: Date
  updatedAt: Date
}
const toAssignment = (row: AssignmentRow): StoredAssignment => ({
  ...row,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
})
const liveAssignment = (institutionId: string) =>
  and(eq(orgAssignments.institutionId, institutionId), isNull(orgAssignments.archivedAt))

/** Atama + pozisyon + personel adı; arşivli pozisyonun geçmiş ataması da okunur. */
function assignmentSelect(db: Database) {
  return db
    .select(ASSIGNMENT_COLUMNS)
    .from(orgAssignments)
    .innerJoin(
      orgPositions,
      and(
        eq(orgPositions.institutionId, orgAssignments.institutionId),
        eq(orgPositions.id, orgAssignments.positionId),
      ),
    )
    .innerJoin(
      memberships,
      and(
        eq(memberships.institutionId, orgAssignments.institutionId),
        eq(memberships.id, orgAssignments.membershipId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId))
}

/** Günde süren atama süzgeci (uçlar dahil). */
const coversDay = (day: string) =>
  and(
    lte(orgAssignments.startDate, day),
    or(isNull(orgAssignments.endDate), gte(orgAssignments.endDate, day)),
  )
/** Gün itibarıyla süren ya da başlayacak (bitmemiş) atama süzgeci. */
const openOn = (day: string) => or(isNull(orgAssignments.endDate), gte(orgAssignments.endDate, day))

const stateFilter = (state: OrgAssignmentState, day: string): SQL | undefined => {
  switch (state) {
    case 'current':
      return coversDay(day)
    case 'upcoming':
      return sql`${orgAssignments.startDate} > ${day}`
    case 'past':
      return sql`${orgAssignments.endDate} < ${day}`
    default:
      return state satisfies never
  }
}

export async function findAssignment(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredAssignment | null> {
  const [row] = await assignmentSelect(db)
    .where(and(liveAssignment(institutionId), eq(orgAssignments.id, id)))
    .limit(1)
  return row === undefined ? null : toAssignment(row)
}

/** Verilen günde süren atamalar (şemadaki görevliler), personel adına göre. */
export async function assignmentsOn(
  db: Database,
  institutionId: string,
  day: string,
): Promise<StoredAssignment[]> {
  const rows = await assignmentSelect(db)
    .where(and(liveAssignment(institutionId), isNull(orgPositions.archivedAt), coversDay(day)))
    .orderBy(asc(foldSql(users.name)), asc(orgAssignments.id))
  return rows.map(toAssignment)
}

export interface AssignmentQuery {
  page: number
  pageSize: number
  day: string
  positionId?: string | undefined
  membershipId?: string | undefined
  state?: OrgAssignmentState | undefined
}

/** Atama geçmişi; başlangıca göre yeniden eskiye. */
export async function listAssignments(
  db: Database,
  institutionId: string,
  query: AssignmentQuery,
): Promise<{ items: StoredAssignment[]; total: number }> {
  const where = and(
    liveAssignment(institutionId),
    query.positionId === undefined ? undefined : eq(orgAssignments.positionId, query.positionId),
    query.membershipId === undefined
      ? undefined
      : eq(orgAssignments.membershipId, query.membershipId),
    query.state === undefined ? undefined : stateFilter(query.state, query.day),
  )
  const [totalRow] = await db.select({ total: count() }).from(orgAssignments).where(where)
  const rows = await assignmentSelect(db)
    .where(where)
    .orderBy(
      sql`${orgAssignments.startDate} desc`,
      asc(foldSql(users.name)),
      asc(orgAssignments.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toAssignment), total: totalRow?.total ?? 0 }
}

/** Pozisyonun arşivsiz bütün atamalarının aralıkları (kadro ve çakışma denetimi). */
export async function positionRanges(
  db: Database,
  institutionId: string,
  positionId: string,
): Promise<{ id: string; membershipId: string; startDate: string; endDate: string | null }[]> {
  return db
    .select({
      id: orgAssignments.id,
      membershipId: orgAssignments.membershipId,
      startDate: orgAssignments.startDate,
      endDate: orgAssignments.endDate,
    })
    .from(orgAssignments)
    .where(and(liveAssignment(institutionId), eq(orgAssignments.positionId, positionId)))
}

export async function insertAssignment(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    positionId: string
    membershipId: string
    startDate: string
    endDate: string | null
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...rest } = input
  await tx.insert(orgAssignments).values({ institutionId, ...rest, createdAt: now, updatedAt: now })
}

/** Bitiş günü ya da arşiv; sürüm tutmazsa `false` (409). */
export async function updateAssignment(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    values: Partial<{ endDate: string | null; archivedAt: Date }>
  },
): Promise<boolean> {
  const rows = await tx
    .update(orgAssignments)
    .set({ ...input.values, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        liveAssignment(institutionId),
        eq(orgAssignments.id, input.id),
        eq(orgAssignments.version, input.expectedVersion),
      ),
    )
    .returning({ id: orgAssignments.id })
  return rows.length === 1
}

/** Birimin arşivsiz pozisyonlarında gün itibarıyla bitmemiş atama sayısı. */
export async function openAssignmentsOfUnit(
  db: Database,
  institutionId: string,
  unitId: string,
  day: string,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(orgAssignments)
    .innerJoin(
      orgPositions,
      and(
        eq(orgPositions.institutionId, orgAssignments.institutionId),
        eq(orgPositions.id, orgAssignments.positionId),
      ),
    )
    .where(
      and(
        liveAssignment(institutionId),
        isNull(orgPositions.archivedAt),
        eq(orgPositions.unitId, unitId),
        openOn(day),
      ),
    )
  return row?.total ?? 0
}

/** Pozisyonun gün itibarıyla bitmemiş atama sayısı. */
export async function openAssignmentsOfPosition(
  db: Database,
  institutionId: string,
  positionId: string,
  day: string,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(orgAssignments)
    .where(
      and(liveAssignment(institutionId), eq(orgAssignments.positionId, positionId), openOn(day)),
    )
  return row?.total ?? 0
}

/** Atanacak personel (rol, etkin mi); kurumda yoksa `null`. */
export async function findAssignmentStaff(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<{ role: string; active: boolean } | null> {
  const [row] = await db
    .select({ role: memberships.role, deactivatedAt: memberships.deactivatedAt })
    .from(memberships)
    .where(and(eq(memberships.institutionId, institutionId), eq(memberships.id, membershipId)))
    .limit(1)
  return row === undefined ? null : { role: row.role, active: row.deactivatedAt === null }
}

// --- Boş pozisyonlar --------------------------------------------------------------------------------

export interface StoredVacancy {
  positionId: string
  title: string
  unitId: string
  unitName: string
  headcount: number
  filled: number
  vacant: number
  reportsToPositionId: string | null
}

/**
 * Verilen günde kadrosu dolmamış pozisyonlar (K-444): dolu = o gün süren atama. Pasif birimin
 * pozisyonu listelenmez (pasif birime atama yapılmaz). Birim adına, sonra unvana göre.
 */
export async function listVacancies(
  db: Database,
  institutionId: string,
  query: {
    page: number
    pageSize: number
    day: string
    unitId?: string | undefined
    q?: string | undefined
  },
): Promise<{ items: StoredVacancy[]; total: number }> {
  const filled = sql<number>`(select count(*)::int from "org_assignments" a
    where a.institution_id = ${orgPositions.institutionId}
      and a.position_id = ${orgPositions.id}
      and a.archived_at is null
      and a.start_date <= ${query.day}
      and (a.end_date is null or a.end_date >= ${query.day}))`
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    livePosition(institutionId),
    eq(orgUnits.isActive, true),
    query.unitId === undefined ? undefined : eq(orgPositions.unitId, query.unitId),
    search === undefined
      ? undefined
      : sql`(strpos(${foldSql(orgPositions.title)}, ${search}) > 0 or strpos(${foldSql(orgUnits.name)}, ${search}) > 0)`,
    sql`${orgPositions.headcount} > ${filled}`,
  )
  const base = () =>
    db
      .select({
        positionId: orgPositions.id,
        title: orgPositions.title,
        unitId: orgPositions.unitId,
        unitName: orgUnits.name,
        headcount: orgPositions.headcount,
        filled,
        reportsToPositionId: orgPositions.reportsToPositionId,
      })
      .from(orgPositions)
      .innerJoin(
        orgUnits,
        and(
          eq(orgUnits.institutionId, orgPositions.institutionId),
          eq(orgUnits.id, orgPositions.unitId),
        ),
      )
      .where(where)
  const [totalRow] = await db
    .select({ total: count() })
    .from(orgPositions)
    .innerJoin(
      orgUnits,
      and(
        eq(orgUnits.institutionId, orgPositions.institutionId),
        eq(orgUnits.id, orgPositions.unitId),
      ),
    )
    .where(where)
  const rows = await base()
    .orderBy(asc(foldSql(orgUnits.name)), asc(foldSql(orgPositions.title)), asc(orgPositions.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return {
    items: rows.map((row) => {
      const taken = Number(row.filled)
      return { ...row, filled: taken, vacant: Math.max(0, row.headcount - taken) }
    }),
    total: totalRow?.total ?? 0,
  }
}
