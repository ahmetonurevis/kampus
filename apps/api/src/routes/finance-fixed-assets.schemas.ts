import { z } from 'zod'

import { FIXED_ASSET_ASSIGNEE_TYPES } from '@kampus/school-core/lib/finance-fixed-asset-assignments.ts'
import { FIXED_ASSET_COUNT_OUTCOMES } from '@kampus/school-core/lib/finance-fixed-asset-counts.ts'
import {
  DEPRECIATION_METHODS,
  FIXED_ASSET_CATEGORIES,
  FIXED_ASSET_STATUSES,
} from '@kampus/school-core/lib/finance-fixed-assets.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Demirbaş şemaları (DOM-FIN-085; ON-235). */

const version = z.number().int().describe('`If-Match` için kayıt sürümü')

const fixedAssetListItemSchema = z.object({
  id: z.string(),
  tagNumber: z.string().describe('Kurumda tekil etiket (ör. `DB-2026-0001`)'),
  name: z.string(),
  category: z.enum(FIXED_ASSET_CATEGORIES).describe('Sabit kategori (K-186)'),
  campusId: z.string().nullable(),
  campusName: z.string().nullable().describe('Kampüs adı; kampüs yoksa ya da arşivlendiyse boş'),
  location: z.string().describe('Oda ya da yer'),
  acquisitionValueCents: z.number().int().describe('KDV hariç alım değeri, kuruş'),
  acquisitionDate: z.string().describe('Alım günü (YYYY-MM-DD)'),
  supplierId: z.string().nullable(),
  supplierName: z.string().nullable(),
  receiptItemId: z.string().nullable().describe('Bağlı mal kabul kalemi'),
  status: z.enum(FIXED_ASSET_STATUSES),
  usefulLifeYears: z.number().int().describe('Faydalı ömür, yıl (DOM-FIN-088)'),
  depreciationMethod: z
    .enum(DEPRECIATION_METHODS)
    .describe('Amortisman yöntemi: `normal` doğrusal, `declining` azalan bakiyeler'),
  scrapDate: z.string().nullable().describe('Hurdaya ayırma günü'),
  assignment: z
    .object({
      id: z.string(),
      assigneeType: z.enum(FIXED_ASSET_ASSIGNEE_TYPES),
      membershipId: z.string().nullable(),
      staffName: z.string().nullable().describe('Teslim alan personelin adı (yalnız yönetici)'),
      staffActive: z.boolean().nullable().describe('Personel pasifleştirildiyse `false`'),
      campusId: z.string().nullable(),
      campusName: z.string().nullable(),
      location: z.string().nullable(),
      assignedDate: z.string().describe('Zimmet günü (YYYY-MM-DD)'),
    })
    .nullable()
    .describe('Açık zimmet (DOM-FIN-086); zimmetsizse boş'),
  openMaintenanceCount: z
    .number()
    .int()
    .describe('Çözülmemiş (açık, atanmış, çalışılan) arıza talebi sayısı (DOM-FIN-089, K-239)'),
  version,
})
export const fixedAssetListResponse = z.object({
  data: z.array(fixedAssetListItemSchema),
  meta: pageMetaSchema,
})

