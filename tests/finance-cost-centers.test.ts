import assert from 'node:assert/strict'
import test from 'node:test'

import {
  costCenterPath,
  costCenterSchema,
  planCostCenter,
  planCostCenterUpdate,
  type CostCenterContext,
  type CostCenterNode,
} from '../packages/school-core/src/lib/finance-cost-centers.ts'

import { isDomainError } from './support/domain-error.ts'

const ZodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'

const COURSE = '00000000-0000-4000-8000-0000000000c1'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const node = (n: number, overrides: Partial<CostCenterNode> = {}): CostCenterNode => ({
  id: id(n),
  code: `M${String(n)}`,
  name: `Merkez ${String(n)}`,
  type: 'unit',
  parentId: null,
  campusId: null,
  gradeLevel: null,
  courseId: null,
  isActive: true,
  ...overrides,
})
const context = (
  centers: CostCenterNode[],
  overrides: Partial<CostCenterContext> = {},
): CostCenterContext => ({
  institutionType: 'school',
  centers,
  campusIds: new Set(['b1', 'b2']),
  courseIds: new Set([COURSE]),
  ...overrides,
})

test('DOM-FIN-062: kod büyük harfe çevrilir, tür bağı biçimde denetlenir', () => {
  const plan = planCostCenter(
    { code: ' kad-01 ', name: 'Kadıköy Kampüsü', type: 'campus', campusId: 'b1' },
    context([]),
  )
  assert.equal(plan.code, 'KAD-01')
  assert.equal(plan.parentId, null)
  assert.throws(
    () => costCenterSchema.parse({ code: 'K', name: 'Kampüs', type: 'campus' }),
    ZodError,
  )
  assert.throws(
    () => costCenterSchema.parse({ code: 'B', name: 'Birim', type: 'unit', gradeLevel: 7 }),
    ZodError,
  )
  assert.throws(
    () => costCenterSchema.parse({ code: 'B', name: 'Birim', type: 'unit', campusId: 'b1' }),
    ZodError,
  )
  assert.throws(
    () =>
      costCenterSchema.parse({
        code: 'P',
        name: 'Program',
        type: 'program',
        gradeLevel: 7,
        courseId: COURSE,
      }),
    ZodError,
  )
  assert.throws(
    () => costCenterSchema.parse({ code: 'ç-1', name: 'Türkçe', type: 'unit' }),
    ZodError,
  )
})

test('DOM-FIN-062: kod kurumda tekildir, pasif merkez dahil', () => {
  assert.throws(
    () =>
      planCostCenter(
        { code: 'm1', name: 'Yeni', type: 'unit' },
        context([node(1, { isActive: false })]),
      ),
    isDomainError('cost_center_code_taken', 'conflict'),
  )
})

test('DOM-FIN-062: kampüs bağı var olan kampüse ve tek etkin merkeze', () => {
  assert.throws(
    () =>
      planCostCenter({ code: 'K', name: 'Kampüs', type: 'campus', campusId: 'yok' }, context([])),
    isDomainError('cost_center_campus_not_found'),
  )
  const taken = context([node(1, { type: 'campus', campusId: 'b1' })])
  assert.throws(
    () => planCostCenter({ code: 'K', name: 'Kampüs', type: 'campus', campusId: 'b1' }, taken),
    isDomainError('cost_center_campus_taken', 'conflict'),
  )
  const inactive = context([node(1, { type: 'campus', campusId: 'b1', isActive: false })])
  assert.equal(
    planCostCenter({ code: 'K', name: 'Kampüs', type: 'campus', campusId: 'b1' }, inactive)
      .campusId,
    'b1',
  )
})

