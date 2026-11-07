import { addDays } from './academic-years.ts'
import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import { assertFinancePeriod, type FinancePeriod } from './finance-export.ts'
import {
  packageHourBalance,
  packageUsedHoursRecorded,
  settledHourEntries,
} from './finance-package-hours.ts'
import {
  packageSaleStatus,
  PACKAGE_KIND_LABELS,
  type PackageHourKind,
  type PackageHourSource,
  type PackageKind,
  type PackageSaleStatus,
} from './finance-packages.ts'
import { dayKey } from './format.ts'

/**
 * Paket saat bakiyesi ve kullanılan saat raporu (IST-114; docs/domain/finans.md DOM-FIN-058,
 * dil-okulu.md DOM-DIL-051). Bakiye saklanmaz, saat hareketlerinden hesaplanır. Rapor dönemin
 * açılış kalanı + satılan − kullanılan − iade edilen = kapanış kalanı eşitliğini saat ve kuruşta
 * tutar; ay dökümü ve satış satırları aynı hesaptan toplanır, toplamlar bakiyeye eşittir.
 *
 * Gelir tanıma (M-12, **doğrulanmalı**): satışın net ücreti kullanılan saat oranıyla tanınır,
 * birikimli payın aşağı yuvarlanmış farkıyla; bütün saat kullanılınca tanınan tutar net ücrete eşit
 * olur, kuruş kaybolmaz. Ayrılış oranı da aynı yuvarlamayı kullanır (`quoteWithdrawal`). Süresi dolan
 * saat yanmaz (H-19): gelir sayılmaz, ertelenmiş gelirde kalır. İade edilen saatin payı yalnız net
 * ücretteki oranıdır; ödenen iade ve kesinti ayrılış kaydındadır.
 *
 * TODO(package-attendance): yoklama ve özel ders köprüsü (OG-116, OG-144) `lesson` kaynaklı hareket
 * yazınca ayrı iş gerekmez: hareket kendi ders gününe düşer. Elle girilen toplam (`manual`, K-21)
 * girişin gününü taşır; değişiklikleri arşivli satırlardan fark olarak okunur ki geçmiş dönem
 * kapandıktan sonra yeni giriş eski dönemi değiştirmesin.
 */

/** Raporun okuduğu saat hareketi; arşivli satır yalnız `manual` zinciri için gelir. */
export interface PackageReportEntry {
  kind: PackageHourKind
  hours: number
  occurredDate: string
  sourceType: PackageHourSource
  /** ISO UTC; etkin satırda `null`. */
  archivedAt: string | null
  /** ISO UTC; aynı anda arşivlenen satırlar arasında sıra. */
  createdAt: string
}

export interface PackageReportSale {
  id: string
  studentId: string
  packageName: string
  kind: PackageKind
  purchasedHours: number
  netCents: number
  /** ISO UTC; dönem günü Europe/Istanbul. */
  soldAt: string
  expiresDate: string | null
  entries: readonly PackageReportEntry[]
}

/** Günlü saat değişimi: tüketim ya da iade; `manual` düzeltmesi eksi olabilir. */
interface HourEvent {
  date: string
  consumed: number
  refunded: number
}

/**
 * Hareketleri güne yayar. Etkin ders ve ayrılış hareketi kendi gününe düşer; ayrılış iadesi yazılmış
 * satışta ayrılış gününden sonraki ders düşmez, çünkü ayrılış o saati ücrete yazmadı, iade etti. `manual` zinciri arşiv
 * sırasıyla okunur: her giriş bir öncekinden farkını kendi gününe yazar, son (etkin) giriş toplamı
 * tamamlar. Satıştan önceki gün satış gününe çekilir: dönem eşitliği satıştan önce hareket görmez.
 */
