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

/**
 * `codes` sorgusu içerikte kayıtlı bağları çözer: bir sürüm en çok 20 kazanım taşır ve eski
 * serbest kod 200 karaktere kadar olabilir (core `resourceTagsSchema`). Kod içerikteki gibi
 * birebir aranır; kaynak yazımının katalog denetimi (`catalogRowsFor`) de birebirdir.
 */
export const LEARNING_OUTCOME_CODES_MAX = 20
const outcomeRefCode = z.string().trim().min(1).max(200)

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
      .union([outcomeRefCode.transform((code) => [code]), z.array(outcomeRefCode)])
      .refine((codes) => codes.length <= LEARNING_OUTCOME_CODES_MAX, {
        message: `En çok ${String(LEARNING_OUTCOME_CODES_MAX)} kod verilebilir.`,
      })
      .transform((codes) => [...new Set(codes)])
      .optional()
      .describe(
        `Kod; tekrarlanabilir (\`codes=A&codes=B\`, en çok ${String(LEARNING_OUTCOME_CODES_MAX)}). Verilirse yalnız bu kodlar birebir (büyük/küçük harf dönüşümü yok, içerikteki bağla aynı) ve arşivliler dahil döner; mevcut içerikteki kazanımın adı ve arşiv durumu için`,
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
