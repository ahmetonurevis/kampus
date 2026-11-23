import assert from 'node:assert/strict'
import test from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  assertAssignmentRange,
  assertAssignmentStaff,
  assertHeadcount,
  assertPositionArchivable,
  assertPositionUnit,
  assertReportingLine,
  assertUniqueName,
  assertUnitDeactivation,
  assertUnitPlacement,
  assignmentState,
  buildOrgTree,
  FINANCE_ORG_CHART_ROLES,
  flattenOrgTree,
  maxConcurrent,
  ORG_UNIT_DEPTH_MAX,
  orgAssignmentInputSchema,
  orgAssignmentUpdateSchema,
  orgNameKey,
  orgPositionInputSchema,
  orgPositionUpdateSchema,
  orgUnitInputSchema,
  orgUnitUpdateSchema,
  positionFill,
  rangesOverlap,
  unitPath,
  type OrgUnitNode,
} from '../packages/school-core/src/lib/finance-org-chart.ts'

/** Organizasyon şeması kuralları (DOM-FIN-129; ON-187; K-442…K-444). */

const UNIT = '00000000-0000-4000-8000-000000000001'

function codeOf(fn: () => unknown): string | null {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof DomainError)
    return error.code
  }
  return null
}

function kindOf(fn: () => unknown): string | null {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof DomainError)
    return error.kind
  }
  return null
}

const unit = (id: string, parentId: string | null, isActive = true): OrgUnitNode => ({
  id,
  parentId,
  isActive,
})

test('DOM-FIN-129 K-444: organizasyon şemasını yalnız yönetici okur ve yazar', () => {
  assert.deepEqual(FINANCE_ORG_CHART_ROLES, ['yonetici'])
})

test('DOM-FIN-129 K-442: birim şeması ad, tür ve üst birim; güncelleme en az bir alan', () => {
  const parsed = orgUnitInputSchema.parse({
    name: '  Matematik zümresi ',
    kind: 'academic_department',
  })
  assert.deepEqual(parsed, {
    name: 'Matematik zümresi',
    kind: 'academic_department',
    parentId: null,
  })
  assert.equal(orgUnitInputSchema.safeParse({ name: 'M', kind: 'support' }).success, false)
  assert.equal(orgUnitInputSchema.safeParse({ name: 'Mutfak', kind: 'kitchen' }).success, false)
  assert.equal(
    orgUnitInputSchema.safeParse({ name: 'Mutfak', kind: 'support', institutionId: 'b' }).success,
    false,
  )
  assert.equal(orgUnitUpdateSchema.safeParse({}).success, false)
  assert.deepEqual(orgUnitUpdateSchema.parse({ parentId: null }), { parentId: null })
  assert.deepEqual(orgUnitUpdateSchema.parse({ isActive: false }), { isActive: false })
})

test('DOM-FIN-129 K-442: aynı üst birimde aynı ad ve aynı birimde aynı unvan 409', () => {
  assert.equal(orgNameKey('  İDARİ İşler '), 'idari işler')
  assert.equal(
    codeOf(() =>
      assertUniqueName({ name: 'idari işler', siblings: ['İdari işler'], kind: 'unit' }),
    ),
    'org_unit_name_taken',
  )
  assert.equal(
    kindOf(() => assertUniqueName({ name: 'Müdür', siblings: ['müdür'], kind: 'position' })),
    'conflict',
  )
  assert.equal(
    codeOf(() => assertUniqueName({ name: 'Müdür', siblings: ['MÜDÜR'], kind: 'position' })),
    'org_position_title_taken',
  )
  assert.equal(
    codeOf(() => assertUniqueName({ name: 'Müdür', siblings: ['Müdür yardımcısı'], kind: 'unit' })),
    null,
  )
})

test('DOM-FIN-129 K-442: birim ağacında döngü engellenir', () => {
  // a → b → c (c en altta)
  const units = [unit('a', null), unit('b', 'a'), unit('c', 'b'), unit('d', null)]
  const place = (unitId: string | null, parentId: string | null) => () =>
    assertUnitPlacement({ unitId, parentId, active: true, units })
  assert.equal(codeOf(place('a', 'a')), 'org_unit_cycle')
  assert.equal(codeOf(place('a', 'c')), 'org_unit_cycle')
  assert.equal(codeOf(place('b', 'c')), 'org_unit_cycle')
  assert.equal(codeOf(place('c', 'a')), null)
  assert.equal(codeOf(place('a', 'd')), null)
  assert.equal(codeOf(place('a', null)), null)
  assert.equal(codeOf(place(null, 'c')), null)
  assert.equal(codeOf(place(null, 'yok')), 'org_unit_parent_not_found')
  // Bozuk veride (önceden oluşmuş döngü) zincir taraması sonsuza girmez.
  const broken = [unit('x', 'y'), unit('y', 'x'), unit('z', null)]
  assert.equal(
    codeOf(() => assertUnitPlacement({ unitId: 'z', parentId: 'x', active: true, units: broken })),
    null,
  )
})

