import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import {
  cancelSupplierInvoiceSchema,
  cancelSupplierPaymentSchema,
  paymentInstructionSchema,
  SUPPLIER_LEDGER_ROLES,
  supplierInvoicePlanSchema,
  supplierInvoiceSchema,
  supplierPaymentSchema,
} from '@kampus/school-core/lib/finance-supplier-ledger.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  cancelSupplierPaymentCommand,
  createSupplierInvoiceCommand,
  createSupplierPaymentCommand,
  getSupplierInvoiceFor,
  listSupplierInvoicesFor,
  listSupplierPaymentsFor,
  paymentInstructionFileFor,
  supplierLedgerFor,
  supplierStatementFor,
  transitionSupplierInvoiceCommand,
} from '../services/finance-supplier-ledger.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  supplierInvoiceListQuery,
  supplierInvoiceListResponse,
  supplierInvoiceParams,
  supplierInvoiceResponse,
  supplierLedgerParams,
  supplierLedgerQuery,
  supplierLedgerResponse,
  supplierPaymentListQuery,
  supplierPaymentListResponse,
  supplierPaymentParams,
  supplierPaymentResponse,
  supplierStatementQuery,
  supplierStatementResponse,
} from './finance-supplier-ledger.schemas.ts'

/**
 * Tedarikçi carisi ve ödeme planı uçları (docs/domain/finans.md DOM-FIN-076; ON-143). Modül
 * `finance`, rol yalnız `yonetici` (K-160; ön büro görmez). Kampüs muhasebe defteri tutmaz (IST-142):
 * cari yönetim takibidir. Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 → işlem.
 */

const WHO = 'Rol: `yonetici` (K-160). Modül `finance`.'
const IF_MATCH = '`If-Match` zorunlu; sürüm tutmazsa 409 `version_conflict`.'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

/** Talimat dosyası sayacı doğrulanmış kullanıcıyadır. */
const instructionRateKey = (request: FastifyRequest) => request.auth?.userId ?? request.ip

export function registerFinanceSupplierLedgerRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    finance,
    app.requireRole(SUPPLIER_LEDGER_ROLES),
  ]
  const tags = ['finance-procurement']

  typed.get(
    '/api/v1/finance/supplier-invoices',
    {
      preValidation: guarded,
      schema: {
        operationId: 'listSupplierInvoices',
        tags,
        summary: 'Tedarikçi faturalarını listele',
        description: `Yeni fatura tarihi önce; tedarikçi, sipariş ve durumla süzülür, \`q\` fatura numarasında ya da tedarikçi adında arar. Ödenen, kalan ve vadesi geçmiş tutar taksit ve etkin ödemelerden hesaplanır; gün Europe/Istanbul. ${WHO}`,
        querystring: supplierInvoiceListQuery,
        response: { 200: supplierInvoiceListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listSupplierInvoicesFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    '/api/v1/finance/supplier-invoices',
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createSupplierInvoice',
        tags,
        summary: 'Tedarikçi faturası ve ödeme planı kaydet',
        description: `Fatura numarası boşluksuz büyük harfle saklanır; aynı tedarikçide iptal edilmemiş aynı numara 409 \`supplier_invoice_number_exists\` (K-161). Tutar KDV dahil ya da hariç girilir, KDV ayrıca yazılır. Vade tek gün (\`dueDate\`) ya da toplamı fatura tutarına eşit plan (\`installments\`; 422 \`supplier_invoice_plan_total_mismatch\`). Fatura tarihi bugünden sonra 422 \`supplier_invoice_date_in_future\`. Siparişe bağlıysa aynı tedarikçinin gönderilmiş siparişi olmalı (422 \`supplier_invoice_order_not_found\`, \`supplier_invoice_order_supplier_mismatch\`, \`supplier_invoice_order_not_open\`); etkin faturaların toplamı sipariş tutarını aşarsa 409 \`supplier_invoice_exceeds_order_warning\`, \`confirmOverOrder: true\` ile geçilir (K-162). \`Idempotency-Key\` zorunlu. ${WHO}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: supplierInvoiceSchema,
        response: { 201: supplierInvoiceResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createSupplierInvoiceCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = supplierInvoiceResponse.parse(sendBody(reply, result))
      reply.header('location', `/api/v1/finance/supplier-invoices/${body.data.id}`)
      return body
    },
  )

  typed.get(
    '/api/v1/finance/supplier-invoices/:invoiceId',
    {
      preValidation: guarded,
      schema: {
        operationId: 'getSupplierInvoice',
        tags,
        summary: 'Tedarikçi faturası ayrıntısı',
        description: `Tutarlar, ödeme planı (taksit başına ödenen, kalan ve vadesi geçti işareti), ödemeler (iptaller dahil), bağlı sipariş ve yapılabilecek işlemler. Olmayan ya da başka kurumun faturası 404. ${WHO}`,
        params: supplierInvoiceParams,
        response: { 200: supplierInvoiceResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getSupplierInvoiceFor(contextOf(request), request.params.invoiceId),
    }),
  )

  const INVOICE_TRANSITIONS = {
    plan: {
      operationId: 'replanSupplierInvoice',
      summary: 'Faturanın ödeme planını yeniden yaz',
      description:
        'Taksitleri değiştirir; toplam fatura tutarına eşit, vadeler fatura tarihinden önce değil. Ödemesi olan fatura 422 `supplier_invoice_plan_locked`, iptal edilmiş fatura 422 `supplier_invoice_cancelled`.',
      body: supplierInvoicePlanSchema,
    },
    cancel: {
      operationId: 'cancelSupplierInvoice',
      summary: 'Tedarikçi faturasını iptal et',
      description:
        'Gerekçeyle iptal eder; silme yoktur, iptal ekstrede iptal gününe yazılır. Ödemesi olan fatura 422 `supplier_invoice_has_payments` (önce ödemeler iptal edilir).',
      body: cancelSupplierInvoiceSchema,
    },
  } as const

  for (const [verb, spec] of Object.entries(INVOICE_TRANSITIONS) as [
    keyof typeof INVOICE_TRANSITIONS,
    (typeof INVOICE_TRANSITIONS)[keyof typeof INVOICE_TRANSITIONS],
  ][]) {
    typed.post(
      `/api/v1/finance/supplier-invoices/:invoiceId/${verb}`,
      {
        preValidation: [...guarded, requireIfMatch(), captureInput()],
        schema: {
          operationId: spec.operationId,
          tags,
          summary: spec.summary,
          description: `${spec.description} ${IF_MATCH} ${WHO}`,
          headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
          params: supplierInvoiceParams,
          body: spec.body,
          response: { 200: supplierInvoiceResponse, ...commandErrors },
        },
      },
      async (request, reply) => {
        const opts = options(request, 'optional')
        const result = await transitionSupplierInvoiceCommand(
          contextOf(request),
          request.params.invoiceId,
          verb,
          request.commandInput,
          expected(opts.expectedVersion),
          opts.idempotency,
        )
        return supplierInvoiceResponse.parse(sendBody(reply, result))
      },
    )
  }

  typed.get(
    '/api/v1/finance/supplier-payments',
    {
      preValidation: guarded,
      schema: {
        operationId: 'listSupplierPayments',
        tags,
        summary: 'Tedarikçi ödemelerini listele',
        description: `Yeni ödeme günü önce; tedarikçi, fatura, yöntem, gün aralığı ve durumla süzülür. \`instruction=pending\` talimat dosyası alınmamış etkin havale/EFT ödemelerini verir. ${WHO}`,
        querystring: supplierPaymentListQuery,
        response: { 200: supplierPaymentListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listSupplierPaymentsFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    '/api/v1/finance/supplier-payments',
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createSupplierPayment',
        tags,
        summary: 'Taksite tedarikçi ödemesi kaydet',
        description: `Ödeme bir taksite yazılır, kısmi olabilir; taksitin kalanı kurum kilidi altında yeniden hesaplanır, aşan ödeme 422 \`supplier_payment_exceeds_installment\`. Nakit dışı yöntemde kurumun banka hesabı zorunlu (422 \`supplier_payment_bank_account_not_found\`), nakitte hesap seçilmez. Gün bugünden sonra 422 \`supplier_payment_date_in_future\`, fatura tarihinden önce 422 \`supplier_payment_before_invoice\`. Nakit ödeme ödeme gününün gün sonuna nakit yönteminde "tedarikçi ödemesi" olarak girer, kasa beklenenini düşürür; kapatılmış güne nakit ödeme 422 \`finance_day_closed\` (DOM-FIN-036, K-166). İptal edilmiş fatura 422 \`supplier_invoice_cancelled\`. \`Idempotency-Key\` zorunlu. ${WHO}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: supplierPaymentSchema,
        response: { 201: supplierPaymentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createSupplierPaymentCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return supplierPaymentResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    '/api/v1/finance/supplier-payments/:paymentId/cancel',
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'cancelSupplierPayment',
        tags,
        summary: 'Tedarikçi ödemesini iptal et',
        description: `Gerekçeyle iptal eder; silme yoktur, taksit yeniden açılır, iptal ekstrede iptal gününe yazılır. Nakit ödeme iptal edilince ödeme gününün gün sonundan çıkar; ödeme günü kapatılmışsa 422 \`finance_day_closed\`, yönetici önce o günü yeniden açar (K-166, K-190). Talimat dosyası alınmış ödemenin bankadaki talimatı ayrıca durdurulur. Zaten iptal 422 \`supplier_payment_cancelled\`. ${IF_MATCH} ${WHO}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: supplierPaymentParams,
        body: cancelSupplierPaymentSchema,
        response: { 200: supplierPaymentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await cancelSupplierPaymentCommand(
        contextOf(request),
        request.params.paymentId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return supplierPaymentResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    '/api/v1/finance/supplier-payments/instruction-file',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: instructionRateKey,
        },
      },
      preValidation: [...guarded, app.requireFreshSession, rejectIfMatch()],
      schema: {
        operationId: 'exportSupplierPaymentInstructions',
        tags,
        summary: 'Ödeme talimatı dosyası (genel CSV)',
        description: `Seçilen havale ve EFT ödemeleri için bankaya yüklenecek genel CSV: Alıcı unvanı, Alıcı IBAN (açık), Tutar, Para birimi, Açıklama, Ödeme günü, Gönderen IBAN; \`;\` ayırıcı, UTF-8 BOM, ondalık virgül, formül kaçışı. Belirli bir bankanın toplu ödeme biçimi değildir (K-164). Ödemeler aynı işlemde "talimatı alındı" işaretlenir ve denetim kaydına düşer; dosya saklanmaz. Daha önce alınmış ödeme 409 \`supplier_payment_instruction_exported_warning\`, \`confirmReexport: true\` ile yeniden alınır (K-165). İptal edilmiş ödeme 422 \`supplier_payment_cancelled\`, havale/EFT dışı yöntem 422 \`supplier_payment_instruction_method\`, IBAN'sız tedarikçi 422 \`supplier_payment_instruction_iban_missing\`, bulunmayan ödeme 422 \`supplier_payment_not_found\`. Taze oturum ister (403 \`reauthentication_required\`); kullanıcı başına 10/dk. ${WHO}`,
        body: paymentInstructionSchema,
        response: { 200: z.string().describe('CSV dosyası'), ...commandErrors },
      },
    },
    async (request, reply) => {
      const { csv, fileName } = await paymentInstructionFileFor(contextOf(request), request.body)
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${fileName}"`)
        .serializer((payload: unknown) => String(payload))
        .send(`\uFEFF${csv}`)
    },
  )

  typed.get(
    '/api/v1/finance/supplier-ledger',
    {
      preValidation: guarded,
      schema: {
        operationId: 'listSupplierLedger',
        tags,
        summary: 'Tedarikçi carisi özeti',
        description: `Faturası olan tedarikçiler: etkin fatura toplamı, ödenen, bakiye (kurumun tedarikçiye borcu), vadesi geçmiş kalan ve ilk açık vade; vadesi geçmiş tutar büyük olan önce. \`meta.totals\` kurumun bütün tedarikçi carisidir. Kampüs muhasebe defteri tutmaz (IST-142): yönetim takibidir. ${WHO}`,
        querystring: supplierLedgerQuery,
        response: { 200: supplierLedgerResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total, totals } = await supplierLedgerFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total, totals } }
    },
  )

  typed.get(
    '/api/v1/finance/supplier-ledger/:supplierId',
    {
      preValidation: guarded,
      schema: {
        operationId: 'getSupplierStatement',
        tags,
        summary: 'Tedarikçi ekstresi',
        description: `Tedarikçinin fatura, ödeme ve iptal hareketleri yürüyen bakiyeyle (iptal iptal gününe ters hareket), yeni önce sayfalı; toplamlar bütün hareketlerden. IBAN ve şahıs TCKN'si maskeli. Olmayan ya da başka kurumun tedarikçisi 404. ${WHO}`,
        params: supplierLedgerParams,
        querystring: supplierStatementQuery,
        response: { 200: supplierStatementResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { item, total } = await supplierStatementFor(
        contextOf(request),
        request.params.supplierId,
        { page, pageSize },
      )
      return { data: item, meta: { page, pageSize, total } }
    },
  )
}
