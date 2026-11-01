import { useQuery, useQueryClient } from '@tanstack/react-query'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { RUBRICS_KEY } from '@kampus/react-shared/use-rubrics.ts'
import {
  findRubricVersion,
  RUBRIC_LOOKUP_PAGE_SIZE,
  shouldLookUpRubric,
  type RubricLookupSource,
} from './rubric-version-lookup.ts'

/** Yayımlanmış ya da kullanılmış sürüm değişmez (DOM-BEC-022); bulunan sürüm uzun süre taze kalır. */
const LOOKUP_STALE_MS = 5 * 60_000

/**
 * Atamanın sabitlediği rubrik sürümünü (kriterler ve bantlar) bulur; `rubricVersionId` boşken
 * (atama yüklenmedi ya da otomatik puanlı görev) hiçbir istek atılmaz. Tarama sırayla yapılır ve
 * bulununca durur (`findRubricVersion`); liste ve ayrıntılar önbelleği paylaşır, aynı sürüm tekrar
 * açıldığında istek atılmaz.
 */
export function useRubricVersion(rubricVersionId: string | null) {
  const client = useKampusClient()
  const queryClient = useQueryClient()
  const institutionId = useActiveInstitutionId()
  const enabled = shouldLookUpRubric(rubricVersionId, institutionId)
  const query = useQuery({
    queryKey: institutionKey(institutionId, RUBRICS_KEY, 'version-lookup', rubricVersionId),
    enabled,
    staleTime: LOOKUP_STALE_MS,
    queryFn: ({ signal }) => {
      const source: RubricLookupSource = {
        listPage: (page) =>
          queryClient.fetchQuery({
            staleTime: LOOKUP_STALE_MS,
            queryKey: institutionKey(institutionId, RUBRICS_KEY, 'list', {
              page,
              pageSize: RUBRIC_LOOKUP_PAGE_SIZE,
            }),
            queryFn: () =>
              runRequest(() =>
                client.GET('/api/v1/rubrics', {
                  params: { query: { page, pageSize: RUBRIC_LOOKUP_PAGE_SIZE } },
                  signal,
                }),
              ),
          }),
        // Önbellek girdisi `useRubricDetail` ile aynı biçimdedir (`{ data }` zarfı).
        detail: async (rubricId) => {
          const result = await queryClient.fetchQuery({
            queryKey: institutionKey(institutionId, RUBRICS_KEY, 'detail', rubricId),
            staleTime: LOOKUP_STALE_MS,
            queryFn: () =>
              runRequest(() =>
                client.GET('/api/v1/rubrics/{rubricId}', {
                  params: { path: { rubricId } },
                  signal,
                }),
              ),
          })
          return result.data
        },
      }
      return findRubricVersion(rubricVersionId ?? '', source)
    },
  })
  return {
    version: query.data ?? null,
    loading: enabled && query.isPending,
    error: query.error,
  }
}
