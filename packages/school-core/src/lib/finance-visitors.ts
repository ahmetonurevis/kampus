import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { DomainError } from './errors.ts'
import { addDays } from './finance-opening-watch.ts'
import { dayKey } from './format.ts'
import { maskPhone } from './parent-contact.ts'
import { STAFF_ROLES } from './staff-accounts.ts'

/**
 * Ziyaretçi kaydı (docs/domain/finans.md DOM-FIN-141; ON-166). Ön büro kuruma gelen ziyaretçiyi
 * girişte kaydeder: ad soyad, kimliğin görülüp görülmediği ve görülen belgenin türü (kimlik numarası
 * saklanmaz), isteğe bağlı telefon (yalnız maskeli gösterilir), ziyaret amacı, isteğe bağlı ziyaret
 * edilen personel (kurum üyeliği) ve veli görüşmesinde öğrenci, giriş anı, kurum havuzundan
 * ziyaretçi kartı ve gösterilen aydınlatma metninin sürümü (zorunlu) (K-478). Çıkış ve kart iadesi
 * ayrı kayıttır; kart iade edilene (ya da kayıp işaretlenene) kadar başka ziyaretçiye verilmez,
 * içeride kalanlar gün sonu listesinde görünür (K-479).
 *
 * Saklama (K-480): kayıt ziyaret gününden başlayarak kurum ayarlı kısa süre (gün; varsayılan 30)
 * saklanır; süresi dolanlar listelenir ve yöneticinin komutuyla anonimleştirilir. Arka plan imhası
 * yoktur. Süre ve kimlik görme biçimi **doğrulanmalı** (H-104). Fonksiyonlar saftır; zaman `now`,
 * gün `today` (Europe/Istanbul) ile gelir.
 */

/** Giriş, çıkış, kart iadesi, liste, ayrıntı ve ayar okuma: yönetici ve ön büro (K-478). */
export const FINANCE_VISITOR_ROLES = ['yonetici', 'onburo'] as const satisfies readonly Role[]
/** Ayar yazma, saklama listesi ve anonimleştirme: yalnız yönetici (K-480). */
export const FINANCE_VISITOR_MANAGE_ROLES = ['yonetici'] as const satisfies readonly Role[]

export const VISITOR_PURPOSES = [
  'parent_meeting',
  'supplier',
  'official',
  'job_applicant',
  'other',
] as const
export type VisitorPurpose = (typeof VISITOR_PURPOSES)[number]
export const VISITOR_PURPOSE_LABELS = {
  parent_meeting: 'Veli görüşmesi',
  supplier: 'Tedarikçi',
  official: 'Resmî ziyaret',
  job_applicant: 'İş başvurusu',
  other: 'Diğer',
} as const satisfies Record<VisitorPurpose, string>

/** Görülen kimlik belgesinin türü; belge numarası hiçbir yerde saklanmaz (K-478). */
export const VISITOR_ID_DOCUMENT_TYPES = [
  'national_id',
  'driver_license',
  'passport',
  'other',
] as const
export type VisitorIdDocumentType = (typeof VISITOR_ID_DOCUMENT_TYPES)[number]
export const VISITOR_ID_DOCUMENT_TYPE_LABELS = {
  national_id: 'Kimlik kartı',
  driver_license: 'Sürücü belgesi',
  passport: 'Pasaport',
  other: 'Diğer belge',
} as const satisfies Record<VisitorIdDocumentType, string>

/** Kartın kapanışı: iade edildi ya da kayıp (K-479). */
export const VISITOR_BADGE_RELEASES = ['returned', 'lost'] as const
export type VisitorBadgeRelease = (typeof VISITOR_BADGE_RELEASES)[number]
export const VISITOR_BADGE_RELEASE_LABELS = {
  returned: 'İade edildi',
  lost: 'Kayıp',
} as const satisfies Record<VisitorBadgeRelease, string>

export const VISITOR_ANONYMIZATION_REASONS = ['retention_expired', 'data_subject_request'] as const
export type VisitorAnonymizationReason = (typeof VISITOR_ANONYMIZATION_REASONS)[number]
export const VISITOR_ANONYMIZATION_REASON_LABELS = {
  retention_expired: 'Saklama süresi doldu',
  data_subject_request: 'Ziyaretçinin silme talebi',
} as const satisfies Record<VisitorAnonymizationReason, string>

