import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GROUP_LESSON_HOUR_MINUTES,
  HOURLY_PAYOUT_ROLES,
  HOURLY_PAYOUT_SELF_ROLES,
  groupPayoutSessions,
  hourlyLessonPayout,
  hourlyPayoutCsv,
  hourlyPayoutFilename,
  hourlyPayoutQuerySchema,
  hourlyPayoutRange,
  payoutMonthLabel,
  payoutPayBasis,
  payoutRateText,
  priceLine,
  type HourlyPayout,
  type HourlyPayoutInput,
  type PayoutGroupSession,
  type PayoutRate,
  type PayoutTeacher,
} from '../packages/school-core/src/lib/finance-hourly-lesson-payouts.ts'
import type { SuggestionLesson } from '../packages/school-core/src/lib/finance-lesson-hour-suggestions.ts'

/**
 * Saat ücretli öğretmen ders saati hakediş dökümü (DOM-FIN-167; ON-075; IST-087; K-556…K-558).
 * Eylül 2026: 1 Eylül salı. Ders saatleri İstanbul 09.00'dan (06.00 UTC) başlar; 40 dakikalık ders
 * 1 ders saatidir. Ece (`m2`, öğretmen kaydı `t2`) ders saati ücretlidir.
 */

let sequence = 0
function lesson(day: string, period: number, extra: Partial<SuggestionLesson> = {}) {
  sequence += 1
  const start = Date.parse(`${day}T06:00:00.000Z`) + period * 50 * 60_000
  return {
    id: `pay-${day}-${String(period)}-${String(sequence)}`,
    date: new Date(start).toISOString(),
    duration: 40,
    classId: 'c1',
    subjectId: 'ing',
    title: 'İngilizce',
    teacherId: 't2',
    originalTeacherId: null,
    cancelledAt: null,
    createdAt: null,
    makeupForLessonId: null,
    ...extra,
  } satisfies SuggestionLesson
}

const wage = (
  rateType: string,
  amountCents: number,
  startDate = '2026-01-01',
  endDate: string | null = null,
) => ({ component: 'wage', rateType, amountCents, startDate, endDate }) satisfies PayoutRate

const ECE: PayoutTeacher = {
  membershipId: 'm2',
  teacherIds: ['t2'],
  rates: [wage('lesson_hour', 50_000)],
}

function input(overrides: Partial<HourlyPayoutInput> = {}): HourlyPayoutInput {
  return {
    month: '2026-09',
    now: '2026-10-06T09:00:00.000Z',
    lessons: [],
    teachers: [ECE],
    groupSessions: [],
    holidays: [],
    absences: [],
    attendanceDays: null,
    ...overrides,
  }
}
const teacherOf = (result: HourlyPayout, membershipId = 'm2') => {
  const found = result.teachers.find((item) => item.membershipId === membershipId)
  assert.ok(found, `${membershipId} dökümde yok`)
  return found
}
const lines = (result: HourlyPayout, membershipId = 'm2') =>
  teacherOf(result, membershipId).days.flatMap((day) => day.lines)

test('DOM-FIN-167: roller, sorgu şeması, aralık, ay adı ve dosya adı', () => {
  assert.deepEqual(HOURLY_PAYOUT_ROLES, ['yonetici'])
  assert.deepEqual([...HOURLY_PAYOUT_SELF_ROLES], ['yonetici', 'ogretmen', 'onburo'])
  assert.deepEqual(hourlyPayoutQuerySchema.parse({}), { purpose: 'view' })
  assert.deepEqual(hourlyPayoutQuerySchema.parse({ purpose: 'pdf' }), { purpose: 'pdf' })
  assert.equal(hourlyPayoutQuerySchema.safeParse({ purpose: 'csv' }).success, false)
  assert.equal(hourlyPayoutQuerySchema.safeParse({ institutionId: 'b' }).success, false)
  // Telafi bağı için önceki aydan 35 gün okunur.
  assert.deepEqual(hourlyPayoutRange('2026-09'), { from: '2026-07-28', to: '2026-09-30' })
  assert.equal(payoutMonthLabel('2026-09'), 'Eylül 2026')
  assert.equal(hourlyPayoutFilename('2026-09', 'csv'), 'ders-saati-hakedis-2026-09.csv')
  assert.equal(payoutRateText(null, null), '')
  assert.match(payoutRateText('lesson_hour', 50_000), /^500,00\s₺ ders saati başı$/)
})

