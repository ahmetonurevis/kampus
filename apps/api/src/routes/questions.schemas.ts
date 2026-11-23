import { z } from 'zod'

/** Öğretmenime Sor uçlarının yol şemaları; gövde şemaları core'dadır (`lib/questions.ts`). */

export const questionParamsSchema = z.object({
  questionId: z.string().min(1).max(200).describe('Soru kimliği'),
})
