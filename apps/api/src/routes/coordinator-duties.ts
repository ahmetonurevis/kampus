import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { AppError, MESSAGES } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import { assignDuty, getDuty, listDuties, removeDuty } from '../services/coordinator-duties.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { readErrors } from './communication.schemas.ts'
import {
  coordinatorDutyBodySchema,
  coordinatorDutyListQuerySchema,
  coordinatorDutyListResponseSchema,
  coordinatorDutyParamsSchema,
  coordinatorDutyResponseSchema,
} from './coordinator-duties.schemas.ts'

/**
 * Zümre başkanı (`school`) ve akademik koordinatör (`language_school`) ek görevi (F4b3b2b;
 * DOM-YTK-027). Görev rol değildir, öğretmen üyeliğine bağlı ek yetkidir. Yalnız yönetici atar ve
 * kaldırır; öğretmen kendi görevlerini okur. Modüle bağlı değildir (personel yönetimi); görevin
 * kullanıldığı uçlar (son puan) kendi modülünü ister.
 */

const ACCESS =
  'Roller: `yonetici` kurumun bütün görevlerini okur, atar ve kaldırır; `ogretmen` yalnız kendi görevlerini okur (başkasının görevi 404); öğrenci, veli ve ön büro 403. Başka kurumun kaydı 404.'

function requiredVersion(request: FastifyRequest): number {
  const version = ifMatchVersion(request)
  if (version === null) throw new AppError(400, 'if_match_required', MESSAGES.if_match_required)
  return version
}

function sendDuty(reply: FastifyReply, response: CommandResponse) {
  if (response.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(response.statusCode)
  return coordinatorDutyResponseSchema.parse(response.body)
}

export function registerCoordinatorDutyRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const read = app.requireRole(['yonetici', 'ogretmen'])
  const write = app.requireRole(['yonetici'])

  typed.get(
    '/api/v1/coordinator-duties',
    {
      preValidation: read,
      schema: {
        operationId: 'listCoordinatorDuties',
        tags: ['institution'],
        summary: 'Zümre başkanı ve koordinatör görevleri',
        description: `Etkin (kaldırılmamış) görevler, üyelik ve kapsam sırasıyla, sayfalı. \`membershipId\` süzgeci; öğretmende kendi üyeliğiyle kesişir. Bilinmeyen parametre 400. ${ACCESS}`,
        querystring: coordinatorDutyListQuerySchema,
        response: { 200: coordinatorDutyListResponseSchema, ...readErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const result = await listDuties(contextOf(request), request.query)
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )

  typed.get(
    '/api/v1/coordinator-duties/:dutyId',
    {
      preValidation: read,
      schema: {
        operationId: 'getCoordinatorDuty',
        tags: ['institution'],
        summary: 'Koordinatör görevi',
        description: `Etkin görev; kaldırılmış görev 404. ${ACCESS}`,
        params: coordinatorDutyParamsSchema,
        response: { 200: coordinatorDutyResponseSchema, ...readErrors },
      },
    },
    async (request) => ({ data: await getDuty(contextOf(request), request.params.dutyId) }),
  )

  typed.post(
    '/api/v1/coordinator-duties',
    {
      preValidation: write,
      schema: {
        operationId: 'assignCoordinatorDuty',
        tags: ['institution'],
        summary: 'Zümre başkanı veya koordinatör görevi ver',
        description: `Yönetici öğretmen üyeliğine ek görev verir (DOM-YTK-027; core \`planCoordinatorDuty\`). Görev türü kurum türünden gelir: \`school\`'da zümre başkanı (\`scopeId\` ders kimliği; öğretmenin kendi branşı olmalı, aksi 422 \`duty_outside_branch\`, kadro kaydı bağlı değilse 422 \`teacher_record_required\`), \`language_school\`'da akademik koordinatör (\`scopeId\` CEFR seviyesi, aksi 422 \`invalid_cefr_level\`). Öğretmen olmayan üyelik 422 \`duty_requires_teacher\`; başka kurumun veya olmayan üyelik 404; aynı etkin görev 409 \`coordinator_duty_exists\`. Görev öğrenci bazında not yazma yetkisi vermez; tek istisna uyuşmazlıkta son puandır (DOM-BEC-024). \`Idempotency-Key\` zorunlu; başarı 201 ve \`Location\`. Denetime yalnız alan adları. Yalnız \`yonetici\`; diğer roller 403.`,
        body: coordinatorDutyBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: { 201: coordinatorDutyResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      const body = sendDuty(
        reply,
        await assignDuty(contextOf(request), request.body, idempotencyOf(request, true)),
      )
      reply.header('location', `/api/v1/coordinator-duties/${body.data.id}`)
      return body
    },
  )

  typed.delete(
    '/api/v1/coordinator-duties/:dutyId',
    {
      preValidation: [write, requireIfMatch()],
      schema: {
        operationId: 'removeCoordinatorDuty',
        tags: ['institution'],
        summary: 'Koordinatör görevini kaldır',
        description:
          "Yönetici görevi kaldırır (arşiv; DOM-YTK-027). `If-Match` görevin `rowVersion`'ı (zorunlu), tutmazsa 409 `version_conflict`; kaldırılmış, olmayan veya başka kurumun görevi 404. Görevin verdiği son puanlar kayıt geçmişinde kalır. `Idempotency-Key` isteğe bağlı. Yanıt kaldırılan görevdir (`archivedAt` dolu). Denetime yalnız alan adları. Yalnız `yonetici`; diğer roller 403.",
        params: coordinatorDutyParamsSchema,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        response: { 200: coordinatorDutyResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendDuty(
        reply,
        await removeDuty(
          contextOf(request),
          { dutyId: request.params.dutyId, expectedVersion: requiredVersion(request) },
          idempotencyOf(request, false),
        ),
      ),
  )
}
