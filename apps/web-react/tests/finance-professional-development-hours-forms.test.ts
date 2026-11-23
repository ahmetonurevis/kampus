import assert from 'node:assert/strict'
import test from 'node:test'

import {
  byteSizeLabel,
  certificateChoices,
  goalChoices,
  hoursRowText,
  targetBody,
  yearOptions,
} from '../src/pages/finance/finance-professional-development-hours-forms.ts'

/** Mesleki gelişim saati ekranının saf mantığı (DOM-FIN-144; ON-215; K-487…K-489). */

test('DOM-FIN-144: öğretim yılı seçenekleri önceki, bu ve sonraki yıl', () => {
  assert.deepEqual(yearOptions(2026), [
    { value: 2025, label: '2025–2026' },
    { value: 2026, label: '2026–2027' },
    { value: 2027, label: '2027–2028' },
  ])
})

test('DOM-FIN-144: K-487 hedef formu tam saat ve en az bir rol; boş hedef kaldırır', () => {
  assert.deepEqual(targetBody('40', ['ogretmen']), {
    ok: true,
    body: { targetHours: 40, appliesToRoles: ['ogretmen'] },
  })
  assert.deepEqual(targetBody(' ', ['ogretmen']), {
    ok: true,
    body: { targetHours: null, appliesToRoles: ['ogretmen'] },
  })
  for (const text of ['1,5', 'kırk', '0', '501'])
    assert.equal(targetBody(text, ['ogretmen']).ok, false)
  const noRole = targetBody('10', [])
  assert.equal(noRole.ok, false)
  assert.equal(noRole.ok ? '' : noRole.message, 'Hedefin uygulanacağı en az bir rol seçin.')
})

test('DOM-FIN-144: K-487 özet satırı metinleri', () => {
  assert.deepEqual(
    hoursRowText({ completedHours: 4.5, targetHours: 24, missingHours: 19.5, met: false }),
    { completed: '4,5 saat', target: '24 saat', missing: '19,5 saat' },
  )
  assert.deepEqual(
    hoursRowText({ completedHours: 26, targetHours: 24, missingHours: 0, met: true }),
    { completed: '26 saat', target: '24 saat', missing: 'Tamamlandı' },
  )
  assert.deepEqual(
    hoursRowText({ completedHours: 0, targetHours: null, missingHours: null, met: null }),
    { completed: '0 saat', target: '—', missing: '—' },
  )
})

test('DOM-FIN-144: K-489 bağlanabilir hedefler açık ya da süren; mevcut bağ kalır', () => {
  const goals = [
    { id: 'g1', status: 'open' },
    { id: 'g2', status: 'in_progress' },
    { id: 'g3', status: 'achieved' },
    { id: 'g4', status: 'dropped' },
  ]
  assert.deepEqual(
    goalChoices(goals, null).map((goal) => goal.id),
    ['g1', 'g2'],
  )
  assert.deepEqual(
    goalChoices(goals, 'g3').map((goal) => goal.id),
    ['g1', 'g2', 'g3'],
  )
})

test('DOM-FIN-144: K-488 bağlanabilir sertifikalar yerine geçilmemiş sertifika belgeleri', () => {
  const docs = [
    { id: 'd1', documentType: 'certificate', supersededAt: null },
    { id: 'd2', documentType: 'certificate', supersededAt: '2026-09-01T00:00:00.000Z' },
    { id: 'd3', documentType: 'diploma', supersededAt: null },
  ]
  assert.deepEqual(
    certificateChoices(docs).map((doc) => doc.id),
    ['d1'],
  )
  assert.equal(byteSizeLabel(null), '')
  assert.equal(byteSizeLabel(300), '1 KB')
  assert.equal(byteSizeLabel(240 * 1024), '240 KB')
  assert.equal(byteSizeLabel(1.25 * 1024 * 1024), '1,3 MB')
})
