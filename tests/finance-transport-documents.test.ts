import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  isCurrentDriverDocument,
  isTransportDocumentRestricted,
  planTransportDocument,
  planTransportDocumentSettings,
  TRANSPORT_DOCUMENT_FILE_MAX_BYTES,
  transportDocumentDaysText,
  transportDocumentInputSchema,
  transportDocumentSettingsSchema,
  transportDocumentStatus,
  transportDocumentTypesText,
  vehicleFitness,
  type FitnessDocument,
  type TransportDocumentChecks,
  type TransportDocumentInput,
} from '../packages/school-core/src/lib/finance-transport-documents.ts'

/** Servis aracı ve personeli belgeleri (DOM-FIN-147; ON-147; K-496…K-498). Bugün 2026-10-06. */

const TODAY = '2026-10-06'
const VEHICLE = '00000000-0000-4000-8000-000000000001'
const FILE = '00000000-0000-4000-8000-000000000002'
const OLD = '00000000-0000-4000-8000-000000000003'

function rejects(fn: () => unknown, code: string, kind: 'rule' | 'forbidden' = 'rule') {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof DomainError)
    assert.equal(error.code, code)
    assert.equal(error.kind, kind)
    return true
  })
}

const parse = (input: TransportDocumentInput) => transportDocumentInputSchema.parse(input)
const issues = (input: Record<string, unknown>) => {
  const result = transportDocumentInputSchema.safeParse(input)
  assert.equal(result.success, false)
  return result.error?.issues.map((issue) => issue.path.join('.')) ?? []
}
const vehicleDoc = (extra: Partial<TransportDocumentInput> = {}): TransportDocumentInput => ({
  subject: 'vehicle',
  vehicleId: VEHICLE,
  documentType: 'inspection',
  documentNumber: ' MUA-2026-1 ',
  startDate: '2026-01-10',
  endDate: '2027-01-10',
  ...extra,
})
const checks = (extra: Partial<TransportDocumentChecks> = {}): TransportDocumentChecks => ({
  vehicle: { driverName: 'Ali Sürücü' },
  staff: undefined,
  file: undefined,
  current: [],
  actorRole: 'onburo',
  today: TODAY,
  ...extra,
})

describe('DOM-FIN-147: servis belgesi şeması (K-496, K-497)', () => {
  test('DOM-FIN-147: araç belgesi numarayı kırpar, varsayılanlar boş', () => {
    const parsed = parse(vehicleDoc())
    assert.equal(parsed.documentNumber, 'MUA-2026-1')
    assert.equal(parsed.membershipId, null)
    assert.equal(parsed.fileId, null)
    assert.equal(parse(vehicleDoc({ documentNumber: '  ' })).documentNumber, null)
  })

  test('DOM-FIN-147: özne ile araç/personel seçimi tutarlı olmalı', () => {
    assert.deepEqual(issues({ ...vehicleDoc(), vehicleId: null }), ['vehicleId'])
    assert.deepEqual(issues({ ...vehicleDoc(), membershipId: 'm1' }), ['membershipId'])
    assert.deepEqual(
      issues({
        subject: 'staff',
        vehicleId: VEHICLE,
        documentType: 'criminal_record',
        startDate: '2026-09-01',
      }),
      ['membershipId', 'vehicleId'],
    )
  })

  test('DOM-FIN-147: tür özneye uymalı; kişi belgesinde numara yok, ehliyette sınıf zorunlu (K-497)', () => {
    assert.deepEqual(issues(vehicleDoc({ documentType: 'driving_license', licenseClass: 'D' })), [
      'documentType',
    ])
    assert.deepEqual(
      issues({
        subject: 'driver',
        vehicleId: VEHICLE,
        documentType: 'inspection',
        startDate: '2026-01-01',
        endDate: '2027-01-01',
      }),
      ['documentType'],
    )
    const license = {
      subject: 'driver',
      vehicleId: VEHICLE,
      documentType: 'driving_license',
      startDate: '2020-01-01',
      endDate: '2030-01-01',
    }
    assert.deepEqual(issues(license), ['licenseClass'])
    assert.deepEqual(issues({ ...license, licenseClass: 'D', documentNumber: '123456' }), [
      'documentNumber',
    ])
    assert.deepEqual(issues({ ...vehicleDoc(), licenseClass: 'D' }), ['licenseClass'])
    assert.equal(
      parse({ ...license, licenseClass: 'D' } as TransportDocumentInput).licenseClass,
      'D',
    )
  })

  test('DOM-FIN-147: bitiş zorunlu türlerde gerekir ve başlangıçtan önce olamaz', () => {
    assert.deepEqual(issues(vehicleDoc({ endDate: null })), ['endDate'])
    assert.deepEqual(issues(vehicleDoc({ endDate: '2026-01-09' })), ['endDate'])
    const criminal = parse({
      subject: 'driver',
      vehicleId: VEHICLE,
      documentType: 'criminal_record',
      startDate: '2026-09-01',
    })
    assert.equal(criminal.endDate, null)
    assert.deepEqual(issues({ ...vehicleDoc(), institutionId: 'b' }), [''])
  })

  test('DOM-FIN-147: uyarı ayarı 1–180 gün (K-498)', () => {
    assert.equal(transportDocumentSettingsSchema.safeParse({ warningDays: 0 }).success, false)
    assert.equal(transportDocumentSettingsSchema.safeParse({ warningDays: 181 }).success, false)
    assert.equal(transportDocumentSettingsSchema.safeParse({ warningDays: 1.5 }).success, false)
    assert.equal(transportDocumentSettingsSchema.parse({ warningDays: 45 }).warningDays, 45)
  })
})

