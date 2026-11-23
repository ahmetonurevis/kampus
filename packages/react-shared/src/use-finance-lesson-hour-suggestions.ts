import type { operations } from '@kampus/api-client/schema.d.ts'
import type { LessonSuggestionParams } from '@kampus/school-core/lib/finance-lesson-hour-suggestions.ts'

import type { CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { PAYROLL_EXPORTS_KEY } from './use-finance-payroll-exports.ts'

// Programdan ek ders önerisi kancaları (`/finance/lesson-hour-suggestions`; DOM-FIN-165, ON-195).
// Öneri bordro aktarımı anahtarının altındadır: elle saat yazmaları ve çizelge geçişleri öneriyi
// (fark ve aktarılabilirlik) tazeler; aktarım önizlemeyi ve çizelgeyi tazeler. Aktarım
// `Idempotency-Key` taşır ve `exclusive`.

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type LessonHourSuggestions =
  operations['getLessonHourSuggestions']['responses'][200]['content']['application/json']['data']
export type LessonHourSuggestionTeacher = LessonHourSuggestions['teachers'][number]
export type LessonHourSuggestionDetail =
  operations['getLessonHourSuggestionDetail']['responses'][200]['content']['application/json']['data']
export type LessonHourSuggestionItem = LessonHourSuggestionDetail['days'][number]['items'][number]
export type TransferLessonHourSuggestionsBody = JsonBody<'transferLessonHourSuggestions'>

const suggestionKey = (month: string, params: LessonSuggestionParams) =>
  [...PAYROLL_EXPORTS_KEY, 'lesson-suggestions', month, params] as const

const MESSAGES = {
  lesson_suggestion_changed:
    'Programdan hesaplanan öneri değişti. Öneri güncellendi; yeniden aktarın.',
}

/** Ayın önerisi: öğretmen başına özet, haftalar, elle girişle fark. */
export function useLessonHourSuggestions(
  month: string,
  params: LessonSuggestionParams,
  enabled = true,
) {
  return useApiQuery({
    key: suggestionKey(month, params),
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/lesson-hour-suggestions/{month}', {
        params: { path: { month }, query: params },
        signal,
      }),
  })
}

/** Öğretmenin gün dökümü. */
export function useLessonHourSuggestionDetail(
  month: string,
  membershipId: string,
  params: LessonSuggestionParams,
  enabled = true,
) {
  return useApiQuery({
    key: [...suggestionKey(month, params), 'teacher', membershipId],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/lesson-hour-suggestions/{month}/teachers/{membershipId}', {
        params: { path: { month, membershipId }, query: params },
        signal,
      }),
  })
}

/** Öneriyi (ya da gerekçeli düzeltmesini) elle ek ders girişine aktarır; tek ya da toplu. */
export function useTransferLessonHourSuggestions() {
  return useApiCommand({
    request: (
      client,
      input: { month: string; body: TransferLessonHourSuggestionsBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/lesson-hour-suggestions/{month}/transfers', {
        params: {
          path: { month: input.month },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [PAYROLL_EXPORTS_KEY],
    messages: MESSAGES,
    exclusive: true,
  })
}
