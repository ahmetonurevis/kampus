import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cashFlowForecast, revenueForecast } from '@kampus/school-core/lib/finance-forecast.ts'
import {
  cashFlowNotes,
  percentLabel,
  revenueNotes,
  revenueRows,
} from '../src/pages/finance/finance-forecast-model.ts'

// ON-246, ON-247 (DOM-FIN-063): tahmin ekranının satırları ve varsayım açıklamaları.

const TODAY = '2026-10-06'
const base = {
  year: 2026,
  enrollmentYear: 2026,
  today: TODAY,
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
  tariff: null,
}

test('DOM-FIN-063 yüzde etiketi Türkçe ondalıkla', () => {
  assert.equal(percentLabel(1250), '%12,5')
  assert.equal(percentLabel(10_000), '%100')
  assert.equal(percentLabel(556), '%5,56')
})

test('DOM-FIN-063 gelir satırları: kesin, dil okulu huni adımları ve toplam', () => {
  const forecast = revenueForecast({
    ...base,
    institutionType: 'language_school',
    prospects: [
      { stage: 'Kayıt oldu', studentId: 'x', createdAt: '2026-06-01T09:00:00.000Z' },
      { stage: 'Yeni aday', createdAt: '2026-09-01T09:00:00.000Z' },
    ],
  })
  const rows = revenueRows(forecast, 'language_school')
  assert.deepEqual(
    rows.map((row) => row.label),
    [
      'Kesin gelir · yeni kayıt',
      'Kesin gelir · yenileme',
      'Huni · Aday',
      'Huni · Seviye tespiti görüşmesi',
      'Huni · Deneme dersi',
      'Beklenen toplam',
    ],
  )
  assert.equal(rows[0]?.netCents, 1_000_000)
  assert.equal(rows[0]?.rateBasisPoints, null)
  assert.equal(rows[2]?.prospects, 1)
  const notes = revenueNotes(forecast)
  assert.ok(notes.some((note) => note.includes('1 adaydan hesaplandı')))
  assert.ok(notes.includes('Yayımlı ücret tarifesi yok.'))
  assert.ok(notes.includes('1 aday fiyatı bulunamadığı için beklentiye girmedi.'))
  assert.ok(notes.includes('Tarifeli sözleşme olmadığı için indirim ve burs oranı sıfır alındı.'))
})

test('DOM-FIN-063 gelir açıklamaları: crm kapalı, geçmiş yıl, taşınan tarife ve sözleşme ortalaması', () => {
  const closed = revenueForecast({ ...base, institutionType: 'school', prospects: null })
  assert.ok(revenueNotes(closed).some((note) => note.includes('CRM) modülü kapalı')))
  const past = revenueForecast({ ...base, year: 2025, institutionType: 'school', prospects: [] })
  assert.ok(revenueNotes(past).some((note) => note.includes('2026–2027 kayıt yılına')))
  const carried = revenueForecast({
    ...base,
    year: 2027,
    institutionType: 'language_school',
    contracts: [
      {
        id: 'k1',
        studentId: 's1',
        amount: 1_000_000,
        date: '2026-05-01T09:00:00.000Z',
        academicYear: 2026,
        grossCents: 1_000_000,
      },
    ],
    tariff: {
      academicYear: 2026,
      items: [{ kind: 'tuition', level: 'B1', amountCents: 50_000, unit: 'lesson_hour' }],
    },
    prospects: [
      { stage: 'Kayıt oldu', studentId: 'x', createdAt: '2026-06-01T09:00:00.000Z' },
      { stage: 'Yeni aday', createdAt: '2026-09-01T09:00:00.000Z' },
    ],
  })
  const notes = revenueNotes(carried)
  assert.ok(notes.some((note) => note.includes('2026–2027 tarifesinin fiyatları')))
  assert.ok(notes.some((note) => note.includes('sözleşmelerin liste ortalamasından')))
  assert.ok(notes.some((note) => note.includes('%0: 2026–2027 sözleşmelerinden')))
})

test('DOM-FIN-063 nakit akışı açıklamaları: varsayılan oran, gider verisi yok, ufuk dışı', () => {
  const forecast = cashFlowForecast({
    today: TODAY,
    months: 1,
    monthlyExpenseCents: null,
    invoices: [{ id: 'i1', amount: 500_000, dueDate: '2027-02-01T09:00:00.000Z', paidAt: null }],
    allocated: new Map(),
    pendingRefunds: [{ refundCents: 70_000, refundDueDate: '2027-03-01' }],
  })
  const notes = cashFlowNotes(forecast)
  assert.ok(notes.includes('Geçmiş taksit örneği yok; planlanan tahsilat düzeltilmeden beklendi.'))
  assert.ok(notes.some((note) => note.startsWith('Gider verisi yok')))
  assert.ok(notes.some((note) => note.includes('vadesi gelen') && note.includes('5.000,00')))
  assert.ok(notes.some((note) => note.includes('700,00') && note.includes('iade')))
  const manual = cashFlowNotes(
    cashFlowForecast({
      today: TODAY,
      months: 1,
      monthlyExpenseCents: 10_000,
      invoices: [
        {
          id: 'h1',
          amount: 100,
          dueDate: '2026-03-01T09:00:00.000Z',
          paidAt: '2026-03-02T09:00:00.000Z',
        },
        { id: 'h2', amount: 100, dueDate: '2026-04-01T09:00:00.000Z', paidAt: null },
      ],
      allocated: new Map(),
      pendingRefunds: [],
    }),
  )
  assert.ok(manual.some((note) => note.startsWith('Vadesinde tahsil oranı %50')))
  assert.ok(manual.some((note) => note.startsWith('Gecikmiş alacağın %0 kadarı')))
  assert.ok(manual.includes('Gider her aya elle girilen aylık tutarla yazıldı.'))
})
