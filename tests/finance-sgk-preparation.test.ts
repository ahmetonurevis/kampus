import assert from 'node:assert/strict'
import test from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import { effectivePayrollParameters } from '../packages/school-core/src/lib/finance-payroll-parameters.ts'
import {
  planSgkEmploymentDates,
  planSgkMissingDays,
  previousSgkMonth,
  sgkBaseDays,
  sgkDateText,
  sgkEmploymentDatesInputSchema,
  sgkMissingDayInputSchema,
  sgkMonthLabel,
  sgkMonthRange,
  sgkMonthSchema,
  sgkParametersFrom,
  sgkPreparationCsv,
  sgkPreparationFilename,
  sgkPreparationList,
  sgkReasonCodeFor,
  sgkReasonText,
  sgkRoleLabel,
  sgkWageText,
  sgkBaseText,
  SGK_SELECTABLE_REASON_CODES,
  wageSpans,
  type SgkEmploymentDatesEntry,
  type SgkMember,
  type SgkMissingDayEntry,
  type SgkParameters,
  type SgkPayRate,
} from '../packages/school-core/src/lib/finance-sgk-preparation.ts'

// DOM-FIN-107 (ON-203): SGK bildirge hazırlık listesi; K-352…K-355.

const PARAMS: SgkParameters = {
  effectiveFrom: '2026-01-01',
  origin: 'platform',
  stale: false,
  unverified: true,
  minimumWageGrossCents: 3_303_000,
  floorCents: 3_303_000,
  ceilingCents: 29_727_000,
}
const member = (id: string, name: string, role = 'ogretmen'): SgkMember => ({
  membershipId: id,
  name,
  role,
  active: true,
})
let seq = 0
const wage = (
  membershipId: string,
  startDate: string,
  endDate: string | null,
  amountCents = 4_500_000,
  rateType: SgkPayRate['rateType'] = 'monthly_gross',
): SgkPayRate => ({
  id: `r-${String((seq += 1))}`,
  membershipId,
  component: 'wage',
  rateType,
  amountCents,
  benefitForm: null,
  startDate,
  endDate,
})
const benefit = (
  membershipId: string,
  amountCents: number,
  benefitForm: 'cash' | 'in_kind',
  startDate = '2025-01-01',
): SgkPayRate => ({
  id: `b-${String((seq += 1))}`,
  membershipId,
  component: 'benefit',
  rateType: 'meal',
  amountCents,
  benefitForm,
  startDate,
  endDate: null,
})
const missing = (
  membershipId: string,
  days: number,
  reasonCode: SgkMissingDayEntry['reasonCode'],
): SgkMissingDayEntry => ({
  id: `m-${String((seq += 1))}`,
  membershipId,
  days,
  reasonCode,
  note: null,
  version: 1,
  createdAt: `2026-11-0${String(seq % 9)}T09:00:00.000Z`,
})
const dates = (
  membershipId: string,
  entryDate: string | null,
  exitDate: string | null,
): SgkEmploymentDatesEntry => ({
  id: `d-${String((seq += 1))}`,
  membershipId,
  entryDate,
  exitDate,
  note: null,
  version: 1,
  createdAt: '2026-11-01T09:00:00.000Z',
})
const list = (
  month: string,
  input: {
    members: SgkMember[]
    rates?: SgkPayRate[]
    missing?: SgkMissingDayEntry[]
    dates?: SgkEmploymentDatesEntry[]
  },
) =>
  sgkPreparationList({
    month,
    parameters: PARAMS,
    rates: [],
    missing: [],
    dates: [],
    ...input,
  })
const only = (result: ReturnType<typeof list>) => {
  assert.equal(result.rows.length, 1)
  return result.rows[0]!
}

