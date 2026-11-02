import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { useKampusClient } from './kampus-context.ts'
import {
  cancelLessonCommand,
  createLessonCommand,
  fetchAllLessons,
  fetchLessonPage,
  getLessonRequest,
  lessonItemKey,
  lessonListKey,
  substituteLessonCommand,
  updateLessonCommand,
  type LessonListQuery,
} from './lessons.ts'
import { institutionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Ders programı kancaları (`/lessons`, IST-094; DOM-YTK-068, DOM-YTK-069). `If-Match` dersin
// `version`'ı (`version` girdisi); `Idempotency-Key` kanca içinde yönetilir (`useApiCommand`).

interface Options {
  enabled?: boolean
}

/** Sayfalı ders listesi (liste görünümü); yeni sayfa gelene kadar önceki sayfa ekranda kalır. */
export function useLessonList(query: LessonListQuery, options: Options = {}) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, ...lessonListKey(query)),
    queryFn: ({ signal }) => fetchLessonPage(client, query, signal),
    enabled: institutionId !== null && (options.enabled ?? true),
    placeholderData: keepPreviousData,
  })
}

/** Süzgece uyan bütün dersler (haftalık ve günlük görünüm; aralık kısa tutulur). */
export function useLessonsInRange(
  query: Omit<LessonListQuery, 'page' | 'pageSize'>,
  options: Options = {},
) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, ...lessonListKey(query), 'all'),
    queryFn: ({ signal }) => fetchAllLessons(client, query, signal),
    enabled: institutionId !== null && (options.enabled ?? true),
  })
}

/** Süzgece uyan bütün dersleri çeken işlev (CSV); önbelleğe yazmaz. */
export function useLessonsFetchAll() {
  const client = useKampusClient()
  return (query: Omit<LessonListQuery, 'page' | 'pageSize'>) => fetchAllLessons(client, query)
}

/** Tek ders (panel ve formlar); liste satırından değil tek kayıt ucundan okunur. */
export function useLesson(lessonId: string) {
  return useApiQuery({
    key: lessonItemKey(lessonId),
    request: (client, signal) => getLessonRequest(client, lessonId, signal),
    enabled: lessonId !== '',
  })
}

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}
const withSuccess = (options: CommandOptions) =>
  options.onSuccess ? { onSuccess: options.onSuccess } : {}

/** Ders planlar (`POST /lessons`, 201). */
export function useCreateLesson(options: CommandOptions = {}) {
  return useApiCommand({ ...createLessonCommand, ...withSuccess(options) })
}

/** Dersi değiştirir (`PATCH /lessons/:id`, `If-Match`). */
export function useUpdateLesson(options: CommandOptions = {}) {
  return useApiCommand({ ...updateLessonCommand, ...withSuccess(options) })
}

/** Derse gerekçeyle yedek öğretmen atar (DOM-YTK-069). */
export function useSubstituteLesson(options: CommandOptions = {}) {
  return useApiCommand({ ...substituteLessonCommand, ...withSuccess(options) })
}

/** Dersi gerekçeyle iptal eder; kayıt silinmez, günlük programdan çıkar. */
export function useCancelLesson(options: CommandOptions = {}) {
  return useApiCommand({ ...cancelLessonCommand, ...withSuccess(options) })
}
