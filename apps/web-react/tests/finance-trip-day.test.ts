import assert from 'node:assert/strict'
import test from 'node:test'

import type { TripDay, TripDayCard } from '@kampus/react-shared/use-finance-trip-day.ts'

import {
  tripDayCardDocument,
  tripDayCardFilename,
  tripDayCardReference,
  tripDayHealthText,
} from '../src/lib/pdf/templates/finance-trip-day-card.ts'
import {
  assignBody,
  assignOptions,
  checkSummary,
  checkTimeText,
  dayNotice,
  groupChanges,
  groupDefaults,
  groupFormSchema,
  groupLine,
  missingNames,
  nextCheckpoint,
  pendingPresentBody,
  UNASSIGN,
} from '../src/pages/finance/finance-trip-day-forms.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

// Gezi günü görünümü ve acil kart PDF'i (DOM-FIN-154; ON-157; K-517…K-519).

const NOW = new Date('2026-10-20T07:00:00.000Z')
type Group = TripDay['groups'][number]
type Check = Group['checks'][number]

const check = (overrides: Partial<Check> = {}): Check => ({
  id: 'c1',
  sequence: 1,
  checkpoint: 'Okuldan çıkış',
  status: 'open',
  startedAt: '2026-10-20T05:00:00.000Z',
  startedByName: 'Selin Kaya',
  closedAt: null,
  closedByName: null,
  counts: { total: 3, present: 1, absent: 1, pending: 1 },
  missingReason: null,
  canOperate: true,
  version: 1,
  roster: [
    {
      studentId: 's1',
      studentName: 'Ali Kurt',
      className: '9-A',
      status: 'present',
      markedAt: null,
    },
    {
      studentId: 's2',
      studentName: 'Deniz Yılmaz',
      className: '9-A',
      status: 'pending',
      markedAt: null,
    },
    {
      studentId: 's3',
      studentName: 'Ece Yılmaz',
      className: '9-B',
      status: 'absent',
      markedAt: null,
    },
  ],
  ...overrides,
})

const group = (overrides: Partial<Group> = {}): Group => ({
  id: 'g1',
  name: '1. otobüs',
  vehiclePlate: '06ABC123',
  leaderMembershipId: 'm1',
  leaderName: 'Selin Kaya',
  position: 0,
  students: [
    { studentId: 's1', studentName: 'Ali Kurt', className: '9-A' },
    { studentId: 's2', studentName: 'Deniz Yılmaz', className: '9-A' },
  ],
  checks: [],
  openCheckId: null,
  canEdit: true,
  canStartCheck: true,
  canOperate: true,
  canReadCard: true,
  canReadFullCard: false,
  version: 2,
  ...overrides,
})

test('DOM-FIN-154: grup formu önerisi ve yalnız değişen alanlar (K-517)', () => {
  const day = {
    transportPlate: '06ABC123',
    staff: [{ membershipId: 'm1', name: 'Selin Kaya', role: 'lead' as const }],
    groups: [],
  }
  assert.deepEqual(groupDefaults(day), {
    name: '1. grup',
    vehiclePlate: '06 ABC 123',
    leaderMembershipId: 'm1',
  })
  assert.equal(groupDefaults({ ...day, groups: [group()] }).vehiclePlate, '')
  assert.equal(groupDefaults(day, group()).vehiclePlate, '06 ABC 123')
  const parsed = groupFormSchema.parse({
    name: '1. otobüs',
    vehiclePlate: '',
    leaderMembershipId: 'm1',
  })
  assert.deepEqual(groupChanges(group(), parsed), { vehiclePlate: null })
  assert.equal(
    groupChanges(
      group(),
      groupFormSchema.parse({
        name: '1. otobüs',
        vehiclePlate: '06 abc 123',
        leaderMembershipId: 'm1',
      }),
    ),
    null,
  )
})

test('DOM-FIN-154: kontrol noktası önerisi, "kalanlar var" gövdesi ve özetler (K-517)', () => {
  assert.equal(nextCheckpoint(group()), 'Okuldan çıkış')
  assert.equal(nextCheckpoint(group({ checks: [check(), check(), check()] })), 'Okula varış')
  assert.equal(nextCheckpoint(group({ checks: [check(), check(), check(), check()] })), '')
  assert.deepEqual(pendingPresentBody(check()), { marks: [{ studentId: 's2', status: 'present' }] })
  assert.equal(pendingPresentBody(check({ roster: [check().roster[0]!] })), null)
  assert.equal(checkSummary(check()), '1. Okuldan çıkış · 1 var · 1 yok · 1 işaretlenmedi')
  assert.equal(checkTimeText(check()), 'Başladı 08:00')
  assert.equal(
    checkTimeText(check({ status: 'incomplete', closedAt: '2026-10-20T05:20:00.000Z' })),
    'Eksikle devam · 08:20',
  )
  assert.deepEqual(missingNames(check()), ['Deniz Yılmaz', 'Ece Yılmaz'])
  assert.equal(groupLine(group()), '2 öğrenci · 06 ABC 123 · Sorumlu: Selin Kaya')
  assert.equal(groupLine(group({ vehiclePlate: null, leaderName: null })), '2 öğrenci · Sorumlu: —')
})

