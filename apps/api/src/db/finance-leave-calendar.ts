import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import { subjectById } from '@kampus/school-core/data/curriculum.ts'
import {
  DEFAULT_LEAVE_CALENDAR_SETTINGS,
  type LeaveAbsence,
  type LeaveCalendarSettings,
} from '@kampus/school-core/lib/finance-leave-calendar.ts'
import type { LeavePeriod } from '@kampus/school-core/lib/finance-staff-leave.ts'

import type { Database } from './client.ts'
import { loadTeachers, teacherLinks } from './finance-leave-requests.ts'
import { loadRecords } from './records.ts'
import { memberships, users } from './schema/auth.ts'
import { leaveCalendarSettings } from './schema/finance-leave-calendar.ts'
import { staffLeaveRequests } from './schema/finance-leave-requests.ts'
import { staffLeaveRecords } from './schema/finance-staff-leave.ts'
import { staffMedicalReports } from './schema/finance-medical-reports.ts'

/**
 * İzin takvimi deposu (DOM-FIN-123; ON-183). Kurum kapsamlıdır: ilk parametre `institutionId`.
 * Kural core `lib/finance-leave-calendar.ts`'tedir. İzin talepleri, kullanılmış izin kayıtları ve
 * sağlık raporları yalnız okunur; sağlık raporundan yalnız aralık okunur (tür ve dosya okunmaz).
 */

export interface StoredLeaveCalendarSettings extends LeaveCalendarSettings {
  /** `If-Match` sürümü; ayar hiç kaydedilmediyse 1. */
  version: number
}

/** Ayar; satır yoksa varsayılan (eşik 2, sınav haftası yok, sürüm 1). */
export async function loadLeaveCalendarSettings(
  db: Database,
  institutionId: string,
): Promise<StoredLeaveCalendarSettings> {
  const [row] = await db
    .select({
      concurrentThreshold: leaveCalendarSettings.concurrentThreshold,
      examWeeks: leaveCalendarSettings.examWeeks,
      version: leaveCalendarSettings.version,
    })
    .from(leaveCalendarSettings)
    .where(eq(leaveCalendarSettings.institutionId, institutionId))
    .limit(1)
  return row ?? { ...DEFAULT_LEAVE_CALENDAR_SETTINGS, version: 1 }
}

/**
 * Ayarı sürüm koşuluyla yazar; tutmazsa `null` (409). İlk kayıt satırı sürüm 2 ile açar.
 */
export async function saveLeaveCalendarSettings(
  tx: Database,
  institutionId: string,
  input: LeaveCalendarSettings & { expectedVersion: number; now: Date },
): Promise<number | null> {
  const values = {
    concurrentThreshold: input.concurrentThreshold,
    examWeeks: input.examWeeks,
    updatedAt: input.now,
  }
  const [updated] = await tx
    .update(leaveCalendarSettings)
    .set({ ...values, version: sql`${leaveCalendarSettings.version} + 1` })
    .where(
      and(
        eq(leaveCalendarSettings.institutionId, institutionId),
        eq(leaveCalendarSettings.version, input.expectedVersion),
      ),
    )
    .returning({ version: leaveCalendarSettings.version })
  if (updated !== undefined) return updated.version
  if (input.expectedVersion !== 1) return null
  const [created] = await tx
    .insert(leaveCalendarSettings)
    .values({ ...values, institutionId, version: 2, createdAt: input.now })
    .onConflictDoNothing()
    .returning({ version: leaveCalendarSettings.version })
  return created?.version ?? null
}

const overlapping = (start: AnyPgColumn, end: AnyPgColumn, period: LeavePeriod) => [
  lte(start, period.endDate),
  gte(end, period.startDate),
]

const memberJoin = (institutionColumn: AnyPgColumn, membershipColumn: AnyPgColumn) =>
  and(eq(memberships.institutionId, institutionColumn), eq(memberships.id, membershipColumn))

/**
 * Aralığa değen izinler: bekleyen ve onaylı talepler, iptal edilmemiş kullanılmış izin kayıtları
 * (talepten doğanlar `requestId` taşır) ve iptal edilmemiş sağlık raporları; personel adı ve rolüyle.
 */
