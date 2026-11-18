import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import {
  WAGE_TYPE_LABELS,
  type SeverancePaySuggestion,
  type SeveranceSuggestionRate,
  type SeveranceSuggestionStatus,
  type WageType,
} from './finance-pay-rates.ts'
import {
  PAYROLL_PLATFORM_DEFAULTS,
  payrollParameterTimeline,
  STAMP_TAX_SCALE,
  stampTaxLabel,
  wageTariffBrackets,
  type PayrollInstitutionSet,
  type PayrollOrigin,
  type PayrollPlatformSet,
} from './finance-payroll-parameters.ts'
import { dateLabel, money } from './format.ts'

/**
 * Kıdem ve ihbar tazminatı tahmini (docs/domain/finans.md DOM-FIN-094; ON-205, ON-341). Saf hesap:
 * ücret elle girilir ya da personelin ücret tanımından önerilir (K-345); kıdem tavanı, gelir vergisi
 * dilimleri ve damga vergisi oranı kurumun çıkış günündeki bordro parametre setinden okunur
 * (DOM-FIN-100, K-344). Sonuç saklanmaz (K-273, K-346). Tutarlar kuruş tamsayı, oranlar on binde
 * birdir; her kalem bir kez kuruşa yuvarlanır (yarım yukarı). Mevzuat varsayımları hukukçu ve mali
 * müşavir sorusu H-34'tür; tablolardaki değerler **doğrulanmalıdır**.
 *
 * - Kıdem (1475 sayılı Kanun md. 14, 4857 sayılı Kanun md. 120 ile yürürlükte): en az bir tam
 *   hizmet yılı ve kıdem hakkı doğuran çıkış nedeni ister; her tam yıl için 30 günlük giydirilmiş
 *   brüt ücret, artan gün yılın 365'te biri oranında. Aylık giydirilmiş ücret çıkış gününde
 *   yürürlükteki tavanı aşamaz. Tavan içindeki tutar gelir vergisinden istisnadır (GVK md. 25/7);
 *   yalnız damga vergisi (binde 7,59) kesilir.
 * - İhbar (4857 md. 17): yalnız işveren feshinde ve bildirim süresi verilmemişse; süre hizmet
 *   süresine göre 2, 4, 6 ya da 8 haftadır, günlük giydirilmiş brüt ücretle çarpılır (tavan yok).
 *   Gelir vergisi (K-274) ve damga vergisi kesilir; SGK primi kesilmez.
 */

/** Hesabı yapan roller. Muhasebe rolü platformda açılınca (`DOM-FIN-057`, OG-110) eklenir (K-272). */
export const FINANCE_SEVERANCE_ROLES = ['yonetici'] as const satisfies readonly Role[]

/** Ekranda ve PDF'te sonucun altında duran uyarı. */
export const SEVERANCE_ESTIMATE_NOTE =
  'Tahmini hesaptır; bordro ya da mali müşavir hesabı yerine geçmez.'

/**
 * Yedek damga vergisi oranı: binde 7,59 (488 sayılı Damga Vergisi Kanunu (1) sayılı tablo IV-1);
 * yalnız bordro parametre seti olmayan çıkış gününde kullanılır (K-344).
 */
export const STAMP_TAX_RATE_PER_100K = 759
/** Aylık giydirilmiş ücretin günlüğe çevrilmesinde ay 30 gündür (4857 md. 49 uygulaması). */
export const DAYS_PER_MONTH = 30
/** Artan günün orantısında yıl 365 gündür. */
export const DAYS_PER_YEAR = 365

/** Aylık brüt ücret ve yan ödeme üst sınırı: 10.000.000 ₺ (yazım hatasına karşı). */
export const SEVERANCE_WAGE_MAX_CENTS = 1_000_000_000
/** Kümülatif gelir vergisi matrahı üst sınırı: 100.000.000 ₺. */
export const SEVERANCE_TAX_BASE_MAX_CENTS = 10_000_000_000
/** En erken işe giriş günü. */
export const SEVERANCE_MIN_START_DATE = '1960-01-01'

/**
 * Yedek kıdem tazminatı tavanı (K-344): bordro parametre seti (DOM-FIN-100) 2025 ocakla başlar; daha
 * önceki çıkış günleri için bu tablo kullanılır. Tavan en yüksek devlet memuruna bir hizmet yılı için
 * ödenen azami emeklilik ikramiyesidir; memur maaş katsayısıyla ocak ve temmuzda değişir. Kaynak:
 * Hazine ve Maliye Bakanlığı memur maaş katsayısı genelgeleri, ÇSGB duyuruları. Değerler
 * **doğrulanmalı** (H-34). 2025 ve sonrası yalnız parametre setindedir (tek kaynak).
 */
export const SEVERANCE_FALLBACK_CEILINGS: readonly { from: string; monthlyCents: number }[] = [
  { from: '2022-01-01', monthlyCents: 1_084_859 },
  { from: '2022-07-01', monthlyCents: 1_537_140 },
  { from: '2023-01-01', monthlyCents: 1_998_283 },
  { from: '2023-07-01', monthlyCents: 2_348_983 },
  { from: '2024-01-01', monthlyCents: 3_505_858 },
  { from: '2024-07-01', monthlyCents: 4_182_842 },
]
/** Yedek tablonun kapsadığı en erken çıkış günü (öncesi için tavan bilinmez, 400). */
export const SEVERANCE_MIN_END_DATE = '2022-01-01'

const TARIFF_RATES = [1500, 2000, 2700, 3500, 4000] as const

