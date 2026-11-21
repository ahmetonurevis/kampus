import assert from 'node:assert/strict'
import test from 'node:test'

import {
  planStockIssueLines,
  planStockMovementCancel,
  stockBalances,
  type CancellableMovement,
  type StockItemRef,
  type StockWarehouseRef,
} from '../packages/school-core/src/lib/finance-inventory.ts'
import {
  materialDeliverySchema,
  materialSetActions,
  materialSetStudentsCsv,
  materialSetTargetLabel,
  planMaterialDelivery,
  planMaterialDeliveryCancel,
  planMaterialDeliverySignature,
  planMaterialSet,
  planMaterialSetUpdate,
  type MaterialDeliveryContext,
  type MaterialSetContext,
} from '../packages/school-core/src/lib/finance-material-sets.ts'

import { isDomainError } from './support/domain-error.ts'

// Kitap ve materyal seti dağıtımı (DOM-FIN-080; ON-232).

const ZodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'
const BOOK = '00000000-0000-4000-8000-0000000000b1'
const NOTEBOOK = '00000000-0000-4000-8000-0000000000b2'
const OLD = '00000000-0000-4000-8000-0000000000b3'
const MAIN = '00000000-0000-4000-8000-0000000000c1'
const CLOSED = '00000000-0000-4000-8000-0000000000c2'
const COURSE = '00000000-0000-4000-8000-0000000000d1'
const GUARDIAN = '00000000-0000-4000-8000-0000000000e1'
const RESTRICTED = '00000000-0000-4000-8000-0000000000e2'

const ITEMS = new Map<string, StockItemRef>([
  [BOOK, { id: BOOK, code: 'KIT-7', name: '7. sınıf kitabı', unit: 'piece', isActive: true }],
  [NOTEBOOK, { id: NOTEBOOK, code: 'DFT', name: 'Defter', unit: 'piece', isActive: true }],
  [OLD, { id: OLD, code: 'ESKI', name: 'Eski kitap', unit: 'piece', isActive: false }],
])
const WAREHOUSES = new Map<string, StockWarehouseRef>([
  [MAIN, { id: MAIN, name: 'Ana depo', campusId: 'b1', isActive: true }],
  [CLOSED, { id: CLOSED, name: 'Eski depo', campusId: 'b1', isActive: false }],
])

const setContext = (extra: Partial<MaterialSetContext> = {}): MaterialSetContext => ({
  institutionType: 'school',
  sets: [{ id: 'set-1', name: '7. Sınıf Seti', academicYear: 2026 }],
  items: ITEMS,
  courseIds: new Set([COURSE]),
  ...extra,
})
const setBody = (extra: Record<string, unknown> = {}) => ({
  name: '8. sınıf seti',
  academicYear: 2026,
  gradeLevel: 8,
  items: [
    { stockItemId: BOOK, quantity: 1 },
    { stockItemId: NOTEBOOK, quantity: 3 },
  ],
  ...extra,
})

let sequence = 0
const movement = (
  type: CancellableMovement['type'],
  quantity: number,
  movementDate: string,
  itemId = BOOK,
): CancellableMovement => ({
  id: `m${String((sequence += 1))}`,
  itemId,
  warehouseId: MAIN,
  type,
  quantity,
  movementDate,
  cancelledAt: null,
  transferId: null,
  receiptId: null,
})
const stocked = () => [
  movement('in', 2, '2026-10-01', BOOK),
  movement('in', 10, '2026-10-01', NOTEBOOK),
]

const deliveryContext = (
  extra: Partial<MaterialDeliveryContext> = {},
): MaterialDeliveryContext => ({
  items: ITEMS,
  warehouses: WAREHOUSES,
  movements: stocked(),
  today: '2026-10-06',
  set: {
    id: 'set-1',
    name: '7. Sınıf Seti',
    isActive: true,
    items: [
      { stockItemId: BOOK, quantity: 1 },
      { stockItemId: NOTEBOOK, quantity: 3 },
    ],
  },
  student: { id: 's1', isActive: true, isEligible: true },
  guardians: new Map([
    [GUARDIAN, { id: GUARDIAN, name: 'Ayşe Yılmaz', isContactRestricted: false }],
    [RESTRICTED, { id: RESTRICTED, name: 'Kısıtlı Veli', isContactRestricted: true }],
  ]),
  delivered: false,
  ...extra,
})
const deliveryBody = (extra: Record<string, unknown> = {}) => ({
  studentId: 's1',
  warehouseId: MAIN,
  deliveryDate: '2026-10-06',
  recipientKind: 'student',
  signatureReceived: true,
  ...extra,
})

