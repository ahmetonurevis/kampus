import { useMemo, useState } from 'react'
import { View } from 'react-native'
import type { CollectionRow } from '@kampus/react-shared/collections.ts'
import { invoiceRow } from '@kampus/react-shared/finance-model.ts'
import {
  balanceSummaryRows,
  familyInvoiceFacts,
  familyInvoiceItem,
  nextDueText,
  statementItems,
  statementNotes,
  statementTotalRows,
} from '@kampus/react-shared/finance-parent-model.ts'
import { useCollectionItem, useCollectionList } from '@kampus/react-shared/use-collection.ts'
import { useStudentBalance, useStudentStatement } from '@kampus/react-shared/use-finance-exports.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { Badge, Button, Empty, Select, Sheet, T } from '../../ui/components.tsx'
import {
  DetailPair,
  EmptyResults,
  ListRow,
  Notice,
  Pagination,
  Section,
  Tabs,
} from '../../ui/SchoolLayout.tsx'
import { INVOICE_FILTER_OPTIONS } from '../finance-staff.ts'
import {
  canOpenParentFinance,
  familyInvoiceQuery,
  pageSlice,
  PARENT_FINANCE_PATH,
} from '../finance-parent.ts'
import { API_PAGE_SIZE, clampPageIndex } from '../list-state.ts'
import { ListLoading, QueryError, useApiSession, useListMemory } from '../shell.ts'
import { useServerToday } from '../use-server-today.ts'
import {
  DocumentsOnWeb,
  FactList,
  FinanceQueryError,
  ParentFinanceFrame,
} from './finance-parent-parts.tsx'

type InvoiceRecord = State['invoices'][number]
type FinanceView = 'invoices' | 'statement'
const VIEWS: readonly { value: FinanceView; label: string }[] = [
  { value: 'invoices', label: 'Taksitler' },
  { value: 'statement', label: 'Cari ekstre' },
]

/**
 * Veli Finans & Ödeme Planı (web `veli/finans` eşi; IST-107, IST-124, DOM-FIN-052): seçili çocuğun
 * bakiye özeti ve sıradaki taksiti, sunucu sayfalı taksitleri (durum süzgeci, ayrıntı) ve cari
 * ekstresi. Salt okurdur: çevrim içi ödeme yoktur, ödeme okulun tahsilat biriminde kaydedilir.
 * Kapsamı sunucu uygular (velayetli ve kısıtsız ya da ödeyici veli); kapsam dışı öğrenci boş
 * durumdur. Dekont, ekstre ve taahhütname PDF'leri web'dedir (mobil PDF OG-112).
 */
export default function ParentFinance() {
  const session = useApiSession()
  const open = canOpenParentFinance(session, PARENT_FINANCE_PATH)
  return (
    <ParentFinanceFrame
      open={open}
      intro="Çocuğunuzun ödeme planı, taksitleri ve hesap hareketleri."
    >
      {(childId) => <ChildFinance childId={childId} />}
    </ParentFinanceFrame>
  )
}

function ChildFinance({ childId }: { childId: string }) {
  const [view, setView] = useState<FinanceView>('invoices')
  const { today } = useServerToday()
  const day = today ?? dayKey()
  return (
    <>
      <BalanceSummary childId={childId} />
      <Tabs value={view} onChange={setView} options={VIEWS} />
      {view === 'invoices' ? (
        <FamilyInvoices childId={childId} today={day} />
      ) : (
        <Statement childId={childId} />
      )}
    </>
  )
}

/** Bakiye (`GET /finance/students/:id/balance`): kısmi ödemede yalnız kalan kısım sayılır. */
function BalanceSummary({ childId }: { childId: string }) {
  const balance = useStudentBalance(childId)
  const data = balance.data?.data
  const next = data ? nextDueText(data) : null
  return (
    <Section title="Ödeme özeti" panel>
      {balance.error ? (
        <FinanceQueryError error={balance.error} onRetry={() => void balance.refetch()} />
      ) : !data ? (
        <ListLoading label="Ödeme özeti yükleniyor…" />
      ) : (
        <View style={{ gap: 12 }}>
          <FactList rows={balanceSummaryRows(data)} />
          {next && <DetailPair label="Sıradaki taksit" value={next} />}
          <T muted size={14}>
            Ödemeler çevrim içi yapılmaz; okulun tahsilat birimi kaydeder. Ödeme için okulla
            iletişime geçin.
          </T>
        </View>
      )}
    </Section>
  )
}

