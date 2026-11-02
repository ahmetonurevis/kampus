import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { useKampusClient } from './kampus-context.ts'
import { institutionKey } from './query-keys.ts'
import {
  archiveQuizCommand,
  createQuizCommand,
  fetchAllQuizzes,
  fetchQuizPage,
  getQuizRequest,
  quizItemKey,
  quizListKey,
  startQuizCommand,
  submitQuizCommand,
  updateQuizCommand,
  type QuizListQuery,
} from './quizzes.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Quiz kancaları (`/quizzes`, IST-095; DOM-AKD-075…079). `If-Match` quizin `version`'ı
// (`version` girdisi); `Idempotency-Key` kanca içinde yönetilir (`useApiCommand`).

interface Options {
  enabled?: boolean
}

/** Sayfalı quiz listesi (öğretmen ve yönetici); yeni sayfa gelene kadar önceki sayfa kalır. */
export function useQuizList(query: QuizListQuery, options: Options = {}) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, ...quizListKey(query)),
    queryFn: ({ signal }) => fetchQuizPage(client, query, signal),
    enabled: institutionId !== null && (options.enabled ?? true),
    placeholderData: keepPreviousData,
  })
}

/** Süzgece uyan bütün quizler (öğrenci ve velinin sınıf listesi). */
export function useAllQuizzes(
  query: Omit<QuizListQuery, 'page' | 'pageSize'>,
  options: Options = {},
) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, ...quizListKey(query), 'all'),
    queryFn: ({ signal }) => fetchAllQuizzes(client, query, signal),
    enabled: institutionId !== null && (options.enabled ?? true),
  })
}

/**
 * Tek quiz: personelde anahtar, denemeler ve özet; öğrenci ve velide kendi/çocuğunun denemesi ve
 * (deneme başlayınca ya da sonuçlanınca) anahtarsız sorular (DOM-AKD-078).
 */
export function useQuiz(quizId: string, options: Options = {}) {
  return useApiQuery({
    key: quizItemKey(quizId),
    request: (client, signal) => getQuizRequest(client, quizId, signal),
    enabled: quizId !== '' && (options.enabled ?? true),
  })
}

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}
const withSuccess = (options: CommandOptions) =>
  options.onSuccess ? { onSuccess: options.onSuccess } : {}

/** Soru bankasından quiz hazırlar (`POST /quizzes`, 201; DOM-AKD-075). */
export function useCreateQuiz(options: CommandOptions = {}) {
  return useApiCommand({ ...createQuizCommand, ...withSuccess(options) })
}

/** Quizi düzenler (`PATCH /quizzes/:id`, `If-Match`; DOM-AKD-076). */
export function useUpdateQuiz(options: CommandOptions = {}) {
  return useApiCommand({ ...updateQuizCommand, ...withSuccess(options) })
}

/** Quizi arşivler (`DELETE /quizzes/:id`, `If-Match`); denemesi olan quiz arşivlenmez. */
export function useArchiveQuiz(options: CommandOptions = {}) {
  return useApiCommand({ ...archiveQuizCommand, ...withSuccess(options) })
}

/** Öğrenci denemesini başlatır; süresi işleyen deneme varsa aynısı döner (DOM-AKD-077). */
export function useStartQuiz(options: CommandOptions = {}) {
  return useApiCommand({ ...startQuizCommand, ...withSuccess(options) })
}

/** Öğrenci cevaplarını gönderir; puan sunucuda hesaplanır (DOM-AKD-077, -078). */
export function useSubmitQuiz(options: CommandOptions = {}) {
  return useApiCommand({ ...submitQuizCommand, ...withSuccess(options) })
}
