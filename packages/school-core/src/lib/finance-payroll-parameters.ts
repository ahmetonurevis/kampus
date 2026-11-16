import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { dateLabel, money } from './format.ts'

/**
 * Bordro parametreleri (docs/domain/finans.md DOM-FIN-100; ON-197). Yürürlük tarihli parametre
 * setleri: brüt asgari ücret, ücret gelir vergisi dilimleri, SGK ve işsizlik sigortası payları, SGK
 * taban ve tavan çarpanı, damga vergisi oranı, asgari ücret istisnaları ve kıdem tazminatı tavanı.
 * Bordro hesabı (ON-198) bu modülde değildir; burada yalnız değerler, doğrulaması ve "o gün geçerli
 * set" çözümü vardır.
 *
 * - Birimler: tutarlar kuruş tamsayı; oranlar ve çarpanlar on binde bir (baz puan, 10.000 = %100 ya
 *   da 1 kat); damga vergisi yüz binde bir (759 = binde 7,59). Her tutar bir kez kuruşa yuvarlanır
 *   (yarım yukarı).
 * - Platform varsayılanı kodda durur (`PAYROLL_PLATFORM_DEFAULTS`) ve sürümle güncellenir; kurum
 *   kendi kopyasını (aynı ya da yeni yürürlük başlangıcıyla) yazar. Aynı başlangıçta kurum kopyası
 *   platform değerini ezer; kopya arşivlenince platform değeri geri gelir (K-308, K-309).
 * - Her set tamdır, eksik alan önceki setten devralınmaz; net asgari ücret saklanmaz, brütten
 *   hesaplanır (K-310). Yürürlük başlangıcı ayın ilk günüdür (K-311).
 *
 * Platform değerleri **doğrulanmalıdır** (M-40, M-41; mevzuat dayanağı H-43, H-44).
 */

/** Okuyan roller: yönetici ve ön büro (değerler kişisel veri değildir). Muhasebe açılınca o da (K-309). */
export const PAYROLL_PARAMETER_READ_ROLES = [
  'yonetici',
  'onburo',
] as const satisfies readonly Role[]
/** Kurum kopyasını yazan rol (K-309). */
export const PAYROLL_PARAMETER_WRITE_ROLES = ['yonetici'] as const satisfies readonly Role[]

/** %100 = 10.000 (on binde bir). Çarpanlarda 10.000 = 1 kat. */
export const BASIS_POINTS_SCALE = 10_000
/** Damga vergisi oranının ölçeği: yüz binde bir (759 = binde 7,59). */
export const STAMP_TAX_SCALE = 100_000
/** Parametre setinin en erken ve en geç yürürlük başlangıcı. */
export const PAYROLL_MIN_DATE = '2020-01-01'
export const PAYROLL_MAX_DATE = '2099-12-01'
export const PAYROLL_MIN_YEAR = 2020
export const PAYROLL_MAX_YEAR = 2099
/** Dilim sayısı üst sınırı (bugünkü tarife 5 dilimdir). */
export const PAYROLL_MAX_BRACKETS = 10
/** Asgari ücret ve kıdem tavanı üst sınırı: 10.000.000 ₺ (yazım hatasına karşı). */
export const PAYROLL_AMOUNT_MAX_CENTS = 1_000_000_000
/** Dilim alt sınırı üst sınırı: 1.000.000.000 ₺. */
export const PAYROLL_BRACKET_MAX_CENTS = 100_000_000_000
/** Taban ve tavan çarpanı üst sınırı: 20 kat. */
export const PAYROLL_MULTIPLIER_MAX = 200_000
/** Damga vergisi oranı üst sınırı: %10. */
export const PAYROLL_STAMP_TAX_MAX = 10_000

/** Ekranda ve PDF'te tablonun altında duran uyarı. */
export const PAYROLL_PARAMETERS_NOTE =
  'Platform değerleri mali müşavir doğrulaması bekliyor; bordroda kullanmadan önce resmî kaynakla karşılaştırın.'

// --- Şema ----------------------------------------------------------------------------------------

const rate = (label: string) =>
  z
    .number(`${label} girin.`)
    .int(`${label} on binde bir cinsinden tam sayı olmalıdır.`)
    .min(0, `${label} eksi olamaz.`)
    .max(BASIS_POINTS_SCALE, `${label} %100'ü aşamaz.`)

const amount = (label: string) =>
  z
    .number(`${label} girin.`)
    .int(`${label} kuruş cinsinden tam sayı olmalıdır.`)
    .min(1, `${label} sıfırdan büyük olmalıdır.`)
    .max(PAYROLL_AMOUNT_MAX_CENTS, `${label} en fazla 10.000.000 ₺ olabilir.`)

