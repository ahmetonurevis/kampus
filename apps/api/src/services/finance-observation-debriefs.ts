import { randomUUID } from 'node:crypto'

import { canViewLessonObservation } from '@kampus/school-core/lib/finance-lesson-observations.ts'
import {
  canViewDevelopmentGoal,
  canViewObservationDebrief,
  developmentGoalCreateSchema,
  developmentGoalFollowUpSchema,
  developmentGoalOverdueDays,
  developmentGoalUpdateSchema,
  isDevelopmentGoalActive,
  isDevelopmentGoalOverdue,
  observationDebriefCreateSchema,
  observationDebriefFinalizeSchema,
  observationDebriefUpdateSchema,
  planDevelopmentGoal,
  planDevelopmentGoalFollowUp,
  planDevelopmentGoalUpdate,
  planObservationDebrief,
  planObservationDebriefFinalize,
  planObservationDebriefUpdate,
  type DebriefChecks,
  type GoalPeriodCheck,
} from '@kampus/school-core/lib/finance-observation-debriefs.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import { findLessonObservation } from '../db/finance-lesson-observations.ts'
import {
  addGoalFollowUp,
  findDebriefByObservation,
  findDebriefMembers,
  findDevelopmentGoal,
  findObservationDebrief,
  finalizeObservationDebrief,
  insertDevelopmentGoal,
  insertObservationDebrief,
  listDevelopmentGoals,
  listGoalNotes,
  updateDevelopmentGoal,
  updateObservationDebrief,
  type DevelopmentGoalQuery,
  type StoredDevelopmentGoal,
} from '../db/finance-observation-debriefs.ts'
import { findPerformancePeriod } from '../db/finance-performance.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Gözlem sonrası görüşme ve gelişim hedefi (DOM-FIN-133; ON-209). Kural core
 * `lib/finance-observation-debriefs.ts`'tedir; servis kurum kilidi altında gözlemi, görüşmeyi,
 * üyelikleri ve performans dönemini yükler, tek transaction'da yazar ve denetime alan adlarını
 * yazar (metin değil). Okumalar aynı transaction'da `finance.observation_debrief.read` ve
 * `finance.development_goal.read` denetimine düşer (K-456). Öğretmen yalnız gözlemcisi olduğu ve
 * öğretmeni olduğu kayıtları görür, gerisi 404. Rol ve modül denetimi rotadadır.
 */

const DEBRIEF_ENTITY = 'observation_debriefs'
const GOAL_ENTITY = 'staff_development_goals'
const DEBRIEF_FIELDS = ['participants', 'strengths', 'developmentAreas', 'teacherComment']
const GOAL_FIELDS = ['teacherName', 'title', 'successCriterion', 'notes']

/** Öğretmen için satır süzgeci; yönetici süzülmez (K-456). */
const viewerFilter = (ctx: ServiceContext) =>
  ctx.actor.role === 'yonetici' ? null : ctx.actor.membershipId

async function auditRead(
  tx: Database,
  ctx: ServiceContext,
  read: { action: string; entityType: string; entityId: string | null; fields: string[] },
  counts: Record<string, number>,
) {
  await tx.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: read.action,
    entityType: read.entityType,
    entityId: read.entityId,
    // kvkk: değer değil, dönen kişisel alanların adı ve kayıt sayısı.
    changes: { fields: read.fields, counts },
    createdAt: ctx.now,
  })
}

// --- Görüşme -------------------------------------------------------------------------------------

/** Görüşmenin gözlemi; arşivli, görülemeyen ya da başka kurumun gözlemi 404 (K-447). */
async function visibleObservation(tx: Database, ctx: ServiceContext, observationId: string) {
  const observation = await findLessonObservation(tx, ctx.institutionId, observationId)
  if (observation === null || !canViewLessonObservation(ctx.actor, observation))
    throw new NotFoundError()
  return observation
}

/**
 * Gözlemin görüşmesi (K-456): görüşme yoksa ya da öğretmen görüşmeyi henüz göremiyorsa (gözlenen
 * öğretmende taslak) `null`. Okuma denetime düşer.
 */
