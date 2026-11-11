import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canSeeMaintenanceCost,
  canTransition,
  maintenanceAssignSchema,
  maintenanceAssigneeLabel,
  maintenanceCancelSchema,
  maintenanceNoteSchema,
  maintenanceRequestActions,
  maintenanceRequestNumber,
  maintenanceRequestSchema,
  maintenanceResolveSchema,
  maintenanceTransition,
  maintenanceVisibility,
  MAINTENANCE_STATUSES,
  planMaintenanceAssign,
  planMaintenanceCancel,
  planMaintenanceRequest,
  planMaintenanceResolve,
  type MaintenanceAssignChecks,
  type MaintenanceRequestInput,
  type MaintenanceResolveChecks,
  type MaintenanceStatus,
} from '../packages/school-core/src/lib/finance-maintenance-requests.ts'

import { isDomainError } from './support/domain-error.ts'

// Arıza ve bakım talebi (DOM-FIN-089; ON-239). Bugün 2026-10-06.

const TODAY = '2026-10-06'
const REPORT: MaintenanceRequestInput = {
  title: 'Projektör açılmıyor',
  description: 'Güç düğmesine basınca ışık yanmıyor.',
  location: '2. kat 5-A sınıfı',
}
const SUPPLIER = '6b0d3c1e-0a4e-4d8f-9a55-0b3e1c2d4f60'
const parseReport = (input: MaintenanceRequestInput) => maintenanceRequestSchema.parse(input)
const assignChecks = (
  overrides: Partial<MaintenanceAssignChecks> = {},
): MaintenanceAssignChecks => ({
  current: null,
  staff: { role: 'ogretmen', active: true },
  supplier: { isActive: true },
  ...overrides,
})
const resolveChecks = (
  overrides: Partial<MaintenanceResolveChecks> = {},
): MaintenanceResolveChecks => ({ today: TODAY, reportedDate: '2026-10-01', ...overrides })
const RESOLVE = { resolvedDate: '2026-10-05', resolution: 'Lamba değiştirildi.' }

test('DOM-FIN-089: bildirim şeması başlık, açıklama ve yer ister; etiket büyük harfe çevrilir, öncelik normal (K-236)', () => {
  const parsed = parseReport({ ...REPORT, assetTagNumber: ' db-2026-0001 ' })
  assert.equal(parsed.assetTagNumber, 'DB-2026-0001')
  assert.equal(parsed.priority, 'normal')
  assert.equal(parsed.campusId, null)
  assert.equal(parseReport({ ...REPORT, assetTagNumber: '  ' }).assetTagNumber, null)
  assert.equal(parseReport(REPORT).assetTagNumber, null)
  for (const bad of [
    { ...REPORT, title: 'ab' },
    { ...REPORT, description: 'kısa' },
    { ...REPORT, location: 'A' },
    { ...REPORT, priority: 'critical' },
    { ...REPORT, assetTagNumber: 'ÇÖP' },
    { ...REPORT, institutionId: 'b' },
  ])
    assert.equal(maintenanceRequestSchema.safeParse(bad).success, false, JSON.stringify(bad))
})

test('DOM-FIN-089: etiketli bildirim kurumun hurdaya ayrılmamış demirbaşını ister (K-236)', () => {
  const tagged = parseReport({ ...REPORT, assetTagNumber: 'DB-2026-0001' })
  assert.deepEqual(planMaintenanceRequest(tagged, { asset: { status: 'broken' } }), tagged)
  assert.throws(
    () => planMaintenanceRequest(tagged, { asset: null }),
    isDomainError('maintenance_asset_not_found'),
  )
  assert.throws(
    () => planMaintenanceRequest(tagged, {}),
    isDomainError('maintenance_asset_not_found'),
  )
  assert.throws(
    () => planMaintenanceRequest(tagged, { asset: { status: 'scrapped' } }),
    isDomainError('maintenance_asset_scrapped'),
  )
  const campus = parseReport({ ...REPORT, campusId: 'kadikoy' })
  assert.throws(
    () => planMaintenanceRequest(campus, { campusFound: false }),
    isDomainError('maintenance_campus_not_found'),
  )
  assert.equal(planMaintenanceRequest(campus, { campusFound: true }).campusId, 'kadikoy')
  assert.equal(planMaintenanceRequest(parseReport(REPORT), {}).assetTagNumber, null)
})

