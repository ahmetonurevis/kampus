import assert from 'node:assert/strict'
import test from 'node:test'

import {
  packageHourReport,
  packageReportCsv,
  studentPackageBalance,
  type PackageReportEntry,
  type PackageReportFlows,
  type PackageReportSale,
} from '../packages/school-core/src/lib/finance-package-report.ts'

import { isDomainError } from './support/domain-error.ts'

// Paket saat bakiyesi ve kullanılan saat raporu (IST-114; DOM-FIN-057, DOM-DIL-051, K-21).

const TODAY = '2026-12-15'
const lesson = (hours: number, occurredDate: string): PackageReportEntry => ({
  kind: 'consumed',
  hours,
  occurredDate,
  sourceType: 'lesson',
  archivedAt: null,
  createdAt: `${occurredDate}T10:00:00.000Z`,
})
const manual = (hours: number, occurredDate: string, archivedAt: string | null = null) => ({
  ...lesson(hours, occurredDate),
  sourceType: 'manual' as const,
  archivedAt,
})
const refund = (hours: number, occurredDate: string): PackageReportEntry => ({
  ...lesson(hours, occurredDate),
  kind: 'refunded',
  sourceType: 'withdrawal',
})

function sale(overrides: Partial<PackageReportSale> = {}): PackageReportSale {
  return {
    id: 'sale-1',
    studentId: 's3',
    packageName: '40 saatlik paket',
    kind: 'hours',
    purchasedHours: 40,
    netCents: 1_800_000,
    soldAt: '2026-10-06T09:00:00.000Z',
    expiresDate: null,
    entries: [],
    ...overrides,
  }
}

const FLOW_KEYS = [
  'soldHours',
  'usedHours',
  'refundedHours',
  'expiredHours',
  'soldCents',
  'recognizedCents',
  'returnedCents',
] as const satisfies readonly (keyof PackageReportFlows)[]

function sumOf<T extends PackageReportFlows>(rows: readonly T[]) {
  return Object.fromEntries(
    FLOW_KEYS.map((key) => [key, rows.reduce((total, row) => total + row[key], 0)]),
  )
}

/** Dönem eşitliği: açılış + satılan − kullanılan − iade = kapanış (saat ve kuruş). */
function assertRollForward(row: {
  openingHours: number
  soldHours: number
  usedHours: number
  refundedHours: number
  closingHours: number
  openingDeferredCents: number
  soldCents: number
  recognizedCents: number
  returnedCents: number
  closingDeferredCents: number
}) {
  assert.equal(
    row.openingHours + row.soldHours - row.usedHours - row.refundedHours,
    row.closingHours,
  )
  assert.equal(
    row.openingDeferredCents + row.soldCents - row.recognizedCents - row.returnedCents,
    row.closingDeferredCents,
  )
}

test('IST-114, K-21: elle girilen saatin değişikliği kendi gününe fark olarak düşer, geçmiş ay değişmez', () => {
  const sold = sale({
    entries: [
      lesson(4, '2026-10-10'),
      manual(10, '2026-11-02', '2026-12-03T08:00:00.000Z'),
      manual(6, '2026-12-03'),
    ],
  })
  const report = packageHourReport([sold], { from: '2026-10-01', to: '2026-12-31' }, TODAY)
  assert.deepEqual(
    report.months.map((month) => [month.month, month.usedHours, month.recognizedCents]),
    [
      ['2026-10', 4, 180_000],
      ['2026-11', 10, 450_000],
      ['2026-12', -4, -180_000],
    ],
  )
  assert.equal(report.totals.usedHours, 10)
  assert.equal(report.totals.recognizedCents, 450_000)
  assert.equal(report.totals.closingHours, 30)
  // Kasım raporu Aralık düzeltmesinden sonra da aynıdır.
  const november = packageHourReport([sold], { from: '2026-11-01', to: '2026-11-30' }, TODAY)
  assert.equal(november.totals.usedHours, 10)
  assert.equal(november.totals.openingHours, 36)
  assert.equal(november.totals.closingHours, 26)
  assertRollForward(november.totals)
  const balance = studentPackageBalance('s3', [sold], TODAY)
  assert.equal(balance.usedHours, 10)
  assert.equal(balance.remainingHours, 30)
})

