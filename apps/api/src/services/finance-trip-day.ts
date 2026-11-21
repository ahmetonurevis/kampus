import { randomUUID } from 'node:crypto'

import {
  assertTripDayCardPurpose,
  canManageTripDay,
  isTripDay,
  planTripDayAssign,
  planTripDayCheckComplete,
  planTripDayCheckProceed,
  planTripDayCheckStart,
  planTripDayGroup,
  planTripDayGroupArchive,
  planTripDayMarks,
  tripDayAssignSchema,
  tripDayCheckCompleteSchema,
  tripDayCheckCounts,
  tripDayCheckProceedSchema,
  tripDayCheckStartSchema,
  tripDayGroupAccess,
  tripDayGroupSchema,
  tripDayGroupUpdateSchema,
  tripDayHealthAlert,
  tripDayMarksSchema,
  tripDayRange,
  type TripDayCardPurpose,
  type TripDayGroupAccess,
  type TripDayHealthAlert,
  type TripDayMarkState,
  type TripDayRosterStatus,
} from '@kampus/school-core/lib/finance-trip-day.ts'
import {
  transportRosterContacts,
  type RosterParentRecord,
} from '@kampus/school-core/lib/finance-transport-roster.ts'
import { tripPlanNumber } from '@kampus/school-core/lib/finance-trip-plans.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import { listApprovedConsentsOn } from '../db/finance-infirmary.ts'
import { activeParticipants } from '../db/finance-paid-activities.ts'
import {
  archiveTripDayGroup,
  archiveTripDayMembers,
  closeTripDayCheck,
  findTripDayCheck,
  findTripDayGroup,
  insertTripDayCheck,
  insertTripDayGroup,
  insertTripDayMark,
  insertTripDayMembers,
  loadStudentTripDayGroups,
  loadStudentTripDayMarks,
  loadTripDayChecks,
  loadTripDayGroups,
  loadTripDayMarks,
  loadTripDayMembers,
  moveTripDayMembers,
  nextTripDayGroupPosition,
  updateTripDayGroup,
  updateTripDayMark,
  userNames,
  type StoredTripDayCheck,
  type StoredTripDayGroup,
  type StoredTripDayMark,
  type StoredTripDayMember,
} from '../db/finance-trip-day.ts'
import { findTripPlan, loadTripPlanStaff, type StoredTripPlan } from '../db/finance-trip-plans.ts'
import { memberNames } from '../db/finance-visitors.ts'
import { loadRecords, loadRecordsByIds } from '../db/records.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { loadGuardianAccounts } from '../db/student-guardians.ts'
import { AppError, ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { getHealthProfile, type HealthProfileDeps } from './health-profiles.ts'
import {
  mapOperationError,
  runCommand,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'
import { readScope } from './read-scope.ts'
import { auditWork } from './task-work.ts'

/**
 * Gezi günü yoklaması ve acil kart (DOM-FIN-154; ON-157; K-517…K-519). Kural core
 * `lib/finance-trip-day.ts`'tedir; servis kurum kilidi altında yükler, aynı transaction'da yazar ve
 * denetime yalnız alan adlarını yazar (öğrenci kimliği, saat, gerekçe ve telefon yazılmaz).
 * Katılımcılar gezi planına bağlı ücretli etkinliğin asil katılımlarıdır (DOM-FIN-098, DOM-FIN-112);
 * etkinliksiz planda kurumun kayıtlı öğrencileridir. Öğretmen yalnız sorumlusu olduğu grubu görür
 * (başka grup ve sorumlusu olmadığı plan 404). Acil kartın sağlık uyarısı sağlık profili servisinden
 * (`getHealthProfile`, IST-020; erişim kararı ve okuma denetimi orada) okunur, kopyalanmaz; okuyanın
 * profil erişimi yoksa yalnız revirdeki onaylı ilaç işareti (DOM-FIN-151) kalır.
 */

const GROUP = 'trip_day_groups'
const CHECK = 'trip_day_checks'
const CARD_FIELDS = ['studentName', 'className', 'contactName', 'contactPhone', 'healthAlert']
const CARD_ACTIONS = {
  office: 'finance.trip_day.emergency_card',
  emergency: 'finance.trip_day.emergency_card_full',
} as const satisfies Record<TripDayCardPurpose, string>
/** Etkinliksiz planda aday listesinin üst sınırı (ada göre). */
const CANDIDATES_MAX = 500

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null
const iso = (value: Date | null) => (value === null ? null : value.toISOString())

// --- Yükleme -------------------------------------------------------------------------------------

interface StudentFacts {
  name: string
  classId: string | null
  parentId: string | null
}

async function studentFacts(
  db: Database,
  ctx: ServiceContext,
  studentIds: readonly string[],
): Promise<{ students: Map<string, StudentFacts>; classNames: Map<string, string> }> {
  const rows = await loadRecordsByIds(db, ctx.institutionId, 'students', [...new Set(studentIds)], {
    includeArchived: true,
  })
  const students = new Map(
    rows.map((row) => [
      row.id,
      {
        name: text(row.data.name) ?? '—',
        classId: text(row.data.classId),
        parentId: text(row.data.parentId),
      },
    ]),
  )
  const classIds = [...students.values()].flatMap((s) => (s.classId === null ? [] : [s.classId]))
  const classRows = await loadRecordsByIds(
    db,
    ctx.institutionId,
    'classes',
    [...new Set(classIds)],
    {
      includeArchived: true,
    },
  )
  const classNames = new Map(
    classRows.flatMap((row) => {
      const name = text(row.data.name)
      return name === null ? [] : [[row.id, name] as const]
    }),
  )
  return { students, classNames }
}

/**
 * Gezinin katılımcıları (K-517): bağlı ücretli etkinlikte asil (taksiti açık, izni alınmış)
 * katılımlar; etkinliksiz planda kurumun arşivlenmemiş ve etkin öğrencileri.
 */
async function eligibleStudents(db: Database, ctx: ServiceContext, plan: StoredTripPlan) {
  if (plan.paidActivityId !== null) {
    const rows = await activeParticipants(db, ctx.institutionId, plan.paidActivityId)
    return { source: 'activity' as const, ids: new Set(rows.map((row) => row.studentId)) }
  }
  const rows = await loadRecords(db, ctx.institutionId, ['students'])
  return {
    source: 'students' as const,
    ids: new Set(rows.filter((row) => row.data.isActive !== false).map((row) => row.id)),
  }
}

interface DayState {
  plan: StoredTripPlan
  groups: StoredTripDayGroup[]
  members: StoredTripDayMember[]
  checks: StoredTripDayCheck[]
  marks: StoredTripDayMark[]
  eligible: Awaited<ReturnType<typeof eligibleStudents>>
}

async function loadDay(db: Database, ctx: ServiceContext, planId: string): Promise<DayState> {
  const plan = await findTripPlan(db, ctx.institutionId, planId)
  if (plan === null) throw new NotFoundError()
  const [groups, members, checks, eligible] = await Promise.all([
    loadTripDayGroups(db, ctx.institutionId, planId),
    loadTripDayMembers(db, ctx.institutionId, planId),
    loadTripDayChecks(db, ctx.institutionId, planId),
    eligibleStudents(db, ctx, plan),
  ])
  const marks = await loadTripDayMarks(
    db,
    ctx.institutionId,
    checks.map((check) => check.id),
  )
  return { plan, groups, members, checks, marks, eligible }
}

const accessOf = (ctx: ServiceContext, group: StoredTripDayGroup) =>
  tripDayGroupAccess(ctx.actor, group.leaderMembershipId)

/** Grubun etkin öğrencileri: katılımı süren üyeler (iptal edilen katılım listeden düşer). */
const groupMembers = (state: DayState, groupId: string) =>
  state.members
    .filter((member) => member.groupId === groupId && state.eligible.ids.has(member.studentId))
    .map((member) => member.studentId)

interface RosterEntry {
  studentId: string
  status: TripDayRosterStatus
  markedAt: Date | null
}

/** Turun listesi: süren turda grubun öğrencileri ve işaretleri, kapanan turda yalnız işaretler. */
function rosterOf(state: DayState, check: StoredTripDayCheck): RosterEntry[] {
  const own = state.marks.filter((mark) => mark.checkId === check.id)
  if (check.status !== 'open')
    return own.map((mark) => ({
      studentId: mark.studentId,
      status: mark.status,
      markedAt: mark.markedAt,
    }))
  const byStudent = new Map(own.map((mark) => [mark.studentId, mark]))
  return groupMembers(state, check.groupId).map((studentId) => {
    const mark = byStudent.get(studentId)
    return { studentId, status: mark?.status ?? 'pending', markedAt: mark?.markedAt ?? null }
  })
}

/** Grup ve yetki; grup yoksa ya da rol göremiyorsa 404 (K-517). */
function groupScope(state: DayState, ctx: ServiceContext, groupId: string) {
  const group = state.groups.find((row) => row.id === groupId)
  if (group === undefined) throw new NotFoundError()
  const access = accessOf(ctx, group)
  if (!access.read) throw new NotFoundError()
  return { group, access }
}

// --- Gezi günü görünümü --------------------------------------------------------------------------

async function dayDetail(db: Database, ctx: ServiceContext, planId: string) {
  const state = await loadDay(db, ctx, planId)
  const { plan } = state
  const manager = canManageTripDay(ctx.actor.role)
  const visible = state.groups
    .map((group) => ({ group, access: accessOf(ctx, group) }))
    .filter((row) => row.access.read)
  // Öğretmen yalnız sorumlusu olduğu grubu görür; grubu yoksa plan ona yoktur (K-517).
  if (!manager && visible.length === 0) throw new NotFoundError()
  const assigned = new Set(state.members.map((member) => member.studentId))
  const unassigned = manager ? [...state.eligible.ids].filter((id) => !assigned.has(id)) : []
  const markStudents = state.marks.map((mark) => mark.studentId)
  const shownMembers = visible.flatMap(({ group }) => groupMembers(state, group.id))
  const [{ students, classNames }, staff, actors] = await Promise.all([
    studentFacts(db, ctx, [...shownMembers, ...unassigned, ...markStudents]),
    manager
      ? loadTripPlanStaff(db, ctx.institutionId, [planId])
      : Promise.resolve(new Map<string, []>()),
    userNames(
      db,
      state.checks.flatMap((check) =>
        check.closedByUserId === null
          ? [check.startedByUserId]
          : [check.startedByUserId, check.closedByUserId],
      ),
    ),
  ])
  const student = (studentId: string) => {
    const facts = students.get(studentId)
    return {
      studentId,
      studentName: facts?.name ?? '—',
      className:
        facts?.classId === null || facts === undefined
          ? null
          : (classNames.get(facts.classId) ?? null),
    }
  }
  const byName = (a: { studentName: string }, b: { studentName: string }) =>
    a.studentName.localeCompare(b.studentName, 'tr')
  const tripDay = isTripDay(plan, ctx.now)
  const { from, to } = tripDayRange(plan)
  const groups = visible.map(({ group, access }) => {
    const checks = state.checks
      .filter((check) => check.groupId === group.id)
      .map((check) => {
        const roster = rosterOf(state, check)
          .map((entry) => ({
            ...student(entry.studentId),
            status: entry.status,
            markedAt: iso(entry.markedAt),
          }))
          .sort(byName)
        return {
          id: check.id,
          sequence: check.sequence,
          checkpoint: check.checkpoint,
          status: check.status,
          startedAt: check.startedAt.toISOString(),
          startedByName: actors.get(check.startedByUserId) ?? null,
          closedAt: iso(check.closedAt),
          closedByName:
            check.closedByUserId === null ? null : (actors.get(check.closedByUserId) ?? null),
          counts: tripDayCheckCounts(roster.map((row) => row.status)),
          // Gerekçe serbest metindir; yalnız turu yürütebilene döner (K-517).
          missingReason: access.operate ? check.missingReason : null,
          canOperate: access.operate && check.status === 'open',
          version: check.version,
          roster,
        }
      })
    const open = checks.find((check) => check.status === 'open') ?? null
    return {
      id: group.id,
      name: group.name,
      vehiclePlate: group.vehiclePlate,
      leaderMembershipId: group.leaderMembershipId,
      leaderName: group.leaderName,
      position: group.position,
      students: groupMembers(state, group.id).map(student).sort(byName),
      checks,
      openCheckId: open?.id ?? null,
      canEdit: manager,
      canStartCheck: access.operate && open === null && tripDay && plan.status === 'approved',
      canOperate: access.operate,
      canReadCard: access.card,
      canReadFullCard: access.card && (ctx.actor.role === 'yonetici' || tripDay),
      version: group.version,
    }
  })
  return {
    planId: plan.id,
    planNumber: tripPlanNumber(plan.sequence),
    planName: plan.name,
    planStatus: plan.status,
    departureAt: plan.departureAt,
    returnAt: plan.returnAt,
    firstDay: from,
    lastDay: to,
    isTripDay: tripDay,
    transportPlate: plan.transport.plate,
    paidActivity:
      plan.paidActivityId === null || plan.paidActivityName === null
        ? null
        : { id: plan.paidActivityId, name: plan.paidActivityName },
    participantSource: state.eligible.source,
    participantCount: state.eligible.ids.size,
    canManage: manager,
    staff: (staff.get(planId) ?? []).map((row) => ({
      membershipId: row.membershipId,
      name: row.name,
      role: row.role,
    })),
    groups,
    unassigned: unassigned.map(student).sort(byName).slice(0, CANDIDATES_MAX),
    unassignedTotal: unassigned.length,
  }
}

export function getTripDayFor(ctx: ServiceContext, planId: string) {
  return dayDetail(ctx.db, ctx, planId)
}

// --- Acil kart -----------------------------------------------------------------------------------

/**
 * Sağlık uyarısı (K-518): sağlık profili servisinden okunur (her okuma orada denetime yazılır); tam
 * düzeyde alerji, kronik durum ve ilaç sayısı, acil düzeyde yalnız alerji ve acil talimat. Okuyanın
 * profil erişimi yoksa (403/404) profil `null` kalır; beklenmeyen hata uyarı loguyla aynı sonuca
 * düşer ki acil kart açılabilsin.
 */
async function healthProfileOf(ctx: ServiceContext, deps: HealthProfileDeps, studentId: string) {
  try {
    const view = await getHealthProfile(ctx, deps, studentId)
    if (view.level === 'full')
      return {
        allergies: view.profile.allergies.length,
        chronicConditions: view.profile.chronicConditions.length,
        medications: view.profile.medications.length,
        emergencyInstructions: view.profile.emergencyInstructions,
      }
    return {
      allergies: view.profile.allergies.length,
      chronicConditions: null,
      medications: null,
      emergencyInstructions: view.profile.emergencyInstructions,
    }
  } catch (error) {
    if (error instanceof AppError && (error.statusCode === 403 || error.statusCode === 404)) {
      ctx.log.info({ event: 'finance.trip_day.health_not_readable', code: error.code })
      return null
    }
    ctx.log.warn({ event: 'finance.trip_day.health_unavailable', err: error })
    return null
  }
}

/**
 * Grubun acil kartı (K-518): öğrenci, sınıf, acil iletişim (K-501; telefon `office` amacında
 * maskeli, `emergency` amacında tam) ve en az bilgiyle sağlık uyarısı. Yönetici ve grubun sorumlusu
 * açar; her açılış amacıyla denetime yazılır (değer, öğrenci kimliği ve telefon yazılmaz).
 */
export async function getTripDayCardFor(
  ctx: ServiceContext,
  deps: HealthProfileDeps,
  planId: string,
  groupId: string,
  purpose: TripDayCardPurpose,
) {
  const state = await loadDay(ctx.db, ctx, planId)
  const { group, access } = groupScope(state, ctx, groupId)
  const tripDay = isTripDay(state.plan, ctx.now)
  try {
    assertTripDayCardPurpose(ctx.actor, access, purpose, tripDay)
  } catch (error) {
    throw mapOperationError(error)
  }
  const studentIds = groupMembers(state, group.id)
  // "Bugün ilaç var" işaretinin günü: gezi sürüyorsa bugün, gezi öncesi açılışta çıkış günü.
  const { from } = tripDayRange(state.plan)
  const today = dayKey(ctx.now)
  const cardDay = today < from ? from : today
  const [{ students, classNames }, links, consents] = await Promise.all([
    studentFacts(ctx.db, ctx, studentIds),
    loadGuardianAccounts(ctx.db, ctx.institutionId, studentIds),
    listApprovedConsentsOn(ctx.db, ctx.institutionId, cardDay),
  ])
  const parentIds = [
    ...links.flatMap((link) => (link.parentId === null ? [] : [link.parentId])),
    ...[...students.values()].flatMap((s) => (s.parentId === null ? [] : [s.parentId])),
  ]
  const [parentRows, accounts] = await Promise.all([
    loadRecordsByIds(ctx.db, ctx.institutionId, 'parents', [...new Set(parentIds)]),
    memberNames(
      ctx.db,
      ctx.institutionId,
      links.flatMap((link) => (link.membershipId === null ? [] : [link.membershipId])),
    ),
  ])
  const parents = new Map<string, RosterParentRecord>(
    parentRows.map((row) => [
      row.id,
      {
        id: row.id,
        name: text(row.data.name),
        phone: text(row.data.phone),
        relationship: text(row.data.relationship),
      },
    ]),
  )
  const medication = new Set(consents.map((consent) => consent.studentId))
  const rows: {
    studentId: string
    studentName: string
    className: string | null
    contacts: ReturnType<typeof transportRosterContacts>
    health: TripDayHealthAlert
  }[] = []
  // Sağlık profili okuması öğrenci başına sıralıdır: her okuma kendi denetim satırını yazar.
  for (const studentId of studentIds) {
    const facts = students.get(studentId)
    const profile = await healthProfileOf(ctx, deps, studentId)
    rows.push({
      studentId,
      studentName: facts?.name ?? '—',
      className:
        facts === undefined || facts.classId === null
          ? null
          : (classNames.get(facts.classId) ?? null),
      contacts: transportRosterContacts({
        links: links.filter((link) => link.studentId === studentId),
        memberNames: accounts,
        parents,
        studentParentId: facts?.parentId ?? null,
        purpose: purpose === 'emergency' ? 'driver' : 'office',
      }),
      health: tripDayHealthAlert({ profile, medicationToday: medication.has(studentId) }),
    })
  }
  rows.sort((a, b) => a.studentName.localeCompare(b.studentName, 'tr'))
  const action = CARD_ACTIONS[purpose]
  await ctx.db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action,
    entityType: GROUP,
    entityId: group.id,
    // kvkk: değer yazılmaz; alan adları ve satır sayısı, amaç eylem adındadır (K-518).
    changes: {
      fields: [...CARD_FIELDS],
      counts: { students: rows.length, alerts: rows.filter((row) => row.health.alert).length },
    },
    createdAt: ctx.now,
  })
  ctx.log.info({ event: action, groupId: group.id, count: rows.length })
  return {
    plan: {
      id: state.plan.id,
      number: tripPlanNumber(state.plan.sequence),
      name: state.plan.name,
      departureAt: state.plan.departureAt,
      returnAt: state.plan.returnAt,
      emergencyContacts: state.plan.emergencyContacts,
    },
    group: {
      id: group.id,
      name: group.name,
      vehiclePlate: group.vehiclePlate,
      leaderName: group.leaderName,
    },
    purpose,
    phonesMasked: purpose !== 'emergency',
    cardDay,
    total: rows.length,
    students: rows,
  }
}

