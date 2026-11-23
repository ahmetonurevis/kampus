import type { KampusClient } from '@kampus/api-client/client.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { components, operations } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'
import { collectionKeyPrefix } from './collections.ts'
import { requireIfMatch, type CommandHeaders, type CommandMessages } from './commands.ts'
import { FILE_REJECTED_MESSAGE, FILE_SCAN_WAIT_MESSAGE } from './files.ts'
import { fetchAllPages, type ListPage } from './institution-lists.ts'

/**
 * Ödev uçlarının (`/homework`, IST-095; DOM-AKD-070…074) saf yardımcıları: istek kurucular,
 * Türkçe hata metinleri, hata → form alanı eşlemesi ve sorgu anahtarı. Kancalar
 * `use-homework.ts`'tedir; burası React olmadan sahte istemciyle sınanır. Her yazma
 * `Idempotency-Key` taşır (`useApiCommand`); ödevin düzenlenmesi ve arşivi ödevin, puanlama
 * teslimin okunan `version`'ını `If-Match` olarak gönderir, sürüm yoksa istek atılmaz
 * (`requireIfMatch`). Teslim ve puanlama yeni kayıt değil işlemdir; teslim `If-Match` taşımaz.
 */

export type Homework = components['schemas']['Homework']
export type HomeworkListItem = components['schemas']['HomeworkListItem']
export type HomeworkDetail = components['schemas']['HomeworkDetail']
export type HomeworkSubmission = components['schemas']['HomeworkSubmission']
export type HomeworkListQuery = NonNullable<operations['listHomework']['parameters']['query']>
export type HomeworkStatusFilter = NonNullable<HomeworkListQuery['status']>

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type CreateHomeworkBody = JsonBody<'createHomework'>
export type UpdateHomeworkBody = JsonBody<'updateHomework'>
export type SubmitHomeworkBody = JsonBody<'submitHomework'>
export type GradeSubmissionBody = JsonBody<'gradeHomeworkSubmission'>

/** Sorgu anahtarının kökü (etkin kurum kendiliğinden eklenir); yazma sonrası bu önek tazelenir. */
export const HOMEWORK_KEY = ['homework'] as const

/**
 * Ödev yazmaları genel koleksiyon okumalarını da etkiler (`homework`, `submissions`: dashboard
 * kartları, ödev durumu sütunu, PDF'ler); üçü birlikte tazelenir.
 */
export const HOMEWORK_INVALIDATES = [
  HOMEWORK_KEY,
  collectionKeyPrefix('homework'),
  collectionKeyPrefix('submissions'),
] as const

export const HOMEWORK_CHANGED_MESSAGE =
  'Ödev bu arada değişti. Güncel hâli yüklendi; kontrol edip yeniden deneyin.'
export const SUBMISSION_CHANGED_MESSAGE =
  'Teslim bu arada değişti. Güncel hâli yüklendi; kontrol edip yeniden değerlendirin.'

