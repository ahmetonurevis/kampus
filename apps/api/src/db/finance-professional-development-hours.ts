import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { DayRange } from '@kampus/school-core/lib/finance-professional-development-hours.ts'
import type { StaffRole } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from './client.ts'
import { academicYears } from './schema/academic-years.ts'
import { memberships, users } from './schema/auth.ts'
import { staffDevelopmentGoals } from './schema/finance-observation-debriefs.ts'
import {
  professionalDevelopmentEnrollments as enrollments,
  professionalDevelopmentTargets as targets,
} from './schema/finance-professional-development.ts'
import { staffDocuments } from './schema/finance-staff-documents.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Mesleki gelişim saati deposu (DOM-FIN-144; ON-215; K-487…K-489). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-professional-development-hours.ts`'tedir. Tamamlanan saat
 * saklanmaz: "katıldı" atamaların katılım dakikası, katılım günü öğretim yılı aralığına düşenlerden
 * toplanır (tarihli eğitimde bitiş günü, sürekli eğitimde işaretin İstanbul günü). Öğretim yılı
 * tablosu (Oğuzhan) ve gelişim hedefi yalnız okunur.
 */

export interface StoredTarget {
  academicYear: number
  targetMinutes: number
  appliesToRoles: StaffRole[]
  updatedAt: string
  version: number
}

export async function findTarget(
  db: Database,
  institutionId: string,
  academicYear: number,
): Promise<StoredTarget | null> {
  const [row] = await db
    .select({
      academicYear: targets.academicYear,
      targetMinutes: targets.targetMinutes,
      appliesToRoles: targets.appliesToRoles,
      updatedAt: targets.updatedAt,
      version: targets.version,
    })
    .from(targets)
    .where(and(eq(targets.institutionId, institutionId), eq(targets.academicYear, academicYear)))
    .limit(1)
  return row === undefined ? null : { ...row, updatedAt: row.updatedAt.toISOString() }
}

/** Hedefi yazar ya da günceller (kurum ayarı; sürüm her yazmada artar). */
export async function upsertTarget(
  tx: Database,
  institutionId: string,
  input: {
    academicYear: number
    targetMinutes: number
    appliesToRoles: StaffRole[]
    userId: string
    now: Date
  },
): Promise<void> {
  await tx
    .insert(targets)
    .values({
      institutionId,
      academicYear: input.academicYear,
      targetMinutes: input.targetMinutes,
      appliesToRoles: input.appliesToRoles,
      updatedByUserId: input.userId,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [targets.institutionId, targets.academicYear],
      set: {
        targetMinutes: input.targetMinutes,
        appliesToRoles: input.appliesToRoles,
        updatedByUserId: input.userId,
        updatedAt: input.now,
        version: sql`${targets.version} + 1`,
      },
    })
}

/** Hedefi kaldırır; satır yoksa `false`. */
export async function deleteTarget(
  tx: Database,
  institutionId: string,
  academicYear: number,
): Promise<boolean> {
  const rows = await tx
    .delete(targets)
    .where(and(eq(targets.institutionId, institutionId), eq(targets.academicYear, academicYear)))
    .returning({ year: targets.academicYear })
  return rows.length === 1
}

/** Kurumun kayıtlı öğretim yılları (aralık hesabı için). */
export async function listRegisteredYears(
  db: Database,
  institutionId: string,
): Promise<(DayRange & { startYear: number })[]> {
  return db
    .select({
      startYear: academicYears.startYear,
      startDate: academicYears.startDate,
      endDate: academicYears.endDate,
    })
    .from(academicYears)
    .where(eq(academicYears.institutionId, institutionId))
    .orderBy(asc(academicYears.startYear))
}

/** Katılımın sayıldığı gün (core `attendanceDay` ile aynı kural). */
const countedDay = sql`case when "p"."ongoing" then ("e"."status_changed_at" at time zone 'Europe/Istanbul')::date else "p"."end_date" end`

/**
 * Personelin aralıktaki tamamlanan dakikası; dış sorgunun üyelik satırına açık adla bağlanır
 * (Drizzle tek tablolu seçimde kolonu nitelemez, alt sorguda iç tabloya düşerdi).
 */
function completedMinutesOf(range: DayRange) {
  return sql<number>`(select coalesce(sum("e"."attended_minutes"), 0)::int
    from "professional_development_enrollments" "e"
    join "professional_development_programs" "p"
      on "p"."institution_id" = "e"."institution_id" and "p"."id" = "e"."program_id"
    where "e"."institution_id" = "memberships"."institution_id"
      and "e"."membership_id" = "memberships"."id"
      and "e"."status" = 'attended'
      and ${countedDay} between ${range.startDate}::date and ${range.endDate}::date)`
}
function attendedCountOf(range: DayRange) {
  return sql<number>`(select count(*)::int
    from "professional_development_enrollments" "e"
    join "professional_development_programs" "p"
      on "p"."institution_id" = "e"."institution_id" and "p"."id" = "e"."program_id"
    where "e"."institution_id" = "memberships"."institution_id"
      and "e"."membership_id" = "memberships"."id"
      and "e"."status" = 'attended'
      and ${countedDay} between ${range.startDate}::date and ${range.endDate}::date)`
}