/** Anonimleştirilen kaydın ad alanına yazılan sabit metin (K-480). */
export const ANONYMIZED_VISITOR_NAME = 'Anonim ziyaretçi'

export const VISITOR_NAME_MAX = 120
export const VISITOR_PURPOSE_NOTE_MAX = 200
export const VISITOR_NOTICE_VERSION_MAX = 40
export const VISITOR_BADGE_NUMBER_MAX = 20
export const VISITOR_BADGE_POOL_MAX = 200
export const VISITOR_ANONYMIZATION_BATCH_MAX = 100
export const VISITOR_RETENTION_DEFAULT_DAYS = 30
export const VISITOR_RETENTION_MIN_DAYS = 1
export const VISITOR_RETENTION_MAX_DAYS = 365
/** Unutulan girişin sonradan kaydı en çok bu kadar geriye gider (K-478). */
export const VISITOR_CHECK_IN_BACKDATE_HOURS = 24
const HOUR_MS = 3_600_000
const VISITOR_PHONE_PATTERN = /^0\d{10}$/
export const VISITOR_BADGE_NUMBER_PATTERN = /^[A-Z0-9-]{1,20}$/

// --- Şemalar -------------------------------------------------------------------------------------

const instant = (message: string) => z.iso.datetime({ offset: true, error: message })

const optionalText = (max: number, label: string) =>
  z
    .string(`${label} metin olmalı.`)
    .trim()
    .max(max, `${label} en çok ${String(max)} karakter olabilir.`)
    .transform((value) => (value === '' ? null : value))
    .nullable()

/** Kart numarası büyük harfe çekilir ve boşlukları atılır (`a-12 ` → `A-12`). */
export const normalizeBadgeNumber = (value: string) => value.trim().toUpperCase()

const badgeNumberSchema = z
  .string('Kart numarasını yazın.')
  .transform(normalizeBadgeNumber)
  .pipe(
    z
      .string()
      .regex(
        VISITOR_BADGE_NUMBER_PATTERN,
        `Kart numarası harf, rakam ve tireden oluşur (en çok ${String(VISITOR_BADGE_NUMBER_MAX)} karakter).`,
      ),
  )

const visitorPhoneSchema = z
  .string('Telefonu yazın.')
  .transform((value) => value.replace(/[\s()-]+/g, ''))
  .transform((value) => (value === '' ? null : value))
  .pipe(
    z
      .string()
      .regex(VISITOR_PHONE_PATTERN, 'Telefonu 0XXXXXXXXXX biçiminde, 11 haneli girin.')
      .nullable(),
  )
  .nullable()

