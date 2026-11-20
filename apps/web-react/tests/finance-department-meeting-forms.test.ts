import assert from 'node:assert/strict'
import test from 'node:test'

import {
  attendanceText,
  decisionBody,
  decisionCountText,
  decisionFormField,
  decisionFormFrom,
  decisionFormSchema,
  emptyDecisionForm,
  emptyMeetingForm,
  followUpFormSchema,
  meetingBody,
  meetingFormField,
  meetingFormFrom,
  meetingFormSchema,
  meetingStaffOptions,
} from '../src/pages/finance/finance-department-meeting-forms.ts'
import { AGENDA_A, AGENDA_B, meetingFixture } from './finance-department-meeting-fixture.ts'

// Zümre tutanağı formları (DOM-FIN-132; ON-217; K-452, K-453).

const issues = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.success ? [] : (result.error?.issues ?? []).map((issue) => issue.path.join('.'))

test('DOM-FIN-132: K-452 kişi seçenekleri etkin öğretmen ve yönetici; tutanaktaki ayrılmış kalır', () => {
  const options = meetingStaffOptions(
    [
      { membershipId: 'z', name: 'Zeynep Arslan', role: 'ogretmen', active: false },
      { membershipId: 'a', name: 'Ali Kurt', role: 'onburo', active: true },
      { membershipId: 'b', name: 'Burak Er', role: 'yonetici', active: true },
      { membershipId: 'c', name: 'Cem Tan', role: 'ogretmen', active: false },
      { membershipId: 'ç', name: 'Çağla Su', role: 'ogretmen', active: true },
    ],
    new Set(['z']),
  )
  assert.deepEqual(
    options.map((option) => option.name),
    ['Burak Er', 'Çağla Su', 'Zeynep Arslan'],
  )
})

test('DOM-FIN-132: tutanak formu gövdeye çevrilir; yeni madde kimliksiz, listede olmayan dışarıda', () => {
  const values = {
    ...emptyMeetingForm('2026-09-10'),
    subjectId: 'math',
    location: 'Öğretmenler odası',
    chairMembershipId: 'm-chair',
    agenda: [
      { id: AGENDA_A, title: 'Açılış', discussion: '' },
      { id: '', title: 'Planlar', discussion: 'Görüşüldü' },
    ],
    attendance: { 'm-chair': 'attended' as const, 'm-2': 'excused' as const, 'm-3': '' as const },
  }
  assert.deepEqual(meetingBody(values), {
    subjectId: 'math',
    kind: 'term_start',
    meetingDate: '2026-09-10',
    location: 'Öğretmenler odası',
    chairMembershipId: 'm-chair',
    agenda: [
      { id: AGENDA_A, title: 'Açılış', discussion: '' },
      { id: null, title: 'Planlar', discussion: 'Görüşüldü' },
    ],
    attendees: [
      { membershipId: 'm-2', status: 'excused' },
      { membershipId: 'm-chair', status: 'attended' },
    ],
  })
  assert.equal(meetingFormSchema.safeParse(values).success, true)

  const empty = emptyMeetingForm('2026-09-10')
  assert.deepEqual(issues(meetingFormSchema.safeParse(empty)), [
    'subjectId',
    'location',
    'chairMembershipId',
    'agenda.0.title',
    'attendance',
  ])
  assert.deepEqual(
    issues(meetingFormSchema.safeParse({ ...values, attendance: { 'm-chair': 'absent' } })),
    ['chairMembershipId'],
  )
})

test('DOM-FIN-132: tutanak formu kayıttan doldurulur; hata yolu alana düşer', () => {
  const meeting = meetingFixture({ status: 'draft' })
  const values = meetingFormFrom(meeting)
  assert.deepEqual(values.agenda, [
    { id: AGENDA_A, title: 'Açılış ve yoklama', discussion: '' },
    {
      id: AGENDA_B,
      title: 'Yıllık planların incelenmesi',
      discussion: 'Planlar kazanımlara göre gözden geçirildi.',
    },
  ])
  assert.deepEqual(values.attendance, {
    'm-2': 'attended',
    'm-chair': 'attended',
    'm-3': 'excused',
  })
  assert.equal(meetingFormField(['location']), 'location')
  assert.equal(meetingFormField(['agenda', 2, 'title']), 'agenda.2.title')
  assert.equal(meetingFormField(['agenda', 1, 'id']), 'agenda')
  assert.equal(meetingFormField(['agenda']), 'agenda')
  assert.equal(meetingFormField(['attendees', 1, 'membershipId']), 'attendance')
  assert.equal(meetingFormField(['subject']), null)
  assert.equal(meetingFormField([]), null)
})

test('DOM-FIN-132: K-452 karar formu; boş termin null, hata alana', () => {
  const values = {
    ...emptyDecisionForm(AGENDA_B),
    text: 'Takvim hazırlanacak.',
    responsibleMembershipId: 'm-2',
  }
  assert.deepEqual(decisionBody(values), {
    agendaItemId: AGENDA_B,
    text: 'Takvim hazırlanacak.',
    responsibleMembershipId: 'm-2',
    dueDate: null,
  })
  assert.equal(decisionFormSchema.safeParse(values).success, true)
  assert.deepEqual(issues(decisionFormSchema.safeParse(emptyDecisionForm(''))), [
    'agendaItemId',
    'text',
    'responsibleMembershipId',
  ])
  const decision = meetingFixture().decisions[0]
  assert.ok(decision)
  assert.deepEqual(decisionFormFrom(decision), {
    agendaItemId: AGENDA_B,
    text: 'Ortak yazılı sınav takvimi hazırlanacak.',
    responsibleMembershipId: 'm-2',
    dueDate: '2026-09-30',
  })
  assert.equal(decisionFormField('dueDate'), 'dueDate')
  assert.equal(decisionFormField('meetingId'), null)
})

test('DOM-FIN-132: K-453 iptal takibi not ister', () => {
  assert.deepEqual(
    issues(followUpFormSchema.safeParse({ status: 'cancelled', followUpNote: '' })),
    ['followUpNote'],
  )
  assert.equal(
    followUpFormSchema.safeParse({ status: 'completed', followUpNote: '' }).success,
    true,
  )
  assert.equal(
    followUpFormSchema.safeParse({ status: 'cancelled', followUpNote: 'Gerek kalmadı' }).success,
    true,
  )
})

test('DOM-FIN-132: liste sütun metinleri', () => {
  assert.equal(attendanceText({ attendedCount: 4, attendeeCount: 6 }), '4 / 6 katıldı')
  assert.equal(decisionCountText({ openDecisionCount: 0, decisionCount: 0 }), '—')
  assert.equal(decisionCountText({ openDecisionCount: 2, decisionCount: 5 }), '2 açık / 5')
})
