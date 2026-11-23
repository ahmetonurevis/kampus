import { randomUUID } from 'node:crypto'

import { lessonObservationScore } from '@kampus/school-core/lib/finance-lesson-observations.ts'
import {
  canViewPerformanceReport,
  developmentGoalStatusAt,
  isGoalInPerformanceReport,
  isObservationInPeriodReport,
  observationAverage,
  PERFORMANCE_REPORT_SECTIONS,
  performanceReportFeedbackSection,
  performanceReportGoalSection,
  performanceReportStatus,
  performanceReportSummary,
  planPerformanceReportAcknowledge,
  planPerformanceReportFinalize,
  selfEvaluationScaleAverage,
  type PerformanceReportFeedbackSection,
  type PerformanceReportGoalItem,
  type PerformanceReportSelfStatus,
} from '@kampus/school-core/lib/finance-performance-reports.ts'
import {
  isPerformanceScored,
  performanceOverallScore,
} from '@kampus/school-core/lib/finance-performance.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import {
  findPerformancePeriod,
  findPerformanceReview,
  findPerformanceStaff,
  listPerformanceReviews,
  type StoredPerformancePeriod,
  type StoredPerformanceReview,
} from '../db/finance-performance.ts'
import {
  acknowledgePerformanceReport,
  findPerformanceReportByReview,
  goalStatusChanges,
  insertPerformanceReport,
  performanceReportsByReview,
  periodReportObservations,
  periodReviewGoals,
  periodSelfEvaluations,
  type ReportObservation,
  type StoredPerformanceReport,
} from '../db/finance-performance-reports.ts'
import {
  listDevelopmentGoals,
  type StoredDevelopmentGoal,
} from '../db/finance-observation-debriefs.ts'
import { findSelfEvaluation, findSelfEvaluationTemplate } from '../db/finance-self-evaluations.ts'
import { findUserName } from '../db/finance-staff-certificates.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { performanceReviewView } from './finance-performance.ts'
import { loadStaffFeedbackResults, loadStaffFeedbackThreshold } from './finance-staff-feedback.ts'
import { auditWork } from './task-work.ts'

/**
 * Personel performans raporu (DOM-FIN-137; ON-220, ON-350). Kural core
 * `lib/finance-performance-reports.ts`'tedir. Dönem sonu değerlendirmesi (DOM-FIN-124),
 * gönderilmiş öz değerlendirme (DOM-FIN-131), dönemdeki tamamlanmış ders gözlemleri (DOM-FIN-130)
 * ve çok kaynaklı geri bildirimin toplu sonucu (DOM-FIN-134) her okumada kaynak tablolardan
 * derlenir (K-466, K-468). `performance_reports` kesinleştirme ve "okudum" kaydını (K-467) ve
 * kaynağı kesinleştirmeden sonra değişebilen iki bilgiyi tutar (K-468): döneme bağlı gelişim
 * hedeflerinin (DOM-FIN-133) özeti ve geri bildirimin anonimlik eşiği. Rapor okuması (ekran ve PDF) ve personel satırları aynı transaction'da
 * denetime düşer (K-468). Rol ve modül denetimi rotadadır; öğretmenin yalnız kendi kesinleşmiş
 * raporunu görmesi burada uygulanır (gerisi 404).
 */

const REVIEW_ENTITY = 'performance_reviews'
const PERIOD_ENTITY = 'performance_periods'
const REPORT_ENTITY = 'performance_reports'
const REPORT_FIELDS = [
  'staffName',
  'goals',
  'interimNote',
  'staffComment',
  'selfEvaluation',
  'observations',
  'developmentGoals',
  'managerOpinion',
]
/** Geri bildirim bölümünün denetim alan adları: yönetici yanıtı ve görünürse meslektaş toplamı. */
const feedbackFields = (section: PerformanceReportFeedbackSection) => [
  ...(section.manager.responses.length > 0 ? ['managerFeedback'] : []),
  ...(section.state === 'visible' ? ['peerFeedbackAggregate'] : []),
]
const ROW_FIELDS = ['staffName', 'overallScore', 'selfEvaluationStatus', 'observationAverage']

export type PerformanceReportPurpose = 'view' | 'pdf'

function scoredObservations(
  observations: readonly ReportObservation[],
  period: StoredPerformancePeriod,
  finalizedAt: string | null,
) {
  return observations.flatMap((observation) => {
    if (!isObservationInPeriodReport(observation, period, finalizedAt)) return []
    const score = lessonObservationScore(observation.criteria, observation.ratings)
    return score === null ? [] : [{ ...observation, score }]
  })
}

