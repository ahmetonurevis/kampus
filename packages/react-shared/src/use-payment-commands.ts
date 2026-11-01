import type { operations } from '@kampus/api-client/schema.d.ts'

import { collectionKeyPrefix } from './collections.ts'
import { requireIfMatch } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Tahsilat kancaları (`/payments`, `/payment-settings`; ADR 0006, DOM-FIN-030…033). Komutlar
// `exclusive`: yollu `issues` (referans, tarih, yöntem) yalnız form alanında görünür.

type JsonBody<TOperation extends keyof operations> = NonNullable<
  operations[TOperation]['requestBody']
>['content']['application/json']

export type RecordPaymentBody = JsonBody<'recordPayment'>
export type PaymentMethodValue = RecordPaymentBody['method']

/** Mükerrer ödeme (core `invoice_already_paid`, 409): liste aynı anda tazelenir. */
export const ALREADY_PAID_MESSAGE = 'Bu taksit zaten ödenmiş. Liste güncellendi.'
export const PAYMENT_SETTINGS_CHANGED_MESSAGE =
  'Ayar başka biri tarafından değiştirildi. Güncel durum yüklendi.'

const PAYMENTS_KEY = ['payments'] as const
const PAYMENT_SETTINGS_KEY = ['payment-settings'] as const
/** Bir öğrencinin tahsilatları sayfaya sığar; uç sınırı 100'dür. */
const STUDENT_PAYMENTS_PAGE_SIZE = 100

/** Öğrencinin tahsilatları ve dağılımları; taksitin kalan tutarı buradan hesaplanır. */
export function useStudentPayments(studentId: string) {
  return useApiQuery({
    key: [...PAYMENTS_KEY, studentId],
    enabled: studentId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/payments', {
        params: { query: { studentId, page: 1, pageSize: STUDENT_PAYMENTS_PAGE_SIZE } },
        signal,
      }),
  })
}

/** İptal edilmemiş tahsilatların bu taksite dağıttığı toplam (DOM-FIN-030). */
export function allocatedToInvoice(
  payments: readonly {
    reversedAt: string | null
    allocations: readonly { invoiceId: string; amountCents: number }[]
  }[],
  invoiceId: string,
): number {
  return payments
    .filter((payment) => payment.reversedAt === null)
    .flatMap((payment) => payment.allocations)
    .filter((allocation) => allocation.invoiceId === invoiceId)
    .reduce((total, allocation) => total + allocation.amountCents, 0)
}

/** Tahsilat kaydeder; taksit ve tahsilat sorguları tazelenir. `Idempotency-Key` zorunludur. */
export function useRecordPayment(options: { onSuccess?: () => void | Promise<void> } = {}) {
  return useApiCommand({
    request: (client, body: RecordPaymentBody, headers) =>
      client.POST('/api/v1/payments', { params: { header: headers }, body }),
    invalidates: [collectionKeyPrefix('invoices'), PAYMENTS_KEY],
    messages: { invoice_already_paid: ALREADY_PAID_MESSAGE },
    exclusive: true,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

/** Nakit tahsilat ayarı; yalnız yönetici ve ön büro okur (ADR 0006 karar 7). */
export function usePaymentSettings(options: { enabled?: boolean } = {}) {
  const query = useApiQuery({
    key: PAYMENT_SETTINGS_KEY,
    enabled: options.enabled ?? true,
    request: (client, signal) => client.GET('/api/v1/payment-settings', { signal }),
  })
  return {
    ...query,
    cashEnabled: query.data?.data.cashPaymentsEnabled ?? false,
    version: query.data?.data.version ?? null,
  }
}

/** Nakit tahsilatı açar veya kapatır; `If-Match` ekrandaki ayar sürümüdür. Yalnız yönetici. */
export function useSetCashPayments() {
  return useApiCommand({
    request: (client, input: { enabled: boolean; version: number }, headers) =>
      client.PATCH('/api/v1/payment-settings', {
        params: { header: { ...headers, 'if-match': requireIfMatch(headers) } },
        body: { cashPaymentsEnabled: input.enabled },
      }),
    invalidates: [PAYMENT_SETTINGS_KEY],
    version: (input) => input.version,
    messages: { version_conflict: PAYMENT_SETTINGS_CHANGED_MESSAGE },
  })
}
