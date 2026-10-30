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
import { RequestUpdateForm } from './RequestUpdateForm.tsx'
import { requestRow } from './request-rows.ts'

type Props = {
  recordId: string
  onClose: () => void
  /** Ön büro: durum, birim ve yanıt formu görünür. Veli yalnız okur. */
  canUpdate?: boolean
}

/**
 * Talep ayrıntısı: tek kayıt ucundan okunur; kapsam dışı kayıt (başka öğrencinin talebi) 404 ile
 * "bulunamadı" olur. Kurumun yanıtları kronolojik listelenir (veli kendi çocuğunun talebinde
 * görür). Ön büroda altta durum/birim/yanıt formu bulunur (`If-Match` kaydın sürümü).
 */
export function RequestPanel({ recordId, onClose, canUpdate = false }: Props) {
  return (
    <SidePanel
      open={recordId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Talep ayrıntısı"
    >
      {recordId ? (
        <RequestDetail recordId={recordId} onClose={onClose} canUpdate={canUpdate} />
      ) : null}
    </SidePanel>
  )
}

function RequestDetail({
  recordId,
  onClose,
  canUpdate,
}: {
  recordId: string
  onClose: () => void
  canUpdate: boolean
}) {
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
      <SummarySection title="Yanıtlar">
        {row.replies.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz yanıt yok.</p>
        ) : (
          <ol className="grid gap-3">
            {row.replies.map((reply) => (
              <li key={reply.id} className="rounded-card border bg-surface-soft px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  {reply.by} · {dateLabel(reply.at, { year: 'numeric' })}
                </p>
                <p className="mt-1 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">
                  {reply.text}
                </p>
              </li>
            ))}
          </ol>
        )}
      </SummarySection>
      {canUpdate ? (
        <SummarySection title="Talebi güncelle">
          <RequestUpdateForm
            record={item.data.record}
            version={item.data.version}
            reload={async () => {
              const fresh = (await item.refetch()).data
              return fresh ? { record: fresh.record, version: fresh.version } : null
            }}
            onClose={onClose}
          />
        </SummarySection>
      ) : null}
    </>
  )
}
