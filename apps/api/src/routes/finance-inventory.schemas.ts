import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  STOCK_CATEGORIES,
  STOCK_ENTRY_REASONS,
  STOCK_ISSUE_REASONS,
  STOCK_MOVEMENT_TYPES,
  STOCK_UNITS,
} from '@kampus/school-core/lib/finance-inventory.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Stok kartı, depo ve hareket şemaları (DOM-FIN-077, DOM-FIN-078; ON-228, ON-229). */

const version = z.number().int().describe('`If-Match` için kayıt sürümü')
const quantity = (description: string) => z.number().int().describe(description)
const status = z
  .enum(['active', 'inactive'])
  .optional()
  .describe('`active` etkin, `inactive` pasif kayıtlar')
const search = z
  .string()
  .trim()
  .min(2)
  .max(100)
  .optional()
  .describe('Kodda ve adda arama, Türkçe harf duyarsız')

const stockItemRowSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  category: z.enum(STOCK_CATEGORIES),
  unit: z.enum(STOCK_UNITS),
  minQuantity: z.number().int().nullable().describe('Kritik seviye; boşsa yok'),
  isActive: z.boolean(),
  quantity: quantity('Hareketlerden türetilen miktar (süzgeçte depo varsa yalnız o depo)'),
  isBelowMinimum: z.boolean().describe('Miktar kritik seviyeye eşit ya da altında (K-182)'),
  version,
})
export const stockItemListResponse = z.object({
  data: z.array(stockItemRowSchema),
  meta: pageMetaSchema,
})
const stockItemDetailSchema = stockItemRowSchema.extend({
  hasMovements: z.boolean().describe('Hareketi varsa birim değişmez (K-182)'),
  balances: z
    .array(
      z.object({
        warehouseId: z.string(),
        warehouseName: z.string(),
        campusName: z.string().nullable(),
        isActive: z.boolean(),
        quantity: quantity('Bu depodaki miktar'),
      }),
    )
    .describe('Depo başına miktar: etkin depolar ve miktarı olan pasif depolar'),
})
export const stockItemResponse = dataResponse(stockItemDetailSchema)
export const stockItemParams = z.object({ itemId: z.uuid('Stok kartı geçersiz.') })
export const stockItemListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: search,
  category: z.enum(STOCK_CATEGORIES).optional().describe('Kategori'),
  status,
  critical: z.enum(['true']).optional().describe('`true`: yalnız kritik seviyedeki etkin kartlar'),
  warehouseId: z.uuid('Depo geçersiz.').optional().describe('Miktar yalnız bu depodan'),
})

/** Kritik stok satırı (DOM-FIN-079; ON-230). `id` stok kartının kimliğidir. */
const criticalStockRowSchema = z.object({
  id: z.string().describe('Stok kartı kimliği'),
  code: z.string(),
  name: z.string(),
  category: z.enum(STOCK_CATEGORIES),
  unit: z.enum(STOCK_UNITS),
  minQuantity: quantity('Kritik seviye'),
  quantity: quantity('Kurum toplamı: etkin ve pasif bütün depolar (K-200)'),
  shortage: quantity('Kritik seviye eksi toplam, en az sıfır'),
  suggestedQuantity: quantity('Öneri: stoku kritik seviyenin iki katına tamamlar, en az 1 (K-201)'),
  lastUnitPriceCents: z
    .number()
    .int()
    .nullable()
    .describe(
      'Son alış fiyatı: iptal edilmemiş en son mal kabul girişinin sipariş birim fiyatı, KDV hariç, kuruş (K-202); yoksa boş',
    ),
  lastReceiptDate: daySchema.nullable().describe('Son alış fiyatının mal kabul günü'),
  lastOrderNumber: z.string().nullable().describe('Son alış fiyatının siparişi'),
  warehouses: z
    .array(
      z.object({
        warehouseId: z.string(),
        warehouseName: z.string(),
        campusName: z.string().nullable(),
        isActive: z.boolean(),
        quantity: quantity('Bu depodaki miktar'),
      }),
    )
    .describe('Depo kırılımı: etkin depolar ve miktarı olan pasif depolar, ada göre'),
})
export const criticalStockListResponse = z.object({
  data: z.array(criticalStockRowSchema),
  meta: pageMetaSchema,
})
export const criticalStockListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: search,
  category: z.enum(STOCK_CATEGORIES).optional().describe('Kategori'),
})

const stockWarehouseSchema = z.object({
  id: z.string(),
  name: z.string(),
  campusId: z.string(),
  campusName: z.string().nullable().describe('Kampüs adı; kampüs arşivlendiyse boş'),
  note: z.string().nullable(),
  isActive: z.boolean(),
  itemCount: quantity('Miktarı sıfırdan farklı ürün çeşidi sayısı'),
  version,
})
export const stockWarehouseListResponse = z.object({
  data: z.array(stockWarehouseSchema),
  meta: pageMetaSchema,
})
export const stockWarehouseResponse = dataResponse(stockWarehouseSchema)
export const stockWarehouseParams = z.object({ warehouseId: z.uuid('Depo geçersiz.') })
export const stockWarehouseListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: search,
  status,
  campusId: z.string().trim().min(1).max(100).optional().describe('Kampüs'),
})

const stockMovementSchema = z.object({
  id: z.string(),
  type: z.enum(STOCK_MOVEMENT_TYPES),
  movementDate: z.string().describe('Hareket günü `YYYY-MM-DD`'),
  itemId: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  unit: z.enum(STOCK_UNITS),
  warehouseId: z.string(),
  warehouseName: z.string(),
  campusName: z.string().nullable(),
  quantity: quantity('Miktar; işaret türden gelir (giriş artırır, çıkış azaltır)'),
  reason: z
    .enum([...STOCK_ENTRY_REASONS, ...STOCK_ISSUE_REASONS])
    .nullable()
    .describe('Elle giriş ve çıkışın nedeni; transfer ve mal kabulde boş'),
  note: z.string().nullable(),
  transferId: z.string().nullable(),
  counterpartWarehouseName: z.string().nullable().describe('Transferde karşı depo'),
  orderId: z.string().nullable().describe('Mal kabul girişinde sipariş'),
  orderNumber: z.string().nullable(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelledByName: z.string().nullable(),
  cancelReason: z.string().nullable(),
  actions: z
    .object({ cancel: z.boolean() })
    .describe('Oturumdaki kullanıcı bu hareketi iptal edebilir mi (K-183)'),
  version,
})
export const stockMovementListResponse = z.object({
  data: z.array(stockMovementSchema),
  meta: pageMetaSchema,
})
export const stockMovementResponse = dataResponse(stockMovementSchema)
export const stockMovementsResponse = dataResponse(z.array(stockMovementSchema))
export const stockTransferResponse = dataResponse(
  z.object({
    transferId: z.string(),
    movements: z.array(stockMovementSchema).describe('Çıkış ve giriş hareketi'),
  }),
)
export const stockMovementParams = z.object({ movementId: z.uuid('Hareket geçersiz.') })
export const stockMovementListQuery = z
  .strictObject({
    ...pageQuerySchema.shape,
    itemId: z.uuid('Stok kartı geçersiz.').optional().describe('Stok kartı'),
    warehouseId: z.uuid('Depo geçersiz.').optional().describe('Depo'),
    type: z.enum(STOCK_MOVEMENT_TYPES).optional().describe('Hareket türü'),
    from: daySchema.optional().describe('Bu günden (dahil)'),
    to: daySchema.optional().describe('Bu güne kadar (dahil)'),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    path: ['to'],
    message: 'Bitiş günü başlangıçtan önce olamaz.',
  })