test('DOM-FIN-167 K-556: kapsam ana ücret türünden; aylık-yalnız öğretmen dökümde yok', () => {
  assert.equal(payoutPayBasis([wage('monthly_gross', 4_500_000)], '2026-09'), null)
  assert.equal(payoutPayBasis([wage('hourly', 40_000)], '2026-09'), 'hourly')
  assert.equal(payoutPayBasis([wage('lesson_hour', 40_000)], '2026-09'), 'hourly')
  assert.equal(payoutPayBasis([], '2026-09'), 'unknown')
  // Ay dışında biten tanım ve ek ders ücreti ana ücret sayılmaz.
  assert.equal(
    payoutPayBasis(
      [
        wage('hourly', 40_000, '2026-01-01', '2026-08-31'),
        { ...wage('extra', 30_000), component: 'lesson' },
      ],
      '2026-09',
    ),
    'unknown',
  )
  assert.equal(
    payoutPayBasis(
      [
        wage('monthly_gross', 4_500_000, '2026-01-01', '2026-09-14'),
        wage('lesson_hour', 50_000, '2026-09-15'),
      ],
      '2026-09',
    ),
    'mixed',
  )
  const monthly: PayoutTeacher = {
    membershipId: 'm1',
    teacherIds: ['t1'],
    rates: [wage('monthly_gross', 4_500_000)],
  }
  const result = hourlyLessonPayout(
    input({
      teachers: [monthly, ECE],
      lessons: [lesson('2026-09-07', 0, { teacherId: 't1' }), lesson('2026-09-07', 1)],
    }),
  )
  assert.deepEqual(
    result.teachers.map((item) => item.membershipId),
    ['m2'],
  )
  // Dersi olmayan saat ücretli öğretmen de yer almaz.
  assert.deepEqual(hourlyLessonPayout(input()).teachers, [])
})

test('DOM-FIN-167 K-556: ders saati ücreti × ders saati; saatlik ücret dakikadan, kuruşa yuvarlanır', () => {
  const day = { day: '2026-09-07', hours: 2, minutes: 80 }
  assert.deepEqual(priceLine([wage('lesson_hour', 50_000)], day), {
    rate: wage('lesson_hour', 50_000),
    rateType: 'lesson_hour',
    rateCents: 50_000,
    amountCents: 100_000,
    unpriced: null,
  })
  // 333,33 ₺ × 40/60 = 222,22 ₺ (22.222 kuruş); 80 dakika 444,44 ₺.
  assert.equal(priceLine([wage('hourly', 33_333)], { ...day, minutes: 40 }).amountCents, 22_222)
  assert.equal(priceLine([wage('hourly', 33_333)], day).amountCents, 44_444)
  assert.equal(priceLine([], day).unpriced, 'no_rate')
  assert.equal(priceLine([wage('monthly_net', 3_000_000)], day).unpriced, 'monthly')
  assert.equal(priceLine([wage('monthly_net', 3_000_000)], day).amountCents, null)
})

