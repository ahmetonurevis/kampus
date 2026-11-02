import { z } from 'zod'

import {
  createQuizSchema,
  submitQuizSchema,
  updateQuizSchema,
} from '@kampus/school-core/lib/quiz.ts'

import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'

/**
 * Quiz uçlarının şemaları (IST-095; docs/domain/akademik-olcme.md DOM-AKD-075…079). Gövdeler core
 * işlem şemalarıdır (`lib/quiz.ts`), katıdır (bilinmeyen alan, ör. istemcinin `score`'u, 400).
 * Yanıt beyaz listedir ve role özgüdür: cevap anahtarı (`answerKey`: doğru şık ve çözüm
 * açıklaması) yalnız yönetici ve öğretmen şemasında tanımlıdır; öğrenci ve veli şemasında alan
 * yoktur ve serileştirici onu düşürür (DOM-AKD-078). Soru bazında doğru/yanlış hiçbir şemada yok.
 */

const identifier = z.string().min(1).max(200)
const instant = z.string().describe('ISO 8601 UTC')

export const quizParamsSchema = z.object({
  quizId: identifier.describe('Quiz kimliği'),
})

export const QUIZ_STATUSES = ['open', 'closed'] as const
export const QUIZ_STATUS_FILTERS = ['all', ...QUIZ_STATUSES] as const

export const quizListQuerySchema = pageQuerySchema
  .extend({
    classId: identifier.optional().describe('Sınıf'),
    subjectId: identifier.optional().describe('Ders'),
    status: z
      .enum(QUIZ_STATUS_FILTERS)
      .default('all')
      .describe(
        '`open` son tarihi gelmemiş ya da son tarihsiz, `closed` son tarihi geçmiş quizler',
      ),
  })
  .strict()

export const createQuizBodySchema = createQuizSchema
export const updateQuizBodySchema = updateQuizSchema
export const submitQuizBodySchema = submitQuizSchema

const version = z.number().int().min(1).describe('Kaydın sürümü; yazmada `If-Match`')

export const quizSchema = z
  .object({
    id: z.string(),
    version,
    classId: z.string(),
    subjectId: z.string(),
    subject: z.string().describe('Dersin adı (kayıt anındaki)'),
    teacherId: z.string().describe('Quizin öğretmeni (sınıfın o dersine atanmış öğretmen)'),
    title: z.string(),
    duration: z.number().int().describe('Çözme süresi (dakika); deneme başlatılınca işler'),
    dueDate: instant.nullable().describe('Deneme başlatmanın son anı; `null` süresiz açık'),
    questionIds: z.array(z.string()).describe('Soru bankası kimlikleri, quizdeki sırayla'),
    questionCount: z.number().int().min(0),
    status: z.enum(QUIZ_STATUSES).describe('Türetilir: son tarih geçtiyse `closed`'),
    createdAt: instant.nullable(),
    updatedAt: instant.describe('Kaydın son değiştiği an'),
  })
  .meta({ id: 'Quiz' })

export const quizStatisticsSchema = z
  .object({
    started: z.number().int().min(0).describe('Deneme başlatan öğrenci sayısı'),
    scored: z.number().int().min(0).describe('Sonuçlanmış (gönderilmiş ya da süresi dolmuş)'),
    inProgress: z.number().int().min(0).describe('Süresi işleyen deneme sayısı'),
    average: z
      .number()
      .int()
      .nullable()
      .describe('Sonuçlanmış denemelerin cevaplardan hesaplanan ortalaması; deneme yoksa `null`'),
  })
  .describe('Deneme özeti (DOM-AKD-079); saklanmaz, her okumada hesaplanır')
  .meta({ id: 'QuizStatistics' })

export const quizResultSchema = z
  .object({
    score: z.number().int().describe('0–100 puan; resmî not değildir (DOM-AKD-060)'),
    correctCount: z.number().int().min(0).describe('Doğru cevap sayısı'),
    total: z.number().int().min(0).describe('Soru sayısı'),
    topicScores: z
      .array(z.object({ topic: z.string(), score: z.number().int() }))
      .describe('Konu başına yüzde'),
  })
  .describe('Cevaplardan sunucuda hesaplanan sonuç (DOM-AKD-078)')
  .meta({ id: 'QuizResult' })

