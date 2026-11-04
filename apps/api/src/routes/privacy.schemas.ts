import { z } from 'zod'

import {
  CONSENT_CHANNELS,
  CONSENT_PURPOSE_KEYS,
  CONSENT_SUBJECT_KINDS,
} from '@kampus/school-core/lib/consent-purposes.ts'
import {
  CONSENT_DECISIONS,
  GRANTOR_RELATIONS,
  giveConsentSchema,
  WITHDRAWAL_REASONS,
} from '@kampus/school-core/lib/consents.ts'
import {
  acknowledgeNoticeSchema,
  NOTICE_AUDIENCE_KEYS,
  PRIVACY_NOTICE_KINDS,
  publishPrivacyNoticeSchema,
} from '@kampus/school-core/lib/privacy-notices.ts'

import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'

/**
 * Aydınlatma ve açık rıza uçlarının şemaları (IST-016, IST-017; DOM-YTK-056…062). Gövdeler core
 * işlem şemalarıdır (katı): gövdedeki `institutionId` gibi bilinmeyen alan 400'dür.
 */

const instant = z.iso.datetime()
const purposeSchema = z.enum(CONSENT_PURPOSE_KEYS).describe('Rıza amacı kodu')
// kvkk: K — öğrenci kaydı kimliği
const studentIdSchema = z.string().min(1).max(200)

export const privacyNoticeSchema = z
  .object({
    id: z.uuid(),
    kind: z
      .enum(PRIVACY_NOTICE_KINDS)
      .describe('`notice` aydınlatma metni (kitleye), `consent_text` rıza metni (amaca)'),
    audience: z.enum(NOTICE_AUDIENCE_KEYS).nullable().describe('Aydınlatma kitlesi'),
    purpose: purposeSchema.nullable(),
    version: z.number().int().min(1).describe('Konu içinde artan sürüm'),
    title: z.string(),
    body: z.string(),
    requiresReconsent: z
      .boolean()
      .describe('Bu sürümden eski metne verilmiş rıza geçersizdir (DOM-YTK-060)'),
    publishedAt: instant,
  })
  .meta({ id: 'PrivacyNotice' })

export const privacyNoticeListQuerySchema = pageQuerySchema.strict()
export const privacyNoticeListResponseSchema = pageResponse(privacyNoticeSchema)
export const privacyNoticeBodySchema = publishPrivacyNoticeSchema
export const privacyNoticeResponseSchema = dataResponse(privacyNoticeSchema)

export const currentNoticeQuerySchema = z.strictObject({
  audience: z
    .enum(NOTICE_AUDIENCE_KEYS)
    .optional()
    .describe(
      'Okunacak kitle; yoksa oturum rolünün kitlesi. `aday` yalnız yönetici ve ön büro (aday formu)',
    ),
})

export const currentNoticeResponseSchema = dataResponse(
  z
    .object({
      audience: z
        .enum(NOTICE_AUDIENCE_KEYS)
        .describe('Okunan kitle: istenen `audience` ya da oturum rolünün kitlesi'),
      notice: privacyNoticeSchema.nullable().describe('Kitlenin son sürümü; yayımlanmamışsa boş'),
      needsAcknowledgement: z
        .boolean()
        .describe(
          'Son sürüm bu kullanıcıya henüz gösterilmedi; ilk girişte gösterilmeli. Aday kitlesinde hep yanlış',
        ),
      acknowledgedAt: instant
        .nullable()
        .describe('Son sürümün gösterim anı; aday kitlesinde hep boş'),
    })
    .meta({ id: 'CurrentPrivacyNotice' }),
)

export const noticeParamsSchema = z.object({
  noticeId: z.uuid().describe('Aydınlatma metni sürümünün kimliği'),
})
export const acknowledgeBodySchema = acknowledgeNoticeSchema.omit({ noticeId: true })
export const acknowledgementResponseSchema = dataResponse(
  z
    .object({
      id: z.uuid(),
      noticeId: z.uuid(),
      userId: z.string(),
      channel: z.enum(CONSENT_CHANNELS),
      acknowledgedAt: instant,
    })
    .meta({ id: 'NoticeAcknowledgement' }),
)