test('IST-114: toplamlar satırlara ve ay dökümüne eşittir, dönem eşitliği saat ve kuruşta tutar', () => {
  const sales = [
    sale({ entries: [lesson(4, '2026-10-10'), manual(3, '2026-11-20')] }),
    sale({
      id: 'sale-2',
      studentId: 's4',
      purchasedHours: 3,
      netCents: 1_000_001,
      soldAt: '2026-09-15T09:00:00.000Z',
      entries: [lesson(1, '2026-09-20'), lesson(1, '2026-10-02'), refund(1, '2026-11-05')],
    }),
    sale({
      id: 'sale-3',
      purchasedHours: 20,
      netCents: 777_777,
      soldAt: '2026-11-25T09:00:00.000Z',
      entries: [lesson(7, '2026-12-01')],
    }),
  ]
  const report = packageHourReport(sales, { from: '2026-10-01', to: '2026-12-31' }, TODAY)
  assert.deepEqual(sumOf(report.lines), sumOf([report.totals]))
  assert.deepEqual(sumOf(report.months), sumOf([report.totals]))
  assert.equal(report.totals.saleCount, 3)
  assertRollForward(report.totals)
  for (const line of report.lines) assertRollForward(line)
  assert.deepEqual(
    report.lines.map((line) => line.saleId),
    ['sale-3', 'sale-1', 'sale-2'],
  )
  // Ayrılışta saat bitti: kalan sıfır, ertelenmiş gelir sıfır, tanınan + iade payı net ücrettir.
  const withdrawn = report.lines.find((line) => line.saleId === 'sale-2')
  assert.equal(withdrawn?.closingHours, 0)
  assert.equal(withdrawn?.closingDeferredCents, 0)
  assert.equal(withdrawn?.openingDeferredCents, 1_000_001 - 333_333)
  assert.equal(withdrawn?.recognizedCents, 666_667 - 333_333)
  assert.equal(withdrawn?.returnedCents, 1_000_001 - 666_667)
})

test('IST-114: rapor bugüne kadar alınınca kapanışı öğrenci bakiyelerinin toplamına eşittir', () => {
  const sales = [
    sale({ entries: [lesson(4, '2026-10-10'), manual(9, '2026-11-20')] }),
    sale({
      id: 'sale-2',
      expiresDate: '2026-11-30',
      soldAt: '2026-10-20T09:00:00.000Z',
      entries: [lesson(2, '2026-10-21')],
    }),
    sale({ id: 'sale-3', studentId: 's4', entries: [lesson(40, '2026-11-01')] }),
  ]
  const report = packageHourReport(sales, { from: '2026-10-01', to: TODAY }, TODAY)
  const balances = ['s3', 's4'].map((id) => studentPackageBalance(id, sales, TODAY))
  const total = (pick: (balance: (typeof balances)[number]) => number) =>
    balances.reduce((sum, balance) => sum + pick(balance), 0)
  assert.equal(
    report.totals.soldHours,
    total((balance) => balance.purchasedHours),
  )
  assert.equal(
    report.totals.usedHours,
    total((balance) => balance.usedHours),
  )
  assert.equal(
    report.totals.closingHours,
    total((balance) => balance.remainingHours),
  )
  assert.equal(
    report.totals.expiredHours,
    total((balance) => balance.expiredHours),
  )
  assert.equal(
    report.totals.soldCents,
    total((balance) => balance.amounts.netCents),
  )
  assert.equal(
    report.totals.recognizedCents,
    total((balance) => balance.amounts.recognizedCents),
  )
  assert.equal(
    report.totals.closingDeferredCents,
    total((balance) => balance.amounts.deferredCents),
  )
})

test('DOM-DIL-051, H-19: süresi dolan saat silinmez, gelir sayılmaz; son kullanma ayına düşer', () => {
  const expiring = sale({ expiresDate: '2026-11-30', entries: [lesson(10, '2026-11-10')] })
  const report = packageHourReport([expiring], { from: '2026-10-01', to: '2026-12-31' }, TODAY)
  assert.equal(report.totals.expiredHours, 30)
  assert.deepEqual(
    report.months.map((month) => month.expiredHours),
    [0, 30, 0],
  )
  assert.equal(report.totals.closingHours, 30)
  assert.equal(report.totals.recognizedCents, 450_000)
  assert.equal(report.totals.closingDeferredCents, 1_350_000)
  const balance = studentPackageBalance('s3', [expiring], TODAY)
  assert.equal(balance.sales[0]?.status, 'expired')
  assert.equal(balance.expiredHours, 30)
  assert.equal(balance.remainingHours, 30)
  // Son kullanma günü bugünse süre dolmamıştır.
  const sameDay = packageHourReport(
    [expiring],
    { from: '2026-11-01', to: '2026-11-30' },
    '2026-11-30',
  )
  assert.equal(sameDay.totals.expiredHours, 0)
  assert.equal(studentPackageBalance('s3', [expiring], '2026-11-30').expiredHours, 0)
})

