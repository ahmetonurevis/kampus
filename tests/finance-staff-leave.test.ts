import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AGE_MINIMUM_DAYS,
  ageRuleApplies,
  anniversary,
  calendarDays,
  completedYears,
  effectiveLeaveTypes,
  isDefaultLeaveTypeCode,
  LEAVE_CUSTOM_TYPE_MAX,
  LEAVE_TYPE_DEFAULTS,
  leaveDaysText,
  leaveEntitlement,
  leaveProfileSchema,
  leaveProfileUpdateSchema,
  leaveRecordCancelSchema,
  leaveRecordSchema,
  leaveTypeCreateSchema,
  leaveTypeUpdateSchema,
  periodsOverlap,
  planLeaveProfile,
  planLeaveProfileUpdate,
  planLeaveRecord,
  planLeaveTypeCreate,
  planLeaveTypeUpdate,
  seniorityLeaveDays,
  seniorityStartOf,
  type LeaveProfile,
  type LeaveRecordInput,
  type LeaveType,
  type LeaveUsage,
  type StoredLeaveType,
} from '../packages/school-core/src/lib/finance-staff-leave.ts'

import { isDomainError } from './support/domain-error.ts'

// Personel izin türleri ve yıllık izin hak edişi (DOM-FIN-109; ON-181). Kararlar K-360…K-362.

const TODAY = '2026-10-06'
const rejects = (run: () => unknown, code: string) => assert.throws(run, isDomainError(code))
const profile = (overrides: Partial<LeaveProfile> = {}): LeaveProfile => ({
  seniorityStartDate: '2020-03-15',
  birthDate: null,
  openingBalance: null,
  ...overrides,
})
const annual = (startDate: string, days: number): LeaveUsage => ({
  startDate,
  days,
  deductsFromAnnual: true,
})
const TYPES = effectiveLeaveTypes([])
const typeOf = (code: string, types: readonly LeaveType[] = TYPES) => {
  const found = types.find((type) => type.code === code)
  assert.ok(found, code)
  return found
}

test('DOM-FIN-109: kıdem eşikleri 1–5 yıl 14, 6–14 yıl 20, 15 yıl ve üstü 26 gün (4857 md. 53)', () => {
  assert.equal(seniorityLeaveDays(0), 0)
  assert.equal(seniorityLeaveDays(1), 14)
  assert.equal(seniorityLeaveDays(5), 14)
  assert.equal(seniorityLeaveDays(6), 20)
  assert.equal(seniorityLeaveDays(14), 20)
  assert.equal(seniorityLeaveDays(15), 26)
  assert.equal(seniorityLeaveDays(40), 26)
})

test('DOM-FIN-109: sınır yaşlar: 18 yaşından küçük ve 50 yaş ve üstü en az 20 gün (K-360)', () => {
  assert.equal(ageRuleApplies(17), true)
  assert.equal(ageRuleApplies(18), false)
  assert.equal(ageRuleApplies(49), false)
  assert.equal(ageRuleApplies(50), true)
  // 2008-10-07 doğumlu: 2025-10-06 hak edişinde 16 yaşında (20), 2026-10-06'da 17 (20).
  const young = leaveEntitlement(
    profile({ seniorityStartDate: '2024-10-06', birthDate: '2008-10-07' }),
    [],
    TODAY,
  )
  assert.deepEqual(
    young.accruals.map((a) => [a.age, a.ageRule, a.days]),
    [
      [16, true, AGE_MINIMUM_DAYS],
      [17, true, AGE_MINIMUM_DAYS],
    ],
  )
  // 18. doğum günü hak ediş günüyse kural kalkar.
  const eighteen = leaveEntitlement(
    profile({ seniorityStartDate: '2025-10-06', birthDate: '2008-10-06' }),
    [],
    TODAY,
  )
  assert.deepEqual(
    eighteen.accruals.map((a) => [a.age, a.ageRule, a.days]),
    [[18, false, 14]],
  )
  // 50 yaş hak ediş gününde dolar (dahil); bir gün önce 49.
  const fifty = leaveEntitlement(
    profile({ seniorityStartDate: '2023-10-06', birthDate: '1976-10-06' }),
    [],
    TODAY,
  )
  assert.deepEqual(
    fifty.accruals.map((a) => [a.age, a.days]),
    [
      [48, 14],
      [49, 14],
      [50, 20],
    ],
  )
  const fortyNine = leaveEntitlement(
    profile({ seniorityStartDate: '2025-10-06', birthDate: '1976-10-07' }),
    [],
    TODAY,
  )
  assert.equal(fortyNine.accruals[0]?.days, 14)
  // Kıdem dilimi 20'den büyükse yaş kuralı düşürmez.
  const senior = leaveEntitlement(
    profile({ seniorityStartDate: '2006-01-01', birthDate: '1960-01-01' }),
    [],
    TODAY,
  )
  assert.equal(senior.accruals.at(-1)?.days, 26)
  assert.equal(senior.accruals.at(-1)?.ageRule, true)
  // Doğum günü yoksa yaş kuralı uygulanmaz.
  assert.equal(leaveEntitlement(profile(), [], TODAY).accruals[0]?.age, null)
})

