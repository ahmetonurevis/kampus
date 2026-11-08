import assert from 'node:assert/strict'
import { test } from 'node:test'
import { budgetActuals } from '@kampus/school-core/lib/finance-budget-actuals.ts'
import {
  actualsNotes,
  actualsTableRows,
  PERIOD_TOTAL,
} from '../src/pages/finance/finance-budget-actuals-model.ts'

// ON-244 (DOM-FIN-066): bütçe–gerçekleşen görünümünün satırları ve varsayım açıklamaları.

const report = (basis: 'accrual' | 'cash' = 'accrual') =>
  budgetActuals({
    period: {
      id: 'p1',
      name: 'Dönem',
      startDate: '2026-09-01',
      endDate: '2026-12-31',
      status: 'open',
    },
    basis,
    today: '2026-10-06',
    institutionType: 'school',
    centers: [
      {
        id: 'kad',
        code: 'KAD',
        name: 'Kadıköy',
        type: 'campus',
        parentId: null,
        campusId: 'b1',
        gradeLevel: null,
        courseId: null,
        isActive: true,
      },
    ],
    items: [
      { id: 'g', code: 'G-1', name: 'Öğrenim', kind: 'income', feeKind: 'tuition', isActive: true },
      { id: 'p', code: 'P-1', name: 'Personel', kind: 'expense', feeKind: null, isActive: true },
    ],
    lines: [
      {
        costCenterId: 'kad',
        itemId: 'g',
        amountCents: 400_000,
        monthlyCents: [100_000, 100_000, 100_000, 100_000],
      },
      { costCenterId: 'kad', itemId: 'p', amountCents: 50_000, monthlyCents: null },
    ],
    invoices: [
      {
        id: 'i1',
        studentId: 's1',
        installment: 1,
        amount: 80_000,
        dueDate: '2026-09-15T09:00:00.000Z',
        paidAt: '2026-09-02T09:00:00.000Z',
        method: 'Açılış aktarımı',
      },
      {
        id: 'i2',
        studentId: 's1',
        installment: 2,
        amount: 5_000,
        dueDate: '2026-09-20T09:00:00.000Z',
        paidAt: null,
        method: null,
        feeKind: 'meal',
      },
    ],
    contracts: [],
    students: [{ id: 's1', classId: 'c1' }],
    classes: [{ id: 'c1', branchId: 'b1', grade: 7 }],
    contractCourseIds: new Map(),
    studentCourseIds: new Map(),
    payments: [],
    withdrawals: [],
    expenses: null,
  })

test('DOM-FIN-066: dönem ve ay görünümü satırları; gider ve eşlenmemiş gelir notlu', () => {
  const data = report()
  const period = actualsTableRows(data, PERIOD_TOTAL)
  assert.deepEqual(
    period.map((row) => [row.item, row.center, row.actual, row.realization, row.note]),
    [
      ['G-1 · Öğrenim', 'KAD · Kadıköy', '800,00 ₺', '%20', ''],
      ['P-1 · Personel', 'KAD · Kadıköy', '—', '—', 'Gerçekleşen verisi yok'],
      ['Yemek (kaleme eşlenmemiş)', '—', '50,00 ₺', '—', 'Eşlenmemiş gelir'],
    ],
  )
  const september = actualsTableRows(data, '2026-09')
  assert.equal(september[0]?.planned, '1.000,00 ₺')
  assert.equal(september[0]?.variance, '-200,00 ₺')
  assert.equal(september[1]?.planned, 'Dağılım yok')
  const november = actualsTableRows(data, '2026-11')
  assert.equal(november[0]?.actual, '—')
  assert.equal(november[2]?.actual, '—')
})

test('DOM-FIN-066: açıklamalar esası, son günü, gider ve eşleme eksiğini söyler', () => {
  const accrual = actualsNotes(report())
  assert.match(accrual[0] ?? '', /^Tahakkuk esası/)
  assert.match(accrual[1] ?? '', /6 Eki 2026/)
  assert.ok(accrual.some((note) => note.startsWith('Gider gerçekleşeni yok')))
  assert.ok(accrual.some((note) => note.includes('Yemek')))
  const cash = actualsNotes(report('cash'))
  assert.match(cash[0] ?? '', /^Tahsilat esası/)
  assert.ok(cash.some((note) => note.includes('800,00 ₺')))
  const notStarted = actualsNotes({ ...report(), asOfDate: null })
  assert.equal(notStarted[1], 'Dönem henüz başlamadı; gerçekleşen yok.')
})
