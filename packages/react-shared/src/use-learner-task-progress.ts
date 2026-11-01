import { useEffect } from 'react'
import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'

import type { ApiError } from '@kampus/api-client/errors.ts'
import type { components } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'
import { useKampusClient } from './kampus-context.ts'
import { institutionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
import { TASK_ASSIGNMENTS_KEY, type TaskAssignment } from './use-task-assignments.ts'
import type { TaskAttemptListQuery } from './use-task-attempts.ts'
import type { TaskSubmissionListQuery } from './use-task-submissions.ts'

/**
 * Kursiyerin görev listesi (IST-051): atama listesi kursiyer görünümünde her hedeflenen kişinin
 * durum özetini (`progress`: hak, son deneme/teslim, yeni deneme/sürüm hakkı, açılmış puan) taşır;
 * satır başına deneme/teslim isteği atılmaz. Deneme ve teslim yazmaları (`TASK_ATTEMPT_INVALIDATES`,
 * `TASK_SUBMISSION_INVALIDATES`) atama anahtarını da tazeler. Kapsamı ve gizlemeyi sunucu uygular
 * (DOM-BEC-045): kursiyer yalnız kendi kaydını ve açılmış puanı görür.
 */

export type LearnerTaskProgress = components['schemas']['TaskAssignmentLearnerProgress']

/** Çalışma alanında bir atamanın bütün denemeleri ve teslimi tek sayfaya sığar (hak ≤ 3, tek teslim). */
export const LEARNER_PROGRESS_PAGE_SIZE = 100

/** Atama listesi sayfa boyutu ve en çok kaç sayfa okunacağı (üst sınır aşılırsa liste kesilmiş sayılır). */
export const LEARNER_ASSIGNMENT_PAGE_SIZE = 100
export const LEARNER_ASSIGNMENT_MAX_PAGES = 10

export interface AssignmentPage {
  data: TaskAssignment[]
  meta: { total: number }
}

/**
 * Sonraki atama sayfası; yoksa `undefined`. Yüklenen kayıt toplama ulaştıysa, son sayfa boşsa
 * (sunucuda kayıt azalmış olabilir; sonsuz istek atılmaz) ya da sayfa üst sınırına varıldıysa durur.
 */
export function nextAssignmentPage(
  pages: readonly AssignmentPage[],
  maxPages: number = LEARNER_ASSIGNMENT_MAX_PAGES,
): number | undefined {
  const last = pages.at(-1)
  if (!last || last.data.length === 0 || pages.length >= maxPages) return undefined
  const loaded = pages.reduce((sum, page) => sum + page.data.length, 0)
  return loaded < last.meta.total ? pages.length + 1 : undefined
}

/** Liste kesildi mi: toplam, yüklenen kayıttan çok ve okunacak sayfa kalmadı. */
export function assignmentListTruncated(pages: readonly AssignmentPage[] | undefined): boolean {
  if (!pages || pages.length === 0) return false
  const loaded = pages.reduce((sum, page) => sum + page.data.length, 0)
  return nextAssignmentPage(pages) === undefined && loaded < (pages.at(-1)?.meta.total ?? 0)
}

/**
 * Kursiyerin atamaları: sayfalar sırayla, kendiliğinden çekilir (tek sayfaya sığmayan yıl boyu
 * görevler kaybolmaz). Anahtar `TASK_ASSIGNMENTS_KEY` altındadır; atama yazmaları listeyi tazeler.
 * `truncated` doğruysa üst sayfa sınırı aşıldı ve bazı atamalar gösterilemiyor.
 */
export function useLearnerAssignments() {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const query = useInfiniteQuery<
    AssignmentPage,
    ApiError,
    InfiniteData<AssignmentPage, number>,
    readonly unknown[],
    number
  >({
    queryKey: institutionKey(institutionId, TASK_ASSIGNMENTS_KEY, 'learner-all'),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      runRequest(() =>
        client.GET('/api/v1/task-assignments', {
          params: { query: { page: pageParam, pageSize: LEARNER_ASSIGNMENT_PAGE_SIZE } },
          signal,
        }),
      ),
    getNextPageParam: (_last, pages) => nextAssignmentPage(pages),
    enabled: institutionId !== null,
  })
  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = query
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isError) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, isError, fetchNextPage])

  const pages = query.data?.pages
  const seen = new Set<string>()
  const items: TaskAssignment[] = []
  for (const page of pages ?? [])
    for (const item of page.data)
      if (!seen.has(item.id)) {
        seen.add(item.id)
        items.push(item)
      }
  return {
    items,
    /** İlk sayfa geldi; sonrakiler arka planda sürebilir. */
    isReady: pages !== undefined,
    /** Sonraki sayfalar hâlâ çekiliyor. */
    isLoadingMore: hasNextPage || isFetchingNextPage,
    // Sonraki sayfa okunamadıysa liste de eksiktir.
    truncated: assignmentListTruncated(pages) || (pages !== undefined && query.isError),
    error: query.error,
    refetch: query.refetch,
  } as const
}

/** Atamanın denemeleri; `useTaskAttempts` ile aynı sorgu (önbellek paylaşımı için). */
export const learnerAttemptsQuery = (assignmentId: string): TaskAttemptListQuery => ({
  assignmentId,
  pageSize: LEARNER_PROGRESS_PAGE_SIZE,
})

/** Atamanın teslimi (kursiyer için en çok bir kayıt); `useTaskSubmissions` ile aynı sorgu. */
export const learnerSubmissionsQuery = (assignmentId: string): TaskSubmissionListQuery => ({
  assignmentId,
  pageSize: LEARNER_PROGRESS_PAGE_SIZE,
})
