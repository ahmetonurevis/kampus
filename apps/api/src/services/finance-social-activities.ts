import { randomUUID } from 'node:crypto'

import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  approvedMinutes,
  assertSocialActivityArchivable,
  assertSocialHourPending,
  assertSocialHourReversible,
  canManageSocialActivity,
  certificateRows,
  DEFAULT_SOCIAL_TARGETS,
  hoursToMinutes,
  isHighSchoolGrade,
  planSocialActivity,
  planSocialActivityUpdate,
  planSocialHourDeclaration,
  planSocialHourEntries,
  socialAcademicYearOf,
  socialActivityCreateSchema,
  socialActivitySettingsSchema,
  socialActivityUpdateSchema,
  socialHourDeclarationSchema,
  socialHourEntrySchema,
  socialHourRejectSchema,
  socialHourReverseSchema,
  socialProgress,
  type SocialActivityKind,
  type SocialHourStatus,
  type SocialStudentCheck,
  type SocialTargets,
} from '@kampus/school-core/lib/finance-social-activities.ts'

import type { Database } from '../db/client.ts'
import { findClub } from '../db/finance-clubs.ts'
import {
  decideSocialHour,
  findSocialActivity,
  findSocialActivitySettings,
  findSocialHour,
  insertSocialActivity,
  insertSocialHours,
  listSocialActivities,
  listSocialHours,
  loadSocialActivities,
  loadSocialHoursByIds,
  loadStudentSocialHours,
  markSocialHourReversed,
  responsibleActivityIds,
  saveSocialActivitySettings,
  socialActivityEntryDays,
  socialActivityTotals,
  studentsWithEntryOn,
  updateSocialActivity,
  type NewSocialHour,
  type StoredSocialActivity,
  type StoredSocialHourRow,
} from '../db/finance-social-activities.ts'
import { memberNames } from '../db/finance-visitors.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { memberCheck } from './finance-transport.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { readScope, readSource } from './read-scope.ts'
import { auditWork } from './task-work.ts'

/**
 * Lise sosyal etkinlik ve gönüllülük saatleri (DOM-FIN-160; ON-170; DOM-AKD-021; K-535…K-537).
 * Kural core `lib/finance-social-activities.ts`'tedir; servis kurum kilidi altında yükler ve aynı
 * transaction'da yazar, denetime alan adlarını yazar (öğrenci kimliği, not ve gerekçe yazılmaz).
 * Yönetici bütün etkinlikleri, öğretmen sorumlu olduğu etkinlikleri yönetir (başkası 404). Sınıf
 * özeti ve öğrenci belgesi öğretmende sınıf öğretmeni olduğu ve derse girdiği sınıflarla sınırlıdır.
 * Öğrenci ve veli kapsamı core `scope.studentIds`'tir. Kurum türü, rol ve modül rotadadır.
 */

const ACTIVITY = 'social_activities'
const HOUR = 'social_activity_hours'
const SETTINGS = 'social_activity_settings'
const STUDENT = 'students'

const actorOf = (ctx: ServiceContext) => ({
  role: ctx.actor.role,
  membershipId: ctx.actor.membershipId,
})

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

// --- Kapsam --------------------------------------------------------------------------------------

/** Etkinliği yönetebilen görür; öğretmene başkasının etkinliği yokmuş gibi 404. */
function assertManageable(
  ctx: ServiceContext,
  activity: StoredSocialActivity | null | undefined,
): asserts activity is StoredSocialActivity {
  if (activity === null || activity === undefined) throw new NotFoundError()
  if (!canManageSocialActivity(actorOf(ctx), activity)) throw new NotFoundError()
}

async function manageableActivity(db: Database, ctx: ServiceContext, id: string) {
  const activity = await findSocialActivity(db, ctx.institutionId, id)
  assertManageable(ctx, activity)
  return activity
}

/** Sınıf özeti ve belge kapsamı: yönetici bütün sınıflar, öğretmen sınıf öğretmeni ve derse girdiği. */
async function visibleClassIds(ctx: ServiceContext): Promise<'all' | ReadonlySet<string>> {
  if (ctx.actor.role === 'yonetici') return 'all'
  if (ctx.actor.role !== 'ogretmen') return new Set()
  const [scope, source] = await Promise.all([readScope(ctx), readSource(ctx)])
  const teacherId = scope.teacher?.id
  if (teacherId === undefined) return new Set()
  return new Set([
    ...source.classes.filter((item) => item.teacherId === teacherId).map((item) => item.id),
    ...source.assignments
      .filter((item) => item.teacherId === teacherId)
      .map((item) => item.classId),
  ])
}

