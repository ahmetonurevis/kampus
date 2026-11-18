import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertMedicalReportPeriod,
  MEDICAL_REPORT_MAX_DAYS,
  medicalReportCancelSchema,
  medicalReportDayCount,
  medicalReportDays,
  medicalReportDaysInPeriod,
  medicalReportInputSchema,
  medicalReportState,
  medicalReportUpdateSchema,
  monthPeriod,
  periodsOverlap,
  planMedicalReport,
  planMedicalReportCancel,
  planMedicalReportUpdate,
  type MedicalReportChecks,
  type MedicalReportInput,
  type MedicalReportState,
} from '../packages/school-core/src/lib/finance-medical-reports.ts'

import { isDomainError } from './support/domain-error.ts'

// Personel sağlık raporu (DOM-FIN-110; ON-185). Kararlar K-363…K-365.

const REPORT: MedicalReportInput = {
  membershipId: 'm-selin',
  reportType: 'sickness',
  startDate: '2026-10-05',
  endDate: '2026-10-07',
}
const parsed = (input: Partial<MedicalReportInput> = {}) =>
  medicalReportInputSchema.parse({ ...REPORT, ...input })
const CHECKS: MedicalReportChecks = {
  staff: { role: 'ogretmen', leftOn: null },
  reports: [],
  today: '2026-10-06',
}
const OPEN: MedicalReportState = {
  cancelled: false,
  employerNotified: false,
  sgkApproved: false,
  fileId: null,
}
const FILE = '0b7c1d4e-2f3a-4b5c-8d6e-7f8091a2b3c4'

test('DOM-FIN-110: şema tanı alanı kabul etmez, isteğe bağlılar boş başlar', () => {
  const value = parsed()
  assert.equal(value.issuerType, null)
  assert.equal(value.fileId, null)
  for (const extra of [{ diagnosis: 'grip' }, { icdCode: 'J11' }, { note: 'serbest metin' }])
    assert.equal(medicalReportInputSchema.safeParse({ ...REPORT, ...extra }).success, false)
  assert.equal(
    medicalReportInputSchema.safeParse({ ...REPORT, reportType: 'flu' }).success,
    false,
    'yalnız sigorta türü',
  )
  assert.equal(parsed({ issuerType: 'family_physician' }).issuerType, 'family_physician')
})

test('DOM-FIN-110: bitiş başlangıçtan önce olamaz, tek rapor en çok 366 gün (K-364)', () => {
  const backwards = medicalReportInputSchema.safeParse({ ...REPORT, endDate: '2026-10-04' })
  assert.equal(backwards.success, false)
  assert.deepEqual(backwards.error?.issues[0]?.path, ['endDate'])
  assert.equal(parsed({ endDate: '2026-10-05' }).endDate, '2026-10-05', 'tek gün geçerli')
  const longest = parsed({ startDate: '2026-01-01', endDate: '2027-01-01' })
  assert.equal(medicalReportDayCount(longest.startDate, longest.endDate), MEDICAL_REPORT_MAX_DAYS)
  assert.equal(
    medicalReportInputSchema.safeParse({
      ...REPORT,
      startDate: '2026-01-01',
      endDate: '2027-01-02',
    }).success,
    false,
  )
})

test('DOM-FIN-110: gün sayısı takvim günüdür, uçlar dahil, ay ve yıl geçişinde doğru', () => {
  assert.equal(medicalReportDayCount('2026-10-05', '2026-10-07'), 3)
  assert.equal(medicalReportDayCount('2026-02-27', '2026-03-02'), 4)
  assert.equal(medicalReportDayCount('2028-02-28', '2028-03-01'), 3, 'artık yıl')
  assert.equal(medicalReportDayCount('2026-12-31', '2027-01-01'), 2)
})

test('DOM-FIN-110: planMedicalReport personeli ve aralığı denetler (K-364)', () => {
  assert.deepEqual(planMedicalReport(parsed(), CHECKS), { dayCount: 3 })
  const cases: [Partial<MedicalReportChecks>, Partial<MedicalReportInput>, string][] = [
    [{ staff: null }, {}, 'medical_report_staff_not_found'],
    [{ staff: { role: 'veli', leftOn: null } }, {}, 'medical_report_not_staff'],
    [{ staff: { role: 'ogrenci', leftOn: null } }, {}, 'medical_report_not_staff'],
    [{ staff: { role: 'ogretmen', leftOn: '2026-10-04' } }, {}, 'medical_report_after_leave'],
    [{}, { startDate: '2027-04-05', endDate: '2027-04-06' }, 'medical_report_start_too_far'],
  ]
  for (const [checks, input, code] of cases)
    assert.throws(
      () => planMedicalReport(parsed(input), { ...CHECKS, ...checks }),
      isDomainError(code),
    )
  // Pasif personele ayrıldığı güne kadar başlayan rapor girilir (son bordro dönemi).
  assert.deepEqual(
    planMedicalReport(parsed(), { ...CHECKS, staff: { role: 'onburo', leftOn: '2026-10-05' } }),
    { dayCount: 3 },
  )
  // Bugünden tam 180 gün ileri başlangıç geçerli.
  assert.deepEqual(
    planMedicalReport(parsed({ startDate: '2027-04-04', endDate: '2027-04-04' }), CHECKS),
    { dayCount: 1 },
  )
})

