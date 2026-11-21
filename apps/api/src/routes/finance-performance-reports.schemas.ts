import { z } from 'zod'

import { PERFORMANCE_PERIOD_STATUSES } from '@kampus/school-core/lib/finance-performance.ts'
import { DEVELOPMENT_GOAL_SOURCES } from '@kampus/school-core/lib/finance-observation-debriefs.ts'
import {
  PERFORMANCE_REPORT_ACK_CHANNELS,
  PERFORMANCE_REPORT_FEEDBACK_STATES,
  PERFORMANCE_REPORT_GOAL_STATUSES,
  PERFORMANCE_REPORT_SECTIONS,
  PERFORMANCE_REPORT_SELF_STATUSES,
  PERFORMANCE_REPORT_STATUSES,
  PERFORMANCE_SCORE_BANDS,
} from '@kampus/school-core/lib/finance-performance-reports.ts'
import {
  SELF_EVALUATION_CHANNELS,
  SELF_EVALUATION_QUESTION_KINDS,
} from '@kampus/school-core/lib/finance-self-evaluations.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/**
 * Performans raporu şemaları (DOM-FIN-137; ON-220). Özet ve satırlar yalnız yöneticiye, rapor
 * yöneticiye ve personelin kendisine (kesinleşmişse) döner (K-468).
 */

const reportMetaShape = {
  reportId: z.string().nullable().describe('Kesinleştirme kaydı; kesinleşmediyse boş'),
  status: z
    .enum(PERFORMANCE_REPORT_STATUSES)
    .describe('`draft` kesinleşmedi, `finalized` kesinleşti, `acknowledged` personel okudu'),
  finalizedAt: z.string().nullable().describe('Kesinleştirme anı (ISO 8601 UTC)'),
  // kvkk: K
  finalizedByName: z.string().nullable().describe('Kesinleştiren yönetici'),
  acknowledgedDate: z.string().nullable().describe('Personelin okuduğunu bildirdiği gün'),
  acknowledgementChannel: z
    .enum(PERFORMANCE_REPORT_ACK_CHANNELS)
    .nullable()
    .describe('"Okudum" kanalı: `paper` ıslak imzalı nüsha, `email` e-posta, `in_person` yüz yüze'),
  acknowledgementRecordedAt: z.string().nullable().describe('"Okudum" kaydının girildiği an'),
  // kvkk: K
  acknowledgementRecordedByName: z
    .string()
    .nullable()
    .describe('"Okudum" kaydını personel adına giren yönetici'),
}

const goalSchema = z.object({
  title: z.string(),
  criterion: z.string(),
  weight: z.number().int().describe('Ağırlık, yüzde'),
  score: z.number().int().nullable().describe('Dönem sonu puanı (1–5)'),
})

const feedbackProgressShape = {
  assigned: z.number().int().describe('Atanan değerlendiren'),
  responded: z.number().int().describe('Yanıtı girilen değerlendiren'),
}

const staffFeedbackSchema = z
  .object({
    state: z
      .enum(PERFORMANCE_REPORT_FEEDBACK_STATES)
      .describe(
        '`not_collected` dönemde şablon ya da atama yok, `period_open` dönem değerlendirme aşamasına geçmedi, `below_threshold` yeterli meslektaş yanıtı yok, `visible` meslektaş toplu sonucu görünür',
      ),
    threshold: z
      .number()
      .int()
      .describe('Meslektaş anonimlik eşiği; kesinleşmiş raporda kesinleştirme anındaki (K-468)'),
    questionCount: z.number().int(),
    manager: z
      .object({
        ...feedbackProgressShape,
        responses: z.array(
          z.object({
            // kvkk: K
            reviewerName: z.string().describe('Yönetici değerlendiren (anonim değil, K-459)'),
            submittedAt: z.string().nullable(),
            items: z.array(
              z.object({
                question: z.string(),
                kind: z.enum(SELF_EVALUATION_QUESTION_KINDS),
                score: z.number().int().nullable(),
                // kvkk: K (serbest metin)
                text: z.string().nullable(),
              }),
            ),
          }),
        ),
      })
      .describe('Yönetici yanıtları adıyla ve soru metniyle'),
    peer: z
      .object({
        ...feedbackProgressShape,
        questions: z
          .array(
            z.object({
              question: z.string(),
              kind: z.enum(SELF_EVALUATION_QUESTION_KINDS),
              answered: z.number().int().describe('Soruyu cevaplayan meslektaş sayısı'),
              hidden: z.boolean().describe('Eşik altında cevaplanan soru gizlidir'),
              average: z.number().nullable().describe('Puanlı soruda ortalama, iki ondalık'),
              // kvkk: K (anonim serbest metin, alfabetik)
              texts: z
                .array(z.string())
                .describe('Açık uçlu cevaplar, alfabetik; kimden geldiği yok'),
            }),
          )
          .describe('Yalnız `visible` durumunda dolu; tek meslektaş yanıtı hiç dönmez (K-459)'),
      })
      .describe('Meslektaş yanıtlarının toplu sonucu'),
  })
  .describe(
    'Çok kaynaklı geri bildirim (DOM-FIN-134): yalnız eşik üstünde toplu meslektaş sonucu (K-459, K-468)',
  )

