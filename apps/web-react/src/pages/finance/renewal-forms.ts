// Kayıt yenileme ekranının saf mantığı (IST-100; DOM-FIN-002, -005, -020, -023, -025; DOM-KAY-020):
// form değerleri, gövde dönüşümü, hedef sınıf seçenekleri, ücret özeti satırları ve ÜFE/TÜFE formu.
// Ücretin kendisi sunucuda hesaplanır (önizleme ucu); ekran yalnız biçimler. Dil okulunda teklifin
// kur sonu kararı dayanağı da önizlemeden gelir (DOM-DIL-070).
import { z } from 'zod'
import { PROGRESSION_OUTCOMES } from '@kampus/school-core/cefr/progression.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import {
  FEE_DISCOUNT_KIND_LABELS,
  FEE_DISCOUNT_KINDS,
  FEE_ITEM_KIND_LABELS,
  FEE_ITEM_KINDS,
  type FeeDiscountKind,
  type FeeItemKind,
} from '@kampus/school-core/lib/fee-tariffs.ts'
import { parseAmountInput } from '@kampus/school-core/lib/payments.ts'
import { createPriceIndexSchema } from '@kampus/school-core/lib/renewals.ts'
import type { RenewalCeiling } from '@kampus/school-core/lib/renewal-ceiling.ts'
import {
  COURSE_OFFER_MESSAGES,
  type RenewalCourseOffer,
} from '@kampus/school-core/lib/renewal-course-offer.ts'

export const RENEWAL_MODES = ['renew', 'graduate'] as const
export type RenewalMode = (typeof RENEWAL_MODES)[number]
export const RENEWAL_MODE_LABELS: Readonly<Record<RenewalMode, string>> = {
  renew: 'Yeni döneme yenile',
  graduate: 'Mezuniyet',
}
export const RENEWAL_STATUSES = ['Planlandı', 'Tamamlandı', 'Mezun', 'İptal'] as const

export const renewalFormSchema = z
  .object({
    studentId: z.string().min(1, 'Öğrenciyi seçin.'),
    mode: z.enum(RENEWAL_MODES),
    targetClassId: z.string(),
    tuition: z.string(),
    discounts: z.array(z.enum(FEE_DISCOUNT_KINDS)),
    extras: z.array(z.enum(FEE_ITEM_KINDS)),
    scholarshipProgramId: z.string(),
    installmentCount: z.string(),
    firstDueDate: z.string(),
  })
  .superRefine((value, context) => {
    if (value.mode === 'graduate') return
    if (!value.targetClassId)
      context.addIssue({ code: 'custom', path: ['targetClassId'], message: 'Yeni sınıfı seçin.' })
    if (value.tuition.trim() !== '' && parseAmountInput(value.tuition) === null)
      context.addIssue({
        code: 'custom',
        path: ['tuition'],
        message: 'Tutarı 1.234,56 biçiminde girin ya da boş bırakın.',
      })
    if (!/^(?:[1-9]|1[0-2])$/.test(value.installmentCount.trim()))
      context.addIssue({
        code: 'custom',
        path: ['installmentCount'],
        message: 'Taksit sayısını 1 ile 12 arasında girin.',
      })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.firstDueDate))
      context.addIssue({
        code: 'custom',
        path: ['firstDueDate'],
        message: 'İlk taksit tarihini seçin.',
      })
  })
export type RenewalFormValues = z.input<typeof renewalFormSchema>

export const renewalDefaults = (): RenewalFormValues => ({
  studentId: '',
  mode: 'renew',
  targetClassId: '',
  tuition: '',
  discounts: [],
  extras: [],
  scholarshipProgramId: '',
  installmentCount: '8',
  firstDueDate: '',
})

/** Önizleme gövdesi; boş ücret ilan ve tavanın küçüğü demektir (sunucu hesaplar). */
export function renewalQuoteBody(values: RenewalFormValues, academicYear: number) {
  const tuitionCents = values.tuition.trim() === '' ? null : parseAmountInput(values.tuition)
  return {
    studentId: values.studentId,
    targetClassId: values.targetClassId,
    academicYear,
    installmentCount: Number(values.installmentCount),
    discounts: [...values.discounts],
    extras: [...values.extras],
    ...(tuitionCents === null ? {} : { tuitionCents }),
    ...(values.scholarshipProgramId === ''
      ? {}
      : { scholarshipProgramId: values.scholarshipProgramId }),
  }
}

