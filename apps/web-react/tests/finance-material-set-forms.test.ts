import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MATERIAL_GRADE_OPTIONS,
  materialDeliveryBody,
  materialDeliveryDefaults,
  materialDeliveryFormField,
  materialDeliveryFormSchema,
  materialSetBody,
  materialSetDefaults,
  materialSetFormField,
  materialSetFormSchema,
} from '../src/pages/finance/finance-material-set-forms.ts'

// ON-232 (DOM-FIN-080): materyal seti ve teslim formlarının gövdeleri ve alan eşlemesi.

const BOOK = '00000000-0000-4000-8000-0000000000b1'
const NOTEBOOK = '00000000-0000-4000-8000-0000000000b2'
const COURSE = '00000000-0000-4000-8000-0000000000d1'
const MAIN = '00000000-0000-4000-8000-0000000000c1'
const GUARDIAN = '00000000-0000-4000-8000-0000000000e1'

test('DOM-FIN-080: set formu hedefi okulda sınıf düzeyine, dil okulunda kura çevirir', () => {
  const values = {
    ...materialSetDefaults(2026),
    name: ' 7. sınıf seti ',
    target: '7',
    items: [
      { stockItemId: BOOK, quantity: '1' },
      { stockItemId: NOTEBOOK, quantity: ' 3 ' },
    ],
  }
  assert.equal(materialSetFormSchema.safeParse(values).success, true)
  assert.deepEqual(materialSetBody(values, 'school'), {
    name: '7. sınıf seti',
    academicYear: 2026,
    gradeLevel: 7,
    courseId: null,
    items: [
      { stockItemId: BOOK, quantity: 1 },
      { stockItemId: NOTEBOOK, quantity: 3 },
    ],
  })
  const language = materialSetBody({ ...values, target: COURSE }, 'language_school')
  assert.equal(language.gradeLevel, null)
  assert.equal(language.courseId, COURSE)
  const open = materialSetBody({ ...values, target: '' }, 'school')
  assert.equal(open.gradeLevel, null)
  assert.equal(open.courseId, null)
  assert.deepEqual(
    MATERIAL_GRADE_OPTIONS.map((option) => option.value),
    ['5', '6', '7', '8', '9', '10', '11', '12'],
  )
})

test('DOM-FIN-080: set formu boş kartı, mükerrer kartı ve sınır dışı adedi reddeder', () => {
  const base = materialSetDefaults(2026)
  assert.deepEqual(base.items, [{ stockItemId: '', quantity: '1' }])
  const issues = (items: { stockItemId: string; quantity: string }[]) =>
    materialSetFormSchema
      .safeParse({ ...base, name: 'Set', items })
      .error?.issues.map((issue) => issue.path.join('.'))
  assert.deepEqual(issues([{ stockItemId: '', quantity: '1' }]), ['items.0.stockItemId'])
  assert.deepEqual(
    issues([
      { stockItemId: BOOK, quantity: '1' },
      { stockItemId: BOOK, quantity: '2' },
    ]),
    ['items.1.stockItemId'],
  )
  assert.deepEqual(issues([{ stockItemId: BOOK, quantity: '101' }]), ['items.0.quantity'])
  assert.deepEqual(issues([]), ['items'])
})

test('DOM-FIN-080: düzenleme varsayılanı setin hedefini ve kalemlerini taşır; sunucu yolu forma eşlenir', () => {
  const values = materialSetDefaults(2027, {
    id: 'set',
    name: '7. Sınıf Seti',
    academicYear: 2026,
    gradeLevel: 7,
    courseId: null,
    courseName: null,
    isActive: true,
    itemCount: 1,
    studentCount: 2,
    deliveredCount: 0,
    version: 3,
    hasDeliveries: false,
    items: [
      {
        stockItemId: BOOK,
        code: 'KIT-7',
        name: 'Kitap',
        unit: 'piece',
        isActive: true,
        quantity: 2,
      },
    ],
  })
  assert.equal(values.academicYear, '2026')
  assert.equal(values.target, '7')
  assert.deepEqual(values.items, [{ stockItemId: BOOK, quantity: '2' }])
  assert.equal(materialSetFormField('courseId'), 'target')
  assert.equal(materialSetFormField('gradeLevel'), 'target')
  assert.equal(materialSetFormField('items.2.stockItemId'), 'items.2.stockItemId')
  assert.equal(materialSetFormField('items'), 'items')
  assert.equal(materialSetFormField('name'), 'name')
  assert.equal(materialSetFormField('version'), undefined)
})

test('DOM-FIN-080, K-206: teslim formu alan türüne göre veli ya da ad ister; gövde gereksiz alanı boşaltır', () => {
  const defaults = { ...materialDeliveryDefaults('2026-10-06'), warehouseId: MAIN }
  assert.equal(defaults.signatureReceived, true)
  assert.deepEqual(materialDeliveryBody('s1', { ...defaults, recipientName: 'Yok', note: ' ' }), {
    studentId: 's1',
    warehouseId: MAIN,
    deliveryDate: '2026-10-06',
    recipientKind: 'student',
    guardianId: null,
    recipientName: null,
    signatureReceived: true,
    note: null,
  })
  const guardian = { ...defaults, recipientKind: 'guardian' as const }
  assert.equal(
    materialDeliveryFormSchema.safeParse(guardian).error?.issues[0]?.path[0],
    'guardianId',
  )
  assert.equal(
    materialDeliveryBody('s1', { ...guardian, guardianId: GUARDIAN, recipientName: 'X' })
      .guardianId,
    GUARDIAN,
  )
  const other = { ...defaults, recipientKind: 'other' as const, recipientName: ' A ' }
  assert.equal(
    materialDeliveryFormSchema.safeParse(other).error?.issues[0]?.path[0],
    'recipientName',
  )
  const named = materialDeliveryBody('s1', {
    ...other,
    recipientName: ' Mehmet Akın ',
    guardianId: GUARDIAN,
  })
  assert.equal(named.recipientName, 'Mehmet Akın')
  assert.equal(named.guardianId, null)
  assert.equal(
    materialDeliveryFormSchema.safeParse({ ...defaults, warehouseId: '' }).success,
    false,
  )
  assert.equal(materialDeliveryFormField('warehouseId'), 'warehouseId')
  assert.equal(materialDeliveryFormField('studentId'), undefined)
})