export const visitorCheckInSchema = z
  .strictObject({
    // kvkk: K (ziyaretçi kimliği)
    visitorName: z
      .string('Ziyaretçinin adını yazın.')
      .trim()
      .min(2, 'Ad soyad en az 2 karakter olmalı.')
      .max(VISITOR_NAME_MAX, `Ad soyad en çok ${String(VISITOR_NAME_MAX)} karakter olabilir.`)
      .describe('Ziyaretçinin adı soyadı (2–120)'),
    identityVerified: z
      .boolean('Kimliğin görülüp görülmediğini işaretleyin.')
      .describe('Kimlik belgesi görüldü mü; kimlik numarası gönderilmez ve saklanmaz'),
    identityDocumentType: z
      .enum(VISITOR_ID_DOCUMENT_TYPES, 'Görülen belgenin türünü seçin.')
      .nullable()
      .default(null)
      .describe(
        'Görülen belge: `national_id` kimlik kartı, `driver_license` sürücü belgesi, `passport` pasaport, `other` diğer; yalnız kimlik görüldüyse ve o zaman zorunlu',
      ),
    // kvkk: K (ziyaretçi iletişimi)
    phone: visitorPhoneSchema
      .default(null)
      .describe('Telefon (isteğe bağlı, 0XXXXXXXXXX); yanıtlarda yalnız maskeli döner'),
    purpose: z
      .enum(VISITOR_PURPOSES, 'Ziyaret amacını seçin.')
      .describe(
        '`parent_meeting` veli görüşmesi, `supplier` tedarikçi, `official` resmî, `job_applicant` iş başvurusu, `other` diğer',
      ),
    // kvkk: K (serbest metin)
    purposeNote: optionalText(VISITOR_PURPOSE_NOTE_MAX, 'Açıklama')
      .default(null)
      .describe('Amaç açıklaması (≤ 200); `other` amacında zorunlu; denetime ve loga yazılmaz'),
    hostMembershipId: z
      .string('Ziyaret edilen kişiyi seçin.')
      .trim()
      .min(1, 'Ziyaret edilen kişiyi seçin.')
      .nullable()
      .default(null)
      .describe('Ziyaret edilen personelin kurum üyeliği (isteğe bağlı; etkin personel)'),
    studentId: z
      .string('Öğrenciyi seçin.')
      .trim()
      .min(1, 'Öğrenciyi seçin.')
      .nullable()
      .default(null)
      .describe('Veli görüşmesinde görüşülen öğrenci (isteğe bağlı; yalnız `parent_meeting`)'),
    checkedInAt: instant('Giriş saatini girin.')
      .nullable()
      .default(null)
      .describe('Giriş anı (ISO 8601); boşsa şimdi. Gelecek ve 24 saatten eski olamaz'),
    badgeNumber: badgeNumberSchema
      .nullable()
      .default(null)
      .describe('Verilen ziyaretçi kartı (kurum havuzundan, isteğe bağlı)'),
    privacyNoticeVersion: z
      .string('Aydınlatma metni sürümünü yazın.')
      .trim()
      .min(1, 'Aydınlatma metni gösterilmeden ziyaretçi kaydedilemez; gösterilen sürümü yazın.')
      .max(
        VISITOR_NOTICE_VERSION_MAX,
        `Sürüm en çok ${String(VISITOR_NOTICE_VERSION_MAX)} karakter olabilir.`,
      )
      .describe('Ziyaretçiye gösterilen aydınlatma metninin sürümü (zorunlu; gösterildi işareti)'),
  })
  .superRefine((value, context) => {
    if (value.identityVerified && value.identityDocumentType === null)
      context.addIssue({
        code: 'custom',
        path: ['identityDocumentType'],
        message: 'Görülen belgenin türünü seçin.',
      })
    if (!value.identityVerified && value.identityDocumentType !== null)
      context.addIssue({
        code: 'custom',
        path: ['identityDocumentType'],
        message: 'Kimlik görülmediyse belge türü seçilmez.',
      })
    if (value.purpose === 'other' && value.purposeNote === null)
      context.addIssue({
        code: 'custom',
        path: ['purposeNote'],
        message: '"Diğer" amacında açıklama yazın.',
      })
    if (value.studentId !== null && value.purpose !== 'parent_meeting')
      context.addIssue({
        code: 'custom',
        path: ['studentId'],
        message: 'Öğrenci yalnız veli görüşmesinde seçilir.',
      })
  })
export type VisitorCheckInInput = z.input<typeof visitorCheckInSchema>
export type VisitorCheckInFields = z.output<typeof visitorCheckInSchema>

export const visitorCheckOutSchema = z.strictObject({
  checkedOutAt: instant('Çıkış saatini girin.')
    .nullable()
    .default(null)
    .describe('Çıkış anı (ISO 8601); boşsa şimdi. Girişten önce ve gelecekte olamaz'),
  badgeReturned: z
    .boolean('Kartın iade edilip edilmediğini işaretleyin.')
    .default(true)
    .describe('Kart çıkışta iade edildi mi (varsayılan evet); kartsız ziyarette yok sayılır'),
})
export type VisitorCheckOutFields = z.output<typeof visitorCheckOutSchema>

export const visitorBadgeReleaseSchema = z.strictObject({
  outcome: z
    .enum(VISITOR_BADGE_RELEASES, 'Kartın durumunu seçin.')
    .describe('`returned` iade edildi, `lost` kayıp (kart havuzda serbest kalır)'),
})
export type VisitorBadgeReleaseFields = z.output<typeof visitorBadgeReleaseSchema>

export const visitorAnonymizationSchema = z.strictObject({
  visitorIds: z
    .array(z.uuid('Ziyaret kaydı geçersiz.'), 'Ziyaret kayıtlarını seçin.')
    .min(1, 'En az bir kayıt seçin.')
    .max(
      VISITOR_ANONYMIZATION_BATCH_MAX,
      `Tek seferde en çok ${String(VISITOR_ANONYMIZATION_BATCH_MAX)} kayıt anonimleştirilir.`,
    )
    .refine((ids) => new Set(ids).size === ids.length, 'Aynı kayıt iki kez seçilmiş.')
    .describe('Anonimleştirilecek ziyaret kayıtları (1–100)'),
  reason: z
    .enum(VISITOR_ANONYMIZATION_REASONS, 'Gerekçeyi seçin.')
    .describe(
      '`retention_expired` saklama süresi dolanlar, `data_subject_request` ziyaretçinin silme talebi (süre beklenmez)',
    ),
})
export type VisitorAnonymizationFields = z.output<typeof visitorAnonymizationSchema>

