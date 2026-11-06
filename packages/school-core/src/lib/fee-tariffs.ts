import { z } from 'zod'

import type { InstitutionType } from '../modules/collection-modules.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { dayKey } from './format.ts'
import { amountInputValue, parseAmountInput } from './payments.ts'

/**
 * Ücret tarifesi (docs/domain/finans.md DOM-FIN-002, -003, -004, -006; IST-104; ADR 0006). Tarife
 * eğitim yılı başına sürümlüdür: taslak düzenlenir, yayımlanan sürüm değişmez. Kurallar saftır;
 * API satırları yükler, karar sonucunu yazar.
 */

/** Yalnız bu türlerle borç açılır; "kayıt ücreti", "bağış" gibi ad yoktur (DOM-FIN-004). */
export const FEE_ITEM_KINDS = [
  'tuition',
  'breakfast',
  'meal',
  'transport',
  'dormitory',
  'stationery',
  'uniform',
  'tutoring',
] as const
export type FeeItemKind = (typeof FEE_ITEM_KINDS)[number]

/** Öğrenim ücreti birimi kurum türüne bağlıdır (DOM-FIN-006). */
export const FEE_UNITS = ['year', 'month', 'lesson_hour', 'item'] as const
export type FeeUnit = (typeof FEE_UNITS)[number]

export const FEE_ITEM_KIND_LABELS: Readonly<Record<FeeItemKind, string>> = {
  tuition: 'Öğrenim ücreti',
  breakfast: 'Kahvaltı',
  meal: 'Yemek',
  transport: 'Servis',
  dormitory: 'Pansiyon',
  stationery: 'Kitap ve kırtasiye',
  uniform: 'Kıyafet',
  tutoring: 'Etüt',
}
export const FEE_UNIT_LABELS: Readonly<Record<FeeUnit, string>> = {
  year: 'Yıl',
  month: 'Ay',
  lesson_hour: 'Ders saati',
  item: 'Adet',
}

export const feeItemSchema = z.strictObject({
  kind: z.enum(FEE_ITEM_KINDS, 'Ücret kalemi türünü seçin.'),
  /** Düzey veya program (`7`, `B1`); tüm düzeylere uygulanıyorsa boş. */
  level: z.string().trim().min(1).max(40).nullable(),
  amountCents: z
    .number()
    .int('Tutar kuruş cinsinden tam sayı olmalıdır.')
    .positive('Tutar sıfırdan büyük olmalıdır.')
    .max(100_000_000, 'Tutar en fazla 1.000.000 ₺ olabilir.'),
  unit: z.enum(FEE_UNITS, 'Ücret birimini seçin.'),
  /** KDV oranı binde değil on binde birlikle tutulur: %10 → 1000 (IST-104). */
  vatBasisPoints: z.number().int().min(0).max(10_000),
  vatEffectiveDate: daySchema,
  /** MEBBİS'te onaylı tutar; okulda öğrenim ücreti için zorunludur (DOM-FIN-002). */
  announcedAmountCents: z.number().int().positive().max(100_000_000).nullable(),
})
export type FeeItem = z.output<typeof feeItemSchema>

/** Yalnız ilan edilen türden indirim uygulanır; serbest tutar yoktur (DOM-FIN-020). */
export const FEE_DISCOUNT_KINDS = [
  'sibling',
  'early_payment',
  'early_registration',
  'referral',
  'corporate',
  'staff_child',
] as const
export type FeeDiscountKind = (typeof FEE_DISCOUNT_KINDS)[number]

export const FEE_DISCOUNT_KIND_LABELS: Readonly<Record<FeeDiscountKind, string>> = {
  sibling: 'Kardeş',
  early_payment: 'Peşin ödeme',
  early_registration: 'Erken kayıt',
  referral: 'Referans',
  corporate: 'Kurumsal anlaşma',
  staff_child: 'Personel çocuğu',
}

