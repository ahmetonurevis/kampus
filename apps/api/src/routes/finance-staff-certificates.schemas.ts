import { z } from 'zod'

import { WAGE_TYPES } from '@kampus/school-core/lib/finance-pay-rates.ts'
import {
  STAFF_CERTIFICATE_KINDS,
  STAFF_CERTIFICATE_STATUSES,
} from '@kampus/school-core/lib/finance-staff-certificates.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Personel belgesi şemaları (DOM-FIN-106; ON-175). Yalnız yöneticiye döner (K-342). */

const certificateSchema = z.object({
  id: z.string(),
  membershipId: z.string().describe('Belgenin düzenlendiği personelin kurum üyeliği'),
  kind: z
    .enum(STAFF_CERTIFICATE_KINDS)
    .describe('`employment` çalışma belgesi, `service` hizmet belgesi'),
  certificateYear: z.number().int().describe('Belge numarasının yılı (Europe/Istanbul)'),
  certificateNumber: z
    .number()
    .int()
    .describe('Yıl içindeki sıra; numara `PB-<yıl>-<sıra>` (K-341)'),
  // kvkk: K
  staffName: z.string().describe('Üretim anındaki personel adı'),
  position: z.string().describe('Görev ya da unvan'),
  hireDate: z.string().describe('İşe giriş günü (YYYY-MM-DD)'),
  exitDate: z.string().nullable().describe('İşten ayrılış günü; yalnız hizmet belgesinde'),
  addressee: z.string().describe('Muhatap; yazılmadıysa "İlgili makama"'),
  includesWage: z.boolean().describe('Belgede ücret bilgisi var mı (tutar yalnız belge ucunda)'),
  hasIdentityNumber: z
    .boolean()
    .describe('Belgede T.C. kimlik no var mı (değer yalnız belge ucunda)'),
  issuedByName: z.string().describe('Düzenleyen yönetici'),
  createdAt: z.string().describe('Düzenleme anı (ISO 8601 UTC)'),
  cancelledAt: z.string().nullable().describe('İptal anı; boşsa belge geçerli'),
  cancelReason: z.string().nullable().describe('İptal gerekçesi'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü (iptal)'),
})

export const certificateResponse = dataResponse(certificateSchema)
export const certificateListResponse = z.object({
  data: z.array(certificateSchema),
  meta: pageMetaSchema,
})

export const certificateDocumentResponse = dataResponse(
  certificateSchema.extend({
    institutionName: z.string().describe('Üretim anındaki kurum adı (belge başlığı)'),
    // kvkk: K (T.C. kimlik no; yalnız bu uçta, okuma denetlenir)
    identityNumber: z.string().nullable().describe('T.C. kimlik no; girilmediyse boş'),
    wageRateType: z
      .enum(WAGE_TYPES)
      .nullable()
      .describe('Belgeye yazılan ana ücretin türü; ücret istenmediyse boş'),
    // kvkk: K (ücret)
    wageAmountCents: z.number().int().nullable().describe('Belgeye yazılan ana ücret, kuruş'),
    currency: z.literal('TRY'),
  }),
)

export const certificateListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Personel adında arama'),
  kind: z.enum(STAFF_CERTIFICATE_KINDS).optional().describe('Belge türü'),
  status: z
    .enum(STAFF_CERTIFICATE_STATUSES)
    .optional()
    .describe('`valid` geçerli, `cancelled` iptal edilmiş'),
  year: z.coerce.number().int().min(2000).max(2999).optional().describe('Belge numarasının yılı'),
  membershipId: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe('Yalnız bu personelin belgeleri'),
})

const staffRowSchema = z.object({
  membershipId: z.string(),
  name: z.string(),
  role: z.string().describe('Rol: `yonetici`, `ogretmen` ya da `onburo`'),
  active: z
    .boolean()
    .describe('Etkin personele çalışma, pasifleştirilmiş (ayrılan) personele hizmet belgesi'),
  leftDate: z
    .string()
    .nullable()
    .describe('Pasifleştirme günü (Europe/Istanbul); ayrılış günü önerisi'),
  lastPosition: z.string().nullable().describe('İptal edilmemiş son belgedeki görev (öneri)'),
  lastHireDate: z
    .string()
    .nullable()
    .describe('İptal edilmemiş son belgedeki işe giriş günü (öneri)'),
})
export const certificateStaffResponse = z.object({
  data: z.array(staffRowSchema),
  meta: pageMetaSchema,
})
export const certificateStaffQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Personel adında arama'),
})

export const certificateParams = z.object({
  certificateId: z.uuid('Belge geçersiz.'),
})
