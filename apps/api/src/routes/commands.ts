import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { automationSchemas } from '@kampus/school-core/lib/assessment-automation.ts'
import type { ArchiveKind } from '@kampus/school-core/lib/school-management.ts'
import {
  mayRun,
  workflowSchemas,
  type WorkflowCommand,
} from '@kampus/school-core/lib/school-workflows.ts'

import { ROLES, type Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  archiveCommand,
  executeTutoringCommand,
  executeWorkflowCommand,
  payInvoiceCommand,
  recordAttendanceCommand,
  restoreCommand,
  type CommandOptions,
  type TutoringCommand,
} from '../services/commands.ts'
import { idempotencyOf, ifMatchVersion, sendCommand } from './command-support.ts'
import {
  archiveQuerySchema,
  attendanceBodySchema,
  branchParamsSchema,
  classParamsSchema,
  commandErrors,
  commandHeadersSchema,
  commandResponseSchema,
  invoiceParamsSchema,
  payInvoiceBodySchema,
  teacherParamsSchema,
  tutorAttendanceBodySchema,
  tutorCancelBodySchema,
  tutorSessionParamsSchema,
} from './commands.schemas.ts'
import {
  emptyCommandBodySchema,
  WORKFLOW_MODULES,
  WORKFLOW_ROUTES,
  workflowDescription,
  workflowQuerySchema,
  workflowRecordParamsSchema,
  type WorkflowRoute,
} from './workflows.schemas.ts'

/**
 * Yazma uçları (api-tasarimi.md §1, §6, §7). Kimlik, modül ve rol denetimi doğrulamadan önce
 * (`preValidation`) çalışır: sıra 401 → 404 kurum türünde olmayan modül → 403 `module_disabled`
 * → 403 `forbidden` → 400 gövde →
 * işlem (404 kayıt, 422 kural, 409 çakışma). İş kuralı ve kapsam serviste core'dadır.
 */

declare module 'fastify' {
  interface FastifyRequest {
    /** Doğrulamadan önceki ham gövde: core şemayı kendisi uygular (`list` dönüşümü iki kez olmaz). */
    commandInput: unknown
  }
}

const response = { 200: commandResponseSchema, ...commandErrors }

function captureInput(): preValidationAsyncHookHandler {
  return async function (request) {
    request.commandInput = structuredClone(request.body ?? {})
  }
}

function options(request: FastifyRequest, idempotency: 'required' | 'optional'): CommandOptions {
  return {
    idempotency: idempotencyOf(request, idempotency === 'required'),
    expectedVersion: ifMatchVersion(request),
  }
}

/** Ham gövde nesnesi; şema doğrulaması geçtiği için nesnedir, değilse boş sayılır. */
function inputObject(request: FastifyRequest): Readonly<Record<string, unknown>> {
  const input = request.commandInput
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input))
    : {}
}

