import { z } from 'zod'

import { errorResponseSchema } from '../errors.ts'
import { authenticatedErrors } from './common.schemas.ts'

/** `Idempotency-Key` biçimi: UUID önerilir; 8–128 karakter harf, rakam, `-`, `_`. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

/**
 * Komut uçlarının başlıkları. Nesne gevşektir: Fastify doğrulanan başlık nesnesini istekte
 * kullandığı için bilinmeyen başlıklar (çerez, köken) atılmamalıdır.
 */
export function commandHeadersSchema(idempotency: 'required' | 'optional') {
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
    'if-match': z
      .string()
      .regex(/^(W\/)?"?\d{1,9}"?$/, 'Sürüm geçersiz.')
      .optional()
      .describe(
        'İsteğe bağlı iyimser kilit: işlemin konusu olan kaydın okunan `version` değeri (ör. `"4"`). Tutmazsa 409 `version_conflict`.',
      ),
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

/** Komut uçlarının hata yanıtları (422 iş kuralı, 409 sürüm/çakışma, 404 kayıt). */
export const commandErrors = {
  ...authenticatedErrors,
  404: errorResponseSchema,
  409: errorResponseSchema,
  422: errorResponseSchema,
} as const