function tariff(limits: readonly [number, number, number, number]) {
  return TARIFF_RATES.map((rateBasisPoints, index) => ({
    upToCents: limits[index] ?? null,
    rateBasisPoints,
  }))
}

/**
 * Yedek ücret gelir vergisi tarifesi (K-344; GVK md. 103, kaynak: GİB gelir vergisi tarifeleri):
 * parametre seti olmayan 2022–2024 çıkışları için. Dilim üst sınırı kuruş, oran on binde bir; son
 * dilimin üst sınırı yoktur. Değerler **doğrulanmalı** (H-34).
 */
export const WAGE_INCOME_TAX_FALLBACK_TARIFFS: Readonly<
  Record<number, readonly { upToCents: number | null; rateBasisPoints: number }[]>
> = {
  2022: tariff([3_200_000, 7_000_000, 25_000_000, 88_000_000]),
  2023: tariff([7_000_000, 15_000_000, 55_000_000, 190_000_000]),
  2024: tariff([11_000_000, 23_000_000, 87_000_000, 300_000_000]),
}
/**
 * Çıkış nedenleri (K-275). `severance`: kıdem hakkı doğurur (bir tam yıl şartıyla); `notice`:
 * bildirim süresi verilmediyse çalışana ihbar tazminatı doğar. İstifa ve işverenin ahlak ve iyi
 * niyet kurallarına aykırılık feshi kıdem doğurmaz; çalışanın bildirimsiz istifasında ihbar
 * tazminatını işçi öder, bu hesap onu kapsamaz.
 */
export const SEVERANCE_EXIT_REASONS = [
  'employer_termination',
  'employer_compelling',
  'employee_just_cause',
  'retirement',
  'military_service',
  'marriage',
  'death',
  'fixed_term_end',
  'resignation',
  'employer_misconduct',
] as const
export type SeveranceExitReason = (typeof SEVERANCE_EXIT_REASONS)[number]

export const SEVERANCE_EXIT_REASON_INFO: Readonly<
  Record<SeveranceExitReason, { label: string; basis: string; severance: boolean; notice: boolean }>
> = {
  employer_termination: {
    label: 'İşveren feshi (ahlak ve iyi niyete aykırılık dışında)',
    basis: '4857 md. 17–18; 1475 md. 14',
    severance: true,
    notice: true,
  },
  employer_compelling: {
    label: 'İşverenin sağlık ya da zorlayıcı nedenle feshi',
    basis: '4857 md. 25/I, 25/III; 1475 md. 14',
    severance: true,
    notice: false,
  },
  employee_just_cause: {
    label: 'Çalışanın haklı nedenle feshi',
    basis: '4857 md. 24; 1475 md. 14',
    severance: true,
    notice: false,
  },
  retirement: {
    label: 'Emeklilik ya da yaş dışındaki emeklilik şartlarını tamamlama',
    basis: '1475 md. 14/1-4, 14/1 son fıkra',
    severance: true,
    notice: false,
  },
  military_service: {
    label: 'Muvazzaf askerlik',
    basis: '1475 md. 14/1-3',
    severance: true,
    notice: false,
  },
  marriage: {
    label: 'Kadın çalışanın evlilikten sonra bir yıl içinde ayrılması',
    basis: '1475 md. 14/1-5',
    severance: true,
    notice: false,
  },
  death: {
    label: 'Çalışanın ölümü (mirasçılara)',
    basis: '1475 md. 14/1',
    severance: true,
    notice: false,
  },
  fixed_term_end: {
    label: 'Belirli süreli sözleşmenin süresinin dolması',
    basis: 'Yargıtay uygulaması (doğrulanmalı, H-34)',
    severance: true,
    notice: false,
  },
  resignation: {
    label: 'İstifa (haklı neden olmadan)',
    basis: '1475 md. 14',
    severance: false,
    notice: false,
  },
  employer_misconduct: {
    label: 'İşverenin ahlak ve iyi niyete aykırılık nedeniyle feshi',
    basis: '4857 md. 25/II',
    severance: false,
    notice: false,
  },
}

const wageField = (required: string, label: string) =>
  z
    .number(required)
    .int(`${label} kuruş cinsinden tam sayı olmalıdır.`)
    .max(SEVERANCE_WAGE_MAX_CENTS, `${label} en fazla 10.000.000 ₺ olabilir.`)

