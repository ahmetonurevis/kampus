import type { KampusClient } from '@kampus/api-client/client.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { components, operations } from '@kampus/api-client/schema.d.ts'
import { QUIZ_SUBMIT_GRACE_SECONDS } from '@kampus/school-core/lib/quiz.ts'

import { runRequest } from './api-result.ts'
import { collectionKeyPrefix } from './collections.ts'
import {
  keepsIdempotencyKey,
  requireIfMatch,
  type CommandHeaders,
  type CommandMessages,
} from './commands.ts'
import { fetchAllPages, type ListPage } from './institution-lists.ts'

/**
 * Quiz uçlarının (`/quizzes`, IST-095; DOM-AKD-075…079) saf yardımcıları: istek kurucular,
 * Türkçe hata metinleri, hata → form alanı eşlemesi, sorgu anahtarı ve deneme süresi hesabı.
 * Kancalar `use-quizzes.ts`'tedir; burası React olmadan sahte istemciyle sınanır. Her yazma
 * `Idempotency-Key` taşır (`useApiCommand`); düzenleme ve arşiv quizin okunan `version`'ını
 * `If-Match` olarak gönderir, sürüm yoksa istek atılmaz (`requireIfMatch`). Başlatma ve gönderim
 * öğrencinin işlemidir, `If-Match` taşımaz. Puan istemcide hesaplanmaz; sunucunun sonucu
 * (`attempts[].result`) gösterilir (DOM-AKD-078).
 */

export type Quiz = components['schemas']['Quiz']
export type QuizListItem = components['schemas']['QuizListItem']
export type QuizStaffDetail = components['schemas']['QuizStaffDetail']
export type QuizPersonalDetail = components['schemas']['QuizPersonalDetail']
export type QuizDetail = QuizStaffDetail | QuizPersonalDetail
export type QuizAttempt = components['schemas']['QuizAttempt']
export type QuizResult = components['schemas']['QuizResult']
export type QuizQuestion = components['schemas']['QuizQuestion']
export type QuizStatistics = components['schemas']['QuizStatistics']
export type QuizStart = components['schemas']['QuizStart']
export type QuizListQuery = NonNullable<operations['listQuizzes']['parameters']['query']>
export type QuizStatusFilter = NonNullable<QuizListQuery['status']>

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type CreateQuizBody = JsonBody<'createQuiz'>
export type UpdateQuizBody = JsonBody<'updateQuiz'>
export type SubmitQuizBody = JsonBody<'submitQuiz'>

/** Sorgu anahtarının kökü (etkin kurum kendiliğinden eklenir); yazma sonrası bu önek tazelenir. */
export const QUIZ_KEY = ['quizzes'] as const

/**
 * Quiz yazmaları genel koleksiyon okumalarını da etkiler (`quizzes`, `quizAttempts`: dashboard
 * kartları, analiz ekranları); üçü birlikte tazelenir.
 */
export const QUIZ_INVALIDATES = [
  QUIZ_KEY,
  collectionKeyPrefix('quizzes'),
  collectionKeyPrefix('quizAttempts'),
] as const

export const QUIZ_CHANGED_MESSAGE =
  'Quiz bu arada değişti. Güncel hâli yüklendi; kontrol edip yeniden deneyin.'
export const QUIZ_TIME_EXPIRED_MESSAGE =
  'Quizin süresi doldu; cevapların kaydedilmedi. Sonucun süre dolduğunda kayıtlı olan hâliyle hesaplandı.'
export const QUIZ_ALREADY_SUBMITTED_MESSAGE = 'Bu quizin cevapları zaten gönderildi.'

