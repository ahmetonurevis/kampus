import assert from 'node:assert/strict'
import test from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  lessonHourCount,
  lessonHourSuggestion,
  lessonSuggestionQuerySchema,
  lessonSuggestionRange,
  lessonSuggestionTransferSchema,
  makeupLinks,
  planLessonSuggestionTransfer,
  suggestionPayBasis,
  type LessonSuggestion,
  type SuggestionInput,
  type SuggestionLesson,
  type SuggestionTeacher,
} from '../packages/school-core/src/lib/finance-lesson-hour-suggestions.ts'

/**
 * Programdan ek ders önerisi (DOM-FIN-165; ON-195; K-550…K-552). Eylül 2026: 1 Eylül salı; haftalar
 * 31 Ağustos–6 Eylül … 28 Eylül–4 Ekim. Saatler İstanbul 09.00'dan (06.00 UTC) başlar.
 */

const rejects = (fn: () => unknown, code: string) =>
  assert.throws(fn, (error) => error instanceof DomainError && error.code === code)

let sequence = 0
function lesson(day: string, period: number, extra: Partial<SuggestionLesson> = {}) {
  sequence += 1
  const start = Date.parse(`${day}T06:00:00.000Z`) + period * 50 * 60_000
  return {
    id: `les-${day}-${String(period)}-${String(sequence)}`,
    date: new Date(start).toISOString(),
    duration: 40,
    classId: 'c1',
    subjectId: 'mat',
    title: 'Matematik',
    teacherId: 't1',
    originalTeacherId: null,
    cancelledAt: null,
    createdAt: null,
    makeupForLessonId: null,
    ...extra,
  } satisfies SuggestionLesson
}
/** Günün `count` dersi. */
const lessonsOn = (day: string, count: number, extra: Partial<SuggestionLesson> = {}) =>
  Array.from({ length: count }, (_, period) => lesson(day, period, extra))

const SELIN: SuggestionTeacher = { membershipId: 'm1', teacherIds: ['t1'], payBasis: 'monthly' }

function input(overrides: Partial<SuggestionInput> = {}): SuggestionInput {
  return {
    month: '2026-09',
    params: { weeklyLoad: 15, weeklyCap: 30 },
    now: '2026-10-06T09:00:00.000Z',
    lessons: [],
    teachers: [SELIN],
    holidays: [],
    absences: [],
    attendanceDays: null,
    ...overrides,
  }
}
const teacherOf = (result: LessonSuggestion, membershipId = 'm1') => {
  const found = result.teachers.find((item) => item.membershipId === membershipId)
  assert.ok(found, `${membershipId} öneride yok`)
  return found
}
const items = (result: LessonSuggestion, membershipId = 'm1') =>
  teacherOf(result, membershipId).days.flatMap((day) => day.items)

test('DOM-FIN-165 K-550: ders saati 40 dakikadır, en az 1; aralık ayı kapsayan haftalardır', () => {
  assert.equal(lessonHourCount(40), 1)
  assert.equal(lessonHourCount(60), 1)
  assert.equal(lessonHourCount(80), 2)
  assert.equal(lessonHourCount(30), 1)
  assert.equal(lessonHourCount(0), 1)
  assert.equal(lessonHourCount(Number.NaN), 1)
  assert.deepEqual(lessonSuggestionRange('2026-09'), { from: '2026-08-31', to: '2026-10-04' })
  assert.deepEqual(lessonSuggestionRange('2026-11'), { from: '2026-10-26', to: '2026-12-06' })
})

test('DOM-FIN-165 K-551: haftada 15 saat maaş karşılığı, 30 saate kadar ek ders (MEB öneri)', () => {
  // 7–11 Eylül: günde 4 ders = 20 saat → 15 maaş karşılığı + 5 ek ders.
  const lessons = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'].flatMap(
    (day) => lessonsOn(day, 4),
  )
  const result = lessonHourSuggestion(input({ lessons }))
  const selin = teacherOf(result)
  assert.equal(selin.suggestedHours, 5)
  assert.equal(selin.totals.countedHours, 20)
  assert.equal(selin.totals.loadHours, 15)
  assert.equal(selin.totals.extraHours, 5)
  assert.deepEqual(selin.warnings, [])
  assert.deepEqual(
    selin.weeks.map((week) => [week.startDate, week.loadHours, week.extraHours, week.extraInMonth]),
    [['2026-09-07', 15, 5, 5]],
  )
  // Maaş karşılığı haftanın ilk derslerinden dolar: pazartesi–çarşamba 12, perşembenin 3'ü.
  const thursday = items(result).filter((item) => item.day === '2026-09-10')
  assert.deepEqual(
    thursday.map((item) => [item.loadHours, item.extraHours]),
    [
      [1, 0],
      [1, 0],
      [1, 0],
      [0, 1],
    ],
  )
  assert.equal(result.monthComplete, true)
  assert.equal(result.attendanceKnown, false)
})