/** Kapsam kaynağında `isActive` yalnız kayıtta varsa bulunur; alan yoksa öğrenci etkindir. */
const activeInSource = (student: object) => !('isActive' in student && student.isActive === false)

const classVisible = (classes: 'all' | ReadonlySet<string>, classId: string | null) =>
  classes === 'all' || (classId !== null && classes.has(classId))

// --- Öğrenci ve sınıf ----------------------------------------------------------------------------

interface SocialStudent {
  id: string
  name: string
  active: boolean
  classId: string | null
  className: string | null
  grade: number | undefined
}

/** Öğrencilerin adı, etkinliği ve sınıf düzeyi (records `students` → `classes`). */
async function socialStudents(
  db: Database,
  ctx: ServiceContext,
  studentIds: readonly string[],
): Promise<Map<string, SocialStudent>> {
  const students = await loadRecordsByIds(db, ctx.institutionId, STUDENT, [...new Set(studentIds)])
  const classIds = students.flatMap((row) =>
    typeof row.data.classId === 'string' ? [row.data.classId] : [],
  )
  const classes = await loadRecordsByIds(db, ctx.institutionId, 'classes', [...new Set(classIds)], {
    includeArchived: true,
  })
  const classById = new Map(classes.map((row) => [row.id, row.data]))
  return new Map(
    students.map((row) => {
      const classId = typeof row.data.classId === 'string' ? row.data.classId : null
      const klass = classId === null ? undefined : classById.get(classId)
      return [
        row.id,
        {
          id: row.id,
          name: text(row.data.name) ?? '—',
          active: row.data.isActive !== false,
          classId,
          className: text(klass?.name) ?? classId,
          grade: typeof klass?.grade === 'number' ? klass.grade : undefined,
        },
      ]
    }),
  )
}

const studentCheckOf = (student: SocialStudent | undefined): SocialStudentCheck =>
  student === undefined ? null : { active: student.active, grade: student.grade }

async function targetsOf(db: Database, ctx: ServiceContext) {
  const row = await findSocialActivitySettings(db, ctx.institutionId)
  return row ?? { ...DEFAULT_SOCIAL_TARGETS, version: 0 }
}

// --- Görünüm -------------------------------------------------------------------------------------

async function activityRows(
  db: Database,
  ctx: ServiceContext,
  activities: readonly StoredSocialActivity[],
) {
  const [names, totals, clubs] = await Promise.all([
    memberNames(
      db,
      ctx.institutionId,
      activities.map((activity) => activity.responsibleMembershipId),
    ),
    socialActivityTotals(
      db,
      ctx.institutionId,
      activities.map((activity) => activity.id),
    ),
    Promise.all(
      [...new Set(activities.flatMap((activity) => activity.clubId ?? []))].map((id) =>
        findClub(db, ctx.institutionId, id),
      ),
    ),
  ])
  const clubNames = new Map(clubs.flatMap((club) => (club === null ? [] : [[club.id, club.name]])))
  return activities.map((activity) => ({
    id: activity.id,
    name: activity.name,
    kind: activity.kind,
    startDate: activity.startDate,
    endDate: activity.endDate,
    location: activity.location,
    responsibleMembershipId: activity.responsibleMembershipId,
    responsibleName: names.get(activity.responsibleMembershipId) ?? null,
    organizationScope: activity.organizationScope,
    organizationName: activity.organizationName,
    clubId: activity.clubId,
    clubName: activity.clubId === null ? null : (clubNames.get(activity.clubId) ?? null),
    approvedMinutes: totals.get(activity.id)?.approvedMinutes ?? 0,
    pendingCount: totals.get(activity.id)?.pendingCount ?? 0,
    version: activity.version,
  }))
}

async function activityBody(db: Database, ctx: ServiceContext, id: string) {
  const activity = await findSocialActivity(db, ctx.institutionId, id)
  if (activity === null) throw new NotFoundError()
  const [row] = await activityRows(db, ctx, [activity])
  if (row === undefined) throw new NotFoundError()
  return row
}

