import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { dateLabel } from './format.ts'
import { addMonthsClamped } from './finance-severance.ts'
import { isStaffRole } from './staff-accounts.ts'

/**
 * Personel izin türleri ve yıllık izin hak edişi (docs/domain/finans.md DOM-FIN-109; ON-181).
 *
 * - **İzin türleri (K-361):** platform varsayılan listesi (yıllık, 4857 Ek md. 2 mazeret izinleri,
 *   ücretsiz, rapor, diğer) kurumda ayarlanır: ad, ücretli mi, yıllık izinden düşer mi, varsayılan
 *   gün ve etkinlik. Yasanın sabitlediği alanlar kilitlidir. Kurum ek tür açabilir.
 * - **Hak ediş (K-360):** kıdem başlangıcından (işe giriş; personel kaydı olmadığı için kurumda elle
 *   girilir) her tam yıl dönümünde o yılın izni hak edilir: hizmet 1–5 yıl 14, 6–14 yıl 20, 15 yıl
 *   ve üstü 26 iş günü (4857 md. 53); hak ediş gününde 18 yaşından küçük ya da 50 yaş ve üstü
 *   çalışana en az 20 gün. Kullanılmayan izin devreder; isteğe bağlı açılış devri sistem öncesini
 *   tek satırla taşır.
 * - **Kullanılmış izin (K-362):** talep ve onay akışı (ON-182) gelene kadar yönetici elle yazar; iş
 *   günü sayısı elle girilir. Rapor günleri sağlık raporu kaydından okunur (ON-185), burada yazılmaz.
 *
 * Fonksiyonlar saftır; bugün `today` (Europe/Istanbul günü) ile gelir.
 */

/** İzin verisi yalnız yöneticide (personel kişisel verisi; ücret tanımıyla aynı, K-306). */
export const FINANCE_STAFF_LEAVE_ROLES = ['yonetici'] as const satisfies readonly Role[]

export const LEAVE_KINDS = ['annual', 'excuse', 'unpaid', 'sick', 'other'] as const
export type LeaveKind = (typeof LEAVE_KINDS)[number]
export const LEAVE_KIND_LABELS = {
  annual: 'Yıllık izin',
  excuse: 'Mazeret izni',
  unpaid: 'Ücretsiz izin',
  sick: 'Rapor',
  other: 'Diğer',
} as const satisfies Record<LeaveKind, string>

/** Kurumun açabileceği ek tür biçimleri; yıllık izin ve rapor tektir. */
export const CUSTOM_LEAVE_KINDS = ['excuse', 'unpaid', 'other'] as const
export type CustomLeaveKind = (typeof CUSTOM_LEAVE_KINDS)[number]

/** Kilitlenebilen tür alanları. */
export const LEAVE_TYPE_LOCKABLE_FIELDS = ['paid', 'deductsFromAnnual', 'isActive'] as const
export type LeaveTypeLockableField = (typeof LEAVE_TYPE_LOCKABLE_FIELDS)[number]

export interface LeaveTypeDefault {
  code: string
  kind: LeaveKind
  label: string
  paid: boolean
  deductsFromAnnual: boolean
  defaultDays: number | null
  /** Yasal en az gün (Ek md. 2); kurum bunun altına inemez, üstüne çıkabilir. */
  statutoryMinDays: number | null
  /** Kurum ayarıyla değişmeyen alanlar (yasa ya da sistem gereği). */
  locked: readonly LeaveTypeLockableField[]
}

/**
 * Platform varsayılan türleri (K-361). Mazeret günleri 4857 Ek md. 2 (H-70): evlenme, evlat edinme,
 * birinci derece yakının ölümü 3 gün, eşin doğumu 5 gün, engelli ya da süreğen hastalığı olan
 * çocuğun tedavisi yılda 10 güne kadar. Rapor ücreti SGK geçici iş göremezlik ödeneğidir; kurum
 * fark ödüyorsa "ücretli" işaretler. Rapor ve ücretsiz izin yıllık izinden düşmez.
 */