export const feeDiscountSchema = z
  .strictObject({
    kind: z.enum(FEE_DISCOUNT_KINDS, 'İndirim türünü seçin.'),
    percentBasisPoints: z.number().int().min(1).max(10_000).nullable(),
    amountCents: z.number().int().positive().max(100_000_000).nullable(),
  })
  .refine((value) => (value.percentBasisPoints === null) !== (value.amountCents === null), {
    message: 'İndirim için oran veya tutardan yalnız birini girin.',
  })
export type FeeDiscount = z.output<typeof feeDiscountSchema>

/** Kalemin tarifedeki değeri: ilan ücretinin oranı (aşağı yuvarlanır) ya da sabit tutar (DOM-FIN-020). */
export function discountRuleAmount(rule: FeeDiscount, grossCents: number): number {
  return rule.amountCents ?? Math.floor((grossCents * (rule.percentBasisPoints ?? 0)) / BASIS)
}
const feeDiscountsSchema = z.array(feeDiscountSchema).max(20).default([])

const feeItemsSchema = z.array(feeItemSchema).min(1, 'En az bir ücret kalemi girin.').max(100)

export const createFeeTariffSchema = z.strictObject({
  academicYear: z.number().int().min(2000).max(2100),
  items: feeItemsSchema,
  discounts: feeDiscountsSchema,
})
export type CreateFeeTariffInput = z.input<typeof createFeeTariffSchema>

/** Kısmi güncelleme: verilmeyen alan kalır; verilen alan bütün olarak değişir. */
export const updateFeeTariffSchema = z.strictObject({
  items: feeItemsSchema.optional(),
  discounts: z.array(feeDiscountSchema).max(20).optional(),
})
export type UpdateFeeTariffInput = z.input<typeof updateFeeTariffSchema>

/**
 * İlan dönemi profil parametresidir (DOM-FIN-002): okulda ücret ocak başı–mayıs sonu arasında ilan
 * edilir (5580 md. 13/1). Kaydı olmayan kurum türü (dil okulu, kurs) bu kurala bağlı değildir.
 */
const ANNOUNCEMENT_PERIODS: Partial<
  Readonly<Record<InstitutionType, { firstMonth: number; lastMonth: number }>>
> = {
  school: { firstMonth: 1, lastMonth: 5 },
}

/**
 * Dönem dışı yayım engellenmez: ek sınıf veya yeni kurum gibi meşru durumlar vardır, ekran uyarır.
 */
export function isOutsideAnnouncementPeriod(
  announcedDate: string,
  institutionType: InstitutionType,
): boolean {
  const period = ANNOUNCEMENT_PERIODS[institutionType]
  if (period === undefined) return false
  const month = Number(announcedDate.slice(5, 7))
  return month < period.firstMonth || month > period.lastMonth
}

/**
 * Eğitim yılının ilan dönemi bitti mi: 2026–2027 ücreti 2026 ocak–mayısında ilan edilir, dönemin son
 * günü de süre içindedir. Gün Europe/Istanbul'a göredir. İlan dönemi olmayan kurum türünde süre de
 * dolmaz.
 */
export function isAnnouncementPeriodOver(
  academicYear: number,
  institutionType: InstitutionType,
  now: string | Date,
): boolean {
  const period = ANNOUNCEMENT_PERIODS[institutionType]
  if (period === undefined) return false
  const lastMonth = `${String(academicYear)}-${String(period.lastMonth).padStart(2, '0')}`
  return dayKey(now).slice(0, 7) > lastMonth
}

/**
 * Sözleşmeye esas tarife (DOM-FIN-002, K-11): hedef yılın yayımlı tarifesi varsa odur; yoksa ve ilan
 * dönemi bittiyse önceki yılın yayımlı tarifesi geçerli kalır. Dönem sürüyorsa, kurum türünün ilan
 * dönemi yoksa ya da önceki yılın da tarifesi yoksa `null`: çağıran `tariff_not_published` verir.
 * Zincirleme taşıma yoktur, yalnız bir önceki yıla bakılır. `carriedOverFromYear` tarifenin taşındığı
 * yıldır; hedef yılın kendi tarifesinde `null`.
 */