async function hourRows(db: Database, ctx: ServiceContext, rows: readonly StoredSocialHourRow[]) {
  const [activities, students] = await Promise.all([
    loadSocialActivities(
      db,
      ctx.institutionId,
      rows.map((row) => row.activityId),
    ),
    socialStudents(
      db,
      ctx,
      rows.map((row) => row.studentId),
    ),
  ])
  const activityById = new Map(activities.map((activity) => [activity.id, activity]))
  return rows.map((row) => {
    const activity = activityById.get(row.activityId)
    return {
      id: row.id,
      activityId: row.activityId,
      activityName: activity?.name ?? '—',
      activityKind: activity?.kind ?? ('volunteering' satisfies SocialActivityKind),
      studentId: row.studentId,
      studentName: students.get(row.studentId)?.name ?? '—',
      className: students.get(row.studentId)?.className ?? null,
      activityDate: row.activityDate,
      academicYear: socialAcademicYearOf(row.activityDate),
      kind: row.kind,
      minutes: row.minutes,
      status: row.status,
      source: row.source,
      note: row.note,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      rejectionReason: row.rejectionReason,
      reversesEntryId: row.reversesEntryId,
      reversedByEntryId: row.reversedByEntryId,
      createdAt: row.createdAt.toISOString(),
      version: row.version,
    }
  })
}

