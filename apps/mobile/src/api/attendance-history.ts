// Öğretmen yoklama geçmişi (`screens/attendance-history.tsx`) saf hesapları: tarih aralığı, süzgeç
// kodlaması, öğrenci özeti ve satır metni. Kapsamı (öğretmenin sınıfları, kayıtları) sunucu uygular;
// buradaki işlevler yalnız istek parametrelerini kurar ve gösterimi sadeleştirir. Web karşılığı
// `apps/web-react/src/pages/academic/AttendanceView.tsx` (öğretmen kipi, IST-093, DOM-AKD-036).
// Geçmiş günü düzeltme yalnız yöneticidedir (DOM-AKD-035); telefonda liste salt okunurdur.
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import {
  addDays,
  attendanceCounts,
  attendanceView,
  isAttendanceStatus,
  weekStart,
  type AttendanceCounts,
  type AttendanceStatus,
  type CurrentTerm,
  type TermStatus,
} from './parent-tracking.ts'
import { EMPTY_LIST_STATE, withFilter, type ListState } from './list-state.ts'

// --- Ekran sekmeleri -------------------------------------------------------------------------

/** Öğretmen yoklama ekranının sekmeleri: bugünkü yoklama alma ve geçmiş. */
export const TEACHER_ATTENDANCE_TABS = [
  { value: 'bugun', label: 'Bugünkü yoklama' },
  { value: 'gecmis', label: 'Yoklama geçmişi' },
] as const
export type TeacherAttendanceTab = (typeof TEACHER_ATTENDANCE_TABS)[number]['value']
export const DEFAULT_TEACHER_ATTENDANCE_TAB: TeacherAttendanceTab = 'bugun'

/** Geçmiş salt okunurdur: geçmiş günü yalnız yönetici düzeltir (`attendance_correction_admin_only`). */
export const HISTORY_READ_ONLY_NOTICE =
  'Geçmiş günlerin yoklaması telefonda salt okunurdur. Düzeltmeyi yalnız yönetici yapar; bugünkü yoklamayı "Bugünkü yoklama" sekmesinden alıp düzeltebilirsiniz.'

// --- Tarih aralığı ---------------------------------------------------------------------------

export const HISTORY_RANGES = ['week', 'last30', 'term'] as const
export type HistoryRange = (typeof HISTORY_RANGES)[number]
export const DEFAULT_HISTORY_RANGE: HistoryRange = 'week'

const RANGE_LABELS = {
  week: 'Bu hafta',
  last30: 'Son 30 gün',
  term: 'Dönem',
} as const satisfies Record<HistoryRange, string>

export const historyRangeLabel = (range: HistoryRange): string => RANGE_LABELS[range]

export const isHistoryRange = (value: string): value is HistoryRange =>
  Object.hasOwn(RANGE_LABELS, value)

/** Sunucunun yoklama geçmişi için kabul ettiği en uzun aralık: bir yıl (IST-093). */
const MAX_SPAN_DAYS = 364

export type DayRange = { dateFrom: string; dateTo: string }

/**
 * Sunucu `dateFrom`/`dateTo` aralığı (Europe/Istanbul günü, iki uç dahil). "Bu hafta" haftanın
 * pazartesisinden bugüne; "Son 30 gün" bugün ve önceki 29 gündür; "Dönem" günün dönemidir. Dönem
 * bitişi gelecekte olsa da bugünle kesilir (yoklama ileri tarihli alınmaz) ve başlangıç bir yıllık
 * sınırı aşmaz. Dönem yoksa (tatil) varsayılan haftaya düşülür, sessizce "tümü" istenmez.
 */
export function historyRangeFilters(
  range: HistoryRange,
  today: string,
  term: CurrentTerm,
): DayRange {
  if (range === 'last30') return { dateFrom: addDays(today, -29), dateTo: today }
  if (range === 'term' && term) {
    const dateTo = term.endDate < today ? term.endDate : today
    const earliest = addDays(dateTo, -MAX_SPAN_DAYS)
    const start = term.startDate > earliest ? term.startDate : earliest
    // Dönem başlangıcı bugünden sonraysa (bayat dönem bilgisi) başlangıç bitişi aşmaz: sunucu
    // `dateFrom > dateTo` için 400 verir.
    return { dateFrom: start > dateTo ? dateTo : start, dateTo }
  }
  return { dateFrom: weekStart(today), dateTo: today }
}

