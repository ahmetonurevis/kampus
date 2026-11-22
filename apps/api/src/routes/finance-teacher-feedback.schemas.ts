import { z } from 'zod'

import {
  TEACHER_FEEDBACK_PHASES,
  TEACHER_FEEDBACK_QUESTION_KINDS,
  TEACHER_FEEDBACK_RESPONDENT_ROLES,
  TEACHER_FEEDBACK_STATUSES,
} from '@kampus/school-core/lib/finance-teacher-feedback.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/**
 * Öğretmen geri bildirim anketi şemaları (DOM-FIN-159; ON-213). Tek bir yanıtı ya da yanıtlayanı
 * taşıyan şema yoktur: cevaplar yalnız öğretmen başına toplu sonuçta çıkar, açık uçlu cevaplar
 * karışık sırada, sınıfsız ve zamansızdır (K-532, K-533).
 */

const questionSchema = z.object({
  kind: z.enum(TEACHER_FEEDBACK_QUESTION_KINDS).describe('`likert` 1–5, `open` açık uçlu'),
  text: z.string().describe('Soru metni'),
  required: z.boolean().describe('Yanıtta cevap zorunlu mu'),
})

const participationSchema = z.object({
  responses: z.number().int().describe('Alınan yanıt sayısı (öğretmen başına bir yanıt)'),
  respondents: z.number().int().describe('Yanıtlayan kişi sayısı (kimin yanıtladığı dönmez)'),
})

const surveyFields = {
  id: z.string(),
  title: z.string().describe('Anket başlığı'),
  term: z.string().describe('Dönem adı'),
  status: z.enum(TEACHER_FEEDBACK_STATUSES).describe('`draft` taslak, `published` yayımlandı'),
  phase: z
    .enum(TEACHER_FEEDBACK_PHASES)
    .describe('`draft`, `scheduled` açılmadı, `open` yanıta açık, `closed` kapandı'),
  openDate: z.string().describe('Açılış günü (Europe/Istanbul, dahil)'),
  closeDate: z.string().describe('Kapanış günü (Europe/Istanbul, dahil)'),
  anonymityThreshold: z.number().int().describe('Öğretmen başına sonuç için en az yanıt (5–20)'),
  audience: z.object({
    respondents: z
      .array(z.enum(TEACHER_FEEDBACK_RESPONDENT_ROLES))
      .describe('Yanıtlayan roller: `ogrenci`, `veli`'),
    classIds: z.array(z.string()).describe('Sınıf süzgeci; boş = bütün sınıflar'),
  }),
  questionCount: z.number().int(),
  participation: participationSchema.nullable().describe('Katılım sayıları; taslakta boş'),
  publishedAt: z.string().nullable(),
  closedAt: z.string().nullable().describe('Erken kapatma anı; boşsa kapanış gününde kapanır'),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().describe('`If-Match` için anket sürümü'),
}

const surveyRowSchema = z.object(surveyFields)
const surveySchema = z.object({
  ...surveyFields,
  questions: z.array(questionSchema).describe('Sorular, sırasıyla'),
})

export const teacherFeedbackSurveyResponse = dataResponse(surveySchema)
export const teacherFeedbackDetailResponse = dataResponse(
  surveySchema.extend({
    audienceClasses: z
      .array(z.object({ id: z.string(), name: z.string() }))
      .describe('Sınıf süzgecindeki sınıfların adları'),
  }),
)
export const teacherFeedbackListResponse = z.object({
  data: z.array(surveyRowSchema),
  meta: pageMetaSchema,
})
export const teacherFeedbackListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Başlık ve dönemde arama'),
  phase: z.enum(TEACHER_FEEDBACK_PHASES).optional().describe('Aşama süzgeci'),
})
export const teacherFeedbackArchiveResponse = dataResponse(z.object({ id: z.string() }))

const questionResultSchema = z.object({
  kind: z.enum(TEACHER_FEEDBACK_QUESTION_KINDS),
  text: z.string(),
  required: z.boolean(),
  answered: z.number().int().nullable().describe('Cevaplayan sayısı; gizliyse boş'),
  hidden: z.boolean().describe('Eşik nedeniyle gizli'),
  average: z.number().nullable().describe('Ölçek sorusunda ortalama (iki ondalık)'),
  distribution: z.array(z.number().int()).describe('Ölçek sorusunda 1–5 değerlerinin sayısı'),
  // kvkk: K (serbest metin; kimden, hangi sınıftan ve ne zaman geldiği dönmez)
  texts: z.array(z.string()).describe('Açık uçlu cevaplar, karışık sırada; eşik altında boş'),
})