async function hourBody(db: Database, ctx: ServiceContext, id: string) {
  const row = await findSocialHour(db, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  const [body] = await hourRows(db, ctx, [row])
  if (body === undefined) throw new NotFoundError()
  return body
}

/** Öğrencinin yıl ve toplam onaylı net dakikası, hedefe göre durumu ve bekleyen beyan sayısı. */
function progressOf(
  rows: readonly StoredSocialHourRow[],
  academicYear: number,
  targets: SocialTargets,
) {
  const year = rows.filter((row) => socialAcademicYearOf(row.activityDate) === academicYear)
  return {
    ...socialProgress({
      totalMinutes: approvedMinutes(rows),
      yearMinutes: approvedMinutes(year),
      targets,
    }),
    pendingCount: rows.filter((row) => row.status === 'pending').length,
  }
}

const groupByStudent = (rows: readonly StoredSocialHourRow[]) => {
  const map = new Map<string, StoredSocialHourRow[]>()
  for (const row of rows) map.set(row.studentId, [...(map.get(row.studentId) ?? []), row])
  return map
}

// --- Okuma: etkinlik ve kuyruk -------------------------------------------------------------------

export async function listSocialActivitiesFor(
  ctx: ServiceContext,
  query: {
    page: number
    pageSize: number
    q?: string | undefined
    kind?: SocialActivityKind | undefined
  },
) {
  const { items, total } = await listSocialActivities(ctx.db, ctx.institutionId, {
    ...query,
    ...(ctx.actor.role === 'ogretmen' ? { responsibleMembershipId: ctx.actor.membershipId } : {}),
  })
  return { items: await activityRows(ctx.db, ctx, items), total }
}

export async function getSocialActivityFor(ctx: ServiceContext, id: string) {
  await manageableActivity(ctx.db, ctx, id)
  return activityBody(ctx.db, ctx, id)
}

/**
 * Saat kayıtları (onay kuyruğu ve geçmiş): yönetici bütün etkinliklerde, öğretmen sorumlu olduğu
 * etkinliklerde (başkasının etkinliği süzgeçte 404).
 */
export async function listSocialHoursFor(
  ctx: ServiceContext,
  query: {
    page: number
    pageSize: number
    status?: SocialHourStatus | undefined
    activityId?: string | undefined
    studentId?: string | undefined
  },
) {
  let activityIds: string[] | undefined
  if (query.activityId !== undefined) {
    const [activity] = await loadSocialActivities(ctx.db, ctx.institutionId, [query.activityId])
    assertManageable(ctx, activity)
    activityIds = [activity.id]
  } else if (ctx.actor.role === 'ogretmen')
    activityIds = await responsibleActivityIds(ctx.db, ctx.institutionId, ctx.actor.membershipId)
  const { items, total } = await listSocialHours(ctx.db, ctx.institutionId, {
    page: query.page,
    pageSize: query.pageSize,
    status: query.status,
    activityIds,
    studentId: query.studentId,
  })
  return { items: await hourRows(ctx.db, ctx, items), total }
}

// --- Okuma: özet ---------------------------------------------------------------------------------

export async function getSocialActivitySettingsFor(ctx: ServiceContext) {
  const targets = await targetsOf(ctx.db, ctx)
  return { ...targets, isDefault: targets.version === 0 }
}

/** Lise öğrencileri olan, görülebilen sınıflar ve hedefe göre durum sayıları (K-537). */
export async function listSocialClassesFor(ctx: ServiceContext, academicYear: number) {
  const [classes, source, targets] = await Promise.all([
    visibleClassIds(ctx),
    readSource(ctx),
    targetsOf(ctx.db, ctx),
  ])
  const highSchool = source.classes.filter(
    (item) => isHighSchoolGrade(item.grade) && classVisible(classes, item.id),
  )
  const classIds = new Set(highSchool.map((item) => item.id))
  const students = source.students.filter(
    (student) => activeInSource(student) && classIds.has(student.classId),
  )
  const [rows, names] = await Promise.all([
    loadStudentSocialHours(
      ctx.db,
      ctx.institutionId,
      students.map((student) => student.id),
    ),
    loadRecordsByIds(
      ctx.db,
      ctx.institutionId,
      'classes',
      highSchool.map((item) => item.id),
    ),
  ])
  const byStudent = groupByStudent(rows)
  const nameOf = new Map(names.map((row) => [row.id, text(row.data.name) ?? row.id]))
  return highSchool
    .map((item) => {
      const own = students.filter((student) => student.classId === item.id)
      const statuses = own.map(
        (student) => progressOf(byStudent.get(student.id) ?? [], academicYear, targets).status,
      )
      return {
        classId: item.id,
        className: nameOf.get(item.id) ?? item.id,
        grade: item.grade,
        studentCount: own.length,
        metCount: statuses.filter((status) => status === 'met').length,
        onTrackCount: statuses.filter((status) => status === 'on_track').length,
        behindCount: statuses.filter((status) => status === 'behind').length,
      }
    })
    .sort((a, b) => a.className.localeCompare(b.className, 'tr', { numeric: true }))
}

/** Sınıfın etkin öğrencileri: yıl ve toplam onaylı saat, durum, bekleyen beyan (K-537). */
export async function getSocialClassFor(
  ctx: ServiceContext,
  classId: string,
  query: { academicYear: number; status?: 'met' | 'on_track' | 'behind' | undefined },
) {
  const [classes, source, targets] = await Promise.all([
    visibleClassIds(ctx),
    readSource(ctx),
    targetsOf(ctx.db, ctx),
  ])
  const klass = source.classes.find((item) => item.id === classId)
  if (klass === undefined || !isHighSchoolGrade(klass.grade) || !classVisible(classes, classId))
    throw new NotFoundError()
  const studentIds = source.students
    .filter((student) => activeInSource(student) && student.classId === classId)
    .map((student) => student.id)
  const [rows, students] = await Promise.all([
    loadStudentSocialHours(ctx.db, ctx.institutionId, studentIds),
    socialStudents(ctx.db, ctx, studentIds),
  ])
  const byStudent = groupByStudent(rows)
  const items = studentIds
    .map((id) => ({
      studentId: id,
      studentName: students.get(id)?.name ?? '—',
      ...progressOf(byStudent.get(id) ?? [], query.academicYear, targets),
    }))
    .filter((row) => query.status === undefined || row.status === query.status)
    .sort((a, b) => a.studentName.localeCompare(b.studentName, 'tr'))
  return {
    classId,
    className: students.get(studentIds[0] ?? '')?.className ?? classId,
    grade: klass.grade,
    academicYear: query.academicYear,
    totalTargetHours: targets.totalTargetHours,
    yearlyTargetHours: targets.yearlyTargetHours,
    students: items,
  }
}

async function visibleStudent(db: Database, ctx: ServiceContext, studentId: string) {
  const [students, classes] = await Promise.all([
    socialStudents(db, ctx, [studentId]),
    visibleClassIds(ctx),
  ])
  const student = students.get(studentId)
  if (student === undefined || !isHighSchoolGrade(student.grade)) throw new NotFoundError()
  if (!classVisible(classes, student.classId)) throw new NotFoundError()
  return student
}

/** Öğrencinin bütün kayıtları ve hedefe göre durumu (yönetici; öğretmen sınıf kapsamında). */
export async function getSocialStudentFor(
  ctx: ServiceContext,
  studentId: string,
  academicYear: number,
) {
  const student = await visibleStudent(ctx.db, ctx, studentId)
  const [rows, targets] = await Promise.all([
    loadStudentSocialHours(ctx.db, ctx.institutionId, [studentId]),
    targetsOf(ctx.db, ctx),
  ])
  return {
    studentId,
    studentName: student.name,
    className: student.className,
    grade: student.grade ?? null,
    academicYear,
    progress: progressOf(rows, academicYear, targets),
    entries: (await hourRows(ctx.db, ctx, rows)).reverse(),
  }
}

/**
 * Sosyal etkinlik ve gönüllülük belgesinin verisi (K-537): yalnız onaylı ve düzeltilmemiş kayıtlar;
 * öğretim yılı toplamları. Her basım öğrenci başına denetime düşer (`finance.social_activity.certificate`).
 */
export async function socialCertificateFor(ctx: ServiceContext, studentId: string) {
  const student = await visibleStudent(ctx.db, ctx, studentId)
  return ctx.db.transaction(async (tx) => {
    const [rows, targets] = await Promise.all([
      loadStudentSocialHours(tx, ctx.institutionId, [studentId]),
      targetsOf(tx, ctx),
    ])
    const kept = certificateRows(rows)
    const activities = await loadSocialActivities(
      tx,
      ctx.institutionId,
      kept.rows.map((row) => row.activityId),
    )
    const responsible = await memberNames(
      tx,
      ctx.institutionId,
      activities.map((activity) => activity.responsibleMembershipId),
    )
    const activityById = new Map(activities.map((activity) => [activity.id, activity]))
    const years = new Map<number, number>()
    for (const row of kept.rows) {
      const year = socialAcademicYearOf(row.activityDate)
      years.set(year, (years.get(year) ?? 0) + row.minutes)
    }
    const progress = socialProgress({
      totalMinutes: kept.totalMinutes,
      yearMinutes: years.get(socialAcademicYearOf(dayKey(ctx.now))) ?? 0,
      targets,
    })
    await auditWork(
      tx,
      ctx,
      'finance.social_activity.certificate',
      { type: STUDENT, id: studentId },
      ['entries', 'totalMinutes'],
    )
    return {
      studentId,
      studentName: student.name,
      className: student.className,
      grade: student.grade ?? null,
      issuedOn: dayKey(ctx.now),
      totalMinutes: kept.totalMinutes,
      totalTargetHours: targets.totalTargetHours,
      status: progress.status,
      years: [...years.entries()]
        .sort(([a], [b]) => a - b)
        .map(([academicYear, minutes]) => ({ academicYear, minutes })),
      rows: kept.rows.map((row) => {
        const activity = activityById.get(row.activityId)
        return {
          entryId: row.id,
          activityDate: row.activityDate,
          academicYear: socialAcademicYearOf(row.activityDate),
          activityName: activity?.name ?? '—',
          activityKind: activity?.kind ?? ('volunteering' satisfies SocialActivityKind),
          organizationScope: activity?.organizationScope ?? 'internal',
          organizationName: activity?.organizationName ?? null,
          location: activity?.location ?? '—',
          responsibleName:
            activity === undefined
              ? null
              : (responsible.get(activity.responsibleMembershipId) ?? null),
          minutes: row.minutes,
        }
      }),
    }
  })
}

// --- Okuma: öğrenci ve veli ----------------------------------------------------------------------

/** Kapsamdaki lise öğrencileri (öğrenci kendisi, veli bağlı çocukları). */
async function familyStudents(ctx: ServiceContext) {
  const scope = await readScope(ctx)
  const students = await socialStudents(ctx.db, ctx, [...scope.studentIds])
  return [...students.values()].filter((student) => isHighSchoolGrade(student.grade))
}

/** Öğrenci ve veli görünümü (K-536, K-537): kendi (çocuğunun) saatleri, durum ve kayıtlar. */
export async function listMySocialHoursFor(ctx: ServiceContext, academicYear: number) {
  const students = await familyStudents(ctx)
  const [rows, targets] = await Promise.all([
    loadStudentSocialHours(
      ctx.db,
      ctx.institutionId,
      students.map((student) => student.id),
    ),
    targetsOf(ctx.db, ctx),
  ])
  const byStudent = groupByStudent(rows)
  return Promise.all(
    students
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .map(async (student) => {
        const own = byStudent.get(student.id) ?? []
        return {
          studentId: student.id,
          studentName: student.name,
          className: student.className,
          academicYear,
          progress: progressOf(own, academicYear, targets),
          entries: (await hourRows(ctx.db, ctx, own)).reverse(),
        }
      }),
  )
}

/** Öğrencinin beyan edebileceği etkinlikler: başlamış, arşivlenmemiş. */
export async function listDeclarableActivitiesFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number; q?: string | undefined },
) {
  const { items, total } = await listSocialActivities(ctx.db, ctx.institutionId, {
    ...query,
    startedBy: dayKey(ctx.now),
  })
  const rows = await activityRows(ctx.db, ctx, items)
  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      startDate: row.startDate,
      endDate: row.endDate,
      location: row.location,
      responsibleName: row.responsibleName,
      organizationScope: row.organizationScope,
      organizationName: row.organizationName,
    })),
    total,
  }
}