/** Koda özgü Türkçe metinler (DOM-AKD-075…079); listede olmayan kodda sunucunun mesajı görünür. */
export const QUIZ_MESSAGES = {
  version_conflict: QUIZ_CHANGED_MESSAGE,
  not_found: 'Quiz bulunamadı. Liste güncellendi.',
  quiz_due_in_past: 'Son tarih geçmişte olamaz. İleri bir tarih ve saat seçin.',
  quiz_subject_required: 'Bu sınıfa birden çok dersle giriyorsunuz; quizin dersini seçin.',
  quiz_teacher_unavailable:
    'Bu sınıfın bu dersine atanmış etkin öğretmen yok. Önce ders atamasını yapın.',
  quiz_scope_denied: 'Bu sınıfa ve derse quiz hazırlayamazsınız; yalnız derse girdiğiniz sınıflar.',
  quiz_not_owner: 'Bu quizin öğretmeni değilsiniz; quizi yalnız öğretmeni değiştirir.',
  quiz_has_attempts:
    'Çözülmeye başlanmış quizin soruları değiştirilemez ve quiz arşivlenemez; öğrencilerin sonuçları korunur.',
  record_inactive: 'Seçilen sınıf etkin değil. Etkin bir sınıf seçin.',
  quiz_question_unavailable:
    'Seçilen sorulardan biri soru bankasında yok. Soru listesini yenileyip yeniden seçin.',
  quiz_question_mismatch: 'Sorular quizin dersine ve sınıfın düzeyine uygun olmalı.',
  quiz_closed: 'Bu quizin son tarihi geçti; quiz artık başlatılamaz.',
  quiz_already_attempted: 'Bu quizi zaten çözdün; her quiz bir kez çözülür.',
  quiz_already_submitted: QUIZ_ALREADY_SUBMITTED_MESSAGE,
  quiz_time_expired: QUIZ_TIME_EXPIRED_MESSAGE,
  quiz_not_started: 'Önce quizi başlat.',
  quiz_answer_invalid: 'Cevaplar bu quizin sorularıyla uyuşmuyor. Sayfayı yenileyip yeniden dene.',
  student_inactive: 'Kaydın pasif olduğu için quiz çözülemez.',
} as const satisfies CommandMessages

/** Formun türü: alan eşlemesi yalnız o formda bulunan alana yapılır, gerisi toast'tur. */
export type QuizFormKind = 'quiz' | 'solve'

/** Alana bağlanamayan, formun kendi içinde gösterilen hata yeri. */
export const QUIZ_FORM_ROOT = 'root.server'

const FORM_FIELDS = {
  quiz: ['classId', 'subjectId', 'title', 'duration', 'dueDate', 'questionIds', QUIZ_FORM_ROOT],
  solve: ['answers', QUIZ_FORM_ROOT],
} as const satisfies Record<QuizFormKind, readonly string[]>

/** Hata kodunun bağlandığı form alanı (mesaj yalnız o alanın altında görünür). */
export const QUIZ_ERROR_FIELDS = {
  quiz_due_in_past: 'dueDate',
  quiz_subject_required: 'subjectId',
  quiz_teacher_unavailable: 'subjectId',
  record_inactive: 'classId',
  quiz_question_unavailable: 'questionIds',
  quiz_question_mismatch: 'questionIds',
  // Quiz artık bu işleme kapalı: açık formun içinde, formu kapatmadan gösterilir.
  quiz_has_attempts: QUIZ_FORM_ROOT,
  quiz_time_expired: QUIZ_FORM_ROOT,
  quiz_already_submitted: QUIZ_FORM_ROOT,
  quiz_not_started: QUIZ_FORM_ROOT,
  quiz_answer_invalid: QUIZ_FORM_ROOT,
} as const satisfies Readonly<Record<string, string>>

const isMappedCode = (code: string): code is keyof typeof QUIZ_ERROR_FIELDS =>
  Object.hasOwn(QUIZ_ERROR_FIELDS, code)

/**
 * Hatanın formdaki alanı: önce kod eşlemesi, yoksa sunucunun yollu ilk maddesi
 * (`questionIds.2` → `questionIds`); alan o formda yoksa `undefined` (toast). Yetki ve bulunamadı
 * hataları alana bağlanmaz.
 */
export function quizErrorField(error: ApiError, form: QuizFormKind): string | undefined {
  if (error.status === 401 || error.status === 403 || error.status === 404) return undefined
  const fields: readonly string[] = FORM_FIELDS[form]
  const mapped = isMappedCode(error.code) ? QUIZ_ERROR_FIELDS[error.code] : undefined
  const path = error.issues.find((issue) => issue.path.length > 0)?.path
  const field = mapped ?? (path ? String(path[0]) : undefined)
  return field !== undefined && fields.includes(field) ? field : undefined
}

/** 409 `version_conflict`: form kendi uyarısını gösterir (toast yok). */
export const isQuizVersionConflict = (error: ApiError) =>
  error.status === 409 && error.code === 'version_conflict'

/**
 * Ekrandaki quiz ya da deneme eskidi (sürüm çakıştı, kayıt yok oldu, deneme başladı, süre doldu,
 * cevaplar gönderildi, quiz kapandı): ilgili sorgular tazelenir.
 */
export const quizStale = (error: ApiError) =>
  error.status === 404 ||
  (error.status === 409 &&
    (error.code === 'version_conflict' ||
      error.code === 'quiz_has_attempts' ||
      error.code === 'quiz_already_attempted' ||
      error.code === 'quiz_already_submitted')) ||
  (error.status === 422 &&
    (error.code === 'quiz_time_expired' ||
      error.code === 'quiz_closed' ||
      error.code === 'quiz_not_started'))

