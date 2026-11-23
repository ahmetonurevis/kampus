import { z } from 'zod'

import { LESSON_OBSERVATION_STATUSES } from '@kampus/school-core/lib/finance-lesson-observations.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Ders gözlem formu şemaları (DOM-FIN-130; ON-206). */

const criterionSchema = z.object({
  id: z.string().describe('Ölçüt kimliği (sürüm içinde k1, k2, …)'),
  title: z.string().describe('Ölçüt'),
  description: z.string().nullable().describe('Ölçüt açıklaması'),
  weight: z.number().int().describe('Göreli ağırlık (1–10)'),
  levels: z
    .array(z.object({ level: z.number().int(), description: z.string() }))
    .describe('0–5 seviye tanımları, sırasıyla'),
})

const templateSchema = z.object({
  id: z.string(),
  versionId: z.string().describe('Son sürümün kimliği; yeni gözlem bunu kullanır'),
  versionNumber: z.number().int().describe('Son sürüm numarası'),
  name: z.string().describe('Form adı (son sürüm)'),
  criteria: z.array(criterionSchema).describe('Son sürümün ölçütleri'),
  observationCount: z.number().int().describe('Son sürümle açılmış gözlem sayısı'),
  used: z
    .boolean()
    .describe(
      'Son sürüm gözlemde ya da aday örnek dersinde kullanıldı mı; kullanıldıysa düzeltilmez (K-445, K-471)',
    ),
  archivedAt: z.string().nullable().describe('Arşiv anı; arşivli form yeni gözlemde seçilmez'),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().describe('`If-Match` için şablon sürümü'),
})

export const templateResponse = dataResponse(templateSchema)
export const templateListResponse = z.object({
  data: z.array(templateSchema),
  meta: pageMetaSchema,
})
export const templateListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Form adında arama'),
  includeArchived: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional()
    .describe('Arşivli formları da listele'),
})

const scoreSchema = z
  .object({
    total: z.number().int().describe('Ağırlıklı seviye toplamı'),
    max: z.number().int().describe('Azami ağırlıklı toplam (5 × Σ ağırlık)'),
    percent: z.number().int().describe('100 üzerinden puan (rubrik yuvarlaması)'),
  })
  .nullable()
  .describe('Sunucunun hesapladığı puan (rubrik kuralı, DOM-BEC-021); seviyesi eksikse boş')

const ratingSchema = z.object({
  criterionId: z.string(),
  level: z.number().int().nullable().describe('Verilen seviye (0–5); boş = verilmedi'),
  // kvkk: K (serbest metin)
  note: z.string().nullable().describe('Ölçüt notu'),
})

const observationSchema = z.object({
  id: z.string(),
  templateId: z.string(),
  templateVersionId: z.string(),
  templateName: z.string().describe('Kullanılan formun adı (gözlemin sürümü)'),
  templateVersionNumber: z.number().int(),
  // kvkk: K
  teacherMembershipId: z.string().describe('Gözlenen öğretmenin kurum üyeliği'),
  teacherName: z.string(),
  // kvkk: K
  observerMembershipId: z.string().describe('Gözlemcinin kurum üyeliği'),
  observerName: z.string(),
  observedDate: z.string().describe('Gözlem günü (YYYY-MM-DD)'),
  classId: z.string().nullable(),
  className: z.string().nullable(),
  subjectId: z.string().nullable(),
  subjectName: z.string().nullable(),
  performancePeriodId: z.string().nullable().describe('Bağlı performans dönemi (DOM-FIN-124)'),
  // kvkk: K
  ratings: z.array(ratingSchema).describe('Ölçüt seviyeleri, formun ölçüt sırasıyla'),
  // kvkk: K (serbest metin)
  generalNote: z.string().nullable().describe('Genel değerlendirme'),
  status: z
    .enum(LESSON_OBSERVATION_STATUSES)
    .describe('`draft` taslak (düzeltilebilir), `completed` tamamlandı (değişmez)'),
  completedAt: z.string().nullable(),
  criterionCount: z.number().int(),
  ratedCount: z.number().int().describe('Seviyesi verilmiş ölçüt sayısı'),
  score: scoreSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

export const observationListResponse = z.object({
  data: z.array(observationSchema),
  meta: pageMetaSchema,
})
export const observationListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Öğretmen adında arama'),
  status: z.enum(LESSON_OBSERVATION_STATUSES).optional().describe('Durum süzgeci'),
  performancePeriodId: z.uuid().optional().describe('Performans dönemi süzgeci'),
})

/** Tek gözlem: kayıt ve kullanılan sürümün ölçütleri (seviye tanımlarıyla). */
export const observationDetailResponse = dataResponse(
  observationSchema.extend({
    criteria: z.array(criterionSchema).describe('Gözlemin form sürümündeki ölçütler'),
  }),
)
export const observationResponse = observationDetailResponse

/** Taslak arşivinin yanıtı: arşivli gözlem okunmaz, yalnız kimlik ve an döner. */
export const observationArchiveResponse = dataResponse(
  z.object({ id: z.string(), archivedAt: z.string().describe('Arşiv anı (ISO 8601 UTC)') }),
)

export const templateParams = z.object({ templateId: z.uuid('Form geçersiz.') })
export const observationParams = z.object({ observationId: z.uuid('Gözlem geçersiz.') })
