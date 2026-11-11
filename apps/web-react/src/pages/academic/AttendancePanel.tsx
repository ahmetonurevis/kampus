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
import {
  attendanceStatusLabel,
  attendanceStatusText,
  NO_REASON,
  type AcademicLookups,
} from './academic-rows.ts'

type Props = {
  recordId: string
  lookups: AcademicLookups
  onClose: () => void
}

/** Yoklama kaydı ayrıntısı: tek kayıt ucundan okunur; kapsam dışı kayıt 404 ile "bulunamadı" olur. */
export function AttendancePanel({ recordId, lookups, onClose }: Props) {
  return (
    <SidePanel
      open={recordId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Yoklama ayrıntısı"
    >
      {recordId ? <AttendanceDetail recordId={recordId} lookups={lookups} /> : null}
    </SidePanel>
  )
}

function AttendanceDetail({ recordId, lookups }: Omit<Props, 'onClose'>) {
  const item = useCoreItem('attendance', recordId)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!item.data) return <SummaryLoading />
  const record = item.data.record
  const status = attendanceStatusLabel(record.status)
  return (
    <>
      <SummaryHeader
        icon={<SummaryIcon name="ClipboardCheck" />}
        title={lookups.students.get(record.studentId)?.name ?? 'Öğrenci'}
        subtitle={dateLabel(record.date, { year: 'numeric', weekday: 'long' })}
        status={status}
      />
      <SummaryMetrics
        items={[
          { label: 'Sınıf', value: lookups.classes.get(record.classId)?.name ?? '—' },
          {
            label: 'Katılım',
            value: attendanceStatusText(
              status,
              record.status === 'late' ? (record.lateMinutes ?? null) : null,
            ),
          },
        ]}
      />
      <SummarySection title="Not">
        <p className="text-sm">{record.reason || NO_REASON}</p>
      </SummarySection>
    </>
  )
}
