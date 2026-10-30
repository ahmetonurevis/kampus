import type { ReactNode } from 'react'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { PdfButton } from '@/components/PdfButton.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { useCoreItem } from '@/hooks/use-core-collection.ts'
import { SummaryLoading, SummaryMetrics } from '../management/SummaryParts.tsx'
import { invoiceRow, type InvoiceRow } from './finance-rows.ts'

type Props = {
  invoiceId: string
  onClose: () => void
  /** Ödenmemiş taksidin işlemleri (tahsilat); ödenmiş taksitte çağrılmaz. */
  actions?: (row: InvoiceRow) => ReactNode
}

/** Taksit detayı (Vue `Finance.vue` drawer): öğrenci, tutar, durum, vade ve tahsilat bilgisi. */
export function InvoiceSummaryPanel({ invoiceId, onClose, actions }: Props) {
  return (
    <SidePanel
      open={invoiceId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Taksit detayı"
    >
      {invoiceId ? <InvoiceDetail invoiceId={invoiceId} actions={actions} /> : null}
    </SidePanel>
  )
}

function InvoiceDetail({ invoiceId, actions }: Omit<Props, 'onClose'>) {
  const item = useCoreItem('invoices', invoiceId)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!item.data) return <SummaryLoading />
  const row = invoiceRow(item.data, dayKey())
  return (
    <>
      <div className="detail-person mb-5 flex items-center gap-3.5">
        <Avatar name={row.studentName} />
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold [overflow-wrap:anywhere]">{row.studentName}</h3>
          <p className="text-sm text-muted-foreground">
            {row.className} · {row.installment}. taksit
          </p>
        </div>
      </div>
      <SummaryMetrics
        items={[
          { label: 'Taksit tutarı', value: money(row.amount) },
          { label: 'Durum', value: <StatusBadge text={row.status} /> },
        ]}
      />
      <dl className="detail-facts mb-6 grid gap-0 text-sm">
        {[
          ['Vade tarihi', dateLabel(row.dueDate, { year: 'numeric' })],
          [
            'Tahsilat tarihi',
            row.paidAt ? dateLabel(row.paidAt, { year: 'numeric' }) : 'Henüz tahsil edilmedi',
          ],
          ['Ödeme yöntemi', row.paidAt ? (row.method ?? '—') : '—'],
          ['Okul numarası', row.studentNumber],
          ['Kayıt numarası', row.id.toUpperCase()],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 border-b py-2.5 last:border-b-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-medium [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
      {row.paidAt ? (
        <div className="detail-actions flex flex-wrap gap-2">
          <PdfButton type="receipt" recordId={row.id} label="Dekontu görüntüle" size="default" />
        </div>
      ) : actions ? (
        <div className="detail-actions flex flex-wrap gap-2">{actions(row)}</div>
      ) : null}
    </>
  )
}
