import { z } from 'zod'

import { MESSAGE_MAX_LENGTH } from '@kampus/school-core/lib/communication.ts'

import { errorResponseSchema } from '../errors.ts'
import { authenticatedErrors, dataResponse, pageMetaSchema } from './common.schemas.ts'

/** İletişim uçlarının yol, sorgu ve yanıt şemaları; gövde şemaları core'dadır. */

const recordId = (description: string) => z.string().min(1).max(200).describe(description)

export const announcementParamsSchema = z.object({ announcementId: recordId('Duyuru kimliği') })
export const conversationParamsSchema = z.object({ conversationId: recordId('Yazışma kimliği') })
export const studentParamsSchema = z.object({ studentId: recordId('Öğrenci kimliği') })

/** Okuma uçlarının hataları: 404 yok, başka kurum veya taraf değil. */
export const readErrors = { ...authenticatedErrors, 404: errorResponseSchema } as const

export const conversationListQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1).describe('Sayfa numarası'),
  pageSize: z.coerce.number().int().min(1).max(100).default(25).describe('Sayfa boyutu (≤ 100)'),
  studentId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('Öğrenci süzgeci; yöneticide zorunlu (yalnız üst veri döner)'),
})

export const messageListQuerySchema = z.strictObject({
  cursor: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('Önceki sayfanın `meta.nextCursor` değeri; yoksa en yeni mesajlar'),
  limit: z.coerce.number().int().min(1).max(100).default(50).describe('Sayfa boyutu (≤ 100)'),
})

// kvkk: K — mesaj metni; loglanmaz, denetim kaydına yazılmaz.
const messageViewSchema = z
  .object({
    id: z.string(),
    text: z.string().max(MESSAGE_MAX_LENGTH),
    sender: z.string().describe('`teacher`, `student` veya `parent`'),
    sentAt: z.string().describe('Gönderim anı (ISO 8601 UTC)'),
    readAt: z.string().nullable().describe('Karşı tarafın ilk görme anı (DOM-ILT-024)'),
    fromMe: z.boolean().describe('Mesaj okuyan tarafın mı; yöneticide her zaman `false`'),
  })
  .meta({ id: 'ConversationMessage' })

const conversationSummarySchema = z
  .object({
    id: z.string(),
    studentId: z.string(),
    teacherId: z.string(),
    audience: z.string().describe('`student` veya `parent`'),
    // kvkk: K
    parentUserId: z
      .string()
      .nullable()
      .describe('Veli yazışmasında velinin kullanıcı kimliği (DOM-ILT-010); eski kayıtta `null`'),
    messageCount: z.number().int().min(0),
    lastMessage: messageViewSchema.nullable().describe('Son mesaj; yöneticide `null`'),
    unreadCount: z.number().int().min(0).describe('Karşı tarafın okunmamış mesajları'),
    awaitingReply: z
      .object({
        since: z.string(),
        dueAt: z.string().describe('İlk iş günü sonu (DOM-ILT-013)'),
        overdue: z.boolean(),
      })
      .nullable()
      .describe('Öğretmen görünümünde yanıt bekleyen yazışma'),
  })
  .meta({ id: 'ConversationSummary' })

export const conversationListResponseSchema = z.object({
  data: z.array(conversationSummarySchema),
  meta: pageMetaSchema,
})

export const messagePageResponseSchema = z.object({
  data: z.array(messageViewSchema).describe('Sayfa içinde eskiden yeniye'),
  meta: z.object({
    nextCursor: z.string().nullable().describe('Daha eski mesajlar için imleç; yoksa `null`'),
  }),
})

export const conversationAccessResponseSchema = dataResponse(
  z.object({
    conversationId: z.string(),
    expiresAt: z.string().describe('Erişimin bittiği an (ISO 8601 UTC); 30 dakika'),
  }),
)

export const parentAccountsResponseSchema = dataResponse(
  z.array(
    z.object({
      // kvkk: K
      userId: z.string().describe('Velinin kullanıcı kimliği (`parentUserId`)'),
      // kvkk: K
      name: z.string(),
    }),
  ),
)
