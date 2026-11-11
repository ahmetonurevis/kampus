import type { KampusClient } from '@kampus/api-client/client.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { components, operations } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'
import { requireIfMatch, type CommandHeaders, type CommandMessages } from './commands.ts'
import { fetchAllPages, type ListPage } from './institution-lists.ts'

/**
 * Dil okulu kur programı uçlarının (`/courses`, IST-076; DOM-DIL-005…007) saf yardımcıları:
 * istek kurucular, Türkçe hata metinleri, hata → form alanı eşlemesi ve sorgu anahtarı. Kancalar
 * `use-courses.ts`'tedir; burası React olmadan sahte istemciyle sınanır. Uçlar yalnız dil okulunda
 * vardır (okulda 404). Her yazma `Idempotency-Key` taşır (`useApiCommand`); var olan kura yazma
 * okunan `rowVersion`'ı `If-Match` olarak gönderir, sürüm yoksa istek atılmaz (`requireIfMatch`).
 */

export type Course = components['schemas']['Course']
export type CourseListQuery = NonNullable<operations['listCourses']['parameters']['query']>

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type CreateCourseBody = JsonBody<'createCourse'>
export type UpdateCourseBody = JsonBody<'updateCourse'>
export type CourseEOzelBody = JsonBody<'recordCourseEOzel'>

/** Sorgu anahtarının kökü (etkin kurum kendiliğinden eklenir); yazma sonrası bu önek tazelenir. */
export const COURSES_KEY = ['courses'] as const

/** Kur yazmaları grup listesini de etkiler (kur adı, seviye, etkin kur seçimi). */
export const COURSE_INVALIDATES = [COURSES_KEY, ['language-groups']] as const

export const COURSE_CHANGED_MESSAGE =
  'Kur bu arada değişti. Güncel hâli yüklendi; kontrol edip yeniden deneyin.'

/**
 * Koda özgü Türkçe metinler (DOM-DIL-005…007). Listede olmayan kodda sunucunun Türkçe mesajı
 * gösterilir.
 */
export const COURSE_MESSAGES = {
  version_conflict: COURSE_CHANGED_MESSAGE,
  not_found: 'Kur bulunamadı. Liste güncellendi.',
  course_not_found: 'Kur bulunamadı. Liste güncellendi.',
  course_coordinator_required:
    'Bu seviyenin kurlarını yalnız yönetici ya da seviyenin akademik koordinatörü yönetir.',
  course_program_not_approved:
    "Belgeli kur, programı e-Özel'de onaylanmadan etkinleştirilemez. Önce e-Özel kaydını onaylı işaretleyin.",
  course_has_open_groups:
    'Kurun kapanmamış grupları var. Grupları tamamlayın ya da iptal edin, sonra arşivleyin.',
  course_max_below_group_capacity:
    'En çok mevcut, kurun açık gruplarından birinin kapasitesinin altına inemez.',
  course_name_exists: 'Bu adla tanımlı bir kur var. Farklı bir ad yazın.',
  course_hours_invalid: 'Toplam ders saati haftalık ders saatinden az olamaz.',
  course_session_mismatch: '90 dakikalık oturumda haftalık ve toplam ders saati çift sayı olmalı.',
  course_learners_invalid: 'En az mevcut en çok mevcuttan büyük olamaz.',
  course_active_locked:
    'Etkin kurun dili, seviyesi, saatleri, oturumu ve belge türü değişmez; yeni kur tanımlayın.',
  course_not_draft: 'Yalnız taslak kur etkinleştirilir.',
  course_archived: 'Arşivlenmiş kur değiştirilemez.',
  course_has_dependents: 'Bu kur başka bir kurun sonraki kuru; önce o bağlantıyı kaldırın.',
  course_program_code_exists: 'Bu e-Özel program kodu başka bir kurda kullanılıyor.',
  course_next_not_found: 'Sonraki kur bulunamadı.',
  course_next_language: 'Sonraki kur aynı dilde olmalı.',
  course_next_level: 'Sonraki kurun seviyesi bu kurdan düşük olamaz.',
  course_next_cycle: 'Sonraki kur zinciri kendine dönemez.',
  course_next_invalid: 'Sonraki kur olarak arşivlenmemiş başka bir kur seçin.',
} as const satisfies CommandMessages

/**
 * Hata kodunun bağlandığı form alanı; mesaj yalnız o alanın altında görünür (toast çıkmaz).
 * Listede olmayan kod toast'tur.
 */
export const COURSE_ERROR_FIELDS = {
  course_name_exists: 'name',
  course_hours_invalid: 'totalHours',
  course_session_mismatch: 'weeklyHours',
  course_learners_invalid: 'minLearners',
  course_max_below_group_capacity: 'maxLearners',
  course_next_not_found: 'nextCourseId',
  course_next_language: 'nextCourseId',
  course_next_level: 'nextCourseId',
  course_next_cycle: 'nextCourseId',
  course_next_invalid: 'nextCourseId',
  course_program_code_exists: 'programCode',
} as const satisfies Readonly<Record<string, string>>

