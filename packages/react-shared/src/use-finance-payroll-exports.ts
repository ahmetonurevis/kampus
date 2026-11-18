import type { operations } from '@kampus/api-client/schema.d.ts'
import type { PayrollExportProfile } from '@kampus/school-core/lib/finance-payroll-exports.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Bordro programına aktarım kancaları (`/finance/payroll-exports`, `/finance/payroll-lesson-hours`,
// `/finance/payroll-export-profile`; DOM-FIN-105, ON-202). Önizleme tutar içerir ve her okuma
// denetime düşer (K-338); dosya taze oturum ister. Her yazma bordro anahtarının tamamını tazeler.

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type PayrollPreview =
  operations['previewPayrollExport']['responses'][200]['content']['application/json']['data']
export type PayrollLine = PayrollPreview['lines'][number]
export type PayrollExportHistoryItem =
  operations['listPayrollExports']['responses'][200]['content']['application/json']['data'][number]
export type CreatePayrollLessonHoursBody = JsonBody<'createPayrollLessonHours'>

export const PAYROLL_EXPORTS_KEY = ['finance', 'payroll-exports'] as const
const MESSAGES = {
  version_conflict: 'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.',
}

/** Ayın girdi satırları ve toplamları; her okuma denetime düşer. */
export function usePayrollPreview(month: string, enabled = true) {
  return useApiQuery({
    key: [...PAYROLL_EXPORTS_KEY, 'preview', month],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/payroll-exports/preview', {
        params: { query: { month } },
        signal,
      }),
  })
}

/** Üretim geçmişi (özet satırları), ay süzgeciyle. */
export function usePayrollExportHistory(query: { page: number; pageSize: number; month?: string }) {
  return useFinanceListQuery({
    key: [...PAYROLL_EXPORTS_KEY, 'history', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/payroll-exports', { params: { query }, signal }),
  })
}

/** Dosyayı metin olarak üretir; taze oturum ister, özet satırı yazar (geçmiş tazelenir). */
export function usePayrollExportFile() {
  return useApiCommand({
    request: (client, input: { month: string }) =>
      client.POST('/api/v1/finance/payroll-exports', { body: input, parseAs: 'text' }),
    invalidates: [[...PAYROLL_EXPORTS_KEY, 'history']],
  })
}

export function useCreatePayrollLessonHours() {
  return useApiCommand({
    request: (client, body: CreatePayrollLessonHoursBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/payroll-lesson-hours', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [PAYROLL_EXPORTS_KEY],
    exclusive: true,
  })
}

export function useUpdatePayrollLessonHours() {
  return useApiCommand({
    request: (
      client,
      input: { entryId: string; version: number; hours: number; note: string | null },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/payroll-lesson-hours/{entryId}', {
        params: {
          path: { entryId: input.entryId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: { hours: input.hours, note: input.note },
      }),
    invalidates: [PAYROLL_EXPORTS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useArchivePayrollLessonHours() {
  return useApiCommand({
    request: (client, input: { entryId: string; version: number }, headers: CommandHeaders) =>
      client.DELETE('/api/v1/finance/payroll-lesson-hours/{entryId}', {
        params: {
          path: { entryId: input.entryId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
      }),
    invalidates: [PAYROLL_EXPORTS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

const PROFILE_KEY = [...PAYROLL_EXPORTS_KEY, 'profile'] as const

export function usePayrollExportProfile(enabled = true) {
  return useApiQuery({
    key: PROFILE_KEY,
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/payroll-export-profile', { signal }),
  })
}

/** Şablonu kaydeder; `profile: null` genel dosyaya döner. */
export function useSetPayrollExportProfile() {
  return useApiCommand({
    request: (
      client,
      input: { profile: PayrollExportProfile | null; version: number },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/payroll-export-profile', {
        params: {
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: { profile: input.profile },
      }),
    invalidates: [PROFILE_KEY],
    version: (input) => input.version,
    messages: {
      version_conflict: 'Şablon başka bir oturumda değişti. Sayfayı yenileyip yeniden deneyin.',
    },
  })
}
