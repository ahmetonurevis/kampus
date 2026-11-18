import assert from 'node:assert/strict'
import test from 'node:test'

import {
  staffCostCsv,
  staffCostNotes,
  staffCostParameters,
  staffCostReport,
  staffMonthCost,
  splitStaffCost,
  type StaffCostAllocation,
  type StaffCostCenter,
  type StaffCostMember,
  type StaffCostMonthParameters,
  type StaffCostRate,
  type StaffCostReportInput,
} from '../packages/school-core/src/lib/finance-staff-cost-report.ts'
import {
  allocationEndMonth,
  allocationInMonth,
  daysInMonth,
  monthLabel,
  monthRangeLabel,
  monthsBetween,
  nextMonth,
  planStaffCostAllocation,
  shareLabel,
  staffCostAllocationCancelSchema,
  staffCostAllocationInputSchema,
  staffCostRangeIssue,
  type StaffCostAllocationChecks,
  type StaffCostAllocationInput,
} from '../packages/school-core/src/lib/finance-staff-costs.ts'
import { isDomainError } from './support/domain-error.ts'

// Personel maliyet raporu ve maliyet merkezi ataması (DOM-FIN-104; ON-204). Kararlar K-332…K-335.

const LISE = '00000000-0000-4000-8000-000000000001'
const ORTA = '00000000-0000-4000-8000-000000000002'
const PASIF = '00000000-0000-4000-8000-000000000003'

const INPUT: StaffCostAllocationInput = {
  membershipId: 'm-selin',
  startMonth: '2026-09',
  shares: [
    { costCenterId: LISE, shareBasisPoints: 6000 },
    { costCenterId: ORTA, shareBasisPoints: 4000 },
  ],
}

