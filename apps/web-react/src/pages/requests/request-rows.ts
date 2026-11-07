// Şikayet/talep ve izin/mazeret ekranlarının satır hesapları (Vue `Communication.vue`). Saf
// işlevlerdir: API satırı girer, tablo/CSV satırı çıkar. Durum ve ilgili birim kayıttaki metindir.
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import {
  ABSENCE_APPROVAL_LABELS,
  absenceApprovalStatus,
  absenceReasonLabel,
  type AbsenceApprovalStatus,
} from '@kampus/school-core/lib/requests.ts'
import type { CoreRow } from '@/hooks/use-core-collection.ts'
import type { CollectionListConfig } from '@/lib/collection-list.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

/** Bildirim türleri (Vue `requestForm.category`); sunucu `category` filtresine gider. */
export const REQUEST_CATEGORIES = ['Talep', 'Şikayet', 'Öneri'] as const
/** Talep durumları (Vue `requestEdit.status`); sunucu `status` filtresine gider. */
export const REQUEST_STATUSES = ['Yeni', 'İnceleniyor', 'Çözüldü'] as const

export const REQUEST_LIST = {
  sortFields: { title: 'title', student: 'studentName', date: 'date', status: 'status' },
  filterFields: { status: 'status', category: 'category' },
  defaultSort: ['-date'],
} satisfies CollectionListConfig

export const ABSENCE_LIST = {
  sortFields: { sentAt: 'date', status: 'status' },
  defaultSort: ['-createdAt'],
} satisfies CollectionListConfig

/** Personel (yönetici, rehber öğretmen) mazeret listesi: öğrenci ve sınıf sıralanır, durum süzülür. */
export const ABSENCE_STAFF_LIST = {
  sortFields: { student: 'studentName', className: 'className', sentAt: 'date', status: 'status' },
  filterFields: { status: 'status' },
  defaultSort: ['-createdAt'],
} satisfies CollectionListConfig

/** Kayıtta onay durumu yoksa (eski ya da çevrimdışı telefon bildirimi) karar bekliyor sayılır. */
export const ABSENCE_PENDING_STATUS = 'İletildi'

/**
 * Mazeret listesinin okuyucusu: veli ve öğrenci yalnız durumu görür (Sabah kararı 72), personel
 * (yönetici, rehber öğretmen) core etiketini. Red gerekçesi hiçbir okuyucuya kayıttan dönmez.
 */
export type AbsenceAudience = 'parent' | 'staff'

/** Velinin gördüğü durum etiketi: red "Onaylanmadı" olarak yumuşatılır, gerekçe gösterilmez. */
const PARENT_APPROVAL_LABELS: Record<AbsenceApprovalStatus, string> = {
  pending: ABSENCE_APPROVAL_LABELS.pending,
  approved: ABSENCE_APPROVAL_LABELS.approved,
  rejected: 'Onaylanmadı',
}

const APPROVAL_TONES: Record<AbsenceApprovalStatus, BadgeTone> = {
  pending: 'amber',
  approved: 'green',
  rejected: 'red',
}

export function absenceStatusLabel(approval: AbsenceApprovalStatus, audience: AbsenceAudience) {
  return (audience === 'parent' ? PARENT_APPROVAL_LABELS : ABSENCE_APPROVAL_LABELS)[approval]
}

/** Personel listesinin durum süzgeci: seçenek etiketi ve kayıttaki `status` değeri. */
export const ABSENCE_STATUS_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: ABSENCE_PENDING_STATUS, label: ABSENCE_APPROVAL_LABELS.pending },
  { value: ABSENCE_APPROVAL_LABELS.approved, label: ABSENCE_APPROVAL_LABELS.approved },
  { value: ABSENCE_APPROVAL_LABELS.rejected, label: ABSENCE_APPROVAL_LABELS.rejected },
]

/** Yanıtı yazanın velinin göreceği adı; yanıtı yalnız ön büro ve yönetici yazar. */
const REPLY_AUTHORS: Readonly<Record<string, string>> = { onburo: 'Ön büro', yonetici: 'Yönetici' }

/** Kurumun talebe yazdığı yanıt; veli kendi çocuğunun talebinde görür, düzenlenmez ve silinmez. */
export type ReplyRow = {
  id: string
  text: string
  /** ISO an. */
  at: string
  /** Yanıtı yazanın rolü (Türkçe); kişi adı gösterilmez. */
  by: string
}

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
  replies: ReplyRow[]
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
    replies: (record.replies ?? []).map((reply) => ({
      id: reply.id,
      text: reply.text,
      at: reply.at,
      by: REPLY_AUTHORS[reply.by.role] ?? 'Kurum',
    })),
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
  /** Gerekçe kategorisinin etiketi; kategorisi olmayan eski kayıtta kayıttaki tür metni. */
  category: string
  /** Eski kayıtların serbest açıklaması; yeni bildirim açıklama taşımaz (DOM-ILT-053). */
  reason: string
  /** Okuyucuya göre durum etiketi (`absenceStatusLabel`). */
  status: string
  approval: AbsenceApprovalStatus
  tone: BadgeTone
  startDate: string
  endDate: string
  /** "1 Kas 2026 – 3 Kas 2026" biçiminde aralık metni. */
  range: string
  /** Bildirimin gönderildiği an; web `date`, telefon `createdAt` yazar. */
  sentAt: string
  /** Sınıf adı (bağlı alan); personel listesinde görünür. */
  className: string
  /** Özür belgesi dosya kimlikleri; ad ve içerik kayda girmez (dosya meta verisinden okunur). */
  fileIds: string[]
  /** Kararın verildiği an (onay ya da red); karar yoksa boş. */
  decidedAt: string
  /** Kaydın okunan sürümü: karar ve belge ekleme `If-Match` olarak gönderir. */
  version: number
}

/** Tek günlük bildirimde aralık tek tarih olarak yazılır. */
export function dateRange(startDate: string, endDate: string): string {
  const start = dateLabel(startDate, { year: 'numeric' })
  return startDate === endDate ? start : `${start} – ${dateLabel(endDate, { year: 'numeric' })}`
}

export function absenceRow(
  item: CoreRow<'absences'>,
  audience: AbsenceAudience = 'parent',
): AbsenceRow {
  const record = item.record
  const approval = absenceApprovalStatus(record)
  return {
    id: item.id,
    studentId: record.studentId,
    student: item.joined?.studentName ?? '',
    category: absenceReasonLabel(record),
    reason: record.reason ?? '',
    status: absenceStatusLabel(approval, audience),
    approval,
    tone: APPROVAL_TONES[approval],
    startDate: record.startDate,
    endDate: record.endDate,
    range: dateRange(record.startDate, record.endDate),
    sentAt: record.date ?? record.createdAt ?? '',
    className: item.joined?.className ?? '',
    fileIds: [...(record.fileIds ?? [])],
    decidedAt: record.decidedAt ?? '',
    version: item.version,
  }
}

export function absenceCsvRow(row: AbsenceRow) {
  return {
    ...row,
    sentAt: dateLabel(row.sentAt, { year: 'numeric' }),
    documents: String(row.fileIds.length),
  }
}
