import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  CHEMICAL_EXPIRY_STATUSES,
  CHEMICAL_SIGNAL_WORDS,
  GHS_PICTOGRAMS,
} from '@kampus/school-core/lib/finance-chemicals.ts'
import { STOCK_UNITS } from '@kampus/school-core/lib/finance-inventory.ts'

import { pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Kimyasal bilgisi, parti ve envanter raporu şemaları (DOM-FIN-090; ON-234). */

const pictograms = z.array(z.enum(GHS_PICTOGRAMS)).describe('GHS piktogram kodları, kod sırasıyla')
const signalWord = z
  .enum(CHEMICAL_SIGNAL_WORDS)
  .nullable()
  .describe('Sinyal kelimesi: `danger` Tehlike, `warning` Dikkat')

/** Stok kartı ayrıntısındaki kimyasal bilgisi; `version` `PATCH …/chemical-profile` içindir. */
export const chemicalProfileViewSchema = z
  .object({
    hazardPictograms: pictograms,
    signalWord,
    casNumber: z.string().nullable(),
    storageClass: z.string().nullable(),
    incompatibilityNote: z.string().nullable(),
    sdsUrl: z.string().nullable().describe('GBF bağlantısı (https)'),
    sdsDocumentNumber: z.string().nullable().describe('GBF belge numarası'),
    sdsRevisionDate: daySchema.nullable(),
    version: z.number().int().describe('`If-Match` için kimyasal bilgisinin sürümü'),
  })
  .describe('Kimyasal bilgisi (K-240); kimyasal olmayan kartta boş')

const status = z.enum(CHEMICAL_EXPIRY_STATUSES)
const lotFields = {
  lotNumber: z.string().nullable().describe('Parti numarası; boşsa parti bilgisi olmayan miktar'),
  expiryDate: daySchema.nullable().describe('Son kullanma günü'),
  quantity: z.number().int().describe('Partide kalan miktar (FEFO ile türetilir, K-242)'),
  status: status.describe(
    '`expired` süresi geçti, `expiring` 30 gün içinde doluyor, `ok`, `unknown` parti bilgisi yok (K-243)',
  ),
  daysLeft: z.number().int().nullable().describe('Son kullanmaya kalan gün; geçtiyse eksi'),
}

const chemicalLotRowSchema = z.object({
  key: z.string().describe('Satır anahtarı: kart, depo, parti ve son kullanma'),
  itemId: z.string(),
  code: z.string(),
  name: z.string(),
  unit: z.enum(STOCK_UNITS),
  hazardPictograms: pictograms,
  signalWord,
  warehouseId: z.string(),
  warehouseName: z.string(),
  campusName: z.string().nullable(),
  warehouseIsActive: z.boolean(),
  ...lotFields,
})
export const chemicalLotListResponse = z.object({
  data: z.array(chemicalLotRowSchema),
  meta: pageMetaSchema,
})
export const chemicalLotListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  status: z
    .enum(['attention', ...CHEMICAL_EXPIRY_STATUSES])
    .optional()
    .describe('`attention`: süresi geçen ve 30 gün içinde dolan partiler (uyarı listesi)'),
  itemId: z.uuid('Stok kartı geçersiz.').optional().describe('Stok kartı'),
  warehouseId: z.uuid('Depo geçersiz.').optional().describe('Depo'),
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .describe('Kod, ad, CAS ve parti numarasında arama, Türkçe harf duyarsız'),
})

const chemicalInventoryRowSchema = z.object({
  key: z.string().describe('Satır anahtarı: depo ve kart'),
  warehouseId: z.string(),
  warehouseName: z.string(),
  campusName: z.string().nullable(),
  itemId: z.string(),
  code: z.string(),
  name: z.string(),
  unit: z.enum(STOCK_UNITS),
  casNumber: z.string().nullable(),
  hazardPictograms: pictograms,
  signalWord,
  storageClass: z.string().nullable(),
  hasSds: z.boolean().describe('GBF bağlantısı ya da belge numarası var'),
  quantity: z.number().int().describe('Depodaki miktar'),
  nearestExpiryDate: daySchema.nullable(),
  expiredQuantity: z.number().int(),
  expiringQuantity: z.number().int(),
  lots: z.array(z.object(lotFields)).describe('Partiler, FEFO sırasıyla'),
})
export const chemicalInventoryResponse = z.object({
  data: z.array(chemicalInventoryRowSchema),
  meta: pageMetaSchema,
})
export const chemicalInventoryQuery = z.strictObject({
  ...pageQuerySchema.shape,
  warehouseId: z.uuid('Depo geçersiz.').optional().describe('Depo'),
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .describe('Kod, ad ve CAS numarasında arama, Türkçe harf duyarsız'),
})
