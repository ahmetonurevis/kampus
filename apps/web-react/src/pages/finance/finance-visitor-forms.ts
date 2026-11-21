import { z } from 'zod'

import type {
  VisitorCheckInBody,
  VisitorRow,
  VisitorSettingsBody,
  VisitorSettingsData,
} from '@kampus/react-shared/use-finance-visitors.ts'
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import {
  normalizeBadgeNumber,
  VISITOR_BADGE_NUMBER_PATTERN,
  VISITOR_BADGE_POOL_MAX,
  VISITOR_ID_DOCUMENT_TYPES,
  VISITOR_NAME_MAX,
  VISITOR_NOTICE_VERSION_MAX,
  VISITOR_PURPOSE_LABELS,
  VISITOR_PURPOSE_NOTE_MAX,
  VISITOR_PURPOSES,
  VISITOR_RETENTION_MAX_DAYS,
  VISITOR_RETENTION_MIN_DAYS,
  type VisitorPurpose,
} from '@kampus/school-core/lib/finance-visitors.ts'

/**
 * Ziyaretçiler sekmesinin saf mantığı (DOM-FIN-141; ON-166): giriş ve ayar formlarının şeması,
 * gövdesi ve tablo metinleri. Bileşen yalnız bunları çağırır; kural ayrıntısı sunucudadır (alan
 * hatası `setError` ile forma döner).
 */

export const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
export const purposeText = (purpose: VisitorPurpose) => VISITOR_PURPOSE_LABELS[purpose]

/** Giriş ve çıkış saati; önceki günden kalan girişte gün de yazılır. */
export function visitTimeText(row: Pick<VisitorRow, 'checkedInAt' | 'checkedOutAt' | 'overdue'>) {
  const checkIn = row.overdue
    ? `${dateLabel(row.checkedInAt)} ${timeLabel(row.checkedInAt)}`
    : timeLabel(row.checkedInAt)
  return row.checkedOutAt === null ? checkIn : `${checkIn} – ${timeLabel(row.checkedOutAt)}`
}

type Tone = 'green' | 'red' | 'amber' | 'purple' | 'gray'

/** Durum rozeti: anonim, önceki günden içeride (uyarı), içeride, çıktı. */
export function visitorStatusBadge(row: Pick<VisitorRow, 'inside' | 'overdue' | 'anonymized'>): {
  text: string
  tone: Tone
} {
  if (row.anonymized) return { text: 'Anonimleştirildi', tone: 'gray' }
  if (row.overdue) return { text: 'Çıkış yapılmadı', tone: 'red' }
  if (row.inside) return { text: 'İçeride', tone: 'green' }
  return { text: 'Çıktı', tone: 'gray' }
}

/** Kart metni: numara ve durum (`A1 · ziyaretçide`). */
export function badgeText(row: Pick<VisitorRow, 'badgeNumber' | 'badgeStatus'>) {
  if (row.badgeNumber === null) return '—'
  const status = {
    none: '',
    out: 'ziyaretçide',
    returned: 'iade edildi',
    lost: 'kayıp',
  }[row.badgeStatus]
  return status === '' ? row.badgeNumber : `${row.badgeNumber} · ${status}`
}

/** Telefon girişinden boşluk, tire ve parantez atılır. */
export const phoneDigits = (value: string) => value.replace(/[\s()-]+/g, '')

const trimmedText = (max: number, maxMessage: string) => z.string().trim().max(max, maxMessage)

export const checkInFormSchema = z
  .object({
    visitorName: z
      .string()
      .trim()
      .min(2, 'Ad soyad en az 2 karakter olmalı.')
      .max(VISITOR_NAME_MAX, `Ad soyad en çok ${String(VISITOR_NAME_MAX)} karakter olabilir.`),
    identityVerified: z.boolean(),
    identityDocumentType: z.enum(['', ...VISITOR_ID_DOCUMENT_TYPES]),
    phone: z
      .string()
      .refine(
        (value) => /^(0\d{10})?$/.test(phoneDigits(value)),
        'Telefonu 0XXXXXXXXXX biçiminde, 11 haneli girin.',
      ),
    purpose: z.enum(VISITOR_PURPOSES, 'Ziyaret amacını seçin.'),
    purposeNote: trimmedText(
      VISITOR_PURPOSE_NOTE_MAX,
      `Açıklama en çok ${String(VISITOR_PURPOSE_NOTE_MAX)} karakter olabilir.`,
    ),
    hostMembershipId: z.string(),
    studentId: z.string(),
    badgeNumber: z.string(),
    privacyNoticeVersion: trimmedText(
      VISITOR_NOTICE_VERSION_MAX,
      `Sürüm en çok ${String(VISITOR_NOTICE_VERSION_MAX)} karakter olabilir.`,
    ).min(1, 'Gösterilen aydınlatma metninin sürümünü yazın.'),
    privacyNoticeShown: z
      .boolean()
      .refine((value) => value, 'Aydınlatma metni gösterilmeden ziyaretçi kaydedilemez.'),
  })
  .superRefine((value, context) => {
    if (value.identityVerified && value.identityDocumentType === '')
      context.addIssue({
        code: 'custom',
        path: ['identityDocumentType'],
        message: 'Görülen belgenin türünü seçin.',
      })
    if (value.purpose === 'other' && value.purposeNote === '')
      context.addIssue({
        code: 'custom',
        path: ['purposeNote'],
        message: '"Diğer" amacında açıklama yazın.',
      })
  })
