import { z } from 'zod'

import type { InstitutionType } from '../modules/collection-modules.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
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
 * Okulda ücret ocak başı–mayıs sonu arasında ilan edilir (DOM-FIN-002, 5580 md. 13/1). Dönem dışı
 * yayım engellenmez: ek sınıf veya yeni kurum gibi meşru durumlar vardır, ekran uyarır. Dil okulu
 * bu kurala bağlı değildir.
 */
export function isOutsideAnnouncementPeriod(
  announcedDate: string,
  institutionType: InstitutionType,
): boolean {
  if (institutionType !== 'school') return false
  const month = Number(announcedDate.slice(5, 7))
  return month < 1 || month > 5
}

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
