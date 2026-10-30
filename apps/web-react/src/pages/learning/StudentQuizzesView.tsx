import { useMemo } from 'react'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll, useCoreItem, type CoreRecord } from '@/hooks/use-core-collection.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import {
  SummaryList,
  SummaryLoading,
  SummaryMetrics,
  SummarySection,
} from '../management/SummaryParts.tsx'
import { SummaryTitle, TableGate } from './LearningParts.tsx'
import { attemptResult, studentQuizRow, type StudentQuizRow } from './learning-rows.ts'

type Student = CoreRecord<'students'>
type Props = { student: Student; title: string }

const NONE: readonly never[] = []
const MOBILE_COLUMNS = ['subject', 'completion', 'score']

/**
 * Seçili öğrencinin quizleri ve sonuçları (öğrencide kendisi, velide seçili çocuk). Puan,
 * core'un cevaplardan hesaplayıp yazdığı sonuçtur (`attemptResult`); cevap anahtarı öğrenci ve
 * veliye açılmaz. Quiz çözme TODO(api-quiz-submit) ile gelir.
 */
export function StudentQuizzesView({ student, title }: Props) {
  const quizzes = useCoreAll('quizzes', { filters: { classId: student.classId } })
  const attempts = useCoreAll('quizAttempts', { filters: { studentId: student.id } })
  const rows = useMemo(() => {
    if (!quizzes.data || !attempts.data) return undefined
    const records = attempts.data.map((row) => row.record)
    return quizzes.data.map((item) => studentQuizRow(item, records, student.id))
  }, [quizzes.data, attempts.data, student.id])

  const panel = useDetailPanel('quiz')
  const openQuiz = panel.open
  const columns = useMemo<DataColumn<StudentQuizRow>[]>(
    () => [
      {
        key: 'title',
        label: 'Quiz',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openQuiz(row.id)}
            aria-label={`${row.title} sonucunu aç`}
            className="record-link max-w-[340px] truncate text-left font-medium text-primary hover:underline"
          >
            {row.title}
          </button>
        ),
      },
      { key: 'subject', label: 'Ders' },
      { key: 'questions', label: 'Soru sayısı' },
      { key: 'duration', label: 'Süre', cell: (row) => `${row.duration} dk` },
      {
        key: 'completion',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge text={row.completion} tone={row.score === null ? 'amber' : 'green'} />
        ),
      },
      {
        key: 'score',
        label: 'Puan',
        cell: (row) => (row.score === null ? '—' : <strong>%{row.score}</strong>),
      },
      {
        key: 'actions',
        label: 'İşlemler',
        cell: (row) => (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${row.title} sonucu`}
            onClick={() => openQuiz(row.id)}
          >
            <Icon name="Eye" size={15} aria-hidden="true" />
            Sonuç
          </Button>
        ),
      },
    ],
    [openQuiz],
  )

  const error = quizzes.error ?? attempts.error
  return (
    <>
      <section
        aria-labelledby="quiz-sonuclari"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="quiz-sonuclari" className="text-lg font-semibold">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">{rows?.length ?? 0} quiz</p>
        </header>
        <TableGate
          error={error}
          onRetry={() => {
            for (const query of [quizzes, attempts]) if (query.error) void query.refetch()
          }}
          loading={rows === undefined}
        >
          <DataTable
            listKey="quizlerim"
            rows={rows ?? NONE}
            columns={columns}
            mobileColumns={MOBILE_COLUMNS}
            caption={title}
            searchKeys={['title', 'subject']}
            onRowClick={(row) => openQuiz(row.id)}
          />
        </TableGate>
      </section>
      <QuizResultPanel quizId={panel.selectedId} studentId={student.id} onClose={panel.close} />
    </>
  )
}

type PanelProps = { quizId: string; studentId: string; onClose: () => void }

function QuizResultPanel({ quizId, studentId, onClose }: PanelProps) {
  return (
    <SidePanel
      open={quizId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Quiz sonucu"
    >
      {quizId ? <QuizResultDetail quizId={quizId} studentId={studentId} /> : null}
    </SidePanel>
  )
}

function QuizResultDetail({ quizId, studentId }: Omit<PanelProps, 'onClose'>) {
  // Tek kayıt ucu kapsamı uygular: kapsam dışı quiz 404 döner ve "bulunamadı" görünür.
  const item = useCoreItem('quizzes', quizId)
  const attempts = useCoreAll('quizAttempts', { filters: { quizId, studentId } })
  const error = item.error ?? attempts.error
  if (error)
    return (
      <QueryError
        error={error}
        onRetry={() => {
          if (item.error) void item.refetch()
          if (attempts.error) void attempts.refetch()
        }}
      />
    )
  if (!item.data || !attempts.data) return <SummaryLoading />
  const quiz = item.data.record
  const attempt = attempts.data[0]?.record
  const result = attempt ? attemptResult(attempt, quiz, null) : null
  return (
    <>
      <SummaryTitle
        icon="ListChecks"
        title={quiz.title}
        subtitle={`${quiz.subject} · ${quiz.questionIds.length} soru · ${quiz.duration} dk`}
      />
      {attempt && result ? (
        <>
          <SummaryMetrics
            items={[
              { label: 'Puan', value: `%${result.score}` },
              { label: 'Doğru / soru', value: `${result.correct} / ${result.total}` },
            ]}
          />
          <p className="mb-6 text-sm text-muted-foreground">
            Çözülme tarihi: {dateLabel(attempt.date, { year: 'numeric' })}
          </p>
          <SummarySection title="Konu bazında başarı">
            <SummaryList
              empty="Konu bazında sonuç yok."
              items={attempt.topicScores.map((topic) => ({
                key: topic.topic,
                label: topic.topic,
                value: `%${topic.score}`,
              }))}
            />
          </SummarySection>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Bu quiz henüz çözülmedi.</p>
      )}
    </>
  )
}
