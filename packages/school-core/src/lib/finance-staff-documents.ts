import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { dateLabel } from './format.ts'
import { addMonthsToDay } from './finance-maintenance-plans.ts'
import { daysBetween } from './finance-opening-watch.ts'
import { isStaffRole } from './staff-accounts.ts'

/**
 * Personel özlük belgeleri ve geçerlilik takibi (docs/domain/finans.md DOM-FIN-113; ON-173). Kurum
 * personelinin (yönetici, öğretmen, ön büro üyeliği) diploma, sağlık raporu, adli sicil kaydı,
 * sertifika, kimlik fotokopisi ve diğer belgeleri kaydedilir. Belge türü kurum ayarıdır: zorunlu mu,
 * geçerlilik süresi (ay) ve özel nitelikli işareti (K-372). Belge silinmez ve düzeltilmez; aynı
 * türün yeni belgesi eskisini "yerine geçti" yapar (K-373). Adli sicil ve sağlık raporu KVKK md. 6
 * kapsamında özel nitelikli kişisel veridir: işaret kaldırılamaz, dosyayı yalnız yönetici açar ve
 * her açılış denetim kaydına yazılır; listelerde yalnız tür ve tarihler görünür (K-374).
 * Fonksiyonlar saftır; bugün `today` (Europe/Istanbul günü) ile gelir.
 */

/** Liste, takip ve belge kaydı: yönetici ve ön büro (K-374). */
export const FINANCE_STAFF_DOCUMENT_ROLES = [
  'yonetici',
  'onburo',
] as const satisfies readonly Role[]
/** Tür ayarları ve özel nitelikli belgeler: yalnız yönetici (K-372, K-374). */
export const FINANCE_STAFF_DOCUMENT_MANAGE_ROLES = ['yonetici'] as const satisfies readonly Role[]

export const STAFF_DOCUMENT_TYPES = [
  'diploma',
  'health_report',
  'criminal_record',
  'certificate',
  'id_copy',
  'other',
] as const
export type StaffDocumentType = (typeof STAFF_DOCUMENT_TYPES)[number]
export const STAFF_DOCUMENT_TYPE_LABELS = {
  diploma: 'Diploma / mezuniyet belgesi',
  health_report: 'Sağlık raporu',
  criminal_record: 'Adli sicil kaydı',
  certificate: 'Sertifika / kurs belgesi',
  id_copy: 'Kimlik fotokopisi',
  other: 'Diğer',
} as const satisfies Record<StaffDocumentType, string>

/** Sağlık raporunun türü: işe giriş ya da periyodik muayene. */
export const HEALTH_REPORT_KINDS = ['pre_employment', 'periodic'] as const
export type HealthReportKind = (typeof HEALTH_REPORT_KINDS)[number]
export const HEALTH_REPORT_KIND_LABELS = {
  pre_employment: 'İşe giriş',
  periodic: 'Periyodik',
} as const satisfies Record<HealthReportKind, string>

/**
 * Kanunen özel nitelikli türler (KVKK md. 6: sağlık ve ceza mahkûmiyeti verisi). İşaret kurum
 * ayarında kaldırılamaz (K-372); diğer türler kurumca özel nitelikli işaretlenebilir.
 */
export const LEGALLY_SENSITIVE_STAFF_DOCUMENT_TYPES = [
  'health_report',
  'criminal_record',
] as const satisfies readonly StaffDocumentType[]

/**
 * Bir arada geçerli olabilen türler (K-373): bir kişinin birden çok diploması ya da sertifikası
 * olur; yeni belge eskisinin yerine yalnız seçilirse geçer. Diğer türlerde (sağlık raporu, adli
 * sicil, kimlik) geçerli belge tektir ve yeni belge eskisinin yerine kendiliğinden geçer.
 */
export const MULTI_STAFF_DOCUMENT_TYPES = [
  'diploma',
  'certificate',
  'other',
] as const satisfies readonly StaffDocumentType[]

export const isLegallySensitiveType = (type: StaffDocumentType) =>
  (LEGALLY_SENSITIVE_STAFF_DOCUMENT_TYPES as readonly string[]).includes(type)
