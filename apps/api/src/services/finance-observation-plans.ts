import { randomUUID } from 'node:crypto'

import {
  planLessonObservation,
  type ObservationPeriodCheck,
} from '@kampus/school-core/lib/finance-lesson-observations.ts'
import {
  canViewObservationPlan,
  isObservationPlanOverdue,
  observationPlanCancelSchema,
  observationPlanCreateSchema,
  observationPlanPostponeSchema,
  observationPlanStartSchema,
  observationPlanUpdateSchema,
  planEndTime,
  planObservationPlan,
  planObservationPlanCancel,
  planObservationPlanPostpone,
  planObservationPlanStart,
  planObservationPlanUpdate,
  type ObservationPlanNoticeKind,
  type ObservationPlanState,
} from '@kampus/school-core/lib/finance-observation-plans.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import {
  findObservationMember,
  findObservationTemplate,
  insertLessonObservation,
  observationRecordExists,
  observationRecordNames,
} from '../db/finance-lesson-observations.ts'
import {
  busyObservationPlans,
  cancelObservationPlan,
  findObservationPlan,
  findPlanTemplateVersion,
  insertObservationPlan,
  insertPlanNotice,
  linkObservationPlan,
  listObservationPlans,
  listPlanNotices,
  pendingNoticeCounts,
  postponeObservationPlan,
  teacherPlanCountInPeriod,
  updateObservationPlan,
  type ObservationPlanQuery,
  type StoredObservationPlan,
} from '../db/finance-observation-plans.ts'
import { findPerformancePeriod } from '../db/finance-performance.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Ders gözlem planı (DOM-FIN-139; ON-207). Kural core `lib/finance-observation-plans.ts`'tedir;
 * servis kurum kilidi altında planı, üyelikleri, formu, dönemi ve aynı gündeki planları yükler
 * (çakışma ve dönem sınırı kilit altında sayılır), tek transaction'da yazar, öğretmene
 * "gönderilecek" bildirim kaydı ekler (K-474; gönderim yok) ve denetime alan adlarını yazar
 * (gerekçe ve not metni yazılmaz). Gözlemi plandan başlatma DOM-FIN-130 gözlem açma kuralını
 * çalıştırır ve gözlemi plana bağlar (K-473). Rol ve modül denetimi rotadadır.
 */

const ENTITY = 'observation_plans'
const OBSERVATION_ENTITY = 'lesson_observations'

/** Tek kayıtlık görünüm dizisinin elemanı; görünüm satır düşürmez. */
function only<T>(items: readonly T[]): T {
  const [item] = items
  if (item === undefined) throw new Error('view row was not built')
  return item
}

async function planViews(
  db: Database,
  ctx: ServiceContext,
  items: readonly StoredObservationPlan[],
) {
  const today = dayKey(ctx.now)
  const [classes, subjects, notices] = await Promise.all([
    observationRecordNames(
      db,
      ctx.institutionId,
      'classes',
      items.map((item) => item.classId),
    ),
    observationRecordNames(
      db,
      ctx.institutionId,
      'subjects',
      items.map((item) => item.subjectId),
    ),
    pendingNoticeCounts(
      db,
      ctx.institutionId,
      items.map((item) => item.id),
    ),
  ])
  return items.map((item) => ({
    ...item,
    endTime: planEndTime(item.startTime, item.durationMinutes),
    className: item.classId === null ? null : (classes.get(item.classId) ?? null),
    subjectName: item.subjectId === null ? null : (subjects.get(item.subjectId) ?? null),
    overdue: isObservationPlanOverdue(item, today),
    pendingNoticeCount: notices.get(item.id) ?? 0,
  }))
}

/** Öğretmen için satır süzgeci; yönetici süzülmez (K-474). */
const viewerFilter = (ctx: ServiceContext) =>
  ctx.actor.role === 'yonetici' ? null : ctx.actor.membershipId

/** Planlar (takvim ve geciken planlar); öğretmen yalnız kendi planlarını görür. */
export async function listObservationPlansFor(ctx: ServiceContext, query: ObservationPlanQuery) {
  const { items, total } = await listObservationPlans(
    ctx.db,
    ctx.institutionId,
    query,
    viewerFilter(ctx),
    dayKey(ctx.now),
  )
  return { items: await planViews(ctx.db, ctx, items), total }
}

