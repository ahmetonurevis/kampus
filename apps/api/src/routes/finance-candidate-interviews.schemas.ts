import { z } from 'zod'

import {
  CANDIDATE_INTERVIEW_STATUSES,
  CANDIDATE_INTERVIEW_TYPES,
} from '@kampus/school-core/lib/finance-candidate-interviews.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Aday değerlendirme ve mülakat şemaları (DOM-FIN-138; ON-178). */

const templateCriterionSchema = z.object({
  id: z.string().describe('Ölçüt kimliği (sürüm içinde k1, k2, …)'),
  title: z.string(),
  description: z.string().nullable(),
  weight: z.number().int().describe('Göreli ağırlık (1–10)'),
})

const templateSchema = z.object({
  id: z.string(),
  versionId: z.string().describe('Son sürümün kimliği; yeni mülakat bunu kullanır'),
  versionNumber: z.number().int().describe('Son sürüm numarası'),
  name: z.string().describe('Form adı (son sürüm)'),
  scaleMax: z.number().int().describe('Puan ölçeğinin üst ucu (puanlar 1–scaleMax)'),
  criteria: z.array(templateCriterionSchema).describe('Son sürümün ölçütleri'),
  interviewCount: z.number().int().describe('Son sürümle planlanmış mülakat sayısı'),
  used: z
    .boolean()
    .describe('Son sürüm mülakatta kullanıldı mı; kullanıldıysa düzeltilmez (K-470)'),
  archivedAt: z.string().nullable().describe('Arşiv anı; arşivli form yeni mülakatta seçilmez'),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().describe('`If-Match` için şablon sürümü'),
})

export const interviewTemplateResponse = dataResponse(templateSchema)
export const interviewTemplateListResponse = z.object({
  data: z.array(templateSchema),
  meta: pageMetaSchema,
})
export const interviewTemplateListQuery = z.strictObject({
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
    total: z.number().int().describe('Ağırlıklı puan toplamı'),
    max: z.number().int().describe('Azami ağırlıklı toplam'),
    percent: z.number().int().describe('100 üzerinden puan'),
  })
  .nullable()
  .describe('Sunucunun hesapladığı puan; gönderilmemişse boş')

const formSchema = z
  .object({
    kind: z
      .enum(['interview', 'observation'])
      .describe('`interview` mülakat formu, `observation` örnek derste ders gözlem formu (K-471)'),
    templateId: z.string(),
    versionId: z.string(),
    versionNumber: z.number().int(),
    name: z.string(),
    scaleMin: z.number().int().describe('En düşük puan (mülakat formunda 1, gözlemde 0)'),
    scaleMax: z.number().int().describe('En yüksek puan (mülakat formunun ölçeği, gözlemde 5)'),
    criteria: z.array(
      templateCriterionSchema.extend({
        levels: z
          .array(z.object({ level: z.number().int(), description: z.string() }))
          .describe('Gözlem formunda 0–5 seviye tanımları; mülakat formunda boş'),
      }),
    ),
  })
  .describe('Mülakatın form sürümü')

const evaluationSchema = z.object({
  id: z.string(),
  // kvkk: K
  evaluatorMembershipId: z.string().describe('Değerlendiricinin kurum üyeliği'),
  evaluatorName: z.string(),
  mine: z.boolean().describe('Değerlendirici isteği yapan mı'),
  submittedAt: z.string().nullable().describe('Gönderim anı; doluysa değişmez'),
  // kvkk: K
  ratings: z
    .array(
      z.object({
        criterionId: z.string(),
        score: z.number().int(),
        // kvkk: K (serbest metin)
        note: z.string().nullable(),
      }),
    )
    .nullable()
    .describe('Gönderilen puanlar, formun ölçüt sırasıyla; anonimleştirmede notlar boş'),
  // kvkk: K (serbest metin)
  generalNote: z.string().nullable().describe('Genel değerlendirme; anonimleştirmede boş'),
  score: scoreSchema,
})

const type = z
  .enum(CANDIDATE_INTERVIEW_TYPES)
  .describe(
    '`pre_screen` ön görüşme, `in_person` yüz yüze, `online` çevrim içi, `sample_lesson` örnek ders',
  )
const status = z
  .enum(CANDIDATE_INTERVIEW_STATUSES)
  .describe('`planned` planlandı, `completed` yapıldı, `cancelled` iptal')

const interviewSchema = z.object({
  id: z.string(),
  jobApplicationId: z.string(),
  type,
  scheduledAt: z.string().describe('Mülakat anı (ISO 8601 UTC)'),
  // kvkk: K
  location: z.string().nullable(),
  // kvkk: K
  meetingUrl: z.string().nullable(),
  status,
  completedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  form: formSchema,
  evaluatorCount: z.number().int(),
  submittedCount: z.number().int().describe('Gönderilmiş değerlendirme sayısı'),
  averagePercent: z
    .number()
    .int()
    .nullable()
    .describe('Gönderilmiş değerlendirmelerin 100’lük ortalaması; yoksa boş'),
  evaluations: z.array(evaluationSchema).describe('Değerlendiriciler, ada göre'),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().describe('`If-Match` için mülakat sürümü'),
})

export const candidateInterviewSummarySchema = z
  .object({
    plannedCount: z.number().int(),
    completedCount: z.number().int(),
    cancelledCount: z.number().int(),
    submittedCount: z.number().int().describe('Yapılmış mülakatlardaki gönderilmiş değerlendirme'),
    interviewAveragePercent: z
      .number()
      .int()
      .nullable()
      .describe('Mülakat formlu yapılmış mülakatların değerlendirici ortalamalarının ortalaması'),
    sampleLessonAveragePercent: z
      .number()
      .int()
      .nullable()
      .describe('Örnek derslerin gözlem puanı ortalaması (ölçek farklı olduğu için ayrı)'),
  })
  .describe('Başvurunun mülakat özeti (K-469)')

export const candidateInterviewResponse = dataResponse(interviewSchema)
export const applicationInterviewsResponse = dataResponse(
  z.object({ interviews: z.array(interviewSchema), summary: candidateInterviewSummarySchema }),
)

const assignedSchema = z.object({
  id: z.string(),
  jobApplicationId: z.string(),
  // kvkk: K
  candidateName: z.string(),
  postingTitle: z.string(),
  type,
  scheduledAt: z.string(),
  // kvkk: K
  location: z.string().nullable(),
  // kvkk: K
  meetingUrl: z.string().nullable(),
  status,
  form: formSchema,
  evaluation: evaluationSchema.describe('İsteği yapanın değerlendirme satırı'),
})
export const assignedInterviewListResponse = z.object({
  data: z.array(assignedSchema),
  meta: pageMetaSchema,
})
export const assignedInterviewListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  pending: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional()
    .describe('`true` yalnız henüz gönderilmemiş değerlendirmeler'),
})

export const interviewTemplateParams = z.object({ templateId: z.uuid('Form geçersiz.') })
export const interviewParams = z.object({ interviewId: z.uuid('Mülakat geçersiz.') })
export const interviewApplicationParams = z.object({
  applicationId: z.uuid('Başvuru geçersiz.'),
})
