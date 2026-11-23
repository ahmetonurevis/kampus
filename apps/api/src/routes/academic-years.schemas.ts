import { z } from 'zod'

import {
  academicTermInputSchema,
  ACADEMIC_YEAR_MAX,
  ACADEMIC_YEAR_MIN,
  ACADEMIC_YEAR_STATUSES,
  createAcademicYearSchema,
  updateAcademicTermSchema,
  updateAcademicYearSchema,
} from '@kampus/school-core/lib/academic-years.ts'

import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'

/**
 * Eğitim yılı ve dönemi (IST-011; DOM-YTK-063…067). Gövdeler core şemalarıdır (katı). Yanıtta
 * personel alanları (`status`, işlem anları, `rowVersion`, `updatedAt`, dönem `id`) isteğe
 * bağlıdır: öğrenci ve veli yalnız ad, tarih ve etkinlik bilgisini alır (`academicYearView`).
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const academicYearParamsSchema = z.object({
  startYear: z.coerce
    .number()
    .int()
    .min(ACADEMIC_YEAR_MIN)
    .max(ACADEMIC_YEAR_MAX)
    .describe('Eğitim yılının başlangıç yılı (2026 → 2026–2027)'),
})

export const academicTermParamsSchema = academicYearParamsSchema.extend({
  termId: z.uuid().describe('Dönem kimliği'),
})

export const academicYearListQuerySchema = pageQuerySchema.strict()

export const createAcademicYearBodySchema = createAcademicYearSchema
export const updateAcademicYearBodySchema = updateAcademicYearSchema
export const academicTermBodySchema = academicTermInputSchema
export const updateAcademicTermBodySchema = updateAcademicTermSchema

export const academicTermSchema = z
  .object({
    id: z.uuid().optional().describe('Dönem kimliği; yalnız personele döner'),
    name: z.string(),
    sequence: z.number().int().min(1).describe('Yıl içindeki sıra; başlangıç gününden hesaplanır'),
    startDate: day,
    endDate: day,
  })
  .meta({ id: 'AcademicTerm' })

export const academicYearSchema = z
  .object({
    startYear: z.number().int().describe('Başlangıç yılı; tarife ve sözleşmedeki `academicYear`'),
    name: z.string().describe('Gösterim adı, ör. `2026–2027`'),
    startDate: day,
    endDate: day,
    isActive: z.boolean().describe('Kurumun etkin yılı mı (en çok bir yıl)'),
    status: z
      .enum(ACADEMIC_YEAR_STATUSES)
      .optional()
      .describe('`planned`, `active`, `closed`; yalnız personele döner'),
    activatedAt: z.iso.datetime().nullable().optional().describe('Yalnız personele döner'),
    closedAt: z.iso.datetime().nullable().optional().describe('Yalnız personele döner'),
    rowVersion: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Yıl ve dönemlerinin ortak sürümü; yazmada `If-Match`. Yalnız personele döner'),
    updatedAt: z.iso.datetime().optional().describe('Yalnız personele döner'),
    terms: z.array(academicTermSchema).describe('Dönemler, gün sırasıyla'),
  })
  .meta({ id: 'AcademicYear' })

export const academicYearResponseSchema = dataResponse(academicYearSchema)
export const academicYearListResponseSchema = pageResponse(academicYearSchema)

export const currentAcademicPeriodResponseSchema = dataResponse(
  z
    .object({
      date: day.describe('Bugün (Europe/Istanbul)'),
      year: academicYearSchema
        .nullable()
        .describe('Günün eğitim yılı; yoksa etkin yıl; o da yoksa `null`'),
      term: academicTermSchema.nullable().describe('Günün dönemi; tatilde ve yıl dışında `null`'),
    })
    .meta({ id: 'CurrentAcademicPeriod' }),
)
