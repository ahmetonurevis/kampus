// Demirbaş formları (DOM-FIN-085; ON-235). Alan kuralları core şemalarındandır; boş bırakılabilen
// alan formda boş metin, gövdede `null` olur. Alım değeri formda `1.234,56` metnidir, gövdede kuruş.
import { z } from 'zod'
import type {
  CreateFixedAssetBody,
  FixedAssetDetail,
  UpdateFixedAssetBody,
} from '@kampus/react-shared/use-finance-fixed-assets.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  DEFAULT_USEFUL_LIFE,
  DEPRECIATION_METHODS,
  FIXED_ASSET_CATEGORIES,
  FIXED_ASSET_OPEN_STATUSES,
  FIXED_ASSET_STATUS_LABELS,
  FIXED_ASSET_VALUE_MAX_CENTS,
  fixedAssetSchema,
  scrapFixedAssetSchema,
  USEFUL_LIFE_MAX,
  USEFUL_LIFE_MIN,
  type FixedAssetStatus,
} from '@kampus/school-core/lib/finance-fixed-assets.ts'
import { amountInputValue, parseAmountInput } from '@kampus/school-core/lib/payments.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

const VALUE_MESSAGE = 'Alım değerini 1.234,56 biçiminde, sıfırdan büyük girin.'
export const parseAssetValue = (text: string) =>
  parseAmountInput(text, { maxCents: FIXED_ASSET_VALUE_MAX_CENTS })

const shape = fixedAssetSchema.shape
const LIFE_MESSAGE = `Faydalı ömrü ${String(USEFUL_LIFE_MIN)}–${String(USEFUL_LIFE_MAX)} arasında tam yıl girin.`
const LIFE_PATTERN = /^\d{1,2}$/
/** Formdaki ömür metni; geçersizse `null`. */
export function parseUsefulLife(text: string): number | null {
  const trimmed = text.trim()
  if (!LIFE_PATTERN.test(trimmed)) return null
  const years = Number(trimmed)
  return years >= USEFUL_LIFE_MIN && years <= USEFUL_LIFE_MAX ? years : null
}
/** Kategorinin önerilen ömrü (K-224), form metni olarak. */
export const suggestedLife = (category: (typeof FIXED_ASSET_CATEGORIES)[number]) =>
  String(DEFAULT_USEFUL_LIFE[category])

export const fixedAssetFormSchema = z.object({
  tagNumber: z.string().superRefine((value, context) => {
    if (value.trim() === '') return
    const parsed = shape.tagNumber.safeParse(value)
    if (!parsed.success)
      context.addIssue({
        code: 'custom',
        message: parsed.error.issues[0]?.message ?? 'Etiket numarası geçersiz.',
      })
  }),
  name: shape.name,
  category: z.enum(FIXED_ASSET_CATEGORIES, 'Kategori seçin.'),
  campusId: z.string(),
  location: shape.location,
  value: z.string().refine((value) => parseAssetValue(value) !== null, { message: VALUE_MESSAGE }),
  acquisitionDate: daySchema,
  supplierId: z.string(),
  receiptItemId: z.string(),
  status: z.enum(FIXED_ASSET_OPEN_STATUSES, 'Durumu seçin.'),
  usefulLifeYears: z.string().refine((value) => parseUsefulLife(value) !== null, {
    message: LIFE_MESSAGE,
  }),
  depreciationMethod: z.enum(DEPRECIATION_METHODS, 'Amortisman yöntemini seçin.'),
})
export type FixedAssetFormValues = z.input<typeof fixedAssetFormSchema>
type FormField = keyof FixedAssetFormValues

/** Sunucu alan yolu form alanına çevrilir (`acquisitionValueCents` → `value`). */
export function fixedAssetFormField(name: string): FormField | undefined {
  if (name === 'acquisitionValueCents') return 'value'
  return (Object.keys(fixedAssetFormSchema.shape) as FormField[]).find((field) => field === name)
}

export function fixedAssetDefaults(asset: FixedAssetDetail | undefined, today: string) {
  return {
    tagNumber: asset?.tagNumber ?? '',
    name: asset?.name ?? '',
    category: asset?.category ?? 'furniture',
    campusId: asset?.campusId ?? '',
    location: asset?.location ?? '',
    value: asset ? amountInputValue(asset.acquisitionValueCents) : '',
    acquisitionDate: asset?.acquisitionDate ?? today,
    supplierId: asset?.supplierId ?? '',
    receiptItemId: asset?.receiptItemId ?? '',
    status: asset && asset.status !== 'scrapped' ? asset.status : 'in_use',
    usefulLifeYears: asset ? String(asset.usefulLifeYears) : suggestedLife('furniture'),
    depreciationMethod: asset?.depreciationMethod ?? 'normal',
  } satisfies FixedAssetFormValues
}

