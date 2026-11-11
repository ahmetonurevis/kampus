import { z } from 'zod'

import {
  FIXED_ASSET_COUNT_ITEM_RESULTS,
  FIXED_ASSET_COUNT_SCOPE_TYPES,
  FIXED_ASSET_COUNT_STATUSES,
  FIXED_ASSET_SCAN_OUTCOMES,
} from '@kampus/school-core/lib/finance-fixed-asset-counts.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Demirbaş sayımı şemaları (DOM-FIN-087; ON-237). Kişi verisi döndürülmez. */

const summarySchema = z
  .object({
    expected: z.number().int().describe('Beklenen listedeki demirbaş sayısı'),
    found: z.number().int().describe('Kayıtlı yerinde bulunan'),
    misplaced: z.number().int().describe('Başka yerde bulunan'),
    pending: z
      .number()
      .int()
      .describe('Okunmayan beklenen demirbaş; tamamlanmış sayımda bulunamayan'),
    extra: z.number().int().describe('Beklenen listede olmayan, okutulan kurum demirbaşı'),
  })
  .describe('Satırlardan sayılan özet')

const countSchema = z.object({
  id: z.string(),
  scopeType: z
    .enum(FIXED_ASSET_COUNT_SCOPE_TYPES)
    .describe('`institution` bütün kurum, `campus` kampüs, `location` oda/konum'),
  campusId: z.string().nullable(),
  campusName: z.string().nullable().describe('Kapsam kampüsünün adı; arşivlendiyse boş'),
  location: z.string().nullable().describe('Oda sayımında oda ya da yer'),
  note: z.string().nullable(),
  status: z.enum(FIXED_ASSET_COUNT_STATUSES),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  version: z.number().int().describe('`If-Match` için sürüm (tamamlama, iptal)'),
  summary: summarySchema,
})
export const countResponse = dataResponse(countSchema)
export const countListResponse = z.object({ data: z.array(countSchema), meta: pageMetaSchema })

const itemSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  inScope: z.boolean().describe('Sayım başlarken beklenen listede miydi'),
  tagNumber: z.string().describe('Etiketin sayım anındaki kopyası'),
  assetName: z.string(),
  recordedCampusId: z.string().nullable(),
  recordedCampusName: z.string().nullable(),
  recordedLocation: z.string().describe('Demirbaş kaydındaki konum (sayım anı)'),
  result: z
    .enum(FIXED_ASSET_COUNT_ITEM_RESULTS)
    .describe('`pending` okunmadı (tamamlanmışta bulunamadı), `found`, `misplaced`'),
  observedCampusId: z.string().nullable(),
  observedCampusName: z.string().nullable(),
  observedLocation: z.string().nullable().describe('Okutulduğu yer'),
  scannedAt: z.string().nullable(),
  relocatedAt: z.string().nullable().describe('Konumu sayılan yere düzeltildiyse zamanı'),
  version: z.number().int().describe('`If-Match` için sürüm (konum düzeltmesi)'),
})
export const countItemResponse = dataResponse(itemSchema)
export const countItemListResponse = z.object({ data: z.array(itemSchema), meta: pageMetaSchema })

export const scanResponse = dataResponse(
  z.object({
    outcome: z
      .enum(FIXED_ASSET_SCAN_OUTCOMES)
      .describe('`found`, `misplaced` ya da daha önce okunmuş `already_counted`'),
    item: itemSchema,
    summary: summarySchema,
  }),
)

const placeSchema = z.object({
  campusId: z.string().nullable(),
  campusName: z.string().nullable(),
  location: z.string(),
  assetCount: z.number().int().describe('Bu yerde kayıtlı, hurdaya ayrılmamış demirbaş sayısı'),
})
export const placeListResponse = z.object({ data: z.array(placeSchema), meta: pageMetaSchema })

export const countParams = z.object({ countId: z.uuid('Sayım geçersiz.') })
export const countItemParams = z.object({
  countId: z.uuid('Sayım geçersiz.'),
  itemId: z.uuid('Sayım satırı geçersiz.'),
})
export const emptyCommandBody = z.strictObject({})

export const countListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  status: z.enum(FIXED_ASSET_COUNT_STATUSES).optional().describe('Durum'),
})
export const countItemListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  result: z.enum(FIXED_ASSET_COUNT_ITEM_RESULTS).optional().describe('Sonuç'),
  inScope: z
    .enum(['true', 'false'])
    .optional()
    .describe('`false` yalnız beklenen listede olmayan okutmalar'),
  q: z.string().trim().min(2).max(100).optional().describe('Etiket ve adda arama'),
})
export const placeListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Konumda arama, Türkçe harf duyarsız'),
  campusId: z.string().trim().min(1).max(100).optional().describe('Kampüs'),
})
