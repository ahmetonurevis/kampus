import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SelfEvaluationOverview } from '@kampus/react-shared/use-finance-self-evaluations.ts'
import type { SelfEvaluationQuestion } from '@kampus/school-core/lib/finance-self-evaluations.ts'
import {
  emptySelfEvaluationQuestion,
  missingRequiredCount,
  SELF_EVALUATION_SCORE_OPTIONS,
  selfEvaluationAnswerDefaults,
  selfEvaluationAnswerFormSchema,
  selfEvaluationAnswersBody,
  selfEvaluationEditable,
  selfEvaluationReopenFormSchema,
  selfEvaluationSummaryText,
  selfEvaluationTemplateDefaults,
  selfEvaluationTemplateFormSchema,
} from '../src/pages/finance/finance-self-evaluation-forms.ts'

// Öz değerlendirme formları (DOM-FIN-131; ON-210; K-448…K-450).

const QUESTIONS: SelfEvaluationQuestion[] = [
  { kind: 'scale', text: 'Ders planlarımı zamanında hazırladım', required: true },
  { kind: 'open', text: 'Bu dönemin en güçlü yanınız neydi?', required: true },
  { kind: 'open', text: 'Eklemek istedikleriniz', required: false },
]
const TEMPLATE: NonNullable<SelfEvaluationOverview['template']> = {
  id: 't-1',
  periodId: 'p-1',
  questions: QUESTIONS,
  responseCount: 0,
  locked: false,
  createdAt: '2026-11-19T09:00:00.000Z',
  updatedAt: '2026-11-19T09:00:00.000Z',
  version: 1,
}

test('DOM-FIN-131 K-448: şablon formu boşsa tek puanlı zorunlu soruyla açılır; core şemasıyla doğrulanır', () => {
  assert.deepEqual(selfEvaluationTemplateDefaults(null), {
    questions: [emptySelfEvaluationQuestion()],
  })
  assert.deepEqual(selfEvaluationTemplateDefaults(TEMPLATE).questions, QUESTIONS)
  assert.equal(selfEvaluationTemplateFormSchema.safeParse({ questions: QUESTIONS }).success, true)
  assert.equal(
    selfEvaluationTemplateFormSchema.safeParse({ questions: [emptySelfEvaluationQuestion()] })
      .success,
    false,
  )
})

test('DOM-FIN-131 K-449: cevap formu varsayılanı ve gövdesi soru türüne göre', () => {
  assert.deepEqual(SELF_EVALUATION_SCORE_OPTIONS, ['1', '2', '3', '4', '5'])
  const empty = selfEvaluationAnswerDefaults(QUESTIONS)
  assert.equal(empty.channel, 'paper')
  assert.deepEqual(empty.answers, [
    { score: '', text: '' },
    { score: '', text: '' },
    { score: '', text: '' },
  ])
  const filled = selfEvaluationAnswerDefaults(QUESTIONS, {
    channel: 'email',
    answers: [
      { score: 4, text: null },
      { score: null, text: 'Veli iletişimi' },
      { score: null, text: null },
    ],
  })
  assert.equal(filled.channel, 'email')
  assert.deepEqual(filled.answers[0], { score: '4', text: '' })
  assert.deepEqual(
    selfEvaluationAnswersBody(QUESTIONS, {
      channel: 'paper',
      answers: [
        { score: '3', text: 'yok sayılır' },
        { score: '5', text: '  Planlama  ' },
        { score: '', text: '   ' },
      ],
    }),
    [
      { score: 3, text: null },
      { score: null, text: 'Planlama' },
      { score: null, text: null },
    ],
  )
  assert.equal(
    selfEvaluationAnswerFormSchema.safeParse({ channel: 'fax', answers: [] }).success,
    false,
  )
})

test('DOM-FIN-131 K-449: gönderimden önce eksik zorunlu soru sayılır; gerekçe 5–500', () => {
  assert.equal(missingRequiredCount(QUESTIONS, selfEvaluationAnswerDefaults(QUESTIONS)), 2)
  assert.equal(
    missingRequiredCount(QUESTIONS, {
      channel: 'paper',
      answers: [
        { score: '4', text: '' },
        { score: '', text: 'Planlama' },
        { score: '', text: '' },
      ],
    }),
    0,
  )
  assert.equal(selfEvaluationReopenFormSchema.safeParse({ reason: ' kısa ' }).success, false)
  assert.equal(
    selfEvaluationReopenFormSchema.safeParse({ reason: 'Yanlış form girildi' }).success,
    true,
  )
})

test('DOM-FIN-131 K-448 K-450: aşamaya göre işlemler ve özet metni', () => {
  assert.deepEqual(selfEvaluationEditable('planning', null), {
    template: true,
    respond: false,
    comment: true,
  })
  assert.deepEqual(selfEvaluationEditable('interim', TEMPLATE), {
    template: true,
    respond: true,
    comment: true,
  })
  assert.equal(selfEvaluationEditable('active', { ...TEMPLATE, locked: true }).template, false)
  assert.deepEqual(selfEvaluationEditable('closed', TEMPLATE), {
    template: false,
    respond: false,
    comment: false,
  })
  assert.equal(
    selfEvaluationSummaryText({ enrolled: 3, submitted: 1, draft: 1, missing: 1, rate: 33.3 }),
    'Gönderen 1 / 3 (%33,3) · Taslak 1 · Gönderilmedi 1',
  )
  assert.equal(
    selfEvaluationSummaryText({ enrolled: 0, submitted: 0, draft: 0, missing: 0, rate: null }),
    'Döneme henüz personel eklenmedi.',
  )
})
