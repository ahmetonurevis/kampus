import { randomUUID } from 'node:crypto'

import {
  affectedLessons,
  LEAVE_REQUEST_LESSONS_MAX,
  leaveBalanceAfterRequest,
  leaveRequestApproveSchema,
  leaveRequestCancelSchema,
  leaveRequestCreateSchema,
  leaveRequestRejectSchema,
  leaveRequestSubstitutesSchema,
  lessonSnapshot,
  planLeaveRequest,
  planLeaveRequestApproval,
  planLeaveRequestCancel,
  planLeaveRequestRejection,
  planLeaveRequestSubstitutes,
  substituteWarnings,
  type LeaveRequestLesson,
  type LeaveRequestState,
  type LeaveTeacher,
  type ScheduleLesson,
} from '@kampus/school-core/lib/finance-leave-requests.ts'
import {
  effectiveLeaveTypes,
  type LeavePeriod,
} from '@kampus/school-core/lib/finance-staff-leave.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { isStaffRole } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from '../db/client.ts'
import {
  findLeaveRequest,
  findRecordOfRequest,
  insertLeaveRequest,
  listLeaveRequests,
  loadActiveRecordPeriods,
  loadOpenLeaveRequests,
  loadRequestLessons,
  loadScheduleLessons,
  loadTeachers,
  teacherLinks,
  updateLeaveRequest,
  updateRequestLessons,
  type LeaveRequestQuery,
  type StoredLeaveRequest,
} from '../db/finance-leave-requests.ts'
import { findStaffMember } from '../db/finance-pay-rates.ts'
import { lockedPayrollMonths } from '../db/finance-payroll-periods.ts'
import {
  cancelLeaveRecord,
  deactivationTimes,
  findLeaveProfile,
  insertLeaveRecord,
  loadLeaveRecords,
  loadStoredLeaveTypes,
} from '../db/finance-staff-leave.ts'
import { loadRecords } from '../db/records.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { dayRange } from './list-filters.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * İzin talebi ve onayı (DOM-FIN-116; ON-182; K-397…K-399). Kural core
 * `lib/finance-leave-requests.ts`'tedir; servis kurum kilidi altında yükler ve aynı transaction'da
 * yazar. Onay kullanılmış izin kaydını (`staff_leave_records.request_id`) üretir; onaylı talebin
 * iptali kaydı da iptal eder. Ders programı ve öğretmen kayıtları yalnız okunur (ders bağı ders
 * programına yazılmaz). Denetim kaydına alan adları yazılır; açıklama ve gerekçe değeri yazılmaz.
 * Rol ve modül denetimi rotadadır (yalnız yönetici).
 */

const ENTITY = 'staff_leave_requests'
const RECORD_ENTITY = 'staff_leave_records'

/** Personel üyeliği: yoksa ya da personel değilse (öğrenci, veli) 404. */
async function staffOf(db: Database, ctx: ServiceContext, membershipId: string) {
  const member = await findStaffMember(db, ctx.institutionId, membershipId)
  if (member === null || !isStaffRole(member.role)) throw new NotFoundError()
  return member
}

/** Personelin bağlı öğretmen kaydı (ilk bağ); öğretmen değilse `null`. */
async function ownTeacherOf(db: Database, ctx: ServiceContext, membershipId: string) {
  const [link] = await teacherLinks(db, ctx.institutionId, [membershipId])
  return link?.teacherId ?? null
}

const scheduleIn = (db: Database, ctx: ServiceContext, period: LeavePeriod) => {
  const range = dayRange('date', period.startDate, period.endDate)
  return range === null ? Promise.resolve([]) : loadScheduleLessons(db, ctx.institutionId, range)
}

