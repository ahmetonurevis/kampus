import { useMemo } from 'react'
import { countOf } from '@kampus/react-shared/collections.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { useCoreAll, useCoreCounts, useCoreItem } from '@/hooks/use-core-collection.ts'
import { scoreText } from '../academic/academic-rows.ts'
import { subjectScores } from '../academic/exam-analysis-model.ts'
import { riskLevel, riskReasons, RISK_LEVELS, type RiskLookups } from './risk-rows.ts'
import { SummaryList, SummaryLoading, SummaryMetrics, SummarySection } from './SummaryParts.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'

type Props = {
  studentId: string
  lookups: RiskLookups & { subjects: ReadonlyMap<string, { name: string }> }
  onClose: () => void
}

/**
 * Öğrenci özeti (Vue `StudentSummary` çekmecesi): öğrenci tek kayıt ucundan okunur (bağlantıyla
 * gelinen öğrenci de açılır); not ortalaması ve devamsızlık sunucu kayıtlarından hesaplanır.
 * Rehberlik dosyası okunmaz (DOM-YTK-020).
 */
export function RiskStudentPanel({ studentId, lookups, onClose }: Props) {
  return (
    <SidePanel
      open={studentId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Öğrenci özeti"
    >
      {studentId ? <Summary studentId={studentId} lookups={lookups} /> : null}
    </SidePanel>
  )
}

function Summary({ studentId, lookups }: Omit<Props, 'onClose'>) {
  const item = useCoreItem('students', studentId)
  const grades = useCoreAll('grades', { filters: { studentId } })
  const absences = useCoreCounts('attendance', {
    groupBy: 'status',
    filters: { studentId },
  })
  const records = useMemo(() => grades.data?.map((row) => row.record) ?? [], [grades.data])
  const bySubject = useMemo(
    () => subjectScores(records, lookups.subjects),
    [records, lookups.subjects],
  )
  const failed = [item, grades, absences].find((query) => query.error)
  if (failed?.error)
    return <QueryError error={failed.error} onRetry={() => void failed.refetch()} />
  if (!item.data || !grades.data || !absences.data) return <SummaryLoading />

  const student = item.data.record
  const schoolClass = lookups.classes.get(student.classId)
  const branch = lookups.branches.get(schoolClass?.branchId ?? '')?.name
  const absent = countOf(absences.data, 'absent')
  const score = records.length
    ? Math.round(records.reduce((sum, grade) => sum + grade.score, 0) / records.length)
    : null
  const level = riskLevel(score, absent)
  const reasons = riskReasons({ score, absent })
  return (
    <>
      <div className="detail-person mb-5 flex items-center gap-3.5">
        <Avatar name={student.name} size="large" />
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold [overflow-wrap:anywhere]">{student.name}</h3>
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {[schoolClass?.name, branch, student.number ? `No: ${student.number}` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <StatusBadge
          text={level ?? 'Risk yok'}
          tone={level === RISK_LEVELS.high ? 'red' : level ? 'amber' : 'green'}
        />
      </div>
      <SummaryMetrics
        items={[
          { label: 'Not ortalaması', value: score === null ? '—' : scoreText(score) },
          { label: 'Devamsızlık', value: `${absent} ders` },
        ]}
      />
      <SummarySection title="Risk nedeni">
        <p className="text-sm text-muted-foreground">
          {reasons.length
            ? reasons.join(' · ')
            : 'Devamsızlık ve not ortalaması risk eşiğinin üzerinde.'}
        </p>
      </SummarySection>
      <SummarySection title="Ders bazında ortalama">
        <SummaryList
          empty="Henüz not kaydı yok."
          items={bySubject.map((entry) => ({
            key: entry.subjectId,
            label: entry.topic,
            value: scoreText(entry.score),
          }))}
        />
      </SummarySection>
    </>
  )
}
