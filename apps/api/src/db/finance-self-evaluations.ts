import { and, asc, count, eq, isNull, sql, type SQL } from 'drizzle-orm'

import type {
  SelfEvaluationAnswer,
  SelfEvaluationChannel,
  SelfEvaluationPatch,
  SelfEvaluationQuestion,
  SelfEvaluationStatus,
  SelfEvaluationTrackingStatus,
} from '@kampus/school-core/lib/finance-self-evaluations.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { performanceReviews } from './schema/finance-performance.ts'
import {
  selfEvaluationResponses,
  selfEvaluationTemplates,
} from './schema/finance-self-evaluations.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Öz değerlendirme deposu (DOM-FIN-131; ON-210). Kurum kapsamlıdır: ilk parametre `institutionId`.
 * Kural core `lib/finance-self-evaluations.ts`'tedir. Personel üyelikten (Better Auth `memberships`,
 * `users`) ve dönemin performans kaydından yalnız okunur.
 */

const templateOf = (institutionId: string) =>
  eq(selfEvaluationTemplates.institutionId, institutionId)
const responseOf = (institutionId: string) =>
  eq(selfEvaluationResponses.institutionId, institutionId)

// --- Şablon --------------------------------------------------------------------------------------

export interface StoredSelfEvaluationTemplate {
  id: string
  periodId: string
  questions: SelfEvaluationQuestion[]
  createdAt: string
  updatedAt: string
  version: number
}

const TEMPLATE_COLUMNS = {
  id: selfEvaluationTemplates.id,
  periodId: selfEvaluationTemplates.periodId,
  questions: selfEvaluationTemplates.questions,
  createdAt: selfEvaluationTemplates.createdAt,
  updatedAt: selfEvaluationTemplates.updatedAt,
  version: selfEvaluationTemplates.version,
}

const toTemplate = (row: {
  id: string
  periodId: string
  questions: SelfEvaluationQuestion[]
  createdAt: Date
  updatedAt: Date
  version: number
}): StoredSelfEvaluationTemplate => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

export async function findSelfEvaluationTemplate(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredSelfEvaluationTemplate | null> {
  const [row] = await db
    .select(TEMPLATE_COLUMNS)
    .from(selfEvaluationTemplates)
    .where(and(templateOf(institutionId), eq(selfEvaluationTemplates.id, id)))
    .limit(1)
  return row === undefined ? null : toTemplate(row)
}

export async function findPeriodTemplate(
  db: Database,
  institutionId: string,
  periodId: string,
): Promise<StoredSelfEvaluationTemplate | null> {
  const [row] = await db
    .select(TEMPLATE_COLUMNS)
    .from(selfEvaluationTemplates)
    .where(and(templateOf(institutionId), eq(selfEvaluationTemplates.periodId, periodId)))
    .limit(1)
  return row === undefined ? null : toTemplate(row)
}

export async function insertSelfEvaluationTemplate(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    periodId: string
    questions: SelfEvaluationQuestion[]
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...rest } = input
  await tx
    .insert(selfEvaluationTemplates)
    .values({ institutionId, ...rest, createdAt: now, updatedAt: now })
}

/** Soru düzeltmesi; sürüm tutmazsa `false` (409). */
export async function updateSelfEvaluationTemplate(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; questions: SelfEvaluationQuestion[]; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(selfEvaluationTemplates)
    .set({
      questions: input.questions,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        templateOf(institutionId),
        eq(selfEvaluationTemplates.id, input.id),
        eq(selfEvaluationTemplates.version, input.expectedVersion),
      ),
    )
    .returning({ id: selfEvaluationTemplates.id })
  return rows.length === 1
}

/** Dönemde açılmış yanıt sayısı (şablon kilidi; K-448). */
export async function periodResponseCount(
  db: Database,
  institutionId: string,
  periodId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(selfEvaluationResponses)
    .where(and(responseOf(institutionId), eq(selfEvaluationResponses.periodId, periodId)))
  return row?.total ?? 0
}

/** Dönemin personel sayısı (performans kaydı) ve yanıt durumları (K-450). */
export async function selfEvaluationCounts(
  db: Database,
  institutionId: string,
  periodId: string,
): Promise<{ enrolled: number; submitted: number; draft: number }> {
  const [enrolled] = await db
    .select({ total: count() })
    .from(performanceReviews)
    .where(
      and(
        eq(performanceReviews.institutionId, institutionId),
        eq(performanceReviews.periodId, periodId),
      ),
    )
  const rows = await db
    .select({ status: selfEvaluationResponses.status, total: count() })
    .from(selfEvaluationResponses)
    .where(and(responseOf(institutionId), eq(selfEvaluationResponses.periodId, periodId)))
    .groupBy(selfEvaluationResponses.status)
  const of = (status: SelfEvaluationStatus) => rows.find((row) => row.status === status)?.total ?? 0
  return { enrolled: enrolled?.total ?? 0, submitted: of('submitted'), draft: of('draft') }
}

