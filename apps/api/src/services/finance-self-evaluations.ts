import { randomUUID } from 'node:crypto'

import {
  planSelfEvaluation,
  planSelfEvaluationReopen,
  planSelfEvaluationSubmit,
  planSelfEvaluationTemplate,
  planSelfEvaluationTemplateUpdate,
  planSelfEvaluationUpdate,
  selfEvaluationAnsweredCount,
  selfEvaluationCreateSchema,
  selfEvaluationSubmitSchema,
  selfEvaluationSummary,
  selfEvaluationTemplateInputSchema,
  selfEvaluationUpdateSchema,
} from '@kampus/school-core/lib/finance-self-evaluations.ts'

import type { Database } from '../db/client.ts'
import { findPerformancePeriod } from '../db/finance-performance.ts'
import {
  findPeriodTemplate,
  findSelfEvaluation,
  findSelfEvaluationTemplate,
  insertSelfEvaluation,
  insertSelfEvaluationTemplate,
  listSelfEvaluationTracking,
  periodResponseCount,
  reopenSelfEvaluation,
  selfEvaluationCounts,
  selfEvaluationStanding,
  submitSelfEvaluation,
  updateSelfEvaluation,
  updateSelfEvaluationTemplate,
  type SelfEvaluationTrackingQuery,
  type StoredSelfEvaluation,
  type StoredSelfEvaluationTemplate,
} from '../db/finance-self-evaluations.ts'
import { findUserName } from '../db/finance-staff-certificates.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Öz değerlendirme (DOM-FIN-131; ON-210). Kural core `lib/finance-self-evaluations.ts`'tedir;
 * servis kurum kilidi altında dönemi, şablonu, yanıtı ve personelin dönemdeki kaydını yükler, tek
 * transaction'da yazar ve denetime alan adlarını yazar (cevap, görüş ve gerekçe metni yazılmaz).
 * Yanıt ayrıntısının okunuşu aynı transaction'da `finance.self_evaluation.read` denetimine düşer
 * (K-450); takip listesi yalnız ad ve durum taşır. Rol ve modül denetimi rotadadır.
 */

const TEMPLATE_ENTITY = 'self_evaluation_templates'
const RESPONSE_ENTITY = 'self_evaluation_responses'
const READ_ACTION = 'finance.self_evaluation.read'

async function templateView(
  db: Database,
  ctx: ServiceContext,
  template: StoredSelfEvaluationTemplate,
) {
  const responseCount = await periodResponseCount(db, ctx.institutionId, template.periodId)
  return { ...template, responseCount, locked: responseCount > 0 }
}

/** Dönemin şablonu (yoksa boş) ve gönderen oranı (K-450). Başka kurumun dönemi 404. */
export async function getSelfEvaluationOverview(ctx: ServiceContext, periodId: string) {
  const period = await findPerformancePeriod(ctx.db, ctx.institutionId, periodId)
  if (period === null) throw new NotFoundError()
  const template = await findPeriodTemplate(ctx.db, ctx.institutionId, periodId)
  const counts = await selfEvaluationCounts(ctx.db, ctx.institutionId, periodId)
  return {
    periodId,
    periodStatus: period.status,
    template: template === null ? null : await templateView(ctx.db, ctx, template),
    summary: selfEvaluationSummary(counts),
  }
}

/** Dönemin personeli ve öz değerlendirme durumu (gönderen/göndermeyen). Başka kurum 404. */
export async function listSelfEvaluationTrackingFor(
  ctx: ServiceContext,
  periodId: string,
  query: SelfEvaluationTrackingQuery,
) {
  const period = await findPerformancePeriod(ctx.db, ctx.institutionId, periodId)
  if (period === null) throw new NotFoundError()
  return listSelfEvaluationTracking(ctx.db, ctx.institutionId, periodId, query)
}

async function responseView(db: Database, ctx: ServiceContext, response: StoredSelfEvaluation) {
  const template = await findSelfEvaluationTemplate(db, ctx.institutionId, response.templateId)
  if (template === null) throw new Error('self evaluation template is missing')
  return {
    ...response,
    questions: template.questions,
    answeredCount: selfEvaluationAnsweredCount(template.questions, response.answers),
  }
}