export const visitorSettingsSchema = z
  .strictObject({
    retentionDays: z
      .number('Saklama süresini gün olarak girin.')
      .int('Süre tam gün olmalı.')
      .min(
        VISITOR_RETENTION_MIN_DAYS,
        `Süre en az ${String(VISITOR_RETENTION_MIN_DAYS)} gün olmalı.`,
      )
      .max(
        VISITOR_RETENTION_MAX_DAYS,
        `Süre en çok ${String(VISITOR_RETENTION_MAX_DAYS)} gün olabilir.`,
      )
      .optional()
      .describe('Saklama süresi (gün, 1–365; varsayılan 30)'),
    privacyNoticeVersion: optionalText(VISITOR_NOTICE_VERSION_MAX, 'Sürüm')
      .optional()
      .describe('Geçerli ziyaretçi aydınlatma metninin sürümü; giriş formunda önerilir'),
    badgeNumbers: z
      .array(badgeNumberSchema, 'Kart numaralarını girin.')
      .max(
        VISITOR_BADGE_POOL_MAX,
        `Kart havuzunda en çok ${String(VISITOR_BADGE_POOL_MAX)} kart olur.`,
      )
      .refine((numbers) => new Set(numbers).size === numbers.length, 'Aynı kart iki kez yazılmış.')
      .optional()
      .describe('Kurumun ziyaretçi kartı havuzu (0–200 numara; harf, rakam, tire)'),
  })
  .superRefine((value, context) => {
    if (
      value.retentionDays === undefined &&
      value.privacyNoticeVersion === undefined &&
      value.badgeNumbers === undefined
    )
      context.addIssue({ code: 'custom', path: [], message: 'En az bir alanı değiştirin.' })
  })
export type VisitorSettingsFields = z.output<typeof visitorSettingsSchema>

export interface VisitorSettings {
  retentionDays: number
  privacyNoticeVersion: string | null
  badgeNumbers: string[]
}
export const DEFAULT_VISITOR_SETTINGS: VisitorSettings = {
  retentionDays: VISITOR_RETENTION_DEFAULT_DAYS,
  privacyNoticeVersion: null,
  badgeNumbers: [],
}

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string[]) =>
  new DomainError(code, message, { kind: 'rule', path })

export interface VisitorCheckInChecks {
  now: Date
  /** Ziyaret edilen üyelik: seçilmediyse `undefined`, kurumda yoksa `null`. */
  host: { role: string; active: boolean } | null | undefined
  /** Öğrenci seçildiyse kurumda var mı; seçilmediyse `undefined`. */
  studentExists: boolean | undefined
  badgePool: readonly string[]
  /** Kart iade edilmemiş başka ziyarette mi. */
  badgeInUse: boolean
}

/**
 * Giriş kuralı (K-478, K-479): giriş anı gelecekte ve 24 saatten eski olamaz; ziyaret edilen kişi
 * kurumun etkin personeli, öğrenci kurumun öğrencisi olmalı; kart havuzda olmalı ve iade edilmemiş
 * başka ziyarette olmamalı (409). Giriş anı ve ziyaret günü (Europe/Istanbul) döner.
 */
