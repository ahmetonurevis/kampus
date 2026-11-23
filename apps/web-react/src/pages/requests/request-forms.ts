// Talep ve izin/mazeret formlarının saf mantığı: varsayılanlar, ön büro güncelleme gövdesi,
// seçenek listeleri ve sunucu hatasının bağlanacağı alanlar. Kuralın kendisi core'dadır
// (`lib/requests.ts`); burası kullanıcıya geçersiz seçenek göstermemek ve sunucuya gereksiz
// istek atmamak içindir. Karar yine sunucudadır.
import { z } from 'zod'
import {
  ABSENCE_REASON_CATEGORIES,
  ABSENCE_REASON_LABELS,
  REQUEST_STATUSES,
  REQUEST_TEXT_MAX_LENGTH,
  REQUEST_UNITS,
  updateRequestSchema,
  type AbsenceReasonCategory,
  type RequestStatus,
  type openRequestSchema,
} from '@kampus/school-core/lib/requests.ts'
import type { CoreRecord } from '@/hooks/use-core-collection.ts'

type RequestRecord = CoreRecord<'requests'>

export type OpenRequestValues = z.input<typeof openRequestSchema>
export type UpdateRequestBody = z.input<typeof updateRequestSchema>

export function openRequestDefaults(studentId: string): OpenRequestValues {
  return { studentId, category: 'Talep', title: '', text: '' }
}

/**
 * Gerekçe seçenekleri. Gerekçe yalnız kategoridir; serbest açıklama alanı yoktur
 * (DOM-ILT-053, KVKK md. 6). Etiket core tablosundan gelir; liste ve ayrıntıda da aynısı görünür.
 */
export const ABSENCE_REASON_OPTIONS: ReadonlyArray<{
  value: AbsenceReasonCategory
  label: string
}> = ABSENCE_REASON_CATEGORIES.map((value) => ({ value, label: ABSENCE_REASON_LABELS[value] }))

/**
 * Sunucu alan hatasında ilk hatalı alana odak taşır (`setError` seçeneği `shouldFocus`). Form düzeyi
 * (`root`) hata odak almaz ve sırayı tüketmez.
 */
export function focusFirstError<TName extends string>(
  setError: (
    name: TName,
    error: { type: string; message: string },
    options?: { shouldFocus: boolean },
  ) => void,
) {
  let focused = false
  return (name: TName, error: { type: string; message: string }) => {
    const field = !name.startsWith('root')
    setError(name, error, { shouldFocus: field && !focused })
    if (field) focused = true
  }
}

// --- Ön büro güncellemesi ---------------------------------------------------------------------

/**
 * Güncelleme formu: durum ve birim kayıttaki değerdir (listede olmayan eski değer de olabilir);
 * değiştirilirse core şeması (`updateRequestSchema`) denetler. Yanıt boş bırakılabilir, doluysa
 * en az iki karakterdir (core ile aynı sınır).
 */
export const updateFormSchema = z.object({
  status: z.string().min(1, 'Durumu seçin.'),
  assignedTo: z.string().min(1, 'İlgili birimi seçin.'),
  reply: z
    .string()
    .trim()
    .max(REQUEST_TEXT_MAX_LENGTH, `En fazla ${REQUEST_TEXT_MAX_LENGTH} karakter yazabilirsiniz.`)
    .refine((value) => value === '' || value.length >= 2, 'En az iki karakter girin.'),
})
export type UpdateFormValues = z.input<typeof updateFormSchema>

const isStatus = (value: string): value is RequestStatus =>
  (REQUEST_STATUSES as readonly string[]).includes(value)

/** Formun başlangıç değerleri kayıttaki gibidir: dokunulmayan alan değişmiş sayılmaz. */
export function updateDefaults(
  record: Pick<RequestRecord, 'status' | 'assignedTo'>,
): UpdateFormValues {
  return { status: record.status, assignedTo: record.assignedTo, reply: '' }
}

/**
 * Durum seçenekleri. Ele alınmış talep "Yeni"ye dönemez (`request_status_invalid`): seçenek hiç
 * sunulmaz. Listede olmayan mevcut değer seçenek olarak görünür, böylece sessizce başka değere
 * çevrilmez.
 */
export function statusOptions(current: string): readonly string[] {
  if (!isStatus(current)) return [current, ...REQUEST_STATUSES]
  return current === 'Yeni'
    ? REQUEST_STATUSES
    : REQUEST_STATUSES.filter((value) => value !== 'Yeni')
}

/** İlgili birim seçenekleri; listede olmayan mevcut birim de seçenek olarak görünür. */
export function unitOptions(current: string): readonly string[] {
  return (REQUEST_UNITS as readonly string[]).includes(current)
    ? REQUEST_UNITS
    : [current, ...REQUEST_UNITS]
}

export type UpdateOutcome =
  | { ok: true; body: UpdateRequestBody }
  | { ok: false; field: 'status' | 'assignedTo' | 'reply'; message: string }

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
  const body: Partial<Record<'status' | 'assignedTo' | 'reply', string>> = {
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
  // Değişen alan listedeki bir değer olmalı (core şeması); değişmeyen eski değer gönderilmez.
  const parsed = updateRequestSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field =
      issue?.path[0] === 'status' || issue?.path[0] === 'assignedTo' ? issue.path[0] : 'reply'
    return { ok: false, field, message: issue?.message ?? 'Değerleri kontrol edin.' }
  }
  return { ok: true, body: parsed.data }
}
