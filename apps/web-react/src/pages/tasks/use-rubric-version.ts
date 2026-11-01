import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { runRequest } from '@kampus/react-shared/api-result.ts'
import { useKampusClient } from '@kampus/react-shared/kampus-context.ts'
import { institutionKey } from '@kampus/react-shared/query-keys.ts'
import { useActiveInstitutionId } from '@kampus/react-shared/use-active-institution.ts'
import { RUBRICS_KEY, useRubrics, type RubricVersion } from '@kampus/react-shared/use-rubrics.ts'

/**
 * Atamanın sabitlediği rubrik sürümünü (kriterler ve bantlar) bulur. Atama yanıtı yalnız
 * `rubricVersionId` taşır, rubrik kimliği taşımaz; bu yüzden önce rubrik listesinde baş ya da
 * yayındaki sürümle eşleşme aranır (ortak durum), bulunamazsa (sürüm sonradan arşivlendi) rubrik
 * ayrıntıları okunup sürüm orada aranır.
 * TODO(W22b-api-rubrik-kimligi): Atama yanıtına `rubricId` eklenince tek ayrıntı çağrısı yeter;
 * 100'den çok rubrikte yalnız ilk 100'ü taranır.
 */
export function useRubricVersion(rubricVersionId: string | null) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const enabled = rubricVersionId !== null
  const list = useRubrics({ page: 1, pageSize: 100 })
  const items = list.data?.data
  const direct = items?.find(
    (item) => item.head.id === rubricVersionId || item.publishedVersionId === rubricVersionId,
  )
  // Baş sürüm ya da yayındaki sürüm eşleşmezse bütün rubriklerin sürümleri taranır.
  const candidates = enabled && items && !direct ? items : []
  const details = useQueries({
    queries: [direct, ...candidates].flatMap((item) =>
      item
        ? [
            {
              queryKey: institutionKey(institutionId, RUBRICS_KEY, 'detail', item.rubric.id),
              queryFn: ({ signal }: { signal: AbortSignal }) =>
                runRequest(() =>
                  client.GET('/api/v1/rubrics/{rubricId}', {
                    params: { path: { rubricId: item.rubric.id } },
                    signal,
                  }),
                ),
              enabled: institutionId !== null,
            },
          ]
        : [],
    ),
  })
  const version = useMemo<RubricVersion | null>(() => {
    for (const detail of details) {
      const found = detail.data?.data.versions.find((item) => item.id === rubricVersionId)
      if (found) return found
    }
    return null
  }, [details, rubricVersionId])
  const loading =
    enabled && version === null && (list.isPending || details.some((item) => item.isPending))
  return {
    version,
    loading,
    error: list.error ?? details.find((item) => item.error)?.error ?? null,
  }
}
