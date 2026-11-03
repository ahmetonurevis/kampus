import { z } from 'zod'

import {
  learningOutcomeCodeSchema,
  learningOutcomeInputSchema,
  learningOutcomeSourceSchema,
} from '@kampus/school-core/content/outcomes.ts'
import { GRADE_LEVEL_RANGE } from '@kampus/school-core/content/taxonomy.ts'

import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'

/**
 * Kazanım kataloğu uçlarının şemaları (ADR 0004 karar 9; DOM-KYN-011). Ekleme gövdesi core
 * `learningOutcomeInputSchema`'dır; kod büyük harfe çevrilir.
 */

/** `codes` sorgusunda en çok kod sayısı (bir içeriğin kazanım sınırının üstünde). */
export const LEARNING_OUTCOME_CODES_MAX = 50

export const learningOutcomeListQuerySchema = pageQuerySchema
  .extend({
    subject: z.string().trim().min(1).max(200).optional().describe('Ders kimliği (ör. `math`)'),
    level: z.coerce
      .number()
      .int()
      .min(GRADE_LEVEL_RANGE.min)
      .max(GRADE_LEVEL_RANGE.max)
      .optional()
      .describe('Sınıf düzeyi (5–12)'),
    q: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe('Kodda veya adda arama; Türkçe harf ve büyük/küçük harf duyarsız, joker yok'),
    source: learningOutcomeSourceSchema
      .optional()
      .describe('Katalog: `platform` öğretim programı, `institution` kurum kazanımı; yoksa ikisi'),
    codes: z
      .string()
      .trim()
      .min(1)
      .max(LEARNING_OUTCOME_CODES_MAX * 41)
      .transform((value, ctx) => {
        const codes = [
          ...new Set(
            value
              .split(',')
              .map((code) => code.trim().toUpperCase())
              .filter((code) => code !== ''),
          ),
        ]
        if (codes.length === 0 || codes.length > LEARNING_OUTCOME_CODES_MAX)
          ctx.addIssue({
            code: 'custom',
            message: `En az 1, en çok ${LEARNING_OUTCOME_CODES_MAX} kod verilebilir.`,
          })
        return codes
      })
      .optional()
      .describe(
        `Virgülle ayrılmış kodlar (en çok ${LEARNING_OUTCOME_CODES_MAX}); verilirse yalnız bu kodlar döner ve arşivliler de dahildir (mevcut içerikteki kazanımın adı ve arşiv durumu için)`,
      ),
  })
  .strict()

export const learningOutcomeParamsSchema = z.object({
  code: learningOutcomeCodeSchema.describe('Kurum kazanımının kodu'),
})

const learningOutcomeSchema = z
  .object({
    source: learningOutcomeSourceSchema,
    code: z.string(),
    name: z.string(),
    subjectId: z.string(),
    gradeLevel: z.number().int(),
    programVersion: z
      .string()
      .nullable()
      .describe('Öğretim programı sürümü; yalnız platform satırında dolu'),
    archivedAt: z.iso.datetime().nullable(),
    rowVersion: z
      .number()
      .int()
      .min(1)
      .describe('Satır sürümü; arşivde `If-Match` (yalnız kurum kazanımında anlamlı)'),
  })
  .meta({ id: 'LearningOutcome' })

export const learningOutcomeListResponseSchema = pageResponse(learningOutcomeSchema)
export const learningOutcomeResponseSchema = dataResponse(learningOutcomeSchema)

export const learningOutcomeBodySchema = learningOutcomeInputSchema
export const learningOutcomeCommandBodySchema = z.strictObject({})