/**
 * Yanıt ayrıntısı (cevaplar, görüş, geri açma izi). Okuma aynı transaction'da denetime yazılır:
 * alan adları (K-450); denetim yazılamazsa yanıt dönmez. Başka kurumun yanıtı 404.
 */
export async function getSelfEvaluationFor(ctx: ServiceContext, id: string) {
  return ctx.db.transaction(async (tx) => {
    const response = await findSelfEvaluation(tx, ctx.institutionId, id)
    if (response === null) throw new NotFoundError()
    await tx.insert(auditLog).values({
      institutionId: ctx.institutionId,
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action: READ_ACTION,
      entityType: RESPONSE_ENTITY,
      entityId: id,
      // kvkk: değer değil, dönen kişisel alanların adı.
      changes: { fields: ['staffName', 'answers', 'managerComment', 'reopenReason'] },
      createdAt: ctx.now,
    })
    return responseView(tx, ctx, response)
  })
}

async function templateBody(tx: Database, ctx: ServiceContext, id: string) {
  const saved = await findSelfEvaluationTemplate(tx, ctx.institutionId, id)
  if (saved === null) throw new Error('self evaluation template was not written')
  return templateView(tx, ctx, saved)
}

async function responseBody(tx: Database, ctx: ServiceContext, id: string) {
  const saved = await findSelfEvaluation(tx, ctx.institutionId, id)
  if (saved === null) throw new Error('self evaluation was not written')
  return responseView(tx, ctx, saved)
}

