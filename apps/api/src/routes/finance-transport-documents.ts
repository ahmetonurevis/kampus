import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_TRANSPORT_DOCUMENT_MANAGE_ROLES,
  FINANCE_TRANSPORT_DOCUMENT_ROLES,
  transportDocumentInputSchema,
  transportDocumentSettingsSchema,
} from '@kampus/school-core/lib/finance-transport-documents.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  createTransportDocumentCommand,
  getTransportDocumentAlertsFor,
  getTransportDocumentSettingsFor,
  listTransportDocumentsFor,
  setTransportDocumentSettingsCommand,
  transportDocumentFileUrl,
} from '../services/finance-transport-documents.ts'
import { assertSchoolLifeModule } from '../services/finance-transport.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import type { StorageDriver } from '../storage/storage.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  transportDocumentAlertsResponse,
  transportDocumentCreateResponse,
  transportDocumentFileUrlResponse,
  transportDocumentListQuery,
  transportDocumentListResponse,
  transportDocumentParams,
  transportDocumentSettingsResponse,
} from './finance-transport-documents.schemas.ts'

/**
 * Servis aracı ve personeli belgesi uçları (docs/domain/finans.md DOM-FIN-147; ON-147). Modüller
 * `finance` ve `transport`; okuma ve belge kaydı yönetici ve ön büro, uyarı ayarı ve özel nitelikli
 * kişi belgesi (adli sicil, psikoteknik) yalnız yönetici (K-496…K-498). Sıra: 401 → 403 modül → 403
 * rol → `If-Match` → 400 → işlem. Belge silinmez ve düzeltilmez; yeni belge eskisinin yerine geçer.
 */

const STAFF =
  'Rol: `yonetici`, `onburo`; adli sicil ve psikoteknik belgesini yalnız yönetici kaydeder ve dosyasını açar (K-497). Modüller `finance` ve `transport` (kapalıysa 403).'
const MANAGER = 'Rol: yalnız `yonetici` (ön büro 403). Modüller `finance` ve `transport`.'
const BASE = '/api/v1/finance/transport'
const DOCUMENTS = `${BASE}/documents`

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function versionOf(request: FastifyRequest) {
  const opts = options(request, 'optional')
  if (opts.expectedVersion === null) throw new Error('If-Match guard did not run')
  return { expectedVersion: opts.expectedVersion, idempotency: opts.idempotency }
}

