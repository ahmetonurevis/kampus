import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  CAMPAIGN_ROLES,
  createCampaignSchema,
  updateCampaignSchema,
} from '@kampus/school-core/lib/prospect-campaigns.ts'

import { errorResponseSchema } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import {
  archiveCampaignCommand,
  campaignFunnelCsvFor,
  campaignFunnelFor,
  createCampaignCommand,
  getCampaignFor,
  listCampaignsFor,
  updateCampaignCommand,
} from '../services/prospect-campaigns.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { authenticatedErrors } from './common.schemas.ts'
import {
  campaignArchiveResponse,
  campaignFunnelQuery,
  campaignFunnelResponse,
  campaignListQuery,
  campaignListResponse,
  campaignParams,
  campaignResponse,
} from './prospect-campaigns.schemas.ts'

/**
 * Kampanya kodu uçları ve kayıt hunisinin kampanya kırılımı (docs/domain/kayit-ve-crm.md
 * DOM-KAY-041; IST-117, ON-134). Modül `crm`; roller yönetici ve ön büro (K-291). Sıra: 401 → 403
 * modül → 403 rol → `If-Match` → 400 → işlem. Kampanya silinmez: `DELETE` arşivler.
 */

const ROLES =
  'Roller: `yonetici`, `onburo` (diğerleri 403); `crm` modülü kapalıysa 403 `module_disabled`.'
const wantsCsv = (request: FastifyRequest) => (request.headers.accept ?? '').includes('text/csv')

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerProspectCampaignRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('crm'),
    app.requireRole(CAMPAIGN_ROLES),
  ]
  const tags = ['prospects']

  typed.get(
    '/api/v1/campaign-codes',
    {
      preValidation: guarded,
      schema: {
        operationId: 'listCampaignCodes',
        tags,
        summary: 'Kampanya kodlarını listele',
        description: `Arşivlenmemiş kampanyalar, en yeni başlangıç önce (DOM-KAY-041). \`status=usable\` aday formunun seçenekleridir: etkin ve bugün (Europe/Istanbul) tarih aralığında olanlar. \`q\` kod ya da adda arar. Bilinmeyen parametre 400. ${ROLES}`,
        querystring: campaignListQuery,
        response: { 200: campaignListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listCampaignsFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    '/api/v1/campaign-codes',
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createCampaignCode',
        tags,
        summary: 'Kampanya kodu ekle',
        description: `Kod (büyük harfe çevrilir; İngilizce harf, rakam ve tire, 3–20 karakter), ad, kanal (\`social_media\`, \`flyer\`, \`fair\`, \`referral\`, \`website\`, \`other\`), başlangıç–bitiş günü (iki uç dahil), isteğe bağlı maliyet (kuruş) ve etkinlik. Kod kurumda arşivliler dahil tekil: 409 \`campaign_code_exists\` (K-288). Bitiş başlangıçtan önceyse 400. ${ROLES}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: createCampaignSchema,
        response: { 201: campaignResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createCampaignCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = campaignResponse.parse(sendBody(reply, result))
      reply.header('location', `/api/v1/campaign-codes/${body.data.id}`)
      return body
    },
  )

  typed.get(
    '/api/v1/campaign-codes/:campaignId',
    {
      preValidation: guarded,
      schema: {
        operationId: 'getCampaignCode',
        tags,
        summary: 'Kampanya kodu ayrıntısı',
        description: `Olmayan, arşivlenmiş ya da başka kurumun kampanyası 404. ${ROLES}`,
        params: campaignParams,
        response: { 200: campaignResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getCampaignFor(contextOf(request), request.params.campaignId),
    }),
  )

  typed.patch(
    '/api/v1/campaign-codes/:campaignId',
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateCampaignCode',
        tags,
        summary: 'Kampanya kodunu düzelt ya da pasifleştir',
        description: `Kısmi düzeltme: ad, kanal, günler, maliyet (\`null\` siler) ve \`isActive\`. Kod değişmez (gövdede \`code\` 400). Birleşik günlerde bitiş başlangıçtan önceyse 422 \`campaign_dates_invalid\`. Pasif ya da günleri dışında kalan kampanyanın kodu yeni adaya bağlanmaz; bağlı adaylar değişmez. Sürüm tutmazsa 409 \`version_conflict\`; \`If-Match\` zorunlu. ${ROLES}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: campaignParams,
        body: updateCampaignSchema,
        response: { 200: campaignResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateCampaignCommand(
        contextOf(request),
        request.params.campaignId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return campaignResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    '/api/v1/campaign-codes/:campaignId',
    {
      preValidation: [...guarded, requireIfMatch()],
      schema: {
        operationId: 'archiveCampaignCode',
        tags,
        summary: 'Kampanya kodunu arşivle',
        description: `Arşivli kampanya listede görünmez, kodu yeni adaya bağlanmaz ve yeniden kullanılmaz; adayları kayıt hunisi kırılımında kalır. Olmayan ya da başka kurumun kampanyası 404, sürüm tutmazsa 409 \`version_conflict\`. \`If-Match\` zorunlu. ${ROLES}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: campaignParams,
        response: { 200: campaignArchiveResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await archiveCampaignCommand(
        contextOf(request),
        request.params.campaignId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return campaignArchiveResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    '/api/v1/prospects/funnel/campaigns',
    {
      preValidation: guarded,
      schema: {
        operationId: 'getProspectCampaignFunnel',
        tags,
        summary: 'Kayıt hunisinin kampanya kırılımı',
        description: `Aralıkta açılan adayların (\`dateFrom\`/\`dateTo\`, açılış günü Europe/Istanbul, iki uç dahil; verilmezse bütün adaylar) kampanya başına aday → görüşme → teklif → kesin kayıt sayıları (birikimli) ve dönüşüm oranı (DOM-KAY-041, IST-117). Satırlar: adayı olan her kampanya (arşivli dahil) ve aralıkla kesişen arşivlenmemiş kampanyalar; kodsuz adaylar \`uncoded\`, hepsi \`total\`. Maliyet girilmişse aday başı ve kayıt başı maliyet (kuruş); aralık kampanyanın bütün günlerini kapsamıyorsa \`costPartial: true\` ve birim maliyet \`null\` (K-290). Yanıt aday adı, iletişim bilgisi ve aday kimliği taşımaz; küçük grup bastırılmaz (K-291). \`Accept: text/csv\` ile aynı tablo CSV iner (\`;\` ayırıcı, UTF-8 BOM, ondalık virgül, formül kaçışı). Bitiş başlangıçtan önceyse ya da bilinmeyen parametre varsa 400. ${ROLES}`,
        querystring: campaignFunnelQuery,
        // CSV gövdesi `reply.serializer` ile gider; şemada yalnız JSON durur.
        response: {
          200: campaignFunnelResponse,
          ...authenticatedErrors,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      if (wantsCsv(request)) {
        const { csv, filename } = await campaignFunnelCsvFor(ctx, request.query)
        return (reply as FastifyReply)
          .type('text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .serializer((payload: unknown) => String(payload))
          .send(`\uFEFF${csv}`)
      }
      return { data: await campaignFunnelFor(ctx, request.query) }
    },
  )
}
