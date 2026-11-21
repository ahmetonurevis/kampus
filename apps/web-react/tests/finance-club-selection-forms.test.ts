import assert from 'node:assert/strict'
import test from 'node:test'

import type { ClubSelectionPeriodDetail } from '@kampus/react-shared/use-finance-club-selection.ts'

import {
  choicesFromSlots,
  choicesText,
  currentAcademicYear,
  gradesText,
  periodCreateBody,
  periodDefaults,
  periodFormField,
  periodFormSchema,
  periodUpdateBody,
  phaseText,
  progressText,
  slotsFor,
  termText,
  toggled,
  waitlistStatusText,
} from '../src/pages/finance/finance-club-selection-forms.ts'

// Kulüp tercih dönemi görünümünün saf mantığı (DOM-FIN-150; ON-169; K-505…K-507).

const issuesOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((issue) => issue.path.join('.')) ?? []

const club = (id: string, name: string) => ({
  id,
  name,
  teacherName: 'Selin Kaya',
  capacity: 10,
  memberCount: 2,
  freeSeats: 8,
  meetingDay: 3,
  startTime: '15:30',
  endTime: '16:30',
})

const period: ClubSelectionPeriodDetail = {
  id: 'p1',
  name: 'Güz kulüp tercihi',
  academicYear: 2026,
  term: 1,
  openDate: '2026-10-05',
  closeDate: '2026-10-08',
  maxChoices: 2,
  seatsPerStudent: 1,
  gradeLevels: [5, 6],
  phase: 'open',
  clubCount: 2,
  preferenceCount: 1,
  drawnAt: null,
  confirmedAt: null,
  version: 3,
  seed: null,
  clubs: [club('c1', 'Robotik'), club('c2', 'Satranç')],
  eligibleStudentCount: 40,
  preferences: [],
  result: null,
}

test('DOM-FIN-150: dönem formu tarih sırasını, tercih ve atama sınırını denetler (K-505)', () => {
  const values = periodDefaults('2026-10-06', period)
  assert.equal(periodFormSchema.safeParse(values).success, true)
  assert.deepEqual(issuesOf(periodFormSchema.safeParse({ ...values, closeDate: '2026-10-01' })), [
    'closeDate',
  ])
  assert.deepEqual(issuesOf(periodFormSchema.safeParse({ ...values, maxChoices: '3' })), [
    'maxChoices',
  ])
  assert.deepEqual(
    issuesOf(periodFormSchema.safeParse({ ...values, seatsPerStudent: '3', maxChoices: '2' })),
    ['seatsPerStudent'],
  )
  assert.deepEqual(issuesOf(periodFormSchema.safeParse({ ...values, clubIds: [] })), ['clubIds'])
  assert.deepEqual(issuesOf(periodFormSchema.safeParse({ ...values, maxChoices: '0' })), [
    'maxChoices',
  ])
})

test('DOM-FIN-150: yeni dönem varsayılanları ve gövdesi; eğitim yılı Eylülde döner (K-505)', () => {
  const fresh = periodDefaults('2026-10-06')
  assert.equal(fresh.academicYear, '2026')
  assert.equal(fresh.seatsPerStudent, '1')
  assert.equal(currentAcademicYear('2027-03-01'), 2026)
  assert.equal(currentAcademicYear('2027-09-01'), 2027)
  assert.deepEqual(
    periodCreateBody({
      ...fresh,
      name: ' Bahar ',
      term: '2',
      closeDate: '2026-10-20',
      clubIds: ['c2', 'c1'],
      maxChoices: '2',
      gradeLevels: ['9', '5'],
    }),
    {
      name: 'Bahar',
      academicYear: 2026,
      term: 2,
      openDate: '2026-10-06',
      closeDate: '2026-10-20',
      clubIds: ['c2', 'c1'],
      maxChoices: 2,
      seatsPerStudent: 1,
      gradeLevels: [5, 9],
    },
  )
  assert.equal(periodCreateBody({ ...fresh, term: '' }).term, null)
})

test('DOM-FIN-150: düzenleme yalnız değişeni gönderir; değişiklik yoksa null (K-505)', () => {
  const values = periodDefaults('2026-10-06', period)
  assert.equal(periodUpdateBody(values, period), null)
  assert.deepEqual(periodUpdateBody({ ...values, name: 'Yeni', closeDate: '2026-10-10' }, period), {
    name: 'Yeni',
    closeDate: '2026-10-10',
  })
  assert.deepEqual(periodUpdateBody({ ...values, clubIds: ['c2', 'c1'], term: '' }, period), {
    term: null,
    clubIds: ['c2', 'c1'],
  })
  assert.deepEqual(
    periodUpdateBody(
      { ...values, gradeLevels: [], maxChoices: '1', seatsPerStudent: '1', academicYear: '2027' },
      period,
    ),
    { academicYear: 2027, maxChoices: 1, gradeLevels: [] },
  )
  assert.deepEqual(periodUpdateBody({ ...values, openDate: '2026-10-04' }, period), {
    openDate: '2026-10-04',
  })
  assert.deepEqual(periodUpdateBody({ ...values, seatsPerStudent: '2' }, period), {
    seatsPerStudent: 2,
  })
  assert.equal(periodFormField('clubIds'), 'clubIds')
  assert.equal(periodFormField('studentId'), null)
})

test('DOM-FIN-150: adına tercih taslağı boşları ve yinelenenleri atlar (K-505)', () => {
  assert.deepEqual(slotsFor(3, ['c2']), ['c2', '', ''])
  assert.deepEqual(choicesFromSlots(['c2', '', 'c2', 'c1']), ['c2', 'c1'])
  assert.deepEqual(choicesFromSlots(['', '']), [])
  assert.deepEqual(toggled(['a'], 'b', true), ['a', 'b'])
  assert.deepEqual(toggled(['a', 'b'], 'a', true), ['a', 'b'])
  assert.deepEqual(toggled(['a', 'b'], 'a', false), ['b'])
})

test('DOM-FIN-150: liste metinleri (K-505, K-507)', () => {
  const names = new Map([
    ['c1', 'Robotik'],
    ['c2', 'Satranç'],
  ])
  assert.equal(choicesText(['c2', 'c1', 'x'], names), '1. Satranç · 2. Robotik · 3. —')
  assert.equal(choicesText([], names), 'Tercih yok')
  assert.equal(termText(period), '2026–2027 · 1. dönem')
  assert.equal(gradesText([]), 'Bütün sınıflar')
  assert.equal(gradesText([5, 6]), '5., 6. sınıf')
  assert.equal(progressText(12, 40), '12 / 40 öğrenci tercih yaptı')
  assert.equal(phaseText('drawn'), 'Kura çekildi')
  assert.equal(waitlistStatusText('joined'), 'Üye oldu')
})