// --- Veli ve öğrenci -----------------------------------------------------------------------------

/**
 * Veli ve öğrenci görünümü (K-519): kapsamdaki öğrencilerin (veli için bağlı çocuklar) bugün süren
 * gezilerinde (çıkış–dönüş günleri, Europe/Istanbul) son kapanan kontrol noktası ve işareti. Tur
 * henüz kapanmadıysa kontrol noktası boştur. Gerekçe ve diğer öğrenciler dönmez; bildirim yoktur.
 */
export async function listMyTripDaysFor(ctx: ServiceContext) {
  const scope = await readScope(ctx)
  const studentIds = [...scope.studentIds]
  if (studentIds.length === 0) return []
  const [memberships, marks] = await Promise.all([
    loadStudentTripDayGroups(ctx.db, ctx.institutionId, studentIds),
    loadStudentTripDayMarks(ctx.db, ctx.institutionId, studentIds),
  ])
  const current = (row: { departureAt: Date; returnAt: Date }) =>
    isTripDay(
      { departureAt: row.departureAt.toISOString(), returnAt: row.returnAt.toISOString() },
      ctx.now,
    )
  const rows = new Map<
    string,
    {
      studentId: string
      planId: string
      planName: string
      departureAt: Date
      returnAt: Date
      groupName: string
      leaderMembershipId: string
      last: (typeof marks)[number] | null
    }
  >()
  for (const row of memberships.filter(current))
    rows.set(`${row.studentId}:${row.planId}`, { ...row, last: null })
  // İşaretler kapanış sırasıyla gelir: sonuncusu kalır; öğrenci sonradan gruptan çıkmış olsa da görünür.
  for (const mark of marks.filter(current)) {
    const key = `${mark.studentId}:${mark.planId}`
    const existing = rows.get(key)
    rows.set(key, {
      studentId: mark.studentId,
      planId: mark.planId,
      planName: mark.planName,
      departureAt: mark.departureAt,
      returnAt: mark.returnAt,
      groupName: existing?.groupName ?? mark.groupName,
      leaderMembershipId: existing?.leaderMembershipId ?? mark.leaderMembershipId,
      last: mark,
    })
  }
  const list = [...rows.values()]
  const [{ students }, leaders] = await Promise.all([
    studentFacts(
      ctx.db,
      ctx,
      list.map((row) => row.studentId),
    ),
    memberNames(
      ctx.db,
      ctx.institutionId,
      list.map((row) => row.leaderMembershipId),
    ),
  ])
  return list
    .map((row) => ({
      studentId: row.studentId,
      studentName: students.get(row.studentId)?.name ?? '—',
      planId: row.planId,
      planName: row.planName,
      departureAt: row.departureAt.toISOString(),
      returnAt: row.returnAt.toISOString(),
      groupName: row.groupName,
      leaderName: leaders.get(row.leaderMembershipId) ?? null,
      checkpoint: row.last?.checkpoint ?? null,
      checkedAt: row.last === null ? null : row.last.closedAt.toISOString(),
      status: row.last?.status ?? null,
    }))
    .sort(
      (a, b) =>
        a.studentName.localeCompare(b.studentName, 'tr') ||
        a.departureAt.localeCompare(b.departureAt),
    )
}

