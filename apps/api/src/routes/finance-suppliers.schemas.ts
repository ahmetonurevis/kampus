import { z } from 'zod'

import { SUPPLIER_CATEGORIES, SUPPLIER_TYPES } from '@kampus/school-core/lib/finance-suppliers.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Tedarikçi şemaları (DOM-FIN-070; ON-221). */

const version = z.number().int().describe('`If-Match` için kayıt sürümü')
const categories = z.array(z.enum(SUPPLIER_CATEGORIES)).describe('Satın alma kategorileri (K-125)')

const supplierListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(SUPPLIER_TYPES),
  taxNumber: z
    .string()
    .describe('Şirkette VKN; şahısta son dört hane dışında maskeli TCKN (`*******0146`)'),
  taxOffice: z.string(),
  categories,
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  iban: z.string().nullable().describe('Ülke kodu ve son dört hane dışında maskeli IBAN'),
  documentCount: z.number().int(),
  expiredDocumentCount: z.number().int().describe('Geçerliliği geçmiş belge sayısı'),
  expiringDocumentCount: z
    .number()
    .int()
    .describe('30 gün içinde geçerliliği bitecek belge sayısı'),
  isActive: z.boolean(),
  version,
})
export const supplierListResponse = z.object({
  data: z.array(supplierListItemSchema),
  meta: pageMetaSchema,
})

const supplierDocumentSchema = z.object({
  name: z.string(),
  expiryDate: z.string().nullable().describe('Son geçerlilik günü; süresizse boş'),
  note: z.string().nullable(),
  status: z
    .enum(['valid', 'expiring', 'expired', 'open-ended'])
    .describe('Bugüne göre durum: geçerli, süresi yaklaşıyor (30 gün), geçti, süresiz'),
})
const supplierDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(SUPPLIER_TYPES),
  taxNumber: z.string().describe('Tam vergi numarası (yalnız yönetici)'),
  taxOffice: z.string(),
  categories,
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  address: z.string().nullable(),
  iban: z.string().nullable().describe('Tam IBAN (yalnız yönetici)'),
  documents: z.array(supplierDocumentSchema),
  isActive: z.boolean(),
  createdAt: z.string(),
  version,
})
export const supplierResponse = dataResponse(supplierDetailSchema)

export const supplierParams = z.object({ supplierId: z.uuid('Tedarikçi geçersiz.') })
export const supplierListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .describe('Unvanda (yöneticide ayrıca vergi numarasında) arama, Türkçe harf duyarsız'),
  status: z
    .enum(['active', 'inactive'])
    .optional()
    .describe('`active` etkin, `inactive` pasif tedarikçiler'),
  type: z.enum(SUPPLIER_TYPES).optional().describe('Tedarikçi türü'),
  category: z.enum(SUPPLIER_CATEGORIES).optional().describe('Kategori'),
})