test('DOM-FIN-080: set adı, eğitim yılı, sınıf düzeyi ve kalemlerle açılır', () => {
  const planned = planMaterialSet(setBody(), setContext())
  assert.equal(planned.gradeLevel, 8)
  assert.equal(planned.courseId, null)
  assert.equal(planned.items.length, 2)
  // Hedefsiz set bütün öğrencilere dağıtılır.
  const open = planMaterialSet(setBody({ gradeLevel: undefined }), setContext())
  assert.equal(open.gradeLevel, null)
  assert.equal(materialSetTargetLabel(open), 'Bütün öğrenciler')
  assert.equal(materialSetTargetLabel({ gradeLevel: 7 }), '7. sınıf')
  assert.equal(materialSetTargetLabel({ gradeLevel: null, courseName: 'B1 Genel' }), 'B1 Genel')
})

test('DOM-FIN-080: set şeması kalemsiz, mükerrer kartlı, sınırı aşan ve iki hedefli seti reddeder', () => {
  assert.throws(() => planMaterialSet(setBody({ items: [] }), setContext()), ZodError)
  assert.throws(
    () =>
      planMaterialSet(
        setBody({
          items: [
            { stockItemId: BOOK, quantity: 1 },
            { stockItemId: BOOK, quantity: 2 },
          ],
        }),
        setContext(),
      ),
    ZodError,
  )
  assert.throws(
    () => planMaterialSet(setBody({ items: [{ stockItemId: BOOK, quantity: 101 }] }), setContext()),
    ZodError,
  )
  assert.throws(() => planMaterialSet(setBody({ gradeLevel: 4 }), setContext()), ZodError)
  assert.throws(() => planMaterialSet(setBody({ courseId: COURSE }), setContext()), ZodError)
  assert.throws(() => planMaterialSet(setBody({ institutionId: 'x' }), setContext()), ZodError)
})

test('DOM-FIN-080, K-205: ad yıl içinde tekil; hedef kurum türüne uygun; kart etkin olmalı', () => {
  assert.throws(
    () => planMaterialSet(setBody({ name: '7. sinif seti' }), setContext()),
    isDomainError('material_set_name_exists', 'conflict'),
  )
  // Başka yılda aynı ad serbesttir.
  assert.equal(
    planMaterialSet(setBody({ name: '7. Sınıf Seti', academicYear: 2027 }), setContext()).name,
    '7. Sınıf Seti',
  )
  assert.throws(
    () => planMaterialSet(setBody(), setContext({ institutionType: 'language_school' })),
    isDomainError('material_set_target_unavailable'),
  )
  assert.throws(
    () => planMaterialSet(setBody({ gradeLevel: null, courseId: COURSE }), setContext()),
    isDomainError('material_set_target_unavailable'),
  )
  const language = setContext({ institutionType: 'language_school' })
  assert.equal(
    planMaterialSet(setBody({ gradeLevel: null, courseId: COURSE }), language).courseId,
    COURSE,
  )
  assert.throws(
    () =>
      planMaterialSet(
        setBody({ gradeLevel: null, courseId: '00000000-0000-4000-8000-0000000000d9' }),
        language,
      ),
    isDomainError('material_set_course_not_found'),
  )
  assert.throws(
    () => planMaterialSet(setBody({ items: [{ stockItemId: OLD, quantity: 1 }] }), setContext()),
    isDomainError('stock_item_inactive'),
  )
  assert.throws(
    () =>
      planMaterialSet(
        setBody({ items: [{ stockItemId: '00000000-0000-4000-8000-0000000000ff', quantity: 1 }] }),
        setContext(),
      ),
    isDomainError('stock_item_not_found'),
  )
})