test('DOM-FIN-062: program okulda sınıf düzeyine, dil okulunda kura bağlanır', () => {
  assert.equal(
    planCostCenter({ code: 'P7', name: '7. sınıflar', type: 'program', gradeLevel: 7 }, context([]))
      .gradeLevel,
    7,
  )
  assert.throws(
    () =>
      planCostCenter({ code: 'P', name: 'Kur', type: 'program', courseId: COURSE }, context([])),
    isDomainError('cost_center_link_unavailable'),
  )
  const language = context([], { institutionType: 'language_school' })
  assert.throws(
    () => planCostCenter({ code: 'P', name: 'Düzey', type: 'program', gradeLevel: 7 }, language),
    isDomainError('cost_center_link_unavailable'),
  )
  assert.throws(
    () => planCostCenter({ code: 'P', name: 'Kur', type: 'program', courseId: id(999) }, language),
    isDomainError('cost_center_course_not_found'),
  )
  assert.equal(
    planCostCenter({ code: 'P', name: 'Kur', type: 'program', courseId: COURSE }, language)
      .courseId,
    COURSE,
  )
  // Bağsız program kademe gibi üst toplamdır.
  assert.equal(
    planCostCenter({ code: 'ORT', name: 'Ortaokul', type: 'program' }, context([])).gradeLevel,
    null,
  )
})

test('DOM-FIN-062: aynı üst merkezde aynı programa tek etkin merkez; başka kampüs altında serbest', () => {
  const campusA = node(1, { type: 'campus', campusId: 'b1' })
  const campusB = node(2, { type: 'campus', campusId: 'b2' })
  const grade7 = node(3, { type: 'program', parentId: campusA.id, gradeLevel: 7 })
  const ctx = context([campusA, campusB, grade7])
  assert.throws(
    () =>
      planCostCenter(
        { code: 'A7', name: '7. sınıflar', type: 'program', parentId: campusA.id, gradeLevel: 7 },
        ctx,
      ),
    isDomainError('cost_center_program_taken', 'conflict'),
  )
  assert.equal(
    planCostCenter(
      { code: 'B7', name: '7. sınıflar', type: 'program', parentId: campusB.id, gradeLevel: 7 },
      ctx,
    ).parentId,
    campusB.id,
  )
  const language = context([node(4, { type: 'program', courseId: COURSE })], {
    institutionType: 'language_school',
  })
  assert.throws(
    () => planCostCenter({ code: 'K2', name: 'Kur', type: 'program', courseId: COURSE }, language),
    isDomainError('cost_center_program_taken', 'conflict'),
  )
})

test('DOM-FIN-062: üst merkez var ve etkin olmalı; hiyerarşi en çok 4 düzey (K-66)', () => {
  assert.throws(
    () => planCostCenter({ code: 'X', name: 'Alt', type: 'unit', parentId: id(50) }, context([])),
    isDomainError('cost_center_parent_not_found'),
  )
  assert.throws(
    () =>
      planCostCenter(
        { code: 'X', name: 'Alt', type: 'unit', parentId: id(1) },
        context([node(1, { isActive: false })]),
      ),
    isDomainError('cost_center_parent_inactive'),
  )
  const chain = [
    node(1),
    node(2, { parentId: id(1) }),
    node(3, { parentId: id(2) }),
    node(4, { parentId: id(3) }),
  ]
  assert.equal(
    planCostCenter({ code: 'L4', name: 'Dördüncü', type: 'unit', parentId: id(3) }, context(chain))
      .parentId,
    id(3),
  )
  assert.throws(
    () =>
      planCostCenter(
        { code: 'L5', name: 'Beşinci', type: 'unit', parentId: id(4) },
        context(chain),
      ),
    isDomainError('cost_center_too_deep'),
  )
})

