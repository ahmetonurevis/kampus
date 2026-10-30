import { z } from 'zod'

/** Aday uçlarının yol şemaları; gövde şemaları core'dadır (`lib/prospects.ts`). */

export const prospectParamsSchema = z.object({
  prospectId: z.string().min(1).max(200).describe('Aday kimliği'),
})
