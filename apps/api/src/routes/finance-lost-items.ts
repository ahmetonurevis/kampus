import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_LOST_ITEM_MANAGE_ROLES,
  FINANCE_LOST_ITEM_ROLES,
  LOST_ITEM_FAMILY_ROLES,
  LOST_ITEM_REPORT_READ_ROLES,
  lostItemCreateSchema,
  lostItemDisposalSchema,
  lostItemHandoverSchema,
  lostItemPhotoSchema,
  lostItemSettingsSchema,
  lostItemUpdateSchema,
  lostReportCreateSchema,
  lostReportMatchSchema,
} from '@kampus/school-core/lib/finance-lost-items.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  addLostItemPhotoCommand,
  closeLostReportCommand,
  createLostItemCommand,
  createLostReportCommand,
  disposeLostItemsCommand,
  getLostItemFor,
  handOverLostItemCommand,
  listLostItemFindersFor,
  listLostItemRetentionFor,
  listLostItemsFor,
  listLostReportsFor,
  lostItemGalleryFor,
  lostItemRecipientsFor,
  lostItemSettingsFor,
  lostItemSummaryFor,
  matchLostReportCommand,
  removeLostItemPhotoCommand,
  setLostItemSettingsCommand,
  unmatchLostReportCommand,
  updateLostItemCommand,
} from '../services/finance-lost-items.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import type { StorageDriver } from '../storage/storage.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  lostItemDisposalResponse,
  lostItemFinderListResponse,
  lostItemFinderQuery,
  lostItemGalleryQuery,
  lostItemGalleryResponse,
  lostItemListQuery,
  lostItemListResponse,
  lostItemParams,
  lostItemPhotoParams,
  lostItemRecipientQuery,
  lostItemRecipientsResponse,
  lostItemResponse,
  lostItemRetentionQuery,
  lostItemRetentionResponse,
  lostItemSettingsResponse,
  lostItemSummaryResponse,
  lostReportListQuery,
  lostReportListResponse,
  lostReportParams,
  lostReportResponse,
} from './finance-lost-items.schemas.ts'

/**
 * Kayıp eşya uçları (docs/domain/finans.md DOM-FIN-145; ON-171; K-490…K-492). Modül `finance`.
 * Bulunan eşya, fotoğraf, eşleme, teslim, özet ve ayar okuma yönetici ve ön büro; ayar yazma,
 * saklama listesi ve toplu bağış/imha yalnız yönetici; kayıp bildirimi ve galeri veli ve öğrenci.
 * Sıra: 401 → 403 modül → 403 rol → başlıklar → 400 → işlem.
 */

const STAFF = 'Rol: `yonetici` ve `onburo`. Modül `finance`.'
const MANAGER = 'Rol: yalnız `yonetici` (ön büro 403). Modül `finance`.'
const FAMILY =
  'Rol: `veli` (yalnız kapsamındaki çocuğu) ve `ogrenci` (yalnız kendisi). Modül `finance`.'
const ITEMS = '/api/v1/finance/lost-items'
const REPORTS = '/api/v1/finance/lost-item-reports'
const SETTINGS = '/api/v1/finance/lost-item-settings'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function versionOf(request: Parameters<typeof options>[0]) {
  const opts = options(request, 'optional')
  if (opts.expectedVersion === null) throw new Error('If-Match guard did not run')
  return { expectedVersion: opts.expectedVersion, idempotency: opts.idempotency }
}

