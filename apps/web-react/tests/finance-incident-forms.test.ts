import assert from 'node:assert/strict'
import test from 'node:test'

import type { IncidentDetail } from '@kampus/react-shared/use-finance-incidents.ts'

import {
  incidentReportDocument,
  incidentReportFilename,
} from '../src/lib/pdf/templates/finance-incident-report.ts'
import {
  addendumFormSchema,
  incidentCreateBody,
  incidentDefaults,
  incidentEditDefaults,
  incidentFormField,
  incidentFormSchema,
  incidentStatusBadge,
  incidentUpdateBody,
  istanbulInstant,
  istanbulTime,
  notificationDefaults,
  notificationText,
} from '../src/pages/finance/finance-incident-forms.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

// Kaza tutanakları sekmesinin saf mantığı ve PDF'i (DOM-FIN-146; ON-162; K-493…K-495).

const NOW = new Date('2026-10-06T09:00:00.000Z')
const issuesOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((issue) => issue.path.join('.')) ?? []

function detail(overrides: Partial<IncidentDetail> = {}): IncidentDetail {
  return {
    id: '1a2b3c4d-0000-4000-8000-000000000001',
    status: 'finalized',
    injuredKind: 'student',
    studentId: 's-1',
    injuredMembershipId: null,
    injuredName: 'Deniz Yılmaz',
    occurredAt: '2026-10-06T05:30:00.000Z',
    location: 'Bahçe',
    kind: 'fall',
    responsibleMembershipId: 'm-teacher',
    responsibleName: 'Selin Kaya',
    notificationCount: 1,
    lastNotifiedAt: '2026-10-06T06:00:00.000Z',
    createdByUserId: 'u-1',
    mine: false,
    finalizedAt: '2026-10-06T08:00:00.000Z',
    version: 2,
    description: 'Teneffüste koşarken düştü.',
    witnesses: [{ membershipId: 'm-desk', name: 'Ön Büro' }],
    notifications: [
      {
        id: 'n-1',
        notifiedAt: '2026-10-06T06:00:00.000Z',
        channel: 'phone',
        notifiedByMembershipId: 'm-teacher',
        notifiedByName: 'Selin Kaya',
        createdAt: '2026-10-06T06:01:00.000Z',
      },
    ],
    health: {
      bodyParts: ['knee', 'hand'],
      severity: 'moderate',
      injuryNote: 'Sol diz sıyrık',
      firstAid: { byMembershipId: 'm-teacher', byName: 'Selin Kaya', action: 'Buz uygulandı.' },
      referral: 'infirmary',
    },
    addenda: [
      {
        id: 'a-1',
        note: 'Akşam hastaneye götürüldü.',
        createdByUserId: 'u-admin',
        createdByName: 'Müdür',
        createdAt: '2026-10-06T09:00:00.000Z',
      },
    ],
    access: { health: true, edit: false, notify: true, manage: true },
    finalizedByUserId: 'u-1',
    createdAt: '2026-10-06T06:00:00.000Z',
    updatedAt: '2026-10-06T08:00:00.000Z',
    ...overrides,
  }
}

test('DOM-FIN-146: İstanbul saati ve an dönüşümü', () => {
  assert.equal(istanbulTime(NOW), '12:00')
  assert.equal(istanbulInstant('2026-10-06', '08:30'), '2026-10-06T08:30:00+03:00')
  assert.deepEqual(notificationDefaults(NOW), {
    channel: 'phone',
    notifiedDate: '2026-10-06',
    notifiedTime: '12:00',
  })
})

test('DOM-FIN-146: form yaralananı, bölgeyi, sorumluyu ve müdahale metnini ister (K-493)', () => {
  const values = incidentDefaults(NOW)
  assert.equal(values.occurredDate, '2026-10-06')
  assert.equal(values.occurredTime, '12:00')
  assert.deepEqual(issuesOf(incidentFormSchema.safeParse(values)).sort(), [
    'bodyParts',
    'description',
    'location',
    'responsibleMembershipId',
    'studentId',
  ])
  const filled = {
    ...values,
    studentId: 's-1',
    location: 'Bahçe',
    description: 'Teneffüste düştü, dizini çarptı.',
    bodyParts: ['knee' as const],
    responsibleMembershipId: 'm-1',
  }
  assert.equal(incidentFormSchema.safeParse(filled).success, true)
  assert.deepEqual(issuesOf(incidentFormSchema.safeParse({ ...filled, firstAidGiven: true })), [
    'firstAidAction',
  ])
  assert.deepEqual(issuesOf(incidentFormSchema.safeParse({ ...filled, injuredKind: 'staff' })), [
    'injuredMembershipId',
  ])
})