test('DOM-FIN-089: geçiş tablosu open → assigned → in_progress → resolved → closed; iptal açık taleplerde (K-237)', () => {
  assert.equal(maintenanceTransition('open', 'assign'), 'assigned')
  assert.equal(maintenanceTransition('assigned', 'assign'), 'assigned')
  assert.equal(maintenanceTransition('in_progress', 'assign'), 'in_progress')
  assert.equal(maintenanceTransition('assigned', 'start'), 'in_progress')
  assert.equal(maintenanceTransition('assigned', 'resolve'), 'resolved')
  assert.equal(maintenanceTransition('in_progress', 'resolve'), 'resolved')
  assert.equal(maintenanceTransition('resolved', 'close'), 'closed')
  for (const status of ['open', 'assigned', 'in_progress'] as const)
    assert.equal(maintenanceTransition(status, 'cancel'), 'cancelled')
  const allowed: Record<string, readonly MaintenanceStatus[]> = {
    assign: ['open', 'assigned', 'in_progress'],
    start: ['assigned'],
    resolve: ['assigned', 'in_progress'],
    close: ['resolved'],
    cancel: ['open', 'assigned', 'in_progress'],
  }
  for (const [action, from] of Object.entries(allowed))
    for (const status of MAINTENANCE_STATUSES) {
      const verb = action as 'assign' | 'start' | 'resolve' | 'close' | 'cancel'
      assert.equal(canTransition(status, verb), from.includes(status), `${action} ${status}`)
      if (!from.includes(status))
        assert.throws(
          () => maintenanceTransition(status, verb),
          isDomainError('maintenance_status_invalid'),
        )
    }
})

test('DOM-FIN-089: atama etkin personel ya da etkin tedarikçi ister; aynı sorumlu reddedilir (K-237)', () => {
  const staff = maintenanceAssignSchema.parse({ assigneeType: 'staff', membershipId: 'm-1' })
  assert.deepEqual(planMaintenanceAssign('open', staff, assignChecks()), {
    status: 'assigned',
    assigneeType: 'staff',
    membershipId: 'm-1',
    supplierId: null,
    note: null,
  })
  const supplier = maintenanceAssignSchema.parse({
    assigneeType: 'supplier',
    supplierId: SUPPLIER,
    note: ' Servis yarın gelir ',
  })
  const planned = planMaintenanceAssign('in_progress', supplier, assignChecks())
  assert.equal(planned.status, 'in_progress')
  assert.equal(planned.supplierId, SUPPLIER)
  assert.equal(planned.membershipId, null)
  assert.equal(planned.note, 'Servis yarın gelir')
  const cases: [Partial<MaintenanceAssignChecks>, typeof staff, string][] = [
    [{ staff: null }, staff, 'maintenance_assignee_not_found'],
    [{ staff: undefined }, staff, 'maintenance_assignee_not_found'],
    [{ staff: { role: 'veli', active: true } }, staff, 'maintenance_assignee_not_staff'],
    [{ staff: { role: 'onburo', active: false } }, staff, 'maintenance_assignee_inactive'],
    [{ supplier: null }, supplier, 'maintenance_supplier_not_found'],
    [{ supplier: { isActive: false } }, supplier, 'maintenance_supplier_inactive'],
    [
      { current: { assigneeType: 'staff', membershipId: 'm-1', supplierId: null } },
      staff,
      'maintenance_same_assignee',
    ],
  ]
  for (const [overrides, input, code] of cases)
    assert.throws(
      () => planMaintenanceAssign('open', input, assignChecks(overrides)),
      isDomainError(code),
    )
  assert.equal(
    planMaintenanceAssign(
      'assigned',
      staff,
      assignChecks({
        current: { assigneeType: 'supplier', membershipId: null, supplierId: SUPPLIER },
      }),
    ).membershipId,
    'm-1',
  )
  assert.throws(
    () => planMaintenanceAssign('resolved', staff, assignChecks()),
    isDomainError('maintenance_status_invalid'),
  )
  for (const bad of [
    { assigneeType: 'staff', membershipId: ' ' },
    { assigneeType: 'supplier', supplierId: 'x' },
    { assigneeType: 'vendor', supplierId: SUPPLIER },
  ])
    assert.equal(maintenanceAssignSchema.safeParse(bad).success, false, JSON.stringify(bad))
})

test('DOM-FIN-089: çözüm günü bildirimden önce ve bugünden sonra olamaz; maliyet ve tedarikçi isteğe bağlı (K-237)', () => {
  const plain = maintenanceResolveSchema.parse(RESOLVE)
  assert.equal(plain.costCents, null)
  assert.equal(plain.supplierId, null)
  assert.equal(planMaintenanceResolve('in_progress', plain, resolveChecks()), 'resolved')
  const full = maintenanceResolveSchema.parse({
    ...RESOLVE,
    costCents: 125_000,
    supplierId: SUPPLIER,
  })
  assert.equal(
    planMaintenanceResolve('assigned', full, resolveChecks({ supplier: { isActive: false } })),
    'resolved',
  )
  assert.throws(
    () => planMaintenanceResolve('assigned', full, resolveChecks({ supplier: null })),
    isDomainError('maintenance_supplier_not_found'),
  )
  assert.throws(
    () => planMaintenanceResolve('assigned', full, resolveChecks()),
    isDomainError('maintenance_supplier_not_found'),
  )
  assert.throws(
    () =>
      planMaintenanceResolve(
        'assigned',
        maintenanceResolveSchema.parse({ ...RESOLVE, resolvedDate: '2026-10-07' }),
        resolveChecks(),
      ),
    isDomainError('maintenance_date_in_future'),
  )
  assert.throws(
    () =>
      planMaintenanceResolve(
        'assigned',
        maintenanceResolveSchema.parse({ ...RESOLVE, resolvedDate: '2026-09-30' }),
        resolveChecks(),
      ),
    isDomainError('maintenance_resolved_before_report'),
  )
  assert.throws(
    () => planMaintenanceResolve('open', plain, resolveChecks()),
    isDomainError('maintenance_status_invalid'),
  )
  for (const bad of [
    { ...RESOLVE, resolution: 'iyi' },
    { ...RESOLVE, costCents: 0 },
    { ...RESOLVE, costCents: 12.5 },
    { ...RESOLVE, costCents: 1_000_000_001 },
    { ...RESOLVE, resolvedDate: '2026-02-30' },
  ])
    assert.equal(maintenanceResolveSchema.safeParse(bad).success, false, JSON.stringify(bad))
})