test('DOM-FIN-109: artık yıl: 29 Şubat başlangıcının yıl dönümü 28 Şubat; yaş da öyle dolar', () => {
  assert.equal(anniversary('2020-02-29', 1), '2021-02-28')
  assert.equal(anniversary('2020-02-29', 4), '2024-02-29')
  assert.equal(completedYears('2020-02-29', '2021-02-27'), 0)
  assert.equal(completedYears('2020-02-29', '2021-02-28'), 1)
  assert.equal(completedYears('2008-02-29', '2026-02-27'), 17)
  assert.equal(completedYears('2008-02-29', '2026-02-28'), 18)
  assert.equal(completedYears('2026-10-06', '2026-10-05'), 0)
  const leap = leaveEntitlement(profile({ seniorityStartDate: '2020-02-29' }), [], '2024-02-29')
  assert.deepEqual(
    leap.accruals.map((a) => a.date),
    ['2021-02-28', '2022-02-28', '2023-02-28', '2024-02-29'],
  )
  assert.equal(leap.next?.date, '2025-02-28')
  assert.equal(calendarDays('2024-02-28', '2024-03-01'), 3)
  assert.equal(calendarDays('2025-02-28', '2025-03-01'), 2)
})

test('DOM-FIN-109: ilk hak ediş bir yıl dolunca; kıdem eşiği hak ediş gününde değişir', () => {
  const start = profile({ seniorityStartDate: '2025-10-07' })
  const before = leaveEntitlement(start, [], TODAY)
  assert.equal(before.serviceYears, 0)
  assert.deepEqual(before.accruals, [])
  assert.equal(before.balanceDays, 0)
  assert.deepEqual(before.next, {
    serviceYear: 1,
    date: '2026-10-07',
    baseDays: 14,
    age: null,
    ageRule: false,
    days: 14,
  })
  // 2010-10-06 girişte 2026-10-06 16. yıl: 5×14 + 9×20 + 2×26.
  const long = leaveEntitlement(profile({ seniorityStartDate: '2010-10-06' }), [], TODAY)
  assert.equal(long.serviceYears, 16)
  assert.deepEqual(
    long.accruals.map((a) => a.days),
    [14, 14, 14, 14, 14, 20, 20, 20, 20, 20, 20, 20, 20, 20, 26, 26],
  )
  assert.equal(long.entitledDays, 5 * 14 + 9 * 20 + 2 * 26)
  // Kıdem başlangıcından önceki gün için hesap boştur.
  const early = leaveEntitlement(profile(), [], '2019-01-01')
  assert.equal(early.serviceYears, 0)
  assert.equal(early.next?.date, '2021-03-15')
})

test('DOM-FIN-109: devreden bakiye, bu yılın hakkı, kullanılan, planlanan ve kalan', () => {
  // 2020-03-15 giriş: 2021…2025 beş hak ediş × 14, 2026 altıncı yıl 20 = 90.
  const usages = [
    annual('2022-07-01', 10),
    annual('2026-01-05', 5),
    annual('2026-04-01', 3),
    annual('2026-12-28', 4),
    { startDate: '2026-05-01', days: 3, deductsFromAnnual: false },
  ]
  const result = leaveEntitlement(profile(), usages, TODAY)
  assert.equal(result.entitledDays, 90)
  assert.equal(result.usedDays, 18)
  assert.equal(result.plannedDays, 4)
  assert.equal(result.balanceDays, 72)
  assert.equal(result.balanceAfterPlannedDays, 68)
  assert.equal(result.currentYearDays, 20)
  assert.equal(result.usedThisYearDays, 3)
  // Son hak ediş (2026-03-15) öncesi: 70 hak − 15 kullanılan = 55 devreden.
  assert.equal(result.carriedOverDays, 55)
  assert.equal(result.carriedOverDays + result.currentYearDays - result.usedThisYearDays, 72)
  // Avans izin: bakiye eksiye düşebilir.
  const advance = leaveEntitlement(
    profile({ seniorityStartDate: '2026-01-01' }),
    [annual('2026-06-01', 5)],
    TODAY,
  )
  assert.equal(advance.balanceDays, -5)
  assert.equal(advance.carriedOverDays, 0)
  assert.equal(advance.usedThisYearDays, 5)
})

