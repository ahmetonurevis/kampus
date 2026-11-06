// Finans & Tahsilat listesinin satır ve sorgu hesapları (Vue `Finance.vue`). Saf işlevlerdir:
// API satırları girer (öğrenci adı, okul numarası ve sınıf adı satırın `joined` alanındandır); tablo/CSV satırı ve
// sunucu sorgusu çıkar.
import {
  dateLabel,
  INVOICE_STATUS_LABELS,
  money,
  type InvoiceStatus,
  type InvoiceStatusKey,
} from '@kampus/school-core/lib/format.ts'
import type {
  CollectionCounts,
  CollectionFilters,
  CollectionQuery,
} from '@kampus/react-shared/collections.ts'
import {
  INVOICE_STATUS_OPTIONS,
  invoiceRow,
  isInvoiceStatusKey,
  PARTIAL_STATUS,
  type InvoiceRow,
} from '@kampus/react-shared/finance-model.ts'
import type { FilterField, FilterValue, FilterValues } from '@/lib/list-query.ts'
import { isDayKey } from '../academic/academic-rows.ts'
import {
  collectionQueryFromList,
  exportQueryFromList,
  type CollectionListConfig,
} from '../../lib/collection-list.ts'
import type { ListState } from '../../lib/list-state.ts'

// Taksit satırı ve durum seçenekleri mobille ortaktır (`@kampus/react-shared/finance-model.ts`).
export { INVOICE_STATUS_OPTIONS, invoiceRow, isInvoiceStatusKey, PARTIAL_STATUS }
export type { InvoiceRow }

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

/**
 * Hazır ödeme filtreleri (Vue `Finance.vue` "Hazır ödeme filtreleri" çipleri): durum süzgecinin
 * kısayoludur, aynı `?durum=` anahtarını yazar. Boş değer "Tüm ödemeler"dir.
 */
export const INVOICE_PRESETS = [
  { value: '', label: 'Tüm ödemeler' },
  { value: 'gecikmis', label: 'Geciken ödemeler' },
  { value: 'yaklasan', label: 'Yaklaşan taksitler' },
  { value: 'odendi', label: 'Ödenenler' },
] as const satisfies readonly { value: InvoiceStatusKey | ''; label: string }[]

/** Kampüs süzgecinin çevrildiği sınıf: taksit kaydında kampüs yoktur, öğrencinin sınıfı vardır. */
export type InvoiceClassRef = { id: string; name: string; branchId: string }
export type InvoiceBranchRef = { id: string; name: string }

/** Hiçbir sınıfla eşleşmeyen kimlik: sınıfı olmayan kampüs ya da kampüs dışı sınıf boş liste verir. */
export const NO_CLASS = '__kampusta-sinif-yok__'
/** Koleksiyon ucunun bir süzgeçte kabul ettiği en çok değer (`collections.schemas.ts`). */
export const MAX_FILTER_VALUES = 20

export const CLASS_FILTER_TOO_MANY =
  'Bu kampüsteki sınıf sayısı tek süzgeç için fazla; listeyi daraltmak için sınıf seçin.'

/** Tahsilat tarihi aralığı (Vue "Tahsilat tarihi" süzgeci); sunucuda `dateField=paidAt` ile süzülür. */
export const PAID_AT_FILTER: FilterField = { key: 'paidAt', label: 'Tahsilat tarihi', type: 'date' }

/**
 * Kurum taksit listesinin süzgeç paneli (Vue `Finance.vue`: Kampüs, Sınıf, Tahsilat tarihi).
 * Kampüs seçiliyse sınıf seçenekleri o kampüsünkilerdir; seçilmemişse sınıf adı kampüs adıyla
 * yazılır (farklı kampüslerde aynı ad olabilir). Ödeme yöntemi tahsilatındır, Tahsilat geçmişi
 * sekmesinde süzülür.
 */
export function invoiceFilterFields(
  branches: readonly InvoiceBranchRef[],
  classes: readonly InvoiceClassRef[],
  branchId: string,
): FilterField[] {
  const branchName = new Map(branches.map((branch) => [branch.id, branch.name]))
  return [
    {
      key: 'branchId',
      label: 'Kampüs',
      options: branches.map((branch) => ({ value: branch.id, label: branch.name })),
    },
    {
      key: 'classId',
      label: 'Sınıf',
      options: classes
        .filter((item) => !branchId || item.branchId === branchId)
        .map((item) => ({
          value: item.id,
          label:
            branchId || !branchName.has(item.branchId)
              ? item.name
              : `${item.name} · ${branchName.get(item.branchId) ?? ''}`,
        })),
    },
    PAID_AT_FILTER,
  ]
}

const textFilter = (value: FilterValue) => (typeof value === 'string' ? value : '')

export type InvoiceClassScope =
  { kind: 'all' } | { kind: 'classes'; classIds: string[] } | { kind: 'too_many' }

/**
 * Kampüs ve sınıf süzgecinin sunucu karşılığı: `classId` (taksitte öğrencinin güncel sınıfı).
 * Sınıf seçiliyse yalnız o sınıf; kampüs de seçili ve sınıf o kampüsün değilse sonuç boştur.
 * Yalnız kampüs seçiliyse kampüsün sınıfları; sınıfsız kampüs boştur. Uç bir süzgeçte en çok
 * `MAX_FILTER_VALUES` değer alır: daha çok sınıflı kampüs gönderilmez (`too_many`, uyarı çıkar).
 */