test('DOM-DIL-051: sıfır bakiyede kalan ve ertelenmiş gelir sıfırdır, tanınan gelir net ücrete eşittir', () => {
  const used = sale({
    purchasedHours: 3,
    netCents: 1_000_001,
    entries: [lesson(1, '2026-10-07'), lesson(1, '2026-10-08'), lesson(1, '2026-10-09')],
  })
  const report = packageHourReport([used], { from: '2026-10-01', to: '2026-10-31' }, TODAY)
  assert.equal(report.totals.recognizedCents, 1_000_001)
  assert.equal(report.totals.closingHours, 0)
  assert.equal(report.totals.closingDeferredCents, 0)
  const balance = studentPackageBalance('s3', [used], TODAY)
  assert.equal(balance.remainingHours, 0)
  assert.equal(balance.sales[0]?.status, 'depleted')
  assert.deepEqual(balance.amounts, {
    netCents: 1_000_001,
    recognizedCents: 1_000_001,
    returnedCents: 0,
    deferredCents: 0,
  })
  // Sonraki dönemde hareketsiz ve kalansız satış satır olmaz.
  const later = packageHourReport([used], { from: '2026-11-01', to: '2026-11-30' }, TODAY)
  assert.deepEqual(later.lines, [])
  assert.equal(later.totals.saleCount, 0)
})

test('IST-114: satış ve hareket günü İstanbul günüdür; satıştan önceki hareket satış gününe düşer', () => {
  const late = sale({
    soldAt: '2026-10-31T22:30:00.000Z',
    entries: [lesson(2, '2026-10-30')],
  })
  const october = packageHourReport([late], { from: '2026-10-01', to: '2026-10-31' }, TODAY)
  assert.deepEqual(october.lines, [])
  const november = packageHourReport([late], { from: '2026-11-01', to: '2026-11-30' }, TODAY)
  assert.equal(november.lines[0]?.soldDate, '2026-11-01')
  assert.equal(november.totals.soldHours, 40)
  assert.equal(november.totals.usedHours, 2)
  assertRollForward(november.totals)
})

test('IST-114: hareketsiz ama kalanı olan satış satırdadır; dönemden sonra satılan girmez', () => {
  const open = sale({ soldAt: '2026-08-01T09:00:00.000Z' })
  const future = sale({ id: 'sale-2', soldAt: '2026-12-20T09:00:00.000Z' })
  const report = packageHourReport([open, future], { from: '2026-10-01', to: '2026-10-31' }, TODAY)
  assert.deepEqual(
    report.lines.map((line) => [line.saleId, line.openingHours, line.closingHours]),
    [['sale-1', 40, 40]],
  )
  assert.equal(report.totals.openingDeferredCents, 1_800_000)
})

test('IST-114: başlangıç bitişten sonra ya da bir yıldan uzun dönem reddedilir', () => {
  assert.throws(
    () => packageHourReport([], { from: '2026-11-02', to: '2026-11-01' }, TODAY),
    isDomainError('export_period_invalid'),
  )
  assert.throws(
    () => packageHourReport([], { from: '2025-01-01', to: '2026-01-02' }, TODAY),
    isDomainError('export_period_too_long'),
  )
  const year = packageHourReport([], { from: '2026-01-15', to: '2026-12-31' }, TODAY)
  assert.equal(year.months.length, 12)
  assert.deepEqual(year.months[0]?.month, '2026-01')
})

test('IST-114: arşivlenip yenisi yazılmamış elle giriş bakiyeye girmez, rapor da onu geri alır', () => {
  const orphan = sale({ entries: [manual(5, '2026-10-10', '2026-11-03T08:00:00.000Z')] })
  const report = packageHourReport([orphan], { from: '2026-10-01', to: '2026-11-30' }, TODAY)
  assert.deepEqual(
    report.months.map((month) => month.usedHours),
    [5, -5],
  )
  assert.equal(report.totals.usedHours, 0)
  assert.equal(studentPackageBalance('s3', [orphan], TODAY).usedHours, 0)
  assert.equal(studentPackageBalance('s3', [orphan], TODAY).usedHoursRecorded, false)
})

test('IST-114: CSV formül kaçışlıdır, tutar ondalık virgüllüdür', () => {
  const report = packageHourReport(
    [sale({ packageName: '=HYPERLINK("x")', entries: [lesson(4, '2026-10-10')] })],
    { from: '2026-10-01', to: '2026-10-31' },
    TODAY,
  )
  const csv = packageReportCsv(report.lines.map((line) => ({ ...line, studentName: '+Ada' })))
  const [header, row] = csv.split('\r\n')
  assert.ok(header?.startsWith('"Öğrenci";"Paket";"Paket türü"'))
  assert.ok(
    row?.startsWith(`"'+Ada";"'=HYPERLINK(""x"")";"Saat paketi";"2026-10-06";"";40;0;40;4;0;0;36;`),
  )
  assert.ok(row?.endsWith(';18000,00;0,00;18000,00;1800,00;0,00;16200,00'))
})
