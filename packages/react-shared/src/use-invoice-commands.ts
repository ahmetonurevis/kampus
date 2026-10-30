import type { operations } from '@kampus/api-client/schema.d.ts'

import { collectionKeyPrefix } from './collections.ts'
import { useApiCommand } from './use-api-command.ts'

/** Ödeme yöntemleri OpenAPI'den gelir (core `paymentInputSchema`; yeni yöntem tek yerden eklenir). */
export type PaymentMethod =
  operations['payInvoice']['requestBody']['content']['application/json']['method']

export interface PayInvoiceInput {
  invoiceId: string
  /** Ödeme yöntemi (`Banka havalesi`, `Nakit`, `Kredi kartı`). */
  method: PaymentMethod
}

/** Mükerrer ödeme (core `invoice_already_paid`, 409): liste aynı anda tazelenir. */
export const ALREADY_PAID_MESSAGE = 'Bu taksit zaten ödenmiş. Liste güncellendi.'

/**
 * Taksit tahsilatı (`POST /invoices/:invoiceId/pay`, yönetici ve ön büro, `finance` modülü).
 * `Idempotency-Key` zorunludur; başarıda ve çakışmada taksit sorguları (liste ve detay) tazelenir.
 * `If-Match` gönderilmez: aynı taksidin ikinci ödemesini core `invoice_already_paid` ile reddeder.
 */
export function usePayInvoice(options: { onSuccess?: () => void | Promise<void> } = {}) {
  return useApiCommand({
    request: (client, { invoiceId, method }: PayInvoiceInput, headers) =>
      client.POST('/api/v1/invoices/{invoiceId}/pay', {
        params: { path: { invoiceId }, header: headers },
        body: { method },
      }),
    invalidates: [collectionKeyPrefix('invoices')],
    messages: { invoice_already_paid: ALREADY_PAID_MESSAGE },
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}