const multiplier = (label: string) =>
  z
    .number(`${label} girin.`)
    .int(`${label} on binde bir cinsinden tam sayı olmalıdır.`)
    .min(1, `${label} sıfırdan büyük olmalıdır.`)
    .max(PAYROLL_MULTIPLIER_MAX, `${label} en fazla 20 kat olabilir.`)

const flag = (label: string) => z.boolean(`${label} açık ya da kapalı olmalıdır.`)

export const incomeTaxBracketSchema = z.strictObject({
  /** Dilimin alt sınırı: yıllık kümülatif matrah, kuruş. İlk dilim 0'dan başlar. */
  lowerBoundCents: z
    .number('Dilim alt sınırını girin.')
    .int('Dilim alt sınırı kuruş cinsinden tam sayı olmalıdır.')
    .min(0, 'Dilim alt sınırı eksi olamaz.')
    .max(PAYROLL_BRACKET_MAX_CENTS, 'Dilim alt sınırı en fazla 1.000.000.000 ₺ olabilir.'),
  rateBasisPoints: rate('Dilim oranı'),
})
export type IncomeTaxBracket = z.output<typeof incomeTaxBracketSchema>

/**
 * Artan oranlı gelir vergisi tarifesi (GVK md. 103): ilk dilim 0 ₺'den başlar, alt sınırlar kesin
 * artan (dilimler çakışmaz, boşluk yoktur: bir dilimin üst sınırı sonrakinin alt sınırıdır), oranlar
 * kesin artan; 1–10 dilim (K-311).
 */
export const incomeTaxBracketsSchema = z
  .array(incomeTaxBracketSchema, 'Gelir vergisi dilimlerini girin.')
  .min(1, 'En az bir gelir vergisi dilimi girin.')
  .max(PAYROLL_MAX_BRACKETS, `En fazla ${String(PAYROLL_MAX_BRACKETS)} dilim girilebilir.`)
  .superRefine((brackets, context) => {
    const first = brackets[0]
    if (first && first.lowerBoundCents !== 0)
      context.addIssue({
        code: 'custom',
        path: [0, 'lowerBoundCents'],
        message: "İlk dilim 0 ₺'den başlamalıdır.",
      })
    brackets.forEach((bracket, index) => {
      const previous = brackets[index - 1]
      if (!previous) return
      if (bracket.lowerBoundCents <= previous.lowerBoundCents)
        context.addIssue({
          code: 'custom',
          path: [index, 'lowerBoundCents'],
          message: 'Dilim alt sınırları artan sırada olmalı; dilimler çakışamaz.',
        })
      if (bracket.rateBasisPoints <= previous.rateBasisPoints)
        context.addIssue({
          code: 'custom',
          path: [index, 'rateBasisPoints'],
          message:
            'Dilim oranı bir önceki dilimin oranından büyük olmalıdır (artan oranlı tarife).',
        })
    })
  })

const effectiveFromSchema = daySchema.superRefine((day, context) => {
  if (!day.endsWith('-01'))
    context.addIssue({ code: 'custom', message: 'Yürürlük başlangıcı ayın ilk günü olmalıdır.' })
  if (day < PAYROLL_MIN_DATE || day > PAYROLL_MAX_DATE)
    context.addIssue({
      code: 'custom',
      message: 'Yürürlük başlangıcı 2020 ile 2099 yılları arasında olmalıdır.',
    })
})

const fieldsShape = {
  effectiveFrom: effectiveFromSchema,
  minimumWageGrossCents: amount('Brüt asgari ücret'),
  incomeTaxBrackets: incomeTaxBracketsSchema,
  sgkEmployeeRateBasisPoints: rate('SGK işçi payı'),
  sgkEmployerRateBasisPoints: rate('SGK işveren payı'),
  sgkEmployerIncentiveBasisPoints: rate('SGK işveren prim indirimi'),
  unemploymentEmployeeRateBasisPoints: rate('İşsizlik sigortası işçi payı'),
  unemploymentEmployerRateBasisPoints: rate('İşsizlik sigortası işveren payı'),
  sgkFloorMultiplierBasisPoints: multiplier('SGK taban çarpanı'),
  sgkCeilingMultiplierBasisPoints: multiplier('SGK tavan çarpanı'),
  stampTaxRatePer100k: z
    .number('Damga vergisi oranını girin.')
    .int('Damga vergisi oranı yüz binde bir cinsinden tam sayı olmalıdır.')
    .min(0, 'Damga vergisi oranı eksi olamaz.')
    .max(PAYROLL_STAMP_TAX_MAX, "Damga vergisi oranı %10'u aşamaz."),
  minimumWageIncomeTaxExempt: flag('Asgari ücret gelir vergisi istisnası'),
  minimumWageStampTaxExempt: flag('Asgari ücret damga vergisi istisnası'),
  severanceCeilingCents: amount('Kıdem tazminatı tavanı'),
  source: z
    .string('Kaynağı yazın.')
    .trim()
    .min(3, 'Kaynağı yazın (Resmî Gazete, GİB ya da SGK duyurusu).')
    .max(300, 'Kaynak en fazla 300 karakter olabilir.'),
}

