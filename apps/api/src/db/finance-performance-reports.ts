import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import type {
  LessonObservationStatus,
  ObservationCriterion,
  ObservationRating,
} from '@kampus/school-core/lib/finance-lesson-observations.ts'
import type { DevelopmentGoalStatus } from '@kampus/school-core/lib/finance-observation-debriefs.ts'
import type { PerformanceGoal } from '@kampus/school-core/lib/finance-performance.ts'
import {
  performanceReportGoalSnapshotSchema,
  type PerformanceReportAckChannel,
  type PerformanceReportGoalItem,
} from '@kampus/school-core/lib/finance-performance-reports.ts'
import type { SelfEvaluationStatus } from '@kampus/school-core/lib/finance-self-evaluations.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import {
  lessonObservations,
  lessonObservationTemplateVersions,
} from './schema/finance-lesson-observations.ts'
import { staffDevelopmentGoalNotes } from './schema/finance-observation-debriefs.ts'
import { performanceReviews } from './schema/finance-performance.ts'
import { performanceReports } from './schema/finance-performance-reports.ts'
import { selfEvaluationResponses } from './schema/finance-self-evaluations.ts'

/**
 * Performans raporu deposu (DOM-FIN-137; ON-220). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-performance-reports.ts`'tedir. Rapor içeriği performans
 * kaydı, öz değerlendirme, ders gözlemi ve gelişim hedefi tablolarından yalnız okunur; bu depo yalnız
 * `performance_reports` (kesinleştirme, hedef anlık görüntüsü, geri bildirim eşiği ve "okudum"
 * kaydı) yazar. Anlık görüntü yazmadan önce ve okurken core şemasıyla doğrulanır (K-468).
 */

const reportOf = (institutionId: string) => eq(performanceReports.institutionId, institutionId)

export interface StoredPerformanceReport {
  id: string
  reviewId: string
  managerOpinion: string
  finalizedAt: string
  finalizedByName: string
  acknowledgedDate: string | null
  acknowledgementChannel: PerformanceReportAckChannel | null
  acknowledgementRecordedAt: string | null
  acknowledgementRecordedByName: string | null
  /** Kesinleştirme anındaki gelişim hedefi özeti; ON-350 öncesi kesinleşen raporda `null`. */
  developmentGoals: PerformanceReportGoalItem[] | null
  /** Kesinleştirme anındaki meslektaş anonimlik eşiği; ON-350 öncesi raporda `null`. */
  feedbackThreshold: number | null
  version: number
}

const REPORT_COLUMNS = {
  id: performanceReports.id,
  reviewId: performanceReports.reviewId,
  managerOpinion: performanceReports.managerOpinion,
  finalizedAt: performanceReports.finalizedAt,
  finalizedByName: performanceReports.finalizedByName,
  acknowledgedDate: performanceReports.acknowledgedDate,
  acknowledgementChannel: performanceReports.acknowledgementChannel,
  acknowledgementRecordedAt: performanceReports.acknowledgementRecordedAt,
  acknowledgementRecordedByName: performanceReports.acknowledgementRecordedByName,
  developmentGoals: performanceReports.developmentGoals,
  feedbackThreshold: performanceReports.feedbackThreshold,
  version: performanceReports.version,
}

type ReportRow = Omit<
  StoredPerformanceReport,
  'finalizedAt' | 'acknowledgementRecordedAt' | 'developmentGoals'
> & {
  finalizedAt: Date
  acknowledgementRecordedAt: Date | null
  developmentGoals: unknown
}
const toReport = (row: ReportRow): StoredPerformanceReport => ({
  ...row,
  finalizedAt: row.finalizedAt.toISOString(),
  acknowledgementRecordedAt: row.acknowledgementRecordedAt?.toISOString() ?? null,
  developmentGoals:
    row.developmentGoals === null
      ? null
      : performanceReportGoalSnapshotSchema.parse(row.developmentGoals),
})