// --- Grup ve dağıtım -----------------------------------------------------------------------------

const respondWith = (statusCode: number, body: () => unknown) => () => ({
  statusCode,
  body: body(),
})

/** Grup açma (K-517). `Idempotency-Key` zorunlu; 201 ve gezi günü görünümü. */
export function createTripDayGroupCommand(
  ctx: ServiceContext,
  planId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: GROUP, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.trip_day.group_create',
      collections: [],
      entity,
      load: async (tx) => {
        const fields = tripDayGroupSchema.parse(input)
        const plan = await findTripPlan(tx, ctx.institutionId, planId)
        if (plan === null) throw new NotFoundError()
        const [groups, staff] = await Promise.all([
          loadTripDayGroups(tx, ctx.institutionId, planId),
          loadTripPlanStaff(tx, ctx.institutionId, [planId]),
        ])
        return {
          run: () => {
            planTripDayGroup(
              fields,
              {
                role: ctx.actor.role,
                planStatus: plan.status,
                staffMembershipIds: (staff.get(planId) ?? []).map((row) => row.membershipId),
                otherGroupNames: groups.map((group) => group.name),
                groupCount: groups.length,
              },
              'create',
            )
            return fields
          },
        }
      },
      after: async (tx, fields) => {
        await insertTripDayGroup(tx, ctx.institutionId, {
          id,
          planId,
          ...fields,
          position: await nextTripDayGroupPosition(tx, ctx.institutionId, planId),
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.trip_day.group_create', entity, [
          'planId',
          'name',
          'vehiclePlate',
          'leaderMembershipId',
        ])
        body = { data: await dayDetail(tx, ctx, planId) }
      },
    },
    respondWith(201, () => body),
    idempotency,
  )
}