export function registerFinanceLostItemRoutes(app: FastifyInstance, storage: StorageDriver) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(roles),
  ]
  const staff = guarded(FINANCE_LOST_ITEM_ROLES)
  const manager = guarded(FINANCE_LOST_ITEM_MANAGE_ROLES)
  const family = guarded(LOST_ITEM_FAMILY_ROLES)
  const reportReaders = guarded(LOST_ITEM_REPORT_READ_ROLES)
  const tags = ['finance-lost-items']
  const versioned = { headers: commandHeadersSchema('optional', { ifMatch: 'required' }) }

  typed.get(
    ITEMS,
    {
      preValidation: staff,
      schema: {
        operationId: 'listLostItems',
        tags,
        summary: 'Bulunan eşyalar',
        description: `Bekleyenler önce, sonra en yeni bulunan önce. Süzgeç durum ve kategori; arama tanımda, bulunduğu ve saklandığı yerde. Satırda fotoğraf sayısı, eşlenen bildirim ve saklama sonu (K-490, K-492). ${STAFF}`,
        querystring: lostItemListQuery,
        response: { 200: lostItemListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, status, category } = request.query
      const { items, total } = await listLostItemsFor(contextOf(request), {
        page,
        pageSize,
        q,
        status,
        category,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    ITEMS,
    {
      preValidation: [...staff, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createLostItem',
        tags,
        summary: 'Bulunan eşyayı kaydet',
        description: `Tanım (2–300), kategori, bulunduğu yer ve gün, saklama yeri, isteğe bağlı bulan personel ve 0–3 fotoğraf (önce \`POST /files\`, amaç \`question_image\`: jpg/png/webp, 2 MB; geçişte yalnız yönetici yükler). Bulunma günü gelecekte 422 \`lost_item_found_future\`, 90 günden eski 422 \`lost_item_found_too_old\`; bulan kişi yok 422 \`lost_item_finder_not_found\`, personel değil \`lost_item_finder_not_staff\`, pasif \`lost_item_finder_inactive\`; fotoğraf başkasının ya da hazır değilse dosya altyapısının hatası (422 \`file_unavailable\`, \`file_not_ready\`, \`file_purpose_mismatch\`, 409 \`file_already_attached\`) (K-490). Yanıtta fotoğraf bağlantısı boştur. Denetim \`finance.lost_item.create\` (alan adları). \`Idempotency-Key\` zorunlu. ${STAFF}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: lostItemCreateSchema,
        response: { 201: lostItemResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createLostItemCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = lostItemResponse.parse(sendBody(reply, result))
      reply.header('location', `${ITEMS}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    `${ITEMS}/:itemId`,
    {
      preValidation: staff,
      schema: {
        operationId: 'getLostItem',
        tags,
        summary: 'Bulunan eşya ayrıntısı',
        description: `Eşya, teslim ya da bağış/imha ayrıntısı ve fotoğrafların kısa ömürlü imzalı bağlantıları (bağış/imha edilen eşyanın fotoğrafı açılmaz, bağlantı boş). Başka kurumun eşyası 404. ${STAFF}`,
        params: lostItemParams,
        response: { 200: lostItemResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getLostItemFor(contextOf(request), storage, request.params.itemId),
    }),
  )

  typed.patch(
    `${ITEMS}/:itemId`,
    {
      preValidation: [...staff, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateLostItem',
        tags,
        summary: 'Bulunan eşyayı düzelt',
        description: `Tanım, kategori, yerler, gün ve bulan personel; gönderilmeyen alan korunur. Teslim edilen, bağışlanan ya da imha edilen eşya 422 \`lost_item_closed\`; değişiklik yoksa 422 \`lost_item_unchanged\`. \`If-Match\` zorunlu. Denetim \`finance.lost_item.update\`. ${STAFF}`,
        params: lostItemParams,
        ...versioned,
        body: lostItemUpdateSchema,
        response: { 200: lostItemResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await updateLostItemCommand(
        contextOf(request),
        request.params.itemId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return lostItemResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${ITEMS}/:itemId/photos`,
    {
      preValidation: [...staff, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'addLostItemPhoto',
        tags,
        summary: 'Eşyaya fotoğraf ekle',
        description: `Yüklenmiş (\`ready\`) fotoğraf eşyaya bağlanır; en çok 3 (422 \`lost_item_photo_limit\`), kapanmış eşya 422 \`lost_item_closed\`. Eşyanın sürümü artar. \`If-Match\` eşya sürümü. Denetim \`finance.lost_item.photo_add\`. ${STAFF}`,
        params: lostItemParams,
        ...versioned,
        body: lostItemPhotoSchema,
        response: { 200: lostItemResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await addLostItemPhotoCommand(
        contextOf(request),
        request.params.itemId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return lostItemResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    `${ITEMS}/:itemId/photos/:fileId`,
    {
      preValidation: [...staff, requireIfMatch()],
      schema: {
        operationId: 'removeLostItemPhoto',
        tags,
        summary: 'Eşyadan fotoğraf çıkar',
        description: `Fotoğrafın bağı kalkar; dosyayı platformun bağsız dosya temizliği siler. Eşyanın olmayan fotoğrafı 404, kapanmış eşya 422 \`lost_item_closed\`. \`If-Match\` eşya sürümü. Denetim \`finance.lost_item.photo_remove\`. ${STAFF}`,
        params: lostItemPhotoParams,
        ...versioned,
        response: { 200: lostItemResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await removeLostItemPhotoCommand(
        contextOf(request),
        request.params.itemId,
        request.params.fileId,
        expectedVersion,
        idempotency,
      )
      return lostItemResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${ITEMS}/:itemId/handover`,
    {
      preValidation: [...staff, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'handOverLostItem',
        tags,
        summary: 'Eşyayı teslim et',
        description: `Teslim alan öğrenci (\`studentId\`), öğrencinin velisi (\`studentId\` + \`guardianLinkId\`, \`GET /finance/lost-item-recipients\`) ya da adıyla başka kişi (\`recipientName\`); teslim eden oturumdaki üyeliktir, an şimdidir. Öğrenci yok 422 \`lost_item_student_not_found\`, bağ yok 422 \`lost_item_guardian_not_found\`, iletişim kısıtlı veli 422 \`lost_item_guardian_restricted\` (DOM-ILT-072), kapanmış eşya 422 \`lost_item_closed\`. Eşlenen bildirim \`returned\` olur; fotoğraflar 30 gün sonra imhaya işaretlenir. Teslimden sonra eşya değişmez (K-490). \`If-Match\` zorunlu. Denetim \`finance.lost_item.handover\`. ${STAFF}`,
        params: lostItemParams,
        ...versioned,
        body: lostItemHandoverSchema,
        response: { 200: lostItemResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await handOverLostItemCommand(
        contextOf(request),
        request.params.itemId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return lostItemResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    '/api/v1/finance/lost-item-summary',
    {
      preValidation: staff,
      schema: {
        operationId: 'getLostItemSummary',
        tags,
        summary: 'Kayıp eşya özeti',
        description: `Bekleyen, saklama süresi dolan, aranan ve teslim bekleyen eşleşmiş bildirim sayısı ile saklama süresi. Kişisel veri taşımaz. ${STAFF}`,
        response: { 200: lostItemSummaryResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await lostItemSummaryFor(contextOf(request)) }),
  )

  typed.get(
    '/api/v1/finance/lost-item-finders',
    {
      preValidation: staff,
      schema: {
        operationId: 'listLostItemFinders',
        tags,
        summary: 'Bulan kişi seçimi',
        description: `Kurumun etkin yönetici, öğretmen ve ön büro üyelikleri, ada göre. ${STAFF}`,
        querystring: lostItemFinderQuery,
        response: { 200: lostItemFinderListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q } = request.query
      const { items, total } = await listLostItemFindersFor(contextOf(request), {
        page,
        pageSize,
        q,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    '/api/v1/finance/lost-item-recipients',
    {
      preValidation: staff,
      schema: {
        operationId: 'getLostItemRecipients',
        tags,
        summary: 'Teslim alabilecek aile',
        description: `Öğrenci ve etkin veli bağları (ad, yakınlık, teslim alabilir mi); iletişim kısıtlı veli \`canReceive: false\`. Olmayan ya da başka kurumun öğrencisi 404. ${STAFF}`,
        querystring: lostItemRecipientQuery,
        response: { 200: lostItemRecipientsResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await lostItemRecipientsFor(contextOf(request), request.query.studentId),
    }),
  )

  typed.get(
    REPORTS,
    {
      preValidation: reportReaders,
      schema: {
        operationId: 'listLostItemReports',
        tags,
        summary: 'Kayıp bildirimleri',
        description: `Açıklar önce, sonra eşlenmişler ve kapananlar; süzgeç durum, arama tanımda. Personel bütün bildirimleri ve eşlenen eşyayı (yer dahil) görür; veli yalnız kapsamındaki çocuklarının, öğrenci yalnız kendi bildirimlerini, eşya ayrıntısı olmadan görür (K-491). Roller: \`yonetici\`, \`onburo\`, \`veli\`, \`ogrenci\`. Modül \`finance\`.`,
        querystring: lostReportListQuery,
        response: { 200: lostReportListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, status } = request.query
      const { items, total } = await listLostReportsFor(contextOf(request), {
        page,
        pageSize,
        q,
        status,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    REPORTS,
    {
      preValidation: [...family, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createLostItemReport',
        tags,
        summary: 'Kayıp bildirimi aç',
        description: `Öğrenci, tanım (2–300), isteğe bağlı kategori ve kaybolduğu gün. Kapsam dışı ya da olmayan öğrenci 404; gün gelecekte 422 \`lost_report_future\`, 90 günden eski 422 \`lost_report_too_old\` (K-491). Denetim \`finance.lost_report.create\`. \`Idempotency-Key\` zorunlu. ${FAMILY}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: lostReportCreateSchema,
        response: { 201: lostReportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createLostReportCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = lostReportResponse.parse(sendBody(reply, result))
      reply.header('location', `${REPORTS}/${body.data.id}`)
      return body
    },
  )

  typed.post(
    `${REPORTS}/:reportId/match`,
    {
      preValidation: [...staff, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'matchLostItemReport',
        tags,
        summary: 'Bildirimi bulunan eşyayla eşle',
        description: `Açık bildirim bekleyen eşyayla eşlenir; eşleme teslim değildir. Bildirim açık değil 422 \`lost_report_not_open\`, eşya yok 422 \`lost_item_not_found\`, kapanmış 422 \`lost_item_closed\`, başka bildirimle eşli 409 \`lost_item_already_matched\` (K-491). \`If-Match\` bildirim sürümü. Denetim \`finance.lost_report.match\`. ${STAFF}`,
        params: lostReportParams,
        ...versioned,
        body: lostReportMatchSchema,
        response: { 200: lostReportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await matchLostReportCommand(
        contextOf(request),
        request.params.reportId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return lostReportResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${REPORTS}/:reportId/unmatch`,
    {
      preValidation: [...staff, requireIfMatch()],
      schema: {
        operationId: 'unmatchLostItemReport',
        tags,
        summary: 'Eşlemeyi kaldır',
        description: `Yanlış eşleme kalkar, bildirim yeniden açılır; eşlenmemiş bildirim 422 \`lost_report_not_matched\`. Gövde yok. \`If-Match\` bildirim sürümü. Denetim \`finance.lost_report.unmatch\`. ${STAFF}`,
        params: lostReportParams,
        ...versioned,
        response: { 200: lostReportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await unmatchLostReportCommand(
        contextOf(request),
        request.params.reportId,
        expectedVersion,
        idempotency,
      )
      return lostReportResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${REPORTS}/:reportId/close`,
    {
      preValidation: [...reportReaders, requireIfMatch()],
      schema: {
        operationId: 'closeLostItemReport',
        tags,
        summary: 'Bildirimi kapat',
        description: `Açık ya da eşlenmiş bildirim kapanır (aile vazgeçti ya da buldu, ön büro bulunamadı dedi); eşleme varsa kalkar. Teslim edilmiş ya da kapalı bildirim 422 \`lost_report_not_open\`; ailenin kapsamı dışındaki bildirim 404. Gövde yok. \`If-Match\` bildirim sürümü. Denetim \`finance.lost_report.close\`. Roller: \`yonetici\`, \`onburo\`, \`veli\`, \`ogrenci\`. Modül \`finance\`.`,
        params: lostReportParams,
        ...versioned,
        response: { 200: lostReportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await closeLostReportCommand(
        contextOf(request),
        request.params.reportId,
        expectedVersion,
        idempotency,
      )
      return lostReportResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    '/api/v1/finance/lost-item-gallery',
    {
      preValidation: family,
      schema: {
        operationId: 'listLostItemGallery',
        tags,
        summary: 'Bekleyen eşya galerisi',
        description: `Bekleyen eşyaların yalnız kategorisi, bulunduğu gün ve fotoğraflarının kısa ömürlü bağlantıları; tanım, yer ve bulan kişi dönmez (K-491). Kurum galeriyi kapattıysa liste boş ve \`meta.enabled: false\`. ${FAMILY}`,
        querystring: lostItemGalleryQuery,
        response: { 200: lostItemGalleryResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, category } = request.query
      const { items, total, enabled } = await lostItemGalleryFor(contextOf(request), storage, {
        page,
        pageSize,
        category,
      })
      return { data: items, meta: { page, pageSize, total, enabled } }
    },
  )

  typed.get(
    '/api/v1/finance/lost-item-retention',
    {
      preValidation: manager,
      schema: {
        operationId: 'listLostItemRetention',
        tags,
        summary: 'Saklama süresi dolan eşyalar',
        description: `Bekleyen ve bulunma günü + kurum ayarlı süre (gün) bugün ya da önce olan eşyalar, en eski önce (K-492). ${MANAGER}`,
        querystring: lostItemRetentionQuery,
        response: { 200: lostItemRetentionResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total, retentionDays } = await listLostItemRetentionFor(contextOf(request), {
        page,
        pageSize,
      })
      return { data: items, meta: { page, pageSize, total, retentionDays } }
    },
  )

  typed.post(
    '/api/v1/finance/lost-item-disposals',
    {
      preValidation: [...manager, app.requireFreshSession, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'disposeLostItems',
        tags,
        summary: 'Süresi dolan eşyaları bağışla ya da imha et',
        description: `1–100 eşya tek işlemde, \`donated\` ya da \`destroyed\` ve zorunlu gerekçe (2–300); biri reddedilirse hiçbiri değişmez. Olmayan ya da başka kurumun 422 \`lost_item_not_found\`, kapanmış 422 \`lost_item_closed\`, bildirimle eşli 422 \`lost_item_matched\`, süresi dolmamış 422 \`lost_item_retention_not_due\`. Fotoğraflar hemen imhaya işaretlenir; nesneyi platform imha işi siler (K-492). Eşya başına \`finance.lost_item.dispose\` denetimi (gerekçe yazılmaz). Taze oturum (403 \`reauthentication_required\`) ve \`Idempotency-Key\` zorunlu. Geri alınamaz. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: lostItemDisposalSchema,
        response: { 200: lostItemDisposalResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await disposeLostItemsCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return lostItemDisposalResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    SETTINGS,
    {
      preValidation: staff,
      schema: {
        operationId: 'getLostItemSettings',
        tags,
        summary: 'Kayıp eşya ayarı',
        description: `Saklama süresi (gün; varsayılan 30) ve aile galerisi (varsayılan açık); hiç kaydedilmediyse varsayılan ve sürüm 1 (K-491, K-492). ${STAFF}`,
        response: { 200: lostItemSettingsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await lostItemSettingsFor(contextOf(request)) }),
  )

  typed.patch(
    SETTINGS,
    {
      preValidation: [...manager, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'setLostItemSettings',
        tags,
        summary: 'Kayıp eşya ayarını kaydet',
        description: `Saklama süresi (7–365 gün, 400) ve aile galerisi; gönderilmeyen alan korunur, değişiklik yoksa 422 \`lost_item_settings_unchanged\`. \`If-Match\` zorunlu (hiç kaydedilmediyse 1). Denetim \`finance.lost_item.settings\`. ${MANAGER}`,
        ...versioned,
        body: lostItemSettingsSchema,
        response: { 200: lostItemSettingsResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await setLostItemSettingsCommand(
        contextOf(request),
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return lostItemSettingsResponse.parse(sendBody(reply, result))
    },
  )
}
