import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  assertTransportGuide,
  assertTransportRouteArchivable,
  assertTransportVehicleArchivable,
  maskDriverPhone,
  planTransportAssignment,
  planTransportRoute,
  planTransportRouteUpdate,
  planTransportStops,
  planTransportVehicle,
  planTransportVehicleUpdate,
  transportAssignSchema,
  transportLoadLabel,
  transportPlateLabel,
  transportRouteCreateSchema,
  transportRouteUpdateSchema,
  transportVehicleCreateSchema,
  transportVehicleUpdateSchema,
  type StoredStop,
  type StoredVehicleFields,
  type TransportAssignChecks,
} from '../packages/school-core/src/lib/finance-transport.ts'

/** Servis güzergâhı ve öğrenci–durak ataması kuralları (DOM-FIN-142; ON-098; K-481, K-482). */

const ID = '00000000-0000-4000-8000-000000000001'
const OTHER = '00000000-0000-4000-8000-000000000002'
const THIRD = '00000000-0000-4000-8000-000000000003'

function rejects(fn: () => unknown, code: string, kind: 'rule' | 'conflict' = 'rule') {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof DomainError)
    assert.equal(error.code, code)
    assert.equal(error.kind, kind)
    return true
  })
}

const vehicle = {
  plate: '34 abc 123',
  capacity: 16,
  driverName: ' Ali Sürücü ',
  driverPhone: '0532 123 45 67',
}

describe('DOM-FIN-142: araç şeması ve kuralı (K-481)', () => {
  test('plaka boşluksuz büyük harfe, telefon rakamlara iner; rehber isteğe bağlı', () => {
    const parsed = transportVehicleCreateSchema.parse(vehicle)
    assert.equal(parsed.plate, '34ABC123')
    assert.equal(parsed.driverPhone, '05321234567')
    assert.equal(parsed.driverName, 'Ali Sürücü')
    assert.equal(parsed.guideMembershipId, null)
    assert.equal(transportPlateLabel(parsed.plate), '34 ABC 123')
    assert.equal(maskDriverPhone(parsed.driverPhone), '0532 *** ** 67')
  })

  test('geçersiz plaka, kapasite, telefon ve bilinmeyen alan reddedilir', () => {
    for (const bad of [
      { ...vehicle, plate: '99 A 1' },
      { ...vehicle, capacity: 0 },
      { ...vehicle, capacity: 81 },
      { ...vehicle, driverPhone: '12345' },
      { ...vehicle, address: 'Moda Cad. No 5' },
    ])
      assert.equal(transportVehicleCreateSchema.safeParse(bad).success, false)
    assert.equal(transportVehicleUpdateSchema.safeParse({}).success, false)
    assert.equal(transportVehicleUpdateSchema.safeParse({ capacity: 20 }).success, true)
  })

  test('plaka tekil, rehber kurumun etkin personeli', () => {
    rejects(
      () => planTransportVehicle({ plateTaken: true, guide: undefined }),
      'transport_plate_taken',
      'conflict',
    )
    rejects(() => assertTransportGuide(null), 'transport_guide_not_found')
    rejects(() => assertTransportGuide({ role: 'veli', active: true }), 'transport_guide_not_staff')
    rejects(
      () => assertTransportGuide({ role: 'ogretmen', active: false }),
      'transport_guide_inactive',
    )
    planTransportVehicle({ plateTaken: false, guide: { role: 'onburo', active: true } })
  })

  test('düzenleme: değişiklik yoksa 422, kapasite atanmış öğrencinin altına inmez', () => {
    const current: StoredVehicleFields = {
      plate: '34ABC123',
      capacity: 16,
      driverName: 'Ali',
      driverPhone: '05321234567',
      guideMembershipId: null,
    }
    const checks = { plateTaken: false, guide: undefined, maxRouteLoad: 10 }
    rejects(
      () => planTransportVehicleUpdate(current, { capacity: 16 }, checks),
      'transport_vehicle_unchanged',
    )
    rejects(
      () => planTransportVehicleUpdate(current, { capacity: 9 }, checks),
      'transport_capacity_below_load',
    )
    rejects(
      () =>
        planTransportVehicleUpdate(current, { plate: '06XY99' }, { ...checks, plateTaken: true }),
      'transport_plate_taken',
      'conflict',
    )
    rejects(
      () =>
        planTransportVehicleUpdate(
          current,
          { guideMembershipId: 'm-1' },
          { ...checks, guide: null },
        ),
      'transport_guide_not_found',
    )
    const plan = planTransportVehicleUpdate(
      current,
      { capacity: 10, driverPhone: '05559998877' },
      checks,
    )
    assert.deepEqual(plan.changed, ['capacity', 'driverPhone'])
    assert.equal(plan.next.capacity, 10)
    rejects(() => assertTransportVehicleArchivable(1), 'transport_vehicle_in_use')
    assertTransportVehicleArchivable(0)
  })
})

