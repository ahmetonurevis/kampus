import { useEffect } from 'react'
import { useInfiniteQuery, useQueries, type InfiniteData } from '@tanstack/react-query'

import type { KampusClient } from '@kampus/api-client/client.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from './api-result.ts'
import { useKampusClient } from './kampus-context.ts'
import { institutionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
import { TASK_ASSIGNMENTS_KEY, type TaskAssignment } from './use-task-assignments.ts'
import {
  TASK_ATTEMPTS_KEY,
  type TaskAttempt,
  type TaskAttemptListQuery,
} from './use-task-attempts.ts'
import {
  TASK_SUBMISSIONS_KEY,
  type TaskSubmission,
  type TaskSubmissionListQuery,
} from './use-task-submissions.ts'

/**
 * Kursiyerin görev listesindeki satır başına ilerleme okuması (IST-051): atama görünümü kursiyerin
 * kendi durumunu taşımadığı için her atamanın denemeleri (otomatik puanlı) ya da teslimi (öğretmen
 * puanlı) okunur. Sorgu anahtarları `useTaskAttempts` ve `useTaskSubmissions` ile aynıdır: aynı
 * atamanın ayrıntı ekranı bu önbelleği paylaşır ve deneme/teslim yazmaları (`TASK_ATTEMPT_INVALIDATES`,
 * `TASK_SUBMISSION_INVALIDATES`) listeyi de tazeler. Kapsamı ve gizlemeyi sunucu uygular
 * (DOM-BEC-045): kursiyer yalnız kendi kaydını ve açılmış puanı görür.
 */

/** Bir atamanın bütün denemeleri ve teslimi tek sayfaya sığar (deneme hakkı ≤ 3, tek teslim). */
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

export interface ProgressTarget {
  id: string
  scoringMode: 'auto' | 'teacher'
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

/**
 * Satır başına sorgu seçenekleri (saf; kanca ve test aynısını kullanır). Anahtarlar kurumlu ve
 * `useTaskAttempts`/`useTaskSubmissions` ile aynıdır.
 */
export function learnerProgressQueries(
  client: KampusClient,
  institutionId: string | null,
  assignments: readonly ProgressTarget[],
) {
  const auto = assignments.filter((assignment) => assignment.scoringMode === 'auto')
  const written = assignments.filter((assignment) => assignment.scoringMode === 'teacher')
  return {
    auto,
    written,
    attemptQueries: auto.map((assignment) => {
      const query = learnerAttemptsQuery(assignment.id)
      return {
        queryKey: institutionKey(institutionId, TASK_ATTEMPTS_KEY, 'list', query),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          runRequest(() => client.GET('/api/v1/task-attempts', { params: { query }, signal })),
        enabled: institutionId !== null,
      }
    }),
    submissionQueries: written.map((assignment) => {
      const query = learnerSubmissionsQuery(assignment.id)
      return {
        queryKey: institutionKey(institutionId, TASK_SUBMISSIONS_KEY, 'list', query),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          runRequest(() => client.GET('/api/v1/task-submissions', { params: { query }, signal })),
        enabled: institutionId !== null,
      }
    }),
  }
}

export function useLearnerTaskProgress(assignments: readonly ProgressTarget[]) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const { auto, written, attemptQueries, submissionQueries } = learnerProgressQueries(
    client,
    institutionId,
    assignments,
  )
  const attemptResults = useQueries({ queries: attemptQueries })
  const submissionResults = useQueries({ queries: submissionQueries })

  const attempts = new Map<string, readonly TaskAttempt[]>()
  auto.forEach((assignment, index) => {
    const data = attemptResults[index]?.data?.data
    if (data) attempts.set(assignment.id, data)
  })
  const submissions = new Map<string, TaskSubmission | null>()
  written.forEach((assignment, index) => {
    const data = submissionResults[index]?.data?.data
    if (data) submissions.set(assignment.id, data[0] ?? null)
  })

  // Satır hatası satır bazındadır: bir atamanın okunamaması listenin geri kalanını gizlemez.
  const errors = new Map<string, ApiError>()
  auto.forEach((assignment, index) => {
    const failure = attemptResults[index]?.error
    if (failure) errors.set(assignment.id, failure as ApiError)
  })
  written.forEach((assignment, index) => {
    const failure = submissionResults[index]?.error
    if (failure) errors.set(assignment.id, failure as ApiError)
  })

  const all = [...attemptResults, ...submissionResults]
  // `runRequest` her hatayı ApiError'a çevirir; useQueries hata türünü bilmediği için daraltılır.
  const error = (all.find((result) => result.error)?.error ?? null) as ApiError | null
  return {
    attempts,
    submissions,
    /** Okunamayan satırlar (atama kimliği → hata). */
    errors,
    /** Okunmamış (yükleniyor) satır var; hata alan satır bu sayıya girmez. */
    isPending: all.some((result) => result.isPending && !result.error),
    error,
    refetch: () => {
      for (const result of all) if (result.error) void result.refetch()
    },
  } as const
}
