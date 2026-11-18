import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TripPlanDetail } from '@kampus/react-shared/use-finance-trip-plans.ts'
import {
  noticeBody,
  noticeFormSchema,
  tripPlanBody,
  tripPlanChanges,
  tripPlanDefaults,
  tripPlanFormField,
  tripPlanFormSchema,
} from '../src/pages/finance/finance-trip-plan-forms.ts'
import {
  TRIP_PLAN_TITLE,
  tripPlanDocument,
  tripPlanFilename,
} from '../src/lib/pdf/templates/finance-trip-plan.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

// ON-155 (DOM-FIN-111): gezi planı onay dosyası PDF'i ve plan formu modeli.

const OPTIONS = {
  institution: 'Akademi Özel Okulları',
  generatedAt: new Date('2026-10-06T15:00:00.000Z'),
}
const ACTIONS = {
  edit: true,
  submit: false,
  approve: false,
  reject: false,
  complete: false,
  cancel: true,
  notify: true,
}
const plan = (overrides: Partial<TripPlanDetail> = {}): TripPlanDetail => ({
  id: 'tp-1',
  number: 'GZ-0007',
  name: 'Anıtkabir gezisi',
  departureAt: '2026-10-20T05:00:00.000Z',
  returnAt: '2026-10-20T15:00:00.000Z',
  expectedStudentCount: 40,
  staffCount: 2,
  leadNames: ['Selin Kaya'],
  ratioWarning: true,
  paidActivity: {
    id: 'pa-1',
    name: 'Ankara gezisi ücreti',
    kind: 'trip',
    activityDate: '2026-10-20',
    status: 'open',
  },
  status: 'approved',
  authorityNotifiedOn: '2026-10-06',
  actions: ACTIONS,
  version: 4,
  purpose: 'Cumhuriyet tarihi kazanımlarını yerinde gözlemlemek.',
  stops: [
    { place: 'Anıtkabir', note: 'Rehberli tur' },
    { place: 'Ankara Kalesi', note: null },
  ],
  staff: [
    { membershipId: 'm-1', name: 'Selin Kaya', role: 'lead' },
    { membershipId: 'm-2', name: 'Murat Demir', role: 'assistant' },
  ],
  transport: {
    type: 'bus',
    company: 'Mavi Turizm',
    plate: '06ABC123',
    driverName: 'Ali Sürücü',
    driverPhone: '05321112233',
    documentFileId: 'f-1',
    documentFile: { id: 'f-1', name: 'Araç ruhsatı.pdf', byteSize: 1200 },
  },
  risks: [{ risk: 'Kalabalıkta kaybolma', measure: 'Yaka kartı ve grup sorumlusu' }],
  emergencyContacts: [{ name: 'Okul müdürü', phone: '05321234567', relation: 'Müdür' }],
  ratio: { studentsPerStaff: 20, recommendedStaff: 3, warning: true },
  submittedAt: '2026-10-05T07:00:00.000Z',
  approvedAt: '2026-10-05T08:00:00.000Z',
  approvedByName: 'Ayşe Müdür',
  rejectedAt: null,
  rejectionReason: null,
  authorityReference: 'E-123',
  completedAt: null,
  cancelledAt: null,
  cancelReason: null,
  createdByName: 'Deniz Ön Büro',
  createdAt: '2026-10-04T07:00:00.000Z',
  events: [],
  ...overrides,
})
const joined = (item: TripPlanDetail) =>
  allTexts(tripPlanDocument(measurer, item, OPTIONS)).join('\n')

test('DOM-FIN-111: onay dosyası plan özeti, güzergâh, görevliler, ulaşım, risk tablosu, onay ve imza alanlarını taşır (K-368)', () => {
  const text = joined(plan())
  for (const part of [
    'GEZİ PLANI',
    TRIP_PLAN_TITLE,
    'GZ-0007',
    'Akademi Özel Okulları',
    'Cumhuriyet tarihi',
    'Anıtkabir',
    'Ankara Kalesi',
    'Selin Kaya',
    'Sorumlu öğretmen',
    'Murat Demir',
    'en az 3 görevli',
    'Otobüs',
    'Mavi Turizm',
    '06 ABC 123',
    'Ali Sürücü',
    'Araç ruhsatı.pdf',
    'Kalabalıkta kaybolma',
    'Yaka kartı ve grup sorumlusu',
    'Okul müdürü',
    '05321234567',
    'Ayşe Müdür',
    'E-123',
    'Ankara gezisi ücreti',
    'Hazırlayan',
    'okul müdürü',
  ])
    assert.ok(text.includes(part), part)
  assert.equal(text.includes('TASLAK'), false)
  assert.equal(tripPlanFilename(plan()), 'gezi-plani-GZ-0007.pdf')
})