test('DOM-FIN-089: yönetici açık talepleri iptal eder; bildiren yalnız kendi atanmamış bildirimini (K-237)', () => {
  const manager = { userId: 'u-admin', role: 'yonetici' }
  const desk = { userId: 'u-desk', role: 'onburo' }
  const own = { status: 'open' as const, reportedByUserId: 'u-desk' }
  assert.equal(planMaintenanceCancel(own, desk), 'cancelled')
  assert.equal(planMaintenanceCancel({ ...own, status: 'in_progress' }, manager), 'cancelled')
  assert.throws(
    () => planMaintenanceCancel({ ...own, reportedByUserId: 'u-other' }, desk),
    isDomainError('maintenance_not_owner', 'forbidden'),
  )
  assert.throws(
    () => planMaintenanceCancel({ ...own, status: 'assigned' }, desk),
    isDomainError('maintenance_not_cancellable'),
  )
  assert.throws(
    () => planMaintenanceCancel({ ...own, status: 'resolved' }, manager),
    isDomainError('maintenance_status_invalid'),
  )
  assert.equal(maintenanceCancelSchema.safeParse({ reason: 'yok' }).success, false)
  assert.equal(
    maintenanceCancelSchema.parse({ reason: ' Yanlış bildirim ' }).reason,
    'Yanlış bildirim',
  )
  assert.equal(maintenanceNoteSchema.parse({}).note, null)
  assert.equal(maintenanceNoteSchema.safeParse({ note: 'x'.repeat(501) }).success, false)
})

test('DOM-FIN-089: rol kapsamı, maliyet görünürlüğü ve ekran işlemleri (K-238)', () => {
  assert.equal(maintenanceVisibility('yonetici'), 'all')
  assert.equal(maintenanceVisibility('onburo'), 'all')
  assert.equal(maintenanceVisibility('ogretmen'), 'own')
  assert.equal(canSeeMaintenanceCost('yonetici'), true)
  assert.equal(canSeeMaintenanceCost('onburo'), false)
  assert.equal(canSeeMaintenanceCost('ogretmen'), false)
  const open = { status: 'open' as const, reportedByUserId: 'u-teacher' }
  assert.deepEqual(maintenanceRequestActions(open, { userId: 'u-admin', role: 'yonetici' }), {
    assign: true,
    start: false,
    resolve: false,
    close: false,
    cancel: true,
  })
  assert.deepEqual(maintenanceRequestActions(open, { userId: 'u-teacher', role: 'ogretmen' }), {
    assign: false,
    start: false,
    resolve: false,
    close: false,
    cancel: true,
  })
  assert.equal(maintenanceRequestActions(open, { userId: 'u-desk', role: 'onburo' }).cancel, false)
  assert.equal(
    maintenanceRequestActions(
      { ...open, status: 'assigned' },
      { userId: 'u-teacher', role: 'ogretmen' },
    ).cancel,
    false,
  )
  assert.deepEqual(
    maintenanceRequestActions(
      { ...open, status: 'resolved' },
      { userId: 'u-admin', role: 'yonetici' },
    ),
    { assign: false, start: false, resolve: false, close: true, cancel: false },
  )
})

test('DOM-FIN-089: talep numarası ve sorumlu etiketi', () => {
  assert.equal(maintenanceRequestNumber(7), 'AT-0007')
  assert.equal(maintenanceRequestNumber(12345), 'AT-12345')
  assert.equal(
    maintenanceAssigneeLabel({ assigneeType: 'staff', name: 'Selin Kaya' }),
    'Selin Kaya',
  )
  assert.equal(maintenanceAssigneeLabel({ assigneeType: 'staff', name: null }), 'Personel')
  assert.equal(
    maintenanceAssigneeLabel({ assigneeType: 'supplier', name: 'Teknik Servis Ltd.' }),
    'Teknik Servis Ltd. (tedarikçi)',
  )
  assert.equal(maintenanceAssigneeLabel({ assigneeType: 'supplier', name: null }), 'Tedarikçi')
})
