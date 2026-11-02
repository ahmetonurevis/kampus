import { z } from 'zod'

import { workflowSchemas } from '@kampus/school-core/lib/school-workflows.ts'

import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'

/**
 * Ders programı uçlarının şemaları (IST-094; docs/domain/yetki-ve-kapsam.md DOM-YTK-068,
 * DOM-YTK-069). Gövdeler core iş akışı şemalarıdır (`workflowSchemas`), API'de katıdır
 * (bilinmeyen alan 400). Yanıt beyaz listedir: iptal ve görevlendirme gerekçesi yalnız
 * yöneticiye döner (core `PLATFORM_HIDDEN_FIELDS`).
 */

const identifier = z.string().min(1).max(200)

export const lessonParamsSchema = z.object({
  lessonId: identifier.describe('Ders kimliği'),
})

export const LESSON_STATUSES = ['planned', 'substituted', 'cancelled'] as const
export const LESSON_CANCELLED_FILTERS = ['false', 'true', 'all'] as const

const day = (edge: string) =>
  z.iso
    .date()
    .optional()
    .describe(`Ders başlangıcının Europe/Istanbul günü için ${edge} (\`YYYY-MM-DD\`, dahil)`)

export const lessonListQuerySchema = pageQuerySchema
  .extend({
    dateFrom: day('başlangıç'),
    dateTo: day('bitiş'),
    classId: identifier.optional().describe('Sınıf'),
    teacherId: identifier
      .optional()
      .describe('Dersi veren öğretmen (yedek atandıysa yedek; asıl öğretmen değil)'),
    room: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .optional()
      .describe('Derslik; baştaki/sondaki boşluk ve Türkçe büyük/küçük harf duyarsız eşitlik'),
    cancelled: z
      .enum(LESSON_CANCELLED_FILTERS)
      .default('false')
      .describe(
        'İptal süzgeci. Varsayılan `false`: iptal edilen ders günlük programda görünmez. `true` yalnız iptal edilenler, `all` ikisi birlikte (iptal geçmişi korunur)',
      ),
  })
  .strict()
  .refine((query) => !query.dateFrom || !query.dateTo || query.dateFrom <= query.dateTo, {
    path: ['dateTo'],
    message: 'Bitiş günü başlangıç gününden önce olamaz.',
  })

export const createLessonBodySchema = workflowSchemas.lesson.strict()

export const updateLessonBodySchema = workflowSchemas.lesson
  .partial()
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'En az bir alan gönderin.',
  })

export const substituteLessonBodySchema = workflowSchemas.substitute.strict()
export const cancelLessonBodySchema = workflowSchemas['lesson-cancel'].strict()

const instant = z.string().describe('ISO 8601 UTC')

export const lessonSubstitutionSchema = z
  .object({
    fromTeacherId: z.string(),
    toTeacherId: z.string(),
    reason: z.string(),
    date: instant.describe('Görevlendirmenin yapıldığı an'),
  })
  .meta({ id: 'LessonSubstitution' })

export const lessonSchema = z
  .object({
    id: z.string(),
    version: z.number().int().min(1).describe('Kaydın sürümü; yazmada `If-Match`'),
    classId: z.string(),
    subjectId: z.string(),
    title: z.string().nullable().describe('Ders adı; eski kayıtta boş olabilir'),
    teacherId: z.string().describe('Dersi veren öğretmen; yedek atandıysa yedek'),
    originalTeacherId: z
      .string()
      .nullable()
      .describe('Yedek atandıysa asıl öğretmen; kalıcı branş ataması değişmez'),
    date: instant.describe('Ders başlangıcı, ISO 8601 UTC'),
    duration: z.number().int().describe('Dakika'),
    room: z.string().describe('Derslik'),
    status: z
      .enum(LESSON_STATUSES)
      .describe('Türetilir: `cancelled` iptal, `substituted` yedek atanmış, `planned` diğerleri'),
    cancelledAt: instant.nullable(),
    cancelReason: z
      .string()
      .nullable()
      .optional()
      .describe('İptal gerekçesi; yalnız yöneticiye döner'),
    substitutions: z
      .array(lessonSubstitutionSchema)
      .optional()
      .describe('Görevlendirme geçmişi (gerekçe dahil); yalnız yöneticiye döner'),
    updatedAt: instant.describe('Kaydın son değiştiği an'),
  })
  .meta({ id: 'Lesson' })

export const lessonResponseSchema = dataResponse(lessonSchema)
export const lessonListResponseSchema = pageResponse(lessonSchema)
