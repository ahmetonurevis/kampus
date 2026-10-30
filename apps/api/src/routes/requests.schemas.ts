import { z } from 'zod'

/** Talep ve izin/mazeret uçlarının yol şemaları; gövde şemaları core'dadır (`lib/requests.ts`). */

export const requestParamsSchema = z.object({
  requestId: z.string().min(1).max(200).describe('Talep kimliği'),
})
