import { z } from 'zod'

import { PROSPECT_LOST_REASONS } from '@kampus/school-core/lib/prospects.ts'

/** Aday uçlarının yol şemaları; gövde şemaları core'dadır (`lib/prospects.ts`). */

export const prospectParamsSchema = z.object({
  prospectId: z.string().min(1).max(200).describe('Aday kimliği'),
})

export const prospectLossBreakdownSchema = z.object({
  total: z.number().int().describe('Vazgeçen aday sayısı'),
  reasons: z
    .array(
      z.object({
        reason: z
          .enum(PROSPECT_LOST_REASONS)
          .nullable()
          .describe('Vazgeçme nedeni; nedeni olmayan eski kayıtta `null`'),
        count: z.number().int(),
      }),
    )
    .describe('Neden başına aday sayısı, çoktan aza'),
  institutions: z
    .array(z.object({ name: z.string(), count: z.number().int() }))
    .describe(
      'Tercih edilen kurum başına aday sayısı, çoktan aza, en çok 50 satır; yazım farkı aynı kurum sayılır',
    ),
  otherInstitutions: z.number().int().describe('Listeye sığmayan kurumlara giden aday sayısı'),
  unnamed: z.number().int().describe('Tercih ettiği kurum yazılmamış aday sayısı'),
})
