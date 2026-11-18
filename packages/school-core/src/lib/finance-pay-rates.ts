import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { dateLabel } from './format.ts'
import { isStaffRole } from './staff-accounts.ts'

/**
 * Personel ücret tanımı (docs/domain/finans.md DOM-FIN-099; ON-194). Bir personel üyeliğine
 * (yönetici, öğretmen, ön büro) yürürlük tarihli tanımlar yazılır: ana ücret (aylık brüt, aylık
 * net, saatlik ya da ders saati ücreti), ek ders ücreti (saat başı; ek ders ve nöbet) ve yan haklar
 * (yemek, yol, çocuk yardımı, servis; nakdi ya da ayni, vergiye tabi işareti). Tutar kuruştur.
 *
 * Yürürlük "yuva" başınadır (K-304): ana ücretin tek yuvası vardır (tür değişse de bir kişinin
 * aynı gün iki ana ücreti olmaz), ek ders ve yan hak türleri ayrı yuvalardır. Bir yuvada aralıklar
 * çakışmaz; yeni tanım yalnız yuvanın son tanımından sonra başlar ve son tanımı, başlangıcından bir
 * gün öncesine kendiliğinden kapatır. Tanım düzeltilmez: yalnız yuvanın son tanımının bitişi
 * değiştirilir ya da gerekçeyle iptal edilir; iptal, kapattığı tanımın eski bitişini geri yazar.
 * Fonksiyonlar saftır; bugün `today` (Europe/Istanbul günü) ile gelir.
 */

/** Ücret verisi yalnız yöneticide (K-306); muhasebe rolü açılsa da ayrı İK yetkisi gerekir. */
export const FINANCE_PAY_RATE_ROLES = ['yonetici'] as const satisfies readonly Role[]

export const PAY_RATE_COMPONENTS = ['wage', 'lesson', 'benefit'] as const
export type PayRateComponent = (typeof PAY_RATE_COMPONENTS)[number]
export const PAY_RATE_COMPONENT_LABELS = {
  wage: 'Ana ücret',
  lesson: 'Ek ders ücreti',
  benefit: 'Yan hak',
} as const satisfies Record<PayRateComponent, string>

export const WAGE_TYPES = ['monthly_gross', 'monthly_net', 'hourly', 'lesson_hour'] as const
export type WageType = (typeof WAGE_TYPES)[number]
export const WAGE_TYPE_LABELS = {
  monthly_gross: 'Aylık brüt',
  monthly_net: 'Aylık net',
  hourly: 'Saatlik',
  lesson_hour: 'Ders saati ücreti',
} as const satisfies Record<WageType, string>

/**
 * Ek ders ücreti türleri (K-305): ders yükü üstündeki ders saati (yedek ders dahil) ve nöbet.
 * "Normal" ders saati ücretli öğretmenin ana ücretidir (`lesson_hour`), burada ayrı tür değildir.
 */
export const LESSON_PAY_TYPES = ['extra', 'duty'] as const
export type LessonPayType = (typeof LESSON_PAY_TYPES)[number]
export const LESSON_PAY_TYPE_LABELS = {
  extra: 'Ek ders',
  duty: 'Nöbet',
} as const satisfies Record<LessonPayType, string>

export const BENEFIT_TYPES = ['meal', 'transport', 'child', 'service'] as const
export type BenefitType = (typeof BENEFIT_TYPES)[number]
export const BENEFIT_TYPE_LABELS = {
  meal: 'Yemek',
  transport: 'Yol',
  child: 'Çocuk yardımı',
  service: 'Servis',
} as const satisfies Record<BenefitType, string>

export const BENEFIT_FORMS = ['cash', 'in_kind'] as const
export type BenefitForm = (typeof BENEFIT_FORMS)[number]
export const BENEFIT_FORM_LABELS = {
  cash: 'Nakdi',
  in_kind: 'Ayni',
} as const satisfies Record<BenefitForm, string>

/** Bütün tür değerleri (veritabanı denetimi ve yanıt şeması). */
export const PAY_RATE_TYPES = [...WAGE_TYPES, ...LESSON_PAY_TYPES, ...BENEFIT_TYPES] as const
export type PayRateType = (typeof PAY_RATE_TYPES)[number]

export const PAY_RATE_TYPE_LABELS: Readonly<Record<PayRateType, string>> = {
  ...WAGE_TYPE_LABELS,
  ...LESSON_PAY_TYPE_LABELS,
  ...BENEFIT_TYPE_LABELS,
}

