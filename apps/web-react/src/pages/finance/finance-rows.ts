// Finans & Tahsilat listesinin satır ve sorgu hesapları (Vue `Finance.vue`). Saf işlevlerdir:
// API satırları ve öğrenci/sınıf eşlemeleri girer; tablo/CSV satırı ve sunucu sorgusu çıkar.
import { dateLabel, invoiceStatus, money } from '@kampus/school-core/lib/format.ts'
import type { CollectionQuery } from '@kampus/react-shared/collections.ts'
import type { CoreRecord, CoreRow } from '@/hooks/use-core-collection.ts'
import {
  exportQueryFromList,
  isSearchActive,
  type CollectionListConfig,
} from '../../lib/collection-list.ts'
import { pageSlice } from '../../lib/list-query.ts'
import type { ListState } from '../../lib/list-state.ts'

type Student = CoreRecord<'students'>
type SchoolClass = CoreRecord<'classes'>

/** Core `invoiceStatus` etiketleri; URL'de ASCII kısa adla taşınır (`?durum=gecikmis`). */
export const INVOICE_STATUSES = {
  odendi: 'Ödendi',
  gecikmis: 'Gecikmiş',
  yaklasan: 'Yaklaşan',
} as const satisfies Record<string, ReturnType<typeof invoiceStatus>>
export type InvoiceStatusSlug = keyof typeof INVOICE_STATUSES
export type InvoiceStatus = ReturnType<typeof invoiceStatus>

export function isInvoiceStatusSlug(value: unknown): value is InvoiceStatusSlug {
  return typeof value === 'string' && Object.hasOwn(INVOICE_STATUSES, value)
}

/** Sunucunun taksitte sıralayabildiği sütunlar; öğrenci adı ve durum türetilmiş alandır. */
export const INVOICE_LIST = {
  sortFields: { installment: 'installment', dueDate: 'dueDate', amount: 'amount' },
  // Vue gibi vadeye göre; eşitlikte kimlik (sayfalar arası kararlı sıra).
  defaultSort: ['dueDate', 'id'],
} satisfies CollectionListConfig

export type FinanceLookups = {
  students: ReadonlyMap<string, Student>
  classes: ReadonlyMap<string, SchoolClass>
}

export function financeLookups(
  students: readonly CoreRow<'students'>[],
  classes: readonly CoreRow<'classes'>[],
): FinanceLookups {
  return {
    students: new Map(students.map((row) => [row.record.id, row.record])),
    classes: new Map(classes.map((row) => [row.record.id, row.record])),
  }
}

export type InvoiceRow = {
  id: string
  version: number
  studentId: string
  studentName: string
  studentNumber: string
  className: string
  installment: number
  dueDate: string
  /** Kuruş. */
  amount: number
  paidAt: string | null
  method: string | null
  status: InvoiceStatus
}

/** `today` Europe/Istanbul günüdür (`dayKey()`); durum vadesi geçmiş ödenmemiş taksitte "Gecikmiş". */
export function invoiceRow(
  item: CoreRow<'invoices'>,
  lookups: FinanceLookups,
  today: string,
): InvoiceRow {
  const invoice = item.record
  const student = lookups.students.get(invoice.studentId)
  return {
    id: invoice.id,
    version: item.version,
    studentId: invoice.studentId,
    studentName: student?.name ?? 'Öğrenci bulunamadı',
    studentNumber: student?.number ?? '—',
    className: (student && lookups.classes.get(student.classId)?.name) ?? '—',
    installment: invoice.installment,
    dueDate: invoice.dueDate,
    amount: invoice.amount,
    paidAt: invoice.paidAt ?? null,
    method: invoice.method ?? null,
    status: invoiceStatus(invoice, today),
  }
}

/** Türkçe büyük/küçük harf ve aksan duyarsız biçim (API `searchKey` ile aynı). */
export function searchKey(value: string): string {
  return value.toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').normalize('NFD').replace(/\p{M}/gu, '')
}

/**
 * Aramanın eşleştiği öğrenciler (ad, okul numarası, sınıf). Taksit kaydı adı taşımadığı için
 * sunucuya `studentId` filtresi olarak gider.
 * TODO(api-search-joined): sunucu ilişkili adla arama verince arama doğrudan `q` olur.
 */
export function matchingStudentIds(lookups: FinanceLookups, query: string): string[] {
  const needle = searchKey(query.trim())
  const ids: string[] = []
  for (const student of lookups.students.values()) {
    const className = lookups.classes.get(student.classId)?.name ?? ''
    if (
      [student.name, student.number ?? '', className].some((text) =>
        searchKey(text).includes(needle),
      )
    )
      ids.push(student.id)
  }
  return ids
}

type AllQuery = Omit<CollectionQuery, 'page' | 'pageSize'>

/**
 * Listenin nasıl okunacağı. Durum türetilmiş olduğundan (`paidAt` + vade) sunucu süzemez:
 * durum seçiliyse filtrenin bütün taksitleri çekilir, süzme/sıralama/sayfa burada yapılır.
 * TODO(api-invoice-status): sunucu durum filtresi verince her durum `server` olur.
 */
export type InvoiceListPlan =
  | { kind: 'empty' }
  | { kind: 'server'; query: CollectionQuery }
  | { kind: 'all'; query: AllQuery; status: InvoiceStatus }

export function invoiceListPlan(
  state: ListState,
  studentIds: readonly string[] | null,
): InvoiceListPlan {
  if (studentIds !== null && studentIds.length === 0) return { kind: 'empty' }
  // Arama sunucuya `q` olarak değil öğrenci kimlikleri olarak gider.
  const base = exportQueryFromList(state, INVOICE_LIST, '')
  const query: AllQuery =
    studentIds === null ? base : { ...base, filters: { studentId: studentIds } }
  const status = state.filters.status
  if (isInvoiceStatusSlug(status)) return { kind: 'all', query, status: INVOICE_STATUSES[status] }
  return { kind: 'server', query: { ...query, page: state.page, pageSize: state.pageSize } }
}

/** Arama etkinse eşleşen öğrenciler, değilse `null` (bütün kurum). */
export function searchStudentIds(lookups: FinanceLookups, query: string): string[] | null {
  return isSearchActive(query) ? matchingStudentIds(lookups, query) : null
}

/**
 * `all` planında durum süzmesi ve sayfa. Sıra sunucudandır (aynı `sort`); süzme sırayı korur,
 * böylece iki planda da aynı sıralama kuralı geçerlidir.
 */
export function selectInvoicePage(
  rows: readonly InvoiceRow[],
  state: Pick<ListState, 'page' | 'pageSize'>,
  status: InvoiceStatus,
): { rows: InvoiceRow[]; total: number; all: InvoiceRow[] } {
  const all = rows.filter((row) => row.status === status)
  return { rows: pageSlice(all, state.page, state.pageSize), total: all.length, all }
}

/** CSV satırı: Vue "Raporu indir" sütunları; tutar ve tarih okunur biçimde. */
export function invoiceCsvRow(row: InvoiceRow) {
  return {
    studentName: row.studentName,
    installment: row.installment,
    dueDate: dateLabel(row.dueDate, { year: 'numeric' }),
    amount: money(row.amount),
    status: row.status,
  }
}
