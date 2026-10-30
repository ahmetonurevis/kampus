// Dashboard özetlerinin saf hesapları (Vue `Dashboard.vue`). Girdi sunucunun toplu sayımları
// (`/counts`) ve kısa listelerdir; sayaçlar istemcide koleksiyon taranarak hesaplanmaz.
import {
  dateLabel,
  INVOICE_STATUS_KEYS,
  INVOICE_STATUS_LABELS,
  type InvoiceStatusKey,
} from '@kampus/school-core/lib/format.ts'
import { countOf, sumOf, type CollectionCounts } from '@kampus/react-shared/collections.ts'
import { CHILD_PARAM } from '../../lib/child-selection.ts'
import { pageHref, type RoleKey } from '../../lib/navigation.ts'
import { addDays, weekStart } from '../academic/academic-rows.ts'

/** Ad soyaddan selamlama için ilk ad. */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? ''

/**
 * Rol sayfasına derin bağlantı; liste filtresi adreste taşınır (`?durum=gecikmis`). Velide seçili
 * çocuk (`?cocuk=`) eklenir, böylece bağlantı aynı çocuğun listesini açar.
 */
export function dashboardHref(
  role: RoleKey,
  path: string,
  params: Readonly<Record<string, string>> = {},
  childId = '',
): string {
  const search = new URLSearchParams()
  if (role === 'veli' && childId) search.set(CHILD_PARAM, childId)
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value)
  const query = search.toString()
  return `${pageHref(role, { path })}${query ? `?${query}` : ''}`
}

// --- Taksitler --------------------------------------------------------------

export type InvoiceStatusSlice = {
  key: InvoiceStatusKey
  label: string
  count: number
  /** Kuruş. */
  amount: number
  /** Toplam tutar içindeki pay (0–100, yuvarlanmış); toplam yoksa 0. */
  share: number
}

/** Öncelik sırası: önce takip gerektiren durumlar. */
const STATUS_ORDER: readonly InvoiceStatusKey[] = ['gecikmis', 'yaklasan', 'odendi']

/**
 * Taksit durumu dağılımı (`groupBy=status&sum=amount`). Sunucu durumu Türkçe etiketle gruplar;
 * anahtar URL süzgecidir. Kayıt olmayan durum sıfırla yer alır, böylece kart düzeni sabit kalır.
 */
export function invoiceStatusSlices(counts: CollectionCounts): InvoiceStatusSlice[] {
  const total = counts.sum ?? 0
  return STATUS_ORDER.filter((key) => INVOICE_STATUS_KEYS.includes(key)).map((key) => {
    const label = INVOICE_STATUS_LABELS[key]
    const amount = sumOf(counts, label)
    return {
      key,
      label,
      count: countOf(counts, label),
      amount,
      share: total > 0 ? Math.round((amount / total) * 100) : 0,
    }
  })
}

/** Ödenmemiş (gecikmiş + yaklaşan) taksitlerin toplamı, kuruş. */
export function outstandingAmount(counts: CollectionCounts): number {
  return (
    sumOf(counts, INVOICE_STATUS_LABELS.gecikmis) + sumOf(counts, INVOICE_STATUS_LABELS.yaklasan)
  )
}

// --- Yoklama ----------------------------------------------------------------

export type AttendanceSummary = {
  present: number
  absent: number
  late: number
  excused: number
  total: number
  /** Katılım oranı (geldi + geç geldi) / toplam, yüzde; kayıt yoksa `null`. */
  rate: number | null
}

export function attendanceSummary(counts: CollectionCounts): AttendanceSummary {
  const present = countOf(counts, 'present')
  const late = countOf(counts, 'late')
  const total = counts.total
  return {
    present,
    absent: countOf(counts, 'absent'),
    late,
    excused: countOf(counts, 'excused'),
    total,
    rate: total > 0 ? Math.round(((present + late) / total) * 100) : null,
  }
}

// --- Haftalık dilimler (mini grafik) -----------------------------------------

export type WeekSlice = { from: string; to: string; label: string }

/**
 * Bugünün haftası dahil son `weeks` hafta (pazartesi–pazar, Europe/Istanbul günleri), eskiden
 * yeniye. Sunucuya `dateFrom`/`dateTo` olarak gider.
 */
export function weekSlices(today: string, weeks = 8): WeekSlice[] {
  const current = weekStart(today)
  return Array.from({ length: weeks }, (_, index) => {
    const from = addDays(current, (index - weeks + 1) * 7)
    return {
      from,
      to: addDays(from, 6),
      label: dateLabel(`${from}T12:00:00.000Z`),
    }
  })
}

export type TrendPoint = { label: string; value: number }

/** Dilim sayımlarından seri: her dilimde istenen grubun sayısı. */
export function weeklyPoints(
  slices: readonly WeekSlice[],
  counts: readonly CollectionCounts[],
  value: string,
): TrendPoint[] {
  return slices.map((slice, index) => ({
    label: slice.label,
    value: countOf(counts[index], value),
  }))
}