export const isMultiDocumentType = (type: StaffDocumentType) =>
  (MULTI_STAFF_DOCUMENT_TYPES as readonly string[]).includes(type)

export const STAFF_DOCUMENT_VALIDITY_MONTHS_MAX = 120
export const STAFF_DOCUMENT_NOTE_MAX = 300
export const STAFF_DOCUMENT_WITHIN_DAYS_DEFAULT = 30
export const STAFF_DOCUMENT_WITHIN_DAYS_MAX = 365

/** Tür ayarı (K-372): zorunlu mu, geçerlilik süresi (ay; boşsa süresiz), özel nitelikli mi. */
export interface StaffDocumentTypeSetting {
  required: boolean
  validityMonths: number | null
  sensitive: boolean
}

/**
 * Ayarlanmamış türün varsayılanı (K-372). Adli sicil 6 ay (H-75), sağlık raporu 60 ay (okul az
 * tehlikeli sınıfta periyodik muayene 5 yılda bir; H-75); diploma, sağlık raporu, adli sicil ve
 * kimlik zorunlu; sertifika ve diğer isteğe bağlı.
 */
export const DEFAULT_STAFF_DOCUMENT_SETTINGS = {
  diploma: { required: true, validityMonths: null, sensitive: false },
  health_report: { required: true, validityMonths: 60, sensitive: true },
  criminal_record: { required: true, validityMonths: 6, sensitive: true },
  certificate: { required: false, validityMonths: null, sensitive: false },
  id_copy: { required: true, validityMonths: null, sensitive: false },
  other: { required: false, validityMonths: null, sensitive: false },
} as const satisfies Record<StaffDocumentType, StaffDocumentTypeSetting>

export type StaffDocumentSettings = Readonly<Record<StaffDocumentType, StaffDocumentTypeSetting>>

/**
 * Kurumun kayıtlı ayarları varsayılanla birleşir; kanunen özel nitelikli türün işareti her durumda
 * açıktır (eski ya da elle yazılmış satır da olsa).
 */
export function resolveStaffDocumentSettings(
  stored: Partial<Record<StaffDocumentType, StaffDocumentTypeSetting>>,
): StaffDocumentSettings {
  const entries = STAFF_DOCUMENT_TYPES.map((type) => {
    const setting = stored[type] ?? DEFAULT_STAFF_DOCUMENT_SETTINGS[type]
    return [
      type,
      { ...setting, sensitive: setting.sensitive || isLegallySensitiveType(type) },
    ] as const
  })
  return Object.fromEntries(entries) as Record<StaffDocumentType, StaffDocumentTypeSetting>
}

/** Zorunlu türler (ayar sırasıyla). */
export const requiredStaffDocumentTypes = (settings: StaffDocumentSettings) =>
  STAFF_DOCUMENT_TYPES.filter((type) => settings[type].required)

// --- Şemalar -------------------------------------------------------------------------------------

const typeSettingSchema = z.strictObject({
  required: z.boolean('Zorunlu olup olmadığını seçin.').describe('Her personelde bulunmalı mı'),
  validityMonths: z
    .number('Geçerlilik süresini ay olarak girin.')
    .int('Geçerlilik süresi tam ay olmalıdır.')
    .min(1, 'Geçerlilik süresi en az 1 ay olmalıdır.')
    .max(
      STAFF_DOCUMENT_VALIDITY_MONTHS_MAX,
      `Geçerlilik süresi en çok ${String(STAFF_DOCUMENT_VALIDITY_MONTHS_MAX)} ay olabilir.`,
    )
    .nullable()
    .describe('Belge tarihinden itibaren geçerlilik süresi (ay); `null` süresiz'),
  sensitive: z
    .boolean('Özel nitelikli olup olmadığını seçin.')
    .describe(
      'Özel nitelikli kişisel veri (KVKK md. 6): dosyayı yalnız yönetici açar, listede yalnız tür ve tarih',
    ),
})

