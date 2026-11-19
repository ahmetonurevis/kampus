import { randomUUID } from 'node:crypto'

import {
  isPerformanceScored,
  performanceOverallScore,
  performancePeriodInputSchema,
  performanceReviewCreateSchema,
  performanceReviewUpdateSchema,
  planPerformancePeriodStatus,
  planPerformanceReview,
  planPerformanceReviewUpdate,
} from '@kampus/school-core/lib/finance-performance.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import { findUserName } from '../db/finance-staff-certificates.ts'
import {
  findPerformancePeriod,
  findPerformanceReview,
  findPerformanceStaff,
  insertPerformancePeriod,
  insertPerformanceReview,
  listPerformancePeriods,
  listPerformanceReviews,
  performanceProgress,
  performanceReviewExists,
  unscoredReviewCount,
  updatePerformancePeriodStatus,
  updatePerformanceReview,
  type PerformancePeriodQuery,
  type StoredPerformancePeriod,
  type StoredPerformanceReview,
} from '../db/finance-performance.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Personel performans dönemi (DOM-FIN-124; ON-211). Kural core `lib/finance-performance.ts`'tedir;
 * servis kurum kilidi altında dönemi, kaydı ve üyeliği yükler, tek transaction'da yazar ve
 * denetime alan adlarını yazar. Performans kaydı okuması aynı transaction'da
 * `finance.performance_review.read` denetimine düşer (K-429); dönem listesi kişisel veri taşımaz.
 * Rol ve modül denetimi rotadadır.
 */

const PERIOD_ENTITY = 'performance_periods'
const REVIEW_ENTITY = 'performance_reviews'
const READ_ACTION = 'finance.performance_review.read'

function periodView(
  period: StoredPerformancePeriod,
  progress: { reviewCount: number; scoredCount: number } | undefined,
) {
  return {
    ...period,
    reviewCount: progress?.reviewCount ?? 0,
    scoredCount: progress?.scoredCount ?? 0,
  }
}

export function performanceReviewView(review: StoredPerformanceReview) {
  return {
    ...review,
    overallScore: performanceOverallScore(review.goals),
    scored: isPerformanceScored(review.goals),
  }
}

export async function listPerformancePeriodsFor(
  ctx: ServiceContext,
  query: PerformancePeriodQuery,
) {
  const { items, total } = await listPerformancePeriods(ctx.db, ctx.institutionId, query)
  const progress = await performanceProgress(
    ctx.db,
    ctx.institutionId,
    items.map((item) => item.id),
  )
  return { items: items.map((item) => periodView(item, progress.get(item.id))), total }
}

/**
 * Dönemin personel kayıtları (hedef, ara görüşme, puan, görüş). Okuma aynı transaction'da denetime
 * yazılır: dönem kimliği, dönen kayıt sayısı ve alan adları (K-429); denetim yazılamazsa yanıt
 * dönmez. Başka kurumun dönemi 404.
 */
export async function listPerformanceReviewsFor(
  ctx: ServiceContext,
  periodId: string,
  query: { page: number; pageSize: number; q?: string | undefined },
) {
  return ctx.db.transaction(async (tx) => {
    const period = await findPerformancePeriod(tx, ctx.institutionId, periodId)
    if (period === null) throw new NotFoundError()
    const { items, total } = await listPerformanceReviews(tx, ctx.institutionId, periodId, query)
    await tx.insert(auditLog).values({
      institutionId: ctx.institutionId,
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action: READ_ACTION,
      entityType: PERIOD_ENTITY,
      entityId: periodId,
      // kvkk: değer değil, dönen kişisel alanların adı ve kayıt sayısı.
      changes: {
        fields: ['staffName', 'goals', 'interimNote', 'staffComment', 'evaluatorName'],
        counts: { reviews: items.length },
      },
      createdAt: ctx.now,
    })
    return { items: items.map(performanceReviewView), total }
  })
}

async function periodBody(tx: Database, ctx: ServiceContext, id: string) {
  const saved = await findPerformancePeriod(tx, ctx.institutionId, id)
  if (saved === null) throw new Error('performance period was not written')
  const progress = await performanceProgress(tx, ctx.institutionId, [id])
  return periodView(saved, progress.get(id))
}

async function reviewBody(tx: Database, ctx: ServiceContext, id: string) {
  const saved = await findPerformanceReview(tx, ctx.institutionId, id)
  if (saved === null) throw new Error('performance review was not written')
  return performanceReviewView(saved)
}

