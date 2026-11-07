import type { operations } from '@kampus/api-client/schema.d.ts'

import { collectionKeyPrefix } from './collections.ts'
import { requireIfMatch } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Tahsilat kancaları (`/payments`, `/payment-settings`; ADR 0006, DOM-FIN-030…033). Komutlar
// `exclusive`: yollu `issues` (referans, tarih, yöntem) yalnız form alanında görünür.

// Dosya yükleme uçları `multipart/form-data` gövdesi taşır; JSON gövdesi koşulla seçilir.
type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type RecordPaymentBody = JsonBody<'recordPayment'>
export type PaymentMethodValue = RecordPaymentBody['method']
export type BankAccountBody = JsonBody<'createBankAccount'>

/** Mükerrer ödeme (core `invoice_already_paid`, 409): liste aynı anda tazelenir. */
export const ALREADY_PAID_MESSAGE = 'Bu taksit zaten ödenmiş. Liste güncellendi.'
export const PAYMENT_CHANGED_MESSAGE =
  'Tahsilat başka biri tarafından değiştirildi. Liste güncellendi.'
export const PAYMENT_SETTINGS_CHANGED_MESSAGE =
  'Ayar başka biri tarafından değiştirildi. Güncel durum yüklendi.'

const PAYMENTS_KEY = ['payments'] as const
const PAYMENT_SETTINGS_KEY = ['payment-settings'] as const
const BANK_ACCOUNTS_KEY = ['bank-accounts'] as const
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

/** Tahsilat listesi: en yeni ödeme önce, sunucu sayfalı; `q` öğrenci adı ve referansta arar. */
export function usePaymentList(query: {
  page: number
  pageSize: number
  q?: string
  mebbis?: 'pending'
  method?: PaymentMethodValue
  /** Ödeme günü aralığı (Europe/Istanbul, `YYYY-MM-DD`, uçlar dahil; ON-118). */
  dateFrom?: string
  dateTo?: string
}) {
  return useApiQuery({
    key: [...PAYMENTS_KEY, 'list', query],
    request: (client, signal) => client.GET('/api/v1/payments', { params: { query }, signal }),
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

/** Tahsilatı gerekçeyle iptal eder (yalnız yönetici); `If-Match` okunan tahsilat sürümüdür. */
export function useReversePayment() {
  return useApiCommand({
    request: (client, input: { paymentId: string; version: number; reason: string }, headers) =>
      client.POST('/api/v1/payments/{paymentId}/reverse', {
        params: {
          path: { paymentId: input.paymentId },
          header: { ...headers, 'if-match': requireIfMatch(headers) },
        },
        body: { reason: input.reason },
      }),
    invalidates: [collectionKeyPrefix('invoices'), PAYMENTS_KEY],
    version: (input) => input.version,
    messages: { version_conflict: PAYMENT_CHANGED_MESSAGE },
    exclusive: true,
  })
}

/**
 * Gecikmiş taksiti elle hatırlatır (DOM-FIN-035, ON-113): veliye bildirim gider, `reminderAt` yazılır.
 * Bugün zaten hatırlatıldıysa yeni bildirim yazılmaz (`reminder: 'already_sent'`).
 */
export function useRemindInstallment() {
  return useApiCommand({
    request: (client, input: { invoiceId: string }, headers) =>
      client.POST('/api/v1/finance/invoices/{invoiceId}/remind', {
        params: { path: { invoiceId: input.invoiceId }, header: headers },
        body: {},
      }),
    invalidates: [collectionKeyPrefix('invoices')],
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

/** Tahsilatın MEBBİS işaretini değiştirir (yönetici ve ön büro; DOM-FIN-032). */
export function useSetPaymentMebbis() {
  return useApiCommand({
    request: (client, input: { paymentId: string; version: number; recorded: boolean }, headers) =>
      client.POST('/api/v1/payments/{paymentId}/mebbis-record', {
        params: {
          path: { paymentId: input.paymentId },
          header: { ...headers, 'if-match': requireIfMatch(headers) },
        },
        body: { recorded: input.recorded },
      }),
    invalidates: [PAYMENTS_KEY],
    version: (input) => input.version,
    messages: { version_conflict: PAYMENT_CHANGED_MESSAGE },
  })
}

/** Kurumun bildirilmiş banka hesapları; yönetici ve ön büro okur (DOM-FIN-032). */
export function useBankAccounts() {
  return useApiQuery({
    key: BANK_ACCOUNTS_KEY,
    request: (client, signal) => client.GET('/api/v1/bank-accounts', { signal }),
  })
}

/** Bildirilmiş hesap ekler; yalnız yönetici. */
export function useCreateBankAccount() {
  return useApiCommand({
    request: (client, body: BankAccountBody, headers) =>
      client.POST('/api/v1/bank-accounts', { params: { header: headers }, body }),
    invalidates: [BANK_ACCOUNTS_KEY],
    exclusive: true,
  })
}

/** Hesabı arşivler; yalnız yönetici. `If-Match` listedeki sürümdür. */
export function useArchiveBankAccount() {
  return useApiCommand({
    request: (client, input: { id: string; version: number }, headers) =>
      client.DELETE('/api/v1/bank-accounts/{bankAccountId}', {
        params: {
          path: { bankAccountId: input.id },
          header: { ...headers, 'if-match': requireIfMatch(headers) },
        },
      }),
    invalidates: [BANK_ACCOUNTS_KEY],
    version: (input) => input.version,
    messages: { version_conflict: PAYMENT_SETTINGS_CHANGED_MESSAGE },
  })
}
