import { z } from 'zod'

import { PROGRESSION_OUTCOMES } from '@kampus/school-core/cefr/progression.ts'
import { enumKeys } from '@kampus/school-core/content/taxonomy.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import { FEE_ITEM_KINDS } from '@kampus/school-core/lib/fee-tariffs.ts'
import {
  CORPORATE_ELIGIBILITY_LABELS,
  CORPORATE_LINE_STATUSES,
  CORPORATE_MEMBER_STATUS_LABELS,
} from '@kampus/school-core/lib/finance-corporate.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Kurumsal müşteri, çalışan bağı, toplu fatura ve katılım özeti şemaları (DOM-FIN-060, IST-089). */

const cents = (description: string) => z.number().int().describe(description)
const hours = (description: string) => z.number().int().describe(description)

const customerSchema = z.object({
  id: z.string(),
  name: z.string(),
  taxNumber: z.string().describe('10 haneli VKN ya da şahıs şirketinde 11 haneli TCKN'),
  taxOffice: z.string(),
  billingAddress: z.string(),
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  activeEmployeeCount: z.number().int().describe('Bugün etkin bağlı kursiyer sayısı'),
  createdAt: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})
export const customerResponse = dataResponse(customerSchema)
export const customerArchiveResponse = dataResponse(z.object({ id: z.string() }))
export const customerListResponse = z.object({
  data: z.array(customerSchema),
  meta: pageMetaSchema,
})
export const customerParams = z.object({ customerId: z.uuid('Şirket geçersiz.') })
export const customerListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Unvanda ya da vergi numarasında arama'),
})

const employeeSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  studentId: z.string(),
  studentName: z.string().nullable(),
  startsOn: z.string().describe('Bağın ilk günü'),
  endsOn: z.string().nullable().describe('Bağın son günü; etkin bağda boş'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})
export const employeeResponse = dataResponse(employeeSchema)
export const employeeListResponse = z.object({
  data: z.array(employeeSchema),
  meta: pageMetaSchema,
})
export const employeeParams = z.object({
  customerId: z.uuid('Şirket geçersiz.'),
  linkId: z.uuid('Bağ geçersiz.'),
})
export const employeeListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  status: z.enum(['active', 'ended']).optional().describe('`active` etkin, `ended` biten bağlar'),
})

export const periodQuery = z.strictObject({
  from: daySchema.describe('Dönem başlangıcı (dahil), Europe/Istanbul günü'),
  to: daySchema.describe('Dönem bitişi (dahil); dönem en çok bir yıl'),
})

const billableLineSchema = z.object({
  invoiceId: z.string().describe('Taksit kimliği'),
  studentId: z.string(),
  studentName: z.string().nullable(),
  installment: z.number().int(),
  feeKind: z.enum(FEE_ITEM_KINDS).nullable().describe('Kalem türü; boşsa öğrenim'),
  dueDate: z.string(),
  amountCents: cents('Taksit tutarı, kuruş'),
})
export const billableResponse = dataResponse(
  z.object({
    from: z.string(),
    to: z.string(),
    totalCents: cents('Faturalanacak toplam, kuruş'),
    lines: z.array(billableLineSchema),
  }),
)

const invoiceSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  number: z.string().describe('`KF-<yıl>-<sıra>`'),
  periodFrom: z.string(),
  periodTo: z.string(),
  customerName: z.string().describe('Kesim anındaki unvan'),
  taxNumber: z.string(),
  taxOffice: z.string(),
  billingAddress: z.string(),
  totalCents: cents('Toplam, kuruş'),
  lineCount: z.number().int(),
  issuedAt: z.string(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})
export const invoiceListResponse = z.object({ data: z.array(invoiceSchema), meta: pageMetaSchema })
export const invoiceListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  customerId: z.uuid('Şirket geçersiz.').optional(),
  status: z
    .enum(['issued', 'cancelled'])
    .optional()
    .describe('`issued` geçerli, `cancelled` iptal'),
})
export const invoiceParams = z.object({ invoiceId: z.uuid('Toplu fatura geçersiz.') })
export const invoiceResponse = dataResponse(
  invoiceSchema.extend({
    lines: z.array(
      billableLineSchema.extend({
        status: z
          .enum(CORPORATE_LINE_STATUSES)
          .describe(
            'Taksitin bugünkü durumu: `open`, `partial`, `paid`, `cancelled` (taksit iptal ya da ek protokolle değişti)',
          ),
      }),
    ),
  }),
)

const attendanceRowSchema = z.object({
  enrollmentId: z.string(),
  courseName: z.string(),
  level: z.string(),
  groupName: z.string(),
  memberStatus: z.enum(enumKeys(CORPORATE_MEMBER_STATUS_LABELS)),
  totalHours: hours('Kurun toplam ders saati'),
  recordedHours: hours('Yoklaması alınan saat'),
  attendedHours: hours('Katılınan saat (geç dahil)'),
  absentHours: hours('Gelinmeyen saat'),
  attendanceRatePermille: z
    .number()
    .int()
    .nullable()
    .describe('Katılınan ÷ yoklaması alınan saat, binde; yoklama yoksa boş'),
  eligibility: z
    .enum(enumKeys(CORPORATE_ELIGIBILITY_LABELS))
    .nullable()
    .describe('Devam şartı (DOM-DIL-060); hesaplanamazsa boş'),
  outcome: z
    .enum(enumKeys(PROGRESSION_OUTCOMES))
    .nullable()
    .describe('Onaylı en son kur sonucu; yoksa boş'),
  attendanceUnavailable: z.boolean().describe('Yoklama verisi hesaplanamadı'),
})
export const attendanceReportResponse = dataResponse(
  z.object({
    customerId: z.string(),
    customerName: z.string(),
    totals: z.object({
      employeeCount: z.number().int(),
      enrollmentCount: z.number().int(),
      recordedHours: hours('Yoklaması alınan saat toplamı'),
      attendedHours: hours('Katılınan saat toplamı'),
      attendanceRatePermille: z.number().int().nullable(),
    }),
    employees: z.array(
      z.object({
        studentId: z.string(),
        studentName: z.string().nullable(),
        startsOn: z.string(),
        enrollments: z.array(attendanceRowSchema),
      }),
    ),
  }),
)
