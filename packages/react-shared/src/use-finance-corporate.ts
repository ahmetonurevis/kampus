import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Kurumsal müşteri, çalışan bağı, toplu fatura ve katılım özeti kancaları
// (`/finance/corporate-customers`, `/finance/corporate-invoices`; IST-089, DOM-FIN-060, DOM-DIL-093).
// Yalnız dil okulunda, yönetici ve ön büro; toplu fatura iptali yöneticide. Komutlar `exclusive`:
// alan hatası formda, yolsuz hata tek toast. Her yazma kurumsal anahtarın tamamını tazeler: bağ
// önizlemeyi, fatura listeyi ve önizlemeyi değiştirir.

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type CreateCorporateCustomerBody = JsonBody<'createCorporateCustomer'>
export type UpdateCorporateCustomerBody = JsonBody<'updateCorporateCustomer'>
export type LinkCorporateEmployeeBody = JsonBody<'linkCorporateEmployee'>
export type CorporateCustomer =
  operations['getCorporateCustomer']['responses'][200]['content']['application/json']['data']
export type CorporateEmployee =
  operations['listCorporateEmployees']['responses'][200]['content']['application/json']['data'][number]
export type CorporateInvoice =
  operations['getCorporateInvoice']['responses'][200]['content']['application/json']['data']
export type CorporateInvoiceSummary =
  operations['listCorporateInvoices']['responses'][200]['content']['application/json']['data'][number]
export type CorporateAttendanceReport =
  operations['getCorporateAttendanceReport']['responses'][200]['content']['application/json']['data']

export const CORPORATE_CHANGED_MESSAGE =
  'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.'

export const CORPORATE_KEY = ['finance-corporate'] as const
const MESSAGES = { version_conflict: CORPORATE_CHANGED_MESSAGE }
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useCorporateCustomers(query: { page: number; pageSize: number; q?: string }) {
  return useFinanceListQuery({
    key: [...CORPORATE_KEY, 'customers', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/corporate-customers', { params: { query }, signal }),
  })
}

export function useCorporateCustomer(customerId: string) {
  return useApiQuery({
    key: [...CORPORATE_KEY, 'customer', customerId],
    enabled: customerId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/corporate-customers/{customerId}', {
        params: { path: { customerId } },
        signal,
      }),
  })
}

export function useCreateCorporateCustomer() {
  return useApiCommand({
    request: (client, body: CreateCorporateCustomerBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/corporate-customers', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [CORPORATE_KEY],
    exclusive: true,
  })
}

export function useUpdateCorporateCustomer() {
  return useApiCommand({
    request: (
      client,
      input: { customerId: string; version: number; body: UpdateCorporateCustomerBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/corporate-customers/{customerId}', {
        params: { path: { customerId: input.customerId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [CORPORATE_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Etkin çalışanı olan şirket arşivlenmez (`corporate_customer_has_employees`). */
export function useArchiveCorporateCustomer() {
  return useApiCommand({
    request: (client, input: { customerId: string; version: number }, headers: CommandHeaders) =>
      client.DELETE('/api/v1/finance/corporate-customers/{customerId}', {
        params: { path: { customerId: input.customerId }, header: versioned(headers) },
      }),
    invalidates: [CORPORATE_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCorporateEmployees(
  customerId: string,
  query: { page: number; pageSize: number; status?: 'active' | 'ended' },
) {
  return useFinanceListQuery(
    {
      key: [...CORPORATE_KEY, 'employees', customerId, query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/corporate-customers/{customerId}/employees', {
          params: { path: { customerId }, query },
          signal,
        }),
    },
    { enabled: customerId !== '' },
  )
}

export function useLinkCorporateEmployee() {
  return useApiCommand({
    request: (
      client,
      input: { customerId: string; body: LinkCorporateEmployeeBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/corporate-customers/{customerId}/employees', {
        params: {
          path: { customerId: input.customerId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [CORPORATE_KEY],
    exclusive: true,
  })
}

export function useEndCorporateEmployee() {
  return useApiCommand({
    request: (
      client,
      input: { customerId: string; linkId: string; version: number; endsOn: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/corporate-customers/{customerId}/employees/{linkId}/end', {
        params: {
          path: { customerId: input.customerId, linkId: input.linkId },
          header: versioned(headers),
        },
        body: { endsOn: input.endsOn },
      }),
    invalidates: [CORPORATE_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Toplu fatura önizlemesi; dönem geçersizse sorgu atılmaz. */
export function useCorporateBillable(
  customerId: string,
  period: { from: string; to: string },
  options: { enabled?: boolean } = {},
) {
  return useApiQuery({
    key: [...CORPORATE_KEY, 'billable', customerId, period],
    enabled: (options.enabled ?? true) && customerId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/corporate-customers/{customerId}/billable', {
        params: { path: { customerId }, query: period },
        signal,
      }),
  })
}

export function useCorporateInvoices(query: {
  page: number
  pageSize: number
  customerId?: string
  status?: 'issued' | 'cancelled'
}) {
  return useFinanceListQuery({
    key: [...CORPORATE_KEY, 'invoices', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/corporate-invoices', { params: { query }, signal }),
  })
}

export function useCorporateInvoice(invoiceId: string) {
  return useApiQuery({
    key: [...CORPORATE_KEY, 'invoice', invoiceId],
    enabled: invoiceId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/corporate-invoices/{invoiceId}', {
        params: { path: { invoiceId } },
        signal,
      }),
  })
}

/** Toplu faturayı keser; `Idempotency-Key` zorunludur, tekrarlanan istek ilk yanıtı alır. */
export function useCreateCorporateInvoice() {
  return useApiCommand({
    request: (
      client,
      body: { customerId: string; from: string; to: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/corporate-invoices', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [CORPORATE_KEY],
    exclusive: true,
  })
}

export function useCancelCorporateInvoice() {
  return useApiCommand({
    request: (
      client,
      input: { invoiceId: string; version: number; reason: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/corporate-invoices/{invoiceId}/cancel', {
        params: { path: { invoiceId: input.invoiceId }, header: versioned(headers) },
        body: { reason: input.reason },
      }),
    invalidates: [CORPORATE_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Toplu fatura dökümü CSV (`Accept: text/csv`); taze oturum ister, denetime düşer. */
export function useCorporateInvoiceExport() {
  return useApiCommand({
    request: (client, invoiceId: string) =>
      client.GET('/api/v1/finance/corporate-invoices/{invoiceId}', {
        params: { path: { invoiceId } },
        headers: { accept: 'text/csv' },
        parseAs: 'text',
      }),
    invalidates: [],
  })
}

export function useCorporateAttendanceReport(customerId: string) {
  return useApiQuery({
    key: [...CORPORATE_KEY, 'attendance', customerId],
    enabled: customerId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/corporate-customers/{customerId}/attendance-report', {
        params: { path: { customerId } },
        signal,
      }),
  })
}

/** Katılım özeti CSV; taze oturum ister, denetime düşer. */
export function useCorporateAttendanceExport() {
  return useApiCommand({
    request: (client, customerId: string) =>
      client.GET('/api/v1/finance/corporate-customers/{customerId}/attendance-report', {
        params: { path: { customerId } },
        headers: { accept: 'text/csv' },
        parseAs: 'text',
      }),
    invalidates: [],
  })
}