export function resolveEffectiveTariff<TTariff>(input: {
  academicYear: number
  institutionType: InstitutionType
  published: TTariff | null
  previousPublished: TTariff | null
  now: string | Date
}): { tariff: TTariff; carriedOverFromYear: number | null } | null {
  if (input.published !== null) return { tariff: input.published, carriedOverFromYear: null }
  if (
    input.previousPublished === null ||
    !isAnnouncementPeriodOver(input.academicYear, input.institutionType, input.now)
  )
    return null
  return { tariff: input.previousPublished, carriedOverFromYear: input.academicYear - 1 }
}

/** Önceki yılın tarifesi uygulandığında kullanıcıya gösterilen açıklama (DOM-FIN-002, K-11). */
export const carriedOverTariffNote = (fromYear: number) =>
  `Bu eğitim yılının ücreti süresinde ilan edilmediği için önceki yılın (${String(fromYear)}–${String(fromYear + 1)}) tarifesi uygulanır.`

export const publishFeeTariffSchema = z.strictObject({
  announcedDate: daySchema,
  mebbisRecordedDate: daySchema.nullable(),
})
export type PublishFeeTariffInput = z.input<typeof publishFeeTariffSchema>

export type FeeTariffStatus = 'draft' | 'published' | 'superseded'

export interface FeeTariffRow {
  id: string
  academicYear: number
  versionNumber: number
  status: FeeTariffStatus
  items: readonly FeeItem[]
  discounts: readonly FeeDiscount[]
}

/** Aynı tür ve düzey iki kez fiyatlanmaz. */
function assertUniqueItems(items: readonly FeeItem[]): void {
  const seen = new Set<string>()
  for (const [index, item] of items.entries()) {
    const key = `${item.kind}|${item.level ?? ''}`
    if (seen.has(key))
      throw new DomainError('tariff_item_duplicate', 'Aynı kalem ve düzey iki kez girilemez.', {
        path: ['items', String(index)],
      })
    seen.add(key)
  }
}

/** Yeni taslağın sürüm numarası; yılda tek açık taslak olur. */
export function planTariffCreate(
  input: unknown,
  existing: readonly Pick<FeeTariffRow, 'versionNumber' | 'status'>[],
): { academicYear: number; versionNumber: number; items: FeeItem[]; discounts: FeeDiscount[] } {
  const data = createFeeTariffSchema.parse(input)
  assertUniqueItems(data.items)
  if (existing.some((row) => row.status === 'draft'))
    throw new DomainError('open_tariff_draft', 'Bu yıl için açık bir tarife taslağı var.', {
      kind: 'conflict',
    })
  const last = existing.reduce((highest, row) => Math.max(highest, row.versionNumber), 0)
  return {
    academicYear: data.academicYear,
    versionNumber: last + 1,
    items: data.items,
    discounts: data.discounts,
  }
}

function assertDraft(row: Pick<FeeTariffRow, 'status'>): void {
  if (row.status !== 'draft')
    throw new DomainError(
      'tariff_not_draft',
      'Yayımlanmış tarife değiştirilemez; yeni sürüm açın.',
      { kind: 'conflict' },
    )
}

export function planTariffUpdate(
  row: Pick<FeeTariffRow, 'status' | 'items' | 'discounts'>,
  input: unknown,
): { items: FeeItem[]; discounts: FeeDiscount[] } {
  assertDraft(row)
  const data = updateFeeTariffSchema.parse(input)
  const items = data.items ?? [...row.items]
  assertUniqueItems(items)
  return { items, discounts: data.discounts ?? [...row.discounts] }
}

/**
 * Yayım denetimi (DOM-FIN-002, -006): öğrenim ücreti bulunur, birimi kurum türüne uyar, okulda
 * onaylı tutar girilmiştir ve ilan edilen tutar onaylı tutarı aşmaz.
 */