export const LEAVE_TYPE_DEFAULTS: readonly LeaveTypeDefault[] = [
  {
    code: 'annual',
    kind: 'annual',
    label: 'Yıllık ücretli izin',
    paid: true,
    deductsFromAnnual: true,
    defaultDays: null,
    statutoryMinDays: null,
    locked: ['paid', 'deductsFromAnnual', 'isActive'],
  },
  {
    code: 'marriage',
    kind: 'excuse',
    label: 'Evlilik izni',
    paid: true,
    deductsFromAnnual: false,
    defaultDays: 3,
    statutoryMinDays: 3,
    locked: ['paid', 'deductsFromAnnual'],
  },
  {
    code: 'adoption',
    kind: 'excuse',
    label: 'Evlat edinme izni',
    paid: true,
    deductsFromAnnual: false,
    defaultDays: 3,
    statutoryMinDays: 3,
    locked: ['paid', 'deductsFromAnnual'],
  },
  {
    code: 'bereavement',
    kind: 'excuse',
    label: 'Ölüm izni (anne, baba, eş, kardeş, çocuk)',
    paid: true,
    deductsFromAnnual: false,
    defaultDays: 3,
    statutoryMinDays: 3,
    locked: ['paid', 'deductsFromAnnual'],
  },
  {
    code: 'paternity',
    kind: 'excuse',
    label: 'Babalık izni (eşin doğumu)',
    paid: true,
    deductsFromAnnual: false,
    defaultDays: 5,
    statutoryMinDays: 5,
    locked: ['paid', 'deductsFromAnnual'],
  },
  {
    code: 'child_treatment',
    kind: 'excuse',
    label: 'Engelli ya da süreğen hastalığı olan çocuğun tedavisi (yılda)',
    paid: true,
    deductsFromAnnual: false,
    defaultDays: 10,
    statutoryMinDays: 10,
    locked: ['paid', 'deductsFromAnnual'],
  },
  {
    code: 'unpaid',
    kind: 'unpaid',
    label: 'Ücretsiz izin',
    paid: false,
    deductsFromAnnual: false,
    defaultDays: null,
    statutoryMinDays: null,
    locked: ['paid', 'deductsFromAnnual'],
  },
  {
    code: 'sick',
    kind: 'sick',
    label: 'Rapor (ücret SGK ödeneğinden)',
    paid: false,
    deductsFromAnnual: false,
    defaultDays: null,
    statutoryMinDays: null,
    locked: ['deductsFromAnnual', 'isActive'],
  },
  {
    code: 'other',
    kind: 'other',
    label: 'Diğer izin',
    paid: true,
    deductsFromAnnual: false,
    defaultDays: null,
    statutoryMinDays: null,
    locked: [],
  },
]

const DEFAULT_BY_CODE = new Map(LEAVE_TYPE_DEFAULTS.map((type) => [type.code, type]))
export const isDefaultLeaveTypeCode = (code: string) => DEFAULT_BY_CODE.has(code)

/** Yıllık izin kıdem dilimleri (4857 md. 53): hak ediş günündeki tam hizmet yılına göre. */
export const ANNUAL_LEAVE_TIERS = [
  { fromYear: 1, days: 14 },
  { fromYear: 6, days: 20 },
  { fromYear: 15, days: 26 },
] as const
/** 18 yaşından küçük ve 50 yaş ve üstü çalışana en az bu kadar gün (K-360, H-69). */
export const AGE_MINIMUM_DAYS = 20
export const YOUNG_AGE_LIMIT = 18
export const SENIOR_AGE_LIMIT = 50

export const LEAVE_LABEL_MIN = 2
export const LEAVE_LABEL_MAX = 80
export const LEAVE_DAYS_MAX = 366
export const LEAVE_NOTE_MAX = 200
export const LEAVE_CANCEL_REASON_MIN = 5
export const LEAVE_CANCEL_REASON_MAX = 500
export const LEAVE_OPENING_DAYS_MIN = -366
export const LEAVE_OPENING_DAYS_MAX = 999
export const LEAVE_CUSTOM_TYPE_MAX = 30
/** Kıdem başlangıcı ve doğum günü alt sınırları. */
export const SENIORITY_MIN_DATE = '1960-01-01'
export const BIRTH_MIN_DATE = '1920-01-01'
/** İşe başlarken en az bu yaşta olunur (4857 md. 71: 14 yaşını doldurmuş, hafif işler). */
export const MIN_WORKING_AGE = 14

// --- Şemalar -------------------------------------------------------------------------------------

const membershipSchema = z
  .string('Personel seçin.')
  .trim()
  .min(1, 'Personel seçin.')
  .max(100, 'Personel geçersiz.')
const labelSchema = z
  .string('Tür adını yazın.')
  .trim()
  .min(LEAVE_LABEL_MIN, 'Tür adını en az 2 karakterle yazın.')
  .max(LEAVE_LABEL_MAX, `En fazla ${String(LEAVE_LABEL_MAX)} karakter girebilirsiniz.`)
const defaultDaysSchema = z
  .number('Gün sayısını girin.')
  .int('Gün sayısı tam sayı olmalıdır.')
  .min(1, 'Gün sayısı en az 1 olmalıdır.')
  .max(LEAVE_DAYS_MAX, `Gün sayısı en fazla ${String(LEAVE_DAYS_MAX)} olabilir.`)
