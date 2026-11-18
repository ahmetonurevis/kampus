import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  addProspectDocumentSchema,
  createDocumentTypeSchema,
  PROSPECT_DOCUMENT_ROLES,
  PROSPECT_DOCUMENT_SETTINGS_ROLES,
  recordDocumentConsentSchema,
  reviewProspectDocumentSchema,
  updateDocumentTypeSchema,
} from '@kampus/school-core/lib/prospect-documents.ts'

import { contextOf } from '../plugins/authenticate.ts'
import type { StorageDriver } from '../storage/storage.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import {
  addProspectDocumentCommand,
  archiveDocumentTypeCommand,
  createDocumentTypeCommand,
  documentGapsFor,
  documentTypesFor,
  prospectDocumentsFor,
  prospectDocumentUrlFor,
  recordDocumentConsentCommand,
  reviewProspectDocumentCommand,
  updateDocumentTypeCommand,
  withdrawDocumentConsentCommand,
} from '../services/prospect-documents.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  documentGapListResponse,
  documentGapQuery,
  documentParams,
  documentTypeArchiveResponse,
  documentTypeListResponse,
  documentTypeParams,
  documentTypeResponse,
  documentUrlResponse,
  prospectDocumentsResponse,
  prospectParams,
} from './prospect-documents.schemas.ts'

/**
 * Aday belgeleri uçları (docs/domain/kayit-ve-crm.md DOM-KAY-043; ON-263). Modül `crm`; belge
 * yönetimi yönetici ve ön büro, tür listesinin yazması yalnız yönetici (K-320), özel nitelikli
 * belgenin açılışı ve incelemesi yalnız yönetici (K-322). Sıra: 401 → 403 modül → 403 rol →
 * `If-Match` → 400 → işlem. Dosya önce `POST /api/v1/files` (amaç `document`: PDF, 20 MB) ile
 * yüklenir; tarama ve tür denetimi orada.
 */

const ROLES =
  'Roller: `yonetici`, `onburo` (diğerleri 403); `crm` modülü kapalıysa 403 `module_disabled`. Olmayan ya da başka kurumun adayı 404.'
const ADMIN =
  'Rol: `yonetici` (ön büro okur, yazamaz; diğerleri 403); `crm` modülü kapalıysa 403 `module_disabled`.'
const DOCUMENTS = '/api/v1/prospects/:prospectId/documents'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

const asList = (value: string | string[] | undefined) =>
  value === undefined ? null : typeof value === 'string' ? [value] : value

