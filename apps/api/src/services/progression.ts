import { randomUUID } from 'node:crypto'

import {
  evaluateProgression,
  planCourseAssessment,
  planProgressionDecision,
  planProgressionReview,
  progressionNextStep,
  type CourseAssessmentDraft,
  type CourseAssessmentRow,
  type CourseEnrollment,
  type ProgressionActor,
  type ProgressionDecisionDraft,
  type ProgressionDecisionRecord,
} from '@kampus/school-core/cefr/progression.ts'
import { canViewCefrProfile } from '@kampus/school-core/cefr/suggestion.ts'
import {
  coordinatesArea,
  coordinatorScopeOf,
  NO_COORDINATOR_SCOPE,
} from '@kampus/school-core/lib/coordinator-duties.ts'
import { canReadGroup } from '@kampus/school-core/lib/language-groups.ts'

import {
  findProgressionDecision,
  insertProgressionDecision,
  listProgressionDecisions,
  saveProgressionReview,
  type StoredProgressionDecision,
} from '../db/cefr.ts'
import type { Database } from '../db/client.ts'
import { activeDutiesOf, findInstitutionMembership } from '../db/coordinator-duties.ts'
import { loadCourses, type StoredCourse } from '../db/courses.ts'
import { loadGroups, type StoredGroup } from '../db/language-groups.ts'
import {
  findEnrollment,
  insertCourseAssessment,
  listCourseAssessments,
  listGroupEnrollments,
  listLessonHourAttendances,
  type StoredEnrollment,
} from '../db/progression.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { learnerSuggestion } from './cefr.ts'
import { getInstitution, listMembershipLinks } from './memberships.ts'
import { learnerMinor } from './notify.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Kur sonu değerlendirme ve geçiş kararı (OG-086; IST-062; docs/domain/dil-okulu.md DOM-DIL-013,
 * DOM-DIL-060, DOM-DIL-061, DOM-DIL-070; ADR 0004 karar 8). Kural core `cefr/progression.ts`'tedir;
 * burada kur kaydı, grup, kur ve kişi kapsamı yüklenir, iş tek transaction ve kurum kilidi altında
 * yazılır (`runCommand`). Uçlar yalnız dil okulundadır (rota).
 *
 * - Ölçme ve kararı yalnız grubun öğretmeni girer (core 403); grubu okuyamayan öğretmen için kayıt
 *   yoktur (404, varlık sızmaz).
 * - Onay ve ret akademik koordinatörün (kurun seviyesinde `academic_coordinator` görevi) işidir;
 *   kararı veren onaylayamaz, onayda koşullar güncel veriyle yeniden hesaplanır (core).
 * - Devam ders saati yoklamasındandır (`lesson_hour_attendances`). Yoklama alma ucu henüz yoktur
 *   (`TODO(cefr-ders-saati-yoklamasi)`, OG-269): satır yoksa devam belli değildir ve karar 409
 *   `attendance_pending` olur.
 * - Öğrenci ve veli yalnız onaylı kararları görür; gerekçe, karar veren ve inceleyen gösterilmez.
 *   Veli yalnız 18 yaş altı çocuğunun kararını görür.
 */

// TODO(cefr-kur-ayari): Kurum kur geçme eşiği ayarı (`progressionSettingsSchema`) saklanmıyor;
// core varsayılanı (kur sonu 60, devam binde 800) kullanılır.

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const assessmentEntity = (id: string) => ({ type: 'course_assessment', id })
const decisionEntity = (id: string) => ({ type: 'progression_decision', id })

/** Kur kaydının bağlamı: grup, kur, core `CourseEnrollment` ve kişinin rolü. */
export type EnrollmentContext = {
  stored: StoredEnrollment
  group: StoredGroup
  course: StoredCourse
  nextCourse: StoredCourse | null
  enrollment: CourseEnrollment
  actor: ProgressionActor
}

export async function languageSchool(db: Database, ctx: ServiceContext) {
  const institution = await getInstitution(db, ctx.institutionId)
  if (institution === null) throw new NotFoundError()
  return institution.type
}

export async function coordinationOf(db: Database, ctx: ServiceContext) {
  if (ctx.actor.role !== 'ogretmen') return NO_COORDINATOR_SCOPE
  const duties = await activeDutiesOf(db, ctx.institutionId, ctx.actor.membershipId)
  return duties.length === 0 ? NO_COORDINATOR_SCOPE : coordinatorScopeOf(duties)
}