const groupSchema = z.object({
  key: z.string().describe('Sınıf kimliği ya da `other` (birleşen küçük sınıflar)'),
  name: z.string().describe('Sınıf adı ya da "Diğer sınıflar"'),
  classIds: z.array(z.string()).describe('Gruptaki sınıflar'),
  responses: z.number().int(),
  average: z.number().nullable().describe('Ölçek sorularının genel ortalaması'),
})

const teacherResultFields = {
  teacherId: z.string(),
  responses: z.number().int().describe('Yanıt sayısı'),
  visible: z.boolean().describe('Sonuç gösteriliyor mu'),
  hiddenReason: z
    .enum(['not_closed', 'below_threshold'])
    .nullable()
    .describe('`not_closed` anket kapanmadı, `below_threshold` yanıt eşiğin altında'),
  average: z.number().nullable().describe('Ölçek sorularının genel ortalaması (iki ondalık)'),
  questions: z.array(questionResultSchema),
  groups: z
    .array(groupSchema)
    .describe('Sınıf kırılımı; eşik altındaki sınıflar birleşir, tek grupta boş'),
}

export const teacherFeedbackResultResponse = dataResponse(
  participationSchema.extend({
    surveyId: z.string(),
    title: z.string(),
    term: z.string(),
    phase: z.enum(TEACHER_FEEDBACK_PHASES),
    closeDate: z.string(),
    threshold: z.number().int().describe('Uygulanan anonimlik eşiği'),
    teachers: z
      .array(z.object({ ...teacherResultFields, teacherName: z.string() }))
      .describe('Yanıt alan öğretmenler, ada göre'),
  }),
)

const trendPointSchema = z.object({
  surveyId: z.string(),
  title: z.string(),
  term: z.string(),
  closeDate: z.string(),
  responses: z.number().int(),
  visible: z.boolean(),
  average: z.number().nullable().describe('Genel ortalama; eşik altında boş'),
})

export const teacherFeedbackTrendResponse = dataResponse(
  z.object({
    teacherId: z.string(),
    teacherName: z.string(),
    trend: z.array(trendPointSchema).describe('Kapanan anketler, eskiden yeniye, en çok 12'),
  }),
)
export const teacherFeedbackTrendQuery = z.strictObject({
  teacherId: z.string().trim().min(1).max(100).describe('Öğretmen kaydı (`teachers`)'),
})

export const teacherFeedbackMineResponse = dataResponse(
  z.object({
    teacherId: z.string().nullable().describe('Bağlı öğretmen kaydı; yoksa boş'),
    surveys: z
      .array(
        z.object({
          surveyId: z.string(),
          title: z.string(),
          term: z.string(),
          closeDate: z.string(),
          threshold: z.number().int(),
          ...teacherResultFields,
        }),
      )
      .describe('Kapanan anketlerdeki kendi sonucunuz, yeniden eskiye'),
    trend: z.array(trendPointSchema),
  }),
)

const assignedSchema = z.object({
  id: z.string(),
  title: z.string(),
  term: z.string(),
  openDate: z.string(),
  closeDate: z.string(),
  phase: z.enum(TEACHER_FEEDBACK_PHASES).describe('`scheduled` açılmadı ya da `open` yanıta açık'),
  anonymityThreshold: z.number().int(),
  questions: z.array(questionSchema),
  teachers: z
    .array(
      z.object({
        teacherId: z.string(),
        name: z.string(),
        responded: z.boolean().describe('Bu öğretmeni değerlendirdiniz mi'),
      }),
    )
    .describe('Değerlendirebileceğiniz öğretmenler'),
})
export const teacherFeedbackAssignedResponse = dataResponse(z.array(assignedSchema))
export const teacherFeedbackRespondResponse = dataResponse(
  z.object({ surveyId: z.string(), teacherId: z.string(), responded: z.literal(true) }),
)

export const teacherFeedbackParams = z.object({ surveyId: z.uuid('Anket geçersiz.') })
