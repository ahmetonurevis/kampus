import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import {
  PROSPECT_STAGES,
  UNKNOWN_SOURCE,
  funnelSteps,
  sourceRows,
} from '../src/pages/management/enrollment-report-rows.ts'

const NOW = new Date('2026-10-15T09:00:00.000Z')
const seed = createSeed(NOW)
const wrap = <T extends { id: string }>(records: readonly T[]) =>
  records.map((record) => ({
    id: record.id,
    version: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    archivedAt: null,
    record,
  }))
const prospect = (source: string, stage: string, id: string) => ({
  ...seed.prospects[0]!,
  id,
  source,
  stage,
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
    wrap([
      prospect('Web sitesi', 'Kayıt oldu', 'a'),
      prospect('Web sitesi', 'Yeni aday', 'b'),
      prospect('Web sitesi', 'Vazgeçti', 'c'),
      prospect('Telefon', 'Kayıt oldu', 'd'),
      prospect('Veli referansı', 'Teklif verildi', 'e'),
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

test('sourceRows: kanalı boş aday "Belirtilmemiş" satırına girer; aday yoksa liste boştur', () => {
  const rows = sourceRows(wrap([prospect('  ', 'Yeni aday', 'x')]))
  assert.equal(rows[0]?.source, UNKNOWN_SOURCE)
  assert.deepEqual(sourceRows([]), [])
})