/** Koda özgü Türkçe metinler (DOM-AKD-070…074); listede olmayan kodda sunucunun mesajı görünür. */
export const HOMEWORK_MESSAGES = {
  version_conflict: HOMEWORK_CHANGED_MESSAGE,
  not_found: 'Ödev bulunamadı. Liste güncellendi.',
  homework_due_in_past: 'Son teslim zamanı geçmişte olamaz. İleri bir tarih ve saat seçin.',
  homework_subject_required: 'Bu sınıfa birden çok dersle giriyorsunuz; ödevin dersini seçin.',
  homework_teacher_unavailable:
    'Bu sınıfın bu dersine atanmış etkin öğretmen yok. Önce ders atamasını yapın.',
  homework_scope_denied: 'Bu sınıfa ve derse ödev veremezsiniz; yalnız derse girdiğiniz sınıflar.',
  homework_not_owner: 'Bu ödevin öğretmeni değilsiniz; ödevi yalnız öğretmeni değiştirir.',
  homework_has_submissions:
    'Teslim alınmış ödev arşivlenemez; öğrencilerin teslimleri ve puanları korunur.',
  record_inactive: 'Seçilen sınıf etkin değil. Etkin bir sınıf seçin.',
  homework_closed: 'Bu ödevin teslim süresi doldu; ödev geç teslime kapalı.',
  submission_graded: 'Teslimin değerlendirildi; değerlendirilmiş teslim değiştirilemez.',
  student_inactive: 'Kaydınız pasif olduğu için ödev teslim edilemez.',
  file_unavailable: 'Eklenen dosyalardan biri bulunamadı. Dosyayı kaldırıp yeniden yükleyin.',
  file_not_ready: FILE_SCAN_WAIT_MESSAGE,
  file_rejected: FILE_REJECTED_MESSAGE,
  file_already_attached:
    'Eklenen dosyalardan biri başka bir kayda bağlı. Dosyayı kaldırıp yeniden yükleyin.',
} as const satisfies CommandMessages

/** Formun türü: alan eşlemesi yalnız o formda bulunan alana yapılır, gerisi toast'tur. */
export type HomeworkFormKind = 'homework' | 'submit' | 'grade'

/** Alana bağlanamayan, formun kendi içinde gösterilen hata yeri. */
export const HOMEWORK_FORM_ROOT = 'root.server'

const FORM_FIELDS = {
  homework: [
    'classId',
    'subjectId',
    'title',
    'description',
    'dueDate',
    'allowLate',
    HOMEWORK_FORM_ROOT,
  ],
  submit: ['note', 'fileIds', HOMEWORK_FORM_ROOT],
  grade: ['score', 'feedback', HOMEWORK_FORM_ROOT],
} as const satisfies Record<HomeworkFormKind, readonly string[]>

/** Hata kodunun bağlandığı form alanı (mesaj yalnız o alanın altında görünür). */
export const HOMEWORK_ERROR_FIELDS = {
  homework_due_in_past: 'dueDate',
  homework_subject_required: 'subjectId',
  homework_teacher_unavailable: 'subjectId',
  record_inactive: 'classId',
  file_unavailable: 'fileIds',
  file_not_ready: 'fileIds',
  file_rejected: 'fileIds',
  file_already_attached: 'fileIds',
  // Ödev ya da teslim artık bu işleme kapalı: açık formun içinde, formu kapatmadan gösterilir.
  homework_closed: HOMEWORK_FORM_ROOT,
  submission_graded: HOMEWORK_FORM_ROOT,
  homework_has_submissions: HOMEWORK_FORM_ROOT,
} as const satisfies Readonly<Record<string, string>>

const isMappedCode = (code: string): code is keyof typeof HOMEWORK_ERROR_FIELDS =>
  Object.hasOwn(HOMEWORK_ERROR_FIELDS, code)

/**
 * Hatanın formdaki alanı: önce kod eşlemesi, yoksa sunucunun yollu ilk maddesi (`fileIds.2` →
 * `fileIds`); alan o formda yoksa `undefined` (toast). Yetki ve bulunamadı hataları alana
 * bağlanmaz.
 */
export function homeworkErrorField(error: ApiError, form: HomeworkFormKind): string | undefined {
  if (error.status === 401 || error.status === 403 || error.status === 404) return undefined
  const fields: readonly string[] = FORM_FIELDS[form]
  const mapped = isMappedCode(error.code) ? HOMEWORK_ERROR_FIELDS[error.code] : undefined
  const path = error.issues.find((issue) => issue.path.length > 0)?.path
  const field = mapped ?? (path ? String(path[0]) : undefined)
  return field !== undefined && fields.includes(field) ? field : undefined
}

/** 409 `version_conflict`: form kendi uyarısını gösterir (toast yok). */
export const isHomeworkVersionConflict = (error: ApiError) =>
  error.status === 409 && error.code === 'version_conflict'

