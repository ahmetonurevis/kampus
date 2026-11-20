import { z } from 'zod'

import { PERFORMANCE_PERIOD_STATUSES } from '@kampus/school-core/lib/finance-performance.ts'
import {
  STAFF_FEEDBACK_CHANNELS,
  STAFF_FEEDBACK_RELATIONS,
  STAFF_FEEDBACK_STATUSES,
} from '@kampus/school-core/lib/finance-staff-feedback.ts'
import { SELF_EVALUATION_QUESTION_KINDS } from '@kampus/school-core/lib/finance-self-evaluations.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/**
 * Çok kaynaklı geri bildirim şemaları (DOM-FIN-134; ON-212). Yalnız yöneticiye döner. Tek bir
 * meslektaş yanıtını taşıyan şema yoktur; cevaplar yalnız toplu sonuçta çıkar (K-459).
 */

const questionKind = z.enum(SELF_EVALUATION_QUESTION_KINDS)

const questionSchema = z.object({
  kind: questionKind.describe('`scale` puanlı (1–5), `open` açık uçlu'),
  text: z.string().describe('Soru metni'),
  required: z.boolean().describe('Girişte cevap zorunlu mu'),
})

const templateSchema = z.object({
  id: z.string(),
  periodId: z.string(),
  questions: z.array(questionSchema).describe('Sorular, sırasıyla'),
  responseCount: z.number().int().describe('Bu şablonla girilmiş yanıt sayısı (geri alınan dahil)'),
  locked: z.boolean().describe('Yanıt girildiği için sorular değiştirilemez (K-457)'),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().describe('`If-Match` için şablon sürümü'),
})

const progressSchema = z.object({
  assigned: z.number().int().describe('Atanan değerlendiren'),
  responded: z.number().int().describe('Yanıtı girilen'),
  rate: z.number().nullable().describe('Yanıtlanan / atanan, yüzde (bir ondalık); atama yoksa boş'),
})

const summarySchema = progressSchema.extend({
  pending: z.number().int().describe('Yanıt bekleyen atama'),
  byRelation: z.object({ manager: progressSchema, peer: progressSchema }),
})

export const staffFeedbackTemplateResponse = dataResponse(templateSchema)
export const staffFeedbackOverviewResponse = dataResponse(
  z.object({
    periodId: z.string(),
    periodStatus: z.enum(PERFORMANCE_PERIOD_STATUSES).describe('Performans döneminin aşaması'),
    template: templateSchema.nullable().describe('Dönemin şablonu; hazırlanmadıysa boş'),
    summary: summarySchema.describe('Atanan / yanıtlanan, toplam ve ilişki türüne göre (K-458)'),
    threshold: z.number().int().describe('Kurumun meslektaş anonimlik eşiği (K-459)'),
  }),
)

const subjectSchema = z.object({
  membershipId: z.string().describe('Değerlendirilen personelin kurum üyeliği'),
  // kvkk: K
  staffName: z.string().describe('Personel adı'),
  staffRole: z.string().describe('Personelin rolü'),
  assigned: z.number().int().describe('Atanan değerlendiren'),
  responded: z.number().int().describe('Yanıtı girilen'),
  manager: progressSchema.describe('Yönetici ilişkisindeki atamalar'),
  peer: progressSchema.describe('Meslektaş ilişkisindeki atamalar'),
})
export const staffFeedbackSubjectListResponse = z.object({
  data: z.array(subjectSchema),
  meta: pageMetaSchema,
})
export const staffFeedbackSubjectListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Personel adında arama'),
})

