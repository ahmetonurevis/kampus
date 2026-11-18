import type { operations } from '@kampus/api-client/schema.d.ts'
import type { LessonConfirmationInput } from '@kampus/school-core/lib/finance-lesson-hour-approvals.ts'

import type { CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { PAYROLL_EXPORTS_KEY } from './use-finance-payroll-exports.ts'

// Ek ders çizelgesi onayı kancaları (`/finance/lesson-hour-sheets`; DOM-FIN-120, ON-196). Çizelge
// bordro aktarımı anahtarının altındadır: saat yazmaları çizelgeyi, çizelge geçişleri önizlemeyi
// ("onay bekliyor" satırları) tazeler. Bütün yazmalar `Idempotency-Key` taşır ve `exclusive`.

export type LessonHourSheet =
  operations['getLessonHourSheet']['responses'][200]['content']['application/json']['data']
export type LessonHourSheetStaff = LessonHourSheet['staff'][number]

const sheetKey = (month: string) => [...PAYROLL_EXPORTS_KEY, 'lesson-sheet', month] as const
const MESSAGES = {
  lesson_hours_changed: 'Ek ders saatleri değişti. Çizelge güncellendi; yeniden onaylayın.',
}

/** Ayın çizelgesi: durum, saat kayıtları ve personel teyitleri. */
export function useLessonHourSheet(month: string, enabled = true) {
  return useApiQuery({
    key: sheetKey(month),
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/lesson-hour-sheets/{month}', {
        params: { path: { month } },
        signal,
      }),
  })
}

export function useSubmitLessonHourSheet() {
  return useApiCommand({
    request: (client, input: { month: string }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/lesson-hour-sheets/{month}/submit', {
        params: { path: { month: input.month }, header: headers },
        body: {},
      }),
    invalidates: [PAYROLL_EXPORTS_KEY],
    exclusive: true,
  })
}

/** Öğretmenin teyidi ya da itirazı, öğretmen adına kanalıyla. */
export function useRecordLessonHourConfirmation() {
  return useApiCommand({
    request: (
      client,
      input: { month: string } & LessonConfirmationInput,
      headers: CommandHeaders,
    ) => {
      const { month, ...body } = input
      return client.POST('/api/v1/finance/lesson-hour-sheets/{month}/confirmations', {
        params: { path: { month }, header: headers },
        body,
      })
    },
    invalidates: [PAYROLL_EXPORTS_KEY],
    exclusive: true,
  })
}

/** Müdür onayı: çizelgede görülen damgayla. */
export function useApproveLessonHourSheet() {
  return useApiCommand({
    request: (client, input: { month: string; entriesHash: string }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/lesson-hour-sheets/{month}/approve', {
        params: { path: { month: input.month }, header: headers },
        body: { entriesHash: input.entriesHash },
      }),
    invalidates: [PAYROLL_EXPORTS_KEY],
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useReopenLessonHourSheet() {
  return useApiCommand({
    request: (client, input: { month: string; reason: string }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/lesson-hour-sheets/{month}/reopen', {
        params: { path: { month: input.month }, header: headers },
        body: { reason: input.reason },
      }),
    invalidates: [PAYROLL_EXPORTS_KEY],
    exclusive: true,
  })
}
