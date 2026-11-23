import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_STAFF_DOCUMENT_MANAGE_ROLES,
  FINANCE_STAFF_DOCUMENT_ROLES,
  staffDocumentInputSchema,
  staffDocumentSettingsUpdateSchema,
} from '@kampus/school-core/lib/finance-staff-documents.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  createStaffDocumentCommand,
  getStaffDocumentAlertsFor,
  getStaffDocumentSettingsFor,
  getStaffDocumentsFor,
  listStaffDocumentStaffFor,
  listStaffDocumentsFor,
  staffDocumentFileUrl,
  updateStaffDocumentSettingsCommand,
} from '../services/finance-staff-documents.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import type { StorageDriver } from '../storage/storage.ts'
import { captureInput, options, rejectIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  staffDocumentAlertsQuery,
  staffDocumentAlertsResponse,
  staffDocumentCreateResponse,
  staffDocumentDetailResponse,
  staffDocumentFileUrlResponse,
  staffDocumentListQuery,
  staffDocumentListResponse,
  staffDocumentParams,
  staffDocumentSettingsResponse,
  staffDocumentStaffListResponse,
  staffDocumentStaffQuery,
  staffParams,
} from './finance-staff-documents.schemas.ts'

/**
 * Personel özlük belgesi uçları (docs/domain/finans.md DOM-FIN-113; ON-173). Modül `finance`;
 * okuma ve belge kaydı yönetici ve ön büro, tür ayarı yalnız yönetici (K-372, K-374). Özel
 * nitelikli belgeyi (adli sicil, sağlık raporu) yalnız yönetici kaydeder ve dosyasını açar; her
 * dosya açılışı denetime düşer. Sıra: 401 → 403 modül → 403 rol → 400 → işlem. Belge silinmez ve
 * düzeltilmez; yeni belge eskisinin yerine geçer (K-373).
 */

const STAFF =
  'Rol: `yonetici` ve `onburo`; özel nitelikli belgenin (adli sicil, sağlık raporu ve kurumca işaretlenen tür) dosyası ve ayrıntısı yalnız yöneticide (K-374). Modül `finance`.'
const MANAGER = 'Rol: yalnız `yonetici` (ön büro 403). Modül `finance`.'
const URL = '/api/v1/finance/staff-documents'
const STAFF_URL = '/api/v1/finance/staff-document-staff'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

