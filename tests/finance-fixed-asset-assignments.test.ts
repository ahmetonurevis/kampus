import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fixedAssetAssignmentSchema,
  fixedAssetHolderLabel,
  fixedAssetReturnSchema,
  planFixedAssetAssignment,
  planFixedAssetReturn,
  type FixedAssetAssignmentChecks,
  type FixedAssetAssignmentInput,
} from '../packages/school-core/src/lib/finance-fixed-asset-assignments.ts'
import { planFixedAssetScrap } from '../packages/school-core/src/lib/finance-fixed-assets.ts'

import { isDomainError } from './support/domain-error.ts'

// Demirbaş zimmeti (DOM-FIN-086; ON-236). Bugün 2026-10-06.

const TODAY = '2026-10-06'
const STAFF: FixedAssetAssignmentInput = {
  assigneeType: 'staff',
  membershipId: 'm-selin',
  assignedDate: '2026-09-10',
}
const ROOM: FixedAssetAssignmentInput = {
  assigneeType: 'location',
  campusId: 'kadikoy',
  location: '2. kat fen laboratuvarı',
  assignedDate: '2026-09-10',
}
const checks = (
  overrides: Partial<FixedAssetAssignmentChecks> = {},
): FixedAssetAssignmentChecks => ({
  today: TODAY,
  asset: { status: 'in_use', acquisitionDate: '2026-09-01' },
  hasOpenAssignment: false,
  lastReturnDate: null,
  staff: { role: 'ogretmen', active: true },
  campusFound: true,
  ...overrides,
})
const plan = (
  input: FixedAssetAssignmentInput,
  overrides: Partial<FixedAssetAssignmentChecks> = {},
) => planFixedAssetAssignment(fixedAssetAssignmentSchema.parse(input), checks(overrides))

test('DOM-FIN-086: zimmet şeması personel ya da konum ister; not kırpılır, boş not null olur (K-210)', () => {
  const staff = fixedAssetAssignmentSchema.parse({ ...STAFF, note: '  ' })
  assert.equal(staff.note, null)
  const room = fixedAssetAssignmentSchema.parse({
    ...ROOM,
    campusId: undefined,
    note: ' Projektör ',
  })
  assert.equal(room.assigneeType === 'location' ? room.campusId : 'x', null)
  assert.equal(room.note, 'Projektör')
  for (const bad of [
    { ...STAFF, membershipId: ' ' },
    { ...STAFF, location: 'Oda 1' },
    { ...ROOM, location: 'A' },
    { ...ROOM, membershipId: 'm-selin' },
    { ...STAFF, assigneeType: 'student' },
    { ...STAFF, assignedDate: '2026-02-30' },
    { ...STAFF, note: 'x'.repeat(501) },
    { ...STAFF, institutionId: 'b' },
  ])
    assert.equal(fixedAssetAssignmentSchema.safeParse(bad).success, false, JSON.stringify(bad))
})

test('DOM-FIN-086: personele zimmet etkin personel üyeliğine verilir; konum ve kampüs boş kalır (K-210)', () => {
  assert.deepEqual(plan({ ...STAFF, note: 'Şarj aletiyle' }), {
    assigneeType: 'staff',
    membershipId: 'm-selin',
    campusId: null,
    location: null,
    assignedDate: '2026-09-10',
    note: 'Şarj aletiyle',
  })
  for (const role of ['yonetici', 'onburo', 'ogretmen'])
    assert.equal(plan(STAFF, { staff: { role, active: true } }).membershipId, 'm-selin')
  assert.throws(() => plan(STAFF, { staff: null }), isDomainError('fixed_asset_assignee_not_found'))
  assert.throws(
    () => plan(STAFF, { staff: undefined }),
    isDomainError('fixed_asset_assignee_not_found'),
  )
  for (const role of ['ogrenci', 'veli'])
    assert.throws(
      () => plan(STAFF, { staff: { role, active: true } }),
      isDomainError('fixed_asset_assignee_not_staff'),
    )
  assert.throws(
    () => plan(STAFF, { staff: { role: 'ogretmen', active: false } }),
    isDomainError('fixed_asset_assignee_inactive'),
  )
})

test('DOM-FIN-086: konuma zimmet kampüs ve oda taşır; olmayan kampüs reddedilir (K-210)', () => {
  assert.deepEqual(plan(ROOM, { staff: undefined }), {
    assigneeType: 'location',
    membershipId: null,
    campusId: 'kadikoy',
    location: '2. kat fen laboratuvarı',
    assignedDate: '2026-09-10',
    note: null,
  })
  assert.equal(plan({ ...ROOM, campusId: null }, { campusFound: false }).campusId, null)
  assert.throws(
    () => plan(ROOM, { campusFound: false }),
    isDomainError('fixed_asset_campus_not_found'),
  )
})

test('DOM-FIN-086: tek açık zimmet; hurdaya ayrılmış demirbaşa zimmet verilmez (K-211, K-213)', () => {
  assert.throws(
    () => plan(STAFF, { hasOpenAssignment: true }),
    isDomainError('fixed_asset_already_assigned', 'conflict'),
  )
  assert.throws(
    () => plan(ROOM, { asset: { status: 'scrapped', acquisitionDate: '2026-09-01' } }),
    isDomainError('fixed_asset_scrapped'),
  )
  for (const status of ['in_storage', 'broken'] as const)
    assert.equal(
      plan(STAFF, { asset: { status, acquisitionDate: '2026-09-01' } }).assigneeType,
      'staff',
    )
})

