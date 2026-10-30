// Finans & Tahsilat listesinin satır ve sorgu hesapları (Vue `Finance.vue`). Saf işlevlerdir:
// API satırları girer (öğrenci adı, okul numarası ve sınıf adı satırın `joined` alanındandır); tablo/CSV satırı ve
// sunucu sorgusu çıkar.
import {
  dateLabel,
  INVOICE_STATUS_KEYS,
  INVOICE_STATUS_LABELS,
  invoiceStatusKey,
  money,
  type InvoiceStatus,
  type InvoiceStatusKey,
} from '@kampus/school-core/lib/format.ts'
import type { CollectionCounts, CollectionQuery } from '@kampus/react-shared/collections.ts'
import type { CoreRow } from '@/hooks/use-core-collection.ts'
import {
  collectionQueryFromList,
  exportQueryFromList,
  type CollectionListConfig,
} from '../../lib/collection-list.ts'
import type { ListState } from '../../lib/list-state.ts'

/** Durum seçenekleri; URL'de core durum anahtarıyla taşınır (`?durum=gecikmis`). */
export const INVOICE_STATUS_OPTIONS = INVOICE_STATUS_KEYS.map((key) => ({
  key,
  label: INVOICE_STATUS_LABELS[key],
}))

export function isInvoiceStatusKey(value: unknown): value is InvoiceStatusKey {
  return typeof value === 'string' && (INVOICE_STATUS_KEYS as readonly string[]).includes(value)
}

/**
 * Sunucunun taksitte sıralayabildiği sütunlar. Öğrenci adı ve okul numarası bağlı alandır
 * (`studentName`, `studentNumber`); durum
 * türetilmiş olduğundan sütun olarak sıralanmaz.
 */
export const INVOICE_LIST = {
  sortFields: {
    studentName: 'studentName',
    studentNumber: 'studentNumber',
    installment: 'installment',
    dueDate: 'dueDate',
    amount: 'amount',
  },
  // Vue gibi vadeye göre; eşitlikte kimlik (sayfalar arası kararlı sıra).
  defaultSort: ['dueDate', 'id'],
} satisfies CollectionListConfig

export type InvoiceRow = {
  id: string
  version: number
  studentId: string
  /** Kapsam dışı öğrencide "—". */
  studentName: string
  /** Okul numarası; kapsam dışında veya saklanmamışsa "—". */
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
export function invoiceRow(item: CoreRow<'invoices'>, today: string): InvoiceRow {
  const invoice = item.record
  return {
    id: invoice.id,
    version: item.version,
    studentId: invoice.studentId,
    studentName: item.joined?.studentName ?? '—',
    studentNumber: item.joined?.studentNumber ?? '—',
    className: item.joined?.className ?? '—',
    installment: invoice.installment,
    dueDate: invoice.dueDate,
    amount: invoice.amount,
    paidAt: invoice.paidAt ?? null,
    method: invoice.method ?? null,
    status: INVOICE_STATUS_LABELS[invoiceStatusKey(invoice, today)],
  }
}

/**
 * Sunucu sorgusu (sayfa dahil). Arama (`q`: öğrenci adı, okul numarası, sınıf adı), durum
 * (`status`, core durum etiketi), sıralama ve sayfa sunucuda uygulanır; `search` gecikmeli arama
 * metnidir.
 */
export function invoiceListQuery(state: ListState, search: string): CollectionQuery {
  return withStatus(collectionQueryFromList(state, INVOICE_LIST, search), state)
}

/** CSV için sayfasız sorgu: aynı arama, durum ve sıralama. */
export function invoiceExportQuery(state: ListState, search: string) {
  return withStatus(exportQueryFromList(state, INVOICE_LIST, search), state)
}

function withStatus<T extends Pick<CollectionQuery, 'filters'>>(query: T, state: ListState): T {
  const status = state.filters.status
  if (!isInvoiceStatusKey(status)) return query
  return { ...query, filters: { ...query.filters, status: INVOICE_STATUS_LABELS[status] } }
}

export type InvoiceTotals = {
  /** Kuruş. */
  total: number
  paid: number
  remaining: number
  overdue: number
}

/**
 * `counts?groupBy=status&sum=amount` yanıtından toplam kartları (kuruş). Kalan bakiye ödenmemiş
 * (gecikmiş + yaklaşan) taksitlerdir; Vue'daki "Kalan bakiye" ile aynıdır.
 */
export function invoiceTotals(counts: CollectionCounts): InvoiceTotals {
  const sumOf = (status: InvoiceStatus) =>
    counts.groups.find((group) => group.value === status)?.sum ?? 0
  const total = counts.sum ?? 0
  const paid = sumOf(INVOICE_STATUS_LABELS.odendi)
  return {
    total,
    paid,
    remaining: total - paid,
    overdue: sumOf(INVOICE_STATUS_LABELS.gecikmis),
  }
}

/** CSV satırı: Vue "Raporu indir" sütunları; tutar ve tarih okunur biçimde. */
export function invoiceCsvRow(row: InvoiceRow) {
  return {
    studentName: row.studentName,
    studentNumber: row.studentNumber,
    installment: row.installment,
    dueDate: dateLabel(row.dueDate, { year: 'numeric' }),
    amount: money(row.amount),
    status: row.status,
  }
}
