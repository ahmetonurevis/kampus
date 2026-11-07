import { z } from 'zod'

import { CEFR_LEVELS, enumKeys } from '@kampus/school-core/content/taxonomy.ts'
import {
  COURSE_EOZEL_APPROVALS,
  COURSE_LANGUAGES,
  COURSE_SESSION_MINUTES,
  COURSE_SKILL_FOCUS,
  COURSE_STATUSES,
  courseEOzelSchema,
  createCourseSchema,
  updateCourseSchema,
} from '@kampus/school-core/lib/courses.ts'

import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'

/**
 * Dil okulu kur programı (IST-076; DOM-DIL-005…007). Gövdeler core şemalarıdır (katı). Yanıtta
 * personel alanları (`minLearners`, `status`, işlem anları, `eOzel`, `rowVersion`, `updatedAt`)
 * isteğe bağlıdır: öğrenci ve veli yalnız etkin kurun katalog alanlarını alır (`courseView`).
 */

const levelEnum = z.enum(enumKeys(CEFR_LEVELS))
const languageEnum = z.enum(enumKeys(COURSE_LANGUAGES))

export const courseParamsSchema = z.object({ courseId: z.uuid().describe('Kur kimliği') })

export const courseListQuerySchema = pageQuerySchema
  .extend({
    status: z
      .enum(COURSE_STATUSES)
      .optional()
      .describe('Durum süzgeci; verilmezse arşiv dışındakiler (öğrenci ve velide yalnız `active`)'),
    level: levelEnum.optional().describe('CEFR seviyesi'),
    language: languageEnum.optional().describe('Öğretim dili (ISO 639-1)'),
  })
  .strict()

export const createCourseBodySchema = createCourseSchema
export const updateCourseBodySchema = updateCourseSchema
export const courseEOzelBodySchema = courseEOzelSchema

const instant = z.iso.datetime()

export const courseEOzelStateSchema = z
  .object({
    programCode: z.string().nullable().describe('e-Özel kurs programı kodu'),
    approval: z.enum(COURSE_EOZEL_APPROVALS),
    recordedAt: instant.nullable().describe('Kurumun e-Özel kaydını son işaretlediği an'),
    recordedByUserId: z.string().nullable().describe('İşaretleyen kullanıcı'),
  })
  .meta({ id: 'CourseEOzel' })

export const courseSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    language: languageEnum,
    level: levelEnum,
    skillFocus: z.array(z.enum(COURSE_SKILL_FOCUS)).describe('Boş liste genel kurdur'),
    description: z.string().nullable(),
    totalHours: z.number().int().min(1).describe('Toplam ders saati (45 dk)'),
    weeklyHours: z.number().int().min(1),
    sessionMinutes: z.literal(COURSE_SESSION_MINUTES),
    durationWeeks: z
      .number()
      .int()
      .min(1)
      .describe('Toplam ÷ haftalık saat, yukarı yuvarlanır; saklanmaz'),
    maxLearners: z.number().int().min(1),
    certified: z.boolean().describe('Belgeli kurs (MEBBİS Kurs Bitirme Belgesi)'),
    nextCourseId: z
      .uuid()
      .nullable()
      .describe('Seviyeli kursta sonraki kur; öğrenci ve velide yalnız etkinse döner'),
    minLearners: z.number().int().min(1).optional().describe('Yalnız personele döner'),
    status: z.enum(COURSE_STATUSES).optional().describe('Yalnız personele döner'),
    activatedAt: instant.nullable().optional().describe('Yalnız personele döner'),
    archivedAt: instant.nullable().optional().describe('Yalnız personele döner'),
    eOzel: courseEOzelStateSchema.optional().describe('Yalnız personele döner'),
    rowVersion: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Yazmada `If-Match`. Yalnız personele döner'),
    updatedAt: instant.optional().describe('Yalnız personele döner'),
  })
  .meta({ id: 'Course' })

export const courseResponseSchema = dataResponse(courseSchema)
export const courseListResponseSchema = pageResponse(courseSchema)
