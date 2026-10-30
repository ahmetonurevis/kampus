import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { useCoreItem } from '@/hooks/use-core-collection.ts'
import {
  SummaryHeader,
  SummaryIcon,
  SummaryLoading,
  SummaryMetrics,
  SummarySection,
} from '../management/SummaryParts.tsx'
import { absenceRow } from './request-rows.ts'

type Props = {
  recordId: string
  onClose: () => void
}

/** İzin/mazeret bildirimi ayrıntısı: tek kayıt ucundan okunur; kapsam dışı kayıt 404 olur. */
export function AbsencePanel({ recordId, onClose }: Props) {
  return (
    <SidePanel
      open={recordId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Bildirim ayrıntısı"
    >
      {recordId ? <AbsenceDetail recordId={recordId} /> : null}
    </SidePanel>
  )
}

function AbsenceDetail({ recordId }: { recordId: string }) {
  const item = useCoreItem('absences', recordId)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!item.data) return <SummaryLoading />
  const row = absenceRow(item.data)
  return (
    <>
      <SummaryHeader
        icon={<SummaryIcon name="ClipboardCheck" />}
        title={row.category}
        subtitle={row.student || row.range}
        status={row.status}
      />
      <SummaryMetrics
        items={[
          { label: 'Tarih aralığı', value: row.range },
          { label: 'Gönderildi', value: dateLabel(row.sentAt, { year: 'numeric' }) },
        ]}
      />
      {row.reason ? (
        <SummarySection title="Açıklama">
          <p className="text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">{row.reason}</p>
        </SummarySection>
      ) : null}
    </>
  )
}
