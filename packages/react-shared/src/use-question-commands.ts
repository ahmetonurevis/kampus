import type { KampusClient } from '@kampus/api-client/client.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'

import { collectionKeyPrefix } from './collections.ts'
import { requireIfMatch, type CommandHeaders, type CommandMessages } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'

// Öğretmenime Sor yazma komutları (`POST /questions`, `POST /questions/:id/answers`,
// `PATCH /questions/:id`; core `question.ask` `question.answer` `question.withdraw`,
// DOM-ILT-090…092). Okuma genel koleksiyon kancalarındadır (DOM-ILT-093).
// Soru gönderme ve yanıt `exclusive`: yollu `issues` (pasif öğrenci `subjectId`, kazanım `topic`,
// yanıt sınırı `text`) yalnız form alanında görünür, toast çıkmaz; yolsuz hata (ör. 403
// `question_teacher_reassigned`) tek toast olur. Geri çekme formsuzdur: hata tek toast.

type JsonBody<TOperation extends keyof operations> = NonNullable<
  operations[TOperation]['requestBody']
>['content']['application/json']

export type AskQuestionBody = JsonBody<'askQuestion'>
export type AnswerQuestionBody = JsonBody<'answerQuestion'>
export type WithdrawQuestionBody = JsonBody<'withdrawQuestion'>

/** Yanıt ve geri çekme: okunan sürüm `If-Match` olarak zorunludur. */
export interface AnswerQuestionInput {
  questionId: string
  version: number
  body: AnswerQuestionBody
}

export interface WithdrawQuestionInput {
  questionId: string
  version: number
}

/** Soru bu arada yanıtlandı veya geri çekildi (`If-Match` tutmadı): güncel hâli yüklenir. */
export const QUESTION_CHANGED_MESSAGE =
  'Soru bu arada güncellendi. Güncel hâlini yükleyip yeniden deneyin.'

export const QUESTION_MESSAGES = {
  version_conflict: QUESTION_CHANGED_MESSAGE,
} as const satisfies CommandMessages

const WITHDRAW_BODY: WithdrawQuestionBody = { withdrawn: true }

export function askQuestionRequest(
  client: KampusClient,
  body: AskQuestionBody,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/questions', {
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body,
  })
}

/** Yanıt ve geri çekme `If-Match` ister; okunan sürüm yoksa istek atılmaz (`requireIfMatch`). */
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function answerQuestionRequest(
  client: KampusClient,
  { questionId, body }: AnswerQuestionInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/questions/{questionId}/answers', {
    params: { path: { questionId }, header: versioned(headers) },
    body,
  })
}

export function withdrawQuestionRequest(
  client: KampusClient,
  { questionId }: WithdrawQuestionInput,
  headers: CommandHeaders,
) {
  return client.PATCH('/api/v1/questions/{questionId}', {
    params: { path: { questionId }, header: versioned(headers) },
    body: WITHDRAW_BODY,
  })
}

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}

const questions = [collectionKeyPrefix('questions')]

/** Öğrenci ders öğretmenine soru gönderir (201); sorular listesi tazelenir. */
export function useAskQuestion(options: CommandOptions = {}) {
  return useApiCommand({
    request: askQuestionRequest,
    invalidates: questions,
    messages: QUESTION_MESSAGES,
    exclusive: true,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

/** Atanmış öğretmen yanıt veya ek yanıt yazar (201); `If-Match` okunan sürümdür. */
export function useAnswerQuestion(options: CommandOptions = {}) {
  return useApiCommand({
    request: answerQuestionRequest,
    version: (input: AnswerQuestionInput) => input.version,
    invalidates: questions,
    messages: QUESTION_MESSAGES,
    exclusive: true,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

/** Öğrenci yanıtlanmamış sorusunu geri çeker (200); `If-Match` okunan sürümdür. */
export function useWithdrawQuestion(options: CommandOptions = {}) {
  return useApiCommand({
    request: withdrawQuestionRequest,
    version: (input: WithdrawQuestionInput) => input.version,
    invalidates: questions,
    messages: QUESTION_MESSAGES,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}
