import { z } from 'zod'

import { bookableSlotsQuerySchema as coreSlotsQuery } from '@kampus/school-core/lib/appointments.ts'

import { dataResponse } from './common.schemas.ts'

/** Randevu uçlarının yol ve yanıt şemaları; gövde şemaları core'dadır (`lib/appointments.ts`). */

export const appointmentParamsSchema = z.object({
  appointmentId: z.string().min(1).max(200).describe('Randevu kimliği'),
})

/**
 * Saat listesi sorgusu: core `bookableSlotsQuerySchema` (sıkı; bilinmeyen parametre, `from`suz
 * `to`, ters veya 28 günü aşan aralık 400).
 */
export const bookableSlotsQuerySchema = coreSlotsQuery

/**
 * Alınabilir saat (DOM-ILT-105). Alanlar beyaz listedir; şemada olmayan alan (saatin iç notu,
 * saati tutan randevu ve kişisi, dolu olmanın nedeni) yanıta girmez.
 */
export const bookableSlotSchema = z
  .object({
    slotId: z.string().describe('Uygunluk saati kimliği; talepte `slotId` olarak gönderilir'),
    teacherId: z.string(),
    teacherName: z.string(),
    startsAt: z.string().describe('Başlangıç, ISO 8601 UTC'),
    duration: z.number().describe('Dakika'),
    campusName: z.string().optional().describe('Öğretmenin kampüsü; kayıt yoksa yok'),
    subjectNames: z
      .array(z.string())
      .describe('Öğretmenin öğrencinin sınıfında verdiği dersler, ada göre sıralı'),
    available: z
      .boolean()
      .describe('`false`: saat dolu ("Dolu"); neden hiçbir durumda bildirilmez (DOM-ILT-073)'),
  })
  .meta({ id: 'BookableSlot' })

export const bookableSlotsResponseSchema = dataResponse(
  z.array(bookableSlotSchema).describe('Başlangıca göre sıralı; aralıkla sınırlı, sayfalanmaz'),
)
