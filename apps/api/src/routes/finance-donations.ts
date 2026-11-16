import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  createDonationCampaignSchema,
  createDonorSchema,
  DONATION_ROLES,
  donationCancelSchema,
  donationSchema,
  donationSettingsSchema,
  updateDonationCampaignSchema,
  updateDonorSchema,
} from '@kampus/school-core/lib/finance-donations.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  campaignDonationsCsvFor,
  cancelDonationCommand,
  changeDonationCampaignCommand,
  createDonationCampaignCommand,
  createDonorCommand,
  donationCampaignFor,
  donationReceiptFor,
  donationSettingsFor,
  listCampaignDonationsFor,
  listDonationCampaignsFor,
  listDonorsFor,
  recordDonationCommand,
  setDonationSettingsCommand,
  updateDonorCommand,
} from '../services/finance-donations.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  campaignListQuery,
  campaignListResponse,
  campaignParams,
  campaignResponse,
  donationListQuery,
  donationListResponse,
  donationParams,
  donationResponse,
  donorListQuery,
  donorListResponse,
  donorParams,
  donorResponse,
  receiptResponse,
  settingsResponse,
} from './finance-donations.schemas.ts'

/**
 * Bağış kampanyası, bağışçı ve makbuz uçları (docs/domain/finans.md DOM-FIN-097; ON-258). Modül
 * `finance`. Bağışçı verisi yalnız yöneticiye açıktır (K-298, K-299). Bağış kaydı ve iptali para
 * kaydıdır: `Idempotency-Key` zorunlu. Çevrim içi ödeme yoktur; bağış elle kaydedilir.
 */

const MANAGER = 'Rol: `yonetici`.'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

const wantsCsv = (request: FastifyRequest) => (request.headers.accept ?? '').includes('text/csv')
const CSV_PER_MINUTE = 10
const READS_PER_MINUTE = 300