// --- Etkinlik yazma ------------------------------------------------------------------------------

/** Yeni etkinlik (K-535). `Idempotency-Key` rotada zorunlu. 201. */
export function createSocialActivityCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ACTIVITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.social_activity.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = socialActivityCreateSchema.parse(input)
        const [responsible, club] = await Promise.all([
          memberCheck(tx, ctx, parsed.responsibleMembershipId),
          parsed.clubId === null ? null : findClub(tx, ctx.institutionId, parsed.clubId),
        ])
        return {
          run: () => {
            planSocialActivity(parsed, {
              actor: actorOf(ctx),
              responsible,
              clubFound: parsed.clubId === null ? null : club !== null,
            })
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        await insertSocialActivity(tx, ctx.institutionId, {
          id,
          ...parsed,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.social_activity.create', entity, Object.keys(parsed))
        body = { data: await activityBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

async function versionedActivity(tx: Database, ctx: ServiceContext, id: string, version: number) {
  const activity = await manageableActivity(tx, ctx, id)
  if (activity.version !== version) throw new ConflictError()
  return activity
}

/** Etkinlik düzenleme (K-535). `If-Match`. */
export function updateSocialActivityCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ACTIVITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.social_activity.update',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = socialActivityUpdateSchema.parse(input)
        const activity = await versionedActivity(tx, ctx, id, expectedVersion)
        const [responsible, club, entryDays] = await Promise.all([
          memberCheck(tx, ctx, parsed.responsibleMembershipId),
          typeof parsed.clubId === 'string' ? findClub(tx, ctx.institutionId, parsed.clubId) : null,
          socialActivityEntryDays(tx, ctx.institutionId, id),
        ])
        return {
          run: () =>
            planSocialActivityUpdate(activity, parsed, {
              actor: actorOf(ctx),
              responsible,
              clubFound: typeof parsed.clubId === 'string' ? club !== null : null,
              entryDays,
            }),
        }
      },
      after: async (tx, plan) => {
        const saved = await updateSocialActivity(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: plan.next,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.social_activity.update', entity, plan.changed)
        body = { data: await activityBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Etkinlik arşivi (K-535): bekleyen beyan varsa 422. `If-Match`. */
export function archiveSocialActivityCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ACTIVITY, id }
  return runCommand(
    ctx,
    {
      action: 'finance.social_activity.archive',
      collections: [],
      entity,
      load: async (tx) => {
        await versionedActivity(tx, ctx, id, expectedVersion)
        const totals = await socialActivityTotals(tx, ctx.institutionId, [id])
        return { run: () => assertSocialActivityArchivable(totals.get(id)?.pendingCount ?? 0) }
      },
      after: async (tx) => {
        const saved = await updateSocialActivity(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: { archivedAt: ctx.now },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.social_activity.archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id } } }),
    idempotency,
  )
}

// --- Saat yazma ----------------------------------------------------------------------------------

/**
 * Sorumlu öğretmen ya da yönetici girişi (K-536): seçilen öğrencilere aynı gün ve saat, onaylı
 * açılır. Bir satır reddedilirse hiçbiri yazılmaz. `Idempotency-Key` zorunlu. 201.
 */
export function createSocialHoursCommand(
  ctx: ServiceContext,
  activityId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ACTIVITY, id: activityId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.social_activity.entry',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = socialHourEntrySchema.parse(input)
        const activity = await manageableActivity(tx, ctx, activityId)
        const [students, existing] = await Promise.all([
          socialStudents(tx, ctx, parsed.studentIds),
          studentsWithEntryOn(tx, ctx.institutionId, {
            activityId,
            activityDate: parsed.activityDate,
            studentIds: parsed.studentIds,
          }),
        ])
        return {
          run: () => {
            planSocialHourEntries(activity, parsed, {
              today: dayKey(ctx.now),
              students: new Map(
                parsed.studentIds.map((id) => [id, studentCheckOf(students.get(id))]),
              ),
              existing,
            })
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        const rows: NewSocialHour[] = parsed.studentIds.map((studentId) => ({
          id: randomUUID(),
          activityId,
          studentId,
          activityDate: parsed.activityDate,
          kind: 'entry',
          minutes: hoursToMinutes(parsed.hours),
          status: 'approved',
          source: 'teacher',
          note: parsed.note,
          enteredByUserId: ctx.actor.userId,
          decidedByUserId: ctx.actor.userId,
          decidedAt: ctx.now,
          reversesEntryId: null,
        }))
        await insertSocialHours(tx, ctx.institutionId, rows, ctx.now)
        await auditWork(tx, ctx, 'finance.social_activity.entry', entity, [
          'activityDate',
          'minutes',
          'studentIds',
          ...(parsed.note === null ? [] : ['note']),
        ])
        body = {
          data: await hourRows(
            tx,
            ctx,
            await loadSocialHoursByIds(
              tx,
              ctx.institutionId,
              rows.map((row) => row.id),
            ),
          ),
        }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Öğrenci beyanı (K-536): onay bekler. `Idempotency-Key` zorunlu. 201. */
export async function declareSocialHourCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  // Kapsam işlemden önce okunur: kapsam sorguları işlemin bağlantısını kullanmaz.
  const scope = await readScope(ctx)
  const [studentId] = [...scope.studentIds]
  const id = randomUUID()
  const entity = { type: HOUR, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.social_activity.declare',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = socialHourDeclarationSchema.parse(input)
        const activity = await findSocialActivity(tx, ctx.institutionId, parsed.activityId)
        if (activity === null) throw new NotFoundError()
        const students = await socialStudents(tx, ctx, studentId === undefined ? [] : [studentId])
        const existing =
          studentId === undefined
            ? new Set<string>()
            : await studentsWithEntryOn(tx, ctx.institutionId, {
                activityId: activity.id,
                activityDate: parsed.activityDate,
                studentIds: [studentId],
              })
        return {
          run: () => {
            planSocialHourDeclaration(activity, parsed, {
              today: dayKey(ctx.now),
              student: studentCheckOf(
                studentId === undefined ? undefined : students.get(studentId),
              ),
              exists: studentId !== undefined && existing.has(studentId),
            })
            return { parsed, studentId: studentId ?? '' }
          },
        }
      },
      after: async (tx, { parsed, studentId }) => {
        await insertSocialHours(
          tx,
          ctx.institutionId,
          [
            {
              id,
              activityId: parsed.activityId,
              studentId,
              activityDate: parsed.activityDate,
              kind: 'entry',
              minutes: hoursToMinutes(parsed.hours),
              status: 'pending',
              source: 'student',
              note: parsed.note,
              enteredByUserId: ctx.actor.userId,
              decidedByUserId: null,
              decidedAt: null,
              reversesEntryId: null,
            },
          ],
          ctx.now,
        )
        await auditWork(tx, ctx, 'finance.social_activity.declare', entity, [
          'activityId',
          'activityDate',
          'minutes',
          ...(parsed.note === null ? [] : ['note']),
        ])
        body = { data: await hourBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Kaydı ve etkinliğini yükler; yönetemeyen 404, sürüm tutmazsa 409. */
async function manageableHour(tx: Database, ctx: ServiceContext, id: string, version: number) {
  const entry = await findSocialHour(tx, ctx.institutionId, id)
  if (entry === null) throw new NotFoundError()
  const [activity] = await loadSocialActivities(tx, ctx.institutionId, [entry.activityId])
  assertManageable(ctx, activity)
  if (entry.version !== version) throw new ConflictError()
  return { entry, activity }
}

/** Beyan onayı ya da gerekçeli reddi (K-536). `If-Match` kaydın sürümü. */
export function decideSocialHourCommand(
  ctx: ServiceContext,
  id: string,
  decision: 'approved' | 'rejected',
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: HOUR, id }
  const action =
    decision === 'approved' ? 'finance.social_activity.approve' : 'finance.social_activity.reject'
  let body: unknown
  return runCommand(
    ctx,
    {
      action,
      collections: [],
      entity,
      load: async (tx) => {
        const reason = decision === 'rejected' ? socialHourRejectSchema.parse(input).reason : null
        const { entry } = await manageableHour(tx, ctx, id, expectedVersion)
        return { run: () => (assertSocialHourPending(entry), reason) }
      },
      after: async (tx, reason) => {
        const saved = await decideSocialHour(tx, ctx.institutionId, {
          id,
          expectedVersion,
          status: decision,
          rejectionReason: reason,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, action, entity, [
          'status',
          ...(reason === null ? [] : ['rejectionReason']),
        ])
        body = { data: await hourBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Ters kayıt (K-536): onaylı kaydın eksi dakikalı karşılığı gerekçeyle yazılır, kayıt bir kez
 * işaretlenir; aynı gün yeniden doğru saat girilebilir. `If-Match` düzeltilen kaydın sürümü. 201.
 */
export function reverseSocialHourCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const reversalId = randomUUID()
  const entity = { type: HOUR, id: reversalId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.social_activity.reverse',
      collections: [],
      entity,
      load: async (tx) => {
        const { reason } = socialHourReverseSchema.parse(input)
        const { entry } = await manageableHour(tx, ctx, id, expectedVersion)
        return { run: () => (assertSocialHourReversible(entry), { entry, reason }) }
      },
      after: async (tx, { entry, reason }) => {
        await insertSocialHours(
          tx,
          ctx.institutionId,
          [
            {
              id: reversalId,
              activityId: entry.activityId,
              studentId: entry.studentId,
              activityDate: entry.activityDate,
              kind: 'reversal',
              minutes: -entry.minutes,
              status: 'approved',
              source: 'teacher',
              note: reason,
              enteredByUserId: ctx.actor.userId,
              decidedByUserId: ctx.actor.userId,
              decidedAt: ctx.now,
              reversesEntryId: entry.id,
            },
          ],
          ctx.now,
        )
        const saved = await markSocialHourReversed(tx, ctx.institutionId, {
          id,
          expectedVersion,
          reversalId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.social_activity.reverse', entity, [
          'reversesEntryId',
          'minutes',
          'note',
        ])
        body = { data: await hourBody(tx, ctx, reversalId) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/**
 * Hedef ayarı (K-537): yalnız yönetici. Satır yokken `If-Match` gönderilmez; satır varsa zorunlu
 * ve tutmalı (yoksa 409).
 */
export function saveSocialActivitySettingsCommand(
  ctx: ServiceContext,
  input: unknown,
  expectedVersion: number | null,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SETTINGS, id: ctx.institutionId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.social_activity.settings',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = socialActivitySettingsSchema.parse(input)
        const current = await targetsOf(tx, ctx)
        if ((expectedVersion ?? 0) !== current.version) throw new ConflictError()
        return {
          run: () => ({
            totalTargetHours: parsed.totalTargetHours ?? current.totalTargetHours,
            yearlyTargetHours:
              parsed.yearlyTargetHours === undefined
                ? current.yearlyTargetHours
                : parsed.yearlyTargetHours,
            version: current.version,
          }),
        }
      },
      after: async (tx, next) => {
        const saved = await saveSocialActivitySettings(tx, ctx.institutionId, {
          totalTargetHours: next.totalTargetHours,
          yearlyTargetHours: next.yearlyTargetHours,
          expectedVersion: next.version,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.social_activity.settings', entity, [
          'totalTargetHours',
          'yearlyTargetHours',
        ])
        body = { data: await getSocialActivitySettingsFor({ ...ctx, db: tx }) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
