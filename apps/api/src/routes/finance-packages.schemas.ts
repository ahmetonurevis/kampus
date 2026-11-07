import { z } from 'zod'

import { PACKAGE_KINDS, PACKAGE_SALE_STATUSES } from '@kampus/school-core/lib/finance-packages.ts'
import { contractPaymentTermSchema } from '@kampus/school-core/lib/payment-terms.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Paket ve satış uçlarının sorgu ve yanıt şemaları (IST-078; DOM-DIL-050, -051). */

const packageSchema = z.object({
  id: z.string(),
  kind: z.enum(PACKAGE_KINDS).describe('`course` kur ücreti, `hours` saat, `private` özel ders'),
  name: z.string(),
  courseId: z.string().nullable(),
  level: z.string().nullable().describe('Tarife düzeyi; kura bağlı pakette kurdan okunur'),
  lessonHours: z.number().int().nullable().describe('Kur ücreti paketinde saat kurdan okunur'),
  hourlyCents: z
    .number()
    .int()
    .nullable()
    .describe('İlan altı saat ücreti, kuruş; boşsa tarifenin saat ücreti'),
  validityDays: z.number().int().nullable().describe('Kullanım süresi, gün; boşsa süresiz'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})
export const packageResponse = dataResponse(packageSchema)
export const packageArchiveResponse = dataResponse(z.object({ id: z.string() }))
export const packageListResponse = z.object({ data: z.array(packageSchema), meta: pageMetaSchema })
export const packageParams = z.object({ packageId: z.uuid('Paket geçersiz.') })
export const packageListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Paket adında arama'),
  kind: z.enum(PACKAGE_KINDS).optional(),
  courseId: z.uuid('Kur geçersiz.').optional(),
})

const lineSchema = z.object({ kind: z.string(), amountCents: z.number().int() })
export const quoteResponse = dataResponse(
  z.object({
    packageId: z.string(),
    tariffId: z.string(),
    tariffVersion: z.number().int(),
    level: z.string().nullable(),
    purchasedHours: z.number().int(),
    announcedHourlyCents: z.number().int().describe('Tarifenin saat ücreti, kuruş'),
    hourlyCents: z.number().int().describe('Uygulanan saat ücreti, kuruş'),
    announcedCents: z.number().int().describe('Saat × tarife saat ücreti'),
    grossCents: z.number().int().describe('Saat × uygulanan saat ücreti'),
    discounts: z.array(lineSchema),
    discountCents: z.number().int(),
    netCents: z.number().int().describe('İndirimden sonra öğrenim ücreti'),
    extras: z.array(lineSchema).describe('Ayrı borç kalemleri (DOM-FIN-003)'),
    installments: z.array(z.number().int()).describe('Öğrenim taksitleri, kuruş'),
    paymentTerm: contractPaymentTermSchema
      .nullable()
      .describe('Taksit sayısının ilanlı koşulu (DOM-FIN-013); koşulsuz eski tarifede boş'),
    expiresDate: z.string().nullable().describe('Son kullanma günü; boşsa süresiz'),
  }),
)

const saleSchema = z.object({
  id: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
  packageId: z.string(),
  packageName: z.string().describe('Satış anındaki ad'),
  kind: z.enum(PACKAGE_KINDS),
  courseId: z.string().nullable(),
  level: z.string().nullable().describe('Satış anındaki seviye'),
  studentId: z.string(),
  contractId: z.string().describe('Satışın açtığı sözleşme'),
  tariffId: z.string(),
  tariffVersion: z.number().int(),
  hourlyCents: z.number().int().describe('Uygulanan saat ücreti; iade bu ücretle hesaplanır'),
  grossCents: z.number().int(),
  netCents: z.number().int(),
  purchasedHours: z.number().int().describe('Satın alınan saat'),
  consumedHours: z.number().int().describe('Tüketilen saat'),
  refundedHours: z.number().int().describe('İade edilen saat'),
  remainingHours: z.number().int().describe('Kalan saat; hesaplanır, saklanmaz (DOM-DIL-051)'),
  // Eski idempotency yanıtı bu alanı taşımaz: tekrar yanıtı şemadan geçerken düşmesin.
  usedHoursRecorded: z
    .boolean()
    .default(false)
    .describe('Kullanılan saat girildi mi; `false` ise iade hesabı sıfır saate dayanır (K-21)'),
  expiresDate: z.string().nullable().describe('Son kullanma günü; boşsa süresiz'),
  status: z
    .enum(PACKAGE_SALE_STATUSES)
    .describe('`expired`: süre doldu, kalan saat silinmez; `depleted`: saat bitti. Türetilir.'),
  soldAt: z.string(),
})
export const saleResponse = dataResponse(saleSchema)
const listedSaleSchema = saleSchema.extend({ studentName: z.string().nullable() })
export const saleListResponse = z.object({ data: z.array(listedSaleSchema), meta: pageMetaSchema })
export const saleDetailResponse = dataResponse(
  listedSaleSchema.extend({
    invoices: z.array(
      z.object({
        id: z.string(),
        installment: z.number().int(),
        amountCents: z.number().int(),
        dueDate: z.string(),
        paidAt: z.string().nullable(),
        feeKind: z.string().nullable(),
      }),
    ),
  }),
)
export const saleParams = z.object({ saleId: z.uuid('Satış geçersiz.') })
export const saleListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  studentId: z.string().min(1).max(200).optional().describe('Öğrenci; kapsamı daraltır'),
  packageId: z.uuid('Paket geçersiz.').optional(),
})