/** Kayıtların kesinleştirme satırları (performans kaydı kimliğine göre). */
export async function performanceReportsByReview(
  db: Database,
  institutionId: string,
  reviewIds: readonly string[],
): Promise<Map<string, StoredPerformanceReport>> {
  const reports = new Map<string, StoredPerformanceReport>()
  if (reviewIds.length === 0) return reports
  const rows = await db
    .select(REPORT_COLUMNS)
    .from(performanceReports)
    .where(
      and(reportOf(institutionId), inArray(performanceReports.reviewId, [...new Set(reviewIds)])),
    )
  for (const row of rows) reports.set(row.reviewId, toReport(row))
  return reports
}

export async function findPerformanceReportByReview(
  db: Database,
  institutionId: string,
  reviewId: string,
): Promise<StoredPerformanceReport | null> {
  return (await performanceReportsByReview(db, institutionId, [reviewId])).get(reviewId) ?? null
}

export async function insertPerformanceReport(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    reviewId: string
    managerOpinion: string
    developmentGoals: readonly PerformanceReportGoalItem[]
    feedbackThreshold: number
    userId: string
    userName: string
    now: Date
  },
): Promise<void> {
  await tx.insert(performanceReports).values({
    institutionId,
    id: input.id,
    reviewId: input.reviewId,
    managerOpinion: input.managerOpinion,
    developmentGoals: performanceReportGoalSnapshotSchema.parse(input.developmentGoals),
    feedbackThreshold: input.feedbackThreshold,
    finalizedAt: input.now,
    finalizedByUserId: input.userId,
    finalizedByName: input.userName,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

/** "Okudum" kaydı; sürüm tutmazsa ya da kayıt zaten girildiyse `false` (409). */
export async function acknowledgePerformanceReport(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    acknowledgedDate: string
    channel: PerformanceReportAckChannel
    userId: string
    userName: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(performanceReports)
    .set({
      acknowledgedDate: input.acknowledgedDate,
      acknowledgementChannel: input.channel,
      acknowledgementRecordedAt: input.now,
      acknowledgementRecordedByUserId: input.userId,
      acknowledgementRecordedByName: input.userName,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        reportOf(institutionId),
        eq(performanceReports.id, input.id),
        eq(performanceReports.version, input.expectedVersion),
        isNull(performanceReports.acknowledgedDate),
      ),
    )
    .returning({ id: performanceReports.id })
  return rows.length === 1
}

/** Dönemin bütün performans kayıtları (özet için): kimlik, personel ve hedefler. */
export async function periodReviewGoals(
  db: Database,
  institutionId: string,
  periodId: string,
): Promise<{ id: string; membershipId: string; goals: PerformanceGoal[] }[]> {
  return db
    .select({
      id: performanceReviews.id,
      membershipId: performanceReviews.membershipId,
      goals: performanceReviews.goals,
    })
    .from(performanceReviews)
    .where(
      and(
        eq(performanceReviews.institutionId, institutionId),
        eq(performanceReviews.periodId, periodId),
      ),
    )
    .orderBy(asc(performanceReviews.id))
}

/** Dönemde personelin öz değerlendirme yanıtı (kimlik ve durum), üyeliğe göre. */
export async function periodSelfEvaluations(
  db: Database,
  institutionId: string,
  periodId: string,
  membershipIds?: readonly string[],
): Promise<Map<string, { id: string; status: SelfEvaluationStatus }>> {
  const responses = new Map<string, { id: string; status: SelfEvaluationStatus }>()
  if (membershipIds?.length === 0) return responses
  const rows = await db
    .select({
      id: selfEvaluationResponses.id,
      membershipId: selfEvaluationResponses.membershipId,
      status: selfEvaluationResponses.status,
    })
    .from(selfEvaluationResponses)
    .where(
      and(
        eq(selfEvaluationResponses.institutionId, institutionId),
        eq(selfEvaluationResponses.periodId, periodId),
        membershipIds === undefined
          ? undefined
          : inArray(selfEvaluationResponses.membershipId, [...new Set(membershipIds)]),
      ),
    )
  for (const row of rows) responses.set(row.membershipId, { id: row.id, status: row.status })
  return responses
}

export interface ReportObservation {
  id: string
  teacherMembershipId: string
  observerName: string
  templateName: string
  observedDate: string
  performancePeriodId: string | null
  status: LessonObservationStatus
  completedAt: string | null
  criteria: ObservationCriterion[]
  ratings: ObservationRating[]
}

const observerMembership = alias(memberships, 'report_observer_membership')
const observerUser = alias(users, 'report_observer_user')

/**
 * Dönemin rapora aday gözlemleri (K-466): verilen öğretmenlerin arşivlenmemiş, tamamlanmış
 * gözlemleri; döneme bağlıysa bu dönem, bağlanmamışsa günü dönem içinde. Kesinleştirme anı
 * süzgeci core `isObservationInPeriodReport` ile serviste uygulanır.
 */
export async function periodReportObservations(
  db: Database,
  institutionId: string,
  period: { id: string; startDate: string; endDate: string },
  teacherMembershipIds?: readonly string[],
): Promise<ReportObservation[]> {
  if (teacherMembershipIds?.length === 0) return []
  const rows = await db
    .select({
      id: lessonObservations.id,
      teacherMembershipId: lessonObservations.teacherMembershipId,
      observerName: observerUser.name,
      templateName: lessonObservationTemplateVersions.name,
      observedDate: lessonObservations.observedDate,
      performancePeriodId: lessonObservations.performancePeriodId,
      status: lessonObservations.status,
      completedAt: lessonObservations.completedAt,
      criteria: lessonObservationTemplateVersions.criteria,
      ratings: lessonObservations.ratings,
    })
    .from(lessonObservations)
    .innerJoin(
      lessonObservationTemplateVersions,
      and(
        eq(lessonObservationTemplateVersions.institutionId, lessonObservations.institutionId),
        eq(lessonObservationTemplateVersions.id, lessonObservations.templateVersionId),
      ),
    )
    .innerJoin(
      observerMembership,
      and(
        eq(observerMembership.institutionId, lessonObservations.institutionId),
        eq(observerMembership.id, lessonObservations.observerMembershipId),
      ),
    )
    .innerJoin(observerUser, eq(observerUser.id, observerMembership.userId))
    .where(
      and(
        eq(lessonObservations.institutionId, institutionId),
        isNull(lessonObservations.archivedAt),
        eq(lessonObservations.status, 'completed'),
        teacherMembershipIds === undefined
          ? undefined
          : inArray(lessonObservations.teacherMembershipId, [...new Set(teacherMembershipIds)]),
        or(
          eq(lessonObservations.performancePeriodId, period.id),
          and(
            isNull(lessonObservations.performancePeriodId),
            sql`${lessonObservations.observedDate} between ${period.startDate} and ${period.endDate}`,
          ),
        ),
      ),
    )
    .orderBy(asc(lessonObservations.observedDate), asc(lessonObservations.id))
  return rows.map((row) => ({ ...row, completedAt: row.completedAt?.toISOString() ?? null }))
}

/**
 * Hedeflerin durum değişiklikleri (takip notlarından, `statusTo` dolu olanlar), hedefe göre
 * (K-468). Durum yalnız takip notuyla değiştiği için kesinleştirme anındaki durum bundan çıkar.
 */
export async function goalStatusChanges(
  db: Database,
  institutionId: string,
  goalIds: readonly string[],
): Promise<Map<string, { statusTo: DevelopmentGoalStatus; createdAt: string }[]>> {
  const changes = new Map<string, { statusTo: DevelopmentGoalStatus; createdAt: string }[]>()
  if (goalIds.length === 0) return changes
  const rows = await db
    .select({
      goalId: staffDevelopmentGoalNotes.goalId,
      statusTo: staffDevelopmentGoalNotes.statusTo,
      createdAt: staffDevelopmentGoalNotes.createdAt,
    })
    .from(staffDevelopmentGoalNotes)
    .where(
      and(
        eq(staffDevelopmentGoalNotes.institutionId, institutionId),
        inArray(staffDevelopmentGoalNotes.goalId, [...new Set(goalIds)]),
        isNotNull(staffDevelopmentGoalNotes.statusTo),
      ),
    )
    .orderBy(asc(staffDevelopmentGoalNotes.createdAt), asc(staffDevelopmentGoalNotes.id))
  for (const row of rows) {
    if (row.statusTo === null) continue
    const list = changes.get(row.goalId) ?? []
    list.push({ statusTo: row.statusTo, createdAt: row.createdAt.toISOString() })
    changes.set(row.goalId, list)
  }
  return changes
}