test('DOM-FIN-109: açılış devri o güne kadarki hak ediş ve kullanımın yerini alır', () => {
  const opened = profile({ openingBalance: { asOf: '2025-12-31', days: 12 } })
  const result = leaveEntitlement(
    opened,
    [annual('2025-06-01', 30), annual('2025-12-31', 2), annual('2026-02-01', 4)],
    TODAY,
  )
  assert.deepEqual(
    result.accruals.map((a) => a.inOpeningBalance),
    [true, true, true, true, true, false],
  )
  assert.equal(result.openingDays, 12)
  assert.equal(result.entitledDays, 20)
  assert.equal(result.usedDays, 4)
  assert.equal(result.balanceDays, 28)
  assert.equal(result.currentYearDays, 20)
  assert.equal(result.usedThisYearDays, 0)
  assert.equal(result.carriedOverDays, 8)
  // Açılış son hak edişten sonraysa bu yılın hakkı devrin içindedir.
  const late = leaveEntitlement(
    profile({ openingBalance: { asOf: '2026-06-30', days: -3 } }),
    [annual('2026-07-01', 2)],
    TODAY,
  )
  assert.equal(late.currentYearDays, 0)
  assert.equal(late.balanceDays, -5)
})

test('DOM-FIN-109: ayrılan personelde hizmet ayrılış gününde biter; sonraki yıl dönümü hak ettirmez', () => {
  const result = leaveEntitlement(profile(), [], TODAY, '2025-03-14')
  assert.equal(result.serviceYears, 4)
  assert.equal(result.entitledDays, 56)
  assert.equal(result.next, null)
  const onDay = leaveEntitlement(profile(), [], TODAY, '2025-03-15')
  assert.equal(onDay.serviceYears, 5)
  assert.equal(onDay.next, null)
  // Ayrılış ileri tarihliyse bugüne kadar hesaplanır, sonraki hak ediş görünür.
  const later = leaveEntitlement(profile(), [], TODAY, '2027-12-31')
  assert.equal(later.serviceYears, 6)
  assert.equal(later.next?.date, '2027-03-15')
  assert.equal(seniorityStartOf(profile()), '2020-03-15')
  assert.equal(seniorityStartOf(null), null)
})

test('DOM-FIN-109: varsayılan türler ve Ek md. 2 günleri; kurum ayarı kilitli alanı değiştirmez (K-361)', () => {
  assert.deepEqual(
    TYPES.map((type) => [type.code, type.paid, type.deductsFromAnnual, type.defaultDays]),
    [
      ['annual', true, true, null],
      ['marriage', true, false, 3],
      ['adoption', true, false, 3],
      ['bereavement', true, false, 3],
      ['paternity', true, false, 5],
      ['child_treatment', true, false, 10],
      ['unpaid', false, false, null],
      ['sick', false, false, null],
      ['other', true, false, null],
    ],
  )
  assert.ok(TYPES.every((type) => type.version === 0 && type.isActive && !type.isCustom))
  assert.equal(isDefaultLeaveTypeCode('marriage'), true)
  assert.equal(isDefaultLeaveTypeCode('custom_ab12'), false)
  const stored: StoredLeaveType[] = [
    {
      code: 'annual',
      kind: 'annual',
      label: 'Yıllık izin',
      paid: false,
      deductsFromAnnual: false,
      defaultDays: null,
      isActive: false,
      version: 2,
    },
    {
      code: 'other',
      kind: 'other',
      label: 'İdari izin',
      paid: false,
      deductsFromAnnual: true,
      defaultDays: 2,
      isActive: false,
      version: 1,
    },
    {
      code: 'custom_b',
      kind: 'excuse',
      label: 'Sınav izni',
      paid: true,
      deductsFromAnnual: false,
      defaultDays: 1,
      isActive: true,
      version: 1,
    },
    {
      code: 'custom_a',
      kind: 'unpaid',
      label: 'Askerlik',
      paid: false,
      deductsFromAnnual: false,
      defaultDays: null,
      isActive: true,
      version: 1,
    },
  ]
  const merged = effectiveLeaveTypes(stored)
  // Kilitli alanlarda saklanan değer yok sayılır, ad kurumundur.
  assert.deepEqual(
    [
      typeOf('annual', merged).label,
      typeOf('annual', merged).paid,
      typeOf('annual', merged).isActive,
    ],
    ['Yıllık izin', true, true],
  )
  assert.equal(typeOf('annual', merged).version, 2)
  assert.deepEqual(
    [typeOf('other', merged).paid, typeOf('other', merged).deductsFromAnnual],
    [false, true],
  )
  assert.equal(typeOf('other', merged).isActive, false)
  assert.deepEqual(
    merged.slice(-2).map((type) => [type.code, type.isCustom]),
    [
      ['custom_a', true],
      ['custom_b', true],
    ],
  )
  assert.equal(LEAVE_TYPE_DEFAULTS.length, 9)
})