/** Hatanın alanı: önce kod eşlemesi, yoksa sunucunun yollu ilk maddesi. */
export function courseErrorField(error: ApiError): string | undefined {
  const mapped = (COURSE_ERROR_FIELDS as Readonly<Record<string, string>>)[error.code]
  if (mapped) return mapped
  if (error.status === 403 || error.status === 404) return undefined
  return error.issues.find((issue) => issue.path.length > 0)?.path.join('.')
}

/** Ekrandaki kur eskidi (sürüm çakıştı, kur yok oldu): liste tazelenir. */
export const courseStale = (error: ApiError) =>
  error.status === 404 || (error.status === 409 && error.code === 'version_conflict')

/** Var olan kura yazmanın hedefi; `version` okunan `rowVersion`'dır. */
export interface CourseTarget {
  courseId: string
  version: number
}

const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function listCoursesRequest(
  client: KampusClient,
  query: CourseListQuery,
  signal?: AbortSignal,
) {
  return client.GET('/api/v1/courses', { params: { query }, ...(signal ? { signal } : {}) })
}

export async function fetchCoursePage(
  client: KampusClient,
  query: CourseListQuery,
  signal?: AbortSignal,
): Promise<ListPage<Course>> {
  const body = await runRequest(() => listCoursesRequest(client, query, signal))
  return { rows: body.data, ...body.meta }
}

/**
 * Kurumun bütün kurları (arşiv dahil). Uç arşivi varsayılan olarak dışladığı için iki süzgeç
 * birleşir; kurum başına kur sayısı azdır, arama ve süzgeç istemcide uygulanır.
 */
export async function fetchAllCourses(
  client: KampusClient,
  signal?: AbortSignal,
): Promise<Course[]> {
  const page = (query: CourseListQuery, pageSignal?: AbortSignal) =>
    fetchCoursePage(client, query, pageSignal)
  const [current, archived] = await Promise.all([
    fetchAllPages<CourseListQuery, Course>(page, {}, signal),
    fetchAllPages<CourseListQuery, Course>(page, { status: 'archived' }, signal),
  ])
  return [...current, ...archived]
}

/** Etkin kurlar (grup formu ve süzgeç seçenekleri). */
export function fetchActiveCourses(client: KampusClient, signal?: AbortSignal): Promise<Course[]> {
  return fetchAllPages<CourseListQuery, Course>(
    (query, pageSignal) => fetchCoursePage(client, query, pageSignal),
    { status: 'active' },
    signal,
  )
}

export function createCourseRequest(
  client: KampusClient,
  body: CreateCourseBody,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/courses', {
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body,
  })
}

export function updateCourseRequest(
  client: KampusClient,
  input: CourseTarget & { body: UpdateCourseBody },
  headers: CommandHeaders,
) {
  return client.PATCH('/api/v1/courses/{courseId}', {
    params: { path: { courseId: input.courseId }, header: versioned(headers) },
    body: input.body,
  })
}

export function activateCourseRequest(
  client: KampusClient,
  input: CourseTarget,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/courses/{courseId}/activate', {
    params: { path: { courseId: input.courseId }, header: versioned(headers) },
    body: {},
  })
}

export function archiveCourseRequest(
  client: KampusClient,
  input: CourseTarget,
  headers: CommandHeaders,
) {
  return client.DELETE('/api/v1/courses/{courseId}', {
    params: { path: { courseId: input.courseId }, header: versioned(headers) },
  })
}

export function recordCourseEOzelRequest(
  client: KampusClient,
  input: CourseTarget & { body: CourseEOzelBody },
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/courses/{courseId}/record-e-ozel', {
    params: { path: { courseId: input.courseId }, header: versioned(headers) },
    body: input.body,
  })
}

const target = (input: CourseTarget) => input.version

/** Komut tanımları (`useApiCommand` seçenekleri); kancalar ve testler aynısını kullanır. */
export const createCourseCommand = {
  request: createCourseRequest,
  invalidates: COURSE_INVALIDATES,
  messages: COURSE_MESSAGES,
} as const
export const updateCourseCommand = {
  request: updateCourseRequest,
  version: target,
  invalidates: COURSE_INVALIDATES,
  refreshOn: courseStale,
  messages: COURSE_MESSAGES,
} as const
export const activateCourseCommand = {
  request: activateCourseRequest,
  version: target,
  invalidates: COURSE_INVALIDATES,
  refreshOn: courseStale,
  messages: COURSE_MESSAGES,
} as const
export const archiveCourseCommand = {
  request: archiveCourseRequest,
  version: target,
  invalidates: COURSE_INVALIDATES,
  refreshOn: courseStale,
  messages: COURSE_MESSAGES,
} as const
export const recordCourseEOzelCommand = {
  request: recordCourseEOzelRequest,
  version: target,
  invalidates: COURSE_INVALIDATES,
  refreshOn: courseStale,
  messages: COURSE_MESSAGES,
} as const
