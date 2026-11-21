import { keepPreviousData, useQuery } from '@tanstack/react-query'

import type { ApiError } from '@kampus/api-client/errors.ts'

import { useKampusClient } from './kampus-context.ts'
import {
  fetchPracticeGradebook,
  PRACTICE_GRADEBOOK_KEY,
  type PracticeGradebook,
  type PracticeGradebookQuery,
} from './practice-gradebook.ts'
import { institutionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'

interface Options {
  enabled?: boolean
}

/**
 * Alıştırma not defteri (OG-085; IST-056, DOM-BEC-048): ünite, beceri ve kazanım kırılımı. Anahtar
 * etkin kurumu ve hedef süzgecini içerir; süzgeç değişirken önceki kırılım ekranda kalır.
 * `enabled: false` iken (ör. veli oturumu, sekme kapalı) istek atılmaz.
 */
export function usePracticeGradebook(query: PracticeGradebookQuery = {}, options: Options = {}) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery<PracticeGradebook, ApiError>({
    queryKey: institutionKey(institutionId, ...PRACTICE_GRADEBOOK_KEY, query),
    queryFn: async ({ signal }) => (await fetchPracticeGradebook(client, query, signal)).data,
    enabled: institutionId !== null && (options.enabled ?? true),
    placeholderData: keepPreviousData,
  })
}