export type PayrollParameterValues = {
  [Key in keyof typeof fieldsShape]: z.output<(typeof fieldsShape)[Key]>
}
export type PayrollParameterField = keyof PayrollParameterValues
export const PAYROLL_PARAMETER_FIELDS = Object.keys(fieldsShape) as PayrollParameterField[]

/** Alanlar arası kurallar: indirim işveren payını, taban tavanı aşamaz. */
function crossCheck(
  value: Pick<
    PayrollParameterValues,
    | 'sgkEmployerRateBasisPoints'
    | 'sgkEmployerIncentiveBasisPoints'
    | 'sgkFloorMultiplierBasisPoints'
    | 'sgkCeilingMultiplierBasisPoints'
  >,
  context: z.RefinementCtx,
) {
  if (value.sgkEmployerIncentiveBasisPoints > value.sgkEmployerRateBasisPoints)
    context.addIssue({
      code: 'custom',
      path: ['sgkEmployerIncentiveBasisPoints'],
      message: 'İşveren prim indirimi işveren payından büyük olamaz.',
    })
  if (value.sgkCeilingMultiplierBasisPoints <= value.sgkFloorMultiplierBasisPoints)
    context.addIssue({
      code: 'custom',
      path: ['sgkCeilingMultiplierBasisPoints'],
      message: 'SGK tavan çarpanı taban çarpanından büyük olmalıdır.',
    })
}

/** Kurum kopyası (oluşturma): bütün alanlar zorunlu (K-310). */
export const payrollParameterSetSchema = z.strictObject(fieldsShape).superRefine(crossCheck)
export type PayrollParameterSetInput = z.input<typeof payrollParameterSetSchema>

/** Kısmi düzeltme: en az bir alan; dilimler bütün olarak yazılır. Birleşik set yeniden doğrulanır. */
export const updatePayrollParameterSetSchema = z
  .strictObject(fieldsShape)
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Değiştirilecek en az bir alan gönderin.')
export type PayrollParameterSetUpdate = z.output<typeof updatePayrollParameterSetSchema>

/** Setin yalnız parametre alanları (kimlik, sürüm ve işaretler atılır), derin kopya. */
const valuesOf = (set: PayrollParameterValues): PayrollParameterValues => ({
  effectiveFrom: set.effectiveFrom,
  minimumWageGrossCents: set.minimumWageGrossCents,
  incomeTaxBrackets: set.incomeTaxBrackets.map((bracket) => ({ ...bracket })),
  sgkEmployeeRateBasisPoints: set.sgkEmployeeRateBasisPoints,
  sgkEmployerRateBasisPoints: set.sgkEmployerRateBasisPoints,
  sgkEmployerIncentiveBasisPoints: set.sgkEmployerIncentiveBasisPoints,
  unemploymentEmployeeRateBasisPoints: set.unemploymentEmployeeRateBasisPoints,
  unemploymentEmployerRateBasisPoints: set.unemploymentEmployerRateBasisPoints,
  sgkFloorMultiplierBasisPoints: set.sgkFloorMultiplierBasisPoints,
  sgkCeilingMultiplierBasisPoints: set.sgkCeilingMultiplierBasisPoints,
  stampTaxRatePer100k: set.stampTaxRatePer100k,
  minimumWageIncomeTaxExempt: set.minimumWageIncomeTaxExempt,
  minimumWageStampTaxExempt: set.minimumWageStampTaxExempt,
  severanceCeilingCents: set.severanceCeilingCents,
  source: set.source,
})

/**
 * Düzeltmeyi mevcut sete uygular, birleşik seti tam şemayla doğrular (alanlar arası kurallar) ve
 * gerçekten değişen alanların adlarını döner (denetim kaydına değer değil ad yazılır).
 */
export function mergePayrollParameterUpdate(
  current: PayrollParameterValues,
  changes: PayrollParameterSetUpdate,
): { values: PayrollParameterValues; changed: PayrollParameterField[] } {
  const values = payrollParameterSetSchema.parse({ ...valuesOf(current), ...changes })
  const changed = PAYROLL_PARAMETER_FIELDS.filter(
    (field) => field in changes && JSON.stringify(values[field]) !== JSON.stringify(current[field]),
  )
  return { values, changed }
}

/** Aynı yürürlük başlangıcında kurumun etkin kopyası varsa 409. */
export function assertPayrollEffectiveFromFree(taken: boolean): void {
  if (taken)
    throw new DomainError(
      'payroll_parameters_exist',
      'Bu yürürlük başlangıcı için kurumun parametre seti var; yeni set yerine onu düzeltin.',
      { kind: 'conflict', path: ['effectiveFrom'] },
    )
}

// --- Platform varsayılanı ------------------------------------------------------------------------

