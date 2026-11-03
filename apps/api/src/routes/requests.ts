import type { FastifyInstance, FastifyRequest, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { WRITE_ACTION_ROLES, type WriteAction } from '@kampus/school-core/lib/authorize.ts'
import {
  approveAbsenceSchema,
  attachAbsenceDocumentsSchema,
  notifyAbsenceSchema,
  openRequestSchema,
  rejectAbsenceSchema,
  updateRequestSchema,
} from '@kampus/school-core/lib/requests.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  approveAbsenceCommand,
  attachAbsenceDocumentsCommand,
  notifyAbsenceCommand,
  openRequestCommand,
  rejectAbsenceCommand,
  updateRequestCommand,
} from '../services/requests.ts'
import { sendCommand } from './command-support.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema, commandResponseSchema } from './commands.schemas.ts'
import { absenceParamsSchema, requestParamsSchema } from './requests.schemas.ts'

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
        description: `Veli bağlı çocuğu için ileri tarihli izin veya geçmiş tarihli mazeret bildirir (core \`notifyAbsence\`, DOM-ILT-053). Geçmiş tarih devamsızlığın bitiminden itibaren ortaokulda 3, lisede 5 iş günü içinde kabul edilir, aksi 422 \`absence_notice_late\`. Aynı öğrencinin örtüşen bildirimi 409 \`absence_overlap\`; başka velinin çocuğu 403 \`student_scope_denied\`, pasif öğrenci 422 \`student_inactive\`. Gerekçe yalnız kategoridir (\`reasonCategory\`: \`health\`, \`family\`, \`official\`, \`other\`); serbest açıklama (\`reason\`) ve bilinmeyen alan 400 \`validation_failed\`, sağlık ayrıntısı alınmaz (KVKK md. 6, en az veri). Özür belgesi (\`fileIds\`, en çok 3; dosya ucundan \`absence_document\` amacıyla yüklenmiş, velinin kendi \`ready\` dosyaları; PDF, JPEG, PNG, en çok 10 MB) aynı transaction'da bildirime bağlanır: 3'ten fazlası 422 \`absence_document_limit\`, başkasının ya da olmayan dosya 422 \`absence_document_unavailable\`, başka amaç 422 \`absence_document_purpose\`, hazır olmayan 422 \`file_not_ready\`, başka kayda bağlı 409 \`file_already_attached\`; hiçbir kayıt değişmez. Bildirim \`approvalStatus: pending\` ile açılır (idare onayı \`POST /absences/{absenceId}/approve\`). Bildirim yoklamayı değiştirmez ve talep kaydı açmaz; ön büro bildirimleri göremez. Modül \`academic\`. \`Idempotency-Key\` zorunludur. Başarı 201 ve \`Location\`. Roller: ${rolesOf('absence.notify')}.`,
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

  const decisionErrors =
    'Olmayan, başka kurumun ya da kapsam dışı bildirim 404 `absence_not_found`; karar verilmiş bildirim 409 `absence_already_decided`. `If-Match` zorunludur (bildirimin sürümü): eksikse 400 `if_match_required`, tutmazsa 409 `version_conflict`. Modül `academic`.'

  typed.post(
    '/api/v1/absences/:absenceId/documents',
    {
      preValidation: guard('absence.attach', 'required'),
      schema: {
        operationId: 'attachAbsenceDocuments',
        tags: ['requests'],
        summary: 'Bildirime özür belgesi ekle',
        description: `Veli, bağlı çocuğunun karar bekleyen bildirimine özür belgesi ekler (core \`attachAbsenceDocuments\`, DOM-ILT-053, IST-072). Belgeler aynı transaction'da bildirime bağlanır; bildirim başına toplam en çok 3 (422 \`absence_document_limit\`), aynı belge ikinci kez 409 \`absence_document_duplicate\`. Belge süresi geçen bildirim (devamsızlığın bitiminden itibaren ortaokulda 3, lisede 5 iş günü) 422 \`absence_document_late\`. Dosya hataları \`POST /absences\` ile aynıdır. Belgeyi bildirimi okuyabilen (yönetici, sınıf rehber öğretmeni, veli, öğrenci) \`GET /files/{fileId}/url\` ile açar; her bağlantı denetim kaydına \`file.access\` olarak yazılır. ${decisionErrors} Roller: ${rolesOf('absence.attach')}.`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: absenceParamsSchema,
        body: attachAbsenceDocumentsSchema,
        response,
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await attachAbsenceDocumentsCommand(
          contextOf(request),
          request.params.absenceId,
          input(request),
          options(request, 'optional'),
        ),
      ),
  )

  typed.post(
    '/api/v1/absences/:absenceId/approve',
    {
      preValidation: guard('absence.approve', 'required'),
      schema: {
        operationId: 'approveAbsence',
        tags: ['requests'],
        summary: 'İzin/mazeret bildirimini onayla',
        description: `Yönetici bildirimi onaylar (core \`approveAbsence\`, DOM-ILT-053): \`approvalStatus\` \`approved\` olur, karar kaydedilir. Günlerin yoklamada ve risk listesinde özürlü gösterilmesi (core \`attendanceExcuse\`) henüz bağlı değildir; yoklama kaydı değişmez. Belge zorunlu değildir. Gövde boş nesnedir, bilinmeyen alan 400. Veliye (yetişkin kursiyerde kendisine) \`absence_decided\` bildirimi aynı transaction'da yazılır; sonuç bildirimde yoktur. Durumu olmayan eski bildirim \`pending\` sayılır. ${decisionErrors} Roller: ${rolesOf('absence.approve')}.`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: absenceParamsSchema,
        body: approveAbsenceSchema,
        response,
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await approveAbsenceCommand(
          contextOf(request),
          request.params.absenceId,
          input(request),
          options(request, 'optional'),
        ),
      ),
  )

  typed.post(
    '/api/v1/absences/:absenceId/reject',
    {
      preValidation: guard('absence.reject', 'required'),
      schema: {
        operationId: 'rejectAbsence',
        tags: ['requests'],
        summary: 'İzin/mazeret bildirimini reddet',
        description: `Yönetici bildirimi gerekçeyle reddeder (core \`rejectAbsence\`, DOM-ILT-053): \`approvalStatus\` \`rejected\` olur, günler özürsüz kalır. Gerekçe (\`reason\`, 2–500 karakter) bildirim kaydına yazılmaz, yalnız denetim kaydının gerekçesine (\`audit_log.reason\`) girer ve loglanmaz. Veliye \`absence_decided\` bildirimi aynı transaction'da yazılır; sonuç ve gerekçe bildirimde yoktur. ${decisionErrors} Roller: ${rolesOf('absence.reject')}.`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: absenceParamsSchema,
        body: rejectAbsenceSchema,
        response,
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await rejectAbsenceCommand(
          contextOf(request),
          request.params.absenceId,
          input(request),
          options(request, 'optional'),
        ),
      ),
  )
}
