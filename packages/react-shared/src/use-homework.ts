import { keepPreviousData, useQuery } from '@tanstack/react-query'

import {
  archiveHomeworkCommand,
  createHomeworkCommand,
  fetchAllHomework,
  fetchHomeworkPage,
  getHomeworkRequest,
  gradeSubmissionCommand,
  homeworkItemKey,
  homeworkListKey,
  submitHomeworkCommand,
  updateHomeworkCommand,
  type HomeworkListQuery,
} from './homework.ts'
import { useKampusClient } from './kampus-context.ts'
import { institutionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Ödev kancaları (`/homework`, IST-095; DOM-AKD-070…074). `If-Match` ödevin ya da teslimin
// `version`'ı (`version` girdisi); `Idempotency-Key` kanca içinde yönetilir (`useApiCommand`).

interface Options {
  enabled?: boolean
}

/** Sayfalı ödev listesi (öğretmen ve yönetici); yeni sayfa gelene kadar önceki sayfa kalır. */
export function useHomeworkList(query: HomeworkListQuery, options: Options = {}) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, ...homeworkListKey(query)),
    queryFn: ({ signal }) => fetchHomeworkPage(client, query, signal),
    enabled: institutionId !== null && (options.enabled ?? true),
    placeholderData: keepPreviousData,
  })
}

/** Süzgece uyan bütün ödevler (öğrenci ve velinin sınıf listesi). */
export function useAllHomework(
  query: Omit<HomeworkListQuery, 'page' | 'pageSize'>,
  options: Options = {},
) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, ...homeworkListKey(query), 'all'),
    queryFn: ({ signal }) => fetchAllHomework(client, query, signal),
    enabled: institutionId !== null && (options.enabled ?? true),
  })
}

/** Tek ödev ve okuyanın görebildiği teslimleri (DOM-AKD-074). */
export function useHomework(homeworkId: string) {
  return useApiQuery({
    key: homeworkItemKey(homeworkId),
    request: (client, signal) => getHomeworkRequest(client, homeworkId, signal),
    enabled: homeworkId !== '',
  })
}

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}
const withSuccess = (options: CommandOptions) =>
  options.onSuccess ? { onSuccess: options.onSuccess } : {}

/** Ödev verir (`POST /homework`, 201; DOM-AKD-070). */
export function useCreateHomework(options: CommandOptions = {}) {
  return useApiCommand({ ...createHomeworkCommand, ...withSuccess(options) })
}

/** Ödevi düzenler (`PATCH /homework/:id`, `If-Match`; DOM-AKD-071). */
export function useUpdateHomework(options: CommandOptions = {}) {
  return useApiCommand({ ...updateHomeworkCommand, ...withSuccess(options) })
}

/** Ödevi arşivler (`DELETE /homework/:id`, `If-Match`); teslim almış ödev arşivlenmez. */
export function useArchiveHomework(options: CommandOptions = {}) {
  return useApiCommand({ ...archiveHomeworkCommand, ...withSuccess(options) })
}

/** Öğrenci ödevi teslim eder ya da teslimini yeniler (DOM-AKD-072). */
export function useSubmitHomework(options: CommandOptions = {}) {
  return useApiCommand({ ...submitHomeworkCommand, ...withSuccess(options) })
}

/** Ödevin öğretmeni teslimi puanlar ve geri bildirim yazar (`If-Match` teslimin; DOM-AKD-073). */
export function useGradeSubmission(options: CommandOptions = {}) {
  return useApiCommand({ ...gradeSubmissionCommand, ...withSuccess(options) })
}
