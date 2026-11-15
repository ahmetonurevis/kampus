import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addMonthsToDay,
  canManageMaintenancePlans,
  isMaintenancePlanAttention,
  MAINTENANCE_PLAN_TYPE_DEFAULTS,
  MAINTENANCE_PLAN_TYPES,
  maintenanceInspectionCancelSchema,
  maintenanceInspectionSchema,
  maintenancePlanSchedule,
  maintenancePlanSchema,
  maintenancePlansCsv,
  maintenanceRequestFromInspection,
  planMaintenanceInspection,
  planMaintenanceInspectionCancel,
  planMaintenancePlan,
  planMaintenancePlanUpdate,
  updateMaintenancePlanSchema,
  type MaintenanceInspectionInput,
  type MaintenancePlanInput,
} from '../packages/school-core/src/lib/finance-maintenance-plans.ts'

import { isDomainError } from './support/domain-error.ts'

// Periyodik bakım planı ve denetim kaydı (DOM-FIN-092; ON-240). Bugün 2026-10-06 (Europe/Istanbul).

const NOW = new Date('2026-10-06T09:00:00.000Z')
const TODAY = '2026-10-06'
const PLAN: MaintenancePlanInput = {
  name: 'A blok asansörü',
  type: 'elevator',
  location: 'A blok giriş',
}
const SUPPLIER = '6b0d3c1e-0a4e-4d8f-9a55-0b3e1c2d4f60'
const INSPECTION: MaintenanceInspectionInput = {
  doneDate: TODAY,
  performedBy: 'Beta Muayene A.Ş.',
  result: 'pass',
}
const parsePlan = (input: Partial<MaintenancePlanInput> = {}) =>
  maintenancePlanSchema.parse({ ...PLAN, ...input })
const CURRENT = {
  name: 'A blok asansörü',
  type: 'elevator' as const,
  campusId: null,
  location: 'A blok giriş',
  assetTagNumber: null,
  periodMonths: 12,
  isLegal: true,
  lastDoneDate: null,
  responsible: null,
}