const reportSchema = z.object({
  reviewId: z.string().describe('Personel × dönem performans kaydı'),
  periodId: z.string(),
  periodName: z.string(),
  periodStartDate: z.string(),
  periodEndDate: z.string(),
  periodStatus: z.enum(PERFORMANCE_PERIOD_STATUSES),
  membershipId: z.string().describe('Personelin kurum üyeliği'),
  // kvkk: K
  staffName: z.string().describe('Personel adı'),
  staffRole: z.string().describe('Personelin rolü'),
  sections: z
    .array(z.enum(PERFORMANCE_REPORT_SECTIONS))
    .describe('Rapordaki bölümler, sırasıyla (K-466)'),
  // kvkk: K
  evaluation: z
    .object({
      goals: z.array(goalSchema),
      overallScore: z.number().nullable().describe('Genel puan (ağırlıklı ortalama, 1–5)'),
      scored: z.boolean(),
      interimDate: z.string().nullable(),
      interimNote: z.string().nullable(),
      evaluatorName: z.string().nullable(),
      evaluatedAt: z.string().nullable(),
      staffComment: z.string().nullable().describe('Personelin değerlendirmeye görüşü'),
    })
    .describe('Dönem sonu değerlendirmesi (DOM-FIN-124)'),
  // kvkk: K
  selfEvaluation: z
    .object({
      status: z
        .enum(PERFORMANCE_REPORT_SELF_STATUSES)
        .describe('`missing` yanıt yok, `draft` gönderilmedi, `submitted` gönderildi'),
      submittedAt: z.string().nullable(),
      channel: z.enum(SELF_EVALUATION_CHANNELS).nullable(),
      scaleAverage: z.number().nullable().describe('Puanlı soruların ortalaması (1–5)'),
      answeredCount: z.number().int(),
      questionCount: z.number().int(),
      items: z
        .array(
          z.object({
            question: z.string(),
            kind: z.enum(SELF_EVALUATION_QUESTION_KINDS),
            score: z.number().int().nullable(),
            text: z.string().nullable(),
          }),
        )
        .describe('Soru ve cevaplar; yalnız gönderilmiş öz değerlendirmede dolu'),
      managerComment: z.string().nullable().describe('Yöneticinin öz değerlendirmeye görüşü'),
    })
    .describe('Öz değerlendirme özeti (DOM-FIN-131); yalnız gönderildiyse içerik taşır'),
  // kvkk: K
  observations: z
    .object({
      count: z.number().int(),
      averagePercent: z.number().nullable().describe("Gözlem puanı ortalaması (100'lük)"),
      items: z.array(
        z.object({
          id: z.string(),
          observedDate: z.string(),
          templateName: z.string(),
          observerName: z.string(),
          total: z.number(),
          max: z.number(),
          percent: z.number(),
        }),
      ),
    })
    .describe('Dönemdeki tamamlanmış ders gözlemleri (DOM-FIN-130)'),
  // kvkk: K
  staffFeedback: staffFeedbackSchema,
  // kvkk: K
  developmentGoals: z
    .object({
      count: z.number().int(),
      achievedCount: z.number().int().describe('Ulaşılan hedef sayısı'),
      items: z.array(
        z.object({
          id: z.string(),
          title: z.string().describe('Hedef'),
          successCriterion: z.string().describe('Başarı ölçütü'),
          source: z
            .enum(DEVELOPMENT_GOAL_SOURCES)
            .describe('`observation_debrief` gözlem görüşmesi, `direct` doğrudan'),
          observedDate: z.string().nullable().describe('Kaynak gözlemin günü'),
          followUpDate: z.string().describe('Takip tarihi'),
          status: z
            .enum(PERFORMANCE_REPORT_GOAL_STATUSES)
            .describe(
              'Durum (kesinleşmiş raporda kesinleştirme anındaki): `open` açık, `in_progress` sürüyor, `achieved` ulaşıldı',
            ),
        }),
      ),
    })
    .describe(
      'Döneme bağlı gelişim hedefleri (DOM-FIN-133): açık, süren ve ulaşılan; bırakılan girmez. Kesinleşmiş raporda kesinleştirme anındaki anlık görüntü (K-468)',
    ),
  // kvkk: K (serbest metin)
  managerOpinion: z.string().nullable().describe('Yönetici görüşü; kesinleştirmede yazılır'),
  ...reportMetaShape,
})

