import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_VISITOR_MANAGE_ROLES,
  FINANCE_VISITOR_ROLES,
  visitorAnonymizationSchema,
  visitorBadgeReleaseSchema,
  visitorCheckInSchema,
  visitorCheckOutSchema,
  visitorSettingsSchema,
} from '@kampus/school-core/lib/finance-visitors.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  anonymizeVisitorsCommand,
  checkInVisitorCommand,
  checkOutVisitorCommand,
  getVisitorFor,
  listVisitorHostsFor,
  listVisitorRetentionFor,
  listVisitorsFor,
  releaseVisitorBadgeCommand,
  setVisitorSettingsCommand,
  visitorSettingsFor,
  visitorSummaryFor,
} from '../services/finance-visitors.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  visitorAnonymizationResponse,
  visitorHostListResponse,
  visitorHostQuery,
  visitorListQuery,
  visitorListResponse,
  visitorParams,
  visitorResponse,
  visitorRetentionQuery,
  visitorRetentionResponse,
  visitorSettingsResponse,
  visitorSummaryResponse,
} from './finance-visitors.schemas.ts'

/**
 * Ziyaretçi kaydı uçları (docs/domain/finans.md DOM-FIN-141; ON-166; K-478…K-480). Modül
 * `finance`. Giriş, çıkış, kart, liste, ayrıntı, özet ve ayar okuma yönetici ve ön büro; ayar
 * yazma, saklama listesi ve anonimleştirme yalnız yönetici. Sıra: 401 → 403 modül → 403 rol →
 * başlıklar → 400 → işlem.
 */

const STAFF = 'Rol: `yonetici` ve `onburo`. Modül `finance`.'
const MANAGER = 'Rol: yalnız `yonetici` (ön büro 403). Modül `finance`.'
const VISITORS = '/api/v1/finance/visitors'
const SETTINGS = '/api/v1/finance/visitor-settings'

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