/**
 * Ekrandaki ödev ya da teslim eskidi (sürüm çakıştı, kayıt yok oldu, teslim değerlendirildi,
 * teslim süresi doldu, teslim alındı): ilgili sorgular tazelenir.
 */
export const homeworkStale = (error: ApiError) =>
  error.status === 404 ||
  (error.status === 409 &&
    (error.code === 'version_conflict' ||
      error.code === 'submission_graded' ||
      error.code === 'homework_has_submissions')) ||
  (error.status === 422 && error.code === 'homework_closed')

/** Var olan ödeve yazmanın hedefi; `version` okunan `version`'dır. */
export interface HomeworkTarget {
  homeworkId: string
  version: number
}

/** Var olan teslime yazmanın hedefi; `version` teslimin okunan `version`'ıdır. */
export interface SubmissionTarget {
  homeworkId: string
  submissionId: string
  version: number
}

/** Başlık aramasının en kısa uzunluğu (sunucu `q` kuralı). */
export const HOMEWORK_SEARCH_MIN = 2

/** Liste sıralama alanları; sunucunun beyaz listesi (`sort`, eksi azalan). */
export const HOMEWORK_SORT_FIELDS = ['dueDate', 'title', 'createdAt'] as const
export type HomeworkSortField = (typeof HOMEWORK_SORT_FIELDS)[number]

/** Sütun alanı ve yönden API `sort` değeri; beyaz liste dışındaki alan için `undefined`. */
export function homeworkSort(
  field: string,
  direction: 1 | -1,
): NonNullable<HomeworkListQuery['sort']> | undefined {
  const known = HOMEWORK_SORT_FIELDS.find((item) => item === field)
  if (!known) return undefined
  return direction === -1 ? `-${known}` : known
}

/**
 * Boş süzgeç gönderilmez (sunucu boş değerde 400 verir); `status` varsayılanı `all`'dır. Başlık
 * araması en az 2 karakterle gider (kısa ya da boş metin aramasız listedir).
 */
export function homeworkListParams(query: HomeworkListQuery): HomeworkListQuery {
  const params: HomeworkListQuery = {}
  if (query.page !== undefined) params.page = query.page
  if (query.pageSize !== undefined) params.pageSize = query.pageSize
  if (query.classId) params.classId = query.classId
  if (query.subjectId) params.subjectId = query.subjectId
  const q = query.q?.trim()
  if (q && q.length >= HOMEWORK_SEARCH_MIN) params.q = q
  if (query.sort) params.sort = query.sort
  if (query.status && query.status !== 'all') params.status = query.status
  if (query.dateFrom) params.dateFrom = query.dateFrom
  if (query.dateTo) params.dateTo = query.dateTo
  return params
}

/** Sorgu anahtarı: süzgeçler sabit sırayla (aynı süzgeç aynı önbellek). */
export function homeworkListKey(query: HomeworkListQuery): unknown[] {
  const params = homeworkListParams(query)
  return [
    ...HOMEWORK_KEY,
    'list',
    Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))),
  ]
}

export const homeworkItemKey = (homeworkId: string): unknown[] => [
  ...HOMEWORK_KEY,
  'item',
  homeworkId,
]

export function listHomeworkRequest(
  client: KampusClient,
  query: HomeworkListQuery,
  signal?: AbortSignal,
) {
  return client.GET('/api/v1/homework', {
    params: { query: homeworkListParams(query) },
    ...(signal ? { signal } : {}),
  })
}

export async function fetchHomeworkPage(
  client: KampusClient,
  query: HomeworkListQuery,
  signal?: AbortSignal,
): Promise<ListPage<HomeworkListItem>> {
  const body = await runRequest(() => listHomeworkRequest(client, query, signal))
  return { rows: body.data, ...body.meta }
}

