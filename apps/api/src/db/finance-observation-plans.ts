import { and, asc, count, eq, gte, inArray, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import type { ObservationCriterion } from '@kampus/school-core/lib/finance-lesson-observations.ts'
import {
  OPEN_OBSERVATION_PLAN_STATUSES,
  type BusyPlan,
  type ObservationPlanNoticeKind,
  type ObservationPlanNoticeStatus,
  type ObservationPlanPatch,
  type ObservationPlanStatus,
} from '@kampus/school-core/lib/finance-observation-plans.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import {
  lessonObservations,
  lessonObservationTemplates,
  lessonObservationTemplateVersions,
} from './schema/finance-lesson-observations.ts'
import { observationPlanNotices, observationPlans } from './schema/finance-observation-plans.ts'
import { performancePeriods } from './schema/finance-performance.ts'

/**
 * Ders gözlem planı deposu (DOM-FIN-139; ON-207). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-observation-plans.ts`'tedir. Öğretmen ve gözlemci
 * üyelikten (Better Auth `memberships`, `users`), form sürümü, gözlem ve dönem kendi
 * tablolarından yalnız okunur; gözlem bağı plandadır (`observation_id`).
 */

const planOf = (institutionId: string) => eq(observationPlans.institutionId, institutionId)
const openStatus = inArray(observationPlans.status, [...OPEN_OBSERVATION_PLAN_STATUSES])
/** Sürümü bilinmeyen bağlı yazmada (gözlem tamamlama ve arşivi) satır sürümü bir artar. */
const nextVersion = sql`${observationPlans.version} + 1`

// --- Form sürümü ---------------------------------------------------------------------------------

export interface PlanTemplateVersion {
  versionId: string
  templateId: string
  archived: boolean
  criteria: ObservationCriterion[]
}

/** Planın form sürümü ve formun arşiv durumu (gözlem başlatırken). */
export async function findPlanTemplateVersion(
  db: Database,
  institutionId: string,
  versionId: string,
): Promise<PlanTemplateVersion | null> {
  const [row] = await db
    .select({
      versionId: lessonObservationTemplateVersions.id,
      templateId: lessonObservationTemplateVersions.templateId,
      archivedAt: lessonObservationTemplates.archivedAt,
      criteria: lessonObservationTemplateVersions.criteria,
    })
    .from(lessonObservationTemplateVersions)
    .innerJoin(
      lessonObservationTemplates,
      and(
        eq(
          lessonObservationTemplates.institutionId,
          lessonObservationTemplateVersions.institutionId,
        ),
        eq(lessonObservationTemplates.id, lessonObservationTemplateVersions.templateId),
      ),
    )
    .where(
      and(
        eq(lessonObservationTemplateVersions.institutionId, institutionId),
        eq(lessonObservationTemplateVersions.id, versionId),
      ),
    )
    .limit(1)
  return row === undefined
    ? null
    : {
        versionId: row.versionId,
        templateId: row.templateId,
        archived: row.archivedAt !== null,
        criteria: row.criteria,
      }
}

// --- Plan ----------------------------------------------------------------------------------------

export interface StoredObservationPlan {
  id: string
  teacherMembershipId: string
  teacherName: string
  observerMembershipId: string
  observerName: string
  templateId: string
  templateVersionId: string
  templateName: string
  templateVersionNumber: number
  plannedDate: string
  startTime: string
  durationMinutes: number
  classId: string | null
  subjectId: string | null
  performancePeriodId: string | null
  performancePeriodName: string | null
  note: string | null
  status: ObservationPlanStatus
  postponeCount: number
  postponeReason: string | null
  cancelReason: string | null
  cancelledAt: string | null
  observationId: string | null
  observationStatus: 'draft' | 'completed' | null
  doneAt: string | null
  createdAt: string
  updatedAt: string
  version: number
}

const teacherMembership = alias(memberships, 'plan_teacher_membership')
const teacherUser = alias(users, 'plan_teacher_user')
const observerMembership = alias(memberships, 'plan_observer_membership')
const observerUser = alias(users, 'plan_observer_user')