test('DOM-FIN-109: tür ayarı: kilit, yasal en az gün, tekil ad ve değişiklik yok reddi (K-361)', () => {
  const update = (code: string, input: unknown) =>
    planLeaveTypeUpdate(typeOf(code), leaveTypeUpdateSchema.parse(input), TYPES)
  rejects(() => update('annual', { deductsFromAnnual: false }), 'leave_type_locked')
  rejects(() => update('annual', { isActive: false }), 'leave_type_locked')
  rejects(() => update('marriage', { paid: false }), 'leave_type_locked')
  rejects(() => update('unpaid', { paid: true }), 'leave_type_locked')
  rejects(() => update('sick', { isActive: false }), 'leave_type_locked')
  rejects(() => update('paternity', { defaultDays: 4 }), 'leave_type_days_below_statutory')
  rejects(() => update('paternity', { defaultDays: null }), 'leave_type_days_below_statutory')
  rejects(() => update('other', { label: 'evlilik İZNİ' }), 'leave_type_label_exists')
  rejects(() => update('marriage', { label: 'Evlilik izni' }), 'leave_type_unchanged')
  // Kilitli alan aynı değerle gelirse değişiklik sayılmaz.
  rejects(() => update('annual', { paid: true }), 'leave_type_unchanged')
  assert.deepEqual(update('paternity', { defaultDays: 10, label: 'Babalık izni' }), {
    code: 'paternity',
    kind: 'excuse',
    label: 'Babalık izni',
    paid: true,
    deductsFromAnnual: false,
    defaultDays: 10,
    isActive: true,
  })
  assert.equal(update('sick', { paid: true }).paid, true)
  assert.equal(update('other', { deductsFromAnnual: true }).deductsFromAnnual, true)
  assert.equal(update('marriage', { isActive: false }).isActive, false)
  assert.equal(leaveTypeUpdateSchema.safeParse({}).success, false)
  assert.equal(leaveTypeUpdateSchema.safeParse({ code: 'x' }).success, false)
  assert.equal(leaveTypeUpdateSchema.safeParse({ defaultDays: 0 }).success, false)
})

test('DOM-FIN-109: kurumun ek türü: ücretsiz ücretli olamaz, ad tekil, en çok 30 (K-361)', () => {
  const create = (input: unknown, types: readonly LeaveType[] = TYPES) =>
    planLeaveTypeCreate(leaveTypeCreateSchema.parse(input), types)
  const exam = { kind: 'excuse', label: ' Sınav izni ', paid: true, deductsFromAnnual: false }
  assert.equal(leaveTypeCreateSchema.parse(exam).label, 'Sınav izni')
  assert.equal(leaveTypeCreateSchema.parse(exam).defaultDays, null)
  create(exam)
  rejects(() => create({ ...exam, kind: 'unpaid' }), 'leave_type_locked')
  rejects(
    () => create({ ...exam, label: 'RAPOR (ücret SGK ödeneğinden)' }),
    'leave_type_label_exists',
  )
  const full = [
    ...TYPES,
    ...Array.from({ length: LEAVE_CUSTOM_TYPE_MAX }, (_, index) => ({
      ...typeOf('other'),
      code: `custom_${String(index)}`,
      label: `Tür ${String(index)}`,
      isCustom: true,
    })),
  ]
  rejects(() => create(exam, full), 'leave_type_limit')
  for (const bad of [
    { ...exam, kind: 'annual' },
    { ...exam, kind: 'sick' },
    { ...exam, label: 'x' },
    { ...exam, paid: 'evet' },
    { ...exam, defaultDays: 1.5 },
    { ...exam, extra: true },
  ])
    assert.equal(leaveTypeCreateSchema.safeParse(bad).success, false, JSON.stringify(bad))
})