describe('DOM-FIN-142: güzergâh ve duraklar (K-481)', () => {
  const route = {
    name: 'Moda hattı',
    direction: 'morning',
    vehicleId: ID,
    stops: [
      { name: 'Moda', time: '07:10' },
      { name: 'Bahariye', time: '07:25' },
    ],
  }

  test('duraklar sıralı ve saatleri ilerler; aynı durak iki kez yazılmaz', () => {
    assert.equal(transportRouteCreateSchema.safeParse(route).success, true)
    const backwards = transportRouteCreateSchema.safeParse({
      ...route,
      stops: [
        { name: 'Moda', time: '07:30' },
        { name: 'Bahariye', time: '07:10' },
      ],
    })
    assert.equal(backwards.success, false)
    assert.deepEqual(backwards.error?.issues[0]?.path, ['stops', 1, 'time'])
    for (const bad of [
      { ...route, stops: [] },
      { ...route, direction: 'noon' },
      { ...route, stops: [{ name: 'Moda', time: '7:10' }] },
      {
        ...route,
        stops: [
          { name: 'Moda', time: '07:10' },
          { name: 'MODA', time: '07:20' },
        ],
      },
      { ...route, stops: [{ id: ID, name: 'Moda', time: '07:10' }] },
    ])
      assert.equal(transportRouteCreateSchema.safeParse(bad).success, false)
    assert.equal(transportRouteUpdateSchema.safeParse({}).success, false)
    assert.equal(transportRouteUpdateSchema.safeParse({ direction: 'evening' }).success, false)
  })

  test('araç kurumda olmalı, ad aynı yönde tekil', () => {
    rejects(
      () => planTransportRoute({ vehicle: null, nameTaken: false }),
      'transport_vehicle_not_found',
    )
    rejects(
      () => planTransportRoute({ vehicle: { capacity: 10 }, nameTaken: true }),
      'transport_route_name_taken',
      'conflict',
    )
    planTransportRoute({ vehicle: { capacity: 10 }, nameTaken: false })
  })

  test('durak planı: yeni, değişen ve kaldırılan; atanmış durak kaldırılmaz', () => {
    const existing: StoredStop[] = [
      { id: ID, name: 'Moda', time: '07:10', position: 1 },
      { id: OTHER, name: 'Bahariye', time: '07:25', position: 2 },
      { id: THIRD, name: 'Kampüs', time: '07:45', position: 3 },
    ]
    const plan = planTransportStops(
      existing,
      [
        { id: ID, name: 'Moda', time: '07:10' },
        { name: 'Altıyol', time: '07:20' },
        { id: THIRD, name: 'Kampüs', time: '07:50' },
      ],
      new Set([ID]),
    )
    assert.deepEqual(plan.insert, [{ name: 'Altıyol', time: '07:20', position: 2 }])
    assert.deepEqual(plan.update, [{ id: THIRD, name: 'Kampüs', time: '07:50', position: 3 }])
    assert.deepEqual(plan.archive, [OTHER])
    rejects(
      () =>
        planTransportStops(existing, [{ id: THIRD, name: 'Kampüs', time: '07:45' }], new Set([ID])),
      'transport_stop_has_students',
    )
    rejects(
      () =>
        planTransportStops(
          existing,
          [{ id: '00000000-0000-4000-8000-000000000009', name: 'X', time: '07:00' }],
          new Set(),
        ),
      'transport_stop_not_found',
    )
  })

  test('araç değişikliği yükü taşımalı; yükü olan güzergâh arşivlenmez', () => {
    rejects(
      () =>
        planTransportRouteUpdate(
          { vehicleId: ID },
          { vehicle: { capacity: 4 }, nameTaken: false, load: 5 },
        ),
      'transport_capacity_below_load',
    )
    rejects(
      () =>
        planTransportRouteUpdate({ vehicleId: ID }, { vehicle: null, nameTaken: false, load: 0 }),
      'transport_vehicle_not_found',
    )
    rejects(
      () =>
        planTransportRouteUpdate(
          { name: 'X hattı' },
          { vehicle: undefined, nameTaken: true, load: 0 },
        ),
      'transport_route_name_taken',
      'conflict',
    )
    planTransportRouteUpdate(
      { vehicleId: ID },
      { vehicle: { capacity: 5 }, nameTaken: false, load: 5 },
    )
    rejects(() => assertTransportRouteArchivable(2), 'transport_route_has_students')
    assertTransportRouteArchivable(0)
  })
})

describe('DOM-FIN-142: öğrenci–durak ataması (K-482)', () => {
  const checks = (overrides: Partial<TransportAssignChecks> = {}): TransportAssignChecks => ({
    student: { active: true },
    stopOnRoute: true,
    load: 3,
    capacity: 4,
    sameDirection: null,
    routeId: ID,
    ...overrides,
  })

  test('şema öğrenci ve durak ister', () => {
    assert.equal(transportAssignSchema.safeParse({ studentId: 's1', stopId: ID }).success, true)
    assert.equal(transportAssignSchema.safeParse({ studentId: '', stopId: ID }).success, false)
    assert.equal(transportAssignSchema.safeParse({ studentId: 's1', stopId: 'x' }).success, false)
  })

  test('öğrenci, durak, yön ve kapasite denetlenir', () => {
    planTransportAssignment(checks())
    rejects(() => planTransportAssignment(checks({ student: null })), 'transport_student_not_found')
    rejects(
      () => planTransportAssignment(checks({ student: { active: false } })),
      'transport_student_inactive',
    )
    rejects(
      () => planTransportAssignment(checks({ stopOnRoute: false })),
      'transport_stop_not_on_route',
    )
    rejects(
      () => planTransportAssignment(checks({ sameDirection: { routeId: ID } })),
      'transport_student_already_assigned',
      'conflict',
    )
    rejects(
      () => planTransportAssignment(checks({ sameDirection: { routeId: OTHER } })),
      'transport_student_direction_taken',
      'conflict',
    )
    rejects(
      () => planTransportAssignment(checks({ load: 4 })),
      'transport_capacity_full',
      'conflict',
    )
    assert.equal(transportLoadLabel(3, 4), '3/4')
  })
})
