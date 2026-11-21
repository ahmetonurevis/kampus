import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  completeRefundInvoiceSchema,
  createRefundInvoiceSchema,
  discardRefundInvoiceSchema,
  REFUND_INVOICE_ROLES,
} from '@kampus/school-core/lib/finance-refund-invoices.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  completeRefundInvoiceCommand,
  createRefundInvoiceCommand,
  discardRefundInvoiceCommand,
  getRefundInvoiceFor,
  listRefundInvoicesFor,
  markRefundInvoiceReadyCommand,
  refundInvoicesCsvFor,
} from '../services/finance-refund-invoices.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  refundInvoiceListQuery,
  refundInvoiceListResponse,
  refundInvoiceParams,
  refundInvoiceResponse,
} from './finance-refund-invoices.schemas.ts'

/**
 * İade faturası ve iptal isteği uçları (docs/domain/finans.md DOM-FIN-096; ON-266; IST-110,
 * IST-112). Modül `finance`; rol yalnız yönetici (K-295, muhasebe rolü açılınca o da). Entegratör
 * bağlantısı yoktur: belge "gönderime hazır"da kalır, CSV iner, sonuç elle işlenir (K-294). Sıra:
 * 401 → 403 modül → 403 rol → `If-Match` → 400 → işlem.
 */

const ROLE = 'Rol: `yonetici` (K-295). Modül `finance`; kapalıysa 403 `module_disabled`.'
const wantsCsv = (request: FastifyRequest) => (request.headers.accept ?? '').includes('text/csv')
const CSV_PER_MINUTE = 10
const READS_PER_MINUTE = 300

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

export function registerFinanceRefundInvoiceRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guard = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(REFUND_INVOICE_ROLES),
  ]
  const freshForCsv: preValidationAsyncHookHandler = async function (request, reply) {
    if (wantsCsv(request)) await app.requireFreshSession.call(app, request, reply)
  }
  const tags = ['finance-refund-invoices']
  const url = '/api/v1/finance/refund-invoices'

  typed.get(
    url,
    {
      config: {
        rateLimit: {
          max: (request: FastifyRequest) => (wantsCsv(request) ? CSV_PER_MINUTE : READS_PER_MINUTE),
          timeWindow: '1 minute',
          hook: 'preHandler' as const,
          keyGenerator: (request: FastifyRequest) =>
            wantsCsv(request)
              ? `refund-invoices-csv:${request.auth?.userId ?? request.ip}`
              : request.ip,
        },
      },
      preValidation: [...guard, freshForCsv],
      schema: {
        operationId: 'listRefundInvoices',
        tags,
        summary: 'İade faturaları ve iptal istekleri',
        description: `Vazgeçilmemiş belgeler, en yeni önce (DOM-FIN-096). \`status\`, \`kind\` ve \`withdrawalId\` ile süzülür; sayfalıdır, bilinmeyen parametre 400. \`Accept: text/csv\` ile entegratör portalına elle giriş için dosya iner (sayfa yok sayılır, en çok 5000 belge; aşarsa 422 \`refund_invoice_export_too_large\`): \`;\` ayırıcı, UTF-8 BOM, ondalık virgül, formül kaçışı; alıcının kimliği ve IBAN'ı yazılmaz (K-295); taze oturum ister (eskiyse 403 \`reauthentication_required\`), kullanıcı başına 10/dk, denetim \`finance.refund_invoice_export\`. ${ROLE}`,
        querystring: refundInvoiceListQuery,
        // CSV gövdesi `reply.serializer` ile gider; şemada yalnız JSON durur.
        response: { 200: refundInvoiceListResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      const { page, pageSize, status, kind, withdrawalId } = request.query
      if (wantsCsv(request)) {
        const { csv, filename } = await refundInvoicesCsvFor(ctx, { status, kind })
        return (reply as FastifyReply)
          .type('text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .serializer((payload: unknown) => String(payload))
          .send(`\uFEFF${csv}`)
      }
      const { items, total } = await listRefundInvoicesFor(ctx, {
        page,
        pageSize,
        status,
        kind,
        withdrawalId,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    url,
    {
      preValidation: [...guard, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createRefundInvoice',
        tags,
        summary: 'İade faturası ya da iptal isteği taslağı aç',
        description: `Ödenmiş ayrılış iadesi (DOM-FIN-041) için asıl faturaya bağlı taslak (DOM-FIN-096). Asıl faturanın GİB numarası (16 karakter; yıl fatura gününün yılı), tarihi, türü (\`e_archive\`, \`e_invoice\`), KDV dahil tutarı ve KDV oranı (on binde birlik: 0, 100, 1000, 2000) elle girilir. \`kind\` verilmezse önerilen tür yazılır: iade asıl faturanın tamamıysa ve bugün iptal penceresindeyse (e-Arşiv 7, e-Fatura 8 gün; doğrulanmalı) iptal isteği, değilse iade faturası (K-292). İade faturası her zaman seçilir; iptal isteği kısmi iadede 422 \`refund_invoice_cancel_partial\`, pencere dışında 422 \`refund_invoice_cancel_window_closed\`. Tutar iadeyi (422 \`refund_invoice_amount_exceeds_refund\`) ve asıl faturayı (422 \`refund_invoice_amount_exceeds_invoice\`) aşamaz; KDV asıl faturanın oranıyla ayrılır (K-293). İade ödenmemişse 422 \`refund_invoice_refund_not_paid\`, iade yoksa 422 \`refund_invoice_no_refund\`; asıl fatura bugünden sonra 422 \`refund_invoice_original_date_future\`, iade ödemesinden sonra 422 \`refund_invoice_original_after_refund\`. Aynı iadeye vazgeçilmemiş ikinci belge 409 \`refund_invoice_exists\`. Olmayan ya da başka kurumun ayrılışı 404; gövdedeki \`institutionId\` 400. \`Idempotency-Key\` zorunlu; aynı anahtar ilk yanıtı tekrarlar. 201 ve \`Location\`. ${ROLE}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: createRefundInvoiceSchema,
        response: { 201: refundInvoiceResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createRefundInvoiceCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = refundInvoiceResponse.parse(sendBody(reply, result))
      reply.header('location', `${url}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    `${url}/:refundInvoiceId`,
    {
      preValidation: guard,
      schema: {
        operationId: 'getRefundInvoice',
        tags,
        summary: 'İade belgesi ayrıntısı',
        description: `Olmayan, vazgeçilmiş ya da başka kurumun belgesi 404. ${ROLE}`,
        params: refundInvoiceParams,
        response: { 200: refundInvoiceResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getRefundInvoiceFor(contextOf(request), request.params.refundInvoiceId),
    }),
  )

  const command = (
    path: string,
    operationId: string,
    summary: string,
    description: string,
    body: typeof completeRefundInvoiceSchema | typeof discardRefundInvoiceSchema | null,
    run: (
      request: FastifyRequest<{ Params: { refundInvoiceId: string } }>,
      expectedVersion: number,
    ) => Promise<CommandResponse>,
  ) =>
    typed.post(
      `${url}/:refundInvoiceId/${path}`,
      {
        preValidation: [...guard, requireIfMatch(), captureInput()],
        schema: {
          operationId,
          tags,
          summary,
          description: `${description} \`If-Match\` belgenin sürümüdür; tutmazsa 409 \`version_conflict\`. \`Idempotency-Key\` isteğe bağlı. Olmayan, vazgeçilmiş ya da başka kurumun belgesi 404. ${ROLE}`,
          headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
          params: refundInvoiceParams,
          ...(body === null ? {} : { body }),
          response: { 200: refundInvoiceResponse, ...commandErrors },
        },
      },
      async (request, reply) => {
        const { expectedVersion } = options(request, 'optional')
        if (expectedVersion === null) throw new Error('If-Match guard did not run')
        return refundInvoiceResponse.parse(sendBody(reply, await run(request, expectedVersion)))
      },
    )

  command(
    'ready',
    'markRefundInvoiceReady',
    'Belgeyi gönderime hazır işaretle',
    'Taslak gönderime hazır olur (K-294); taslak değilse 422 `refund_invoice_not_draft`. İptal isteğinde pencere yeniden denetlenir: süre geçtiyse 422 `refund_invoice_cancel_window_closed` (belgeden vazgeçilip iade faturası açılır). Entegratör bağlantısı olmadığından belge hazırda kalır; CSV ile dışa aktarılır.',
    null,
    (request, version) =>
      markRefundInvoiceReadyCommand(
        contextOf(request),
        request.params.refundInvoiceId,
        version,
        options(request, 'optional').idempotency,
      ),
  )

  command(
    'complete',
    'completeRefundInvoice',
    'Entegratördeki sonucu işle',
    'Gönderime hazır belgenin sonucu (K-294): iade faturası `documentNumber` (GİB numarası; yıl işlem gününün yılı, asıl faturanınkinden farklı) ile `sent`, iptal isteği numarasız `cancelled` olur. Hazır değilse 422 `refund_invoice_not_ready`; gün bugünden sonra 422 `refund_invoice_completed_date_future`, asıl faturadan önce 422 `refund_invoice_completed_before_original`; iptal pencere dışında 422 `refund_invoice_cancel_window_closed`; iade faturasında numara yoksa 422 `refund_invoice_number_required`, iptalde numara 422 `refund_invoice_number_not_applicable`; numara kurumda kayıtlıysa 409 `refund_invoice_number_exists`. Sonucu işlenen belge değişmez.',
    completeRefundInvoiceSchema,
    (request, version) =>
      completeRefundInvoiceCommand(
        contextOf(request),
        request.params.refundInvoiceId,
        request.commandInput,
        version,
        options(request, 'optional').idempotency,
      ),
  )

  command(
    'discard',
    'discardRefundInvoice',
    'Belgeden vazgeç',
    'Taslak ya da hazır belge gerekçeyle (5–500 karakter) arşivlenir; aynı iade için yeni belge açılabilir (K-294). Sonucu işlenmiş belge 422 `refund_invoice_completed`. Yanıt arşivlenen belgenin son hâlidir.',
    discardRefundInvoiceSchema,
    (request, version) =>
      discardRefundInvoiceCommand(
        contextOf(request),
        request.params.refundInvoiceId,
        request.commandInput,
        version,
        options(request, 'optional').idempotency,
      ),
  )
}