// --- Takip listesi -------------------------------------------------------------------------------

export interface SelfEvaluationTrackingRow {
  membershipId: string
  staffName: string
  staffRole: string
  responseId: string | null
  status: SelfEvaluationTrackingStatus
  channel: SelfEvaluationChannel | null
  submittedAt: string | null
  reopenCount: number
  hasManagerComment: boolean
  updatedAt: string | null
}

export interface SelfEvaluationTrackingQuery {
  page: number
  pageSize: number
  q?: string | undefined
  status?: SelfEvaluationTrackingStatus | undefined
}

const reviewJoin = and(
  eq(selfEvaluationResponses.institutionId, performanceReviews.institutionId),
  eq(selfEvaluationResponses.periodId, performanceReviews.periodId),
  eq(selfEvaluationResponses.membershipId, performanceReviews.membershipId),
)
const memberJoin = and(
  eq(memberships.institutionId, performanceReviews.institutionId),
  eq(memberships.id, performanceReviews.membershipId),
)

/**
 * Dönemin personeli (performans kaydı) ve öz değerlendirme durumu, personel adına göre. Yanıtı
 * olmayan personel `missing`. Cevap ve görüş metni dönmez.
 */
export async function listSelfEvaluationTracking(
  db: Database,
  institutionId: string,
  periodId: string,
  query: SelfEvaluationTrackingQuery,
): Promise<{ items: SelfEvaluationTrackingRow[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const statusFilter = (): SQL | undefined => {
    if (query.status === undefined) return undefined
    if (query.status === 'missing') return isNull(selfEvaluationResponses.id)
    return eq(selfEvaluationResponses.status, query.status)
  }
  const where = and(
    eq(performanceReviews.institutionId, institutionId),
    eq(performanceReviews.periodId, periodId),
    search === undefined ? undefined : sql`strpos(${foldSql(users.name)}, ${search}) > 0`,
    statusFilter(),
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(performanceReviews)
    .innerJoin(memberships, memberJoin)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(selfEvaluationResponses, reviewJoin)
    .where(where)
  const rows = await db
    .select({
      membershipId: performanceReviews.membershipId,
      staffName: users.name,
      staffRole: memberships.role,
      responseId: selfEvaluationResponses.id,
      status: selfEvaluationResponses.status,
      channel: selfEvaluationResponses.channel,
      submittedAt: selfEvaluationResponses.submittedAt,
      reopenCount: selfEvaluationResponses.reopenCount,
      managerComment: selfEvaluationResponses.managerComment,
      updatedAt: selfEvaluationResponses.updatedAt,
    })
    .from(performanceReviews)
    .innerJoin(memberships, memberJoin)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(selfEvaluationResponses, reviewJoin)
    .where(where)
    .orderBy(asc(foldSql(users.name)), asc(performanceReviews.membershipId))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return {
    items: rows.map((row) => ({
      membershipId: row.membershipId,
      staffName: row.staffName,
      staffRole: row.staffRole,
      responseId: row.responseId,
      status: row.status ?? 'missing',
      channel: row.channel,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      reopenCount: row.reopenCount ?? 0,
      hasManagerComment: row.managerComment !== null,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    })),
    total: totalRow?.total ?? 0,
  }
}

// --- Yanıt ---------------------------------------------------------------------------------------

export interface StoredSelfEvaluation {
  id: string
  periodId: string
  templateId: string
  membershipId: string
  staffName: string
  staffRole: string
  answers: SelfEvaluationAnswer[]
  status: SelfEvaluationStatus
  channel: SelfEvaluationChannel
  submittedAt: string | null
  managerComment: string | null
  managerCommentByName: string | null
  managerCommentAt: string | null
  reopenCount: number
  reopenedAt: string | null
  reopenReason: string | null
  createdAt: string
  updatedAt: string
  version: number
}

const RESPONSE_COLUMNS = {
  id: selfEvaluationResponses.id,
  periodId: selfEvaluationResponses.periodId,
  templateId: selfEvaluationResponses.templateId,
  membershipId: selfEvaluationResponses.membershipId,
  staffName: users.name,
  staffRole: memberships.role,
  answers: selfEvaluationResponses.answers,
  status: selfEvaluationResponses.status,
  channel: selfEvaluationResponses.channel,
  submittedAt: selfEvaluationResponses.submittedAt,
  managerComment: selfEvaluationResponses.managerComment,
  managerCommentByName: selfEvaluationResponses.managerCommentByName,
  managerCommentAt: selfEvaluationResponses.managerCommentAt,
  reopenCount: selfEvaluationResponses.reopenCount,
  reopenedAt: selfEvaluationResponses.reopenedAt,
  reopenReason: selfEvaluationResponses.reopenReason,
  createdAt: selfEvaluationResponses.createdAt,
  updatedAt: selfEvaluationResponses.updatedAt,
  version: selfEvaluationResponses.version,
}

type DateKey = 'submittedAt' | 'managerCommentAt' | 'reopenedAt' | 'createdAt' | 'updatedAt'
type ResponseRow = Omit<StoredSelfEvaluation, DateKey> & {
  submittedAt: Date | null
  managerCommentAt: Date | null
  reopenedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
const toResponse = (row: ResponseRow): StoredSelfEvaluation => ({
  ...row,
  submittedAt: row.submittedAt?.toISOString() ?? null,
  managerCommentAt: row.managerCommentAt?.toISOString() ?? null,
  reopenedAt: row.reopenedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

export async function findSelfEvaluation(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredSelfEvaluation | null> {
  const [row] = await db
    .select(RESPONSE_COLUMNS)
    .from(selfEvaluationResponses)
    .innerJoin(
      memberships,
      and(
        eq(memberships.institutionId, selfEvaluationResponses.institutionId),
        eq(memberships.id, selfEvaluationResponses.membershipId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(responseOf(institutionId), eq(selfEvaluationResponses.id, id)))
    .limit(1)
  return row === undefined ? null : toResponse(row)
}

/** Personelin dönemde performans kaydı ve yanıtı var mı (K-449). */
export async function selfEvaluationStanding(
  db: Database,
  institutionId: string,
  periodId: string,
  membershipId: string,
): Promise<{ enrolled: boolean; duplicate: boolean }> {
  const [review] = await db
    .select({ id: performanceReviews.id })
    .from(performanceReviews)
    .where(
      and(
        eq(performanceReviews.institutionId, institutionId),
        eq(performanceReviews.periodId, periodId),
        eq(performanceReviews.membershipId, membershipId),
      ),
    )
    .limit(1)
  const [response] = await db
    .select({ id: selfEvaluationResponses.id })
    .from(selfEvaluationResponses)
    .where(
      and(
        responseOf(institutionId),
        eq(selfEvaluationResponses.periodId, periodId),
        eq(selfEvaluationResponses.membershipId, membershipId),
      ),
    )
    .limit(1)
  return { enrolled: review !== undefined, duplicate: response !== undefined }
}

export async function insertSelfEvaluation(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    periodId: string
    templateId: string
    membershipId: string
    answers: SelfEvaluationAnswer[]
    channel: SelfEvaluationChannel
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...rest } = input
  await tx
    .insert(selfEvaluationResponses)
    .values({ institutionId, ...rest, createdAt: now, updatedAt: now })
}

const versioned = (institutionId: string, id: string, expectedVersion: number) =>
  and(
    responseOf(institutionId),
    eq(selfEvaluationResponses.id, id),
    eq(selfEvaluationResponses.version, expectedVersion),
  )

/** Kısmi düzeltme; sürüm tutmazsa `false` (409). Görüş yazılınca yazan ve an işaretlenir. */
export async function updateSelfEvaluation(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    patch: SelfEvaluationPatch
    actorName: string
    now: Date
  },
): Promise<boolean> {
  const { patch } = input
  const rows = await tx
    .update(selfEvaluationResponses)
    .set({
      ...(patch.answers === undefined ? {} : { answers: patch.answers }),
      ...(patch.channel === undefined ? {} : { channel: patch.channel }),
      ...(patch.managerComment === undefined
        ? {}
        : {
            managerComment: patch.managerComment,
            managerCommentByName: patch.managerComment === null ? null : input.actorName,
            managerCommentAt: patch.managerComment === null ? null : input.now,
          }),
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(versioned(institutionId, input.id, input.expectedVersion))
    .returning({ id: selfEvaluationResponses.id })
  return rows.length === 1
}

/** Gönderim; sürüm tutmazsa `false` (409). */
export async function submitSelfEvaluation(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(selfEvaluationResponses)
    .set({
      status: 'submitted',
      submittedAt: input.now,
      submittedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(versioned(institutionId, input.id, input.expectedVersion))
    .returning({ id: selfEvaluationResponses.id })
  return rows.length === 1
}

/** Geri açma: taslağa döner, son gerekçe ve açan saklanır; sürüm tutmazsa `false` (409). */
export async function reopenSelfEvaluation(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; reason: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(selfEvaluationResponses)
    .set({
      status: 'draft',
      submittedAt: null,
      submittedByUserId: null,
      reopenCount: sql`${selfEvaluationResponses.reopenCount} + 1`,
      reopenedAt: input.now,
      reopenedByUserId: input.userId,
      reopenReason: input.reason,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(versioned(institutionId, input.id, input.expectedVersion))
    .returning({ id: selfEvaluationResponses.id })
  return rows.length === 1
}
