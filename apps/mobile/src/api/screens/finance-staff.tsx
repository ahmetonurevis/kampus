import { useState } from 'react'
import { View } from 'react-native'
import { useFinanceTotals } from '@kampus/react-shared/use-finance-exports.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { Empty, T } from '../../ui/components.tsx'
import { DetailPair, Screen, Section, Tabs } from '../../ui/SchoolLayout.tsx'
import { canOpenFinanceStaff, financeTotalRows } from '../finance-staff.ts'
import { ListLoading, QueryError, useApiSession } from '../shell.ts'
import { useServerToday } from '../use-server-today.ts'
import { FinanceContracts } from './contract-staff.tsx'
import { FinanceInvoices } from './finance-invoices.tsx'
import { FinancePayments } from './finance-payments.tsx'

type FinanceView = 'invoices' | 'payments' | 'contracts'
const VIEWS: readonly { value: FinanceView; label: string }[] = [
  { value: 'invoices', label: 'Taksitler' },
  { value: 'payments', label: 'Tahsilat geçmişi' },
  { value: 'contracts', label: 'Sözleşmeler' },
]

/**
 * Finans & Tahsilat (yönetici `finans`, ön büro `tahsilat-takip`; web `FinancePage` eşi): kurum geneli
 * toplamlar, taksitler ve tahsilat kaydı, tahsilat geçmişi, sözleşmeler. Veriler sunucudadır, cihaza yazılmaz.
 * "Bugün" sunucudan gelir; alınamazsa cihaz günü yalnız ekran durumunda kullanılır, ileri tarihli
 * tahsilatı sunucu reddeder. Tarife, burs, ayrılış-iade ve muhasebe aktarımı web'dedir.
 */
export default function FinanceStaff() {
  const session = useApiSession()
  const open = canOpenFinanceStaff(session)
  const [view, setView] = useState<FinanceView>('invoices')

  if (!open)
    return (
      <Screen>
        <Empty title="Modül kullanıma kapalı" text="Yönetici modül tercihlerini değiştirebilir." />
      </Screen>
    )
  return (
    <Screen>
      <T muted>Kurumun ödeme planları, tahsilatları ve sözleşmeleri.</T>
      <FinanceTotals />
      <Tabs value={view} onChange={setView} options={VIEWS} />
      <FinanceBody view={view} />
    </Screen>
  )
}

function FinanceBody({ view }: { view: FinanceView }) {
  const session = useApiSession()
  const { today } = useServerToday()
  const day = today ?? dayKey()
  switch (view) {
    case 'invoices':
      return <FinanceInvoices today={day} />
    case 'payments':
      return <FinancePayments role={session.role} />
    case 'contracts':
      return <FinanceContracts today={day} />
    default:
      return view satisfies never
  }
}

/** Liste aramasından bağımsız, kısmi ödemeleri sayan kurum geneli toplamlar (`GET /finance/totals`). */
function FinanceTotals() {
  const totals = useFinanceTotals()
  return (
    <Section title="Kurum geneli" panel>
      {totals.error ? (
        <QueryError error={totals.error} onRetry={() => void totals.refetch()} />
      ) : !totals.data ? (
        <ListLoading label="Toplamlar yükleniyor…" />
      ) : (
        <View style={{ gap: 12 }}>
          {financeTotalRows(totals.data.data).map(([label, value]) => (
            <DetailPair key={label} label={label} value={value} />
          ))}
        </View>
      )}
    </Section>
  )
}
