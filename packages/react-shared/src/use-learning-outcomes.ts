import { keepPreviousData, useQuery } from '@tanstack/react-query'

import type { operations } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'
import { useKampusClient } from './kampus-context.ts'
import { institutionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'

/**
 * Kazanım kataloğu (`GET /api/v1/learning-outcomes`; DOM-KYN-011): öğretim programı ve kurum
 * kazanımları birleşik, sunucu sayfalı. İçerik ve soru formunun kazanım seçicisi kullanır; arşivli
 * kod sunucuda listeden düşer.
 */

export const LEARNING_OUTCOMES_KEY = 'learning-outcomes'

export type LearningOutcomeListQuery = NonNullable<
  operations['listLearningOutcomes']['parameters']['query']
>
export type LearningOutcomeRow =
  operations['listLearningOutcomes']['responses']['200']['content']['application/json']['data'][number]

export function useLearningOutcomeList(
  query: LearningOutcomeListQuery,
  options: { enabled?: boolean } = {},
) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, LEARNING_OUTCOMES_KEY, 'list', query),
    queryFn: ({ signal }) =>
      runRequest(() => client.GET('/api/v1/learning-outcomes', { params: { query }, signal })),
    enabled: institutionId !== null && (options.enabled ?? true),
    placeholderData: keepPreviousData,
  })
}
