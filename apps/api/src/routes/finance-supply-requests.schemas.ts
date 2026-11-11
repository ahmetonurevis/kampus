import { z } from 'zod'

import { STOCK_CATEGORIES, STOCK_UNITS } from '@kampus/school-core/lib/finance-inventory.ts'
import { PURCHASE_REQUEST_STATUSES } from '@kampus/school-core/lib/finance-purchase-requests.ts'
import { SUPPLY_REQUEST_STATUSES } from '@kampus/school-core/lib/finance-supply-requests.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Sarf malzeme talebi şemaları (DOM-FIN-091; ON-233). */

const version = z.number().int().describe('`If-Match` için kayıt sürümü')

const summaryShape = {
  id: z.string(),
  number: z.string().describe('Kurum içi talep numarası, ör. `SM-0001`'),
  status: z.enum(SUPPLY_REQUEST_STATUSES),
  requestedByUserId: z.string(),
  requestedByName: z.string().nullable().describe('Talep eden personel'),
  neededDate: z.string().describe('İstenen gün (`YYYY-MM-DD`)'),
  justification: z.string(),
  itemCount: z.number().int(),
  itemSummary: z.array(z.string()).describe('Kalemlerin stok kartı adları, sırayla'),
  fullyFulfilled: z.boolean().describe('Bütün kalemler istenen miktarda karşılandı mı'),
  purchaseRequest: z
    .object({
      id: z.string(),
      number: z.string().describe('Satın alma talebi numarası, ör. `ST-0001`'),
      status: z.enum(PURCHASE_REQUEST_STATUSES),
    })
    .nullable()
    .describe('Kalanın dönüştürüldüğü satın alma talebi (K-246); yoksa boş'),
  createdAt: z.string(),
  version,
}

export const supplyRequestListResponse = z.object({
  data: z.array(z.object(summaryShape)),
  meta: pageMetaSchema,
})

const detailSchema = z.object({
  ...summaryShape,
  items: z.array(
    z.object({
      id: z.string().describe('Talep kalemi; karşılama ve dönüştürme gövdesinde `itemId`'),
      position: z.number().int(),
      stockItem: z.object({
        id: z.string(),
        code: z.string(),
        name: z.string(),
        isActive: z.boolean(),
      }),
      unit: z.enum(STOCK_UNITS),
      quantity: z.number().int().describe('İstenen miktar'),
      fulfilledQuantity: z.number().int().describe('Karşılanan miktar (supply çıkışları)'),
      remainingQuantity: z.number().int().describe('Kalan miktar'),
      stock: z
        .array(
          z.object({
            warehouseId: z.string(),
            warehouseName: z.string(),
            quantity: z.number().int(),
          }),
        )
        .nullable()
        .describe('Etkin depolardaki güncel miktar; yalnız yönetici ve ön büroya, diğerine boş'),
      lastPriceCents: z
        .number()
        .int()
        .nullable()
        .describe(
          'Son alış fiyatı, KDV hariç kuruş (K-202); dönüştürme formunun önerisi. Yalnız yönetici ve ön büroya',
        ),
    }),
  ),
  issues: z
    .array(
      z.object({
        movementId: z.string(),
        itemId: z.string(),
        itemName: z.string(),
        warehouseName: z.string(),
        quantity: z.number().int(),
        movementDate: z.string(),
        createdByName: z.string().nullable(),
        createdAt: z.string(),
        cancelled: z.boolean(),
      }),
    )
    .describe('Karşılama geçmişi (supply stok çıkışları)'),
  decidedAt: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decisionNote: z.string().nullable().describe('Onay notu ya da ret gerekçesi'),
  fulfilledAt: z.string().nullable(),
  fulfilledByName: z.string().nullable(),
  fulfillmentNote: z.string().nullable().describe('Kısmi kapatma açıklaması'),
  cancelledAt: z.string().nullable(),
  cancelledByName: z.string().nullable(),
  cancelReason: z.string().nullable(),
  actions: z
    .object({
      cancel: z.boolean(),
      decide: z.boolean(),
      fulfill: z.boolean(),
      convert: z.boolean(),
    })
    .describe('Oturumdaki kullanıcının bu talepte yapabileceği işlemler'),
})
export const supplyRequestResponse = dataResponse(detailSchema)

export const supplyRequestParams = z.object({ requestId: z.uuid('Talep geçersiz.') })

export const supplyRequestListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .describe('Talep numarasında (`SM-0001`), gerekçede, talep edenin adında ya da kalemde arama'),
  status: z.enum(SUPPLY_REQUEST_STATUSES).optional().describe('Durum'),
  stockItemId: z.uuid('Stok kartı geçersiz.').optional().describe('Bu kartı içeren talepler'),
  mine: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional()
    .describe('Yalnız kendi taleplerim (yönetici ve ön büro için; diğer roller her zaman kendi)'),
})

export const supplyStockCardQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Kod ya da adda arama'),
})
export const supplyStockCardResponse = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      name: z.string(),
      category: z.enum(STOCK_CATEGORIES),
      unit: z.enum(STOCK_UNITS),
    }),
  ),
  meta: pageMetaSchema,
})
