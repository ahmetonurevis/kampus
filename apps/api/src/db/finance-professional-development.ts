import { and, asc, count, eq, ne, sql, type SQL } from 'drizzle-orm'

import {
  minutesToHours,
  type ProfessionalDevelopmentEnrollmentOrigin,
  type ProfessionalDevelopmentEnrollmentStatus,
  type ProfessionalDevelopmentKind,
  type ProfessionalDevelopmentStatus,
} from '@kampus/school-core/lib/finance-professional-development.ts'
import type { StaffRole } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { costCenters } from './schema/finance-budget.ts'
import {
  professionalDevelopmentEnrollments as enrollments,
  professionalDevelopmentPrograms as programs,
} from './schema/finance-professional-development.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Mesleki gelişim kataloğu deposu (DOM-FIN-125; ON-214). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-professional-development.ts`'tedir; depo yalnız okur ve
 * yazar. Süre dakika saklanır, saat olarak döner. Personel üyelikten yalnız okunur.
 */

export interface StoredProgram {
  id: string
  name: string
  kind: ProfessionalDevelopmentKind
  provider: string
  durationHours: number
  durationMinutes: number
  ongoing: boolean
  startDate: string | null
  endDate: string | null
  location: string | null
  onlineUrl: string | null
  audienceRoles: StaffRole[]
  audienceBranches: string[]
  feeCents: number | null
  costCenterId: string | null
  capacity: number | null
  status: ProfessionalDevelopmentStatus
  enrolledCount: number
  attendedCount: number
  /** Girilmiş en büyük katılım süresi (süre düzeltmesinin alt sınırı); yoksa 0. */
  maxAttendedMinutes: number
  createdAt: string
  updatedAt: string
  version: number
}

export interface ProgramWrite {
  name: string
  kind: ProfessionalDevelopmentKind
  provider: string
  durationMinutes: number
  ongoing: boolean
  startDate: string | null
  endDate: string | null
  location: string | null
  onlineUrl: string | null
  audienceRoles: StaffRole[]
  audienceBranches: string[]
  feeCents: number | null
  costCenterId: string | null
  capacity: number | null
}

/** Alt sorgular dış tabloya açık adla bağlanır (Drizzle tek tablolu seçimde kolonu nitelemez). */
const enrolledCount = sql<number>`(select count(*)::int from "professional_development_enrollments" e
  where e.institution_id = "professional_development_programs"."institution_id"
    and e.program_id = "professional_development_programs"."id")`
const attendedCount = sql<number>`(select count(*)::int from "professional_development_enrollments" e
  where e.institution_id = "professional_development_programs"."institution_id"
    and e.program_id = "professional_development_programs"."id"
    and e.status = 'attended')`
const maxAttendedMinutes = sql<number>`(select coalesce(max(e.attended_minutes), 0)::int from "professional_development_enrollments" e
  where e.institution_id = "professional_development_programs"."institution_id"
    and e.program_id = "professional_development_programs"."id")`

const PROGRAM_COLUMNS = {
  id: programs.id,
  name: programs.name,
  kind: programs.kind,
  provider: programs.provider,
  durationMinutes: programs.durationMinutes,
  ongoing: programs.ongoing,
  startDate: programs.startDate,
  endDate: programs.endDate,
  location: programs.location,
  onlineUrl: programs.onlineUrl,
  audienceRoles: programs.audienceRoles,
  audienceBranches: programs.audienceBranches,
  feeCents: programs.feeCents,
  costCenterId: programs.costCenterId,
  capacity: programs.capacity,
  status: programs.status,
  enrolledCount,
  attendedCount,
  maxAttendedMinutes,
  createdAt: programs.createdAt,
  updatedAt: programs.updatedAt,
  version: programs.version,
}

