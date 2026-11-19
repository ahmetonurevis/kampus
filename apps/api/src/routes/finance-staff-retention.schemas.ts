import { z } from 'zod'

import {
  STAFF_RETENTION_CATEGORIES,
  STAFF_RETENTION_METHODS,
  STAFF_RETENTION_START_EVENTS,
  STAFF_RETENTION_STATUSES,
} from '@kampus/school-core/lib/finance-staff-retention.ts'

import { dataResponse, pageResponse, pageQuerySchema } from './common.schemas.ts'

/** Özlük verisi saklama ve imha şemaları (DOM-FIN-122; ON-176). İmha kaydı kişisel veri taşımaz. */

const category = z
  .enum(STAFF_RETENTION_CATEGORIES)
  .describe(
    '`sick_leave_reports` istirahat raporları, `health_reports` sağlık raporu belgeleri, `criminal_records` adli sicil kayıtları, `personnel_file` özlük dosyası, `leave_records` izin kayıtları, `payroll_records` mali kayıtlar',
  )
const method = z
  .enum(STAFF_RETENTION_METHODS)
  .describe('`delete` fiziksel silme, `anonymize` kişi düzeyinde silinerek anonimleştirme (K-416)')
const startEvent = z
  .enum(STAFF_RETENTION_START_EVENTS)
  .describe(
    '`separation_day` ayrılış günü, `year_after_separation` ayrılış yılını izleyen yıl başı',
  )

const policyEntrySchema = z.object({
  category,
  retentionMonths: z.number().int().describe('Geçerli saklama süresi (ay)'),
  legalMinimumMonths: z
    .number()
    .int()
    .describe('Yasal en az süre (ay); varsayılan budur, altına inilemez'),
  maximumMonths: z.number().int().describe('Girilebilecek en uzun süre (ay)'),
  startEvent,
  method,
  special: z.boolean().describe('Özel nitelikli kişisel veri (KVKK md. 6)'),
  customized: z.boolean().describe('Kurum ayarı mı (`false` ise yasal en az süre)'),
  updatedAt: z.string().nullable(),
})
export const staffRetentionPolicyResponse = dataResponse(z.array(policyEntrySchema))

const candidateSchema = z.object({
  membershipId: z.string().describe('Ayrılmış personelin kurum üyeliği'),
  name: z.string(),
  role: z.string().describe('Ayrılıştaki rol (`yonetici`, `ogretmen`, `onburo`)'),
  separationDate: z.string().describe('Ayrılış günü: pasifleştirildiği Europe/Istanbul günü'),
  category,
  method,
  special: z.boolean(),
  recordCount: z.number().int().describe('Kategoride imha edilecek kayıt sayısı'),
  retentionMonths: z.number().int(),
  dueDate: z.string().describe('İmha edilebileceği ilk gün (dahil)'),
  status: z
    .enum(STAFF_RETENTION_STATUSES)
    .describe('`due` süre doldu, imha edilebilir; `waiting` süre sürüyor'),
  daysLeft: z.number().int().describe('İmhaya kalan gün; dolmuşsa 0 ya da eksi'),
})
export const staffRetentionCandidateListResponse = pageResponse(candidateSchema)

export const staffRetentionCandidateQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Personel adında arama'),
  category: category.optional(),
  status: z
    .enum(STAFF_RETENTION_STATUSES)
    .optional()
    .describe('`due` yalnız süresi dolan, `waiting` yalnız süresi süren'),
})

const destructionSchema = z.object({
  id: z.uuid(),
  category,
  method,
  recordCount: z.number().int().describe('İmha edilen kayıt sayısı'),
  fileCount: z.number().int().describe('İmhaya işaretlenen dosya sayısı'),
  retentionMonths: z.number().int().describe('Uygulanan saklama süresi (ay)'),
  startEvent,
  destroyedAt: z.string(),
  destroyedByUserId: z.string().describe('İmhayı onaylayan yönetici'),
  destroyedByName: z.string().nullable(),
})
export const staffDataDestructionResponse = dataResponse(destructionSchema)
export const staffDataDestructionListResponse = pageResponse(destructionSchema)

export const staffDataDestructionQuery = z.strictObject({
  ...pageQuerySchema.shape,
  category: category.optional(),
})
