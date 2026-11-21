import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { DomainError } from './errors.ts'
import { addMonthsToDay } from './finance-maintenance-plans.ts'
import { daysBetween } from './finance-opening-watch.ts'
import { dateLabel, dayKey } from './format.ts'
import { isStaffRole } from './staff-accounts.ts'

/**
 * Personel özlük verisinin saklanması ve imhası (docs/domain/finans.md DOM-FIN-122; ON-176; KVKK
 * IST-021). Ayrılan personelin (pasifleştirilmiş yönetici, öğretmen, ön büro üyeliği) verisi veri
 * kategorisi başına bir saklama süresi boyunca durur; süre dolunca yönetici onayıyla imha edilir.
 *
 * - **Politika (K-415):** kategori başına süre (ay), sabit başlangıç olayı ve yasal en az süre.
 *   Varsayılan yasal en az süredir; kurum yalnız uzatabilir (en çok `STAFF_RETENTION_MONTHS_MAX`).
 *   Kod güncellemesiyle yasal alt sınır yükselirse kayıtlı daha kısa süre alt sınıra çekilir.
 * - **Yöntem (K-416):** özlük, izin, sağlık ve adli sicil verisi fiziksel silinir; mali kayıtlar
 *   kişi düzeyinde silinerek anonimleşir (kişisiz toplamlar, ör. onaylı bordro dönemi özeti, kalır).
 * - **Onay (K-417):** imha yalnız yöneticinin tek personel × kategori için verdiği onayla olur;
 *   arka plan otomatik imhası yoktur.
 *
 * Süreler ve başlangıç olayları **doğrulanmalı** (H-89, H-90, M-85). Fonksiyonlar saftır; bugün
 * `today` (Europe/Istanbul günü) ile gelir.
 */

/** Politika, aday listesi, imha ve imha kayıtları yalnız yöneticide (K-417). */
export const FINANCE_STAFF_RETENTION_ROLES = ['yonetici'] as const satisfies readonly Role[]

export const STAFF_RETENTION_CATEGORIES = [
  'sick_leave_reports',
  'health_reports',
  'criminal_records',
  'personnel_file',
  'leave_records',
  'payroll_records',
] as const
export type StaffRetentionCategory = (typeof STAFF_RETENTION_CATEGORIES)[number]

/**
 * Sürenin başladığı olay (K-415): ayrılış günü (üyeliğin pasifleştirildiği Europe/Istanbul günü)
 * ya da ayrılış yılını izleyen takvim yılının ilk günü (SGK ve vergi mevzuatındaki "ilgili olduğu
 * yılı takip eden yıl" sayımı).
 */
export const STAFF_RETENTION_START_EVENTS = ['separation_day', 'year_after_separation'] as const
export type StaffRetentionStartEvent = (typeof STAFF_RETENTION_START_EVENTS)[number]
export const STAFF_RETENTION_START_EVENT_LABELS = {
  separation_day: 'Ayrılış günü',
  year_after_separation: 'Ayrılış yılını izleyen yılın başı',
} as const satisfies Record<StaffRetentionStartEvent, string>

/** İmha yöntemi (K-416). */
export const STAFF_RETENTION_METHODS = ['delete', 'anonymize'] as const
export type StaffRetentionMethod = (typeof STAFF_RETENTION_METHODS)[number]
export const STAFF_RETENTION_METHOD_LABELS = {
  delete: 'Fiziksel silme',
  anonymize: 'Anonimleştirme',
} as const satisfies Record<StaffRetentionMethod, string>

export interface StaffRetentionCategorySpec {
  label: string
  /** Kategoriye giren kayıtlar (ekranda ve belgede). */
  contents: string
  /** KVKK md. 6 özel nitelikli veri. */
  special: boolean
  method: StaffRetentionMethod
  startEvent: StaffRetentionStartEvent
  /** Yasal en az süre (ay); kurum bunun altına inemez. Varsayılan da budur. */
  legalMinimumMonths: number
  /** Sürenin dayanağı; hepsi **doğrulanmalı** (H-89, M-85). */
  legalBasis: string
}

