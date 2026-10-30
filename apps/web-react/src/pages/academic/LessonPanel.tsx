import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { useCoreItem } from '@/hooks/use-core-collection.ts'
import {
  SummaryHeader,
  SummaryIcon,
  SummaryLoading,
  SummaryMetrics,
} from '../management/SummaryParts.tsx'
import { isVisibleLesson, type AcademicLookups } from './academic-rows.ts'

type Props = {
  lessonId: string
  lookups: AcademicLookups
  onClose: () => void
}

/** Ders ayrıntısı: tek kayıt ucundan okunur; iptal edilen ders programda yer almaz. */
export function LessonPanel({ lessonId, lookups, onClose }: Props) {
  return (
    <SidePanel
      open={lessonId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Ders ayrıntısı"
    >
      {lessonId ? <LessonDetail lessonId={lessonId} lookups={lookups} /> : null}
    </SidePanel>
  )
}

function LessonDetail({ lessonId, lookups }: Omit<Props, 'onClose'>) {
  const item = useCoreItem('schedule', lessonId)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!item.data) return <SummaryLoading />
  const record = item.data.record
  if (!isVisibleLesson(record))
    return <p className="text-sm text-muted-foreground">Bu ders programda yer almıyor.</p>
  const schoolClass = lookups.classes.get(record.classId)
  return (
    <>
      <SummaryHeader
        icon={<SummaryIcon name="CalendarDays" />}
        title={record.title ?? lookups.subjects.get(record.subjectId)?.name ?? 'Ders'}
        subtitle={dateLabel(record.date, { weekday: 'long', year: 'numeric' })}
        status={schoolClass?.name ?? 'Ders'}
        tone="purple"
      />
      <SummaryMetrics
        items={[
          {
            label: 'Saat',
            value: `${timeLabel(record.date)} · ${record.duration} dakika`,
          },
          { label: 'Derslik', value: record.room },
          { label: 'Öğretmen', value: lookups.teachers.get(record.teacherId)?.name ?? '—' },
          {
            label: 'Kampüs',
            value: lookups.branches.get(schoolClass?.branchId ?? '')?.name ?? '—',
          },
        ]}
      />
    </>
  )
}