/** Tür ayarlarını değiştir (K-372): gönderilen türlerin ayarı bütünüyle yazılır. */
export const staffDocumentSettingsUpdateSchema = z
  .strictObject(
    Object.fromEntries(
      STAFF_DOCUMENT_TYPES.map((type) => [
        type,
        typeSettingSchema.optional().describe(STAFF_DOCUMENT_TYPE_LABELS[type]),
      ]),
    ) as Record<StaffDocumentType, z.ZodOptional<typeof typeSettingSchema>>,
  )
  .superRefine((value, context) => {
    const types = STAFF_DOCUMENT_TYPES.filter((type) => value[type] !== undefined)
    if (types.length === 0)
      context.addIssue({ code: 'custom', path: [], message: 'En az bir belge türünü değiştirin.' })
    for (const type of types)
      if (isLegallySensitiveType(type) && value[type]?.sensitive === false)
        context.addIssue({
          code: 'custom',
          path: [type, 'sensitive'],
          message: `${STAFF_DOCUMENT_TYPE_LABELS[type]} özel nitelikli kişisel veridir; işaret kaldırılamaz.`,
        })
  })
export type StaffDocumentSettingsUpdate = z.output<typeof staffDocumentSettingsUpdateSchema>

const noteSchema = z
  .string()
  .trim()
  .max(
    STAFF_DOCUMENT_NOTE_MAX,
    `En fazla ${String(STAFF_DOCUMENT_NOTE_MAX)} karakter girebilirsiniz.`,
  )
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .default(null)

/** Yeni belge (DOM-FIN-113, K-373). */
export const staffDocumentInputSchema = z
  .strictObject({
    // kvkk: K (personel üyeliği)
    membershipId: z
      .string('Personel seçin.')
      .trim()
      .min(1, 'Personel seçin.')
      .max(100, 'Personel geçersiz.')
      .describe('Belgenin ait olduğu personelin kurum üyeliği'),
    documentType: z
      .enum(STAFF_DOCUMENT_TYPES, 'Belge türünü seçin.')
      .describe(
        '`diploma`, `health_report` sağlık raporu, `criminal_record` adli sicil kaydı, `certificate` sertifika/kurs belgesi, `id_copy` kimlik fotokopisi, `other` diğer',
      ),
    healthReportKind: z
      .enum(HEALTH_REPORT_KINDS, 'Raporun işe giriş ya da periyodik olduğunu seçin.')
      .nullable()
      .default(null)
      .describe('Yalnız sağlık raporunda ve orada zorunlu: `pre_employment` işe giriş, `periodic`'),
    documentDate: daySchema.describe('Belgenin düzenlendiği gün; bugünden sonra olamaz'),
    validUntil: daySchema
      .nullable()
      .default(null)
      .describe(
        'Geçerlilik bitişi (dahil), elle; `null` ise türün geçerlilik süresinden hesaplanır (süresiz türde boş kalır)',
      ),
    fileId: z
      .uuid('Dosya geçersiz.')
      .nullable()
      .default(null)
      .describe('Yüklenmiş `document` amaçlı dosya (`POST /files`); isteğe bağlı'),
    note: noteSchema.describe('İsteğe bağlı not, en çok 300 karakter; denetim kaydına yazılmaz'),
    replacesDocumentId: z
      .uuid('Yerine geçilecek belge geçersiz.')
      .nullable()
      .default(null)
      .describe(
        'Yerine geçilen belge: diploma, sertifika ve diğerde isteğe bağlı; tekil türlerde verilirse geçerli belge olmalıdır',
      ),
  })
  .superRefine((value, context) => {
    if (value.documentType === 'health_report' && value.healthReportKind === null)
      context.addIssue({
        code: 'custom',
        path: ['healthReportKind'],
        message: 'Raporun işe giriş ya da periyodik olduğunu seçin.',
      })
    if (value.documentType !== 'health_report' && value.healthReportKind !== null)
      context.addIssue({
        code: 'custom',
        path: ['healthReportKind'],
        message: 'Rapor türü yalnız sağlık raporunda seçilir.',
      })
    if (value.validUntil !== null && value.validUntil < value.documentDate)
      context.addIssue({
        code: 'custom',
        path: ['validUntil'],
        message: 'Geçerlilik bitişi belge tarihinden önce olamaz.',
      })
  })
export type StaffDocumentInput = z.input<typeof staffDocumentInputSchema>
export type StaffDocumentFields = z.output<typeof staffDocumentInputSchema>

// --- Geçerlilik ----------------------------------------------------------------------------------