const fixedAssetDetailSchema = fixedAssetListItemSchema.extend({
  receipt: z
    .object({
      receiptId: z.string(),
      receiptDate: z.string(),
      receiptCancelled: z.boolean().describe('Kabul sonradan iptal edildiyse `true`'),
      orderId: z.string(),
      orderNumber: z.string(),
      itemName: z.string(),
      unitPriceCents: z.number().int().describe('Sipariş birim fiyatı, KDV hariç, kuruş'),
      acceptedQuantity: z.number().int(),
      linkedAssetCount: z.number().int().describe('Kaleme bağlı demirbaş sayısı (bu kayıt dahil)'),
    })
    .nullable()
    .describe('Mal kabul bağı (DOM-FIN-074)'),
  scrappedAt: z.string().nullable(),
  scrapReason: z.string().nullable(),
  lastCount: z
    .object({
      countId: z.string(),
      completedAt: z.string().describe('Sayımın tamamlandığı zaman'),
      outcome: z
        .enum(FIXED_ASSET_COUNT_OUTCOMES)
        .describe('`found` bulundu, `misplaced` yanlış konumda, `missing` bulunamadı'),
    })
    .nullable()
    .describe('Demirbaşın son tamamlanmış sayımı (DOM-FIN-087); hiç sayılmadıysa boş'),
  createdAt: z.string(),
  depreciation: z
    .object({
      rateBasisPoints: z.number().int().describe('Yıllık oran, baz puan (2000 = %20)'),
      rows: z.array(
        z.object({
          year: z.number().int().describe('Takvim yılı; alım yılı tam yıl sayılır (K-225)'),
          openingCents: z.number().int().describe('Dönem başı net değer, kuruş'),
          depreciationCents: z.number().int().describe('Yılın amortismanı, kuruş'),
          accumulatedCents: z.number().int().describe('Yıl sonu birikmiş amortisman, kuruş'),
          netCents: z.number().int().describe('Yıl sonu net değer, kuruş'),
          disposedCents: z
            .number()
            .int()
            .describe('Hurdaya ayırma yılında kayıttan düşen net değer, kuruş (K-226)'),
        }),
      ),
    })
    .describe('Amortisman ön hesabı (DOM-FIN-088); yönetim raporu, defter kaydı değildir'),
})
export const fixedAssetResponse = dataResponse(fixedAssetDetailSchema)

const receiptItemSchema = z.object({
  receiptItemId: z.string(),
  receiptId: z.string(),
  receiptDate: z.string(),
  orderId: z.string(),
  orderNumber: z.string(),
  supplierId: z.string(),
  supplierName: z.string().describe('Siparişteki tedarikçi unvanı'),
  itemName: z.string(),
  unitPriceCents: z.number().int().describe('Sipariş birim fiyatı, KDV hariç, kuruş'),
  acceptedQuantity: z.number().int(),
  linkedAssetCount: z.number().int().describe('Kaleme bağlı demirbaş sayısı'),
})
export const fixedAssetReceiptItemsResponse = z.object({
  data: z.array(receiptItemSchema),
  meta: pageMetaSchema,
})

export const fixedAssetParams = z.object({ assetId: z.uuid('Demirbaş geçersiz.') })

const search = z.string().trim().min(2).max(100).optional()

export const fixedAssetListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: search.describe('Etiket, ad ve konumda arama, Türkçe harf duyarsız'),
  status: z.enum(FIXED_ASSET_STATUSES).optional().describe('Durum'),
  category: z.enum(FIXED_ASSET_CATEGORIES).optional().describe('Kategori'),
  campusId: z.string().trim().min(1).max(100).optional().describe('Kampüs'),
  supplierId: z.uuid().optional().describe('Tedarikçi'),
})
export const fixedAssetReceiptItemsQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: search.describe('Kalem adı, sipariş numarası ve tedarikçi unvanında arama'),
})

const depreciationTotalsShape = {
  assetCount: z.number().int().describe('Yıl içinde kayıtta olan demirbaş'),
  heldCount: z.number().int().describe('Yıl sonunda kayıtta kalan demirbaş'),
  disposedCount: z.number().int().describe('Yıl içinde hurdaya ayrılan demirbaş'),
  costCents: z.number().int().describe('Yıl sonunda kayıtta kalanların alım değeri, KDV hariç'),
  openingNetCents: z.number().int().describe('Dönem başı net değer'),
  additionsCents: z.number().int().describe('Yıl içinde alınanların alım değeri'),
  depreciationCents: z.number().int().describe('Yılın amortismanı'),
  disposedCents: z.number().int().describe('Hurdaya ayrılanların kayıttan düşen net değeri'),
  accumulatedCents: z
    .number()
    .int()
    .describe('Yıl sonunda kayıtta kalanların birikmiş amortismanı'),
  closingNetCents: z.number().int().describe('Yıl sonu net değer'),
}

/** Amortisman ön hesabı raporu (DOM-FIN-088); tutarlar kuruş. */
export const depreciationReportResponse = dataResponse(
  z.object({
    year: z.number().int(),
    firstYear: z
      .number()
      .int()
      .nullable()
      .describe('Kurumdaki en eski alım yılı; demirbaş yoksa boş'),
    totals: z.object(depreciationTotalsShape),
    categories: z.array(
      z.object({ category: z.enum(FIXED_ASSET_CATEGORIES), ...depreciationTotalsShape }),
    ),
  }),
)
