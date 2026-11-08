import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'
import { PROCUREMENT_CHANGED_MESSAGE, PROCUREMENT_KEY } from './use-finance-procurement.ts'
import { PURCHASE_REPORT_KEY } from './use-finance-purchase-report.ts'

// Tedarikçi carisi kancaları (`/finance/supplier-invoices`, `/finance/supplier-payments`,
// `/finance/supplier-ledger`; DOM-FIN-076, ON-143). Anahtar satın alma anahtarının altındadır:
// faturanın siparişe bağı ve tedarikçi kaydı aynı önbelleği paylaşır. Komutlar `exclusive`.

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never
type Query<TOperation extends keyof operations> = operations[TOperation]['parameters'] extends {
  query?: infer TQuery
}
  ? NonNullable<TQuery>
  : never

export type CreateSupplierInvoiceBody = JsonBody<'createSupplierInvoice'>
export type SupplierInvoicePlanBody = JsonBody<'replanSupplierInvoice'>
export type CreateSupplierPaymentBody = JsonBody<'createSupplierPayment'>
export type SupplierInvoiceRow =
  operations['listSupplierInvoices']['responses'][200]['content']['application/json']['data'][number]
export type SupplierInvoiceDetail =
  operations['getSupplierInvoice']['responses'][200]['content']['application/json']['data']
export type SupplierPaymentRow =
  operations['listSupplierPayments']['responses'][200]['content']['application/json']['data'][number]
export type SupplierLedgerRow =
  operations['listSupplierLedger']['responses'][200]['content']['application/json']['data'][number]
export type SupplierStatement =
  operations['getSupplierStatement']['responses'][200]['content']['application/json']['data']
export type SupplierInvoiceQuery = Query<'listSupplierInvoices'>
export type SupplierPaymentQuery = Query<'listSupplierPayments'>
export type SupplierLedgerQuery = Query<'listSupplierLedger'>

/** Kullanıcının açık onayını isteyen uyarılar (409): sipariş aşımı ve yeniden talimat (K-162, K-165). */
export const SUPPLIER_LEDGER_WARNING_CODES = [
  'supplier_invoice_exceeds_order_warning',
  'supplier_payment_instruction_exported_warning',
] as const

const LEDGER_KEY = [...PROCUREMENT_KEY, 'supplier-ledger'] as const
const MESSAGES = { version_conflict: PROCUREMENT_CHANGED_MESSAGE }
const keyOnly = (headers: CommandHeaders) => ({ 'idempotency-key': headers['idempotency-key'] })
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useSupplierLedger(query: SupplierLedgerQuery) {
  return useFinanceListQuery({
    key: [...LEDGER_KEY, 'summary', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/supplier-ledger', { params: { query }, signal }),
  })
}

export function useSupplierStatement(
  supplierId: string,
  query: { page: number; pageSize: number },
) {
  return useFinanceListQuery(
    {
      key: [...LEDGER_KEY, 'statement', supplierId, query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/supplier-ledger/{supplierId}', {
          params: { path: { supplierId }, query },
          signal,
        }),
    },
    { enabled: supplierId !== '' },
  )
}

export function useSupplierInvoices(query: SupplierInvoiceQuery) {
  return useFinanceListQuery({
    key: [...LEDGER_KEY, 'invoices', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/supplier-invoices', { params: { query }, signal }),
  })
}

export function useSupplierInvoice(invoiceId: string) {
  return useApiQuery({
    key: [...LEDGER_KEY, 'invoice', invoiceId],
    enabled: invoiceId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/supplier-invoices/{invoiceId}', {
        params: { path: { invoiceId } },
        signal,
      }),
  })
}

export function useSupplierPayments(query: SupplierPaymentQuery) {
  return useFinanceListQuery({
    key: [...LEDGER_KEY, 'payments', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/supplier-payments', { params: { query }, signal }),
  })
}

/** Fatura ve ödeme planı; `Idempotency-Key` zorunlu (yinelenen tıklama ikinci fatura açmaz). */
export function useCreateSupplierInvoice() {
  return useApiCommand({
    request: (client, body: CreateSupplierInvoiceBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/supplier-invoices', {
        params: { header: keyOnly(headers) },
        body,
      }),
    invalidates: [LEDGER_KEY, PURCHASE_REPORT_KEY],
    exclusive: true,
  })
}

/** Ödeme planı değişikliği ve fatura iptali (`If-Match`). */
export function useTransitionSupplierInvoice() {
  return useApiCommand({
    request: (
      client,
      input:
        | { invoiceId: string; version: number; action: 'plan'; body: SupplierInvoicePlanBody }
        | { invoiceId: string; version: number; action: 'cancel'; reason: string },
      headers: CommandHeaders,
    ) => {
      const params = { path: { invoiceId: input.invoiceId }, header: versioned(headers) }
      return input.action === 'plan'
        ? client.POST('/api/v1/finance/supplier-invoices/{invoiceId}/plan', {
            params,
            body: input.body,
          })
        : client.POST('/api/v1/finance/supplier-invoices/{invoiceId}/cancel', {
            params,
            body: { reason: input.reason },
          })
    },
    invalidates: [LEDGER_KEY, PURCHASE_REPORT_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Taksite ödeme; `Idempotency-Key` zorunlu (çift tıklama iki ödeme yazmaz). */
export function useCreateSupplierPayment() {
  return useApiCommand({
    request: (client, body: CreateSupplierPaymentBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/supplier-payments', {
        params: { header: keyOnly(headers) },
        body,
      }),
    invalidates: [LEDGER_KEY, PURCHASE_REPORT_KEY],
    exclusive: true,
  })
}

export function useCancelSupplierPayment() {
  return useApiCommand({
    request: (
      client,
      input: { paymentId: string; version: number; reason: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/supplier-payments/{paymentId}/cancel', {
        params: { path: { paymentId: input.paymentId }, header: versioned(headers) },
        body: { reason: input.reason },
      }),
    invalidates: [LEDGER_KEY, PURCHASE_REPORT_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/**
 * Ödeme talimatı dosyası (K-164): CSV metin olarak gelir; ödemeler sunucuda "talimatı alındı"
 * işaretlendiği için liste tazelenir. Taze oturum ister.
 */
export function usePaymentInstructionFile() {
  return useApiCommand({
    request: (client, body: { paymentIds: string[]; confirmReexport?: boolean }) =>
      client.POST('/api/v1/finance/supplier-payments/instruction-file', {
        body,
        parseAs: 'text',
      }),
    invalidates: [LEDGER_KEY],
  })
}
