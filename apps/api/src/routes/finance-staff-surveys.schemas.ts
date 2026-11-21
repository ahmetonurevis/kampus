import { z } from 'zod'

import {
  STAFF_SURVEY_NO_UNIT,
  STAFF_SURVEY_PHASES,
  STAFF_SURVEY_QUESTION_KINDS,
  STAFF_SURVEY_STATUSES,
} from '@kampus/school-core/lib/finance-staff-surveys.ts'
import { STAFF_ROLES } from '@kampus/school-core/lib/staff-accounts.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/**
 * Personel memnuniyet anketi şemaları (DOM-FIN-143; ON-191). Tek bir yanıtı ya da yanıtlayanı
 * taşıyan şema yoktur: cevaplar yalnız toplu sonuçta çıkar, açık uçlu cevaplar karışık sırada ve
 * zamansızdır (K-485, K-486).
 */

const questionSchema = z.object({
  kind: z.enum(STAFF_SURVEY_QUESTION_KINDS).describe('`likert` 1–5, `enps` 0–10, `open` açık uçlu'),
  text: z.string().describe('Soru metni'),
  required: z.boolean().describe('Yanıtta cevap zorunlu mu'),
})

const participationSchema = z.object({
  participants: z.number().int().describe('Yayımda donan katılımcı sayısı'),
  responded: z.number().int().describe('Yanıtlayan sayısı (kimin yanıtladığı dönmez)'),
  rate: z.number().nullable().describe('Yanıtlayan / katılımcı, yüzde (bir ondalık)'),
})

const surveyFields = {
  id: z.string(),
  title: z.string().describe('Anket başlığı'),
  revision: z.number().int().describe('Sürüm numarası (ilk anket 1)'),
  sourceSurveyId: z.string().nullable().describe('Yeni sürümün kopyalandığı anket'),
  status: z.enum(STAFF_SURVEY_STATUSES).describe('`draft` taslak, `published` yayımlandı'),
  phase: z
    .enum(STAFF_SURVEY_PHASES)
    .describe('`draft`, `scheduled` açılmadı, `open` yanıta açık, `closed` kapandı (bugünden)'),
  openDate: z.string().describe('Açılış günü (Europe/Istanbul, dahil)'),
  closeDate: z.string().describe('Kapanış günü (Europe/Istanbul, dahil)'),
  anonymityThreshold: z.number().int().describe('Sonuç için en az yanıt (3–10)'),
  audience: z.object({
    roles: z.array(z.enum(STAFF_ROLES)).describe('Rol süzgeci; boş = bütün personel'),
    unitIds: z.array(z.string()).describe('Birim süzgeci; boş = birim süzgeci yok'),
  }),
  questionCount: z.number().int(),
  participation: participationSchema.nullable().describe('Katılım oranı; taslakta boş (K-486)'),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().describe('`If-Match` için anket sürümü'),
}

const surveyRowSchema = z.object(surveyFields)
const surveySchema = z.object({
  ...surveyFields,
  questions: z.array(questionSchema).describe('Sorular, sırasıyla'),
})

export const staffSurveyResponse = dataResponse(surveySchema)
export const staffSurveyDetailResponse = dataResponse(
  surveySchema.extend({
    audienceSize: z
      .number()
      .int()
      .describe('Hedef kitle: taslakta bugünkü personelle hesaplanır, yayımlanmışta donan liste'),
    audienceUnits: z
      .array(z.object({ id: z.string(), name: z.string() }))
      .describe('Birim süzgecindeki birimlerin adları'),
  }),
)
export const staffSurveyListResponse = z.object({
  data: z.array(surveyRowSchema),
  meta: pageMetaSchema,
})
export const staffSurveyListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Başlıkta arama'),
  phase: z.enum(STAFF_SURVEY_PHASES).optional().describe('Aşama süzgeci'),
})
export const staffSurveyArchiveResponse = dataResponse(z.object({ id: z.string() }))

const questionResultSchema = z.object({
  kind: z.enum(STAFF_SURVEY_QUESTION_KINDS),
  text: z.string(),
  required: z.boolean(),
  answered: z.number().int().nullable().describe('Cevaplayan sayısı; gizliyse boş'),
  hidden: z.boolean().describe('Eşik ya da tamamlayıcı gizleme nedeniyle gizli'),
  average: z.number().nullable().describe('Puanlı soruda ortalama (iki ondalık)'),
  distribution: z
    .array(z.number().int())
    .describe('Puanlı soruda ölçeğin her değerinin yanıt sayısı, küçükten büyüğe'),
  enps: z
    .object({
      score: z.number().int().describe('eNPS: tavsiye eden % − kötüleyen % (−100…100)'),
      promoters: z.number().int().describe('9–10'),
      passives: z.number().int().describe('7–8'),
      detractors: z.number().int().describe('0–6'),
    })
    .nullable(),
  // kvkk: K (serbest metin; kimden ve ne zaman geldiği dönmez)
  texts: z.array(z.string()).describe('Açık uçlu cevaplar, karışık sırada'),
})

export const staffSurveyResultResponse = dataResponse(
  participationSchema.extend({
    surveyId: z.string(),
    title: z.string(),
    phase: z.enum(STAFF_SURVEY_PHASES),
    closeDate: z.string(),
    threshold: z.number().int().describe('Uygulanan anonimlik eşiği'),
    unit: z.string().nullable().describe('Seçilen birim kırılımı; `none` birimsiz, boş = hepsi'),
    visible: z.boolean().describe('Sonuç gösteriliyor mu'),
    hiddenReason: z
      .enum(['not_closed', 'below_threshold', 'unit_below_threshold'])
      .nullable()
      .describe(
        '`not_closed` anket kapanmadı, `below_threshold` yanıt eşiğin altında, `unit_below_threshold` seçilen birim eşik ya da tamamlayıcı gizlemeye takıldı',
      ),
    units: z
      .array(z.object({ unit: z.string(), name: z.string(), responses: z.number().int() }))
      .describe('Seçilebilen birimler (eşik ve tamamlayıcı gizlemeyi geçen), yanıt sayısıyla'),
    questions: z.array(questionResultSchema),
  }),
)
export const staffSurveyResultQuery = z.strictObject({
  unit: z
    .union([z.uuid('Birim geçersiz.'), z.literal(STAFF_SURVEY_NO_UNIT)])
    .optional()
    .describe('Birim kırılımı: birim kimliği ya da `none` (birimsiz); verilmezse bütün yanıtlar'),
})

const assignedSchema = z.object({
  id: z.string(),
  title: z.string(),
  openDate: z.string(),
  closeDate: z.string(),
  phase: z.enum(STAFF_SURVEY_PHASES).describe('`scheduled` açılmadı ya da `open` yanıta açık'),
  anonymityThreshold: z.number().int(),
  questions: z.array(questionSchema),
  responded: z.boolean().describe('Bu anketi yanıtladınız mı'),
})
export const staffSurveyAssignedResponse = z.object({
  data: z.array(assignedSchema),
  meta: pageMetaSchema,
})
export const staffSurveyAssignedQuery = z.strictObject({ ...pageQuerySchema.shape })
export const staffSurveyRespondResponse = dataResponse(
  z.object({ surveyId: z.string(), responded: z.literal(true) }),
)

export const surveyParams = z.object({ surveyId: z.uuid('Anket geçersiz.') })