const noteSchema = z
  .string()
  .trim()
  .max(LEAVE_NOTE_MAX, `En fazla ${String(LEAVE_NOTE_MAX)} karakter girebilirsiniz.`)
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .default(null)
export const leaveTypeCodeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, 'İzin türü geçersiz.')
  .describe('İzin türü kodu (varsayılan türlerde sabit ad, kurum türünde `custom_…`)')

/** Kurumun ek izin türü (K-361): mazeret, ücretsiz ya da diğer. */
export const leaveTypeCreateSchema = z.strictObject({
  kind: z
    .enum(CUSTOM_LEAVE_KINDS, 'Tür biçimini seçin.')
    .describe('`excuse` mazeret, `unpaid` ücretsiz, `other` diğer'),
  label: labelSchema.describe('Tür adı, 2–80 karakter; kurumda tekil'),
  paid: z.boolean('Ücretli olup olmadığını seçin.').describe('İzin günleri ücretli mi'),
  deductsFromAnnual: z
    .boolean('Yıllık izinden düşüp düşmediğini seçin.')
    .describe('Kullanılan gün yıllık izin bakiyesinden düşer mi'),
  defaultDays: defaultDaysSchema
    .nullable()
    .default(null)
    .describe('Varsayılan gün (bilgi; kayıtta gün elle girilir)'),
})
export type LeaveTypeCreateInput = z.input<typeof leaveTypeCreateSchema>
export type LeaveTypeCreateFields = z.output<typeof leaveTypeCreateSchema>

/** Tür ayarı (K-361): kısmi; kilitli alan değişmez. */
export const leaveTypeUpdateSchema = z
  .strictObject({
    label: labelSchema.optional(),
    paid: z.boolean().optional(),
    deductsFromAnnual: z.boolean().optional(),
    defaultDays: defaultDaysSchema.nullable().optional(),
    isActive: z.boolean().optional().describe('Pasif tür yeni kayıtta seçilmez'),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Değiştirilecek bir alan girin.',
  })
export type LeaveTypeUpdateFields = z.output<typeof leaveTypeUpdateSchema>

const openingBalanceSchema = z
  .strictObject({
    asOf: daySchema.describe(
      'Açılış devrinin günü: bu güne kadarki hak ediş ve kullanım devirdedir',
    ),
    days: z
      .number('Devreden gün sayısını girin.')
      .int('Devreden gün tam sayı olmalıdır.')
      .min(LEAVE_OPENING_DAYS_MIN, 'Devreden gün en az −366 olabilir.')
      .max(LEAVE_OPENING_DAYS_MAX, 'Devreden gün en fazla 999 olabilir.')
      .describe('O günün sonundaki kalan yıllık izin (gün; eksi avans izindir)'),
  })
  .nullable()

const profileFields = {
  // kvkk: K (işe giriş günü)
  seniorityStartDate: daySchema.describe(
    'Kıdem başlangıcı (işe giriş günü; personel kaydında olmadığı için elle)',
  ),
  // kvkk: K (doğum günü; yalnız yaş kuralı için)
  birthDate: daySchema
    .nullable()
    .describe('Doğum günü; 18 yaş altı ve 50 yaş ve üstü kuralı için (boşsa kural uygulanmaz)'),
  openingBalance: openingBalanceSchema.describe(
    'İsteğe bağlı açılış devri: sistem öncesi hak ediş ve kullanımın tek satırı',
  ),
}

/** İzin profili (K-360): kıdem başlangıcı, doğum günü ve açılış devri. */
export const leaveProfileSchema = z.strictObject({
  // kvkk: K (personel üyeliği)
  membershipId: membershipSchema.describe('Personelin kurum üyeliği'),
  seniorityStartDate: profileFields.seniorityStartDate,
  birthDate: profileFields.birthDate.default(null),
  openingBalance: profileFields.openingBalance.default(null),
})
export type LeaveProfileInput = z.input<typeof leaveProfileSchema>
export type LeaveProfileFields = z.output<typeof leaveProfileSchema>

/** Profil düzeltmesi: kısmi. */
export const leaveProfileUpdateSchema = z
  .strictObject({
    seniorityStartDate: profileFields.seniorityStartDate.optional(),
    birthDate: profileFields.birthDate.optional(),
    openingBalance: profileFields.openingBalance.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Değiştirilecek bir alan girin.',
  })
export type LeaveProfileUpdateFields = z.output<typeof leaveProfileUpdateSchema>