/** Grup düzeltme (K-517): `If-Match` grubun sürümüdür. */
export function updateTripDayGroupCommand(
  ctx: ServiceContext,
  planId: string,
  groupId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: GROUP, id: groupId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.trip_day.group_update',
      collections: [],
      entity,
      load: async (tx) => {
        const changes = tripDayGroupUpdateSchema.parse(input)
        const plan = await findTripPlan(tx, ctx.institutionId, planId)
        if (plan === null) throw new NotFoundError()
        const group = await findTripDayGroup(tx, ctx.institutionId, planId, groupId)
        if (group === null) throw new NotFoundError()
        if (group.version !== expectedVersion) throw new ConflictError()
        const [groups, staff, checks] = await Promise.all([
          loadTripDayGroups(tx, ctx.institutionId, planId),
          loadTripPlanStaff(tx, ctx.institutionId, [planId]),
          loadTripDayChecks(tx, ctx.institutionId, planId, [groupId]),
        ])
        const changed = Object.entries(changes)
          .filter(
            ([key, value]) => value !== undefined && group[key as keyof typeof changes] !== value,
          )
          .map(([key]) => key)
        return {
          run: () => {
            planTripDayGroup(
              {
                name: changed.includes('name') ? changes.name : undefined,
                leaderMembershipId: changed.includes('leaderMembershipId')
                  ? changes.leaderMembershipId
                  : undefined,
              },
              {
                role: ctx.actor.role,
                planStatus: plan.status,
                staffMembershipIds: (staff.get(planId) ?? []).map((row) => row.membershipId),
                otherGroupNames: groups.filter((row) => row.id !== groupId).map((row) => row.name),
                groupCount: groups.length,
                hasOpenCheck: checks.some((check) => check.status === 'open'),
              },
              'update',
            )
            return { changes, changed }
          },
        }
      },
      after: async (tx, { changes, changed }) => {
        if (changed.length > 0) {
          const saved = await updateTripDayGroup(tx, ctx.institutionId, {
            id: groupId,
            expectedVersion,
            changes: Object.fromEntries(
              Object.entries(changes).filter(([key]) => changed.includes(key)),
            ),
            now: ctx.now,
          })
          if (!saved) throw new ConflictError()
          await auditWork(tx, ctx, 'finance.trip_day.group_update', entity, changed)
        }
        body = { data: await dayDetail(tx, ctx, planId) }
      },
    },
    respondWith(200, () => body),
    idempotency,
  )
}

