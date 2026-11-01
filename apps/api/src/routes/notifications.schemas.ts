import { z } from 'zod'

import {
  NOTIFICATION_AUDIENCES,
  NOTIFICATION_KIND_NAMES,
  NOTIFICATION_TOPICS,
} from '@kampus/school-core/lib/notifications.ts'

import { dataResponse, pageMetaSchema } from './common.schemas.ts'

/** Bildirim uçlarının yol, sorgu ve yanıt şemaları (core `lib/notifications.ts`). */

export const notificationParamsSchema = z.object({
  notificationId: z.string().min(1).max(200).describe('Bildirim kimliği'),
})

export const notificationListQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1).describe('Sayfa numarası'),
  pageSize: z.coerce.number().int().min(1).max(100).default(25).describe('Sayfa boyutu (≤ 100)'),
  unread: z
    .enum(['true', 'false'])
    .default('false')
    .describe('`true`: yalnız okunmamış bildirimler'),
})

/**
 * Bildirim görünümü. Serbest metin yoktur: başlık türün sabit şablonundan, öğrencinin ilk adıyla
 * üretilir (DOM-ILT-023). Okundu bilgisi yalnız okuyanın kendisininkidir (DOM-ILT-073).
 */
const notificationViewSchema = z
  .object({
    id: z.string(),
    kind: z.enum(NOTIFICATION_KIND_NAMES).describe('Bildirim türü (core `NOTIFICATION_KINDS`)'),
    topic: z.enum(NOTIFICATION_TOPICS).describe('Konu (DOM-ILT-020)'),
    audience: z.enum(NOTIFICATION_AUDIENCES).describe('Alıcı kitlesi: öğrenci veya veli'),
    studentId: z.string().describe('Bildirimin ait olduğu öğrenci'),
    subject: z
      .object({
        type: z.string().describe('Konu kaydının türü (`task_submission`, `students`)'),
        id: z.string(),
      })
      .describe('Bildirimin bağlandığı kayıt'),
    // kvkk: K — öğrencinin ilk adını içerir; loglanmaz.
    title: z.string().describe('Gösterilen başlık; ayrıntı (puan, tutar, metin) içermez'),
    createdAt: z.string().describe('Oluşturulma anı (ISO 8601 UTC)'),
    readAt: z.string().nullable().describe('Okuyanın ilk okuma anı; okunmamışsa `null`'),
  })
  .meta({ id: 'Notification' })

export const notificationPageResponseSchema = z.object({
  data: z.array(notificationViewSchema),
  meta: pageMetaSchema,
})

export const unreadNotificationsResponseSchema = dataResponse(
  z.object({ unread: z.number().int().min(0).describe('Okunmamış bildirim sayısı') }),
)