const assignmentSchema = z.object({
  id: z.string(),
  periodId: z.string(),
  subjectMembershipId: z.string().describe('Değerlendirilen personelin kurum üyeliği'),
  // kvkk: K
  subjectName: z.string().describe('Değerlendirilen personelin adı'),
  reviewerMembershipId: z.string().describe('Değerlendirenin kurum üyeliği'),
  // kvkk: K
  reviewerName: z.string().describe('Değerlendirenin adı'),
  reviewerRole: z.string().describe('Değerlendirenin rolü'),
  relation: z.enum(STAFF_FEEDBACK_RELATIONS).describe('`manager` yönetici, `peer` meslektaş'),
  status: z
    .enum(STAFF_FEEDBACK_STATUSES)
    .describe('`pending` yanıt bekleniyor, `submitted` yanıtlandı'),
  channel: z
    .enum(STAFF_FEEDBACK_CHANNELS)
    .nullable()
    .describe('Yanıtın geldiği kanal; yanıt yoksa boş'),
  submittedAt: z.string().nullable().describe('Yanıtın girildiği an (ISO 8601 UTC)'),
  withdrawCount: z.number().int().describe('Yanıtın geri alınma sayısı'),
  withdrawnAt: z.string().nullable().describe('Son geri alma anı'),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().describe('`If-Match` için atama sürümü'),
})
export const staffFeedbackAssignmentResponse = dataResponse(assignmentSchema)
export const staffFeedbackAssignmentRemoveResponse = dataResponse(z.object({ id: z.string() }))
export const staffFeedbackAssignmentListResponse = z.object({
  data: z.array(assignmentSchema),
  meta: pageMetaSchema,
})
export const staffFeedbackAssignmentListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .describe('Değerlendirilen ya da değerlendiren adında arama'),
  subjectMembershipId: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe('Değerlendirilen süzgeci'),
  relation: z.enum(STAFF_FEEDBACK_RELATIONS).optional().describe('İlişki türü süzgeci'),
  status: z.enum(STAFF_FEEDBACK_STATUSES).optional().describe('Durum süzgeci'),
})

const answerSchema = z.object({
  score: z.number().int().nullable().describe('Puanlı soru için 1–5; boş = cevaplanmadı'),
  // kvkk: K (serbest metin)
  text: z.string().nullable().describe('Açık uçlu soru için cevap'),
})

const questionResultSchema = z.object({
  kind: questionKind,
  text: z.string().describe('Soru metni'),
  answered: z.number().int().describe('Soruyu cevaplayan meslektaş sayısı'),
  hidden: z.boolean().describe('Soru eşiğin altında cevaplandı; ortalama ve metin dönmez'),
  average: z.number().nullable().describe('Puanlı soruda ortalama (iki ondalık)'),
  // kvkk: K (serbest metin; kimden geldiği dönmez)
  texts: z.array(z.string()).describe('Açık uçlu cevaplar, alfabetik; kimden geldiği dönmez'),
})

export const staffFeedbackResultResponse = dataResponse(
  z.object({
    periodId: z.string(),
    periodStatus: z.enum(PERFORMANCE_PERIOD_STATUSES),
    membershipId: z.string().describe('Değerlendirilen personelin kurum üyeliği'),
    // kvkk: K
    staffName: z.string().describe('Değerlendirilen personelin adı'),
    staffRole: z.string(),
    threshold: z.number().int().describe('Uygulanan meslektaş anonimlik eşiği'),
    questions: z.array(questionSchema).describe('Şablonun soruları; şablon yoksa boş'),
    manager: progressSchema.extend({
      responses: z
        .array(
          z.object({
            // kvkk: K
            reviewerName: z.string().describe('Yönetici değerlendiren (anonim değil)'),
            submittedAt: z.string().nullable(),
            // kvkk: K
            answers: z.array(answerSchema).describe('Cevaplar, soru sırasıyla'),
          }),
        )
        .describe('Yönetici yanıtları, adıyla (K-459)'),
    }),
    peer: progressSchema.extend({
      visible: z.boolean().describe('Meslektaş toplu sonucu gösteriliyor mu'),
      hiddenReason: z
        .enum(['period_open', 'below_threshold'])
        .nullable()
        .describe(
          '`period_open` dönem değerlendirme aşamasına geçmedi, `below_threshold` meslektaş yanıtı eşiğin altında',
        ),
      questions: z.array(questionResultSchema).describe('Soru başına toplu meslektaş sonucu'),
    }),
  }),
)

export const staffFeedbackSettingsResponse = dataResponse(
  z.object({
    peerAnonymityThreshold: z.number().int().describe('Meslektaş anonimlik eşiği (3–10)'),
    version: z.number().int().describe('`If-Match` için ayar sürümü (hiç kaydedilmediyse 1)'),
  }),
)

export const periodParams = z.object({ periodId: z.uuid('Dönem geçersiz.') })
export const templateParams = z.object({ templateId: z.uuid('Şablon geçersiz.') })
export const assignmentParams = z.object({ assignmentId: z.uuid('Atama geçersiz.') })
export const resultParams = z.object({
  periodId: z.uuid('Dönem geçersiz.'),
  membershipId: z.string().trim().min(1).max(100),
})