export function registerFinanceVisitorRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(roles),
  ]
  const staff = guarded(FINANCE_VISITOR_ROLES)
  const manager = guarded(FINANCE_VISITOR_MANAGE_ROLES)
  const tags = ['finance-visitors']

  typed.get(
    VISITORS,
    {
      preValidation: staff,
      schema: {
        operationId: 'listVisitors',
        tags,
        summary: 'Ziyaretçiler',
        description: `İçeridekiler önce (en eski giriş önce), sonra çıkanlar en yeni önce. Süzgeç gün, \`status=inside\` (gün sonunda içeride kalanlar), amaç ve \`badge=outstanding\` (kartı ziyaretçide kalanlar); arama ad ve kart numarasında. Telefon yalnız maskeli, açıklama yok (K-478). Önceki günden içeride kalan \`overdue\` (K-479). ${STAFF}`,
        querystring: visitorListQuery,
        response: { 200: visitorListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, date, status, purpose, badge } = request.query
      const { items, total } = await listVisitorsFor(contextOf(request), {
        page,
        pageSize,
        q,
        date,
        status,
        purpose,
        badgeOutstanding: badge === 'outstanding',
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    VISITORS,
    {
      preValidation: [...staff, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'checkInVisitor',
        tags,
        summary: 'Ziyaretçi girişi',
        description: `Ad soyad (2–120), kimlik görüldü işareti ve görülen belgenin türü (numara alınmaz; görüldüyse tür zorunlu, görülmediyse boş, 400), isteğe bağlı telefon, amaç (\`other\` açıklama ister, 400), isteğe bağlı ziyaret edilen personel ve veli görüşmesinde öğrenci, giriş anı (boşsa şimdi), havuzdan kart ve gösterilen aydınlatma sürümü (zorunlu). Gelecekteki giriş 422 \`visitor_check_in_future\`, 24 saatten eski 422 \`visitor_check_in_too_old\`; kişi yok 422 \`visitor_host_not_found\`, personel değil \`visitor_host_not_staff\`, pasif \`visitor_host_inactive\`; öğrenci yok 422 \`visitor_student_not_found\`; kart havuzda yok 422 \`visitor_badge_unknown\`, iade edilmemiş başka ziyarette 409 \`visitor_badge_in_use\` (K-478, K-479). Denetim \`finance.visitor.check_in\` (alan adları). \`Idempotency-Key\` zorunlu. ${STAFF}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: visitorCheckInSchema,
        response: { 201: visitorResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await checkInVisitorCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = visitorResponse.parse(sendBody(reply, result))
      reply.header('location', `${VISITORS}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    `${VISITORS}/:visitorId`,
    {
      preValidation: staff,
      schema: {
        operationId: 'getVisitor',
        tags,
        summary: 'Ziyaret kaydı ayrıntısı',
        description: `Tam telefon, açıklama, aydınlatma sürümü, kart ve anonimleştirme bilgisi. Okuma aynı transaction'da \`finance.visitor.read\` denetimine düşer (K-478). Başka kurumun kaydı 404. ${STAFF}`,
        params: visitorParams,
        response: { 200: visitorResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getVisitorFor(contextOf(request), request.params.visitorId),
    }),
  )

  typed.post(
    `${VISITORS}/:visitorId/check-out`,
    {
      preValidation: [...staff, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'checkOutVisitor',
        tags,
        summary: 'Ziyaretçi çıkışı',
        description: `Çıkış anı (boşsa şimdi) ve kartın iade edilip edilmediği (varsayılan evet). İkinci çıkış 422 \`visitor_already_checked_out\`, gelecek 422 \`visitor_check_out_future\`, girişten önce 422 \`visitor_check_out_before_check_in\`, anonim kayıt 422 \`visitor_anonymized\`. İade edilmeyen kart ziyaretçide kalır (K-479). \`If-Match\` zorunlu. Denetim \`finance.visitor.check_out\`. ${STAFF}`,
        params: visitorParams,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        body: visitorCheckOutSchema,
        response: { 200: visitorResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await checkOutVisitorCommand(
        contextOf(request),
        request.params.visitorId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return visitorResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${VISITORS}/:visitorId/badge-release`,
    {
      preValidation: [...staff, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'releaseVisitorBadge',
        tags,
        summary: 'Ziyaretçi kartını iade al ya da kayıp işaretle',
        description: `\`returned\` ya da \`lost\`; kart havuzda serbest kalır. Kart verilmemiş 422 \`visitor_no_badge\`, kapanmış 422 \`visitor_badge_already_released\` (K-479). \`If-Match\` zorunlu. Denetim \`finance.visitor.badge_release\`. ${STAFF}`,
        params: visitorParams,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        body: visitorBadgeReleaseSchema,
        response: { 200: visitorResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await releaseVisitorBadgeCommand(
        contextOf(request),
        request.params.visitorId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return visitorResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    '/api/v1/finance/visitor-summary',
    {
      preValidation: staff,
      schema: {
        operationId: 'getVisitorSummary',
        tags,
        summary: 'Ziyaretçi özeti ve kart havuzu',
        description: `Bugünün ziyaret sayısı, içeride, önceki günden içeride kalan ve ziyaretçide kalan kart sayısı; geçerli aydınlatma sürümü ve kart havuzu (kart ziyaretçideyse kaydın kimliği) (K-479). Kişisel veri taşımaz. ${STAFF}`,
        response: { 200: visitorSummaryResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await visitorSummaryFor(contextOf(request)) }),
  )

  typed.get(
    '/api/v1/finance/visitor-hosts',
    {
      preValidation: staff,
      schema: {
        operationId: 'listVisitorHosts',
        tags,
        summary: 'Ziyaret edilebilecek personel',
        description: `Kurumun etkin yönetici, öğretmen ve ön büro üyelikleri, ada göre; giriş formundaki seçim içindir. ${STAFF}`,
        querystring: visitorHostQuery,
        response: { 200: visitorHostListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q } = request.query
      const { items, total } = await listVisitorHostsFor(contextOf(request), { page, pageSize, q })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    '/api/v1/finance/visitor-retention',
    {
      preValidation: manager,
      schema: {
        operationId: 'listVisitorRetention',
        tags,
        summary: 'Saklama süresi dolan ziyaret kayıtları',
        description: `Anonimleştirilmemiş, çıkışı yapılmış ve ziyaret günü + kurum ayarlı süre (gün) bugün ya da önce olan kayıtlar, en eski önce (K-480). ${MANAGER}`,
        querystring: visitorRetentionQuery,
        response: { 200: visitorRetentionResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total, retentionDays } = await listVisitorRetentionFor(contextOf(request), {
        page,
        pageSize,
      })
      return { data: items, meta: { page, pageSize, total, retentionDays } }
    },
  )

  typed.post(
    '/api/v1/finance/visitor-anonymizations',
    {
      preValidation: [...manager, app.requireFreshSession, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'anonymizeVisitors',
        tags,
        summary: 'Ziyaret kayıtlarını anonimleştir',
        description: `1–100 kayıt tek işlemde; biri reddedilirse hiçbiri değişmez. Ad "Anonim ziyaretçi" olur; telefon, açıklama ve öğrenci bağı silinir; gün, saatler, amaç, ziyaret edilen kişi, kart ve aydınlatma sürümü kalır (K-480). \`retention_expired\` yalnız süresi dolanlarda (422 \`visitor_retention_not_due\`); \`data_subject_request\` süre beklemez. Olmayan ya da başka kurumun 422 \`visitor_not_found\`, anonim 422 \`visitor_already_anonymized\`, içerideki 422 \`visitor_still_inside\`. Kayıt başına \`finance.visitor.anonymize\` denetimi. Taze oturum (403 \`reauthentication_required\`) ve \`Idempotency-Key\` zorunlu. Geri alınamaz. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: visitorAnonymizationSchema,
        response: { 200: visitorAnonymizationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await anonymizeVisitorsCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return visitorAnonymizationResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    SETTINGS,
    {
      preValidation: staff,
      schema: {
        operationId: 'getVisitorSettings',
        tags,
        summary: 'Ziyaretçi kaydı ayarı',
        description: `Saklama süresi (gün; varsayılan 30), geçerli aydınlatma sürümü ve kart havuzu; hiç kaydedilmediyse varsayılan ve sürüm 1 (K-479, K-480). ${STAFF}`,
        response: { 200: visitorSettingsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await visitorSettingsFor(contextOf(request)) }),
  )

  typed.patch(
    SETTINGS,
    {
      preValidation: [...manager, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'setVisitorSettings',
        tags,
        summary: 'Ziyaretçi kaydı ayarını kaydet',
        description: `Saklama süresi (1–365 gün, 400), aydınlatma sürümü (≤ 40, boş bırakılabilir) ve kart havuzu (≤ 200 tekil numara; harf, rakam, tire); gönderilmeyen alan korunur. Değişiklik yoksa 422 \`visitor_settings_unchanged\`; ziyaretçide kalan kart havuzdan çıkarılamaz (422 \`visitor_settings_badge_in_use\`). \`If-Match\` zorunlu (hiç kaydedilmediyse 1). Denetim \`finance.visitor.settings\`. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        body: visitorSettingsSchema,
        response: { 200: visitorSettingsResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await setVisitorSettingsCommand(
        contextOf(request),
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return visitorSettingsResponse.parse(sendBody(reply, result))
    },
  )
}