export const severanceRequestSchema = z
  .strictObject({
    startDate: daySchema,
    endDate: daySchema,
    // kvkk: K — ücret bilgisi; kişi adı alınmaz, gövde loglanmaz ve saklanmaz (K-273).
    grossWageCents: wageField('Son brüt ücreti girin.', 'Brüt ücret').min(
      1,
      'Brüt ücret sıfırdan büyük olmalıdır.',
    ),
    // kvkk: K — düzenli yan ödemelerin aylık toplamı (yol, yemek, düzenli prim); giydirilmiş ücrete eklenir.
    regularBenefitsCents: wageField('Yan ödemeyi girin.', 'Yan ödeme')
      .min(0, 'Yan ödeme eksi olamaz.')
      .default(0),
    exitReason: z.enum(SEVERANCE_EXIT_REASONS, 'Çıkış nedenini seçin.'),
    /** İşveren bildirim (ihbar) süresini verdiyse ya da süre çalışılarak geçtiyse ihbar tazminatı yoktur. */
    noticeGiven: z.boolean('İhbar süresi seçeneği evet ya da hayır olmalıdır.').default(false),
    // kvkk: K — çalışanın çıkış yılındaki kümülatif gelir vergisi matrahı; boşsa ilk dilim (K-274).
    cumulativeTaxBaseCents: z
      .number('Kümülatif matrahı girin.')
      .int('Kümülatif matrah kuruş cinsinden tam sayı olmalıdır.')
      .min(0, 'Kümülatif matrah eksi olamaz.')
      .max(SEVERANCE_TAX_BASE_MAX_CENTS, 'Kümülatif matrah en fazla 100.000.000 ₺ olabilir.')
      .nullable()
      .default(null),
    // kvkk: K — personel üyeliği. Verilirse sunucu çıkış gününün ücret önerisini yeniden okur ve
    // kaynağını sonuçta döner (K-346); yalnız ücret okuyan rol (K-347). Ad alınmaz.
    membershipId: z
      .string('Personel geçersiz.')
      .trim()
      .min(1, 'Personel geçersiz.')
      .max(100, 'Personel geçersiz.')
      .nullable()
      .default(null),
  })
  .superRefine((value, context) => {
    if (value.startDate < SEVERANCE_MIN_START_DATE)
      context.addIssue({
        code: 'custom',
        path: ['startDate'],
        message: 'İşe giriş günü 1960 yılından önce olamaz.',
      })
    if (value.endDate < SEVERANCE_MIN_END_DATE)
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'Çıkış günü 2022 yılından önce olamaz; tavan tablosu 2022 ile başlar.',
      })
    if (value.endDate < value.startDate)
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'Çıkış günü işe giriş gününden önce olamaz.',
      })
  })
export type SeveranceRequest = z.output<typeof severanceRequestSchema>
export type SeveranceRequestInput = z.input<typeof severanceRequestSchema>

// --- Takvim --------------------------------------------------------------------------------------

const parts = (day: string) => {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  return { year, month, date }
}
const pad = (value: number, length = 2) => String(value).padStart(length, '0')
/** Gösterim: 1 Ocak 2026. */
const dayText = (day: string) =>
  dateLabel(`${day}T09:00:00.000Z`, { day: 'numeric', month: 'long', year: 'numeric' })
const lastDayOfMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate()