export interface PayrollPlatformSet extends PayrollParameterValues {
  /** Sabit kimlik: `platform-<yürürlük başlangıcı>`. */
  id: string
  /** Emin olunmayan, ayrıca mali müşavire sorulan alanlar (M-40). */
  unverifiedFields: readonly PayrollParameterField[]
}

const TARIFF_RATES = [1500, 2000, 2700, 3500, 4000] as const
/** Ücret tarifesi: dört üst sınır (kuruş) → beş dilim, alt sınırlarla. */
const wageTariff = (limits: readonly [number, number, number, number]): IncomeTaxBracket[] =>
  TARIFF_RATES.map((rateBasisPoints, index) => ({
    lowerBoundCents: index === 0 ? 0 : (limits[index - 1] ?? 0),
    rateBasisPoints,
  }))

/** 2025 ve 2026'da değişmeyen oranlar (5510 md. 81, 4447 md. 49, DVK). */
const COMMON_RATES = {
  // 5510 md. 81: işçi malullük-yaşlılık-ölüm %9 + genel sağlık %5.
  sgkEmployeeRateBasisPoints: 1400,
  // 5510 md. 81: işveren malullük-yaşlılık-ölüm %11 + genel sağlık %7,5 + kısa vadeli %2,25.
  sgkEmployerRateBasisPoints: 2075,
  // 5510 md. 81/ı: Hazine desteği (5 puan); sektör ve şartlara göre değişebilir.
  sgkEmployerIncentiveBasisPoints: 500,
  // 4447 md. 49: işsizlik sigortası işçi %1, işveren %2.
  unemploymentEmployeeRateBasisPoints: 100,
  unemploymentEmployerRateBasisPoints: 200,
  // 5510 md. 82: prime esas kazanç alt sınırı asgari ücrettir.
  sgkFloorMultiplierBasisPoints: 10_000,
  // 488 sayılı DVK (1) sayılı tablo IV-1: ücretlerde binde 7,59.
  stampTaxRatePer100k: 759,
  // GVK md. 23/18 ve DVK md. 9 (2022'den beri): asgari ücret tutarı kadar istisna.
  minimumWageIncomeTaxExempt: true,
  minimumWageStampTaxExempt: true,
} as const

const SOURCE_2025 =
  'Asgari Ücret Tespit Komisyonu kararı (2025); GİB 2025 ücret gelir vergisi tarifesi (GVK md. 103); 5510 sayılı Kanun md. 81, 82; 4447 sayılı Kanun md. 49; 488 sayılı DVK (1) sayılı tablo IV-1; kıdem tavanı Hazine ve Maliye Bakanlığı memur maaş katsayısı genelgesi.'
const SOURCE_2026 =
  'Asgari Ücret Tespit Komisyonu kararı (2026); GİB 2026 ücret gelir vergisi tarifesi (GVK md. 103); 5510 sayılı Kanun md. 81, 82; 4447 sayılı Kanun md. 49; 488 sayılı DVK (1) sayılı tablo IV-1; kıdem tavanı Hazine ve Maliye Bakanlığı memur maaş katsayısı genelgesi.'

/**
 * Platform varsayılanı (tüm kurumlar). Yeni dönem (ocak; kıdem tavanında temmuz; yıl ortası asgari
 * ücret artışı) yeni satırla eklenir, eski satır değişmez. Değerler **doğrulanmalı** (M-40);
 * `unverifiedFields` ayrıca emin olunmayan alanlardır. Kıdem tavanı ve dilimler kıdem
 * hesaplayıcısının tablolarıyla aynıdır (`finance-severance.ts`; tutarlılık testle denetlenir).
 *
 * - 2025: brüt asgari ücret 26.005,50 ₺ (net 22.104,67 ₺); dilimler 158.000 / 330.000 /
 *   1.200.000 / 4.300.000 ₺; SGK tavanı 7,5 kat; kıdem tavanı ocak 46.655,43 ₺, temmuz 53.919,68 ₺.
 * - 2026: brüt asgari ücret 33.030,00 ₺ (net 28.075,50 ₺); dilimler 190.000 / 400.000 /
 *   1.500.000 / 5.300.000 ₺; SGK tavanı 9 kat; kıdem tavanı ocak 64.948,77 ₺. 2026 temmuz kıdem
 *   tavanı ve olası yıl ortası asgari ücret artışı M-40'ta sorulur.
 */