export function registerFinanceTransportDocumentRoutes(
  app: FastifyInstance,
  storage: StorageDriver,
) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const schoolLife: preValidationAsyncHookHandler = async (request) =>
    assertSchoolLifeModule(contextOf(request), 'transport')
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    app.requireModule('finance'),
    schoolLife,
    app.requireRole(roles),
  ]
  const staff = guarded(FINANCE_TRANSPORT_DOCUMENT_ROLES)
  const tags = ['finance-transport-documents']

  typed.get(
    DOCUMENTS,
    {
      preValidation: staff,
      schema: {
        operationId: 'listTransportDocuments',
        tags,
        summary: 'Servis belgeleri',
        description: `Etkin araçların, sürücülerinin ve personelin belgeleri; bitişi en yakın önce (süresiz en sonda), sayfalı. Süzgeçler: özne, araç, personel, tür, \`due\` (süresi geçen, uyarı penceresinde biten, ikisi ya da geçerli; yalnız uyarıya sayılan belgeler) ve \`history=true\` (yerine geçilenler dahil). Önceki sürücünün ve pasif personelin belgesi \`counted: false\` döner. Özel nitelikli belgede yönetici dışında dosya bilgisi \`null\` (\`restricted: true\`; K-497). Arşivli aracın belgesi dönmez. ${STAFF}`,
        querystring: transportDocumentListQuery,
        response: { 200: transportDocumentListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, subject, vehicleId, membershipId, documentType, due, history } =
        request.query
      const { items, total } = await listTransportDocumentsFor(contextOf(request), {
        page,
        pageSize,
        subject,
        vehicleId,
        membershipId,
        documentType,
        due,
        history: history === 'true',
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    DOCUMENTS,
    {
      preValidation: [...staff, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createTransportDocument',
        tags,
        summary: 'Servis belgesi kaydet',
        description: `Özne araç (\`vehicleId\`; muayene, zorunlu trafik sigortası, koltuk sigortası, okul servis aracı uygunluk/izin belgesi, diğer; isteğe bağlı belge no), aracın kayıtlı sürücüsü (\`vehicleId\`; belge kayıt anındaki sürücü adına bağlanır) ya da kurum üyesi personel (\`membershipId\`; rehber ya da üye sürücü). Kişi belgesi ehliyet (sınıf zorunlu), SRC, psikoteknik, adli sicil ya da diğerdir; içerik ve numara saklanmaz (K-497). Bitiş muayene, sigortalar, izin belgesi, ehliyet ve psikoteknikte zorunlu (400). Başlangıç bugünden sonra olamaz (422 \`transport_document_start_in_future\`). Dosya isteğe bağlı: \`POST /files\` amaç \`document\` (PDF) ya da \`question_image\` (görsel, geçişte yalnız yönetici yükler), en çok 10 MB (422 \`transport_document_file_too_large\`). "Diğer" dışındaki türde yeni belge aynı öznenin geçerli belgesinin yerine kendiliğinden geçer ve yanıtta \`superseded\` döner; geçerli belgeden eski tarih 422 \`transport_document_older_than_current\` (K-496). Ön büro adli sicil ve psikoteknik kaydedemez (403 \`transport_document_sensitive_forbidden\`). Olmayan ya da arşivli araç 422 \`transport_document_vehicle_not_found\`; personel 422 \`transport_document_staff_not_found\`, \`transport_document_not_staff\`, \`transport_document_staff_inactive\`. Denetim \`finance.transport.document_create\` (alan adları) ve \`…document_supersede\`. \`Idempotency-Key\` zorunlu. ${STAFF}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: transportDocumentInputSchema,
        response: { 201: transportDocumentCreateResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createTransportDocumentCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = transportDocumentCreateResponse.parse(sendBody(reply, result))
      reply.header('location', `${DOCUMENTS}/${body.data.document.id}`)
      return body
    },
  )

  typed.get(
    `${DOCUMENTS}/:documentId/file-url`,
    {
      preValidation: staff,
      schema: {
        operationId: 'getTransportDocumentFileUrl',
        tags,
        summary: 'Servis belgesinin dosyasını aç',
        description: `Belgenin dosyası için kısa ömürlü imzalı bağlantı. Her üretim denetime \`finance.transport.document_file_open\` olarak yazılır; denetim yazılamazsa bağlantı dönmez. Adli sicil ve psikoteknik dosyasını yalnız yönetici açar (ön büro 403 \`transport_document_sensitive_forbidden\`; K-497). Dosyasız belge 422 \`transport_document_no_file\`. Belge dosyası \`GET /files/{fileId}/url\` yolundan açılmaz (404). Başka kurumun belgesi 404. ${STAFF}`,
        params: transportDocumentParams,
        response: { 200: transportDocumentFileUrlResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await transportDocumentFileUrl(contextOf(request), storage, request.params.documentId),
    }),
  )

  typed.get(
    `${BASE}/document-alerts`,
    {
      preValidation: staff,
      schema: {
        operationId: 'getTransportDocumentAlerts',
        tags,
        summary: 'Servis belgesi uyarıları ve araç uygunluğu',
        description: `Uyarıya sayılan belgelerde süresi geçen ve kurumun uyarı penceresinde (varsayılan 30 gün) biten belge sayısı; her etkin araç için süresi geçmiş ve yaklaşan zorunlu türler (araç: muayene, trafik ve koltuk sigortası, izin belgesi; şimdiki sürücü: ehliyet, SRC, psikoteknik, adli sicil), eksik türler ve etkin güzergâhlar. Zorunlu belgesi süresi geçmiş araç \`fit: false\` ("uygun değil"); öğrenci ataması engellenmez (K-498). Bildirim gönderilmez. ${STAFF}`,
        response: { 200: transportDocumentAlertsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await getTransportDocumentAlertsFor(contextOf(request)) }),
  )

  typed.get(
    `${BASE}/document-settings`,
    {
      preValidation: staff,
      schema: {
        operationId: 'getTransportDocumentSettings',
        tags,
        summary: 'Servis belgesi uyarı ayarı',
        description: `Uyarı penceresi (gün) ve \`If-Match\` sürümü; hiç kaydedilmediyse 30 gün, sürüm 1 (K-498). ${STAFF}`,
        response: { 200: transportDocumentSettingsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await getTransportDocumentSettingsFor(contextOf(request)) }),
  )

  typed.patch(
    `${BASE}/document-settings`,
    {
      preValidation: [
        ...guarded(FINANCE_TRANSPORT_DOCUMENT_MANAGE_ROLES),
        requireIfMatch(),
        captureInput(),
      ],
      schema: {
        operationId: 'updateTransportDocumentSettings',
        tags,
        summary: 'Servis belgesi uyarı ayarını değiştir',
        description: `Uyarı penceresi 1–180 gün; değişiklik yoksa 422 \`transport_document_settings_unchanged\`. \`If-Match\` ayar sürümü (hiç kaydedilmediyse 1), tutmazsa 409. Denetim \`finance.transport.document_settings\` (K-498). ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        body: transportDocumentSettingsSchema,
        response: { 200: transportDocumentSettingsResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await setTransportDocumentSettingsCommand(
        contextOf(request),
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return transportDocumentSettingsResponse.parse(sendBody(reply, result))
    },
  )
}
