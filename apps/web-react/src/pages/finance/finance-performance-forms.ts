import { z } from 'zod'
import type {
  PerformanceReview,
  UpdatePerformanceReviewBody,
} from '@kampus/react-shared/use-finance-performance.ts'
import {
  PERFORMANCE_ENROLL_STATUSES,
  PERFORMANCE_GOAL_STATUSES,
  PERFORMANCE_INTERIM_STATUSES,
  PERFORMANCE_NOTE_MAX,
  PERFORMANCE_SCORE_MAX,
  PERFORMANCE_SCORE_MIN,
  performanceGoalsSchema,
  type PerformancePeriodStatus,
} from '@kampus/school-core/lib/finance-performance.ts'

// Performans kaydı formunun saf mantığı (DOM-FIN-124; ON-211): aşamaya göre açık alanlar ve
// düzeltme gövdesi (K-428). Bileşen yalnız bağlar; doğrulama core şemasındandır.

export type PerformanceGoalFormValue = { title: string; criterion: string; weight: number }

export type PerformanceReviewFormValues = {
  goals: PerformanceGoalFormValue[]
  interimNote: string
  interimDate: string
  /** Hedef sırasıyla `''` (girilmedi) ya da "1"…"5". */
  scores: string[]
  staffComment: string
}

export const SCORE_OPTIONS = Array.from(
  { length: PERFORMANCE_SCORE_MAX - PERFORMANCE_SCORE_MIN + 1 },
  (_, index) => String(PERFORMANCE_SCORE_MIN + index),
)

/** Aşamada hangi alanlar yazılır (K-428); kapanmış dönemde hiçbiri. */
export function performanceEditable(status: PerformancePeriodStatus) {
  const has = (list: readonly PerformancePeriodStatus[]) => list.includes(status)
  return {
    enroll: has(PERFORMANCE_ENROLL_STATUSES),
    goals: has(PERFORMANCE_GOAL_STATUSES),
    interim: has(PERFORMANCE_INTERIM_STATUSES),
    evaluation: status === 'evaluation',
  }
}

export const emptyGoal = (weight = 100): PerformanceGoalFormValue => ({
  title: '',
  criterion: '',
  weight,
})

/** Toplam ağırlık (formda canlı gösterilir). */
export const goalWeightTotal = (goals: readonly { weight: number }[]) =>
  goals.reduce((sum, goal) => sum + (Number.isFinite(goal.weight) ? goal.weight : 0), 0)

export function performanceReviewDefaults(review: PerformanceReview): PerformanceReviewFormValues {
  return {
    goals: review.goals.map(({ title, criterion, weight }) => ({ title, criterion, weight })),
    interimNote: review.interimNote ?? '',
    interimDate: review.interimDate ?? '',
    scores: review.goals.map((goal) => (goal.score === null ? '' : String(goal.score))),
    staffComment: review.staffComment ?? '',
  }
}

const noteSchema = z
  .string()
  .max(PERFORMANCE_NOTE_MAX, `En fazla ${String(PERFORMANCE_NOTE_MAX)} karakter girebilirsiniz.`)

/** Form doğrulaması: hedefler core şemasıyla, notlar uzunlukla; aşama kuralı sunucudadır. */
export const performanceReviewFormSchema = z.object({
  goals: performanceGoalsSchema,
  interimNote: noteSchema,
  interimDate: z.string(),
  scores: z.array(z.string()),
  staffComment: noteSchema,
})

/** Düzeltme gövdesi: yalnız aşamada açık alanlar gönderilir (K-428). */
export function performanceReviewUpdateBody(
  status: PerformancePeriodStatus,
  values: PerformanceReviewFormValues,
): UpdatePerformanceReviewBody {
  const editable = performanceEditable(status)
  return {
    ...(editable.goals ? { goals: values.goals } : {}),
    ...(editable.interim
      ? {
          interimNote: values.interimNote,
          interimDate: values.interimDate === '' ? null : values.interimDate,
        }
      : {}),
    ...(editable.evaluation
      ? {
          scores: values.scores.map((score) => (score === '' ? null : Number(score))),
          staffComment: values.staffComment,
        }
      : {}),
  }
}

/** Genel puan metni: "3,60 / 5" ya da puan eksikse "—". */
export const overallScoreText = (score: number | null) =>
  score === null
    ? '—'
    : `${score.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / 5`