test('DOM-FIN-080, K-208: teslimi başlamış setin yılı ve hedefi değişmez; ad, kalem ve durum değişir', () => {
  const current = {
    id: 'set-1',
    name: '7. Sınıf Seti',
    academicYear: 2026,
    gradeLevel: 7,
    courseId: null,
  }
  const delivered = { ...setContext(), hasDeliveries: true }
  assert.throws(
    () => planMaterialSetUpdate(current, { gradeLevel: 8 }, delivered),
    isDomainError('material_set_has_deliveries'),
  )
  assert.throws(
    () => planMaterialSetUpdate(current, { academicYear: 2027 }, delivered),
    isDomainError('material_set_has_deliveries'),
  )
  assert.deepEqual(planMaterialSetUpdate(current, { isActive: false }, delivered), {
    isActive: false,
  })
  assert.equal(
    planMaterialSetUpdate(current, { items: [{ stockItemId: BOOK, quantity: 2 }] }, delivered)
      .items?.[0]?.quantity,
    2,
  )
  // Kendi adını korumak tekillik ihlali değildir; başka setin adı ihlaldir.
  assert.equal(
    planMaterialSetUpdate(current, { name: '7. sınıf seti' }, delivered).name,
    '7. sınıf seti',
  )
  const other = setContext({
    sets: [...setContext().sets, { id: 'set-2', name: 'Yaz seti', academicYear: 2026 }],
  })
  assert.throws(
    () => planMaterialSetUpdate(current, { name: 'YAZ SETİ' }, { ...other, hasDeliveries: false }),
    isDomainError('material_set_name_exists', 'conflict'),
  )
  assert.equal(
    planMaterialSetUpdate(current, { gradeLevel: 9 }, { ...setContext(), hasDeliveries: false })
      .gradeLevel,
    9,
  )
  assert.throws(
    () =>
      planMaterialSetUpdate(
        current,
        { items: [{ stockItemId: OLD, quantity: 1 }] },
        { ...setContext(), hasDeliveries: false },
      ),
    isDomainError('stock_item_inactive'),
  )
  assert.throws(() => planMaterialSetUpdate(current, {}, delivered), ZodError)
})

test('DOM-FIN-080: teslim setin kalemleri kadar çıkış planlar; teslim alan türü alanları ayıklar', () => {
  const planned = planMaterialDelivery(
    deliveryBody({ recipientName: 'Yok sayılır' }),
    deliveryContext(),
  )
  assert.deepEqual(planned.lines, [
    { itemId: BOOK, quantity: 1 },
    { itemId: NOTEBOOK, quantity: 3 },
  ])
  assert.equal(planned.recipientName, null)
  assert.equal(planned.data.guardianId, null)
  assert.equal(planned.data.note, null)

  const guardian = planMaterialDelivery(
    deliveryBody({ recipientKind: 'guardian', guardianId: GUARDIAN, signatureReceived: false }),
    deliveryContext(),
  )
  assert.equal(guardian.recipientName, 'Ayşe Yılmaz')
  assert.equal(guardian.data.signatureReceived, false)

  const other = planMaterialDelivery(
    deliveryBody({
      recipientKind: 'other',
      recipientName: '  Mehmet Yılmaz ',
      guardianId: GUARDIAN,
    }),
    deliveryContext(),
  )
  assert.equal(other.recipientName, 'Mehmet Yılmaz')
  assert.equal(other.data.guardianId, null)
})

test('DOM-FIN-080: teslim şeması veli seçimini, adı ve imza işaretini ister', () => {
  const parse = (extra: Record<string, unknown>) =>
    materialDeliverySchema.safeParse(deliveryBody(extra))
  assert.equal(parse({ recipientKind: 'guardian' }).error?.issues[0]?.path[0], 'guardianId')
  assert.equal(parse({ recipientKind: 'other' }).error?.issues[0]?.path[0], 'recipientName')
  assert.equal(
    parse({ recipientKind: 'other', recipientName: 'A' }).error?.issues[0]?.path[0],
    'recipientName',
  )
  assert.equal(parse({ signatureReceived: undefined }).success, false)
  assert.equal(parse({ deliveryDate: '2026-02-30' }).success, false)
  assert.equal(parse({ institutionId: 'b' }).success, false)
})