test('DOM-FIN-086: zimmet günü alım ve son iade gününden önce, bugünden sonra olamaz (K-211)', () => {
  assert.equal(plan({ ...STAFF, assignedDate: TODAY }).assignedDate, TODAY)
  assert.equal(plan({ ...STAFF, assignedDate: '2026-09-01' }).assignedDate, '2026-09-01')
  assert.throws(
    () => plan({ ...STAFF, assignedDate: '2026-10-07' }),
    isDomainError('fixed_asset_date_in_future'),
  )
  assert.throws(
    () => plan({ ...STAFF, assignedDate: '2026-08-31' }),
    isDomainError('fixed_asset_assignment_before_acquisition'),
  )
  // Devir aynı gün yapılabilir: iade günü yeni zimmet gününe eşit olabilir.
  assert.equal(plan(STAFF, { lastReturnDate: '2026-09-10' }).assignedDate, '2026-09-10')
  assert.throws(
    () => plan(STAFF, { lastReturnDate: '2026-09-11' }),
    isDomainError('fixed_asset_assignment_before_return'),
  )
})

test('DOM-FIN-086: iade bir kez yapılır; hasarlı iadede not zorunlu; gün aralığı denetlenir (K-212)', () => {
  const open = { assignedDate: '2026-09-10', returnDate: null }
  assert.doesNotThrow(() => planFixedAssetReturn(open, { returnDate: TODAY }, TODAY))
  assert.doesNotThrow(() => planFixedAssetReturn(open, { returnDate: '2026-09-10' }, TODAY))
  assert.throws(
    () => planFixedAssetReturn({ ...open, returnDate: '2026-09-20' }, { returnDate: TODAY }, TODAY),
    isDomainError('fixed_asset_assignment_returned'),
  )
  assert.throws(
    () => planFixedAssetReturn(open, { returnDate: '2026-10-07' }, TODAY),
    isDomainError('fixed_asset_date_in_future'),
  )
  assert.throws(
    () => planFixedAssetReturn(open, { returnDate: '2026-09-09' }, TODAY),
    isDomainError('fixed_asset_return_before_assignment'),
  )
  assert.deepEqual(fixedAssetReturnSchema.parse({ returnDate: TODAY, condition: 'intact' }), {
    returnDate: TODAY,
    condition: 'intact',
    note: null,
  })
  const damaged = fixedAssetReturnSchema.safeParse({
    returnDate: TODAY,
    condition: 'damaged',
    note: 'kır',
  })
  assert.equal(damaged.success, false)
  assert.deepEqual(damaged.error?.issues[0]?.path, ['note'])
  assert.equal(
    fixedAssetReturnSchema.parse({ returnDate: TODAY, condition: 'damaged', note: 'Ekran çizik' })
      .note,
    'Ekran çizik',
  )
  assert.equal(
    fixedAssetReturnSchema.safeParse({ returnDate: TODAY, condition: 'lost' }).success,
    false,
  )
})

test('DOM-FIN-086: zimmetli demirbaş hurdaya ayrılmaz; hurda günü son iadeden önce olamaz (K-213)', () => {
  const asset = { status: 'in_use' as const, acquisitionDate: '2026-09-01' }
  assert.throws(
    () =>
      planFixedAssetScrap(asset, { scrapDate: TODAY }, TODAY, {
        hasOpenAssignment: true,
        lastReturnDate: null,
      }),
    isDomainError('fixed_asset_assigned'),
  )
  assert.throws(
    () =>
      planFixedAssetScrap(asset, { scrapDate: '2026-09-15' }, TODAY, {
        hasOpenAssignment: false,
        lastReturnDate: '2026-09-20',
      }),
    isDomainError('fixed_asset_scrap_before_return'),
  )
  assert.doesNotThrow(() =>
    planFixedAssetScrap(asset, { scrapDate: '2026-09-20' }, TODAY, {
      hasOpenAssignment: false,
      lastReturnDate: '2026-09-20',
    }),
  )
  assert.doesNotThrow(() => planFixedAssetScrap(asset, { scrapDate: TODAY }, TODAY))
})

test('DOM-FIN-086: teslim alan etiketi personel adı ya da kampüs · konum', () => {
  const base = { staffName: null, campusName: null, location: null }
  assert.equal(
    fixedAssetHolderLabel({ ...base, assigneeType: 'staff', staffName: 'Selin Kaya' }),
    'Selin Kaya',
  )
  assert.equal(fixedAssetHolderLabel({ ...base, assigneeType: 'staff' }), 'Personel')
  assert.equal(
    fixedAssetHolderLabel({
      ...base,
      assigneeType: 'location',
      campusName: 'Kadıköy Kampüsü',
      location: 'Oda 12',
    }),
    'Kadıköy Kampüsü · Oda 12',
  )
  assert.equal(
    fixedAssetHolderLabel({ ...base, assigneeType: 'location', location: 'Oda 12' }),
    'Oda 12',
  )
})