export async function getObservationDebriefFor(ctx: ServiceContext, observationId: string) {
  return ctx.db.transaction(async (tx) => {
    await visibleObservation(tx, ctx, observationId)
    const debrief = await findDebriefByObservation(tx, ctx.institutionId, observationId)
    const visible = debrief !== null && canViewObservationDebrief(ctx.actor, debrief)
    await auditRead(
      tx,
      ctx,
      {
        action: 'finance.observation_debrief.read',
        entityType: DEBRIEF_ENTITY,
        entityId: visible ? debrief.id : null,
        fields: DEBRIEF_FIELDS,
      },
      { debriefs: visible ? 1 : 0 },
    )
    return visible ? debrief : null
  })
}

async function debriefBody(tx: Database, ctx: ServiceContext, id: string) {
  const saved = await findObservationDebrief(tx, ctx.institutionId, id)
  if (saved === null) throw new Error('observation debrief was not written')
  return saved
}

/** Katılımcı üyelikleri ve önceki liste; core denetimi için. */
async function participantChecks(
  tx: Database,
  ctx: ServiceContext,
  ids: readonly string[] | undefined,
): Promise<DebriefChecks['participants']> {
  const members = await findDebriefMembers(tx, ctx.institutionId, ids ?? [])
  return new Map((ids ?? []).map((id) => [id, members.get(id) ?? null]))
}

/**
 * Yeni görüşme taslağı (K-454): tamamlanmış gözleme en çok bir görüşme; gün ve katılanlar.
 * `Idempotency-Key` rotada zorunludur. 201.
 */