/** Dönemin şablonunu açar (K-448). `Idempotency-Key` rotada zorunludur. 201. */
export function createSelfEvaluationTemplateCommand(
  ctx: ServiceContext,
  periodId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: TEMPLATE_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.self_evaluation_template.create',
      collections: [],
      entity,
      load: async (tx) => {
        const period = await findPerformancePeriod(tx, ctx.institutionId, periodId)
        if (period === null) throw new NotFoundError()
        const parsed = selfEvaluationTemplateInputSchema.parse(input)
        const exists = (await findPeriodTemplate(tx, ctx.institutionId, periodId)) !== null
        return { run: () => planSelfEvaluationTemplate(period, parsed, { exists }) }
      },
      after: async (tx, questions) => {
        await insertSelfEvaluationTemplate(tx, ctx.institutionId, {
          id,
          periodId,
          questions,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.self_evaluation_template.create', entity, [
          'periodId',
          'questions',
        ])
        body = { data: await templateBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Soruları düzeltir (K-448): yanıt açılmamış, kapanmamış dönemde. */
export function updateSelfEvaluationTemplateCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: TEMPLATE_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.self_evaluation_template.update',
      collections: [],
      entity,
      load: async (tx) => {
        const template = await findSelfEvaluationTemplate(tx, ctx.institutionId, id)
        if (template === null) throw new NotFoundError()
        const period = await findPerformancePeriod(tx, ctx.institutionId, template.periodId)
        if (period === null) throw new NotFoundError()
        const parsed = selfEvaluationTemplateInputSchema.parse(input)
        if (template.version !== expectedVersion) throw new ConflictError()
        const responseCount = await periodResponseCount(tx, ctx.institutionId, template.periodId)
        return {
          run: () => planSelfEvaluationTemplateUpdate(period, parsed, { responseCount }),
        }
      },
      after: async (tx, questions) => {
        const saved = await updateSelfEvaluationTemplate(tx, ctx.institutionId, {
          id,
          expectedVersion,
          questions,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.self_evaluation_template.update', entity, ['questions'])
        body = { data: await templateBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Personel adına yanıt açar (taslak; K-449). `Idempotency-Key` rotada zorunludur: çift gönderim
 * ikinci yanıtı açmaz. Başka kurumun dönemi 404. 201.
 */
export function createSelfEvaluationCommand(
  ctx: ServiceContext,
  periodId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: RESPONSE_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.self_evaluation.create',
      collections: [],
      entity,
      load: async (tx) => {
        const period = await findPerformancePeriod(tx, ctx.institutionId, periodId)
        if (period === null) throw new NotFoundError()
        const parsed = selfEvaluationCreateSchema.parse(input)
        const template = await findPeriodTemplate(tx, ctx.institutionId, periodId)
        const standing = await selfEvaluationStanding(
          tx,
          ctx.institutionId,
          periodId,
          parsed.membershipId,
        )
        return {
          run: () => ({
            membershipId: parsed.membershipId,
            channel: parsed.channel,
            templateId: template?.id ?? '',
            answers: planSelfEvaluation(parsed, {
              period,
              questions: template?.questions ?? null,
              ...standing,
            }),
          }),
        }
      },
      after: async (tx, plan) => {
        await insertSelfEvaluation(tx, ctx.institutionId, {
          id,
          periodId,
          ...plan,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.self_evaluation.create', entity, [
          'membershipId',
          'channel',
          'answers',
        ])
        body = { data: await responseBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

async function loadResponse(tx: Database, ctx: ServiceContext, id: string, version: number) {
  const response = await findSelfEvaluation(tx, ctx.institutionId, id)
  if (response === null) throw new NotFoundError()
  const period = await findPerformancePeriod(tx, ctx.institutionId, response.periodId)
  const template = await findSelfEvaluationTemplate(tx, ctx.institutionId, response.templateId)
  if (period === null || template === null) throw new NotFoundError()
  if (response.version !== version) throw new ConflictError()
  return { response, period, questions: template.questions }
}

/**
 * Yanıt düzeltmesi (K-449, K-450): cevap ve kanal taslakta, yönetici görüşü gönderilmiş yanıtta;
 * kapanmış dönem 409. Cevap ve görüş metni denetime yazılmaz.
 */
export function updateSelfEvaluationCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: RESPONSE_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.self_evaluation.update',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = selfEvaluationUpdateSchema.parse(input)
        const loaded = await loadResponse(tx, ctx, id, expectedVersion)
        const actorName = await findUserName(tx, ctx.actor.userId)
        return {
          run: () => ({
            patch: planSelfEvaluationUpdate(
              loaded.response,
              loaded.period,
              loaded.questions,
              parsed,
            ),
            actorName: actorName ?? '—',
          }),
        }
      },
      after: async (tx, plan) => {
        const saved = await updateSelfEvaluation(tx, ctx.institutionId, {
          id,
          expectedVersion,
          patch: plan.patch,
          actorName: plan.actorName,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          'finance.self_evaluation.update',
          entity,
          Object.entries(plan.patch)
            .filter(([, value]) => value !== undefined)
            .map(([key]) => key),
        )
        body = { data: await responseBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Gönderim (K-449): zorunlu sorular cevaplı olmalı; gönderilen yanıt düzenlenmez. */
export function submitSelfEvaluationCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: RESPONSE_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.self_evaluation.submit',
      collections: [],
      entity,
      load: async (tx) => {
        selfEvaluationSubmitSchema.parse(input)
        const loaded = await loadResponse(tx, ctx, id, expectedVersion)
        return {
          run: () => planSelfEvaluationSubmit(loaded.response, loaded.period, loaded.questions),
        }
      },
      after: async (tx) => {
        const saved = await submitSelfEvaluation(tx, ctx.institutionId, {
          id,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.self_evaluation.submit', entity, [
          'status',
          'submittedAt',
        ])
        body = { data: await responseBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Geri açma (K-449): gönderilmiş yanıt taslağa döner; gerekçe zorunlu, metni denetime yazılmaz. */
export function reopenSelfEvaluationCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: RESPONSE_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.self_evaluation.reopen',
      collections: [],
      entity,
      load: async (tx) => {
        const loaded = await loadResponse(tx, ctx, id, expectedVersion)
        return { run: () => planSelfEvaluationReopen(loaded.response, loaded.period, input) }
      },
      after: async (tx, reason) => {
        const saved = await reopenSelfEvaluation(tx, ctx.institutionId, {
          id,
          expectedVersion,
          userId: ctx.actor.userId,
          reason,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.self_evaluation.reopen', entity, [
          'status',
          'reopenReason',
          'reopenCount',
        ])
        body = { data: await responseBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