test('DOM-FIN-129 K-442: derinlik sınırı alt dal yüksekliğiyle birlikte sayılır', () => {
  const chain = Array.from({ length: ORG_UNIT_DEPTH_MAX }, (_, index) =>
    unit(`u${String(index)}`, index === 0 ? null : `u${String(index - 1)}`),
  )
  const last = `u${String(ORG_UNIT_DEPTH_MAX - 1)}`
  assert.equal(
    codeOf(() => assertUnitPlacement({ unitId: null, parentId: last, active: true, units: chain })),
    'org_unit_too_deep',
  )
  assert.equal(
    codeOf(() => assertUnitPlacement({ unitId: null, parentId: 'u8', active: true, units: chain })),
    null,
  )
  // İki düzeyli dal (s → t) dokuzuncu düzeye taşınırsa 11 düzey olur.
  const withBranch = [...chain, unit('s', null), unit('t', 's')]
  assert.equal(
    codeOf(() =>
      assertUnitPlacement({ unitId: 's', parentId: 'u8', active: true, units: withBranch }),
    ),
    'org_unit_too_deep',
  )
  assert.equal(
    codeOf(() =>
      assertUnitPlacement({ unitId: 's', parentId: 'u7', active: true, units: withBranch }),
    ),
    null,
  )
})

test('DOM-FIN-129 K-442: etkin birim pasif üst birime bağlanmaz; pasife alma koşulları', () => {
  const units = [unit('a', null, false), unit('b', null)]
  assert.equal(
    codeOf(() => assertUnitPlacement({ unitId: 'b', parentId: 'a', active: true, units })),
    'org_unit_parent_inactive',
  )
  assert.equal(
    codeOf(() => assertUnitPlacement({ unitId: 'b', parentId: 'a', active: false, units })),
    null,
  )
  assert.equal(
    codeOf(() => assertUnitDeactivation({ activeChildren: 1, openAssignments: 0 })),
    'org_unit_has_active_children',
  )
  assert.equal(
    codeOf(() => assertUnitDeactivation({ activeChildren: 0, openAssignments: 2 })),
    'org_unit_has_assignments',
  )
  assert.equal(
    codeOf(() => assertUnitDeactivation({ activeChildren: 0, openAssignments: 0 })),
    null,
  )
})

test('DOM-FIN-129 K-443: pozisyon şeması ve birimi', () => {
  const parsed = orgPositionInputSchema.parse({ unitId: UNIT, title: ' Müdür ', headcount: 1 })
  assert.deepEqual(parsed, {
    unitId: UNIT,
    title: 'Müdür',
    headcount: 1,
    reportsToPositionId: null,
  })
  assert.equal(
    orgPositionInputSchema.safeParse({ unitId: UNIT, title: 'Müdür', headcount: 0 }).success,
    false,
  )
  assert.equal(
    orgPositionInputSchema.safeParse({ unitId: UNIT, title: 'Müdür', headcount: 1.5 }).success,
    false,
  )
  assert.equal(
    orgPositionInputSchema.safeParse({ unitId: UNIT, title: 'Müdür', headcount: 501 }).success,
    false,
  )
  assert.equal(orgPositionUpdateSchema.safeParse({}).success, false)
  assert.equal(orgPositionUpdateSchema.safeParse({ reportsToPositionId: null }).success, true)
  assert.equal(
    codeOf(() => assertPositionUnit(null)),
    'org_position_unit_not_found',
  )
  assert.equal(
    codeOf(() => assertPositionUnit({ isActive: false })),
    'org_unit_inactive',
  )
  assert.equal(
    codeOf(() => assertPositionUnit({ isActive: true })),
    null,
  )
})

