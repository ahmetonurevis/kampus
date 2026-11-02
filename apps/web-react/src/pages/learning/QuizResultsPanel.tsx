// Öğretmen ve yönetici quiz paneli (IST-095; DOM-AKD-075…079). Tek sağ panelin içeriği adresteki
// parametreye göre değişir: `?quiz=` sonuçlar, `?quiz-form=` quiz hazırla/düzenle. Ortalama ve
// öğrenci sonuçları sunucunun cevaplardan hesapladığı değerlerdir; istemci puan hesaplamaz.
import { useState } from 'react'
import { isStaffQuizDetail, type QuizStaffDetail } from '@kampus/react-shared/quizzes.ts'
import { useQuiz } from '@kampus/react-shared/use-quizzes.ts'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCoreItem } from '@/hooks/use-core-collection.ts'
import { SummaryLoading, SummaryMetrics, SummarySection } from '../management/SummaryParts.tsx'
import type { PanelControl } from './HomeworkDeliveryPanel.tsx'
import { NoPermission } from './HomeworkForms.tsx'
import { Facts, SummaryTitle } from './LearningParts.tsx'
import {
  attemptSummary,
  optionText,
  QUIZ_LOCKED_REASON,
  quizActions,
  quizDueText,
  quizLocked,
  seesQuizResults,
  type QuizActor,
} from './quiz-forms.ts'
import { ArchiveQuizDialog, NEW_QUIZ, QuizFormContent } from './QuizForms.tsx'
import { useClassRoster } from './use-class-roster.ts'

type Props = { detail: PanelControl; form: PanelControl; actor: QuizActor }

export function QuizResultsPanel({ detail, form, actor }: Props) {
  const mode = form.selectedId ? 'form' : detail.selectedId ? 'detail' : null
  const title =
    mode === 'form'
      ? form.selectedId === NEW_QUIZ
        ? 'Quiz hazırla'
        : 'Quizi düzenle'
      : 'Quiz sonuçları'
  const close = mode === 'form' ? form.close : detail.close
  return (
    <SidePanel
      open={mode !== null}
      onOpenChange={(open) => (open ? undefined : close())}
      title={title}
    >
      {mode === 'form' ? (
        <QuizFormContent
          key={form.selectedId}
          target={form.selectedId}
          actor={actor}
          onClose={form.close}
        />
      ) : mode === 'detail' ? (
        <QuizResultsDetail
          quizId={detail.selectedId}
          actor={actor}
          onEdit={() => form.open(detail.selectedId)}
          onArchived={detail.close}
        />
      ) : null}
    </SidePanel>
  )
}