test('DOM-FIN-080: pasif set, etkin olmayan ya da hedef dışı öğrenci ve gelecek gün reddedilir', () => {
  assert.throws(
    () =>
      planMaterialDelivery(
        deliveryBody(),
        deliveryContext({ set: { ...deliveryContext().set, isActive: false } }),
      ),
    isDomainError('material_set_inactive'),
  )
  assert.throws(
    () => planMaterialDelivery(deliveryBody(), deliveryContext({ student: undefined })),
    isDomainError('material_delivery_student_not_found'),
  )
  assert.throws(
    () =>
      planMaterialDelivery(
        deliveryBody(),
        deliveryContext({ student: { id: 's1', isActive: false, isEligible: true } }),
      ),
    isDomainError('material_delivery_student_not_found'),
  )
  assert.throws(
    () =>
      planMaterialDelivery(
        deliveryBody(),
        deliveryContext({ student: { id: 's1', isActive: true, isEligible: false } }),
      ),
    isDomainError('material_delivery_student_not_eligible'),
  )
  assert.throws(
    () => planMaterialDelivery(deliveryBody({ deliveryDate: '2026-10-07' }), deliveryContext()),
    isDomainError('material_delivery_date_future'),
  )
})

test('DOM-FIN-080: aynı öğrenciye aynı set iptal edilmemiş ikinci kez teslim edilmez', () => {
  assert.throws(
    () => planMaterialDelivery(deliveryBody(), deliveryContext({ delivered: true })),
    isDomainError('material_delivery_exists', 'conflict'),
  )
})

test('DOM-FIN-080, K-206: kayıtlı veli öğrenciye bağlı ve iletişim kısıtsız olmalı', () => {
  assert.throws(
    () =>
      planMaterialDelivery(
        deliveryBody({
          recipientKind: 'guardian',
          guardianId: '00000000-0000-4000-8000-0000000000e9',
        }),
        deliveryContext(),
      ),
    isDomainError('material_delivery_guardian_not_found'),
  )
  assert.throws(
    () =>
      planMaterialDelivery(
        deliveryBody({ recipientKind: 'guardian', guardianId: RESTRICTED }),
        deliveryContext(),
      ),
    isDomainError('material_delivery_guardian_restricted'),
  )
})

test('DOM-FIN-080, K-181: stok yetmezse teslim 422 stock_insufficient; depo ve kart etkin olmalı', () => {
  const short = deliveryContext({ movements: [movement('in', 2, '2026-10-01', BOOK)] })
  assert.throws(
    () => planMaterialDelivery(deliveryBody(), short),
    (error: unknown) => {
      assert.ok(isDomainError('stock_insufficient')(error))
      assert.match(String((error as Error).message), /Defter.*en çok 0 adet/)
      return true
    },
  )
  // Geriye tarihli teslim sonraki günlerin çıkışını eksiye düşüremez.
  const later = deliveryContext({
    movements: [...stocked(), movement('out', 2, '2026-10-05', BOOK)],
  })
  assert.throws(
    () => planMaterialDelivery(deliveryBody({ deliveryDate: '2026-10-02' }), later),
    isDomainError('stock_insufficient'),
  )
  assert.throws(
    () => planMaterialDelivery(deliveryBody({ warehouseId: CLOSED }), deliveryContext()),
    isDomainError('stock_warehouse_inactive'),
  )
  assert.throws(
    () =>
      planMaterialDelivery(
        deliveryBody(),
        deliveryContext({
          set: { ...deliveryContext().set, items: [{ stockItemId: OLD, quantity: 1 }] },
        }),
      ),
    isDomainError('stock_item_inactive'),
  )
})

test('DOM-FIN-078: aynı kart iki satırda gelirse miktarlar birlikte denetlenir', () => {
  const context = deliveryContext()
  assert.throws(
    () =>
      planStockIssueLines(
        {
          warehouseId: MAIN,
          day: '2026-10-06',
          lines: [
            { itemId: BOOK, quantity: 1, path: [] },
            { itemId: BOOK, quantity: 2, path: [] },
          ],
        },
        context,
        { warehouse: ['warehouseId'], day: ['day'] },
      ),
    isDomainError('stock_insufficient'),
  )
  assert.throws(
    () =>
      planStockIssueLines(
        { warehouseId: MAIN, day: '2026-10-09', lines: [{ itemId: BOOK, quantity: 1, path: [] }] },
        context,
        { warehouse: ['warehouseId'], day: ['day'] },
      ),
    isDomainError('stock_movement_date_future'),
  )
})

