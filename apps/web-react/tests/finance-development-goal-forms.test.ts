import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  DevelopmentGoalDetail,
  ObservationDebrief,
} from '@kampus/react-shared/use-finance-development-goals.ts'
import {
  debriefBody,
  debriefFormSchema,
  debriefValues,
  emptyDebrief,
  emptyFollowUp,
  emptyGoal,
  followUpBody,
  followUpFormSchema,
  goalCreateBody,
  goalFormSchema,
  goalTone,
  goalUpdateBody,
  goalValues,
  nextStatuses,
  toggleParticipant,
} from '../src/pages/finance/finance-development-goal-forms.ts'

// Gözlem sonrası görüşme ve gelişim hedefi formları (DOM-FIN-133; ON-209; K-454, K-455).

const debrief: ObservationDebrief = {
  id: 'd1',
  observationId: 'o1',
  observedDate: '2026-11-10',
  observationStatus: 'completed',
  teacherMembershipId: 'm-selin',
  teacherName: 'Selin Kaya',
  observerMembershipId: 'm-mudur',
  observerName: 'Müdür',
  debriefDate: '2026-11-12',
  participants: [
    { membershipId: 'm-selin', name: 'Selin Kaya', role: 'ogretmen', active: true },
    { membershipId: 'm-mudur', name: 'Müdür', role: 'yonetici', active: true },
  ],
  strengths: 'Sınıf yönetimi',
  developmentAreas: null,
  teacherComment: null,
  status: 'draft',
  finalizedAt: null,
  createdAt: '2026-11-12T09:00:00.000Z',
  updatedAt: '2026-11-12T09:00:00.000Z',
  version: 2,
}

const goal: DevelopmentGoalDetail = {
  id: 'g1',
  teacherMembershipId: 'm-selin',
  teacherName: 'Selin Kaya',
  source: 'observation_debrief',
  debriefId: 'd1',
  observationId: 'o1',
  observedDate: '2026-11-10',
  observerMembershipId: 'm-mudur',
  performancePeriodId: 'p1',
  performancePeriodName: '2026 güz',
  title: 'Çıkış kartı',
  successCriterion: 'Üç derste',
  followUpDate: '2026-12-01',
  status: 'open',
  active: true,
  overdue: false,
  overdueDays: 0,
  closedAt: null,
  createdAt: '2026-11-12T09:00:00.000Z',
  updatedAt: '2026-11-12T09:00:00.000Z',
  version: 1,
  notes: [],
}

test('DOM-FIN-133 K-454: yeni görüşmede öğretmen ve gözlemci seçili; öğretmen çıkarılamaz', () => {
  const values = emptyDebrief('2026-11-19', {
    teacherMembershipId: 'm-selin',
    observerMembershipId: 'm-mudur',
  })
  assert.deepEqual(values.participantMembershipIds, ['m-selin', 'm-mudur'])
  assert.equal(values.debriefDate, '2026-11-19')
  assert.deepEqual(toggleParticipant(['m-selin', 'm-mudur'], 'm-selin', 'm-selin'), [
    'm-selin',
    'm-mudur',
  ])
  assert.deepEqual(toggleParticipant(['m-selin', 'm-mudur'], 'm-mudur', 'm-selin'), ['m-selin'])
  assert.deepEqual(toggleParticipant(['m-selin'], 'm-zumre', 'm-selin'), ['m-selin', 'm-zumre'])
  assert.equal(
    debriefFormSchema.safeParse({ ...values, participantMembershipIds: [] }).success,
    false,
  )
})

test('DOM-FIN-133 K-454: görüşme değerleri ve gövdesi; boş metin sunucuda null olur', () => {
  const values = debriefValues(debrief)
  assert.equal(values.developmentAreas, '')
  assert.deepEqual(debriefBody(values), {
    debriefDate: '2026-11-12',
    participantMembershipIds: ['m-selin', 'm-mudur'],
    strengths: 'Sınıf yönetimi',
    developmentAreas: '',
    teacherComment: '',
  })
})

test('DOM-FIN-133 K-455: hedef gövdesi kaynağa göre öğretmen ya da görüşme taşır', () => {
  const values = {
    ...emptyGoal('2026-12-01'),
    teacherMembershipId: 'm-selin',
    title: ' Hedef ',
    successCriterion: 'Ölçüt',
  }
  assert.deepEqual(goalCreateBody(values, null), {
    teacherMembershipId: 'm-selin',
    title: 'Hedef',
    successCriterion: 'Ölçüt',
    followUpDate: '2026-12-01',
  })
  assert.deepEqual(goalCreateBody({ ...values, performancePeriodId: 'p1' }, 'd1'), {
    debriefId: 'd1',
    title: 'Hedef',
    successCriterion: 'Ölçüt',
    followUpDate: '2026-12-01',
    performancePeriodId: 'p1',
  })
  assert.equal(goalFormSchema.safeParse({ ...values, title: 'x' }).success, false)
})

test('DOM-FIN-133 K-455: hedef düzeltmesi yalnız değişen alanları gönderir; boş dönem bağı kaldırır', () => {
  const values = goalValues(goal)
  assert.equal(goalUpdateBody(goal, values), null)
  assert.deepEqual(goalUpdateBody(goal, { ...values, performancePeriodId: '' }), {
    performancePeriodId: null,
  })
  assert.deepEqual(goalUpdateBody(goal, { ...values, followUpDate: '2026-12-10', title: 'Yeni' }), {
    title: 'Yeni',
    followUpDate: '2026-12-10',
  })
})

test('DOM-FIN-133 K-455: takip notu; durum yalnız ileri, boş seçimler gönderilmez', () => {
  assert.deepEqual(nextStatuses('open'), ['in_progress', 'achieved', 'dropped'])
  assert.deepEqual(nextStatuses('in_progress'), ['achieved', 'dropped'])
  assert.deepEqual(nextStatuses('achieved'), [])
  assert.deepEqual(followUpBody({ ...emptyFollowUp(), note: ' Görüşüldü ' }), {
    note: 'Görüşüldü',
  })
  assert.deepEqual(
    followUpBody({ note: 'Başladı', status: 'in_progress', nextFollowUpDate: '2026-12-05' }),
    { note: 'Başladı', status: 'in_progress', nextFollowUpDate: '2026-12-05' },
  )
  assert.equal(followUpFormSchema.safeParse(emptyFollowUp()).success, false)
})

test('DOM-FIN-133 K-455: gecikmiş hedef kırmızı, ulaşıldı yeşil, bırakıldı gri', () => {
  assert.equal(goalTone({ status: 'open', overdue: true }), 'red')
  assert.equal(goalTone({ status: 'achieved', overdue: false }), 'green')
  assert.equal(goalTone({ status: 'dropped', overdue: false }), 'gray')
  assert.equal(goalTone({ status: 'in_progress', overdue: false }), 'amber')
})