const PLAN_COLUMNS = {
  id: observationPlans.id,
  teacherMembershipId: observationPlans.teacherMembershipId,
  teacherName: teacherUser.name,
  observerMembershipId: observationPlans.observerMembershipId,
  observerName: observerUser.name,
  templateId: lessonObservationTemplateVersions.templateId,
  templateVersionId: observationPlans.templateVersionId,
  templateName: lessonObservationTemplateVersions.name,
  templateVersionNumber: lessonObservationTemplateVersions.versionNumber,
  plannedDate: observationPlans.plannedDate,
  startTime: observationPlans.startTime,
  durationMinutes: observationPlans.durationMinutes,
  classId: observationPlans.classId,
  subjectId: observationPlans.subjectId,
  performancePeriodId: observationPlans.performancePeriodId,
  performancePeriodName: performancePeriods.name,
  note: observationPlans.note,
  status: observationPlans.status,
  postponeCount: observationPlans.postponeCount,
  postponeReason: observationPlans.postponeReason,
  cancelReason: observationPlans.cancelReason,
  cancelledAt: observationPlans.cancelledAt,
  observationId: observationPlans.observationId,
  observationStatus: lessonObservations.status,
  doneAt: observationPlans.doneAt,
  createdAt: observationPlans.createdAt,
  updatedAt: observationPlans.updatedAt,
  version: observationPlans.version,
}

type PlanRow = Omit<
  StoredObservationPlan,
  'cancelledAt' | 'doneAt' | 'createdAt' | 'updatedAt' | 'observationStatus'
