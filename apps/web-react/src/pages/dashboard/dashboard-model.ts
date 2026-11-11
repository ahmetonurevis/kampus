// Genel Bakış özetinin saf gösterim hesapları (Vue `Dashboard.vue`). Girdi sunucunun tek özet
// yanıtıdır (`GET /api/v1/dashboard`, `useDashboard`); sayaçlar istemcide koleksiyon taranarak
// hesaplanmaz, burada yalnız oran, ortalama ve etiket türetilir.
import {
  dateLabel,
  INVOICE_STATUS_KEYS,
  INVOICE_STATUS_LABELS,
  type InvoiceStatusKey,
} from '@kampus/school-core/lib/format.ts'
import type { components } from '@kampus/api-client/schema.d.ts'
import { CHILD_PARAM } from '../../lib/child-selection.ts'
import { pageHref, type RoleKey } from '../../lib/navigation.ts'

type Schemas = components['schemas']
export type InvoiceSummary = Schemas['DashboardInvoiceSummary']
export type AttendanceCounts = Schemas['DashboardAttendanceCounts']
export type InvoiceRow = Schemas['DashboardInvoiceRow']
type AdminDashboardData = Schemas['DashboardAdmin']
type StudentAcademic = NonNullable<Schemas['DashboardStudent']['academic']>

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

/**
 * Kartın gösterilip gösterilmeyeceği: yanıt geldiyse sunucunun kararı (kapalı modülün bölümü
 * `null`), gelmediyse oturumdaki modül bayrağı (iskelet aynı düzende çizilir).
 */
export function sectionVisible(section: unknown, loaded: boolean, moduleOn: boolean): boolean {
  return loaded ? section !== null && section !== undefined : moduleOn
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
const SUMMARY_FIELD = {
  gecikmis: 'overdue',
  yaklasan: 'upcoming',
  odendi: 'paid',
} as const satisfies Record<InvoiceStatusKey, keyof InvoiceSummary>

/**
 * Taksit durumu dağılımı. Anahtar URL süzgecidir; kayıt olmayan durum sıfırla yer alır, böylece
 * kart düzeni sabit kalır.
 */
export function invoiceStatusSlices(summary: InvoiceSummary): InvoiceStatusSlice[] {
  return STATUS_ORDER.filter((key) => INVOICE_STATUS_KEYS.includes(key)).map((key) => {
    const { count, amount } = summary[SUMMARY_FIELD[key]]
    return {
      key,
      label: INVOICE_STATUS_LABELS[key],
      count,
      amount,
      share: summary.amount > 0 ? Math.round((amount / summary.amount) * 100) : 0,
    }
  })
}

/** Ödenmemiş (gecikmiş + yaklaşan) taksitlerin toplamı, kuruş. */
export const outstandingAmount = (summary: InvoiceSummary): number =>
  summary.overdue.amount + summary.upcoming.amount

// --- Yoklama ----------------------------------------------------------------

export type AttendanceSummary = AttendanceCounts & {
  /** Katılım oranı (geldi + geç geldi) / toplam, yüzde; kayıt yoksa `null`. */
  rate: number | null
}

export function attendanceSummary(counts: AttendanceCounts): AttendanceSummary {
  return {
    ...counts,
    rate:
      counts.total > 0 ? Math.round(((counts.present + counts.late) / counts.total) * 100) : null,
  }
}

// --- Mini grafikler -----------------------------------------------------------

export type TrendPoint = { label: string; value: number }

/** Haftalık devamsızlık serisi; etiket haftanın pazartesisi. */
export function weeklyPoints(weeks: StudentAcademic['weeklyAbsences']): TrendPoint[] {
  return weeks.map((week) => ({
    label: dateLabel(`${week.from}T12:00:00.000Z`),
    value: week.absent,
  }))
}

/** `YYYY-MM` ay anahtarının kısa etiketi (ör. "Eki 26"). */
export function monthLabel(month: string): string {
  const date = new Date(`${month}-15T12:00:00.000Z`)
  return new Intl.DateTimeFormat('tr-TR', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(date)
}

/** Aylık tahsilat serisi; değer ayın toplamıdır (kuruş). */
export function monthlyPoints(
  months: NonNullable<AdminDashboardData['finance']>['monthlyCollection']['months'],
): TrendPoint[] {
  return months.map((month) => ({ label: monthLabel(month.month), value: month.amount }))
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

// --- Notlar -----------------------------------------------------------------

export type SubjectAverageRow = { subjectId: string; name: string; average: number; count: number }

/**
 * Ders ortalamaları: ortalama `scoreSum / count`, tam sayıya yuvarlanır (core `average` ile aynı).
 * Ad sunucudan gelir (yoksa "Ders"); Türkçe sıralı.
 */
export function subjectAverageRows(grades: StudentAcademic['grades']): SubjectAverageRow[] {
  return grades.subjects
    .filter((row) => row.count > 0)
    .map((row) => ({
      subjectId: row.subjectId,
      name: row.name ?? 'Ders',
      average: Math.round(row.scoreSum / row.count),
      count: row.count,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'tr'))
}

/** Genel ortalama: bütün notların ortalaması; not yoksa `null`. */
export function overallAverage(grades: StudentAcademic['grades']): number | null {
  return grades.count > 0 ? Math.round(grades.scoreSum / grades.count) : null
}

// --- Kampüs doluluğu ----------------------------------------------------------

export type CampusOccupancy = AdminDashboardData['campuses'][number] & {
  /** 0–100; kontenjan yoksa 0. */
  percentage: number
}

/** Kampüs başına aktif öğrenci ve kontenjandan doluluk yüzdesi. */
export function campusOccupancy(campuses: AdminDashboardData['campuses']): CampusOccupancy[] {
  return campuses.map((campus) => ({
    ...campus,
    percentage:
      campus.capacity > 0
        ? Math.min(100, Math.round((campus.students / campus.capacity) * 100))
        : 0,
  }))
}
