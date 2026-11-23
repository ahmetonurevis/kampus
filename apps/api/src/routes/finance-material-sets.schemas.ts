import { z } from 'zod'

import { STOCK_UNITS } from '@kampus/school-core/lib/finance-inventory.ts'
import {
  MATERIAL_RECIPIENT_KINDS,
  MATERIAL_SET_YEAR_MAX,
  MATERIAL_SET_YEAR_MIN,
} from '@kampus/school-core/lib/finance-material-sets.ts'
import { GUARDIAN_RELATIONSHIP_KEYS } from '@kampus/school-core/lib/guardianship.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Materyal seti ve teslim şemaları (DOM-FIN-080; ON-232). */

const version = z.number().int().describe('`If-Match` için kayıt sürümü')
const count = (description: string) => z.number().int().describe(description)
const search = (description: string) =>
  z.string().trim().min(2).max(100).optional().describe(description)

const materialSetRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  academicYear: z.number().int().describe('Eğitim yılının başladığı yıl'),
  gradeLevel: z.number().int().nullable().describe('Okulda hedef sınıf düzeyi; boşsa yok'),
  courseId: z.string().nullable().describe('Dil okulunda hedef kur; boşsa yok'),
  courseName: z.string().nullable(),
  isActive: z.boolean(),
  itemCount: count('Kalem sayısı'),
  studentCount: count('Hedefteki etkin öğrenci ile teslim alan öğrencilerin sayısı'),
  deliveredCount: count('İptal edilmemiş teslim sayısı'),
  version,
})
export const materialSetListResponse = z.object({
  data: z.array(materialSetRowSchema),
  meta: pageMetaSchema,
})
export const materialSetResponse = dataResponse(
  materialSetRowSchema.extend({
    hasDeliveries: z
      .boolean()
      .describe('İptal edilmemiş teslimi varsa eğitim yılı ve hedef değişmez (K-208)'),
    items: z.array(
      z.object({
        stockItemId: z.string(),
        code: z.string(),
        name: z.string(),
        unit: z.enum(STOCK_UNITS),
        isActive: z.boolean().describe('Stok kartı etkin mi; pasif kartlı set teslim edilmez'),
        quantity: count('Öğrenci başına adet'),
      }),
    ),
  }),
)
export const materialSetParams = z.object({ setId: z.uuid('Set geçersiz.') })
export const materialSetListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: search('Set adında arama, Türkçe harf duyarsız'),
  academicYear: z.coerce
    .number()
    .int()
    .min(MATERIAL_SET_YEAR_MIN)
    .max(MATERIAL_SET_YEAR_MAX)
    .optional()
    .describe('Eğitim yılı'),
  status: z.enum(['active', 'inactive']).optional().describe('`active` etkin, `inactive` pasif'),
})

const deliverySummarySchema = z.object({
  id: z.string(),
  deliveryDate: z.string().describe('Teslim günü `YYYY-MM-DD`'),
  recipientKind: z.enum(MATERIAL_RECIPIENT_KINDS),
  recipientName: z
    .string()
    .nullable()
    .describe('Kayıtlı velide teslim anındaki ad, başka kişide yazılan ad; öğrencide boş'),
  signatureReceived: z.boolean().describe('Kâğıt imza alındı mı'),
  warehouseName: z.string(),
  version,
})
const materialStudentSchema = z.object({
  studentId: z.string(),
  studentName: z.string(),
  studentNumber: z.string().nullable(),
  className: z
    .string()
    .nullable()
    .describe('Sınıf; kura bağlı sette o kurun grubu, sınıfsız öğrencide etkin kur grupları'),
  hasMaterialFee: z
    .boolean()
    .describe('Setin yılında kitap ve kırtasiye ücret kalemi var (K-207; ödeme durumu değil)'),
  delivery: deliverySummarySchema.nullable().describe('İptal edilmemiş teslim; yoksa boş'),
  cancelledDelivery: z
    .object({
      id: z.string(),
      deliveryDate: z.string().describe('Teslim günü `YYYY-MM-DD`'),
      cancelledAt: z.string(),
    })
    .nullable()
    .describe('Bu setteki son iptal edilmiş teslim (iptal tutanağı için, K-218); yoksa boş'),
  actions: z
    .object({ deliver: z.boolean(), sign: z.boolean(), cancel: z.boolean() })
    .describe('Oturumdaki kullanıcının bu satırda yapabilecekleri'),
})
export const materialStudentListResponse = z.object({
  data: z.array(materialStudentSchema),
  meta: pageMetaSchema,
})
export const materialStudentQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: search('Öğrenci adında (Türkçe harf duyarsız) ya da numarasında arama'),
  status: z
    .enum(['delivered', 'pending'])
    .optional()
    .describe('`delivered` teslim edilen, `pending` teslim edilmeyen'),
  fee: z
    .enum(['charged', 'none'])
    .optional()
    .describe('`charged` kitap ve kırtasiye ücret kalemi olan, `none` olmayan'),
  signature: z
    .enum(['received', 'missing'])
    .optional()
    .describe('`received` imzası alınan, `missing` imzası bekleyen teslimler'),
})

const materialDeliverySchemaOut = z.object({
  id: z.string(),
  setId: z.string(),
  setName: z.string(),
  academicYear: z.number().int().describe('Setin eğitim yılı'),
  studentId: z.string(),
  studentName: z.string(),
  studentNumber: z.string().nullable(),
  className: z
    .string()
    .nullable()
    .describe('Sınıf; kura bağlı sette o kurun grubu, sınıfsız öğrencide etkin kur grupları'),
  hasMaterialFee: z
    .boolean()
    .describe(
      'Setin yılında kitap ve kırtasiye ücret kalemi var (K-207, K-218; tutar ve ödeme durumu değil)',
    ),
  warehouseId: z.string(),
  warehouseName: z.string(),
  deliveryDate: z.string(),
  recipientKind: z.enum(MATERIAL_RECIPIENT_KINDS),
  recipientName: z.string().nullable(),
  signatureReceived: z.boolean(),
  signatureRecordedAt: z.string().nullable(),
  note: z.string().nullable(),
  items: z
    .array(
      z.object({
        stockItemId: z.string(),
        code: z.string(),
        name: z.string(),
        unit: z.enum(STOCK_UNITS),
        quantity: count('Teslim edilen adet'),
      }),
    )
    .describe('Teslim anındaki kalemler; her biri bir stok çıkışıdır'),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelledByName: z.string().nullable(),
  cancelReason: z.string().nullable(),
  actions: z.object({ cancel: z.boolean(), sign: z.boolean() }),
  version,
})
export const materialDeliveryResponse = dataResponse(materialDeliverySchemaOut)
export const materialDeliveryParams = z.object({ deliveryId: z.uuid('Teslim geçersiz.') })

export const materialRecipientQuery = z.strictObject({
  studentId: z.string().trim().min(1).max(200).describe('Öğrenci kaydı'),
})
export const materialRecipientResponse = dataResponse(
  z.array(
    z.object({
      id: z.string().describe('Veli bağı (`guardianId`)'),
      name: z.string(),
      relationship: z.enum(GUARDIAN_RELATIONSHIP_KEYS),
    }),
  ),
)
