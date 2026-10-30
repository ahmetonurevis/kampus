import type { FastifyInstance, FastifyRequest, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  bookAppointmentSchema,
  updateAppointmentSchema,
} from '@kampus/school-core/lib/appointments.ts'
import { WRITE_ACTION_ROLES, type WriteAction } from '@kampus/school-core/lib/authorize.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import { errorResponseSchema } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  bookAppointmentCommand,
  listBookableSlots,
  updateAppointmentCommand,
} from '../services/appointments.ts'
import {
  appointmentParamsSchema,
  bookableSlotsQuerySchema,
  bookableSlotsResponseSchema,
} from './appointments.schemas.ts'
import { sendCommand } from './command-support.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema, commandResponseSchema } from './commands.schemas.ts'
import { authenticatedErrors } from './common.schemas.ts'

/**
 * Öğretmen randevusu uçları (docs/domain/iletisim-ve-veli.md DOM-ILT-100…105). Randevu okuması
 * genel koleksiyon ucundadır (`GET /collections/appointments`): öğretmen kendi randevularını,
 * yönetici hepsini görür; öğrenci velinin açtığı görüşmeyi, veli başka velinin görüşmesini
 * görmez. Sıra komut uçlarıyla aynıdır: 401 → 403 `module_disabled` → 403 `forbidden` (core
 * `WRITE_ACTION_ROLES`) → `If-Match` → 400 gövde → işlem (404, 409 sürüm, 403, 422, 409).
 * Kapsam core `requireAuthorized` ve `requireVisibleAppointment`'tadır. Veli ve öğrencinin
 * alınabilir saatleri ayrı salt okunur uçtadır (`GET /appointments/slots`, DOM-ILT-105).
 */

const response = { 200: commandResponseSchema, ...commandErrors }
const created = { 201: commandResponseSchema, ...commandErrors }