/** "Dönem" yalnız günün dönemi varken sunulur; diğer aralıklar her zaman. */
export const historyRanges = (term: CurrentTerm): HistoryRange[] =>
  HISTORY_RANGES.filter((range) => range !== 'term' || term !== null)

/** Dönem bilinmeden de "Dönem" düğmesi sunulur (seçilince bekletilir); bilgi gelince süzülür. */
export const presentedHistoryRanges = (status: TermStatus, term: CurrentTerm): HistoryRange[] =>
  status === 'ready' ? historyRanges(term) : [...HISTORY_RANGES]

export type HistoryRangeResolution = {
  range: HistoryRange
  /**
   * `loading`/`error`: gün ve dönem sunucudan gelir (`/academic-years/current`); bilinmeden hiçbir
   * aralık kurulamaz, liste istekleri bekletilir. Cihaz saati kullanılmaz (saat geri kalmışsa
   * `dateFrom > dateTo` olurdu).
   */
  wait: 'loading' | 'error' | null
}

/** Seçili aralığın uygulanacak değeri; dönem yoksa "Dönem" varsayılana düşer. */
export function resolveHistoryRange(
  range: HistoryRange,
  status: TermStatus,
  term: CurrentTerm,
): HistoryRangeResolution {
  if (status !== 'ready') return { range, wait: status }
  return { range: historyRanges(term).includes(range) ? range : DEFAULT_HISTORY_RANGE, wait: null }
}

export type HistoryDay = {
  /** Sunucunun bugünü (Europe/Istanbul); yanıt gelmediyse `null`. */
  today: string | null
  /** Yanıt cihazın başka bir gününde alındı: gün geçmiş olabilir, yeniden istenmeli. */
  stale: boolean
}

/**
 * Ekranın günü: sunucunun günüdür (`/academic-years/current` `date`), cihaz saati yalnız "yanıt
 * eskidi mi" için kullanılır. Yanıtın alındığı andaki cihaz günü şimdikinden farklıysa gece yarısı
 * geçmiştir ve gün yeniden istenir; o zamana kadar tek yanıttan türeyen gün, dönem ve aralık tutarlı
 * kalır.
 */
export function historyDay(
  serverDate: string | undefined,
  fetchedAt: number | undefined,
  now: Date = new Date(),
): HistoryDay {
  if (!serverDate) return { today: null, stale: false }
  const stale = fetchedAt !== undefined && dayKey(new Date(fetchedAt)) !== dayKey(now)
  return { today: serverDate, stale }
}

// --- Süzgeç (aralık, sınıf, durum) -----------------------------------------------------------

/** Listenin tek süzgeç alanında tutulan üçlü; değişince sayfa başa döner (`withFilter`). */
export type HistoryFilter = {
  range: HistoryRange
  /** Boş: bütün sınıflar. */
  classId: string
  /** Boş: bütün durumlar. */
  status: AttendanceStatus | ''
}

export const DEFAULT_HISTORY_FILTER: HistoryFilter = {
  range: DEFAULT_HISTORY_RANGE,
  classId: '',
  status: '',
}

const SEPARATOR = '|'

export function encodeHistoryFilter(filter: HistoryFilter): string {
  return [filter.range, filter.classId, filter.status].join(SEPARATOR)
}

/** Bozuk ya da boş kod varsayılana düşer; sınıf kimliği ayırıcı içermez. */
export function decodeHistoryFilter(value: string): HistoryFilter {
  const [range = '', classId = '', status = ''] = value.split(SEPARATOR)
  return {
    range: isHistoryRange(range) ? range : DEFAULT_HISTORY_RANGE,
    classId,
    status: isAttendanceStatus(status) ? status : '',
  }
}

/** Seçili sınıf öğretmenin sınıfları arasında değilse (atama kalktı, arşiv) "bütün sınıflar". */
export function resolveHistoryClass(classId: string, classIds: readonly string[]): string {
  return classId !== '' && classIds.includes(classId) ? classId : ''
}