export function createObservationDebriefCommand(
  ctx: ServiceContext,
  observationId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: DEBRIEF_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.observation_debrief.create',
      collections: [],
      entity,
      load: async (tx) => {
        const observation = await findLessonObservation(tx, ctx.institutionId, observationId)
        if (observation === null) throw new NotFoundError()
        const parsed = observationDebriefCreateSchema.parse(input)
        const [existing, participants] = await Promise.all([
          findDebriefByObservation(tx, ctx.institutionId, observationId),
          participantChecks(tx, ctx, parsed.participantMembershipIds),
        ])
        return {
          run: () => {
            planObservationDebrief(parsed, {
              observation,
              participants,
              previousParticipants: [],
              exists: existing !== null,
              today: dayKey(ctx.now),
            })
            return parsed
          },
        }
      },
      after: async (tx, plan) => {
        await insertObservationDebrief(tx, ctx.institutionId, {
          id,
          observationId,
          ...plan,
          newId: randomUUID,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.observation_debrief.create', entity, [
          'observationId',
          'debriefDate',
          'participantMembershipIds',
          ...(plan.strengths === null ? [] : ['strengths']),
          ...(plan.developmentAreas === null ? [] : ['developmentAreas']),
          ...(plan.teacherComment === null ? [] : ['teacherComment']),
        ])
        body = { data: await debriefBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

async function loadDebriefForWrite(
  tx: Database,
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
) {
  const debrief = await findObservationDebrief(tx, ctx.institutionId, id)
  if (debrief === null) throw new NotFoundError()
  if (debrief.version !== expectedVersion) throw new ConflictError()
  return debrief
}

/** Taslak görüşme düzeltmesi (K-454); kesinleşen görüşme 409. Metinler denetime yazılmaz. */
export function updateObservationDebriefCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: DEBRIEF_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.observation_debrief.update',
      collections: [],
      entity,
      load: async (tx) => {
        const debrief = await loadDebriefForWrite(tx, ctx, id, expectedVersion)
        const parsed = observationDebriefUpdateSchema.parse(input)
        const participants = await participantChecks(tx, ctx, parsed.participantMembershipIds)
        return {
          run: () => ({
            debrief,
            patch: planObservationDebriefUpdate(debrief, parsed, {
              observation: {
                status: debrief.observationStatus,
                teacherMembershipId: debrief.teacherMembershipId,
                observedDate: debrief.observedDate,
              },
              participants,
              previousParticipants: debrief.participants.map((row) => row.membershipId),
              today: dayKey(ctx.now),
            }),
          }),
        }
      },
      after: async (tx, { debrief, patch }) => {
        const saved = await updateObservationDebrief(tx, ctx.institutionId, {
          id,
          expectedVersion,
          patch,
          previousParticipants: debrief.participants,
          newId: randomUUID,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.observation_debrief.update', entity, Object.keys(patch))
        body = { data: await debriefBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Kesinleştirme (K-454): güçlü yönler ve gelişim alanları yazılı; sonra değişmez. */
export function finalizeObservationDebriefCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: DEBRIEF_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.observation_debrief.finalize',
      collections: [],
      entity,
      load: async (tx) => {
        observationDebriefFinalizeSchema.parse(input)
        const debrief = await loadDebriefForWrite(tx, ctx, id, expectedVersion)
        return { run: () => planObservationDebriefFinalize(debrief) }
      },
      after: async (tx) => {
        const saved = await finalizeObservationDebrief(tx, ctx.institutionId, {
          id,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.observation_debrief.finalize', entity, [
          'status',
          'finalizedAt',
        ])
        body = { data: await debriefBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Gelişim hedefi ------------------------------------------------------------------------------

function goalView(goal: StoredDevelopmentGoal, today: string) {
  return {
    ...goal,
    active: isDevelopmentGoalActive(goal.status),
    overdue: isDevelopmentGoalOverdue(goal, today),
    overdueDays: developmentGoalOverdueDays(goal, today),
  }
}

export interface DevelopmentGoalListQuery extends Omit<DevelopmentGoalQuery, 'overdueBefore'> {
  overdue?: boolean | undefined
}

/**
 * Gelişim hedefleri (K-456): yönetici hepsini, öğretmen kendi hedefini ve gözlemcisi olduğu
 * gözlemden doğanı görür. `overdue` takip tarihi geçmiş süren hedefleri süzer (K-455). Okuma aynı
 * transaction'da denetime yazılır.
 */
export async function listDevelopmentGoalsFor(
  ctx: ServiceContext,
  query: DevelopmentGoalListQuery,
) {
  const today = dayKey(ctx.now)
  const { overdue, ...rest } = query
  return ctx.db.transaction(async (tx) => {
    const { items, total } = await listDevelopmentGoals(
      tx,
      ctx.institutionId,
      { ...rest, ...(overdue === true ? { overdueBefore: today } : {}) },
      viewerFilter(ctx),
    )
    await auditRead(
      tx,
      ctx,
      {
        action: 'finance.development_goal.read',
        entityType: GOAL_ENTITY,
        entityId: null,
        fields: GOAL_FIELDS.filter((field) => field !== 'notes'),
      },
      { goals: items.length },
    )
    return { items: items.map((goal) => goalView(goal, today)), total }
  })
}

async function goalDetail(tx: Database, ctx: ServiceContext, goal: StoredDevelopmentGoal) {
  const notes = await listGoalNotes(tx, ctx.institutionId, goal.id)
  return { ...goalView(goal, dayKey(ctx.now)), notes }
}

/** Tek hedef ve takip geçmişi; görülemeyen ya da başka kurumun hedefi 404 (K-456). */
export async function getDevelopmentGoalFor(ctx: ServiceContext, id: string) {
  return ctx.db.transaction(async (tx) => {
    const goal = await findDevelopmentGoal(tx, ctx.institutionId, id)
    if (goal === null || !canViewDevelopmentGoal(ctx.actor, goal)) throw new NotFoundError()
    await auditRead(
      tx,
      ctx,
      {
        action: 'finance.development_goal.read',
        entityType: GOAL_ENTITY,
        entityId: id,
        fields: GOAL_FIELDS,
      },
      { goals: 1 },
    )
    return goalDetail(tx, ctx, goal)
  })
}

async function goalBody(tx: Database, ctx: ServiceContext, id: string) {
  const saved = await findDevelopmentGoal(tx, ctx.institutionId, id)
  if (saved === null) throw new Error('development goal was not written')
  return goalDetail(tx, ctx, saved)
}

/** Dönem bağı: boş kimlikte `undefined` (istenmedi), kurumda yoksa `null`. */
async function periodCheck(
  tx: Database,
  ctx: ServiceContext,
  periodId: string | null | undefined,
): Promise<GoalPeriodCheck> {
  if (periodId === null || periodId === undefined) return undefined
  return findPerformancePeriod(tx, ctx.institutionId, periodId)
}

/**
 * Yeni gelişim hedefi (K-455): kaynak gözlem görüşmesi (öğretmen gözlemden) ya da doğrudan
 * (öğretmen gövdeden). `Idempotency-Key` rotada zorunludur. 201.
 */
export function createDevelopmentGoalCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: GOAL_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.development_goal.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = developmentGoalCreateSchema.parse(input)
        const debrief =
          parsed.debriefId === undefined
            ? undefined
            : await findObservationDebrief(tx, ctx.institutionId, parsed.debriefId)
        const teacherId = debrief?.teacherMembershipId ?? parsed.teacherMembershipId
        const [members, period] = await Promise.all([
          findDebriefMembers(tx, ctx.institutionId, teacherId === undefined ? [] : [teacherId]),
          periodCheck(tx, ctx, parsed.performancePeriodId),
        ])
        const teacher = teacherId === undefined ? null : (members.get(teacherId) ?? null)
        return {
          run: () =>
            planDevelopmentGoal(parsed, { debrief, teacher, period, today: dayKey(ctx.now) }),
        }
      },
      after: async (tx, plan) => {
        await insertDevelopmentGoal(tx, ctx.institutionId, {
          id,
          ...plan,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.development_goal.create', entity, [
          'teacherMembershipId',
          'source',
          ...(plan.debriefId === null ? [] : ['debriefId']),
          ...(plan.performancePeriodId === null ? [] : ['performancePeriodId']),
          'title',
          'successCriterion',
          'followUpDate',
        ])
        body = { data: await goalBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

async function loadGoalForWrite(
  tx: Database,
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
) {
  const goal = await findDevelopmentGoal(tx, ctx.institutionId, id)
  if (goal === null) throw new NotFoundError()
  if (goal.version !== expectedVersion) throw new ConflictError()
  return goal
}

/** Süren hedefin düzeltmesi (K-455); kapanan hedef 409. */
export function updateDevelopmentGoalCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: GOAL_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.development_goal.update',
      collections: [],
      entity,
      load: async (tx) => {
        const goal = await loadGoalForWrite(tx, ctx, id, expectedVersion)
        const parsed = developmentGoalUpdateSchema.parse(input)
        const period = await periodCheck(tx, ctx, parsed.performancePeriodId)
        return {
          run: () => planDevelopmentGoalUpdate(goal, parsed, { period, today: dayKey(ctx.now) }),
        }
      },
      after: async (tx, patch) => {
        const saved = await updateDevelopmentGoal(tx, ctx.institutionId, {
          id,
          expectedVersion,
          patch,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.development_goal.update', entity, Object.keys(patch))
        body = { data: await goalBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Takip notu (K-455): not, isteğe bağlı yeni durum ve sonraki takip tarihi; geçmiş değişmez. */
export function followUpDevelopmentGoalCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: GOAL_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.development_goal.follow_up',
      collections: [],
      entity,
      load: async (tx) => {
        const goal = await loadGoalForWrite(tx, ctx, id, expectedVersion)
        const parsed = developmentGoalFollowUpSchema.parse(input)
        return { run: () => planDevelopmentGoalFollowUp(goal, parsed, dayKey(ctx.now)) }
      },
      after: async (tx, plan) => {
        const closing = plan.statusTo !== null && !isDevelopmentGoalActive(plan.statusTo)
        const saved = await addGoalFollowUp(tx, ctx.institutionId, {
          goalId: id,
          noteId: randomUUID(),
          expectedVersion,
          plan,
          closing,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.development_goal.follow_up', entity, [
          'notes',
          ...(plan.statusTo === null ? [] : ['status']),
          ...(plan.nextFollowUpDate === null ? [] : ['followUpDate']),
          ...(closing ? ['closedAt'] : []),
        ])
        body = { data: await goalBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