export const reportResponse = dataResponse(reportSchema)
export const reportQuery = z.strictObject({
  purpose: z
    .enum(['view', 'pdf'], 'Amaç `view` ya da `pdf` olmalıdır.')
    .default('view')
    .describe(
      '`view` ekran (denetim `finance.performance_report.read`), `pdf` PDF üretimi (denetim `finance.performance_report.export`)',
    ),
})

export const summaryResponse = dataResponse(
  z.object({
    periodId: z.string(),
    periodName: z.string(),
    periodStatus: z.enum(PERFORMANCE_PERIOD_STATUSES),
    periodStartDate: z.string(),
    periodEndDate: z.string(),
    staffCount: z.number().int().describe('Dönemdeki personel kaydı'),
    scoredCount: z.number().int().describe('Genel puanı hesaplanan kayıt'),
    unscoredCount: z.number().int().describe('Puanı eksik kayıt'),
    averageScore: z.number().nullable().describe('Genel puan ortalaması (iki ondalık)'),
    minScore: z.number().nullable(),
    maxScore: z.number().nullable(),
    distribution: z
      .array(z.object({ band: z.enum(PERFORMANCE_SCORE_BANDS), count: z.number().int() }))
      .describe('Genel puan bantları: `1` 1,00–1,99 … `5` 5,00'),
    observationCount: z.number().int().describe('Rapora giren tamamlanmış gözlem'),
    observationAverage: z.number().nullable().describe("Gözlem puanı ortalaması (100'lük)"),
    selfEvaluationSubmitted: z.number().int().describe('Öz değerlendirmesini gönderen'),
    finalizedCount: z.number().int().describe('Kesinleşen rapor (okunanlar dahil)'),
    acknowledgedCount: z.number().int().describe('"Okudum" kaydı girilen rapor'),
  }),
)

const rowSchema = z.object({
  reviewId: z.string(),
  membershipId: z.string(),
  // kvkk: K
  staffName: z.string(),
  staffRole: z.string(),
  // kvkk: K
  overallScore: z.number().nullable().describe('Genel puan (1–5)'),
  scored: z.boolean(),
  selfEvaluationStatus: z.enum(PERFORMANCE_REPORT_SELF_STATUSES),
  observationCount: z.number().int(),
  // kvkk: K
  observationAverage: z.number().nullable().describe("Gözlem puanı ortalaması (100'lük)"),
  ...reportMetaShape,
})

export const rowListResponse = z.object({ data: z.array(rowSchema), meta: pageMetaSchema })
export const rowListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Personel adında arama'),
})

export const periodParams = z.object({ periodId: z.uuid('Dönem geçersiz.') })
export const reviewParams = z.object({ reviewId: z.uuid('Kayıt geçersiz.') })
