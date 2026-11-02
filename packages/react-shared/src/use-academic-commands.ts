import type { KampusClient } from '@kampus/api-client/client.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'

import { collectionKeyPrefix } from './collections.ts'
import { requireIfMatch, type CommandHeaders, type CommandMessages } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'

type AttendanceBody = NonNullable<
  operations['recordClassAttendance']['requestBody']
>['content']['application/json']
type GradeBody = operations['recordGrade']['requestBody']['content']['application/json']
type GradeUpdateBody = operations['updateGrade']['requestBody']['content']['application/json']

/** Yoklama durumları (core `recordAttendance` ile aynı dört değer). */
export type AttendanceMark = AttendanceBody['marks'][string]

export interface RecordAttendanceInput {
  classId: string
  /** Yoklama günü (`YYYY-MM-DD`). */
  date: string
  /** Öğrenci kimliği → durum; sınıfın bütün aktif öğrencileri bulunmalıdır. */
  marks: Readonly<Record<string, AttendanceMark>>
  /** Yönetici düzeltmesinin gerekçesi (DOM-AKD-035); öğretmende gönderilmez. */
  reason?: string
  /** Sınıf kaydının okunan sürümü (`If-Match`); yoksa başlık gönderilmez. */
  classVersion?: number | null
}

/**
 * Yönetici yoklama düzeltmesi (DOM-AKD-035): gerekçe ve sınıfın okunan sürümü zorunludur. Gün
 * geçmiş ya da bugün olabilir; o gün hiç yoklama yoksa aynı istek ilk kaydı yazar.
 */
export interface CorrectAttendanceInput {
  classId: string
  /** Düzeltilen gün (`YYYY-MM-DD`). */
  date: string
  /** Sınıfın bütün aktif öğrencileri; değişmeyen öğrenciye geçmiş satırı düşülmez. */
  marks: Readonly<Record<string, AttendanceMark>>
  /** Kırpılmış en az 2 karakter (core `attendanceCorrectionReasonSchema`). */
  reason: string
  /** Sınıf kaydının okunan sürümü; `If-Match` zorunludur (başkası değiştirdiyse 409). */
  classVersion: number
}

export type RecordGradeInput = GradeBody

export interface UpdateGradeInput {
  gradeId: string
  score: number
  /** Düzeltme gerekçesi (DOM-AKD-051); öğretmende de zorunludur. */
  reason: string
  /** Notun okunan sürümü; `If-Match` zorunludur (başka biri değiştirdiyse 409). */
  gradeVersion: number
}

/** Başka kullanıcı sınıf kaydını değiştirdi (`If-Match` tutmadı): ekran tazelenir. */
export const ATTENDANCE_CHANGED_MESSAGE =
  'Sınıf kaydı değişti. Liste güncellendi; yoklamayı kontrol edip yeniden kaydedin.'
/** Düzeltme sayfasında çakışma: veri tazelenir, kullanıcının işaretleri ve gerekçesi formda kalır. */
export const ATTENDANCE_CORRECTION_CHANGED_MESSAGE =
  'Kayıt başkası tarafından değişti. Güncel yoklama yeniden yüklendi; düzeltmeyi kontrol edip yeniden kaydedin.'
export const GRADE_CHANGED_MESSAGE =
  'Kayıt değişti. Not güncellendi; güncel puanı kontrol edip yeniden deneyin.'
export const GRADE_NOT_FOUND_MESSAGE = 'Not kaydı bulunamadı.'

/** Koda özgü Türkçe metinler; olmayan kodda sunucunun mesajı gösterilir. */
export const ATTENDANCE_MESSAGES = {
  version_conflict: ATTENDANCE_CHANGED_MESSAGE,
  attendance_class_forbidden: 'Bu sınıfın yoklamasını almak için yetkiniz yok.',
  attendance_correction_admin_only: 'Geçmiş günün yoklamasını yalnızca yönetici düzeltebilir.',
  attendance_future_date: 'Gelecek tarih için yoklama alınamaz.',
  attendance_incomplete: 'Tüm öğrencilerin yoklama durumunu seçin.',
  correction_reason_required: 'Yoklama düzeltmesi için gerekçe yazın.',
} as const satisfies CommandMessages

export const ATTENDANCE_CORRECTION_MESSAGES = {
  ...ATTENDANCE_MESSAGES,
  version_conflict: ATTENDANCE_CORRECTION_CHANGED_MESSAGE,
} as const satisfies CommandMessages