export function invoiceClassScope(
  filters: FilterValues,
  classes: readonly InvoiceClassRef[],
): InvoiceClassScope {
  const branchId = textFilter(filters.branchId)
  const classId = textFilter(filters.classId)
  if (classId) {
    const chosen = classes.find((item) => item.id === classId)
    const outside = branchId !== '' && chosen !== undefined && chosen.branchId !== branchId
    return { kind: 'classes', classIds: [outside ? NO_CLASS : classId] }
  }
  if (!branchId) return { kind: 'all' }
  const ids = classes.filter((item) => item.branchId === branchId).map((item) => item.id)
  if (ids.length > MAX_FILTER_VALUES) return { kind: 'too_many' }
  return { kind: 'classes', classIds: ids.length > 0 ? ids : [NO_CLASS] }
}

/**
 * Tahsilat tarihi aralığı (`dateField=paidAt`, `dateFrom`/`dateTo`; Europe/Istanbul günü, uçlar
 * dahil). Tek uç açık aralıktır; biçimsiz uç ve ters aralık gönderilmez (hata alanın altında).
 */
export function paidAtRange(value: FilterValue): CollectionFilters {
  if (typeof value !== 'object' || value === null) return {}
  const from = isDayKey(value.min) ? value.min : ''
  const to = isDayKey(value.max) ? value.max : ''
  if ((!from && !to) || (from && to && to < from)) return {}
  return { dateField: 'paidAt', ...(from ? { dateFrom: from } : {}), ...(to ? { dateTo: to } : {}) }
}

/**
 * Sunucu sorgusu (sayfa dahil). Arama (`q`: öğrenci adı, okul numarası, sınıf adı), durum
 * (`status`, core durum etiketi), kampüs/sınıf (`classId`), tahsilat tarihi aralığı, sıralama ve
 * sayfa sunucuda uygulanır; `search` gecikmeli arama metnidir. `classes` kampüs süzgecini sınıf
 * listesine çevirir; veli/öğrenci görünümünde süzgeç yoktur, boş kalır.
 */
export function invoiceListQuery(
  state: ListState,
  search: string,
  classes: readonly InvoiceClassRef[] = [],
): CollectionQuery {
  return withInvoiceFilters(collectionQueryFromList(state, INVOICE_LIST, search), state, classes)
}

/** CSV için sayfasız sorgu: aynı arama, süzgeçler ve sıralama. */
export function invoiceExportQuery(
  state: ListState,
  search: string,
  classes: readonly InvoiceClassRef[] = [],
) {
  return withInvoiceFilters(exportQueryFromList(state, INVOICE_LIST, search), state, classes)
}

function withInvoiceFilters<T extends Pick<CollectionQuery, 'filters'>>(
  query: T,
  state: ListState,
  classes: readonly InvoiceClassRef[],
): T {
  const filters: CollectionFilters = { ...query.filters, ...paidAtRange(state.filters.paidAt) }
  const status = state.filters.status
  if (isInvoiceStatusKey(status)) filters.status = INVOICE_STATUS_LABELS[status]
  const scope = invoiceClassScope(state.filters, classes)
  if (scope.kind === 'classes') filters.classId = scope.classIds
  return Object.keys(filters).length > 0 ? { ...query, filters } : query
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

/** Veli ve öğrenci görünümünün kapsamı: sabit öğrenci (veli: seçili çocuk) ve yalnız ödenmişler. */
export type FamilyScope = {
  /** Veli: seçili çocuk. Öğrencide boştur; kapsamı sunucu kendi kaydına daraltır. */
  studentId: string
  /** Dekontlar: yalnız ödenmiş taksitler. */
  paidOnly: boolean
}

function withFamilyScope<T extends Pick<CollectionQuery, 'filters'>>(
  query: T,
  scope: FamilyScope,
): T {
  const filters: Record<string, string | readonly string[]> = { ...query.filters }
  if (scope.studentId) filters.studentId = scope.studentId
  if (scope.paidOnly) filters.status = INVOICE_STATUS_LABELS.odendi
  return { ...query, filters }
}

/** Veli/öğrenci taksit listesi sorgusu: seçili çocuk ve (dekontlarda) ödendi süzgeci eklenir. */
export function familyInvoiceListQuery(state: ListState, search: string, scope: FamilyScope) {
  return withFamilyScope(invoiceListQuery(state, search), scope)
}

/** CSV için sayfasız aynı sorgu. */
export function familyInvoiceExportQuery(state: ListState, search: string, scope: FamilyScope) {
  return withFamilyScope(invoiceExportQuery(state, search), scope)
}

/** Kalan tutar: ödenmemiş taksitte taksit tutarı, ödenmişte 0 (kuruş). */
export function remainingAmount(row: Pick<InvoiceRow, 'amount' | 'paidAt'>): number {
  return row.paidAt ? 0 : row.amount
}

/** Veli/öğrenci CSV satırı: vade, tutar, kalan ve durum okunur biçimde. */
export function familyInvoiceCsvRow(row: InvoiceRow) {
  return {
    installment: `${row.installment}. taksit`,
    dueDate: dateLabel(row.dueDate, { year: 'numeric' }),
    amount: money(row.amount),
    remaining: money(remainingAmount(row)),
    status: row.status,
  }
}

/**
 * Veli/öğrenci toplam kartları için sayım sorgusu (liste araması ve durumundan bağımsız): yalnız
 * seçili çocuk; öğrencide sunucu kapsamı yeter.
 */
export function familyTotalsQuery(studentId: string) {
  return {
    groupBy: 'status',
    sum: 'amount',
    ...(studentId ? { filters: { studentId } } : {}),
  } as const
}
