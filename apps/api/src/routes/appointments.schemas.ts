import { z } from 'zod'

/** Randevu uçlarının yol şemaları; gövde şemaları core'dadır (`lib/appointments.ts`). */

export const appointmentParamsSchema = z.object({
  appointmentId: z.string().min(1).max(200).describe('Randevu kimliği'),
})