/** Güne ay ekler; ayın günü hedef ayda yoksa ayın son günü alınır (29 Şubat + 1 yıl → 28 Şubat). */
export function addMonthsClamped(day: string, months: number): string {
  const { year, month, date } = parts(day)
  const index = year * 12 + (month - 1) + months
  const targetYear = Math.floor(index / 12)
  const targetMonth = (index % 12) + 1
  const targetDate = Math.min(date, lastDayOfMonth(targetYear, targetMonth))
  return `${pad(targetYear, 4)}-${pad(targetMonth)}-${pad(targetDate)}`
}

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00.000Z`) / 86_400_000
const addOneDay = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10)

export interface ServicePeriod {
  startDate: string
  endDate: string
  /** İşe giriş ve çıkış günü dahil takvim günü. */
  totalDays: number
  /** Tam hizmet yılı (yıl dönümleri). */
  years: number
  /** Son yıl dönümünden sonraki tam ay ve gün (gösterim için). */
  months: number
  days: number
  /** Son yıl dönümünden sonraki gün (kıdemde 365'te bir oranında). */
  remainderDays: number
}

/**
 * Hizmet süresi: giriş ve çıkış günü dahildir; süre çıkışın ertesi gününe kadar sayılır. 2020-01-01
 * giriş, 2020-12-31 çıkış tam bir yıldır.
 */
export function servicePeriod(startDate: string, endDate: string): ServicePeriod {
  const until = addOneDay(endDate)
  let years = 0
  while (addMonthsClamped(startDate, (years + 1) * 12) <= until) years += 1
  const anniversary = addMonthsClamped(startDate, years * 12)
  let months = 0
  while (months < 11 && addMonthsClamped(startDate, years * 12 + months + 1) <= until) months += 1
  return {
    startDate,
    endDate,
    totalDays: dayNumber(until) - dayNumber(startDate),
    years,
    months,
    days: dayNumber(until) - dayNumber(addMonthsClamped(startDate, years * 12 + months)),
    remainderDays: dayNumber(until) - dayNumber(anniversary),
  }
}

/**
 * İhbar süresi (4857 md. 17; K-275): altı aydan az 2 hafta; altı ay (dahil) ile bir buçuk yıl (dahil)
 * arası 4 hafta; bir buçuk yıldan fazla, üç yıla kadar (dahil) 6 hafta; üç yıldan fazla 8 hafta.
 */
export function noticeWeeks(startDate: string, endDate: string): 2 | 4 | 6 | 8 {
  const until = addOneDay(endDate)
  if (until < addMonthsClamped(startDate, 6)) return 2
  if (until <= addMonthsClamped(startDate, 18)) return 4
  if (until <= addMonthsClamped(startDate, 36)) return 6
  return 8
}

// --- Tablolar ------------------------------------------------------------------------------------

export interface CeilingLookup {
  /** Uygulanan tavan döneminin (parametre setinin ya da yedek tablo satırının) başlangıcı. */
  from: string
  monthlyCents: number
  /**
   * Çıkış günü, son bilinen dönemin başladığı yarıyıldan (ocak–haziran, temmuz–aralık) sonraki bir
   * yarıyılda: tavan ocak ve temmuzda değişir, güncel olmayabilir.
   */
  stale: boolean
}

export interface WageTariff {
  /** Tarifenin yılı (parametre setinin başlangıç yılı). */
  year: number
  /** Çıkış yılı için tarife yok, son bilinen kullanıldı. */
  stale: boolean
  brackets: readonly { upToCents: number | null; rateBasisPoints: number }[]
}

export const SEVERANCE_PARAMETER_SOURCES = ['payroll_parameters', 'fallback_table'] as const
export type SeveranceParameterSource = (typeof SEVERANCE_PARAMETER_SOURCES)[number]

/** Hesabın dayandığı tavan, tarife ve damga oranı ile kaynağı (K-344). */
export interface SeveranceParameters {
  /** `payroll_parameters` kurumun geçerli bordro parametre seti, `fallback_table` yedek tablo. */
  source: SeveranceParameterSource
  /** Parametre setinin kimliği (`platform-…` ya da kurum kopyası); yedek tabloda `null`. */
  setId: string | null
  origin: PayrollOrigin | null
  /** Kurum kopyasının sürümü; platform setinde ve yedek tabloda `null`. */
  version: number | null
  /** Setin yürürlük başlangıcı ya da yedek tavan satırının başlangıcı. */
  effectiveFrom: string
  ceiling: CeilingLookup
  tariff: WageTariff
  /** Damga vergisi oranı, yüz binde bir (759 = binde 7,59). */
  stampTaxRatePer100k: number
}

/** Günün yarıyılının ilk günü: ocak–haziran 1 Ocak, temmuz–aralık 1 Temmuz. */
const halfYearStart = (day: string) =>
  `${day.slice(0, 4)}-${Number(day.slice(5, 7)) >= 7 ? '07' : '01'}-01`

/** Son dönem, günün yarıyılından önce başladıysa tavan güncel olmayabilir. */
const ceilingStale = (from: string, isLast: boolean, day: string) =>
  isLast && from < halfYearStart(day)

const FALLBACK_TARIFF_YEARS = Object.keys(WAGE_INCOME_TAX_FALLBACK_TARIFFS)
  .map(Number)
  .sort((a, b) => a - b)

/** Yedek tablodan (2025 öncesi) tavan ve tarife; tabloyu kapsamayan gün `RangeError`. */
function fallbackParameters(day: string): SeveranceParameters {
  let found: { from: string; monthlyCents: number } | undefined
  for (const row of SEVERANCE_FALLBACK_CEILINGS) if (row.from <= day) found = row
  if (found === undefined) throw new RangeError(`Tavan tablosu ${day} gününü kapsamıyor.`)
  const year = Number(day.slice(0, 4))
  const known = FALLBACK_TARIFF_YEARS.filter((item) => item <= year)
  const tariffYear = known[known.length - 1] ?? FALLBACK_TARIFF_YEARS[0] ?? year
  return {
    source: 'fallback_table',
    setId: null,
    origin: null,
    version: null,
    effectiveFrom: found.from,
    ceiling: {
      from: found.from,
      monthlyCents: found.monthlyCents,
      stale: ceilingStale(found.from, found === SEVERANCE_FALLBACK_CEILINGS.at(-1), day),
    },
    tariff: {
      year: tariffYear,
      stale: tariffYear !== year,
      brackets: WAGE_INCOME_TAX_FALLBACK_TARIFFS[tariffYear] ?? [],
    },
    stampTaxRatePer100k: STAMP_TAX_RATE_PER_100K,
  }
}

/**
 * Çıkış gününde geçerli kıdem parametreleri (K-344): kurumun bordro parametre setlerinin ve platform
 * varsayılanının birleşiminde (DOM-FIN-100) başlangıcı güne eşit ya da önce olan en geç set; tavan,
 * dilimler ve damga oranı o setten okunur. Gün bütün setlerden önceyse (2025 öncesi, kurumun daha
 * erken kopyası yoksa) yedek tablo kullanılır. Tarife yılı setin yılıdır; çıkış yılı için set yoksa
 * `tariff.stale`.
 */
export function severanceParametersOn(
  day: string,
  institutionSets: readonly PayrollInstitutionSet[] = [],
  platform: readonly PayrollPlatformSet[] = PAYROLL_PLATFORM_DEFAULTS,
): SeveranceParameters {
  const timeline = payrollParameterTimeline(institutionSets, platform)
  let index = -1
  timeline.forEach((set, at) => {
    if (set.values.effectiveFrom <= day) index = at
  })
  const set = timeline[index]
  if (set === undefined) return fallbackParameters(day)
  const from = set.values.effectiveFrom
  const year = Number(from.slice(0, 4))
  return {
    source: 'payroll_parameters',
    setId: set.id,
    origin: set.origin,
    version: set.version,
    effectiveFrom: from,
    ceiling: {
      from,
      monthlyCents: set.values.severanceCeilingCents,
      stale: ceilingStale(from, index === timeline.length - 1, day),
    },
    tariff: {
      year,
      stale: Number(day.slice(0, 4)) > year,
      brackets: wageTariffBrackets(set.values.incomeTaxBrackets),
    },
    stampTaxRatePer100k: set.values.stampTaxRatePer100k,
  }
}

/** Kümülatif matrahın tarifeye göre vergisi (kuruş, yuvarlanmamış). */
function cumulativeTax(
  baseCents: number,
  brackets: readonly { upToCents: number | null; rateBasisPoints: number }[],
): number {
  let tax = 0
  let lower = 0
  for (const bracket of brackets) {
    const upper = bracket.upToCents ?? Number.POSITIVE_INFINITY
    if (baseCents > lower)
      tax += ((Math.min(baseCents, upper) - lower) * bracket.rateBasisPoints) / 10_000
    lower = upper
  }
  return tax
}

const stampTax = (grossCents: number, ratePer100k: number) =>
  Math.round((grossCents * ratePer100k) / STAMP_TAX_SCALE)

// --- Hesap ---------------------------------------------------------------------------------------

export type SeveranceStatus = 'eligible' | 'reason_not_entitled' | 'under_one_year'
export type NoticeStatus = 'eligible' | 'reason_not_entitled' | 'notice_given'
export type IncomeTaxMethod = 'first_bracket' | 'cumulative_base' | 'none'

export interface SeveranceLine {
  status: SeveranceStatus
  /** Tazminata esas gün: tam yıl × 30 + artan gün × 30 / 365 (iki ondalık). */
  days: number
  fullYears: number
  remainderDays: number
  ceiling: CeilingLookup
  /** Tavan aylık giydirilmiş ücreti kesti mi. */
  ceilingApplied: boolean
  /** Esas aylık ücret: giydirilmiş ücret ile tavanın küçüğü. */
  baseMonthlyCents: number
  dailyWageCents: number
  grossCents: number
  /** Tavan içinde gelir vergisinden istisna (GVK md. 25/7): her zaman 0. */
  incomeTaxCents: number
  stampTaxCents: number
  netCents: number
}

export interface NoticeLine {
  status: NoticeStatus
  /** Hizmet süresine göre ihbar süresi (hak olmasa da gösterilir). */
  weeks: 2 | 4 | 6 | 8
  /** Ödenen gün: hak varsa hafta × 7, yoksa 0. */
  days: number
  dailyWageCents: number
  grossCents: number
  incomeTaxMethod: IncomeTaxMethod
  /** Ücret tarifesinin yılı; tabloda yoksa en yakın önceki yıl. */
  taxYear: number
  taxTableStale: boolean
  /** Kesilen gelir vergisinin brüte oranı, on binde bir (dilim geçişinde ortalama). */
  incomeTaxRateBasisPoints: number
  incomeTaxCents: number
  stampTaxCents: number
  netCents: number
}

/** Hesabın parametre kaynağı (yanıt ve PDF; tavan ve tarife satırları ilgili kalemdedir). */
export type SeveranceParameterInfo = Omit<SeveranceParameters, 'ceiling' | 'tariff'>

/**
 * Ücret girdisinin kaynağı (K-346): personel seçildiyse sunucunun çıkış gününde okuduğu ücret
 * tanımları ve önerilen tutarlar; girilen ücret öneriden farklıysa `…Changed`. Tutar ve tanım
 * kimliği yanıtta ve PDF'te kalır, sunucuda saklanmaz (K-273).
 */
export interface SeverancePaySource {
  membershipId: string
  /** Önerinin okunduğu gün: çıkış günü. */
  date: string
  status: SeveranceSuggestionStatus
  /** Günde yürürlükteki ana ücret tanımı (türü ne olursa olsun). */
  wageRateId: string | null
  wageRateType: WageType | null
  wageStartDate: string | null
  /** Öneriye giren (nakdi) yan hak tanımları. */
  benefitRateIds: string[]
  /** Öneri dışında kalan (ayni) yan hak sayısı. */
  excludedBenefitCount: number
  suggestedGrossWageCents: number | null
  suggestedBenefitsCents: number | null
  /** Girilen brüt öneriden farklı ya da öneri yok. */
  grossWageChanged: boolean
  benefitsChanged: boolean
}

export interface SeveranceEstimate {
  exitReason: SeveranceExitReason
  noticeGiven: boolean
  service: ServicePeriod
  wage: {
    grossWageCents: number
    regularBenefitsCents: number
    /** Aylık giydirilmiş brüt ücret: brüt + düzenli yan ödemeler. */
    dressedWageCents: number
    /** Günlük giydirilmiş brüt: aylık / 30. */
    dailyDressedWageCents: number
  }
  severance: SeveranceLine
  notice: NoticeLine
  totals: { grossCents: number; incomeTaxCents: number; stampTaxCents: number; netCents: number }
  parameters: SeveranceParameterInfo
  /** Personel seçilmediyse `null` (ücret elle girildi). */
  paySource: SeverancePaySource | null
}

const isWageType = (rate: { rateType: string }): rate is { rateType: WageType } =>
  Object.hasOwn(WAGE_TYPE_LABELS, rate.rateType)

/** Sunucunun okuduğu öneriden ve istekteki ücretten kaynak satırı (K-346). */
export function severancePaySource(
  membershipId: string,
  day: string,
  suggestion: SeverancePaySuggestion<SeveranceSuggestionRate & { id: string }>,
  request: Pick<SeveranceRequest, 'grossWageCents' | 'regularBenefitsCents'>,
): SeverancePaySource {
  const wage = suggestion.wage
  return {
    membershipId,
    date: day,
    status: suggestion.status,
    wageRateId: wage?.id ?? null,
    wageRateType: wage !== null && isWageType(wage) ? wage.rateType : null,
    wageStartDate: wage?.startDate ?? null,
    benefitRateIds: suggestion.benefits.filter((item) => item.included).map((item) => item.rate.id),
    excludedBenefitCount: suggestion.benefits.filter((item) => !item.included).length,
    suggestedGrossWageCents: suggestion.grossWageCents,
    suggestedBenefitsCents: suggestion.regularBenefitsCents,
    grossWageChanged: suggestion.grossWageCents !== request.grossWageCents,
    benefitsChanged: suggestion.regularBenefitsCents !== request.regularBenefitsCents,
  }
}

export interface SeveranceEstimateOptions {
  /** Çıkış gününün parametreleri; verilmezse yalnız platform varsayılanı (kurum kopyası yok). */
  parameters?: SeveranceParameters
  paySource?: SeverancePaySource | null
}

/**
 * Kıdem ve ihbar tazminatı tahmini (DOM-FIN-094). Girdi `severanceRequestSchema` çıktısıdır; tavan,
 * tarife ve damga oranı `options.parameters`tan (servis kurumun çıkış günündeki setini verir, K-344).
 */
export function severanceEstimate(
  input: SeveranceRequestInput,
  options: SeveranceEstimateOptions = {},
): SeveranceEstimate {
  const request = severanceRequestSchema.parse(input)
  const parameters = options.parameters ?? severanceParametersOn(request.endDate)
  const reason = SEVERANCE_EXIT_REASON_INFO[request.exitReason]
  const service = servicePeriod(request.startDate, request.endDate)
  const dressed = request.grossWageCents + request.regularBenefitsCents
  const daily = Math.round(dressed / DAYS_PER_MONTH)
  const stampRate = parameters.stampTaxRatePer100k

  // Kıdem: tam yıl × aylık + artan gün × aylık / 365; aylık tavanla sınırlı.
  const ceiling = parameters.ceiling
  const baseMonthly = Math.min(dressed, ceiling.monthlyCents)
  const severanceStatus: SeveranceStatus = !reason.severance
    ? 'reason_not_entitled'
    : service.years < 1
      ? 'under_one_year'
      : 'eligible'
  const severanceGross =
    severanceStatus === 'eligible'
      ? Math.round(
          (baseMonthly * (service.years * DAYS_PER_YEAR + service.remainderDays)) / DAYS_PER_YEAR,
        )
      : 0
  const severanceStamp = stampTax(severanceGross, stampRate)
  const severance: SeveranceLine = {
    status: severanceStatus,
    days:
      severanceStatus === 'eligible'
        ? Math.round(
            (service.years * DAYS_PER_MONTH +
              (service.remainderDays * DAYS_PER_MONTH) / DAYS_PER_YEAR) *
              100,
          ) / 100
        : 0,
    fullYears: service.years,
    remainderDays: service.remainderDays,
    ceiling: { ...ceiling },
    ceilingApplied: dressed > ceiling.monthlyCents,
    baseMonthlyCents: baseMonthly,
    dailyWageCents: Math.round(baseMonthly / DAYS_PER_MONTH),
    grossCents: severanceGross,
    incomeTaxCents: 0,
    stampTaxCents: severanceStamp,
    netCents: severanceGross - severanceStamp,
  }

  // İhbar: hafta × 7 gün × aylık / 30; tavan yok. Gelir vergisi K-274.
  const weeks = noticeWeeks(request.startDate, request.endDate)
  const noticeStatus: NoticeStatus = !reason.notice
    ? 'reason_not_entitled'
    : request.noticeGiven
      ? 'notice_given'
      : 'eligible'
  const noticeDays = noticeStatus === 'eligible' ? weeks * 7 : 0
  const noticeGross = Math.round((dressed * noticeDays) / DAYS_PER_MONTH)
  const tariffUsed = parameters.tariff
  const method: IncomeTaxMethod =
    noticeGross === 0
      ? 'none'
      : request.cumulativeTaxBaseCents === null
        ? 'first_bracket'
        : 'cumulative_base'
  const noticeIncomeTax =
    method === 'none'
      ? 0
      : method === 'first_bracket'
        ? Math.round(((tariffUsed.brackets[0]?.rateBasisPoints ?? 0) * noticeGross) / 10_000)
        : Math.round(
            cumulativeTax(
              (request.cumulativeTaxBaseCents ?? 0) + noticeGross,
              tariffUsed.brackets,
            ) - cumulativeTax(request.cumulativeTaxBaseCents ?? 0, tariffUsed.brackets),
          )
  const noticeStamp = stampTax(noticeGross, stampRate)
  const notice: NoticeLine = {
    status: noticeStatus,
    weeks,
    days: noticeDays,
    dailyWageCents: daily,
    grossCents: noticeGross,
    incomeTaxMethod: method,
    taxYear: tariffUsed.year,
    taxTableStale: tariffUsed.stale,
    incomeTaxRateBasisPoints:
      noticeGross === 0 ? 0 : Math.round((noticeIncomeTax * 10_000) / noticeGross),
    incomeTaxCents: noticeIncomeTax,
    stampTaxCents: noticeStamp,
    netCents: noticeGross - noticeIncomeTax - noticeStamp,
  }

  return {
    exitReason: request.exitReason,
    noticeGiven: request.noticeGiven,
    service,
    wage: {
      grossWageCents: request.grossWageCents,
      regularBenefitsCents: request.regularBenefitsCents,
      dressedWageCents: dressed,
      dailyDressedWageCents: daily,
    },
    severance,
    notice,
    totals: {
      grossCents: severance.grossCents + notice.grossCents,
      incomeTaxCents: severance.incomeTaxCents + notice.incomeTaxCents,
      stampTaxCents: severance.stampTaxCents + notice.stampTaxCents,
      netCents: severance.netCents + notice.netCents,
    },
    parameters: {
      source: parameters.source,
      setId: parameters.setId,
      origin: parameters.origin,
      version: parameters.version,
      effectiveFrom: parameters.effectiveFrom,
      stampTaxRatePer100k: parameters.stampTaxRatePer100k,
    },
    paySource: options.paySource ?? null,
  }
}

// --- Gösterim metinleri (web ve PDF ortak) ------------------------------------------------------

export const SEVERANCE_STATUS_LABELS: Readonly<Record<SeveranceStatus, string>> = {
  eligible: 'Hak var',
  reason_not_entitled: 'Bu çıkış nedeninde kıdem tazminatı doğmaz',
  under_one_year: 'Hizmet süresi bir yıldan az; kıdem tazminatı doğmaz',
}

export const NOTICE_STATUS_LABELS: Readonly<Record<NoticeStatus, string>> = {
  eligible: 'Hak var',
  reason_not_entitled: 'Bu çıkış nedeninde ihbar tazminatı doğmaz',
  notice_given: 'İhbar süresi verildi; ihbar tazminatı doğmaz',
}

export const INCOME_TAX_METHOD_LABELS: Readonly<Record<IncomeTaxMethod, string>> = {
  none: 'Gelir vergisi yok',
  first_bracket: 'İlk dilim oranı (kümülatif matrah girilmedi)',
  cumulative_base: 'Girilen kümülatif matraha göre dilimli',
}

/** Hizmet süresi metni: "3 yıl 2 ay 5 gün" (sıfır kalemler yazılmaz; hepsi sıfırsa "0 gün"). */
export function servicePeriodLabel(period: Pick<ServicePeriod, 'years' | 'months' | 'days'>) {
  const text = [
    period.years > 0 ? `${String(period.years)} yıl` : null,
    period.months > 0 ? `${String(period.months)} ay` : null,
    period.days > 0 ? `${String(period.days)} gün` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' ')
  return text === '' ? '0 gün' : text
}

export const SEVERANCE_WARNING_CODES = [
  'ceiling_stale',
  'tax_table_stale',
  'resignation_notice_owed',
  'pay_suggestion_unavailable',
] as const
export type SeveranceWarningCode = (typeof SEVERANCE_WARNING_CODES)[number]

type WarningSource = Pick<SeveranceEstimate, 'exitReason' | 'noticeGiven'> & {
  severance: Pick<SeveranceLine, 'ceiling'>
  notice: Pick<NoticeLine, 'taxTableStale' | 'incomeTaxMethod' | 'taxYear'>
  paySource: Pick<SeverancePaySource, 'status'> | null
}

/** Personel seçildi ama öneri yapılmadıysa nedeni (sonuç notu). */
const SUGGESTION_UNAVAILABLE_REASONS: Readonly<
  Record<Exclude<SeveranceSuggestionStatus, 'suggested'>, string>
> = {
  net_wage: 'ana ücret net tanımlı, brüte çevrilmez',
  non_monthly_wage: 'ana ücret saatlik ya da ders saati üzerinden',
  no_wage: 'çıkış gününde yürürlükte ana ücret yok',
}

/**
 * Hesabın uyarı kodları (API yanıtında): tavan ya da tarife parametrelerde yok (son bilinen değer
 * kullanıldı), bildirimsiz istifada ihbar tazminatını çalışan öder (bu hesap kapsamaz), personel
 * seçildi ama ücret tanımından öneri yapılamadı (K-345).
 */
export function severanceWarningCodes(estimate: WarningSource): SeveranceWarningCode[] {
  const codes: SeveranceWarningCode[] = []
  if (estimate.severance.ceiling.stale) codes.push('ceiling_stale')
  if (estimate.notice.taxTableStale && estimate.notice.incomeTaxMethod === 'cumulative_base')
    codes.push('tax_table_stale')
  if (estimate.exitReason === 'resignation' && !estimate.noticeGiven)
    codes.push('resignation_notice_owed')
  if (estimate.paySource !== null && estimate.paySource.status !== 'suggested')
    codes.push('pay_suggestion_unavailable')
  return codes
}

/** Uyarı metinleri (ekran ve PDF). */
export function severanceWarnings(estimate: WarningSource): string[] {
  return severanceWarningCodes(estimate).map((code) => {
    switch (code) {
      case 'ceiling_stale':
        return `Çıkış günü için kıdem tavanı bordro parametrelerinde yok; son bilinen ${dayText(estimate.severance.ceiling.from)} dönemi tavanı kullanıldı. Güncel tavanı doğrulayın ve Bordro parametrelerine girin.`
      case 'tax_table_stale':
        return `Çıkış yılının gelir vergisi dilimleri bordro parametrelerinde yok; ${String(estimate.notice.taxYear)} tarifesi kullanıldı.`
      case 'resignation_notice_owed':
        return 'Bildirim süresine uyulmadan istifada ihbar tazminatını çalışan işverene öder; bu hesap onu kapsamaz.'
      case 'pay_suggestion_unavailable': {
        const status = estimate.paySource?.status ?? 'no_wage'
        const reason = status === 'suggested' ? '' : SUGGESTION_UNAVAILABLE_REASONS[status]
        return `Ücret tanımından öneri yapılmadı (${reason}); hesap elle girilen ücretle yapıldı.`
      }
      default:
        return code satisfies never
    }
  })
}

// --- Döküm (ekran ve PDF aynı satırları kullanır) ------------------------------------------------

type BreakdownSource = WarningSource & {
  service: Pick<ServicePeriod, 'years' | 'months' | 'days'>
  wage: SeveranceEstimate['wage']
  severance: SeveranceLine
  notice: NoticeLine
  totals: SeveranceEstimate['totals']
  parameters: SeveranceParameterInfo
  paySource: SeverancePaySource | null
}

// Intl kurucusu bir kez kurulur (format.ts ile aynı gerekçe).
const dayFormatter = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 })
const dayCount = (value: number) => dayFormatter.format(value)

/** Kalem kalem döküm: [kalem, kıdem, ihbar, toplam]. */
export function severanceBreakdownRows(estimate: BreakdownSource): string[][] {
  const { severance, notice, totals } = estimate
  const right = (status: string) => (status === 'eligible' ? 'Var' : 'Yok')
  return [
    ['Hak', right(severance.status), right(notice.status), '—'],
    ['Esas gün', dayCount(severance.days), dayCount(notice.days), '—'],
    ['Günlük brüt ücret', money(severance.dailyWageCents), money(notice.dailyWageCents), '—'],
    ['Brüt tutar', money(severance.grossCents), money(notice.grossCents), money(totals.grossCents)],
    [
      'Gelir vergisi',
      money(severance.incomeTaxCents),
      money(notice.incomeTaxCents),
      money(totals.incomeTaxCents),
    ],
    [
      'Damga vergisi',
      money(severance.stampTaxCents),
      money(notice.stampTaxCents),
      money(totals.stampTaxCents),
    ],
    ['Net tutar', money(severance.netCents), money(notice.netCents), money(totals.netCents)],
  ]
}

/** Tanım kimliğinin kısa gösterimi (belgede izlenebilirlik için). */
const shortId = (id: string) => id.slice(0, 8)

/** Ücret ve yan ödeme girdisinin kaynağı (K-346); personel seçilmediyse elle girildi. */
export function severancePaySourceFacts(source: SeverancePaySource | null): [string, string][] {
  if (source === null) return [['Ücret kaynağı', 'Elle girildi']]
  const changed = (value: boolean) => (value ? '; öneri değiştirildi' : '')
  if (source.status !== 'suggested') {
    const type =
      source.wageRateType === null
        ? 'ana ücret tanımı yok'
        : WAGE_TYPE_LABELS[source.wageRateType].toLocaleLowerCase('tr-TR')
    return [['Ücret kaynağı', `Ücret tanımından öneri yapılmadı (${type}); elle girildi`]]
  }
  const wage = `Ücret tanımı: ${WAGE_TYPE_LABELS[source.wageRateType ?? 'monthly_gross']}, ${dayText(source.wageStartDate ?? source.date)} başlangıçlı (tanım ${shortId(source.wageRateId ?? '')}), ${dayText(source.date)} günü geçerli${changed(source.grossWageChanged)}`
  const included = source.benefitRateIds.length
  const benefits = [
    included === 0
      ? 'Nakdi yan hak yok'
      : `${String(included)} nakdi yan hak (tanım ${source.benefitRateIds.map(shortId).join(', ')})`,
    source.excludedBenefitCount > 0
      ? `${String(source.excludedBenefitCount)} ayni yan hak hariç`
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(', ')
  return [
    ['Ücret kaynağı', wage],
    ['Yan ödeme kaynağı', `${benefits}${changed(source.benefitsChanged)}`],
  ]
}

/** Tavan, dilim ve damga oranının kaynağı (K-344). */
export function severanceParameterSourceLabel(parameters: SeveranceParameterInfo): string {
  if (parameters.source === 'fallback_table')
    return 'Yerleşik tavan ve tarife tablosu (bordro parametrelerinden önceki dönem)'
  const owner = parameters.origin === 'institution' ? 'Kurumun' : 'Platformun'
  return `${owner} bordro parametresi, ${dayText(parameters.effectiveFrom)} dönemi`
}

/** Hesabın dayanakları: hizmet süresi, ücret ve kaynağı, tavan, ihbar süresi, vergi ve kaynağı. */
export function severanceFacts(estimate: BreakdownSource): [string, string][] {
  const { wage, severance, notice } = estimate
  return [
    ['Çıkış nedeni', SEVERANCE_EXIT_REASON_INFO[estimate.exitReason].label],
    ['Hizmet süresi', servicePeriodLabel(estimate.service)],
    ['Aylık brüt ücret', money(wage.grossWageCents)],
    ['Düzenli yan ödemeler', money(wage.regularBenefitsCents)],
    ['Giydirilmiş aylık brüt', money(wage.dressedWageCents)],
    ...severancePaySourceFacts(estimate.paySource),
    [
      'Kıdem tavanı',
      `${money(severance.ceiling.monthlyCents)} (${dayText(severance.ceiling.from)} dönemi)${severance.ceilingApplied ? ', uygulandı' : ''}`,
    ],
    ['İhbar süresi', `${String(notice.weeks)} hafta${estimate.noticeGiven ? ' (verildi)' : ''}`],
    [
      'İhbarda gelir vergisi',
      notice.incomeTaxMethod === 'none'
        ? INCOME_TAX_METHOD_LABELS.none
        : `${INCOME_TAX_METHOD_LABELS[notice.incomeTaxMethod]}, ${String(notice.taxYear)} tarifesi`,
    ],
    ['Damga vergisi oranı', stampTaxLabel(estimate.parameters.stampTaxRatePer100k)],
    ['Parametre kaynağı', severanceParameterSourceLabel(estimate.parameters)],
  ]
}

/** Hak doğmayan kalemin nedeni ve uyarılar. */
export function severanceNotes(estimate: BreakdownSource): string[] {
  return [
    ...(estimate.severance.status === 'eligible'
      ? []
      : [`Kıdem: ${SEVERANCE_STATUS_LABELS[estimate.severance.status]}.`]),
    ...(estimate.notice.status === 'eligible'
      ? []
      : [`İhbar: ${NOTICE_STATUS_LABELS[estimate.notice.status]}.`]),
    ...severanceWarnings(estimate),
  ]
}
