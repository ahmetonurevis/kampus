import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  TransportDocumentAlerts,
  TransportDocumentRow,
  TransportVehicleFitness,
} from '@kampus/react-shared/use-finance-transport-documents.ts'

import {
  alertCount,
  documentTitle,
  fitnessText,
  fitnessTone,
  missingText,
  periodText,
  statusLine,
  subjectText,
  transportDocumentBody,
  transportDocumentDefaults,
  transportDocumentFormField,
  transportDocumentFormSchema,
  warningDaysFormSchema,
} from '../src/pages/finance/finance-transport-document-forms.ts'

// Servis belgesi formu ve gösterimi (DOM-FIN-147; ON-147; K-496…K-498).

const issuesOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((issue) => issue.path.join('.')) ?? []

const row = (extra: Partial<TransportDocumentRow> = {}): TransportDocumentRow => ({
  id: 'd1',
  subject: 'vehicle',
  vehicleId: 'v1',
  vehiclePlate: '34KMP101',
  membershipId: null,
  subjectName: null,
  counted: true,
  documentType: 'inspection',
  documentNumber: null,
  licenseClass: null,
  startDate: '2026-01-10',
  endDate: '2027-01-10',
  status: 'valid',
  daysLeft: 96,
  sensitive: false,
  restricted: false,
  hasFile: false,
  file: null,
  replacesId: null,
  supersededAt: null,
  createdAt: '2026-10-06T09:00:00.000Z',
  ...extra,
})
const fitness = (extra: Partial<TransportVehicleFitness> = {}): TransportVehicleFitness => ({
  vehicleId: 'v1',
  plate: '34KMP101',
  fit: true,
  expiredTypes: [],
  expiringTypes: [],
  missingVehicleTypes: [],
  missingDriverTypes: [],
  routes: [],
  ...extra,
})

test('DOM-FIN-147: belge sahibi, başlık ve dönem metinleri', () => {
  assert.equal(subjectText(row()), '34 KMP 101')
  assert.equal(
    subjectText(row({ subject: 'driver', subjectName: 'Ali Sürücü' })),
    'Sürücü Ali Sürücü · 34 KMP 101',
  )
  assert.equal(
    subjectText(row({ subject: 'staff', vehiclePlate: null, subjectName: 'Selin Kaya' })),
    'Personel Selin Kaya',
  )
  assert.equal(subjectText(row({ vehiclePlate: null })), '—')
  assert.equal(
    documentTitle(row({ documentType: 'driving_license', licenseClass: 'D' })),
    'Sürücü belgesi (ehliyet) · D',
  )
  assert.equal(documentTitle(row()), 'Araç muayenesi')
  assert.match(periodText(row()), /2026 – .*2027/)
  assert.match(periodText(row({ endDate: null })), /süresiz$/)
})

test('DOM-FIN-147: durum satırı, önceki sürücü ve rozet sayısı (K-497, K-498)', () => {
  assert.equal(
    statusLine(row({ status: 'expiring', daysLeft: 12 })),
    'Süresi yaklaşıyor · 12 gün kaldı',
  )
  assert.equal(statusLine(row({ status: 'superseded', counted: false })), 'Yerine yenisi geçti')
  assert.equal(
    statusLine(row({ subject: 'driver', counted: false, status: 'expired', daysLeft: -3 })),
    'Süresi geçti · 3 gün geçti · önceki sürücü',
  )
  assert.equal(alertCount(undefined), undefined)
  const alerts = {
    warningDays: 30,
    expiredCount: 1,
    expiringCount: 2,
    unfitVehicleCount: 1,
    missingVehicleCount: 0,
    vehicles: [],
  } satisfies TransportDocumentAlerts
  assert.equal(alertCount(alerts), 3)
  assert.equal(alertCount({ ...alerts, expiredCount: 0, expiringCount: 0 }), undefined)
})

test('DOM-FIN-147: araç uygunluğu metni ve tonu (K-498)', () => {
  assert.equal(fitnessText(fitness()), 'Uygun')
  assert.equal(fitnessTone(fitness()), 'green')
  const unfit = fitness({ fit: false, expiredTypes: ['inspection', 'driving_license'] })
  assert.equal(fitnessText(unfit), 'Uygun değil: Araç muayenesi, Sürücü belgesi (ehliyet)')
  assert.equal(fitnessTone(unfit), 'red')
  const missing = fitness({
    missingVehicleTypes: ['seat_insurance'],
    missingDriverTypes: ['src_certificate'],
  })
  assert.equal(fitnessText(missing), 'Eksik belge')
  assert.equal(fitnessTone(missing), 'amber')
  assert.equal(missingText(missing), 'Araç: Koltuk sigortası · Sürücü: Mesleki yeterlilik (SRC)')
  assert.equal(missingText(fitness()), null)
})

test('DOM-FIN-147: form şeması özneye göre alanları ister (K-496, K-497)', () => {
  const defaults = transportDocumentDefaults('2026-10-06')
  assert.equal(defaults.documentType, 'inspection')
  assert.equal(transportDocumentDefaults('2026-10-06', 'driver').documentType, 'driving_license')
  assert.deepEqual(issuesOf(transportDocumentFormSchema.safeParse(defaults)), [
    'vehicleId',
    'endDate',
  ])
  assert.deepEqual(
    issuesOf(
      transportDocumentFormSchema.safeParse({
        ...defaults,
        subject: 'driver',
        vehicleId: 'v1',
        documentType: 'driving_license',
        endDate: '2030-01-01',
      }),
    ),
    ['licenseClass'],
  )
  assert.deepEqual(
    issuesOf(transportDocumentFormSchema.safeParse({ ...defaults, subject: 'staff' })),
    ['membershipId', 'documentType', 'endDate'],
  )
  assert.deepEqual(
    issuesOf(
      transportDocumentFormSchema.safeParse({
        ...defaults,
        vehicleId: 'v1',
        endDate: '2026-01-01',
      }),
    ),
    ['endDate'],
  )
})

test('DOM-FIN-147: gövde özneye ait olmayan alanları boş gönderir', () => {
  const values = {
    ...transportDocumentDefaults('2026-10-06'),
    vehicleId: 'v1',
    documentNumber: ' P-1 ',
    licenseClass: 'D' as const,
    endDate: '2027-10-06',
  }
  assert.deepEqual(transportDocumentBody(values, 'f1'), {
    subject: 'vehicle',
    vehicleId: 'v1',
    membershipId: null,
    documentType: 'inspection',
    documentNumber: 'P-1',
    licenseClass: null,
    startDate: '2026-10-06',
    endDate: '2027-10-06',
    fileId: 'f1',
  })
  const staff = transportDocumentBody(
    {
      ...values,
      subject: 'staff',
      membershipId: 'm1',
      documentType: 'criminal_record',
      endDate: '',
    },
    null,
  )
  assert.equal(staff.vehicleId, null)
  assert.equal(staff.membershipId, 'm1')
  assert.equal(staff.documentNumber, null)
  assert.equal(staff.endDate, null)
  assert.equal(transportDocumentFormField('endDate'), 'endDate')
  assert.equal(transportDocumentFormField('fileId'), null)
})

test('DOM-FIN-147: uyarı ayarı formu 1–180 gün (K-498)', () => {
  assert.equal(warningDaysFormSchema.safeParse({ warningDays: '30' }).success, true)
  assert.equal(warningDaysFormSchema.safeParse({ warningDays: '0' }).success, false)
  assert.equal(warningDaysFormSchema.safeParse({ warningDays: '181' }).success, false)
  assert.equal(warningDaysFormSchema.safeParse({ warningDays: '3,5' }).success, false)
})
