import { View } from 'react-native'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { ContractRecord } from '@kampus/react-shared/contract-model.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import { Badge, T } from '../../ui/components.tsx'
import { ListRow, Section } from '../../ui/SchoolLayout.tsx'
import { contractPlanView } from '../contract-approval.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'

/**
 * Belgedeki Ek 1 ile aynı ödeme planı (veli ve görevli sözleşme ekranı): onaylı sürümde onay anının
 * kopyası, ek protokol taslağında korunan ve önerilen satırlar, onaysızda güncel taksitler.
 */
export function ContractPlanSection({
  contract,
  invoices,
  error,
  onRetry,
}: {
  contract: ContractRecord
  /** Öğrencinin taksitleri; yüklenirken `undefined`. */
  invoices: readonly State['invoices'][number][] | undefined
  error: ApiError | null
  onRetry: () => void
}) {
  const plan = invoices ? contractPlanView(contract, invoices) : null
  return (
    <Section title={plan?.caption ?? 'Ödeme planı'}>
      {error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : !plan ? (
        <ListLoading label="Ödeme planı yükleniyor…" />
      ) : plan.rows.length === 0 ? (
        <T muted>Sözleşmeye bağlı taksit yok.</T>
      ) : (
        <View accessibilityRole="list">
          {plan.rows.map((row) => (
            <ListRow
              key={row.key}
              title={row.title}
              subtitle={row.subtitle}
              eyebrow={row.amount}
              badge={row.kind ? <Badge text={row.kind} tone="primary" /> : undefined}
            />
          ))}
        </View>
      )}
    </Section>
  )
}
