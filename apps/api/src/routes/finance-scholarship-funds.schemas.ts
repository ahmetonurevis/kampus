import { z } from 'zod'

import {
  SCHOLARSHIP_FUND_CHANNELS,
  SCHOLARSHIP_FUND_DONOR_KINDS,
  SCHOLARSHIP_FUND_STATUSES,
} from '@kampus/school-core/lib/finance-scholarship-funds.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Burs fonu şemaları (DOM-FIN-068; ON-259). Tutarlar kuruş tamsayı; bakiye hesaplanır. */

const cents = (description: string) => z.number().int().describe(description)

const fundSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  donorKind: z.enum(SCHOLARSHIP_FUND_DONOR_KINDS).describe('Bağışçı türü'),
  donorName: z.string().nullable().describe('Kişi ya da kurum adı; anonimde boş (K-95)'),
  status: z.enum(SCHOLARSHIP_FUND_STATUSES).describe('`closed`: bağış ve atama alınmaz'),
  closedAt: z.string().nullable(),
  createdAt: z.string(),
  donatedCents: cents('Geçerli bağışların toplamı'),
  allocatedCents: cents('Geçerli burs atamalarının toplamı'),
  balanceCents: cents('Bakiye = bağışlar − atamalar; eksiye düşmez'),
  donationCount: z.number().int().describe('Geçerli bağış sayısı'),
  allocationCount: z.number().int().describe('Geçerli atama sayısı'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü (kapanış)'),
})

const movementSchema = z.object({
  id: z.string(),
  kind: z.enum(['donation', 'allocation']),
  day: z.string().describe('Bağış ya da atama günü (YYYY-MM-DD)'),
  amountCents: cents('Hareket tutarı (pozitif)'),
  effectCents: cents('Bakiyeye etkisi: bağış artı, atama eksi, iptal edilen sıfır'),
  balanceAfterCents: cents('Gün sırasıyla bu hareketten sonraki bakiye'),
  channel: z.enum(SCHOLARSHIP_FUND_CHANNELS).nullable().describe('Bağışın kaynağı'),
  note: z.string().nullable().describe('Bağış notu'),
  awardId: z.string().nullable().describe('Karşılanan burs ataması'),
  studentId: z.string().nullable(),
  studentName: z.string().nullable().describe('Yalnız `yonetici` rolünde dolu (K-98)'),
  academicYear: z.number().int().nullable().describe('Bursun eğitim yılı'),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  version: z.number().int().describe('`If-Match` için hareket sürümü (iptal)'),
})

export const fundListResponse = z.object({ data: z.array(fundSchema), meta: pageMetaSchema })
export const fundReportResponse = dataResponse(
  z.object({ fund: fundSchema, movements: z.array(movementSchema) }),
)
export const fundListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Fon adında ya da bağışçı adında arama'),
  status: z.enum(SCHOLARSHIP_FUND_STATUSES).optional().describe('Açık ya da kapalı fonlar'),
})
export const fundParams = z.object({ fundId: z.uuid('Fon geçersiz.') })
export const donationParams = fundParams.extend({ donationId: z.uuid('Bağış geçersiz.') })
export const allocationParams = fundParams.extend({ allocationId: z.uuid('Atama geçersiz.') })
