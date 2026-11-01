import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AMOUNT_FORMAT_MESSAGE,
  classOptions,
  enrollBody,
  enrollDefaults,
  enrollFieldOfCode,
  enrollFieldOfPath,
  enrollFormSchema,
  FRACTION_MESSAGE,
  installmentPreview,
  LIRA_RANGE_MESSAGE,
  liraToCents,
  parseLira,
} from '../src/pages/crm/enroll-forms.ts'

const valid = { classId: 'c1', total: '24.000', count: '6', startDate: '2026-12-01' }

test('DOM-KAY-035: tam lira kuruşa çevrilir, binlik ayraç ve ₺ işareti kabul edilir', () => {
  assert.deepEqual(parseLira('12500'), { ok: true, lira: 12500 })
  assert.deepEqual(parseLira(' 12.500 ₺ '), { ok: true, lira: 12500 })
  assert.deepEqual(parseLira('950 000'), { ok: true, lira: 950_000 })
  assert.equal(liraToCents(12500), 1_250_000)
  assert.equal(liraToCents(100), 10_000)
})

test('DOM-KAY-035: kuruşlu ya da sayı olmayan tutar formda engellenir', () => {
  for (const input of ['12500,50', '12500.5', '12.50', '99,9'])
    assert.deepEqual(parseLira(input), { ok: false, message: FRACTION_MESSAGE }, input)
  assert.deepEqual(parseLira('1500,50'), { ok: false, message: FRACTION_MESSAGE })
  assert.deepEqual(parseLira('12.500,50'), { ok: false, message: FRACTION_MESSAGE })
  assert.equal(parseLira('on bin').ok, false)
  assert.equal(parseLira('-500').ok, false)
  assert.deepEqual(parseLira(''), { ok: false, message: 'Eğitim bedelini girin.' })
})

test('DOM-KAY-035: ,00 ile biten tam lira kabul edilir, bozuk ayraç biçim hatası alır', () => {
  assert.deepEqual(parseLira('1500,00'), { ok: true, lira: 1500 })
  assert.deepEqual(parseLira('12.500,00'), { ok: true, lira: 12500 })
  assert.deepEqual(parseLira('12 500,00 ₺'), { ok: true, lira: 12500 })
  for (const input of ['1.0000', '1,0000', '12.5000', '1,5,00', ',00', '12,000'])
    assert.equal(parseLira(input).ok, false, input)
  for (const input of ['1.0000', '1,0000', '12.5000'])
    assert.deepEqual(parseLira(input), { ok: false, message: AMOUNT_FORMAT_MESSAGE }, input)
  assert.deepEqual(parseLira('50,00'), { ok: false, message: LIRA_RANGE_MESSAGE })
})

test('DOM-KAY-035: tutar 100–1.000.000 ₺ dışında reddedilir, sınırlar kabul edilir', () => {
  assert.deepEqual(parseLira('99'), { ok: false, message: LIRA_RANGE_MESSAGE })
  assert.deepEqual(parseLira('1000001'), { ok: false, message: LIRA_RANGE_MESSAGE })
  assert.equal(parseLira('100').ok, true)
  assert.equal(parseLira('1.000.000').ok, true)
})

test('DOM-KAY-035: form şeması sınıf, taksit sayısı ve ilk vadeyi doğrular', () => {
  assert.equal(enrollFormSchema.safeParse(valid).success, true)
  const fields = (values: object) => {
    const result = enrollFormSchema.safeParse({ ...valid, ...values })
    return result.success ? [] : result.error.issues.map((issue) => String(issue.path[0]))
  }
  assert.deepEqual(fields({ classId: '' }), ['classId'])
  assert.deepEqual(fields({ total: '10,5' }), ['total'])
  assert.deepEqual(fields({ count: '0' }), ['count'])
  assert.deepEqual(fields({ count: '13' }), ['count'])
  assert.deepEqual(fields({ startDate: '' }), ['startDate'])
  assert.deepEqual(fields({ startDate: '2026-02-30' }), ['startDate'])
  assert.deepEqual(Object.keys(enrollDefaults()).sort(), ['classId', 'count', 'startDate', 'total'])
})