export const PAYROLL_PLATFORM_DEFAULTS: readonly PayrollPlatformSet[] = [
  {
    id: 'platform-2025-01-01',
    effectiveFrom: '2025-01-01',
    minimumWageGrossCents: 2_600_550,
    incomeTaxBrackets: wageTariff([15_800_000, 33_000_000, 120_000_000, 430_000_000]),
    ...COMMON_RATES,
    sgkCeilingMultiplierBasisPoints: 75_000,
    severanceCeilingCents: 4_665_543,
    source: SOURCE_2025,
    unverifiedFields: [
      'sgkEmployerRateBasisPoints',
      'sgkEmployerIncentiveBasisPoints',
      'sgkCeilingMultiplierBasisPoints',
      'severanceCeilingCents',
    ],
  },
  {
    id: 'platform-2025-07-01',
    effectiveFrom: '2025-07-01',
    minimumWageGrossCents: 2_600_550,
    incomeTaxBrackets: wageTariff([15_800_000, 33_000_000, 120_000_000, 430_000_000]),
    ...COMMON_RATES,
    sgkCeilingMultiplierBasisPoints: 75_000,
    severanceCeilingCents: 5_391_968,
    source: SOURCE_2025,
    unverifiedFields: [
      'sgkEmployerRateBasisPoints',
      'sgkEmployerIncentiveBasisPoints',
      'sgkCeilingMultiplierBasisPoints',
      'severanceCeilingCents',
    ],
  },
  {
    id: 'platform-2026-01-01',
    effectiveFrom: '2026-01-01',
    minimumWageGrossCents: 3_303_000,
    incomeTaxBrackets: wageTariff([19_000_000, 40_000_000, 150_000_000, 530_000_000]),
    ...COMMON_RATES,
    sgkCeilingMultiplierBasisPoints: 90_000,
    severanceCeilingCents: 6_494_877,
    source: SOURCE_2026,
    unverifiedFields: [
      'minimumWageGrossCents',
      'incomeTaxBrackets',
      'sgkEmployerRateBasisPoints',
      'sgkEmployerIncentiveBasisPoints',
      'sgkCeilingMultiplierBasisPoints',
      'severanceCeilingCents',
    ],
  },
]

// --- Geçerli set ---------------------------------------------------------------------------------

/** Kurumun kayıtlı (arşivlenmemiş) kopyası. */
export interface PayrollInstitutionSet extends PayrollParameterValues {
  id: string
  version: number
}

export type PayrollOrigin = 'platform' | 'institution'

export interface PayrollResolvedSet {
  id: string
  origin: PayrollOrigin
  /** Kurum kopyası aynı başlangıçlı platform setinin yerini aldı mı. */
  overridesPlatform: boolean
  /** Kurum kopyasında iyimser kilit sürümü; platform setinde `null`. */
  version: number | null
  values: PayrollParameterValues
  /** Platform setinde emin olunmayan alanlar; kurum kopyasında boş (değer kurumundur). */
  unverifiedFields: readonly PayrollParameterField[]
}

/**
 * Platform ve kurum setlerinin birleşimi, yürürlük başlangıcına göre artan. Aynı başlangıçta kurum
 * kopyası platform setinin yerini alır (K-309).
 */
export function payrollParameterTimeline(
  institutionSets: readonly PayrollInstitutionSet[],
  platform: readonly PayrollPlatformSet[] = PAYROLL_PLATFORM_DEFAULTS,
): PayrollResolvedSet[] {
  const byStart = new Map<string, PayrollResolvedSet>()
  for (const set of platform)
    byStart.set(set.effectiveFrom, {
      id: set.id,
      origin: 'platform',
      overridesPlatform: false,
      version: null,
      values: valuesOf(set),
      unverifiedFields: set.unverifiedFields,
    })
  for (const set of institutionSets)
    byStart.set(set.effectiveFrom, {
      id: set.id,
      origin: 'institution',
      overridesPlatform: byStart.get(set.effectiveFrom)?.origin === 'platform',
      version: set.version,
      values: valuesOf(set),
      unverifiedFields: [],
    })
  return [...byStart.values()].sort((a, b) =>
    a.values.effectiveFrom.localeCompare(b.values.effectiveFrom),
  )
}

export interface PayrollEffectiveSet extends PayrollResolvedSet {
  /** Gün setin yılından sonraki bir yılda: o yıl için tanımlı set yok, son bilinen set kullanıldı. */
  stale: boolean
}

/**
 * Günde geçerli set: yürürlük başlangıcı güne eşit ya da önce olan en geç set (DOM-FIN-100). Tablonun
 * ilk setinden önceki gün için `null`.
 */
export function effectivePayrollParameters(
  day: string,
  institutionSets: readonly PayrollInstitutionSet[],
  platform: readonly PayrollPlatformSet[] = PAYROLL_PLATFORM_DEFAULTS,
): PayrollEffectiveSet | null {
  let found: PayrollResolvedSet | null = null
  for (const set of payrollParameterTimeline(institutionSets, platform))
    if (set.values.effectiveFrom <= day) found = set
  if (found === null) return null
  return { ...found, stale: day.slice(0, 4) > found.values.effectiveFrom.slice(0, 4) }
}

