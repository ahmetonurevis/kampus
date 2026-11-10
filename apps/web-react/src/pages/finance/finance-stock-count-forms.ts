// Stok sayımı formları ve gösterimi (DOM-FIN-081; ON-231). Okutma alanı barkod okuyucunun klavye
// gibi yazdığı kodu alır, Enter gönderir; miktar alanı boşsa 1 eklenir (K-229). Formda sayılar
// metindir; gövdeye tam sayı gider. Fark, stok ve rol kuralları sunucuda kurum kilidi altında
// denetlenir; ekran yalnız sunucunun hesapladığı raporu gösterir.
import { z } from 'zod'
import type { StockCountDetail } from '@kampus/react-shared/use-finance-stock-counts.ts'
import { STOCK_NOTE_MAX, STOCK_QUANTITY_MAX } from '@kampus/school-core/lib/finance-inventory.ts'
import {
  STOCK_COUNT_CODE_MAX,
  type StockCountStatus,
} from '@kampus/school-core/lib/finance-stock-counts.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

const WHOLE = /^\d{1,7}$/

const quantityText = (min: number, message: string) =>
  z
    .string()
    .trim()
    .regex(WHOLE, 'Miktarı tam sayı girin.')
    .refine((value) => Number(value) >= min && Number(value) <= STOCK_QUANTITY_MAX, message)

// --- Başlatma ------------------------------------------------------------------------------------

export const startCountFormSchema = z.object({
  warehouseId: z.string().min(1, 'Sayılacak depoyu seçin.'),
  note: z
    .string()
    .trim()
    .max(STOCK_NOTE_MAX, `En fazla ${String(STOCK_NOTE_MAX)} karakter girebilirsiniz.`),
})
export type StartCountFormValues = z.input<typeof startCountFormSchema>
export const startCountDefaults = (): StartCountFormValues => ({ warehouseId: '', note: '' })
export const startCountBody = (values: StartCountFormValues) => ({
  warehouseId: values.warehouseId,
  note: values.note.trim() === '' ? null : values.note.trim(),
})
export const startCountFormField = (name: string): keyof StartCountFormValues | undefined =>
  name === 'warehouseId' || name === 'note' ? name : undefined

// --- Okutma --------------------------------------------------------------------------------------

export const scanFormSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Kart kodunu okutun ya da yazın.')
    .max(STOCK_COUNT_CODE_MAX, `Kod en fazla ${String(STOCK_COUNT_CODE_MAX)} karakter olabilir.`),
  /** Boşsa 1. */
  quantity: z
    .string()
    .trim()
    .refine(
      (value) =>
        value === '' ||
        (WHOLE.test(value) && Number(value) >= 1 && Number(value) <= STOCK_QUANTITY_MAX),
      'Eklenecek miktar 1 ya da daha büyük bir tam sayı olmalıdır.',
    ),
})
export type ScanFormValues = z.input<typeof scanFormSchema>
export const scanDefaults = (): ScanFormValues => ({ code: '', quantity: '1' })
/** Okutma gövdesi: kod büyük harfe sunucuda çevrilir; boş miktar 1'dir. */
export const scanBody = (values: ScanFormValues) => ({
  code: values.code.trim(),
  quantity: values.quantity.trim() === '' ? 1 : Number(values.quantity.trim()),
})

// --- Elle miktar ---------------------------------------------------------------------------------

export const quantityFormSchema = z.object({
  countedQuantity: quantityText(0, 'Sayılan miktar 0 ya da daha büyük bir tam sayı olmalıdır.'),
})
export type QuantityFormValues = z.input<typeof quantityFormSchema>
export const quantityDefaults = (current: number | null): QuantityFormValues => ({
  countedQuantity: current === null ? '' : String(current),
})

// --- Gösterim ------------------------------------------------------------------------------------

export const COUNT_STATUS_TONE = {
  open: 'amber',
  completed: 'green',
  cancelled: 'gray',
} as const satisfies Record<StockCountStatus, BadgeTone>

/** İşaretli fark: `+2`, `−3`, `0`. */
export const signedDifference = (value: number) =>
  value > 0 ? `+${String(value)}` : value < 0 ? `−${String(-value)}` : '0'

export const differenceTone = (value: number): BadgeTone =>
  value > 0 ? 'green' : value < 0 ? 'red' : 'gray'

/** Sayım sırasında depoda hareket olan sayılan kalem var mı (K-231 açıklaması gösterilir). */
export const hasMovementsDuringCount = (count: Pick<StockCountDetail, 'counted'>) =>
  count.counted.some((row) => row.movementQuantity !== 0)

/** CSV dosya adı: depo adı ve sayımın başlangıç günü (Europe/Istanbul). */
export const stockCountCsvFilename = (
  count: Pick<StockCountDetail, 'warehouseName' | 'startedAt'>,
) => `stok-sayimi-${count.warehouseName}-${dayKey(count.startedAt)}.csv`

/** CSV için kart bilgileri: sayılan ve sayılmayan satırlardan. */
export const stockCountCsvItems = (count: Pick<StockCountDetail, 'counted' | 'uncounted'>) =>
  new Map(
    [...count.counted, ...count.uncounted].map((row) => [
      row.itemId,
      { code: row.itemCode, name: row.itemName, unit: row.unit },
    ]),
  )

/** Tamamlama onayı özeti: kaç fazla, kaç eksik düzeltmesi yazılacak. */
export function completionSummary(count: Pick<StockCountDetail, 'counted' | 'uncounted'>) {
  const surplus = count.counted.filter((row) => row.difference > 0).length
  const shortage = count.counted.filter((row) => row.difference < 0).length
  const parts = [
    surplus === 0 && shortage === 0
      ? 'Sayılan kalemlerde fark yok; düzeltme hareketi yazılmayacak.'
      : `${String(surplus)} kalem için fazla, ${String(shortage)} kalem için eksik düzeltmesi yazılacak.`,
  ]
  if (count.uncounted.length > 0)
    parts.push(`${String(count.uncounted.length)} sayılmayan kalem değişmeyecek.`)
  return parts.join(' ')
}
