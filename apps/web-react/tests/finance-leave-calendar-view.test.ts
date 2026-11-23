import assert from 'node:assert/strict'
import test from 'node:test'

import type { LeaveCalendarEntry } from '@kampus/react-shared/use-finance-leave-calendar.ts'
import type { LeaveRequestLessonView } from '@kampus/react-shared/use-finance-leave-requests.ts'
import {
  addDays,
  agendaDays,
  busyOn,
  calendarRange,
  calendarWeeks,
  conflictTexts,
  dayLongText,
  entriesOn,
  entryLabel,
  entryText,
  examWeekOn,
  formConflicts,
  holidayOn,
  isWeekend,
  periodTitle,
  settingsBody,
  settingsDefaults,
  shiftAnchor,
} from '../src/pages/finance/finance-leave-calendar-view.ts'

// İzin takvimi görünümü ve ayar formu (DOM-FIN-123; ON-183; K-420…K-422).

const entry = (overrides: Partial<LeaveCalendarEntry> = {}): LeaveCalendarEntry => ({
  id: 'q1',
  source: 'request',
  membershipId: 'm1',
  name: 'Selin Kaya',
  role: 'ogretmen',
  subjectIds: ['mat'],
  status: 'approved',
  category: 'leave',
  typeLabel: 'Yıllık ücretli izin',
  startDate: '2026-11-02',
  endDate: '2026-11-04',
  ...overrides,
})

test('DOM-FIN-123: ay görünümü ayı kapsayan tam haftalar, hafta görünümü pazartesi–pazar', () => {
  assert.deepEqual(calendarRange('month', '2026-11-18'), {
    startDate: '2026-10-26',
    endDate: '2026-12-06',
  })
  assert.deepEqual(calendarRange('week', '2026-11-18'), {
    startDate: '2026-11-16',
    endDate: '2026-11-22',
  })
  // Pazar günü kendi haftasındadır.
  assert.deepEqual(calendarRange('week', '2026-11-22').startDate, '2026-11-16')
  const weeks = calendarWeeks(calendarRange('month', '2026-11-18'))
  assert.equal(weeks.length, 6)
  assert.ok(weeks.every((week) => week.length === 7))
  assert.equal(weeks[0]?.[0], '2026-10-26')
  // Şubat 2027 pazartesi başlar, dört hafta.
  assert.equal(calendarWeeks(calendarRange('month', '2027-02-10')).length, 4)
  assert.equal(shiftAnchor('month', '2026-11-18', 1), '2026-12-01')
  assert.equal(shiftAnchor('month', '2026-01-31', -1), '2025-12-01')
  assert.equal(shiftAnchor('week', '2026-11-18', -1), '2026-11-09')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(isWeekend('2026-11-21'), true)
  assert.equal(isWeekend('2026-11-20'), false)
})

test('DOM-FIN-123: başlık ve gün metinleri Türkçe', () => {
  assert.equal(periodTitle('month', '2026-11-18'), 'Kasım 2026')
  assert.equal(periodTitle('week', '2026-11-18'), '16 Kasım – 22 Kasım 2026')
  assert.equal(dayLongText('2026-11-18'), '18 Kasım 2026 Çarşamba')
})

test('DOM-FIN-123: kayıt etiketi tür adı, "Raporlu" ya da ön büroda "İzinli"', () => {
  assert.equal(entryLabel(entry()), 'Yıllık ücretli izin')
  assert.equal(entryLabel(entry({ category: 'sick', typeLabel: null })), 'Raporlu')
  assert.equal(entryLabel(entry({ category: 'absent', typeLabel: null })), 'İzinli')
  assert.equal(
    entryText(entry({ status: 'pending' })),
    'Selin Kaya (Yıllık ücretli izin, Onay bekliyor)',
  )
  assert.equal(entryText(entry()), 'Selin Kaya (Yıllık ücretli izin)')
})

test('DOM-FIN-123: gün içeriği, sınav haftası, eşik günü ve dar ekran gün listesi', () => {
  const entries = [entry(), entry({ id: 'q2', startDate: '2026-11-06', endDate: '2026-11-06' })]
  assert.deepEqual(
    entriesOn(entries, '2026-11-03').map((item) => item.id),
    ['q1'],
  )
  const examWeeks = [{ label: 'Ara sınavlar', startDate: '2026-11-09', endDate: '2026-11-13' }]
  assert.equal(examWeekOn(examWeeks, '2026-11-10'), 'Ara sınavlar')
  assert.equal(examWeekOn(examWeeks, '2026-11-14'), null)
  assert.deepEqual(
    busyOn(
      [
        { day: '2026-11-03', subjectId: 'mat', count: 2 },
        { day: '2026-11-03', subjectId: 'x', count: 3 },
      ],
      [{ id: 'mat', name: 'Matematik' }],
      '2026-11-03',
    ),
    ['Matematik: 2 kişi', 'x: 3 kişi'],
  )
  const days = calendarWeeks(calendarRange('week', '2026-11-02'))
    .concat(calendarWeeks(calendarRange('week', '2026-11-09')))
    .flat()
  assert.deepEqual(agendaDays(days, { entries, examWeeks, holidays: [] }), [
    '2026-11-02',
    '2026-11-03',
    '2026-11-04',
    '2026-11-06',
    '2026-11-09',
    '2026-11-10',
    '2026-11-11',
    '2026-11-12',
    '2026-11-13',
  ])
})