test('DOM-FIN-129 K-443: raporlama hattında döngü engellenir', () => {
  // müdür ← yardımcı ← zümre başkanı
  const positions = [
    { id: 'mudur', reportsToPositionId: null },
    { id: 'yardimci', reportsToPositionId: 'mudur' },
    { id: 'zumre', reportsToPositionId: 'yardimci' },
  ]
  const line = (positionId: string | null, reportsToPositionId: string | null) => () =>
    assertReportingLine({ positionId, reportsToPositionId, positions })
  assert.equal(codeOf(line('mudur', 'mudur')), 'org_position_cycle')
  assert.equal(codeOf(line('mudur', 'zumre')), 'org_position_cycle')
  assert.equal(codeOf(line('yardimci', 'zumre')), 'org_position_cycle')
  assert.equal(codeOf(line('zumre', 'mudur')), null)
  assert.equal(codeOf(line(null, 'zumre')), null)
  assert.equal(codeOf(line('mudur', null)), null)
  assert.equal(codeOf(line('zumre', 'yok')), 'org_position_reports_to_not_found')
  assert.equal(
    codeOf(() => assertPositionArchivable({ reports: 1, openAssignments: 0 })),
    'org_position_has_reports',
  )
  assert.equal(
    codeOf(() => assertPositionArchivable({ reports: 0, openAssignments: 1 })),
    'org_position_has_assignments',
  )
  assert.equal(
    codeOf(() => assertPositionArchivable({ reports: 0, openAssignments: 0 })),
    null,
  )
})

test('DOM-FIN-129 K-444: gün aralıkları, eşzamanlı atama ve atama durumu', () => {
  const open = { startDate: '2026-09-01', endDate: null }
  const closed = { startDate: '2026-01-01', endDate: '2026-06-30' }
  assert.equal(rangesOverlap(open, closed), false)
  assert.equal(rangesOverlap(open, { startDate: '2027-01-01', endDate: '2027-01-01' }), true)
  assert.equal(rangesOverlap(closed, { startDate: '2026-06-30', endDate: null }), true)
  const ranges = [
    { startDate: '2026-01-01', endDate: '2026-03-31' },
    { startDate: '2026-03-01', endDate: '2026-05-31' },
    { startDate: '2026-06-01', endDate: null },
  ]
  assert.equal(maxConcurrent(ranges, { startDate: '2026-01-01', endDate: null }), 2)
  assert.equal(maxConcurrent(ranges, { startDate: '2026-04-01', endDate: null }), 1)
  assert.equal(maxConcurrent(ranges, { startDate: '2025-01-01', endDate: '2025-12-31' }), 0)
  assert.equal(assignmentState(closed, '2026-11-19'), 'past')
  assert.equal(assignmentState(open, '2026-08-31'), 'upcoming')
  assert.equal(assignmentState(open, '2026-09-01'), 'current')
  assert.deepEqual(positionFill(2, ranges, '2026-03-15'), { filled: 2, vacant: 0 })
  assert.deepEqual(positionFill(3, ranges, '2026-07-01'), { filled: 1, vacant: 2 })
  assert.deepEqual(positionFill(1, ranges, '2026-03-15'), { filled: 2, vacant: 0 })
})

test('DOM-FIN-129 K-444: atama şeması; bitiş başlangıçtan önce olamaz', () => {
  const body = { positionId: UNIT, membershipId: 'm1', startDate: '2026-09-01' }
  assert.deepEqual(orgAssignmentInputSchema.parse(body), { ...body, endDate: null })
  assert.equal(
    orgAssignmentInputSchema.safeParse({ ...body, endDate: '2026-08-31' }).success,
    false,
  )
  assert.equal(
    orgAssignmentInputSchema.safeParse({ ...body, startDate: '2026-02-30' }).success,
    false,
  )
  assert.equal(orgAssignmentUpdateSchema.safeParse({}).success, false)
  assert.equal(orgAssignmentUpdateSchema.safeParse({ endDate: null }).success, true)
})

test('DOM-FIN-129 K-444: atanacak personel kurumun etkin personeli', () => {
  assert.equal(
    codeOf(() => assertAssignmentStaff(null)),
    'org_assignment_staff_not_found',
  )
  assert.equal(
    codeOf(() => assertAssignmentStaff({ role: 'veli', active: true })),
    'org_assignment_not_staff',
  )
  assert.equal(
    codeOf(() => assertAssignmentStaff({ role: 'ogretmen', active: false })),
    'org_assignment_staff_inactive',
  )
  for (const role of ['yonetici', 'ogretmen', 'onburo'])
    assert.equal(
      codeOf(() => assertAssignmentStaff({ role, active: true })),
      null,
    )
})