function pascal(command: string): string {
  return command
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function workflowBody(command: WorkflowCommand): z.ZodType {
  return Object.hasOwn(workflowSchemas, command)
    ? workflowSchemas[command as keyof typeof workflowSchemas]
    : emptyCommandBodySchema
}

export function registerCommandRoutes(app: FastifyInstance) {
  app.decorateRequest('commandInput', null)
  const typed = app.withTypeProvider<ZodTypeProvider>()

  /** Rota ön işleyicileri: kimlik → modül → rol → ham gövde. */
  function guard(roles: readonly Role[], module: string | null): preValidationAsyncHookHandler[] {
    return [
      app.authenticate,
      ...(module === null ? [] : [app.requireModule(module)]),
      app.requireRole(roles),
      captureInput(),
    ]
  }

  // --- İş akışı köprüsü -------------------------------------------------------------------
  for (const [name, route] of Object.entries(WORKFLOW_ROUTES) as [
    WorkflowCommand,
    WorkflowRoute,
  ][]) {
    const roles = ROLES.filter((role) => mayRun({ role }, name))
    const base = {
      tags: ['workflows'],
      summary: route.summary,
      description: workflowDescription(name, roles),
      headers: commandHeadersSchema(route.idempotency),
      querystring: workflowQuerySchema,
      body: workflowBody(name),
      response,
    }
    const run = (request: FastifyRequest, reply: FastifyReply, recordId: string | undefined) =>
      executeWorkflowCommand(
        contextOf(request),
        {
          command: name,
          input: request.commandInput,
          recordId,
          childId: workflowQuerySchema.parse(request.query).childId,
        },
        options(request, route.idempotency),
      ).then((result) => sendCommand(reply, result))

    // Rol kuralı core'dadır (`mayRun`): rota her rolü kabul eder, core reddi 403'tür. Modül
    // rotada denetlenir (okuma uçlarıyla aynı 404/403); core da kapalı modülü ayrıca reddeder.
    const module = WORKFLOW_MODULES[name]
    if (route.record !== 'required')
      typed.post(
        `/api/v1/workflows/${name}`,
        {
          preValidation: guard(ROLES, module),
          schema: { ...base, operationId: `runWorkflow${pascal(name)}` },
        },
        (request, reply) => run(request, reply, undefined),
      )
    if (route.record !== 'none')
      typed.post(
        `/api/v1/workflows/${name}/:recordId`,
        {
          preValidation: guard(ROLES, module),
          schema: {
            ...base,
            operationId: `runWorkflow${pascal(name)}${route.record === 'optional' ? 'Update' : ''}`,
            params: workflowRecordParamsSchema,
          },
        },
        (request, reply) => run(request, reply, request.params.recordId),
      )
  }

  // --- Ödeme --------------------------------------------------------------------------------
  // Core `payInvoice` rol denetlemez: tahsilat yönetici ve ön büronundur (yetki matrisi).
  typed.post(
    '/api/v1/invoices/:invoiceId/pay',
    {
      preValidation: guard(['yonetici', 'onburo'], 'finance'),
      schema: {
        operationId: 'payInvoice',
        tags: ['invoices'],
        summary: 'Taksiti öde',
        description:
          'Taksiti ödenmiş işaretler (core `payInvoice`). `Idempotency-Key` zorunludur; ödenmiş taksit 409 `invoice_already_paid`. Roller: `yonetici`, `onburo`.',
        headers: commandHeadersSchema('required'),
        params: invoiceParamsSchema,
        body: payInvoiceBodySchema,
        response,
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await payInvoiceCommand(
          contextOf(request),
          request.params.invoiceId,
          request.body.method,
          options(request, 'required'),
        ),
      ),
  )

  // --- Yoklama ------------------------------------------------------------------------------
  // Core `recordAttendance` rol denetlemez: yönetici ve (core kapsamındaki sınıfta) öğretmen.
  typed.post(
    '/api/v1/classes/:classId/attendance',
    {
      preValidation: guard(['yonetici', 'ogretmen'], 'academic'),
      schema: {
        operationId: 'recordClassAttendance',
        tags: ['attendance'],
        summary: 'Sınıf yoklaması al',
        description:
          'Sınıfın günlük yoklamasını yazar (core `recordAttendance`); aynı öğrenci ve gün için kayıt yinelenmez, güncellenir. Roller: `yonetici`; `ogretmen` yalnız core kapsamındaki sınıfta.',
        headers: commandHeadersSchema('optional'),
        params: classParamsSchema,
        body: attendanceBodySchema,
        response,
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await recordAttendanceCommand(
          contextOf(request),
          request.params.classId,
          request.body.date,
          request.body.marks,
          options(request, 'optional'),
        ),
      ),
  )

  // --- Kampüs/sınıf/kadro arşivi ----------------------------------------------------------
  const archiveTargets = [
    {
      kind: 'branch',
      path: 'branches',
      param: 'branchId',
      params: branchParamsSchema,
      label: 'Kampüs',
      name: 'Branch',
    },
    {
      kind: 'class',
      path: 'classes',
      param: 'classId',
      params: classParamsSchema,
      label: 'Sınıf',
      name: 'Class',
    },
    {
      kind: 'teacher',
      path: 'teachers',
      param: 'teacherId',
      params: teacherParamsSchema,
      label: 'Öğretmen',
      name: 'Teacher',
    },
  ] as const satisfies readonly { kind: ArchiveKind; [key: string]: unknown }[]

  for (const target of archiveTargets) {
    const recordIdOf = (request: FastifyRequest): string =>
      z.object({ [target.param]: z.string() }).parse(request.params)[target.param] ?? ''
    // Core arşiv işlemleri rol denetlemez: kampüs/sınıf/kadro yönetimi yöneticinindir.
    typed.delete(
      `/api/v1/${target.path}/:${target.param}`,
      {
        preValidation: guard(['yonetici'], null),
        schema: {
          operationId: `archive${target.name}`,
          tags: ['school-management'],
          summary: `${target.label} arşivle`,
          description: `${target.label} kaydını arşivler (core \`archiveRecord\`); bağlı kayıtlar \`replacementId\`'ye aktarılır, geçmiş finans/not/yoklama korunur. Rol: \`yonetici\`.`,
          headers: commandHeadersSchema('optional'),
          params: target.params,
          querystring: archiveQuerySchema,
          response,
        },
      },
      async (request, reply) =>
        sendCommand(
          reply,
          await archiveCommand(
            contextOf(request),
            target.kind,
            recordIdOf(request),
            request.query.replacementId ?? '',
            options(request, 'optional'),
          ),
        ),
    )
    typed.post(
      `/api/v1/${target.path}/:${target.param}/restore`,
      {
        preValidation: guard(['yonetici'], null),
        schema: {
          operationId: `restore${target.name}`,
          tags: ['school-management'],
          summary: `${target.label} arşivden geri al`,
          description: `${target.label} kaydını arşivden geri alır (core \`restoreRecord\`); aktarılan görevler otomatik geri taşınmaz. Rol: \`yonetici\`.`,
          headers: commandHeadersSchema('optional'),
          params: target.params,
          body: emptyCommandBodySchema.optional(),
          response,
        },
      },
      async (request, reply) =>
        sendCommand(
          reply,
          await restoreCommand(
            contextOf(request),
            target.kind,
            recordIdOf(request),
            options(request, 'optional'),
          ),
        ),
    )
  }

  // --- Etüt ---------------------------------------------------------------------------------
  // Rol ve kapsam core `runAssessment`'tadır (yazma: yönetici ve kendi etüdünde öğretmen).
  const tutoring = (
    command: TutoringCommand,
    request: FastifyRequest,
    reply: FastifyReply,
    recordId: string | undefined,
  ) =>
    executeTutoringCommand(
      contextOf(request),
      command,
      inputObject(request),
      recordId,
      options(request, 'optional'),
    ).then((result) => sendCommand(reply, result))

  typed.post(
    '/api/v1/tutor-sessions',
    {
      preValidation: guard(ROLES, 'tutoring'),
      schema: {
        operationId: 'createTutorSessions',
        tags: ['tutoring'],
        summary: 'Etüt planını onayla',
        description:
          "Deneme sonuçlarından etüt planını güncel veriyle yeniden hesaplar ve etütleri oluşturur (core `runAssessment('plan')`). `expectedPlan` önizlemedeki plandır; plan değiştiyse 409 `tutoring_plan_stale`.",
        headers: commandHeadersSchema('optional'),
        body: automationSchemas.plan.extend({
          expectedPlan: z
            .string()
            .max(1024 * 1024)
            .optional()
            .describe('Önizlemede gösterilen planın JSON metni'),
        }),
        response,
      },
    },
    (request, reply) => tutoring('plan', request, reply, undefined),
  )

  typed.post(
    '/api/v1/tutor-sessions/:sessionId/cancel',
    {
      preValidation: guard(ROLES, 'tutoring'),
      schema: {
        operationId: 'cancelTutorSession',
        tags: ['tutoring'],
        summary: 'Etüdü iptal et',
        description:
          "Etüdü gerekçeyle iptal eder (core `runAssessment('cancel')`); iptal geçmişi korunur. Tamamlanmış etüt 422, iptal edilmiş etüt 409.",
        headers: commandHeadersSchema('optional'),
        params: tutorSessionParamsSchema,
        body: tutorCancelBodySchema,
        response,
      },
    },
    (request, reply) => tutoring('cancel', request, reply, request.params.sessionId),
  )

  typed.post(
    '/api/v1/tutor-sessions/:sessionId/attendance',
    {
      preValidation: guard(ROLES, 'tutoring'),
      schema: {
        operationId: 'recordTutorAttendance',
        tags: ['tutoring'],
        summary: 'Etüt yoklaması al',
        description:
          "Etüdün yoklamasını alır ve etüdü tamamlar (core `runAssessment('attendance')`). Gelecek etüt 422.",
        headers: commandHeadersSchema('optional'),
        params: tutorSessionParamsSchema,
        body: tutorAttendanceBodySchema,
        response,
      },
    },
    (request, reply) => tutoring('attendance', request, reply, request.params.sessionId),
  )
}