export function planVisitorCheckIn(
  input: Pick<
    VisitorCheckInFields,
    'checkedInAt' | 'hostMembershipId' | 'studentId' | 'badgeNumber'
  >,
  checks: VisitorCheckInChecks,
): { checkedInAt: string; visitOn: string } {
  const at = input.checkedInAt === null ? checks.now : new Date(input.checkedInAt)
  if (at.getTime() > checks.now.getTime())
    throw ruleError('visitor_check_in_future', 'Giriş saati şimdiden sonra olamaz.', [
      'checkedInAt',
    ])
  if (checks.now.getTime() - at.getTime() > VISITOR_CHECK_IN_BACKDATE_HOURS * HOUR_MS)
    throw ruleError(
      'visitor_check_in_too_old',
      `Giriş en çok ${String(VISITOR_CHECK_IN_BACKDATE_HOURS)} saat geriye kaydedilir.`,
      ['checkedInAt'],
    )
  if (input.hostMembershipId !== null) {
    if (checks.host === null || checks.host === undefined)
      throw ruleError('visitor_host_not_found', 'Ziyaret edilen kişi bulunamadı.', [
        'hostMembershipId',
      ])
    if (!(STAFF_ROLES as readonly string[]).includes(checks.host.role))
      throw ruleError('visitor_host_not_staff', 'Ziyaret edilen kişi kurum personeli olmalı.', [
        'hostMembershipId',
      ])
    if (!checks.host.active)
      throw ruleError('visitor_host_inactive', 'Ziyaret edilen kişinin hesabı pasif.', [
        'hostMembershipId',
      ])
  }
  if (input.studentId !== null && checks.studentExists !== true)
    throw ruleError('visitor_student_not_found', 'Öğrenci bulunamadı.', ['studentId'])
  if (input.badgeNumber !== null) {
    if (!checks.badgePool.includes(input.badgeNumber))
      throw ruleError('visitor_badge_unknown', 'Bu kart kurumun kart havuzunda yok.', [
        'badgeNumber',
      ])
    if (checks.badgeInUse)
      throw new DomainError(
        'visitor_badge_in_use',
        'Bu kart iade edilmemiş başka bir ziyaretçide; başka kart seçin.',
        { kind: 'conflict', path: ['badgeNumber'] },
      )
  }
  return { checkedInAt: at.toISOString(), visitOn: dayKey(at) }
}

export interface StoredVisitorState {
  checkedInAt: string
  checkedOutAt: string | null
  badgeNumber: string | null
  badgeReleasedAt: string | null
  anonymizedAt: string | null
}

const assertNotAnonymized = (current: Pick<StoredVisitorState, 'anonymizedAt'>) => {
  if (current.anonymizedAt !== null)
    throw ruleError('visitor_anonymized', 'Anonimleştirilmiş ziyaret kaydı değiştirilemez.', [])
}

/** Kart ziyaretçide mi (verilmiş ve kapanmamış). */
export const badgeOutstanding = (
  state: Pick<StoredVisitorState, 'badgeNumber' | 'badgeReleasedAt'>,
) => state.badgeNumber !== null && state.badgeReleasedAt === null

/**
 * Çıkış (K-479): bir kez yapılır; çıkış anı girişten önce ve şimdiden sonra olamaz. Kart iade
 * edildiyse kart aynı anda kapanır; edilmediyse ziyaretçide kalır ve sonra iade ya da kayıp
 * işaretlenir.
 */
export function planVisitorCheckOut(
  current: StoredVisitorState,
  input: VisitorCheckOutFields,
  now: Date,
): { checkedOutAt: string; badgeRelease: VisitorBadgeRelease | null } {
  assertNotAnonymized(current)
  if (current.checkedOutAt !== null)
    throw ruleError('visitor_already_checked_out', 'Ziyaretçinin çıkışı zaten kaydedilmiş.', [])
  const at = input.checkedOutAt === null ? now : new Date(input.checkedOutAt)
  if (at.getTime() > now.getTime())
    throw ruleError('visitor_check_out_future', 'Çıkış saati şimdiden sonra olamaz.', [
      'checkedOutAt',
    ])
  if (at.getTime() < new Date(current.checkedInAt).getTime())
    throw ruleError('visitor_check_out_before_check_in', 'Çıkış saati girişten önce olamaz.', [
      'checkedOutAt',
    ])
  return {
    checkedOutAt: at.toISOString(),
    badgeRelease: badgeOutstanding(current) && input.badgeReturned ? 'returned' : null,
  }
}

/** Kart iadesi ya da kayıp (K-479): kart verilmiş ve henüz kapanmamış olmalı. */
export function planVisitorBadgeRelease(
  current: StoredVisitorState,
  input: VisitorBadgeReleaseFields,
): VisitorBadgeRelease {
  assertNotAnonymized(current)
  if (current.badgeNumber === null)
    throw ruleError('visitor_no_badge', 'Bu ziyaretçiye kart verilmemiş.', [])
  if (current.badgeReleasedAt !== null)
    throw ruleError('visitor_badge_already_released', 'Kart zaten iade edilmiş ya da kayıp.', [])
  return input.outcome
}