/** Tek plan ve bildirimleri; görülemeyen ya da başka kurumun planı 404 (K-474). */
export async function getObservationPlanFor(ctx: ServiceContext, id: string) {
  const plan = await findObservationPlan(ctx.db, ctx.institutionId, id)
  if (plan === null || !canViewObservationPlan(ctx.actor, plan)) throw new NotFoundError()
  const [view, notices] = await Promise.all([
    planViews(ctx.db, ctx, [plan]),
    listPlanNotices(ctx.db, ctx.institutionId, id),
  ])
  return { ...only(view), notices }
}

async function planBody(tx: Database, ctx: ServiceContext, id: string) {
  const saved = await findObservationPlan(tx, ctx.institutionId, id)
  if (saved === null) throw new Error('observation plan was not written')
  return only(await planViews(tx, ctx, [saved]))
}

/** Dönem bağı: `null`/`undefined` kimlikte `undefined` (istenmedi), kurumda yoksa `null`. */
async function periodCheck(
  tx: Database,
  ctx: ServiceContext,
  periodId: string | null | undefined,
): Promise<ObservationPeriodCheck> {
  if (periodId === null || periodId === undefined) return undefined
  return findPerformancePeriod(tx, ctx.institutionId, periodId)
}

async function planCount(
  tx: Database,
  ctx: ServiceContext,
  input: { teacherMembershipId: string; periodId: string | null | undefined; excludeId?: string },
): Promise<number> {
  if (input.periodId === null || input.periodId === undefined) return 0
  return teacherPlanCountInPeriod(tx, ctx.institutionId, {
    teacherMembershipId: input.teacherMembershipId,
    performancePeriodId: input.periodId,
    ...(input.excludeId === undefined ? {} : { excludeId: input.excludeId }),
  })
}

/** Formun son sürümü (yoksa `null`). */
async function templateCheck(tx: Database, ctx: ServiceContext, templateId: string) {
  const template = await findObservationTemplate(tx, ctx.institutionId, templateId)
  return template === null
    ? null
    : { archived: template.archivedAt !== null, versionId: template.versionId }
}

async function notice(
  tx: Database,
  ctx: ServiceContext,
  input: {
    planId: string
    teacherMembershipId: string
    kind: ObservationPlanNoticeKind
    plannedDate: string
    startTime: string
  },
) {
  await insertPlanNotice(tx, ctx.institutionId, {
    id: randomUUID(),
    planId: input.planId,
    recipientMembershipId: input.teacherMembershipId,
    kind: input.kind,
    plannedDate: input.plannedDate,
    startTime: input.startTime,
    now: ctx.now,
  })
}

/**
 * Yeni plan (K-472): form (son sürümü yazılır), öğretmen, gözlemci, gün, saat, süre ve isteğe
 * bağlı sınıf/ders/dönem/not. Öğretmene "planlandı" bildirimi gönderilecek olarak yazılır.
 * `Idempotency-Key` rotada zorunludur. 201.
 */