export function planTariffPublish(
  row: Pick<FeeTariffRow, 'status' | 'items'>,
  input: unknown,
  options: { institutionType: InstitutionType; today: string },
): { announcedDate: string; mebbisRecordedDate: string | null } {
  assertDraft(row)
  const data = publishFeeTariffSchema.parse(input)
  if (data.announcedDate > options.today)
    throw new DomainError('tariff_announced_in_future', 'İlan tarihi ileri bir gün olamaz.', {
      path: ['announcedDate'],
    })
  if (data.mebbisRecordedDate !== null && data.mebbisRecordedDate > options.today)
    throw new DomainError('tariff_mebbis_in_future', 'MEBBİS tarihi ileri bir gün olamaz.', {
      path: ['mebbisRecordedDate'],
    })
  const expectedUnit: FeeUnit = options.institutionType === 'school' ? 'year' : 'lesson_hour'
  const tuition = row.items.filter((item) => item.kind === 'tuition')
  if (tuition.length === 0)
    throw new DomainError('tariff_tuition_required', 'Tarifede öğrenim ücreti bulunmalıdır.')
  for (const item of tuition) {
    if (item.unit !== expectedUnit)
      throw new DomainError(
        'tariff_unit_mismatch',
        expectedUnit === 'year'
          ? 'Okulda öğrenim ücreti yıllık tespit edilir.'
          : 'Dil okulunda öğrenim ücreti ders saati üzerinden tespit edilir.',
      )
    if (options.institutionType === 'school' && item.announcedAmountCents === null)
      throw new DomainError(
        'tariff_announced_required',
        'Öğrenim ücreti için MEBBİS onaylı tutarı girin.',
      )
  }
  for (const item of row.items)
    if (item.announcedAmountCents !== null && item.amountCents > item.announcedAmountCents)
      throw new DomainError(
        'tariff_amount_exceeds_announced',
        'Ücret, MEBBİS onaylı tutarı aşamaz.',
      )
  return { announcedDate: data.announcedDate, mebbisRecordedDate: data.mebbisRecordedDate }
}

const AMOUNT_MESSAGE = 'Tutarı 1.234,56 biçiminde girin (en fazla 1.000.000 ₺).'
const amountField = z.string().refine((value) => parseAmountInput(value) !== null, AMOUNT_MESSAGE)
const percentCents = (value: string) => {
  const parsed = parseAmountInput(value)
  return parsed !== null && parsed <= BASIS ? parsed : null
}
const BASIS = 10_000

/** Tarife formu (web): tutar ve oran metindir, gönderimde kuruşa ve on binde birliğe çevrilir. */
export const feeTariffFormSchema = z.object({
  academicYear: z.string().regex(/^20\d{2}$/, 'Eğitim yılını 2026 biçiminde girin.'),
  items: z
    .array(
      z.object({
        kind: z.enum(FEE_ITEM_KINDS, 'Ücret kalemi türünü seçin.'),
        level: z.string().trim().max(40),
        amount: amountField,
        unit: z.enum(FEE_UNITS, 'Ücret birimini seçin.'),
        vatPercent: z.string().refine((value) => {
          const trimmed = value.trim()
          return trimmed === '0' || percentCents(trimmed) !== null
        }, 'KDV oranını 0 ile 100 arasında girin.'),
        vatEffectiveDate: daySchema,
        announcedAmount: z
          .string()
          .refine(
            (value) => value.trim() === '' || parseAmountInput(value) !== null,
            AMOUNT_MESSAGE,
          ),
      }),
    )
    .min(1, 'En az bir ücret kalemi girin.'),
  discounts: z.array(
    z
      .object({
        kind: z.enum(FEE_DISCOUNT_KINDS, 'İndirim türünü seçin.'),
        mode: z.enum(['percent', 'amount']),
        value: z.string(),
      })
      .superRefine((discount, context) => {
        const valid =
          discount.mode === 'percent'
            ? percentCents(discount.value) !== null
            : parseAmountInput(discount.value) !== null
        if (!valid)
          context.addIssue({
            code: 'custom',
            path: ['value'],
            message:
              discount.mode === 'percent' ? 'Oranı 0 ile 100 arasında girin.' : AMOUNT_MESSAGE,
          })
      }),
  ),
})
export type FeeTariffFormValues = z.output<typeof feeTariffFormSchema>

