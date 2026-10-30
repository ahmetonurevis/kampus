import type { FastifyInstance, FastifyRequest, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { WRITE_ACTION_ROLES, type WriteAction } from '@kampus/school-core/lib/authorize.ts'
import {
  notifyAbsenceSchema,
  openRequestSchema,
  updateRequestSchema,
} from '@kampus/school-core/lib/requests.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  notifyAbsenceCommand,
  openRequestCommand,
  updateRequestCommand,
} from '../services/requests.ts'
import { sendCommand } from './command-support.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema, commandResponseSchema } from './commands.schemas.ts'
import { requestParamsSchema } from './requests.schemas.ts'

/**
 * Veli talebi ve izin/mazeret bildirimi uçları (docs/domain/iletisim-ve-veli.md DOM-ILT-053,
 * DOM-ILT-080). Okuma genel koleksiyon ucundadır (`GET /collections/requests`,
 * `GET /collections/absences`): veli bağlı çocuklarınınkini, ön büro bütün talepleri görür;
 * mazereti ön büro göremez. Sıra komut uçlarıyla aynıdır: 401 → 403 `module_disabled` → 403
 * `forbidden` (core `WRITE_ACTION_ROLES`) → `If-Match` → 400 gövde → işlem (404, 422, 409).
 * Kapsam core `requireAuthorized`'dadır.
 */

const response = { 200: commandResponseSchema, ...commandErrors }
const created = { 201: commandResponseSchema, ...commandErrors }

export function registerRequestRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  /** Kimlik → modül (core komut tablosu) → rol → `If-Match` (oluşturmada yasak) → ham gövde. */
  function guard(
    action: WriteAction,
    ifMatch: 'reject' | 'required',
  ): preValidationAsyncHookHandler[] {
    const module = OPERATION_COMMANDS[action].module
    return [
      app.authenticate,
      ...(module === null ? [] : [app.requireModule(module)]),
      app.requireRole(WRITE_ACTION_ROLES[action]),
      ifMatch === 'reject' ? rejectIfMatch() : requireIfMatch(),
      captureInput(),
    ]
  }
  const rolesOf = (action: WriteAction) =>
    WRITE_ACTION_ROLES[action].map((role) => `\`${role}\``).join(', ')
  const input = (request: FastifyRequest) => request.commandInput

  typed.post(
    '/api/v1/requests',
    {
      preValidation: guard('request.open', 'reject'),
      schema: {
        operationId: 'openRequest',
        tags: ['requests'],
        summary: 'Talep, şikayet veya öneri aç',
        description: `Veli bağlı çocuğu için talep açar; talep \`Yeni\` durumunda \`Ön büro\`'ya düşer (core \`openRequest\`, DOM-ILT-080). Başka velinin çocuğu veya kurumda olmayan öğrenci 403 \`student_scope_denied\` (DOM-YTK-025), pasif öğrenci 422 \`student_inactive\`. Modül \`communication\`. \`Idempotency-Key\` zorunludur. Başarı 201 ve \`Location\`. Roller: ${rolesOf('request.open')}.`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: openRequestSchema,
        response: created,
      },
    },
    async (request, reply) => {
      const body = sendCommand(
        reply,
        await openRequestCommand(contextOf(request), input(request), options(request, 'required')),
      )
      const entity = body.data.entity
      if (entity)
        reply.header('location', `/api/v1/collections/requests/${encodeURIComponent(entity.id)}`)
      return body
    },
  )

  typed.patch(
    '/api/v1/requests/:requestId',
    {
      preValidation: guard('request.update', 'required'),
      schema: {
        operationId: 'updateRequest',
        tags: ['requests'],
        summary: 'Talebi güncelle ve yanıtla',
        description: `Talebin durumunu (\`Yeni\`, \`İnceleniyor\`, \`Çözüldü\`) ve ilgili birimini değiştirir; \`reply\` verilirse yanıtı \`replies\` listesine ekler, önceki yanıtlar değişmez ve veli yanıtları talepte görür (core \`updateRequest\`, DOM-ILT-080). Yanıt süresi saklanmaz (core \`requestResponse\`, DOM-ILT-013). Değişiklik yoksa 409 \`request_unchanged\`, çözülmüş talep yeniden incelemeye alınmadan 409 \`request_resolved\`, ele alınmış talep \`Yeni\`'ye dönerse 422 \`request_status_invalid\`; olmayan veya başka kurumun talebi 404. \`If-Match\` zorunludur (talebin sürümü): eksikse 400 \`if_match_required\`, tutmazsa 409 \`version_conflict\`. Roller: ${rolesOf('request.update')}.`,
        headers: commandHeadersSchema('optional'),
        params: requestParamsSchema,
        body: updateRequestSchema,
        response,
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await updateRequestCommand(
          contextOf(request),
          request.params.requestId,
          input(request),
          options(request, 'optional'),
        ),
      ),
  )

  typed.post(
    '/api/v1/absences',
    {
      preValidation: guard('absence.notify', 'reject'),
      schema: {
        operationId: 'notifyAbsence',
        tags: ['requests'],
        summary: 'İzin veya mazeret bildir',
        description: `Veli bağlı çocuğu için ileri tarihli izin veya geçmiş tarihli mazeret bildirir (core \`notifyAbsence\`, DOM-ILT-053). Geçmiş tarih devamsızlığın bitiminden itibaren ortaokulda 3, lisede 5 iş günü içinde kabul edilir, aksi 422 \`absence_notice_late\`. Aynı öğrencinin örtüşen bildirimi 409 \`absence_overlap\`; belge eki (\`files\`) henüz 422 \`absence_files_unsupported\`; başka velinin çocuğu 403 \`student_scope_denied\`, pasif öğrenci 422 \`student_inactive\`. Gerekçe yalnız kategoridir (\`reasonCategory\`: \`health\`, \`family\`, \`official\`, \`other\`); serbest açıklama (\`reason\`) ve bilinmeyen alan 400 \`validation_failed\`, sağlık ayrıntısı alınmaz (KVKK md. 6, en az veri). Bildirim yoklamayı değiştirmez ve talep kaydı açmaz; ön büro bildirimleri göremez. Modül \`academic\`. \`Idempotency-Key\` zorunludur. Başarı 201 ve \`Location\`. Roller: ${rolesOf('absence.notify')}.`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: notifyAbsenceSchema,
        response: created,
      },
    },
    async (request, reply) => {
      const body = sendCommand(
        reply,
        await notifyAbsenceCommand(
          contextOf(request),
          input(request),
          options(request, 'required'),
        ),
      )
      const entity = body.data.entity
      if (entity)
        reply.header('location', `/api/v1/collections/absences/${encodeURIComponent(entity.id)}`)
      return body
    },
  )
}