/** Tutarın birimi (gösterim): aylık, saatlik ya da ders saati başına. */
export function payRateUnitLabel(component: PayRateComponent, rateType: PayRateType): string {
  if (component === 'benefit') return 'aylık'
  if (component === 'lesson') return 'saat başı'
  if (rateType === 'hourly') return 'saat başı'
  if (rateType === 'lesson_hour') return 'ders saati başı'
  return 'aylık'
}

/** Durum (saklanmaz, bugüne göre): ileri tarihli, yürürlükte, sona ermiş. */
export const PAY_RATE_STATES = ['scheduled', 'active', 'ended'] as const
export type PayRateState = (typeof PAY_RATE_STATES)[number]
export const PAY_RATE_STATE_LABELS = {
  scheduled: 'İleri tarihli',
  active: 'Yürürlükte',
  ended: 'Sona erdi',
} as const satisfies Record<PayRateState, string>

export const PAY_RATE_AMOUNT_MAX_CENTS = 1_000_000_000
export const PAY_RATE_NOTE_MAX = 200
export const PAY_RATE_CANCEL_REASON_MIN = 5
export const PAY_RATE_CANCEL_REASON_MAX = 500

// --- Şemalar -------------------------------------------------------------------------------------

const membershipSchema = z
  .string('Personel seçin.')
  .trim()
  .min(1, 'Personel seçin.')
  .max(100, 'Personel geçersiz.')
const amountSchema = z
  .number('Tutarı girin.')
  .int('Tutar kuruş cinsinden tam sayı olmalıdır.')
  .min(1, 'Tutar sıfırdan büyük olmalıdır.')
  .max(PAY_RATE_AMOUNT_MAX_CENTS, 'Tutar en fazla 10.000.000 ₺ olabilir.')
const noteSchema = z
  .string()
  .trim()
  .max(PAY_RATE_NOTE_MAX, `En fazla ${String(PAY_RATE_NOTE_MAX)} karakter girebilirsiniz.`)
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .default(null)

const common = {
  // kvkk: K (personel üyeliği)
  membershipId: membershipSchema.describe('Tanımın yapıldığı personelin kurum üyeliği'),
  // kvkk: K (ücret)
  amountCents: amountSchema.describe(
    'Tutar, kuruş: ana ücrette türün birimi (aylık, saat ya da ders saati başı), ek derste saat başı, yan hakta aylık',
  ),
  startDate: daySchema.describe('Yürürlük başlangıcı (gün)'),
  endDate: daySchema.nullable().default(null).describe('İsteğe bağlı bitiş (gün, dahil)'),
  note: noteSchema.describe('İsteğe bağlı not, en çok 200 karakter'),
}

const wageRateSchema = z.strictObject({
  component: z.literal('wage'),
  rateType: z
    .enum(WAGE_TYPES, 'Ücret türünü seçin.')
    .describe(
      '`monthly_gross` aylık brüt, `monthly_net` aylık net, `hourly` saatlik, `lesson_hour` ders saati',
    ),
  ...common,
})
const lessonRateSchema = z.strictObject({
  component: z.literal('lesson'),
  rateType: z
    .enum(LESSON_PAY_TYPES, 'Ek ders türünü seçin.')
    .describe('`extra` ek ders (ders yükü üstü, yedek ders dahil), `duty` nöbet'),
  ...common,
})
const benefitRateSchema = z.strictObject({
  component: z.literal('benefit'),
  rateType: z
    .enum(BENEFIT_TYPES, 'Yan hak türünü seçin.')
    .describe('`meal` yemek, `transport` yol, `child` çocuk yardımı, `service` servis'),
  benefitForm: z
    .enum(BENEFIT_FORMS, 'Nakdi ya da ayni seçin.')
    .describe('`cash` nakdi, `in_kind` ayni'),
  taxable: z.boolean('Vergiye tabi olup olmadığını seçin.').describe('Gelir vergisine tabi mi'),
  ...common,
})

/** Ücret tanımı (DOM-FIN-099): ana ücret, ek ders ücreti ya da yan hak. */
export const payRateInputSchema = z
  .discriminatedUnion(
    'component',
    [wageRateSchema, lessonRateSchema, benefitRateSchema],
    'Tanımın ana ücret, ek ders ücreti ya da yan hak olduğunu seçin.',
  )
  .superRefine((value, context) => {
    if (value.endDate !== null && value.endDate < value.startDate)
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'Bitiş günü başlangıç gününden önce olamaz.',
      })
  })
export type PayRateInput = z.input<typeof payRateInputSchema>
export type PayRateFields = z.output<typeof payRateInputSchema>