/** Taksitler: durum süzgeci ve sayfa sunucuda; süzgeç ve sayfa çocuk bazında bellekte korunur. */
function FamilyInvoices({ childId, today }: { childId: string; today: string }) {
  const { state, setFilter, setIndex, clear } = useListMemory(`veli/finans/${childId}`)
  const query = useMemo(() => familyInvoiceQuery(childId, state), [childId, state])
  const list = useCollectionList<InvoiceRecord>('invoices', query)
  const total = list.data?.total
  const index = clampPageIndex(state.index, total)
  if (index !== state.index) setIndex(index)
  const [selected, setSelected] = useState<CollectionRow<InvoiceRecord> | null>(null)

  return (
    <View style={{ gap: 12 }}>
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
        state.filter !== '' ? (
          <EmptyResults noun="taksit" onClear={clear} />
        ) : (
          <Empty title="Taksit yok" text="Kesin kayıtla oluşan taksitler burada görünür." />
        )
      ) : (
        <>
          <View style={{ gap: 10 }} accessibilityRole="list">
            {list.data.rows.map((row) => {
              const item = familyInvoiceItem(invoiceRow(row, today))
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

/** Taksit ayrıntısı: tek kayıt ucundan tazelenir; kayıt kapsamdan çıktıysa (404) boş durum. */
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
  const row = item.data ? invoiceRow(item.data, today) : null
  return (
    <Sheet
      visible
      title="Taksit ayrıntısı"
      onClose={onClose}
      footer={<Button onPress={onClose}>Kapat</Button>}
    >
      {item.error ? (
        <FinanceQueryError error={item.error} onRetry={() => void item.refetch()} />
      ) : !row ? (
        <ListLoading label="Taksit yükleniyor…" />
      ) : (
        <>
          <View style={{ gap: 8 }}>
            <T bold size={18}>
              {`${String(row.installment)}. taksit`}
            </T>
            <Badge text={row.status} />
          </View>
          <FactList rows={familyInvoiceFacts(row)} />
          <DocumentsOnWeb text="Dekont ve taksit taahhütnamesi web uygulamasından alınır." />
        </>
      )}
    </Sheet>
  )
}

/** Cari ekstre (IST-107, DOM-FIN-054): toplamlar, notlar ve tarih sıralı hareketler, sayfalı. */
function Statement({ childId }: { childId: string }) {
  const query = useStudentStatement(childId)
  const statement = query.data?.data
  const { state, setIndex } = useListMemory(`veli/finans/ekstre/${childId}`)
  const items = useMemo(() => (statement ? statementItems(statement.lines) : []), [statement])
  const index = clampPageIndex(state.index, statement ? items.length : undefined)
  if (index !== state.index) setIndex(index)

  if (query.error)
    return <FinanceQueryError error={query.error} onRetry={() => void query.refetch()} />
  if (!statement) return <ListLoading label="Ekstre yükleniyor…" />
  return (
    <View style={{ gap: 12 }}>
      <Section title="Hesap özeti" panel>
        <FactList rows={statementTotalRows(statement)} />
      </Section>
      {statementNotes(statement).map((note) => (
        <Notice key={note} title="Bilgi" text={note} />
      ))}
      {items.length === 0 ? (
        <Empty title="Hesap hareketi yok" text="Taksit ve tahsilatlar burada sırayla görünür." />
      ) : (
        <>
          <View style={{ gap: 10 }} accessibilityRole="list">
            {pageSlice(items, index).map((item) => (
              <ListRow
                key={item.key}
                card
                title={item.label}
                subtitle={`${item.date} · ${item.movement}`}
                eyebrow={`Bakiye ${item.balance}`}
              />
            ))}
          </View>
          <Pagination
            count={items.length}
            index={index}
            pageSize={API_PAGE_SIZE}
            onChange={setIndex}
          />
        </>
      )}
      <DocumentsOnWeb text="Ekstre PDF'i web uygulamasından alınır." />
    </View>
  )
}