/** Var olan quize yazmanın hedefi; `version` okunan `version`'dır. */
export interface QuizTarget {
  quizId: string
  version: number
}

/** Personel (yönetici, öğretmen) ayrıntısı mı: cevap anahtarı yalnız onda vardır (DOM-AKD-078). */
export function isStaffQuizDetail<T extends object>(detail: T): detail is T & QuizStaffDetail {
  return 'answerKey' in detail
}

/** Başlık aramasının en kısa uzunluğu (sunucu `q` kuralı). */
export const QUIZ_SEARCH_MIN = 2

/** Boş süzgeç gönderilmez (sunucu boş değerde 400 verir); `status` varsayılanı `all`'dır. */
export function quizListParams(query: QuizListQuery): QuizListQuery {
  const params: QuizListQuery = {}
  if (query.page !== undefined) params.page = query.page
  if (query.pageSize !== undefined) params.pageSize = query.pageSize
  if (query.classId) params.classId = query.classId
  if (query.subjectId) params.subjectId = query.subjectId
  // Sunucu başlık aramasını en az 2 karakterle kabul eder; kısa ya da boş metin aramasız listedir.
  const q = query.q?.trim()
  if (q && q.length >= QUIZ_SEARCH_MIN) params.q = q
  if (query.status && query.status !== 'all') params.status = query.status
  return params
}

/** Sorgu anahtarı: süzgeçler sabit sırayla (aynı süzgeç aynı önbellek). */
export function quizListKey(query: QuizListQuery): unknown[] {
  const params = quizListParams(query)
  return [
    ...QUIZ_KEY,
    'list',
    Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))),
  ]
}

export const quizItemKey = (quizId: string): unknown[] => [...QUIZ_KEY, 'item', quizId]

export function listQuizzesRequest(
  client: KampusClient,
  query: QuizListQuery,
  signal?: AbortSignal,
) {
  return client.GET('/api/v1/quizzes', {
    params: { query: quizListParams(query) },
    ...(signal ? { signal } : {}),
  })
}

export async function fetchQuizPage(
  client: KampusClient,
  query: QuizListQuery,
  signal?: AbortSignal,
): Promise<ListPage<QuizListItem>> {
  const body = await runRequest(() => listQuizzesRequest(client, query, signal))
  return { rows: body.data, ...body.meta }
}

/** Süzgece uyan bütün quizler (öğrenci ve veli listesi); sayfa sayfa okunur. */
export function fetchAllQuizzes(
  client: KampusClient,
  query: Omit<QuizListQuery, 'page' | 'pageSize'>,
  signal?: AbortSignal,
): Promise<QuizListItem[]> {
  return fetchAllPages<QuizListQuery, QuizListItem>(
    (page, pageSignal) => fetchQuizPage(client, page, pageSignal),
    query,
    signal,
  )
}

export function getQuizRequest(client: KampusClient, quizId: string, signal?: AbortSignal) {
  return client.GET('/api/v1/quizzes/{quizId}', {
    params: { path: { quizId } },
    ...(signal ? { signal } : {}),
  })
}

const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function createQuizRequest(
  client: KampusClient,
  body: CreateQuizBody,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/quizzes', {
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body,
  })
}

export function updateQuizRequest(
  client: KampusClient,
  input: QuizTarget & { body: UpdateQuizBody },
  headers: CommandHeaders,
) {
  return client.PATCH('/api/v1/quizzes/{quizId}', {
    params: { path: { quizId: input.quizId }, header: versioned(headers) },
    body: input.body,
  })
}

export function archiveQuizRequest(
  client: KampusClient,
  input: QuizTarget,
  headers: CommandHeaders,
) {
  return client.DELETE('/api/v1/quizzes/{quizId}', {
    params: { path: { quizId: input.quizId }, header: versioned(headers) },
  })
}

/** Denemeyi başlatır; süresi işleyen deneme varsa sunucu aynısını (200) döndürür. */
export function startQuizRequest(
  client: KampusClient,
  input: { quizId: string },
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/quizzes/{quizId}/attempt', {
    params: {
      path: { quizId: input.quizId },
      header: { 'idempotency-key': headers['idempotency-key'] },
    },
  })
}

export function submitQuizRequest(
  client: KampusClient,
  input: { quizId: string; body: SubmitQuizBody },
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/quizzes/{quizId}/attempt/submit', {
    params: {
      path: { quizId: input.quizId },
      header: { 'idempotency-key': headers['idempotency-key'] },
    },
    body: input.body,
  })
}