test('DOM-FIN-110: aynı personelin raporu bir gün bile çakışmaz (K-364)', () => {
  const existing = { id: 'r-1', startDate: '2026-10-07', endDate: '2026-10-09' }
  assert.throws(
    () => planMedicalReport(parsed(), { ...CHECKS, reports: [existing] }),
    isDomainError('medical_report_overlap'),
  )
  const before = { id: 'r-0', startDate: '2026-10-01', endDate: '2026-10-04' }
  const after = { id: 'r-2', startDate: '2026-10-08', endDate: '2026-10-10' }
  assert.deepEqual(planMedicalReport(parsed(), { ...CHECKS, reports: [before, after] }), {
    dayCount: 3,
  })
  assert.equal(periodsOverlap(before, { startDate: '2026-10-04', endDate: '2026-10-04' }), true)
  assert.equal(periodsOverlap(before, after), false)
})

test('DOM-FIN-110: işaretler — SGK onayı bildirimi ister, değişiklik yoksa ret (K-365)', () => {
  const both = planMedicalReportUpdate(OPEN, { employerNotified: true, sgkApproved: true })
  assert.deepEqual(both.fields, ['employerNotified', 'sgkApproved'])
  assert.equal(both.file, undefined)
  assert.throws(
    () => planMedicalReportUpdate(OPEN, { sgkApproved: true }),
    isDomainError('medical_report_sgk_requires_notice'),
  )
  const approved = { ...OPEN, employerNotified: true, sgkApproved: true }
  assert.throws(
    () => planMedicalReportUpdate(approved, { employerNotified: false }),
    isDomainError('medical_report_sgk_requires_notice'),
    'onaylıyken bildirim geri alınamaz',
  )
  assert.deepEqual(
    planMedicalReportUpdate(approved, { employerNotified: false, sgkApproved: false }).fields,
    ['employerNotified', 'sgkApproved'],
    'ikisi birlikte geri alınır',
  )
  assert.throws(
    () => planMedicalReportUpdate(OPEN, { employerNotified: false }),
    isDomainError('medical_report_unchanged'),
  )
  assert.throws(
    () => planMedicalReportUpdate({ ...OPEN, cancelled: true }, { employerNotified: true }),
    isDomainError('medical_report_cancelled'),
  )
  assert.equal(medicalReportUpdateSchema.safeParse({}).success, false)
})

test('DOM-FIN-110: dosya ekleme, değiştirme ve kaldırma; iptal dosya bağını kaldırır (K-363)', () => {
  assert.deepEqual(planMedicalReportUpdate(OPEN, { fileId: FILE }).file, {
    detach: null,
    attach: FILE,
  })
  const withFile = { ...OPEN, fileId: FILE }
  assert.deepEqual(planMedicalReportUpdate(withFile, { fileId: null }).file, {
    detach: FILE,
    attach: null,
  })
  assert.throws(
    () => planMedicalReportUpdate(withFile, { fileId: FILE }),
    isDomainError('medical_report_unchanged'),
  )
  assert.deepEqual(planMedicalReportCancel(withFile), { detachFileId: FILE })
  assert.throws(
    () => planMedicalReportCancel({ ...withFile, cancelled: true }),
    isDomainError('medical_report_cancelled'),
  )
  assert.equal(medicalReportCancelSchema.safeParse({ reason: 'yok' }).success, false)
  assert.equal(
    medicalReportCancelSchema.parse({ reason: '  Yanlış personel  ' }).reason,
    'Yanlış personel',
  )
})

test('DOM-FIN-110: dönem günleri — kesişim, türe göre sayı ve gün listesi (ON-181 girdisi)', () => {
  const reports = [
    { reportType: 'sickness' as const, startDate: '2026-09-29', endDate: '2026-10-02' },
    { reportType: 'work_accident' as const, startDate: '2026-10-30', endDate: '2026-11-03' },
    { reportType: 'maternity' as const, startDate: '2026-12-01', endDate: '2026-12-31' },
  ]
  const { from, to } = monthPeriod('2026-10-17')
  assert.deepEqual({ from, to }, { from: '2026-10-01', to: '2026-10-31' })
  assert.equal(medicalReportDaysInPeriod(reports[0]!, from, to), 2)
  assert.equal(medicalReportDaysInPeriod(reports[2]!, from, to), 0)
  const days = medicalReportDays(reports, from, to)
  assert.equal(days.totalDays, 4)
  assert.deepEqual(days.byType, {
    sickness: 2,
    work_accident: 2,
    occupational_disease: 0,
    maternity: 0,
  })
  assert.deepEqual(days.days, ['2026-10-01', '2026-10-02', '2026-10-30', '2026-10-31'])
  assert.deepEqual(monthPeriod('2028-02-10'), { from: '2028-02-01', to: '2028-02-29' })
  assert.deepEqual(monthPeriod('2026-12-31'), { from: '2026-12-01', to: '2026-12-31' })
  assert.equal(medicalReportDays([], from, to).totalDays, 0)
})

test('DOM-FIN-110: dönem en çok 366 gün, sonu başından önce olamaz', () => {
  assert.doesNotThrow(() => assertMedicalReportPeriod('2026-01-01', '2027-01-01'))
  assert.throws(
    () => assertMedicalReportPeriod('2026-10-02', '2026-10-01'),
    isDomainError('medical_report_period_invalid'),
  )
  assert.throws(
    () => assertMedicalReportPeriod('2026-01-01', '2027-01-02'),
    isDomainError('medical_report_period_too_long'),
  )
})

test('DOM-FIN-110: durum bugüne göre hesaplanır, iptal ayrıdır', () => {
  const report = { startDate: '2026-10-05', endDate: '2026-10-07', cancelled: false }
  assert.equal(medicalReportState(report, '2026-10-04'), 'scheduled')
  assert.equal(medicalReportState(report, '2026-10-05'), 'ongoing')
  assert.equal(medicalReportState(report, '2026-10-07'), 'ongoing')
  assert.equal(medicalReportState(report, '2026-10-08'), 'ended')
  assert.equal(medicalReportState({ ...report, cancelled: true }, '2026-10-06'), 'cancelled')
})
