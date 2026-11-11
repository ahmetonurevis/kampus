// Kimyasal bilgisi formu ve kimyasal envanter gösterimi (DOM-FIN-090; ON-234; K-240…K-243). Alan
// kuralları core şemasıyla aynıdır (CAS sağlama basamağı, https GBF bağlantısı); formda metinler
// boş dize, gövdede boş değer `null`.
import { z } from 'zod'
import type {
  ChemicalLotRow,
  CreateChemicalProfileBody,
} from '@kampus/react-shared/use-finance-chemicals.ts'
import type { StockItemDetail } from '@kampus/react-shared/use-finance-inventory.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  CHEMICAL_EXPIRY_STATUS_LABELS,
  CHEMICAL_NOTE_MAX,
  CHEMICAL_SDS_NUMBER_MAX,
  CHEMICAL_SDS_URL_MAX,
  CHEMICAL_SIGNAL_WORD_LABELS,
  CHEMICAL_SIGNAL_WORDS,
  CHEMICAL_STORAGE_CLASS_MAX,
  GHS_PICTOGRAM_LABELS,
  GHS_PICTOGRAMS,
  isValidCasNumber,
  type ChemicalExpiryStatus,
  type ChemicalSignalWord,
  type GhsPictogram,
} from '@kampus/school-core/lib/finance-chemicals.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `En fazla ${String(max)} karakter girebilirsiniz.`)

const isHttps = (value: string) => {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    // Ayrıştırılamayan metin adres değildir; alan hatası şemadan döner.
    return false
  }
}

export const chemicalProfileFormSchema = z.object({
  hazardPictograms: z.array(z.enum(GHS_PICTOGRAMS)),
  signalWord: z.union([z.literal(''), z.enum(CHEMICAL_SIGNAL_WORDS)]),
  casNumber: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || /^\d{2,7}-\d{2}-\d$/.test(value),
      'CAS numarasını 7732-18-5 biçiminde yazın.',
    )
    .refine(
      (value) => value === '' || !/^\d{2,7}-\d{2}-\d$/.test(value) || isValidCasNumber(value),
      'CAS numarasının sağlama basamağı tutmuyor; numarayı kontrol edin.',
    ),
  storageClass: text(CHEMICAL_STORAGE_CLASS_MAX),
  incompatibilityNote: text(CHEMICAL_NOTE_MAX),
  sdsUrl: text(CHEMICAL_SDS_URL_MAX).refine(
    (value) => value === '' || isHttps(value),
    'GBF bağlantısı https:// ile başlayan geçerli bir adres olmalıdır.',
  ),
  sdsDocumentNumber: text(CHEMICAL_SDS_NUMBER_MAX),
  sdsRevisionDate: z.union([z.literal(''), daySchema]),
})
export type ChemicalProfileFormValues = z.input<typeof chemicalProfileFormSchema>

type Profile = NonNullable<StockItemDetail['chemical']>

export const chemicalProfileDefaults = (profile?: Profile | null): ChemicalProfileFormValues => ({
  hazardPictograms: profile?.hazardPictograms ?? [],
  signalWord: profile?.signalWord ?? '',
  casNumber: profile?.casNumber ?? '',
  storageClass: profile?.storageClass ?? '',
  incompatibilityNote: profile?.incompatibilityNote ?? '',
  sdsUrl: profile?.sdsUrl ?? '',
  sdsDocumentNumber: profile?.sdsDocumentNumber ?? '',
  sdsRevisionDate: profile?.sdsRevisionDate ?? '',
})

const orNull = (value: string) => (value.trim() === '' ? null : value.trim())

/** Form değerinden gövde; düzeltmede de bütün alanlar gider (kısmi uç bütünü kabul eder). */
export function chemicalProfileBody(values: ChemicalProfileFormValues): CreateChemicalProfileBody {
  return {
    hazardPictograms: GHS_PICTOGRAMS.filter((code) => values.hazardPictograms.includes(code)),
    signalWord: values.signalWord === '' ? null : values.signalWord,
    casNumber: orNull(values.casNumber),
    storageClass: orNull(values.storageClass),
    incompatibilityNote: orNull(values.incompatibilityNote),
    sdsUrl: orNull(values.sdsUrl),
    sdsDocumentNumber: orNull(values.sdsDocumentNumber),
    sdsRevisionDate: values.sdsRevisionDate === '' ? null : values.sdsRevisionDate,
  }
}

const PROFILE_FIELDS = [
  'hazardPictograms',
  'signalWord',
  'casNumber',
  'storageClass',
  'incompatibilityNote',
  'sdsUrl',
  'sdsDocumentNumber',
  'sdsRevisionDate',
] as const
/** Sunucu alan yolu form alanına; piktogram dizisinin öğe hatası listenin kendisine düşer. */
export const chemicalProfileFormField = (name: string) => {
  const root = name.split('.')[0]
  return PROFILE_FIELDS.find((field) => field === root)
}

// --- Gösterim ------------------------------------------------------------------------------------

export const PICTOGRAM_OPTIONS = GHS_PICTOGRAMS.map((code) => ({
  value: code,
  label: `${code} · ${GHS_PICTOGRAM_LABELS[code]}`,
}))
export const SIGNAL_WORD_OPTIONS = CHEMICAL_SIGNAL_WORDS.map((value) => ({
  value,
  label: CHEMICAL_SIGNAL_WORD_LABELS[value],
}))

/** Piktogramlar adlarıyla: "GHS05 Aşındırıcı · GHS07 Zararlı, tahriş edici"; yoksa tire. */
export const pictogramNames = (codes: readonly GhsPictogram[]) =>
  codes.length === 0
    ? '—'
    : codes.map((code) => `${code} ${GHS_PICTOGRAM_LABELS[code]}`).join(' · ')

export const signalWordText = (word: ChemicalSignalWord | null) =>
  word === null ? '—' : CHEMICAL_SIGNAL_WORD_LABELS[word]

export const EXPIRY_TONE = {
  expired: 'red',
  expiring: 'amber',
  ok: 'green',
  unknown: 'gray',
} as const satisfies Record<ChemicalExpiryStatus, BadgeTone>

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/**
 * Son kullanma metni: "31.01.2027", "20.10.2026 · 14 gün kaldı", "Bugün son gün",
 * "05.10.2026 · 1 gün geçti"; parti bilgisi yoksa "Parti bilgisi yok".
 */
export function expiryText(
  lot: Pick<ChemicalLotRow, 'expiryDate' | 'status' | 'daysLeft'>,
): string {
  if (lot.expiryDate === null || lot.daysLeft === null) return CHEMICAL_EXPIRY_STATUS_LABELS.unknown
  const day = dayText(lot.expiryDate)
  if (lot.status === 'expired') return `${day} · ${String(-lot.daysLeft)} gün geçti`
  if (lot.status === 'expiring')
    return lot.daysLeft === 0
      ? `${day} · bugün son gün`
      : `${day} · ${String(lot.daysLeft)} gün kaldı`
  return day
}

/** Parti adı: numara ya da "Parti bilgisi yok". */
export const lotText = (lot: Pick<ChemicalLotRow, 'lotNumber'>) =>
  lot.lotNumber ?? CHEMICAL_EXPIRY_STATUS_LABELS.unknown