function hourEvents(sale: PackageReportSale): HourEvent[] {
  const soldDate = dayKey(sale.soldAt)
  const dateOf = (day: string) => (day < soldDate ? soldDate : day)
  const events: HourEvent[] = []
  // Ayrılış gününden sonraki ders bakiyeye girmez (`packageHourBalance` ile aynı küme, K-43).
  const settled = settledHourEntries(sale.entries.filter((entry) => entry.archivedAt === null))
  for (const entry of settled) {
    if (entry.sourceType === 'manual') continue
    events.push({
      date: dateOf(entry.occurredDate),
      consumed: entry.kind === 'consumed' ? entry.hours : 0,
      refunded: entry.kind === 'refunded' ? entry.hours : 0,
    })
  }
  const chain = sale.entries
    .filter((entry) => entry.sourceType === 'manual')
    .sort(
      (a, b) =>
        (a.archivedAt === null ? 1 : 0) - (b.archivedAt === null ? 1 : 0) ||
        (a.archivedAt ?? '').localeCompare(b.archivedAt ?? '') ||
        a.createdAt.localeCompare(b.createdAt),
    )
  let previous = 0
  for (const entry of chain) {
    events.push({ date: dateOf(entry.occurredDate), consumed: entry.hours - previous, refunded: 0 })
    previous = entry.hours
  }
  const last = chain.at(-1)
  // Etkin satırı kalmamış zincir bakiyeye girmez; son değer arşiv gününde geri alınır.
  if (last !== undefined && last.archivedAt !== null)
    events.push({ date: dateOf(dayKey(last.archivedAt)), consumed: -previous, refunded: 0 })
  return events
}

/** Bir güne kadarki (dahil) birikimli saatler; `null` bütün hareketler. */
function hoursThrough(events: readonly HourEvent[], day: string | null) {
  let consumed = 0
  let refunded = 0
  for (const event of events) {
    if (day !== null && event.date > day) continue
    consumed += event.consumed
    refunded += event.refunded
  }
  return { consumed, refunded }
}

/** Net ücretin saat payı, aşağı yuvarlanır; saat alınan saatle sınırlıdır. */
function hourShare(netCents: number, purchasedHours: number, hours: number): number {
  const bounded = Math.min(Math.max(hours, 0), purchasedHours)
  return Math.floor((netCents * bounded) / purchasedHours)
}

/** Satışın bir güne kadarki birikimli durumu; satıştan önceki günde her şey sıfırdır. */
function positionAt(sale: PackageReportSale, events: readonly HourEvent[], day: string | null) {
  if (day !== null && day < dayKey(sale.soldAt))
    return { sold: false, consumed: 0, refunded: 0, remaining: 0, recognized: 0, settled: 0 }
  const { consumed, refunded } = hoursThrough(events, day)
  const settled = hourShare(sale.netCents, sale.purchasedHours, consumed + refunded)
  return {
    sold: true,
    consumed,
    refunded,
    remaining: sale.purchasedHours - consumed - refunded,
    recognized: hourShare(sale.netCents, sale.purchasedHours, consumed),
    settled,
  }
}

/** Dönem hareketleri; ay dökümünde ve satış satırında aynı alanlar. */
export interface PackageReportFlows {
  soldHours: number
  usedHours: number
  refundedHours: number
  /** Son kullanma günü dönemde olan, bugün süresi dolmuş satışların dönem sonu kalanı. */
  expiredHours: number
  soldCents: number
  /** Kullanılan saatin net ücretteki payı: dönemde tanınan gelir. */
  recognizedCents: number
  /** İade edilen saatin net ücretteki payı; ödenen iade tutarı değildir. */
  returnedCents: number
}

export interface PackageReportLine extends PackageReportFlows {
  saleId: string
  studentId: string
  packageName: string
  kind: PackageKind
  soldDate: string
  expiresDate: string | null
  purchasedHours: number
  netCents: number
  openingHours: number
  closingHours: number
  openingDeferredCents: number
  /** Dönem sonunda kalan saatin net ücretteki payı: ertelenmiş gelir. */
  closingDeferredCents: number
}