/** Ders görünümü için ortak veri: aralıktaki ders programı, öğretmenler, izinler ve sınıf adları. */
async function lessonContext(db: Database, ctx: ServiceContext, period: LeavePeriod) {
  const [schedule, teachers, links, classes] = await Promise.all([
    scheduleIn(db, ctx, period),
    loadTeachers(db, ctx.institutionId),
    teacherLinks(db, ctx.institutionId),
    loadRecords(db, ctx.institutionId, ['classes']),
  ])
  const memberIds = links.map((link) => link.membershipId)
  const [requests, records] = await Promise.all([
    loadOpenLeaveRequests(db, ctx.institutionId, memberIds, period),
    loadActiveRecordPeriods(db, ctx.institutionId, memberIds, period),
  ])
  const absences = new Map<string, LeavePeriod[]>()
  for (const link of links)
    for (const item of [...requests, ...records])
      if (item.membershipId === link.membershipId)
        absences.set(link.teacherId, [
          ...(absences.get(link.teacherId) ?? []),
          { startDate: item.startDate, endDate: item.endDate },
        ])
  const classNames = new Map(
    classes.map((row) => [row.id, typeof row.data.name === 'string' ? row.data.name : null]),
  )
  return { schedule, teachers, absences, classNames }
}
type LessonContext = Awaited<ReturnType<typeof lessonContext>>

/**
 * Ders görünümü: sınıf adı, seçilen yedeğin adı ve uyarıları, yedek adaylarının uyarıları
 * (yalnız uyarısı olan etkin öğretmenler; izne çıkan öğretmen aday değildir).
 */
function lessonViews(
  lessons: readonly LeaveRequestLesson[],
  context: LessonContext,
  ownTeacherId: string | null,
) {
  const teacherOf = new Map(context.teachers.map((teacher) => [teacher.id, teacher]))
  const candidates = context.teachers.filter(
    (teacher) => teacher.isActive && teacher.id !== ownTeacherId,
  )
  const warn = (lesson: LeaveRequestLesson, teacher: LeaveTeacher) =>
    substituteWarnings(lesson, teacher, context.schedule, context.absences)
  return lessons.map((lesson) => {
    const substitute =
      lesson.substituteTeacherId === null ? undefined : teacherOf.get(lesson.substituteTeacherId)
    return {
      ...lesson,
      className: context.classNames.get(lesson.classId) ?? null,
      substituteName: substitute?.name ?? null,
      substituteWarnings: substitute === undefined ? [] : warn(lesson, substitute),
      candidateWarnings: candidates.flatMap((teacher) => {
        const warnings = warn(lesson, teacher)
        return warnings.length === 0 ? [] : [{ teacherId: teacher.id, warnings }]
      }),
    }
  })
}

const teacherOptions = (teachers: readonly LeaveTeacher[], ownTeacherId: string | null) =>
  teachers
    .filter((teacher) => teacher.isActive && teacher.id !== ownTeacherId)
    .map(({ id, name, subjectId }) => ({ id, name, subjectId }))

const endDayOf = (ends: Map<string, Date>, membershipId: string) => {
  const end = ends.get(membershipId)
  return end === undefined ? null : dayKey(end)
}

// --- Okuma ---------------------------------------------------------------------------------------

export async function listLeaveRequestsFor(ctx: ServiceContext, query: LeaveRequestQuery) {
  return listLeaveRequests(ctx.db, ctx.institutionId, query)
}

/**
 * Talep, dersleri (seçilen yedek ve uyarılar), yedek adayları ve bekleyen talepte onay sonrası
 * kalacak yıllık izin.
 */
export async function getLeaveRequestFor(ctx: ServiceContext, id: string) {
  return ctx.db.transaction(async (tx) => {
    const request = await findLeaveRequest(tx, ctx.institutionId, id)
    if (request === null) throw new NotFoundError()
    return requestDetail(tx, ctx, request)
  })
}

async function requestDetail(tx: Database, ctx: ServiceContext, request: StoredLeaveRequest) {
  const [lessons, ownTeacherId, context, profile, records, ends] = await Promise.all([
    loadRequestLessons(tx, ctx.institutionId, request.id),
    ownTeacherOf(tx, ctx, request.membershipId),
    lessonContext(tx, ctx, request),
    findLeaveProfile(tx, ctx.institutionId, request.membershipId),
    loadLeaveRecords(tx, ctx.institutionId, [request.membershipId]),
    deactivationTimes(tx, ctx.institutionId, [request.membershipId]),
  ])
  return {
    ...request,
    balanceAfterDays:
      request.status === 'pending'
        ? leaveBalanceAfterRequest(request, profile, records, endDayOf(ends, request.membershipId))
        : null,
    ownTeacherId,
    lessons: lessonViews(lessons, context, ownTeacherId),
    teachers: teacherOptions(context.teachers, ownTeacherId),
  }
}