test('DOM-FIN-107: ay şeması ve ayın günleri', () => {
  assert.equal(sgkMonthSchema.safeParse('2026-11').success, true)
  for (const bad of ['2026-13', '2026-1', '2019-12', '2100-01', '2026-11-01'])
    assert.equal(sgkMonthSchema.safeParse(bad).success, false, bad)
  assert.deepEqual(sgkMonthRange('2026-02'), {
    month: '2026-02',
    firstDay: '2026-02-01',
    lastDay: '2026-02-28',
    daysInMonth: 28,
  })
  assert.equal(sgkMonthRange('2028-02').lastDay, '2028-02-29')
  assert.equal(previousSgkMonth('2026-01'), '2025-12')
  assert.equal(previousSgkMonth('2026-11'), '2026-10')
  assert.equal(sgkMonthLabel('2026-11'), 'Kasım 2026')
})

test('DOM-FIN-107 K-353: tam ay 30 gün, ay içi giriş/çıkışta takvim günü (en çok 30)', () => {
  const feb = sgkMonthRange('2026-02')
  const jan = sgkMonthRange('2026-01')
  assert.equal(sgkBaseDays(feb, '2026-02-01', '2026-02-28'), 30)
  assert.equal(sgkBaseDays(jan, '2026-01-01', '2026-01-31'), 30)
  assert.equal(sgkBaseDays(feb, '2026-02-02', '2026-02-28'), 27)
  assert.equal(sgkBaseDays(jan, '2026-01-02', '2026-01-31'), 30)
  assert.equal(sgkBaseDays(jan, '2026-01-01', '2026-01-10'), 10)
  assert.equal(sgkBaseDays(jan, '2026-01-20', '2026-01-10'), 0)
})

test('DOM-FIN-107 K-353: birden fazla neden birleşik koda döner', () => {
  assert.equal(sgkReasonCodeFor([]), null)
  assert.equal(sgkReasonCodeFor([null]), null)
  assert.equal(sgkReasonCodeFor(['01', '01', null]), '01')
  assert.equal(sgkReasonCodeFor(['01', '21']), '12')
  assert.equal(sgkReasonCodeFor(['18', '21']), '27')
  assert.equal(sgkReasonCodeFor(['23', '01']), '24')
  assert.equal(SGK_SELECTABLE_REASON_CODES.includes('12' as never), false)
  assert.equal(sgkReasonText(null), '')
  assert.equal(sgkReasonText('21'), '21 · Diğer ücretsiz izin')
})

test('DOM-FIN-107: ana ücret zinciri kesintisiz aralıklara birleşir', () => {
  assert.deepEqual(
    wageSpans([
      wage('a', '2026-09-01', '2026-10-14'),
      wage('a', '2026-10-15', null),
      benefit('a', 10_000, 'cash'),
    ]),
    [{ from: '2026-09-01', to: null }],
  )
  assert.deepEqual(
    wageSpans([wage('a', '2026-01-01', '2026-03-31'), wage('a', '2026-05-01', null)]),
    [
      { from: '2026-01-01', to: '2026-03-31' },
      { from: '2026-05-01', to: null },
    ],
  )
})

test('DOM-FIN-107 K-352, K-354: tam ay, nakdi yan hak matraha girer, ayni girmez', () => {
  const row = only(
    list('2026-11', {
      members: [member('a', 'Selin Kaya')],
      rates: [
        wage('a', '2026-01-01', null),
        benefit('a', 300_000, 'cash'),
        benefit('a', 200_000, 'in_kind'),
      ],
    }),
  )
  assert.equal(row.baseDays, 30)
  assert.equal(row.primDays, 30)
  assert.equal(row.entryDate, null)
  assert.equal(row.exitDate, null)
  assert.equal(row.cashBenefitsCents, 300_000)
  assert.equal(row.sgkBaseCents, 4_800_000)
  assert.deepEqual(row.warnings, [])
  assert.equal(row.reasonCode, null)
})