/** Grup arşivleme (K-517): turu açılmış grup arşivlenmez; öğrencileri grupsuz kalır. */
export function archiveTripDayGroupCommand(
  ctx: ServiceContext,
  planId: string,
  groupId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: GROUP, id: groupId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.trip_day.group_archive',
      collections: [],
      entity,
      load: async (tx) => {
        const plan = await findTripPlan(tx, ctx.institutionId, planId)
        if (plan === null) throw new NotFoundError()
        const group = await findTripDayGroup(tx, ctx.institutionId, planId, groupId)
        if (group === null) throw new NotFoundError()
        if (group.version !== expectedVersion) throw new ConflictError()
        const checks = await loadTripDayChecks(tx, ctx.institutionId, planId, [groupId])
        return {
          run: () =>
            planTripDayGroupArchive({
              role: ctx.actor.role,
              planStatus: plan.status,
              checkCount: checks.length,
            }),
        }
      },
      after: async (tx) => {
        const saved = await archiveTripDayGroup(tx, ctx.institutionId, {
          id: groupId,
          expectedVersion,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.trip_day.group_archive', entity, ['archivedAt'])
        body = { data: await dayDetail(tx, ctx, planId) }
      },
    },
    respondWith(200, () => body),
    idempotency,
  )
}

/** Dağıtım (K-517): öğrencileri gruba ekler, taşır ya da gruptan çıkarır. `Idempotency-Key` zorunlu. */
export function assignTripDayCommand(
  ctx: ServiceContext,
  planId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: 'trip_plans', id: planId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.trip_day.assign',
      collections: [],
      entity,
      load: async (tx) => {
        const fields = tripDayAssignSchema.parse(input)
        const state = await loadDay(tx, ctx, planId)
        const openGroups = new Set(
          state.checks.filter((check) => check.status === 'open').map((check) => check.groupId),
        )
        return {
          run: () => ({
            groupId: fields.groupId,
            plan: planTripDayAssign(fields, {
              role: ctx.actor.role,
              planStatus: state.plan.status,
              targetExists: state.groups.some((group) => group.id === fields.groupId),
              eligible: state.eligible.ids,
              currentGroup: new Map(state.members.map((row) => [row.studentId, row.groupId])),
              openGroups,
            }),
          }),
        }
      },
      after: async (tx, { groupId, plan }) => {
        if (groupId !== null) {
          await insertTripDayMembers(tx, ctx.institutionId, {
            planId,
            groupId,
            studentIds: plan.add,
            now: ctx.now,
            ids: randomUUID,
          })
          await moveTripDayMembers(tx, ctx.institutionId, {
            planId,
            groupId,
            studentIds: plan.move,
            now: ctx.now,
          })
        }
        await archiveTripDayMembers(tx, ctx.institutionId, {
          planId,
          studentIds: plan.remove,
          now: ctx.now,
        })
        if (plan.add.length + plan.move.length + plan.remove.length > 0)
          await auditWork(tx, ctx, 'finance.trip_day.assign', entity, ['groupId', 'studentIds'])
        body = { data: await dayDetail(tx, ctx, planId) }
      },
    },
    respondWith(200, () => body),
    idempotency,
  )
}