/**
 * Grubun bağlamı; grup ya da kuru yoksa veya personel grubu okuyamıyorsa (core `canReadGroup`:
 * yönetici her grubu, öğretmen kendi grubunu ya da koordinatörü olduğu seviyenin grubunu) 404.
 */
export async function groupContext(db: Database, ctx: ServiceContext, groupId: string) {
  const [groups, courses, coordination] = await Promise.all([
    loadGroups(db, ctx.institutionId),
    loadCourses(db, ctx.institutionId),
    coordinationOf(db, ctx),
  ])
  const group = groups.find((item) => item.id === groupId)
  const course = courses.find((item) => item.id === group?.courseId)
  if (group === undefined || course === undefined) throw new NotFoundError()
  const reader = {
    role: ctx.actor.role,
    membershipId: ctx.actor.membershipId,
    coordination,
    studentIds: [] as string[],
  }
  if (!canReadGroup(reader, group, course, [])) throw new NotFoundError()
  const nextCourse =
    course.nextCourseId === null
      ? null
      : (courses.find((item) => item.id === course.nextCourseId) ?? null)
  const teacher =
    group.teacherMembershipId === null
      ? null
      : await findInstitutionMembership(db, ctx.institutionId, group.teacherMembershipId)
  const actor: ProgressionActor = {
    userId: ctx.actor.userId,
    role: ctx.actor.role,
    coordinator: coordinatesArea(coordination, { subjectId: null, cefrLevel: course.level }),
  }
  return {
    group,
    course,
    nextCourse,
    teacherUserIds: teacher === null ? [] : [teacher.userId],
    actor,
  }
}

function toCourseEnrollment(
  stored: StoredEnrollment,
  course: StoredCourse,
  teacherUserIds: readonly string[],
): CourseEnrollment {
  return {
    id: stored.id,
    learnerId: stored.studentId,
    courseId: course.id,
    level: course.level,
    totalHours: course.totalHours,
    teacherUserIds,
  }
}

/** Kur kaydının bağlamı; kayıt yoksa, başka kurumunsa ya da kapsam dışıysa 404. */
export async function enrollmentContext(
  db: Database,
  ctx: ServiceContext,
  enrollmentId: string,
): Promise<EnrollmentContext> {
  const stored = UUID.test(enrollmentId)
    ? await findEnrollment(db, ctx.institutionId, enrollmentId)
    : null
  if (stored === null) throw new NotFoundError()
  const scope = await groupContext(db, ctx, stored.groupId)
  return {
    stored,
    group: scope.group,
    course: scope.course,
    nextCourse: scope.nextCourse,
    enrollment: toCourseEnrollment(stored, scope.course, scope.teacherUserIds),
    actor: scope.actor,
  }
}

/** Kaydın devam ve ölçme verisi (core `evaluateProgression` girdisi). */
async function evidenceOf(db: Database, ctx: ServiceContext, enrollmentId: string) {
  const [attendance, assessments] = await Promise.all([
    listLessonHourAttendances(db, ctx.institutionId, [enrollmentId]),
    listCourseAssessments(db, ctx.institutionId, [enrollmentId]),
  ])
  return { attendance: attendance.get(enrollmentId) ?? [], assessments }
}

// --- Görünüm ------------------------------------------------------------------------------

function assessmentView(row: CourseAssessmentRow) {
  return {
    id: row.id,
    enrollmentId: row.enrollmentId,
    point: row.point,
    score: row.score,
    skills: row.skills.map((s) => ({ skill: s.skill, score: s.score, feedback: s.feedback })),
    assessedAt: row.assessedAt,
    assessedByUserId: row.assessedByUserId,
  }
}

function nextOf(
  decisions: readonly ProgressionDecisionRecord[],
  course: StoredCourse,
  nextCourse: StoredCourse | null,
) {
  return progressionNextStep({ decisions, course, nextCourse })
}

/** Personel görünümü: karar, gerekçe, kişiler, dayanak ve karar anının genel seviye önerisi. */
function decisionView(decision: StoredProgressionDecision) {
  const overall = decision.evidenceSnapshot.overall
  return {
    id: decision.id,
    enrollmentId: decision.enrollmentId,
    groupId: decision.groupId,
    learnerId: decision.learnerId,
    courseId: decision.courseId,
    outcome: decision.outcome,
    status: decision.status,
    rationale: decision.rationale,
    correctsDecisionId: decision.correctsDecisionId,
    decidedByUserId: decision.decidedByUserId,
    decidedAt: decision.decidedAt,
    reviewedByUserId: decision.reviewedByUserId,
    reviewedAt: decision.reviewedAt,
    rejectionReason: decision.rejectionReason,
    basis: decision.basis,
    suggestedLevel: overall.status === 'suggested' ? overall.level : null,
    rowVersion: decision.rowVersion,
  }
}

