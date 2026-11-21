import type { KampusClient } from '@kampus/api-client/client.ts'
import type { components, operations } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'

/**
 * Alıştırma not defteri ucunun (`GET /practice-gradebook`; OG-085, IST-056, DOM-BEC-048) saf
 * yardımcıları. Kanca `use-practice-gradebook.ts`'tedir. Kapsamı sunucu uygular: yönetici bütün
 * atamaları, öğretmen gördüğü atamaları, öğrenci yalnız kendi sonucunu görür; veli 403
 * (DOM-BEC-041). Kırılım her okumada hesaplanır; değerlendirme notlarından ayrıdır.
 */

export type PracticeGradebook = components['schemas']['PracticeGradebook']
export type PracticeGradebookLearner = PracticeGradebook['learners'][number]
export type PracticeGradebookBreakdown = PracticeGradebook['totals']
export type PracticeGradebookQuery = NonNullable<
  operations['getPracticeGradebook']['parameters']['query']
>

/** Sorgu anahtarının kökü (etkin kurumla `institutionKey` içinde kullanılır). */
export const PRACTICE_GRADEBOOK_KEY = ['practice-gradebook'] as const

export function fetchPracticeGradebook(
  client: KampusClient,
  query: PracticeGradebookQuery = {},
  signal?: AbortSignal,
) {
  return runRequest(() =>
    client.GET('/api/v1/practice-gradebook', {
      params: { query },
      ...(signal ? { signal } : {}),
    }),
  )
}