test('DOM-FIN-154: dağıtım listesi grupsuzlar önce; gruptan çıkarma null gönderir', () => {
  const options = assignOptions({
    groups: [group()],
    unassigned: [{ studentId: 's9', studentName: 'Zeynep Ak', className: null }],
  })
  assert.deepEqual(
    options.map((row) => [row.studentId, row.groupName]),
    [
      ['s9', null],
      ['s1', '1. otobüs'],
      ['s2', '1. otobüs'],
    ],
  )
  assert.deepEqual(assignBody({ target: UNASSIGN, studentIds: ['s1'] }), {
    groupId: null,
    studentIds: ['s1'],
  })
  assert.deepEqual(assignBody({ target: 'g1', studentIds: ['s9'] }), {
    groupId: 'g1',
    studentIds: ['s9'],
  })
})

test('DOM-FIN-154: görünüm notu planın durumuna ve güne göre', () => {
  assert.match(
    dayNotice({ planStatus: 'draft', isTripDay: false, firstDay: '2026-10-20' }) ?? '',
    /onaylandıktan/,
  )
  assert.match(
    dayNotice({ planStatus: 'approved', isTripDay: false, firstDay: '2026-10-20' }) ?? '',
    /2026-10-20/,
  )
  assert.equal(dayNotice({ planStatus: 'approved', isTripDay: true, firstDay: '2026-10-20' }), null)
  assert.match(
    dayNotice({ planStatus: 'completed', isTripDay: false, firstDay: '2026-10-20' }) ?? '',
    /kapandı/,
  )
})

function card(overrides: Partial<TripDayCard> = {}): TripDayCard {
  return {
    plan: {
      id: 'p1',
      number: 'GZ-0007',
      name: 'Anıtkabir gezisi',
      departureAt: '2026-10-20T05:00:00.000Z',
      returnAt: '2026-10-20T17:00:00.000Z',
      emergencyContacts: [{ name: 'Okul müdürü', phone: '05321234500', relation: 'Müdür' }],
    },
    group: {
      id: 'a1b2c3d4-0000-4000-8000-000000000157',
      name: '1. otobüs',
      vehiclePlate: '06ABC123',
      leaderName: 'Selin Kaya',
    },
    purpose: 'office',
    phonesMasked: true,
    cardDay: '2026-10-20',
    total: 2,
    students: [
      {
        studentId: 's1',
        studentName: 'Deniz Yılmaz',
        className: '9-A',
        contacts: [{ name: 'Ayşe Yılmaz', relationship: 'mother', phone: '0532 *** ** 67' }],
        health: {
          alert: true,
          kinds: ['allergy', 'medication'],
          action: 'Oto-enjektör çantada.',
          medicationToday: true,
          source: 'profile',
        },
      },
      {
        studentId: 's2',
        studentName: 'Ece Yılmaz',
        className: null,
        contacts: [],
        health: {
          alert: false,
          kinds: [],
          action: null,
          medicationToday: false,
          source: 'unavailable',
        },
      },
    ],
    ...overrides,
  }
}

test('DOM-FIN-154: acil kart numarası, sağlık hücresi ve dosya adı (K-518)', () => {
  assert.equal(tripDayCardReference(card()), 'GZ-0007-A1B2C3')
  assert.equal(tripDayCardFilename(card()), 'gezi-acil-karti-GZ-0007-A1B2C3.pdf')
  assert.equal(
    tripDayHealthText(card().students[0]!),
    'Dikkat: alerji, ilaç var · Bugün ilaç var. Acil: Oto-enjektör çantada.',
  )
  assert.equal(tripDayHealthText(card().students[1]!), '—')
})

test('DOM-FIN-154: acil kart PDF grup, okul iletişimi, öğrenciler ve imza; maskeli telefon (K-518)', () => {
  const document = tripDayCardDocument(measurer, card(), {
    institution: 'Akademi Özel Okulları',
    generatedAt: NOW,
  })
  const texts = allTexts(document).join('\n')
  for (const expected of [
    'GEZİ ACİL KARTI',
    '1. OTOBÜS',
    'Akademi Özel Okulları',
    'GZ-0007 · Anıtkabir gezisi',
    '06 ABC 123',
    'Selin Kaya',
    'Okul müdürü',
    '05321234500',
    'Deniz Yılmaz',
    '0532 *** ** 67',
    'Grup sorumlusu',
    'Maskeli',
  ])
    assert.ok(texts.includes(expected), expected)
  assert.ok(texts.includes('maskelidir'))
  const full = allTexts(
    tripDayCardDocument(
      measurer,
      card({ purpose: 'emergency', phonesMasked: false, students: [], total: 0 }),
      { institution: 'Akademi Özel Okulları', generatedAt: NOW },
    ),
  ).join('\n')
  assert.ok(full.includes('Grupta öğrenci yok.'))
  assert.ok(full.includes('imha edilir'))
})
