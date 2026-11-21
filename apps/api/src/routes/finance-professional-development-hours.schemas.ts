import { z } from 'zod'

import { PROFESSIONAL_DEVELOPMENT_HOURS_STATUSES } from '@kampus/school-core/lib/finance-professional-development-hours.ts'
import { STAFF_ROLES } from '@kampus/school-core/lib/staff-accounts.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Mesleki gelişim saati, hedef ve belge şemaları (DOM-FIN-144; ON-215). */

const academicYear = z.coerce
  .number('Öğretim yılı geçersiz.')
  .int('Öğretim yılı geçersiz.')
  .min(2000, 'Öğretim yılı geçersiz.')
  .max(2100, 'Öğretim yılı geçersiz.')
  .describe('Öğretim yılının başlangıç yılı (2026 → 2026–2027)')

export const targetParams = z.object({ academicYear })

const targetSchema = z.object({
  academicYear: z.number().int(),
  startDate: z.string().describe('Öğretim yılı başlangıcı (kayıtlı yıl ya da 1 Eylül)'),
  endDate: z.string().describe('Öğretim yılı sonu (kayıtlı yıl ya da 31 Ağustos)'),
  targetHours: z.number().int().nullable().describe('Hedef saat; tanımsızsa boş'),
  appliesToRoles: z.array(z.enum(STAFF_ROLES)).describe('Hedefin uygulandığı roller'),
  updatedAt: z.string().nullable(),
  version: z.number().int().nullable(),
})
export const targetResponse = dataResponse(targetSchema)

export const hoursListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  academicYear: academicYear.optional().describe('Öğretim yılı; verilmezse içinde bulunulan yıl'),
  q: z.string().trim().min(2).max(100).optional().describe('Personel adında arama'),
  status: z
    .enum(PROFESSIONAL_DEVELOPMENT_HOURS_STATUSES)
    .optional()
    .describe('`missing` eksik saati olan, `met` hedefi tamamlayan (yalnız hedef rollerinde)'),
})

const hoursRow = z.object({
  membershipId: z.string(),
  // kvkk: K
  name: z.string().describe('Personel adı'),
  role: z.string(),
  attendedCount: z.number().int().describe('Yıl içinde katıldığı eğitim sayısı'),
  completedHours: z.number().describe('Tamamlanan saat (katılım saatlerinin toplamı)'),
  targetHours: z.number().nullable().describe('Hedef; hedef yoksa ya da rolüne uygulanmıyorsa boş'),
  missingHours: z.number().nullable().describe('Eksik saat; hedef yoksa boş'),
  met: z.boolean().nullable().describe('Hedef tamamlandı mı; hedef yoksa boş'),
})
export const hoursListResponse = z.object({
  data: z.array(hoursRow),
  meta: pageMetaSchema.extend({
    academicYear: z.number().int().describe('Özetin öğretim yılı'),
  }),
})

export const documentUrlResponse = dataResponse(
  z.object({
    url: z.string().describe('Kısa ömürlü imzalı GET bağlantısı'),
    expiresAt: z.string().describe('Bağlantının geçerlilik sonu'),
  }),
)
