import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed, type State } from '@kampus/school-core/data/seed.ts'
import { exampleOpticalFile, runAssessment } from '@kampus/school-core/lib/assessment-automation.ts'
import type {
  OpticalQuestionResult,
  OpticalTopicScore,
} from '@kampus/school-core/lib/assessment-automation.ts'
import type { Session } from '@kampus/school-core/lib/domain.ts'
import {
  evaluationRows,
  questionDetailRows,
  topicRows,
  type TopicRow,
} from '../src/pages/assessment/optical-model.ts'

// DOM-AKD-062 kayıtlı optik değerlendirme ayrıntısı: kazanım başarıları ve soru satırları kayıtlı
// analizden türetilir; anahtar revizyonu veya sonuç değişimi analizi "eski" yapar.
const NOW = '2026-11-02T09:00:00.000Z'
const admin: Session = { role: 'yonetici' }

let counter = 0
const makeId = (prefix: string) => `${prefix}-detay-${++counter}`

function evaluated(): State {
  const state = structuredClone(createSeed(new Date(NOW)))
  const profile = state.opticalProfiles[0]
  assert.ok(profile)
  const text = exampleOpticalFile(state, profile)
  runAssessment(state, admin, 'evaluate', { profileId: profile.id, text }, makeId, '', NOW)
  return state
}

test('DOM-AKD-062 · kazanım satırları core başarı yüzdesini ve yanlış/boş sayılarını soru sonuçlarıyla verir', () => {
  const state = evaluated()
  const evaluation = state.opticalEvaluations[0]
  assert.ok(evaluation)
  const topics: TopicRow[] = topicRows(evaluation)
  assert.equal(topics.length, evaluation.topicScores.length)
  for (const topic of topics) {
    const score: OpticalTopicScore | undefined = evaluation.topicScores.find(
      (item) => item.topic === topic.topic,
    )
    assert.ok(score)
    assert.equal(topic.correct, score.correct)
    assert.equal(topic.total, score.total)
    assert.equal(topic.percent, score.percent === null ? '—' : `%${score.percent}`)
    assert.equal(topic.weak, evaluation.weakTopics.includes(topic.topic))
    const answered: OpticalQuestionResult[] = evaluation.questionResults.filter(
      (q) => q.topic === topic.topic && q.outcome !== 'cancelled',
    )
    assert.equal(topic.correct + topic.wrong + topic.blank, answered.length)
  }
  // Ders toplamı kazanım toplamıyla tutarlıdır (iptal sorular hariç).
  assert.equal(
    topics.reduce((sum, topic) => sum + topic.correct, 0),
    evaluation.correct,
  )
})

test('DOM-AKD-062 · çoklu işaret yanlış, iptal soru kazanım payından çıkar ve boş işaret açık yazılır', () => {
  const state = evaluated()
  const evaluation = structuredClone(state.opticalEvaluations[0])
  assert.ok(evaluation)
  const [first, second, third] = evaluation.questionResults
  assert.ok(first && second && third)
  const topic = first.topic
  Object.assign(first, { topic, response: '*', outcome: 'multiple' })
  Object.assign(second, { topic, response: ' ', outcome: 'blank' })
  Object.assign(third, { topic, response: '-', answer: '-', outcome: 'cancelled' })
  evaluation.topicScores = [{ topic, total: 2, correct: 0, percent: 0 }]
  evaluation.weakTopics = [topic]
  const [row] = topicRows(evaluation).filter((item) => item.topic === topic)
  assert.ok(row)
  assert.equal(
    row.wrong,
    1 +
      evaluation.questionResults.slice(3).filter((q) => q.topic === topic && q.outcome === 'wrong')
        .length,
  )
  assert.equal(
    row.blank,
    1 +
      evaluation.questionResults.slice(3).filter((q) => q.topic === topic && q.outcome === 'blank')
        .length,
  )
  assert.equal(row.weak, true)

  const questions = questionDetailRows(evaluation)
  assert.deepEqual(
    questions.slice(0, 3).map((q) => [q.response, q.answer, q.outcome]),
    [
      ['Çoklu işaret', first.answer, 'Çoklu işaret'],
      ['Boş', second.answer, 'Boş'],
      ['Boş', '—', 'İptal'],
    ],
  )
  assert.equal(new Set(questions.map((q) => q.id)).size, questions.length)
})

test('DOM-AKD-062 · değerlendirme satırı ayrıntıyı taşır; anahtar revizyonu analizi eski yapar', () => {
  const state = evaluated()
  const fresh = evaluationRows(state, admin)
  assert.ok(fresh.length > 0)
  for (const row of fresh) {
    assert.equal(row.current, true)
    assert.equal(row.staleReason, '')
    assert.ok(row.questions.length > 0)
    assert.ok(row.topics.length > 0)
  }
  const profile = state.opticalProfiles[0]
  assert.ok(profile)
  profile.revision += 1
  const stale = evaluationRows(state, admin).filter((row) => !row.current)
  assert.ok(stale.length > 0)
  assert.match(stale[0]?.staleReason ?? '', /Cevap anahtarı değişti/)
  // Eski analizde de ayrıntı kayıtlı analizden gösterilir.
  assert.ok((stale[0]?.questions.length ?? 0) > 0)
})
