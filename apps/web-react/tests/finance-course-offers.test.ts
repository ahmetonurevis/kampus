import assert from 'node:assert/strict'
import { test } from 'node:test'
import { money } from '@kampus/school-core/lib/format.ts'
import {
  courseOfferRow,
  isProgressionOutcome,
  type CourseOfferItem,
} from '../src/pages/finance/course-offer-rows.ts'

// IST-088, ON-082; DOM-DIL-070, DOM-DIL-071: kur yenileme teklif listesinin saf satır mantığı.

const ITEM: CourseOfferItem = {
  studentId: 's1',
  studentName: 'Deniz Yılmaz',
  status: 'ready',
  outcome: 'passed',
  fromCourseName: 'Genel İngilizce B1.1',
  fromLevel: 'B1',
  courseName: 'Genel İngilizce B1.2',
  level: 'B1',
  options: [{ packageId: 'pkg-1', packageName: 'B1.2 kur ücreti', hours: 12, priceCents: 600_000 }],
  saleId: null,
  problem: null,
}

test('IST-088: hazır teklif ilk paketle açılır; tutar tarifeden biçimlenir', () => {
  const row = courseOfferRow(ITEM)
  assert.equal(row.outcome, 'Geçti')
  assert.equal(row.fromCourse, 'Genel İngilizce B1.1 (B1)')
  assert.equal(row.target, 'Genel İngilizce B1.2 (B1)')
  assert.equal(row.price, `${money(600_000)} · 12 saat · B1.2 kur ücreti`)
  assert.deepEqual(row.state, { label: 'Teklif hazır', tone: 'purple', note: null })
  assert.deepEqual(row.offer, {
    studentId: 's1',
    packageId: 'pkg-1',
    note: 'Deniz Yılmaz · kur sonu kararı: Geçti; teklif Genel İngilizce B1.2 (B1).',
  })
})

test('DOM-DIL-070: satılan, sorunlu ya da üst seviyesi olmayan satırda teklif açılmaz', () => {
  const sold = courseOfferRow({ ...ITEM, saleId: 'sale-1' })
  assert.equal(sold.offer, null)
  assert.equal(sold.state.label, 'Satıldı')
  const problem = { code: 'course_offer_package_missing', message: 'Paket yok.' }
  const missing = courseOfferRow({ ...ITEM, options: [], problem })
  assert.equal(missing.offer, null)
  assert.equal(missing.price, '—')
  assert.deepEqual(missing.state, { label: 'Teklif açılamaz', tone: 'amber', note: 'Paket yok.' })
  const top = courseOfferRow({
    ...ITEM,
    status: 'no_next_level',
    level: null,
    options: [],
    problem,
  })
  assert.equal(top.target, 'Üst seviye yok')
  const unchained = courseOfferRow({ ...ITEM, courseName: null, level: 'B1+' })
  assert.equal(unchained.target, 'B1+ seviyesi')
  assert.equal(courseOfferRow({ ...ITEM, outcome: 'repeat' }).outcome, 'Tekrar')
})

test('DOM-DIL-070: karar süzgeci yalnız bilinen sonucu kabul eder', () => {
  assert.equal(isProgressionOutcome('passed'), true)
  assert.equal(isProgressionOutcome('incomplete_attendance'), true)
  assert.equal(isProgressionOutcome('baska'), false)
  assert.equal(isProgressionOutcome(null), false)
})