export type CheckInFormValues = z.infer<typeof checkInFormSchema>

/** Yeni giriş: kimlik görüldü, kimlik kartı, veli görüşmesi; sürüm kurum ayarından önerilir. */
export function checkInDefaults(noticeVersion: string | null): CheckInFormValues {
  return {
    visitorName: '',
    identityVerified: true,
    identityDocumentType: 'national_id',
    phone: '',
    purpose: 'parent_meeting',
    purposeNote: '',
    hostMembershipId: '',
    studentId: '',
    badgeNumber: '',
    privacyNoticeVersion: noticeVersion ?? '',
    privacyNoticeShown: false,
  }
}

export function checkInBody(values: CheckInFormValues): VisitorCheckInBody {
  const phone = phoneDigits(values.phone)
  const purposeNote = values.purposeNote.trim()
  return {
    visitorName: values.visitorName.trim(),
    identityVerified: values.identityVerified,
    identityDocumentType:
      values.identityVerified && values.identityDocumentType !== ''
        ? values.identityDocumentType
        : null,
    phone: phone === '' ? null : phone,
    purpose: values.purpose,
    purposeNote: purposeNote === '' ? null : purposeNote,
    hostMembershipId: values.hostMembershipId === '' ? null : values.hostMembershipId,
    studentId:
      values.purpose === 'parent_meeting' && values.studentId !== '' ? values.studentId : null,
    badgeNumber: values.badgeNumber === '' ? null : values.badgeNumber,
    privacyNoticeVersion: values.privacyNoticeVersion.trim(),
  }
}

const CHECK_IN_FIELDS = [
  'visitorName',
  'identityDocumentType',
  'phone',
  'purpose',
  'purposeNote',
  'hostMembershipId',
  'studentId',
  'badgeNumber',
  'privacyNoticeVersion',
] as const
/** Sunucu alanını forma eşler; eşleşmeyen alan kök hatadır. */
export function checkInFormField(name: string): (typeof CHECK_IN_FIELDS)[number] | null {
  return CHECK_IN_FIELDS.find((field) => field === name) ?? null
}

/** Kart havuzu metni: virgül, boşluk ya da satır sonuyla ayrılmış numaralar. */
export const parseBadgeList = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map(normalizeBadgeNumber)
    .filter((value) => value !== '')

export const settingsFormSchema = z.object({
  retentionDays: z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, 'Süreyi tam gün olarak girin.')
    .refine(
      (value) =>
        Number(value) >= VISITOR_RETENTION_MIN_DAYS && Number(value) <= VISITOR_RETENTION_MAX_DAYS,
      `Süre ${String(VISITOR_RETENTION_MIN_DAYS)}–${String(VISITOR_RETENTION_MAX_DAYS)} gün olmalı.`,
    ),
  privacyNoticeVersion: trimmedText(
    VISITOR_NOTICE_VERSION_MAX,
    `Sürüm en çok ${String(VISITOR_NOTICE_VERSION_MAX)} karakter olabilir.`,
  ),
  badgeNumbers: z.string().superRefine((text, context) => {
    const numbers = parseBadgeList(text)
    const invalid = numbers.find((value) => !VISITOR_BADGE_NUMBER_PATTERN.test(value))
    if (invalid !== undefined)
      context.addIssue({
        code: 'custom',
        message: `"${invalid}" geçersiz; kart numarası harf, rakam ve tireden oluşur.`,
      })
    else if (new Set(numbers).size !== numbers.length)
      context.addIssue({ code: 'custom', message: 'Aynı kart iki kez yazılmış.' })
    else if (numbers.length > VISITOR_BADGE_POOL_MAX)
      context.addIssue({
        code: 'custom',
        message: `Kart havuzunda en çok ${String(VISITOR_BADGE_POOL_MAX)} kart olur.`,
      })
  }),
})
export type SettingsFormValues = z.infer<typeof settingsFormSchema>

export function settingsDefaults(current: VisitorSettingsData): SettingsFormValues {
  return {
    retentionDays: String(current.retentionDays),
    privacyNoticeVersion: current.privacyNoticeVersion ?? '',
    badgeNumbers: current.badgeNumbers.join(', '),
  }
}

/** Yalnız değişen alanlar; değişiklik yoksa `null`. */
export function settingsBody(
  current: VisitorSettingsData,
  values: SettingsFormValues,
): VisitorSettingsBody | null {
  const days = Number(values.retentionDays)
  const version = values.privacyNoticeVersion.trim()
  const badges = parseBadgeList(values.badgeNumbers)
  const body: VisitorSettingsBody = {
    ...(days === current.retentionDays ? {} : { retentionDays: days }),
    ...((version === '' ? null : version) === current.privacyNoticeVersion
      ? {}
      : { privacyNoticeVersion: version === '' ? null : version }),
    ...(badges.join(',') === current.badgeNumbers.join(',') ? {} : { badgeNumbers: badges }),
  }
  return Object.keys(body).length === 0 ? null : body
}

const SETTINGS_FIELDS = ['retentionDays', 'privacyNoticeVersion', 'badgeNumbers'] as const
export function settingsFormField(name: string): (typeof SETTINGS_FIELDS)[number] | null {
  return SETTINGS_FIELDS.find((field) => field === name) ?? null
}
