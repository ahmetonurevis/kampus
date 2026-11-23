import { z } from 'zod'

import {
  SOCIAL_ACTIVITY_KINDS,
  SOCIAL_ACTIVITY_SCOPES,
  SOCIAL_HOUR_KINDS,
  SOCIAL_HOUR_SOURCES,
  SOCIAL_HOUR_STATUSES,
  SOCIAL_PROGRESS_STATUSES,
} from '@kampus/school-core/lib/finance-social-activities.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Sosyal etkinlik ve gönüllülük saati şemaları (DOM-FIN-160; ON-170; K-535…K-537). */

const academicYear = z
  .number()
  .int()
  .describe('Öğretim yılının başlangıç yılı (2026 → 2026–2027; Eylül başı)')

export const socialActivityRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(SOCIAL_ACTIVITY_KINDS),
  startDate: z.string().describe('YYYY-MM-DD'),
  endDate: z.string().nullable().describe('YYYY-MM-DD; boşsa süren etkinlik'),
  location: z.string(),
  responsibleMembershipId: z.string().describe('Sorumlu öğretmenin kurum üyeliği'),
  // kvkk: K (personel)
  responsibleName: z.string().nullable(),
  organizationScope: z.enum(SOCIAL_ACTIVITY_SCOPES),
  organizationName: z.string().nullable(),
  clubId: z.string().nullable(),
  clubName: z.string().nullable(),
  approvedMinutes: z.number().int().describe('Onaylı net dakika (ters kayıtlar düşülmüş)'),
  pendingCount: z.number().int().describe('Onay bekleyen beyan sayısı'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

export const socialHourRowSchema = z.object({
  id: z.string(),
  activityId: z.string(),
  activityName: z.string(),
  activityKind: z.enum(SOCIAL_ACTIVITY_KINDS),
  studentId: z.string(),
  // kvkk: K (öğrenci)
  studentName: z.string(),
  className: z.string().nullable(),
  activityDate: z.string().describe('Çalışma günü (YYYY-MM-DD)'),
  academicYear,
  kind: z.enum(SOCIAL_HOUR_KINDS).describe('`entry` kayıt, `reversal` ters kayıt'),
  minutes: z.number().int().describe('Dakika; ters kayıtta eksi'),
  status: z.enum(SOCIAL_HOUR_STATUSES),
  source: z.enum(SOCIAL_HOUR_SOURCES),
  // kvkk: K (serbest metin)
  note: z.string().nullable().describe('Çalışma açıklaması; ters kayıtta düzeltme gerekçesi'),
  decidedAt: z.string().nullable().describe('Karar anı (ISO 8601)'),
  // kvkk: K (serbest metin)
  rejectionReason: z.string().nullable(),
  reversesEntryId: z.string().nullable(),
  reversedByEntryId: z.string().nullable(),
  createdAt: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü (onay, ret, ters kayıt)'),
})

export const socialProgressSchema = z.object({
  totalMinutes: z.number().int().describe('Ortaöğrenim boyunca onaylı net dakika (bu kurumda)'),
  yearMinutes: z.number().int().describe('Seçilen öğretim yılının onaylı net dakikası'),
  totalTargetHours: z.number().int(),
  yearlyTargetHours: z.number().int().nullable(),
  totalMissingMinutes: z.number().int(),
  yearMissingMinutes: z.number().int().nullable(),
  status: z
    .enum(SOCIAL_PROGRESS_STATUSES)
    .describe('`met` toplam hedef tamam, `on_track` yıllık hedef tamam, `behind` eksik'),
  pendingCount: z.number().int(),
})

export const socialSettingsSchema = z.object({
  totalTargetHours: z.number().int(),
  yearlyTargetHours: z.number().int().nullable(),
  isDefault: z.boolean().describe('Kurum ayarı yok; mevzuat önerisi uygulanıyor'),
  version: z.number().int().describe('`If-Match` sürümü; ayar yokken 0 (başlık gönderilmez)'),
})

export const socialClassRowSchema = z.object({
  classId: z.string(),
  className: z.string(),
  grade: z.number().int(),
  studentCount: z.number().int(),
  metCount: z.number().int(),
  onTrackCount: z.number().int(),
  behindCount: z.number().int(),
})

export const socialClassSchema = z.object({
  classId: z.string(),
  className: z.string(),
  grade: z.number().int(),
  academicYear,
  totalTargetHours: z.number().int(),
  yearlyTargetHours: z.number().int().nullable(),
  students: z.array(
    socialProgressSchema.extend({
      studentId: z.string(),
      // kvkk: K (öğrenci)
      studentName: z.string(),
    }),
  ),
})

const studentSummary = z.object({
  studentId: z.string(),
  // kvkk: K (öğrenci)
  studentName: z.string(),
  className: z.string().nullable(),
  academicYear,
  progress: socialProgressSchema,
  entries: z.array(socialHourRowSchema).describe('Bütün kayıtlar, yeni gün önce'),
})

export const socialStudentSchema = studentSummary.extend({
  grade: z.number().int().nullable(),
})

export const socialCertificateSchema = z.object({
  studentId: z.string(),
  // kvkk: K (öğrenci)
  studentName: z.string(),
  className: z.string().nullable(),
  grade: z.number().int().nullable(),
  issuedOn: z.string().describe('Düzenleme günü (YYYY-MM-DD)'),
  totalMinutes: z.number().int().describe('Onaylı ve düzeltilmemiş kayıtların toplamı'),
  totalTargetHours: z.number().int(),
  status: z.enum(SOCIAL_PROGRESS_STATUSES),
  years: z.array(z.object({ academicYear, minutes: z.number().int() })),
  rows: z.array(
    z.object({
      entryId: z.string(),
      activityDate: z.string(),
      academicYear,
      activityName: z.string(),
      activityKind: z.enum(SOCIAL_ACTIVITY_KINDS),
      organizationScope: z.enum(SOCIAL_ACTIVITY_SCOPES),
      organizationName: z.string().nullable(),
      location: z.string(),
      // kvkk: K (personel)
      responsibleName: z.string().nullable(),
      minutes: z.number().int(),
    }),
  ),
})

export const declarableActivitySchema = socialActivityRowSchema.pick({
  id: true,
  name: true,
  kind: true,
  startDate: true,
  endDate: true,
  location: true,
  responsibleName: true,
  organizationScope: true,
  organizationName: true,
})

export const socialActivityResponse = dataResponse(socialActivityRowSchema)
export const socialActivityListResponse = z.object({
  data: z.array(socialActivityRowSchema),
  meta: pageMetaSchema,
})
export const socialActivityArchivedResponse = dataResponse(z.object({ id: z.string() }))
export const socialHourResponse = dataResponse(socialHourRowSchema)
export const socialHoursResponse = dataResponse(z.array(socialHourRowSchema))
export const socialHourListResponse = z.object({
  data: z.array(socialHourRowSchema),
  meta: pageMetaSchema,
})
export const socialSettingsResponse = dataResponse(socialSettingsSchema)
export const socialClassListResponse = dataResponse(z.array(socialClassRowSchema))
export const socialClassResponse = dataResponse(socialClassSchema)
export const socialStudentResponse = dataResponse(socialStudentSchema)
export const socialCertificateResponse = dataResponse(socialCertificateSchema)
export const mySocialHoursResponse = dataResponse(z.array(studentSummary))
export const declarableActivityListResponse = z.object({
  data: z.array(declarableActivitySchema),
  meta: pageMetaSchema,
})

const q = z.string().trim().min(2).max(100).optional()
const yearQuery = z.coerce
  .number()
  .int()
  .min(2000)
  .max(2100)
  .optional()
  .describe('Öğretim yılının başlangıç yılı; boşsa bugünün öğretim yılı')

export const socialActivityListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: q.describe('Etkinlik ya da kuruluş adında arama'),
  kind: z.enum(SOCIAL_ACTIVITY_KINDS).optional().describe('Tür süzgeci'),
})
export const declarableActivityQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: q.describe('Etkinlik ya da kuruluş adında arama'),
})
export const socialHourListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  status: z
    .enum(SOCIAL_HOUR_STATUSES)
    .optional()
    .describe('Durum süzgeci (`pending` onay kuyruğu)'),
  activityId: z.uuid('Etkinlik geçersiz.').optional().describe('Etkinlik süzgeci'),
  studentId: z.string().trim().min(1).max(100).optional().describe('Öğrenci süzgeci'),
})
export const socialYearQuery = z.strictObject({ academicYear: yearQuery })
export const socialClassQuery = z.strictObject({
  academicYear: yearQuery,
  status: z
    .enum(SOCIAL_PROGRESS_STATUSES)
    .optional()
    .describe('Durum süzgeci; `behind` eksik kalanlar'),
})

export const socialActivityParams = z.object({ activityId: z.uuid('Etkinlik geçersiz.') })
export const socialHourParams = z.object({ entryId: z.uuid('Kayıt geçersiz.') })
export const socialClassParams = z.object({ classId: z.string().trim().min(1).max(100) })
export const socialStudentParams = z.object({ studentId: z.string().trim().min(1).max(100) })
