import { useQuery } from '@tanstack/react-query'

import {
  activateCourseCommand,
  archiveCourseCommand,
  COURSES_KEY,
  createCourseCommand,
  fetchActiveCourses,
  fetchAllCourses,
  recordCourseEOzelCommand,
  updateCourseCommand,
} from './courses.ts'
import { useKampusClient } from './kampus-context.ts'
import { institutionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Dil okulu kur kancaları (`/courses`, IST-076; DOM-DIL-005…007). `If-Match` kurun `rowVersion`'ı
// (`version` girdisi); `Idempotency-Key` kanca içinde yönetilir (`useApiCommand`).

interface Options {
  enabled?: boolean
}

/** Kurumun bütün kurları, arşiv dahil (kur listesi; arama ve süzgeç istemcide). */
export function useAllCourses(options: Options = {}) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, ...COURSES_KEY, 'all'),
    queryFn: ({ signal }) => fetchAllCourses(client, signal),
    enabled: institutionId !== null && (options.enabled ?? true),
  })
}

/** Etkin kurlar: grup formunda kur seçimi ve grup listesinin kur süzgeci. */
export function useActiveCourses(options: Options = {}) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, ...COURSES_KEY, 'active'),
    queryFn: ({ signal }) => fetchActiveCourses(client, signal),
    enabled: institutionId !== null && (options.enabled ?? true),
  })
}

/** Tek kur (panel ve düzenleme formu); liste satırından değil tek kayıt ucundan okunur. */
export function useCourse(courseId: string) {
  return useApiQuery({
    key: [...COURSES_KEY, 'item', courseId],
    request: (client, signal) =>
      client.GET('/api/v1/courses/{courseId}', { params: { path: { courseId } }, signal }),
    enabled: courseId !== '',
  })
}

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}
const withSuccess = (options: CommandOptions) =>
  options.onSuccess ? { onSuccess: options.onSuccess } : {}

/** Taslak kur oluşturur (`POST /courses`, 201). */
export function useCreateCourse(options: CommandOptions = {}) {
  return useApiCommand({ ...createCourseCommand, ...withSuccess(options) })
}

/** Kuru değiştirir (`PATCH /courses/:id`, `If-Match`). */
export function useUpdateCourse(options: CommandOptions = {}) {
  return useApiCommand({ ...updateCourseCommand, ...withSuccess(options) })
}

/** Taslak kuru etkinleştirir; belgeli kur e-Özel onayı ister (DOM-DIL-006). */
export function useActivateCourse(options: CommandOptions = {}) {
  return useApiCommand({ ...activateCourseCommand, ...withSuccess(options) })
}

/** Kuru arşivler (`DELETE /courses/:id`); geri alınmaz. */
export function useArchiveCourse(options: CommandOptions = {}) {
  return useApiCommand({ ...archiveCourseCommand, ...withSuccess(options) })
}

/** e-Özel program kodu ve onay durumunu işaretler (yalnız yönetici). */
export function useRecordCourseEOzel(options: CommandOptions = {}) {
  return useApiCommand({ ...recordCourseEOzelCommand, ...withSuccess(options) })
}
