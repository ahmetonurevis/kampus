import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PROSPECT_STAGES,
  UNKNOWN_SOURCE,
  counselorRows,
  funnelSteps,
  rateLabel,
  sourceRows,
} from '../src/pages/management/enrollment-report-rows.ts'

/** Sunucunun `groupBy=source` yanıtı: gruplar ve toplam. */
const counts = (groups: [string | null, number][]) => ({
  groups: groups.map(([value, count]) => ({ value, count })),
  total: groups.reduce((sum, [, count]) => sum + count, 0),
})

test('funnelSteps: bilinen aşamalar sırasıyla gelir, sayısı 0 olan aşama da görünür, oran toplamdandır', () => {
  const steps = funnelSteps({
    groups: [
      { value: 'Kayıt oldu', count: 1 },
      { value: 'Yeni aday', count: 3 },
    ],
    total: 4,
  })
  assert.deepEqual(
    steps.map((step) => step.stage),
    [...PROSPECT_STAGES],
  )
  assert.deepEqual(
    steps.map((step) => [step.count, step.share]),
    [
      [3, 75],
      [0, 0],
      [0, 0],
      [0, 0],
      [1, 25],
      [0, 0],
    ],
  )
})

test('funnelSteps: bilinmeyen aşama sona eklenir; sayım yokken bütün adımlar sıfırdır', () => {
  const steps = funnelSteps({ groups: [{ value: 'Beklemede', count: 2 }], total: 2 })
  assert.equal(steps.at(-1)?.stage, 'Beklemede')
  assert.equal(steps.at(-1)?.share, 100)
  const empty = funnelSteps(undefined)
  assert.equal(empty.length, PROSPECT_STAGES.length)
  assert.ok(empty.every((step) => step.count === 0 && step.share === 0))
})

test('sourceRows: kanal başına aday, kesin kayıt ve dönüşüm oranı hesaplanır, çoktan aza sıralanır', () => {
  const rows = sourceRows(
    counts([
      ['Web sitesi', 3],
      ['Telefon', 1],
      ['Veli referansı', 1],
    ]),
    counts([
      ['Web sitesi', 1],
      ['Telefon', 1],
    ]),
  )
  assert.deepEqual(
    rows.map((row) => [row.source, row.count, row.enrolled, row.ratio]),
    [
      ['Web sitesi', 3, 1, 33],
      ['Telefon', 1, 1, 100],
      ['Veli referansı', 1, 0, 0],
    ],
  )
})

test('sourceRows: eşit sayıda aday kanal adıyla sıralanır; kayıtsız kanalın kesin kaydı 0 olur', () => {
  const rows = sourceRows(
    counts([
      ['Telefon', 2],
      ['Instagram', 2],
    ]),
    counts([]),
  )
  assert.deepEqual(
    rows.map((row) => [row.source, row.enrolled, row.ratio]),
    [
      ['Instagram', 0, 0],
      ['Telefon', 0, 0],
    ],
  )
})

test('sourceRows: kanalı boş ya da yok aday "Belirtilmemiş" satırında toplanır; aday yoksa liste boştur', () => {
  const rows = sourceRows(
    counts([
      [null, 1],
      ['  ', 1],
      ['', 2],
    ]),
    counts([[null, 1]]),
  )
  assert.deepEqual(
    rows.map((row) => [row.source, row.count, row.enrolled, row.ratio]),
    [[UNKNOWN_SOURCE, 4, 1, 25]],
  )
  assert.deepEqual(sourceRows(undefined, undefined), [])
  assert.deepEqual(sourceRows(counts([]), counts([])), [])
})

test('ON-052: oran bir ondalıklı yüzde, oran yoksa tire', () => {
  assert.equal(rateLabel(null), '—')
  assert.equal(rateLabel(33.3), '%33,3')
  assert.equal(rateLabel(100), '%100')
})

test('ON-052, DOM-KAY-040: danışman satırı kesin kayıt adımını ve oranı taşır; adı bilinmeyen Belirtilmemiş', () => {
  const steps = (prospect: number, enrolled: number) => [
    { step: 'prospect' as const, count: prospect, rate: null },
    { step: 'meeting' as const, count: prospect, rate: 100 },
    {
      step: 'enrolled' as const,
      count: enrolled,
      rate: prospect ? (enrolled / prospect) * 100 : null,
    },
  ]
  const rows = counselorRows([
    {
      counselorId: 'u1',
      counselorName: 'Selin Kaya',
      prospects: 4,
      steps: steps(4, 1),
      conversionRate: 25,
    },
    { counselorId: null, counselorName: null, prospects: 2, steps: steps(2, 0), conversionRate: 0 },
  ])
  assert.deepEqual(rows, [
    { id: 'u1', counselor: 'Selin Kaya', prospects: 4, enrolled: 1, conversion: '%25' },
    { id: 'bilinmeyen-1', counselor: UNKNOWN_SOURCE, prospects: 2, enrolled: 0, conversion: '%0' },
  ])
})
