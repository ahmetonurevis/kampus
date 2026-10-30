// Şikayet/talep ve izin/mazeret ekranlarının satır hesapları (Vue `Communication.vue`). Saf
// işlevlerdir: API satırı girer, tablo/CSV satırı çıkar. Durum ve ilgili birim kayıttaki metindir.
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import type { CoreRow } from '@/hooks/use-core-collection.ts'
import type { CollectionListConfig } from '@/lib/collection-list.ts'

/** Bildirim türleri (Vue `requestForm.category`); sunucu `category` filtresine gider. */
export const REQUEST_CATEGORIES = ['Talep', 'Şikayet', 'Öneri'] as const
/** Talep durumları (Vue `requestEdit.status`); sunucu `status` filtresine gider. */
export const REQUEST_STATUSES = ['Yeni', 'İnceleniyor', 'Çözüldü'] as const

/** Kayıtta durum yoksa (çevrimdışı telefon bildirimi) bildirim iletilmiş sayılır. */
export const ABSENCE_DEFAULT_STATUS = 'İletildi'

export const REQUEST_LIST = {
  sortFields: { title: 'title', student: 'studentName', date: 'date', status: 'status' },
  filterFields: { status: 'status', category: 'category' },
  defaultSort: ['-date'],
} satisfies CollectionListConfig

export const ABSENCE_LIST = {
  sortFields: { sentAt: 'date', status: 'status' },
  defaultSort: ['-createdAt'],
} satisfies CollectionListConfig

export type RequestRow = {
  id: string
  studentId: string
  student: string
  title: string
  text: string
  category: string
  status: string
  assignedTo: string
  /** ISO tarih; ekranda `dateLabel` ile gösterilir. */
  date: string
}

export function requestRow(item: CoreRow<'requests'>): RequestRow {
  const record = item.record
  return {
    id: item.id,
    studentId: record.studentId,
    student: item.joined?.studentName ?? '',
    title: record.title,
    text: record.text,
    category: record.category,
    status: record.status,
    assignedTo: record.assignedTo,
    date: record.date,
  }
}

/** CSV hücreleri ekrandaki metinle aynıdır (tarih Türkçe). */
export function requestCsvRow(row: RequestRow) {
  return { ...row, date: dateLabel(row.date, { year: 'numeric' }) }
}

export type AbsenceRow = {
  id: string
  studentId: string
  student: string
  category: string
  reason: string
  status: string
  startDate: string
  endDate: string
  /** "1 Kas 2026 – 3 Kas 2026" biçiminde aralık metni. */
  range: string
  /** Bildirimin gönderildiği an; web `date`, telefon `createdAt` yazar. */
  sentAt: string
}

/** Tek günlük bildirimde aralık tek tarih olarak yazılır. */
export function dateRange(startDate: string, endDate: string): string {
  const start = dateLabel(startDate, { year: 'numeric' })
  return startDate === endDate ? start : `${start} – ${dateLabel(endDate, { year: 'numeric' })}`
}

export function absenceRow(item: CoreRow<'absences'>): AbsenceRow {
  const record = item.record
  return {
    id: item.id,
    studentId: record.studentId,
    student: item.joined?.studentName ?? '',
    category: record.category,
    reason: record.reason,
    status: record.status || ABSENCE_DEFAULT_STATUS,
    startDate: record.startDate,
    endDate: record.endDate,
    range: dateRange(record.startDate, record.endDate),
    sentAt: record.date ?? record.createdAt ?? '',
  }
}

export function absenceCsvRow(row: AbsenceRow) {
  return { ...row, sentAt: dateLabel(row.sentAt, { year: 'numeric' }) }
}