export function registerFinanceDonationRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const read: preValidationAsyncHookHandler[] = [
    app.authenticate,
    finance,
    app.requireRole(DONATION_ROLES),
  ]
  const write = (ifMatch: 'reject' | 'required', body = true): preValidationAsyncHookHandler[] => [
    ...read,
    ifMatch === 'reject' ? rejectIfMatch() : requireIfMatch(),
    ...(body ? [captureInput()] : []),
  ]
  // Döküm bağışçı adı taşır: taze oturum ve kullanıcı başına 10/dk yalnız CSV isteğinde.
  const freshForCsv: preValidationAsyncHookHandler = async function (request, reply) {
    if (wantsCsv(request)) await app.requireFreshSession.call(app, request, reply)
  }
  const tags = ['finance-donations']
  const CAMPAIGNS = '/api/v1/finance/donation-campaigns'
  const DONATIONS = '/api/v1/finance/donations'
  const DONORS = '/api/v1/finance/donors'
  const SETTINGS = '/api/v1/finance/donation-settings'

  typed.get(
    CAMPAIGNS,
    {
      preValidation: read,
      schema: {
        operationId: 'listDonationCampaigns',
        tags,
        summary: 'Bağış kampanyalarını listele',
        description: `Açık kampanyalar önce, sonra taslak ve kapananlar; toplanan nakdi bağış, ayni bağış değeri ve hedefe göre ilerlemeyle (DOM-FIN-097). \`q\` adda arar, \`status\` süzer. ${MANAGER}`,
        querystring: campaignListQuery,
        response: { 200: campaignListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, status } = request.query
      const { items, total } = await listDonationCampaignsFor(contextOf(request), {
        page,
        pageSize,
        q,
        status,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    CAMPAIGNS,
    {
      preValidation: write('reject'),
      schema: {
        operationId: 'createDonationCampaign',
        tags,
        summary: 'Bağış kampanyası aç (taslak)',
        description: `Ad, amaç, hedef (kuruş), başlangıç ve bitiş günü, isteğe bağlı banka hesabı. Kampanya taslak açılır; bağış açıldıktan sonra yazılır (K-296). Aynı ad 409 \`donation_campaign_exists\`; olmayan ya da başka kurumun hesabı 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: createDonationCampaignSchema,
        response: { 201: campaignResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createDonationCampaignCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = campaignResponse.parse(sendBody(reply, result))
      reply.header('location', `${CAMPAIGNS}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    `${CAMPAIGNS}/:campaignId`,
    {
      preValidation: read,
      schema: {
        operationId: 'getDonationCampaign',
        tags,
        summary: 'Bağış kampanyası',
        description: `Kampanya, toplamlar ve ilerleme. Olmayan ya da başka kurumun kampanyası 404. ${MANAGER}`,
        params: campaignParams,
        response: { 200: campaignResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await donationCampaignFor(contextOf(request), request.params.campaignId),
    }),
  )

  typed.patch(
    `${CAMPAIGNS}/:campaignId`,
    {
      preValidation: write('required'),
      schema: {
        operationId: 'updateDonationCampaign',
        tags,
        summary: 'Bağış kampanyasını düzelt',
        description: `Taslakta ve açıkken; kapanmış kampanya 422 \`donation_campaign_closed\`. Günler geçerli bağışların günlerini kapsamalıdır (422 \`donation_campaign_dates_conflict\`). \`If-Match\` zorunlu; sürüm tutmazsa 409 \`version_conflict\`. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: campaignParams,
        body: updateDonationCampaignSchema,
        response: { 200: campaignResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await changeDonationCampaignCommand(
        contextOf(request),
        request.params.campaignId,
        'update',
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return campaignResponse.parse(sendBody(reply, result))
    },
  )

  for (const [verb, operationId, summary, description] of [
    [
      'open',
      'openDonationCampaign',
      'Bağış kampanyasını aç',
      'Taslak açılır ve bağış almaya başlar; taslak olmayan 409 `donation_campaign_not_draft`, bitiş günü geçmişse 422 `donation_campaign_ended`.',
    ],
    [
      'close',
      'closeDonationCampaign',
      'Bağış kampanyasını kapat',
      'Açık kampanya kapanır; kapanana bağış yazılmaz, geri açılmaz. Açık olmayan 409 `donation_campaign_not_open`. Bağış iptali kapandıktan sonra da yapılır.',
    ],
  ] as const)
    typed.post(
      `${CAMPAIGNS}/:campaignId/${verb}`,
      {
        preValidation: write('required', false),
        schema: {
          operationId,
          tags,
          summary,
          description: `${description} \`If-Match\` zorunlu (K-296). ${MANAGER}`,
          headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
          params: campaignParams,
          response: { 200: campaignResponse, ...commandErrors },
        },
      },
      async (request, reply) => {
        const opts = options(request, 'optional')
        const result = await changeDonationCampaignCommand(
          contextOf(request),
          request.params.campaignId,
          verb,
          {},
          expected(opts.expectedVersion),
          opts.idempotency,
        )
        return campaignResponse.parse(sendBody(reply, result))
      },
    )

  typed.get(
    `${CAMPAIGNS}/:campaignId/donations`,
    {
      config: {
        rateLimit: {
          max: (request: FastifyRequest) => (wantsCsv(request) ? CSV_PER_MINUTE : READS_PER_MINUTE),
          timeWindow: '1 minute',
          hook: 'preHandler' as const,
          keyGenerator: (request: FastifyRequest) =>
            wantsCsv(request) ? `donation-csv:${request.auth?.userId ?? request.ip}` : request.ip,
        },
      },
      preValidation: [...read, freshForCsv],
      schema: {
        operationId: 'listCampaignDonations',
        tags,
        summary: 'Kampanyanın bağışları',
        description: `Makbuz numarasına göre en yeni önce, iptal edilenler dahil; kimlik numarası maskeli (K-298). \`Accept: text/csv\` ile bütün döküm iner (sayfalama yok): \`;\` ayırıcı, UTF-8 BOM, ondalık virgül, formül kaçışı, son satır geçerli nakdi toplam; taze oturum ister (eskiyse 403 \`reauthentication_required\`), kullanıcı başına 10/dk, denetim \`finance.donation_export\`. ${MANAGER}`,
        params: campaignParams,
        querystring: donationListQuery,
        // CSV gövdesi `reply.serializer` ile gider; şemada yalnız JSON durur, istemci tipi tek kalsın.
        response: { 200: donationListResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      if (wantsCsv(request)) {
        const csv = await campaignDonationsCsvFor(ctx, request.params.campaignId)
        return (reply as FastifyReply)
          .type('text/csv; charset=utf-8')
          .header('content-disposition', 'attachment; filename="bagislar.csv"')
          .serializer((payload: unknown) => String(payload))
          .send(`\uFEFF${csv}`)
      }
      const { page, pageSize } = request.query
      const { items, total } = await listCampaignDonationsFor(ctx, request.params.campaignId, {
        page,
        pageSize,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    `${CAMPAIGNS}/:campaignId/donations`,
    {
      preValidation: write('reject'),
      schema: {
        operationId: 'recordDonation',
        tags,
        summary: 'Bağış kaydet ve makbuz kes',
        description: `Elle girilen bağış: \`donorId\` (anonimde \`null\`), tür (\`cash\` nakdi: tutar ve yöntem \`cash\`/\`bank_transfer\`/\`card_slip\`; \`in_kind\` ayni: açıklama, isteğe bağlı beyan edilen değer), gün. Havalede banka hesabı verilmezse kampanyanınki; ikisi de yoksa 422 \`donation_bank_account_required\`. Taslak ya da kapanmış kampanya 422 \`donation_campaign_not_open\`, gelecek gün 422 \`donation_date_future\`, kampanya günleri dışı 422 \`donation_date_outside_campaign\`; olmayan ya da başka kurumun bağışçısı, hesabı 404. Makbuz numarası yılın sıradaki numarasıdır (K-297); vergi ibaresi ayar açıksa ve bağış anonim değilse kopyalanır (K-299). \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: campaignParams,
        body: donationSchema,
        response: { 201: donationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await recordDonationCommand(
        contextOf(request),
        request.params.campaignId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return donationResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${DONATIONS}/:donationId/cancel`,
    {
      preValidation: write('required'),
      schema: {
        operationId: 'cancelDonation',
        tags,
        summary: 'Bağışı ve makbuzunu iptal et',
        description: `Gerekçeyle (5–500 karakter); silinmez, makbuz numarası yeniden kullanılmaz, makbuz "İptal edildi" ibaresiyle kalır (K-297). İptal edilmiş bağış 409 \`donation_cancelled\`, sürüm tutmazsa 409 \`version_conflict\`. \`If-Match\` ve \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: donationParams,
        body: donationCancelSchema,
        response: { 200: donationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'required')
      const result = await cancelDonationCommand(
        contextOf(request),
        request.params.donationId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return donationResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${DONATIONS}/:donationId/receipt`,
    {
      preValidation: read,
      schema: {
        operationId: 'getDonationReceipt',
        tags,
        summary: 'Bağış makbuzu verisi',
        description: `Makbuz PDF'inin verisi: bağışçının tam kimlik numarası, kampanya ve kopyalanmış vergi ibaresi. Okuma denetime yazılır (\`finance.donation_receipt\`, K-298). Olmayan ya da başka kurumun bağışı 404. ${MANAGER}`,
        params: donationParams,
        response: { 200: receiptResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await donationReceiptFor(contextOf(request), request.params.donationId),
    }),
  )

  typed.get(
    DONORS,
    {
      preValidation: read,
      schema: {
        operationId: 'listDonors',
        tags,
        summary: 'Bağışçıları listele',
        description: `Ada göre; kimlik numarası maskeli (K-298). ${MANAGER}`,
        querystring: donorListQuery,
        response: { 200: donorListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q } = request.query
      const { items, total } = await listDonorsFor(contextOf(request), { page, pageSize, q })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    DONORS,
    {
      preValidation: write('reject'),
      schema: {
        operationId: 'createDonor',
        tags,
        summary: 'Bağışçı kaydet',
        description: `Kişi ya da kurum; ad zorunlu, kimlik numarası (kişide TCKN, kurumda VKN), telefon, e-posta, adres ve veli/mezun bağı isteğe bağlı (K-298). Kimlik numarası kurumda tekil (409 \`donor_identity_exists\`); olmayan ya da başka kurumun öğrencisi 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: createDonorSchema,
        response: { 201: donorResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createDonorCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return donorResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    `${DONORS}/:donorId`,
    {
      preValidation: write('required'),
      schema: {
        operationId: 'updateDonor',
        tags,
        summary: 'Bağışçıyı düzelt',
        description: `Tür değişmez; \`null\` isteğe bağlı alanı temizler. Kesilmiş makbuzlar değişmez (bağışçı bilgisi makbuza kopyalanmıştır). Kimlik numarası türe uymazsa 422 \`donor_identity_invalid\`. \`If-Match\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: donorParams,
        body: updateDonorSchema,
        response: { 200: donorResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateDonorCommand(
        contextOf(request),
        request.params.donorId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return donorResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    SETTINGS,
    {
      preValidation: read,
      schema: {
        operationId: 'getDonationSettings',
        tags,
        summary: 'Bağış ayarı',
        description: `Makbuza vergi indirimi ibaresi yazılıp yazılmayacağı ve metni; varsayılan kapalı (K-299). ${MANAGER}`,
        response: { 200: settingsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await donationSettingsFor(contextOf(request)) }),
  )

  typed.patch(
    SETTINGS,
    {
      preValidation: write('required'),
      schema: {
        operationId: 'setDonationSettings',
        tags,
        summary: 'Vergi indirimi ibaresini ayarla',
        description: `İbare açıkken metin (20–600 karakter) zorunlu. Yalnız bundan sonra kesilen makbuzları etkiler. GVK md. 89 / KVK md. 10 kapsamı kurumun mali müşavirince doğrulanmalıdır (H-37). \`If-Match\` (ayar hiç değişmediyse 1) zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        body: donationSettingsSchema,
        response: { 200: settingsResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await setDonationSettingsCommand(
        contextOf(request),
        donationSettingsSchema.parse(request.commandInput),
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return settingsResponse.parse(sendBody(reply, result))
    },
  )
}