test('DOM-FIN-165 K-551: üst sınırı aşan saat sayılmaz ve uyarı taşır', () => {
  const lessons = [
    ...lessonsOn('2026-09-07', 3),
    ...lessonsOn('2026-09-08', 3),
    lesson('2026-09-09', 0, { duration: 80 }),
  ]
  const result = lessonHourSuggestion(input({ lessons, params: { weeklyLoad: 3, weeklyCap: 5 } }))
  const selin = teacherOf(result)
  assert.equal(selin.totals.countedHours, 8)
  assert.equal(selin.suggestedHours, 2)
  assert.equal(selin.totals.overCapHours, 3)
  assert.deepEqual(selin.warnings, ['over_cap'])
  const block = items(result).find((item) => item.day === '2026-09-09')
  assert.deepEqual([block?.hours, block?.extraHours, block?.overCapHours], [2, 0, 2])
})

test('DOM-FIN-165 K-551: ayı kesen haftada ek ders dersin gününün ayına yazılır', () => {
  const lessons = [
    // 31 Ağustos pazartesi maaş karşılığını doldurur; 1 Eylül'ün dersleri ek derstir.
    ...lessonsOn('2026-08-31', 3),
    ...lessonsOn('2026-09-01', 2),
    // 28–30 Eylül: 4 ders; 3'ü maaş karşılığı, 1'i eylül ek dersi; 1 Ekim'in 2 dersi ekim ek dersi.
    ...lessonsOn('2026-09-28', 2),
    ...lessonsOn('2026-09-30', 2),
    ...lessonsOn('2026-10-01', 2),
  ]
  const params = { weeklyLoad: 3, weeklyCap: 20 }
  const september = teacherOf(lessonHourSuggestion(input({ lessons, params })))
  assert.equal(september.suggestedHours, 3)
  assert.deepEqual(
    september.weeks.map((week) => [
      week.startDate,
      week.monthFrom,
      week.monthTo,
      week.extraHours,
      week.extraInMonth,
    ]),
    [
      ['2026-08-31', '2026-09-01', '2026-09-06', 2, 2],
      ['2026-09-28', '2026-09-28', '2026-09-30', 3, 1],
    ],
  )
  // Ay dışındaki günler dökümde yer almaz.
  assert.ok(september.days.every((day) => day.day.startsWith('2026-09')))
  const october = teacherOf(
    lessonHourSuggestion(
      input({ lessons, params, month: '2026-10', now: '2026-11-03T09:00:00.000Z' }),
    ),
  )
  assert.equal(october.suggestedHours, 2)
})