/** Durum (saklanmaz, bugüne göre): geçerli, süresi yaklaşan, süresi geçen, yerine geçildi. */
export const STAFF_DOCUMENT_STATUSES = ['valid', 'expiring', 'expired', 'superseded'] as const
export type StaffDocumentStatus = (typeof STAFF_DOCUMENT_STATUSES)[number]
export const STAFF_DOCUMENT_STATUS_LABELS = {
  valid: 'Geçerli',
  expiring: 'Süresi yaklaşıyor',
  expired: 'Süresi geçti',
  superseded: 'Yerine yenisi geçti',
} as const satisfies Record<StaffDocumentStatus, string>

export const VALID_UNTIL_SOURCES = ['type', 'manual'] as const
export type ValidUntilSource = (typeof VALID_UNTIL_SOURCES)[number]

/**
 * Türden geçerlilik bitişi (K-372): belge tarihi + süre (ay); hedef ayda o gün yoksa ayın son günü.
 * Bitiş günü dahil geçerlidir. Süresiz türde `null`.
 */
export function staffDocumentValidUntil(
  documentDate: string,
  validityMonths: number | null,
): string | null {
  return validityMonths === null ? null : addMonthsToDay(documentDate, validityMonths)
}

/**
 * Bugüne göre durum ve kalan gün (bitiş günü dahil; bugün biten belgede 0, geçende eksi).
 * Bitişi `withinDays` gün içinde (dahil) olan belge "yaklaşıyor"dur.
 */
export function staffDocumentStatus(
  document: { validUntil: string | null; supersededAt: unknown },
  today: string,
  withinDays: number = STAFF_DOCUMENT_WITHIN_DAYS_DEFAULT,
): { status: StaffDocumentStatus; daysLeft: number | null } {
  const daysLeft = document.validUntil === null ? null : daysBetween(today, document.validUntil)
  if (document.supersededAt !== null) return { status: 'superseded', daysLeft }
  if (daysLeft === null) return { status: 'valid', daysLeft }
  if (daysLeft < 0) return { status: 'expired', daysLeft }
  return { status: daysLeft <= withinDays ? 'expiring' : 'valid', daysLeft }
}

/**
 * Personelin eksik zorunlu belgeleri (K-372): zorunlu türde yerine geçilmemiş belgesi olmayan
 * türler. Süresi geçmiş belge eksik sayılmaz, "süresi geçti" uyarısıyla izlenir.
 */
export function missingStaffDocumentTypes(
  settings: StaffDocumentSettings,
  documents: readonly { documentType: StaffDocumentType; supersededAt: unknown }[],
): StaffDocumentType[] {
  const present = new Set(
    documents.filter((doc) => doc.supersededAt === null).map((doc) => doc.documentType),
  )
  return requiredStaffDocumentTypes(settings).filter((type) => !present.has(type))
}

/**
 * Belgenin ayrıntısı (not ve dosya) kime gizlenir (K-374): özel nitelikli türde listelerde
 * herkese, personel ayrıntısında yönetici dışındakilere. Gizli belgede yalnız tür ve tarihler döner.
 */
export function isStaffDocumentRestricted(
  sensitive: boolean,
  role: string,
  context: 'list' | 'detail',
): boolean {
  if (!sensitive) return false
  return context === 'list' || role !== 'yonetici'
}

// --- Kurallar ------------------------------------------------------------------------------------

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const ruleError = (code: string, message: string, path: string) =>
  new DomainError(code, message, { kind: 'rule', path: [path] })

/** Yerine geçilebilecek geçerli belge (aynı personel ve tür, yerine geçilmemiş). */
export interface CurrentStaffDocument {
  id: string
  documentDate: string
}

/** Yeni belgenin denetimi için servis kurum kilidi altında yükler. */
export interface StaffDocumentChecks {
  /** Üyelik: kurumda yoksa `null`; `active` pasifleştirilmemiş demektir. */
  staff: { role: string; active: boolean } | null
  /** Kurumun çözülmüş tür ayarları. */
  settings: StaffDocumentSettings
  /** Personelin bu türdeki yerine geçilmemiş belgeleri. */
  current: readonly CurrentStaffDocument[]
  /** Kaydı yazanın rolü (özel nitelikli tür yalnız yöneticide). */
  actorRole: string
  today: string
}