/** Günde geçerli set yoksa 422 (tablonun ilk setinden önceki gün). */
export function requireEffectivePayrollParameters(
  day: string,
  institutionSets: readonly PayrollInstitutionSet[],
  platform: readonly PayrollPlatformSet[] = PAYROLL_PLATFORM_DEFAULTS,
): PayrollEffectiveSet {
  const found = effectivePayrollParameters(day, institutionSets, platform)
  if (found === null)
    throw new DomainError(
      'payroll_parameters_missing',
      'Bu gün için bordro parametresi tanımlı değil.',
      { path: ['date'] },
    )
  return found
}

// --- Hesaplanan değerler -------------------------------------------------------------------------

const ofBasisPoints = (cents: number, basisPoints: number) =>
  Math.round((cents * basisPoints) / BASIS_POINTS_SCALE)

export interface PayrollDerivedValues {
  /** Asgari ücretin işçi SGK payı. */
  minimumWageEmployeeSgkCents: number
  /** Asgari ücretin işsizlik sigortası işçi payı. */
  minimumWageEmployeeUnemploymentCents: number
  /** Asgari ücrete gelir vergisi: istisna açıksa 0, kapalıysa ilk dilim oranıyla (bir ay, kümülatifsiz). */
  minimumWageIncomeTaxCents: number
  /** Asgari ücrete damga vergisi: istisna açıksa 0. */
  minimumWageStampTaxCents: number
  /** Net asgari ücret: brüt − işçi SGK − işsizlik − gelir ve damga vergisi (K-310). */
  minimumWageNetCents: number
  /** SGK prime esas kazanç alt ve üst sınırı (aylık): brüt asgari ücret × çarpan. */
  sgkFloorCents: number
  sgkCeilingCents: number
  /** Teşvikli işveren SGK oranı: işveren payı − prim indirimi. */
  sgkEmployerNetRateBasisPoints: number
}

/** Setten hesaplanan değerler; saklanmaz (K-310). */
export function payrollDerivedValues(values: PayrollParameterValues): PayrollDerivedValues {
  const gross = values.minimumWageGrossCents
  const sgk = ofBasisPoints(gross, values.sgkEmployeeRateBasisPoints)
  const unemployment = ofBasisPoints(gross, values.unemploymentEmployeeRateBasisPoints)
  const firstRate = values.incomeTaxBrackets[0]?.rateBasisPoints ?? 0
  const incomeTax = values.minimumWageIncomeTaxExempt
    ? 0
    : ofBasisPoints(gross - sgk - unemployment, firstRate)
  const stampTax = values.minimumWageStampTaxExempt
    ? 0
    : Math.round((gross * values.stampTaxRatePer100k) / STAMP_TAX_SCALE)
  return {
    minimumWageEmployeeSgkCents: sgk,
    minimumWageEmployeeUnemploymentCents: unemployment,
    minimumWageIncomeTaxCents: incomeTax,
    minimumWageStampTaxCents: stampTax,
    minimumWageNetCents: gross - sgk - unemployment - incomeTax - stampTax,
    sgkFloorCents: ofBasisPoints(gross, values.sgkFloorMultiplierBasisPoints),
    sgkCeilingCents: ofBasisPoints(gross, values.sgkCeilingMultiplierBasisPoints),
    sgkEmployerNetRateBasisPoints:
      values.sgkEmployerRateBasisPoints - values.sgkEmployerIncentiveBasisPoints,
  }
}

// --- Yıllık tablo --------------------------------------------------------------------------------

const pad = (value: number) => String(value).padStart(2, '0')
const previousDay = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10)

export interface PayrollPeriod extends PayrollResolvedSet {
  /** Dönemin yıl içindeki ilk ve son günü. */
  periodStart: string
  periodEnd: string
  /** Set önceki yıldan sürüyor: yılın başında başlayan set yok. */
  carriedOver: boolean
  derived: PayrollDerivedValues
}

export interface PayrollParameterYear {
  year: number
  periods: PayrollPeriod[]
  /** Platform ya da kurum seti olan yıllar (yıl seçimi için), artan. */
  availableYears: number[]
}

/**
 * Yılın dönemleri (DOM-FIN-100): yıl içinde başlayan setler ve yılın 1 Ocak'ında önceki yıldan süren
 * set (`carriedOver`). Dönem bir sonraki setin başlangıcından bir gün önce ya da 31 Aralık'ta biter.
 */