test('DOM-FIN-165 K-550: iptal, tatil, izin, yedek, telafi ve bitmemiş ders dökümde nedeniyle', () => {
  const cancelled = lesson('2026-09-14', 0, { cancelledAt: '2026-09-13T08:00:00.000Z' })
  const makeup = lesson('2026-09-18', 3, { createdAt: '2026-09-13T09:00:00.000Z' })
  const lessons = [
    lesson('2026-09-14', 1),
    cancelled,
    lesson('2026-09-15', 0),
    lesson('2026-09-16', 0),
    // Asıl öğretmeni t1, yedek t2.
    lesson('2026-09-17', 0, { teacherId: 't2', originalTeacherId: 't1' }),
    // t2'nin dersine t1 yedek girdi.
    lesson('2026-09-17', 1, { classId: 'c2', originalTeacherId: 't2' }),
    makeup,
    lesson('2026-09-30', 0),
  ]
  const result = lessonHourSuggestion(
    input({
      lessons,
      now: '2026-09-29T12:00:00.000Z',
      teachers: [SELIN, { membershipId: 'm2', teacherIds: ['t2'], payBasis: 'monthly' }],
      holidays: [{ title: 'Okul kuruluş günü', startDate: '2026-09-15', endDate: '2026-09-15' }],
      absences: [{ membershipId: 'm1', startDate: '2026-09-16', endDate: '2026-09-16' }],
      attendanceDays: new Set(['c1|2026-09-14', 'c1|2026-09-18']),
    }),
  )
  const byDay = (day: string, period = 0) =>
    items(result).find(
      (item) =>
        item.day === day &&
        item.startsAt === new Date(Date.parse(`${day}T06:00:00.000Z`) + period * 3e6).toISOString(),
    )
  assert.equal(byDay('2026-09-14', 0)?.status, 'cancelled')
  assert.equal(byDay('2026-09-14', 1)?.status, 'counted')
  assert.equal(byDay('2026-09-14', 1)?.attendanceMissing, false)
  assert.equal(byDay('2026-09-15')?.status, 'holiday')
  assert.equal(byDay('2026-09-15')?.holidayTitle, 'Okul kuruluş günü')
  assert.equal(byDay('2026-09-16')?.status, 'leave')
  assert.equal(byDay('2026-09-17', 0)?.status, 'substituted_out')
  assert.equal(byDay('2026-09-17', 1)?.status, 'counted')
  assert.equal(byDay('2026-09-17', 1)?.kind, 'substitute')
  assert.equal(byDay('2026-09-17', 1)?.attendanceMissing, true)
  assert.equal(byDay('2026-09-18', 3)?.kind, 'makeup')
  assert.equal(byDay('2026-09-18', 3)?.makeupForLessonId, cancelled.id)
  assert.equal(byDay('2026-09-30')?.status, 'upcoming')
  assert.equal(byDay('2026-09-30')?.attendanceMissing, null)
  const totals = teacherOf(result).totals
  assert.deepEqual(
    [
      totals.countedHours,
      totals.ownHours,
      totals.substituteHours,
      totals.makeupHours,
      totals.cancelledHours,
      totals.holidayHours,
      totals.leaveHours,
      totals.substitutedOutHours,
      totals.upcomingHours,
      totals.attendanceMissingLessons,
    ],
    [3, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  )
  assert.ok(teacherOf(result).warnings.includes('attendance_missing'))
  assert.equal(result.monthComplete, false)
  assert.equal(result.attendanceKnown, true)
  // Yedek öğretmen dersi kendi sayımında; t2 kendi dersini devretti.
  const murat = items(result, 'm2')
  assert.deepEqual(
    murat.map((item) => [item.day, item.status, item.kind]),
    [
      ['2026-09-17', 'counted', 'substitute'],
      ['2026-09-17', 'substituted_out', 'own'],
    ],
  )
})

test('DOM-FIN-165 K-550: telafi bağı açık alandan önce, yoksa iptalden sonra açılan dersle', () => {
  const first = lesson('2026-09-07', 0, { cancelledAt: '2026-09-06T10:00:00.000Z' })
  const second = lesson('2026-09-08', 0, { cancelledAt: '2026-09-06T10:00:00.000Z' })
  const explicit = lesson('2026-09-20', 0, { makeupForLessonId: second.id })
  const inferred = lesson('2026-09-21', 0, { createdAt: '2026-09-06T11:00:00.000Z' })
  // İptalden önce açılmış ders ve başka dersin dersi telafi sayılmaz.
  const before = lesson('2026-09-22', 0, { createdAt: '2026-09-01T11:00:00.000Z' })
  const other = lesson('2026-09-23', 0, {
    subjectId: 'fen',
    createdAt: '2026-09-06T12:00:00.000Z',
  })
  const links = makeupLinks([first, second, explicit, inferred, before, other])
  assert.equal(links.get(explicit.id), second.id)
  assert.equal(links.get(inferred.id), first.id)
  assert.equal(links.has(before.id), false)
  assert.equal(links.has(other.id), false)
})

test('DOM-FIN-165 K-551: saat ücretliye öneri yok, ücret tanımı yoksa aylık sayılır ve uyarılır', () => {
  const lessons = [
    ...['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'].flatMap((day) => lessonsOn(day, 5)),
    ...lessonsOn('2026-09-07', 5, { teacherId: 't3', classId: 'c3' }),
  ]
  const result = lessonHourSuggestion(
    input({
      lessons,
      teachers: [
        { ...SELIN, payBasis: 'hourly' },
        { membershipId: 'm3', teacherIds: ['t3'], payBasis: 'unknown' },
      ],
      params: { weeklyLoad: 3, weeklyCap: 30 },
    }),
  )
  const hourly = teacherOf(result)
  assert.equal(hourly.applicable, false)
  assert.equal(hourly.suggestedHours, null)
  assert.equal(hourly.totals.countedHours, 20)
  assert.equal(hourly.totals.extraHours, 0)
  const unknown = teacherOf(result, 'm3')
  assert.equal(unknown.suggestedHours, 2)
  assert.deepEqual(unknown.warnings, ['no_pay_rate'])
})

test('DOM-FIN-165: üyeliğe bağlı olmayan öğretmen kaydı ayrı listelenir, dersi olmayan yok', () => {
  const lessons = [
    lesson('2026-09-07', 0, { teacherId: 'tx' }),
    lesson('2026-09-08', 0, { teacherId: 'tx', cancelledAt: '2026-09-01T08:00:00.000Z' }),
    lesson('2026-10-08', 0, { teacherId: 'ty' }),
  ]
  const result = lessonHourSuggestion(
    input({ lessons, teachers: [SELIN, { ...SELIN, membershipId: 'm9', teacherIds: ['t9'] }] }),
  )
  assert.deepEqual(result.unlinked, [{ teacherId: 'tx', countedHours: 1 }])
  assert.deepEqual(result.teachers, [])
})

test('DOM-FIN-165: girdi değişmez', () => {
  const lessons = Object.freeze(lessonsOn('2026-09-07', 20).map((item) => Object.freeze(item)))
  const before = JSON.stringify(lessons)
  lessonHourSuggestion(input({ lessons }))
  assert.equal(JSON.stringify(lessons), before)
})

test('DOM-FIN-165 K-551: sorgu varsayılanı 15/30, üst sınır maaş karşılığından az olamaz', () => {
  assert.deepEqual(lessonSuggestionQuerySchema.parse({}), { weeklyLoad: 15, weeklyCap: 30 })
  assert.deepEqual(lessonSuggestionQuerySchema.parse({ weeklyLoad: '18', weeklyCap: '24' }), {
    weeklyLoad: 18,
    weeklyCap: 24,
  })
  assert.equal(
    lessonSuggestionQuerySchema.safeParse({ weeklyLoad: 20, weeklyCap: 10 }).success,
    false,
  )
  assert.equal(lessonSuggestionQuerySchema.safeParse({ weeklyLoad: -1 }).success, false)
  assert.equal(lessonSuggestionQuerySchema.safeParse({ weeklyLoad: 41 }).success, false)
  assert.equal(lessonSuggestionQuerySchema.safeParse({ weeklyCap: 61 }).success, false)
  assert.equal(lessonSuggestionQuerySchema.safeParse({ other: 1 }).success, false)
})

test('DOM-FIN-165 K-552: aktarım gövdesi tekil öğretmen, gerekçe 5–500, boş gerekçe yok sayılır', () => {
  const body = (items: unknown[]) => ({ weeklyLoad: 15, weeklyCap: 30, items })
  const item = { membershipId: 'm1', suggestedHours: 5, hours: 5 }
  assert.deepEqual(lessonSuggestionTransferSchema.parse(body([{ ...item, reason: '  ' }])).items, [
    { ...item, reason: null },
  ])
  assert.equal(lessonSuggestionTransferSchema.safeParse(body([item, item])).success, false)
  assert.equal(lessonSuggestionTransferSchema.safeParse(body([])).success, false)
  assert.equal(
    lessonSuggestionTransferSchema.safeParse(body([{ ...item, reason: 'kısa' }])).success,
    false,
  )
  assert.equal(
    lessonSuggestionTransferSchema.safeParse(body([{ ...item, reason: 'x'.repeat(501) }])).success,
    false,
  )
  assert.equal(
    lessonSuggestionTransferSchema.safeParse(body([{ ...item, hours: 0 }])).success,
    false,
  )
  assert.equal(
    lessonSuggestionTransferSchema.safeParse({ weeklyLoad: '15', weeklyCap: 30, items: [item] })
      .success,
    false,
  )
})

test('DOM-FIN-165 K-552: aktarım planı öneriyi, gerekçeyi ve mevcut kaydı denetler', () => {
  const lessons = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'].flatMap((day) =>
    lessonsOn(day, 5),
  )
  const suggestion = lessonHourSuggestion(
    input({
      lessons: [...lessons, ...lessonsOn('2026-09-07', 2, { teacherId: 't4' })],
      teachers: [SELIN, { membershipId: 'm4', teacherIds: ['t4'], payBasis: 'hourly' }],
    }),
  )
  assert.equal(teacherOf(suggestion).suggestedHours, 5)
  const parse = (items: unknown[]) =>
    lessonSuggestionTransferSchema.parse({ weeklyLoad: 15, weeklyCap: 30, items })
  const none = new Map()
  const plan = planLessonSuggestionTransfer(
    parse([{ membershipId: 'm1', suggestedHours: 5, hours: 5 }]),
    suggestion,
    none,
  )
  assert.deepEqual(plan, [
    { membershipId: 'm1', suggestedHours: 5, hours: 5, reason: null, entry: null },
  ])
  const entry = { id: 'e1', hours: 3, version: 2, note: 'Elle' }
  const corrected = planLessonSuggestionTransfer(
    parse([{ membershipId: 'm1', suggestedHours: 5, hours: 4, reason: 'Bir ders gezide geçti' }]),
    suggestion,
    new Map([['m1', entry]]),
  )
  assert.deepEqual(corrected[0]?.entry, entry)
  rejects(
    () =>
      planLessonSuggestionTransfer(
        parse([{ membershipId: 'm1', suggestedHours: 4, hours: 4 }]),
        suggestion,
        none,
      ),
    'lesson_suggestion_changed',
  )
  rejects(
    () =>
      planLessonSuggestionTransfer(
        parse([{ membershipId: 'm1', suggestedHours: 5, hours: 6 }]),
        suggestion,
        none,
      ),
    'lesson_suggestion_reason_required',
  )
  rejects(
    () =>
      planLessonSuggestionTransfer(
        parse([{ membershipId: 'm1', suggestedHours: 5, hours: 5 }]),
        suggestion,
        new Map([['m1', { ...entry, hours: 5 }]]),
      ),
    'lesson_suggestion_unchanged',
  )
  for (const membershipId of ['m4', 'yok'])
    rejects(
      () =>
        planLessonSuggestionTransfer(
          parse([{ membershipId, suggestedHours: 0, hours: 1, reason: 'Elle düzeltme' }]),
          suggestion,
          none,
        ),
      'lesson_suggestion_not_found',
    )
  const conflict = (() => {
    try {
      planLessonSuggestionTransfer(
        parse([{ membershipId: 'm1', suggestedHours: 1, hours: 1 }]),
        suggestion,
        none,
      )
    } catch (error) {
      return error
    }
    return null
  })()
  assert.ok(conflict instanceof DomainError)
  assert.equal(conflict.kind, 'conflict')
  assert.deepEqual(conflict.path, ['items', '0', 'suggestedHours'])
})

test('DOM-FIN-165 K-551: ücret türü ayla kesişen en geç başlayan ana ücretten', () => {
  const rate = (rateType: string, startDate: string, endDate: string | null = null) => ({
    component: 'wage',
    rateType,
    startDate,
    endDate,
  })
  assert.equal(suggestionPayBasis([], '2026-09'), 'unknown')
  assert.equal(
    suggestionPayBasis([{ ...rate('hourly', '2026-01-01'), component: 'lesson' }], '2026-09'),
    'unknown',
  )
  assert.equal(suggestionPayBasis([rate('monthly_gross', '2026-01-01')], '2026-09'), 'monthly')
  assert.equal(suggestionPayBasis([rate('monthly_net', '2026-01-01')], '2026-09'), 'monthly')
  assert.equal(
    suggestionPayBasis(
      [rate('monthly_gross', '2026-01-01', '2026-09-14'), rate('lesson_hour', '2026-09-15')],
      '2026-09',
    ),
    'hourly',
  )
  assert.equal(suggestionPayBasis([rate('hourly', '2026-10-01')], '2026-09'), 'unknown')
  assert.equal(
    suggestionPayBasis([rate('hourly', '2026-01-01', '2026-08-31')], '2026-09'),
    'unknown',
  )
})