> & {
  cancelledAt: Date | null
  doneAt: Date | null
  createdAt: Date
  updatedAt: Date
  observationStatus: 'draft' | 'completed' | null
}
const toPlan = (row: PlanRow): StoredObservationPlan => ({
  ...row,
  cancelledAt: row.cancelledAt?.toISOString() ?? null,
  doneAt: row.doneAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const ON_TEACHER = and(
  eq(teacherMembership.institutionId, observationPlans.institutionId),
  eq(teacherMembership.id, observationPlans.teacherMembershipId),
)
const ON_OBSERVER = and(
  eq(observerMembership.institutionId, observationPlans.institutionId),
  eq(observerMembership.id, observationPlans.observerMembershipId),
)

const planBase = (db: Database) =>
  db
    .select(PLAN_COLUMNS)
    .from(observationPlans)
    .innerJoin(
      lessonObservationTemplateVersions,
      and(
        eq(lessonObservationTemplateVersions.institutionId, observationPlans.institutionId),
        eq(lessonObservationTemplateVersions.id, observationPlans.templateVersionId),
      ),
    )
    .innerJoin(teacherMembership, ON_TEACHER)
    .innerJoin(teacherUser, eq(teacherUser.id, teacherMembership.userId))
    .innerJoin(observerMembership, ON_OBSERVER)
    .innerJoin(observerUser, eq(observerUser.id, observerMembership.userId))
    .leftJoin(
      performancePeriods,
      and(
        eq(performancePeriods.institutionId, observationPlans.institutionId),
        eq(performancePeriods.id, observationPlans.performancePeriodId),
      ),
    )
    .leftJoin(
      lessonObservations,
      and(
        eq(lessonObservations.institutionId, observationPlans.institutionId),
        eq(lessonObservations.id, observationPlans.observationId),
      ),
    )

export async function findObservationPlan(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredObservationPlan | null> {
  const [row] = await planBase(db)
    .where(and(planOf(institutionId), eq(observationPlans.id, id)))
    .limit(1)
  return row === undefined ? null : toPlan(row)
}

export interface ObservationPlanQuery {
  page: number
  pageSize: number
  from?: string | undefined
  to?: string | undefined
  teacherMembershipId?: string | undefined
  observerMembershipId?: string | undefined
  status?: ObservationPlanStatus | undefined
  overdue?: boolean | undefined
  performancePeriodId?: string | undefined
}

/** Öğretmen yalnız gözlemcisi ya da gözleneni olduğu planı görür (K-474); yönetici süzülmez. */
const visibleTo = (viewerMembershipId: string | null): SQL | undefined =>
  viewerMembershipId === null
    ? undefined
    : or(
        eq(observationPlans.teacherMembershipId, viewerMembershipId),
        eq(observationPlans.observerMembershipId, viewerMembershipId),
      )

/**
 * Planlar gün ve saat sırasıyla (takvim). `overdue` günü bugünden önce, açık planlardır (K-473).
 * `viewerMembershipId` öğretmen süzgecidir.
 */
export async function listObservationPlans(
  db: Database,
  institutionId: string,
  query: ObservationPlanQuery,
  viewerMembershipId: string | null,
  today: string,
): Promise<{ items: StoredObservationPlan[]; total: number }> {
  const where = and(
    planOf(institutionId),
    visibleTo(viewerMembershipId),
    query.from === undefined ? undefined : gte(observationPlans.plannedDate, query.from),
    query.to === undefined ? undefined : lte(observationPlans.plannedDate, query.to),
    query.teacherMembershipId === undefined
      ? undefined
      : eq(observationPlans.teacherMembershipId, query.teacherMembershipId),
    query.observerMembershipId === undefined
      ? undefined
      : eq(observationPlans.observerMembershipId, query.observerMembershipId),
    query.status === undefined ? undefined : eq(observationPlans.status, query.status),
    query.performancePeriodId === undefined
      ? undefined
      : eq(observationPlans.performancePeriodId, query.performancePeriodId),
    query.overdue === true ? and(openStatus, lt(observationPlans.plannedDate, today)) : undefined,
  )
  const [totalRow] = await db.select({ total: count() }).from(observationPlans).where(where)
  const rows = await planBase(db)
    .where(where)
    .orderBy(
      asc(observationPlans.plannedDate),
      asc(observationPlans.startTime),
      asc(observationPlans.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toPlan), total: totalRow?.total ?? 0 }
}

/**
 * Verilen kişilerden birinin (gözlemci ya da gözlenen olarak) o gündeki, iptal edilmemiş planları;
 * `excludeId` düzeltilen planın kendisidir. Çakışma core'da hesaplanır (K-472).
 */
export async function busyObservationPlans(
  db: Database,
  institutionId: string,
  input: { plannedDate: string; membershipIds: readonly string[]; excludeId?: string },
): Promise<BusyPlan[]> {
  const people = [...new Set(input.membershipIds)]
  return db
    .select({
      id: observationPlans.id,
      teacherMembershipId: observationPlans.teacherMembershipId,
      observerMembershipId: observationPlans.observerMembershipId,
      plannedDate: observationPlans.plannedDate,
      startTime: observationPlans.startTime,
      durationMinutes: observationPlans.durationMinutes,
    })
    .from(observationPlans)
    .where(
      and(
        planOf(institutionId),
        eq(observationPlans.plannedDate, input.plannedDate),
        ne(observationPlans.status, 'cancelled'),
        input.excludeId === undefined ? undefined : ne(observationPlans.id, input.excludeId),
        or(
          inArray(observationPlans.observerMembershipId, people),
          inArray(observationPlans.teacherMembershipId, people),
        ),
      ),
    )
}

/** Öğretmenin döneme bağlı, iptal edilmemiş plan sayısı (sınır; K-472). */
export async function teacherPlanCountInPeriod(
  db: Database,
  institutionId: string,
  input: { teacherMembershipId: string; performancePeriodId: string; excludeId?: string },
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(observationPlans)
    .where(
      and(
        planOf(institutionId),
        eq(observationPlans.teacherMembershipId, input.teacherMembershipId),
        eq(observationPlans.performancePeriodId, input.performancePeriodId),
        ne(observationPlans.status, 'cancelled'),
        input.excludeId === undefined ? undefined : ne(observationPlans.id, input.excludeId),
      ),
    )
  return row?.total ?? 0
}

export async function insertObservationPlan(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    teacherMembershipId: string
    observerMembershipId: string
    templateVersionId: string
    plannedDate: string
    startTime: string
    durationMinutes: number
    classId: string | null
    subjectId: string | null
    performancePeriodId: string | null
    note: string | null
    userId: string
    now: Date
  },
): Promise<void> {
  const { now, userId, ...rest } = input
  await tx.insert(observationPlans).values({
    institutionId,
    ...rest,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
}

/** Açık ve başlamamış planı sürüm tutarsa yazar; değilse `false` (409). */
async function writeOpenPlan(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; now: Date },
  values: Partial<typeof observationPlans.$inferInsert>,
): Promise<boolean> {
  const rows = await tx
    .update(observationPlans)
    .set({ ...values, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        planOf(institutionId),
        eq(observationPlans.id, input.id),
        eq(observationPlans.version, input.expectedVersion),
        openStatus,
      ),
    )
    .returning({ id: observationPlans.id })
  return rows.length === 1
}

export const updateObservationPlan = (
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; patch: ObservationPlanPatch; now: Date },
) => writeOpenPlan(tx, institutionId, input, input.patch)

export const postponeObservationPlan = (
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    plannedDate: string
    startTime: string
    durationMinutes: number
    reason: string
    postponeCount: number
    now: Date
  },
) =>
  writeOpenPlan(tx, institutionId, input, {
    status: 'postponed',
    plannedDate: input.plannedDate,
    startTime: input.startTime,
    durationMinutes: input.durationMinutes,
    postponeReason: input.reason,
    postponeCount: input.postponeCount,
  })

export const cancelObservationPlan = (
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; reason: string; now: Date },
) =>
  writeOpenPlan(tx, institutionId, input, {
    status: 'cancelled',
    cancelReason: input.reason,
    cancelledAt: input.now,
  })

