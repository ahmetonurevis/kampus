import { z } from 'zod'

import type { InstitutionType } from '../modules/collection-modules.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'

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