/** Kullanılmış izin kaydı (K-362). */
export const leaveRecordSchema = z
  .strictObject({
    // kvkk: K (personel üyeliği)
    membershipId: membershipSchema.describe('Personelin kurum üyeliği'),
    typeCode: leaveTypeCodeSchema,
    startDate: daySchema.describe('İznin ilk günü'),
    endDate: daySchema.describe('İznin son günü (dahil)'),
    days: z
      .number('Gün sayısını girin.')
      .int('Gün sayısı tam sayı olmalıdır.')
      .min(1, 'Gün sayısı en az 1 olmalıdır.')
      .max(LEAVE_DAYS_MAX, `Gün sayısı en fazla ${String(LEAVE_DAYS_MAX)} olabilir.`)
      .describe('Kullanılan iş günü (hafta tatili ve genel tatil hariç; elle)'),
    note: noteSchema.describe('İsteğe bağlı not, en çok 200 karakter'),
  })
  .superRefine((value, context) => {
    if (value.endDate < value.startDate)
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'Bitiş günü başlangıç gününden önce olamaz.',
      })
  })
export type LeaveRecordInput = z.input<typeof leaveRecordSchema>
export type LeaveRecordFields = z.output<typeof leaveRecordSchema>

export const leaveRecordCancelSchema = z.strictObject({
  reason: z
    .string('İptal gerekçesini yazın.')
    .trim()
    .min(LEAVE_CANCEL_REASON_MIN, 'İptal gerekçesini en az 5 karakterle yazın.')
    .max(
      LEAVE_CANCEL_REASON_MAX,
      `En fazla ${String(LEAVE_CANCEL_REASON_MAX)} karakter girebilirsiniz.`,
    )
    .describe('İptal gerekçesi; denetim kaydına yazılmaz'),
})
export type LeaveRecordCancelFields = z.output<typeof leaveRecordCancelSchema>

// --- İzin türleri --------------------------------------------------------------------------------

/** Kurumda saklanan tür satırı (varsayılan türün ayarı ya da kurumun ek türü). */
export interface StoredLeaveType {
  code: string
  kind: LeaveKind
  label: string
  paid: boolean
  deductsFromAnnual: boolean
  defaultDays: number | null
  isActive: boolean
  version: number
}

/** Kurumda geçerli tür: varsayılan + kurum ayarı ya da kurumun ek türü. */
export interface LeaveType {
  code: string
  kind: LeaveKind
  label: string
  paid: boolean
  deductsFromAnnual: boolean
  defaultDays: number | null
  statutoryMinDays: number | null
  isActive: boolean
  isCustom: boolean
  locked: readonly LeaveTypeLockableField[]
  /** Saklanan ayarın sürümü; ayar hiç yazılmadıysa 0 (`If-Match: "0"`). */
  version: number
}

function fromDefault(base: LeaveTypeDefault, stored: StoredLeaveType | undefined): LeaveType {
  return {
    code: base.code,
    kind: base.kind,
    label: stored?.label ?? base.label,
    paid: base.locked.includes('paid') ? base.paid : (stored?.paid ?? base.paid),
    deductsFromAnnual: base.locked.includes('deductsFromAnnual')
      ? base.deductsFromAnnual
      : (stored?.deductsFromAnnual ?? base.deductsFromAnnual),
    defaultDays: stored === undefined ? base.defaultDays : stored.defaultDays,
    statutoryMinDays: base.statutoryMinDays,
    isActive: base.locked.includes('isActive') ? true : (stored?.isActive ?? true),
    isCustom: false,
    locked: base.locked,
    version: stored?.version ?? 0,
  }
}

/**
 * Kurumda geçerli türler (K-361): varsayılan sırasıyla varsayılan türler (kurum ayarı uygulanmış),
 * sonra kurumun ek türleri ada göre. Kilitli alanda saklanan değer yok sayılır.
 */
