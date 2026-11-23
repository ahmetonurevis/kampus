import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  LessonHourSuggestionItem,
  LessonHourSuggestions,
  LessonHourSuggestionTeacher,
} from '@kampus/react-shared/use-finance-lesson-hour-suggestions.ts'

import {
  bulkTransferBody,
  canCorrect,
  canTransfer,
  dayHeading,
  differenceText,
  lessonItemText,
  SUGGESTION_PARAM_DEFAULTS,
  suggestionParams,
  suggestionRow,
  transferBody,
  transferDefaults,
  transferFormSchema,
  transferNotice,
  weekText,
} from '../src/pages/finance/finance-lesson-suggestion-forms.ts'

// Programdan ek ders önerisi ekranı (DOM-FIN-165; ON-195; K-550…K-552).

const totals = {
  countedHours: 20,
  ownHours: 19,
  substituteHours: 1,
  makeupHours: 0,
  loadHours: 15,
  extraHours: 5,
  overCapHours: 0,
  cancelledHours: 1,
  holidayHours: 0,
  leaveHours: 0,
  substitutedOutHours: 0,
  upcomingHours: 0,
  attendanceMissingLessons: 0,
}

const teacher = (
  overrides: Partial<LessonHourSuggestionTeacher> = {},
): LessonHourSuggestionTeacher => ({
  membershipId: 'm-selin',
  staffName: 'Selin Kaya',
  role: 'ogretmen',
  staffActive: true,
  payBasis: 'monthly',
  applicable: true,
  suggestedHours: 5,
  currentHours: null,
  currentEntryId: null,
  difference: -5,
  totals,
  weeks: [],
  warnings: [],
  lastTransfer: null,
  ...overrides,
})

const suggestions = (overrides: Partial<LessonHourSuggestions> = {}): LessonHourSuggestions => ({
  month: '2026-09',
  weeklyLoad: 15,
  weeklyCap: 30,
  rangeFrom: '2026-08-31',
  rangeTo: '2026-10-04',
  monthComplete: true,
  attendanceKnown: true,
  sheetStatus: 'draft',
  payrollLocked: false,
  transferable: true,
  teachers: [],
  unlinked: [],
  totals: { teacherCount: 0, suggestedHours: 0, currentHours: 0 },
  ...overrides,
})

test('DOM-FIN-165 K-551: parametreler tam sayı, üst sınır maaş karşılığından az olamaz', () => {
  assert.deepEqual(suggestionParams(SUGGESTION_PARAM_DEFAULTS), {
    params: { weeklyLoad: 15, weeklyCap: 30 },
    errors: {},
  })
  assert.deepEqual(suggestionParams({ weeklyLoad: ' 18 ', weeklyCap: '24' }).params, {
    weeklyLoad: 18,
    weeklyCap: 24,
  })
  assert.deepEqual(suggestionParams({ weeklyLoad: '', weeklyCap: '2,5' }), {
    params: null,
    errors: { weeklyLoad: 'Tam sayı girin.', weeklyCap: 'Tam sayı girin.' },
  })
  const below = suggestionParams({ weeklyLoad: '20', weeklyCap: '10' })
  assert.equal(below.params, null)
  assert.match(below.errors.weeklyCap ?? '', /maaş karşılığı/)
  assert.match(
    suggestionParams({ weeklyLoad: '41', weeklyCap: '50' }).errors.weeklyLoad ?? '',
    /40/,
  )
})

test('DOM-FIN-165: tablo satırı öneri, elle giriş, fark ve uyarı metni', () => {
  assert.deepEqual(suggestionRow(teacher({ warnings: ['no_pay_rate', 'over_cap'] })), {
    id: 'm-selin',
    staff: 'Selin Kaya',
    payBasis: 'Aylık ücretli',
    counted: '20 saat',
    load: '15 saat',
    suggested: '5 saat',
    current: 'Girilmedi',
    difference: '−5',
    warnings:
      'Ana ücret tanımı yok; aylık ücretli sayıldı; Haftalık üst sınırı aşan saat sayılmadı',
  })
  const hourly = suggestionRow(
    teacher({
      staffActive: false,
      payBasis: 'hourly',
      applicable: false,
      suggestedHours: null,
      currentHours: 4,
      difference: null,
    }),
  )
  assert.deepEqual(
    [hourly.staff, hourly.load, hourly.suggested, hourly.current, hourly.difference],
    ['Selin Kaya (pasif)', '—', 'Öneri yok', '4 saat', '—'],
  )
  assert.deepEqual([differenceText(2), differenceText(0), differenceText(-1)], ['+2', '0', '−1'])
})

test('DOM-FIN-165 K-552 K-410: aktarım yalnız açık ayda, öneri varsa ve elle giriş farklıysa', () => {
  const open = suggestions()
  assert.equal(canTransfer(open, teacher()), true)
  assert.equal(canTransfer(open, teacher({ currentHours: 5 })), false)
  assert.equal(canTransfer(open, teacher({ suggestedHours: 0 })), false)
  assert.equal(canTransfer(open, teacher({ suggestedHours: null })), false)
  assert.equal(canTransfer(suggestions({ transferable: false }), teacher()), false)
  assert.equal(canCorrect(open, teacher({ suggestedHours: 0 })), true)
  assert.equal(canCorrect(open, teacher({ suggestedHours: null })), false)
  assert.equal(canCorrect(suggestions({ transferable: false }), teacher()), false)
  assert.equal(transferNotice(open), null)
  assert.match(
    transferNotice(suggestions({ transferable: false, payrollLocked: true })) ?? '',
    /bordro dönemi kilitli/,
  )
  assert.match(
    transferNotice(suggestions({ transferable: false, sheetStatus: 'approved' })) ?? '',
    /müdür onaylı/,
  )
  assert.match(transferNotice(suggestions({ transferable: false })) ?? '', /Gelecek ay/)
})