export const quizAttemptSchema = z
  .object({
    id: z.string(),
    quizId: z.string(),
    studentId: z.string(),
    status: z
      .enum(['in_progress', 'expired', 'completed'])
      .describe('`in_progress` süresi işleyen, `expired` süresinde gönderilmemiş (0) deneme'),
    startedAt: instant.nullable(),
    expiresAt: instant.nullable().describe('Gönderimin son anı (60 sn ağ payı ayrıca kabul)'),
    submittedAt: instant.nullable(),
    answers: z
      .record(z.string(), z.number().int())
      .describe('Öğrencinin seçtiği şıklar (soru → şık sırası); süre işlerken boş'),
    result: quizResultSchema.nullable().describe('Süre işlerken `null`'),
  })
  .meta({ id: 'QuizAttempt' })

export const quizQuestionSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    options: z.array(z.string()),
    topic: z.string(),
  })
  .describe('Cevap anahtarsız soru')
  .meta({ id: 'QuizQuestion' })

export const quizAnswerKeySchema = z
  .object({
    questionId: z.string(),
    answer: z.number().int().describe('Doğru şıkkın sırası (0’dan)'),
    explanation: z.string().optional().describe('Çözüm açıklaması'),
  })
  .meta({ id: 'QuizAnswerKey' })

export const quizListItemSchema = quizSchema
  .extend({
    statistics: quizStatisticsSchema
      .nullable()
      .describe('Yönetici ve öğretmende deneme özeti; öğrenci ve velide `null`'),
    attempts: z
      .array(quizAttemptSchema)
      .describe('Öğrencide kendi, velide çocuğunun denemesi; yönetici ve öğretmende boş'),
  })
  .meta({ id: 'QuizListItem' })

const studentAttemptsField = z
  .array(quizAttemptSchema)
  .describe('Öğrencide kendi, velide çocuğunun denemesi')

/** Öğrenci ve veli ayrıntısı: anahtar ve sınıf ortalaması yok (DOM-AKD-078, DOM-AKD-079). */
export const quizPersonalDetailSchema = quizSchema
  .extend({
    statistics: z.null(),
    questions: z
      .array(quizQuestionSchema)
      .nullable()
      .describe(
        'Öğrenci denemeyi başlatınca, veli çocuğunun denemesi sonuçlanınca; aksi halde `null`',
      ),
    attempts: studentAttemptsField,
  })
  .meta({ id: 'QuizPersonalDetail' })

/** Yönetici ve öğretmen ayrıntısı: cevap anahtarı, bütün görünen denemeler ve özet. */
export const quizStaffDetailSchema = quizSchema
  .extend({
    statistics: quizStatisticsSchema,
    questions: z.array(quizQuestionSchema).nullable(),
    answerKey: z
      .array(quizAnswerKeySchema)
      .describe('Doğru şık ve çözüm açıklaması; yalnız yönetici ve öğretmen'),
    attempts: z
      .array(quizAttemptSchema.extend({ studentName: z.string().nullable() }))
      .describe('Görünen denemeler, başlangıç anına göre'),
  })
  .meta({ id: 'QuizStaffDetail' })

export const quizStartSchema = z
  .object({
    attempt: quizAttemptSchema,
    questions: z.array(quizQuestionSchema).describe('Cevap anahtarsız sorular'),
  })
  .meta({ id: 'QuizStart' })

export const quizResponseSchema = dataResponse(quizSchema)
export const quizListResponseSchema = pageResponse(quizListItemSchema)
export const quizStaffDetailResponseSchema = dataResponse(quizStaffDetailSchema)
export const quizPersonalDetailResponseSchema = dataResponse(quizPersonalDetailSchema)
/** OpenAPI: iki görünüm; personel şeması önce (anahtar alanı zorunlu, öğrenci gövdesi eşleşmez). */
export const quizDetailResponseSchema = dataResponse(
  z.union([quizStaffDetailSchema, quizPersonalDetailSchema]),
)
export const quizStartResponseSchema = dataResponse(quizStartSchema)
export const quizAttemptResponseSchema = dataResponse(quizAttemptSchema)
