import { useMemo } from 'react'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { useCoreAll, useCoreItem } from '@/hooks/use-core-collection.ts'
import { SummaryLoading, SummaryMetrics, SummarySection } from '../management/SummaryParts.tsx'
import { SummaryTitle } from './LearningParts.tsx'
import { deliverySummary, type LearningLookups } from './learning-rows.ts'

type Props = {
  homeworkId: string
  lookups: LearningLookups
  onClose: () => void
}

/** Öğretmen ödev özeti: teslim eden, geciken ve bekleyen sayıları, öğrenci bazında durum. */
export function HomeworkDeliveryPanel({ homeworkId, lookups, onClose }: Props) {
  return (
    <SidePanel
      open={homeworkId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Ödev teslim durumu"
    >
      {homeworkId ? <DeliveryDetail homeworkId={homeworkId} lookups={lookups} /> : null}
    </SidePanel>
  )
}

function DeliveryDetail({ homeworkId, lookups }: Omit<Props, 'onClose'>) {
  // Tek kayıt ucu kapsamı uygular: başka sınıfın ödevi 404 döner ve "bulunamadı" görünür.
  const item = useCoreItem('homework', homeworkId)
  const submissions = useCoreAll('submissions', { filters: { homeworkId } })
  const homework = item.data?.record
  const summary = useMemo(
    () =>
      homework && submissions.data
        ? deliverySummary(
            homework,
            submissions.data.map((row) => row.record),
            lookups.studentsByClass,
          )
        : null,
    [homework, submissions.data, lookups.studentsByClass],
  )
  const error = item.error ?? submissions.error
  if (error)
    return (
      <QueryError
        error={error}
        onRetry={() => {
          if (item.error) void item.refetch()
          if (submissions.error) void submissions.refetch()
        }}
      />
    )
  if (!homework || !summary) return <SummaryLoading />
  const schoolClass = lookups.classes.get(homework.classId)
  return (
    <>
      <SummaryTitle
        icon="NotebookPen"
        title={homework.title}
        subtitle={`${schoolClass?.name ?? '—'} · ${homework.subject} · Son teslim ${dateLabel(homework.dueDate, { year: 'numeric' })}`}
      />
      <SummaryMetrics
        items={[
          { label: 'Teslim eden', value: `${summary.delivered} / ${summary.total}` },
          { label: 'Geciken', value: summary.late },
          { label: 'Bekleyen', value: summary.pending },
          { label: 'Değerlendirilen', value: summary.evaluated },
        ]}
      />
      <SummarySection title="Ödev açıklaması">
        <p className="text-sm [overflow-wrap:anywhere]">{homework.description}</p>
      </SummarySection>
      <SummarySection title="Öğrenci durumu">
        {summary.students.length ? (
          <ul aria-label="Öğrenci teslim durumu" className="detail-list grid gap-2">
            {summary.students.map((entry) => (
              <li
                key={entry.studentId}
                className="flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm"
              >
                <strong className="font-medium">{entry.name}</strong>
                <StatusBadge text={entry.status} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Bu sınıfta aktif öğrenci yok.</p>
        )}
      </SummarySection>
    </>
  )
}