/**
 * Girilen ücret ilan tutarını aşıyor mu (IST-104). Form anında uyarmak içindir, kaydı engellemez:
 * taslak eksik ya da hatalı olabilir, asıl ret yayımdadır (`planTariffPublish`). Boş ya da
 * çözümlenemeyen tutar karşılaştırılmaz; onun mesajı alanın kendi doğrulamasıdır.
 */
export function tariffItemExceedsAnnounced(item: {
  amount: string
  announcedAmount: string
}): boolean {
  const amount = parseAmountInput(item.amount)
  const announced = parseAmountInput(item.announcedAmount)
  return amount !== null && announced !== null && amount > announced
}

export function emptyTariffForm(academicYear: number, today: string): FeeTariffFormValues {
  return {
    academicYear: String(academicYear),
    items: [
      {
        kind: 'tuition',
        level: '',
        amount: '',
        unit: 'year',
        vatPercent: '10',
        vatEffectiveDate: today,
        announcedAmount: '',
      },
    ],
    discounts: [],
  }
}

/** Kayıtlı tarifeyi forma çevirir: taslak düzenleme ve yeni sürüm aynı değerlerle açılır. */
export function tariffToForm(tariff: {
  academicYear: number
  items: readonly FeeItem[]
  discounts: readonly FeeDiscount[]
}): FeeTariffFormValues {
  return {
    academicYear: String(tariff.academicYear),
    items: tariff.items.map((item) => ({
      kind: item.kind,
      level: item.level ?? '',
      amount: amountInputValue(item.amountCents),
      unit: item.unit,
      vatPercent: item.vatBasisPoints === 0 ? '0' : amountInputValue(item.vatBasisPoints),
      vatEffectiveDate: item.vatEffectiveDate,
      announcedAmount:
        item.announcedAmountCents === null ? '' : amountInputValue(item.announcedAmountCents),
    })),
    discounts: tariff.discounts.map((discount) =>
      discount.amountCents === null
        ? {
            kind: discount.kind,
            mode: 'percent' as const,
            value: amountInputValue(discount.percentBasisPoints ?? 0),
          }
        : {
            kind: discount.kind,
            mode: 'amount' as const,
            value: amountInputValue(discount.amountCents),
          },
    ),
  }
}

/**
 * Yayımlanmış tarifeden bir sonraki eğitim yılının taslak formu (ON-055, DOM-FIN-002): kalemler,
 * birimler, KDV ve indirimler başlangıç olarak taşınır; MEBBİS'te onaylanan ilan tutarı yıla
 * özgü olduğu için boşaltılır ve yeni yılın ilanıyla girilir. Kayıtlı tarife değişmez.
 */
export function nextYearTariffForm(tariff: {
  academicYear: number
  items: readonly FeeItem[]
  discounts: readonly FeeDiscount[]
}): FeeTariffFormValues {
  const form = tariffToForm(tariff)
  return {
    ...form,
    academicYear: String(tariff.academicYear + 1),
    items: form.items.map((item) => ({ ...item, announcedAmount: '' })),
  }
}

/** Doğrulanmış form değerlerini API gövdesine çevirir. */
export function tariffFormToBody(values: FeeTariffFormValues): {
  academicYear: number
  items: FeeItem[]
  discounts: FeeDiscount[]
} {
  return {
    academicYear: Number(values.academicYear),
    items: values.items.map((item) => ({
      kind: item.kind,
      level: item.level.trim() === '' ? null : item.level.trim(),
      amountCents: parseAmountInput(item.amount) ?? 0,
      unit: item.unit,
      vatBasisPoints: item.vatPercent.trim() === '0' ? 0 : (percentCents(item.vatPercent) ?? 0),
      vatEffectiveDate: item.vatEffectiveDate,
      announcedAmountCents:
        item.announcedAmount.trim() === '' ? null : parseAmountInput(item.announcedAmount),
    })),
    discounts: values.discounts.map((discount) =>
      discount.mode === 'percent'
        ? {
            kind: discount.kind,
            percentBasisPoints: percentCents(discount.value),
            amountCents: null,
          }
        : {
            kind: discount.kind,
            percentBasisPoints: null,
            amountCents: parseAmountInput(discount.value),
          },
    ),
  }
}