export async function loadLeaveAbsences(
  db: Database,
  institutionId: string,
  period: LeavePeriod,
): Promise<LeaveAbsence[]> {
  const r = staffLeaveRequests
  const k = staffLeaveRecords
  const m = staffMedicalReports
  const [requests, records, reports] = await Promise.all([
    db
      .select({
        id: r.id,
        membershipId: r.membershipId,
        name: users.name,
        role: memberships.role,
        status: r.status,
        kind: r.kind,
        typeLabel: r.typeLabel,
        startDate: r.startDate,
        endDate: r.endDate,
      })
      .from(r)
      .innerJoin(memberships, memberJoin(r.institutionId, r.membershipId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(r.institutionId, institutionId),
          inArray(r.status, ['pending', 'approved']),
          ...overlapping(r.startDate, r.endDate, period),
        ),
      ),
    db
      .select({
        id: k.id,
        membershipId: k.membershipId,
        name: users.name,
        role: memberships.role,
        kind: k.kind,
        typeLabel: k.typeLabel,
        startDate: k.startDate,
        endDate: k.endDate,
        requestId: k.requestId,
      })
      .from(k)
      .innerJoin(memberships, memberJoin(k.institutionId, k.membershipId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(k.institutionId, institutionId),
          isNull(k.archivedAt),
          ...overlapping(k.startDate, k.endDate, period),
        ),
      ),
    db
      .select({
        id: m.id,
        membershipId: m.membershipId,
        name: users.name,
        role: memberships.role,
        startDate: m.startDate,
        endDate: m.endDate,
      })
      .from(m)
      .innerJoin(memberships, memberJoin(m.institutionId, m.membershipId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(m.institutionId, institutionId),
          isNull(m.archivedAt),
          ...overlapping(m.startDate, m.endDate, period),
        ),
      ),
  ])
  const absences: LeaveAbsence[] = [
    ...requests.flatMap((row): LeaveAbsence[] =>
      row.status === 'pending' || row.status === 'approved'
        ? [{ ...row, source: 'request', status: row.status }]
        : [],
    ),
    ...records.map((row): LeaveAbsence => ({ ...row, source: 'record', status: 'approved' })),
    ...reports.map((row): LeaveAbsence => ({
      ...row,
      source: 'medical_report',
      status: 'approved',
      kind: null,
      typeLabel: null,
    })),
  ]
  return absences.sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) ||
      a.name.localeCompare(b.name, 'tr') ||
      a.id.localeCompare(b.id),
  )
}

/**
 * Branş verisi (K-421): üyelik → bağlı etkin öğretmen kayıtlarının dersleri, öğretmen kaydı →
 * izinli aralık eşlemesi için üyelik bağı, öğretmen adları ve ders adları (kurum `subjects`
 * kaydı, yoksa müfredat adı).
 */
export async function loadBranchData(db: Database, institutionId: string) {
  const [links, teachers, subjects] = await Promise.all([
    teacherLinks(db, institutionId),
    loadTeachers(db, institutionId),
    loadRecords(db, institutionId, ['subjects']),
  ])
  const teacherOf = new Map(teachers.map((teacher) => [teacher.id, teacher]))
  const branches = new Map<string, string[]>()
  for (const link of links) {
    const subjectId = teacherOf.get(link.teacherId)?.subjectId
    if (
      subjectId === null ||
      subjectId === undefined ||
      teacherOf.get(link.teacherId)?.isActive === false
    )
      continue
    const list = branches.get(link.membershipId) ?? []
    if (!list.includes(subjectId)) branches.set(link.membershipId, [...list, subjectId])
  }
  const subjectNames = new Map<string, string>()
  for (const teacher of teachers)
    if (teacher.subjectId !== null)
      subjectNames.set(teacher.subjectId, subjectById(teacher.subjectId)?.name ?? teacher.subjectId)
  for (const row of subjects)
    if (typeof row.data.name === 'string' && row.data.name.trim() !== '')
      subjectNames.set(row.id, row.data.name)
  return {
    links,
    branches,
    subjectNames,
    teacherNames: new Map(teachers.map((teacher) => [teacher.id, teacher.name])),
  }
}