export function createObservationPlanCommand(
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
      action: 'finance.observation_plan.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = observationPlanCreateSchema.parse(input)
        const [template, teacher, observer, classFound, subjectFound, period, count, busy] =
          await Promise.all([
            templateCheck(tx, ctx, parsed.templateId),
            findObservationMember(tx, ctx.institutionId, parsed.teacherMembershipId),
            findObservationMember(tx, ctx.institutionId, parsed.observerMembershipId),
            observationRecordExists(tx, ctx.institutionId, 'classes', parsed.classId),
            observationRecordExists(tx, ctx.institutionId, 'subjects', parsed.subjectId),
            periodCheck(tx, ctx, parsed.performancePeriodId),
            planCount(tx, ctx, {
              teacherMembershipId: parsed.teacherMembershipId,
              periodId: parsed.performancePeriodId,
            }),
            busyObservationPlans(tx, ctx.institutionId, {
              plannedDate: parsed.plannedDate,
              membershipIds: [parsed.teacherMembershipId, parsed.observerMembershipId],
            }),
          ])
        return {
          run: () =>
            planObservationPlan(parsed, {
              template,
              teacher,
              observer,
              classFound,
              subjectFound,
              period,
              teacherPlansInPeriod: count,
              busy,
              today: dayKey(ctx.now),
            }),
        }
      },
      after: async (tx, plan) => {
        await insertObservationPlan(tx, ctx.institutionId, {
          id,
          ...plan,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await notice(tx, ctx, { planId: id, kind: 'scheduled', ...plan })
        await auditWork(tx, ctx, 'finance.observation_plan.create', entity, [
          'teacherMembershipId',
          'observerMembershipId',
          'templateVersionId',
          'plannedDate',
          'startTime',
          'durationMinutes',
          ...(plan.classId === null ? [] : ['classId']),
          ...(plan.subjectId === null ? [] : ['subjectId']),
          ...(plan.performancePeriodId === null ? [] : ['performancePeriodId']),
          ...(plan.note === null ? [] : ['note']),
        ])
        body = { data: await planBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

async function loadPlanForWrite(
  tx: Database,
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
): Promise<StoredObservationPlan & ObservationPlanState> {
  const plan = await findObservationPlan(tx, ctx.institutionId, id)
  if (plan === null) throw new NotFoundError()
  if (plan.version !== expectedVersion) throw new ConflictError()
  return plan
}

/**
 * Açık planın düzeltmesi (K-472). Gün, saat, süre ya da gözlemci değişirse öğretmene "plan
 * değişti" bildirimi gönderilecek olarak yazılır. Not metni denetime yazılmaz.
 */
export function updateObservationPlanCommand(
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
      action: 'finance.observation_plan.update',
      collections: [],
      entity,
      load: async (tx) => {
        const plan = await loadPlanForWrite(tx, ctx, id, expectedVersion)
        const parsed = observationPlanUpdateSchema.parse(input)
        const observerId = parsed.observerMembershipId ?? plan.observerMembershipId
        const periodId =
          parsed.performancePeriodId === undefined
            ? plan.performancePeriodId
            : parsed.performancePeriodId
        const [template, teacher, observer, classFound, subjectFound, period, count, busy] =
          await Promise.all([
            parsed.templateId === undefined ? undefined : templateCheck(tx, ctx, parsed.templateId),
            findObservationMember(tx, ctx.institutionId, plan.teacherMembershipId),
            findObservationMember(tx, ctx.institutionId, observerId),
            observationRecordExists(tx, ctx.institutionId, 'classes', parsed.classId),
            observationRecordExists(tx, ctx.institutionId, 'subjects', parsed.subjectId),
            periodCheck(tx, ctx, periodId),
            planCount(tx, ctx, {
              teacherMembershipId: plan.teacherMembershipId,
              periodId,
              excludeId: id,
            }),
            busyObservationPlans(tx, ctx.institutionId, {
              plannedDate: parsed.plannedDate ?? plan.plannedDate,
              membershipIds: [plan.teacherMembershipId, observerId],
              excludeId: id,
            }),
          ])
        return {
          run: () => ({
            plan,
            ...planObservationPlanUpdate(plan, parsed, {
              template,
              teacher,
              observer,
              classFound,
              subjectFound,
              period,
              teacherPlansInPeriod: count,
              busy,
              today: dayKey(ctx.now),
            }),
          }),
        }
      },
      after: async (tx, { plan, patch, notify }) => {
        const saved = await updateObservationPlan(tx, ctx.institutionId, {
          id,
          expectedVersion,
          patch,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        if (notify)
          await notice(tx, ctx, {
            planId: id,
            teacherMembershipId: plan.teacherMembershipId,
            kind: 'changed',
            plannedDate: patch.plannedDate ?? plan.plannedDate,
            startTime: patch.startTime ?? plan.startTime,
          })
        await auditWork(
          tx,
          ctx,
          'finance.observation_plan.update',
          entity,
          Object.entries(patch)
            .filter(([, value]) => value !== undefined)
            .map(([key]) => key),
        )
        body = { data: await planBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Erteleme (K-472): yeni gün ve saat, gerekçe; öğretmene "ertelendi" bildirimi. */
export function postponeObservationPlanCommand(
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
      action: 'finance.observation_plan.postpone',
      collections: [],
      entity,
      load: async (tx) => {
        const plan = await loadPlanForWrite(tx, ctx, id, expectedVersion)
        const parsed = observationPlanPostponeSchema.parse(input)
        const [period, busy] = await Promise.all([
          periodCheck(tx, ctx, plan.performancePeriodId),
          busyObservationPlans(tx, ctx.institutionId, {
            plannedDate: parsed.plannedDate,
            membershipIds: [plan.teacherMembershipId, plan.observerMembershipId],
            excludeId: id,
          }),
        ])
        return {
          run: () => ({
            plan,
            next: planObservationPlanPostpone(plan, parsed, {
              period,
              busy,
              today: dayKey(ctx.now),
            }),
          }),
        }
      },
      after: async (tx, { plan, next }) => {
        const saved = await postponeObservationPlan(tx, ctx.institutionId, {
          id,
          expectedVersion,
          ...next,
          postponeCount: plan.postponeCount + 1,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await notice(tx, ctx, {
          planId: id,
          teacherMembershipId: plan.teacherMembershipId,
          kind: 'postponed',
          plannedDate: next.plannedDate,
          startTime: next.startTime,
        })
        await auditWork(tx, ctx, 'finance.observation_plan.postpone', entity, [
          'status',
          'plannedDate',
          'startTime',
          'durationMinutes',
          'postponeReason',
          'postponeCount',
        ])
        body = { data: await planBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** İptal (K-472): gerekçeyle; öğretmene "iptal edildi" bildirimi. */
export function cancelObservationPlanCommand(
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
      action: 'finance.observation_plan.cancel',
      collections: [],
      entity,
      load: async (tx) => {
        const plan = await loadPlanForWrite(tx, ctx, id, expectedVersion)
        const parsed = observationPlanCancelSchema.parse(input)
        return { run: () => ({ plan, ...planObservationPlanCancel(plan, parsed) }) }
      },
      after: async (tx, { plan, reason }) => {
        const saved = await cancelObservationPlan(tx, ctx.institutionId, {
          id,
          expectedVersion,
          reason,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await notice(tx, ctx, {
          planId: id,
          teacherMembershipId: plan.teacherMembershipId,
          kind: 'cancelled',
          plannedDate: plan.plannedDate,
          startTime: plan.startTime,
        })
        await auditWork(tx, ctx, 'finance.observation_plan.cancel', entity, [
          'status',
          'cancelReason',
          'cancelledAt',
        ])
        body = { data: await planBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Gözlemi başlatma (K-473): plan günü geldiyse planın form sürümüyle gözlem taslağı açılır
 * (DOM-FIN-130 gözlem açma kuralı: form arşivli değil, öğretmen ve gözlemci hâlâ etkin, dönem
 * kapanmamış) ve plana bağlanır; gözlemin günü plan günüdür. Sınıf ve ders plandakidir
 * (yabancı anahtar korur; sonradan arşivlenen sınıf başlatmayı engellemez).
 */
export function startObservationPlanCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  const observationId = randomUUID()
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.observation_plan.start',
      collections: [],
      entity,
      load: async (tx) => {
        observationPlanStartSchema.parse(input)
        const plan = await loadPlanForWrite(tx, ctx, id, expectedVersion)
        const [version, teacher, observer, period] = await Promise.all([
          findPlanTemplateVersion(tx, ctx.institutionId, plan.templateVersionId),
          findObservationMember(tx, ctx.institutionId, plan.teacherMembershipId),
          findObservationMember(tx, ctx.institutionId, plan.observerMembershipId),
          periodCheck(tx, ctx, plan.performancePeriodId),
        ])
        const today = dayKey(ctx.now)
        return {
          run: () => {
            planObservationPlanStart(plan, today)
            const ratings = planLessonObservation(
              { observedDate: plan.plannedDate },
              {
                template:
                  version === null
                    ? null
                    : { archived: version.archived, criteria: version.criteria },
                teacher,
                observer,
                classFound: null,
                subjectFound: null,
                period,
                today,
              },
            )
            return { plan, ratings }
          },
        }
      },
      after: async (tx, { plan, ratings }) => {
        await insertLessonObservation(tx, ctx.institutionId, {
          id: observationId,
          templateVersionId: plan.templateVersionId,
          teacherMembershipId: plan.teacherMembershipId,
          observerMembershipId: plan.observerMembershipId,
          observedDate: plan.plannedDate,
          classId: plan.classId,
          subjectId: plan.subjectId,
          performancePeriodId: plan.performancePeriodId,
          ratings,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        const linked = await linkObservationPlan(tx, ctx.institutionId, {
          id,
          expectedVersion,
          observationId,
          now: ctx.now,
        })
        if (!linked) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          'finance.lesson_observation.create',
          { type: OBSERVATION_ENTITY, id: observationId },
          [
            'templateVersionId',
            'teacherMembershipId',
            'observerMembershipId',
            'observedDate',
            'observationPlanId',
          ],
        )
        await auditWork(tx, ctx, 'finance.observation_plan.start', entity, ['observationId'])
        body = { data: await planBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