export function payrollParameterYear(
  year: number,
  institutionSets: readonly PayrollInstitutionSet[],
  platform: readonly PayrollPlatformSet[] = PAYROLL_PLATFORM_DEFAULTS,
): PayrollParameterYear {
  const timeline = payrollParameterTimeline(institutionSets, platform)
  const yearStart = `${String(year)}-01-01`
  const yearEnd = `${String(year)}-12-31`
  const inYear = timeline.filter((set) => set.values.effectiveFrom.startsWith(`${String(year)}-`))
  const carried = timeline.filter((set) => set.values.effectiveFrom < yearStart).at(-1)
  const startsOnFirstDay = inYear[0]?.values.effectiveFrom === yearStart
  const starts =
    carried && !startsOnFirstDay ? [{ set: carried, start: yearStart, carriedOver: true }] : []
  const rows = [
    ...starts,
    ...inYear.map((set) => ({ set, start: set.values.effectiveFrom, carriedOver: false })),
  ]
  const periods = rows.map(({ set, start, carriedOver }, index): PayrollPeriod => {
    const next = rows[index + 1]
    return {
      ...set,
      periodStart: start,
      periodEnd: next ? previousDay(next.start) : yearEnd,
      carriedOver,
      derived: payrollDerivedValues(set.values),
    }
  })
  const availableYears = [
    ...new Set(timeline.map((set) => Number(set.values.effectiveFrom.slice(0, 4)))),
  ].sort((a, b) => a - b)
  return { year, periods, availableYears }
}

// --- Kıdem hesaplayıcısına okuma bağı -----------------------------------------------------------

/**
 * Kıdem tavanı satırları, kıdem hesaplayıcısının `SEVERANCE_CEILINGS` biçiminde (DOM-FIN-094).
 * Hesaplayıcı bugün kendi tablosunu kullanır; parametre tablosuna geçişte bu satırlar verilir.
 */
export function severanceCeilingRows(
  institutionSets: readonly PayrollInstitutionSet[],
  platform: readonly PayrollPlatformSet[] = PAYROLL_PLATFORM_DEFAULTS,
): { from: string; monthlyCents: number }[] {
  return payrollParameterTimeline(institutionSets, platform).map((set) => ({
    from: set.values.effectiveFrom,
    monthlyCents: set.values.severanceCeilingCents,
  }))
}

/** Dilimler kıdem hesaplayıcısının tarife biçiminde (`upToCents`, son dilimde `null`). */
export function wageTariffBrackets(
  brackets: readonly IncomeTaxBracket[],
): { upToCents: number | null; rateBasisPoints: number }[] {
  return brackets.map((bracket, index) => ({
    upToCents: brackets[index + 1]?.lowerBoundCents ?? null,
    rateBasisPoints: bracket.rateBasisPoints,
  }))
}

// --- Gösterim (web ve test ortak) ----------------------------------------------------------------

const decimal = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 })

/** 2075 → "%20,75". */
export const basisPointsLabel = (basisPoints: number) => `%${decimal.format(basisPoints / 100)}`
/** 759 → "binde 7,59". */
export const stampTaxLabel = (per100k: number) => `binde ${decimal.format(per100k / 100)}`
/** 75000 → "7,5 kat". */
export const multiplierLabel = (basisPoints: number) =>
  `${decimal.format(basisPoints / BASIS_POINTS_SCALE)} kat`
/** Gün gösterimi: 1 Ocak 2026. */
export const payrollDayLabel = (day: string) =>
  dateLabel(`${day}T09:00:00.000Z`, { day: 'numeric', month: 'long', year: 'numeric' })

/** Dilim satırları: [aralık, oran]; son dilimin üst sınırı yoktur. */
export function incomeTaxBracketRows(brackets: readonly IncomeTaxBracket[]): [string, string][] {
  return wageTariffBrackets(brackets).map((bracket, index) => {
    const lower = brackets[index]?.lowerBoundCents ?? 0
    const range =
      bracket.upToCents === null
        ? `${money(lower)} üzeri`
        : `${money(lower)} – ${money(bracket.upToCents)}`
    return [range, basisPointsLabel(bracket.rateBasisPoints)]
  })
}

export const PAYROLL_PARAMETER_LABELS: Readonly<Record<PayrollParameterField, string>> = {
  effectiveFrom: 'Yürürlük başlangıcı',
  minimumWageGrossCents: 'Brüt asgari ücret',
  incomeTaxBrackets: 'Gelir vergisi dilimleri',
  sgkEmployeeRateBasisPoints: 'SGK işçi payı',
  sgkEmployerRateBasisPoints: 'SGK işveren payı',
  sgkEmployerIncentiveBasisPoints: 'SGK işveren prim indirimi',
  unemploymentEmployeeRateBasisPoints: 'İşsizlik sigortası işçi payı',
  unemploymentEmployerRateBasisPoints: 'İşsizlik sigortası işveren payı',
  sgkFloorMultiplierBasisPoints: 'SGK taban çarpanı',
  sgkCeilingMultiplierBasisPoints: 'SGK tavan çarpanı',
  stampTaxRatePer100k: 'Damga vergisi oranı',
  minimumWageIncomeTaxExempt: 'Asgari ücret gelir vergisi istisnası',
  minimumWageStampTaxExempt: 'Asgari ücret damga vergisi istisnası',
  severanceCeilingCents: 'Kıdem tazminatı tavanı',
  source: 'Kaynak',
}