test('DOM-FIN-062: taşımada döngü ve alt dalla birlikte düzey sınırı denetlenir', () => {
  const centers = [node(1), node(2, { parentId: id(1) }), node(3, { parentId: id(2) }), node(4)]
  const ctx = context(centers)
  const root = centers[0]!
  assert.throws(
    () => planCostCenterUpdate(root, { parentId: id(3) }, ctx),
    isDomainError('cost_center_cycle'),
  )
  assert.throws(
    () => planCostCenterUpdate(root, { parentId: id(1) }, ctx),
    isDomainError('cost_center_cycle'),
  )
  // 1 → 2 → 3 dalı 4'ün altına girerse 4 düzey olur; 3'ün altındaki yeni dal 5'i aşar.
  assert.deepEqual(planCostCenterUpdate(root, { parentId: id(4) }, ctx), { parentId: id(4) })
  const deeper = context([...centers, node(5, { parentId: id(4) })])
  assert.throws(
    () => planCostCenterUpdate(root, { parentId: id(5) }, deeper),
    isDomainError('cost_center_too_deep'),
  )
  assert.deepEqual(planCostCenterUpdate(centers[1]!, { parentId: null }, ctx), { parentId: null })
})

test('DOM-FIN-062: altında etkin merkez varken pasifleştirilmez; silme yok, yeniden etkinleşir', () => {
  const parent = node(1)
  const child = node(2, { parentId: id(1) })
  assert.throws(
    () => planCostCenterUpdate(parent, { isActive: false }, context([parent, child])),
    isDomainError('cost_center_has_active_children'),
  )
  const passiveChild = { ...child, isActive: false }
  assert.deepEqual(
    planCostCenterUpdate(parent, { isActive: false }, context([parent, passiveChild])),
    { isActive: false },
  )
  // Pasif üstün altındaki pasif merkez adı düzeltilir, yeniden etkinleşemez.
  const passiveParent = { ...parent, isActive: false }
  const ctx = context([passiveParent, passiveChild])
  assert.deepEqual(planCostCenterUpdate(passiveChild, { name: 'Yeni ad' }, ctx), {
    name: 'Yeni ad',
  })
  assert.throws(
    () => planCostCenterUpdate(passiveChild, { isActive: true }, ctx),
    isDomainError('cost_center_parent_inactive'),
  )
  // Yeniden etkinleşen kampüs merkezi bağı boşta değilse reddedilir.
  const old = node(3, { type: 'campus', campusId: 'b1', isActive: false })
  const fresh = node(4, { type: 'campus', campusId: 'b1' })
  assert.throws(
    () => planCostCenterUpdate(old, { isActive: true }, context([old, fresh])),
    isDomainError('cost_center_campus_taken', 'conflict'),
  )
})

test('DOM-FIN-062: düzeltmede tür değişmez, bağ türe uymalı, boş düzeltme reddedilir', () => {
  const unit = node(1)
  assert.throws(() => planCostCenterUpdate(unit, { type: 'campus' }, context([unit])), ZodError)
  assert.throws(() => planCostCenterUpdate(unit, {}, context([unit])), ZodError)
  assert.throws(
    () => planCostCenterUpdate(unit, { gradeLevel: 7 }, context([unit])),
    isDomainError('cost_center_link_invalid'),
  )
  const campus = node(2, { type: 'campus', campusId: 'b1' })
  assert.throws(
    () => planCostCenterUpdate(campus, { campusId: null }, context([campus])),
    isDomainError('cost_center_link_invalid'),
  )
  assert.deepEqual(
    planCostCenterUpdate(campus, { campusId: 'b2', code: 'kad' }, context([campus])),
    {
      campusId: 'b2',
      code: 'KAD',
    },
  )
  assert.throws(
    () => planCostCenterUpdate(campus, { code: 'M1' }, context([campus, unit])),
    isDomainError('cost_center_code_taken', 'conflict'),
  )
})

test('DOM-FIN-062: hiyerarşi yolu kökten kod sırasıyla', () => {
  const centers = [node(1, { code: 'KAD' }), node(2, { code: 'ORT', parentId: id(1) })]
  const byId = new Map(centers.map((center) => [center.id, center]))
  assert.equal(costCenterPath(byId, id(2)), 'KAD / ORT')
  assert.equal(costCenterPath(byId, id(9)), '')
})