/**
 * Gönderim gövdesi: yalnız quizin sorularına verilmiş cevaplar, quizin soru sırasıyla. Boş soru
 * gönderilmez (sunucu yanlış sayar); puan alanı yoktur, puanı sunucu hesaplar (DOM-AKD-078).
 */
export function submitQuizBody(
  questionIds: readonly string[],
  answers: Readonly<Record<string, number | undefined>>,
): SubmitQuizBody {
  const picked: Record<string, number> = {}
  for (const id of questionIds) {
    const answer = answers[id]
    if (typeof answer === 'number' && Number.isInteger(answer) && answer >= 0) picked[id] = answer
  }
  return { answers: picked }
}

/**
 * Denemenin kalan süresi (saniye, en az 0). Yalnız gösterimdir: sunucu bitiş anından sonra ağ
 * payını da tanır, karar sunucudadır (DOM-AKD-077). Bitiş anı yoksa `null` (süresiz).
 * `offsetMs` sunucu saati eksi cihaz saatidir (`quizClockOffset`): cihaz saati ileri ya da geri
 * olsa da sayaç sunucu saatiyle işler.
 */
export function quizSecondsLeft(
  expiresAt: string | null,
  now: number,
  offsetMs = 0,
): number | null {
  if (expiresAt === null) return null
  const end = Date.parse(expiresAt)
  if (!Number.isFinite(end)) return null
  return Math.max(0, Math.ceil((end - (now + offsetMs)) / 1000))
}

/**
 * Sunucu saati ile cihaz saati arasındaki fark (ms; sunucu eksi cihaz). `serverNow` yanıtın
 * taşıdığı sunucu anı, `receivedAt` yanıtın cihazda alındığı andır (`dataUpdatedAt`). Sunucu anı
 * yoksa ya da geçersizse 0 (cihaz saatine düşer).
 */
export function quizClockOffset(serverNow: string | null | undefined, receivedAt: number): number {
  if (serverNow === null || serverNow === undefined) return 0
  const server = Date.parse(serverNow)
  return Number.isFinite(server) ? server - receivedAt : 0
}

/**
 * Süre bittikten sonraki gönderimde geri çekilmeli yeniden deneme beklemeleri (ms). Sunucu ağ
 * payı (`QUIZ_SUBMIT_GRACE_SECONDS`) içinde kabul eder; deneme yalnız pay bitmeden yapılır.
 */
export const QUIZ_SUBMIT_RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const

/**
 * Gönderim hatası kesin değil mi: ağ kopması, 5xx, 429 ve süren aynı anahtar. Bunlarda cevaplar
 * kaybolmaz, aynı `Idempotency-Key` ile yeniden gönderilir. Kesin hata (422 `quiz_time_expired`,
 * 409, 403…) yeniden denenmez.
 */
export function isQuizSubmitRetryable(error: ApiError): boolean {
  return error.status === 429 || keepsIdempotencyKey(error)
}

/**
 * Sıradaki yeniden denemenin bekleme süresi (ms); deneme hakkı bittiyse ya da bekleme sonunda
 * ağ payı da geçmiş olacaksa `null`. `graceLeftMs` sunucu saatiyle payın bitimine kalan süredir.
 */
export function quizSubmitRetryDelay(tryNo: number, graceLeftMs: number): number | null {
  const delay = QUIZ_SUBMIT_RETRY_DELAYS_MS[tryNo]
  if (delay === undefined || delay >= graceLeftMs) return null
  return delay
}

/** Gönderimin ağ payı dahil son anına kalan süre (ms; sunucu saatiyle); bitiş anı yoksa sonsuz. */
export function quizGraceLeftMs(expiresAt: string | null, now: number, offsetMs = 0): number {
  if (expiresAt === null) return Number.POSITIVE_INFINITY
  const end = Date.parse(expiresAt)
  if (!Number.isFinite(end)) return Number.POSITIVE_INFINITY
  return end + QUIZ_SUBMIT_GRACE_SECONDS * 1000 - (now + offsetMs)
}

/** Hata metni: koda özgü Türkçe mesaj, yoksa sunucunun mesajı. */
export function quizErrorMessage(error: ApiError): string {
  return Object.hasOwn(QUIZ_MESSAGES, error.code)
    ? QUIZ_MESSAGES[error.code as keyof typeof QUIZ_MESSAGES]
    : error.message
}