test('DOM-FIN-167 K-556: verildi, iptal, telafi, yedeğe devredildi, yedek, tatil, izin ve henüz yapılmadı', () => {
  const cancelled = lesson('2026-09-08', 0, { cancelledAt: '2026-09-01T08:00:00.000Z' })
  const result = hourlyLessonPayout(
    input({
      now: '2026-09-30T08:00:00.000Z',
      lessons: [
        lesson('2026-09-07', 0),
        lesson('2026-09-07', 1, { duration: 80 }),
        cancelled,
        lesson('2026-09-15', 0, { makeupForLessonId: cancelled.id }),
        // Ece'nin dersine yedek girildi: Ece'ye ödenmez.
        lesson('2026-09-09', 0, { teacherId: 't9', originalTeacherId: 't2' }),
        // Ece başkasının dersine yedek girdi: ödenir.
        lesson('2026-09-10', 0, { originalTeacherId: 't9', classId: 'c2' }),
        lesson('2026-09-16', 0),
        lesson('2026-09-17', 0),
        // Bitmemiş ders (ayın son günü, şimdi 11.00 İstanbul).
        lesson('2026-09-30', 3),
      ],
      holidays: [{ title: 'Kuruluş günü', startDate: '2026-09-16', endDate: '2026-09-16' }],
      absences: [{ membershipId: 'm2', startDate: '2026-09-17', endDate: '2026-09-17' }],
      attendanceDays: new Set(['c1|2026-09-07']),
    }),
  )
  assert.equal(result.monthComplete, false)
  assert.equal(result.attendanceKnown, true)
  const ece = teacherOf(result)
  assert.equal(ece.payBasis, 'hourly')
  assert.deepEqual(
    lines(result).map((line) => [line.day, line.status, line.kind, line.hours, line.amountCents]),
    [
      ['2026-09-07', 'counted', 'own', 1, 50_000],
      ['2026-09-07', 'counted', 'own', 2, 100_000],
      ['2026-09-08', 'cancelled', 'own', 1, null],
      ['2026-09-09', 'substituted_out', 'own', 1, null],
      ['2026-09-10', 'counted', 'substitute', 1, 50_000],
      ['2026-09-15', 'counted', 'makeup', 1, 50_000],
      ['2026-09-16', 'holiday', 'own', 1, null],
      ['2026-09-17', 'leave', 'own', 1, null],
      ['2026-09-30', 'upcoming', 'own', 1, null],
    ],
  )
  const makeup = lines(result).find((line) => line.kind === 'makeup')
  assert.equal(makeup?.makeupForLessonId, cancelled.id)
  assert.equal(lines(result)[6]?.holidayTitle, 'Kuruluş günü')
  assert.deepEqual(ece.totals, {
    lessons: 9,
    givenLessons: 4,
    givenHours: 5,
    givenMinutes: 200,
    ownHours: 3,
    substituteHours: 1,
    makeupLessons: 1,
    makeupHours: 1,
    groupHours: 0,
    cancelledLessons: 1,
    cancelledHours: 1,
    substitutedOutLessons: 1,
    holidayLessons: 1,
    leaveLessons: 1,
    upcomingLessons: 1,
    duplicateLessons: 0,
    // c2 ve c1'in 15 Eylül günü yoklaması yok.
    attendanceMissingLessons: 2,
    amountCents: 250_000,
    unpricedHours: 0,
  })
  assert.deepEqual(ece.warnings, ['attendance_missing'])
  assert.deepEqual(ece.rates, [
    {
      rateType: 'lesson_hour',
      rateCents: 50_000,
      startDate: '2026-01-01',
      endDate: null,
      lessons: 4,
      hours: 5,
      minutes: 200,
      amountCents: 250_000,
    },
  ])
  // Yedeğe devreden asıl öğretmen kaydı dökümde değil; dersi veren t9 üyeliğe bağlı değil.
  assert.equal(result.teachers.length, 1)
})

test('DOM-FIN-167 K-556: ay içinde ücret değişirse her ders kendi gününün ücretiyle', () => {
  const teacher: PayoutTeacher = {
    ...ECE,
    rates: [
      wage('lesson_hour', 50_000, '2026-01-01', '2026-09-14'),
      wage('hourly', 90_000, '2026-09-15'),
    ],
  }
  const result = hourlyLessonPayout(
    input({
      teachers: [teacher],
      lessons: [
        lesson('2026-09-14', 0),
        lesson('2026-09-15', 0),
        lesson('2026-09-16', 0, { duration: 45 }),
      ],
    }),
  )
  assert.deepEqual(
    lines(result).map((line) => [line.rateType, line.rateCents, line.amountCents]),
    [
      ['lesson_hour', 50_000, 50_000],
      ['hourly', 90_000, 60_000],
      ['hourly', 90_000, 67_500],
    ],
  )
  const ece = teacherOf(result)
  assert.equal(ece.totals.amountCents, 177_500)
  assert.deepEqual(
    ece.rates.map((rate) => [
      rate.rateType,
      rate.startDate,
      rate.lessons,
      rate.minutes,
      rate.amountCents,
    ]),
    [
      ['lesson_hour', '2026-01-01', 1, 40, 50_000],
      ['hourly', '2026-09-15', 2, 85, 127_500],
    ],
  )
})