test('DOM-KAY-035: varsayılanlar Vue gibi 8 taksit ve Europe/Istanbul bugünüdür', () => {
  // 31 Ekim 21:30 UTC, İstanbul'da 1 Kasım 00:30'dur.
  const defaults = enrollDefaults(new Date('2026-10-31T21:30:00.000Z'))
  assert.equal(defaults.count, '8')
  assert.equal(defaults.startDate, '2026-11-01')
  assert.equal(enrollDefaults(new Date('2026-10-31T20:59:00.000Z')).startDate, '2026-10-31')
})

test('DOM-KAY-011: gövde kuruş tamsayı ve sayısal taksit taşır', () => {
  const body = enrollBody(enrollFormSchema.parse(valid))
  assert.deepEqual(body, {
    classId: 'c1',
    totalCents: 2_400_000,
    count: 6,
    startDate: '2026-12-01',
  })
  assert.equal(Number.isInteger(body.totalCents), true)
})

test('DOM-KAY-035: sunucu yolu ve kodu form alanına bağlanır', () => {
  assert.equal(enrollFieldOfPath('totalCents'), 'total')
  assert.equal(enrollFieldOfPath('total'), 'total')
  assert.equal(enrollFieldOfPath('classId'), 'classId')
  assert.equal(enrollFieldOfPath('studentId'), undefined)
  assert.equal(enrollFieldOfCode('class_capacity_full'), 'classId')
  assert.equal(enrollFieldOfCode('amount_not_whole_lira'), 'total')
  assert.equal(enrollFieldOfCode('prospect_closed'), undefined)
})

const classes = [
  { id: 'c-b', name: '8-A', branchId: 'b1', capacity: 2, isActive: true },
  { id: 'c-a', name: '10-A', branchId: 'b1', capacity: 24, isActive: true },
  { id: 'c-x', name: '9-C', branchId: 'b2', capacity: 24, isActive: true },
  { id: 'c-off', name: '7-A', branchId: 'b1', capacity: 24, isActive: false },
]
const branches = new Map([
  ['b1', 'Kadıköy'],
  ['b2', 'Beşiktaş'],
  ['b3', 'Kapalı Şube'],
])
const activeBranches = new Set(['b1', 'b2'])
const occupancy = new Map([
  ['c-b', 2],
  ['c-a', 5],
])

test('DOM-KAY-035: sınıf seçici varsayılan olarak adayın kampüsünü, etkin sınıfları gösterir', () => {
  const options = classOptions(classes, occupancy, branches, 'b1', false, activeBranches)
  assert.deepEqual(
    options.map((option) => option.id),
    ['c-b', 'c-a'],
  )
  assert.equal(options[0]?.label, '8-A · Kadıköy · 2/2 (dolu)')
  assert.equal(options[0]?.full, true)
  assert.equal(options[0]?.disabled, true)
  assert.equal(options[1]?.disabled, false)
  assert.equal(options[1]?.label, '10-A · Kadıköy · 5/24')
  assert.equal(options[1]?.full, false)
})

test('DOM-KAY-035: "tüm kampüsler" diğer kampüsün sınıflarını da getirir, pasif sınıf hiç gelmez', () => {
  const options = classOptions(classes, occupancy, branches, 'b1', true, activeBranches)
  assert.deepEqual(
    options.map((option) => option.id),
    ['c-x', 'c-b', 'c-a'],
  )
  assert.equal(options[0]?.label, '9-C · Beşiktaş · 0/24')
  assert.equal(
    options.some((option) => option.id === 'c-off'),
    false,
  )
})

test('DOM-KAY-035: pasif kampüsün etkin sınıfı seçeneklerde çıkmaz', () => {
  const withInactiveBranch = [
    ...classes,
    { id: 'c-z', name: '5-A', branchId: 'b3', capacity: 24, isActive: true },
  ]
  for (const all of [false, true]) {
    const options = classOptions(withInactiveBranch, occupancy, branches, 'b3', all, activeBranches)
    assert.equal(
      options.some((option) => option.id === 'c-z'),
      false,
      `tüm kampüsler=${all}`,
    )
  }
})

test('DOM-KAY-011: taksit önizlemesi kuruş farkını ilk taksitlere verir, toplam korunur', () => {
  const preview = installmentPreview(1_000_000, 3)
  assert.deepEqual(preview, { count: 3, first: 333_334, last: 333_333, total: 1_000_000 })
  assert.deepEqual(installmentPreview(2_400_000, 1), {
    count: 1,
    first: 2_400_000,
    last: 2_400_000,
    total: 2_400_000,
  })
})
