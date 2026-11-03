/**
 * İçeriğe bağlı sonuç özeti (DOM-BEC-036, IST-034): bir içeriğin atamalarında hedef başına kursiyer
 * sayısı, tamamlayan sayısı ve puan ortalaması. Her okumada kursiyer sonuçlarından hesaplanır,
 * saklanmaz. Kursiyer sonucunu (tamamlandı mı, puanı) deneme ve teslim kurallarıyla çağıran çıkarır;
 * burada yalnız sayım ve ortalama vardır.
 */

/** Kursiyerin atamadaki sonucu: tamamlandı mı ve (kesinleşmişse) yüzde puanı. */
export type LearnerOutcome = {
  learnerId: string
  completed: boolean
  /** Kesinleşmiş veya gösterilen puan; puanlanmamışsa `null`. */
  percent: number | null
}

/** Bir kursiyer kümesinin sayımı; ortalama yalnız puanı olanlardan, bir ondalıkla. */
export type ResultTally = {
  learners: number
  completed: number
  scored: number
  averagePercent: number | null
}

const round1 = (value: number) => Math.round(value * 10) / 10

export function tallyOutcomes(outcomes: readonly LearnerOutcome[]): ResultTally {
  const byLearner = new Map<string, LearnerOutcome>()
  // Aynı kursiyer iki kez gelirse (iki hedefte birden) bir kez sayılır; tamamlanmış sonuç önce gelir.
  for (const outcome of outcomes) {
    const seen = byLearner.get(outcome.learnerId)
    if (seen === undefined || (!seen.completed && outcome.completed))
      byLearner.set(outcome.learnerId, outcome)
  }
  const rows = [...byLearner.values()]
  const scores = rows.flatMap((row) => (row.percent === null ? [] : [row.percent]))
  return {
    learners: rows.length,
    completed: rows.filter((row) => row.completed).length,
    scored: scores.length,
    averagePercent:
      scores.length === 0
        ? null
        : round1(scores.reduce((sum, value) => sum + value, 0) / scores.length),
  }
}
