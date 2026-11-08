import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { WRITE_ACTION_ROLES } from '@kampus/school-core/lib/authorize.ts'
import {
  createScholarshipFundSchema,
  SCHOLARSHIP_FUND_READ_ROLES,
  scholarshipFundAllocationSchema,
  scholarshipFundCancelSchema,
  scholarshipFundDonationSchema,
} from '@kampus/school-core/lib/finance-scholarship-funds.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  allocateFromScholarshipFundCommand,
  cancelScholarshipFundAllocationCommand,
  cancelScholarshipFundDonationCommand,
  closeScholarshipFundCommand,
  createScholarshipFundCommand,
  donateToScholarshipFundCommand,
  listScholarshipFundsFor,
  scholarshipFundCsvFor,
  scholarshipFundReportFor,
} from '../services/finance-scholarship-funds.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  allocationParams,
  donationParams,
  fundListQuery,
  fundListResponse,
  fundParams,
  fundReportResponse,
} from './finance-scholarship-funds.schemas.ts'

/**
 * Burs fonu uçları (docs/domain/finans.md DOM-FIN-068; ON-259, K26). Modül `finance`. Okuma
 * yönetici ve ön büro, yazma burs onayı gibi yalnız yönetici (`scholarship.manage`, K-98). Bağış,
 * atama ve iptalleri para hareketidir: `Idempotency-Key` zorunlu. Raporda öğrenci adı yalnız
 * yöneticiye döner. Bağış makbuzu ya da vergi belgesi üretilmez (M-21).
 */

const STAFF = 'Roller: `yonetici`, `onburo`.'
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

export function registerFinanceScholarshipFundRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const read: preValidationAsyncHookHandler[] = [
    app.authenticate,
    finance,
    app.requireRole(SCHOLARSHIP_FUND_READ_ROLES),
  ]
  const write = (ifMatch: 'reject' | 'required', body = true): preValidationAsyncHookHandler[] => [
    app.authenticate,
    finance,
    app.requireRole(WRITE_ACTION_ROLES['scholarship.manage']),
    ifMatch === 'reject' ? rejectIfMatch() : requireIfMatch(),
    ...(body ? [captureInput()] : []),
  ]
  // CSV öğrenci adı taşıyabilir: taze oturum ve kullanıcı başına 10/dk yalnız CSV isteğinde.
  const freshForCsv: preValidationAsyncHookHandler = async function (request, reply) {
    if (wantsCsv(request)) await app.requireFreshSession.call(app, request, reply)
  }
  const tags = ['finance-scholarship-funds']
  const FUNDS = '/api/v1/finance/scholarship-funds'

  typed.get(
    FUNDS,
    {
      preValidation: read,
      schema: {
        operationId: 'listScholarshipFunds',
        tags,
        summary: 'Burs fonlarını listele',
        description: `Açık fonlar önce, ada göre; bağış, atama ve bakiye toplamlarıyla (DOM-FIN-068). \`q\` fon ya da bağışçı adında arar, \`status\` açık ya da kapalı fonları süzer. ${STAFF}`,
        querystring: fundListQuery,
        response: { 200: fundListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, status } = request.query
      const { items, total } = await listScholarshipFundsFor(contextOf(request), {
        page,
        pageSize,
        q,
        status,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    FUNDS,
    {
      preValidation: write('reject'),
      schema: {
        operationId: 'createScholarshipFund',
        tags,
        summary: 'Burs fonu aç',
        description: `Ad, isteğe bağlı açıklama ve bağışçı (kişi ya da kurum adı; anonimde ad yazılmaz, K-95). Aynı adla ikinci açık fon 409 \`scholarship_fund_exists\`. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: createScholarshipFundSchema,
        response: { 201: fundReportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createScholarshipFundCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = fundReportResponse.parse(sendBody(reply, result))
      reply.header('location', `${FUNDS}/${body.data.fund.id}/report`)
      return body
    },
  )

  typed.get(
    `${FUNDS}/:fundId/report`,
    {
      config: {
        rateLimit: {
          max: (request: FastifyRequest) => (wantsCsv(request) ? CSV_PER_MINUTE : READS_PER_MINUTE),
          timeWindow: '1 minute',
          hook: 'preHandler' as const,
          keyGenerator: (request: FastifyRequest) =>
            wantsCsv(request)
              ? `scholarship-fund-csv:${request.auth?.userId ?? request.ip}`
              : request.ip,
        },
      },
      preValidation: [...read, freshForCsv],
      schema: {
        operationId: 'getScholarshipFundReport',
        tags,
        summary: 'Burs fonu raporu',
        description: `Fon, toplamlar ve hareket dökümü (bağış ve atamalar gün sırasıyla, iptal edilenler dahil, yürüyen bakiyeyle; DOM-FIN-068). Öğrenci adı yalnız \`yonetici\` rolünde dolu (K-98). \`Accept: text/csv\` ile dosya iner: \`;\` ayırıcı, UTF-8 BOM, ondalık virgül, formül kaçışı; taze oturum ister (eskiyse 403 \`reauthentication_required\`), kullanıcı başına 10/dk, denetim \`finance.scholarship_fund_export\`. Olmayan ya da başka kurumun fonu 404. ${STAFF}`,
        params: fundParams,
        // CSV gövdesi `reply.serializer` ile gider; şemada yalnız JSON durur, istemci tipi tek kalsın.
        response: { 200: fundReportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      if (wantsCsv(request)) {
        const csv = await scholarshipFundCsvFor(ctx, request.params.fundId)
        return (reply as FastifyReply)
          .type('text/csv; charset=utf-8')
          .header('content-disposition', 'attachment; filename="burs-fonu.csv"')
          .serializer((payload: unknown) => String(payload))
          .send(`\uFEFF${csv}`)
      }
      return { data: await scholarshipFundReportFor(ctx, request.params.fundId) }
    },
  )

  typed.post(
    `${FUNDS}/:fundId/donations`,
    {
      preValidation: write('reject'),
      schema: {
        operationId: 'donateToScholarshipFund',
        tags,
        summary: 'Fona bağış gir',
        description: `Tutar (kuruş), gün ve kaynak (\`bank_transfer\`, \`cash\`, \`other\`), isteğe bağlı not. Gelecek gün 422 \`scholarship_fund_date_future\`, kapalı fon 422 \`scholarship_fund_closed\`. Makbuz ya da vergi belgesi üretilmez (M-21). \`Idempotency-Key\` zorunlu; aynı anahtar ilk yanıtı tekrarlar. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: fundParams,
        body: scholarshipFundDonationSchema,
        response: { 201: fundReportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await donateToScholarshipFundCommand(
        contextOf(request),
        request.params.fundId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return fundReportResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${FUNDS}/:fundId/allocations`,
    {
      preValidation: write('reject'),
      schema: {
        operationId: 'allocateFromScholarshipFund',
        tags,
        summary: 'Bursu fondan karşıla',
        description: `Kesin kayıtta ya da yenilemede yapılmış burs atamasını (DOM-FIN-025) fondan karşılanmış olarak bağlar; öğrenci ve eğitim yılı atamadan gelir, sözleşme değişmez (K-96). Tutar fon bakiyesini aşarsa 422 \`scholarship_fund_insufficient\`, bursun fonlardan karşılanmamış kısmını aşarsa 422 \`scholarship_fund_exceeds_award\`; aynı fondan aynı bursa ikinci atama 409 \`scholarship_fund_allocation_exists\`; olmayan ya da başka kurumun bursu 404. Kurum kilidi altında: eşzamanlı atamalar bakiyeyi aşamaz. \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: fundParams,
        body: scholarshipFundAllocationSchema,
        response: { 201: fundReportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await allocateFromScholarshipFundCommand(
        contextOf(request),
        request.params.fundId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return fundReportResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${FUNDS}/:fundId/donations/:donationId/cancel`,
    {
      preValidation: write('required'),
      schema: {
        operationId: 'cancelScholarshipFundDonation',
        tags,
        summary: 'Bağışı iptal et',
        description: `Gerekçeyle (5–500 karakter); silinmez. Bakiyeyi eksiye düşürecekse 422 \`scholarship_fund_donation_in_use\` (önce atama iptal edilir, K-97); iptal edilmiş bağış 409 \`scholarship_fund_donation_cancelled\`, sürüm tutmazsa 409 \`version_conflict\`. \`If-Match\` ve \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: donationParams,
        body: scholarshipFundCancelSchema,
        response: { 200: fundReportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'required')
      const result = await cancelScholarshipFundDonationCommand(
        contextOf(request),
        request.params.fundId,
        request.params.donationId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return fundReportResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${FUNDS}/:fundId/allocations/:allocationId/cancel`,
    {
      preValidation: write('required'),
      schema: {
        operationId: 'cancelScholarshipFundAllocation',
        tags,
        summary: 'Fondan atamayı iptal et',
        description: `Gerekçeyle (5–500 karakter); tutar fon bakiyesine geri döner, burs ataması kalır (K-97). Kapalı fonda 422 \`scholarship_fund_closed\`. İptal edilmiş atama 409 \`scholarship_fund_allocation_cancelled\`, sürüm tutmazsa 409 \`version_conflict\`. \`If-Match\` ve \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: allocationParams,
        body: scholarshipFundCancelSchema,
        response: { 200: fundReportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'required')
      const result = await cancelScholarshipFundAllocationCommand(
        contextOf(request),
        request.params.fundId,
        request.params.allocationId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return fundReportResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${FUNDS}/:fundId/close`,
    {
      preValidation: write('required', false),
      schema: {
        operationId: 'closeScholarshipFund',
        tags,
        summary: 'Burs fonunu kapat',
        description: `Yalnız sıfır bakiyede: aksi 422 \`scholarship_fund_balance_not_zero\`; kapalı fon 409 \`scholarship_fund_already_closed\`, sürüm tutmazsa 409 \`version_conflict\`. Kapalı fona bağış ve atama yapılmaz; rapor kalır. \`If-Match\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: fundParams,
        response: { 200: fundReportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await closeScholarshipFundCommand(
        contextOf(request),
        request.params.fundId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return fundReportResponse.parse(sendBody(reply, result))
    },
  )
}