// --- Yoklama turu --------------------------------------------------------------------------------

/** Tur açma (K-517): sorumlu ya da yönetici, gezi günü; `Idempotency-Key` zorunlu; 201. */
export function startTripDayCheckCommand(
  ctx: ServiceContext,
  planId: string,
  groupId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: CHECK, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.trip_day.check_start',
      collections: [],
      entity,
      load: async (tx) => {
        const fields = tripDayCheckStartSchema.parse(input)
        const state = await loadDay(tx, ctx, planId)
        const { access } = groupScope(state, ctx, groupId)
        const checks = state.checks.filter((check) => check.groupId === groupId)
        return {
          run: () => {
            planTripDayCheckStart({
              access,
              planStatus: state.plan.status,
              tripDay: isTripDay(state.plan, ctx.now),
              memberCount: groupMembers(state, groupId).length,
              hasOpenCheck: checks.some((check) => check.status === 'open'),
              checkCount: checks.length,
            })
            return {
              checkpoint: fields.checkpoint,
              sequence: Math.max(0, ...checks.map((check) => check.sequence)) + 1,
            }
          },
        }
      },
      after: async (tx, values) => {
        await insertTripDayCheck(tx, ctx.institutionId, {
          id,
          planId,
          groupId,
          ...values,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.trip_day.check_start', entity, [
          'groupId',
          'checkpoint',
          'sequence',
        ])
        body = { data: await dayDetail(tx, ctx, planId) }
      },
    },
    respondWith(201, () => body),
    idempotency,
  )
}