test('DOM-FIN-109: izin profili: kıdem başlangıcı, doğum günü ve açılış devri denetlenir (K-360)', () => {
  const staff = { role: 'ogretmen', active: true }
  const open = (input: unknown, exists = false) =>
    planLeaveProfile(leaveProfileSchema.parse(input), { staff, exists, today: TODAY })
  const base = { membershipId: 'm-selin', seniorityStartDate: '2020-03-15' }
  assert.deepEqual(open(base), profile())
  rejects(() => open(base, true), 'staff_leave_profile_exists')
  rejects(
    () => open({ ...base, seniorityStartDate: '1959-12-31' }),
    'staff_leave_seniority_too_early',
  )
  rejects(() => open({ ...base, seniorityStartDate: '2026-10-07' }), 'staff_leave_seniority_future')
  rejects(() => open({ ...base, birthDate: '2026-10-07' }), 'staff_leave_birth_date_invalid')
  rejects(() => open({ ...base, birthDate: '1919-12-31' }), 'staff_leave_birth_date_invalid')
  // İşe başlarken 14 yaşını doldurmuş olmalı.
  rejects(() => open({ ...base, birthDate: '2006-03-16' }), 'staff_leave_birth_date_invalid')
  assert.equal(open({ ...base, birthDate: '2006-03-15' }).birthDate, '2006-03-15')
  rejects(
    () => open({ ...base, openingBalance: { asOf: '2020-03-14', days: 3 } }),
    'staff_leave_opening_date_invalid',
  )
  rejects(
    () => open({ ...base, openingBalance: { asOf: '2026-10-07', days: 3 } }),
    'staff_leave_opening_date_invalid',
  )
  for (const bad of [
    { ...base, openingBalance: { asOf: '2025-01-01', days: 1000 } },
    { ...base, openingBalance: { asOf: '2025-01-01', days: -367 } },
    { ...base, openingBalance: { asOf: '2025-01-01', days: 1.5 } },
    { ...base, seniorityStartDate: '2026-02-30' },
    { ...base, institutionId: 'x' },
  ])
    assert.equal(leaveProfileSchema.safeParse(bad).success, false, JSON.stringify(bad))
  rejects(
    () =>
      planLeaveProfile(leaveProfileSchema.parse(base), {
        staff: { role: 'veli', active: true },
        exists: false,
        today: TODAY,
      }),
    'staff_leave_not_staff',
  )
  rejects(
    () =>
      planLeaveProfile(leaveProfileSchema.parse(base), {
        staff: null,
        exists: false,
        today: TODAY,
      }),
    'staff_leave_staff_not_found',
  )
})

test('DOM-FIN-109: profil düzeltmesi birleşir; yıllık izin kaydı yeni kıdem başlangıcından önce kalamaz', () => {
  const staff = { role: 'onburo', active: true }
  const update = (input: unknown, firstAnnualRecord: string | null = null) =>
    planLeaveProfileUpdate(
      profile({ birthDate: '1980-01-01' }),
      leaveProfileUpdateSchema.parse(input),
      {
        staff,
        today: TODAY,
        firstAnnualRecord,
      },
    )
  assert.deepEqual(update({ openingBalance: { asOf: '2025-12-31', days: 4 } }), {
    seniorityStartDate: '2020-03-15',
    birthDate: '1980-01-01',
    openingBalance: { asOf: '2025-12-31', days: 4 },
  })
  assert.equal(update({ birthDate: null }).birthDate, null)
  rejects(() => update({ birthDate: '1980-01-01' }), 'staff_leave_profile_unchanged')
  rejects(() => update({ openingBalance: null }), 'staff_leave_profile_unchanged')
  rejects(
    () => update({ seniorityStartDate: '2021-01-01' }, '2020-08-01'),
    'staff_leave_before_seniority',
  )
  assert.equal(
    update({ seniorityStartDate: '2020-08-01' }, '2020-08-01').seniorityStartDate,
    '2020-08-01',
  )
  rejects(
    () =>
      planLeaveProfileUpdate(profile(), leaveProfileUpdateSchema.parse({ birthDate: null }), {
        staff: { role: 'onburo', active: false },
        today: TODAY,
        firstAnnualRecord: null,
      }),
    'staff_leave_staff_inactive',
  )
  assert.equal(leaveProfileUpdateSchema.safeParse({}).success, false)
})