export const linkObservationPlan = (
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; observationId: string; now: Date },
) => writeOpenPlan(tx, institutionId, input, { observationId: input.observationId })

/**
 * Gözlem tamamlanınca bağlı açık plan gerçekleşir (K-473); bağlı plan yoksa `null`. Gözlemin
 * tamamlama transaction'ında çağrılır.
 */
export async function markObservationPlanDone(
  tx: Database,
  institutionId: string,
  input: { observationId: string; now: Date },
): Promise<string | null> {
  const [row] = await tx
    .update(observationPlans)
    .set({
      status: 'done',
      doneAt: input.now,
      updatedAt: input.now,
      version: nextVersion,
    })
    .where(
      and(
        planOf(institutionId),
        eq(observationPlans.observationId, input.observationId),
        openStatus,
      ),
    )
    .returning({ id: observationPlans.id })
  return row?.id ?? null
}

/**
 * Taslak arşivlenince plan bağı kalkar; plan açık kalır ve yeniden başlatılabilir (K-473).
 * Bağlı plan yoksa `null`.
 */
export async function unlinkObservationPlan(
  tx: Database,
  institutionId: string,
  input: { observationId: string; now: Date },
): Promise<string | null> {
  const [row] = await tx
    .update(observationPlans)
    .set({ observationId: null, updatedAt: input.now, version: nextVersion })
    .where(and(planOf(institutionId), eq(observationPlans.observationId, input.observationId)))
    .returning({ id: observationPlans.id })
  return row?.id ?? null
}

// --- Bildirim ------------------------------------------------------------------------------------

export interface StoredPlanNotice {
  id: string
  kind: ObservationPlanNoticeKind
  status: ObservationPlanNoticeStatus
  plannedDate: string
  startTime: string
  createdAt: string
}

/** Öğretmene "gönderilecek" bildirim kaydı (K-474); gönderim yapılmaz. */
export async function insertPlanNotice(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    planId: string
    recipientMembershipId: string
    kind: ObservationPlanNoticeKind
    plannedDate: string
    startTime: string
    now: Date
  },
): Promise<void> {
  const { now, ...rest } = input
  await tx.insert(observationPlanNotices).values({
    institutionId,
    ...rest,
    createdAt: now,
    updatedAt: now,
  })
}

/** Planların bekleyen (gönderilecek) bildirim sayısı. */
export async function pendingNoticeCounts(
  db: Database,
  institutionId: string,
  planIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (planIds.length === 0) return counts
  const rows = await db
    .select({ planId: observationPlanNotices.planId, total: count() })
    .from(observationPlanNotices)
    .where(
      and(
        eq(observationPlanNotices.institutionId, institutionId),
        inArray(observationPlanNotices.planId, [...new Set(planIds)]),
        eq(observationPlanNotices.status, 'pending'),
      ),
    )
    .groupBy(observationPlanNotices.planId)
  for (const row of rows) counts.set(row.planId, row.total)
  return counts
}

/** Planın bildirimleri, eskiden yeniye. */
export async function listPlanNotices(
  db: Database,
  institutionId: string,
  planId: string,
): Promise<StoredPlanNotice[]> {
  const rows = await db
    .select({
      id: observationPlanNotices.id,
      kind: observationPlanNotices.kind,
      status: observationPlanNotices.status,
      plannedDate: observationPlanNotices.plannedDate,
      startTime: observationPlanNotices.startTime,
      createdAt: observationPlanNotices.createdAt,
    })
    .from(observationPlanNotices)
    .where(
      and(
        eq(observationPlanNotices.institutionId, institutionId),
        eq(observationPlanNotices.planId, planId),
      ),
    )
    .orderBy(asc(observationPlanNotices.createdAt), asc(observationPlanNotices.id))
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}