test('DOM-FIN-107 K-352: ay içi giriş ve çıkış ücret tanımından, kıst matrah', () => {
  const result = list('2026-11', {
    members: [member('a', 'Ali'), member('b', 'Banu')],
    rates: [wage('a', '2026-11-16', null, 6_000_000), wage('b', '2025-01-01', '2026-11-10')],
  })
  const [ali, banu] = result.rows
  assert.equal(ali!.entryDate, '2026-11-16')
  assert.equal(ali!.entrySource, 'pay_rate')
  assert.equal(ali!.primDays, 15)
  assert.equal(ali!.sgkBaseCents, 3_000_000)
  assert.deepEqual(ali!.warnings, ['entry_in_month'])
  assert.equal(banu!.exitDate, '2026-11-10')
  assert.equal(banu!.exitSource, 'pay_rate')
  assert.equal(banu!.primDays, 10)
  assert.equal(banu!.sgkBaseCents, 1_500_000)
  assert.deepEqual(banu!.warnings, ['exit_in_month'])
  assert.equal(result.totals.primDays, 25)
  assert.equal(result.totals.sgkBaseCents, 4_500_000)
  assert.equal(result.totals.warningRowCount, 2)
})

test('DOM-FIN-107 K-352: ücret değişikliği giriş/çıkış sayılmaz, son günün ücreti alınır', () => {
  const row = only(
    list('2026-11', {
      members: [member('a', 'Ali')],
      rates: [wage('a', '2026-01-01', '2026-11-14'), wage('a', '2026-11-15', null, 5_000_000)],
    }),
  )
  assert.equal(row.entryDate, null)
  assert.equal(row.exitDate, null)
  assert.equal(row.wage?.amountCents, 5_000_000)
  assert.equal(row.sgkBaseCents, 5_000_000)
  assert.deepEqual(row.warnings, ['wage_changed'])
})

test('DOM-FIN-107 K-352: elle giriş/çıkış ücret tanımından önce gelir', () => {
  const row = only(
    list('2026-11', {
      members: [member('a', 'Ali')],
      rates: [wage('a', '2026-11-01', null)],
      dates: [dates('a', '2026-11-03', '2026-11-20')],
    }),
  )
  assert.equal(row.entryDate, '2026-11-03')
  assert.equal(row.entrySource, 'manual')
  assert.equal(row.exitDate, '2026-11-20')
  assert.equal(row.exitSource, 'manual')
  assert.equal(row.primDays, 18)
  assert.equal(row.employmentDates?.entryDate, '2026-11-03')
  assert.deepEqual(row.warnings, ['entry_in_month', 'exit_in_month'])
})

test('DOM-FIN-107 K-353: eksik gün düşülür, nedeni yoksa uyarı, toplam gün aşarsa 0', () => {
  const row = only(
    list('2026-11', {
      members: [member('a', 'Ali')],
      rates: [wage('a', '2026-01-01', null, 6_000_000)],
      missing: [missing('a', 2, '01'), missing('a', 3, null)],
    }),
  )
  assert.equal(row.missingDays, 5)
  assert.equal(row.primDays, 25)
  assert.equal(row.reasonCode, '01')
  assert.equal(row.sgkBaseCents, 5_000_000)
  assert.deepEqual(row.warnings, ['missing_reason'])
  assert.equal(row.missingDayEntries.length, 2)

  const over = only(
    list('2026-11', {
      members: [member('a', 'Ali')],
      rates: [wage('a', '2026-11-21', null)],
      missing: [missing('a', 12, '21')],
    }),
  )
  assert.equal(over.baseDays, 10)
  assert.equal(over.primDays, 0)
  assert.equal(over.sgkBaseCents, 0)
  assert.deepEqual(over.warnings, ['entry_in_month', 'missing_days_exceed'])
})

test('DOM-FIN-107 K-354: tabanın altı yükseltilir, tavanın üstü kesilir (gün oranlı)', () => {
  const result = list('2026-11', {
    members: [member('a', 'Ali'), member('b', 'Banu')],
    rates: [wage('a', '2026-01-01', null, 2_000_000), wage('b', '2026-11-16', null, 70_000_000)],
  })
  const [ali, banu] = result.rows
  assert.equal(ali!.floorCents, 3_303_000)
  assert.equal(ali!.sgkBaseCents, 3_303_000)
  assert.deepEqual(ali!.warnings, ['below_floor'])
  assert.equal(banu!.ceilingCents, 14_863_500)
  assert.equal(banu!.sgkBaseCents, 14_863_500)
  assert.deepEqual(banu!.warnings, ['above_ceiling', 'entry_in_month'])
})