/** Gözlemler öğretmen üyeliğine göre (özet ve satırlar için tek geçiş). */
function byTeacherOf(observations: readonly ReportObservation[]) {
  const groups = new Map<string, ReportObservation[]>()
  for (const observation of observations) {
    const list = groups.get(observation.teacherMembershipId) ?? []
    list.push(observation)
    groups.set(observation.teacherMembershipId, list)
  }
  return groups
}

const selfStatusOf = (
  response: { status: 'draft' | 'submitted' } | undefined,
): PerformanceReportSelfStatus => response?.status ?? 'missing'

function reportMeta(report: StoredPerformanceReport | null) {
  return {
    reportId: report?.id ?? null,
    status: performanceReportStatus(report),
    finalizedAt: report?.finalizedAt ?? null,
    finalizedByName: report?.finalizedByName ?? null,
    acknowledgedDate: report?.acknowledgedDate ?? null,
    acknowledgementChannel: report?.acknowledgementChannel ?? null,
    acknowledgementRecordedAt: report?.acknowledgementRecordedAt ?? null,
    acknowledgementRecordedByName: report?.acknowledgementRecordedByName ?? null,
  }
}

async function selfEvaluationSection(
  db: Database,
  ctx: ServiceContext,
  review: StoredPerformanceReview,
) {
  const responses = await periodSelfEvaluations(db, ctx.institutionId, review.periodId, [
    review.membershipId,
  ])
  const found = responses.get(review.membershipId)
  const empty = {
    status: selfStatusOf(found),
    submittedAt: null,
    channel: null,
    scaleAverage: null,
    answeredCount: 0,
    questionCount: 0,
    items: [],
    managerComment: null,
  }
  // Rapor yalnız gönderilmiş beyanı taşır; taslak personelin son sözü değildir (K-466).
  if (found?.status !== 'submitted') return empty
  const response = await findSelfEvaluation(db, ctx.institutionId, found.id)
  if (response === null) return empty
  const template = await findSelfEvaluationTemplate(db, ctx.institutionId, response.templateId)
  if (template === null) throw new Error('self evaluation template is missing')
  const items = template.questions.map((question, index) => ({
    question: question.text,
    kind: question.kind,
    score: response.answers[index]?.score ?? null,
    text: response.answers[index]?.text ?? null,
  }))
  return {
    status: 'submitted' as const,
    submittedAt: response.submittedAt,
    channel: response.channel,
    scaleAverage: selfEvaluationScaleAverage(template.questions, response.answers),
    answeredCount: items.filter((item) => item.score !== null || item.text !== null).length,
    questionCount: items.length,
    items,
    managerComment: response.managerComment,
  }
}

const GOAL_PAGE = 100

/**
 * Personelin bu döneme bağlı hedefleri kaynaktan (K-468): `at` anındaki durumuyla (sonra açılan
 * hedef girmez; `at` boşsa bugünkü durum). Açık, süren ve ulaşılan hedefler girer; bırakılan girmez.
 * Kesinleştirme bu listeyi anlık görüntü olarak yazar.
 */
async function sourceGoalItems(
  db: Database,
  ctx: ServiceContext,
  review: StoredPerformanceReview,
  at: string | null,
): Promise<PerformanceReportGoalItem[]> {
  const goals: StoredDevelopmentGoal[] = []
  for (let page = 1; ; page += 1) {
    const { items, total } = await listDevelopmentGoals(
      db,
      ctx.institutionId,
      {
        page,
        pageSize: GOAL_PAGE,
        performancePeriodId: review.periodId,
        teacherMembershipId: review.membershipId,
      },
      null,
    )
    goals.push(...items)
    if (items.length === 0 || goals.length >= total) break
  }
  const changes = await goalStatusChanges(
    db,
    ctx.institutionId,
    goals.map((goal) => goal.id),
  )
  return goals.flatMap((goal) => {
    const status = developmentGoalStatusAt(goal, changes.get(goal.id) ?? [], at)
    if (status === null || !isGoalInPerformanceReport(status)) return []
    return [
      {
        id: goal.id,
        title: goal.title,
        successCriterion: goal.successCriterion,
        source: goal.source,
        observedDate: goal.observedDate,
        followUpDate: goal.followUpDate,
        status,
      },
    ]
  })
}

