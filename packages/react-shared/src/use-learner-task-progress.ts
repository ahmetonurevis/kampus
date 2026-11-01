import { useQueries } from '@tanstack/react-query'

import type { KampusClient } from '@kampus/api-client/client.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from './api-result.ts'
import { useKampusClient } from './kampus-context.ts'
import { institutionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
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

  const all = [...attemptResults, ...submissionResults]
  // `runRequest` her hatayı ApiError'a çevirir; useQueries hata türünü bilmediği için daraltılır.
  const error = (all.find((result) => result.error)?.error ?? null) as ApiError | null
  return {
    attempts,
    submissions,
    /** Okunmamış (yükleniyor) satır var; hata alan satır bu sayıya girmez. */
    isPending: all.some((result) => result.isPending && !result.error),
    error,
    refetch: () => {
      for (const result of all) if (result.error) void result.refetch()
    },
  } as const
}
