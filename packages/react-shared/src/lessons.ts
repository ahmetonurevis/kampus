import type { KampusClient } from '@kampus/api-client/client.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { components, operations } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'
import { collectionKeyPrefix } from './collections.ts'
import { requireIfMatch, type CommandHeaders, type CommandMessages } from './commands.ts'
import { fetchAllPages, type ListPage } from './institution-lists.ts'

/**
 * Ders programı uçlarının (`/lessons`, IST-094; DOM-YTK-068, DOM-YTK-069) saf yardımcıları:
 * istek kurucular, Türkçe hata metinleri, hata → form alanı eşlemesi ve sorgu anahtarı. Kancalar
 * `use-lessons.ts`'tedir; burası React olmadan sahte istemciyle sınanır. Her yazma
 * `Idempotency-Key` taşır (`useApiCommand`); var olan derse yazma okunan `version`'ı `If-Match`
 * olarak gönderir, sürüm yoksa istek atılmaz (`requireIfMatch`). Yazma yalnız yöneticidedir;
 * iptal ve yedek gerekçesi yalnız yöneticiye döner (`cancelReason`, `substitutions`).
 */

export type Lesson = components['schemas']['Lesson']
export type LessonListQuery = NonNullable<operations['listLessons']['parameters']['query']>
export type LessonCancelledFilter = NonNullable<LessonListQuery['cancelled']>

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type CreateLessonBody = JsonBody<'createLesson'>
export type UpdateLessonBody = JsonBody<'updateLesson'>
export type SubstituteLessonBody = JsonBody<'substituteLesson'>
export type CancelLessonBody = JsonBody<'cancelLesson'>

/** Sorgu anahtarının kökü (etkin kurum kendiliğinden eklenir); yazma sonrası bu önek tazelenir. */
export const LESSONS_KEY = ['lessons'] as const

/**
 * Ders yazmaları genel koleksiyon okumalarını da etkiler (`schedule`: dashboard kartları, eski
 * ekranlar); ikisi birlikte tazelenir.
 */
export const LESSON_INVALIDATES = [LESSONS_KEY, collectionKeyPrefix('schedule')] as const

export const LESSON_CHANGED_MESSAGE =
  'Ders bu arada değişti. Güncel hâli yüklendi; kontrol edip yeniden deneyin.'

/**
 * Koda özgü Türkçe metinler (DOM-YTK-069). Çakışma kodları (`teacher_lesson_conflict`,
 * `class_lesson_conflict`, `room_conflict`, `teacher_appointment_conflict`,
 * `teacher_event_conflict`, `tutor_schedule_conflict`) bilerek listede yoktur: sunucunun mesajı
 * çakışan kaydı (etüt grubu, saat) söyler ve aynen gösterilir.
 */
export const LESSON_MESSAGES = {
  version_conflict: LESSON_CHANGED_MESSAGE,
  not_found: 'Ders bulunamadı. Program güncellendi.',
  lesson_in_past:
    'Başlamış ya da geçmiş ders değiştirilemez; ders geçmiş bir saate de planlanamaz.',
  lesson_cancelled: 'İptal edilmiş ders değiştirilemez.',
  lesson_already_cancelled: 'Ders zaten iptal edilmiş. Program güncellendi.',
  lesson_teacher_mismatch: 'Öğretmenin branşı ve kampüsü seçilen sınıf ve derse uygun olmalı.',
  record_inactive: 'Seçilen sınıf ya da öğretmen etkin değil. Etkin bir kayıt seçin.',
  teacher_unchanged: 'Dersi zaten bu öğretmen veriyor. Farklı bir öğretmen seçin.',
  lesson_attendance_taken: 'Bu ders günü için sınıfın yoklaması alınmış; ders iptal edilemez.',
  lesson_has_substitution:
    'Bu derse yedek atanmış; öğretmeni değiştirmek için yedek atama işlemini kullanın.',
} as const satisfies CommandMessages

/** Formun türü: alan eşlemesi yalnız o formda bulunan alana yapılır, gerisi toast'tur. */
export type LessonFormKind = 'lesson' | 'substitute' | 'cancel'

