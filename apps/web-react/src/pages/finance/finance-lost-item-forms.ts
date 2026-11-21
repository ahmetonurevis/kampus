import { z } from 'zod'

import type {
  LostItemCreateBody,
  LostItemHandoverBody,
  LostItemRow,
  LostItemSettingsBody,
  LostItemSettingsData,
  LostReportRow,
} from '@kampus/react-shared/use-finance-lost-items.ts'
import {
  LOST_ITEM_CATEGORIES,
  LOST_ITEM_CATEGORY_LABELS,
  LOST_ITEM_DESCRIPTION_MAX,
  LOST_ITEM_DISPOSAL_OUTCOMES,
  LOST_ITEM_DISPOSAL_REASON_MAX,
  LOST_ITEM_LOCATION_MAX,
  LOST_ITEM_PHOTO_UPLOAD_ROLES,
  LOST_ITEM_RECIPIENT_NAME_MAX,
  LOST_ITEM_RECIPIENT_TYPES,
  LOST_ITEM_RETENTION_MAX_DAYS,
  LOST_ITEM_RETENTION_MIN_DAYS,
  LOST_ITEM_STATUS_LABELS,
  LOST_REPORT_STATUS_LABELS,
  type LostItemCategory,
} from '@kampus/school-core/lib/finance-lost-items.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'

/**
 * Kayıp eşya sekmesinin saf mantığı (DOM-FIN-145; ON-171): kayıt, teslim, bağış/imha ve ayar
 * formlarının şeması ve gövdesi, rozet ve metinler. Bileşen yalnız bunları çağırır; kural ayrıntısı
 * sunucudadır (alan hatası `setError` ile forma döner).
 */

export const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
export const categoryText = (category: LostItemCategory | null) =>
  category === null ? '—' : LOST_ITEM_CATEGORY_LABELS[category]

/** Fotoğraf yüklemesi rolün dosya amacı iznine bağlıdır (geçişte yalnız yönetici; K-490). */
export const canUploadLostItemPhotos = (role: string | undefined) =>
  role !== undefined && (LOST_ITEM_PHOTO_UPLOAD_ROLES as readonly string[]).includes(role)

type Tone = 'green' | 'red' | 'amber' | 'purple' | 'gray'

/** Eşya rozeti: süresi dolan bekleyen uyarılı, eşlenmiş mor, kapananlar gri. */
export function lostItemStatusBadge(
  row: Pick<LostItemRow, 'status' | 'retentionDue' | 'matchedReport'>,
): { text: string; tone: Tone } {
  if (row.status !== 'pending')
    return {
      text: LOST_ITEM_STATUS_LABELS[row.status],
      tone: row.status === 'handed_over' ? 'green' : 'gray',
    }
  if (row.matchedReport !== null) return { text: 'Sahibi bulundu', tone: 'purple' }
  if (row.retentionDue) return { text: 'Saklama süresi doldu', tone: 'red' }
  return { text: LOST_ITEM_STATUS_LABELS.pending, tone: 'amber' }
}

export function lostReportStatusBadge(row: Pick<LostReportRow, 'status'>): {
  text: string
  tone: Tone
} {
  const tone = { open: 'amber', matched: 'purple', returned: 'green', closed: 'gray' } as const
  return { text: LOST_REPORT_STATUS_LABELS[row.status], tone: tone[row.status] }
}

const text = (max: number, label: string, min = 1) =>
  z
    .string()
    .trim()
    .min(min, min === 1 ? `${label} yazın.` : `${label} en az ${String(min)} karakter olmalı.`)
    .max(max, `${label} en çok ${String(max)} karakter olabilir.`)

// --- Hızlı kayıt ---------------------------------------------------------------------------------

export const recordFormSchema = z.object({
  description: text(LOST_ITEM_DESCRIPTION_MAX, 'Eşyanın tanımı', 2),
  category: z.enum(LOST_ITEM_CATEGORIES, 'Kategoriyi seçin.'),
  foundLocation: text(LOST_ITEM_LOCATION_MAX, 'Bulunduğu yeri'),
  foundOn: z.string().min(1, 'Bulunduğu günü seçin.'),
  storageLocation: text(LOST_ITEM_LOCATION_MAX, 'Saklama yerini'),
  finderMembershipId: z.string(),
})
export type RecordFormValues = z.infer<typeof recordFormSchema>

/** Yeni kayıt: bugün, giysi; saklama yeri son kullanılan yerden önerilir. */
export function recordDefaults(today: string, storageLocation = ''): RecordFormValues {
  return {
    description: '',
    category: 'clothing',
    foundLocation: '',
    foundOn: today,
    storageLocation,
    finderMembershipId: '',
  }
}