/** Süzgece uyan bütün ödevler (öğrenci ve veli listesi); sayfa sayfa okunur. */
export function fetchAllHomework(
  client: KampusClient,
  query: Omit<HomeworkListQuery, 'page' | 'pageSize'>,
  signal?: AbortSignal,
): Promise<HomeworkListItem[]> {
  return fetchAllPages<HomeworkListQuery, HomeworkListItem>(
    (page, pageSignal) => fetchHomeworkPage(client, page, pageSignal),
    query,
    signal,
  )
}

export function getHomeworkRequest(client: KampusClient, homeworkId: string, signal?: AbortSignal) {
  return client.GET('/api/v1/homework/{homeworkId}', {
    params: { path: { homeworkId } },
    ...(signal ? { signal } : {}),
  })
}

const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function createHomeworkRequest(
  client: KampusClient,
  body: CreateHomeworkBody,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/homework', {
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body,
  })
}

export function updateHomeworkRequest(
  client: KampusClient,
  input: HomeworkTarget & { body: UpdateHomeworkBody },
  headers: CommandHeaders,
) {
  return client.PATCH('/api/v1/homework/{homeworkId}', {
    params: { path: { homeworkId: input.homeworkId }, header: versioned(headers) },
    body: input.body,
  })
}

export function archiveHomeworkRequest(
  client: KampusClient,
  input: HomeworkTarget,
  headers: CommandHeaders,
) {
  return client.DELETE('/api/v1/homework/{homeworkId}', {
    params: { path: { homeworkId: input.homeworkId }, header: versioned(headers) },
  })
}

export function submitHomeworkRequest(
  client: KampusClient,
  input: { homeworkId: string; body: SubmitHomeworkBody },
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/homework/{homeworkId}/submissions', {
    params: {
      path: { homeworkId: input.homeworkId },
      header: { 'idempotency-key': headers['idempotency-key'] },
    },
    body: input.body,
  })
}

export function gradeSubmissionRequest(
  client: KampusClient,
  input: SubmissionTarget & { body: GradeSubmissionBody },
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/homework/{homeworkId}/submissions/{submissionId}/grade', {
    params: {
      path: { homeworkId: input.homeworkId, submissionId: input.submissionId },
      header: versioned(headers),
    },
    body: input.body,
  })
}

/** Teslim gövdesi: boş not ve boş dosya listesi gönderilmez (sunucu en az birini ister). */
export function submitHomeworkBody(input: {
  note: string
  fileIds: readonly string[]
}): SubmitHomeworkBody {
  const note = input.note.trim()
  return {
    ...(note ? { note } : {}),
    ...(input.fileIds.length ? { fileIds: [...input.fileIds] } : {}),
  }
}

const target = (input: { version: number }) => input.version

/** Komut tanımları (`useApiCommand` seçenekleri); kancalar ve testler aynısını kullanır. */
export const createHomeworkCommand = {
  request: createHomeworkRequest,
  invalidates: HOMEWORK_INVALIDATES,
  messages: HOMEWORK_MESSAGES,
} as const
export const updateHomeworkCommand = {
  request: updateHomeworkRequest,
  version: target,
  invalidates: HOMEWORK_INVALIDATES,
  refreshOn: homeworkStale,
  messages: HOMEWORK_MESSAGES,
} as const
export const archiveHomeworkCommand = {
  request: archiveHomeworkRequest,
  version: target,
  invalidates: HOMEWORK_INVALIDATES,
  refreshOn: homeworkStale,
  messages: HOMEWORK_MESSAGES,
} as const
export const submitHomeworkCommand = {
  request: submitHomeworkRequest,
  invalidates: HOMEWORK_INVALIDATES,
  refreshOn: homeworkStale,
  messages: HOMEWORK_MESSAGES,
} as const
export const gradeSubmissionCommand = {
  request: gradeSubmissionRequest,
  version: target,
  invalidates: HOMEWORK_INVALIDATES,
  refreshOn: homeworkStale,
  messages: { ...HOMEWORK_MESSAGES, version_conflict: SUBMISSION_CHANGED_MESSAGE },
} as const
