// Talep ve izin/mazeret formlarının saf mantığı: varsayılanlar, ön büro güncelleme gövdesi,
// seçenek listeleri ve sunucu hatasının bağlanacağı alanlar. Kuralın kendisi core'dadır
// (`lib/requests.ts`); burası kullanıcıya geçersiz seçenek göstermemek ve sunucuya gereksiz
// istek atmamak içindir. Karar yine sunucudadır.
import { z } from 'zod'
import {
  ABSENCE_REASON_CATEGORIES,
  REQUEST_STATUSES,
  REQUEST_TEXT_MAX_LENGTH,
  REQUEST_UNITS,
  type AbsenceReasonCategory,
  type RequestStatus,
  type openRequestSchema,
  type updateRequestSchema,
} from '@kampus/school-core/lib/requests.ts'
import type { CoreRecord } from '@/hooks/use-core-collection.ts'

type RequestRecord = CoreRecord<'requests'>

export type OpenRequestValues = z.input<typeof openRequestSchema>
export type UpdateRequestBody = z.input<typeof updateRequestSchema>

export function openRequestDefaults(studentId: string): OpenRequestValues {
  return { studentId, category: 'Talep', title: '', text: '' }
}

const ABSENCE_REASON_LABELS: Record<AbsenceReasonCategory, string> = {
  health: 'Sağlık',
  family: 'Aile',
  official: 'Resmî işlem',
  other: 'Diğer',
}

/**
 * Gerekçe seçenekleri. Gerekçe yalnız kategoridir; serbest açıklama alanı yoktur
 * (DOM-ILT-053, KVKK md. 6). Listede ve ayrıntıda kategorinin core etiketi görünür.
 */
export const ABSENCE_REASON_OPTIONS: ReadonlyArray<{
  value: AbsenceReasonCategory
  label: string
}> = ABSENCE_REASON_CATEGORIES.map((value) => ({ value, label: ABSENCE_REASON_LABELS[value] }))

/** Sunucu kodu → hatanın gösterileceği alan. Yollu hata (`issues`) kendi yolundaki alana düşer. */
export const OPEN_REQUEST_ERROR_FIELDS = {
  student_inactive: 'studentId',
  student_scope_denied: 'studentId',
} as const

export const UPDATE_REQUEST_ERROR_FIELDS = {
  request_resolved: 'status',
  request_status_invalid: 'status',
  request_unchanged: 'reply',
} as const

export const ABSENCE_ERROR_FIELDS = {
  student_inactive: 'studentId',
  student_scope_denied: 'studentId',
  absence_notice_late: 'endDate',
  absence_overlap: 'startDate',
} as const

// --- Ön büro güncellemesi ---------------------------------------------------------------------

/** Güncelleme formu: yanıt boş bırakılabilir, doluysa en az iki karakterdir (core ile aynı sınır). */
export const updateFormSchema = z.object({
  status: z.enum(REQUEST_STATUSES, 'Durumu seçin.'),
  assignedTo: z.enum(REQUEST_UNITS, 'İlgili birimi seçin.'),
  reply: z
    .string()
    .trim()
    .max(REQUEST_TEXT_MAX_LENGTH, `En fazla ${REQUEST_TEXT_MAX_LENGTH} karakter yazabilirsiniz.`)
    .refine((value) => value === '' || value.length >= 2, 'En az iki karakter girin.'),
})
export type UpdateFormValues = z.input<typeof updateFormSchema>

const isStatus = (value: string): value is RequestStatus =>
  (REQUEST_STATUSES as readonly string[]).includes(value)
const isUnit = (value: string): value is (typeof REQUEST_UNITS)[number] =>
  (REQUEST_UNITS as readonly string[]).includes(value)

export function updateDefaults(
  record: Pick<RequestRecord, 'status' | 'assignedTo'>,
): UpdateFormValues {
  return {
    status: isStatus(record.status) ? record.status : 'Yeni',
    // Kayıttaki birim listede yoksa (eski kayıt) ilk birim seçili gelir; kullanıcı bilerek seçer.
    assignedTo: isUnit(record.assignedTo) ? record.assignedTo : REQUEST_UNITS[0],
    reply: '',
  }
}

/** Ele alınmış talep "Yeni"ye dönemez (`request_status_invalid`): seçenek hiç sunulmaz. */
export function statusOptions(current: string): readonly RequestStatus[] {
  return current === 'Yeni' || !isStatus(current)
    ? REQUEST_STATUSES
    : REQUEST_STATUSES.filter((value) => value !== 'Yeni')
}

export type UpdateOutcome =
  { ok: true; body: UpdateRequestBody } | { ok: false; field: 'status' | 'reply'; message: string }

/**
 * Yalnız değişen alanlar gönderilir (core `updateRequest`). Değişiklik yoksa ya da çözülmüş
 * talebe durumu açmadan dokunulursa istek atılmaz; mesajlar sunucuyla aynıdır (aynı kural,
 * ağ gidiş gelişi olmadan).
 */
export function updateRequestBody(
  record: Pick<RequestRecord, 'status' | 'assignedTo'>,
  values: UpdateFormValues,
): UpdateOutcome {
  const reply = values.reply.trim()
  const body: UpdateRequestBody = {
    ...(values.status !== record.status ? { status: values.status } : {}),
    ...(values.assignedTo !== record.assignedTo ? { assignedTo: values.assignedTo } : {}),
    ...(reply !== '' ? { reply } : {}),
  }
  if (Object.keys(body).length === 0)
    return {
      ok: false,
      field: 'reply',
      message: 'Değişiklik yok: durumu veya birimi değiştirin ya da yanıt yazın.',
    }
  if (record.status === 'Çözüldü' && values.status === 'Çözüldü')
    return {
      ok: false,
      field: 'status',
      message: 'Çözülen talep değiştirilemez; önce durumu "İnceleniyor" yapın.',
    }
  return { ok: true, body }
}
