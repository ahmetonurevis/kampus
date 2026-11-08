import { z } from 'zod'

import { PURCHASE_ORDER_STATUSES } from '@kampus/school-core/lib/finance-purchase-orders.ts'
import { PURCHASE_UNITS } from '@kampus/school-core/lib/finance-purchase-requests.ts'

import { dataResponse } from './common.schemas.ts'

/** Mal kabul şemaları (DOM-FIN-074; ON-226). */

const cents = (description: string) => z.number().int().describe(description)
const version = z.number().int().describe('`If-Match` için kayıt sürümü')
const count = (description: string) => z.number().int().describe(description)

const receiptBoardSchema = z.object({
  order: z
    .object({
      id: z.string(),
      number: z.string(),
      status: z.enum(PURCHASE_ORDER_STATUSES),
      version,
    })
    .describe('Sipariş; durum kabul edilen toplamdan türetilir (K-150)'),
  items: z
    .array(
      z.object({
        id: z.string(),
        position: z.number().int(),
        name: z.string(),
        unit: z.enum(PURCHASE_UNITS),
        quantity: count('Sipariş miktarı'),
        unitPriceCents: cents('KDV hariç birim fiyat, kuruş'),
        acceptedQuantity: count('İptal edilmemiş kabullerde kabul edilen toplam'),
        rejectedQuantity: count(
          'İptal edilmemiş kabullerde reddedilen toplam; karşılanmış sayılmaz',
        ),
        remainingQuantity: count('Sipariş miktarı eksi kabul edilen'),
      }),
    )
    .describe('Sipariş kalemleri ve teslim durumu'),
  receivedNetCents: cents(
    'Gerçekleşen: iptal edilmemiş kabullerde kabul edilen miktar × birim fiyat, KDV hariç (K-151)',
  ),
  receipts: z
    .array(
      z.object({
        id: z.string(),
        receiptDate: z.string().describe('Kabul günü `YYYY-MM-DD`'),
        warehouseId: z
          .string()
          .nullable()
          .describe('Stok girişinin yapıldığı depo; stok kartı seçilmediyse boş (K-184)'),
        warehouseName: z.string().nullable(),
        receivedBy: z.string().describe('Teslim alan personel (K-152)'),
        inspectionNote: z.string().nullable(),
        netCents: cents('Kabul edilen kısmın KDV hariç tutarı'),
        lines: z.array(
          z.object({
            orderItemId: z.string(),
            name: z.string(),
            unit: z.enum(PURCHASE_UNITS),
            acceptedQuantity: count('Kabul edilen miktar'),
            rejectedQuantity: count('Reddedilen miktar'),
            rejectReason: z.string().nullable(),
            stockItemId: z
              .string()
              .nullable()
              .describe('Kabul edilen miktarın girdiği stok kartı (DOM-FIN-078, K-184)'),
            stockItemName: z.string().nullable(),
          }),
        ),
        createdAt: z.string(),
        createdByName: z.string().nullable(),
        cancelledAt: z.string().nullable(),
        cancelledByName: z.string().nullable(),
        cancelReason: z.string().nullable(),
        actions: z
          .object({ cancel: z.boolean() })
          .describe('Oturumdaki kullanıcı bu kabulü iptal edebilir mi (K-153)'),
        version,
      }),
    )
    .describe('Kabul geçmişi (iptal edilenler dahil), kabul günü sırasıyla'),
  actions: z
    .object({ receive: z.boolean() })
    .describe('Oturumdaki kullanıcı yeni kabul kaydedebilir mi'),
})
export const purchaseReceiptBoardResponse = dataResponse(receiptBoardSchema)

export const purchaseReceiptOrderParams = z.object({ orderId: z.uuid('Sipariş geçersiz.') })
export const purchaseReceiptParams = z.object({
  orderId: z.uuid('Sipariş geçersiz.'),
  receiptId: z.uuid('Kabul geçersiz.'),
})