/** Kursiyer ve veli görünümü: yalnız onaylı karar; gerekçe ve kişiler yok (Sabah kararı 35). */
function learnerDecisionView(decision: StoredProgressionDecision) {
  return {
    id: decision.id,
    courseId: decision.courseId,
    outcome: decision.outcome,
    correctsDecisionId: decision.correctsDecisionId,
    approvedAt: decision.reviewedAt ?? decision.decidedAt,
    basis: decision.basis,
  }
}

// --- Yazma --------------------------------------------------------------------------------

function respond(out: { body?: unknown }, statusCode: number) {
  return () => {
    if (out.body === undefined) throw new Error('progression command was not written')
    return { statusCode, body: out.body }
  }
}

/**
 * Kur içi ölçme sonucunu girer (DOM-DIL-013; core `planCourseAssessment`): yalnız grubun öğretmeni,
 * dört becerinin puanı ve geri bildirimiyle; nokta kayıt başına bir kez (409
 * `assessment_already_recorded`). Ölçme değişmez satırdır. Başarı 201.
 */
export function recordCourseAssessment(
  ctx: ServiceContext,
  input: { enrollmentId: string } & Record<string, unknown>,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  const id = randomUUID()
  return runCommand<{ draft: CourseAssessmentDraft; scope: EnrollmentContext }>(
    ctx,
    {
      action: 'course_assessment.record',
      collections: [],
      entity: assessmentEntity(id),
      load: async (tx) => {
        const institutionType = await languageSchool(tx, ctx)
        const scope = await enrollmentContext(tx, ctx, input.enrollmentId)
        const existing = await listCourseAssessments(tx, ctx.institutionId, [scope.stored.id])
        return {
          run: () => ({
            scope,
            draft: planCourseAssessment({
              institutionType,
              enrollment: scope.enrollment,
              existing,
              actor: scope.actor,
              input,
              now: ctx.now,
            }),
          }),
        }
      },
      after: async (tx, { draft, scope }) => {
        const row = await insertCourseAssessment(
          tx,
          ctx.institutionId,
          { ...draft, groupId: scope.group.id, learnerId: scope.stored.studentId },
          id,
        )
        await auditWork(tx, ctx, 'course_assessment.record', assessmentEntity(id), [
          'enrollmentId',
          'point',
          'score',
          'skills',
        ])
        out.body = { data: assessmentView(row) }
      },
    },
    respond(out, 201),
    idempotency,
  )
}

/**
 * Kur sonu kararını önerir (DOM-DIL-070, DOM-DIL-060; core `planProgressionDecision`): yalnız
 * grubun öğretmeni; koşulları sağlamayan sonuç 422, açık karar varken 409 `progression_pending`,
 * devam belli değilse 409 `attendance_pending`. Karar anının seviye önerisi kopyalanır. Başarı 201.
 */
export function proposeProgressionDecision(
  ctx: ServiceContext,
  input: { enrollmentId: string } & Record<string, unknown>,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  const id = randomUUID()
  return runCommand<{ draft: ProgressionDecisionDraft; scope: EnrollmentContext }>(
    ctx,
    {
      action: 'progression_decision.propose',
      collections: [],
      entity: decisionEntity(id),
      load: async (tx) => {
        const institutionType = await languageSchool(tx, ctx)
        const scope = await enrollmentContext(tx, ctx, input.enrollmentId)
        const [evidence, existingDecisions, { suggestion }] = await Promise.all([
          evidenceOf(tx, ctx, scope.stored.id),
          listProgressionDecisions(tx, ctx.institutionId, { enrollmentId: scope.stored.id }),
          learnerSuggestion(tx, ctx, scope.stored.studentId),
        ])
        return {
          run: () => ({
            scope,
            draft: planProgressionDecision({
              institutionType,
              enrollment: scope.enrollment,
              ...evidence,
              suggestion,
              existingDecisions,
              actor: scope.actor,
              input,
              now: ctx.now,
            }),
          }),
        }
      },
      after: async (tx, { draft, scope }) => {
        const saved = await insertProgressionDecision(
          tx,
          ctx.institutionId,
          { ...draft, groupId: scope.group.id },
          id,
        )
        await auditWork(tx, ctx, 'progression_decision.propose', decisionEntity(id), [
          'enrollmentId',
          'outcome',
          'rationale',
          'correctsDecisionId',
          'basis',
          'evidenceSnapshot',
        ])
        out.body = { data: { ...decisionView(saved), next: null } }
      },
    },
    respond(out, 201),
    idempotency,
  )
}