/** Alana bağlanamayan, formun kendi içinde (alanların altında değil) gösterilen hata yeri. */
export const LESSON_FORM_ROOT = 'root.server'

const FORM_FIELDS = {
  lesson: ['classId', 'subjectId', 'teacherId', 'date', 'duration', 'room', LESSON_FORM_ROOT],
  substitute: ['teacherId', 'reason', LESSON_FORM_ROOT],
  cancel: ['reason', LESSON_FORM_ROOT],
} as const satisfies Record<LessonFormKind, readonly string[]>

/**
 * Hata kodunun bağlandığı form alanı (mesaj yalnız o alanın altında görünür). Öğretmen meşgulse
 * öğretmen, sınıf ya da etüt çakışmasında başlangıç, derslik çakışmasında derslik alanı.
 */
export const LESSON_ERROR_FIELDS = {
  teacher_lesson_conflict: 'teacherId',
  teacher_appointment_conflict: 'teacherId',
  teacher_event_conflict: 'teacherId',
  class_lesson_conflict: 'date',
  tutor_schedule_conflict: 'date',
  room_conflict: 'room',
  lesson_in_past: 'date',
  lesson_teacher_mismatch: 'teacherId',
  lesson_has_substitution: 'teacherId',
  teacher_unchanged: 'teacherId',
  // Ders artık değiştirilemiyor: açık formun içinde, formu kapatmadan gösterilir.
  lesson_cancelled: LESSON_FORM_ROOT,
  lesson_already_cancelled: LESSON_FORM_ROOT,
} as const satisfies Readonly<Record<string, string>>

const isMappedCode = (code: string): code is keyof typeof LESSON_ERROR_FIELDS =>
  Object.hasOwn(LESSON_ERROR_FIELDS, code)

/**
 * Ders başlamış ya da geçmişse (`lesson_in_past`) ders formunda başlangıç alanı, yedek ve iptal
 * formlarında (başlangıç alanı yok) form içi mesajdır.
 */
const IN_PAST_CODE = 'lesson_in_past'

/**
 * Hatanın formdaki alanı: önce kod eşlemesi, yoksa sunucunun yollu ilk maddesi; alan o formda
 * yoksa `undefined` (toast). Yetki ve bulunamadı hataları alana bağlanmaz.
 */
export function lessonErrorField(error: ApiError, form: LessonFormKind): string | undefined {
  if (error.status === 401 || error.status === 403 || error.status === 404) return undefined
  const fields: readonly string[] = FORM_FIELDS[form]
  const mapped = isMappedCode(error.code) ? LESSON_ERROR_FIELDS[error.code] : undefined
  const field = mapped ?? error.issues.find((issue) => issue.path.length > 0)?.path.join('.')
  if (field !== undefined && fields.includes(field)) return field
  return error.code === IN_PAST_CODE ? LESSON_FORM_ROOT : undefined
}

/** Çakışma kodları (409, sürüm dışı): form korunur, kullanıcı saati ya da kişiyi değiştirir. */
export const LESSON_CONFLICT_CODES = [
  'teacher_lesson_conflict',
  'class_lesson_conflict',
  'room_conflict',
  'teacher_appointment_conflict',
  'teacher_event_conflict',
  'tutor_schedule_conflict',
] as const

export const isLessonConflict = (error: ApiError) =>
  error.status === 409 && LESSON_CONFLICT_CODES.some((code) => code === error.code)

/** Ekrandaki ders eskidi (sürüm çakıştı, ders yok oldu ya da zaten iptal): program tazelenir. */
export const lessonStale = (error: ApiError) =>
  error.status === 404 ||
  (error.status === 409 &&
    (error.code === 'version_conflict' || error.code === 'lesson_already_cancelled')) ||
  (error.status === 422 && error.code === 'lesson_cancelled')

/** Var olan derse yazmanın hedefi; `version` okunan `version`'dır. */
export interface LessonTarget {
  lessonId: string
  version: number
}