test('DOM-FIN-165 K-552: toplu ve tek aktarım gövdesi', () => {
  const data = suggestions({
    weeklyLoad: 18,
    teachers: [
      teacher(),
      teacher({ membershipId: 'm-ece', currentHours: 5 }),
      teacher({ membershipId: 'm-murat', suggestedHours: null, applicable: false }),
      teacher({ membershipId: 'm-ayla', suggestedHours: 2, currentHours: 6 }),
    ],
  })
  assert.deepEqual(bulkTransferBody(data), {
    weeklyLoad: 18,
    weeklyCap: 30,
    items: [
      { membershipId: 'm-selin', suggestedHours: 5, hours: 5, reason: null },
      { membershipId: 'm-ayla', suggestedHours: 2, hours: 2, reason: null },
    ],
  })
  assert.deepEqual(transferBody(data, teacher()).items, [
    { membershipId: 'm-selin', suggestedHours: 5, hours: 5, reason: null },
  ])
  assert.deepEqual(
    transferBody(data, teacher(), { hours: ' 6 ', reason: '  Gezi dersi eklendi ' }).items,
    [{ membershipId: 'm-selin', suggestedHours: 5, hours: 6, reason: 'Gezi dersi eklendi' }],
  )
  assert.deepEqual(transferDefaults(teacher()), { hours: '5', reason: '' })
})

test('DOM-FIN-165 K-552: düzeltme formu saat 1–400, farklı saatte gerekçe 5–500', () => {
  const schema = transferFormSchema(5)
  assert.equal(schema.safeParse({ hours: '5', reason: '' }).success, true)
  assert.equal(schema.safeParse({ hours: '6', reason: 'Gezi dersi eklendi' }).success, true)
  const messages = (values: { hours: string; reason: string }) => {
    const parsed = schema.safeParse(values)
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)
  }
  assert.deepEqual(messages({ hours: '6', reason: '' }), [
    'Öneriden farklı saat için gerekçe yazın.',
  ])
  assert.deepEqual(messages({ hours: '6', reason: 'kısa' }), [
    'Gerekçe en az 5 karakter olmalıdır.',
  ])
  assert.deepEqual(messages({ hours: '5', reason: 'x'.repeat(501) }), [
    'Gerekçe en fazla 500 karakter olabilir.',
  ])
  for (const hours of ['0', '401', '2.5', ''])
    assert.deepEqual(messages({ hours, reason: 'Gezi dersi eklendi' }), [
      'Saati 1 ile 400 arasında tam sayı girin.',
    ])
})

test('DOM-FIN-165 K-550: döküm satırı ders, sınıf, durum ve neden', () => {
  const item = (overrides: Partial<LessonHourSuggestionItem> = {}): LessonHourSuggestionItem => ({
    lessonId: 'l1',
    day: '2026-09-14',
    startsAt: '2026-09-14T06:00:00.000Z',
    classId: 'c1',
    subjectId: 'mat',
    title: 'Matematik',
    hours: 1,
    status: 'counted',
    kind: 'own',
    loadHours: 0,
    extraHours: 1,
    overCapHours: 0,
    attendanceMissing: false,
    makeupForLessonId: null,
    holidayTitle: null,
    className: '9-A',
    ...overrides,
  })
  assert.deepEqual(lessonItemText(item()), {
    main: '09:00 · Matematik · 9-A · 1 ders saati',
    status: 'Sayıldı · 1 ek ders',
  })
  assert.equal(
    lessonItemText(
      item({ kind: 'substitute', loadHours: 1, extraHours: 0, attendanceMissing: true }),
    ).status,
    'Sayıldı · Yedek ders · 1 maaş karşılığı · Sınıfın yoklaması alınmamış',
  )
  assert.equal(
    lessonItemText(item({ status: 'holiday', holidayTitle: 'Okul kuruluş günü', extraHours: 0 }))
      .status,
    'Tatil; sayılmadı · Okul kuruluş günü',
  )
  assert.equal(
    lessonItemText(item({ kind: 'makeup', loadHours: 1, extraHours: 1, overCapHours: 1, hours: 3 }))
      .status,
    'Sayıldı · Telafi dersi · 1 maaş karşılığı, 1 ek ders, 1 üst sınır üstü',
  )
  assert.equal(
    lessonItemText(item({ title: null, className: null, classId: '' })).main,
    '09:00 · Ders · 1 ders saati',
  )
  assert.equal(
    lessonItemText(item({ className: null })).main,
    '09:00 · Matematik · c1 · 1 ders saati',
  )
  assert.equal(dayHeading('2026-09-14'), '14 Eylül Pazartesi')
  assert.equal(
    weekText({
      startDate: '2026-09-07',
      endDate: '2026-09-13',
      monthFrom: '2026-09-07',
      monthTo: '2026-09-13',
      countedHours: 22,
      loadHours: 15,
      extraHours: 5,
      overCapHours: 2,
      extraInMonth: 5,
    }),
    '7 Eyl – 13 Eyl: 22 saat · 15 maaş karşılığı · 5 ek ders (bu aya 5) · 2 üst sınır üstü',
  )
})
