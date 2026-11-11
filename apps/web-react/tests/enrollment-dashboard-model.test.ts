import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OPEN_PROSPECT_STAGES } from '@kampus/school-core/lib/prospects.ts'
import {
  enrollmentRate,
  ENROLLED_STAGE,
  stageCount,
  todayMeetingsQuery,
} from '../src/pages/crm/enrollment-dashboard-model.ts'

// Genel Bakış ön büro aday kartları (ON-035, Vue `Dashboard.vue` ön büro sayaçları): sorgu ve
// oran saf hesaplardır; sayım sunucudadır.

const STAGES = [
  { stage: 'Yeni aday', count: 6 },
  { stage: ENROLLED_STAGE, count: 3 },
  { stage: null, count: 1 },
]

test('ON-035, DOM-KAY-033: bugünkü görüşme sayımı yalnız açık adayların trialAt gününü süzer', () => {
  assert.deepEqual(todayMeetingsQuery('2026-10-20'), {
    groupBy: 'stage',
    filters: {
      stage: [...OPEN_PROSPECT_STAGES],
      dateField: 'trialAt',
      dateFrom: '2026-10-20',
      dateTo: '2026-10-20',
    },
  })
  const stages = todayMeetingsQuery('2026-10-20').filters?.stage
  assert.ok(Array.isArray(stages) && !stages.includes(ENROLLED_STAGE))
  assert.ok(Array.isArray(stages) && !stages.includes('Vazgeçti'))
})

test('ON-035: aşama sayısı gruptan okunur, olmayan aşama sıfırdır', () => {
  assert.equal(stageCount(STAGES, 'Yeni aday'), 6)
  assert.equal(stageCount(STAGES, 'Vazgeçti'), 0)
})

test('ON-035: kesin kayıt oranı bütün adaylara göre yuvarlanır; aday yoksa oran yoktur', () => {
  assert.equal(enrollmentRate(STAGES, 10), 30)
  assert.equal(enrollmentRate([{ stage: ENROLLED_STAGE, count: 1 }], 3), 33)
  assert.equal(enrollmentRate([], 0), null)
})