test('DOM-FIN-123, DOM-FIN-163: kurum tatili okul takviminden gelir ve gün listesine girer (K-545)', () => {
  const holidays = [{ title: 'Ara tatil', startDate: '2026-11-09', endDate: '2026-11-13' }]
  assert.equal(holidayOn(holidays, '2026-11-10'), 'Ara tatil')
  assert.equal(holidayOn(holidays, '2026-11-14'), null)
  const days = calendarWeeks(calendarRange('week', '2026-11-09')).flat()
  assert.deepEqual(agendaDays(days, { entries: [], examWeeks: [], holidays }), [
    '2026-11-09',
    '2026-11-10',
    '2026-11-11',
    '2026-11-12',
    '2026-11-13',
  ])
})

test('DOM-FIN-123: talep formu seçilen yedeğin iznini uyarıya ekler', () => {
  const lesson = {
    lessonId: 'l1',
    startsAt: '2026-11-02T06:00:00.000Z',
    duration: 40,
    classId: 'c1',
    className: '9-A',
    subjectId: 'mat',
    title: 'Matematik',
    substituteTeacherId: null,
    substituteName: null,
    substituteWarnings: [],
    candidateWarnings: [
      { teacherId: 't2', warnings: ['on_leave'] },
      { teacherId: 't3', warnings: ['busy'] },
    ],
  } satisfies LeaveRequestLessonView
  const teachers = [
    { id: 't2', name: 'Murat Demir', subjectId: 'mat' },
    { id: 't3', name: 'Ayla Şen', subjectId: 'fen' },
  ]
  const exam = {
    code: 'exam_week' as const,
    label: 'Ara',
    startDate: '2026-11-02',
    endDate: '2026-11-06',
  }
  assert.deepEqual(formConflicts([exam], [lesson], {}, teachers), [exam])
  assert.deepEqual(formConflicts([], [lesson], { l1: 't3' }, teachers), [])
  const withSub = formConflicts([exam], [lesson], { l1: 't2' }, teachers)
  assert.equal(withSub.length, 2)
  assert.deepEqual(conflictTexts(withSub), [
    'İzin sınav haftasına denk geliyor: Ara (2 Kasım – 6 Kasım).',
    'Matematik dersinin (2 Kasım 09:00) yedeği Murat Demir o gün izinli.',
  ])
})

test('DOM-FIN-123: ayar formu eşiği ve sınav haftalarını core şemasıyla denetler', () => {
  const values = settingsDefaults({
    concurrentThreshold: 2,
    examWeeks: [{ label: 'Ara', startDate: '2026-11-09', endDate: '2026-11-13' }],
  })
  assert.deepEqual(values.concurrentThreshold, '2')
  assert.deepEqual(settingsBody({ ...values, concurrentThreshold: ' 3 ' }), {
    body: {
      concurrentThreshold: 3,
      examWeeks: [{ label: 'Ara', startDate: '2026-11-09', endDate: '2026-11-13' }],
    },
  })
  assert.deepEqual(settingsBody({ ...values, concurrentThreshold: 'iki' }), {
    issues: [{ field: 'concurrentThreshold', message: 'Eşiği tam sayı olarak girin.' }],
  })
  const low = settingsBody({ ...values, concurrentThreshold: '1' })
  assert.ok('issues' in low)
  assert.equal(low.issues[0]?.field, 'concurrentThreshold')
  const backwards = settingsBody({
    concurrentThreshold: '2',
    examWeeks: [{ label: ' Final ', startDate: '2027-01-15', endDate: '2027-01-11' }],
  })
  assert.ok('issues' in backwards)
  assert.equal(backwards.issues[0]?.field, 'examWeeks.0.endDate')
  const trimmed = settingsBody({
    concurrentThreshold: '2',
    examWeeks: [{ label: ' Final ', startDate: '2027-01-11', endDate: '2027-01-15' }],
  })
  assert.ok('body' in trimmed)
  assert.equal(trimmed.body.examWeeks?.[0]?.label, 'Final')
})