export interface StaffDocumentPlan {
  validUntil: string | null
  validUntilSource: ValidUntilSource
  /** Yerine geçilen belge; yoksa `null`. */
  supersedes: string | null
  sensitive: boolean
}

/**
 * Yeni belge (DOM-FIN-113, K-373). Personel kurumun etkin yönetici, öğretmen ya da ön büro
 * üyeliğidir; belge tarihi bugünden sonra olamaz. Özel nitelikli türü yalnız yönetici kaydeder
 * (K-374) ve özel nitelikli belgeye not yazılmaz. Geçerlilik bitişi elle verilmezse türün süresinden hesaplanır. Tekil türde (sağlık
 * raporu, adli sicil, kimlik) yeni belge geçerli belgenin yerine kendiliğinden geçer; çoklu türde
 * (diploma, sertifika, diğer) yalnız `replacesDocumentId` verilirse. Yerine geçilen belgeden eski
 * tarihli belge yerine geçemez (geçmiş belge sonradan girilirken geçerli belge korunur).
 */
export function planStaffDocument(
  input: StaffDocumentFields,
  checks: StaffDocumentChecks,
): StaffDocumentPlan {
  if (checks.staff === null)
    throw ruleError('staff_document_staff_not_found', 'Personel bulunamadı.', 'membershipId')
  if (!isStaffRole(checks.staff.role))
    throw ruleError(
      'staff_document_not_staff',
      'Özlük belgesi yalnız personele (yönetici, öğretmen, ön büro) kaydedilir.',
      'membershipId',
    )
  if (!checks.staff.active)
    throw ruleError(
      'staff_document_staff_inactive',
      'Pasifleştirilmiş (ayrılan) personele yeni belge kaydedilmez.',
      'membershipId',
    )
  const setting = checks.settings[input.documentType]
  if (setting.sensitive && checks.actorRole !== 'yonetici')
    throw new DomainError(
      'staff_document_sensitive_forbidden',
      `${STAFF_DOCUMENT_TYPE_LABELS[input.documentType]} özel nitelikli kişisel veridir; yalnız yönetici kaydeder.`,
      { kind: 'forbidden' },
    )
  // Özel nitelikli veri serbest metne yazılmaz (guvenlik-kvkk: Ö veri ayrı ve denetimli tutulur).
  if (setting.sensitive && input.note !== null)
    throw ruleError(
      'staff_document_sensitive_note',
      'Özel nitelikli belgeye not yazılmaz; içerik yalnız dosyada tutulur.',
      'note',
    )
  if (input.documentDate > checks.today)
    throw ruleError(
      'staff_document_date_in_future',
      'Belge tarihi bugünden sonra olamaz.',
      'documentDate',
    )
  let target: CurrentStaffDocument | null = null
  if (isMultiDocumentType(input.documentType)) {
    if (input.replacesDocumentId !== null) {
      target = checks.current.find((doc) => doc.id === input.replacesDocumentId) ?? null
      if (target === null)
        throw ruleError(
          'staff_document_replace_not_found',
          'Yerine geçilecek belge bu personelin bu türdeki geçerli belgeleri arasında yok.',
          'replacesDocumentId',
        )
    }
  } else {
    target = checks.current[0] ?? null
    if (input.replacesDocumentId !== null && input.replacesDocumentId !== target?.id)
      throw ruleError(
        'staff_document_replace_not_found',
        'Yerine geçilecek belge bu personelin bu türdeki geçerli belgesi değil.',
        'replacesDocumentId',
      )
  }
  if (target !== null && input.documentDate < target.documentDate)
    throw ruleError(
      'staff_document_older_than_current',
      `Yeni belgenin tarihi yerine geçeceği belgeden (${dayText(target.documentDate)}) önce olamaz.`,
      'documentDate',
    )
  const manual = input.validUntil !== null
  return {
    validUntil: manual
      ? input.validUntil
      : staffDocumentValidUntil(input.documentDate, setting.validityMonths),
    validUntilSource: manual ? 'manual' : 'type',
    supersedes: target?.id ?? null,
    sensitive: setting.sensitive,
  }
}
