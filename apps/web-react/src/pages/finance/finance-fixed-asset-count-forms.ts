import { z } from 'zod'
import type {
  FixedAssetCount,
  FixedAssetScan,
  ScanFixedAssetCountBody,
  StartFixedAssetCountBody,
} from '@kampus/react-shared/use-finance-fixed-asset-counts.ts'
import {
  FIXED_ASSET_COUNT_NOTE_MAX,
  FIXED_ASSET_COUNT_SCOPE_TYPES,
  fixedAssetCountOutcome,
  type FixedAssetCountItemResult,
  type FixedAssetCountOutcome,
  type FixedAssetCountScopeType,
  type FixedAssetCountStatus,
} from '@kampus/school-core/lib/finance-fixed-asset-counts.ts'
import { FIXED_ASSET_LOCATION_MAX } from '@kampus/school-core/lib/finance-fixed-assets.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

// Demirbaş sayımı form modeli (DOM-FIN-087; ON-237): başlatma ve okutma formlarının şeması ve
// gövdesi, okutma geri bildirimi ve rozet tonları. Sunucu aynı kuralları core şemasıyla yeniden
// denetler; burada yalnız formun anında gösterdiği alan hataları vardır.

const LOCATION_MESSAGE = 'Konumu en az 2 karakterle yazın (ör. 2. kat fen laboratuvarı).'
const SCAN_LOCATION_MESSAGE = 'Sayım yaptığınız odayı ya da yeri yazın.'

export const countFormSchema = z
  .object({
    scopeType: z.enum(FIXED_ASSET_COUNT_SCOPE_TYPES, 'Sayım kapsamını seçin.'),
    campusId: z.string(),
    location: z.string().max(FIXED_ASSET_LOCATION_MAX, 'Konum çok uzun.'),
    note: z
      .string()
      .max(
        FIXED_ASSET_COUNT_NOTE_MAX,
        `En fazla ${String(FIXED_ASSET_COUNT_NOTE_MAX)} karakter girebilirsiniz.`,
      ),
  })
  .superRefine((value, context) => {
    if (value.scopeType === 'campus' && value.campusId === '')
      context.addIssue({ code: 'custom', path: ['campusId'], message: 'Kampüs seçin.' })
    if (value.scopeType === 'location' && value.location.trim().length < 2)
      context.addIssue({ code: 'custom', path: ['location'], message: LOCATION_MESSAGE })
  })
export type CountFormValues = z.infer<typeof countFormSchema>

export const COUNT_FORM_DEFAULTS: CountFormValues = {
  scopeType: 'location',
  campusId: '',
  location: '',
  note: '',
}

/** Başlatma gövdesi: kapsamın gerektirmediği alan gönderilmez (sunucu katı şema kullanır). */
export function countBody(values: CountFormValues): StartFixedAssetCountBody {
  const note = values.note.trim() === '' ? null : values.note.trim()
  if (values.scopeType === 'institution') return { scopeType: 'institution', note }
  if (values.scopeType === 'campus') return { scopeType: 'campus', campusId: values.campusId, note }
  return {
    scopeType: 'location',
    campusId: values.campusId === '' ? null : values.campusId,
    location: values.location.trim(),
    note,
  }
}

/** Okutma formu: kod her okutmada boşalır; sayılan yer (kurum ve kampüs sayımında) kalır. */
export function scanFormSchema(scopeType: FixedAssetCountScopeType) {
  return z
    .object({
      code: z.string().trim().min(1, 'Demirbaş kodunu okutun ya da yazın.'),
      campusId: z.string(),
      location: z.string().max(FIXED_ASSET_LOCATION_MAX, 'Konum çok uzun.'),
    })
    .superRefine((value, context) => {
      if (scopeType !== 'location' && value.location.trim().length < 2)
        context.addIssue({ code: 'custom', path: ['location'], message: SCAN_LOCATION_MESSAGE })
    })
}
export type ScanFormValues = z.infer<ReturnType<typeof scanFormSchema>>

export function scanBody(
  scopeType: FixedAssetCountScopeType,
  values: ScanFormValues,
): ScanFixedAssetCountBody {
  if (scopeType === 'location') return { code: values.code }
  return {
    code: values.code,
    ...(scopeType === 'institution' && values.campusId !== '' ? { campusId: values.campusId } : {}),
    location: values.location.trim(),
  }
}

/** Sunucu hata yolunun formdaki alanı (okutma); bilinmeyen yol kod alanına düşer. */
export function scanFormField(path: string | undefined): keyof ScanFormValues {
  return path === 'location' || path === 'campusId' ? path : 'code'
}

export const COUNT_OUTCOME_TONES = {
  found: 'green',
  misplaced: 'amber',
  missing: 'red',
  pending: 'gray',
} as const satisfies Record<FixedAssetCountOutcome, BadgeTone>

export const COUNT_STATUS_TONES = {
  open: 'purple',
  completed: 'green',
  cancelled: 'gray',
} as const satisfies Record<FixedAssetCountStatus, BadgeTone>

const placeText = (campusName: string | null, location: string | null) =>
  location === null ? '' : campusName ? `${campusName} · ${location}` : location

/** Okutmanın tek satırlık geri bildirimi (ekran okuyucu da aynı metni duyurur). */
export function scanFeedback(scan: FixedAssetScan): { text: string; tone: BadgeTone } {
  const { item } = scan
  const name = `${item.tagNumber} · ${item.assetName}`
  if (scan.outcome === 'already_counted')
    return { text: `${name}: daha önce okutuldu, değişmedi.`, tone: 'gray' }
  const extra = item.inScope ? '' : ' Bu demirbaş sayım listesinde yoktu.'
  if (scan.outcome === 'found') return { text: `${name}: bulundu.${extra}`, tone: 'green' }
  return {
    text: `${name}: yanlış konumda. Kayıtlı yer: ${placeText(item.recordedCampusName, item.recordedLocation)}.${extra}`,
    tone: 'amber',
  }
}

/** Satır süzgeci seçenekleri: tamamlanmış sayımda okunmayanlar "Bulunamadı" adını alır. */
export function itemFilterOptions(status: FixedAssetCountStatus) {
  const pending: FixedAssetCountItemResult = 'pending'
  return [
    { value: '', label: 'Tümü' },
    { value: pending, label: status === 'completed' ? 'Bulunamadı' : 'Okunmadı' },
    { value: 'found', label: 'Bulundu' },
    { value: 'misplaced', label: 'Yanlış konumda' },
  ] as const
}

export const itemOutcome = (
  item: { result: FixedAssetCountItemResult },
  count: Pick<FixedAssetCount, 'status'>,
) => fixedAssetCountOutcome(item.result, count.status)