/**
 * Ayar güncellemesi (K-479, K-480): gönderilmeyen alan korunur; iade edilmemiş kart havuzdan
 * çıkarılamaz; değişiklik yoksa 422. Değişen alan adları döner.
 */
export function planVisitorSettings(
  current: VisitorSettings,
  input: VisitorSettingsFields,
  outstandingBadges: readonly string[],
): { next: VisitorSettings; changed: string[] } {
  const next: VisitorSettings = {
    retentionDays: input.retentionDays ?? current.retentionDays,
    privacyNoticeVersion:
      input.privacyNoticeVersion === undefined
        ? current.privacyNoticeVersion
        : input.privacyNoticeVersion,
    badgeNumbers: input.badgeNumbers ?? current.badgeNumbers,
  }
  const sameBadges =
    next.badgeNumbers.length === current.badgeNumbers.length &&
    next.badgeNumbers.every((badge, index) => badge === current.badgeNumbers[index])
  const changed = [
    ...(next.retentionDays === current.retentionDays ? [] : ['retentionDays']),
    ...(next.privacyNoticeVersion === current.privacyNoticeVersion ? [] : ['privacyNoticeVersion']),
    ...(sameBadges ? [] : ['badgeNumbers']),
  ]
  if (changed.length === 0)
    throw ruleError('visitor_settings_unchanged', 'Ayarda değişiklik yok.', [])
  const removedInUse = outstandingBadges.find((badge) => !next.badgeNumbers.includes(badge))
  if (removedInUse !== undefined)
    throw ruleError(
      'visitor_settings_badge_in_use',
      `${removedInUse} numaralı kart bir ziyaretçide; iade edilmeden havuzdan çıkarılamaz.`,
      ['badgeNumbers'],
    )
  return { next, changed }
}

// --- Görünüm ve saklama --------------------------------------------------------------------------

/** Telefon yalnız maskeli gösterilir (K-478): `0532 *** ** 67`. */
export const maskVisitorPhone = (phone: string | null) => (phone === null ? null : maskPhone(phone))

/** Saklama süresinin dolduğu gün: ziyaret günü + süre (K-480); süre bu gün dolar. */
export const visitorRetentionDueOn = (visitOn: string, retentionDays: number) =>
  addDays(visitOn, retentionDays)

/** İçeride ve ziyaret günü bugünden önce: gün sonunda çıkışı yapılmamış (K-479). */
export const visitorOverdue = (
  state: Pick<StoredVisitorState, 'checkedOutAt' | 'anonymizedAt'> & { visitOn: string },
  today: string,
) => state.checkedOutAt === null && state.anonymizedAt === null && state.visitOn < today

export interface VisitorAnonymizationTarget {
  id: string
  visitOn: string
  checkedOutAt: string | null
  anonymizedAt: string | null
}

/**
 * Anonimleştirme kuralı (K-480): her kayıt kurumda, anonimleştirilmemiş ve çıkışı yapılmış olmalı;
 * süre gerekçesinde süre sonu bugün ya da önce olmalı, ziyaretçinin silme talebinde süre beklenmez.
 * Hata yolu kaydın dizideki sırasıdır; biri reddedilirse hiçbiri değişmez.
 */
export function assertVisitorAnonymization(
  input: VisitorAnonymizationFields,
  found: ReadonlyMap<string, VisitorAnonymizationTarget>,
  checks: { retentionDays: number; today: string },
): void {
  for (const [index, id] of input.visitorIds.entries()) {
    const path = ['visitorIds', String(index)]
    const target = found.get(id)
    if (target === undefined)
      throw ruleError('visitor_not_found', 'Ziyaret kaydı bulunamadı.', path)
    if (target.anonymizedAt !== null)
      throw ruleError('visitor_already_anonymized', 'Kayıt zaten anonimleştirilmiş.', path)
    if (target.checkedOutAt === null)
      throw ruleError(
        'visitor_still_inside',
        'İçerideki ziyaretçinin kaydı anonimleştirilemez; önce çıkışını kaydedin.',
        path,
      )
    if (
      input.reason === 'retention_expired' &&
      visitorRetentionDueOn(target.visitOn, checks.retentionDays) > checks.today
    )
      throw ruleError('visitor_retention_not_due', 'Kaydın saklama süresi dolmadı.', path)
  }
}
