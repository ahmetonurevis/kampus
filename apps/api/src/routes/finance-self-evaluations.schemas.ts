import { z } from 'zod'

import { PERFORMANCE_PERIOD_STATUSES } from '@kampus/school-core/lib/finance-performance.ts'
import {
  SELF_EVALUATION_CHANNELS,
  SELF_EVALUATION_QUESTION_KINDS,
  SELF_EVALUATION_STATUSES,
  SELF_EVALUATION_TRACKING_STATUSES,
} from '@kampus/school-core/lib/finance-self-evaluations.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Öz değerlendirme şemaları (DOM-FIN-131; ON-210). Yalnız yöneticiye döner (K-450). */

const questionSchema = z.object({
  kind: z.enum(SELF_EVALUATION_QUESTION_KINDS).describe('`scale` puanlı (1–5), `open` açık uçlu'),
  text: z.string().describe('Soru metni'),
  required: z.boolean().describe('Gönderimde cevap zorunlu mu'),
})

const templateSchema = z.object({
  id: z.string(),
  periodId: z.string(),
  questions: z.array(questionSchema).describe('Sorular, sırasıyla'),
  responseCount: z.number().int().describe('Bu şablonla açılmış yanıt sayısı'),
  locked: z.boolean().describe('Yanıt açıldığı için sorular değiştirilemez (K-448)'),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().describe('`If-Match` için şablon sürümü'),
})

const summarySchema = z.object({
  enrolled: z.number().int().describe('Dönemde performans kaydı olan personel'),
  submitted: z.number().int().describe('Öz değerlendirmesini gönderen'),
  draft: z.number().int().describe('Yanıtı taslakta olan'),
  missing: z.number().int().describe('Yanıtı hiç açılmamış'),
  rate: z
    .number()
    .nullable()
    .describe('Gönderen oranı, yüzde (bir ondalık); dönemde personel yoksa boş'),
})

export const templateResponse = dataResponse(templateSchema)
export const overviewResponse = dataResponse(
  z.object({
    periodId: z.string(),
    periodStatus: z.enum(PERFORMANCE_PERIOD_STATUSES).describe('Performans döneminin aşaması'),
    template: templateSchema.nullable().describe('Dönemin şablonu; hazırlanmadıysa boş'),
    summary: summarySchema,
  }),
)

const trackingSchema = z.object({
  membershipId: z.string().describe('Personelin kurum üyeliği'),
  // kvkk: K
  staffName: z.string().describe('Personel adı'),
  staffRole: z.string().describe('Personelin rolü'),
  responseId: z.string().nullable().describe('Yanıt kimliği; yanıt açılmadıysa boş'),
  status: z
    .enum(SELF_EVALUATION_TRACKING_STATUSES)
    .describe('`missing` gönderilmedi (yanıt yok), `draft` taslak, `submitted` gönderildi'),
  channel: z.enum(SELF_EVALUATION_CHANNELS).nullable().describe('Yanıtın geldiği kanal'),
  submittedAt: z.string().nullable().describe('Gönderim anı (ISO 8601 UTC)'),
  reopenCount: z.number().int().describe('Geri açılma sayısı'),
  hasManagerComment: z.boolean().describe('Yönetici görüşü yazıldı mı'),
  updatedAt: z.string().nullable(),
})

export const trackingListResponse = z.object({
  data: z.array(trackingSchema),
  meta: pageMetaSchema,
})
export const trackingListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Personel adında arama'),
  status: z.enum(SELF_EVALUATION_TRACKING_STATUSES).optional().describe('Durum süzgeci'),
})

const answerSchema = z.object({
  score: z.number().int().nullable().describe('Puanlı soru için 1–5; boş = cevaplanmadı'),
  // kvkk: K (serbest metin)
  text: z.string().nullable().describe('Açık uçlu soru için cevap'),
})

const responseSchema = z.object({
  id: z.string(),
  periodId: z.string(),
  templateId: z.string(),
  membershipId: z.string().describe('Yanıtı veren personelin kurum üyeliği'),
  // kvkk: K
  staffName: z.string().describe('Personel adı'),
  staffRole: z.string().describe('Personelin rolü'),
  questions: z.array(questionSchema).describe('Şablonun soruları, sırasıyla'),
  // kvkk: K
  answers: z.array(answerSchema).describe('Cevaplar, soru sırasıyla'),
  answeredCount: z.number().int().describe('Cevaplanmış soru sayısı'),
  status: z.enum(SELF_EVALUATION_STATUSES).describe('`draft` taslak, `submitted` gönderildi'),
  channel: z
    .enum(SELF_EVALUATION_CHANNELS)
    .describe('Yanıtın geldiği kanal: `paper` kâğıt form, `email` e-posta'),
  submittedAt: z.string().nullable().describe('Gönderim anı (ISO 8601 UTC)'),
  // kvkk: K (serbest metin)
  managerComment: z.string().nullable().describe('Yöneticinin görüşü'),
  // kvkk: K
  managerCommentByName: z.string().nullable().describe('Görüşü son yazan yönetici'),
  managerCommentAt: z.string().nullable().describe('Görüşün son yazıldığı an'),
  reopenCount: z.number().int().describe('Geri açılma sayısı'),
  reopenedAt: z.string().nullable().describe('Son geri açma anı'),
  // kvkk: K (serbest metin)
  reopenReason: z.string().nullable().describe('Son geri açmanın gerekçesi'),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().describe('`If-Match` için yanıt sürümü'),
})

export const selfEvaluationResponse = dataResponse(responseSchema)

export const periodParams = z.object({ periodId: z.uuid('Dönem geçersiz.') })
export const templateParams = z.object({ templateId: z.uuid('Şablon geçersiz.') })
export const responseParams = z.object({ responseId: z.uuid('Yanıt geçersiz.') })