test('DOM-FIN-146: açma gövdesi, düzeltmede yalnız değişen alanlar (K-493)', () => {
  const values = {
    ...incidentDefaults(NOW),
    studentId: 's-1',
    occurredTime: '08:30',
    location: ' Bahçe ',
    description: ' Teneffüste düştü, dizini çarptı. ',
    bodyParts: ['knee' as const],
    injuryNote: '  ',
    firstAidGiven: true,
    firstAidAction: 'Buz',
    responsibleMembershipId: 'm-1',
  }
  const body = incidentCreateBody(values)
  assert.deepEqual(body.injured, { kind: 'student', studentId: 's-1' })
  assert.equal(body.occurredAt, '2026-10-06T08:30:00+03:00')
  assert.equal(body.location, 'Bahçe')
  assert.equal(body.injuryNote, null)
  assert.deepEqual(body.firstAid, { byMembershipId: null, action: 'Buz' })
  const staff = incidentCreateBody({ ...values, injuredKind: 'staff', injuredMembershipId: 'm-2' })
  assert.deepEqual(staff.injured, { kind: 'staff', membershipId: 'm-2' })

  const initial = incidentEditDefaults(detail({ status: 'draft' }))
  assert.equal(initial.occurredTime, '08:30')
  assert.equal(initial.firstAidGiven, true)
  assert.deepEqual(initial.witnessMembershipIds, ['m-desk'])
  assert.deepEqual(incidentUpdateBody(initial, initial), {})
  assert.deepEqual(
    incidentUpdateBody({ ...initial, severity: 'severe', firstAidGiven: false }, initial),
    { severity: 'severe', firstAid: null },
  )
  const noHealth = incidentEditDefaults(detail({ health: undefined }))
  assert.deepEqual(noHealth.bodyParts, [])
})

test('DOM-FIN-146: sunucu alanı forma eşlenir; rozet ve bildirim metni', () => {
  assert.equal(incidentFormField('occurredAt'), 'occurredTime')
  assert.equal(incidentFormField('injured.studentId'), 'studentId')
  assert.equal(incidentFormField('injured.membershipId'), 'injuredMembershipId')
  assert.equal(incidentFormField('firstAid.byMembershipId'), 'firstAidBy')
  assert.equal(incidentFormField('firstAid.action'), 'firstAidAction')
  assert.equal(incidentFormField('witnessMembershipIds.0'), 'witnessMembershipIds')
  assert.equal(incidentFormField('severity'), 'severity')
  assert.equal(incidentFormField('unknown'), null)
  assert.deepEqual(incidentStatusBadge({ status: 'draft' }), { text: 'Taslak', tone: 'amber' })
  assert.deepEqual(incidentStatusBadge({ status: 'finalized' }), {
    text: 'Kesinleşti',
    tone: 'green',
  })
  assert.equal(notificationText({ injuredKind: 'staff', notificationCount: 0 }), '—')
  assert.equal(notificationText({ injuredKind: 'student', notificationCount: 0 }), 'Bildirilmedi')
  assert.equal(notificationText({ injuredKind: 'student', notificationCount: 2 }), '2 kayıt')
  assert.equal(addendumFormSchema.safeParse({ note: 'kısa' }).success, false)
})

test('DOM-FIN-146: tutanak PDF’i bölge, müdahale, bildirim, ek not ve boş imza alanlarını taşır (K-493, K-494)', () => {
  const options = { institution: 'Akademi Özel Okulları', generatedAt: NOW }
  const all = allTexts(incidentReportDocument(measurer, detail(), options)).join(' ')
  for (const expected of [
    'Kaza ve yaralanma tutanağı',
    'Deniz Yılmaz (Öğrenci)',
    'Diz, El ve parmak',
    'Orta',
    'Revir',
    'Yapılan müdahale: Buz uygulandı.',
    'Telefon',
    'Akşam hastaneye götürüldü.',
    'Okul müdürü',
    'Veli (tebellüğ)',
  ])
    assert.ok(all.includes(expected), expected)
  assert.equal(incidentReportFilename(detail()), 'kaza-tutanagi-2026-10-06-1a2b3c4d.pdf')
  const staff = allTexts(
    incidentReportDocument(
      measurer,
      detail({ injuredKind: 'staff', notifications: [], addenda: [] }),
      options,
    ),
  ).join(' ')
  assert.ok(staff.includes('Yaralanan personel'))
  assert.equal(staff.includes('Veli bildirimi'), false)
  assert.throws(() => incidentReportDocument(measurer, detail({ status: 'draft' }), options))
  assert.throws(() => incidentReportDocument(measurer, detail({ health: undefined }), options))
})
