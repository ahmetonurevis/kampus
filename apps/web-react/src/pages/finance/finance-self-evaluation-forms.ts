import { z } from 'zod'
import type {
  SelfEvaluationDetail,
  SelfEvaluationOverview,
} from '@kampus/react-shared/use-finance-self-evaluations.ts'
import type { PerformancePeriodStatus } from '@kampus/school-core/lib/finance-performance.ts'
import {
  isSelfEvaluationOpen,
  SELF_EVALUATION_CHANNELS,
  SELF_EVALUATION_REASON_MAX,
  SELF_EVALUATION_REASON_MIN,
  SELF_EVALUATION_SCORE_MAX,
  SELF_EVALUATION_SCORE_MIN,
  SELF_EVALUATION_TEXT_MAX,
  selfEvaluationTemplateInputSchema,
  type SelfEvaluationAnswer,
  type SelfEvaluationChannel,
  type SelfEvaluationQuestion,
} from '@kampus/school-core/lib/finance-self-evaluations.ts'

// Öz değerlendirme formlarının saf mantığı (DOM-FIN-131; ON-210): şablon soruları, cevap formu
// ve gövdesi, eksik zorunlu soru ve özet metni (K-448…K-450). Bileşen yalnız bağlar; kural
// doğrulaması core şemasında ve sunucudadır.

export type SelfEvaluationQuestionFormValue = SelfEvaluationQuestion

export type SelfEvaluationTemplateFormValues = { questions: SelfEvaluationQuestionFormValue[] }

/** Şablon formu core şemasıyla doğrulanır (1–20 soru, metin 5–300). */
export const selfEvaluationTemplateFormSchema = selfEvaluationTemplateInputSchema

export const emptySelfEvaluationQuestion = (): SelfEvaluationQuestionFormValue => ({
  kind: 'scale',
  text: '',
  required: true,
})

export function selfEvaluationTemplateDefaults(
  template: SelfEvaluationOverview['template'],
): SelfEvaluationTemplateFormValues {
  return {
    questions:
      template === null
        ? [emptySelfEvaluationQuestion()]
        : template.questions.map((question) => ({ ...question })),
  }
}

export const SELF_EVALUATION_SCORE_OPTIONS = Array.from(
  { length: SELF_EVALUATION_SCORE_MAX - SELF_EVALUATION_SCORE_MIN + 1 },
  (_, index) => String(SELF_EVALUATION_SCORE_MIN + index),
)

export type SelfEvaluationAnswerFormValues = {
  channel: SelfEvaluationChannel
  /** Soru sırasıyla: puanlı soruda `score` `''` ya da "1"…"5", açık uçluda `text`. */
  answers: { score: string; text: string }[]
}

export const selfEvaluationAnswerFormSchema = z.object({
  channel: z.enum(SELF_EVALUATION_CHANNELS, 'Yanıtın geldiği kanalı seçin.'),
  answers: z.array(
    z.object({
      score: z.string(),
      text: z
        .string()
        .max(
          SELF_EVALUATION_TEXT_MAX,
          `En fazla ${String(SELF_EVALUATION_TEXT_MAX)} karakter girebilirsiniz.`,
        ),
    }),
  ),
})

export function selfEvaluationAnswerDefaults(
  questions: readonly SelfEvaluationQuestion[],
  detail?: Pick<SelfEvaluationDetail, 'channel' | 'answers'>,
): SelfEvaluationAnswerFormValues {
  return {
    channel: detail?.channel ?? 'paper',
    answers: questions.map((_, index) => {
      const answer = detail?.answers[index]
      return {
        score: answer?.score === null || answer?.score === undefined ? '' : String(answer.score),
        text: answer?.text ?? '',
      }
    }),
  }
}

/** Cevap gövdesi: puanlı soruda yalnız puan, açık uçluda yalnız metin (K-449). */
export function selfEvaluationAnswersBody(
  questions: readonly SelfEvaluationQuestion[],
  values: SelfEvaluationAnswerFormValues,
): SelfEvaluationAnswer[] {
  return questions.map((question, index) => {
    const value = values.answers[index] ?? { score: '', text: '' }
    if (question.kind === 'scale')
      return { score: value.score === '' ? null : Number(value.score), text: null }
    const text = value.text.trim()
    return { score: null, text: text === '' ? null : text }
  })
}

/** Gönderimden önce cevaplanmamış zorunlu soru sayısı (sunucu da denetler). */
export function missingRequiredCount(
  questions: readonly SelfEvaluationQuestion[],
  values: SelfEvaluationAnswerFormValues,
): number {
  const answers = selfEvaluationAnswersBody(questions, values)
  return questions.filter((question, index) => {
    if (!question.required) return false
    const answer = answers[index]
    return question.kind === 'scale' ? answer?.score === null : answer?.text === null
  }).length
}

export const selfEvaluationReopenFormSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(SELF_EVALUATION_REASON_MIN, 'Gerekçeyi en az 5 karakterle yazın.')
    .max(
      SELF_EVALUATION_REASON_MAX,
      `Gerekçe en fazla ${String(SELF_EVALUATION_REASON_MAX)} karakter olabilir.`,
    ),
})

export const selfEvaluationCommentFormSchema = z.object({
  managerComment: z
    .string()
    .max(
      SELF_EVALUATION_TEXT_MAX,
      `En fazla ${String(SELF_EVALUATION_TEXT_MAX)} karakter girebilirsiniz.`,
    ),
})

/** Özet: "Gönderen 1 / 3 (%33,3) · Taslak 1 · Gönderilmedi 1"; personel yoksa açıklama. */
export function selfEvaluationSummaryText(summary: SelfEvaluationOverview['summary']): string {
  if (summary.enrolled === 0) return 'Döneme henüz personel eklenmedi.'
  const rate = (summary.rate ?? 0).toLocaleString('tr-TR', { maximumFractionDigits: 1 })
  return `Gönderen ${String(summary.submitted)} / ${String(summary.enrolled)} (%${rate}) · Taslak ${String(summary.draft)} · Gönderilmedi ${String(summary.missing)}`
}

/** Dönemin aşamasına göre açık işlemler (K-448, K-449). */
export function selfEvaluationEditable(
  status: PerformancePeriodStatus,
  template: SelfEvaluationOverview['template'],
) {
  const closed = status === 'closed'
  return {
    template: !closed && (template === null || !template.locked),
    respond: template !== null && isSelfEvaluationOpen(status),
    comment: !closed,
  }
}