/** Boş süzgeç gönderilmez (sunucu boş değerde 400 verir); `cancelled` varsayılanı `false`'tur. */
export function lessonListParams(query: LessonListQuery): LessonListQuery {
  const params: LessonListQuery = {}
  if (query.page !== undefined) params.page = query.page
  if (query.pageSize !== undefined) params.pageSize = query.pageSize
  if (query.dateFrom) params.dateFrom = query.dateFrom
  if (query.dateTo) params.dateTo = query.dateTo
  if (query.classId) params.classId = query.classId
  if (query.teacherId) params.teacherId = query.teacherId
  const room = query.room?.trim() ?? ''
  if (room) params.room = room.slice(0, 80)
  if (query.cancelled && query.cancelled !== 'false') params.cancelled = query.cancelled
  return params
}

/** Sorgu anahtarı: süzgeçler sabit sırayla (aynı süzgeç aynı önbellek). */
export function lessonListKey(query: LessonListQuery): unknown[] {
  const params = lessonListParams(query)
  return [
    ...LESSONS_KEY,
    'list',
    Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))),
  ]
}

export const lessonItemKey = (lessonId: string): unknown[] => [...LESSONS_KEY, 'item', lessonId]

export function listLessonsRequest(
  client: KampusClient,
  query: LessonListQuery,
  signal?: AbortSignal,
) {
  return client.GET('/api/v1/lessons', {
    params: { query: lessonListParams(query) },
    ...(signal ? { signal } : {}),
  })
}

export async function fetchLessonPage(
  client: KampusClient,
  query: LessonListQuery,
  signal?: AbortSignal,
): Promise<ListPage<Lesson>> {
  const body = await runRequest(() => listLessonsRequest(client, query, signal))
  return { rows: body.data, ...body.meta }
}

/** Süzgece uyan bütün dersler (haftalık/günlük görünüm, CSV); sayfa sayfa okunur. */
export function fetchAllLessons(
  client: KampusClient,
  query: Omit<LessonListQuery, 'page' | 'pageSize'>,
  signal?: AbortSignal,
): Promise<Lesson[]> {
  return fetchAllPages<LessonListQuery, Lesson>(
    (page, pageSignal) => fetchLessonPage(client, page, pageSignal),
    query,
    signal,
  )
}

export function getLessonRequest(client: KampusClient, lessonId: string, signal?: AbortSignal) {
  return client.GET('/api/v1/lessons/{lessonId}', {
    params: { path: { lessonId } },
    ...(signal ? { signal } : {}),
  })
}

const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function createLessonRequest(
  client: KampusClient,
  body: CreateLessonBody,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/lessons', {
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body,
  })
}

export function updateLessonRequest(
  client: KampusClient,
  input: LessonTarget & { body: UpdateLessonBody },
  headers: CommandHeaders,
) {
  return client.PATCH('/api/v1/lessons/{lessonId}', {
    params: { path: { lessonId: input.lessonId }, header: versioned(headers) },
    body: input.body,
  })
}

export function substituteLessonRequest(
  client: KampusClient,
  input: LessonTarget & { body: SubstituteLessonBody },
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/lessons/{lessonId}/substitute', {
    params: { path: { lessonId: input.lessonId }, header: versioned(headers) },
    body: input.body,
  })
}

export function cancelLessonRequest(
  client: KampusClient,
  input: LessonTarget & { body: CancelLessonBody },
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/lessons/{lessonId}/cancel', {
    params: { path: { lessonId: input.lessonId }, header: versioned(headers) },
    body: input.body,
  })
}

const target = (input: LessonTarget) => input.version

/** Komut tanımları (`useApiCommand` seçenekleri); kancalar ve testler aynısını kullanır. */
export const createLessonCommand = {
  request: createLessonRequest,
  invalidates: LESSON_INVALIDATES,
  messages: LESSON_MESSAGES,
} as const
export const updateLessonCommand = {
  request: updateLessonRequest,
  version: target,
  invalidates: LESSON_INVALIDATES,
  refreshOn: lessonStale,
  messages: LESSON_MESSAGES,
} as const
export const substituteLessonCommand = {
  request: substituteLessonRequest,
  version: target,
  invalidates: LESSON_INVALIDATES,
  refreshOn: lessonStale,
  messages: LESSON_MESSAGES,
} as const
export const cancelLessonCommand = {
  request: cancelLessonRequest,
  version: target,
  invalidates: LESSON_INVALIDATES,
  refreshOn: lessonStale,
  messages: LESSON_MESSAGES,
} as const