/**
 * Kategori tablosu (K-415, K-416). Süreler mevzuattaki saklama ve zamanaşımı sürelerinin
 * temkinli okumasıdır; hukukçu ve mali müşavir onayı beklenir (H-89, H-90, M-85).
 */
export const STAFF_RETENTION_CATEGORY_SPECS = {
  sick_leave_reports: {
    label: 'İstirahat raporları',
    contents: 'Personel sağlık raporu girişleri (tarih aralığı, tür, rapor dosyası)',
    special: true,
    method: 'delete',
    startEvent: 'year_after_separation',
    legalMinimumMonths: 120,
    legalBasis:
      '5510 sayılı Kanun md. 86: işverenin belgeleri ilgili yılı izleyen takvim yılından başlayarak 10 yıl saklaması (eksik gün ve rapor parası dayanağı)',
  },
  health_reports: {
    label: 'Sağlık raporu belgeleri',
    contents: 'Özlük belgelerindeki işe giriş ve periyodik muayene sağlık raporları',
    special: true,
    method: 'delete',
    startEvent: 'separation_day',
    legalMinimumMonths: 180,
    legalBasis:
      '6331 sayılı İSG Kanunu md. 15 ve İşyeri Hekimi Yönetmeliği: kişisel sağlık dosyasının işten ayrılıştan sonra 15 yıl saklanması',
  },
  criminal_records: {
    label: 'Adli sicil kayıtları',
    contents: 'Özlük belgelerindeki adli sicil kayıtları',
    special: true,
    method: 'delete',
    startEvent: 'separation_day',
    legalMinimumMonths: 120,
    legalBasis:
      '4857 sayılı İş Kanunu md. 75 (özlük dosyası) ve 6098 sayılı TBK md. 146 (genel zamanaşımı 10 yıl)',
  },
  personnel_file: {
    label: 'Özlük dosyası',
    contents:
      'Diploma, kimlik, sertifika ve diğer özlük belgeleri; öğretmen çalışma onayı kayıtları; düzenlenen çalışma ve hizmet belgeleri; özlük kartı (kimlik, iletişim, eğitim, banka, acil durum kişileri)',
    special: false,
    method: 'delete',
    startEvent: 'separation_day',
    legalMinimumMonths: 120,
    legalBasis:
      '4857 sayılı İş Kanunu md. 75 (özlük dosyası), 6098 sayılı TBK md. 146 (genel zamanaşımı 10 yıl), 5510 sayılı Kanun md. 86',
  },
  leave_records: {
    label: 'İzin kayıtları',
    contents: 'Kullanılmış izin kayıtları ve izin profili (kıdem başlangıcı, doğum günü, devir)',
    special: false,
    method: 'delete',
    startEvent: 'separation_day',
    legalMinimumMonths: 120,
    legalBasis:
      'Yıllık Ücretli İzin Yönetmeliği (izin kayıtlarının özlük dosyasında saklanması), 4857 sayılı İş Kanunu md. 75 ve ek md. 3 (izin ücreti zamanaşımı 5 yıl)',
  },
  payroll_records: {
    label: 'Mali kayıtlar',
    contents:
      'Ücret tanımları; avans, icra ve BES kayıtları; bordro düzeltmeleri; ek ders saatleri; SGK eksik gün ve giriş/çıkış günleri; maliyet merkezi atamaları',
    special: false,
    method: 'anonymize',
    startEvent: 'year_after_separation',
    legalMinimumMonths: 120,
    legalBasis:
      '5510 sayılı Kanun md. 86 (10 yıl), 6102 sayılı TTK md. 82 (10 yıl), 213 sayılı VUK md. 253 (5 yıl); süre ilgili yılı izleyen takvim yılından başlar',
  },
} as const satisfies Record<StaffRetentionCategory, StaffRetentionCategorySpec>

