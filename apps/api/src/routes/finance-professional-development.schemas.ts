import { z } from 'zod'

import {
  PROFESSIONAL_DEVELOPMENT_ENROLLMENT_ORIGINS,
  PROFESSIONAL_DEVELOPMENT_ENROLLMENT_STATUSES,
  PROFESSIONAL_DEVELOPMENT_KINDS,
  PROFESSIONAL_DEVELOPMENT_STATUSES,
} from '@kampus/school-core/lib/finance-professional-development.ts'
import { STAFF_ROLES } from '@kampus/school-core/lib/staff-accounts.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Mesleki gelişim kataloğu şemaları (DOM-FIN-125; ON-214). */

const programSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(PROFESSIONAL_DEVELOPMENT_KINDS),
  provider: z.string(),
  durationHours: z.number().describe('Toplam süre, saat (yarım saat adımlı)'),
  ongoing: z.boolean().describe('Sürekli açık eğitim; tarih aralığı yok'),
  startDate: z.string().nullable().describe('Başlangıç günü (YYYY-MM-DD)'),
  endDate: z.string().nullable().describe('Bitiş günü (YYYY-MM-DD)'),
  location: z.string().nullable(),
  onlineUrl: z.string().nullable(),
  audienceRoles: z.array(z.enum(STAFF_ROLES)).describe('Hedef rol etiketleri; boşsa tüm personel'),
  audienceBranches: z.array(z.string()).describe('Hedef branş etiketleri'),
  feeCents: z.number().int().nullable().describe('Kişi başı ücret, kuruş'),
  costCenterId: z.string().nullable().describe('Maliyet merkezi (ON-204)'),
  capacity: z.number().int().nullable().describe('Kontenjan; boşsa sınırsız'),
  status: z.enum(PROFESSIONAL_DEVELOPMENT_STATUSES),
  enrolledCount: z.number().int().describe('Atanan personel sayısı (her durum)'),
  attendedCount: z.number().int().describe('Katıldı işaretli personel sayısı'),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

export const programResponse = dataResponse(programSchema)
export const programListResponse = z.object({
  data: z.array(programSchema),
  meta: pageMetaSchema,
})

export const programListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Eğitim adında ya da sağlayıcıda arama'),
  kind: z.enum(PROFESSIONAL_DEVELOPMENT_KINDS).optional().describe('Eğitim türü'),
  status: z
    .enum(PROFESSIONAL_DEVELOPMENT_STATUSES)
    .optional()
    .describe('Durum; ön büroya taslak hiç dönmez'),
})

export const programParams = z.object({
  programId: z.uuid('Eğitim geçersiz.'),
})

const enrollmentSchema = z.object({
  id: z.string(),
  programId: z.string(),
  membershipId: z.string().describe('Personelin kurum üyeliği'),
  // kvkk: K
  staffName: z.string().describe('Personel adı (üyelikten)'),
  staffRole: z.string().describe('Personelin rolü'),
  origin: z.enum(PROFESSIONAL_DEVELOPMENT_ENROLLMENT_ORIGINS),
  status: z.enum(PROFESSIONAL_DEVELOPMENT_ENROLLMENT_STATUSES),
  attendedHours: z.number().nullable().describe('Katılım saati; yalnız `attended`'),
  statusChangedAt: z.string(),
  createdAt: z.string(),
  version: z.number().int(),
})

export const enrollmentResponse = dataResponse(enrollmentSchema)
export const enrollmentListResponse = z.object({
  data: z.array(enrollmentSchema),
  meta: pageMetaSchema,
})

export const enrollmentListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  status: z
    .enum(PROFESSIONAL_DEVELOPMENT_ENROLLMENT_STATUSES)
    .optional()
    .describe('Katılım durumu'),
})

export const enrollmentParams = z.object({
  programId: z.uuid('Eğitim geçersiz.'),
  enrollmentId: z.uuid('Atama geçersiz.'),
})
