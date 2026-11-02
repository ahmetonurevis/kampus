import { z } from 'zod'

import { dataResponse } from './common.schemas.ts'

// Kampüs ve kadro ekranlarının toplu ölçüleri (`GET /api/v1/class-metrics`,
// `GET /api/v1/teacher-metrics`; IST-010). Yalnız kimlik ve sayı döner; ad, not ve soru metni yok.

const count = z.number().int().min(0)
const percent = z.number().int().min(0).max(100)

export const metricsQuerySchema = z.object({}).strict()

export const classMetricSchema = z
  .object({
    classId: z.string().describe('Sınıf kimliği'),
    students: count.describe('Sınıftaki aktif öğrenci'),
    gradedStudents: count.describe('Notu olan aktif öğrenci'),
    averageScore: percent
      .nullable()
      .describe(
        'Notu olan öğrencilerin (yuvarlanmamış) not ortalamalarının ortalaması, bir kez yuvarlanmış; not yoksa `null`',
      ),
  })
  .meta({ id: 'ClassMetric' })

export const classMetricsResponseSchema = dataResponse(z.array(classMetricSchema))

export const teacherMetricSchema = z
  .object({
    teacherId: z.string().describe('Öğretmen kimliği'),
    questions: count.describe('Geri çekilmemiş soru'),
    breaches: count.describe('24 saat yanıt hedefini aşan soru'),
    slaRate: percent.describe('Hedefe uyan soru yüzdesi; soru yoksa 100'),
    performance: percent
      .nullable()
      .describe('Yoklama, ödev takibi ve soru süresi uyumunun ortalaması; oran yoksa `null`'),
  })
  .meta({ id: 'TeacherMetric' })

export const teacherMetricsResponseSchema = dataResponse(z.array(teacherMetricSchema))