/**
 * Gelişim hedefleri bölümü (K-468). Kesinleşmiş rapor kesinleştirmede yazılan anlık görüntüyü okur:
 * hedefin başlığı, ölçütü, takip tarihi ya da dönem bağı sonradan değişse de rapor değişmez.
 * Görüntüsü olmayan (ON-350 öncesi kesinleşen) rapor hedefleri kaynaktan kesinleştirme anındaki
 * durumuyla okur; kesinleşmemiş rapor bugünkü durumla.
 */
async function developmentGoalSection(
  db: Database,
  ctx: ServiceContext,
  review: StoredPerformanceReview,
  report: StoredPerformanceReport | null,
) {
  return performanceReportGoalSection(
    report?.developmentGoals ??
      (await sourceGoalItems(db, ctx, review, report?.finalizedAt ?? null)),
  )
}

/**
 * Çok kaynaklı geri bildirim bölümü (K-468, K-459): değerlendirilenin toplu sonucu; meslektaş
 * yanıtları yalnız toplu ve eşik üstünde. Yanıtlar kapanan dönemde değişmediği için (K-457)
 * kaynaktan okunur; kesinleşmiş rapor kesinleştirme anındaki eşiği kullanır, kurum ayarı sonradan
 * değişse de bölüm değişmez. Okuma denetimini çağıran yazar.
 */
async function staffFeedbackSection(
  db: Database,
  ctx: ServiceContext,
  review: StoredPerformanceReview,
  report: StoredPerformanceReport | null,
) {
  const results = await loadStaffFeedbackResults(
    db,
    ctx.institutionId,
    review.periodId,
    [review.membershipId],
    { threshold: report?.feedbackThreshold ?? undefined },
  )
  const result = results.get(review.membershipId)
  if (result === undefined) throw new Error('staff feedback result is missing')
  return performanceReportFeedbackSection(result)
}

async function reportView(
  db: Database,
  ctx: ServiceContext,
  review: StoredPerformanceReview,
  period: StoredPerformancePeriod,
  report: StoredPerformanceReport | null,
) {
  const evaluation = performanceReviewView(review)
  const observations = scoredObservations(
    await periodReportObservations(db, ctx.institutionId, period, [review.membershipId]),
    period,
    report?.finalizedAt ?? null,
  )
  return {
    reviewId: review.id,
    periodId: period.id,
    periodName: period.name,
    periodStartDate: period.startDate,
    periodEndDate: period.endDate,
    periodStatus: period.status,
    membershipId: review.membershipId,
    staffName: review.staffName,
    staffRole: review.staffRole,
    sections: [...PERFORMANCE_REPORT_SECTIONS],
    evaluation: {
      goals: evaluation.goals,
      overallScore: evaluation.overallScore,
      scored: evaluation.scored,
      interimDate: evaluation.interimDate,
      interimNote: evaluation.interimNote,
      evaluatorName: evaluation.evaluatorName,
      evaluatedAt: evaluation.evaluatedAt,
      staffComment: evaluation.staffComment,
    },
    selfEvaluation: await selfEvaluationSection(db, ctx, review),
    observations: {
      count: observations.length,
      averagePercent: observationAverage(observations.map((item) => item.score.percent)),
      items: observations.map((item) => ({
        id: item.id,
        observedDate: item.observedDate,
        templateName: item.templateName,
        observerName: item.observerName,
        total: item.score.total,
        max: item.score.max,
        percent: item.score.percent,
      })),
    },
    staffFeedback: await staffFeedbackSection(db, ctx, review, report),
    developmentGoals: await developmentGoalSection(db, ctx, review, report),
    managerOpinion: report?.managerOpinion ?? null,
    ...reportMeta(report),
  }
}

async function loadReview(db: Database, ctx: ServiceContext, reviewId: string) {
  const review = await findPerformanceReview(db, ctx.institutionId, reviewId)
  if (review === null) throw new NotFoundError()
  const period = await findPerformancePeriod(db, ctx.institutionId, review.periodId)
  if (period === null) throw new NotFoundError()
  return { review, period }
}

/**
 * Personel × dönem raporu (K-466). Yönetici her raporu, öğretmen yalnız kendi kesinleşmiş raporunu
 * okur; görünmeyen rapor 404 (K-468). Okuma aynı transaction'da denetime yazılır: ekran
 * `finance.performance_report.read`, PDF `finance.performance_report.export` (alan adları).
 */
