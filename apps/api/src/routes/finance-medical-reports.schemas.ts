import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  MEDICAL_REPORT_ISSUERS,
  MEDICAL_REPORT_STATES,
  MEDICAL_REPORT_TYPES,
} from '@kampus/school-core/lib/finance-medical-reports.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Personel sağlık raporu şemaları (DOM-FIN-110; ON-185). Yalnız yöneticiye döner (K-363). */

const medicalReportSchema = z.object({
  id: z.string(),
  membershipId: z.string(),
  // kvkk: K
  staffName: z.string().describe('Personelin adı'),
  // kvkk: Ö (sigorta türü, tanı değil)
  reportType: z
    .enum(MEDICAL_REPORT_TYPES)
    .describe(
      '`sickness` istirahat (hastalık), `work_accident` iş kazası, `occupational_disease` meslek hastalığı, `maternity` analık',
    ),
  startDate: z.string().describe('Başlangıç (YYYY-MM-DD, dahil)'),
  endDate: z.string().describe('Bitiş (YYYY-MM-DD, dahil)'),
  dayCount: z.number().int().describe('Takvim günü sayısı, uçlar dahil'),
  daysInPeriod: z
    .number()
    .int()
    .nullable()
    .describe('Sorgudaki döneme düşen gün; dönem verilmediyse `null`'),
  issuerType: z.enum(MEDICAL_REPORT_ISSUERS).nullable().describe('Veren kurum türü (isteğe bağlı)'),
  fileId: z
    .string()
    .nullable()
    .describe('Rapor dosyası; `GET /files/{fileId}/url` ile açılır, her açılış denetimde'),
  employerNotifiedAt: z.string().nullable().describe('"İşverene bildirildi" işaret anı'),
  sgkApprovedAt: z.string().nullable().describe('"SGK sisteminde onaylandı" işaret anı'),
  state: z
    .enum(MEDICAL_REPORT_STATES)
    .describe(
      'Bugüne göre: `scheduled` ileri tarihli, `ongoing` sürüyor, `ended` bitti, `cancelled` iptal',
    ),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable().describe('İptal gerekçesi (yalnız iptal edilmiş raporda)'),
  createdAt: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü (işaret, dosya ve iptal)'),
})

export const medicalReportResponse = dataResponse(medicalReportSchema)

const periodSchema = z.object({
  from: z.string().describe('Dönem başı (YYYY-MM-DD)'),
  to: z.string().describe('Dönem sonu (YYYY-MM-DD)'),
})

export const medicalReportListResponse = z.object({
  data: z.array(medicalReportSchema),
  meta: z.object({
    ...pageMetaSchema.shape,
    period: periodSchema.nullable().describe('Uygulanan dönem; dönem verilmediyse `null`'),
  }),
})

const byTypeSchema = z
  .object({
    sickness: z.number().int(),
    work_accident: z.number().int(),
    occupational_disease: z.number().int(),
    maternity: z.number().int(),
  })
  .describe('Türe göre döneme düşen gün')

const summaryRowSchema = z.object({
  membershipId: z.string(),
  // kvkk: K
  name: z.string(),
  role: z.string().describe('Rol: `yonetici`, `ogretmen` ya da `onburo`'),
  active: z.boolean().describe('Pasifleştirilmiş (ayrılan) personelde `false`'),
  totalDays: z.number().int().describe('Döneme düşen rapor günü (takvim günü)'),
  byType: byTypeSchema,
  reportCount: z.number().int().describe('Dönemle kesişen rapor sayısı'),
  awaitingNoticeCount: z.number().int().describe('İşverene bildirildi işareti olmayan rapor'),
  awaitingSgkCount: z.number().int().describe('SGK onayı işareti olmayan rapor'),
})

export const medicalReportSummaryResponse = z.object({
  data: z.array(summaryRowSchema),
  meta: z.object({ ...pageMetaSchema.shape, period: periodSchema }),
})

const fromQuery = daySchema
  .optional()
  .describe('Dönem başı (YYYY-MM-DD); verilmezse bugünün ayı (Europe/Istanbul)')
const toQuery = daySchema
  .optional()
  .describe('Dönem sonu (YYYY-MM-DD, dahil); verilmezse dönem başının ay sonu. En çok 366 gün')

export const medicalReportListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  membershipId: z.string().trim().min(1).max(100).optional().describe('Yalnız bu personel'),
  from: fromQuery,
  to: toQuery,
  reportType: z.enum(MEDICAL_REPORT_TYPES).optional().describe('Rapor türü'),
  state: z
    .enum(['active', 'cancelled'])
    .optional()
    .describe('`active` (varsayılan) iptal edilmemiş, `cancelled` iptal edilmiş raporlar'),
})

export const medicalReportSummaryQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Personel adında arama'),
  status: z
    .enum(['active', 'passive'])
    .optional()
    .describe('`active` etkin, `passive` pasifleştirilmiş (ayrılan) personel'),
  from: fromQuery,
  to: toQuery,
  withReports: z
    .enum(['true', 'false'])
    .optional()
    .describe('`true` yalnız dönemde raporu olan personel; varsayılan bütün personel'),
})

export const medicalReportParams = z.object({ reportId: z.uuid('Rapor geçersiz.') })
