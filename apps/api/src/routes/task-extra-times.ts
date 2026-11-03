import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import type { Role } from '../auth.ts'
import { AppError, MESSAGES } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { listTaskExtraTimes, writeTaskExtraTime } from '../services/task-extra-times.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { readErrors } from './communication.schemas.ts'
import {
  extraTimeChangeBodySchema,
  extraTimeGrantBodySchema,
  extraTimeListParamsSchema,
  extraTimeListResponseSchema,
  extraTimeParamsSchema,
  extraTimeWriteResponseSchema,
} from './task-extra-times.schemas.ts'

/**
 * Bireysel ek süre uçları (OG-248; docs/domain/beceri-gelisimi.md DOM-BEC-043). `learning`
 * modülüne bağlıdır. Okuma ve yazma yalnız personelindir (yönetici, öğretmen); yazma atayan
 * öğretmen ve yöneticidir (servis 403). Kursiyer ek süresini denemesinde (`extraMinutes`,
 * `endsAt`) görür, gerekçeyi görmez.
 */

const MODULE = 'learning'
const STAFF: readonly Role[] = ['yonetici', 'ogretmen']
const ACCESS =
  'Roller: `yonetici` her atamada; `ogretmen` gördüğü atamada okur (atayan değilse yalnız kendi kapsamındaki kursiyerler), yalnız kendi atamasında yazar (atayan olmayan öğretmen 403 `forbidden`); öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Olmayan, arşivli, kapsam dışı ya da başka kurumun ataması 404.'
const RULES =
  'Yalnız süreli görevde (422 `extra_time_untimed`), teslim penceresi açıkken (422 `submission_closed`), 1–300 dakika ve görevin süresini aşmadan (422 `extra_time_too_long`); süren denemeyi şimdiden önce bitirecek kısaltma 422 `extra_time_below_elapsed`. Kursiyer atamanın güncel hedefinde değilse 404. Süren deneme yeni ek süreyle uzar, biten deneme yeniden açılmaz (DOM-BEC-043). Kayıt değişmez, her değişiklik yeni kayıttır; denetime yalnız alan adları yazılır.'

function requiredVersion(request: FastifyRequest): number {
  const version = ifMatchVersion(request)
  if (version === null) throw new AppError(400, 'if_match_required', MESSAGES.if_match_required)
  return version
}

function send(reply: FastifyReply, response: CommandResponse) {
  if (response.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(response.statusCode)
  return extraTimeWriteResponseSchema.parse(response.body)
}

export function registerTaskExtraTimeRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  // Kimlik, modül ve rol şema doğrulamasından önce: oturumsuz istek geçersiz kimlikte de 401 alır.
  const staff = [app.requireModule(MODULE), app.requireRole(STAFF)]

  typed.get(
    '/api/v1/task-assignments/:assignmentId/extra-times',
    {
      preValidation: staff,
      schema: {
        operationId: 'listTaskExtraTimes',
        tags: ['task-assignments'],
        summary: 'Kursiyerlerin bireysel ek süresi',
        description: `Atamanın kursiyerleri (güncel hedefler ve ek süre kaydı olanlar), güncel ek süreleri, sürümleri ve gerekçeli kayıt geçmişi (DOM-BEC-043). ${ACCESS}`,
        params: extraTimeListParamsSchema,
        response: { 200: extraTimeListResponseSchema, ...readErrors },
      },
    },
    async (request) => ({
      data: await listTaskExtraTimes(contextOf(request), request.params.assignmentId),
    }),
  )

  typed.post(
    '/api/v1/task-assignments/:assignmentId/extra-times',
    {
      preValidation: staff,
      schema: {
        operationId: 'grantTaskExtraTime',
        tags: ['task-assignments'],
        summary: 'Kursiyere ek süre ver',
        description: `Kursiyere bu atamada ek süre tanımlar. Ek süresi olan kursiyere ikinci verme 409 \`extra_time_exists\` (değiştirme \`PATCH\`). ${RULES} \`Idempotency-Key\` isteğe bağlı. Başarı 201. ${ACCESS}`,
        params: extraTimeListParamsSchema,
        body: extraTimeGrantBodySchema,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        response: { 201: extraTimeWriteResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      const { learnerId, ...input } = request.body
      return send(
        reply,
        await writeTaskExtraTime(
          contextOf(request),
          { kind: 'grant', assignmentId: request.params.assignmentId, learnerId, input },
          idempotencyOf(request, false),
        ),
      )
    },
  )

  typed.patch(
    '/api/v1/task-assignments/:assignmentId/extra-times/:learnerId',
    {
      preValidation: [...staff, requireIfMatch()],
      schema: {
        operationId: 'changeTaskExtraTime',
        tags: ['task-assignments'],
        summary: 'Kursiyerin ek süresini değiştir',
        description: `Güncel ek süreyi yeni süre ve gerekçeyle değiştirir; ek süresi yoksa 404. \`If-Match\` zorunlu: ek sürenin \`version\`'ı (tutmazsa 409 \`version_conflict\`). ${RULES} ${ACCESS}`,
        params: extraTimeParamsSchema,
        body: extraTimeChangeBodySchema,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        response: { 200: extraTimeWriteResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      send(
        reply,
        await writeTaskExtraTime(
          contextOf(request),
          {
            kind: 'change',
            assignmentId: request.params.assignmentId,
            learnerId: request.params.learnerId,
            input: request.body,
            expectedVersion: requiredVersion(request),
          },
          idempotencyOf(request, false),
        ),
      ),
  )

  typed.delete(
    '/api/v1/task-assignments/:assignmentId/extra-times/:learnerId',
    {
      preValidation: [...staff, requireIfMatch()],
      schema: {
        operationId: 'removeTaskExtraTime',
        tags: ['task-assignments'],
        summary: 'Kursiyerin ek süresini kaldır',
        description: `Ek süreyi kaldırır (geçmişte kalan yeni kayıt, \`minutes: 0\`); ek süresi yoksa 404. \`If-Match\` zorunlu: ek sürenin \`version\`'ı (tutmazsa 409 \`version_conflict\`). ${RULES} Yanıt kursiyerin güncel satırıdır (\`current: null\`). ${ACCESS}`,
        params: extraTimeParamsSchema,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        response: { 200: extraTimeWriteResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      send(
        reply,
        await writeTaskExtraTime(
          contextOf(request),
          {
            kind: 'remove',
            assignmentId: request.params.assignmentId,
            learnerId: request.params.learnerId,
            expectedVersion: requiredVersion(request),
          },
          idempotencyOf(request, false),
        ),
      ),
  )
}
