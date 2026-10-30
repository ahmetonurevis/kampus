import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  ASSESSMENT_COMMANDS,
  type AssessmentCommand,
} from '@kampus/school-core/modules/commands.ts'

import { AppError } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import { executeAssessmentCommand, previewEvaluation, previewPlan } from '../services/assessment.ts'
import { captureInput, options, rejectIfMatch } from './commands.ts'
import { sendCommand } from './command-support.ts'
import { commandHeadersSchema, commandResponseSchema } from './commands.schemas.ts'
import {
  assessmentDescription,
  assessmentErrors,
  assessmentRecordParamsSchema,
  ASSESSMENT_BODIES,
  ASSESSMENT_ROUTES,
  evaluationPreviewResponseSchema,
  FILE_BODY_LIMIT,
  FILE_FIELDS,
  MAX_FILE_BYTES,
  planPreviewResponseSchema,
  previewErrors,
  previewEvaluateBodySchema,
  previewPlanBodySchema,
} from './assessment.schemas.ts'

/**
 * Optik değerlendirme ve otomatik etüt uçları (`/api/v1/assessment/...`). Sıra: 401 → 404 kurum
 * türünde olmayan modül → 403 `module_disabled` → 413 dosya sınırı → 400 gövde → işlem (403 rol
 * ve kapsam, 404 kayıt, 422 kural, 409 çakışma). Rol, kapsam ve kural core `runAssessment`'tadır
 * (yazma yalnız yönetici ve öğretmen, DOM-YTK-021). Okuma uçları koleksiyon köprüsündedir
 * (`GET /collections/opticalProfiles|opticalEvaluations|tutorSessions|availability`).
 */

const response = { 200: commandResponseSchema, ...assessmentErrors }

function pascal(command: string): string {
  return command
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

/**
 * Dosya alanı 1 MB'ı (UTF-8 bayt) aşarsa 413. Gövde tavanı (`FILE_BODY_LIMIT`) JSON kaçışlarına
 * pay bırakır; böylece sınır alan düzeyinde ve deterministiktir.
 */
export function limitFiles(fields: readonly string[]): preValidationAsyncHookHandler {
  return async function (request) {
    const body: unknown = request.body
    if (typeof body !== 'object' || body === null) return
    for (const field of fields) {
      const value: unknown = Reflect.get(body, field)
      if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > MAX_FILE_BYTES)
        throw new AppError(413, 'payload_too_large', 'Dosya en fazla 1 MB olabilir.', {
          issues: [
            {
              path: [field],
              code: 'file_too_large',
              message: 'Dosya en fazla 1 MB olabilir.',
            },
          ],
        })
    }
  }
}