export interface PayrollParameterRow {
  /** Alan anahtarı ya da hesaplanan değerin anahtarı. */
  key: PayrollParameterField | keyof PayrollDerivedValues
  label: string
  value: string
  /** Platform setinde emin olunmayan değer ("doğrulanmalı"). */
  unverified: boolean
  /** Saklanmaz, setten hesaplanır. */
  derived: boolean
}

type RowSource = Pick<PayrollPeriod, 'values' | 'derived' | 'unverifiedFields'>

/** Dönemin tablo satırları (dilimler ayrı tablodadır, `incomeTaxBracketRows`). */
export function payrollParameterRows(period: RowSource): PayrollParameterRow[] {
  const { values, derived } = period
  const unverified = new Set(period.unverifiedFields)
  const field = (key: PayrollParameterField, value: string): PayrollParameterRow => ({
    key,
    label: PAYROLL_PARAMETER_LABELS[key],
    value,
    unverified: unverified.has(key),
    derived: false,
  })
  const computed = (
    key: keyof PayrollDerivedValues,
    label: string,
    value: string,
    from: PayrollParameterField[],
  ): PayrollParameterRow => ({
    key,
    label,
    value,
    unverified: from.some((item) => unverified.has(item)),
    derived: true,
  })
  const onOff = (value: boolean) => (value ? 'Uygulanır' : 'Uygulanmaz')
  return [
    field('minimumWageGrossCents', money(values.minimumWageGrossCents)),
    computed('minimumWageNetCents', 'Net asgari ücret', money(derived.minimumWageNetCents), [
      'minimumWageGrossCents',
    ]),
    field('sgkEmployeeRateBasisPoints', basisPointsLabel(values.sgkEmployeeRateBasisPoints)),
    field('sgkEmployerRateBasisPoints', basisPointsLabel(values.sgkEmployerRateBasisPoints)),
    field(
      'sgkEmployerIncentiveBasisPoints',
      basisPointsLabel(values.sgkEmployerIncentiveBasisPoints),
    ),
    computed(
      'sgkEmployerNetRateBasisPoints',
      'İndirimli SGK işveren payı',
      basisPointsLabel(derived.sgkEmployerNetRateBasisPoints),
      ['sgkEmployerRateBasisPoints', 'sgkEmployerIncentiveBasisPoints'],
    ),
    field(
      'unemploymentEmployeeRateBasisPoints',
      basisPointsLabel(values.unemploymentEmployeeRateBasisPoints),
    ),
    field(
      'unemploymentEmployerRateBasisPoints',
      basisPointsLabel(values.unemploymentEmployerRateBasisPoints),
    ),
    field('sgkFloorMultiplierBasisPoints', multiplierLabel(values.sgkFloorMultiplierBasisPoints)),
    computed('sgkFloorCents', 'SGK prime esas kazanç tabanı', money(derived.sgkFloorCents), [
      'minimumWageGrossCents',
      'sgkFloorMultiplierBasisPoints',
    ]),
    field(
      'sgkCeilingMultiplierBasisPoints',
      multiplierLabel(values.sgkCeilingMultiplierBasisPoints),
    ),
    computed('sgkCeilingCents', 'SGK prime esas kazanç tavanı', money(derived.sgkCeilingCents), [
      'minimumWageGrossCents',
      'sgkCeilingMultiplierBasisPoints',
    ]),
    field('stampTaxRatePer100k', stampTaxLabel(values.stampTaxRatePer100k)),
    field('minimumWageIncomeTaxExempt', onOff(values.minimumWageIncomeTaxExempt)),
    field('minimumWageStampTaxExempt', onOff(values.minimumWageStampTaxExempt)),
    field('severanceCeilingCents', money(values.severanceCeilingCents)),
  ]
}

/** Dönem başlığı: "1 Ocak 2026 – 31 Aralık 2026". */
export const payrollPeriodLabel = (period: Pick<PayrollPeriod, 'periodStart' | 'periodEnd'>) =>
  `${payrollDayLabel(period.periodStart)} – ${payrollDayLabel(period.periodEnd)}`

/** Yıl seçimi seçenekleri: tablodaki yıllar, bu yıl ve gelecek yıl (yeni dönem girişi için). */
export function payrollYearOptions(availableYears: readonly number[], currentYear: number) {
  const first = Math.max(PAYROLL_MIN_YEAR, Math.min(currentYear, ...availableYears))
  const last = Math.min(PAYROLL_MAX_YEAR, Math.max(currentYear + 1, ...availableYears))
  const years: number[] = []
  for (let year = last; year >= first; year -= 1) years.push(year)
  return years
}

/** Yıl içindeki ayların ilk günleri (yeni dönem formunda öneri için). */
export const monthStarts = (year: number) =>
  Array.from({ length: 12 }, (_, index) => `${String(year)}-${pad(index + 1)}-01`)