test('DOM-FIN-111: onaylanmamış planın dosyası taslak notu, boş risk ve iletişim metni taşır', () => {
  const text = joined(
    plan({
      status: 'draft',
      approvedAt: null,
      approvedByName: null,
      authorityNotifiedOn: null,
      authorityReference: null,
      risks: [],
      emergencyContacts: [],
      paidActivity: null,
      staff: [{ membershipId: 'm-1', name: 'Selin Kaya', role: 'lead' }],
      expectedStudentCount: 10,
    }),
  )
  assert.ok(text.includes('TASLAK'))
  assert.ok(text.includes('Risk maddesi eklenmedi.'))
  assert.ok(text.includes('Acil iletişim kişisi eklenmedi.'))
  assert.ok(text.includes('Ücretsiz gezi'))
  assert.ok(text.includes('Onaylanmadı'))
  assert.equal(text.includes('en az'), false)
})

test('DOM-FIN-111: yeni plan formu varsayılanları ve gövdesi; boş isteğe bağlı alanlar null olur (K-366)', () => {
  const blank = tripPlanDefaults('2026-10-06')
  assert.equal(blank.departureAt, '2026-10-20T08:00')
  assert.equal(blank.returnAt, '2026-10-20T18:00')
  assert.equal(tripPlanFormSchema.safeParse(blank).success, false)
  const values = {
    ...blank,
    name: ' Anıtkabir gezisi ',
    purpose: 'Cumhuriyet tarihi kazanımları',
    expectedStudentCount: '30',
    stops: [{ place: 'Anıtkabir', note: ' ' }],
    staff: [{ membershipId: 'm-1', role: 'lead' as const }],
    plate: '06 abc 123',
    driverPhone: '0532 111 22 33',
  }
  assert.equal(tripPlanFormSchema.safeParse(values).success, true)
  const body = tripPlanBody(values, 'f-1')
  assert.equal(body.name, 'Anıtkabir gezisi')
  assert.equal(body.departureAt, '2026-10-20T05:00:00.000Z')
  assert.equal(body.expectedStudentCount, 30)
  assert.deepEqual(body.stops, [{ place: 'Anıtkabir', note: null }])
  assert.deepEqual(body.transport, {
    type: 'bus',
    company: null,
    plate: '06ABC123',
    driverName: null,
    driverPhone: '05321112233',
    documentFileId: 'f-1',
  })
  assert.equal(body.paidActivityId, null)
  const invalid = (patch: Record<string, unknown>) =>
    assert.equal(tripPlanFormSchema.safeParse({ ...values, ...patch }).success, false)
  invalid({ returnAt: '2026-10-20T07:00' })
  invalid({ staff: [{ membershipId: 'm-1', role: 'assistant' }] })
  invalid({
    staff: [
      { membershipId: 'm-1', role: 'lead' },
      { membershipId: 'm-1', role: 'assistant' },
    ],
  })
  invalid({ plate: 'ABC' })
  invalid({ expectedStudentCount: '0' })
  invalid({ contacts: [{ name: 'Müdür', phone: '123', relation: '' }] })
})

test('DOM-FIN-111: düzeltmede yalnız değişen alanlar gider; sunucu yolları form alanına çevrilir (K-367)', () => {
  const current = plan()
  const defaults = tripPlanDefaults('2026-10-06', current)
  assert.equal(defaults.departureAt, '2026-10-20T08:00')
  assert.equal(defaults.paidActivityId, 'pa-1')
  assert.deepEqual(tripPlanChanges(defaults, 'f-1', current), {})
  assert.deepEqual(tripPlanChanges({ ...defaults, expectedStudentCount: '45' }, 'f-1', current), {
    expectedStudentCount: 45,
  })
  const changed = tripPlanChanges(defaults, null, current)
  assert.equal(changed.transport?.documentFileId, null)
  assert.equal(tripPlanFormField('staff.0.membershipId'), 'staff.0.membershipId')
  assert.equal(tripPlanFormField('transport.plate'), 'plate')
  assert.equal(tripPlanFormField('transport'), 'transportType')
  assert.equal(tripPlanFormField('emergencyContacts.1.phone'), 'contacts.1.phone')
  assert.equal(tripPlanFormField('paidActivityId'), 'paidActivityId')
  assert.equal(tripPlanFormField('institutionId'), undefined)
  assert.deepEqual(noticeBody({ notifiedOn: '2026-10-06', reference: ' ' }), {
    notifiedOn: '2026-10-06',
    reference: null,
  })
  assert.equal(noticeFormSchema.safeParse({ notifiedOn: '', reference: '' }).success, false)
})