/**
 * Talep önizlemesi (formda): aralıktaki etkilenen dersler (en çok 200), yedek adayları ve uyarılar;
 * tür ve gün verilirse talep sonrası kalan yıllık izin. Yalnız okur.
 */
export async function previewLeaveRequestFor(
  ctx: ServiceContext,
  query: LeavePeriod & {
    membershipId: string
    typeCode?: string | undefined
    days?: number | undefined
  },
) {
  return ctx.db.transaction(async (tx) => {
    await staffOf(tx, ctx, query.membershipId)
    const [ownTeacherId, context, types, profile, records, ends] = await Promise.all([
      ownTeacherOf(tx, ctx, query.membershipId),
      lessonContext(tx, ctx, query),
      loadStoredLeaveTypes(tx, ctx.institutionId),
      findLeaveProfile(tx, ctx.institutionId, query.membershipId),
      loadLeaveRecords(tx, ctx.institutionId, [query.membershipId]),
      deactivationTimes(tx, ctx.institutionId, [query.membershipId]),
    ])
    const affected =
      ownTeacherId === null ? [] : affectedLessons(context.schedule, ownTeacherId, query)
    const type = effectiveLeaveTypes(types).find((item) => item.code === query.typeCode)
    return {
      membershipId: query.membershipId,
      startDate: query.startDate,
      endDate: query.endDate,
      ownTeacherId,
      lessonCount: affected.length,
      lessonLimit: LEAVE_REQUEST_LESSONS_MAX,
      lessons: lessonViews(
        affected.slice(0, LEAVE_REQUEST_LESSONS_MAX).map((item) => lessonSnapshot(item, null)),
        context,
        ownTeacherId,
      ),
      teachers: teacherOptions(context.teachers, ownTeacherId),
      deductsFromAnnual: type?.deductsFromAnnual ?? null,
      balanceAfterDays:
        type === undefined || query.days === undefined
          ? null
          : leaveBalanceAfterRequest(
              { ...query, days: query.days, deductsFromAnnual: type.deductsFromAnnual },
              profile,
              records,
              endDayOf(ends, query.membershipId),
            ),
    }
  })
}

async function detailBody(tx: Database, ctx: ServiceContext, id: string) {
  const request = await findLeaveRequest(tx, ctx.institutionId, id)
  if (request === null) throw new NotFoundError()
  return { data: await requestDetail(tx, ctx, request) }
}

/** Talebi yükler; yok ya da başka kurumun 404, sürüm tutmazsa 409. */
async function loadRequest(tx: Database, ctx: ServiceContext, id: string, version: number) {
  const request = await findLeaveRequest(tx, ctx.institutionId, id)
  if (request === null) throw new NotFoundError()
  if (request.version !== version) throw new ConflictError()
  return request
}

const stateOf = (request: StoredLeaveRequest): LeaveRequestState => ({
  id: request.id,
  membershipId: request.membershipId,
  typeCode: request.typeCode,
  startDate: request.startDate,
  endDate: request.endDate,
  days: request.days,
  description: request.description,
  status: request.status,
})

// --- Yazma ---------------------------------------------------------------------------------------

