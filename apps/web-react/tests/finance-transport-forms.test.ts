import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  TransportRouteDetail,
  TransportVehicle,
} from '@kampus/react-shared/use-finance-transport.ts'

import {
  routeCreateBody,
  routeDefaults,
  routeFormField,
  routeFormSchema,
  routeUpdateBody,
  timeRangeText,
  vehicleCreateBody,
  vehicleDefaults,
  vehicleFormField,
  vehicleFormSchema,
  vehicleUpdateBody,
} from '../src/pages/finance/finance-transport-forms.ts'

// Servis sekmesinin saf mantığı (DOM-FIN-142; ON-098; K-481, K-482).

const issuesOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((issue) => issue.path.join('.')) ?? []

const vehicle: TransportVehicle = {
  id: 'v1',
  plate: '34KMP101',
  capacity: 16,
  driverName: 'Ali Sürücü',
  driverPhoneMasked: '0532 *** ** 67',
  guideMembershipId: null,
  guideName: null,
  routeCount: 1,
  maxRouteLoad: 3,
  version: 2,
}

test('DOM-FIN-142: araç formu yeni kayıtta telefon ister, düzenlemede boş telefonu göndermez (K-481)', () => {
  const values = {
    ...vehicleDefaults(),
    plate: '34 kmp 101',
    capacity: '16',
    driverName: ' Ali ',
    driverPhone: '0532 123 45 67',
  }
  assert.equal(vehicleFormSchema(false).safeParse(values).success, true)
  assert.deepEqual(issuesOf(vehicleFormSchema(false).safeParse({ ...values, driverPhone: '' })), [
    'driverPhone',
  ])
  assert.deepEqual(issuesOf(vehicleFormSchema(false).safeParse({ ...values, capacity: '81' })), [
    'capacity',
  ])
  assert.deepEqual(vehicleCreateBody(values), {
    plate: '34KMP101',
    capacity: 16,
    driverName: 'Ali',
    driverPhone: '05321234567',
    guideMembershipId: null,
  })
  const editing = vehicleDefaults(vehicle)
  assert.equal(editing.plate, '34 KMP 101')
  assert.equal(editing.driverPhone, '')
  assert.equal(vehicleFormSchema(true).safeParse(editing).success, true)
  assert.equal(vehicleUpdateBody(editing, vehicle), null)
  assert.deepEqual(vehicleUpdateBody({ ...editing, capacity: '20' }, vehicle), { capacity: 20 })
  assert.deepEqual(vehicleUpdateBody({ ...editing, driverPhone: '05559998877' }, vehicle), {
    driverPhone: '05559998877',
  })
  assert.equal(vehicleFormField('plate'), 'plate')
  assert.equal(vehicleFormField('institutionId'), null)
})

const route: TransportRouteDetail = {
  id: 'r1',
  name: 'Moda hattı',
  direction: 'morning',
  vehicleId: 'v1',
  vehiclePlate: '34KMP101',
  capacity: 16,
  load: 1,
  stopCount: 2,
  firstStopTime: '07:10',
  lastStopTime: '07:25',
  version: 3,
  driverName: 'Ali',
  driverPhoneMasked: '0532 *** ** 67',
  guideName: null,
  stops: [
    { id: 's-a', position: 1, name: 'Moda', time: '07:10', assigned: 1 },
    { id: 's-b', position: 2, name: 'Bahariye', time: '07:25', assigned: 0 },
  ],
  assignments: [],
}

test('DOM-FIN-142: güzergâh formu sıralı saat ister; düzenleme yalnız değişeni gönderir (K-481)', () => {
  const fresh = {
    ...routeDefaults(),
    name: 'Kadıköy',
    vehicleId: 'v1',
    stops: [
      { stopId: '', name: 'Moda', time: '07:30' },
      { stopId: '', name: 'Bahariye', time: '07:10' },
    ],
  }
  assert.deepEqual(issuesOf(routeFormSchema.safeParse(fresh)), ['stops.1.time'])
  const ordered = {
    ...fresh,
    stops: [
      { stopId: '', name: 'Moda', time: '07:10' },
      { stopId: '', name: 'Bahariye', time: '07:30' },
    ],
  }
  assert.deepEqual(routeCreateBody(ordered).stops, [
    { name: 'Moda', time: '07:10' },
    { name: 'Bahariye', time: '07:30' },
  ])
  const editing = routeDefaults(route)
  assert.equal(routeUpdateBody(editing, route), null)
  assert.deepEqual(routeUpdateBody({ ...editing, name: 'Moda – Kadıköy' }, route), {
    name: 'Moda – Kadıköy',
  })
  const firstStop = editing.stops[0]
  assert.ok(firstStop)
  assert.deepEqual(routeUpdateBody({ ...editing, stops: [firstStop] }, route), {
    stops: [{ id: 's-a', name: 'Moda', time: '07:10' }],
  })
  assert.equal(routeFormField('stops.1.time'), 'stops.1.time')
  assert.equal(routeFormField('stops.0.id'), 'stops.0.name')
  assert.equal(routeFormField('direction'), null)
  assert.equal(timeRangeText('07:10', '07:25'), '07:10–07:25')
  assert.equal(timeRangeText(null, null), '—')
})