test('DOM-FIN-129 K-444: kadro sayısı aşılmaz, aynı personel çakışan aralıkla iki kez atanmaz', () => {
  const others = [
    { membershipId: 'm1', startDate: '2026-01-01', endDate: '2026-06-30' },
    { membershipId: 'm2', startDate: '2026-03-01', endDate: null },
  ]
  const check = (membershipId: string, startDate: string, endDate: string | null, headcount = 2) =>
    codeOf(() =>
      assertAssignmentRange({ range: { startDate, endDate }, membershipId, headcount, others }),
    )
  assert.equal(check('m3', '2026-04-01', '2026-04-30'), 'org_position_full')
  assert.equal(check('m3', '2026-07-01', null), null)
  assert.equal(check('m3', '2026-04-01', null, 3), null)
  assert.equal(check('m1', '2026-06-30', null, 5), 'org_assignment_overlap')
  assert.equal(check('m1', '2026-07-01', null, 5), null)
  assert.equal(check('m3', '2026-05-01', '2026-04-01', 5), 'org_assignment_end_before_start')
  assert.equal(
    kindOf(() =>
      assertAssignmentRange({
        range: { startDate: '2026-01-01', endDate: null },
        membershipId: 'm2',
        headcount: 5,
        others,
      }),
    ),
    'conflict',
  )
})

test('DOM-FIN-129 K-444: kadro sayısı bugünden sonraki atamaların altına inmez', () => {
  const assignments = [
    { startDate: '2025-01-01', endDate: '2025-12-31' },
    { startDate: '2025-06-01', endDate: '2025-12-31' },
    { startDate: '2026-09-01', endDate: null },
    { startDate: '2027-01-01', endDate: null },
  ]
  assert.equal(
    codeOf(() => assertHeadcount({ headcount: 1, assignments, today: '2026-11-19' })),
    'org_position_headcount_below_assigned',
  )
  assert.equal(
    codeOf(() => assertHeadcount({ headcount: 2, assignments, today: '2026-11-19' })),
    null,
  )
})

test('DOM-FIN-129: görsel şema ağacı, düzleştirme ve birim yolu', () => {
  const units = [
    { id: 'kok', parentId: null, isActive: true, name: 'Okul müdürlüğü' },
    { id: 'idari', parentId: 'kok', isActive: true, name: 'İdari işler' },
    { id: 'akademik', parentId: 'kok', isActive: true, name: 'Akademik birimler' },
    { id: 'mat', parentId: 'akademik', isActive: true, name: 'Matematik zümresi' },
    { id: 'yetim', parentId: 'gizli', isActive: true, name: 'Bağımsız birim' },
  ]
  const positions = [
    {
      id: 'p-ogretmen',
      unitId: 'mat',
      title: 'Matematik öğretmeni',
      reportsToPositionId: 'p-baskan',
    },
    { id: 'p-baskan', unitId: 'mat', title: 'Zümre başkanı', reportsToPositionId: 'p-mudur' },
    { id: 'p-mudur', unitId: 'kok', title: 'Okul müdürü', reportsToPositionId: null },
  ]
  const tree = buildOrgTree(units, positions)
  assert.deepEqual(
    tree.map((node) => node.unit.name),
    ['Bağımsız birim', 'Okul müdürlüğü'],
  )
  const root = tree[1]
  assert.ok(root)
  assert.deepEqual(
    root.children.map((node) => node.unit.name),
    ['Akademik birimler', 'İdari işler'],
  )
  const math = root.children[0]?.children[0]
  assert.equal(math?.depth, 3)
  // Birim dışına raporlayan zümre başkanı birimin başında.
  assert.deepEqual(
    math?.positions.map((position) => position.title),
    ['Zümre başkanı', 'Matematik öğretmeni'],
  )
  assert.deepEqual(
    flattenOrgTree(tree).map(({ unit: item, depth }) => `${String(depth)}:${item.id}`),
    ['1:yetim', '1:kok', '2:akademik', '3:mat', '2:idari'],
  )
  assert.equal(unitPath(units, 'mat'), 'Okul müdürlüğü › Akademik birimler › Matematik zümresi')
  assert.equal(unitPath(units, 'yetim'), 'Bağımsız birim')
})