// --- Mevzuat hesapları (saf; uygulanacakları yer yenileme API'si, ON-030) ---------------------

/** Artış tavanındaki ek puan (DOM-FIN-005): bugün 5 puan; on binde birlik. */
export const TUITION_INCREASE_EXTRA_BASIS_POINTS = 500
/** Ücretsiz okutma oranı (DOM-FIN-026): bugün %3; on binde birlik, profil parametresidir. */
export const FREE_QUOTA_BASIS_POINTS = 300

/** Bir yılın ÜFE ve TÜFE ortalaması, on binde birlik (%42,5 → 4250); TÜİK bülteninden girilir. */
export type PriceIndexRates = { ppiBasisPoints: number; cpiBasisPoints: number }

function requireMoney(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new DomainError('tuition_base_invalid', 'Ücret tutarı geçersiz.')
}
function requireRate(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new DomainError('tuition_rate_invalid', 'ÜFE ve TÜFE oranı geçersiz.')
}

/**
 * Devam eden öğrencinin yeni yıl ücret tavanı (DOM-FIN-005, ÖÖKY md. 53/1):
 * `baz × (1 + ((ÜFE + TÜFE) / 2 + ek puan) / 100)`. Tavan aşılmasın diye aşağı yuvarlanır.
 * Hesap kuruş tamsayısıyla yapılır; ara sonuç güvenli aralığı aşarsa reddedilir.
 */
export function tuitionIncreaseCeiling(
  baseCents: number,
  rates: PriceIndexRates,
  extraBasisPoints = TUITION_INCREASE_EXTRA_BASIS_POINTS,
): number {
  requireMoney(baseCents)
  requireRate(rates.ppiBasisPoints)
  requireRate(rates.cpiBasisPoints)
  requireRate(extraBasisPoints)
  const factor = 20_000 + rates.ppiBasisPoints + rates.cpiBasisPoints + 2 * extraBasisPoints
  const product = baseCents * factor
  if (!Number.isSafeInteger(product))
    throw new DomainError('tuition_base_invalid', 'Ücret tutarı geçersiz.')
  return Math.floor(product / 20_000)
}

/**
 * İndirim koşulu kalkan öğrencinin sonraki yıl ücreti (DOM-FIN-023, ÖÖKY md. 53/1 son cümle):
 * kayıt yılındaki indirimsiz ücrete her öğrenim yılı için `DOM-FIN-005` oranı sırayla uygulanır.
 * `yearlyRates` kayıt yılından sonraki yılların oranlarıdır, eskiden yeniye.
 */
export function tuitionAfterDiscountLoss(
  undiscountedCents: number,
  yearlyRates: readonly PriceIndexRates[],
  extraBasisPoints = TUITION_INCREASE_EXTRA_BASIS_POINTS,
): number {
  return yearlyRates.reduce(
    (cents, rates) => tuitionIncreaseCeiling(cents, rates, extraBasisPoints),
    undiscountedCents,
  )
}

/**
 * Ücretsiz okutulacak öğrenci sayısı (DOM-FIN-026, 5580 md. 13/3): öğrenci sayısının oranı; kesirli
 * sonuç 0,5 ve üstündeyse yukarı yuvarlanır.
 */
export function freeQuotaCount(
  studentCount: number,
  basisPoints = FREE_QUOTA_BASIS_POINTS,
): number {
  if (!Number.isSafeInteger(studentCount) || studentCount < 0)
    throw new DomainError('free_quota_input_invalid', 'Öğrenci sayısı geçersiz.')
  requireRate(basisPoints)
  return Math.floor((studentCount * basisPoints + 5_000) / 10_000)
}
