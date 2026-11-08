// Mal kabul formu (DOM-FIN-074; ON-226). Alan kuralları core şemasından: kabul günü, teslim alan,
// muayene notu ve kalanı olan her sipariş kalemi için kabul ve ret miktarı. Formda miktar metindir,
// boş sıfır sayılır; gövdeye yalnız miktar girilen kalemler gider. Kalanı aşma sunucuda kurum kilidi
// altında yeniden denetlenir (K-150). Kaleme stok kartı seçilirse kabul edilen miktar seçilen depoya
// girer (DOM-FIN-078, K-184); kart boşsa kalem yalnız kabul edilir.
import { z } from 'zod'
import type {
  CreatePurchaseReceiptBody,
  PurchaseReceiptBoard,
} from '@kampus/react-shared/use-finance-purchase-receipts.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  RECEIPT_NOTE_MAX,
  RECEIPT_RECEIVED_BY_MAX,
  RECEIPT_RECEIVED_BY_MIN,
  RECEIPT_REJECT_REASON_MAX,
  RECEIPT_REJECT_REASON_MIN,
} from '@kampus/school-core/lib/finance-purchase-receipts.ts'

const QUANTITY = /^\d{0,7}$/
const count = (text: string) => (text.trim() === '' ? 0 : Number(text.trim()))

/** Form satırı; `remaining` gösterim ve denetim içindir, gövdeye gitmez. */
const lineSchema = z.object({
  orderItemId: z.string(),
  remaining: z.number(),
  accepted: z.string().trim().regex(QUANTITY, 'Miktarı tam sayı girin.'),
  rejected: z.string().trim().regex(QUANTITY, 'Miktarı tam sayı girin.'),
  rejectReason: z
    .string()
    .trim()
    .max(RECEIPT_REJECT_REASON_MAX, `En fazla ${String(RECEIPT_REJECT_REASON_MAX)} karakter.`),
  stockItemId: z.string(),
})

export const receiptFormSchema = z
  .object({
    receiptDate: daySchema,
    receivedBy: z
      .string()
      .trim()
      .min(RECEIPT_RECEIVED_BY_MIN, 'Teslim alan personeli yazın.')
      .max(
        RECEIPT_RECEIVED_BY_MAX,
        `En fazla ${String(RECEIPT_RECEIVED_BY_MAX)} karakter girebilirsiniz.`,
      ),
    inspectionNote: z
      .string()
      .trim()
      .max(RECEIPT_NOTE_MAX, `En fazla ${String(RECEIPT_NOTE_MAX)} karakter girebilirsiniz.`),
    warehouseId: z.string(),
    lines: z.array(lineSchema),
  })
  .superRefine((values, ctx) => {
    let entered = false
    values.lines.forEach((line, index) => {
      if (!QUANTITY.test(line.accepted) || !QUANTITY.test(line.rejected)) return
      const accepted = count(line.accepted)
      const rejected = count(line.rejected)
      if (accepted + rejected > 0) entered = true
      if (accepted > line.remaining)
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index, 'accepted'],
          message: `Kabul edilen miktar kalanı aşamaz (kalan ${String(line.remaining)}).`,
        })
      if (rejected > 0 && line.rejectReason.length < RECEIPT_REJECT_REASON_MIN)
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index, 'rejectReason'],
          message: 'Reddedilen miktar için nedeni en az 3 karakterle yazın.',
        })
    })
    if (values.warehouseId === '' && values.lines.some((line) => line.stockItemId !== ''))
      ctx.addIssue({
        code: 'custom',
        path: ['warehouseId'],
        message: 'Stok girişi için depoyu seçin.',
      })
    if (!entered)
      ctx.addIssue({
        code: 'custom',
        path: ['root', 'server'],
        message: 'En az bir kalem için kabul edilen ya da reddedilen miktarı girin.',
      })
  })
export type ReceiptFormValues = z.input<typeof receiptFormSchema>

/** Başlangıç: bugün, kalanı olan her kalem için boş miktar. */
export function receiptDefaults(
  board: Pick<PurchaseReceiptBoard, 'items'>,
  today: string,
): ReceiptFormValues {
  return {
    receiptDate: today,
    receivedBy: '',
    inspectionNote: '',
    warehouseId: '',
    lines: board.items
      .filter((item) => item.remainingQuantity > 0)
      .map((item) => ({
        orderItemId: item.id,
        remaining: item.remainingQuantity,
        accepted: '',
        rejected: '',
        rejectReason: '',
        stockItemId: '',
      })),
  }
}

/** Gövde ve gövde satırının form satırı karşılığı (sunucu alan yolunu forma çevirmek için). */
export function receiptBody(values: ReceiptFormValues): {
  body: CreatePurchaseReceiptBody
  formIndexes: number[]
} {
  const formIndexes: number[] = []
  const lines = values.lines.flatMap((line, index) => {
    const accepted = count(line.accepted)
    const rejected = count(line.rejected)
    if (accepted + rejected === 0) return []
    formIndexes.push(index)
    const reason = line.rejectReason.trim()
    return [
      {
        orderItemId: line.orderItemId,
        acceptedQuantity: accepted,
        rejectedQuantity: rejected,
        rejectReason: rejected > 0 && reason !== '' ? reason : null,
        stockItemId: line.stockItemId === '' ? null : line.stockItemId,
      },
    ]
  })
  const note = values.inspectionNote.trim()
  return {
    body: {
      receiptDate: values.receiptDate,
      receivedBy: values.receivedBy.trim(),
      inspectionNote: note === '' ? null : note,
      warehouseId: values.warehouseId === '' ? null : values.warehouseId,
      lines,
    },
    formIndexes,
  }
}

type ReceiptField =
  | 'receiptDate'
  | 'receivedBy'
  | 'inspectionNote'
  | 'warehouseId'
  | `lines.${number}.${'accepted' | 'rejected' | 'rejectReason' | 'stockItemId'}`

/** Sunucu alan yolu (`lines.0.acceptedQuantity`) form alanına çevrilir; bilinmeyen yol `undefined`. */
export function receiptFormField(
  name: string,
  formIndexes: readonly number[],
): ReceiptField | undefined {
  if (
    name === 'receiptDate' ||
    name === 'receivedBy' ||
    name === 'inspectionNote' ||
    name === 'warehouseId'
  )
    return name
  const line =
    /^lines\.(\d+)\.(acceptedQuantity|rejectedQuantity|rejectReason|orderItemId|stockItemId)$/.exec(
      name,
    )
  const index = line === null ? undefined : formIndexes[Number(line[1])]
  if (line === null || index === undefined) return undefined
  const field =
    line[2] === 'rejectedQuantity'
      ? 'rejected'
      : line[2] === 'rejectReason'
        ? 'rejectReason'
        : line[2] === 'stockItemId'
          ? 'stockItemId'
          : 'accepted'
  return `lines.${index}.${field}`
}