export type ProgressionReviewBody = { action: 'approve' } | { action: 'reject'; reason: string }

/**
 * Kararı onaylar ya da reddeder (DOM-DIL-070; core `planProgressionReview`). Yalnız kurun
 * seviyesinin akademik koordinatörü (403); kararı veren onaylayamaz (403
 * `progression_self_review`); sonuçlanmış karar 409 `progression_already_reviewed`. `If-Match`
 * kararın satır sürümüdür (tutmazsa 409, rol ve plan denetiminden sonra); eşzamanlı ikinci onay 409. Onaylı `passed`
 * kararında yanıt üst kur çıktısını (`next`, core `progressionNextStep`) taşır.
 */
export function reviewProgressionDecision(
  ctx: ServiceContext,
  command: { decisionId: string; expectedVersion: number; body: ProgressionReviewBody },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  const action = `progression_decision.${command.body.action}`
  return runCommand<{ reviewed: ProgressionDecisionRecord; scope: EnrollmentContext }>(
    ctx,
    {
      action,
      collections: [],
      entity: decisionEntity(command.decisionId),
      load: async (tx) => {
        const decision = UUID.test(command.decisionId)
          ? await findProgressionDecision(tx, ctx.institutionId, command.decisionId)
          : null
        if (decision === null) throw new NotFoundError()
        const institutionType = await languageSchool(tx, ctx)
        const scope = await enrollmentContext(tx, ctx, decision.enrollmentId)
        const evidence = await evidenceOf(tx, ctx, scope.stored.id)
        return {
          run: () => {
            const reviewed = planProgressionReview({
              institutionType,
              enrollment: scope.enrollment,
              ...evidence,
              decision,
              actor: scope.actor,
              input: { ...command.body, decisionId: decision.id },
              now: ctx.now,
            })
            // Sürüm denetimi rol/plan denetiminden sonra: yetkisiz çağıran 403 alır, 409 değil.
            if (decision.rowVersion !== command.expectedVersion) throw new ConflictError()
            return { scope, reviewed }
          },
        }
      },
      after: async (tx, { reviewed, scope }) => {
        const saved = await saveProgressionReview(
          tx,
          ctx.institutionId,
          command.decisionId,
          command.expectedVersion,
          reviewed,
          ctx.now,
        )
        if (saved === null) throw new ConflictError()
        await auditWork(tx, ctx, action, decisionEntity(saved.id), [
          'status',
          'reviewedByUserId',
          'reviewedAt',
          ...(command.body.action === 'reject' ? ['rejectionReason'] : []),
        ])
        const decisions = await listProgressionDecisions(tx, ctx.institutionId, {
          enrollmentId: scope.stored.id,
        })
        const next = nextOf(decisions, scope.course, scope.nextCourse)
        out.body = {
          data: { ...decisionView(saved), next: next?.decisionId === saved.id ? next : null },
        }
      },
    },
    respond(out, 200),
    idempotency,
  )
}

// --- Okuma --------------------------------------------------------------------------------

/**
 * Grubun kur sonu tablosu (IST-062): kursiyer başına devam özeti, ölçmeler, koşullar ve verilebilir
 * sonuçlar (core `evaluateProgression`, saklanmaz), kararlar ve üst kur çıktısı. Personel; grubu
 * okuyamayan öğretmen 404.
 */
export async function getGroupProgression(ctx: ServiceContext, groupId: string) {
  if (!UUID.test(groupId)) throw new NotFoundError()
  const scope = await groupContext(ctx.db, ctx, groupId)
  const enrollments = await listGroupEnrollments(ctx.db, ctx.institutionId, groupId)
  const ids = enrollments.map((item) => item.id)
  const [attendance, assessments, decisions] = await Promise.all([
    listLessonHourAttendances(ctx.db, ctx.institutionId, ids),
    listCourseAssessments(ctx.db, ctx.institutionId, ids),
    listProgressionDecisions(ctx.db, ctx.institutionId, { enrollmentIds: ids }),
  ])
  const learners = enrollments.map((stored) => {
    const enrollment = toCourseEnrollment(stored, scope.course, scope.teacherUserIds)
    const own = assessments.filter((row) => row.enrollmentId === stored.id)
    const ownDecisions = decisions.filter((row) => row.enrollmentId === stored.id)
    const evaluation = evaluateProgression({
      enrollment,
      attendance: attendance.get(stored.id) ?? [],
      assessments: own,
    })
    return {
      enrollmentId: stored.id,
      studentId: stored.studentId,
      memberStatus: stored.status,
      attendance: {
        totalHours: evaluation.attendance.totalHours,
        recordedHours: evaluation.attendance.recordedHours,
        attendedHours: evaluation.attendance.attendedHours,
        absentHours: evaluation.attendance.absentHours,
        unrecordedHours: evaluation.attendance.unrecordedHours,
        requiredHours: evaluation.attendance.requiredHours,
        status: evaluation.attendance.status,
      },
      assessments: own.map(assessmentView),
      conditions: evaluation.conditions,
      failingSkills: evaluation.failingSkills,
      allowedOutcomes: evaluation.allowedOutcomes,
      blocker: evaluation.blocker?.reason ?? null,
      decisions: ownDecisions.map(decisionView),
      next: nextOf(ownDecisions, scope.course, scope.nextCourse),
    }
  })
  return {
    groupId,
    courseId: scope.course.id,
    level: scope.course.level,
    canDecide: ctx.actor.role === 'ogretmen' && scope.teacherUserIds.includes(ctx.actor.userId),
    canReview: scope.actor.coordinator === true,
    learners,
  }
}

