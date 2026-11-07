import type { operations } from '@kampus/api-client/schema.d.ts'

import { collectionKeyPrefix } from './collections.ts'
import { requireIfMatch } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Ayrılış ve iade kancaları (`/students/:id/withdraw*`, `/withdrawals`; ADR 0006 karar 10,
// DOM-FIN-040, -041, DOM-KAY-024). Onay ve iade ödemesi taze oturum ister.

// Dosya yükleme uçları `multipart/form-data` gövdesi taşır; JSON gövdesi koşulla seçilir.
type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type WithdrawalQuoteBody = JsonBody<'quoteWithdrawal'>
export type WithdrawStudentBody = JsonBody<'withdrawStudent'>
export type PayRefundBody = JsonBody<'payRefund'>
export type RefundStatus = 'none' | 'pending' | 'paid'

/** Sunucu "oturum eski" dediğinde ekran parola penceresini açar. */
export const REAUTHENTICATION_CODE = 'reauthentication_required'
export const WITHDRAWAL_CHANGED_MESSAGE =
  'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.'

const WITHDRAWALS_KEY = ['withdrawals'] as const

export function useWithdrawals(query: {
  page: number
  pageSize: number
  refundStatus?: RefundStatus
  /** Öğrenci adında arama (en az 2 karakter; ON-118). */
  q?: string
}) {
  return useFinanceListQuery({
    key: [...WITHDRAWALS_KEY, query],
    request: (client, signal) => client.GET('/api/v1/withdrawals', { params: { query }, signal }),
  })
}

/** Hesabı yazmadan gösterir; yazma değildir, sorgu tazelenmez. */
export function useQuoteWithdrawal() {
  return useApiCommand({
    request: (client, input: { studentId: string; body: WithdrawalQuoteBody }) =>
      client.POST('/api/v1/students/{studentId}/withdrawal-quote', {
        params: { path: { studentId: input.studentId } },
        body: input.body,
      }),
    invalidates: [],
    exclusive: true,
  })
}

export function useWithdrawStudent() {
  return useApiCommand({
    request: (client, input: { studentId: string; body: WithdrawStudentBody }, headers) =>
      client.POST('/api/v1/students/{studentId}/withdraw', {
        params: { path: { studentId: input.studentId }, header: headers },
        body: input.body,
      }),
    invalidates: [
      WITHDRAWALS_KEY,
      collectionKeyPrefix('students'),
      collectionKeyPrefix('invoices'),
    ],
    exclusive: true,
  })
}

export function usePayRefund() {
  return useApiCommand({
    request: (
      client,
      input: { withdrawalId: string; version: number; body: PayRefundBody },
      headers,
    ) =>
      client.POST('/api/v1/withdrawals/{withdrawalId}/pay-refund', {
        params: {
          path: { withdrawalId: input.withdrawalId },
          header: { ...headers, 'if-match': requireIfMatch(headers) },
        },
        body: input.body,
      }),
    invalidates: [WITHDRAWALS_KEY],
    version: (input) => input.version,
    messages: { version_conflict: WITHDRAWAL_CHANGED_MESSAGE },
    exclusive: true,
  })
}