/** Plan gövdesi; yenilemede önizlemenin tarifesi gönderilir, sürüm değiştiyse sunucu 409 döner. */
export function renewalPlanBody(
  values: RenewalFormValues,
  academicYear: number,
  tariffId: string | null,
) {
  if (values.mode === 'graduate')
    return { mode: 'graduate' as const, studentId: values.studentId, academicYear }
  return {
    ...renewalQuoteBody(values, academicYear),
    mode: 'renew' as const,
    tariffId: tariffId ?? '',
    firstDueDate: values.firstDueDate,
  }
}

type ClassLike = {
  id: string
  name: string
  grade?: number | undefined
  branchId: string
  isActive?: boolean | undefined
}
type Option = { value: string; label: string }

/** Yeni sınıf: bir üst düzeyin etkin sınıfları, kampüs adıyla (DOM-KAY-021). */
export function targetClassOptions(
  classes: readonly ClassLike[],
  branchNames: ReadonlyMap<string, string>,
  currentClassId: string | undefined,
): Option[] {
  const current = classes.find((item) => item.id === currentClassId)
  if (current?.grade === undefined) return []
  return classes
    .filter((item) => item.isActive !== false && item.grade === (current.grade ?? 0) + 1)
    .map((item) => ({
      value: item.id,
      label: `${item.name} · ${branchNames.get(item.branchId) ?? 'Kampüs'}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'tr'))
}

/** Yenilenecek öğrenci seçenekleri: etkin öğrenciler, `Ad Soyad · Sınıf`. */
export function studentOptions(
  students: readonly { id: string; name: string; classId: string; isActive?: boolean }[],
  classNames: ReadonlyMap<string, string>,
): Option[] {
  return students
    .filter((item) => item.isActive !== false)
    .map((item) => ({
      value: item.id,
      label: `${item.name} · ${classNames.get(item.classId) ?? '—'}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'tr'))
}

const percent = (basisPoints: number) =>
  `%${(basisPoints / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`

/** Tavanın açıklaması (DOM-FIN-005, DOM-FIN-023); uygulanmıyorsa nedeni. */
export function ceilingLines(ceiling: RenewalCeiling): string[] {
  if (ceiling.status === 'entry_grade')
    return ['Kademenin başlangıç sınıfı: artış tavanı uygulanmaz, ücret ilanla sınırlıdır.']
  if (ceiling.status === 'no_base')
    return [
      'Artış tavanı hesaplanamadı: öğrencinin önceki sözleşmesi ve önceki yılın ilan ücreti yok. Ücret ilanla sınırlıdır.',
    ]
  const source =
    ceiling.baseSource === 'previous_tariff'
      ? 'önceki yılın ilan ücreti'
      : ceiling.baseSource === 'enrollment_contract'
        ? 'kayıt yılındaki indirimsiz ücret'
        : 'son sözleşmedeki ücret'
  const rates = ceiling.rates
    .map(
      (rate) =>
        `${String(rate.academicYear)}: ÜFE ${percent(rate.ppiBasisPoints)}, TÜFE ${percent(rate.cpiBasisPoints)}`,
    )
    .join('; ')
  return [
    `Artış tavanı: ${money(ceiling.ceilingCents)} (baz ${money(ceiling.baseCents)}, ${source}, ${String(ceiling.baseYear)})`,
    `Uygulanan oranlar: ${rates} · ek ${percent(ceiling.extraBasisPoints)}`,
    ...(ceiling.discountLoss ? [ceiling.discountLoss.reason] : []),
  ]
}

export type RenewalQuoteView = {
  announcedCents: number
  ceiling: RenewalCeiling
  tuitionCents: number
  discounts: readonly { kind: string; amountCents: number }[]
  discountCents: number
  scholarship: { amountCents: number } | null
  netCents: number
  extras: readonly { kind: string; amountCents: number }[]
  installments: readonly number[]
  /** Dil okulunda kur sonu kararı dayanağı; okulda `null`. */
  courseOffer?: RenewalCourseOffer | null
}

/**
 * Teklifin kur sonu kararı notu (DOM-DIL-070). `blocking`: karar onaylı değil, plan yazılmaz;
 * sunucu da 422 ile reddeder. Okulda not yok.
 */
export function courseOfferNotice(
  offer: RenewalCourseOffer | null | undefined,
): { blocking: boolean; text: string } | null {
  if (!offer) return null
  if (offer.status !== 'ready') return { blocking: true, text: COURSE_OFFER_MESSAGES[offer.status] }
  const outcome = offer.outcome === null ? '' : PROGRESSION_OUTCOMES[offer.outcome].label
  const target =
    offer.outcome === 'passed'
      ? `teklif ${offer.level ?? ''} seviyesine açılır`
      : `teklif aynı seviyede (${offer.level ?? ''}) kalır`
  return { blocking: false, text: `Kur sonu kararı: ${outcome}; ${target}.` }
}

const discountLabel = (kind: string) =>
  FEE_DISCOUNT_KIND_LABELS[kind as FeeDiscountKind] ?? 'İndirim'
const extraLabel = (kind: string) => FEE_ITEM_KIND_LABELS[kind as FeeItemKind] ?? 'Ek hizmet'

/** Ödeme özeti satırları; tutarlar sunucunun önizlemesidir. */
export function quoteLines(quote: RenewalQuoteView) {
  return {
    pricing: [
      `İlan edilen ücret: ${money(quote.announcedCents)}`,
      ...ceilingLines(quote.ceiling),
      `Öğrenim ücreti: ${money(quote.tuitionCents)}`,
      ...quote.discounts.map(
        (line) => `${discountLabel(line.kind)} indirimi: −${money(line.amountCents)}`,
      ),
      ...(quote.scholarship ? [`Burs: −${money(quote.scholarship.amountCents)}`] : []),
    ],
    net: `Net eğitim bedeli: ${money(quote.netCents)}`,
    installments:
      quote.installments.length === 0
        ? 'Tam burs: öğrenim taksiti açılmaz'
        : `${String(quote.installments.length)} taksit`,
    extras: quote.extras.map(
      (line) => `${extraLabel(line.kind)}: ${money(line.amountCents)} (ayrı taksit)`,
    ),
  }
}

export const RENEWAL_SERVER_FIELDS = [
  'studentId',
  'targetClassId',
  'tuition',
  'discounts',
  'extras',
  'scholarshipProgramId',
  'installmentCount',
  'firstDueDate',
] as const
export type RenewalServerField = (typeof RENEWAL_SERVER_FIELDS)[number]

/** Sunucu alanı → form alanı (`tuitionCents` formda ₺ olarak girilir). */
export function renewalFieldFor(name: string): RenewalServerField | null {
  if (name === 'tuitionCents') return 'tuition'
  return (RENEWAL_SERVER_FIELDS as readonly string[]).includes(name)
    ? (name as RenewalServerField)
    : null
}

// --- ÜFE ve TÜFE formu ------------------------------------------------------------------------

/** "42,5" → 4250 (on binde birlik); en çok iki ondalık, %1000'e kadar. */
export function parseRateInput(text: string): number | null {
  const value = text.trim()
  if (!/^\d{1,4}(?:[.,]\d{1,2})?$/.test(value)) return null
  const points = Math.round(Number(value.replace(',', '.')) * 100)
  return points <= 100_000 ? points : null
}
export const rateText = (basisPoints: number) =>
  (basisPoints / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })

