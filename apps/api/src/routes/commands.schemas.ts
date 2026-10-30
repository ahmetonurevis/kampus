import { z } from 'zod'

import { errorResponseSchema } from '../errors.ts'
import { authenticatedErrors } from './common.schemas.ts'

/** `Idempotency-Key` biçimi: UUID önerilir; 8–128 karakter harf, rakam, `-`, `_`. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

/**
 * Komut uçlarının başlıkları. Nesne gevşektir: Fastify doğrulanan başlık nesnesini istekte
 * kullandığı için bilinmeyen başlıklar (çerez, köken) atılmamalıdır. `ifMatch: false`: işlemin
 * önceden var olan konusu yoktur (oluşturma); başlık şemada yer almaz ve gönderilirse 400
 * `if_match_not_supported` döner (`command-support.ts`), sessizce yok sayılmaz.
 */
export function commandHeadersSchema(
  idempotency: 'required' | 'optional',
  { ifMatch = true }: { ifMatch?: boolean } = {},
) {
  return z.looseObject({
    'idempotency-key': z
      .string()
      .regex(IDEMPOTENCY_KEY_PATTERN, 'İstek anahtarı geçersiz.')
      .optional()
      .describe(
        idempotency === 'required'
          ? 'Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); yoksa 400 `idempotency_key_required`. Aynı anahtar + aynı istek ilk yanıtı `Idempotent-Replayed: true` ile tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır.'
          : 'İsteğe bağlı. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar, farklı istek 422 `idempotency_key_reused`. 24 saat saklanır.',
      ),
    ...(ifMatch
      ? {
          'if-match': z
            .string()
            .regex(/^(W\/)?"?\d{1,9}"?$/, 'Sürüm geçersiz.')
            .optional()
            .describe(
              'İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`.',
            ),
        }
      : {}),
  })
}

const CHANGE_KINDS = ['insert', 'update', 'archive', 'restore', 'move'] as const

export const commandResultSchema = z
  .object({
    entity: z
      .object({
        collection: z.string().describe('İşlemin konusu olan kaydın koleksiyonu'),
        id: z.string().describe('İşlemin konusu olan kaydın kimliği (yeni kayıtta üretilen)'),
      })
      .nullable()
      .describe('İşlemin konusu; yalnız toplu işlemlerde `null`'),
    changes: z
      .object({
        inserted: z.number().int().min(0),
        updated: z.number().int().min(0),
        archived: z.number().int().min(0),
        restored: z.number().int().min(0),
      })
      .describe('Değişen kayıt sayıları (yalnız sıra değişikliği sayılmaz)'),
    records: z
      .array(
        z.object({
          collection: z.string().describe('school-core State koleksiyonu'),
          id: z.string(),
          version: z.number().int().min(1).describe('Kaydın yeni sürümü (`If-Match` için)'),
          change: z.enum(CHANGE_KINDS),
        }),
      )
      .describe('Yazılan kayıtlar; güncel veri koleksiyon okuma uçlarından alınır'),
  })
  .meta({ id: 'CommandResult' })

export const commandResponseSchema = z.object({ data: commandResultSchema })
export type CommandResponseBody = z.infer<typeof commandResponseSchema>

/** Komut uçlarının hata yanıtları (422 iş kuralı, 409 sürüm/çakışma, 404 kayıt). */
export const commandErrors = {
  ...authenticatedErrors,
  404: errorResponseSchema,
  409: errorResponseSchema,
  422: errorResponseSchema,
} as const

const recordId = (description: string) => z.string().min(1).max(200).describe(description)

/** Gün (`YYYY-MM-DD`, Europe/Istanbul günü). */
const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Geçerli bir tarih seçin.')
  .refine(
    (value) => new Date(`${value}T09:00:00.000Z`).toISOString().slice(0, 10) === value,
    'Geçerli bir tarih seçin.',
  )

export const invoiceParamsSchema = z.object({ invoiceId: recordId('Taksit kimliği') })

/**
 * Ödeme gövdesi. Core `payInvoice` yöntem için şema vermez; alan burada sınırlanır.
 * TODO(core-payment-schema): core ödeme girdisi şemasını verince gövde o olur.
 */
export const payInvoiceBodySchema = z.object({
  method: z
    .string()
    .trim()
    .min(2, 'Ödeme yöntemini seçin.')
    .max(60)
    .describe('Ödeme yöntemi (ör. `Kredi kartı`, `Nakit`, `Havale/EFT`)'),
})

export const classParamsSchema = z.object({ classId: recordId('Sınıf kimliği') })

/**
 * Yoklama gövdesi. Durumlar core `recordAttendance`'ın kabul ettikleridir; core listeyi dışa
 * aktarmadığı için burada tekrarlanır.
 * TODO(core-attendance-schema): core yoklama girdisi şemasını verince gövde o olur.
 */
export const attendanceBodySchema = z.object({
  date: daySchema.describe('Yoklama günü (`YYYY-MM-DD`); gelecek gün 422'),
  marks: z
    .record(z.string().min(1).max(200), z.enum(['present', 'absent', 'late', 'excused']))
    .describe('Öğrenci kimliği → durum; sınıfın bütün aktif öğrencileri bulunmalı'),
})

export const branchParamsSchema = z.object({ branchId: recordId('Kampüs kimliği') })
export const teacherParamsSchema = z.object({ teacherId: recordId('Öğretmen kimliği') })

export const archiveQuerySchema = z.strictObject({
  replacementId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Bağlı kayıtların aktarılacağı kayıt (kampüs, sınıf veya öğretmen); core gerektiriyorsa zorunlu',
    ),
})

export const tutorSessionParamsSchema = z.object({ sessionId: recordId('Etüt kimliği') })

export const tutorCancelBodySchema = z.object({
  reason: z.string().trim().min(2, 'İptal nedenini girin.').max(500),
})

export const tutorAttendanceBodySchema = z.object({
  marks: z
    .record(z.string().min(1).max(200), z.enum(['Geldi', 'Gelmedi', 'İzinli']))
    .describe('Etüt öğrencisi → durum; bütün etüt öğrencileri ve yalnız onlar'),
})