export interface PackageReportMonth extends PackageReportFlows {
  /** `YYYY-MM`, Europe/Istanbul. */
  month: string
}

export interface PackageReportTotals extends PackageReportFlows {
  saleCount: number
  openingHours: number
  closingHours: number
  openingDeferredCents: number
  closingDeferredCents: number
}

export interface PackageReport {
  from: string
  to: string
  /** Satış satırları: yeni satış önce; dönemde hareketi ya da dönem sonunda kalanı olanlar. */
  lines: PackageReportLine[]
  months: PackageReportMonth[]
  totals: PackageReportTotals
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

const emptyFlows = (): PackageReportFlows => ({
  soldHours: 0,
  usedHours: 0,
  refundedHours: 0,
  expiredHours: 0,
  soldCents: 0,
  recognizedCents: 0,
  returnedCents: 0,
})

/**
 * Bir aralığın hareketleri. Süresi dolan saat, son kullanma günü aralıkta olan ve bugün süresi dolmuş
 * satışın `remainingDay` günündeki kalanıdır; ay dökümü dönem sonunu verir, toplamla tutsun diye.
 */
function flowsIn(
  sale: PackageReportSale,
  events: readonly HourEvent[],
  range: { from: string; to: string; remainingDay: string },
  today: string,
): PackageReportFlows {
  const before = positionAt(sale, events, addDays(range.from, -1))
  const end = positionAt(sale, events, range.to)
  const soldNow = end.sold && !before.sold
  const expiry = sale.expiresDate
  // Süre, son kullanma gününden sonraki gün dolar (`packageSaleStatus`).
  const expired = expiry !== null && expiry >= range.from && expiry <= range.to && today > expiry
  const remainingAtDay = positionAt(sale, events, range.remainingDay).remaining
  return {
    soldHours: soldNow ? sale.purchasedHours : 0,
    usedHours: end.consumed - before.consumed,
    refundedHours: end.refunded - before.refunded,
    expiredHours: expired ? Math.max(remainingAtDay, 0) : 0,
    soldCents: soldNow ? sale.netCents : 0,
    recognizedCents: end.recognized - before.recognized,
    returnedCents: end.settled - end.recognized - (before.settled - before.recognized),
  }
}

function addFlows(target: PackageReportFlows, flows: PackageReportFlows) {
  for (const key of FLOW_KEYS) target[key] += flows[key]
}

/** Dönemin ayları, kesik ilk ve son ayla. */
function monthRanges({ from, to }: FinancePeriod) {
  const ranges: { month: string; from: string; to: string }[] = []
  let start = from
  while (start <= to) {
    const month = start.slice(0, 7)
    const [year, monthNumber] = month.split('-').map(Number) as [number, number]
    const nextMonth =
      monthNumber === 12
        ? `${String(year + 1)}-01-01`
        : `${String(year)}-${String(monthNumber + 1).padStart(2, '0')}-01`
    const monthEnd = addDays(nextMonth, -1)
    ranges.push({ month, from: start, to: monthEnd < to ? monthEnd : to })
    start = nextMonth
  }
  return ranges
}

/**
 * Dönem raporu (IST-114). Dönem en çok bir yıldır; başlangıç bitişten sonraysa 422
 * (`assertFinancePeriod`). Satış günü ve hareket günü Europe/Istanbul günüdür. Toplam bütün satırların
 * toplamıdır, ay dökümünün toplamı da aynıdır.
 */
export function packageHourReport(
  sales: readonly PackageReportSale[],
  period: FinancePeriod,
  today: string,
): PackageReport {
  assertFinancePeriod(period)
  const months = monthRanges(period).map((range) => ({ ...range, flows: emptyFlows() }))
  const totals: PackageReportTotals = {
    ...emptyFlows(),
    saleCount: 0,
    openingHours: 0,
    closingHours: 0,
    openingDeferredCents: 0,
    closingDeferredCents: 0,
  }
  const lines: PackageReportLine[] = []
  for (const sale of sales) {
    const events = hourEvents(sale)
    const opening = positionAt(sale, events, addDays(period.from, -1))
    const closing = positionAt(sale, events, period.to)
    if (!closing.sold) continue
    const flows = flowsIn(sale, events, { ...period, remainingDay: period.to }, today)
    const line: PackageReportLine = {
      saleId: sale.id,
      studentId: sale.studentId,
      packageName: sale.packageName,
      kind: sale.kind,
      soldDate: dayKey(sale.soldAt),
      expiresDate: sale.expiresDate,
      purchasedHours: sale.purchasedHours,
      netCents: sale.netCents,
      openingHours: opening.remaining,
      closingHours: closing.remaining,
      openingDeferredCents: opening.sold ? sale.netCents - opening.settled : 0,
      closingDeferredCents: sale.netCents - closing.settled,
      ...flows,
    }
    const moved = FLOW_KEYS.some((key) => flows[key] !== 0)
    if (!moved && line.closingHours === 0 && line.closingDeferredCents === 0) continue
    lines.push(line)
    totals.saleCount += 1
    addFlows(totals, flows)
    totals.openingHours += line.openingHours
    totals.closingHours += line.closingHours
    totals.openingDeferredCents += line.openingDeferredCents
    totals.closingDeferredCents += line.closingDeferredCents
    for (const month of months)
      addFlows(month.flows, flowsIn(sale, events, { ...month, remainingDay: period.to }, today))
  }
  lines.sort(
    (a, b) =>
      b.soldDate.localeCompare(a.soldDate) ||
      a.packageName.localeCompare(b.packageName, 'tr') ||
      a.saleId.localeCompare(b.saleId),
  )
  return {
    from: period.from,
    to: period.to,
    lines,
    months: months.map(({ month, flows }) => ({ month, ...flows })),
    totals,
  }
}

const REPORT_COLUMNS = [
  'Öğrenci',
  'Paket',
  'Paket türü',
  'Satış günü',
  'Son kullanma',
  'Alınan saat',
  'Açılış kalan saat',
  'Satılan saat',
  'Kullanılan saat',
  'İade edilen saat',
  'Süresi dolan saat',
  'Kapanış kalan saat',
  'Net ücret',
  'Açılış ertelenmiş gelir',
  'Satış tutarı',
  'Tanınan gelir',
  'İade edilen saat payı',
  'Kapanış ertelenmiş gelir',
] as const

/**
 * Raporun bütün satırları CSV olarak: `;` ayırıcı, ondalık virgül, formül kaçışı (`csvCell`). Tutar
 * kuruştan TL'ye çevrilir; saat tam sayıdır. Toplam satırı yazılmaz: dosya satırların kendisidir.
 */
export function packageReportCsv(
  lines: readonly (PackageReportLine & { studentName: string | null })[],
): string {
  const rows = lines.map((line) => [
    csvCell(line.studentName ?? ''),
    csvCell(line.packageName),
    csvCell(PACKAGE_KIND_LABELS[line.kind]),
    csvCell(line.soldDate),
    csvCell(line.expiresDate ?? ''),
    csvCell(line.purchasedHours),
    csvCell(line.openingHours),
    csvCell(line.soldHours),
    csvCell(line.usedHours),
    csvCell(line.refundedHours),
    csvCell(line.expiredHours),
    csvCell(line.closingHours),
    csvAmount(line.netCents),
    csvAmount(line.openingDeferredCents),
    csvAmount(line.soldCents),
    csvAmount(line.recognizedCents),
    csvAmount(line.returnedCents),
    csvAmount(line.closingDeferredCents),
  ])
  return [REPORT_COLUMNS.map(csvCell), ...rows].map((row) => row.join(CSV_SEPARATOR)).join('\r\n')
}

// --- Öğrenci bakiyesi -----------------------------------------------------------------------------

export interface PackageBalanceAmounts {
  netCents: number
  recognizedCents: number
  returnedCents: number
  deferredCents: number
}

export interface PackageBalanceSale {
  saleId: string
  packageName: string
  kind: PackageKind
  soldDate: string
  expiresDate: string | null
  status: PackageSaleStatus
  purchasedHours: number
  usedHours: number
  refundedHours: number
  remainingHours: number
  /** Süresi dolmuş satışın kalan saati; kalan saatin içindedir, silinmez (DOM-DIL-051). */
  expiredHours: number
  usedHoursRecorded: boolean
  amounts: PackageBalanceAmounts
}

export interface PackageBalance {
  studentId: string
  purchasedHours: number
  usedHours: number
  refundedHours: number
  remainingHours: number
  expiredHours: number
  /** Bir satışta kullanılan saat hiç girilmediyse `false` (K-21). */
  usedHoursRecorded: boolean
  sales: PackageBalanceSale[]
  amounts: PackageBalanceAmounts
}

/**
 * Öğrencinin paket bakiyesi (IST-114, DOM-DIL-051): satılan, kullanılan, iade edilen, kalan ve
 * süresi dolan saat; personel için ücret payları. Saatler etkin hareketlerden `packageHourBalance`
 * ile, paylar raporla aynı yuvarlamayla hesaplanır: bugüne kadar alınan raporun kapanışı bakiyeye
 * eşittir. Yeni satış önce.
 */
export function studentPackageBalance(
  studentId: string,
  sales: readonly PackageReportSale[],
  today: string,
): PackageBalance {
  const rows = sales
    .filter((sale) => sale.studentId === studentId)
    .map((sale): PackageBalanceSale => {
      const active = sale.entries.filter((entry) => entry.archivedAt === null)
      const balance = packageHourBalance(sale.purchasedHours, active)
      const status = packageSaleStatus(
        { expiresDate: sale.expiresDate, remainingHours: balance.remainingHours },
        today,
      )
      const recognized = hourShare(sale.netCents, sale.purchasedHours, balance.consumedHours)
      const settled = hourShare(
        sale.netCents,
        sale.purchasedHours,
        balance.consumedHours + balance.refundedHours,
      )
      return {
        saleId: sale.id,
        packageName: sale.packageName,
        kind: sale.kind,
        soldDate: dayKey(sale.soldAt),
        expiresDate: sale.expiresDate,
        status,
        purchasedHours: balance.purchasedHours,
        usedHours: balance.consumedHours,
        refundedHours: balance.refundedHours,
        remainingHours: balance.remainingHours,
        expiredHours: status === 'expired' ? balance.remainingHours : 0,
        usedHoursRecorded: packageUsedHoursRecorded(active),
        amounts: {
          netCents: sale.netCents,
          recognizedCents: recognized,
          returnedCents: settled - recognized,
          deferredCents: sale.netCents - settled,
        },
      }
    })
    .sort((a, b) => b.soldDate.localeCompare(a.soldDate) || a.saleId.localeCompare(b.saleId))
  const total = (pick: (sale: PackageBalanceSale) => number) =>
    rows.reduce((sum, sale) => sum + pick(sale), 0)
  return {
    studentId,
    purchasedHours: total((sale) => sale.purchasedHours),
    usedHours: total((sale) => sale.usedHours),
    refundedHours: total((sale) => sale.refundedHours),
    remainingHours: total((sale) => sale.remainingHours),
    expiredHours: total((sale) => sale.expiredHours),
    usedHoursRecorded: rows.every((sale) => sale.usedHoursRecorded),
    sales: rows,
    amounts: {
      netCents: total((sale) => sale.amounts.netCents),
      recognizedCents: total((sale) => sale.amounts.recognizedCents),
      returnedCents: total((sale) => sale.amounts.returnedCents),
      deferredCents: total((sale) => sale.amounts.deferredCents),
    },
  }
}