/** İzin talebi (K-397…K-399). `Idempotency-Key` zorunlu. 201. */
export function createLeaveRequestCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_leave_request.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = leaveRequestCreateSchema.parse(input)
        const membershipId = parsed.membershipId
        const [staff, stored, profile, records, requests, ownTeacherId, ends] = await Promise.all([
          findStaffMember(tx, ctx.institutionId, membershipId),
          loadStoredLeaveTypes(tx, ctx.institutionId),
          findLeaveProfile(tx, ctx.institutionId, membershipId),
          loadLeaveRecords(tx, ctx.institutionId, [membershipId]),
          loadOpenLeaveRequests(tx, ctx.institutionId, [membershipId]),
          ownTeacherOf(tx, ctx, membershipId),
          deactivationTimes(tx, ctx.institutionId, [membershipId]),
        ])
        const type = effectiveLeaveTypes(stored).find((item) => item.code === parsed.typeCode)
        let lessons: ScheduleLesson[] = []
        let teachers: LeaveTeacher[] = []
        if (ownTeacherId !== null) {
          const schedule = await scheduleIn(tx, ctx, parsed)
          lessons = affectedLessons(schedule, ownTeacherId, parsed)
        }
        if (parsed.substitutes.length > 0) teachers = await loadTeachers(tx, ctx.institutionId)
        return {
          run: () => ({
            parsed,
            plan: planLeaveRequest(parsed, {
              staff,
              type: type ?? null,
              profile,
              records,
              requests,
              lessons,
              teachers,
              ownTeacherId,
              employmentEndDate: endDayOf(ends, membershipId),
            }),
          }),
        }
      },
      after: async (tx, { parsed, plan }) => {
        await insertLeaveRequest(
          tx,
          ctx.institutionId,
          {
            id,
            membershipId: parsed.membershipId,
            typeCode: parsed.typeCode,
            kind: plan.snapshot.kind,
            typeLabel: plan.snapshot.typeLabel,
            deductsFromAnnual: plan.snapshot.deductsFromAnnual,
            startDate: parsed.startDate,
            endDate: parsed.endDate,
            days: parsed.days,
            description: parsed.description,
            requestedByUserId: ctx.actor.userId,
            now: ctx.now,
          },
          plan.lessons,
        )
        await auditWork(tx, ctx, 'finance.staff_leave_request.create', entity, [
          'membershipId',
          'typeCode',
          'startDate',
          'endDate',
          'days',
          ...(parsed.description === null ? [] : ['description']),
          ...(plan.lessons.length === 0 ? [] : ['lessons']),
          ...(parsed.substitutes.length === 0 ? [] : ['substitutes']),
        ])
        body = await detailBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/**
 * Onay (K-398): kullanılmış izin kaydını üretir. `If-Match` talep sürümü; `Idempotency-Key`
 * zorunlu (çift gönderim izni iki kez düşmez).
 */
export function approveLeaveRequestCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  const recordId = randomUUID()
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_leave_request.approve',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = leaveRequestApproveSchema.parse(input)
        const request = await loadRequest(tx, ctx, id, expectedVersion)
        const membershipId = request.membershipId
        const [staff, stored, profile, records, requests, locked, ends] = await Promise.all([
          findStaffMember(tx, ctx.institutionId, membershipId),
          loadStoredLeaveTypes(tx, ctx.institutionId),
          findLeaveProfile(tx, ctx.institutionId, membershipId),
          loadLeaveRecords(tx, ctx.institutionId, [membershipId]),
          loadOpenLeaveRequests(tx, ctx.institutionId, [membershipId]),
          lockedPayrollMonths(tx, ctx.institutionId),
          deactivationTimes(tx, ctx.institutionId, [membershipId]),
        ])
        const type = effectiveLeaveTypes(stored).find((item) => item.code === request.typeCode)
        return {
          run: () => ({
            request,
            parsed,
            plan: planLeaveRequestApproval(stateOf(request), parsed, {
              staff,
              type: type ?? null,
              profile,
              records,
              requests,
              lockedMonths: locked,
              employmentEndDate: endDayOf(ends, membershipId),
            }),
          }),
        }
      },
      after: async (tx, { request, parsed, plan }) => {
        const advance =
          parsed.allowAdvance && plan.balanceAfterDays !== null && plan.balanceAfterDays < 0
        const saved = await updateLeaveRequest(tx, ctx.institutionId, {
          id,
          expectedVersion,
          change: {
            status: 'approved',
            decidedAt: ctx.now,
            decidedByUserId: ctx.actor.userId,
            advanceApproved: advance,
          },
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await insertLeaveRecord(tx, ctx.institutionId, {
          id: recordId,
          membershipId: request.membershipId,
          typeCode: request.typeCode,
          ...plan.snapshot,
          startDate: request.startDate,
          endDate: request.endDate,
          days: request.days,
          note: null,
          requestId: id,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.staff_leave_request.approve', entity, [
          'status',
          'decidedAt',
          ...(advance ? ['advanceApproved'] : []),
        ])
        await auditWork(
          tx,
          ctx,
          'finance.staff_leave_record.create',
          { type: RECORD_ENTITY, id: recordId },
          ['membershipId', 'typeCode', 'startDate', 'endDate', 'days', 'requestId'],
        )
        body = await detailBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Ret (K-397): gerekçe zorunlu; `If-Match` talep sürümü. */
export function rejectLeaveRequestCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_leave_request.reject',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = leaveRequestRejectSchema.parse(input)
        const request = await loadRequest(tx, ctx, id, expectedVersion)
        return {
          run: () => {
            planLeaveRequestRejection(stateOf(request))
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        const saved = await updateLeaveRequest(tx, ctx.institutionId, {
          id,
          expectedVersion,
          change: {
            status: 'rejected',
            decidedAt: ctx.now,
            decidedByUserId: ctx.actor.userId,
            rejectReason: parsed.reason,
          },
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.staff_leave_request.reject', entity, [
          'status',
          'decidedAt',
          'rejectReason',
        ])
        body = await detailBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * İptal (K-397): bekleyen talep geri çekilir; onaylı talebin ürettiği kayıt da aynı gerekçeyle
 * iptal edilir. `If-Match` talep sürümü.
 */
export function cancelLeaveRequestCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_leave_request.cancel',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = leaveRequestCancelSchema.parse(input)
        const request = await loadRequest(tx, ctx, id, expectedVersion)
        const [locked, record] = await Promise.all([
          lockedPayrollMonths(tx, ctx.institutionId),
          findRecordOfRequest(tx, ctx.institutionId, id),
        ])
        return {
          run: () => ({
            parsed,
            record,
            plan: planLeaveRequestCancel(stateOf(request), locked),
          }),
        }
      },
      after: async (tx, { parsed, record, plan }) => {
        const saved = await updateLeaveRequest(tx, ctx.institutionId, {
          id,
          expectedVersion,
          change: {
            status: 'cancelled',
            cancelledAt: ctx.now,
            cancelledByUserId: ctx.actor.userId,
            cancelReason: parsed.reason,
          },
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.staff_leave_request.cancel', entity, [
          'status',
          'cancelledAt',
          'cancelReason',
        ])
        if (plan.cancelsRecord && record !== null) {
          const cancelled = await cancelLeaveRecord(tx, ctx.institutionId, {
            id: record.id,
            expectedVersion: record.version,
            reason: parsed.reason,
            userId: ctx.actor.userId,
            now: ctx.now,
          })
          if (!cancelled) throw new ConflictError()
          await auditWork(
            tx,
            ctx,
            'finance.staff_leave_record.cancel',
            { type: RECORD_ENTITY, id: record.id },
            ['archivedAt', 'cancelReason'],
          )
        }
        body = await detailBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Yedek öğretmen değişikliği (K-399): bekleyen ya da onaylı talepte; `If-Match` talep sürümü. */
export function updateLeaveRequestSubstitutesCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_leave_request.substitutes',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = leaveRequestSubstitutesSchema.parse(input)
        const request = await loadRequest(tx, ctx, id, expectedVersion)
        const [lessons, teachers, ownTeacherId] = await Promise.all([
          loadRequestLessons(tx, ctx.institutionId, id),
          loadTeachers(tx, ctx.institutionId),
          ownTeacherOf(tx, ctx, request.membershipId),
        ])
        return {
          run: () => ({
            lessons,
            next: planLeaveRequestSubstitutes(stateOf(request), lessons, parsed, {
              teachers,
              ownTeacherId,
            }),
          }),
        }
      },
      after: async (tx, { lessons, next }) => {
        const changed = next.filter(
          (lesson, index) => lesson.substituteTeacherId !== lessons[index]?.substituteTeacherId,
        )
        const saved = await updateLeaveRequest(tx, ctx.institutionId, {
          id,
          expectedVersion,
          change: {},
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await updateRequestLessons(tx, ctx.institutionId, id, changed, ctx.now)
        await auditWork(tx, ctx, 'finance.staff_leave_request.substitutes', entity, ['substitutes'])
        body = await detailBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
