import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import { STOCK_UNITS } from '@kampus/school-core/lib/finance-inventory.ts'
import { STOCK_COUNT_STATUSES } from '@kampus/school-core/lib/finance-stock-counts.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Stok sayımı şemaları (DOM-FIN-081; ON-231). */

const version = z.number().int().describe('`If-Match` için kayıt sürümü')
const quantity = (description: string) => z.number().int().describe(description)
const cents = (description: string) => z.number().int().nullable().describe(description)

const itemFields = {
  itemId: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  unit: z.enum(STOCK_UNITS),
}

const stockCountRowSchema = z.object({
  id: z.string(),
  warehouseId: z.string(),
  warehouseName: z.string(),
  campusName: z.string().nullable(),
  status: z.enum(STOCK_COUNT_STATUSES),
  note: z.string().nullable(),
  startedAt: z.string(),
  startedByName: z.string().nullable(),
  completedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  lineCount: quantity('Satır sayısı: anlık görüntüdeki ve sonradan sayılan kartlar'),
  countedCount: quantity('Sayılan satır sayısı'),
  adjustmentCount: quantity('Tamamlamada yazılan düzeltme hareketi sayısı'),
  version,
})
export const stockCountListResponse = z.object({
  data: z.array(stockCountRowSchema),
  meta: pageMetaSchema,
})
export const stockCountListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  status: z.enum(STOCK_COUNT_STATUSES).optional().describe('Durum'),
  warehouseId: z.uuid('Depo geçersiz.').optional().describe('Depo'),
})

const countedRowSchema = z.object({
  ...itemFields,
  systemQuantity: quantity('Anlık görüntü: sayım başladığında depodaki miktar'),
  movementQuantity: quantity(
    'Sayım başladıktan sonra, kart sayılana kadar kaydedilen hareketlerin net etkisi (K-231)',
  ),
  expectedQuantity: quantity('Beklenen: anlık görüntü + sayım sırasındaki hareket'),
  countedQuantity: quantity('Sayılan miktar'),
  difference: quantity('Sayılan − beklenen; artı fazla, eksi eksik'),
  unitCostCents: cents(
    'Birim maliyet: son alış fiyatı (K-202), KDV hariç, kuruş; tamamlanan sayımda saklanan değer. Yoksa boş',
  ),
  differenceCents: cents('Fark × birim maliyet, kuruş; birim maliyet yoksa boş'),
  countedAt: z.string().describe('Satırın son sayıldığı an'),
  movementId: z.string().nullable().describe('Tamamlamada farkı yazan düzeltme hareketi'),
})

const stockCountDetailSchema = z.object({
  id: z.string(),
  warehouseId: z.string(),
  warehouseName: z.string(),
  campusName: z.string().nullable(),
  status: z.enum(STOCK_COUNT_STATUSES),
  note: z.string().nullable(),
  startedAt: z.string(),
  startedByName: z.string().nullable(),
  completedAt: z.string().nullable(),
  completedByName: z.string().nullable(),
  adjustmentDate: daySchema.nullable().describe('Düzeltme hareketlerinin günü (tamamlama günü)'),
  cancelledAt: z.string().nullable(),
  cancelledByName: z.string().nullable(),
  cancelReason: z.string().nullable(),
  counted: z.array(countedRowSchema).describe('Sayılan kalemler, koda göre'),
  uncounted: z
    .array(z.object({ ...itemFields, systemQuantity: quantity('Anlık görüntüdeki miktar') }))
    .describe('Anlık görüntüde miktarı olup sayılmayan kalemler; değişmez (K-230)'),
  totals: z.object({
    countedItems: quantity('Sayılan kalem'),
    uncountedItems: quantity('Sayılmayan kalem'),
    differenceItems: quantity('Farkı olan kalem'),
    surplusCents: quantity('Fazla tutarı (birim maliyeti bilinenler), kuruş'),
    shortageCents: quantity('Eksik tutarı (birim maliyeti bilinenler), kuruş, artı'),
    netCents: quantity('Fazla − eksik tutarı, kuruş'),
    unpricedDifferenceItems: quantity('Farkı olup birim maliyeti bilinmeyen kalem'),
  }),
  actions: z
    .object({ count: z.boolean(), complete: z.boolean(), cancel: z.boolean() })
    .describe('Oturumdaki kullanıcının bu sayımda yapabilecekleri (K-228)'),
  version,
})
export const stockCountResponse = dataResponse(stockCountDetailSchema)
export const stockCountParams = z.object({ countId: z.uuid('Sayım geçersiz.') })
export const stockCountLineResponse = dataResponse(
  z.object({
    countId: z.string(),
    ...itemFields,
    systemQuantity: quantity('Anlık görüntüdeki miktar (sonradan sayılan kartta 0)'),
    countedQuantity: z.number().int().nullable().describe('Sayılan miktar; boşsa sayılmadı'),
    countedAt: z.string().nullable(),
  }),
)
export const completeStockCountBody = z.strictObject({})