test('DOM-FIN-107 K-354: aylık brüt olmayan ücret, ek ders ve tanımsız gün uyarısı', () => {
  const result = list('2026-11', {
    members: [member('a', 'Ali'), member('b', 'Banu')],
    rates: [
      wage('a', '2026-01-01', null, 50_000, 'hourly'),
      {
        ...wage('a', '2026-01-01', null, 60_000),
        component: 'lesson',
        rateType: 'extra',
      },
      wage('b', '2026-01-01', '2026-11-05'),
      wage('b', '2026-11-20', null),
    ],
  })
  const [ali, banu] = result.rows
  assert.equal(ali!.sgkBaseCents, null)
  assert.deepEqual(ali!.warnings, ['wage_not_monthly_gross', 'lesson_pay_excluded'])
  assert.equal(banu!.primDays, 30)
  assert.deepEqual(banu!.warnings, ['wage_changed', 'pay_rate_gap'])
  assert.equal(result.totals.unestimatedCount, 1)
  assert.equal(result.totals.sgkBaseCents, 4_500_000)
})

test('DOM-FIN-107 K-352: tanımı ayda olmayan personel listeye girmez; elle satırla girer', () => {
  const result = list('2026-11', {
    members: [member('a', 'Ali'), member('b', 'Banu'), member('c', 'Cem')],
    rates: [wage('a', '2026-12-01', null), wage('c', '2026-01-01', '2026-10-31')],
    missing: [missing('b', 2, '21')],
  })
  assert.deepEqual(
    result.rows.map((row) => row.name),
    ['Banu'],
  )
  assert.deepEqual(result.rows[0]!.warnings, ['no_wage'])
  assert.equal(result.rows[0]!.wage, null)
  assert.equal(result.rows[0]!.sgkBaseCents, null)
})

test('DOM-FIN-107: liste ada göre Türkçe sıralanır', () => {
  const result = list('2026-11', {
    members: [member('a', 'Zeynep'), member('b', 'Çağla'), member('c', 'Cem')],
    rates: ['a', 'b', 'c'].map((id) => wage(id, '2026-01-01', null)),
  })
  assert.deepEqual(
    result.rows.map((row) => row.name),
    ['Cem', 'Çağla', 'Zeynep'],
  )
})

test('DOM-FIN-107 K-353: eksik gün girişi şeması ve ay toplamı', () => {
  const parsed = sgkMissingDayInputSchema.parse({ membershipId: 'a', month: '2026-11', days: 2 })
  assert.equal(parsed.reasonCode, null)
  assert.equal(parsed.note, null)
  for (const bad of [
    { membershipId: 'a', month: '2026-11', days: 0 },
    { membershipId: 'a', month: '2026-11', days: 31 },
    { membershipId: 'a', month: '2026-11', days: 1.5 },
    { membershipId: 'a', month: '2026-11', days: 2, reasonCode: '12' },
    { membershipId: 'a', month: '2026-11', days: 2, note: 'x'.repeat(201) },
    { membershipId: 'a', month: '2026-11', days: 2, extra: true },
  ])
    assert.equal(sgkMissingDayInputSchema.safeParse(bad).success, false, JSON.stringify(bad))

  const teacher = { role: 'ogretmen' }
  planSgkMissingDays({ days: 10 }, { staff: teacher, enteredDays: 20 })
  assert.throws(
    () => planSgkMissingDays({ days: 11 }, { staff: teacher, enteredDays: 20 }),
    (error) => error instanceof DomainError && error.code === 'sgk_missing_days_exceed_month',
  )
  assert.throws(
    () => planSgkMissingDays({ days: 1 }, { staff: null, enteredDays: 0 }),
    (error) => error instanceof DomainError && error.code === 'sgk_staff_not_found',
  )
  assert.throws(
    () => planSgkMissingDays({ days: 1 }, { staff: { role: 'veli' }, enteredDays: 0 }),
    (error) => error instanceof DomainError && error.code === 'sgk_not_staff',
  )
})

