import assert from 'node:assert/strict'
import { test } from 'node:test'
import { revenueForecast } from '@kampus/school-core/lib/finance-forecast.ts'
import {
  financeScenarioComparison,
  financeScenarioSchema,
} from '@kampus/school-core/lib/finance-scenarios.ts'
import {
  cashMonthsFromParams,
  comparisonRows,
  draftsFromParams,
  draftToScenario,
  emptyDraft,
  scenarioNotes,
  writeDrafts,
  yearFromParams,
  type ScenarioDraft,
} from '../src/pages/finance/finance-scenario-model.ts'

// ON-248 (DOM-FIN-067): senaryo formu, adres biçimi ve karşılaştırma tablosu.

const draft = (patch: Partial<ScenarioDraft> = {}): ScenarioDraft => ({
  ...emptyDraft(0, 'd1'),
  ...patch,
})

test('DOM-FIN-067: form değerleri on binde bire çevrilir; boş alan sıfırdır', () => {
  const empty = draftToScenario(draft())
  assert.deepEqual(empty.scenario, financeScenarioSchema.parse({}))
  const result = draftToScenario(
    draft({
      newValue: '-12,5',
      renewalValue: '3',
      renewalUnit: 'count',
      price: '25',
      discount: '1.5',
      applyToExisting: true,
    }),
  )
  assert.deepEqual(result.scenario, {
    newStudents: { unit: 'percent', value: -1250 },
    renewalStudents: { unit: 'count', value: 3 },
    priceChangeBasisPoints: 2500,
    discountChangeBasisPoints: 150,
    applyToExistingContracts: true,
  })
})

test('DOM-FIN-067: geçersiz ve sınır dışı değer alana Türkçe mesaj yazar', () => {
  const invalid = draftToScenario(
    draft({ name: ' ', newValue: 'on', renewalValue: '1,5', renewalUnit: 'count', price: '1,234' }),
  )
  assert.equal(invalid.scenario, null)
  assert.deepEqual(Object.keys(invalid.errors ?? {}).sort(), [
    'name',
    'newValue',
    'price',
    'renewalValue',
  ])
  const bounds = draftToScenario(draft({ price: '201', newValue: '-101', discount: '100,01' }))
  assert.deepEqual(bounds.errors, {
    newValue: 'Öğrenci sayısı en çok %100 azalabilir.',
    price: 'Fiyat en çok %200 artabilir.',
    discount: 'İndirim ve burs oranı en çok 100 puan değişebilir.',
  })
  assert.equal(draftToScenario(draft({ name: 'x'.repeat(41) })).errors?.name?.includes('40'), true)
})

test('DOM-FIN-067: senaryolar adrese yazılır ve adresten okunur; öteki parametreler korunur', () => {
  const params = new URLSearchParams('gorunum=tahmin&senaryo3=Eski&senaryo3.fiyat=5')
  const written = writeDrafts(params, [
    draft({ name: ' Kötümser ', newValue: '-10', price: '12,5' }),
    draft({
      id: 'd2',
      name: 'İyimser',
      renewalValue: '4',
      renewalUnit: 'count',
      applyToExisting: true,
    }),
  ])
  assert.equal(written.get('gorunum'), 'tahmin')
  assert.equal(written.get('senaryo3'), null)
  assert.equal(written.get('senaryo3.fiyat'), null)
  assert.equal(written.get('senaryo1'), 'Kötümser')
  assert.equal(written.get('senaryo1.fiyat'), '12.5')
  assert.equal(written.get('senaryo1.yenileme'), null, 'sıfır değişim yazılmaz')
  assert.equal(written.get('senaryo2.yenilemeBirim'), 'adet')
  assert.equal(written.get('senaryo2.mevcut'), '1')

  const read = draftsFromParams(written)
  assert.deepEqual(
    read.map((item) => [item.id, item.name, item.newValue, item.price, item.renewalUnit]),
    [
      ['senaryo1', 'Kötümser', '-10', '12.5', 'percent'],
      ['senaryo2', 'İyimser', '', '', 'count'],
    ],
  )
  assert.deepEqual(
    read.map((item) => draftToScenario(item).scenario?.priceChangeBasisPoints),
    [1250, 0],
  )
  // Beşinci ve sonraki sıra okunmaz; ara boşluk atlanır.
  assert.equal(draftsFromParams(new URLSearchParams('senaryo2=A&senaryo5=B')).length, 1)
})

test('DOM-FIN-067: nakit ayı ve yıl adresten sınırla okunur', () => {
  assert.equal(cashMonthsFromParams(new URLSearchParams('senaryoNakit=12')), 12)
  for (const value of ['0', '25', 'x', '1.5'])
    assert.equal(cashMonthsFromParams(new URLSearchParams(`senaryoNakit=${value}`)), null)
  assert.equal(cashMonthsFromParams(new URLSearchParams()), null)
  assert.equal(yearFromParams(new URLSearchParams('senaryoYili=2027'), [2025, 2026, 2027]), 2027)
  assert.equal(yearFromParams(new URLSearchParams('senaryoYili=2030'), [2026]), null)
})

test('DOM-FIN-067: karşılaştırma satırları ve açıklamalar', () => {
  const forecast = revenueForecast({
    year: 2026,
    enrollmentYear: 2026,
    institutionType: 'school',
    today: '2026-10-06',
    invoices: [
      {
        id: 'i1',
        studentId: 's1',
        amount: 1_000_000,
        dueDate: '2026-11-01T09:00:00.000Z',
        paidAt: null,
        academicYear: 2026,
      },
    ],
    contracts: [],
    renewals: [],
    prospects: null,
    tariff: null,
  })
  const comparison = financeScenarioComparison({
    forecast,
    scenarios: [
      financeScenarioSchema.parse({ newStudents: { unit: 'percent', value: -5000 } }),
      financeScenarioSchema.parse({ newStudents: { unit: 'count', value: 2 } }),
    ],
    cashFlow: null,
  })
  const rows = comparisonRows(comparison, ['a', 'b'])
  const total = rows.find((row) => row.key === 'total')
  assert.deepEqual(
    total?.cells.map((cell) => cell.key),
    ['temel', 'a', 'b'],
  )
  const difference = rows.find((row) => row.key === 'difference-rate')
  assert.deepEqual(
    difference?.cells.map((cell) => cell.text),
    ['%0', '%-50', '+%200'],
  )
  assert.equal(rows.find((row) => row.key === 'new-students')?.cells[1]?.text, '0,5')
  const notes = scenarioNotes(comparison, ['Kötümser', 'İyimser'])
  assert.ok(notes.some((note) => note.includes('CRM')))
  assert.ok(!notes.some((note) => note.includes('fiyatı bulunamadığı')))
})