export function effectiveLeaveTypes(stored: readonly StoredLeaveType[]): LeaveType[] {
  const byCode = new Map(stored.map((row) => [row.code, row]))
  const defaults = LEAVE_TYPE_DEFAULTS.map((base) => fromDefault(base, byCode.get(base.code)))
  const custom = stored
    .filter((row) => !DEFAULT_BY_CODE.has(row.code))
    .map((row): LeaveType => ({
      ...row,
      statutoryMinDays: null,
      isCustom: true,
      locked: [],
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'tr'))
  return [...defaults, ...custom]
}

const ruleError = (code: string, message: string, path: string) =>
  new DomainError(code, message, { kind: 'rule', path: [path] })

const foldLabel = (label: string) => label.trim().toLocaleLowerCase('tr')

function assertLabelFree(label: string, types: readonly LeaveType[], exceptCode: string | null) {
  const folded = foldLabel(label)
  if (types.some((type) => type.code !== exceptCode && foldLabel(type.label) === folded))
    throw ruleError('leave_type_label_exists', 'Bu adla bir izin türü zaten var.', 'label')
}

/** Kurumun ek türü (K-361): ad kurumda tekil, en çok 30 ek tür. */
export function planLeaveTypeCreate(
  input: LeaveTypeCreateFields,
  types: readonly LeaveType[],
): void {
  if (types.filter((type) => type.isCustom).length >= LEAVE_CUSTOM_TYPE_MAX)
    throw ruleError(
      'leave_type_limit',
      `Kurum en çok ${String(LEAVE_CUSTOM_TYPE_MAX)} ek izin türü açabilir.`,
      'label',
    )
  if (input.kind === 'unpaid' && input.paid)
    throw ruleError('leave_type_locked', 'Ücretsiz izin ücretli olamaz.', 'paid')
  assertLabelFree(input.label, types, null)
}

const FIELD_LABELS: Readonly<Record<LeaveTypeLockableField, string>> = {
  paid: 'ücretli olup olmadığı',
  deductsFromAnnual: 'yıllık izinden düşüp düşmediği',
  isActive: 'etkinliği',
}

/**
 * Tür ayarı (K-361). Kilitli alan farklı değerle gelirse 422 `leave_type_locked`; yasal mazerette
 * varsayılan gün yasal en azın altına inmez; ad kurumda tekil; değişiklik yoksa 422
 * `leave_type_unchanged`. Döner: birleşik ayar (saklanacak satır).
 */
export function planLeaveTypeUpdate(
  type: LeaveType,
  input: LeaveTypeUpdateFields,
  types: readonly LeaveType[],
): Omit<StoredLeaveType, 'version'> {
  for (const field of type.locked)
    if (input[field] !== undefined && input[field] !== type[field])
      throw ruleError(
        'leave_type_locked',
        `${type.label} türünün ${FIELD_LABELS[field]} değiştirilemez.`,
        field,
      )
  if (type.kind === 'unpaid' && input.paid === true)
    throw ruleError('leave_type_locked', 'Ücretsiz izin ücretli olamaz.', 'paid')
  const next = {
    code: type.code,
    kind: type.kind,
    label: input.label ?? type.label,
    paid: input.paid ?? type.paid,
    deductsFromAnnual: input.deductsFromAnnual ?? type.deductsFromAnnual,
    defaultDays: input.defaultDays === undefined ? type.defaultDays : input.defaultDays,
    isActive: input.isActive ?? type.isActive,
  }
  if (
    type.statutoryMinDays !== null &&
    (next.defaultDays === null || next.defaultDays < type.statutoryMinDays)
  )
    throw ruleError(
      'leave_type_days_below_statutory',
      `${type.label} yasal olarak en az ${String(type.statutoryMinDays)} gündür; daha az girilemez.`,
      'defaultDays',
    )
  if (input.label !== undefined) assertLabelFree(next.label, types, type.code)
  if (
    next.label === type.label &&
    next.paid === type.paid &&
    next.deductsFromAnnual === type.deductsFromAnnual &&
    next.defaultDays === type.defaultDays &&
    next.isActive === type.isActive
  )
    throw ruleError('leave_type_unchanged', 'İzin türünde değişiklik yok.', 'label')
  return next
}

// --- Takvim --------------------------------------------------------------------------------------

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00.000Z`) / 86_400_000
/** Takvim günü sayısı, iki uç dahil. */
export const calendarDays = (startDate: string, endDate: string) =>
  dayNumber(endDate) - dayNumber(startDate) + 1
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/** `n`. yıl dönümü (29 Şubat → 28 Şubat; kıdem hesaplayıcısıyla aynı, DOM-FIN-094). */
export const anniversary = (startDate: string, years: number) =>
  addMonthsClamped(startDate, years * 12)

/** `day` günündeki tam yaş ya da tam hizmet yılı (yıl dönümü o gün dahil dolmuş sayılır). */
export function completedYears(fromDate: string, day: string): number {
  if (day < fromDate) return 0
  // Yıl farkından bir eksiği kesin dolmuştur; döngü en çok bir adım atar.
  let years = Math.max(0, Number(day.slice(0, 4)) - Number(fromDate.slice(0, 4)) - 1)
  while (anniversary(fromDate, years + 1) <= day) years += 1
  return years
}

/** Hizmet yılına göre kıdem dilimi günü (4857 md. 53). */
export function seniorityLeaveDays(serviceYears: number): number {
  let days = 0
  for (const tier of ANNUAL_LEAVE_TIERS) if (serviceYears >= tier.fromYear) days = tier.days
  return days
}

/** Yaş kuralı (K-360, H-69): 18'den küçük ya da 50 ve üstü. */
export const ageRuleApplies = (age: number) => age < YOUNG_AGE_LIMIT || age >= SENIOR_AGE_LIMIT

// --- Profil --------------------------------------------------------------------------------------

export interface LeaveProfile {
  seniorityStartDate: string
  birthDate: string | null
  openingBalance: { asOf: string; days: number } | null
}

/** Profildeki tarih ilişkileri (yaratma ve düzeltmede aynı). */
function checkProfile(profile: LeaveProfile, today: string, firstAnnualRecord: string | null) {
  if (profile.seniorityStartDate < SENIORITY_MIN_DATE)
    throw ruleError(
      'staff_leave_seniority_too_early',
      `Kıdem başlangıcı ${dayText(SENIORITY_MIN_DATE)} gününden önce olamaz.`,
      'seniorityStartDate',
    )
  if (profile.seniorityStartDate > today)
    throw ruleError(
      'staff_leave_seniority_future',
      'Kıdem başlangıcı bugünden sonra olamaz.',
      'seniorityStartDate',
    )
  if (profile.birthDate !== null) {
    if (profile.birthDate < BIRTH_MIN_DATE || profile.birthDate > today)
      throw ruleError('staff_leave_birth_date_invalid', 'Doğum günü geçersiz.', 'birthDate')
    if (completedYears(profile.birthDate, profile.seniorityStartDate) < MIN_WORKING_AGE)
      throw ruleError(
        'staff_leave_birth_date_invalid',
        `Kıdem başlangıcında çalışan en az ${String(MIN_WORKING_AGE)} yaşında olmalıdır; doğum gününü ya da kıdem başlangıcını denetleyin.`,
        'birthDate',
      )
  }
  const opening = profile.openingBalance
  if (opening !== null && (opening.asOf < profile.seniorityStartDate || opening.asOf > today))
    throw ruleError(
      'staff_leave_opening_date_invalid',
      'Açılış devrinin günü kıdem başlangıcı ile bugün arasında olmalıdır.',
      'openingBalance.asOf',
    )
  if (firstAnnualRecord !== null && firstAnnualRecord < profile.seniorityStartDate)
    throw ruleError(
      'staff_leave_before_seniority',
      `Yıllık izinden düşen ${dayText(firstAnnualRecord)} kaydı yeni kıdem başlangıcından önce kalıyor; önce o kaydı iptal edin.`,
      'seniorityStartDate',
    )
}

/** Personel üyeliği denetimi (yazmalarda): kurumda var, personel ve etkin. */
export interface LeaveStaff {
  role: string
  active: boolean
}

function checkStaff(staff: LeaveStaff | null) {
  if (staff === null)
    throw ruleError('staff_leave_staff_not_found', 'Personel bulunamadı.', 'membershipId')
  if (!isStaffRole(staff.role))
    throw ruleError(
      'staff_leave_not_staff',
      'İzin kaydı yalnız personele (yönetici, öğretmen, ön büro) yapılır.',
      'membershipId',
    )
  if (!staff.active)
    throw ruleError(
      'staff_leave_staff_inactive',
      'Pasifleştirilmiş (ayrılan) personelin izin bilgisi değiştirilmez.',
      'membershipId',
    )
}

/** Profil açma (K-360): personel etkin, profil yok, tarih ilişkileri tutarlı. */
export function planLeaveProfile(
  input: LeaveProfileFields,
  checks: { staff: LeaveStaff | null; exists: boolean; today: string },
): LeaveProfile {
  checkStaff(checks.staff)
  if (checks.exists)
    throw ruleError(
      'staff_leave_profile_exists',
      'Bu personelin izin bilgisi zaten var; düzeltin.',
      'membershipId',
    )
  const profile = {
    seniorityStartDate: input.seniorityStartDate,
    birthDate: input.birthDate,
    openingBalance: input.openingBalance,
  }
  checkProfile(profile, checks.today, null)
  return profile
}

const sameOpening = (a: LeaveProfile['openingBalance'], b: LeaveProfile['openingBalance']) =>
  a === null || b === null ? a === b : a.asOf === b.asOf && a.days === b.days

/**
 * Profil düzeltmesi: birleşik profil aynı denetimden geçer; yıllık izinden düşen kayıt yeni kıdem
 * başlangıcından önce kalamaz; değişiklik yoksa 422 `staff_leave_profile_unchanged`.
 */
export function planLeaveProfileUpdate(
  current: LeaveProfile,
  input: LeaveProfileUpdateFields,
  checks: { staff: LeaveStaff | null; today: string; firstAnnualRecord: string | null },
): LeaveProfile {
  checkStaff(checks.staff)
  const next = {
    seniorityStartDate: input.seniorityStartDate ?? current.seniorityStartDate,
    birthDate: input.birthDate === undefined ? current.birthDate : input.birthDate,
    openingBalance:
      input.openingBalance === undefined ? current.openingBalance : input.openingBalance,
  }
  if (
    next.seniorityStartDate === current.seniorityStartDate &&
    next.birthDate === current.birthDate &&
    sameOpening(next.openingBalance, current.openingBalance)
  )
    throw ruleError(
      'staff_leave_profile_unchanged',
      'İzin bilgisinde değişiklik yok.',
      'membershipId',
    )
  checkProfile(next, checks.today, checks.firstAnnualRecord)
  return next
}

// --- Kullanılmış izin ----------------------------------------------------------------------------

export interface LeavePeriod {
  startDate: string
  endDate: string
}

/** İki aralık çakışıyor mu (uçlar dahil). */
export const periodsOverlap = (a: LeavePeriod, b: LeavePeriod) =>
  a.startDate <= b.endDate && b.startDate <= a.endDate

/** Kaydın saklanan tür kopyası (K-361): ayar sonradan değişse de geçmiş kayıt değişmez. */
export interface LeaveRecordSnapshot {
  kind: LeaveKind
  typeLabel: string
  paid: boolean
  deductsFromAnnual: boolean
}

/**
 * Kullanılmış izin (K-362). Personel etkin; tür kurumda var ve etkin; rapor elle yazılmaz (sağlık
 * raporu kaydından gelir, ON-185); iş günü takvim aralığını aşamaz; aynı personelde çakışan kayıt
 * yok; yıllık izinden düşen kayıt profil (kıdem başlangıcı) ister ve ondan önce başlayamaz.
 */
export function planLeaveRecord(
  input: LeaveRecordFields,
  checks: {
    staff: LeaveStaff | null
    type: LeaveType | null
    profile: LeaveProfile | null
    records: readonly (LeavePeriod & { id: string })[]
  },
): LeaveRecordSnapshot {
  checkStaff(checks.staff)
  const type = checks.type
  if (type === null)
    throw ruleError('staff_leave_type_not_found', 'İzin türü bulunamadı.', 'typeCode')
  if (!type.isActive)
    throw ruleError(
      'staff_leave_type_inactive',
      `${type.label} türü kurumda kapalı; ayarlardan açın.`,
      'typeCode',
    )
  if (type.kind === 'sick')
    throw ruleError(
      'staff_leave_sick_not_manual',
      'Rapor günleri sağlık raporu kaydından okunur; buradan yazılmaz.',
      'typeCode',
    )
  if (input.days > calendarDays(input.startDate, input.endDate))
    throw ruleError(
      'staff_leave_days_exceed_range',
      'İş günü sayısı seçilen tarih aralığındaki gün sayısını aşamaz.',
      'days',
    )
  if (type.deductsFromAnnual) {
    if (checks.profile === null)
      throw ruleError(
        'staff_leave_profile_required',
        'Yıllık izinden düşen kayıt için önce kıdem başlangıcını girin.',
        'typeCode',
      )
    if (input.startDate < checks.profile.seniorityStartDate)
      throw ruleError(
        'staff_leave_before_seniority',
        'Yıllık izinden düşen izin kıdem başlangıcından önce başlayamaz.',
        'startDate',
      )
  }
  const clash = checks.records.find((record) => periodsOverlap(record, input))
  if (clash !== undefined)
    throw ruleError(
      'staff_leave_overlap',
      `Bu tarihlerde personelin başka bir izin kaydı var (${dayText(clash.startDate)} – ${dayText(clash.endDate)}).`,
      'startDate',
    )
  return {
    kind: type.kind,
    typeLabel: type.label,
    paid: type.paid,
    deductsFromAnnual: type.deductsFromAnnual,
  }
}

// --- Hak ediş ------------------------------------------------------------------------------------

export interface LeaveAccrual {
  /** Kaçıncı hizmet yılının dolumu. */
  serviceYear: number
  /** Hak ediş günü (yıl dönümü). */
  date: string
  /** Kıdem dilimine göre gün. */
  baseDays: number
  /** Hak ediş günündeki yaş; doğum günü yoksa `null`. */
  age: number | null
  /** 18 yaş altı ya da 50 yaş ve üstü en az 20 gün kuralı uygulandı mı. */
  ageRule: boolean
  days: number
  /** Açılış devrinin günü ya da öncesindeyse bakiyeye ayrıca sayılmaz (devirdedir). */
  inOpeningBalance: boolean
}

export interface LeaveUsage {
  startDate: string
  days: number
  deductsFromAnnual: boolean
}

export interface LeaveEntitlement {
  asOf: string
  /** `asOf` gününde tam hizmet yılı. */
  serviceYears: number
  accruals: LeaveAccrual[]
  /** Bir sonraki hak ediş (hizmet sürüyorsa). */
  next: Omit<LeaveAccrual, 'inOpeningBalance'> | null
  openingDays: number
  /** Bakiyeye sayılan hak ediş toplamı (açılış devri sonrası). */
  entitledDays: number
  /** `asOf` gününe kadar başlamış, yıllık izinden düşen kullanım (açılış devri sonrası). */
  usedDays: number
  /** `asOf` gününden sonra başlayan, yıllık izinden düşen kayıtlar (planlanan). */
  plannedDays: number
  /** Son hak ediş gününden önceki yıllardan devreden. */
  carriedOverDays: number
  /** Son hak ediş gününde kazanılan (açılış devrindeyse 0). */
  currentYearDays: number
  /** Son hak ediş gününden beri kullanılan. */
  usedThisYearDays: number
  /** Kalan: açılış + hak ediş − kullanılan; eksi avans izindir. */
  balanceDays: number
  /** Planlanan kayıtlar düşüldükten sonra kalan. */
  balanceAfterPlannedDays: number
}

function accrualOn(profile: LeaveProfile, serviceYear: number) {
  const date = anniversary(profile.seniorityStartDate, serviceYear)
  const baseDays = seniorityLeaveDays(serviceYear)
  const age = profile.birthDate === null ? null : completedYears(profile.birthDate, date)
  const ageRule = age !== null && ageRuleApplies(age)
  return {
    serviceYear,
    date,
    baseDays,
    age,
    ageRule,
    days: ageRule ? Math.max(baseDays, AGE_MINIMUM_DAYS) : baseDays,
  }
}

/**
 * Yıllık izin hak edişi ve bakiye (DOM-FIN-109, K-360). Kıdem başlangıcının her tam yıl dönümü bir
 * hak ediş günüdür (ilk hak ediş bir yıl sonra; deneme süresi dahil). Hizmet `employmentEndDate`
 * gününde (ayrılan personel) biter; o günden sonraki yıl dönümü hak ettirmez. Açılış devri
 * verilmişse o güne kadarki hak ediş ve kullanım devrin içindedir. Yalnız yıllık izinden düşen
 * kayıtlar sayılır. Kullanılmayan izin devreder (zamanaşımı yok, iş ilişkisi sürerken).
 */
export function leaveEntitlement(
  profile: LeaveProfile,
  usages: readonly LeaveUsage[],
  asOf: string,
  employmentEndDate: string | null = null,
): LeaveEntitlement {
  const until = employmentEndDate !== null && employmentEndDate < asOf ? employmentEndDate : asOf
  const serviceYears = completedYears(profile.seniorityStartDate, until)
  const openingAsOf = profile.openingBalance?.asOf ?? null
  const accruals: LeaveAccrual[] = []
  for (let year = 1; year <= serviceYears; year += 1) {
    const accrual = accrualOn(profile, year)
    accruals.push({
      ...accrual,
      inOpeningBalance: openingAsOf !== null && accrual.date <= openingAsOf,
    })
  }
  const nextAccrual = accrualOn(profile, serviceYears + 1)
  const next =
    employmentEndDate !== null && nextAccrual.date > employmentEndDate ? null : nextAccrual
  const counted = (usage: LeaveUsage) =>
    usage.deductsFromAnnual && (openingAsOf === null || usage.startDate > openingAsOf)
  const sum = (list: readonly { days: number }[]) =>
    list.reduce((total, item) => total + item.days, 0)
  const used = usages.filter((usage) => counted(usage) && usage.startDate <= asOf)
  const planned = usages.filter((usage) => counted(usage) && usage.startDate > asOf)
  const openingDays = profile.openingBalance?.days ?? 0
  const entitledDays = sum(accruals.filter((accrual) => !accrual.inOpeningBalance))
  const usedDays = sum(used)
  const plannedDays = sum(planned)
  const balanceDays = openingDays + entitledDays - usedDays
  const latest = accruals.at(-1) ?? null
  const currentYearDays = latest === null || latest.inOpeningBalance ? 0 : latest.days
  const usedThisYearDays = sum(
    latest === null ? used : used.filter((usage) => usage.startDate >= latest.date),
  )
  return {
    asOf,
    serviceYears,
    accruals,
    next,
    openingDays,
    entitledDays,
    usedDays,
    plannedDays,
    carriedOverDays: balanceDays - currentYearDays + usedThisYearDays,
    currentYearDays,
    usedThisYearDays,
    balanceDays,
    balanceAfterPlannedDays: balanceDays - plannedDays,
  }
}

/**
 * Kıdem başlangıcı ortak kaynağı (ON-175 personel belgesi ve ON-341 kıdem hesaplayıcısı için
 * öneri): profil varsa kıdem başlangıcı, yoksa `null`. Personel özlük kaydı gelince oradan okunur.
 */
export const seniorityStartOf = (profile: LeaveProfile | null) =>
  profile?.seniorityStartDate ?? null

/** Gösterim: "3 gün", "-2 gün". */
export const leaveDaysText = (days: number) => `${String(days)} gün`