export function registerAppointmentRoutes(app: FastifyInstance) {
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

  const slotsModule = OPERATION_COMMANDS['appointment.slots'].module
  typed.get(
    '/api/v1/appointments/slots',
    {
      // Okuma: `If-Match` ve gövde yok. Sıra kimlik → modül → rol → sorgu (400) → core.
      preValidation: [
        app.authenticate,
        ...(slotsModule === null ? [] : [app.requireModule(slotsModule)]),
        app.requireRole(WRITE_ACTION_ROLES['appointment.slots']),
      ],
      schema: {
        operationId: 'listBookableSlots',
        tags: ['appointments'],
        summary: 'Randevu alınabilecek saatleri listele',
        description: `Öğrenci kendisi, veli seçili çocuğu (\`studentId\`) için öğrencinin sınıfına ders veren etkin öğretmenlerin gelecekteki uygunluk saatlerini okur (core \`bookableSlots\`, DOM-ILT-105). Aralık \`from\`–\`to\` (ISO 8601); verilmezse şimdiden itibaren 14 gün, \`to\` yalnız \`from\` ile verilir, en çok 28 gün (aşan, ters veya \`from\`suz aralık 400). Saat başına yalnız \`slotId\`, öğretmen ve adı, başlangıç, süre, varsa kampüs ve ders adları ile \`available\` döner; saatin iç notu, saati tutan randevu ve kişisi dönmez. \`available: false\` saatin talepte çakışma alacağını söyler (bekleyen/onaylı randevu ya da öğrencinin dersi, etüdü, randevusu, okul etkinliği; DOM-ILT-101) ve nedeni hiçbir durumda bildirilmez (DOM-ILT-073). Başka velinin çocuğu, kapsam dışı veya olmayan öğrenci olmayan kayıtla aynı 404 \`not_found\`; pasif öğrenci 422 \`student_inactive\`. Hiçbir şey yazılmaz. Modül \`communication\`. Roller: ${rolesOf('appointment.slots')}.`,
        querystring: bookableSlotsQuerySchema,
        response: {
          200: bookableSlotsResponseSchema,
          ...authenticatedErrors,
          404: errorResponseSchema,
          422: errorResponseSchema,
        },
      },
    },
    async (request) => ({ data: await listBookableSlots(contextOf(request), request.query) }),
  )

  typed.post(
    '/api/v1/appointments',
    {
      preValidation: guard('appointment.book', 'reject'),
      schema: {
        operationId: 'bookAppointment',
        tags: ['appointments'],
        summary: 'Öğretmenden randevu talep et',
        description: `Veli bağlı çocuğu, öğrenci kendisi için öğretmenin bir uygunluk saatini (\`slotId\`) seçerek randevu talep eder; başlangıç ve süre o saatten alınır, talep \`Bekliyor\` durumunda açılır (core \`bookAppointment\`, DOM-ILT-100, DOM-ILT-101). Başka velinin çocuğu veya kurumda olmayan öğrenci 403 \`student_scope_denied\` (DOM-YTK-025), pasif öğrenci 422 \`student_inactive\`. Olmayan saat, başka öğretmenin, öğrencinin sınıfına ders vermeyen veya pasif öğretmenin saati aynı 422 \`appointment_slot_unavailable\`; geçmiş saat 422 \`appointment_in_past\`; role uymayan tür 422 \`appointment_type_invalid\`. Ders, etüt, etkinlik veya bekleyen/onaylı randevuyla çakışma 409 \`appointment_conflict\`; aynı saate eşzamanlı iki talepten yalnız biri yazılır. Görüşme notu loglanmaz. Modül \`communication\`. \`Idempotency-Key\` zorunludur. Başarı 201 ve \`Location\`. Roller: ${rolesOf('appointment.book')}.`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: bookAppointmentSchema,
        response: created,
      },
    },
    async (request, reply) => {
      const body = sendCommand(
        reply,
        await bookAppointmentCommand(
          contextOf(request),
          input(request),
          options(request, 'required'),
        ),
      )
      const entity = body.data.entity
      if (entity)
        reply.header(
          'location',
          `/api/v1/collections/appointments/${encodeURIComponent(entity.id)}`,
        )
      return body
    },
  )

  typed.patch(
    '/api/v1/appointments/:appointmentId',
    {
      preValidation: guard('appointment.update', 'required'),
      schema: {
        operationId: 'updateAppointment',
        tags: ['appointments'],
        summary: 'Randevuyu onayla, reddet, iptal et veya geri çek',
        description: `Randevunun durumunu değiştirir; her geçiş yapan kişi, an ve gerekçesiyle kaydın \`history\` listesine eklenir, kayıt silinmez (core \`updateAppointment\`, DOM-ILT-102). \`Bekliyor\` talebi yalnız ilgili öğretmen onaylar veya gerekçeyle reddeder (403 \`appointment_teacher_only\`); talep eden onaydan önce geri çeker (403 \`appointment_requester_only\`); onaylı ve başlamamış randevuyu öğretmen veya talep eden gerekçeyle iptal eder (403 \`appointment_cancel_forbidden\`). Red ve iptalde gerekçe yoksa 400 \`validation_failed\` (\`reason\`). Onayda saat geçmişse 422 \`appointment_in_past\`, çakışma 409 \`appointment_conflict\`; sonuçlanmış randevu 409 \`appointment_closed\`, yanlış geçiş 422 \`appointment_transition_invalid\`. Olmayan, başka kurumun veya aktörün göremediği randevu 404; görünürlük sürümden önce denetlenir (DOM-ILT-103). \`If-Match\` zorunludur (randevunun sürümü): eksikse 400 \`if_match_required\`, tutmazsa 409 \`version_conflict\`. Gerekçe loglanmaz. Roller: ${rolesOf('appointment.update')}.`,
        headers: commandHeadersSchema('optional'),
        params: appointmentParamsSchema,
        body: updateAppointmentSchema,
        response,
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await updateAppointmentCommand(
          contextOf(request),
          request.params.appointmentId,
          input(request),
          options(request, 'optional'),
        ),
      ),
  )
}
