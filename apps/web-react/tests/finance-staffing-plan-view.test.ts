import assert from 'node:assert/strict'
import test from 'node:test'

import {
  academicYearLabel,
  balanceText,
  currentAcademicYear,
  fteText,
  planFormBody,
  planFormDefaults,
  positionActions,
  yearOptions,
} from '../src/pages/finance/finance-staffing-plan-view.ts'

test('DOM-FIN-126: eğitim yılı eylülde döner', () => {
  assert.equal(currentAcademicYear('2026-08-31'), 2025)
  assert.equal(currentAcademicYear('2026-09-01'), 2026)
  assert.equal(academicYearLabel(2026), '2026–2027')
  assert.deepEqual(yearOptions(2026), [2025, 2026, 2027])
  assert.equal(fteText(1.2), '1,2')
  assert.equal(fteText(2), '2')
})

test('DOM-FIN-126 K-433: plan formu; boş saat satır yazmaz, sınır dışı değer alan hatası', () => {
  const defaults = planFormDefaults({
    normHours: 20,
    lines: [{ subjectId: 'mat', requiredHours: 50 }],
    subjects: [{ id: 'mat' }, { id: 'fen' }],
  })
  assert.deepEqual(defaults, { normHours: '20', hours: { mat: '50', fen: '' } })
  assert.deepEqual(planFormBody({ normHours: ' 18 ', hours: { mat: '40', fen: '' } }), {
    body: { normHours: 18, lines: [{ subjectId: 'mat', requiredHours: 40 }] },
  })
  const bad = planFormBody({ normHours: '41', hours: { mat: '-1', fen: '2001' } })
  assert.ok('issues' in bad)
  assert.deepEqual(
    bad.issues.map((issue) => issue.field),
    ['normHours', 'hours.mat', 'hours.fen'],
  )
})

test('DOM-FIN-126 K-435: pozisyon eylemleri ve denge metni', () => {
  assert.deepEqual(
    positionActions('open').map((action) => action.status),
    ['posted', 'filled', 'cancelled'],
  )
  assert.deepEqual(
    positionActions('posted').map((action) => action.status),
    ['open', 'filled', 'cancelled'],
  )
  assert.deepEqual(positionActions('filled'), [])
  assert.deepEqual(positionActions('cancelled'), [])
  assert.equal(balanceText({ gapHours: 4, surplusHours: 0 }), '4 saat açık')
  assert.equal(balanceText({ gapHours: 0, surplusHours: 3 }), '3 saat fazla')
  assert.equal(balanceText({ gapHours: 0, surplusHours: 0 }), 'Dengede')
})