/** Son tanımın bitişini değiştir (K-304): gün ya da `null` (süresiz). */
export const payRateEndSchema = z.strictObject({
  endDate: daySchema.nullable().describe('Yeni bitiş günü (dahil); `null` süresiz yapar'),
})
export type PayRateEndFields = z.output<typeof payRateEndSchema>

/** Son tanımı iptal et (K-304): gerekçe 5–500 karakter. */
export const payRateCancelSchema = z.strictObject({
  reason: z
    .string('İptal gerekçesini yazın.')
    .trim()
    .min(PAY_RATE_CANCEL_REASON_MIN, 'İptal gerekçesini en az 5 karakterle yazın.')
    .max(
      PAY_RATE_CANCEL_REASON_MAX,
      `En fazla ${String(PAY_RATE_CANCEL_REASON_MAX)} karakter girebilirsiniz.`,
    )
    .describe('İptal gerekçesi; denetim kaydına yazılmaz'),
})
export type PayRateCancelFields = z.output<typeof payRateCancelSchema>

// --- Yuva ve yürürlük -------------------------------------------------------------------------

/** Çakışma yuvası (K-304): ana ücret tek yuva; ek ders ve yan hak türleri ayrı yuvalar. */
export function payRateSlot(component: PayRateComponent, rateType: string): string {
  return component === 'wage' ? 'wage' : `${component}:${rateType}`
}

/** Yürürlük aralığı olan tanım (saklanan satırın ilgili alanları). */
export interface PayRatePeriod {
  startDate: string
  endDate: string | null
}

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/** Bir önceki gün (`YYYY-MM-DD`, takvim günü; saat dilimi yok). */
export function previousDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

/** Tanım `day` gününde yürürlükte mi (başlangıç ve bitiş dahil). */
export const isPayRateInEffect = (rate: PayRatePeriod, day: string) =>
  rate.startDate <= day && (rate.endDate === null || rate.endDate >= day)

/** Bugüne göre durum: başlamamış, yürürlükte ya da sona ermiş. */
export function payRateState(rate: PayRatePeriod, today: string): PayRateState {
  if (rate.startDate > today) return 'scheduled'
  return rate.endDate !== null && rate.endDate < today ? 'ended' : 'active'
}

/**
 * "Şu tarihte geçerli ücret" (DOM-FIN-099): `day` gününde yürürlükte olan tanımlar, ana ücret,
 * ek ders ve yan hak sırasıyla. Yuvada çakışma olmadığından her yuvadan en çok bir tanım döner.
 */
export function payRatesOn<
  T extends PayRatePeriod & { component: PayRateComponent; rateType: string },
>(rates: readonly T[], day: string): T[] {
  const order = (rate: T) =>
    PAY_RATE_COMPONENTS.indexOf(rate.component) * 100 +
    (PAY_RATE_TYPES as readonly string[]).indexOf(rate.rateType)
  return rates.filter((rate) => isPayRateInEffect(rate, day)).sort((a, b) => order(a) - order(b))
}

/** `day` gününde yürürlükteki ana ücret; yoksa `null`. */
export function wageOn<T extends PayRatePeriod & { component: PayRateComponent; rateType: string }>(
  rates: readonly T[],
  day: string,
): T | null {
  return payRatesOn(rates, day).find((rate) => rate.component === 'wage') ?? null
}

/**
 * Kıdem hesaplayıcısına öneri (DOM-FIN-094 girdisi; yalnız okuma): `day` gününde yürürlükteki
 * aylık brüt ücret (ana ücret aylık brüt değilse `null`, çeviri yapılmaz) ve yürürlükteki yan
 * hakların aylık toplamı. Hesaplayıcı girdisi elle düzeltilebilir kalır.
 */
export function severancePaySuggestion(
  rates: readonly (PayRatePeriod & {
    component: PayRateComponent
    rateType: string
    amountCents: number
  })[],
  day: string,
): { grossWageCents: number | null; regularBenefitsCents: number } {
  const effective = payRatesOn(rates, day)
  const wage = effective.find((rate) => rate.component === 'wage')
  return {
    grossWageCents: wage?.rateType === 'monthly_gross' ? wage.amountCents : null,
    regularBenefitsCents: effective
      .filter((rate) => rate.component === 'benefit')
      .reduce((sum, rate) => sum + rate.amountCents, 0),
  }
}

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string) =>
  new DomainError(code, message, { kind: 'rule', path: [path] })

/** Yeni tanımın denetimi için servis kurum kilidi altında yükler. */
export interface PayRateChecks {
  /** Üyelik: kurumda yoksa `null`; `active` pasifleştirilmemiş demektir. */
  staff: { role: string; active: boolean } | null
  /** Aynı yuvadaki iptal edilmemiş tanımlar. */
  slotRates: readonly (PayRatePeriod & { id: string })[]
}