export const GRADE_MESSAGES = {
  version_conflict: GRADE_CHANGED_MESSAGE,
  // Görülemeyen not (başka branş, başka kurum) API'de genel `not_found` olarak döner (404).
  not_found: GRADE_NOT_FOUND_MESSAGE,
  grade_not_found: GRADE_NOT_FOUND_MESSAGE,
  grade_assignment_forbidden: 'Yalnızca ders verdiğiniz sınıf ve ders için not girebilirsiniz.',
  grade_duplicate: 'Bu öğrenciye aynı gün aynı türde not zaten girilmiş.',
  grade_future_date: 'Gelecek tarihli not girilemez.',
  grade_unchanged: 'Not zaten bu puanda.',
  grade_score_from_quiz: 'Quizden aktarılan notun puanı cevaplardan hesaplanır; düzeltilemez.',
} as const satisfies CommandMessages

/** `POST /classes/:classId/attendance` isteği; ayrı verilir ki sahte istemciyle sınanabilsin. */
export function recordAttendanceRequest(
  client: KampusClient,
  { classId, date, marks, reason }: RecordAttendanceInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/classes/{classId}/attendance', {
    params: { path: { classId }, header: headers },
    body: { date, marks: { ...marks }, ...(reason ? { reason } : {}) },
  })
}

/**
 * Düzeltme isteği: aynı uç (`POST /classes/:classId/attendance`), gerekçe her zaman gövdede.
 * Okunan sürüm yoksa istek hiç atılmaz (`requireIfMatch`); sürümsüz yazma başkasının
 * düzeltmesini sessizce ezebilirdi.
 */
export function correctAttendanceRequest(
  client: KampusClient,
  { classId, date, marks, reason }: CorrectAttendanceInput,
  headers: CommandHeaders,
) {
  const ifMatch = requireIfMatch(headers)
  return client.POST('/api/v1/classes/{classId}/attendance', {
    params: { path: { classId }, header: { ...headers, 'if-match': ifMatch } },
    body: { date, marks: { ...marks }, reason },
  })
}

export function recordGradeRequest(
  client: KampusClient,
  input: RecordGradeInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/grades', {
    // `Idempotency-Key` bu uçta zorunludur; `runCommand` her zaman gönderir.
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body: input,
  })
}

export function updateGradeRequest(
  client: KampusClient,
  { gradeId, score, reason }: UpdateGradeInput,
  headers: CommandHeaders,
) {
  const body: GradeUpdateBody = { score, reason }
  return client.PATCH('/api/v1/grades/{gradeId}', {
    params: { path: { gradeId }, header: headers },
    body,
  })
}

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}

/**
 * Sınıf yoklaması (`POST /classes/:classId/attendance`, öğretmen: kendi sınıfı ve aynı gün;
 * yönetici: gerekçeyle düzeltme). Aynı gün ikinci gönderim kaydı günceller. `If-Match` sınıf
 * sürümüdür; başarıda ve çakışmada yoklama ile sınıf sorguları tazelenir.
 */
export function useRecordAttendance(options: CommandOptions = {}) {
  return useApiCommand({
    request: recordAttendanceRequest,
    version: (input: RecordAttendanceInput) => input.classVersion,
    invalidates: [collectionKeyPrefix('attendance'), collectionKeyPrefix('classes')],
    messages: ATTENDANCE_MESSAGES,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

/**
 * Yönetici yoklama düzeltmesi (DOM-AKD-035, IST-093): gerekçe zorunlu, `If-Match` sınıfın okunan
 * sürümü. Başarıda ve 409'da yoklama ile sınıf sorguları tazelenir; 409 mesajı
 * `ATTENDANCE_CORRECTION_CHANGED_MESSAGE`'dır.
 */
export function useCorrectAttendance(options: CommandOptions = {}) {
  return useApiCommand({
    request: correctAttendanceRequest,
    version: (input: CorrectAttendanceInput) => input.classVersion,
    invalidates: [collectionKeyPrefix('attendance'), collectionKeyPrefix('classes')],
    messages: ATTENDANCE_CORRECTION_MESSAGES,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

/** Resmî not girişi (`POST /grades`, atanmış ders öğretmeni); `Idempotency-Key` zorunlu, 201. */
export function useRecordGrade(options: CommandOptions = {}) {
  return useApiCommand({
    request: recordGradeRequest,
    invalidates: [collectionKeyPrefix('grades')],
    messages: GRADE_MESSAGES,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

/**
 * Not düzeltmesi (`PATCH /grades/:gradeId`): gerekçe zorunlu, `If-Match` notun okunan sürümü.
 * Tutmazsa 409 (`GRADE_CHANGED_MESSAGE`) ve liste tazelenir; başka branşın notu 404.
 */
export function useUpdateGrade(options: CommandOptions = {}) {
  return useApiCommand({
    request: updateGradeRequest,
    version: (input: UpdateGradeInput) => input.gradeVersion,
    invalidates: [collectionKeyPrefix('grades')],
    messages: GRADE_MESSAGES,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}
