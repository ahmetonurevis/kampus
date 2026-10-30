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
import { requestRow } from './request-rows.ts'

type Props = {
  recordId: string
  onClose: () => void
}

/**
 * Talep ayrıntısı: tek kayıt ucundan okunur; kapsam dışı kayıt (başka öğrencinin talebi) 404 ile
 * "bulunamadı" olur. Yalnız okuma.
 * TODO(api-request-write): ön büronun durum/ilgili birim güncellemesi ve yanıtı için komut ucu
 * yok (core'da `requests` işlemi tanımlı değil); uç gelince buraya form eklenir.
 */
export function RequestPanel({ recordId, onClose }: Props) {
  return (
    <SidePanel
      open={recordId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Talep ayrıntısı"
    >
      {recordId ? <RequestDetail recordId={recordId} /> : null}
    </SidePanel>
  )
}

function RequestDetail({ recordId }: { recordId: string }) {
  const item = useCoreItem('requests', recordId)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!item.data) return <SummaryLoading />
  const row = requestRow(item.data)
  return (
    <>
      <SummaryHeader
        icon={<SummaryIcon name="MessageCircleQuestion" />}
        title={row.title}
        subtitle={[row.student, dateLabel(row.date, { year: 'numeric' })]
          .filter(Boolean)
          .join(' · ')}
        status={row.status}
      />
      <SummaryMetrics
        items={[
          { label: 'Bildirim türü', value: row.category },
          { label: 'İlgili birim', value: row.assignedTo },
          { label: 'Tarih', value: dateLabel(row.date, { year: 'numeric' }) },
        ]}
      />
      <SummarySection title="Açıklama">
        <p className="text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">{row.text}</p>
      </SummarySection>
    </>
  )
}