export function recordBody(
  values: RecordFormValues,
  photoFileIds: readonly string[],
): LostItemCreateBody {
  return {
    description: values.description.trim(),
    category: values.category,
    foundLocation: values.foundLocation.trim(),
    foundOn: values.foundOn,
    storageLocation: values.storageLocation.trim(),
    finderMembershipId: values.finderMembershipId === '' ? null : values.finderMembershipId,
    photoFileIds: [...photoFileIds],
  }
}

const RECORD_FIELDS = [
  'description',
  'category',
  'foundLocation',
  'foundOn',
  'storageLocation',
  'finderMembershipId',
] as const
export const recordFormField = (name: string) => RECORD_FIELDS.find((field) => field === name)

// --- Teslim --------------------------------------------------------------------------------------

export const handoverFormSchema = z
  .object({
    recipientType: z.enum(LOST_ITEM_RECIPIENT_TYPES, 'Teslim alanı seçin.'),
    studentId: z.string(),
    guardianLinkId: z.string(),
    recipientName: z
      .string()
      .trim()
      .max(
        LOST_ITEM_RECIPIENT_NAME_MAX,
        `Ad en çok ${String(LOST_ITEM_RECIPIENT_NAME_MAX)} karakter olabilir.`,
      ),
  })
  .superRefine((value, context) => {
    if (value.recipientType !== 'other' && value.studentId === '')
      context.addIssue({ code: 'custom', path: ['studentId'], message: 'Öğrenciyi seçin.' })
    if (value.recipientType === 'guardian' && value.guardianLinkId === '')
      context.addIssue({ code: 'custom', path: ['guardianLinkId'], message: 'Veliyi seçin.' })
    if (value.recipientType === 'other' && value.recipientName.length < 2)
      context.addIssue({
        code: 'custom',
        path: ['recipientName'],
        message: 'Teslim alanın adını yazın (en az 2 karakter).',
      })
  })
export type HandoverFormValues = z.infer<typeof handoverFormSchema>

/** Eşlenmiş eşyada öğrenci bildirimin öğrencisidir; teslim varsayılanı öğrencinin kendisi. */
export function handoverDefaults(studentId: string | null): HandoverFormValues {
  return {
    recipientType: 'student',
    studentId: studentId ?? '',
    guardianLinkId: '',
    recipientName: '',
  }
}

/** Teslim alan türüne uymayan alan gövdeye girmez. */
export function handoverBody(values: HandoverFormValues): LostItemHandoverBody {
  if (values.recipientType === 'other')
    return { recipientType: 'other', recipientName: values.recipientName.trim() }
  return {
    recipientType: values.recipientType,
    studentId: values.studentId,
    ...(values.recipientType === 'guardian' ? { guardianLinkId: values.guardianLinkId } : {}),
  }
}

// --- Bağış / imha --------------------------------------------------------------------------------

export const disposalFormSchema = z.object({
  outcome: z.enum(LOST_ITEM_DISPOSAL_OUTCOMES, 'Bağış ya da imha seçin.'),
  reason: text(LOST_ITEM_DISPOSAL_REASON_MAX, 'Gerekçe', 2),
})
export type DisposalFormValues = z.infer<typeof disposalFormSchema>
export const DISPOSAL_OUTCOME_LABELS = { donated: 'Bağışlandı', destroyed: 'İmha edildi' } as const

// --- Ayar ----------------------------------------------------------------------------------------

export const settingsFormSchema = z.object({
  retentionDays: z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, 'Süreyi tam gün olarak girin.')
    .refine(
      (value) =>
        Number(value) >= LOST_ITEM_RETENTION_MIN_DAYS &&
        Number(value) <= LOST_ITEM_RETENTION_MAX_DAYS,
      `Süre ${String(LOST_ITEM_RETENTION_MIN_DAYS)}–${String(LOST_ITEM_RETENTION_MAX_DAYS)} gün olmalı.`,
    ),
  familyGalleryEnabled: z.boolean(),
})
export type SettingsFormValues = z.infer<typeof settingsFormSchema>

export const settingsDefaults = (current: LostItemSettingsData): SettingsFormValues => ({
  retentionDays: String(current.retentionDays),
  familyGalleryEnabled: current.familyGalleryEnabled,
})

/** Yalnız değişen alanlar; değişiklik yoksa `null` (istek atılmaz). */
export function settingsBody(
  current: LostItemSettingsData,
  values: SettingsFormValues,
): LostItemSettingsBody | null {
  const retentionDays = Number(values.retentionDays)
  const body: LostItemSettingsBody = {
    ...(retentionDays === current.retentionDays ? {} : { retentionDays }),
    ...(values.familyGalleryEnabled === current.familyGalleryEnabled
      ? {}
      : { familyGalleryEnabled: values.familyGalleryEnabled }),
  }
  return Object.keys(body).length === 0 ? null : body
}