test('DOM-FIN-167 K-556: ücret tanımı yoksa tutar boş ve uyarılı; aylık günler ve boşluk ayrı uyarı', () => {
  const unknown = hourlyLessonPayout(
    input({ teachers: [{ ...ECE, rates: [] }], lessons: [lesson('2026-09-07', 0)] }),
  )
  const ece = teacherOf(unknown)
  assert.equal(ece.payBasis, 'unknown')
  assert.deepEqual(ece.warnings, ['no_pay_rate'])
  assert.equal(ece.totals.amountCents, 0)
  assert.equal(ece.totals.unpricedHours, 1)
  assert.deepEqual(ece.rates, [])
  assert.equal(lines(unknown)[0]?.unpriced, 'no_rate')

  const mixed = hourlyLessonPayout(
    input({
      teachers: [
        {
          ...ECE,
          rates: [
            wage('monthly_gross', 4_500_000, '2026-01-01', '2026-09-09'),
            wage('lesson_hour', 50_000, '2026-09-15'),
          ],
        },
      ],
      lessons: [lesson('2026-09-08', 0), lesson('2026-09-10', 0), lesson('2026-09-15', 0)],
    }),
  )
  const mixedEce = teacherOf(mixed)
  assert.equal(mixedEce.payBasis, 'mixed')
  assert.deepEqual(
    lines(mixed).map((line) => line.unpriced),
    ['monthly', 'no_rate', null],
  )
  assert.deepEqual(mixedEce.warnings, ['rate_gap', 'monthly_days'])
  assert.equal(mixedEce.totals.amountCents, 50_000)
  assert.equal(mixedEce.totals.unpricedHours, 2)
})

test('DOM-FIN-167 K-557: grup oturumları plandan; açılmamış ve öğretmensiz grup yok, iptalden sonrası iptal', () => {
  const course = {
    id: 'k1',
    name: 'Genel İngilizce B1',
    totalHours: 8,
    sessionMinutes: 90 as const,
  }
  const group = {
    id: 'g1',
    courseId: 'k1',
    teacherMembershipId: 'm2',
    schedule: [{ weekday: 1, startTime: '18:00' }],
    startDate: '2026-09-07',
    endDate: '2026-09-28',
    state: 'open' as const,
    openedAt: '2026-09-01T08:00:00.000Z',
    cancelledAt: null,
  }
  const range = { from: '2026-09-01', to: '2026-09-30' }
  const sessions = groupPayoutSessions([group], [course], range)
  assert.deepEqual(
    sessions.map((item) => [item.day, item.startsAt, item.minutes, item.cancelled]),
    [
      ['2026-09-07', '2026-09-07T15:00:00.000Z', 90, false],
      ['2026-09-14', '2026-09-14T15:00:00.000Z', 90, false],
      ['2026-09-21', '2026-09-21T15:00:00.000Z', 90, false],
      ['2026-09-28', '2026-09-28T15:00:00.000Z', 90, false],
    ],
  )
  assert.equal(sessions[0]?.title, 'Genel İngilizce B1')
  assert.equal(sessions[0]?.id, 'group:g1:2026-09-07:18:00')
  const cancelled = groupPayoutSessions(
    [{ ...group, state: 'cancelled', cancelledAt: '2026-09-15T08:00:00.000Z' }],
    [course],
    range,
  )
  assert.deepEqual(
    cancelled.map((item) => item.cancelled),
    [false, false, true, true],
  )
  assert.deepEqual(groupPayoutSessions([{ ...group, openedAt: null }], [course], range), [])
  assert.deepEqual(
    groupPayoutSessions([{ ...group, teacherMembershipId: null }], [course], range),
    [],
  )
  assert.deepEqual(groupPayoutSessions([group], [], range), [])
  assert.deepEqual(
    groupPayoutSessions([group], [course], { from: '2026-10-01', to: '2026-10-31' }),
    [],
  )
  // Ay sınırında yalnız aralıktaki oturumlar.
  assert.equal(
    groupPayoutSessions([group], [course], { from: '2026-09-10', to: '2026-09-30' }).length,
    3,
  )
})

