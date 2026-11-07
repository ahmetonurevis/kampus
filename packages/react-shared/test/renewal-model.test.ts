import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ceilingLines,
  renewalDetailSections,
  renewalPeriod,
  renewalRow,
  renewalTransition,
  type RenewalDetail,
  type RenewalListItem,
} from '../src/renewal-model.ts'

const item: RenewalListItem = {
  id: 'ren-1',
  version: 3,
  createdAt: '2026-06-01T09:00:00.000Z',
  studentId: 'st-1',
  studentName: 'Deniz Yılmaz',
  fromClassId: 'c-9a',
  fromClassName: '9-A',
  targetClassId: 'c-10a',
  targetClassName: '10-A',
  academicYear: 2027,
  mode: 'renew',
  status: 'Planlandı',
  netCents: 25_000_000,
  tuitionCents: 27_000_000,
  discountCents: 2_000_000,
  scholarshipCents: null,
  contractId: 'ct-1',
  activatedAt: null,
} as RenewalListItem

const detail = (patch: Partial<RenewalDetail>): RenewalDetail =>
  ({
    ...item,
    pricing: null,
    invoices: [],
    ...patch,
  }) as RenewalDetail

test('IST-100: liste satırı dönem, sınıf geçişi ve net bedeli biçimler', () => {
  const row = renewalRow(item)
  assert.equal(row.period, '2027–2028')
  assert.equal(row.transition, '9-A → 10-A')
  assert.equal(row.netLabel, '250.000,00 ₺')
  assert.equal(row.studentName, 'Deniz Yılmaz')
  assert.equal(renewalRow({ ...item, studentName: null }).studentName, '—')
})

test('DOM-KAY-020: mezuniyette hedef "Mezuniyet", kapsam dışı sınıf tire olur', () => {
  assert.equal(
    renewalTransition({ fromClassName: '12-A', targetClassName: null, mode: 'graduate' }),
    '12-A → Mezuniyet',
  )
  assert.equal(
    renewalTransition({ fromClassName: null, targetClassName: null, mode: 'renew' }),
    '— → —',
  )
  assert.equal(renewalPeriod(2026), '2026–2027')
})

test('DOM-FIN-005: tavan uygulanmıyorsa nedeni, uygulanıyorsa baz ve oranlar yazılır', () => {
  assert.match(ceilingLines({ status: 'entry_grade' })[0] ?? '', /başlangıç sınıfı/)
  assert.match(ceilingLines({ status: 'no_base' })[0] ?? '', /hesaplanamadı/)
  const lines = ceilingLines({
    status: 'applied',
    baseCents: 20_000_000,
    baseSource: 'previous_tariff',
    baseYear: 2026,
    rates: [{ academicYear: 2026, ppiBasisPoints: 3050, cpiBasisPoints: 3325 }],
    extraBasisPoints: 500,
    ceilingCents: 27_000_000,
  } as Parameters<typeof ceilingLines>[0])
  assert.match(lines[0] ?? '', /önceki yılın ilan ücreti, 2026/)
  assert.match(lines[1] ?? '', /ÜFE %30,5, TÜFE %33,25 · ek %5/)
})

test('DOM-KAY-020, DOM-FIN-012: ayrıntı dönem geçişi, ücret ve kendi taksitlerini sırayla verir', () => {
  const sections = renewalDetailSections(
    detail({
      invoices: [
        {
          id: 'inv-1',
          installment: 1,
          dueDate: '2027-09-10T09:00:00.000Z',
          amountCents: 12_500_000,
          paidAt: null,
          feeKind: 'tuition',
        },
        {
          id: 'inv-2',
          installment: 2,
          dueDate: '2027-10-10T09:00:00.000Z',
          amountCents: 300_000,
          paidAt: '2027-10-01T09:00:00.000Z',
          feeKind: 'bilinmeyen',
        },
      ],
    } as Partial<RenewalDetail>),
  )
  assert.deepEqual(
    sections.map((section) => section.title),
    ['Dönem geçişi', 'Ücret', 'Yeni dönem taksitleri'],
  )
  assert.match(sections[0]?.lines[2] ?? '', /uygulanınca sınıf değişir/)
  assert.deepEqual(sections[1]?.lines, [
    'Öğrenim ücreti: 270.000,00 ₺',
    'İndirim: −20.000,00 ₺',
    'Net eğitim bedeli: 250.000,00 ₺',
  ])
  assert.match(sections[2]?.lines[0] ?? '', /^1\. taksit · .* · 125\.000,00 ₺ · Bekliyor$/)
  assert.match(sections[2]?.lines[1] ?? '', /Ödendi · Ek hizmet$/)
})

test('DOM-KAY-020: mezuniyette ücret bölümü yoktur, tamamlanan geçiş bildirilir', () => {
  const sections = renewalDetailSections(
    detail({ mode: 'graduate', status: 'Mezun', targetClassName: null }),
  )
  assert.deepEqual(
    sections.map((section) => section.title),
    ['Dönem geçişi'],
  )
  assert.deepEqual(sections[0]?.lines.slice(1), ['9-A → Mezuniyet', 'Dönem geçişi uygulanmış.'])
})