/**
 * Kursiyerin kur sonu kararları (IST-062): öğrenci kendisinin, veli 18 yaş altı çocuğunun yalnız
 * onaylı kararlarını gerekçesiz görür; personel (yönetici, grubu okuyan öğretmen) bütün kararları
 * görür. Kapsam dışı ya da olmayan öğrenci 404.
 */
export async function getStudentProgression(ctx: ServiceContext, studentId: string) {
  const [record] = await loadRecordsByIds(ctx.db, ctx.institutionId, 'students', [studentId])
  if (record === undefined) throw new NotFoundError()
  const links = await listMembershipLinks(ctx.db, ctx.institutionId, ctx.actor.membershipId)
  if (!canViewCefrProfile({ role: ctx.actor.role, links, userId: ctx.actor.userId }, studentId))
    throw new NotFoundError()
  const learner = ctx.actor.role === 'ogrenci' || ctx.actor.role === 'veli'
  if (ctx.actor.role === 'veli') {
    const type = await languageSchool(ctx.db, ctx)
    if (!(await learnerMinor(ctx.db, ctx, type, studentId))) throw new NotFoundError()
  }
  const decisions = await listProgressionDecisions(ctx.db, ctx.institutionId, {
    learnerId: studentId,
  })
  const [groups, courses] = await Promise.all([
    loadGroups(ctx.db, ctx.institutionId),
    loadCourses(ctx.db, ctx.institutionId),
  ])
  const courseOf = new Map(courses.map((course) => [course.id, course]))
  if (ctx.actor.role === 'ogretmen') {
    const coordination = await coordinationOf(ctx.db, ctx)
    const reader = {
      role: ctx.actor.role,
      membershipId: ctx.actor.membershipId,
      coordination,
      studentIds: [] as string[],
    }
    const readable = new Set(
      groups
        .filter((group) => {
          const course = courseOf.get(group.courseId)
          return course !== undefined && canReadGroup(reader, group, course, [])
        })
        .map((group) => group.id),
    )
    const visible = decisions.filter((decision) => readable.has(decision.groupId))
    if (visible.length === 0) throw new NotFoundError()
    return { studentId, decisions: visible.map(staffWithNext(visible, courseOf)) }
  }
  if (learner) {
    const approved = decisions.filter((decision) => decision.status === 'approved')
    return {
      studentId,
      decisions: approved.map((decision) => ({
        ...learnerDecisionView(decision),
        next: nextFor(approved, decision, courseOf),
      })),
    }
  }
  return { studentId, decisions: decisions.map(staffWithNext(decisions, courseOf)) }
}

function nextFor(
  decisions: readonly StoredProgressionDecision[],
  decision: StoredProgressionDecision,
  courseOf: ReadonlyMap<string, StoredCourse>,
) {
  const course = courseOf.get(decision.courseId)
  if (course === undefined) return null
  const own = decisions.filter((item) => item.enrollmentId === decision.enrollmentId)
  const nextCourse =
    course.nextCourseId === null ? null : (courseOf.get(course.nextCourseId) ?? null)
  const next = nextOf(own, course, nextCourse)
  return next?.decisionId === decision.id ? next : null
}

function staffWithNext(
  decisions: readonly StoredProgressionDecision[],
  courseOf: ReadonlyMap<string, StoredCourse>,
) {
  return (decision: StoredProgressionDecision) => ({
    ...decisionView(decision),
    next: nextFor(decisions, decision, courseOf),
  })
}