test('DOM-FIN-078, DOM-FIN-080: teslim çıkışı miktarı azaltır ve hareket listesinden iptal edilmez', () => {
  const delivery = movement('delivery', 1, '2026-10-06', BOOK)
  const balances = stockBalances([...stocked(), delivery])
  assert.equal(balances.get(`${BOOK}|${MAIN}`), 1)
  assert.throws(
    () =>
      planStockMovementCancel(
        delivery,
        { reason: 'Hatalı kayıt' },
        { items: ITEMS, warehouses: WAREHOUSES, movements: [delivery] },
      ),
    isDomainError('stock_movement_from_delivery'),
  )
})

test('DOM-FIN-080, K-209: iptal gerekçe ister, iptal edilmiş teslim yeniden iptal edilmez', () => {
  const live = { cancelledAt: null, signatureReceived: false }
  assert.equal(planMaterialDeliveryCancel(live, { reason: '  Yanlış öğrenci ' }), 'Yanlış öğrenci')
  assert.throws(() => planMaterialDeliveryCancel(live, { reason: 'kısa' }), ZodError)
  assert.throws(
    () =>
      planMaterialDeliveryCancel(
        { cancelledAt: '2026-10-06T10:00:00.000Z', signatureReceived: false },
        { reason: 'Yanlış öğrenci' },
      ),
    isDomainError('material_delivery_already_cancelled'),
  )
})

test('DOM-FIN-080, K-206: imza sonradan işlenir; imzalı ya da iptal edilmiş teslime işlenmez', () => {
  assert.doesNotThrow(() =>
    planMaterialDeliverySignature({ cancelledAt: null, signatureReceived: false }),
  )
  assert.throws(
    () => planMaterialDeliverySignature({ cancelledAt: null, signatureReceived: true }),
    isDomainError('material_delivery_signature_exists'),
  )
  assert.throws(
    () =>
      planMaterialDeliverySignature({
        cancelledAt: '2026-10-06T10:00:00.000Z',
        signatureReceived: false,
      }),
    isDomainError('material_delivery_cancelled'),
  )
})

test('K-205: yönetici seti yönetir ve teslimi iptal eder; ön büro teslim ve imza yazar; diğerleri hiçbir şey', () => {
  assert.deepEqual(materialSetActions('yonetici'), {
    manage: true,
    deliver: true,
    sign: true,
    cancel: true,
  })
  assert.deepEqual(materialSetActions('onburo'), {
    manage: false,
    deliver: true,
    sign: true,
    cancel: false,
  })
  for (const role of ['ogretmen', 'veli', 'ogrenci', 'muhasebe'])
    assert.deepEqual(materialSetActions(role), {
      manage: false,
      deliver: false,
      sign: false,
      cancel: false,
    })
})

test('K-209: öğrenci CSV’si durum, teslim alan ve imzayı yazar; formül kaçılır', () => {
  const csv = materialSetStudentsCsv([
    {
      studentNumber: '2026001',
      studentName: 'Deniz Yılmaz',
      className: '7-A',
      hasMaterialFee: true,
      delivery: {
        deliveryDate: '2026-10-06',
        recipientKind: 'guardian',
        recipientName: 'Ayşe Yılmaz',
        signatureReceived: true,
        warehouseName: 'Ana depo',
      },
    },
    {
      studentNumber: null,
      studentName: '=HYPERLINK("x")',
      className: null,
      hasMaterialFee: false,
      delivery: null,
    },
    {
      studentNumber: '2026003',
      studentName: 'Ece Yılmaz',
      className: '5-A',
      hasMaterialFee: false,
      delivery: {
        deliveryDate: '2026-10-05',
        recipientKind: 'student',
        recipientName: null,
        signatureReceived: false,
        warehouseName: 'Ana depo',
      },
    },
  ])
  const lines = csv.split('\r\n')
  assert.equal(lines.length, 4)
  assert.match(lines[0] ?? '', /^"Öğrenci no";"Öğrenci";"Sınıf";"Materyal ücreti";"Durum"/)
  assert.equal(
    lines[1],
    '"2026001";"Deniz Yılmaz";"7-A";"Ücretli";"Teslim edildi";"06.10.2026";"Ayşe Yılmaz (Kayıtlı veli)";"Alındı";"Ana depo"',
  )
  assert.match(
    lines[2] ?? '',
    /"'=HYPERLINK\(""x""\)";"";"Ücret kalemi yok";"Teslim edilmedi";"";"";"";""$/,
  )
  assert.match(lines[3] ?? '', /"Öğrencinin kendisi";"Bekliyor";"Ana depo"$/)
})
