import { z } from 'zod'

import { answerKeySchema, questionBodySchema } from '@kampus/school-core/content/resource.ts'
import { answersSchema } from '@kampus/school-core/skills/scoring.ts'

import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'

/**
 * Otomatik puanlı görev denemelerinin şemaları (ADR 0004 karar 5, 6; DOM-BEC-010, 042…045).
 * Cevap gövdesi core `answersSchema`'dır. Gövdeler katıdır: istemcinin gönderdiği puan, teslim
 * anı veya durum alanı 400 alır; puan sunucuda cevaplardan hesaplanır ve saklanmaz.
 */

const id = z.uuid()
const instant = z.iso.datetime()

export const taskAttemptParamsSchema = z.object({
  attemptId: id.describe('Deneme kimliği'),
})

export const taskAttemptAssignmentParamsSchema = z.object({
  assignmentId: id.describe('Atama kimliği'),
})

export const taskAttemptListQuerySchema = pageQuerySchema
  .extend({
    assignmentId: id.describe('Atama (zorunlu)'),
    learnerId: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('Kursiyer süzgeci; okuma kapsamı dışındaki kursiyer boş liste verir'),
  })
  .strict()

export const taskAttemptStartBodySchema = z.strictObject({})

export const taskAttemptAnswersBodySchema = z.strictObject({
  answers: answersSchema.describe('Kaydedilecek cevaplar; yalnız gönderilen sorular güncellenir'),
})

export const taskAttemptSubmitBodySchema = z.strictObject({
  answers: answersSchema
    .optional()
    .describe('Teslimle birlikte kaydedilecek son cevaplar; süre dolduysa alınmaz'),
})

const itemScoreSchema = z
  .object({
    questionVersionId: z.string(),
    parts: z.number().int(),
    correctParts: z.number().int(),
    answered: z.boolean(),
    points: z.number(),
    earned: z.number(),
  })
  .meta({ id: 'TaskAttemptItemScore' })

const resultSchema = z
  .object({
    earned: z.number().describe('Kazanılan puan (iki ondalık)'),
    possible: z.number(),
    percent: z.number().int().describe('100 üzerinden puan'),
    items: z
      .array(itemScoreSchema)
      .nullable()
      .describe('Madde sonuçları; kursiyer ve veli yalnız anahtar açılınca görür (DOM-BEC-045)'),
    answerKey: z
      .array(z.object({ questionVersionId: z.string(), answerKey: answerKeySchema }))
      .nullable()
      .describe('Doğru cevaplar ve açıklamalar; yalnız anahtar açılınca (DOM-BEC-045)'),
  })
  .meta({ id: 'TaskAttemptResult' })

const attemptShape = {
  id,
  assignmentId: id,
  learnerId: z.string(),
  attemptNumber: z.number().int().min(1),
  status: z
    .enum(['in_progress', 'submitted', 'expired'])
    .describe('Süren, teslim edilmiş veya süresi dolmuş (kaydedilmiş cevaplarla teslim sayılır)'),
  startedAt: instant,
  endsAt: instant.nullable().describe('Süre ve teslim kapanışından erken olanı; yoksa `null`'),
  remainingMs: z.number().int().nullable(),
  completedAt: instant.nullable(),
  autoSubmitted: z.boolean().describe('Süre dolduğu için kaydedilmiş cevaplarla teslim sayıldı'),
  late: z.boolean().describe('Son teslimden sonra, geç kabul süresinde tamamlandı'),
  counted: z.boolean().describe('Sayılan deneme (DOM-BEC-042); alıştırmada hep `false`'),
  answers: answersSchema,
  result: resultSchema
    .nullable()
    .describe('Süren denemede ve kursiyer görünümünde tamamlanmadan `null`'),
  rowVersion: z
    .number()
    .int()
    .min(1)
    .describe('Deneme satırının iyimser kilit sürümü (cevap kaydı ve teslimde `If-Match`)'),
}

const taskAttemptSchema = z.object(attemptShape).meta({ id: 'TaskAttempt' })

const taskAttemptDetailSchema = z
  .object({
    ...attemptShape,
    questions: z
      .array(
        z.object({
          questionVersionId: z.string(),
          points: z.number(),
          question: questionBodySchema,
        }),
      )
      .describe('Denemenin soruları; anahtar ve açıklama yoktur, seçenekler denemeye göre karışık'),
  })
  .meta({ id: 'TaskAttemptDetail' })

export const taskAttemptListResponseSchema = pageResponse(taskAttemptSchema)
export const taskAttemptDetailResponseSchema = dataResponse(taskAttemptDetailSchema)