/** Kalan süre `dd:ss` (bir saatten uzunsa `s:dd:ss`). */
export function quizClockLabel(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const rest = safe % 60
  const two = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${two(minutes)}:${two(rest)}` : `${two(minutes)}:${two(rest)}`
}

// --- Öğrenci ve veli görünümü (web ve mobil ortak) -------------------------------

/** Öğrenci ya da velinin gördüğü deneme durumu. */
export type AttemptPhase = 'none' | 'in_progress' | 'completed' | 'expired'

export const attemptPhase = (attempt: Pick<QuizAttempt, 'status'> | undefined): AttemptPhase =>
  attempt?.status ?? 'none'

/** Öğrenci ve velinin listesindeki durum metni (deneme durumu sunucudandır). */
export const QUIZ_PHASE_TEXT = {
  none: 'Henüz çözülmedi',
  in_progress: 'Devam ediyor',
  completed: 'Çözüldü',
  expired: 'Süresi doldu',
} as const satisfies Record<AttemptPhase, string>

/**
 * Öğrenci quizi başlatabilir mi (DOM-AKD-077): quiz açık ve denemesi yok. Karar sunucudadır
 * (son tarih istemci saatiyle değil sunucunun `status` alanıyla); burası düğmeyi göstermek içindir.
 */
export const canStartQuiz = (
  quiz: Pick<Quiz, 'status'>,
  attempt: Pick<QuizAttempt, 'status'> | undefined,
) => quiz.status === 'open' && attempt === undefined

/** Şıkların harfleri (A, B, C…); seçenek sırası sunucudakiyle aynıdır. */
export const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const

/** Şıkkın görünen metni: `B) 46`. */
export function optionText(options: readonly string[], index: number): string {
  const letter = OPTION_LETTERS[index] ?? String(index + 1)
  return `${letter}) ${options[index] ?? ''}`
}

/** Cevaplanan soru sayısı (yalnız quizin soruları sayılır). */
export function answeredCount(
  questionIds: readonly string[],
  answers: Readonly<Record<string, number | undefined>>,
): number {
  return questionIds.filter((id) => typeof answers[id] === 'number').length
}

/** İnceleme satırı: soru ve öğrencinin seçtiği şık; doğru şık hiç yoktur (DOM-AKD-078). */
export type QuizReviewRow = { id: string; text: string; topic: string; chosen: string | null }

/**
 * İnceleme açıldığında (son tarih geçince ya da quiz kapanınca; sunucu `answers` alanını o zaman
 * gönderir) soruların listesi ve öğrencinin cevabı. Anahtar öğrenci ve veli yanıtında yoktur;
 * burada da üretilmez.
 */
export function quizReviewRows(
  questions: readonly Pick<QuizQuestion, 'id' | 'text' | 'topic' | 'options'>[],
  answers: Readonly<Record<string, number>>,
): QuizReviewRow[] {
  return questions.map((question) => {
    const answer = answers[question.id]
    return {
      id: question.id,
      text: question.text,
      topic: question.topic,
      chosen:
        typeof answer === 'number' && answer < question.options.length
          ? optionText(question.options, answer)
          : null,
    }
  })
}

/** Okuyanın (öğrenci ya da velinin seçili çocuğu) bu quizdeki denemesi. */
export function attemptOf<A extends Pick<QuizAttempt, 'studentId'>>(
  item: { attempts: readonly A[] },
  studentId: string,
): A | undefined {
  return item.attempts.find((attempt) => attempt.studentId === studentId)
}

const target = (input: { version: number }) => input.version

/** Komut tanımları (`useApiCommand` seçenekleri); kancalar ve testler aynısını kullanır. */
export const createQuizCommand = {
  request: createQuizRequest,
  invalidates: QUIZ_INVALIDATES,
  messages: QUIZ_MESSAGES,
} as const
export const updateQuizCommand = {
  request: updateQuizRequest,
  version: target,
  invalidates: QUIZ_INVALIDATES,
  refreshOn: quizStale,
  messages: QUIZ_MESSAGES,
} as const
export const archiveQuizCommand = {
  request: archiveQuizRequest,
  version: target,
  invalidates: QUIZ_INVALIDATES,
  refreshOn: quizStale,
  messages: QUIZ_MESSAGES,
} as const
export const startQuizCommand = {
  request: startQuizRequest,
  invalidates: QUIZ_INVALIDATES,
  refreshOn: quizStale,
  messages: QUIZ_MESSAGES,
} as const
export const submitQuizCommand = {
  request: submitQuizRequest,
  invalidates: QUIZ_INVALIDATES,
  refreshOn: quizStale,
  messages: QUIZ_MESSAGES,
} as const
