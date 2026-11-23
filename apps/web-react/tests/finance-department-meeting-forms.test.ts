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
  emptyTemplateForm,
  suggestedItems,
  templateBody,
  templateFormField,
  templateFormFrom,
  templateFormSchema,
  templateUpdateBody,
  withTemplateAgenda,
} from '../src/pages/finance/finance-department-meeting-forms.ts'
import { AGENDA_A, AGENDA_B, meetingFixture } from './finance-department-meeting-fixture.ts'

// Kurul ve zümre tutanağı formları (DOM-FIN-132, DOM-FIN-135; ON-217, ON-218; K-452, K-453,
// K-460, K-461).

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
    board: 'department',
    subjectId: 'math',
    classId: null,
    agendaTemplateId: null,
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

test('DOM-FIN-135: K-460 kurul türü hedefi belirler; türe ait olmayan seçim gönderilmez', () => {
  const base = {
    ...emptyMeetingForm('2026-09-10', 'teachers'),
    subjectId: 'math',
    classId: 'c-9a',
    location: 'Konferans salonu',
    chairMembershipId: 'm-chair',
    agenda: [{ id: '', title: 'Açılış', discussion: '' }],
    attendance: { 'm-chair': 'attended' as const },
  }
  const board = meetingBody(base)
  assert.equal(board.board, 'teachers')
  assert.equal(board.subjectId, null)
  assert.equal(board.classId, null)
  assert.equal(meetingFormSchema.safeParse(base).success, true)

  const section = meetingBody({ ...base, board: 'class' })
  assert.equal(section.classId, 'c-9a')
  assert.equal(section.subjectId, null)
  assert.deepEqual(issues(meetingFormSchema.safeParse({ ...base, board: 'class', classId: '' })), [
    'classId',
  ])
  assert.deepEqual(
    issues(meetingFormSchema.safeParse({ ...base, board: 'department', subjectId: '' })),
    ['subjectId'],
  )
  assert.equal(meetingFormField(['classId']), 'classId')
  assert.equal(meetingFormField(['board']), 'board')
  assert.equal(meetingFormField(['agendaTemplateId']), 'agendaTemplateId')

  const values = meetingFormFrom(
    meetingFixture({
      board: 'class',
      subjectId: null,
      subjectName: null,
      classId: 'c-9a',
      className: '9-A',
      agendaTemplateId: '22222222-2222-4222-8222-222222222222',
    }),
  )
  assert.equal(values.board, 'class')
  assert.equal(values.subjectId, '')
  assert.equal(values.classId, 'c-9a')
  assert.equal(values.agendaTemplateId, '22222222-2222-4222-8222-222222222222')
})

test('DOM-FIN-135: K-461 şablondan gündem kopyalanır, şablon iz olarak seçilir', () => {
  const values = {
    ...emptyMeetingForm('2026-09-10', 'teachers'),
    agenda: [{ id: AGENDA_A, title: 'Eski madde', discussion: 'Not' }],
  }
  const filled = withTemplateAgenda(values, {
    id: '33333333-3333-4333-8333-333333333333',
    items: [{ title: 'Açılış ve yoklama' }, { title: 'Çalışma takvimi' }],
  })
  assert.equal(filled.agendaTemplateId, '33333333-3333-4333-8333-333333333333')
  assert.deepEqual(filled.agenda, [
    { id: '', title: 'Açılış ve yoklama', discussion: '' },
    { id: '', title: 'Çalışma takvimi', discussion: '' },
  ])
  assert.equal(meetingBody(filled).agendaTemplateId, '33333333-3333-4333-8333-333333333333')
  assert.equal(filled.board, 'teachers')
})

test('DOM-FIN-135: K-461 şablon formu önerilen gündemle açılır; kurul türü düzeltmede gitmez', () => {
  const empty = emptyTemplateForm('class')
  assert.deepEqual(empty.items, suggestedItems('class'))
  assert.ok(empty.items.length > 0)
  assert.deepEqual(issues(templateFormSchema.safeParse(empty)), ['name'])
  const values = { ...empty, name: 'Şube kurulu', items: [{ title: 'Açılış' }] }
  assert.equal(templateFormSchema.safeParse(values).success, true)
  assert.deepEqual(templateBody(values), {
    board: 'class',
    name: 'Şube kurulu',
    items: [{ title: 'Açılış' }],
  })
  assert.deepEqual(templateUpdateBody(values), {
    name: 'Şube kurulu',
    items: [{ title: 'Açılış' }],
  })
  assert.deepEqual(issues(templateFormSchema.safeParse({ ...values, items: [] })), ['items'])
  assert.deepEqual(issues(templateFormSchema.safeParse({ ...values, items: [{ title: 'a' }] })), [
    'items.0.title',
  ])
  assert.equal(templateFormField(['items', 3, 'title']), 'items.3.title')
  assert.equal(templateFormField(['items']), 'items')
  assert.equal(templateFormField(['name']), 'name')
  assert.equal(templateFormField(['board']), 'board')
  assert.equal(templateFormField(['other']), null)

  const stored = templateFormFrom({
    id: '33333333-3333-4333-8333-333333333333',
    board: 'teachers',
    name: 'Dönem başı',
    items: [{ title: 'Açılış' }],
    archivedAt: null,
    meetingCount: 2,
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
    version: 1,
  })
  assert.deepEqual(stored, { board: 'teachers', name: 'Dönem başı', items: [{ title: 'Açılış' }] })
})