/** Süzgeç alanı değişir, sayfa başa döner; arama korunur. */
export function changeHistoryFilter(state: ListState, patch: Partial<HistoryFilter>): ListState {
  return withFilter(state, encodeHistoryFilter({ ...decodeHistoryFilter(state.filter), ...patch }))
}

/**
 * "Süzgeci temizle": sınıf, durum ve arama sıfırlanır, sayfa başa döner; tarih aralığı korunur
 * (aralık varsayılan bir görünümdür, kullanıcının seçtiği dönem kaybolmaz).
 */
export function clearHistoryFilters(state: ListState): ListState {
  const { range } = decodeHistoryFilter(state.filter)
  return {
    ...EMPTY_LIST_STATE,
    filter: encodeHistoryFilter({ ...DEFAULT_HISTORY_FILTER, range }),
  }
}

/**
 * Liste ve sayım uçlarının ortak sunucu süzgeci: tarih aralığı, isteğe bağlı sınıf ve durum. Kapsam
 * (öğretmenin sınıfları) sunucudadır; sınıf süzgeci yalnız daraltır.
 */
export function historyQueryFilters(
  filter: HistoryFilter,
  range: DayRange,
  studentId?: string,
): Record<string, string> {
  return {
    ...range,
    ...(filter.classId ? { classId: filter.classId } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(studentId ? { studentId } : {}),
  }
}

// --- Sayılar ---------------------------------------------------------------------------------

type CountGroup = { value: string | number | boolean | null; count: number }

/** Sunucu durum gruplarından (`groupBy=status`) sayılar; bilinmeyen durum sayıma girmez. */
export function countsFromGroups(groups: readonly CountGroup[]): AttendanceCounts {
  const counts = attendanceCounts([])
  for (const group of groups) {
    const status = String(group.value)
    if (isAttendanceStatus(status)) counts[status] += group.count
  }
  return counts
}

/** Aralığın okunur metni: "27 Eki 2026 – 3 Kas 2026" (gün anahtarı Europe/Istanbul günüdür). */
export function historyRangeText(range: DayRange): string {
  const day = (key: string) => dateLabel(`${key}T09:00:00.000Z`, { year: 'numeric' })
  return range.dateFrom === range.dateTo
    ? day(range.dateFrom)
    : `${day(range.dateFrom)} – ${day(range.dateTo)}`
}

// --- Satır -----------------------------------------------------------------------------------

type HistoryRecordFields = {
  date?: string
  status?: string
  lateMinutes?: number | null
  reason?: string | null
}

export type HistoryRowView = {
  /** Öğrenci adı (sunucunun bağlı alanı; kapsam dışıysa genel ad). */
  title: string
  /** Sınıf adı. */
  eyebrow: string | undefined
  status: string
  /** "Salı, 3 Kasım 2026 · 12 dk · mazeret notu". */
  subtitle: string
  /** Ekran okuyucu için tam cümle. */
  label: string
}

/** Öğretmen yoklama geçmişi satırı: öğrenci, gün (Europe/Istanbul), durum, dakika ve not. */
export function historyRowView(
  record: HistoryRecordFields,
  joined: { studentName?: string | undefined; className?: string | undefined } | undefined,
): HistoryRowView {
  const view = attendanceView(record)
  const title = joined?.studentName?.trim() || 'Öğrenci'
  const eyebrow = joined?.className?.trim() || undefined
  const subtitle = [view.title, view.subtitle].join(' · ')
  return {
    title,
    eyebrow,
    status: view.status,
    subtitle,
    label: [title, eyebrow, view.status, subtitle].filter(Boolean).join(', '),
  }
}

/** Boş geçmiş metni: süzgeç varsa sonuç yok, yoksa henüz kayıt yok. */
export function emptyHistoryText(filtered: boolean): { title: string; text: string } {
  return filtered
    ? {
        title: 'Bu süzgeçte yoklama kaydı yok',
        text: 'Aralığı, sınıfı veya durumu değiştirin.',
      }
    : {
        title: 'Bu aralıkta yoklama kaydı yok',
        text: 'Yoklama alındığında kayıtlar burada görünür.',
      }
}