test('DOM-FIN-109: kullanılmış izin kaydı tür kopyasını taşır; rapor, çakışma ve aralık reddi (K-362)', () => {
  const RECORD: LeaveRecordInput = {
    membershipId: 'm-selin',
    typeCode: 'annual',
    startDate: '2026-07-06',
    endDate: '2026-07-17',
    days: 10,
  }
  const plan = (
    input: LeaveRecordInput,
    overrides: Partial<Parameters<typeof planLeaveRecord>[1]> = {},
  ) => {
    const parsed = leaveRecordSchema.parse(input)
    return planLeaveRecord(parsed, {
      staff: { role: 'ogretmen', active: true },
      type: TYPES.find((type) => type.code === parsed.typeCode) ?? null,
      profile: profile(),
      records: [],
      ...overrides,
    })
  }
  assert.deepEqual(plan(RECORD), {
    kind: 'annual',
    typeLabel: 'Yıllık ücretli izin',
    paid: true,
    deductsFromAnnual: true,
  })
  assert.equal(leaveRecordSchema.parse({ ...RECORD, note: ' ' }).note, null)
  // Takvim günü kadar iş günü olabilir (12 gün), fazlası olamaz.
  assert.equal(plan({ ...RECORD, days: 12 }).deductsFromAnnual, true)
  rejects(() => plan({ ...RECORD, days: 13 }), 'staff_leave_days_exceed_range')
  rejects(() => plan({ ...RECORD, typeCode: 'sick' }), 'staff_leave_sick_not_manual')
  rejects(() => plan({ ...RECORD, typeCode: 'custom_yok' }), 'staff_leave_type_not_found')
  rejects(
    () => plan(RECORD, { type: { ...typeOf('annual'), isActive: false } }),
    'staff_leave_type_inactive',
  )
  rejects(() => plan(RECORD, { profile: null }), 'staff_leave_profile_required')
  rejects(() => plan({ ...RECORD, startDate: '2020-03-14' }), 'staff_leave_before_seniority')
  // Yıllık izinden düşmeyen tür profil istemez.
  assert.equal(plan({ ...RECORD, typeCode: 'marriage', days: 3 }, { profile: null }).paid, true)
  rejects(
    () => plan(RECORD, { records: [{ id: 'l1', startDate: '2026-07-17', endDate: '2026-07-20' }] }),
    'staff_leave_overlap',
  )
  assert.equal(
    plan(RECORD, { records: [{ id: 'l1', startDate: '2026-07-18', endDate: '2026-07-20' }] }).kind,
    'annual',
  )
  rejects(
    () => plan(RECORD, { staff: { role: 'ogretmen', active: false } }),
    'staff_leave_staff_inactive',
  )
  for (const bad of [
    { ...RECORD, endDate: '2026-07-05' },
    { ...RECORD, days: 0 },
    { ...RECORD, days: 367 },
    { ...RECORD, typeCode: 'Yıllık' },
    { ...RECORD, note: 'x'.repeat(201) },
  ])
    assert.equal(leaveRecordSchema.safeParse(bad).success, false, JSON.stringify(bad))
  assert.equal(
    periodsOverlap(RECORD as never, { startDate: '2026-07-17', endDate: '2026-07-17' }),
    true,
  )
  assert.equal(leaveRecordCancelSchema.safeParse({ reason: 'kısa' }).success, false)
  assert.equal(
    leaveRecordCancelSchema.parse({ reason: ' Yanlış girildi ' }).reason,
    'Yanlış girildi',
  )
  assert.equal(leaveDaysText(-2), '-2 gün')
})