function QuizResultsDetail({
  quizId,
  actor,
  onEdit,
  onArchived,
}: {
  quizId: string
  actor: QuizActor
  onEdit: () => void
  onArchived: () => void
}) {
  // Tek kayıt ucu kapsamı uygular: başka sınıfın quizi 404 döner ve "bulunamadı" görünür.
  const item = useQuiz(quizId)
  const data = item.data?.data
  const quiz = data && isStaffQuizDetail(data) ? data : undefined
  const classItem = useCoreItem('classes', quiz?.classId ?? null)
  const { roster, query: students } = useClassRoster(quiz?.classId)
  const [archiving, setArchiving] = useState(false)

  const error = item.error ?? students.error
  if (error)
    return (
      <QueryError
        error={error}
        onRetry={() => {
          if (item.error) void item.refetch()
          if (students.error) void students.refetch()
        }}
      />
    )
  if (data && !quiz) return <NoPermission />
  if (!quiz || !roster) return <SummaryLoading />
  const actions = quizActions(actor, quiz)
  const visible = seesQuizResults(actor, quiz, classItem.data?.record.teacherId)
  const locked = quizLocked(quiz)
  const className = classItem.data?.record.name ?? '—'
  const byStudent = new Map(quiz.attempts.map((attempt) => [attempt.studentId, attempt]))
  const { statistics } = quiz
  return (
    <>
      <SummaryTitle
        icon="ListChecks"
        title={quiz.title}
        subtitle={`${className} · ${quiz.questionCount} soru · ${quiz.duration} dk`}
      />
      <Facts
        items={[
          ['Ders', quiz.subject],
          ['Son tarih', quizDueText(quiz.dueDate)],
          [
            'Durum',
            <StatusBadge
              key="durum"
              text={quiz.status === 'open' ? 'Açık' : 'Kapandı'}
              tone={quiz.status === 'open' ? 'green' : 'gray'}
            />,
          ],
        ]}
      />
      {actions.manage ? (
        <div className="mb-6 grid gap-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={onEdit}>
              <Icon name="Pencil" size={15} aria-hidden="true" />
              Düzenle
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              aria-describedby={locked ? 'quiz-kilit-gerekce' : undefined}
              onClick={() => setArchiving(true)}
            >
              <Icon name="Archive" size={15} aria-hidden="true" />
              Arşivle
            </Button>
          </div>
          {locked ? (
            <p id="quiz-kilit-gerekce" className="text-sm text-muted-foreground">
              {QUIZ_LOCKED_REASON}
            </p>
          ) : null}
          <ArchiveQuizDialog
            quiz={quiz}
            open={archiving}
            onOpenChange={setArchiving}
            onArchived={onArchived}
          />
        </div>
      ) : null}
      {visible ? (
        <>
          <SummaryMetrics
            items={[
              {
                label: 'Sınıf ortalaması',
                value: statistics.average === null ? '—' : `%${statistics.average}`,
              },
              { label: 'Çözen öğrenci', value: `${statistics.scored} / ${roster.length}` },
              { label: 'Çözüyor', value: statistics.inProgress },
            ]}
          />
          <SummarySection title="Öğrenci sonuçları">
            {roster.length ? (
              <ul aria-label="Öğrenci quiz sonuçları" className="detail-list grid gap-2">
                {roster.map((student) => (
                  <li
                    key={student.id}
                    className="flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm"
                  >
                    <strong className="font-medium">{student.name}</strong>
                    <span className="text-right text-muted-foreground">
                      {attemptSummary(byStudent.get(student.id))}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Bu sınıfta aktif öğrenci yok.</p>
            )}
          </SummarySection>
        </>
      ) : (
        <p className="mb-6 text-sm text-muted-foreground">
          Quiz sonuçlarını yalnız quizin öğretmeni, sınıfın rehber öğretmeni ve yönetici görür.
        </p>
      )}
      <QuestionKey quiz={quiz} />
    </>
  )
}

/** Sorular ve cevap anahtarı: yalnız personel yanıtında gelir (DOM-AKD-078). */
function QuestionKey({ quiz }: { quiz: QuizStaffDetail }) {
  if (!quiz.questions)
    return (
      <SummarySection title="Sorular">
        <p className="text-sm text-muted-foreground">
          Quizin bazı soruları soru bankasında artık bulunmuyor.
        </p>
      </SummarySection>
    )
  const keyOf = new Map(quiz.answerKey.map((entry) => [entry.questionId, entry]))
  return (
    <SummarySection title="Sorular ve cevap anahtarı">
      <ol aria-label="Quiz soruları" className="grid gap-3">
        {quiz.questions.map((question, index) => {
          const key = keyOf.get(question.id)
          return (
            <li key={question.id} className="grid gap-1 rounded-xl border px-3.5 py-2.5 text-sm">
              <span className="font-medium [overflow-wrap:anywhere]">
                {index + 1}. {question.text}
              </span>
              <span className="text-muted-foreground">
                {question.topic}
                {key ? ` · Doğru: ${optionText(question.options, key.answer)}` : ''}
              </span>
            </li>
          )
        })}
      </ol>
    </SummarySection>
  )
}