/** Yeni dönem (planlama aşamasında). `Idempotency-Key` rotada zorunludur. 201. */
export function createPerformancePeriodCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: PERIOD_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.performance_period.create',
      collections: [],
      entity,
      load: () => Promise.resolve({ run: () => performancePeriodInputSchema.parse(input) }),
      after: async (tx, parsed) => {
        await insertPerformancePeriod(tx, ctx.institutionId, {
          id,
          ...parsed,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.performance_period.create', entity, [
          'name',
          'startDate',
          'endDate',
          'status',
        ])
        body = { data: await periodBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Aşama geçişi (K-427): yalnız sonraki aşama; kapanış bütün kayıtların puanını ister. */
export function changePerformancePeriodStatusCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: PERIOD_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.performance_period.status',
      collections: [],
      entity,
      load: async (tx) => {
        const period = await findPerformancePeriod(tx, ctx.institutionId, id)
        if (period === null) throw new NotFoundError()
        if (period.version !== expectedVersion) throw new ConflictError()
        const unscoredCount = await unscoredReviewCount(tx, ctx.institutionId, id)
        return { run: () => planPerformancePeriodStatus(period, input, { unscoredCount }) }
      },
      after: async (tx, status) => {
        const saved = await updatePerformancePeriodStatus(tx, ctx.institutionId, {
          id,
          expectedVersion,
          status,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.performance_period.status', entity, [
          'status',
          ...(status === 'closed' ? ['closedAt'] : []),
        ])
        body = { data: await periodBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Döneme personel ekler (hedeflerle; K-428). `Idempotency-Key` rotada zorunludur: çift gönderim
 * ikinci kayıt açmaz. Başka kurumun dönemi 404. 201.
 */
export function createPerformanceReviewCommand(
  ctx: ServiceContext,
  periodId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: REVIEW_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.performance_review.create',
      collections: [],
      entity,
      load: async (tx) => {
        const period = await findPerformancePeriod(tx, ctx.institutionId, periodId)
        if (period === null) throw new NotFoundError()
        const parsed = performanceReviewCreateSchema.parse(input)
        const [staff, duplicate] = await Promise.all([
          findPerformanceStaff(tx, ctx.institutionId, parsed.membershipId),
          performanceReviewExists(tx, ctx.institutionId, periodId, parsed.membershipId),
        ])
        return {
          run: () => ({
            membershipId: parsed.membershipId,
            goals: planPerformanceReview(parsed, {
              period,
              staff,
              duplicate,
              actorUserId: ctx.actor.userId,
            }),
          }),
        }
      },
      after: async (tx, plan) => {
        await insertPerformanceReview(tx, ctx.institutionId, {
          id,
          periodId,
          membershipId: plan.membershipId,
          goals: plan.goals,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.performance_review.create', entity, [
          'membershipId',
          'goals',
        ])
        body = { data: await reviewBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/**
 * Kayıt düzeltmesi (K-428): hedef, ara görüşme, puan ve personel görüşü aşamaya göre; kapanmış
 * dönem 409. Puan yazan yönetici değerlendiren olur. Not ve görüş metni denetime yazılmaz.
 */
export function updatePerformanceReviewCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: REVIEW_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.performance_review.update',
      collections: [],
      entity,
      load: async (tx) => {
        const review = await findPerformanceReview(tx, ctx.institutionId, id)
        if (review === null) throw new NotFoundError()
        const period = await findPerformancePeriod(tx, ctx.institutionId, review.periodId)
        if (period === null) throw new NotFoundError()
        const parsed = performanceReviewUpdateSchema.parse(input)
        if (review.version !== expectedVersion) throw new ConflictError()
        const evaluatorName = await findUserName(tx, ctx.actor.userId)
        return {
          run: () => ({
            patch: planPerformanceReviewUpdate(review, period, parsed, dayKey(ctx.now)),
            evaluatorName: evaluatorName ?? '—',
          }),
        }
      },
      after: async (tx, plan) => {
        const saved = await updatePerformanceReview(tx, ctx.institutionId, {
          id,
          expectedVersion,
          patch: plan.patch,
          evaluator: { userId: ctx.actor.userId, name: plan.evaluatorName },
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          'finance.performance_review.update',
          entity,
          Object.entries(plan.patch)
            .filter(([, value]) => value !== undefined)
            .map(([key]) => (key === 'evaluated' ? 'evaluatorUserId' : key)),
        )
        body = { data: await reviewBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
