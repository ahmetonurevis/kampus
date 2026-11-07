import { z } from 'zod'

import { errorResponseSchema } from '../errors.ts'
import { REQUIRED_HEADER_MARK } from './commands.schemas.ts'
import { dataResponse } from './common.schemas.ts'

const IF_MATCH = /^(W\/)?"?\d{1,9}"?$/

/** Biçim serviste denetlenir: bozuk anahtar da bilinmeyen anahtarla aynı 404'ü alır. */
export const applicationFormKeyParamsSchema = z.object({
  formKey: z.string().max(200).describe('Kurumun form anahtarı'),
})

export const applicationFormVersionHeadersSchema = z.looseObject({
  'if-match': z
    .string()
    .regex(IF_MATCH, 'Sürüm geçersiz.')
    .optional()
    .meta({ [REQUIRED_HEADER_MARK]: true })
    .describe(
      'Zorunlu iyimser kilit: formun okunan `version` değeri; yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`.',
    ),
})

export const applicationFormRotateHeadersSchema = z.looseObject({
  'if-match': z
    .string()
    .regex(IF_MATCH, 'Sürüm geçersiz.')
    .optional()
    .describe(
      'Form varken zorunlu iyimser kilit; yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`. İlk anahtar üretiminde gönderilmez.',
    ),
})

export const applicationFormSettingsResponseSchema = dataResponse(
  z.object({
    enabled: z.boolean(),
    formKey: z.string().nullable().describe('Henüz üretilmediyse boş'),
    siteOrigin: z.string().nullable(),
    version: z.number().int().nullable().describe('İlk anahtar üretilmeden boş'),
    noticeVersion: z
      .number()
      .int()
      .nullable()
      .describe('Yayımlı güncel aday aydınlatma sürümü; yoksa form açılamaz'),
    dailyLimit: z
      .object({
        reached: z.boolean().describe('Bugün (Europe/Istanbul) kurumun form tavanı doldu'),
        rejected: z
          .number()
          .int()
          .describe('Bugün tavan yüzünden alınamayan gönderim sayısı; kişi sayısı değildir'),
      })
      .describe('Yöneticinin uyarısı (DOM-KAY-002, K-23)'),
  }),
)

export const publicApplicationFormResponseSchema = dataResponse(
  z.object({
    institutionName: z.string(),
    asksAgeGroup: z.boolean().describe('Kurs türlerinde 18 yaş altı seçimi sorulur (DOM-KAY-009)'),
    siteOrigin: z.string().nullable().describe('Formun gömülebileceği tek site'),
    branches: z.array(z.object({ id: z.string(), name: z.string() })),
    notice: z.object({
      version: z.string().describe('Gönderimde `privacyNoticeVersion` olarak geri gelir'),
      title: z.string(),
      body: z.string(),
    }),
  }),
)

export const applicationFramePolicyResponseSchema = dataResponse(
  z.object({
    frameAncestors: z.string().describe("Kurum sitesinin kök adresi ya da `'none'`"),
  }),
)

export const applicationReceivedResponseSchema = dataResponse(
  z.object({ received: z.literal(true) }),
)

export const publicApplicationErrors = {
  404: errorResponseSchema,
  429: errorResponseSchema,
  500: errorResponseSchema,
} as const

export const applicationSubmissionErrors = {
  ...publicApplicationErrors,
  400: errorResponseSchema,
  403: errorResponseSchema,
  409: errorResponseSchema,
  413: errorResponseSchema,
  422: errorResponseSchema,
} as const