const blankToNull = (value: string) => (value.trim() === '' ? null : value.trim())

/** Yeni kayıt gövdesi; boş etiket sunucuda `DB-<yıl>-<sıra>` olur (K-185). */
export function fixedAssetBody(values: FixedAssetFormValues): CreateFixedAssetBody {
  return {
    tagNumber: blankToNull(values.tagNumber),
    name: values.name.trim(),
    category: values.category,
    campusId: blankToNull(values.campusId),
    location: values.location.trim(),
    acquisitionValueCents: parseAssetValue(values.value) ?? 0,
    acquisitionDate: values.acquisitionDate,
    supplierId: blankToNull(values.supplierId),
    receiptItemId: blankToNull(values.receiptItemId),
    status: values.status,
    usefulLifeYears:
      parseUsefulLife(values.usefulLifeYears) ?? DEFAULT_USEFUL_LIFE[values.category],
    depreciationMethod: values.depreciationMethod,
  }
}

/**
 * Düzeltme gövdesi: yalnız değişen alanlar (değişmeyen bağ sunucuda yeniden denetlenmez). Etiket
 * boşaltılamaz; boş bırakılırsa kayıttaki etiket korunur.
 */
export function fixedAssetChanges(
  values: FixedAssetFormValues,
  asset: FixedAssetDetail,
): UpdateFixedAssetBody | null {
  const next = fixedAssetBody(values)
  const changes: Record<string, unknown> = {}
  const tag = blankToNull(values.tagNumber)
  if (tag !== null && tag.toUpperCase() !== asset.tagNumber) changes.tagNumber = tag
  if (next.name !== asset.name) changes.name = next.name
  if (next.category !== asset.category) changes.category = next.category
  if (next.campusId !== asset.campusId) changes.campusId = next.campusId
  if (next.location !== asset.location) changes.location = next.location
  if (next.acquisitionValueCents !== asset.acquisitionValueCents)
    changes.acquisitionValueCents = next.acquisitionValueCents
  if (next.acquisitionDate !== asset.acquisitionDate) changes.acquisitionDate = next.acquisitionDate
  if (next.supplierId !== asset.supplierId) changes.supplierId = next.supplierId
  if (next.receiptItemId !== asset.receiptItemId) changes.receiptItemId = next.receiptItemId
  if (next.status !== asset.status) changes.status = next.status
  if (next.usefulLifeYears !== asset.usefulLifeYears) changes.usefulLifeYears = next.usefulLifeYears
  if (next.depreciationMethod !== asset.depreciationMethod)
    changes.depreciationMethod = next.depreciationMethod
  return Object.keys(changes).length === 0 ? null : (changes as UpdateFixedAssetBody)
}

export const scrapFormSchema = z.object({
  reason: scrapFixedAssetSchema.shape.reason,
  scrapDate: daySchema,
})
export type ScrapFormValues = z.input<typeof scrapFormSchema>

export const FIXED_ASSET_STATUS_VIEW: Readonly<
  Record<FixedAssetStatus, { label: string; tone: BadgeTone }>
> = {
  in_use: { label: FIXED_ASSET_STATUS_LABELS.in_use, tone: 'green' },
  in_storage: { label: FIXED_ASSET_STATUS_LABELS.in_storage, tone: 'gray' },
  broken: { label: FIXED_ASSET_STATUS_LABELS.broken, tone: 'amber' },
  scrapped: { label: FIXED_ASSET_STATUS_LABELS.scrapped, tone: 'red' },
}

const RATE = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
/** Baz puanlı yıllık oran: 2000 → "%20", 3333 → "%33,33". */
export const depreciationRateLabel = (basisPoints: number) => `%${RATE.format(basisPoints / 100)}`

/** Amortisman raporunda ileriye dönük gösterilen yıl (ön hesap). */
export const REPORT_YEARS_AHEAD = 5

/**
 * Rapor yıl seçenekleri, yeniden eskiye: kurumun en eski alım yılından bu yılın beş yıl sonrasına;
 * seçili yıl aralık dışında kalırsa o da listede durur.
 */
export function reportYears(firstYear: number | null, thisYear: number, selected: number) {
  const from = Math.min(firstYear ?? thisYear, thisYear, selected)
  const to = Math.max(thisYear + REPORT_YEARS_AHEAD, selected)
  return Array.from({ length: to - from + 1 }, (_, index) => to - index)
}
