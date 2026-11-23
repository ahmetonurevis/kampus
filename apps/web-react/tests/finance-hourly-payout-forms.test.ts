import assert from 'node:assert/strict'
import test from 'node:test'

import {
  defaultPayoutMonth,
  payoutAmountText,
  payoutBasisText,
  payoutKindText,
  payoutLineRateText,
  payoutLineTimeText,
  payoutPlaceText,
  payoutRatePeriodText,
  payoutStatusText,
  payoutStatusTone,
  payoutTotalsText,
  payoutWarningText,
  payoutWarningTone,
  validPayoutMonth,
} from '../src/pages/finance/finance-hourly-payout-forms.ts'
import {
  hourlyPayoutPdfFilename,
  payoutAmountCell,
} from '../src/lib/pdf/templates/finance-hourly-lesson-payout.ts'

// Ders saati hakediş dökümü gösterimi (DOM-FIN-167; ON-075).

type Line = Parameters<typeof payoutAmountCell>[0]
const line = (overrides: Partial<Line> = {}): Line => ({
  lessonId: 'l1',
  source: 'schedule',
  day: '2026-09-07',
  startsAt: '2026-09-07T06:00:00.000Z',
  minutes: 40,
  hours: 1,
  classId: 'c1',
  groupId: null,
  subjectId: 'ing',
  title: 'İngilizce',
  placeName: '9-A',
  status: 'counted',
  kind: 'own',
  makeupForLessonId: null,
  holidayTitle: null,
  attendanceMissing: null,
  rateType: 'lesson_hour',
  rateCents: 50_000,
  amountCents: 50_000,
  unpriced: null,
  ...overrides,
})

test('DOM-FIN-167: varsayılan ay bir önceki ay, geçersiz ay istek atmaz', () => {
  assert.equal(defaultPayoutMonth('2026-11-24'), '2026-10')
  assert.equal(defaultPayoutMonth('2027-01-05'), '2026-12')
  assert.equal(validPayoutMonth('2026-09'), '2026-09')
  assert.equal(validPayoutMonth(''), null)
  assert.equal(validPayoutMonth('2026-13'), null)
})

test('DOM-FIN-167 K-556: satır metinleri, durum tonu ve tutarın neden boş olduğu', () => {
  assert.equal(payoutLineTimeText(line()), '09:00 · 40 dk · 1 ders saati')
  assert.equal(payoutStatusText(line({ status: 'substituted_out' })), 'Yedeğe devredildi')
  assert.equal(payoutKindText(line({ kind: 'makeup' })), 'Telafi dersi')
  assert.equal(payoutPlaceText(line()), '9-A')
  assert.equal(payoutPlaceText(line({ placeName: null })), 'c1')
  assert.equal(payoutPlaceText(line({ placeName: null, classId: null, groupId: 'g1' })), 'g1')
  assert.equal(payoutPlaceText(line({ placeName: null, classId: null })), '—')
  assert.deepEqual(
    (
      [
        'counted',
        'cancelled',
        'upcoming',
        'duplicate',
        'holiday',
        'leave',
        'substituted_out',
      ] as const
    ).map((status) => payoutStatusTone(line({ status }))),
    ['green', 'red', 'amber', 'amber', 'gray', 'gray', 'gray'],
  )
  assert.match(payoutAmountText(line()), /^500,00\s₺$/)
  assert.equal(payoutAmountText(line({ status: 'cancelled', amountCents: null })), 'Ödenmez')
  assert.equal(
    payoutAmountText(line({ amountCents: null, unpriced: 'no_rate' })),
    'O gün ana ücret tanımı yok',
  )
  assert.equal(payoutAmountText(line({ amountCents: null })), '—')
  assert.match(payoutLineRateText(line()), /ders saati başı$/)
  assert.equal(payoutLineRateText(line({ rateType: null, rateCents: null })), '')
  // PDF hücresi: verilmeyen derste tire.
  assert.equal(payoutAmountCell(line({ status: 'holiday', amountCents: null })), '—')
  assert.equal(
    payoutAmountCell(line({ amountCents: null, unpriced: 'monthly' })),
    'O gün ana ücret aylık',
  )
})

test('DOM-FIN-167: özet, ücret dilimi, uyarı ve PDF dosya adı', () => {
  assert.equal(payoutBasisText({ payBasis: 'mixed' }), 'Ay içinde aylık ve saat ücreti')
  assert.equal(
    payoutTotalsText({
      lessons: 9,
      givenLessons: 3,
      givenHours: 4,
      givenMinutes: 160,
      ownHours: 3,
      substituteHours: 0,
      makeupLessons: 1,
      makeupHours: 1,
      groupHours: 0,
      cancelledLessons: 1,
      cancelledHours: 1,
      substitutedOutLessons: 1,
      holidayLessons: 1,
      leaveLessons: 1,
      upcomingLessons: 0,
      duplicateLessons: 0,
      attendanceMissingLessons: 0,
      amountCents: 210_000,
      unpricedHours: 0,
    }),
    '3 ders, 4 ders saati · 1 iptal · 1 telafi',
  )
  assert.match(payoutRatePeriodText({ startDate: '2026-09-15', endDate: null }), /itibarıyla$/)
  assert.match(payoutRatePeriodText({ startDate: '2026-01-01', endDate: '2026-09-14' }), / – /)
  assert.equal(
    payoutWarningText('group_plan'),
    'Grup dersleri plandan; oturum iptali ve telafisi bilinmiyor',
  )
  assert.equal(payoutWarningTone('group_plan'), 'purple')
  assert.equal(payoutWarningTone('no_pay_rate'), 'amber')
  assert.equal(hourlyPayoutPdfFilename('2026-09'), 'ders-saati-hakedis-2026-09.pdf')
  assert.equal(hourlyPayoutPdfFilename('2026-09', 'üye/1'), 'ders-saati-hakedis-2026-09--ye-1.pdf')
})
