import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { tallyOutcomes } from '../packages/school-core/src/skills/content-results.ts'

describe('içeriğe bağlı sonuç özeti (DOM-BEC-036, IST-034)', () => {
  test('DOM-BEC-036 tamamlayan ve puan ortalaması kursiyer sonuçlarından hesaplanır', () => {
    assert.deepEqual(
      tallyOutcomes([
        { learnerId: 'test-s1', completed: true, percent: 80 },
        { learnerId: 'test-s2', completed: true, percent: 65 },
        { learnerId: 'test-s3', completed: true, percent: null },
        { learnerId: 'test-s4', completed: false, percent: null },
      ]),
      { learners: 4, completed: 3, scored: 2, averagePercent: 72.5 },
    )
  })

  test('DOM-BEC-036 sonuç yoksa ortalama boştur; yinelenen kursiyer bir kez sayılır', () => {
    assert.deepEqual(tallyOutcomes([]), {
      learners: 0,
      completed: 0,
      scored: 0,
      averagePercent: null,
    })
    assert.deepEqual(
      tallyOutcomes([
        { learnerId: 'test-s1', completed: false, percent: null },
        { learnerId: 'test-s1', completed: true, percent: 66.66 },
        { learnerId: 'test-s1', completed: false, percent: null },
      ]),
      { learners: 1, completed: 1, scored: 1, averagePercent: 66.7 },
    )
  })
})
