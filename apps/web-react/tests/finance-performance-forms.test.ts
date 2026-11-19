import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PerformanceReview } from '@kampus/react-shared/use-finance-performance.ts'
import {
  goalWeightTotal,
  overallScoreText,
  performanceEditable,
  performanceReviewDefaults,
  performanceReviewFormSchema,
  performanceReviewUpdateBody,
  SCORE_OPTIONS,
} from '../src/pages/finance/finance-performance-forms.ts'

// Performans kaydı formu (DOM-FIN-124; ON-211; K-428).

const REVIEW: PerformanceReview = {
  id: 'r-1',
  periodId: 'p-1',
  membershipId: 'm-selin',
  staffName: 'Selin Kaya',
  staffRole: 'ogretmen',
  goals: [
    { title: 'Okuma', criterion: 'B1', weight: 60, score: 4 },
    { title: 'Veli', criterion: 'İki görüşme', weight: 40, score: null },
  ],
  overallScore: null,
  scored: false,
  interimNote: null,
  interimDate: '2026-10-01',
  evaluatorName: null,
  evaluatedAt: null,
  staffComment: null,
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-01T09:00:00.000Z',
  version: 3,
}

test('DOM-FIN-124 K-428: aşamaya göre açık alanlar', () => {
  assert.deepEqual(performanceEditable('planning'), {
    enroll: true,
    goals: true,
    interim: false,
    evaluation: false,
  })
  assert.deepEqual(performanceEditable('interim'), {
    enroll: false,
    goals: true,
    interim: true,
    evaluation: false,
  })
  assert.deepEqual(performanceEditable('closed'), {
    enroll: false,
    goals: false,
    interim: false,
    evaluation: false,
  })
  assert.deepEqual(SCORE_OPTIONS, ['1', '2', '3', '4', '5'])
})

test('DOM-FIN-124 K-428: gövde yalnız aşamada açık alanları taşır', () => {
  const values = performanceReviewDefaults(REVIEW)
  assert.deepEqual(values.scores, ['4', ''])
  assert.equal(values.interimNote, '')
  assert.deepEqual(performanceReviewUpdateBody('planning', values), {
    goals: [
      { title: 'Okuma', criterion: 'B1', weight: 60 },
      { title: 'Veli', criterion: 'İki görüşme', weight: 40 },
    ],
  })
  assert.deepEqual(
    performanceReviewUpdateBody('evaluation', { ...values, scores: ['4', '3'], interimDate: '' }),
    { interimNote: '', interimDate: null, scores: [4, 3], staffComment: '' },
  )
  assert.deepEqual(performanceReviewUpdateBody('closed', values), {})
})

test('DOM-FIN-124: ağırlık toplamı ve genel puan metni', () => {
  assert.equal(goalWeightTotal([{ weight: 60 }, { weight: Number.NaN }, { weight: 30 }]), 90)
  assert.equal(overallScoreText(null), '—')
  assert.equal(overallScoreText(3.6), '3,60 / 5')
  const result = performanceReviewFormSchema.safeParse({
    ...performanceReviewDefaults(REVIEW),
    goals: [{ title: 'Okuma', criterion: 'B1', weight: 50 }],
  })
  assert.equal(result.success, false)
})
