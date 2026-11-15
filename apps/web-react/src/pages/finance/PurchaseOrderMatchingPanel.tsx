import { usePurchaseOrderInvoiceMatching } from '@kampus/react-shared/use-finance-supplier-ledger.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import { PURCHASE_UNIT_LABELS } from '@kampus/school-core/lib/finance-purchase-requests.ts'
import { SUPPLIER_LEDGER_ROLES } from '@kampus/school-core/lib/finance-supplier-ledger.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { dayText, MATCH_STATUS_VIEW } from './finance-supplier-ledger-forms.ts'

const signedQuantity = (value: number) => (value > 0 ? `+${String(value)}` : String(value))

/**
 * Sipariş ayrıntısında fatura ve kabul özeti (DOM-FIN-095; ON-277): kalem başına sipariş, kabul
 * edilen ve faturalanan miktar ile siparişin faturaları eşleştirme durumuyla. Faturayı yalnız
 * tedarikçi carisinin rolü görür (K-160, K-283); ön büroya gösterilmez.
 */
export function PurchaseOrderMatchingPanel({ orderId }: { orderId: string }) {
  const { session } = useAuth()
  const allowed = SUPPLIER_LEDGER_ROLES.some((role) => role === session?.role)
  const matching = usePurchaseOrderInvoiceMatching(orderId, allowed)
  if (!allowed) return null
  if (matching.error)
    return <QueryError error={matching.error} onRetry={() => void matching.refetch()} />
  const data = matching.data?.data
  if (!data) return <SummaryLoading />
  const view = data.status === null ? null : MATCH_STATUS_VIEW[data.status]
  return (
    <section aria-labelledby="siparis-fatura-ozeti" className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="siparis-fatura-ozeti" className="text-base font-semibold">
          Fatura ve kabul özeti
        </h3>
        {view ? <StatusBadge text={view.label} tone={view.tone} /> : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <caption className="sr-only">Kalem bazında sipariş, kabul ve fatura</caption>
          <thead className="text-left text-muted-foreground">
            <tr>
              {['Kalem', 'Sipariş', 'Kabul', 'Faturalanan', 'Fark'].map((label) => (
                <th key={label} scope="col" className="py-2 pr-3 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {data.items.map((item) => (
              <tr key={item.orderItemId} className="border-t align-top">
                <th scope="row" className="py-2 pr-3 text-left font-medium">
                  {item.name}
                </th>
                <td className="py-2 pr-3">
                  {`${String(item.orderedQuantity)} ${PURCHASE_UNIT_LABELS[item.unit]}`}
                </td>
                <td className="py-2 pr-3">{String(item.acceptedQuantity)}</td>
                <td className="py-2 pr-3">{String(item.invoicedQuantity)}</td>
                <td
                  className={`py-2 pr-3 ${item.differenceQuantity > 0 ? 'font-semibold text-danger' : ''}`}
                >
                  {signedQuantity(item.differenceQuantity)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted-foreground">
        Fark faturalanan eksi kabul edilendir; artı değer teslim alınmadan faturalanan, eksi değer
        faturası beklenen miktardır.
      </p>
      {data.invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground">Bu siparişe bağlı fatura yok.</p>
      ) : (
        <ul className="grid gap-2" aria-label="Siparişin faturaları">
          {data.invoices.map((invoice) => {
            const status = MATCH_STATUS_VIEW[invoice.status]
            return (
              <li
                key={invoice.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">{`Fatura ${invoice.invoiceNumber}`}</span>
                  <span className="block text-muted-foreground tabular-nums">
                    {`${dayText(invoice.invoiceDate)} · ${money(invoice.grossCents)}`}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-1">
                  {invoice.cancelled ? (
                    <StatusBadge text="İptal edildi" tone="gray" />
                  ) : (
                    <>
                      <StatusBadge text={status.label} tone={status.tone} />
                      {invoice.approved ? <StatusBadge text="Fark onaylandı" tone="green" /> : null}
                    </>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
