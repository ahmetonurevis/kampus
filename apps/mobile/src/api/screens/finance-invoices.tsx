import { useMemo, useState } from 'react'
import { View } from 'react-native'
import type { CollectionRow } from '@kampus/react-shared/collections.ts'
import { invoiceRow } from '@kampus/react-shared/finance-model.ts'
import { useCollectionItem, useCollectionList } from '@kampus/react-shared/use-collection.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import { Badge, Button, Empty, SearchField, Select, Sheet, T } from '../../ui/components.tsx'
import { DetailPair, EmptyResults, ListRow, Pagination } from '../../ui/SchoolLayout.tsx'
import {
  INVOICE_FILTER_OPTIONS,
  invoiceFacts,
  invoiceListItem,
  invoiceListQuery,
} from '../finance-staff.ts'
import { listRefreshing } from '../finance-list.ts'
import { API_PAGE_SIZE, clampPageIndex } from '../list-state.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import { useDebouncedValue } from '../use-debounced-value.ts'
import { useListMemory } from '../view-memory.tsx'
import { PaymentSheet } from './payment-sheet.tsx'

type InvoiceRecord = State['invoices'][number]

/**
 * Taksitler (web `InvoicesSection` eşi): kurumun taksitleri sunucu sayfalı; arama ve ödeme durumu
 * süzgeci sunucuda uygulanır, durum ve sayfa bellekte korunur. Dokununca ayrıntı açılır, ödenmemiş
 * taksitte tahsilat kaydedilir. Yeni sayfa gelene kadar önceki satırlar soluk ve meşgul kalır,
 * tazeleme duyurulur (ON-323).
 */
export function FinanceInvoices({ today }: { today: string }) {
  const { state, setSearch, setFilter, setIndex, clear } = useListMemory('finans:taksitler')
  const search = useDebouncedValue(state.search)
  const query = useMemo(() => invoiceListQuery(state, search), [state, search])
  const list = useCollectionList<InvoiceRecord>('invoices', query)
  const refreshing = listRefreshing(list)
  const total = list.data?.total
  const index = clampPageIndex(state.index, total)
  if (index !== state.index) setIndex(index)
  const [selected, setSelected] = useState<CollectionRow<InvoiceRecord> | null>(null)
  const filtered = state.search.trim() !== '' || state.filter !== ''

  return (
    <View style={{ gap: 12 }}>
      <SearchField
        value={state.search}
        onChange={setSearch}
        placeholder="Öğrenci adı, numarası veya sınıf"
      />
      <Select
        label="Ödeme durumu"
        value={state.filter}
        options={INVOICE_FILTER_OPTIONS}
        onChange={setFilter}
      />
      {list.error ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <ListLoading label="Taksitler yükleniyor…" />
      ) : list.data.rows.length === 0 ? (
        filtered ? (
          <EmptyResults noun="taksit" onClear={clear} />
        ) : (
          <Empty title="Taksit yok" text="Kesin kayıtla oluşan taksitler burada görünür." />
        )
      ) : (
        <>
          <T muted size={14} accessibilityLiveRegion="polite">
            {refreshing ? 'Taksitler güncelleniyor…' : `${String(list.data.total)} taksit`}
          </T>
          <View
            style={{ gap: 10, opacity: refreshing ? 0.55 : 1 }}
            accessibilityRole="list"
            accessibilityState={{ busy: refreshing }}
            aria-busy={refreshing}
          >
            {list.data.rows.map((row) => {
              const item = invoiceListItem(invoiceRow(row, today))
              return (
                <ListRow
                  key={row.id}
                  card
                  title={item.title}
                  subtitle={item.subtitle}
                  eyebrow={item.amount}
                  badge={<Badge text={item.status} />}
                  label={item.label}
                  onPress={() => setSelected(row)}
                />
              )
            })}
          </View>
          <Pagination
            count={list.data.total}
            index={index}
            pageSize={API_PAGE_SIZE}
            onChange={setIndex}
          />
        </>
      )}
      {selected && (
        <InvoiceSheet
          key={selected.id}
          initial={selected}
          today={today}
          onClose={() => setSelected(null)}
        />
      )}
    </View>
  )
}

/**
 * Taksit ayrıntısı (web `InvoiceSummaryPanel`): tek kayıt ucundan tazelenir; ödenmemiş taksitte
 * "Tahsil et" aynı pencerede tahsilat formuna geçer. Dekont ve ödeme planı PDF'i web'dedir.
 */
function InvoiceSheet({
  initial,
  today,
  onClose,
}: {
  initial: CollectionRow<InvoiceRecord>
  today: string
  onClose: () => void
}) {
  const item = useCollectionItem<InvoiceRecord>('invoices', initial.id, { placeholder: initial })
  const [paying, setPaying] = useState(false)
  const row = item.data ? invoiceRow(item.data, today) : null

  if (paying && row && !row.paidAt)
    return (
      <PaymentSheet row={row} today={today} onBack={() => setPaying(false)} onClose={onClose} />
    )
  return (
    <Sheet
      visible
      title="Taksit ayrıntısı"
      onClose={onClose}
      footer={
        <View style={{ gap: 10 }}>
          {row && !row.paidAt && (
            <Button
              primary
              icon="Wallet"
              label={`${row.studentName} ${String(row.installment)}. taksiti tahsil et`}
              disabled={item.isPlaceholderData}
              onPress={() => setPaying(true)}
            >
              Tahsil et
            </Button>
          )}
          <Button onPress={onClose}>Kapat</Button>
        </View>
      }
    >
      {item.error ? (
        <QueryError error={item.error} onRetry={() => void item.refetch()} />
      ) : !row ? (
        <ListLoading label="Taksit yükleniyor…" />
      ) : (
        <>
          <View style={{ gap: 12 }}>
            {invoiceFacts(row).map(([label, value]) => (
              <DetailPair key={label} label={label} value={value} />
            ))}
          </View>
          {row.paidAt && (
            <T muted size={14}>
              Dekont, ödeme planı ve hesap ekstresi belgeleri web uygulamasından alınır.
            </T>
          )}
        </>
      )}
    </Sheet>
  )
}