test('DOM-FIN-092: ay ekleme ayın son gününe çekilir, yıl döner (PostgreSQL ile aynı)', () => {
  assert.equal(addMonthsToDay('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonthsToDay('2028-01-31', 1), '2028-02-29')
  assert.equal(addMonthsToDay('2026-08-31', 6), '2027-02-28')
  assert.equal(addMonthsToDay('2026-10-06', 12), '2027-10-06')
  assert.equal(addMonthsToDay('2026-12-15', 1), '2027-01-15')
  assert.equal(addMonthsToDay('2026-03-31', 60), '2031-03-31')
})

test('DOM-FIN-092: takvim son denetimden periyotla hesaplanır; gecikti, yaklaşıyor, zamanında (K-253)', () => {
  assert.deepEqual(maintenancePlanSchedule({ periodMonths: 12, previousDoneDate: null }, NOW), {
    lastDoneDate: null,
    nextDueDate: null,
    status: 'never',
    daysLeft: null,
  })
  // Geçen yıl bugün: sonraki gün bugün, yaklaşıyor (0 gün).
  assert.deepEqual(
    maintenancePlanSchedule({ periodMonths: 12, previousDoneDate: '2025-10-06' }, NOW),
    { lastDoneDate: '2025-10-06', nextDueDate: '2026-10-06', status: 'due_soon', daysLeft: 0 },
  )
  assert.equal(
    maintenancePlanSchedule({ periodMonths: 12, previousDoneDate: '2025-10-05' }, NOW).status,
    'overdue',
  )
  // 30. gün yaklaşıyor, 31. gün zamanında.
  const in30 = maintenancePlanSchedule({ periodMonths: 6, previousDoneDate: '2026-05-05' }, NOW)
  assert.deepEqual([in30.nextDueDate, in30.status, in30.daysLeft], ['2026-11-05', 'due_soon', 30])
  const in31 = maintenancePlanSchedule({ periodMonths: 6, previousDoneDate: '2026-05-06' }, NOW)
  assert.deepEqual([in31.status, in31.daysLeft], ['ok', 31])
  // Denetimlerin en geç günü sistemden önceki günü geçer; sıra önemli değil.
  const latest = maintenancePlanSchedule(
    {
      periodMonths: 6,
      previousDoneDate: '2025-01-10',
      inspectionDates: ['2026-09-01', '2026-04-01'],
    },
    NOW,
  )
  assert.deepEqual([latest.lastDoneDate, latest.nextDueDate], ['2026-09-01', '2027-03-01'])
  // `now` Europe/Istanbul gününe çevrilir: 2026-10-05T22:30Z İstanbul'da 6 Ekim'dir.
  assert.equal(
    maintenancePlanSchedule(
      { periodMonths: 12, previousDoneDate: '2025-10-06' },
      new Date('2026-10-05T22:30:00.000Z'),
    ).daysLeft,
    0,
  )
  assert.equal(isMaintenancePlanAttention('never'), true)
  assert.equal(isMaintenancePlanAttention('ok'), false)
})

test('DOM-FIN-092: plan şeması; periyot ve yasal işaret boşsa türün önerisi (K-252)', () => {
  const asansor = planMaintenancePlan(parsePlan(), { today: TODAY })
  assert.equal(asansor.periodMonths, 12)
  assert.equal(asansor.isLegal, true)
  assert.equal(asansor.responsible, null)
  const sondurucu = planMaintenancePlan(parsePlan({ type: 'fire_extinguisher' }), { today: TODAY })
  assert.equal(sondurucu.periodMonths, 6)
  const diger = planMaintenancePlan(parsePlan({ type: 'other' }), { today: TODAY })
  assert.equal(diger.isLegal, false)
  const elle = planMaintenancePlan(parsePlan({ periodMonths: 3, isLegal: false }), {
    today: TODAY,
  })
  assert.deepEqual([elle.periodMonths, elle.isLegal], [3, false])
  for (const type of MAINTENANCE_PLAN_TYPES)
    assert.ok(MAINTENANCE_PLAN_TYPE_DEFAULTS[type].periodMonths >= 1)
  assert.equal(parsePlan({ assetTagNumber: ' db-2026-0001 ' }).assetTagNumber, 'DB-2026-0001')
  assert.equal(parsePlan({ assetTagNumber: '' }).assetTagNumber, null)
})

test('DOM-FIN-092: plan şemasında doğrulama hataları', () => {
  for (const input of [
    { name: 'A' },
    { type: 'pool' },
    { location: 'x' },
    { periodMonths: 0 },
    { periodMonths: 61 },
    { periodMonths: 1.5 },
    { lastDoneDate: '2026-13-01' },
    { assetTagNumber: 'DB-2026-0001!' },
    { responsible: { type: 'staff', membershipId: '' } },
    { responsible: { type: 'supplier', supplierId: 'yok' } },
    { institutionId: 'b' },
  ])
    assert.equal(maintenancePlanSchema.safeParse({ ...PLAN, ...input }).success, false)
  assert.equal(updateMaintenancePlanSchema.safeParse({}).success, false)
  assert.equal(updateMaintenancePlanSchema.safeParse({ periodMonths: null }).success, false)
  assert.equal(updateMaintenancePlanSchema.safeParse({ responsible: null }).success, true)
})

test('DOM-FIN-092: plan bağlantı kuralları (demirbaş, kampüs, gün, sorumlu)', () => {
  const tagged = parsePlan({ assetTagNumber: 'DB-2026-0001' })
  assert.throws(
    () => planMaintenancePlan(tagged, { today: TODAY, asset: null }),
    isDomainError('maintenance_plan_asset_not_found'),
  )
  assert.throws(
    () => planMaintenancePlan(tagged, { today: TODAY, asset: { status: 'scrapped' } }),
    isDomainError('maintenance_plan_asset_scrapped'),
  )
  assert.equal(
    planMaintenancePlan(tagged, { today: TODAY, asset: { status: 'broken' } }).assetTagNumber,
    'DB-2026-0001',
  )
  assert.throws(
    () => planMaintenancePlan(parsePlan({ campusId: 'b1' }), { today: TODAY, campusFound: false }),
    isDomainError('maintenance_plan_campus_not_found'),
  )
  assert.throws(
    () => planMaintenancePlan(parsePlan({ lastDoneDate: '2026-10-07' }), { today: TODAY }),
    isDomainError('maintenance_plan_date_in_future'),
  )
  assert.equal(
    planMaintenancePlan(parsePlan({ lastDoneDate: TODAY }), { today: TODAY }).lastDoneDate,
    TODAY,
  )
  const staff = parsePlan({ responsible: { type: 'staff', membershipId: 'm1' } })
  assert.throws(
    () => planMaintenancePlan(staff, { today: TODAY, staff: null }),
    isDomainError('maintenance_plan_responsible_not_found'),
  )
  assert.throws(
    () => planMaintenancePlan(staff, { today: TODAY, staff: { role: 'veli', active: true } }),
    isDomainError('maintenance_plan_responsible_not_staff'),
  )
  assert.throws(
    () => planMaintenancePlan(staff, { today: TODAY, staff: { role: 'onburo', active: false } }),
    isDomainError('maintenance_plan_responsible_inactive'),
  )
  assert.ok(planMaintenancePlan(staff, { today: TODAY, staff: { role: 'ogretmen', active: true } }))
  const supplier = parsePlan({ responsible: { type: 'supplier', supplierId: SUPPLIER } })
  assert.throws(
    () => planMaintenancePlan(supplier, { today: TODAY }),
    isDomainError('maintenance_plan_supplier_not_found'),
  )
  assert.throws(
    () => planMaintenancePlan(supplier, { today: TODAY, supplier: { isActive: false } }),
    isDomainError('maintenance_plan_supplier_inactive'),
  )
  assert.ok(planMaintenancePlan(supplier, { today: TODAY, supplier: { isActive: true } }))
})

test('DOM-FIN-092: düzeltme yalnız değişen alanları denetler; değişiklik yoksa 422', () => {
  const update = (input: Record<string, unknown>) => updateMaintenancePlanSchema.parse(input)
  assert.throws(
    () => planMaintenancePlanUpdate(CURRENT, update({ name: CURRENT.name }), { today: TODAY }),
    isDomainError('maintenance_plan_unchanged'),
  )
  assert.deepEqual(
    planMaintenancePlanUpdate(CURRENT, update({ periodMonths: 6, name: CURRENT.name }), {
      today: TODAY,
    }),
    ['periodMonths'],
  )
  // Tür değişikliği periyodu değiştirmez; yalnız tür değişir.
  assert.deepEqual(
    planMaintenancePlanUpdate(CURRENT, update({ type: 'generator' }), { today: TODAY }),
    ['type'],
  )
  // Değişmeyen sorumlu yeniden denetlenmez (pasifleşmiş olsa bile).
  const withSupplier = {
    ...CURRENT,
    responsible: { type: 'supplier' as const, supplierId: SUPPLIER },
  }
  assert.deepEqual(
    planMaintenancePlanUpdate(
      withSupplier,
      update({ responsible: { type: 'supplier', supplierId: SUPPLIER }, location: 'B blok' }),
      { today: TODAY },
    ),
    ['location'],
  )
  assert.throws(
    () =>
      planMaintenancePlanUpdate(CURRENT, update({ lastDoneDate: '2026-12-01' }), {
        today: TODAY,
      }),
    isDomainError('maintenance_plan_date_in_future'),
  )
  assert.deepEqual(
    planMaintenancePlanUpdate(withSupplier, update({ responsible: null }), { today: TODAY }),
    ['responsible'],
  )
  assert.throws(
    () =>
      planMaintenancePlanUpdate(CURRENT, update({ assetTagNumber: 'DB-2026-0002' }), {
        today: TODAY,
        asset: null,
      }),
    isDomainError('maintenance_plan_asset_not_found'),
  )
})

test('DOM-FIN-092: denetim kaydı; gün, aynı gün mükerrer, uygunsuzlukta not zorunlu (K-254)', () => {
  const pass = maintenanceInspectionSchema.parse(INSPECTION)
  assert.deepEqual(planMaintenanceInspection(pass, { today: TODAY, sameDayExists: false }), {
    ...INSPECTION,
    documentNumber: null,
    note: null,
  })
  assert.throws(
    () =>
      planMaintenanceInspection(
        maintenanceInspectionSchema.parse({ ...INSPECTION, doneDate: '2026-10-07' }),
        { today: TODAY, sameDayExists: false },
      ),
    isDomainError('maintenance_inspection_date_in_future'),
  )
  assert.throws(
    () => planMaintenanceInspection(pass, { today: TODAY, sameDayExists: true }),
    isDomainError('maintenance_inspection_exists', 'conflict'),
  )
  const failNoNote = maintenanceInspectionSchema.safeParse({ ...INSPECTION, result: 'fail' })
  assert.equal(failNoNote.success, false)
  assert.deepEqual(failNoNote.error?.issues[0]?.path, ['note'])
  assert.equal(
    maintenanceInspectionSchema.safeParse({ ...INSPECTION, result: 'partial', note: 'kısa' })
      .success,
    false,
  )
  assert.equal(
    maintenanceInspectionSchema.safeParse({ ...INSPECTION, performedBy: 'A' }).success,
    false,
  )
  assert.equal(
    maintenanceInspectionSchema.parse({ ...INSPECTION, documentNumber: '  ' }).documentNumber,
    null,
  )
  assert.equal(maintenanceInspectionCancelSchema.safeParse({ reason: 'kısa' }).success, false)
  planMaintenanceInspectionCancel({ cancelledAt: null })
  assert.throws(
    () => planMaintenanceInspectionCancel({ cancelledAt: '2026-10-06T09:00:00.000Z' }),
    isDomainError('maintenance_inspection_cancelled'),
  )
})

test('DOM-FIN-092: uygunsuz denetimden arıza talebi taslağı; uygun, iptal ve bağlı denetim reddedilir (K-254)', () => {
  const plan = { name: 'A blok asansörü', type: 'elevator' as const }
  const inspection = {
    doneDate: TODAY,
    performedBy: 'Beta Muayene A.Ş.',
    result: 'fail' as const,
    documentNumber: 'PK-2026-117',
    note: 'Kabin kapı kilidi arızalı.',
    cancelledAt: null,
    maintenanceRequestId: null,
  }
  assert.deepEqual(maintenanceRequestFromInspection(plan, inspection), {
    title: 'Denetim uygunsuzluğu: A blok asansörü',
    description:
      'Asansör periyodik denetimi, 2026-10-06, Beta Muayene A.Ş., belge no PK-2026-117. Sonuç: Uygunsuz. Kabin kapı kilidi arızalı.',
    priority: 'urgent',
  })
  const partial = maintenanceRequestFromInspection(plan, {
    ...inspection,
    result: 'partial',
    documentNumber: null,
  })
  assert.equal(partial.priority, 'normal')
  assert.ok(!partial.description.includes('belge no'))
  const long = maintenanceRequestFromInspection({ ...plan, name: 'x'.repeat(120) }, inspection)
  assert.equal(long.title.length, 120)
  assert.ok(long.title.endsWith('…'))
  assert.throws(
    () => maintenanceRequestFromInspection(plan, { ...inspection, result: 'pass' }),
    isDomainError('maintenance_inspection_passed'),
  )
  assert.throws(
    () =>
      maintenanceRequestFromInspection(plan, {
        ...inspection,
        cancelledAt: '2026-10-06T10:00:00.000Z',
      }),
    isDomainError('maintenance_inspection_cancelled'),
  )
  assert.throws(
    () => maintenanceRequestFromInspection(plan, { ...inspection, maintenanceRequestId: 'r1' }),
    isDomainError('maintenance_inspection_request_exists', 'conflict'),
  )
})

test('DOM-FIN-092: yönetici yazar, ön büro okur (K-255)', () => {
  assert.equal(canManageMaintenancePlans('yonetici'), true)
  for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'])
    assert.equal(canManageMaintenancePlans(role), false)
})

test('DOM-FIN-092: plan CSV başlığı, satırı ve formül kaçışı (K-255)', () => {
  const csv = maintenancePlansCsv([
    {
      name: '=Kazan',
      type: 'boiler',
      isLegal: true,
      campusName: 'Merkez',
      location: 'Bodrum',
      assetTagNumber: null,
      periodMonths: 12,
      responsibleName: 'Beta Teknik',
      lastDoneDate: '2025-10-01',
      nextDueDate: '2026-10-01',
      status: 'overdue',
      daysLeft: -5,
    },
  ])
  const [header, row] = csv.trimEnd().split('\r\n')
  assert.ok(header?.startsWith('"Plan";"Tür";"Yasal"'))
  assert.equal(
    row,
    `"'=Kazan";"Kazan ve kalorifer";"Evet";"Merkez";"Bodrum";"";12;"Beta Teknik";"2025-10-01";"2026-10-01";"Gecikti";-5`,
  )
})
