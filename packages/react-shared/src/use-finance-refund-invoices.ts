import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// İade faturası ve iptal isteği kancaları (`/finance/refund-invoices`; DOM-FIN-096, K-292…K-295).
// Yalnız yönetici. Entegratör bağlantısı yok: hazır belge CSV ile dışa aktarılır, sonuç elle işlenir.

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never
type Json200<TOperation extends keyof operations> = operations[TOperation]['responses'] extends {
  200: { content: { 'application/json': infer TBody } }
}
  ? TBody
  : never

export type CreateRefundInvoiceBody = JsonBody<'createRefundInvoice'>
export type CompleteRefundInvoiceBody = JsonBody<'completeRefundInvoice'>
export type DiscardRefundInvoiceBody = JsonBody<'discardRefundInvoice'>
export type RefundInvoice = Json200<'listRefundInvoices'>['data'][number]
export type RefundInvoiceQuery = {
  page: number
  pageSize: number
  status?: RefundInvoice['status']
  kind?: RefundInvoice['kind']
  withdrawalId?: string
}

const KEY = ['refund-invoices'] as const
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useRefundInvoices(query: RefundInvoiceQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...KEY, query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/refund-invoices', { params: { query }, signal }),
    },
    { enabled },
  )
}

/** Belgenin hazırlanacağı ayrılış iadesi (ayrılış listesinden gelen bağlantı); önceki kayıt yer tutucu olmaz. */
export function useRefundInvoiceWithdrawal(withdrawalId: string | null) {
  return useFinanceListQuery(
    {
      key: ['withdrawals', 'detail', withdrawalId],
      request: (client, signal) =>
        client.GET('/api/v1/withdrawals/{withdrawalId}', {
          params: { path: { withdrawalId: withdrawalId ?? '' } },
          signal,
        }),
    },
    { enabled: withdrawalId !== null, keepPreviousPage: false },
  )
}

export function useCreateRefundInvoice() {
  return useApiCommand({
    request: (client, body: CreateRefundInvoiceBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/refund-invoices', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [KEY],
    exclusive: true,
  })
}

/** Durum geçişleri: hazır işaretleme, sonucun işlenmesi ve vazgeçme (`If-Match` zorunlu). */
export function useRefundInvoiceStep() {
  return useApiCommand({
    request: (
      client,
      input:
        | { action: 'ready'; id: string; version: number }
        | { action: 'complete'; id: string; version: number; body: CompleteRefundInvoiceBody }
        | { action: 'discard'; id: string; version: number; body: DiscardRefundInvoiceBody },
      headers: CommandHeaders,
    ) => {
      const params = { path: { refundInvoiceId: input.id }, header: versioned(headers) }
      switch (input.action) {
        case 'ready':
          return client.POST('/api/v1/finance/refund-invoices/{refundInvoiceId}/ready', {
            params,
          })
        case 'complete':
          return client.POST('/api/v1/finance/refund-invoices/{refundInvoiceId}/complete', {
            params,
            body: input.body,
          })
        case 'discard':
          return client.POST('/api/v1/finance/refund-invoices/{refundInvoiceId}/discard', {
            params,
            body: input.body,
          })
        default:
          return input satisfies never
      }
    },
    version: (input) => input.version,
    invalidates: [KEY],
    exclusive: true,
  })
}

/** Belge listesinin CSV'si (`Accept: text/csv`); öğrenci adı taşır, taze oturum ister, denetime düşer. */
export function useRefundInvoicesExport() {
  return useApiCommand({
    request: (client, query: Pick<RefundInvoiceQuery, 'status' | 'kind'>) =>
      client.GET('/api/v1/finance/refund-invoices', {
        params: { query },
        headers: { accept: 'text/csv' },
        parseAs: 'text',
      }),
    invalidates: [],
  })
}
