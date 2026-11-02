import { z } from 'zod'

import {
  assignHomeworkSchema,
  gradeSubmissionSchema,
  submitHomeworkSchema,
  updateHomeworkSchema,
} from '@kampus/school-core/lib/homework.ts'

import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'

/**
 * Ödev uçlarının şemaları (IST-095; docs/domain/akademik-olcme.md DOM-AKD-070…074). Gövdeler core
 * işlem şemalarıdır (`lib/homework.ts`), katıdır (bilinmeyen alan 400). Yanıt beyaz listedir.
 */

const identifier = z.string().min(1).max(200)
const instant = z.string().describe('ISO 8601 UTC')

export const homeworkParamsSchema = z.object({
  homeworkId: identifier.describe('Ödev kimliği'),
})
export const submissionParamsSchema = homeworkParamsSchema.extend({
  submissionId: identifier.describe('Teslim kimliği'),
})

export const HOMEWORK_STATUSES = ['open', 'closed'] as const
export const HOMEWORK_STATUS_FILTERS = ['all', ...HOMEWORK_STATUSES] as const

const day = (edge: string) =>
  z.iso
    .date()
    .optional()
    .describe(`Son teslim anının Europe/Istanbul günü için ${edge} (\`YYYY-MM-DD\`, dahil)`)

export const homeworkListQuerySchema = pageQuerySchema
  .extend({
    classId: identifier.optional().describe('Sınıf'),
    subjectId: identifier.optional().describe('Ders'),
    status: z
      .enum(HOMEWORK_STATUS_FILTERS)
      .default('all')
      .describe('`open` son teslim anı gelmemiş, `closed` geçmiş ödevler; varsayılan `all`'),
    dateFrom: day('başlangıç'),
    dateTo: day('bitiş'),
  })
  .strict()
  .refine((query) => !query.dateFrom || !query.dateTo || query.dateFrom <= query.dateTo, {
    path: ['dateTo'],
    message: 'Bitiş günü başlangıç gününden önce olamaz.',
  })

export const createHomeworkBodySchema = assignHomeworkSchema
export const updateHomeworkBodySchema = updateHomeworkSchema
export const submitHomeworkBodySchema = submitHomeworkSchema
export const gradeSubmissionBodySchema = gradeSubmissionSchema

const version = z.number().int().min(1).describe('Kaydın sürümü; yazmada `If-Match`')

export const homeworkSchema = z
  .object({
    id: z.string(),
    version,
    classId: z.string(),
    subjectId: z.string(),
    subject: z.string().describe('Dersin adı (kayıt anındaki)'),
    teacherId: z.string().describe('Ödevin öğretmeni (sınıfın o dersine atanmış öğretmen)'),
    title: z.string(),
    description: z.string(),
    dueDate: instant.describe('Son teslim anı, ISO 8601 UTC'),
    allowLate: z
      .boolean()
      .describe('Son teslim anından sonra teslim geç işaretiyle kabul edilir mi'),
    status: z.enum(HOMEWORK_STATUSES).describe('Türetilir: son teslim anı geçtiyse `closed`'),
    createdAt: instant.nullable(),
    updatedAt: instant.describe('Kaydın son değiştiği an'),
  })
  .meta({ id: 'Homework' })

export const submissionCountsSchema = z
  .object({
    submitted: z.number().int().min(0),
    graded: z.number().int().min(0),
    late: z.number().int().min(0),
  })
  .describe('Okuyanın görebildiği teslimlerin sayıları (öğrenci ve velide yalnız kendi teslimi)')
  .meta({ id: 'HomeworkSubmissionCounts' })

export const submissionSchema = z
  .object({
    id: z.string(),
    version,
    homeworkId: z.string(),
    studentId: z.string(),
    // kvkk: Ç — öğrencinin teslim metni.
    note: z.string(),
    fileIds: z.array(z.string()).describe('Teslime bağlı dosyalar (`GET /files/:fileId`)'),
    fileName: z.string().describe('İlk dosyanın özgün adı; eski kayıtlarda tek dosya adı'),
    submittedAt: instant,
    late: z.boolean().describe('Son teslim anından sonra mı teslim edildi'),
    score: z.number().int().nullable().describe('0–100 puan; resmî not değildir'),
    // kvkk: Ç — öğretmenin geri bildirimi.
    feedback: z.string(),
    gradedAt: instant.nullable(),
    updatedAt: instant.describe('Kaydın son değiştiği an'),
  })
  .meta({ id: 'HomeworkSubmission' })

export const homeworkListItemSchema = homeworkSchema
  .extend({ submissionCounts: submissionCountsSchema })
  .meta({ id: 'HomeworkListItem' })

export const homeworkDetailSchema = homeworkListItemSchema
  .extend({
    submissions: z
      .array(submissionSchema)
      .describe('Okuyanın görebildiği teslimler, teslim anına göre'),
  })
  .meta({ id: 'HomeworkDetail' })

export const homeworkResponseSchema = dataResponse(homeworkSchema)
export const homeworkDetailResponseSchema = dataResponse(homeworkDetailSchema)
export const homeworkListResponseSchema = pageResponse(homeworkListItemSchema)
export const submissionResponseSchema = dataResponse(submissionSchema)
