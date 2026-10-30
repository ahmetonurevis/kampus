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
import { scoreText, scoreTone, type AcademicLookups } from './academic-rows.ts'

type Props = {
  gradeId: string
  lookups: AcademicLookups
  onClose: () => void
}

/**
 * Not ayrıntısı: kayıt tek kayıt ucundan okunur; kapsam dışı veya olmayan not 404 olur ve
 * Türkçe "bulunamadı" mesajı gösterilir (varlığı sızdırılmaz).
 */
export function GradePanel({ gradeId, lookups, onClose }: Props) {
  return (
    <SidePanel
      open={gradeId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Not ayrıntısı"
    >
      {gradeId ? <GradeDetail gradeId={gradeId} lookups={lookups} /> : null}
    </SidePanel>
  )
}

function GradeDetail({ gradeId, lookups }: Omit<Props, 'onClose'>) {
  const item = useCoreItem('grades', gradeId)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!item.data) return <SummaryLoading />
  const record = item.data.record
  const student = lookups.students.get(record.studentId)
  const subject = lookups.subjects.get(record.subjectId)?.name ?? record.subject
  return (
    <>
      <SummaryHeader
        icon={<SummaryIcon name="Award" />}
        title={record.title}
        subtitle={`${subject} · ${dateLabel(record.date, { year: 'numeric' })}`}
        status={scoreText(record.score)}
        tone={scoreTone(record.score)}
      />
      <SummaryMetrics
        items={[
          { label: 'Öğrenci', value: student?.name ?? '—' },
          { label: 'Puan', value: scoreText(record.score) },
        ]}
      />
      <SummarySection title="Kazanım / Konu">
        <p className="text-sm">{record.topic || '—'}</p>
      </SummarySection>
    </>
  )
}