describe('DOM-FIN-147: planTransportDocument (K-496, K-497)', () => {
  test('DOM-FIN-147: araç belgesi geçerli belgenin yerine kendiliğinden geçer', () => {
    assert.deepEqual(planTransportDocument(parse(vehicleDoc()), checks()), {
      supersedes: null,
      sensitive: false,
      driverName: null,
    })
    assert.equal(
      planTransportDocument(
        parse(vehicleDoc()),
        checks({ current: [{ id: OLD, startDate: '2025-01-10' }] }),
      ).supersedes,
      OLD,
    )
    // "Diğer" birden çok geçerli belge olabilir.
    assert.equal(
      planTransportDocument(
        parse(vehicleDoc({ documentType: 'other', endDate: null })),
        checks({ current: [{ id: OLD, startDate: '2025-01-10' }] }),
      ).supersedes,
      null,
    )
  })

  test('DOM-FIN-147: geçerli belgeden eski ve gelecek tarihli belge reddedilir', () => {
    rejects(
      () =>
        planTransportDocument(
          parse(vehicleDoc()),
          checks({ current: [{ id: OLD, startDate: '2026-02-01' }] }),
        ),
      'transport_document_older_than_current',
    )
    rejects(
      () => planTransportDocument(parse(vehicleDoc({ startDate: '2026-10-07' })), checks()),
      'transport_document_start_in_future',
    )
  })

  test('DOM-FIN-147: sürücü belgesi kayıt anındaki sürücü adını taşır; araç yoksa 422', () => {
    const input = parse({
      subject: 'driver',
      vehicleId: VEHICLE,
      documentType: 'driving_license',
      licenseClass: 'D',
      startDate: '2020-01-01',
      endDate: '2030-01-01',
    })
    assert.equal(planTransportDocument(input, checks()).driverName, 'Ali Sürücü')
    rejects(
      () => planTransportDocument(input, checks({ vehicle: null })),
      'transport_document_vehicle_not_found',
    )
  })

  test('DOM-FIN-147: personel etkin kurum personeli olmalı', () => {
    const input = parse({
      subject: 'staff',
      membershipId: 'm-rehber',
      documentType: 'other',
      startDate: '2026-01-01',
    })
    const staff = (value: TransportDocumentChecks['staff']) =>
      checks({ vehicle: undefined, staff: value })
    rejects(() => planTransportDocument(input, staff(null)), 'transport_document_staff_not_found')
    rejects(
      () => planTransportDocument(input, staff({ role: 'veli', active: true })),
      'transport_document_not_staff',
    )
    rejects(
      () => planTransportDocument(input, staff({ role: 'ogretmen', active: false })),
      'transport_document_staff_inactive',
    )
    assert.equal(
      planTransportDocument(input, staff({ role: 'ogretmen', active: true })).driverName,
      null,
    )
  })

  test('DOM-FIN-147: adli sicil ve psikoteknik yalnız yöneticide (K-497)', () => {
    const criminal = parse({
      subject: 'driver',
      vehicleId: VEHICLE,
      documentType: 'criminal_record',
      startDate: '2026-09-01',
    })
    rejects(
      () => planTransportDocument(criminal, checks()),
      'transport_document_sensitive_forbidden',
      'forbidden',
    )
    assert.equal(planTransportDocument(criminal, checks({ actorRole: 'yonetici' })).sensitive, true)
    assert.equal(isTransportDocumentRestricted('psychotechnical', 'onburo'), true)
    assert.equal(isTransportDocumentRestricted('psychotechnical', 'yonetici'), false)
    assert.equal(isTransportDocumentRestricted('inspection', 'onburo'), false)
  })

  test('DOM-FIN-147: dosya PDF ya da görsel, en çok 10 MB (K-496)', () => {
    const input = parse(vehicleDoc({ fileId: FILE }))
    rejects(
      () =>
        planTransportDocument(input, checks({ file: { mimeType: 'audio/mpeg', byteSize: 10 } })),
      'transport_document_file_type',
    )
    rejects(
      () =>
        planTransportDocument(
          input,
          checks({
            file: { mimeType: 'application/pdf', byteSize: TRANSPORT_DOCUMENT_FILE_MAX_BYTES + 1 },
          }),
        ),
      'transport_document_file_too_large',
    )
    planTransportDocument(
      input,
      checks({ file: { mimeType: 'image/png', byteSize: TRANSPORT_DOCUMENT_FILE_MAX_BYTES } }),
    )
    // Bulunamayan dosyayı dosya altyapısı reddeder.
    planTransportDocument(input, checks({ file: null }))
  })

  test('DOM-FIN-147: ayar değişikliği yoksa 422 (K-498)', () => {
    rejects(
      () => planTransportDocumentSettings({ warningDays: 30 }, { warningDays: 30 }),
      'transport_document_settings_unchanged',
    )
    assert.deepEqual(planTransportDocumentSettings({ warningDays: 30 }, { warningDays: 45 }), {
      next: { warningDays: 45 },
      changed: ['warningDays'],
    })
  })
})