export async function getPerformanceReportFor(
  ctx: ServiceContext,
  reviewId: string,
  purpose: PerformanceReportPurpose,
) {
  return ctx.db.transaction(async (tx) => {
    const { review, period } = await loadReview(tx, ctx, reviewId)
    const report = await findPerformanceReportByReview(tx, ctx.institutionId, reviewId)
    const visible = canViewPerformanceReport(ctx.actor, {
      membershipId: review.membershipId,
      finalized: report !== null,
    })
    if (!visible) throw new NotFoundError()
    const view = await reportView(tx, ctx, review, period, report)
    await tx.insert(auditLog).values({
      institutionId: ctx.institutionId,
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action:
        purpose === 'pdf' ? 'finance.performance_report.export' : 'finance.performance_report.read',
      entityType: REVIEW_ENTITY,
      entityId: reviewId,
      // kvkk: değer değil, dönen kişisel alanların adı; meslektaş toplamı yalnız görünürse.
      changes: { fields: [...REPORT_FIELDS, ...feedbackFields(view.staffFeedback)] },
      createdAt: ctx.now,
    })
    return view
  })
}

/**
 * Dönem özeti (K-466): personel sayısı, genel puan ortalaması, en düşük ve en yüksek, bant
 * dağılımı, gözlem ortalaması, öz değerlendirme gönderen, kesinleşen ve okunan rapor sayısı.
 * Kişi adı ve kimliği taşımaz; okuma denetime yazılmaz. Başka kurumun dönemi 404.
 */
export async function getPerformanceReportSummaryFor(ctx: ServiceContext, periodId: string) {
  const period = await findPerformancePeriod(ctx.db, ctx.institutionId, periodId)
  if (period === null) throw new NotFoundError()
  const reviews = await periodReviewGoals(ctx.db, ctx.institutionId, periodId)
  const [reports, responses, observations] = await Promise.all([
    performanceReportsByReview(
      ctx.db,
      ctx.institutionId,
      reviews.map((review) => review.id),
    ),
    periodSelfEvaluations(ctx.db, ctx.institutionId, periodId),
    periodReportObservations(ctx.db, ctx.institutionId, period),
  ])
  const byTeacher = byTeacherOf(observations)
  const summary = performanceReportSummary(
    reviews.map((review) => {
      const report = reports.get(review.id) ?? null
      return {
        overallScore: performanceOverallScore(review.goals),
        status: performanceReportStatus(report),
        selfEvaluationStatus: selfStatusOf(responses.get(review.membershipId)),
        observationPercents: scoredObservations(
          byTeacher.get(review.membershipId) ?? [],
          period,
          report?.finalizedAt ?? null,
        ).map((item) => item.score.percent),
      }
    }),
  )
  return {
    periodId: period.id,
    periodName: period.name,
    periodStatus: period.status,
    periodStartDate: period.startDate,
    periodEndDate: period.endDate,
    ...summary,
  }
}

/**
 * Dönem özetinin personel satırları, ada göre (K-466): genel puan, öz değerlendirme durumu,
 * gözlem sayısı ve ortalaması, rapor durumu. Okuma aynı transaction'da
 * `finance.performance_report.list` denetimine (alan adları, satır sayısı) düşer. Başka kurum 404.
 */
export async function listPerformanceReportRowsFor(
  ctx: ServiceContext,
  periodId: string,
  query: { page: number; pageSize: number; q?: string | undefined },
) {
  return ctx.db.transaction(async (tx) => {
    const period = await findPerformancePeriod(tx, ctx.institutionId, periodId)
    if (period === null) throw new NotFoundError()
    const { items, total } = await listPerformanceReviews(tx, ctx.institutionId, periodId, query)
    const memberIds = items.map((item) => item.membershipId)
    const [reports, responses, observations] = await Promise.all([
      performanceReportsByReview(
        tx,
        ctx.institutionId,
        items.map((item) => item.id),
      ),
      periodSelfEvaluations(tx, ctx.institutionId, periodId, memberIds),
      periodReportObservations(tx, ctx.institutionId, period, memberIds),
    ])
    const byTeacher = byTeacherOf(observations)
    await tx.insert(auditLog).values({
      institutionId: ctx.institutionId,
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action: 'finance.performance_report.list',
      entityType: PERIOD_ENTITY,
      entityId: periodId,
      // kvkk: değer değil, dönen kişisel alanların adı ve satır sayısı.
      changes: { fields: ROW_FIELDS, counts: { rows: items.length } },
      createdAt: ctx.now,
    })
    return {
      items: items.map((review) => {
        const report = reports.get(review.id) ?? null
        const percents = scoredObservations(
          byTeacher.get(review.membershipId) ?? [],
          period,
          report?.finalizedAt ?? null,
        ).map((item) => item.score.percent)
        return {
          reviewId: review.id,
          membershipId: review.membershipId,
          staffName: review.staffName,
          staffRole: review.staffRole,
          overallScore: performanceOverallScore(review.goals),
          scored: isPerformanceScored(review.goals),
          selfEvaluationStatus: selfStatusOf(responses.get(review.membershipId)),
          observationCount: percents.length,
          observationAverage: observationAverage(percents),
          ...reportMeta(report),
        }
      }),
      total,
    }
  })
}