interface LoadedCheck {
  state: DayState
  check: StoredTripDayCheck
  access: TripDayGroupAccess
  roster: RosterEntry[]
}

async function checkScope(tx: Database, ctx: ServiceContext, planId: string, checkId: string) {
  const state = await loadDay(tx, ctx, planId)
  const check = await findTripDayCheck(tx, ctx.institutionId, planId, checkId)
  if (check === null) throw new NotFoundError()
  const { access } = groupScope(state, ctx, check.groupId)
  return { state, check, access, roster: rosterOf(state, check) } satisfies LoadedCheck
}

/**
 * Tur işaretleri (K-517): `If-Match` yoktur; çevrimdışı kuyruktaki ardışık işaretler kurum kilidi
 * altında sırayla uygulanır, aynı işaretin yinelenmesi yazmaz. `Idempotency-Key` zorunlu.
 */
export function markTripDayCheckCommand(
  ctx: ServiceContext,
  planId: string,
  checkId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: CHECK, id: checkId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.trip_day.check_mark',
      collections: [],
      entity,
      load: async (tx) => {
        const fields = tripDayMarksSchema.parse(input)
        const { state, check, access, roster } = await checkScope(tx, ctx, planId, checkId)
        const own = state.marks.filter((mark) => mark.checkId === check.id)
        const current = new Map<string, TripDayMarkState>(
          own.map((mark) => [mark.studentId, { status: mark.status, markedAt: mark.markedAt }]),
        )
        return {
          run: () => ({
            writes: planTripDayMarks(fields, {
              access,
              status: check.status,
              roster: new Set(roster.map((entry) => entry.studentId)),
              current,
              now: ctx.now,
            }),
            stored: new Map(own.map((mark) => [mark.studentId, mark])),
          }),
        }
      },
      after: async (tx, { writes, stored }) => {
        for (const write of writes) {
          const existing = stored.get(write.studentId)
          if (existing === undefined)
            await insertTripDayMark(tx, ctx.institutionId, {
              id: randomUUID(),
              checkId,
              studentId: write.studentId,
              ...write.next,
              userId: ctx.actor.userId,
              now: ctx.now,
            })
          else {
            const saved = await updateTripDayMark(tx, ctx.institutionId, {
              id: existing.id,
              expectedVersion: existing.version,
              ...write.next,
              userId: ctx.actor.userId,
              now: ctx.now,
            })
            if (!saved) throw new ConflictError()
          }
        }
        if (writes.length > 0)
          await auditWork(tx, ctx, 'finance.trip_day.check_mark', entity, ['status', 'markedAt'])
        body = { data: await dayDetail(tx, ctx, planId) }
      },
    },
    respondWith(200, () => body),
    idempotency,
  )
}

