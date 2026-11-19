import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  STAFFING_POSITION_STATUSES,
  staffingYearSchema,
} from '@kampus/school-core/lib/finance-staffing-plans.ts'

import { dataResponse } from './common.schemas.ts'

/** Kadro planı ve açık pozisyon şemaları (DOM-FIN-126; ON-188). */

export const staffingPlanParams = z.object({
  academicYear: staffingYearSchema.describe('Eğitim yılının başlangıç yılı (2026 = 2026-2027)'),
})

export const staffingPlanQuery = z.strictObject({
  weekOf: daySchema
    .optional()
    .describe(
      'Ders programı önerisinin haftası: bu günün pazartesi–pazar haftası (varsayılan bugün)',
    ),
})

export const staffingPositionParams = z.object({ positionId: z.uuid('Pozisyon geçersiz.') })

const line = z.object({ subjectId: z.string(), requiredHours: z.number().int() })

const planFields = {
  academicYear: z.number().int(),
  normHours: z.number().int().describe('Tam zamanlı öğretmen başına haftalık zorunlu ders saati'),
  lines: z.array(line).describe('Elle girilen branş ihtiyaç saatleri'),
  version: z.number().int().describe('`If-Match` için plan sürümü (hiç kaydedilmediyse 1)'),
  updatedAt: z.string().nullable(),
}

export const staffingPlanSavedResponse = dataResponse(z.object(planFields))

const position = z.object({
  id: z.string(),
  academicYear: z.number().int(),
  subjectId: z.string(),
  hours: z.number().int().describe('Haftalık ders saati'),
  status: z
    .enum(STAFFING_POSITION_STATUSES)
    .describe('`open` açık, `posted` ilanda, `filled` dolduruldu, `cancelled` iptal'),
  jobOfferId: z.string().nullable().describe('Bağlı iş teklifi (DOM-FIN-121)'),
  jobOfferPosition: z.string().nullable().describe('Bağlı teklifin pozisyon adı'),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
})

export const staffingPositionResponse = dataResponse(position)

const hours = {
  requiredHours: z.number().int().describe('Haftalık ihtiyaç saati'),
  scheduleHours: z.number().int().describe('Ders programından öneri (seçilen hafta)'),
  capacityHours: z.number().int().describe('Tam zamanlı öğretmen × norm (branşlara bölünmüş)'),
  gapHours: z.number().int().describe('Açık: ihtiyaç − kapasite (eksiye düşmez)'),
  surplusHours: z.number().int().describe('Fazla: kapasite − ihtiyaç (eksiye düşmez)'),
  openPositionHours: z.number().int().describe('Açık ya da ilandaki pozisyonların saati'),
  suggestedHours: z.number().int().describe('Önerilen yeni pozisyon saati: açık − pozisyonlar'),
  suggestedFte: z.number().describe('Önerinin tam zamanlı eşdeğeri (saat / norm, onda bir)'),
}

export const staffingPlanResponse = dataResponse(
  z.object({
    ...planFields,
    week: z.object({ startDate: z.string(), endDate: z.string() }),
    rows: z.array(
      z.object({
        subjectId: z.string(),
        subjectName: z.string(),
        requiredSource: z
          .enum(['plan', 'schedule'])
          .describe('`plan` elle girildi, `schedule` plan satırı yok, programdan'),
        fullTimeTeachers: z
          .number()
          .int()
          .describe('Tam zamanlı öğretmen (ücret tanımı aylık ya da yok)'),
        hourlyTeachers: z
          .number()
          .int()
          .describe('Saatlik ya da ders saati ücretli öğretmen (kapasiteye girmez)'),
        ...hours,
      }),
    ),
    totals: z.object(hours),
    teachersWithoutPayRate: z
      .number()
      .int()
      .describe('Yürürlükte ana ücret tanımı olmayan öğretmen (tam zamanlı sayıldı)'),
    positions: z.array(position.extend({ subjectName: z.string() })),
    subjects: z.array(z.object({ id: z.string(), name: z.string() })).describe('Branş seçenekleri'),
  }),
)
