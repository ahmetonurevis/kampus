import { useMemo } from 'react'
import { average } from '@kampus/school-core/lib/format.ts'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { useCoreAll, useCoreItem } from '@/hooks/use-core-collection.ts'
import { SummaryLoading, SummaryMetrics, SummarySection } from '../management/SummaryParts.tsx'
import { SummaryTitle } from './LearningParts.tsx'
import { attemptResult } from './learning-rows.ts'
import { useClassRoster } from './use-class-roster.ts'

type Props = { quizId: string; onClose: () => void }

/** Öğretmen quiz özeti: sınıf ortalaması ve öğrenci bazında sonuç (cevaplardan hesaplanır). */
export function QuizResultsPanel({ quizId, onClose }: Props) {
  return (
    <SidePanel
      open={quizId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Quiz sonuçları"
    >
      {quizId ? <QuizResultsDetail quizId={quizId} /> : null}
    </SidePanel>
  )
}

function QuizResultsDetail({ quizId }: Omit<Props, 'onClose'>) {
  // Tek kayıt ucu kapsamı uygular: başka sınıfın quizi 404 döner ve "bulunamadı" görünür.
  const item = useCoreItem('quizzes', quizId)
  const quiz = item.data?.record
  const { roster, query: students } = useClassRoster(quiz?.classId)
  const attempts = useCoreAll('quizAttempts', { filters: { quizId } })
  const bank = useCoreAll(
    'bank',
    { filters: { subjectId: quiz?.subjectId ?? '' } },
    { enabled: quiz !== undefined },
  )
  const results = useMemo(() => {
    if (!quiz || !attempts.data || !bank.data || !roster) return null
    const questions = bank.data.map((row) => row.record)
    const byStudent = new Map(
      attempts.data.map((row) => [
        row.record.studentId,
        attemptResult(row.record, quiz, questions),
      ]),
    )
    const entries = roster.map((student) => ({
      id: student.id,
      name: student.name,
      result: byStudent.get(student.id) ?? null,
    }))
    const scores = entries.flatMap((entry) => (entry.result ? [entry.result.score] : []))
    return { entries, solved: scores.length, average: scores.length ? average(scores) : null }
  }, [quiz, attempts.data, bank.data, roster])

  const error = item.error ?? attempts.error ?? bank.error ?? students.error
  if (error)
    return (
      <QueryError
        error={error}
        onRetry={() => {
          for (const query of [item, attempts, bank, students])
            if (query.error) void query.refetch()
        }}
      />
    )
  if (!quiz || !results) return <SummaryLoading />
  return (
    <>
      <SummaryTitle
        icon="ListChecks"
        title={quiz.title}
        subtitle={`${item.data?.joined?.className ?? '—'} · ${quiz.questionIds.length} soru · ${quiz.duration} dk`}
      />
      <SummaryMetrics
        items={[
          {
            label: 'Sınıf ortalaması',
            value: results.average === null ? '—' : `%${results.average}`,
          },
          { label: 'Çözen öğrenci', value: `${results.solved} / ${results.entries.length}` },
        ]}
      />
      <SummarySection title="Öğrenci sonuçları">
        {results.entries.length ? (
          <ul aria-label="Öğrenci quiz sonuçları" className="detail-list grid gap-2">
            {results.entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm"
              >
                <strong className="font-medium">{entry.name}</strong>
                <span className="text-right text-muted-foreground">
                  {entry.result
                    ? `${entry.result.correct}/${entry.result.total} doğru · %${entry.result.score}`
                    : 'Henüz çözmedi'}
                </span>
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
