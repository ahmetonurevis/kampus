import { z } from 'zod'

import { OUTCOME_SOURCES, PRIMARY_SKILLS, enumKeys } from '@kampus/school-core/content/taxonomy.ts'

import { dataResponse } from './common.schemas.ts'

/**
 * Alıştırma not defteri şemaları (OG-085, IST-056; DOM-BEC-048). Hücreler madde puanlarının
 * toplamıdır; her okumada hesaplanır, saklanmaz.
 */

export const practiceGradebookQuerySchema = z
  .object({
    targetId: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('Hedef süzgeci: sınıf/şube, dil grubu ya da öğrenci hedefi kimliği'),
  })
  .strict()

const tally = {
  items: z.number().int().min(0).describe('Madde sayısı (deneme × madde)'),
  earned: z.number().describe('Kazanılan puan (iki ondalık)'),
  possible: z.number(),
  percent: z.number().int().describe('100 üzerinden puan'),
}

const unitSchema = z.object({
  number: z.number().int().min(1),
  title: z.string().nullable(),
})

const breakdownShape = {
  sets: z
    .number()
    .int()
    .min(0)
    .describe(
      'Sonuç sayısı (kursiyer × alıştırma); kursiyer satırında sonuç giren alıştırma sayısı',
    ),
  overall: z.object(tally).describe('Bütün maddeler'),
  units: z
    .array(z.object({ ...unitSchema.shape, sets: z.number().int().min(1), ...tally }))
    .describe('Ünite kırılımı, numara sırasıyla; ünitesiz set yalnız genel toplamdadır'),
  skills: z
    .array(z.object({ skill: z.enum(PRIMARY_SKILLS), ...tally }))
    .describe(
      'Beceri kırılımı (madde etiketi, yoksa setin), taksonomi sırasıyla (okuma, dinleme, …)',
    ),
  outcomes: z
    .array(
      z.object({
        outcomeSource: z.enum(enumKeys(OUTCOME_SOURCES)),
        outcomeId: z.string(),
        ...tally,
      }),
    )
    .describe('Kazanım kırılımı (madde etiketi, yoksa setin), kaynak ve kimlik sırasıyla'),
}

const practiceGradebookSchema = z
  .object({
    assignments: z
      .array(
        z.object({
          id: z.uuid(),
          title: z.string(),
          unit: unitSchema.nullable(),
          learners: z.number().int().min(0).describe('Tamamlanmış denemesi olan kursiyer sayısı'),
        }),
      )
      .describe('Not defterine giren alıştırma atamaları, en yeni önce'),
    learners: z
      .array(
        z.object({
          learnerId: z.string(),
          learnerName: z
            .string()
            .nullable()
            .describe('Öğrencinin adı: yöneticide her öğrenci, öğretmende kapsamındakiler'),
          ...breakdownShape,
        }),
      )
      .describe('Kursiyer başına kırılım, kimlik sırasıyla'),
    totals: z.object(breakdownShape).describe('Bütün kursiyerlerin toplamı'),
    truncated: z
      .boolean()
      .describe('Görülen alıştırma ataması sınırı (100) aştı; en yeniler okundu'),
  })
  .meta({ id: 'PracticeGradebook' })

export const practiceGradebookResponseSchema = dataResponse(practiceGradebookSchema)
