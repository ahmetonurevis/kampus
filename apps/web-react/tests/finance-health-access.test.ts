import assert from 'node:assert/strict'
import test from 'node:test'

import { HEALTH_ACCESS_REASON_TTL_MS } from '../../../packages/school-core/src/lib/finance-health-access.ts'
import {
  forgetHealthReasons,
  healthAccessScope,
  healthLogQuery,
  healthLogReasonText,
  healthReasonFormSchema,
  recallHealthReason,
  rememberHealthReason,
} from '../src/pages/finance/finance-health-access.ts'

// Sağlık verisi erişim gerekçesi, web tarafı (DOM-FIN-156; ON-164; K-523…K-525).

const NOW = Date.parse('2026-10-06T09:00:00Z')

test('DOM-FIN-156: gerekçe kapsam başına 15 dakika bellekte kalır; kurum ve kişi ayrıdır (K-525)', () => {
  forgetHealthReasons()
  const key = healthAccessScope('k1', 'm1', 'incident:1')
  const reason = { code: 'guardian_meeting' as const, note: null }
  assert.equal(recallHealthReason(key, NOW), null)
  rememberHealthReason(key, reason, NOW)
  assert.deepEqual(recallHealthReason(key, NOW + HEALTH_ACCESS_REASON_TTL_MS - 1), reason)
  assert.equal(recallHealthReason(healthAccessScope('k2', 'm1', 'incident:1'), NOW), null)
  assert.equal(recallHealthReason(healthAccessScope('k1', 'm2', 'incident:1'), NOW), null)
  assert.equal(recallHealthReason(healthAccessScope('k1', 'm1', 'incident:2'), NOW), null)
  assert.equal(recallHealthReason(key, NOW + HEALTH_ACCESS_REASON_TTL_MS), null)
  // Süresi dolan gerekçe silinir; saat geri alınsa da dönmez.
  assert.equal(recallHealthReason(key, NOW), null)
})

test('DOM-FIN-156: diyalog formu gerekçe ister; açıklama yalnız "Diğer"de gider (K-523)', () => {
  const empty = healthReasonFormSchema.safeParse({ code: '', note: '' })
  assert.equal(empty.success, false)
  assert.equal(empty.error?.issues[0]?.message, 'Erişim gerekçesini seçin.')
  assert.deepEqual(healthReasonFormSchema.parse({ code: 'emergency', note: 'eski metin' }), {
    code: 'emergency',
    note: null,
  })
  const short = healthReasonFormSchema.safeParse({ code: 'other', note: 'abc' })
  assert.equal(short.success, false)
  assert.deepEqual(short.error?.issues[0]?.path, ['note'])
  assert.deepEqual(healthReasonFormSchema.parse({ code: 'other', note: ' Okul hekimi ' }), {
    code: 'other',
    note: 'Okul hekimi',
  })
})

test('DOM-FIN-156: günlük süzgeçleri API sorgusuna çevrilir (K-524)', () => {
  assert.deepEqual(healthLogQuery(1, 20, {}), { page: 1, pageSize: 20 })
  assert.deepEqual(
    healthLogQuery(2, 50, {
      actor: 'm1',
      student: 's-1',
      reasonCode: 'other',
      accessedAt: { min: '2026-10-01', max: '2026-10-06' },
    }),
    {
      page: 2,
      pageSize: 50,
      actorMembershipId: 'm1',
      studentId: 's-1',
      reasonCode: 'other',
      from: '2026-10-01',
      to: '2026-10-06',
    },
  )
  assert.deepEqual(
    healthLogQuery(1, 20, { reasonCode: 'curiosity', actor: '', accessedAt: { min: '1.10.2026' } }),
    { page: 1, pageSize: 20 },
  )
  assert.equal(
    healthLogReasonText({ reasonCode: 'other', reasonNote: 'Okul hekimi' }),
    'Diğer: Okul hekimi',
  )
  assert.equal(
    healthLogReasonText({ reasonCode: 'first_aid', reasonNote: null }),
    'İlk yardım / revir işlemi',
  )
})