export function registerAssessmentRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  /** Ön işleyiciler: kimlik → modül → dosya sınırı → `If-Match` (oluşturmada) → ham gövde. */
  function guard(
    module: string,
    { subject, files = [] }: { subject: boolean; files?: readonly string[] },
  ): preValidationAsyncHookHandler[] {
    return [
      app.authenticate,
      app.requireModule(module),
      ...(files.length > 0 ? [limitFiles(files)] : []),
      ...(subject ? [] : [rejectIfMatch()]),
      captureInput(),
    ]
  }

  // --- Komut köprüsü ----------------------------------------------------------------------
  for (const [name, route] of Object.entries(ASSESSMENT_ROUTES) as [
    AssessmentCommand,
    (typeof ASSESSMENT_ROUTES)[AssessmentCommand],
  ][]) {
    const module = ASSESSMENT_COMMANDS[name].module
    const files = Object.hasOwn(FILE_FIELDS, name)
      ? FILE_FIELDS[name as keyof typeof FILE_FIELDS]
      : []
    const base = {
      tags: ['assessment'],
      summary: route.summary,
      description: assessmentDescription(name),
      body: ASSESSMENT_BODIES[name],
      response,
    }
    const bodyLimit = files.length > 0 ? { bodyLimit: FILE_BODY_LIMIT } : {}
    const run = (request: FastifyRequest, reply: FastifyReply, recordId: string | undefined) =>
      executeAssessmentCommand(
        contextOf(request),
        { command: name, input: request.commandInput, recordId },
        options(request, route.idempotency),
      ).then((result) => sendCommand(reply, result))

    if (route.record !== 'required')
      typed.post(
        `/api/v1/assessment/${name}`,
        {
          preValidation: guard(module, { subject: false, files }),
          ...bodyLimit,
          schema: {
            tags: base.tags,
            summary: base.summary,
            description: base.description,
            body: base.body,
            response: base.response,
            operationId: `runAssessment${pascal(name)}`,
            headers: commandHeadersSchema(route.idempotency, { ifMatch: false }),
          },
        },
        (request, reply) => run(request, reply, undefined),
      )
    if (route.record !== 'none')
      typed.post(
        `/api/v1/assessment/${name}/:recordId`,
        {
          preValidation: guard(module, { subject: true, files }),
          ...bodyLimit,
          schema: {
            tags: base.tags,
            summary: base.summary,
            description: base.description,
            body: base.body,
            response: base.response,
            operationId: `runAssessment${pascal(name)}${route.record === 'optional' ? 'Update' : ''}`,
            headers: commandHeadersSchema(route.idempotency),
            params: assessmentRecordParamsSchema,
          },
        },
        (request, reply) => run(request, reply, request.params.recordId),
      )
  }

  // --- Saf önizleme (hiçbir şey yazmaz) -----------------------------------------------------
  typed.post(
    '/api/v1/assessment/plan/preview',
    {
      preValidation: guard(ASSESSMENT_COMMANDS.plan.module, { subject: false }),
      schema: {
        operationId: 'previewAssessmentPlan',
        tags: ['assessment'],
        summary: 'Etüt planını önizle',
        description:
          'Etüt planını güncel veriyle hesaplar (core `planTutoring`) ve **hiçbir şey yazmaz** (salt okunur transaction, kurum kilidi yok; kayıt, sürüm ve denetim kaydı değişmez). Yanıt: önerilen etütler (`sessions`, kapasite ile), yerleşemeyen gruplar ve nedenleri (`unresolved`: öğretmen, derslik, uygunluk, kapasite ve çakışma uyarıları), zaten karşılanan kazanımlar (`covered`) ve onayda geri gönderilecek `expectedPlan`. Onay (`POST /assessment/plan`) planı yeniden hesaplar; fark varsa 409 `tutoring_plan_stale`. Roller core `runAssessment` ile aynıdır: `yonetici`, `ogretmen`.',
        body: previewPlanBodySchema,
        response: { 200: planPreviewResponseSchema, ...previewErrors },
      },
    },
    async (request) => ({ data: await previewPlan(contextOf(request), request.commandInput) }),
  )

  typed.post(
    '/api/v1/assessment/evaluate/preview',
    {
      preValidation: guard(ASSESSMENT_COMMANDS.evaluate.module, {
        subject: false,
        files: FILE_FIELDS.evaluate,
      }),
      bodyLimit: FILE_BODY_LIMIT,
      schema: {
        operationId: 'previewAssessmentEvaluation',
        tags: ['assessment'],
        summary: 'Okuyucu dosyasını önizle',
        description:
          'Okuyucu dosyasını (CSV/DAT/TXT, en çok 1 MB; aşarsa 413) profile göre değerlendirir (core `previewOptical`) ve **hiçbir şey yazmaz**. Yanıt öğrenci/ders başına doğru, yanlış, boş, çoklu, iptal, net, zayıf kazanımlar ve üzerine yazılacak sonuç işaretidir (soru bazında ayrıntı yok) ile onayda `expectedDigest` olarak gönderilecek `digest`. Dosya hatası 422 ve `issues`: yol `["text","line",<satır>]`, satır dosya satırıdır (başlık 1).',
        body: previewEvaluateBodySchema,
        response: { 200: evaluationPreviewResponseSchema, ...previewErrors },
      },
    },
    async (request) => ({
      data: await previewEvaluation(contextOf(request), request.commandInput),
    }),
  )
}