const issues = (value: unknown) => {
  const result = staffCostAllocationInputSchema.safeParse(value)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

test('DOM-FIN-104: atama şeması payları %100, merkezi tekil ve saati 0–300 ister (K-332)', () => {
  const parsed = staffCostAllocationInputSchema.parse(INPUT)
  assert.deepEqual(
    [parsed.wageHours, parsed.extraLessonHours, parsed.dutyHours],
    [null, null, null],
  )
  assert.deepEqual(issues({ ...INPUT, shares: [{ costCenterId: LISE, shareBasisPoints: 6000 }] }), [
    'Payların toplamı %100 olmalıdır (şu an %60).',
  ])
  assert.deepEqual(
    issues({
      ...INPUT,
      shares: [
        { costCenterId: LISE, shareBasisPoints: 5000 },
        { costCenterId: LISE, shareBasisPoints: 5000 },
      ],
    }),
    ['Bir maliyet merkezi atamada bir kez seçilir.'],
  )
  assert.deepEqual(issues({ ...INPUT, shares: [] }), ['En az bir maliyet merkezi seçin.'])
  assert.ok(issues({ ...INPUT, wageHours: 301 }).length === 1)
  assert.ok(issues({ ...INPUT, dutyHours: -1 }).length === 1)
  assert.ok(issues({ ...INPUT, extraLessonHours: 2.5 }).length === 1)
  assert.ok(issues({ ...INPUT, startMonth: '2026-13' }).length === 1)
  assert.ok(issues({ ...INPUT, startMonth: '2019-12' }).length === 1)
  assert.ok(issues({ ...INPUT, institutionId: 'x' }).length === 1)
  assert.ok(issues({ ...INPUT, shares: [{ costCenterId: LISE, shareBasisPoints: 0 }] }).length >= 1)
  assert.equal(staffCostAllocationCancelSchema.safeParse({ reason: 'kısa' }).success, false)
  assert.equal(
    staffCostAllocationCancelSchema.parse({ reason: '  Yanlış merkez  ' }).reason,
    'Yanlış merkez',
  )
})

test('DOM-FIN-104: ay yardımcıları ve dönem sınırı', () => {
  assert.equal(daysInMonth('2028-02'), 29)
  assert.equal(daysInMonth('2026-02'), 28)
  assert.equal(nextMonth('2026-12'), '2027-01')
  assert.deepEqual(monthsBetween('2026-11', '2027-02'), [
    '2026-11',
    '2026-12',
    '2027-01',
    '2027-02',
  ])
  assert.equal(monthLabel('2026-10'), 'Ekim 2026')
  assert.equal(monthRangeLabel('2026-01', '2026-03'), 'Ocak 2026 – Mart 2026')
  assert.equal(monthRangeLabel('2026-01', '2026-01'), 'Ocak 2026')
  assert.equal(shareLabel(3333), '%33,33')
  assert.equal(staffCostRangeIssue('2026-01', '2026-12'), null)
  assert.equal(staffCostRangeIssue('2026-01', '2027-01'), 'Dönem en çok 12 ay olabilir.')
  assert.equal(
    staffCostRangeIssue('2026-02', '2026-01'),
    'Bitiş ayı başlangıç ayından önce olamaz.',
  )
})

test('DOM-FIN-104: ayın ataması en geç başlayandır; bitiş sonraki atamadan bir önceki ay', () => {
  const list = [
    { membershipId: 'a', startMonth: '2026-01' },
    { membershipId: 'a', startMonth: '2026-09' },
    { membershipId: 'b', startMonth: '2026-03' },
  ]
  const own = list.filter((item) => item.membershipId === 'a')
  assert.equal(allocationInMonth(own, '2025-12'), null)
  assert.equal(allocationInMonth(own, '2026-08')?.startMonth, '2026-01')
  assert.equal(allocationInMonth(own, '2026-09')?.startMonth, '2026-09')
  assert.equal(allocationEndMonth(list[0]!, list), '2026-08')
  assert.equal(allocationEndMonth(list[1]!, list), null)
  assert.equal(
    allocationEndMonth({ membershipId: 'a', startMonth: '2026-01' }, [
      { membershipId: 'a', startMonth: '2026-01' },
      { membershipId: 'a', startMonth: '2027-01' },
    ]),
    '2026-12',
  )
})

test('DOM-FIN-104: atama kuralı personeli, merkezi ve aynı ayı denetler (K-332)', () => {
  const checks: StaffCostAllocationChecks = {
    staff: { role: 'ogretmen' },
    centers: new Map([
      [LISE, { isActive: true }],
      [ORTA, { isActive: true }],
      [PASIF, { isActive: false }],
    ]),
    monthTaken: false,
  }
  const parsed = staffCostAllocationInputSchema.parse(INPUT)
  assert.doesNotThrow(() => planStaffCostAllocation(parsed, checks))
  assert.throws(
    () => planStaffCostAllocation(parsed, { ...checks, staff: null }),
    isDomainError('staff_cost_staff_not_found'),
  )
  assert.throws(
    () => planStaffCostAllocation(parsed, { ...checks, staff: { role: 'veli' } }),
    isDomainError('staff_cost_not_staff'),
  )
  const withPassive = staffCostAllocationInputSchema.parse({
    ...INPUT,
    shares: [{ costCenterId: PASIF, shareBasisPoints: 10_000 }],
  })
  assert.throws(
    () => planStaffCostAllocation(withPassive, checks),
    isDomainError('staff_cost_center_inactive'),
  )
  const unknown = staffCostAllocationInputSchema.parse({
    ...INPUT,
    shares: [{ costCenterId: '00000000-0000-4000-8000-0000000000ff', shareBasisPoints: 10_000 }],
  })
  assert.throws(
    () => planStaffCostAllocation(unknown, checks),
    isDomainError('staff_cost_center_not_found'),
  )
  assert.throws(
    () => planStaffCostAllocation(parsed, { ...checks, monthTaken: true }),
    isDomainError('staff_cost_allocation_exists', 'conflict'),
  )
})

const PARAMS: StaffCostMonthParameters = {
  setId: 'set',
  origin: 'platform',
  stale: false,
  unverified: false,
  sgkEmployerNetRateBasisPoints: 1575,
  unemploymentEmployerRateBasisPoints: 200,
  sgkCeilingCents: 20_000_000,
}
const ACTIVE = { deactivatedDay: null }
const rate = (fields: Partial<StaffCostRate>): StaffCostRate => ({
  membershipId: 'm1',
  component: 'wage',
  rateType: 'monthly_gross',
  amountCents: 6_000_000,
  startDate: '2026-01-01',
  endDate: null,
  ...fields,
})

test('DOM-FIN-104: aylık brüt, SGK ve işsizlik işveren payı, yan hak (K-333)', () => {
  const cost = staffMonthCost({
    month: '2026-10',
    member: ACTIVE,
    rates: [rate({}), rate({ component: 'benefit', rateType: 'meal', amountCents: 300_000 })],
    allocation: null,
    parameters: PARAMS,
  })
  assert.deepEqual(cost, {
    included: true,
    flags: [],
    grossCents: 6_000_000,
    employerSgkCents: 945_000,
    unemploymentCents: 120_000,
    benefitsCents: 300_000,
    totalCents: 7_365_000,
  })
})

test('DOM-FIN-104: ay içinde başlayan, değişen ve pasifleşen ücret gün oranıyla (K-333)', () => {
  // 10 Ekim'de başlayan 31.000 ₺: 22/31 gün.
  const started = staffMonthCost({
    month: '2026-10',
    member: ACTIVE,
    rates: [rate({ amountCents: 3_100_000, startDate: '2026-10-10' })],
    allocation: null,
    parameters: PARAMS,
  })
  assert.equal(started.grossCents, 2_200_000)
  // Zam: 1–15 Kasım 30.000, 16–30 Kasım 36.000.
  const raised = staffMonthCost({
    month: '2026-11',
    member: ACTIVE,
    rates: [
      rate({ amountCents: 3_000_000, endDate: '2026-11-15' }),
      rate({ amountCents: 3_600_000, startDate: '2026-11-16' }),
    ],
    allocation: null,
    parameters: PARAMS,
  })
  assert.equal(raised.grossCents, 3_300_000)
  // 20 Kasım'da pasifleşen personel: 20/30 gün.
  const left = staffMonthCost({
    month: '2026-11',
    member: { deactivatedDay: '2026-11-20' },
    rates: [rate({ amountCents: 3_000_000 })],
    allocation: null,
    parameters: PARAMS,
  })
  assert.equal(left.grossCents, 2_000_000)
  const gone = staffMonthCost({
    month: '2026-12',
    member: { deactivatedDay: '2026-11-20' },
    rates: [rate({})],
    allocation: null,
    parameters: PARAMS,
  })
  assert.equal(gone.included, false)
  assert.equal(gone.totalCents, 0)
})

test('DOM-FIN-104: SGK matrahı tavanı aşmaz; net ücret ve saati olmayan ücret dahil edilmez (K-333)', () => {
  const capped = staffMonthCost({
    month: '2026-10',
    member: ACTIVE,
    rates: [rate({ amountCents: 30_000_000 })],
    allocation: null,
    parameters: PARAMS,
  })
  assert.equal(capped.employerSgkCents, 3_150_000)
  assert.equal(capped.unemploymentCents, 400_000)

  const net = staffMonthCost({
    month: '2026-10',
    member: ACTIVE,
    rates: [
      rate({ rateType: 'monthly_net' }),
      rate({ component: 'benefit', rateType: 'transport', amountCents: 100_000 }),
    ],
    allocation: null,
    parameters: PARAMS,
  })
  assert.deepEqual(net.flags, ['net_wage'])
  assert.equal(net.grossCents, 0)
  assert.equal(net.totalCents, 100_000)

  const hourly = [
    rate({ rateType: 'lesson_hour', amountCents: 50_000 }),
    rate({ component: 'lesson', rateType: 'extra', amountCents: 40_000 }),
    rate({ component: 'lesson', rateType: 'duty', amountCents: 20_000 }),
  ]
  const missing = staffMonthCost({
    month: '2026-10',
    member: ACTIVE,
    rates: hourly,
    allocation: null,
    parameters: PARAMS,
  })
  assert.deepEqual(missing.flags, ['missing_wage_hours', 'missing_lesson_hours'])
  assert.equal(missing.included, true)
  assert.equal(missing.grossCents, 0)
  const withHours = staffMonthCost({
    month: '2026-10',
    member: ACTIVE,
    rates: hourly,
    allocation: { wageHours: 80, extraLessonHours: 10, dutyHours: 0 },
    parameters: PARAMS,
  })
  assert.deepEqual(withHours.flags, [])
  assert.equal(withHours.grossCents, 80 * 50_000 + 10 * 40_000)
})

test('DOM-FIN-104: paylara bölme toplamı korur', () => {
  const amounts = {
    grossCents: 100_001,
    employerSgkCents: 15_751,
    unemploymentCents: 2001,
    benefitsCents: 1,
    totalCents: 117_754,
  }
  const parts = splitStaffCost(amounts, [3333, 3333, 3334])
  for (const key of Object.keys(amounts) as (keyof typeof amounts)[])
    assert.equal(
      parts.reduce((sum, part) => sum + part[key], 0),
      amounts[key],
      key,
    )
})

test('DOM-FIN-104: parametre ayın ilk günü setinden; ilk setten önce 422 (K-333)', () => {
  const params = staffCostParameters(['2025-06', '2026-02'], [])
  assert.equal(params.get('2025-06')?.origin, 'platform')
  assert.equal(params.get('2025-06')?.sgkEmployerNetRateBasisPoints, 1575)
  assert.equal(params.get('2025-06')?.unemploymentEmployerRateBasisPoints, 200)
  assert.equal(params.get('2026-02')?.unverified, true)
  assert.equal(staffCostParameters(['2030-01'], []).get('2030-01')?.stale, true)
  assert.throws(
    () => staffCostParameters(['2024-12'], []),
    isDomainError('payroll_parameters_missing'),
  )
})

const CENTERS: StaffCostCenter[] = [
  { id: LISE, code: 'LISE', name: 'Lise', type: 'program', parentId: null, isActive: true },
  { id: ORTA, code: 'ORTA', name: 'Ortaokul', type: 'program', parentId: null, isActive: true },
]
const member = (id: string, name = id): StaffCostMember => ({
  membershipId: id,
  name,
  role: 'ogretmen',
  deactivatedDay: null,
})
const allocation = (
  membershipId: string,
  shares: [string, number][],
  startMonth = '2026-01',
): StaffCostAllocation => ({
  id: `a-${membershipId}-${startMonth}`,
  membershipId,
  startMonth,
  shares: shares.map(([costCenterId, shareBasisPoints]) => ({ costCenterId, shareBasisPoints })),
  wageHours: null,
  extraLessonHours: null,
  dutyHours: null,
})

function reportInput(overrides: Partial<StaffCostReportInput> = {}): StaffCostReportInput {
  const ids = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']
  return {
    from: '2026-10',
    to: '2026-10',
    people: false,
    staff: [...ids.map((id) => member(id)), member('m7', 'Atanmamış Kişi')],
    rates: [...ids, 'm7'].map((id) => rate({ membershipId: id, amountCents: 1_000_000 })),
    allocations: [
      // Lise: m1–m5 tam, m6 %60 (6 kişi); ortaokul: m6 %40 (1 kişi).
      ...['m1', 'm2', 'm3', 'm4', 'm5'].map((id) => allocation(id, [[LISE, 10_000]])),
      allocation('m6', [
        [LISE, 6000],
        [ORTA, 4000],
      ]),
    ],
    centers: CENTERS,
    parameters: new Map([
      ['2026-10', PARAMS],
      ['2026-11', { ...PARAMS, setId: 'set-2', stale: true }],
    ]),
    ...overrides,
  }
}

test('DOM-FIN-104: merkez kırılımı yüzde payla; küçük grup bastırılır, toplam görünür (K-333, K-334)', () => {
  const cells = (input: StaffCostReportInput) =>
    staffCostReport(input).centers.map((row) => [
      row.name,
      row.staffCount,
      row.grossCents,
      row.suppressed,
    ])
  // Ortaokul ve Atanmamış birer kişi: gizli hücrelerin birleşimi (2 kişi) toplamdan geri
  // hesaplanabileceği için en küçük görünür hücre (Lise) de gizlenir.
  assert.deepEqual(cells(reportInput()), [
    ['Lise', 6, null, true],
    ['Ortaokul', 1, null, true],
    ['Atanmamış', 1, null, true],
  ])
  // Atanmamış 5 kişi: yalnız Ortaokul birincil, Atanmamış ikincil gizlenir; Lise görünür.
  const extra = ['m8', 'm9', 'm10', 'm11']
  assert.deepEqual(
    cells(
      reportInput({
        staff: [...reportInput().staff, ...extra.map((id) => member(id))],
        rates: [
          ...reportInput().rates,
          ...extra.map((id) => rate({ membershipId: id, amountCents: 1_000_000 })),
        ],
      }),
    ),
    [
      ['Lise', 6, 5_600_000, false],
      ['Ortaokul', 1, null, true],
      ['Atanmamış', 5, null, true],
    ],
  )
  const report = staffCostReport(reportInput())
  assert.equal(report.persons, null)
  assert.equal(report.totals.staffCount, 7)
  assert.equal(report.totals.grossCents, 7_000_000)
  assert.equal(report.warnings.unassignedStaffCount, 1)
  assert.equal(report.months[0]?.staffCount, 7)
})

test('DOM-FIN-104: kişi satırlarıyla bastırma yok; atama değişince pay boş (K-334)', () => {
  const input = reportInput({
    to: '2026-11',
    people: true,
    allocations: [
      ...reportInput().allocations,
      allocation('m1', [[ORTA, 10_000]], '2026-11'),
      allocation('m8', [[LISE, 10_000]]),
    ],
    staff: [...reportInput().staff, member('m8')],
  })
  const report = staffCostReport(input)
  assert.ok(report.centers.every((row) => !row.suppressed && row.totalCents !== null))
  const m6 = report.persons?.filter((row) => row.membershipId === 'm6')
  assert.deepEqual(
    m6?.map((row) => [row.centerName, row.shareBasisPoints, row.monthCount, row.grossCents]),
    [
      ['LISE · Lise', 6000, 2, 1_200_000],
      ['ORTA · Ortaokul', 4000, 2, 800_000],
    ],
  )
  const unassigned = report.persons?.find((row) => row.centerId === null)
  assert.equal(unassigned?.name, 'Atanmamış Kişi')
  assert.equal(unassigned?.shareBasisPoints, 10_000)
  assert.deepEqual(report.warnings.staleMonths, ['2026-11'])
  assert.equal(report.warnings.assignedWithoutRateCount, 1)
  assert.equal(report.months.length, 2)
  assert.equal(report.months[1]?.parameterSetId, 'set-2')
  const notes = staffCostNotes(report)
  assert.ok(notes.some((note) => note.includes('ataması var ama dönemde ücret tanımı yok')))
  assert.ok(notes.some((note) => note.includes('son bilinen set')))
})

test('DOM-FIN-104: CSV merkez ve kişi tablosu, küçük grup ve formül kaçışı', () => {
  const masked = staffCostCsv(staffCostReport(reportInput()))
  assert.ok(masked.includes('"Ortaokul";"Program";1;"Küçük grup"'))
  assert.ok(masked.includes('"Kurum toplamı";"";"";7;70000,00'))
  assert.equal(masked.includes('"Personel";"Rol"'), false)
  const people = staffCostCsv(
    staffCostReport(
      reportInput({
        people: true,
        staff: [...reportInput().staff.slice(0, 6), member('m7', '=HYPERLINK("x")')],
        rates: [
          ...reportInput().rates,
          rate({ membershipId: 'm7', rateType: 'monthly_net', startDate: '2026-02-01' }),
        ],
      }),
    ),
  )
  assert.ok(people.includes(`"Atanmamış";"'=HYPERLINK(""x"")";"Öğretmen";"%100";1`))
  assert.ok(people.includes('Net ücret tanımlı, ana ücret dahil edilmedi'))
})
