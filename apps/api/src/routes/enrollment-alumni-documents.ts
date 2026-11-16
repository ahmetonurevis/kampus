import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import {
  ALUMNI_DOCUMENT_FEE_ROLES,
  ALUMNI_DOCUMENT_ROLES,
  createAlumniDocumentRequestSchema,
  deliverAlumniDocumentSchema,
  markAlumniDocumentReadySchema,
  rejectAlumniDocumentSchema,
  updateAlumniDocumentFeesSchema,
} from '@kampus/school-core/lib/enrollment-alumni-documents.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  createAlumniRequestCommand,
  getAlumniFeesFor,
  getAlumniRequestFor,
  issueAlumniDocument,
  listAlumniRequestsFor,
  listAlumniStudentsFor,
  transitionAlumniRequestCommand,
  updateAlumniFeesCommand,
} from '../services/enrollment-alumni-documents.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  alumniDocumentResponse,
  alumniFeesResponse,
  alumniRequestListQuery,
  alumniRequestListResponse,
  alumniRequestParams,
  alumniRequestResponse,
  alumniStudentListResponse,
  alumniStudentQuery,
} from './enrollment-alumni-documents.schemas.ts'

/**
 * Mezun belge talebi uçları (docs/domain/kayit-ve-crm.md DOM-KAY-044; ON-260). Öğrenci belgesi gibi
 * personel kayıt ucudur: `/prospects` önekinde, modül `crm` (K-331). Talebi yönetici ve ön büro
 * kaydeder, hazırlar ve teslim eder; ücret ayarını yalnız yönetici değiştirir. Sıra: 401 → 403 modül
 * → 403 rol → `If-Match` → 400 → işlem.
 */

const STAFF = 'Roller: `yonetici`, `onburo` (diğerleri 403). Modül `crm`.'
const IF_MATCH = '`If-Match` zorunlu; sürüm tutmazsa 409 `version_conflict`.'
const BASE = '/api/v1/prospects/alumni-document-requests'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

const TRANSITIONS = {
  start: {
    operationId: 'startAlumniDocumentRequest',
    summary: 'Mezun belge talebini hazırlamaya başla',
    description:
      'Alınan talebi hazırlanıyor durumuna geçirir. Alındı durumunda değilse 422 `alumni_document_invalid_status`.',
    body: z.strictObject({}).nullish(),
  },
  ready: {
    operationId: 'markAlumniDocumentReady',
    summary: 'Mezun belgesini hazır işaretle',
    description:
      'Hazırlanan talebi hazır yapar ve yılın sıradaki belge numarasını (`MB-<yıl>-<sıra>`, Europe/Istanbul yılı) verir. Öğrenim belgesi ve not dökümünde içerik kayıtlardan üretilip dondurulur (kurum, ad, okul numarası, kayıt ve ayrılış günü, son sınıf; not dökümünde sınıf ve dönem başına ders ortalaması, dil okulunda kurlar); dosya verilirse 422 `alumni_document_file_not_allowed`, not dökümünde kayıt yoksa `manualNote` zorunlu (422 `alumni_document_transcript_empty`). Diploma örneğinde taranmış PDF (`fileId`, amaç `document`, aynı kullanıcının yüklediği bağsız dosya) zorunlu (422 `alumni_document_file_required`) ve talebe bağlanır; resmî sisteme gönderim yoktur (IST-143). Öğrencinin kaydı yeniden aktifse 422 `alumni_document_student_active`. Hazırlanıyor durumunda değilse 422 `alumni_document_invalid_status`.',
    body: markAlumniDocumentReadySchema.nullish(),
  },
  deliver: {
    operationId: 'deliverAlumniDocument',
    summary: 'Mezun belgesini teslim et',
    description:
      'Hazır belgeyi teslim edildi yapar. Kimlik doğrulama notu (5–500 karakter) zorunludur; kimliği kontrol eden oturumdaki personeldir. Ücretli talepte ödeme yöntemi (`cash`, `card`, `transfer`) seçilmeden 422 `alumni_document_payment_required`; ödendi işareti teslimle düşer, tahsilat kaydı açılmaz (K-329). Hazır değilse 422 `alumni_document_invalid_status`.',
    body: deliverAlumniDocumentSchema,
  },
  reject: {
    operationId: 'rejectAlumniDocumentRequest',
    summary: 'Mezun belge talebini reddet',
    description:
      'Teslim edilmemiş talebi gerekçeyle (5–500 karakter) reddeder (ör. talep edenin yetkisi doğrulanamadı). Teslim edilmiş ya da reddedilmiş talep 422 `alumni_document_invalid_status`.',
    body: rejectAlumniDocumentSchema,
  },
} as const

export function registerEnrollmentAlumniDocumentRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const crm = app.requireModule('crm')
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    crm,
    app.requireRole(roles),
  ]
  const tags = ['prospects']

  typed.get(
    BASE,
    {
      preValidation: guarded(ALUMNI_DOCUMENT_ROLES),
      schema: {
        operationId: 'listAlumniDocumentRequests',
        tags,
        summary: 'Mezun belge taleplerini listele',
        description: `Yeni alınan önce; durum, belge türü ve öğrenciyle süzülür, \`q\` öğrencinin ya da talep edenin adında ve belge numarasında arar. Yanıtta talep edenin adı, teslim iletişimi ve kimlik notu vardır (kişisel veri; loglanmaz). ${STAFF}`,
        querystring: alumniRequestListQuery,
        response: { 200: alumniRequestListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listAlumniRequestsFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    '/api/v1/prospects/alumni-document-students',
    {
      preValidation: guarded(ALUMNI_DOCUMENT_ROLES),
      schema: {
        operationId: 'listAlumniDocumentStudents',
        tags,
        summary: 'Mezun belge talebi açılabilecek öğrenciler',
        description: `Kaydı pasif (mezun ya da ayrılmış) öğrenciler, ada göre: kayıt durumu, mezuniyet ya da ayrılış günü, son sınıf, bugün reşit olup olmadığı (doğum tarihi bilinmiyorsa \`null\`) ve veli kaydına bağlı velileri (velayet, iletişim kısıtı). Kimlik numarası ve doğum tarihi dönmez. ${STAFF}`,
        querystring: alumniStudentQuery,
        response: { 200: alumniStudentListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q } = request.query
      const { items, total } = await listAlumniStudentsFor(contextOf(request), {
        page,
        pageSize,
        q,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    '/api/v1/prospects/alumni-document-fees',
    {
      preValidation: guarded(ALUMNI_DOCUMENT_ROLES),
      schema: {
        operationId: 'getAlumniDocumentFees',
        tags,
        summary: 'Mezun belge ücretleri',
        description: `Belge türü başına ücret (kuruş); ayarlanmamış tür ücretsizdir (K-329). ${STAFF}`,
        response: { 200: alumniFeesResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await getAlumniFeesFor(contextOf(request)) }),
  )

  typed.patch(
    '/api/v1/prospects/alumni-document-fees',
    {
      preValidation: [...guarded(ALUMNI_DOCUMENT_FEE_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'updateAlumniDocumentFees',
        tags,
        summary: 'Mezun belge ücretlerini değiştir',
        description:
          'Gönderilen belge türlerinin belge başı ücretini (0–1.000.000 kuruş) yazar; açılmış taleplerin dondurulmuş ücreti değişmez (K-329). Denetim `alumni_document_fees.update` (alan adları). Rol: `yonetici` (ön büro 403). Modül `crm`.',
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: updateAlumniDocumentFeesSchema,
        response: { 200: alumniFeesResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await updateAlumniFeesCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return alumniFeesResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    BASE,
    {
      preValidation: [...guarded(ALUMNI_DOCUMENT_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createAlumniDocumentRequest',
        tags,
        summary: 'Mezun belge talebi kaydet',
        description: `Telefon, e-posta, dilekçe ya da şahsen gelen talebi alındı durumunda kaydeder (DOM-KAY-044, K-328). Öğrenci kurumun mezun ya da ayrılmış öğrencisi olmalı: aktif öğrenci 422 \`alumni_document_student_active\` (öğrenci belgesi DOM-KAY-027), olmayan ya da başka kurumun öğrencisi 404. Diploma örneği yalnız okulda (422 \`alumni_document_type_unavailable\`) ve mezuna (422 \`alumni_document_not_graduated\`). Talep eden: kendisi (reşit değilse 422 \`alumni_document_requester_minor\`), velisi (öğrenciye bağlı veli kaydı; bağ yoksa 422 \`alumni_document_guardian_unknown\`, velayetsiz ya da iletişimi kısıtlıysa 422 \`alumni_document_guardian_not_authorized\`, öğrenci reşitse ya da yaşı bilinmiyorsa yazılı rıza dosyası yoksa 422 \`alumni_document_consent_required\`) ya da vekili (ad ve vekâletname zorunlu). Dosya (\`authorizationFileId\`, amaç \`document\`, aynı kullanıcının yüklediği bağsız dosya) talebe bağlanır. E-posta yolunda e-posta, kargo yolunda adres zorunlu. Ücret kurum ayarından belge başı × adet olarak dondurulur. \`Idempotency-Key\` zorunlu. ${STAFF}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: createAlumniDocumentRequestSchema,
        response: { 201: alumniRequestResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createAlumniRequestCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = alumniRequestResponse.parse(sendBody(reply, result))
      reply.header('location', `${BASE}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    `${BASE}/:requestId`,
    {
      preValidation: guarded(ALUMNI_DOCUMENT_ROLES),
      schema: {
        operationId: 'getAlumniDocumentRequest',
        tags,
        summary: 'Mezun belge talebi ayrıntısı',
        description: `Talep, durum izi (kim, ne zaman), belge numarası, ödendi işareti ve yapılabilecek işlemler. Olmayan ya da başka kurumun talebi 404. ${STAFF}`,
        params: alumniRequestParams,
        response: { 200: alumniRequestResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getAlumniRequestFor(contextOf(request), request.params.requestId),
    }),
  )

  typed.get(
    `${BASE}/:requestId/document`,
    {
      preValidation: guarded(ALUMNI_DOCUMENT_ROLES),
      schema: {
        operationId: 'getAlumniDocument',
        tags,
        summary: 'Mezun belgesinin PDF verisi',
        description: `Hazır ya da teslim edilmiş öğrenim belgesi ve not dökümünün dondurulmuş içeriği, numarası ve hazırlayanın notu; PDF web'de üretilir. Kimlik numarası ve doğum tarihi yoktur. Her istek denetime \`alumni_document.issue\` olarak yazılır (yalnız alan adları). Diploma örneği 422 \`alumni_document_no_pdf\`, hazır olmayan ya da reddedilen talep 422 \`alumni_document_not_ready\`, olmayan ya da başka kurumun talebi 404. ${STAFF}`,
        params: alumniRequestParams,
        response: { 200: alumniDocumentResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await issueAlumniDocument(contextOf(request), request.params.requestId),
    }),
  )

  for (const [verb, spec] of Object.entries(TRANSITIONS) as [
    keyof typeof TRANSITIONS,
    (typeof TRANSITIONS)[keyof typeof TRANSITIONS],
  ][]) {
    typed.post(
      `${BASE}/:requestId/${verb}`,
      {
        preValidation: [...guarded(ALUMNI_DOCUMENT_ROLES), requireIfMatch(), captureInput()],
        schema: {
          operationId: spec.operationId,
          tags,
          summary: spec.summary,
          description: `${spec.description} Olmayan ya da başka kurumun talebi 404. ${IF_MATCH} ${STAFF}`,
          headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
          params: alumniRequestParams,
          body: spec.body,
          response: { 200: alumniRequestResponse, ...commandErrors },
        },
      },
      async (request, reply) => {
        const opts = options(request, 'optional')
        const result = await transitionAlumniRequestCommand(
          contextOf(request),
          request.params.requestId,
          verb,
          request.commandInput,
          expected(opts.expectedVersion),
          opts.idempotency,
        )
        return alumniRequestResponse.parse(sendBody(reply, result))
      },
    )
  }
}