export const consentTextParamsSchema = z.object({ purpose: purposeSchema })
const consentTextSchema = z
  .object({
    text: privacyNoticeSchema,
    minimumVersion: z
      .number()
      .int()
      .min(1)
      .describe('Geçerli rıza için gereken en düşük metin sürümü (DOM-YTK-060)'),
  })
  .meta({ id: 'ConsentText' })
export const consentTextResponseSchema = dataResponse(consentTextSchema)

export const consentTextListQuerySchema = z.strictObject({
  purpose: purposeSchema.optional().describe('Yalnız bu amacın metni; yoksa bütün amaçlar'),
})
export const consentTextListResponseSchema = dataResponse(z.array(consentTextSchema))

export const consentSchema = z
  .object({
    id: z.uuid(),
    subjectKind: z
      .enum(CONSENT_SUBJECT_KINDS)
      .describe('`student` öğrenci kaydı, `user` hesabın kendisi'),
    // kvkk: K
    subjectId: z.string().describe('Öğrenci kaydı ya da kullanıcı kimliği'),
    purpose: purposeSchema,
    decision: z.enum(CONSENT_DECISIONS).describe('`granted` rıza, `objected` öğrenci itirazı'),
    // kvkk: K
    grantedByUserId: z
      .string()
      .optional()
      .describe('Rızayı veren kullanıcı; yalnız yönetici ve ön büroya döner'),
    grantorRelation: z.enum(GRANTOR_RELATIONS).describe('`self` kendisi, `guardian` veli'),
    textId: z.uuid(),
    textVersion: z.number().int().min(1),
    channel: z.enum(CONSENT_CHANNELS),
    givenAt: instant,
    expiresAt: instant.nullable().describe('Eğitim yılı sonu ya da öğrencinin 18. yaş günü'),
    withdrawnAt: instant.nullable(),
    withdrawalReason: z
      .enum(WITHDRAWAL_REASONS)
      .nullable()
      .describe('`withdrawn` geri çekme, `renewed` yenilenerek kapanma'),
    canWithdraw: z
      .boolean()
      .describe(
        'Oturumdaki kullanıcı bu satırı şu anda geri çekebilir: satır açık ve kullanıcı ya veren ya da veri sahibi için şu anda rıza verebilecek kişi; itirazı ve hesap rızasını yalnız veren (DOM-YTK-059)',
      ),
    rowVersion: z.number().int().min(1),
  })
  .meta({ id: 'Consent' })

export const consentBodySchema = giveConsentSchema
export const consentResponseSchema = dataResponse(consentSchema)
export const consentParamsSchema = z.object({ consentId: z.uuid().describe('Rıza kaydı kimliği') })

export const consentListQuerySchema = pageQuerySchema
  .extend({
    studentId: studentIdSchema
      .optional()
      .describe('Veri sahibi öğrenci; yoksa oturum sahibinin hesap rızaları'),
    purpose: purposeSchema.optional(),
    status: z
      .enum(['open', 'all'])
      .default('open')
      .describe('`open` geri çekilmemiş satırlar, `all` geçmiş dahil'),
  })
  .strict()
export const consentListResponseSchema = pageResponse(consentSchema)

export const consentStatusQuerySchema = z.strictObject({
  studentId: studentIdSchema
    .optional()
    .describe('Veri sahibi öğrenci; yoksa oturum sahibinin hesap amaçları'),
  purpose: purposeSchema.optional(),
})
export const consentStatusResponseSchema = dataResponse(
  z.array(
    z
      .object({
        purpose: purposeSchema,
        valid: z.boolean().describe('Şu anda geçerli rıza var ve etkin itiraz yok (DOM-YTK-061)'),
        grantor: z
          .enum(GRANTOR_RELATIONS)
          .nullable()
          .optional()
          .describe(
            'Bu amaçta rızayı kim verir (DOM-YTK-057): öğrenci amacında 18 yaşını doldurmuş öğrencinin kendisi `self`, değilse ya da doğum tarihi bilinmiyorsa veli `guardian`; hesap amacında hesap sahibi `self`, 18 yaş altı öğrenci hesabında `null` (alınmaz). Doğum tarihi dönmez, yalnız sonuç. Öğretmene dönmez; öğretmen yalnız var/yok görür (DOM-YTK-061)',
          ),
      })
      .meta({ id: 'ConsentStatus' }),
  ),
)