async function reportBody(tx: Database, ctx: ServiceContext, reviewId: string) {
  const { review, period } = await loadReview(tx, ctx, reviewId)
  const report = await findPerformanceReportByReview(tx, ctx.institutionId, reviewId)
  if (report === null) throw new Error('performance report was not written')
  return reportView(tx, ctx, review, period, report)
}

/**
 * Kesinleştirme (K-467): dönem kapanmış, rapor daha önce kesinleşmemiş, kesinleştiren raporun
 * sahibi değil. Görüş metni denetime yazılmaz. `Idempotency-Key` rotada zorunludur. 201.
 */
export function finalizePerformanceReportCommand(
  ctx: ServiceContext,
  reviewId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: REPORT_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.performance_report.finalize',
      collections: [],
      entity,
      load: async (tx) => {
        const { review, period } = await loadReview(tx, ctx, reviewId)
        const [existing, staff, actorName] = await Promise.all([
          findPerformanceReportByReview(tx, ctx.institutionId, reviewId),
          findPerformanceStaff(tx, ctx.institutionId, review.membershipId),
          findUserName(tx, ctx.actor.userId),
        ])
        if (staff === null) throw new NotFoundError()
        return {
          run: () => ({
            ...planPerformanceReportFinalize(input, {
              period,
              finalized: existing !== null,
              staffUserId: staff.userId,
              actorUserId: ctx.actor.userId,
            }),
            review,
            actorName: actorName ?? '—',
          }),
        }
      },
      after: async (tx, plan) => {
        // Kaynağı sonradan değişebilen bilgiler kesinleştirme anındaki hâliyle sabitlenir (K-468).
        const [developmentGoals, feedbackThreshold] = await Promise.all([
          sourceGoalItems(tx, ctx, plan.review, ctx.now.toISOString()),
          loadStaffFeedbackThreshold(tx, ctx.institutionId),
        ])
        await insertPerformanceReport(tx, ctx.institutionId, {
          id,
          reviewId,
          managerOpinion: plan.managerOpinion,
          developmentGoals,
          feedbackThreshold,
          userId: ctx.actor.userId,
          userName: plan.actorName,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.performance_report.finalize', entity, [
          'reviewId',
          'managerOpinion',
          'finalizedAt',
          'developmentGoals',
          'feedbackThreshold',
        ])
        body = { data: await reportBody(tx, ctx, reviewId) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/**
 * "Okudum" kaydı (K-467): yönetici personel adına kanal ve günle girer; yalnız kesinleşmiş rapora,
 * bir kez. `Idempotency-Key` rotada zorunludur. 200.
 */
export function acknowledgePerformanceReportCommand(
  ctx: ServiceContext,
  reviewId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: REVIEW_ENTITY, id: reviewId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.performance_report.acknowledge',
      collections: [],
      entity,
      load: async (tx) => {
        await loadReview(tx, ctx, reviewId)
        const [report, actorName] = await Promise.all([
          findPerformanceReportByReview(tx, ctx.institutionId, reviewId),
          findUserName(tx, ctx.actor.userId),
        ])
        return {
          run: () => ({
            ...planPerformanceReportAcknowledge(
              report === null
                ? null
                : {
                    finalizedDate: dayKey(report.finalizedAt),
                    acknowledgedDate: report.acknowledgedDate,
                  },
              input,
              dayKey(ctx.now),
            ),
            report,
            actorName: actorName ?? '—',
          }),
        }
      },
      after: async (tx, plan) => {
        if (plan.report === null) throw new Error('performance report is missing')
        const saved = await acknowledgePerformanceReport(tx, ctx.institutionId, {
          id: plan.report.id,
          expectedVersion: plan.report.version,
          acknowledgedDate: plan.acknowledgedDate,
          channel: plan.channel,
          userId: ctx.actor.userId,
          userName: plan.actorName,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          'finance.performance_report.acknowledge',
          { type: REPORT_ENTITY, id: plan.report.id },
          ['acknowledgedDate', 'acknowledgementChannel'],
        )
        body = { data: await reportBody(tx, ctx, reviewId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
