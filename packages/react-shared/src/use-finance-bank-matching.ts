import type { components, operations } from '@kampus/api-client/schema.d.ts'

import { collectionKeyPrefix } from './collections.ts'
import { requireIfMatch } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Banka hareketi eşleştirme kancaları (IST-115, ON-099; DOM-FIN-069). Yalnız `BANK_MATCH_ROLES`
// (bugün yönetici). Onay tahsilat yazar: taksit, tahsilat ve kart sorguları da tazelenir.

export type BankTransaction = components['schemas']['BankTransactionListItem']
export type BankMatchSuggestion = components['schemas']['BankMatchSuggestion']
export type BankStatementImportResult = components['schemas']['BankStatementImportResult']
export type BankStatementImportRow = components['schemas']['BankStatementImportRow']
type ImportBody = NonNullable<
  operations['importBankStatement']['requestBody']
>['content']['application/json']
export type BankStatementImportBody = Omit<ImportBody, 'dryRun'> & { dryRun: boolean }
export type BankTransactionListQuery = NonNullable<
  operations['listBankTransactions']['parameters']['query']
>

export const BANK_TRANSACTIONS_KEY = ['bank-transactions'] as const
export const BANK_TRANSACTION_CHANGED_MESSAGE =
  'Hareket başka biri tarafından değiştirildi. Liste güncellendi.'
export const BANK_TRANSACTION_CLOSED_MESSAGE =
  'Bu hareket zaten eşleşmiş ya da yoksayılmış. Liste güncellendi.'
/** Onayda olası mükerrer (K-121): panel uyarıyı gösterir, açık onayla yeniden gönderir. */
export const BANK_MATCH_DUPLICATE_CODE = 'bank_match_possible_duplicate'

const PAID_INVALIDATES = [
  BANK_TRANSACTIONS_KEY,
  collectionKeyPrefix('invoices'),
  ['payments'],
  ['finance-summary'],
] as const

/** Hareket listesi: en yeni işlem günü önce, sunucu sayfalı. */
export function useBankTransactions(query: BankTransactionListQuery & { page: number }) {
  return useFinanceListQuery({
    key: [...BANK_TRANSACTIONS_KEY, 'list', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/bank-transactions', { params: { query }, signal }),
  })
}

/** Tek hareketin önerileri; `studentId` verilirse yalnız o öğrencinin açık taksiti. */
export function useBankSuggestions(transactionId: string | null, studentId?: string) {
  return useApiQuery({
    key: [...BANK_TRANSACTIONS_KEY, 'suggestions', transactionId, studentId ?? null],
    enabled: transactionId !== null,
    request: (client, signal) =>
      client.GET('/api/v1/finance/bank-transactions/{transactionId}/suggestions', {
        params: {
          path: { transactionId: transactionId ?? '' },
          query: studentId === undefined ? {} : { studentId },
        },
        signal,
      }),
  })
}

/** Ekstre önizleme ve onayı; `Idempotency-Key` kanca içinde yönetilir. */
export function useImportBankStatement() {
  return useApiCommand({
    request: (client, body: BankStatementImportBody, headers) =>
      client.POST('/api/v1/finance/bank-statement-imports', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [BANK_TRANSACTIONS_KEY],
  })
}

/**
 * Öneriyi ya da seçilen taksiti onaylar: tahsilat yazılır (DOM-FIN-069). `confirmDuplicate`
 * olası mükerrer uyarısından sonra yetkilinin açık onayıdır (K-121).
 */
export function useMatchBankTransaction() {
  return useApiCommand({
    request: (
      client,
      input: {
        transactionId: string
        version: number
        studentId: string
        invoiceId: string
        confirmDuplicate?: boolean
      },
      headers,
    ) =>
      client.POST('/api/v1/finance/bank-transactions/{transactionId}/match', {
        params: {
          path: { transactionId: input.transactionId },
          header: { ...headers, 'if-match': requireIfMatch(headers) },
        },
        body: {
          studentId: input.studentId,
          invoiceId: input.invoiceId,
          ...(input.confirmDuplicate === true ? { confirmDuplicate: true } : {}),
        },
      }),
    invalidates: PAID_INVALIDATES,
    version: (input) => input.version,
    messages: {
      version_conflict: BANK_TRANSACTION_CHANGED_MESSAGE,
      bank_transaction_not_open: BANK_TRANSACTION_CLOSED_MESSAGE,
    },
    refreshOn: (error) => error.code === 'bank_transaction_not_open',
  })
}

export function useIgnoreBankTransaction() {
  return useApiCommand({
    request: (
      client,
      input: { transactionId: string; version: number; ignoreReason: string },
      headers,
    ) =>
      client.POST('/api/v1/finance/bank-transactions/{transactionId}/ignore', {
        params: {
          path: { transactionId: input.transactionId },
          header: { ...headers, 'if-match': requireIfMatch(headers) },
        },
        body: { ignoreReason: input.ignoreReason },
      }),
    invalidates: [BANK_TRANSACTIONS_KEY],
    version: (input) => input.version,
    messages: {
      version_conflict: BANK_TRANSACTION_CHANGED_MESSAGE,
      bank_transaction_not_open: BANK_TRANSACTION_CLOSED_MESSAGE,
    },
    exclusive: true,
  })
}

export function useRestoreBankTransaction() {
  return useApiCommand({
    request: (client, input: { transactionId: string; version: number }, headers) =>
      client.POST('/api/v1/finance/bank-transactions/{transactionId}/restore', {
        params: {
          path: { transactionId: input.transactionId },
          header: { ...headers, 'if-match': requireIfMatch(headers) },
        },
      }),
    invalidates: [BANK_TRANSACTIONS_KEY],
    version: (input) => input.version,
    messages: { version_conflict: BANK_TRANSACTION_CHANGED_MESSAGE },
  })
}