const rateField = (message: string) =>
  z.string().refine((value) => parseRateInput(value) !== null, message)

export const priceIndexFormSchema = z.object({
  academicYear: z.string().regex(/^\d{4}$/, 'Ücret yılını girin.'),
  ppi: rateField('ÜFE ortalamasını yüzde olarak girin (ör. 42,5).'),
  cpi: rateField('TÜFE ortalamasını yüzde olarak girin (ör. 42,5).'),
  source: createPriceIndexSchema.shape.source,
  bulletinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Bülten tarihini seçin.'),
})
export type PriceIndexFormValues = z.input<typeof priceIndexFormSchema>

export const priceIndexDefaults = (
  academicYear: number,
  existing?: {
    ppiBasisPoints: number
    cpiBasisPoints: number
    source: string
    bulletinDate: string
  },
): PriceIndexFormValues => ({
  academicYear: String(academicYear),
  ppi: existing ? rateText(existing.ppiBasisPoints) : '',
  cpi: existing ? rateText(existing.cpiBasisPoints) : '',
  source: existing?.source ?? '',
  bulletinDate: existing?.bulletinDate ?? '',
})

export function priceIndexBody(values: z.output<typeof priceIndexFormSchema>) {
  return {
    academicYear: Number(values.academicYear),
    ppiBasisPoints: parseRateInput(values.ppi) ?? 0,
    cpiBasisPoints: parseRateInput(values.cpi) ?? 0,
    source: values.source,
    bulletinDate: values.bulletinDate,
  }
}

export const bulletinText = (day: string) => dateLabel(day, { year: 'numeric' })