export const STAFF_RETENTION_CATEGORY_LABELS = Object.fromEntries(
  STAFF_RETENTION_CATEGORIES.map((category) => [
    category,
    STAFF_RETENTION_CATEGORY_SPECS[category].label,
  ]),
) as Record<StaffRetentionCategory, string>

/** Kurumun girebileceği en uzun süre (30 yıl): KVKK md. 4/2-d gereğinden uzun saklamayı sınırlar. */
export const STAFF_RETENTION_MONTHS_MAX = 360

const yearsText = (months: number) =>
  months % 12 === 0 ? `${String(months / 12)} yıl` : `${String(months)} ay`

/** Kurum ayarı (K-415): kategori başına süre; `null` platform varsayılanına (yasal en az) döner. */
const policySettingSchema = z.strictObject({
  retentionMonths: z
    .number('Süreyi ay olarak girin.')
    .int('Süre tam ay olmalı.')
    .min(1, 'Süre en az 1 ay olmalı.')
    .max(
      STAFF_RETENTION_MONTHS_MAX,
      `Süre en çok ${String(STAFF_RETENTION_MONTHS_MAX)} ay (30 yıl) olabilir.`,
    )
    .nullable()
    .describe('Saklama süresi (ay); `null` yasal en az süreye (varsayılan) döner'),
})

/** Politika güncellemesi: gönderilen kategoriler yazılır; yasal en az sürenin altı 400 (K-415). */
export const staffRetentionPolicyUpdateSchema = z
  .strictObject(
    Object.fromEntries(
      STAFF_RETENTION_CATEGORIES.map((category) => [
        category,
        policySettingSchema.optional().describe(STAFF_RETENTION_CATEGORY_SPECS[category].label),
      ]),
    ) as Record<StaffRetentionCategory, z.ZodOptional<typeof policySettingSchema>>,
  )
  .superRefine((value, context) => {
    const categories = STAFF_RETENTION_CATEGORIES.filter(
      (category) => value[category] !== undefined,
    )
    if (categories.length === 0)
      context.addIssue({ code: 'custom', path: [], message: 'En az bir kategoriyi değiştirin.' })
    for (const category of categories) {
      const months = value[category]?.retentionMonths
      const minimum = STAFF_RETENTION_CATEGORY_SPECS[category].legalMinimumMonths
      if (typeof months === 'number' && months < minimum)
        context.addIssue({
          code: 'custom',
          path: [category, 'retentionMonths'],
          message: `${STAFF_RETENTION_CATEGORY_SPECS[category].label} için yasal en az süre ${yearsText(minimum)} (${String(minimum)} ay); daha kısa süre girilemez.`,
        })
    }
  })
export type StaffRetentionPolicyUpdate = z.output<typeof staffRetentionPolicyUpdateSchema>

export interface StaffRetentionPolicyEntry {
  retentionMonths: number
  /** Kurum ayarı mı (`false` ise yasal en az süre). */
  customized: boolean
}
export type StaffRetentionPolicy = Readonly<
  Record<StaffRetentionCategory, StaffRetentionPolicyEntry>
>

/**
 * Kurumun kayıtlı süreleri varsayılanla birleşir (K-415). Kayıtlı süre yasal en az sürenin
 * altındaysa (alt sınır kodla yükseldiyse) alt sınır geçerlidir: imha hiçbir zaman erkene çekilmez.
 */
export function resolveStaffRetentionPolicy(
  stored: Partial<Record<StaffRetentionCategory, number | null>>,
): StaffRetentionPolicy {
  return Object.fromEntries(
    STAFF_RETENTION_CATEGORIES.map((category) => {
      const minimum = STAFF_RETENTION_CATEGORY_SPECS[category].legalMinimumMonths
      const months = stored[category]
      return [
        category,
        typeof months === 'number'
          ? { retentionMonths: Math.max(months, minimum), customized: true }
          : { retentionMonths: minimum, customized: false },
      ]
    }),
  ) as Record<StaffRetentionCategory, StaffRetentionPolicyEntry>
}