export interface HoursRow {
  membershipId: string
  name: string
  role: string
  completedMinutes: number
  attendedCount: number
}

/**
 * Etkin personelin öğretim yılı saatleri, ada göre. `roles` özetin rolleridir; `missingBelow`
 * verilirse yalnız tamamlanan dakikası altında kalanlar, `metAtLeast` verilirse ulaşanlar.
 */
export async function listHours(
  db: Database,
  institutionId: string,
  query: {
    range: DayRange
    roles: readonly StaffRole[]
    q?: string | undefined
    missingBelow?: number | undefined
    metAtLeast?: number | undefined
    page: number
    pageSize: number
  },
): Promise<{ items: HoursRow[]; total: number }> {
  const minutes = completedMinutesOf(query.range)
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    eq(memberships.institutionId, institutionId),
    isNull(memberships.deactivatedAt),
    inArray(memberships.role, [...query.roles]),
    search === undefined ? undefined : sql`strpos(${foldSql(users.name)}, ${search}) > 0`,
    query.missingBelow === undefined ? undefined : sql`${minutes} < ${query.missingBelow}`,
    query.metAtLeast === undefined ? undefined : sql`${minutes} >= ${query.metAtLeast}`,
  )
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
      completedMinutes: minutes,
      attendedCount: attendedCountOf(query.range),
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(where)
    .orderBy(asc(foldSql(users.name)), asc(memberships.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return {
    items: rows.map((row) => ({
      ...row,
      completedMinutes: Number(row.completedMinutes),
      attendedCount: Number(row.attendedCount),
    })),
    total: totalRow?.total ?? 0,
  }
}

/** Tek personelin öğretim yılı saati (özlük kartı özeti, DOM-FIN-140). */
export async function memberHours(
  db: Database,
  institutionId: string,
  membershipId: string,
  range: DayRange,
): Promise<{ completedMinutes: number; attendedCount: number }> {
  const [row] = await db
    .select({
      completedMinutes: completedMinutesOf(range),
      attendedCount: attendedCountOf(range),
    })
    .from(memberships)
    .where(and(eq(memberships.institutionId, institutionId), eq(memberships.id, membershipId)))
    .limit(1)
  return {
    completedMinutes: Number(row?.completedMinutes ?? 0),
    attendedCount: Number(row?.attendedCount ?? 0),
  }
}

/** Bağlanacak özlük belgesi (sahibi, türü, yerine geçilmiş mi); kurumda yoksa `null`. */
export async function findCertificateCandidate(
  db: Database,
  institutionId: string,
  staffDocumentId: string,
): Promise<{ membershipId: string; documentType: string; superseded: boolean } | null> {
  const [row] = await db
    .select({
      membershipId: staffDocuments.membershipId,
      documentType: staffDocuments.documentType,
      supersededAt: staffDocuments.supersededAt,
      archivedAt: staffDocuments.archivedAt,
    })
    .from(staffDocuments)
    .where(
      and(eq(staffDocuments.institutionId, institutionId), eq(staffDocuments.id, staffDocumentId)),
    )
    .limit(1)
  if (row === undefined) return null
  return {
    membershipId: row.membershipId,
    documentType: row.documentType,
    superseded: row.supersededAt !== null || row.archivedAt !== null,
  }
}

/** Sertifika başka bir katılıma bağlı mı. */
export async function certificateLinkedElsewhere(
  db: Database,
  institutionId: string,
  staffDocumentId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.institutionId, institutionId),
        eq(enrollments.certificateDocumentId, staffDocumentId),
      ),
    )
    .limit(1)
  return row !== undefined
}

/** Gelişim hedefinin sahibi ve durumu; kurumda yoksa `null`. */
export async function findGoalOwner(
  db: Database,
  institutionId: string,
  goalId: string,
): Promise<{ membershipId: string; status: string } | null> {
  const [row] = await db
    .select({
      membershipId: staffDevelopmentGoals.teacherMembershipId,
      status: staffDevelopmentGoals.status,
    })
    .from(staffDevelopmentGoals)
    .where(
      and(
        eq(staffDevelopmentGoals.institutionId, institutionId),
        eq(staffDevelopmentGoals.id, goalId),
      ),
    )
    .limit(1)
  return row ?? null
}

/** Katılım belgesi bağı olan atama kurumda var mı (dosya okuma kuralı). */
export async function enrollmentHasFile(
  db: Database,
  institutionId: string,
  enrollmentId: string,
  fileId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.institutionId, institutionId),
        eq(enrollments.id, enrollmentId),
        eq(enrollments.documentFileId, fileId),
      ),
    )
    .limit(1)
  return row !== undefined
}
