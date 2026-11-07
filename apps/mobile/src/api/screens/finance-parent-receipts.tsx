import { useMemo, useState } from 'react'
import { View } from 'react-native'
import {
  FAMILY_PAYMENT_FILTERS,
  familyPaymentFacts,
  familyPaymentItem,
  familyPaymentStatus,
  filterFamilyPayments,
  type FamilyPayment,
} from '@kampus/react-shared/finance-parent-model.ts'
import { useStudentPayments } from '@kampus/react-shared/use-payment-commands.ts'
import { Badge, Button, Empty, Select, Sheet, T } from '../../ui/components.tsx'
import { EmptyResults, ListRow, Pagination } from '../../ui/SchoolLayout.tsx'
import { canOpenParentFinance, pageSlice, PARENT_RECEIPTS_PATH } from '../finance-parent.ts'
import { API_PAGE_SIZE, clampPageIndex } from '../list-state.ts'
import { ListLoading, useApiSession, useListMemory } from '../shell.ts'
import {
  DocumentsOnWeb,
  FactList,
  FinanceQueryError,
  ParentFinanceFrame,
} from './finance-parent-parts.tsx'

const FILTER_OPTIONS = FAMILY_PAYMENT_FILTERS.map(({ value, label }) => ({ value, label }))

/**
 * Veli Dekontlar (web `veli/dekontlar` eşi; DOM-FIN-030, -033, -050, -052): seçili çocuğun
 * tahsilatları dekont numarasıyla, en yeni önce. İptal edilen tahsilat durumuyla listede kalır;
 * iptal gerekçesi veliye dönmez. Süzgeç (geçerli/iptal) ve sayfa çocuk bazında bellekte korunur.
 * Kapsamı sunucu uygular; dekont PDF'i web'dedir (mobil PDF OG-112).
 */
export default function ParentReceipts() {
  const session = useApiSession()
  const open = canOpenParentFinance(session, PARENT_RECEIPTS_PATH)
  return (
    <ParentFinanceFrame open={open} intro="Okulun kaydettiği tahsilatlar ve dekont numaraları.">
      {(childId) => <ChildReceipts childId={childId} />}
    </ParentFinanceFrame>
  )
}

function ChildReceipts({ childId }: { childId: string }) {
  const payments = useStudentPayments(childId)
  const { state, setFilter, setIndex, clear } = useListMemory(`veli/dekontlar/${childId}`)
  const rows = useMemo(
    () => filterFamilyPayments(payments.data?.data ?? [], state.filter),
    [payments.data, state.filter],
  )
  const index = clampPageIndex(state.index, payments.data ? rows.length : undefined)
  if (index !== state.index) setIndex(index)
  const [selected, setSelected] = useState<FamilyPayment | null>(null)

  return (
    <View style={{ gap: 12 }}>
      <Select
        label="Tahsilat durumu"
        value={state.filter}
        options={FILTER_OPTIONS}
        onChange={setFilter}
      />
      {payments.error ? (
        <FinanceQueryError error={payments.error} onRetry={() => void payments.refetch()} />
      ) : !payments.data ? (
        <ListLoading label="Tahsilatlar yükleniyor…" />
      ) : rows.length === 0 ? (
        state.filter !== '' ? (
          <EmptyResults noun="tahsilat" onClear={clear} />
        ) : (
          <Empty
            title="Tahsilat yok"
            text="Okul ödemenizi kaydettiğinde tahsilat ve dekont numarası burada görünür."
          />
        )
      ) : (
        <>
          <View style={{ gap: 10 }} accessibilityRole="list">
            {pageSlice(rows, index).map((payment) => {
              const item = familyPaymentItem(payment)
              return (
                <ListRow
                  key={payment.id}
                  card
                  title={item.title}
                  subtitle={item.subtitle}
                  eyebrow={item.amount}
                  badge={<Badge text={item.status} tone={payment.reversedAt ? 'red' : 'green'} />}
                  label={item.label}
                  onPress={() => setSelected(payment)}
                />
              )
            })}
          </View>
          <Pagination
            count={rows.length}
            index={index}
            pageSize={API_PAGE_SIZE}
            onChange={setIndex}
          />
        </>
      )}
      <DocumentsOnWeb text="Dekont PDF'i web uygulamasından alınır." />
      {selected && <ReceiptSheet payment={selected} onClose={() => setSelected(null)} />}
    </View>
  )
}

function ReceiptSheet({ payment, onClose }: { payment: FamilyPayment; onClose: () => void }) {
  const item = familyPaymentItem(payment)
  return (
    <Sheet
      visible
      title="Tahsilat ayrıntısı"
      onClose={onClose}
      footer={<Button onPress={onClose}>Kapat</Button>}
    >
      <View style={{ gap: 8 }}>
        <T bold size={18}>
          {item.title}
        </T>
        <Badge text={familyPaymentStatus(payment)} tone={payment.reversedAt ? 'red' : 'green'} />
      </View>
      <FactList rows={familyPaymentFacts(payment)} />
    </Sheet>
  )
}
