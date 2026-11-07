import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  collectionRate,
  collectionRateLabel,
  overdueStudentsNote,
  overdueTrendPoints,
  PRIORITY_INVOICE_COUNT,
  priorityInvoicesQuery,
} from '../src/pages/finance/finance-dashboard-model.ts'

// ON-032: pano finans ve kayıt kartları Onur bloğundadır; mini grafik gerçek kayıttan türetilir.

const read = (path: string) =>
  readFileSync(new URL(`../src/pages/${path}`, import.meta.url), 'utf8')

test('IST-116: gecikmiş eğilimi vade ayının gecikmiş tutarından türetilir', () => {
  assert.deepEqual(
    overdueTrendPoints([
      { month: '2026-09', overdueCents: 0 },
      { month: '2026-10', overdueCents: 1_250_050 },
    ]),
    [
      { label: 'Eyl 26', value: 0 },
      { label: 'Eki 26', value: 1_250_050 },
    ],
  )
})

test('IST-116: hiç gecikme yoksa mini grafik çizilmez', () => {
  assert.deepEqual(overdueTrendPoints([]), [])
  assert.deepEqual(overdueTrendPoints([{ month: '2026-10', overdueCents: 0 }]), [])
})

test('IST-116: gecikmiş kartının notu öğrenci sayısını söyler, sıfırda ayrı metin', () => {
  assert.equal(overdueStudentsNote(0), 'Gecikmiş borç bulunmuyor')
  assert.equal(overdueStudentsNote(1234), '1.234 öğrencide gecikmiş borç')
})

test('IST-116, DOM-KAY-012: dil okulu ve kursta borçlu kayıtlı kişi kursiyerdir', () => {
  assert.equal(overdueStudentsNote(3, 'kursiyer'), '3 kursiyerde gecikmiş borç')
  assert.equal(overdueStudentsNote(0, 'kursiyer'), 'Gecikmiş borç bulunmuyor')
})

test('IST-116: finans ve kayıt kartları Onur bloğundan kayıtlıdır, devir listesi kalkmıştır', () => {
  const registry = read('dashboard/dashboard-cards.tsx')
  const start = registry.lastIndexOf('// Onur: kayıt ve finans\n')
  const end = registry.lastIndexOf('// Onur: kayıt ve finans sonu')
  assert.match(registry.slice(start, end), /\.\.\.FINANCE_CARDS, \.\.\.ENROLLMENT_CARDS/)
  assert.doesNotMatch(registry, /Handover|DEVREDILECEK/)
  assert.match(registry, /buildDashboardCards\(OGUZHAN_CARDS, ONUR_CARDS\)/)
})

test('IST-116: taşınan kartların kimlikleri korunur', () => {
  const ids = (source: string) =>
    [...source.matchAll(/^\s+id: '([^']+)',$/gm)].map((match) => match[1])
  assert.deepEqual(ids(read('finance/FinanceDashboardCards.tsx')), [
    'yonetici.tahsilat-orani',
    'yonetici.bugunku-tahsilat',
    'yonetici.bekleyen-tahsilat',
    'yonetici.gecikmis-tutar',
    'yonetici.taksit-durumu',
    'yonetici.yaklasan-odemeler',
    'yonetici.aylik-tahsilat',
    'onburo.gecikmis-taksit',
    'onburo.yaklasan-taksit',
    'onburo.bugunku-tahsilat',
    'onburo.tahsil-edilen',
    'onburo.gecikmis-taksitler',
    'onburo.yaklasan-taksitler',
    'onburo.son-tahsilatlar',
    'veli.guncel-bakiye',
  ])
  // Taşınan iki kartın kimliği korunur; ON-035 Vue eşitliği iki sayaç ekledi, ON-036 tahsilat
  // oranını (yukarıda).
  assert.deepEqual(ids(read('crm/EnrollmentDashboardCards.tsx')), [
    'onburo.bugunku-gorusme',
    'onburo.gorusme-bekleyen-aday',
    'onburo.toplam-kesin-kayit',
    'onburo.aday-asamalari',
  ])
})

test('ON-036: tahsilat oranı ödenmiş tutarın ödeme planına oranıdır, yuvarlanır', () => {
  const summary = (amount: number, paid: number) => ({ amount, paid: { amount: paid } })
  assert.equal(collectionRate(summary(1_000_000, 375_000)), 38)
  assert.equal(collectionRate(summary(300, 100)), 33)
  assert.equal(collectionRate(summary(1_000, 1_000)), 100)
  assert.equal(collectionRate(summary(1_000, 0)), 0)
  assert.equal(collectionRateLabel(38), '%38')
  assert.equal(collectionRateLabel(0), '%0')
})

test('ON-036: ödeme planı yoksa tahsilat oranı yoktur, tire gösterilir', () => {
  assert.equal(collectionRate({ amount: 0, paid: { amount: 0 } }), null)
  assert.equal(collectionRateLabel(null), '—')
})

test('ON-036: öncelikli tahsilatlar vadesi en erken dört ödenmemiş taksittir', () => {
  assert.equal(PRIORITY_INVOICE_COUNT, 4)
  assert.deepEqual(priorityInvoicesQuery({ kind: 'all' }), {
    page: 1,
    pageSize: 4,
    sort: ['dueDate', 'id'],
    filters: { status: ['Gecikmiş', 'Yaklaşan'] },
  })
})

test('ON-036: öncelikli tahsilatlar seçili kampüsün sınıflarına daralır; sığmayan kampüste sorgu yok', () => {
  assert.deepEqual(priorityInvoicesQuery({ kind: 'classes', classIds: ['c9', 'c10'] })?.filters, {
    status: ['Gecikmiş', 'Yaklaşan'],
    classId: ['c9', 'c10'],
  })
  assert.equal(priorityInvoicesQuery({ kind: 'too_many' }), null)
})