type ProgramRow = Omit<StoredProgram, 'createdAt' | 'updatedAt' | 'durationHours'> & {
  createdAt: Date
  updatedAt: Date
}
const toProgram = (row: ProgramRow): StoredProgram => ({
  ...row,
  durationHours: minutesToHours(row.durationMinutes),
  enrolledCount: Number(row.enrolledCount),
  attendedCount: Number(row.attendedCount),
  maxAttendedMinutes: Number(row.maxAttendedMinutes),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const programOf = (institutionId: string) => eq(programs.institutionId, institutionId)

export async function findProgram(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredProgram | null> {
  const [row] = await db
    .select(PROGRAM_COLUMNS)
    .from(programs)
    .where(and(programOf(institutionId), eq(programs.id, id)))
    .limit(1)
  return row === undefined ? null : toProgram(row)
}

export interface ProgramQuery {
  page: number
  pageSize: number
  q?: string | undefined
  kind?: ProfessionalDevelopmentKind | undefined
  status?: ProfessionalDevelopmentStatus | undefined
}

/** Eğitimler; yayında önce, sonra başlangıç günü (sürekli eğitim sonda) ve ad. */
export async function listPrograms(
  db: Database,
  institutionId: string,
  query: ProgramQuery,
  options: { publishedOnly: boolean },
): Promise<{ items: StoredProgram[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const filters: (SQL | undefined)[] = [
    programOf(institutionId),
    search === undefined
      ? undefined
      : sql`(strpos(${foldSql(programs.name)}, ${search}) > 0 or strpos(${foldSql(programs.provider)}, ${search}) > 0)`,
    query.kind === undefined ? undefined : eq(programs.kind, query.kind),
    query.status === undefined ? undefined : eq(programs.status, query.status),
    options.publishedOnly ? ne(programs.status, 'draft') : undefined,
  ]
  const where = and(...filters)
  const [totalRow] = await db.select({ total: count() }).from(programs).where(where)
  const rows = await db
    .select(PROGRAM_COLUMNS)
    .from(programs)
    .where(where)
    .orderBy(
      sql`case ${programs.status} when 'published' then 0 when 'draft' then 1 else 2 end`,
      sql`${programs.startDate} desc nulls last`,
      asc(programs.name),
      asc(programs.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toProgram), total: totalRow?.total ?? 0 }
}

export async function insertProgram(
  tx: Database,
  institutionId: string,
  input: ProgramWrite & { id: string; createdByUserId: string; now: Date },
): Promise<void> {
  const { now, ...rest } = input
  await tx.insert(programs).values({
    institutionId,
    ...rest,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  })
}

/** Düzeltme ya da durum; sürüm tutmazsa `false` (409). */
export async function updateProgram(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    values: Partial<ProgramWrite> & { status?: ProfessionalDevelopmentStatus }
  },
): Promise<boolean> {
  const rows = await tx
    .update(programs)
    .set({ ...input.values, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        programOf(institutionId),
        eq(programs.id, input.id),
        eq(programs.version, input.expectedVersion),
      ),
    )
    .returning({ id: programs.id })
  return rows.length === 1
}

/** Kurumun maliyet merkezi etkin mi; yoksa `null`. */
export async function findCostCenterActive(
  db: Database,
  institutionId: string,
  id: string,
): Promise<boolean | null> {
  const [row] = await db
    .select({ isActive: costCenters.isActive })
    .from(costCenters)
    .where(and(eq(costCenters.institutionId, institutionId), eq(costCenters.id, id)))
    .limit(1)
  return row === undefined ? null : row.isActive
}

// --- Atamalar -----------------------------------------------------------------------------------

export interface StoredEnrollment {
  id: string
  programId: string
  membershipId: string
  staffName: string
  staffRole: string
  origin: ProfessionalDevelopmentEnrollmentOrigin
  status: ProfessionalDevelopmentEnrollmentStatus
  attendedHours: number | null
  attendedMinutes: number | null
  statusChangedAt: string
  createdAt: string
  version: number
}

const ENROLLMENT_COLUMNS = {
  id: enrollments.id,
  programId: enrollments.programId,
  membershipId: enrollments.membershipId,
  staffName: users.name,
  staffRole: memberships.role,
  origin: enrollments.origin,
  status: enrollments.status,
  attendedMinutes: enrollments.attendedMinutes,
  statusChangedAt: enrollments.statusChangedAt,
  createdAt: enrollments.createdAt,
  version: enrollments.version,
}
type EnrollmentRow = Omit<StoredEnrollment, 'statusChangedAt' | 'createdAt' | 'attendedHours'> & {
  statusChangedAt: Date
  createdAt: Date
}
const toEnrollment = (row: EnrollmentRow): StoredEnrollment => ({
  ...row,
  attendedHours: row.attendedMinutes === null ? null : minutesToHours(row.attendedMinutes),
  statusChangedAt: row.statusChangedAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
})

function enrollmentSelect(db: Database) {
  return db
    .select(ENROLLMENT_COLUMNS)
    .from(enrollments)
    .innerJoin(
      memberships,
      and(
        eq(memberships.institutionId, enrollments.institutionId),
        eq(memberships.id, enrollments.membershipId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId))
}

export async function findEnrollment(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredEnrollment | null> {
  const [row] = await enrollmentSelect(db)
    .where(and(eq(enrollments.institutionId, institutionId), eq(enrollments.id, id)))
    .limit(1)
  return row === undefined ? null : toEnrollment(row)
}

/** Eğitimin katılımcıları, ada göre. */
export async function listEnrollments(
  db: Database,
  institutionId: string,
  programId: string,
  query: {
    page: number
    pageSize: number
    status?: ProfessionalDevelopmentEnrollmentStatus | undefined
  },
): Promise<{ items: StoredEnrollment[]; total: number }> {
  const where = and(
    eq(enrollments.institutionId, institutionId),
    eq(enrollments.programId, programId),
    query.status === undefined ? undefined : eq(enrollments.status, query.status),
  )
  const [totalRow] = await db.select({ total: count() }).from(enrollments).where(where)
  const rows = await enrollmentSelect(db)
    .where(where)
    .orderBy(asc(foldSql(users.name)), asc(enrollments.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toEnrollment), total: totalRow?.total ?? 0 }
}

export async function enrollmentExists(
  db: Database,
  institutionId: string,
  programId: string,
  membershipId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.institutionId, institutionId),
        eq(enrollments.programId, programId),
        eq(enrollments.membershipId, membershipId),
      ),
    )
    .limit(1)
  return row !== undefined
}

export async function insertEnrollment(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    programId: string
    membershipId: string
    origin: ProfessionalDevelopmentEnrollmentOrigin
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...rest } = input
  await tx.insert(enrollments).values({
    institutionId,
    ...rest,
    status: 'assigned',
    attendedMinutes: null,
    statusChangedAt: now,
    createdAt: now,
    updatedAt: now,
  })
}

export async function updateEnrollment(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    status: ProfessionalDevelopmentEnrollmentStatus
    attendedMinutes: number | null
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(enrollments)
    .set({
      status: input.status,
      attendedMinutes: input.attendedMinutes,
      statusChangedAt: input.now,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        eq(enrollments.institutionId, institutionId),
        eq(enrollments.id, input.id),
        eq(enrollments.version, input.expectedVersion),
      ),
    )
    .returning({ id: enrollments.id })
  return rows.length === 1
}

/** Atanacak personel (ad, rol, etkin mi); kurumda yoksa `null`. */
export async function findEnrollmentStaff(
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