/** Ayrılış günü: üyeliğin pasifleştirildiği an → Europe/Istanbul günü (K-415). */
export const separationDayOf = (deactivatedAt: Date | string) => dayKey(deactivatedAt)

/** Sürenin başladığı gün (K-415). */
export function staffRetentionStartDay(
  separationDay: string,
  startEvent: StaffRetentionStartEvent,
): string {
  if (startEvent === 'separation_day') return separationDay
  return `${String(Number(separationDay.slice(0, 4)) + 1).padStart(4, '0')}-01-01`
}

/**
 * İmha edilebileceği ilk gün: başlangıç günü + süre (ay; hedef ayda gün yoksa ayın son günü).
 * Bu gün dahil kayıt imha edilebilir.
 */
export function staffRetentionDueDay(
  separationDay: string,
  category: StaffRetentionCategory,
  retentionMonths: number,
): string {
  const { startEvent } = STAFF_RETENTION_CATEGORY_SPECS[category]
  return addMonthsToDay(staffRetentionStartDay(separationDay, startEvent), retentionMonths)
}

export const STAFF_RETENTION_STATUSES = ['due', 'waiting'] as const
export type StaffRetentionStatus = (typeof STAFF_RETENTION_STATUSES)[number]

/** Süre doldu mu (`due`, imha edilebilir) ve imhaya kalan gün (dolmuşsa 0 ya da eksi). */
export function staffRetentionState(dueDay: string, today: string) {
  const daysLeft = daysBetween(today, dueDay)
  return { status: (daysLeft <= 0 ? 'due' : 'waiting') as StaffRetentionStatus, daysLeft }
}

export type StaffRetentionCounts = Partial<Record<StaffRetentionCategory, number>>

export interface DepartedStaff {
  membershipId: string
  name: string
  role: string
  separationDay: string
}

export interface StaffRetentionCandidate extends DepartedStaff {
  category: StaffRetentionCategory
  recordCount: number
  retentionMonths: number
  dueDay: string
  status: StaffRetentionStatus
  daysLeft: number
}

/**
 * İmha adayları (K-415): ayrılmış personel × kayıt bulunan kategori. Süresi dolmuşlar önce, sonra
 * imha günü, ad ve kategori sırasıyla. `status` ve `category` verilirse süzülür.
 */
export function staffRetentionCandidates(
  staff: readonly DepartedStaff[],
  counts: ReadonlyMap<string, StaffRetentionCounts>,
  policy: StaffRetentionPolicy,
  today: string,
  filter: {
    status?: StaffRetentionStatus | undefined
    category?: StaffRetentionCategory | undefined
  } = {},
): StaffRetentionCandidate[] {
  const rows: StaffRetentionCandidate[] = []
  for (const member of staff) {
    const own = counts.get(member.membershipId) ?? {}
    for (const category of STAFF_RETENTION_CATEGORIES) {
      const recordCount = own[category] ?? 0
      if (recordCount === 0) continue
      if (filter.category !== undefined && filter.category !== category) continue
      const { retentionMonths } = policy[category]
      const dueDay = staffRetentionDueDay(member.separationDay, category, retentionMonths)
      const state = staffRetentionState(dueDay, today)
      if (filter.status !== undefined && filter.status !== state.status) continue
      rows.push({ ...member, category, recordCount, retentionMonths, dueDay, ...state })
    }
  }
  const order = (category: StaffRetentionCategory) => STAFF_RETENTION_CATEGORIES.indexOf(category)
  return rows.sort(
    (a, b) =>
      (a.status === b.status ? 0 : a.status === 'due' ? -1 : 1) ||
      a.dueDay.localeCompare(b.dueDay) ||
      a.name.localeCompare(b.name, 'tr') ||
      order(a.category) - order(b.category),
  )
}