export function registerFinanceStaffDocumentRoutes(app: FastifyInstance, storage: StorageDriver) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(roles),
  ]
  const tags = ['finance-staff-documents']

  typed.get(
    '/api/v1/finance/staff-document-types',
    {
      preValidation: guarded(FINANCE_STAFF_DOCUMENT_ROLES),
      schema: {
        operationId: 'getStaffDocumentTypes',
        tags,
        summary: 'Özlük belgesi tür ayarları',
        description: `Altı belge türünün (diploma, sağlık raporu, adli sicil kaydı, sertifika, kimlik fotokopisi, diğer) zorunluluğu, geçerlilik süresi (ay) ve özel nitelikli işareti; ayarlanmamış tür platform varsayılanıdır (\`customized: false\`; K-372). ${STAFF}`,
        response: { 200: staffDocumentSettingsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await getStaffDocumentSettingsFor(contextOf(request)) }),
  )

  typed.patch(
    '/api/v1/finance/staff-document-types',
    {
      preValidation: [
        ...guarded(FINANCE_STAFF_DOCUMENT_MANAGE_ROLES),
        rejectIfMatch(),
        captureInput(),
      ],
      schema: {
        operationId: 'updateStaffDocumentTypes',
        tags,
        summary: 'Özlük belgesi tür ayarlarını değiştir',
        description: `Gönderilen türlerin ayarı bütünüyle yazılır (zorunlu, geçerlilik süresi 1–120 ay ya da \`null\` süresiz, özel nitelikli). Adli sicil ve sağlık raporunun özel nitelikli işareti kaldırılamaz (400). Kayıtlı belgelerin bitişi değişmez (K-372). Denetim \`finance.staff_document_type.update\` (tür adları). ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: staffDocumentSettingsUpdateSchema,
        response: { 200: staffDocumentSettingsResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await updateStaffDocumentSettingsCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return staffDocumentSettingsResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    '/api/v1/finance/staff-document-alerts',
    {
      preValidation: guarded(FINANCE_STAFF_DOCUMENT_ROLES),
      schema: {
        operationId: 'getStaffDocumentAlerts',
        tags,
        summary: 'Özlük belgesi uyarı sayıları',
        description: `Etkin personelde süresi geçen ve \`withinDays\` gün (varsayılan 30) içinde bitecek belge sayısı ile zorunlu belgesi eksik personel sayısı (pano ve sekme rozeti). Bildirim gönderilmez. ${STAFF}`,
        querystring: staffDocumentAlertsQuery,
        response: { 200: staffDocumentAlertsResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getStaffDocumentAlertsFor(contextOf(request), request.query.withinDays),
    }),
  )

  typed.get(
    URL,
    {
      preValidation: guarded(FINANCE_STAFF_DOCUMENT_ROLES),
      schema: {
        operationId: 'listStaffDocuments',
        tags,
        summary: 'Geçerlilik takibi',
        description: `Etkin personelin yerine geçilmemiş belgeleri, bitişi en yakın önce (süresiz en sonda). \`due\`: süresi geçen, \`withinDays\` gün içinde biten, ikisi (\`attention\`) ya da geçerli; tür ve personel adıyla süzülür, sayfalıdır. Özel nitelikli belgede listede **yalnız tür ve tarihler** döner (\`restricted: true\`, dosya ve not \`null\`; K-374). ${STAFF}`,
        querystring: staffDocumentListQuery,
        response: { 200: staffDocumentListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, documentType, due, withinDays } = request.query
      const { items, total } = await listStaffDocumentsFor(contextOf(request), {
        page,
        pageSize,
        q,
        documentType,
        due,
        withinDays,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    STAFF_URL,
    {
      preValidation: guarded(FINANCE_STAFF_DOCUMENT_ROLES),
      schema: {
        operationId: 'listStaffDocumentStaff',
        tags,
        summary: 'Personel ve özlük belgesi özeti',
        description: `Kurumun yönetici, öğretmen ve ön büro üyelikleri ada göre; her satırda yerine geçilmemiş belge sayısı, eksik zorunlu türler, süresi geçen ve \`withinDays\` gün içinde biten belge sayısı (pasif personelde eksik ve uyarı yok). \`missing=true\` yalnız zorunlu belgesi eksik etkin personeli verir. ${STAFF}`,
        querystring: staffDocumentStaffQuery,
        response: { 200: staffDocumentStaffListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, status, missing, withinDays } = request.query
      const { items, total } = await listStaffDocumentStaffFor(contextOf(request), {
        page,
        pageSize,
        q,
        status,
        missing: missing === 'true',
        withinDays,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${STAFF_URL}/:membershipId`,
    {
      preValidation: guarded(FINANCE_STAFF_DOCUMENT_ROLES),
      schema: {
        operationId: 'getStaffDocuments',
        tags,
        summary: 'Personelin özlük belgeleri',
        description: `Bütün belgeler (yerine geçilenler dahil) ve eksik zorunlu türler. Özel nitelikli belgenin dosya bilgisi yalnız yöneticiye döner; ön büroda yalnız tür ve tarihler (K-374). Olmayan, başka kurumun ya da personel olmayan (öğrenci, veli) üyelik 404. ${STAFF}`,
        params: staffParams,
        response: { 200: staffDocumentDetailResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getStaffDocumentsFor(contextOf(request), request.params.membershipId),
    }),
  )

  typed.post(
    URL,
    {
      preValidation: [...guarded(FINANCE_STAFF_DOCUMENT_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createStaffDocument',
        tags,
        summary: 'Özlük belgesi kaydet',
        description: `Personel, tür (sağlık raporunda işe giriş/periyodik), belge tarihi (bugünden sonra olamaz, 422 \`staff_document_date_in_future\`), isteğe bağlı elle geçerlilik bitişi (verilmezse türün süresinden), isteğe bağlı dosya (\`POST /files\` amaç \`document\`; yükleyenin, hazır ve bağsız olmalı) ve not. Tekil türde (sağlık raporu, adli sicil, kimlik) yeni belge geçerli belgenin yerine kendiliğinden geçer; diploma, sertifika ve diğerde yalnız \`replacesDocumentId\` verilirse (422 \`staff_document_replace_not_found\`). Yerine geçtiği belgeden eski tarih 422 \`staff_document_older_than_current\`. Yerine geçilen belge yanıtta \`superseded\` olarak döner (K-373). Özel nitelikli türü ön büro kaydedemez (403 \`staff_document_sensitive_forbidden\`) ve bu türe not yazılmaz (422 \`staff_document_sensitive_note\`). Olmayan üyelik 422 \`staff_document_staff_not_found\`, öğrenci/veli 422 \`staff_document_not_staff\`, pasif personel 422 \`staff_document_staff_inactive\`. Belge silinmez. Denetim kaydına alan adları yazılır. \`Idempotency-Key\` isteğe bağlı. ${STAFF}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: staffDocumentInputSchema,
        response: { 201: staffDocumentCreateResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createStaffDocumentCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = staffDocumentCreateResponse.parse(sendBody(reply, result))
      reply.header('location', `${URL}/${body.data.document.id}`)
      return body
    },
  )

  typed.get(
    `${URL}/:documentId/file-url`,
    {
      preValidation: guarded(FINANCE_STAFF_DOCUMENT_ROLES),
      schema: {
        operationId: 'getStaffDocumentFileUrl',
        tags,
        summary: 'Özlük belgesinin dosyasını aç',
        description: `Belgenin dosyası için kısa ömürlü imzalı bağlantı (5 dk). Her üretim denetim kaydına \`finance.staff_document.file_open\` olarak yazılır; denetim yazılamazsa bağlantı dönmez. Özel nitelikli belgenin dosyasını yalnız yönetici açar (ön büro 403 \`staff_document_sensitive_forbidden\`; K-374). Dosyasız belge 422 \`staff_document_no_file\`; dosya işlenirken 409 \`file_processing\`. Belge dosyası \`GET /files/{fileId}/url\` yolundan açılmaz (404). Başka kurumun belgesi 404. ${STAFF}`,
        params: staffDocumentParams,
        response: { 200: staffDocumentFileUrlResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await staffDocumentFileUrl(contextOf(request), storage, request.params.documentId),
    }),
  )
}
