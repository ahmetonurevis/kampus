import type { FinanceExportProfile } from '@kampus/school-core/lib/finance-export-profile.ts'

import { requireIfMatch } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Muhasebe aktarımı kancaları (`/finance/summary`, `/finance/exports`; IST-111, ADR 0006 karar 11).

export type FinanceExportKind = 'payments' | 'refunds' | 'invoices'
export interface FinancePeriod {
  from: string
  to: string
}

export function useFinanceSummary(period: FinancePeriod, options: { enabled?: boolean } = {}) {
  return useApiQuery({
    key: ['finance-summary', period],
    enabled: options.enabled ?? true,
    request: (client, signal) =>
      client.GET('/api/v1/finance/summary', { params: { query: period }, signal }),
  })
}

/** Finans ekranı kartları: kurum geneli, kısmi ödemeler dahil. Ödeme sonrası tazelenir. */
export function useFinanceTotals() {
  return useApiQuery({
    key: ['payments', 'finance-totals'],
    request: (client, signal) => client.GET('/api/v1/finance/totals', { signal }),
  })
}

/**
 * Finans özeti (`GET /finance/overview`; IST-116, IST-121): tahsilat, açık ve gecikmiş tutar, ay
 * kırılımı ve gecikmiş borcu olan öğrenciler. Dönem verilmezse son altı takvim ayı. Ödeme sonrası
 * tazelenir.
 */
export function useFinanceOverview(
  period: FinancePeriod | null = null,
  options: { enabled?: boolean } = {},
) {
  return useApiQuery({
    key: ['payments', 'finance-overview', period],
    enabled: options.enabled ?? true,
    request: (client, signal) =>
      client.GET('/api/v1/finance/overview', { params: { query: period ?? {} }, signal }),
  })
}

/**
 * Öğrencinin bakiyesi: toplam, ödenen, açık, gecikmiş tutar ve en yakın açık taksit. Veli yalnız
 * bağlı çocuğunu, öğrenci kendisini okur. Ödeme sonrası tazelenir.
 */
export function useStudentBalance(studentId: string, options: { enabled?: boolean } = {}) {
  return useApiQuery({
    key: ['payments', 'student-balance', studentId],
    enabled: options.enabled ?? true,
    request: (client, signal) =>
      client.GET('/api/v1/finance/students/{studentId}/balance', {
        params: { path: { studentId } },
        signal,
      }),
  })
}

const EXPORT_PROFILE_KEY = ['payments', 'export-profile'] as const

/** Muhasebe aktarım profili (ON-024); yalnız yönetici okur. */
export function useFinanceExportProfile(options: { enabled?: boolean } = {}) {
  return useApiQuery({
    key: EXPORT_PROFILE_KEY,
    enabled: options.enabled ?? true,
    request: (client, signal) => client.GET('/api/v1/finance/export-profile', { signal }),
  })
}

/** Profili kaydeder; `profile: null` standart dosyaya döndürür. */
export function useSetFinanceExportProfile() {
  return useApiCommand({
    request: (client, input: { profile: FinanceExportProfile | null; version: number }, headers) =>
      client.PATCH('/api/v1/finance/export-profile', {
        params: { header: { ...headers, 'if-match': requireIfMatch(headers) } },
        body: { profile: input.profile },
      }),
    invalidates: [EXPORT_PROFILE_KEY],
    version: (input) => input.version,
    messages: {
      version_conflict: 'Profil başka bir oturumda değişti. Sayfayı yenileyip yeniden deneyin.',
    },
  })
}

/** Cari ekstre (IST-107): tarih sıralı borç ve tahsilat satırları, yürüyen bakiye. */
export function useStudentStatement(studentId: string, options: { enabled?: boolean } = {}) {
  return useApiQuery({
    key: ['payments', 'student-statement', studentId],
    enabled: options.enabled ?? true,
    request: (client, signal) =>
      client.GET('/api/v1/finance/students/{studentId}/statement', {
        params: { path: { studentId } },
        signal,
      }),
  })
}

/** Dosyayı metin olarak alır; yazma değildir, sorgu tazelenmez. Hata mesajı toast olur. */
export function useFinanceExport() {
  return useApiCommand({
    request: (client, query: FinancePeriod & { kind: FinanceExportKind }) =>
      client.GET('/api/v1/finance/exports', { params: { query }, parseAs: 'text' }),
    invalidates: [],
  })
}

/** Aynı dosyanın Excel biçimi (ON-094): sunucuda üretilir, istemciye yalnız ikili gövde gelir. */
export function useFinanceWorkbookExport() {
  return useApiCommand({
    request: (client, query: FinancePeriod & { kind: FinanceExportKind }) =>
      client.GET('/api/v1/finance/exports', {
        params: { query: { ...query, format: 'xlsx' } },
        parseAs: 'blob',
      }),
    invalidates: [],
  })
}
