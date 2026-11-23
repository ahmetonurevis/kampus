import { z } from 'zod'

import { moduleToggleInputSchema } from '@kampus/school-core/lib/institution-modules.ts'

import { IDEMPOTENCY_KEY_PATTERN, REQUIRED_HEADER_MARK } from './commands.schemas.ts'
import { dataResponse } from './common.schemas.ts'

export const moduleParamsSchema = z.object({
  moduleKey: z.string().min(1).max(50).describe('Modül anahtarı (ör. `meals`, `finance`)'),
})

/** Gövde: core `moduleToggleInputSchema`; burada yalnız OpenAPI açıklaması eklenir. */
export const moduleToggleBodySchema = moduleToggleInputSchema.extend({
  enabled: moduleToggleInputSchema.shape.enabled.describe('Modül açık mı olacak'),
})

/**
 * Başlıklar: `If-Match` (kurum ayar sürümü) ve `Idempotency-Key` bu uçta zorunludur. Eksiklik
 * Zod `validation_failed` değil, 400 `if_match_required` / `idempotency_key_required` döner
 * (`modules.ts`); belge dönüşümü işaretli başlığı `required` yapar.
 */
export const moduleHeadersSchema = z.looseObject({
  'idempotency-key': z
    .string()
    .regex(IDEMPOTENCY_KEY_PATTERN, 'İstek anahtarı geçersiz.')
    .optional()
    .meta({ [REQUIRED_HEADER_MARK]: true })
    .describe(
      'Zorunlu. Kullanıcı eylemi başına bir kez üretilen anahtar (UUID önerilir); aynı anahtar + aynı istek ilk yanıtı tekrarlar.',
    ),
  'if-match': z
    .string()
    .regex(/^(W\/)?"?\d{1,9}"?$/, 'Sürüm geçersiz.')
    .optional()
    .meta({ [REQUIRED_HEADER_MARK]: true })
    .describe(
      'Zorunlu. `GET /modules` yanıtındaki kurum ayar sürümü (ör. `"3"`). Tutmazsa 409 `version_conflict`.',
    ),
})

export const moduleSettingsSchema = z
  .object({
    version: z.number().int().min(1).describe('Kurum ayar sürümü (`If-Match` için)'),
    modules: z
      .array(
        z.object({
          key: z.string().describe('Modül anahtarı'),
          enabled: z.boolean().describe('Modül açık mı'),
        }),
      )
      .describe('Kurum türünde bulunan modüller; türde olmayan modül listelenmez'),
  })
  .meta({ id: 'ModuleSettings' })

export const moduleChangeSchema = z
  .object({
    moduleKey: z.string(),
    enabled: z.boolean(),
    enabledModules: z
      .record(z.string(), z.boolean())
      .describe('Güncel etkin modül haritası (`/me` `enabledModules` ile aynı)'),
    version: z.number().int().min(1).describe('Yeni kurum ayar sürümü'),
  })
  .meta({ id: 'ModuleChange' })

export const moduleSettingsResponseSchema = dataResponse(moduleSettingsSchema)
export const moduleChangeResponseSchema = dataResponse(moduleChangeSchema)
