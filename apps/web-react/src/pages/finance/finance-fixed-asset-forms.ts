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
  FIXED_ASSET_CATEGORIES,
  FIXED_ASSET_OPEN_STATUSES,
  FIXED_ASSET_STATUS_LABELS,
  FIXED_ASSET_VALUE_MAX_CENTS,
  fixedAssetSchema,
  scrapFixedAssetSchema,
  type FixedAssetStatus,
} from '@kampus/school-core/lib/finance-fixed-assets.ts'
import { amountInputValue, parseAmountInput } from '@kampus/school-core/lib/payments.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

const VALUE_MESSAGE = 'Alım değerini 1.234,56 biçiminde, sıfırdan büyük girin.'
export const parseAssetValue = (text: string) =>
  parseAmountInput(text, { maxCents: FIXED_ASSET_VALUE_MAX_CENTS })

const shape = fixedAssetSchema.shape

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
