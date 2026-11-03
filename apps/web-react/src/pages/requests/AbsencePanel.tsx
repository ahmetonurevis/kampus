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
import { AbsenceAttachForm } from './AbsenceAttachForm.tsx'
import { AbsenceDecision } from './AbsenceDecision.tsx'
import { AbsenceDocuments } from './AbsenceDocuments.tsx'
import { absenceActions, type AbsenceViewer } from './absence-forms.ts'
import { absenceRow } from './request-rows.ts'

type Props = {
  recordId: string
  onClose: () => void
  /** Okuyucu: veli belge ekler, yönetici karar verir, rehber öğretmen salt okur (varsayılan veli). */
  viewer?: AbsenceViewer
}

/**
 * İzin/mazeret bildirimi ayrıntısı: tek kayıt ucundan okunur; kapsam dışı kayıt 404 olur.
 * Durum rozeti okuyucuya göre yazılır (veli red yerine "Onaylanmadı" görür, gerekçe hiçbir yerde
 * yoktur; Sabah kararı 72). Özür belgeleri "Aç" ile imzalı bağlantıyla açılır. Veli karar
 * verilmemiş bildirimine belge ekler, yönetici onaylar ya da gerekçeyle reddeder (Sabah kararı
 * 71), rehber öğretmen aynı paneli salt okur görür.
 */
export function AbsencePanel({ recordId, onClose, viewer = 'parent' }: Props) {
  return (
    <SidePanel
      open={recordId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Bildirim ayrıntısı"
    >
      {recordId ? <AbsenceDetail recordId={recordId} viewer={viewer} /> : null}
    </SidePanel>
  )
}

function AbsenceDetail({ recordId, viewer }: { recordId: string; viewer: AbsenceViewer }) {
  const item = useCoreItem('absences', recordId)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!item.data) return <SummaryLoading />
  const row = absenceRow(item.data, viewer === 'parent' ? 'parent' : 'staff')
  const actions = absenceActions(row, viewer)
  return (
    <>
      <SummaryHeader
        icon={<SummaryIcon name="ClipboardCheck" />}
        title={row.category}
        subtitle={row.student || row.range}
        status={row.status}
        tone={row.tone}
      />
      <SummaryMetrics
        items={[
          { label: 'Tarih aralığı', value: row.range },
          { label: 'Gönderildi', value: dateLabel(row.sentAt, { year: 'numeric' }) },
          ...(row.className ? [{ label: 'Sınıf', value: row.className }] : []),
          ...(row.decidedAt
            ? [{ label: 'Karar tarihi', value: dateLabel(row.decidedAt, { year: 'numeric' }) }]
            : []),
        ]}
      />
      {row.reason ? (
        <SummarySection title="Açıklama">
          <p className="text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">{row.reason}</p>
        </SummarySection>
      ) : null}
      <AbsenceDocuments row={row} />
      {actions.attach ? (
        <AbsenceAttachForm key={row.fileIds.length} row={row} remaining={actions.remaining} />
      ) : null}
      {actions.decide ? <AbsenceDecision key={row.version} row={row} /> : null}
    </>
  )
}