/**
 * Turu bitirme (K-517): `complete` herkes "var" iken; `proceed` herkes işaretli, en az biri "yok"
 * iken gerekçeyle. `If-Match` turun sürümüdür.
 */
export function closeTripDayCheckCommand(
  ctx: ServiceContext,
  planId: string,
  checkId: string,
  mode: 'complete' | 'proceed',
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: CHECK, id: checkId }
  const action =
    mode === 'complete' ? 'finance.trip_day.check_complete' : 'finance.trip_day.check_proceed'
  let body: unknown
  return runCommand(
    ctx,
    {
      action,
      collections: [],
      entity,
      load: async (tx) => {
        const reason = mode === 'proceed' ? tripDayCheckProceedSchema.parse(input).reason : null
        if (mode === 'complete') tripDayCheckCompleteSchema.parse(input)
        const { check, access, roster } = await checkScope(tx, ctx, planId, checkId)
        if (check.version !== expectedVersion) throw new ConflictError()
        const statuses = roster.map((entry) => entry.status)
        return {
          run: () => {
            if (mode === 'complete') {
              planTripDayCheckComplete({ access, status: check.status, roster: statuses })
              return { reason: null, missing: 0 }
            }
            const counts = planTripDayCheckProceed({
              access,
              status: check.status,
              roster: statuses,
            })
            return { reason, missing: counts.absent }
          },
        }
      },
      after: async (tx, { reason, missing }) => {
        const saved = await closeTripDayCheck(tx, ctx.institutionId, {
          id: checkId,
          expectedVersion,
          status: mode === 'complete' ? 'complete' : 'incomplete',
          missingCount: missing,
          missingReason: reason,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          action,
          entity,
          mode === 'complete'
            ? ['status', 'closedAt']
            : ['status', 'closedAt', 'missingCount', 'missingReason'],
        )
        body = { data: await dayDetail(tx, ctx, planId) }
      },
    },
    respondWith(200, () => body),
    idempotency,
  )
}