/** Yeni tanımla kendiliğinden kapanan önceki tanım: yeni bitiş ve iptalde geri yazılacak eski bitiş. */
export interface PayRateClosure {
  id: string
  endDate: string
  previousEndDate: string | null
}

export interface PayRatePlan {
  slot: string
  close: PayRateClosure | null
}

/** Yuvanın son tanımı (en geç başlayan); yuva boşsa `null`. */
export function latestPayRate<T extends PayRatePeriod>(rates: readonly T[]): T | null {
  let latest: T | null = null
  for (const rate of rates) if (latest === null || rate.startDate > latest.startDate) latest = rate
  return latest
}

/**
 * Yeni tanım (DOM-FIN-099, K-304). Personel kurumun etkin yönetici, öğretmen ya da ön büro
 * üyeliğidir. Yeni tanım yuvanın son tanımından sonra başlar (geçmişe ara tanım yazılmaz; geçmiş
 * son tanımı iptal ederek düzeltilir). Son tanım yeni başlangıçta hâlâ yürürlükteyse (süresiz ya
 * da bitişi yeni başlangıçla aynı gün ya da sonra) bitişi yeni başlangıçtan bir gün önceye çekilir.
 */
export function planPayRate(input: PayRateFields, checks: PayRateChecks): PayRatePlan {
  if (checks.staff === null)
    throw ruleError('pay_rate_staff_not_found', 'Personel bulunamadı.', 'membershipId')
  if (!isStaffRole(checks.staff.role))
    throw ruleError(
      'pay_rate_not_staff',
      'Ücret tanımı yalnız personele (yönetici, öğretmen, ön büro) yapılır.',
      'membershipId',
    )
  if (!checks.staff.active)
    throw ruleError(
      'pay_rate_staff_inactive',
      'Pasifleştirilmiş (ayrılan) personele yeni ücret tanımı yapılmaz.',
      'membershipId',
    )
  const latest = latestPayRate(checks.slotRates)
  if (latest !== null && input.startDate <= latest.startDate)
    throw ruleError(
      'pay_rate_start_not_after_latest',
      `Yeni tanım bu türün son tanımının başlangıcından (${dayText(latest.startDate)}) sonra başlamalı. Geçmişi düzeltmek için son tanımı iptal edin.`,
      'startDate',
    )
  const close =
    latest !== null && (latest.endDate === null || latest.endDate >= input.startDate)
      ? { id: latest.id, endDate: previousDay(input.startDate), previousEndDate: latest.endDate }
      : null
  return { slot: payRateSlot(input.component, input.rateType), close }
}

/** Değiştirilecek ya da iptal edilecek tanım ve yuvadaki yeri. */
export interface PayRateTarget extends PayRatePeriod {
  /** Yuvanın son tanımı mı (sonraki tanım yoksa). */
  isLatest: boolean
}

function requireLatest(target: PayRateTarget, message: string) {
  if (!target.isLatest) throw ruleError('pay_rate_not_latest', message, 'id')
}

/**
 * Bitiş değiştirme (K-304): yalnız yuvanın son tanımında; öncekilerin bitişini sonraki tanım
 * belirler. Bitiş başlangıçtan önce olamaz; aynı bitiş yeniden yazılmaz.
 */
export function planPayRateEnd(target: PayRateTarget, input: PayRateEndFields): void {
  requireLatest(
    target,
    'Yalnız bu türün son tanımının bitişi değiştirilir; öncekilerin bitişi sonraki tanımla belirlenir.',
  )
  if (input.endDate !== null && input.endDate < target.startDate)
    throw ruleError(
      'pay_rate_end_before_start',
      'Bitiş günü başlangıç gününden önce olamaz.',
      'endDate',
    )
  if (input.endDate === target.endDate)
    throw ruleError('pay_rate_end_unchanged', 'Bitiş günü değişmedi.', 'endDate')
}

/**
 * İptal (K-304): yalnız yuvanın son tanımı iptal edilir (önce sonrakiler). İptal edilen tanım
 * öncekini kendiliğinden kapattıysa önceki tanımın eski bitişi geri yazılır.
 */
export function planPayRateCancel(
  target: PayRateTarget,
  closed: { id: string; previousEndDate: string | null } | null,
): { reopen: { id: string; endDate: string | null } | null } {
  requireLatest(target, 'Yalnız bu türün son tanımı iptal edilir; önce sonraki tanımı iptal edin.')
  return { reopen: closed === null ? null : { id: closed.id, endDate: closed.previousEndDate } }
}
