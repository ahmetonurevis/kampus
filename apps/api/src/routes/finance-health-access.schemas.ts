import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  HEALTH_ACCESS_NOTE_HEADER,
  HEALTH_ACCESS_NOTE_MAX,
  HEALTH_ACCESS_NOTE_MIN,
  HEALTH_ACCESS_REASON_CODES,
  HEALTH_ACCESS_REASON_HEADER,
} from '@kampus/school-core/lib/finance-health-access.ts'

import { REQUIRED_HEADER_MARK } from './commands.schemas.ts'
import { pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Sağlık verisi okuma gerekçesi şemaları (DOM-FIN-156; ON-164; K-523…K-525). */

const reasonCode = z
  .enum(HEALTH_ACCESS_REASON_CODES)
  .describe(
    '`emergency` acil durum, `first_aid` ilk yardım / revir işlemi, `guardian_meeting` veli görüşmesi, `incident_report` tutanak hazırlama, `official_request` resmî talep, `other` diğer',
  )

/**
 * Gerekçeli okuma uçlarının başlıkları. Çalışma zamanında isteğe bağlıdır: eksik ya da geçersiz
 * gerekçe Zod `validation_failed` değil 400 `health_access_reason_required|invalid` döner
 * (`requireHealthAccessReason`). `required`: OpenAPI'de zorunlu görünür (veli ve öğrencinin de
 * okuduğu uçta isteğe bağlı bırakılır). Nesne gevşektir: bilinmeyen başlıklar atılmaz.
 */
export function healthAccessHeadersSchema(required: boolean) {
  // Gerekçe doğrulamadan önce (`preValidation`) denetlendiğinden Zod bu şemada hata üretmez.
  const code = z.enum(HEALTH_ACCESS_REASON_CODES).optional()
  return z.looseObject({
    [HEALTH_ACCESS_REASON_HEADER]: (required
      ? code.meta({ [REQUIRED_HEADER_MARK]: true })
      : code
    ).describe(
      `${required ? 'Zorunlu.' : 'Personelde zorunlu; veli ve öğrencide gönderilmez.'} Sağlık verisi erişim gerekçesi: ${reasonCode.description ?? ''}. Yoksa 400 \`health_access_reason_required\`, geçersizse 400 \`health_access_reason_invalid\`. Gerekçe başlıkta taşınır, sorgu dizesine konmaz; istek logunda başlık yer almaz.`,
    ),
    [HEALTH_ACCESS_NOTE_HEADER]: z
      .string()
      .optional()
      .describe(
        `Yalnız \`other\` gerekçede zorunlu açıklama: yüzde kodlu UTF-8 (\`encodeURIComponent\`), çözülmüş hâli kırpılınca ${HEALTH_ACCESS_NOTE_MIN}–${HEALTH_ACCESS_NOTE_MAX} karakter. Kodlu gerekçede gönderilirse 400 \`health_access_reason_invalid\`.`,
      ),
  })
}

export const healthAccessLogQuery = z.strictObject({
  ...pageQuerySchema.shape,
  actorMembershipId: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe('Okuyan kişinin kurum üyeliği'),
  studentId: z.string().trim().min(1).max(100).optional().describe('Kaydın öğrencisi'),
  reasonCode: reasonCode.optional(),
  from: daySchema.optional().describe('Okuma günü başlangıcı (YYYY-MM-DD, Europe/Istanbul)'),
  to: daySchema.optional().describe('Okuma günü sonu (dahil)'),
})

export const healthAccessLogResponse = z.object({
  data: z.array(
    z.object({
      id: z.uuid().describe('Denetim satırının kimliği'),
      accessedAt: z.iso.datetime(),
      actorMembershipId: z.string(),
      actorName: z.string().nullable().describe('Okuyan kişi; üyelik silindiyse boş'),
      actorRole: z.string().nullable(),
      action: z
        .string()
        .describe(
          'Denetim eylemi (`finance.incident.read`, `finance.infirmary.visit_read`, `consent_read`, `schedule_read` …)',
        ),
      entityType: z.string().nullable(),
      entityId: z.string().nullable().describe('Okunan kaydın kimliği'),
      studentId: z.string().nullable(),
      studentName: z.string().nullable(),
      reasonCode,
      reasonNote: z.string().nullable().describe('Yalnız `other` gerekçede açıklama'),
    }),
  ),
  meta: pageMetaSchema,
})