describe('DOM-FIN-147: geçerlilik ve araç uygunluğu (K-498)', () => {
  test('DOM-FIN-147: durum ve kalan gün; bitiş günü dahil, pencere dahil', () => {
    const status = (endDate: string | null, supersededAt: unknown = null, days = 30) =>
      transportDocumentStatus({ endDate, supersededAt }, TODAY, days)
    assert.deepEqual(status(null), { status: 'valid', daysLeft: null })
    assert.deepEqual(status('2026-10-06'), { status: 'expiring', daysLeft: 0 })
    assert.deepEqual(status('2026-10-05'), { status: 'expired', daysLeft: -1 })
    assert.deepEqual(status('2026-11-05'), { status: 'expiring', daysLeft: 30 })
    assert.deepEqual(status('2026-11-06'), { status: 'valid', daysLeft: 31 })
    assert.deepEqual(status('2026-11-06', null, 31), { status: 'expiring', daysLeft: 31 })
    assert.equal(status('2026-01-01', '2026-02-01T00:00:00.000Z').status, 'superseded')
    assert.equal(
      transportDocumentStatus({ endDate: '2026-11-05', supersededAt: null }, TODAY).status,
      'expiring',
    )
  })

  test('DOM-FIN-147: süresi geçmiş zorunlu belge aracı uygun değil yapar, eksik belge yapmaz', () => {
    const doc = (
      documentType: FitnessDocument['documentType'],
      endDate: string | null,
    ): FitnessDocument => ({
      documentType,
      endDate,
      supersededAt: null,
    })
    const allVehicle = [
      doc('inspection', '2027-01-01'),
      doc('traffic_insurance', '2027-01-01'),
      doc('seat_insurance', '2026-10-20'),
      doc('school_bus_permit', '2027-08-31'),
    ]
    const fit = vehicleFitness(allVehicle, [], TODAY, 30)
    assert.equal(fit.fit, true)
    assert.deepEqual(fit.expiringTypes, ['seat_insurance'])
    assert.deepEqual(fit.missingVehicleTypes, [])
    assert.deepEqual(fit.missingDriverTypes, [
      'driving_license',
      'src_certificate',
      'psychotechnical',
      'criminal_record',
    ])
    const expired = vehicleFitness(
      [...allVehicle.slice(1), doc('inspection', '2026-10-05'), doc('other', '2020-01-01')],
      [doc('driving_license', '2026-01-01')],
      TODAY,
      30,
    )
    assert.equal(expired.fit, false)
    assert.deepEqual(expired.expiredTypes, ['inspection', 'driving_license'])
    // Yerine geçilen belge sayılmaz.
    const superseded = vehicleFitness(
      [{ documentType: 'inspection', endDate: '2026-01-01', supersededAt: '2026-02-01' }],
      [],
      TODAY,
      30,
    )
    assert.equal(superseded.fit, true)
    assert.ok(superseded.missingVehicleTypes.includes('inspection'))
  })

  test('DOM-FIN-147: sürücü belgesi yalnız şimdiki sürücüde sayılır (K-497)', () => {
    assert.equal(isCurrentDriverDocument('Ali Sürücü', 'Ali Sürücü'), true)
    assert.equal(isCurrentDriverDocument('Ali Sürücü', 'Veli Sürücü'), false)
    assert.equal(isCurrentDriverDocument(null, 'Ali Sürücü'), false)
  })

  test('DOM-FIN-147: metinler', () => {
    assert.equal(transportDocumentDaysText(null), 'süresiz')
    assert.equal(transportDocumentDaysText(0), 'bugün bitiyor')
    assert.equal(transportDocumentDaysText(12), '12 gün kaldı')
    assert.equal(transportDocumentDaysText(-3), '3 gün geçti')
    assert.equal(
      transportDocumentTypesText(['inspection', 'seat_insurance']),
      'Araç muayenesi, Koltuk sigortası',
    )
  })
})