test('DOM-FIN-167 K-557: grup dersi 45 dakikalık ders saatiyle ödenir; programla çakışan oturum sayılmaz', () => {
  const session = (day: string, extra: Partial<PayoutGroupSession> = {}): PayoutGroupSession => ({
    id: `group:g1:${day}:09:00`,
    groupId: 'g1',
    teacherMembershipId: 'm2',
    day,
    startsAt: `${day}T06:00:00.000Z`,
    minutes: 90,
    title: 'Genel İngilizce B1',
    cancelled: false,
    ...extra,
  })
  const result = hourlyLessonPayout(
    input({
      lessons: [lesson('2026-09-14', 1)],
      groupSessions: [
        session('2026-09-07'),
        // Programdaki 06.50 UTC dersiyle çakışır.
        session('2026-09-14'),
        session('2026-09-21', { cancelled: true }),
        session('2026-09-22'),
        session('2026-09-23'),
        session('2026-09-24', { teacherMembershipId: 'm9' }),
      ],
      holidays: [{ title: 'Bayram', startDate: '2026-09-22', endDate: '2026-09-22' }],
      absences: [{ membershipId: 'm2', startDate: '2026-09-23', endDate: '2026-09-23' }],
    }),
  )
  assert.equal(GROUP_LESSON_HOUR_MINUTES, 45)
  assert.deepEqual(
    lines(result).map((line) => [line.day, line.source, line.status, line.hours, line.amountCents]),
    [
      ['2026-09-07', 'group', 'counted', 2, 100_000],
      ['2026-09-14', 'group', 'duplicate', 2, null],
      ['2026-09-14', 'schedule', 'counted', 1, 50_000],
      ['2026-09-21', 'group', 'cancelled', 2, null],
      ['2026-09-22', 'group', 'holiday', 2, null],
      ['2026-09-23', 'group', 'leave', 2, null],
    ],
  )
  const ece = teacherOf(result)
  assert.equal(ece.totals.groupHours, 2)
  assert.equal(ece.totals.duplicateLessons, 1)
  assert.equal(ece.totals.cancelledHours, 2)
  assert.deepEqual(ece.warnings, ['group_plan', 'duplicate'])
  const groupLine = lines(result)[0]
  assert.equal(groupLine?.groupId, 'g1')
  assert.equal(groupLine?.classId, null)
  assert.equal(groupLine?.kind, 'group')
  // Henüz bitmemiş grup oturumu.
  const early = hourlyLessonPayout(
    input({ now: '2026-09-07T06:30:00.000Z', groupSessions: [session('2026-09-07')] }),
  )
  assert.equal(lines(early)[0]?.status, 'upcoming')
})

test('DOM-FIN-167: CSV ders başına satır, öğretmen toplamı ve not; formül kaçışı ve ondalık virgül', () => {
  const result = hourlyLessonPayout(
    input({
      lessons: [
        lesson('2026-09-07', 0),
        lesson('2026-09-08', 0, { cancelledAt: '2026-09-01T08:00:00.000Z' }),
      ],
      holidays: [],
    }),
  )
  const ece = teacherOf(result)
  const csv = hourlyPayoutCsv([
    {
      staffName: '=Ece Yılmaz',
      totals: ece.totals,
      days: ece.days.map((day) => ({
        lines: day.lines.map((line) => ({ ...line, placeName: '9-A' })),
      })),
    },
  ])
  const rows = csv.split('\r\n')
  assert.equal(rows.length, 5)
  assert.match(rows[0] ?? '', /^"Öğretmen";"Gün";"Başlangıç";"Sınıf \/ grup";"Ders"/)
  assert.equal(
    rows[1],
    `"'=Ece Yılmaz";"2026-09-07";"09:00";"9-A";"İngilizce";"Kendi dersi";"Verildi";40;1;"Ders saati ücreti";500,00;500,00;""`,
  )
  assert.match(rows[2] ?? '', /"İptal edildi";40;1;"";"";"";""$/)
  assert.match(rows[3] ?? '', /^"'=Ece Yılmaz toplamı";.*"1 iptal, 0 telafi";"";1;"";"";500,00;""$/)
  assert.match(rows[4] ?? '', /^"Döküm ders programından/)
})