test('DOM-FIN-107 K-352: elle giriş/çıkış şeması ve aylık tek satır', () => {
  const base = { membershipId: 'a', month: '2026-11' }
  assert.equal(
    sgkEmploymentDatesInputSchema.safeParse({ ...base, entryDate: '2026-11-03' }).success,
    true,
  )
  const issues = (value: unknown) =>
    sgkEmploymentDatesInputSchema.safeParse(value).error?.issues.map((issue) => issue.message)
  assert.deepEqual(issues(base), ['Giriş ya da çıkış gününden en az birini girin.'])
  assert.deepEqual(issues({ ...base, entryDate: '2026-10-31' }), [
    'Gün seçilen ayın içinde olmalıdır.',
  ])
  assert.deepEqual(issues({ ...base, entryDate: '2026-11-20', exitDate: '2026-11-10' }), [
    'Çıkış günü giriş gününden önce olamaz.',
  ])
  planSgkEmploymentDates({ staff: { role: 'onburo' }, exists: false })
  assert.throws(
    () => planSgkEmploymentDates({ staff: { role: 'onburo' }, exists: true }),
    (error) =>
      error instanceof DomainError &&
      error.code === 'sgk_employment_dates_exist' &&
      error.kind === 'conflict',
  )
})

test('DOM-FIN-107 K-354: parametre setinden taban ve tavan', () => {
  const set = effectivePayrollParameters('2026-11-01', [])
  assert.ok(set)
  const params = sgkParametersFrom(set)
  assert.equal(params.effectiveFrom, '2026-01-01')
  assert.equal(params.floorCents, 3_303_000)
  assert.equal(params.ceilingCents, 29_727_000)
  assert.equal(params.unverified, true)
  assert.equal(params.origin, 'platform')
})

test('DOM-FIN-107 K-355: CSV kimlik sütunu boş, formül kaçışlı, toplam ve not satırı', () => {
  const result = list('2026-11', {
    members: [member('a', '=Ali'), member('b', 'Banu', 'onburo')],
    rates: [wage('a', '2026-11-16', null), wage('b', '2026-01-01', null, 100, 'monthly_net')],
    missing: [missing('a', 1, '21')],
  })
  const lines = sgkPreparationCsv(result).split('\r\n')
  assert.equal(lines.length, 5)
  assert.match(lines[0]!, /^"Ad soyad";"T.C. kimlik no";"Rol"/)
  assert.equal(
    lines[1],
    `"'=Ali";"";"Öğretmen";"2026-11-16";"Ücret tanımı";"";"";14;1;"21";"Diğer ücretsiz izin";"Aylık brüt";45000,00;0,00;15414,00;138726,00;21000,00;"Ay içinde işe giriş"`,
  )
  assert.match(
    lines[2]!,
    /^"Banu";"";"Ön büro";.*"Aylık net";1,00;0,00;.*;"";"Ana ücret aylık brüt değil/,
  )
  assert.match(lines[3]!, /^"Toplam";"";"2 personel";"";"";"";"";44;1;/)
  assert.match(lines[3]!, /;21000,00;"1 personelin matrahı tahmin edilmedi"$/)
  assert.match(lines[4]!, /^"Bu liste resmî bildirge değildir/)
  assert.equal(sgkPreparationFilename('2026-11', 'csv'), 'sgk-hazirlik-listesi-2026-11.csv')
})

test('DOM-FIN-107: gösterim metinleri', () => {
  assert.equal(sgkDateText(null, null), '')
  assert.equal(sgkDateText('2026-11-03', 'manual'), '3 Kas 2026 (elle)')
  assert.equal(sgkDateText('2026-11-03', 'pay_rate'), '3 Kas 2026 (ücret tanımı)')
  assert.equal(sgkWageText(null), 'Tanım yok')
  assert.equal(
    sgkWageText({ rateType: 'monthly_gross', amountCents: 4_500_000, startDate: '2026-01-01' }),
    'Aylık brüt 45.000,00 ₺',
  )
  assert.equal(sgkBaseText({ sgkBaseCents: null }), 'Tahmin yok')
  assert.equal(sgkRoleLabel('yonetici'), 'Yönetici')
  assert.equal(sgkRoleLabel('x'), 'x')
})
