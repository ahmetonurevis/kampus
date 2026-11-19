import assert from 'node:assert/strict'
import test from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  hrDecimalText,
  hrHiddenText,
  hrPeriodLabel,
  hrRateText,
  hrReport,
  hrReportCsv,
  hrReportFilename,
  hrReportNotes,
  hrReportPeriod,
  hrRoleGroupOf,
  seniorityBandOf,
  turnoverCounts,
  type HrAllocation,
  type HrLeaveProfile,
  type HrLeaveRecord,
  type HrLeaveType,
  type HrReportInput,
  type HrStaffMember,
} from '../packages/school-core/src/lib/finance-hr-reports.ts'

// İK raporları (DOM-FIN-117; ON-192, K-400…K-402). Bugün 2026-10-06; dönem Ocak–Haziran 2026.

const TODAY = '2026-10-06'
const PERIOD = hrReportPeriod('2026-01', '2026-06', TODAY)

const member = (
  id: string,
  role = 'ogretmen',
  joinedDay = '2024-09-01',
  deactivatedDay: string | null = null,
): HrStaffMember => ({ membershipId: id, role, joinedDay, deactivatedDay })
const profile = (membershipId: string, seniorityStartDate: string): HrLeaveProfile => ({
  membershipId,
  profile: { seniorityStartDate, birthDate: null, openingBalance: null },
})
const record = (
  membershipId: string,
  startDate: string,
  days: number,
  typeCode = 'annual',
  fields: Partial<HrLeaveRecord> = {},
): HrLeaveRecord => ({
  membershipId,
  typeCode,
  kind: typeCode === 'annual' ? 'annual' : 'excuse',
  typeLabel: typeCode === 'annual' ? 'Yıllık izin' : 'Mazeret izni',
  deductsFromAnnual: typeCode === 'annual',
  startDate,
  days,
  ...fields,
})
const TYPES: HrLeaveType[] = [
  { code: 'annual', label: 'Yıllık izin', kind: 'annual', isActive: true },
  { code: 'excuse_marriage', label: 'Evlilik izni', kind: 'excuse', isActive: true },
  { code: 'unpaid', label: 'Ücretsiz izin', kind: 'unpaid', isActive: false },
  { code: 'sick', label: 'Rapor', kind: 'sick', isActive: true },
]
const ids = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1)}`)

function input(overrides: Partial<HrReportInput> = {}): HrReportInput {
  return {
    period: PERIOD,
    staff: [],
    profiles: [],
    allocations: [],
    centers: [],
    leaveTypes: TYPES,
    leaveRecords: [],
    medicalDays: [],
    ...overrides,
  }
}

test('DOM-FIN-117 K-400: dönem günleri, süren dönem bugünde biter, başlamamış dönem 422', () => {
  assert.deepEqual(PERIOD, {
    from: '2026-01',
    to: '2026-06',
    firstDay: '2026-01-01',
    lastDay: '2026-06-30',
    endDay: '2026-06-30',
  })
  assert.equal(hrReportPeriod('2026-09', '2026-12', TODAY).endDay, TODAY)
  assert.throws(
    () => hrReportPeriod('2026-11', '2026-11', TODAY),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === 'hr_report_period_not_started' &&
      error.kind === 'rule',
  )
})

test('DOM-FIN-117 K-400: devir oranı çıkış ÷ ((dönem başı + dönem sonu) ÷ 2); başı + giriş − çıkış = sonu', () => {
  const persons = [
    ...Array.from({ length: 10 }, () => ({ start: '2025-01-01', exit: null })),
    { start: '2025-05-01', exit: '2026-03-31' },
    { start: '2025-05-01', exit: '2026-01-01' },
    { start: '2026-02-01', exit: '2026-06-30' },
    { start: '2026-06-30', exit: null },
    { start: '2026-07-01', exit: null },
    { start: '2024-01-01', exit: '2025-12-31' },
  ]
  const counts = turnoverCounts(persons, PERIOD)
  assert.deepEqual(counts, {
    opening: 12,
    hires: 2,
    exits: 3,
    closing: 11,
    averageHeadcount: 11.5,
    turnoverBasisPoints: 2609,
  })
  assert.equal(counts.opening + counts.hires - counts.exits, counts.closing)
  assert.equal(hrRateText(counts.turnoverBasisPoints), '%26,09')
  assert.deepEqual(turnoverCounts([], PERIOD), {
    opening: 0,
    hires: 0,
    exits: 0,
    closing: 0,
    averageHeadcount: 0,
    turnoverBasisPoints: null,
  })
  assert.equal(hrRateText(null), '—')
  assert.equal(hrDecimalText(11.5), '11,5')
  assert.equal(hrDecimalText(null), '')
})

test('DOM-FIN-117 K-400: kıdem bandı alt sınır dahil, üst sınır hariç; rol grubu', () => {
  assert.equal(seniorityBandOf(null), 'unknown')
  assert.equal(seniorityBandOf(0), 'under_1')
  assert.equal(seniorityBandOf(1), 'from_1_to_3')
  assert.equal(seniorityBandOf(3), 'from_3_to_5')
  assert.equal(seniorityBandOf(5), 'from_5_to_10')
  assert.equal(seniorityBandOf(9), 'from_5_to_10')
  assert.equal(seniorityBandOf(10), 'over_10')
  assert.equal(hrRoleGroupOf('ogretmen'), 'teacher')
  assert.equal(hrRoleGroupOf('yonetici'), 'administrative')
  assert.equal(hrRoleGroupOf('onburo'), 'administrative')
})

test('DOM-FIN-117 K-400: giriş kıdem başlangıcı, yoksa üyelik günü; çıkış pasifleştirme; öğrenci ve veli sayılmaz', () => {
  const teachers = ids('t', 6).map((id) => member(id))
  const report = hrReport(
    input({
      staff: [
        ...teachers,
        // Hesap 2024'te açıldı ama kıdem başlangıcı Mart 2026: giriş dönemdedir.
        member('late', 'ogretmen', '2024-01-01'),
        member('left', 'onburo', '2023-01-01', '2026-04-15'),
        member('s1', 'ogrenci', '2026-02-01'),
        member('v1', 'veli', '2026-02-01'),
      ],
      profiles: [profile('late', '2026-03-01')],
    }),
  )
  assert.deepEqual(report.turnover.totals, {
    opening: 7,
    hires: 1,
    exits: 1,
    closing: 7,
    averageHeadcount: 7,
    turnoverBasisPoints: 1429,
    suppressed: false,
  })
  assert.equal(report.warnings.missingSeniorityCount, 7)
  assert.equal(report.minGroupSize, 5)
})

test('DOM-FIN-117 K-401: 5 kişiden az rol kırılımı gizlenir, toplamdan geri hesaplanmasın diye öbürü de', () => {
  const staff = [
    ...ids('t', 8).map((id) => member(id)),
    ...ids('a', 3).map((id) => member(id, 'onburo')),
  ]
  const small = hrReport(input({ staff }))
  assert.deepEqual(
    small.turnover.byRole.map((row) => [row.group, row.closing, row.suppressed]),
    [
      ['teacher', null, true],
      ['administrative', null, true],
    ],
  )
  assert.equal(small.turnover.totals.closing, 11)

  const big = hrReport(
    input({ staff: [...staff, ...ids('b', 3).map((id) => member(id, 'yonetici'))] }),
  )
  assert.deepEqual(
    big.turnover.byRole.map((row) => [row.group, row.closing, row.suppressed]),
    [
      ['teacher', 8, false],
      ['administrative', 6, false],
    ],
  )

  const tiny = hrReport(input({ staff: ids('t', 4).map((id) => member(id)) }))
  assert.equal(tiny.turnover.totals.suppressed, true)
  assert.equal(tiny.turnover.totals.closing, null)
  assert.equal(tiny.turnover.totals.turnoverBasisPoints, null)
  assert.equal(tiny.seniority.total, null)
  assert.equal(tiny.seniority.totalSuppressed, true)
})

test('DOM-FIN-117 K-400: maliyet merkezi kırılımı son ayın atamasıyla, paylı kişi iki merkezde, atanmamış sonda', () => {
  const lise = ids('l', 5)
  const orta = ids('o', 5)
  const shared = 'p1'
  const allocation = (membershipId: string, centers: [string, number][], startMonth = '2026-01') =>
    ({
      membershipId,
      startMonth,
      shares: centers.map(([costCenterId, shareBasisPoints]) => ({
        costCenterId,
        shareBasisPoints,
      })),
    }) satisfies HrAllocation
  const report = hrReport(
    input({
      staff: [
        ...[...lise, ...orta, shared].map((id) => member(id)),
        ...ids('u', 5).map((id) => member(id, 'onburo')),
        // Nisanda ayrıldı: Nisan ataması (ORTA) sayılır, Haziran'daki LISE değil.
        member('gone', 'ogretmen', '2024-01-01', '2026-04-10'),
      ],
      allocations: [
        ...lise.map((id) => allocation(id, [['c-lise', 10_000]])),
        ...orta.map((id) => allocation(id, [['c-orta', 10_000]])),
        allocation(shared, [
          ['c-lise', 6_000],
          ['c-orta', 4_000],
        ]),
        allocation('gone', [['c-orta', 10_000]]),
        allocation('gone', [['c-lise', 10_000]], '2026-06'),
        // Dönemden sonraki atama sayılmaz.
        allocation(lise[0] ?? '', [['c-orta', 10_000]], '2026-08'),
      ],
      centers: [
        { id: 'c-okul', code: 'OKUL', name: 'Okul', parentId: null, isActive: true },
        { id: 'c-orta', code: 'ORTA', name: 'Ortaokul', parentId: 'c-okul', isActive: true },
        { id: 'c-lise', code: 'LISE', name: 'Lise', parentId: 'c-okul', isActive: false },
      ],
    }),
  )
  assert.deepEqual(
    report.turnover.byCenter.map((row) => [
      row.path,
      row.name,
      row.isActive,
      row.opening,
      row.exits,
      row.closing,
      row.suppressed,
    ]),
    [
      ['OKUL / LISE', 'Lise', false, 6, 0, 6, false],
      ['OKUL / ORTA', 'Ortaokul', true, 7, 1, 6, false],
      [null, 'Atanmamış', true, 5, 0, 5, false],
    ],
  )
})

test('DOM-FIN-117 K-400 K-401: kıdem dağılımı dönem sonunda, bilinmiyor bandı ve küçük bant gizli', () => {
  const report = hrReport(
    input({
      staff: [
        ...ids('n', 5).map((id) => member(id)),
        ...ids('m', 5).map((id) => member(id)),
        ...ids('x', 2).map((id) => member(id)),
        member('left', 'ogretmen', '2020-01-01', '2026-05-01'),
      ],
      profiles: [
        ...ids('n', 5).map((id) => profile(id, '2025-09-01')),
        ...ids('m', 5).map((id) => profile(id, '2016-06-30')),
        profile('left', '2010-01-01'),
      ],
    }),
  )
  assert.equal(report.seniority.asOf, '2026-06-30')
  assert.equal(report.seniority.total, 12)
  assert.deepEqual(
    report.seniority.bands.map((band) => [band.key, band.count, band.suppressed]),
    [
      // Tek gizli bant (2 kişi) toplamdan çıkar: eşit en küçük görünür bant da gizlenir.
      ['under_1', null, true],
      ['from_1_to_3', 0, false],
      ['from_3_to_5', 0, false],
      ['from_5_to_10', 0, false],
      ['over_10', 5, false],
      ['unknown', null, true],
    ],
  )
})

test('DOM-FIN-117 K-402: izin türe göre başladığı güne göre, rapor yok, bakiye toplamı ve rapor günü toplamı', () => {
  const staff = ids('t', 10).map((id) => member(id))
  const records = [
    ...ids('t', 6).map((id) => record(id, '2026-03-02', 5)),
    // Dönemden önce başlayan kayıt dönemde sayılmaz ama bakiyeden düşer.
    record('t1', '2025-12-29', 4),
    record('t7', '2026-07-01', 3),
    record('t2', '2026-04-01', 1, 'excuse_marriage'),
    record('t3', '2026-04-01', 2, 'custom_x', { typeLabel: 'Kurum izni', kind: 'other' }),
    record('t4', '2026-04-01', 2, 'sick', { kind: 'sick', typeLabel: 'Rapor' }),
  ]
  const report = hrReport(
    input({
      staff,
      profiles: ids('t', 6).map((id) => profile(id, '2024-01-15')),
      leaveRecords: records,
      medicalDays: [
        { membershipId: 't1', totalDays: 3 },
        { membershipId: 't2', totalDays: 0 },
      ],
    }),
  )
  assert.deepEqual(
    report.leave.types.map((type) => [type.code, type.usedDays, type.staffCount, type.suppressed]),
    [
      ['annual', null, null, true],
      ['excuse_marriage', null, null, true],
      ['custom_x', null, null, true],
    ],
  )
  // Yıllık izni 6 kişi kullandı ama tek gizli hücre toplamdan geri hesaplanır: en küçük görünür de gizlenir.
  assert.deepEqual(report.leave.totals, {
    usedDays: 33,
    staffCount: 6,
    perStaffDays: 3.3,
    suppressed: false,
  })
  // 6 profil: her biri 2025 ve 2026 Ocak'ında 14'er gün hak etti; t1 dört gün daha kullandı →
  // 6 × 28 − 30 − 4. Temmuz kaydı dönem sonundan sonra başlar, bakiyeden düşmez (planlanan).
  assert.deepEqual(report.leave.balance, {
    staffCount: 6,
    balanceDays: 134,
    perStaffDays: 22.3,
    suppressed: false,
    missingProfileCount: 4,
  })
  assert.deepEqual(report.leave.medical, { totalDays: null, suppressed: true })

  const visible = hrReport(
    input({
      staff,
      leaveRecords: [
        ...ids('t', 6).map((id) => record(id, '2026-03-02', 5)),
        ...ids('t', 5).map((id) => record(id, '2026-05-04', 1, 'excuse_marriage')),
      ],
      medicalDays: ids('t', 5).map((id) => ({ membershipId: id, totalDays: 2 })),
    }),
  )
  assert.deepEqual(
    visible.leave.types.map((type) => [
      type.code,
      type.usedDays,
      type.staffCount,
      type.perStaffDays,
    ]),
    [
      ['annual', 30, 6, 3],
      ['excuse_marriage', 5, 5, 0.5],
    ],
  )
  assert.deepEqual(visible.leave.medical, { totalDays: 10, suppressed: false })
  assert.equal(visible.leave.balance.suppressed, false)
  assert.equal(visible.leave.balance.staffCount, 0)
  assert.equal(visible.leave.balance.perStaffDays, null)
  assert.equal(visible.leave.balance.missingProfileCount, 10)
})

test('DOM-FIN-117 K-401: CSV ve notlar kişi adı ve kimliği taşımaz, gizli hücre "<5"', () => {
  const staff = [...ids('t', 8).map((id) => member(id)), member('=a1', 'onburo')]
  const report = hrReport(input({ staff, period: hrReportPeriod('2026-09', '2026-10', TODAY) }))
  const csv = hrReportCsv(report)
  assert.ok(csv.startsWith('"Dönem";"Eylül 2026 – Ekim 2026 (6 Eki 2026 itibarıyla)"\r\n'))
  assert.ok(csv.includes('"Kurum";"Toplam";9;0;0;9;"9";"%0"'))
  assert.ok(csv.includes('"Rol";"Öğretmen";"<5";"<5";"<5";"<5";"<5";"<5"'))
  assert.ok(csv.includes('"Bilinmiyor";9'))
  assert.ok(csv.includes('"Rapor günleri (toplam)";0'))
  assert.ok(!csv.includes('t1') && !csv.includes('a1'))
  assert.ok(csv.endsWith('\r\n'))
  assert.equal(hrHiddenText(5), '<5')
  assert.equal(hrPeriodLabel(PERIOD), 'Ocak 2026 – Haziran 2026')
  const notes = hrReportNotes(report)
  assert.equal(notes.length, 6)
  assert.match(notes[5] ?? '', /^9 personelin kıdem başlangıcı girilmemiş/)
  assert.equal(hrReportNotes(hrReport(input())).length, 5)
  assert.equal(hrReportFilename('2026-01', '2026-06', 'csv'), 'ik-raporu-2026-01-2026-06.csv')
  assert.equal(hrReportFilename('2026-01', '2026-01', 'pdf'), 'ik-raporu-2026-01.pdf')
})