export function registerProspectDocumentRoutes(app: FastifyInstance, storage: StorageDriver) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('crm'),
    app.requireRole(PROSPECT_DOCUMENT_ROLES),
  ]
  const settings: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('crm'),
    app.requireRole(PROSPECT_DOCUMENT_SETTINGS_ROLES),
  ]
  const tags = ['prospects']

  typed.get(
    '/api/v1/prospects/document-types',
    {
      preValidation: guarded,
      schema: {
        operationId: 'listProspectDocumentTypes',
        tags,
        summary: 'Aday belge türlerini listele',
        description: `Kurumun arşivlenmemiş belge türleri, sırayla (K-320). Kurumun hiç türü yoksa ilk okumada varsayılan liste yazılır: kimlik, karne, fotoğraf ve sağlık raporu kesin kayıt aşamasında; okulda kimlik, karne ve fotoğraf, kursta yalnız kimlik zorunlu; sağlık raporu zorunlu değil ve özel nitelikli; "Diğer belge" ön başvuruda, zorunlu değil. ${ROLES}`,
        response: { 200: documentTypeListResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await documentTypesFor(contextOf(request)) }),
  )

  typed.post(
    '/api/v1/prospects/document-types',
    {
      preValidation: [...settings, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createProspectDocumentType',
        tags,
        summary: 'Aday belge türü ekle',
        description: `Tür (\`identity\`, \`report_card\`, \`health_report\`, \`photo\`, \`other\`), ad (2–80), zorunlu mu, aşama (\`application\` ön başvuru, \`enrollment\` kesin kayıt) ve özel nitelikli işareti. Sağlık raporunda işaret kendiliğinden açıktır; \`false\` 422 \`document_type_special_required\`. Ad arşivlenmemiş türler arasında tekil: 409 \`document_type_exists\`; en çok 30 tür: 422 \`document_type_limit\`. ${ADMIN}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: createDocumentTypeSchema,
        response: { 201: documentTypeResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createDocumentTypeCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return documentTypeResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    '/api/v1/prospects/document-types/:typeId',
    {
      preValidation: [...settings, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateProspectDocumentType',
        tags,
        summary: 'Aday belge türünü düzelt',
        description: `Kısmi düzeltme: ad, zorunluluk, aşama, özel nitelikli işareti; tür (\`kind\`) değişmez (gövdede 400). Değişiklik eksik belge hesabına hemen yansır; var olan belgenin erişim kuralı yükleme anındaki işarettir. Olmayan, arşivlenmiş ya da başka kurumun türü 404; sürüm tutmazsa 409 \`version_conflict\`; \`If-Match\` zorunlu. ${ADMIN}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: documentTypeParams,
        body: updateDocumentTypeSchema,
        response: { 200: documentTypeResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateDocumentTypeCommand(
        contextOf(request),
        request.params.typeId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return documentTypeResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    '/api/v1/prospects/document-types/:typeId',
    {
      preValidation: [...settings, requireIfMatch()],
      schema: {
        operationId: 'archiveProspectDocumentType',
        tags,
        summary: 'Aday belge türünü arşivle',
        description: `Arşivli tür listede ve eksik belge hesabında yoktur, yeni belge alınmaz; var olan belgeler adıyla kalır. Olmayan ya da başka kurumun türü 404, sürüm tutmazsa 409; \`If-Match\` zorunlu. ${ADMIN}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: documentTypeParams,
        response: { 200: documentTypeArchiveResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await archiveDocumentTypeCommand(
        contextOf(request),
        request.params.typeId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return documentTypeArchiveResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    '/api/v1/prospects/document-gaps',
    {
      preValidation: guarded,
      schema: {
        operationId: 'listProspectDocumentGaps',
        tags,
        summary: 'Eksik belgesi olan adaylar',
        description: `Aşaması gelmiş zorunlu belgesi eksik olan açık adaylar, ad sırasıyla (DOM-KAY-043, K-321): ön başvuru belgesi aday açıkken, kesin kayıt belgesi \`Teklif verildi\` aşamasında istenir; reddedilen ya da dosyası imha edilen belge eksiktir, incelemesi bekleyen belge eksik değildir (\`awaitingReview\`). Vazgeçen ve kayda dönmüş aday listede yoktur (kayda dönmüş adayın eksikleri aday belgelerindedir). \`prospectId\` (en çok 100) verilirse yalnız o adaylar. Satır telefon ve e-posta taşımaz. Platform ileti göndermez (K-323). ${ROLES}`,
        querystring: documentGapQuery,
        response: { 200: documentGapListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, prospectId } = request.query
      const { items, total } = await documentGapsFor(contextOf(request), {
        page,
        pageSize,
        prospectIds: asList(prospectId),
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    DOCUMENTS,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getProspectDocuments',
        tags,
        summary: 'Adayın belgeleri',
        description: `Belge türleri (arşivliler dahil), belgeler (yerine yenisi yüklenenler dahil, en yeni önce), eksik zorunlu türler ve özel nitelikli belge rızası (DOM-KAY-043). Özel nitelikli belgeyi açamayan (ön büro) dosya adını ve ret gerekçesini \`null\` görür. Kayda dönmüş adayda iki aşamanın eksikleri de döner; vazgeçen adayda eksik yoktur. ${ROLES}`,
        params: prospectParams,
        response: { 200: prospectDocumentsResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await prospectDocumentsFor(contextOf(request), request.params.prospectId),
    }),
  )

  typed.post(
    DOCUMENTS,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'addProspectDocument',
        tags,
        summary: 'Adaya belge ekle',
        description: `Önceden \`POST /api/v1/files\` (amaç \`document\`) ile aynı kullanıcının yüklediği, taramadan geçmiş (\`ready\`) dosyayı belge türüne bağlar (DOM-KAY-043). Aynı türün güncel belgesi \`superseded\` olur ve dosyası 30 gün sonra imhaya işaretlenir (K-323). Dosya yoksa, başkasınınsa ya da imhaya işaretliyse 422 \`file_unavailable\`; henüz hazır değilse 422 \`file_not_ready\`; başka kayda bağlıysa 409 \`file_already_attached\`; amacı \`document\` değilse 422 \`file_purpose_mismatch\`. Bilinmeyen tür 422 \`document_type_unknown\`, arşivli tür 422 \`document_type_archived\`; özel nitelikli türde etkin rıza yoksa 422 \`document_consent_required\` (K-322); adayda 50 belge sınırı 422 \`prospect_document_limit\`. Vazgeçen aday 409 \`prospect_closed\`. Başarıda 201 ve adayın belge görünümü. ${ROLES}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        params: prospectParams,
        body: addProspectDocumentSchema,
        response: { 201: prospectDocumentsResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await addProspectDocumentCommand(
        contextOf(request),
        request.params.prospectId,
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return prospectDocumentsResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${DOCUMENTS}/:documentId/review`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'reviewProspectDocument',
        tags,
        summary: 'Aday belgesini kabul et ya da reddet',
        description: `\`{ decision: 'accept' }\` ya da \`{ decision: 'reject', reason }\` (gerekçe 2–300 karakter; özel nitelikli bilgi yazılmaz, denetime yalnız alan adı düşer). Yalnız incelemesi bekleyen güncel belge: kararlı belge 409 \`prospect_document_reviewed\`, yerine yenisi yüklenen 409 \`prospect_document_superseded\`, dosyası imha edilen 422 \`prospect_document_file_missing\`. Özel nitelikli belgeyi yalnız yönetici inceler: ön büro 403 \`special_document_forbidden\` (K-322). Vazgeçen aday 409 \`prospect_closed\`. \`If-Match\` belgenin sürümü. ${ROLES}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: documentParams,
        body: reviewProspectDocumentSchema,
        response: { 200: prospectDocumentsResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await reviewProspectDocumentCommand(
        contextOf(request),
        request.params.prospectId,
        request.params.documentId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return prospectDocumentsResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${DOCUMENTS}/:documentId/url`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getProspectDocumentUrl',
        tags,
        summary: 'Aday belgesinin imzalı bağlantısı',
        description: `5 dakikalık imzalı indirme bağlantısı (ADR 0003 karar 6). Her üretim denetim kaydına \`prospect_document.read\` olarak yazılır (DOM-YTK-052). Aday belgesinin dosyası genel dosya uçlarından (\`GET /api/v1/files/{fileId}\`, \`/url\`) açılmaz (404). Özel nitelikli belgeyi yalnız yönetici açar: ön büro 403 \`special_document_forbidden\` (K-322). Dosyası imha edilmiş belge 422 \`prospect_document_file_missing\`; başka adayın ya da kurumun belgesi 404. ${ROLES}`,
        params: documentParams,
        response: { 200: documentUrlResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await prospectDocumentUrlFor(
        contextOf(request),
        storage,
        request.params.prospectId,
        request.params.documentId,
      ),
    }),
  )

  typed.post(
    '/api/v1/prospects/:prospectId/document-consent',
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'recordProspectDocumentConsent',
        tags,
        summary: 'Özel nitelikli belge için açık rızayı kaydet',
        description: `Ön büro ya da yönetici, sağlık raporu gibi özel nitelikli belge için ıslak imzalı açık rıza formunu aldığını kaydeder (\`method: 'wet_signature'\`; K-322, H-50). Rızayı veren adaydan türetilir: okul adayında ve 18 yaş altında veli (\`guardian\`), yetişkin kursiyer adayında kendisi (\`self\`). Etkin rıza varken 409 \`document_consent_exists\`; vazgeçen aday 409 \`prospect_closed\`. 201 ve adayın belge görünümü. ${ROLES}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        params: prospectParams,
        body: recordDocumentConsentSchema,
        response: { 201: prospectDocumentsResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await recordDocumentConsentCommand(
        contextOf(request),
        request.params.prospectId,
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return prospectDocumentsResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    '/api/v1/prospects/:prospectId/document-consent/withdraw',
    {
      preValidation: [...guarded, requireIfMatch()],
      schema: {
        operationId: 'withdrawProspectDocumentConsent',
        tags,
        summary: 'Özel nitelikli belge rızasını geri çek',
        description: `Tek işlem, anında etkili (DOM-YTK-059 deseni): rıza satırına geri çekme anı yazılır, adayın özel nitelikli belgeleri arşivlenir ve dosyaları hemen imhaya işaretlenir; yeni özel nitelikli belge yüklenmez. Aşamadan bağımsızdır. Etkin rıza yoksa 409 \`document_consent_missing\`; \`If-Match\` rızanın sürümü. ${ROLES}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: prospectParams,
        response: { 200: prospectDocumentsResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await withdrawDocumentConsentCommand(
        contextOf(request),
        request.params.prospectId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return prospectDocumentsResponse.parse(sendBody(reply, result))
    },
  )
}
