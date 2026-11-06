import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { WRITE_ACTION_ROLES } from '@kampus/school-core/lib/authorize.ts'
import {
  decideFreezeSchema,
  FREEZE_PHASES,
  FREEZE_REASONS,
  FREEZE_STATUSES,
  freezesAvailableFor,
  requestFreezeSchema,
} from '@kampus/school-core/lib/enrollment-freezes.ts'
import { GROUP_MEMBER_STATUSES } from '@kampus/school-core/lib/language-groups.ts'

import { AppError, MESSAGES, NotFoundError } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  approveFreezeCommand,
  getFreezeFor,
  listFreezesFor,
  rejectFreezeCommand,
  requestFreezeCommand,
  returnFreezeCommand,
} from '../services/enrollment-freezes.ts'
import { getInstitutionModules } from '../services/modules.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/**
 * Kayıt dondurma uçları (docs/domain/dil-okulu.md DOM-DIL-052; kayit-ve-crm.md DOM-KAY-024, -026;
 * IST-084). Modül `crm`; yalnız dil okulunda vardır, başka türde 404 (rol reddinden önce). Talep
 * kursiyer (18 yaş altında veli) ya da personel, karar yönetici, dönüş yönetici ve ön büro.
 */

const BASE = '/api/v1/finance/enrollment-freezes'

const freezeSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  studentName: z.string().nullable(),
  status: z.enum(FREEZE_STATUSES),
  phase: z
    .enum(FREEZE_PHASES)
    .describe(
      'Görünen aşama: onaylı kayıt başlangıcı gelmediyse `scheduled`, etkideyse `frozen`, planlanan dönüş geçtiyse `overdue`',
    ),
  reason: z.enum(FREEZE_REASONS),
  reasonNote: z.string(),
  startDate: z.string(),
  returnDate: z.string().describe('Planlanan dönüş; kursiyer kendiliğinden dönmez'),
  endedDate: z.string().nullable(),
  midCourse: z.boolean().describe('Başlangıç kur ortasına denk geliyor; belge bilgisi zorunludur'),
  documentReceived: z.boolean().describe('Belge alındı beyanı; dosya içeriği alınmaz'),
  documentNote: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  startedAt: z.string().nullable().describe('Etkinin doğduğu an'),
  needsPlacement: z.boolean().describe('Dönüşte eski grup uygun değildi; yeniden yerleştirilir'),
  placementRenewalRequired: z
    .boolean()
    .describe('90 günü aşan dondurma: dönüşte seviye tespiti yenilenir (DOM-DIL-012)'),
  openInstallmentsDuring: z
    .number()
    .int()
    .describe(
      'Aralıkta vadesi gelen açık taksit sayısı; plan değişmez, erteleme ek protokolle yapılır',
    ),
  groups: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      memberStatus: z.enum(GROUP_MEMBER_STATUSES),
    }),
  ),
  createdAt: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})
const freezeResponseSchema = dataResponse(freezeSchema)
const freezeParams = z.object({ freezeId: z.uuid('Dondurma kimliği geçersiz.') })
const listQuerySchema = z.strictObject({
  ...pageQuerySchema.shape,
  status: z.enum(FREEZE_STATUSES).optional().describe('Saklanan durum'),
  q: z.string().trim().min(2).max(100).optional().describe('Kursiyer adında arama'),
})

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function versionOf(request: FastifyRequest): number {
  const { expectedVersion } = options(request, 'optional')
  if (expectedVersion === null)
    throw new AppError(400, 'if_match_required', MESSAGES.if_match_required)
  return expectedVersion
}

export function registerEnrollmentFreezeRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const crm = app.requireModule('crm')
  /** Dondurma yalnız dil okulunda vardır (DOM-DIL-052); modül denetiminden sonra, rolden önce. */
  const languageSchool: preValidationAsyncHookHandler = async function (request) {
    const ctx = contextOf(request)
    const institution = await getInstitutionModules(ctx.db, ctx.institutionId)
    if (institution === null || !freezesAvailableFor(institution.type)) throw new NotFoundError()
  }
  const guard = (action: keyof typeof WRITE_ACTION_ROLES) => [
    app.authenticate,
    crm,
    languageSchool,
    app.requireRole(WRITE_ACTION_ROLES[action]),
  ]
  const versionedHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })

  typed.get(
    BASE,
    {
      preValidation: guard('enrollment.freezeRequest'),
      schema: {
        operationId: 'listEnrollmentFreezes',
        tags: ['enrollment-freezes'],
        summary: 'Kayıt dondurmaları',
        description:
          'En yeni kayıt önce gelir. `status` saklanan duruma, `q` kursiyer adına (Türkçe harf duyarsız) göre süzer; sayfalıdır, bilinmeyen parametre 400. Personel kurumun bütün kayıtlarını, öğrenci kendi kaydını, veli bağlı çocuklarının kaydını görür (DOM-DIL-052).',
        querystring: listQuerySchema,
        response: {
          200: z.object({ data: z.array(freezeSchema), meta: pageMetaSchema }),
          ...commandErrors,
        },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total } = await listFreezesFor(contextOf(request), request.query)
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${BASE}/:freezeId`,
    {
      preValidation: guard('enrollment.freezeRequest'),
      schema: {
        operationId: 'getEnrollmentFreeze',
        tags: ['enrollment-freezes'],
        summary: 'Kayıt dondurma ayrıntısı',
        description: 'Kapsam dışı ya da başka kurumun kaydı 404.',
        params: freezeParams,
        response: { 200: freezeResponseSchema, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getFreezeFor(contextOf(request), request.params.freezeId),
    }),
  )

  typed.post(
    BASE,
    {
      preValidation: [...guard('enrollment.freezeRequest'), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'requestEnrollmentFreeze',
        tags: ['enrollment-freezes'],
        summary: 'Kayıt dondurma talebi aç',
        description:
          'Kursiyer (18 yaş altında veli) ya da personel gerekçeyle açar (DOM-DIL-052). Küçük kursiyerin kendi talebi 403 `freeze_guardian_required`, 18 yaşını dolduranın velisi 403 `freeze_learner_required`; kapsam dışı öğrenci 404. Açık kayıt varsa 409 `enrollment_freeze_open`; ayrılmış ya da mezun kursiyer 409 `freeze_student_inactive`. Geçmiş başlangıç 422 `freeze_start_past`, başlangıçtan önceki dönüş 422 `freeze_return_before_start`, toplamda 6 ayı aşan süre 422 `freeze_limit_exceeded`. Kur ortasına denk gelen başlangıç belge alındı beyanı ister: yoksa 422 `freeze_document_required`; dosya içeriği alınmaz. Rol: `yonetici`, `onburo`, `ogrenci`, `veli`. Başarı 201 ve `Location`.',
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: requestFreezeSchema,
        response: { 201: freezeResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await requestFreezeCommand(
        contextOf(request),
        request.body.studentId,
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = freezeResponseSchema.parse(sendBody(reply, result))
      reply.header('location', `${BASE}/${body.data.id}`)
      return body
    },
  )

  typed.post(
    `${BASE}/:freezeId/approve`,
    {
      preValidation: [...guard('enrollment.freezeDecide'), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'approveEnrollmentFreeze',
        tags: ['enrollment-freezes'],
        summary: 'Kayıt dondurmayı onayla',
        description:
          'Yönetici gerekçeyle onaylar; koşullar onay anındaki veriyle yeniden denetlenir (DOM-DIL-052). Başlangıç günü geldiyse kayıt durumu `Dondurulmuş` olur, kapanmamış gruptaki üyelik dondurulur ve kapasitede yer tutmaz; ileri tarihli onay başlangıç günü işlenir. Taksit planı değişmez: erteleme ek protokolle yapılır ve kursiyere/veliye onaylatılır. MEBBİS kaydına yazmaz (H-24, doğrulanmalı). Karara bağlanmış talep 409 `enrollment_freeze_decided`. `If-Match` zorunlu. Rol: `yonetici`.',
        headers: versionedHeaders,
        params: freezeParams,
        body: decideFreezeSchema,
        response: { 200: freezeResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await approveFreezeCommand(
        contextOf(request),
        request.params.freezeId,
        request.commandInput,
        versionOf(request),
        options(request, 'optional').idempotency,
      )
      return freezeResponseSchema.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${BASE}/:freezeId/reject`,
    {
      preValidation: [...guard('enrollment.freezeDecide'), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'rejectEnrollmentFreeze',
        tags: ['enrollment-freezes'],
        summary: 'Kayıt dondurmayı reddet',
        description:
          'Yönetici gerekçeyle reddeder; kursiyerin kaydı değişmez (DOM-DIL-052). Karara bağlanmış talep 409 `enrollment_freeze_decided`. `If-Match` zorunlu. Rol: `yonetici`.',
        headers: versionedHeaders,
        params: freezeParams,
        body: decideFreezeSchema,
        response: { 200: freezeResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await rejectFreezeCommand(
        contextOf(request),
        request.params.freezeId,
        request.commandInput,
        versionOf(request),
        options(request, 'optional').idempotency,
      )
      return freezeResponseSchema.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${BASE}/:freezeId/return`,
    {
      preValidation: [...guard('enrollment.freezeReturn'), requireIfMatch()],
      schema: {
        operationId: 'returnEnrollmentFreeze',
        tags: ['enrollment-freezes'],
        summary: 'Kursiyerin dönüşünü işle',
        description:
          'Kayıt yeniden `Aktif` olur (DOM-DIL-052). Aynı grup garanti edilmez: yalnız henüz başlamamış ve boş yeri olan gruptaki üyelik geri açılır, öteki üyelik kapanır ve `needsPlacement` döner. 90 günü aşan dondurmada `placementRenewalRequired` döner (DOM-DIL-012). Başlamamış onaylı dondurmayı da kapatır; süre sayılmaz. Etkin olmayan kayıt 409 `enrollment_freeze_not_active`. `If-Match` zorunlu. Rol: `yonetici`, `onburo`.',
        headers: versionedHeaders,
        params: freezeParams,
        response: { 200: freezeResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await returnFreezeCommand(
        contextOf(request),
        request.params.freezeId,
        versionOf(request),
        options(request, 'optional').idempotency,
      )
      return freezeResponseSchema.parse(sendBody(reply, result))
    },
  )
}