/** Seride en az bir kayıt var mı; yoksa grafik çizilmez. */
export const hasTrendData = (points: readonly TrendPoint[]) =>
  points.some((point) => point.value > 0)

/** Grafiğin ekran okuyucu ve görünür metin özeti. */
export function trendSummary(points: readonly TrendPoint[], unit: string): string {
  const first = points[0]
  const last = points.at(-1)
  if (!first || !last) return ''
  const total = points.reduce((sum, point) => sum + point.value, 0)
  if (total === 0) return `Son ${points.length} haftada ${unit} kaydı yok.`
  const peak = points.reduce((best, point) => (point.value > best.value ? point : best), first)
  return (
    `Son ${points.length} haftada toplam ${total} ${unit}. ` +
    `En yüksek: ${peak.label} haftası (${peak.value}). Bu hafta: ${last.value}.`
  )
}

// --- Aylık seri (mini grafik) --------------------------------------------------

export type MonthSlice = { key: string; label: string }

/**
 * Bugünün ayı dahil son `months` ay, eskiden yeniye. Anahtar sunucunun `<alan>:month`
 * gruplamasındaki `YYYY-MM` değeridir (Europe/Istanbul ayı).
 */
export function monthSlices(today: string, months = 6): MonthSlice[] {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7)) - 1
  return Array.from({ length: months }, (_, index) => {
    const date = new Date(Date.UTC(year, month - (months - 1 - index), 15, 12))
    const key = date.toISOString().slice(0, 7)
    const label = new Intl.DateTimeFormat('tr-TR', {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    }).format(date)
    return { key, label }
  })
}

/** Aylık gruplamanın `dateFrom` değeri: ilk dilimin ayının ilk günü. */
export const monthRangeStart = (slices: readonly MonthSlice[]) => `${slices[0]?.key ?? ''}-01`

/** Aylık sayımdan seri; kaydı olmayan ay sıfırdır. `sum` istenirse değer grubun toplamıdır. */
export function monthlyPoints(
  slices: readonly MonthSlice[],
  counts: CollectionCounts,
  measure: 'count' | 'sum' = 'count',
): TrendPoint[] {
  return slices.map((slice) => {
    const group = counts.groups.find((item) => item.value === slice.key)
    return { label: slice.label, value: (measure === 'sum' ? group?.sum : group?.count) ?? 0 }
  })
}

// --- Notlar -----------------------------------------------------------------

export type SubjectAverageRow = { subjectId: string; name: string; average: number; count: number }

/**
 * Ders ortalamaları (`grades` `groupBy=subjectId&sum=score`): ortalama `sum / count`, tam sayıya
 * yuvarlanır (core `average` ile aynı). Ders adı başvuru koleksiyonundan; Türkçe sıralı.
 */
export function subjectAverageRows(
  counts: CollectionCounts,
  subjectNames: ReadonlyMap<string, string>,
): SubjectAverageRow[] {
  return counts.groups
    .filter((group) => typeof group.value === 'string' && group.count > 0)
    .map((group) => {
      const subjectId = String(group.value)
      return {
        subjectId,
        name: subjectNames.get(subjectId) ?? 'Ders',
        average: Math.round((group.sum ?? 0) / group.count),
        count: group.count,
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'tr'))
}

/** Genel ortalama: bütün notların ortalaması (`meta.sum / meta.total`); not yoksa `null`. */
export function overallAverage(counts: CollectionCounts): number | null {
  return counts.total > 0 ? Math.round((counts.sum ?? 0) / counts.total) : null
}

// --- Kampüs doluluğu ----------------------------------------------------------

export type CampusOccupancy = {
  id: string
  name: string
  students: number
  capacity: number
  /** 0–100; kontenjan yoksa 0. */
  percentage: number
}

/**
 * Kampüs başına öğrenci ve kontenjan. Sunucu ilişki zinciri kurmaz (api-tasarimi §3): sınıf
 * başına öğrenci sayımı sınıfın kampüsüyle burada birleşir; kontenjan `classes`
 * `groupBy=branchId&sum=capacity` sayımındandır.
 */
export function campusOccupancy(
  branches: readonly { id: string; name: string }[],
  classBranch: ReadonlyMap<string, string>,
  studentsByClass: CollectionCounts,
  capacityByBranch: CollectionCounts,
): CampusOccupancy[] {
  const students = new Map<string, number>()
  for (const group of studentsByClass.groups) {
    const branchId = classBranch.get(String(group.value))
    if (branchId) students.set(branchId, (students.get(branchId) ?? 0) + group.count)
  }
  return branches.map((branch) => {
    const count = students.get(branch.id) ?? 0
    const capacity = sumOf(capacityByBranch, branch.id)
    return {
      id: branch.id,
      name: branch.name,
      students: count,
      capacity,
      percentage: capacity > 0 ? Math.min(100, Math.round((count / capacity) * 100)) : 0,
    }
  })
}