/** İmha onayı (K-417): tek personel × kategori. */
export const staffDataDestructionInputSchema = z.strictObject({
  // kvkk: K (personel üyeliği; imha kaydına yazılmaz)
  membershipId: z
    .string('Personel seçin.')
    .trim()
    .min(1, 'Personel seçin.')
    .max(100, 'Personel geçersiz.')
    .describe('Verisi imha edilecek ayrılmış personelin kurum üyeliği'),
  category: z
    .enum(STAFF_RETENTION_CATEGORIES, 'Veri kategorisini seçin.')
    .describe(
      '`sick_leave_reports` istirahat raporları, `health_reports` sağlık raporu belgeleri, `criminal_records` adli sicil kayıtları, `personnel_file` özlük dosyası, `leave_records` izin kayıtları, `payroll_records` mali kayıtlar',
    ),
})
export type StaffDataDestructionInput = z.output<typeof staffDataDestructionInputSchema>

export interface StaffDataDestructionChecks {
  /** Üyelik; yoksa ya da başka kurumdaysa `null`. */
  member: { role: string; deactivatedAt: Date | string | null } | null
  policy: StaffRetentionPolicy
  /** Kategoride imha edilecek kayıt sayısı (kurum kilidi altında sayılır). */
  recordCount: number
  today: string
}

export interface StaffDataDestructionPlan {
  category: StaffRetentionCategory
  method: StaffRetentionMethod
  retentionMonths: number
  startEvent: StaffRetentionStartEvent
  dueDay: string
  recordCount: number
}

const MESSAGES = {
  staff_retention_member_not_found: 'Personel bulunamadı.',
  staff_retention_member_active:
    'Personel hâlâ etkin; özlük verisi yalnız ayrılıştan sonra, saklama süresi dolunca imha edilir.',
  staff_retention_nothing_to_destroy: 'Bu kategoride imha edilecek kayıt yok.',
} as const

/**
 * İmha planı (K-415…K-417). Olmayan, başka kurumun ya da personel olmayan üyelik 404; etkin
 * personel, süresi dolmamış kategori ve kayıtsız kategori 422. Yöntem kategoriden gelir.
 */
export function planStaffDataDestruction(
  input: StaffDataDestructionInput,
  checks: StaffDataDestructionChecks,
): StaffDataDestructionPlan {
  const { member } = checks
  if (member === null || !isStaffRole(member.role))
    throw new DomainError(
      'staff_retention_member_not_found',
      MESSAGES.staff_retention_member_not_found,
      { kind: 'not_found' },
    )
  if (member.deactivatedAt === null)
    throw new DomainError('staff_retention_member_active', MESSAGES.staff_retention_member_active, {
      path: ['membershipId'],
    })
  const spec = STAFF_RETENTION_CATEGORY_SPECS[input.category]
  const { retentionMonths } = checks.policy[input.category]
  const dueDay = staffRetentionDueDay(
    separationDayOf(member.deactivatedAt),
    input.category,
    retentionMonths,
  )
  if (staffRetentionState(dueDay, checks.today).status !== 'due')
    throw new DomainError(
      'staff_retention_not_due',
      `Saklama süresi dolmadı; ${spec.label.toLocaleLowerCase('tr')} en erken ${dateLabel(dueDay, { year: 'numeric' })} günü imha edilebilir.`,
      { path: ['category'] },
    )
  if (checks.recordCount === 0)
    throw new DomainError(
      'staff_retention_nothing_to_destroy',
      MESSAGES.staff_retention_nothing_to_destroy,
      { path: ['category'] },
    )
  return {
    category: input.category,
    method: spec.method,
    retentionMonths,
    startEvent: spec.startEvent,
    dueDay,
    recordCount: checks.recordCount,
  }
}

/** Süreyi okunur metne çevirir: 120 → "10 yıl", 18 → "18 ay". */
export const staffRetentionPeriodLabel = (months: number) => yearsText(months)
