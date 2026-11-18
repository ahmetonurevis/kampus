import { z } from 'zod'

import {
  HEALTH_REPORT_KINDS,
  STAFF_DOCUMENT_STATUSES,
  STAFF_DOCUMENT_TYPES,
  STAFF_DOCUMENT_WITHIN_DAYS_MAX,
  VALID_UNTIL_SOURCES,
} from '@kampus/school-core/lib/finance-staff-documents.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Özlük belgesi şemaları (DOM-FIN-113; ON-173). Özel nitelikli belge gizlenir (K-374). */

const documentType = z
  .enum(STAFF_DOCUMENT_TYPES)
  .describe(
    '`diploma`, `health_report` sağlık raporu, `criminal_record` adli sicil kaydı, `certificate` sertifika/kurs belgesi, `id_copy` kimlik fotokopisi, `other` diğer',
  )

const typeSettingSchema = z.object({
  documentType,
  required: z.boolean().describe('Her etkin personelde bulunmalı mı'),
  validityMonths: z.number().int().nullable().describe('Geçerlilik süresi (ay); `null` süresiz'),
  sensitive: z.boolean().describe('Özel nitelikli (KVKK md. 6)'),
  sensitiveLocked: z
    .boolean()
    .describe('Kanunen özel nitelikli tür (adli sicil, sağlık raporu): işaret kaldırılamaz'),
  customized: z.boolean().describe('Kurum ayarı mı (`false` ise platform varsayılanı)'),
  updatedAt: z.string().nullable(),
})
export const staffDocumentSettingsResponse = dataResponse(z.array(typeSettingSchema))

const documentSchema = z.object({
  id: z.string(),
  membershipId: z.string(),
  documentType,
  healthReportKind: z
    .enum(HEALTH_REPORT_KINDS)
    .nullable()
    .describe('Sağlık raporunda `pre_employment` işe giriş, `periodic` periyodik'),
  documentDate: z.string().describe('Belge tarihi (YYYY-MM-DD)'),
  validUntil: z.string().nullable().describe('Geçerlilik bitişi (dahil); boşsa süresiz'),
  validUntilSource: z
    .enum(VALID_UNTIL_SOURCES)
    .describe('`type` türün süresinden hesaplandı, `manual` elle girildi'),
  status: z
    .enum(STAFF_DOCUMENT_STATUSES)
    .describe(
      'Bugüne göre: `valid`, `expiring` (bitişi `withinDays` gün içinde), `expired`, `superseded` (yerine yenisi geçti)',
    ),
  daysLeft: z
    .number()
    .int()
    .nullable()
    .describe('Bitişe kalan gün (bugün biten 0, geçen eksi); süresizde `null`'),
  sensitive: z.boolean().describe('Türü özel nitelikli mi'),
  restricted: z
    .boolean()
    .describe('Gizli görünüm (K-374): yalnız tür, tarihler ve durum; dosya bilgisi ve not `null`'),
  hasFile: z.boolean().nullable().describe('Dosya eklenmiş mi; gizli görünümde `null`'),
  file: z
    .object({ name: z.string(), byteSize: z.number().int() })
    .nullable()
    .describe('Dosyanın adı ve boyutu; dosya yoksa ya da gizli görünümde `null`'),
  // kvkk: K (serbest metin)
  note: z.string().nullable(),
  replacesId: z.string().nullable().describe('Bu belgenin yerine geçtiği belge'),
  supersededAt: z.string().nullable().describe('Yerine yeni belge geçtiği an'),
  createdAt: z.string(),
})

const staffSchema = z.object({
  membershipId: z.string(),
  name: z.string(),
  role: z.string().describe('Rol: `yonetici`, `ogretmen` ya da `onburo`'),
  active: z.boolean().describe('Pasifleştirilmiş (ayrılan) personelde `false`'),
})

export const staffDocumentCreateResponse = dataResponse(
  z.object({
    document: documentSchema,
    superseded: documentSchema.nullable().describe('Yerine geçilen (artık geçmiş) belge'),
  }),
)

export const staffDocumentListResponse = z.object({
  data: z.array(documentSchema.extend({ staff: staffSchema })),
  meta: pageMetaSchema,
})

export const staffDocumentStaffListResponse = z.object({
  data: z.array(
    staffSchema.extend({
      documentCount: z.number().int().describe('Yerine geçilmemiş belge sayısı'),
      missingTypes: z.array(documentType).describe('Eksik zorunlu türler (pasif personelde boş)'),
      expiredCount: z.number().int().describe('Süresi geçen belge sayısı'),
      expiringCount: z.number().int().describe('`withinDays` gün içinde bitecek belge sayısı'),
    }),
  ),
  meta: pageMetaSchema,
})

export const staffDocumentDetailResponse = dataResponse(
  staffSchema.extend({
    missingTypes: z.array(documentType).describe('Eksik zorunlu türler (pasif personelde boş)'),
    documents: z
      .array(documentSchema)
      .describe('Bütün belgeler (yerine geçilenler dahil), tür ve belge tarihine göre'),
  }),
)

export const staffDocumentAlertsResponse = dataResponse(
  z.object({
    withinDays: z.number().int(),
    expiredCount: z.number().int().describe('Etkin personelde süresi geçen belge'),
    expiringCount: z
      .number()
      .int()
      .describe('Etkin personelde `withinDays` gün içinde biten belge'),
    staffMissingCount: z.number().int().describe('Zorunlu belgesi eksik etkin personel'),
  }),
)

export const staffDocumentFileUrlResponse = dataResponse(
  z.object({
    url: z.string().describe('Kısa ömürlü imzalı GET bağlantısı'),
    expiresAt: z.string().describe('Bağlantının geçerlilik sonu'),
  }),
)

const withinDays = z.coerce
  .number()
  .int()
  .min(0)
  .max(STAFF_DOCUMENT_WITHIN_DAYS_MAX)
  .optional()
  .describe('Yaklaşan bitiş penceresi, gün (0–365; varsayılan 30)')
const q = z.string().trim().min(2).max(100).optional().describe('Personel adında arama')

export const staffDocumentListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q,
  documentType: documentType.optional(),
  due: z
    .enum(['expired', 'expiring', 'attention', 'valid'])
    .optional()
    .describe(
      '`expired` süresi geçen, `expiring` `withinDays` gün içinde biten, `attention` ikisi, `valid` geçerli ya da süresiz',
    ),
  withinDays,
})

export const staffDocumentStaffQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q,
  status: z
    .enum(['active', 'passive'])
    .optional()
    .describe('`active` etkin, `passive` pasifleştirilmiş (ayrılan) personel'),
  missing: z
    .enum(['true', 'false'])
    .optional()
    .describe('`true` yalnız zorunlu belgesi eksik etkin personel'),
  withinDays,
})

export const staffDocumentAlertsQuery = z.strictObject({ withinDays })

export const staffParams = z.object({
  membershipId: z.string().trim().min(1).max(100).describe('Personelin kurum üyeliği'),
})
export const staffDocumentParams = z.object({ documentId: z.uuid('Belge geçersiz.') })
