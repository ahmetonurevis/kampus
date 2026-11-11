import { useMemo, useState } from 'react'
import {
  attemptOf,
  type QuizAttempt,
  type QuizListItem,
  type QuizQuestion,
} from '@kampus/react-shared/quizzes.ts'
import { useAllQuizzes, useQuiz, useStartQuiz } from '@kampus/react-shared/use-quizzes.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { CoreRecord } from '@/hooks/use-core-collection.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import {
  SummaryList,
  SummaryLoading,
  SummaryMetrics,
  SummarySection,
} from '../management/SummaryParts.tsx'
import { Facts, SummaryTitle, TableGate } from './LearningParts.tsx'
import { studentQuizRow, type StudentQuizRow } from './learning-rows.ts'
import {
  attemptPhase,
  canStartQuiz,
  QUIZ_PHASE_TEXT,
  quizDueText,
  quizReviewRows,
  type AttemptPhase,
} from './quiz-forms.ts'
import { QUIZ_RESULT_PARAM, useQuizNavigation } from './StudentQuizSolve.tsx'

type Student = CoreRecord<'students'>
/** Panelin quizden kullandığı alanlar (öğrenci ve veli ayrıntısı; anahtar yoktur). */
type QuizDetail = Pick<QuizListItem, 'id' | 'status' | 'duration' | 'questionCount'> & {
  questions: readonly QuizQuestion[] | null
}
/** `student`: kendi quizleri, başlatma ve çözmeyle; `parent`: seçili çocuğun sonuçları, salt okur. */
export type QuizViewMode = 'student' | 'parent'
type Props = { student: Student; title: string; mode: QuizViewMode }

const NONE: readonly never[] = []
const MOBILE_COLUMNS = ['subject', 'completion', 'score']

const PHASE_TONE = {
  none: 'amber',
  in_progress: 'purple',
  completed: 'green',
  expired: 'red',
} as const satisfies Record<AttemptPhase, BadgeTone>

const REVIEW_LOCKED_TEXT =
  'Konu bazında sonuç ve cevaplar quizin son tarihi geçince ya da quiz kapanınca açılır.'

/**
 * Seçili öğrencinin quizleri ve sonuçları (öğrencide kendisi, velide seçili çocuk; IST-095,
 * DOM-AKD-077…079): sınıfın quizleri `/quizzes` ucundan, deneme durumu ve puan sunucunun
 * cevaplardan hesapladığı sonuçtan (`attempts[].result`). İstemci puan hesaplamaz; cevap anahtarı
 * ve çözüm öğrenci ve veliye hiç gelmez. Öğrenci açık quizi panelden başlatır, devam eden denemeye
 * döner (`?quiz-coz=`); veli salt okur.
 */
export function StudentQuizzesView({ student, title, mode }: Props) {
  const quizzes = useAllQuizzes({ classId: student.classId })
  const rows = useMemo(
    () => quizzes.data?.map((item) => studentQuizRow(item, student.id)),
    [quizzes.data, student.id],
  )
  const nav = useQuizNavigation()
  const solve = nav.solve

  const panel = useDetailPanel(QUIZ_RESULT_PARAM)
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
      { key: 'dueDate', label: 'Son tarih', cell: (row) => quizDueText(row.dueDate) },
      {
        key: 'completion',
        label: 'Durum',
        cell: (row) => <StatusBadge text={row.completion} tone={PHASE_TONE[row.phase]} />,
      },
      {
        key: 'score',
        label: 'Puan',
        cell: (row) => (row.score === null ? '—' : <strong>%{row.score}</strong>),
      },
      {
        key: 'actions',
        label: 'İşlemler',
        cell: (row) =>
          mode === 'student' && row.phase === 'in_progress' ? (
            <Button
              size="sm"
              aria-label={`${row.title} quizine devam et`}
              onClick={() => solve(row.id)}
            >
              <Icon name="Play" size={15} aria-hidden="true" />
              Devam et
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              aria-label={`${row.title} sonucu`}
              onClick={() => openQuiz(row.id)}
            >
              <Icon name="Eye" size={15} aria-hidden="true" />
              {row.phase === 'completed' || row.phase === 'expired' ? 'Sonuç' : 'Ayrıntı'}
            </Button>
          ),
      },
    ],
    [openQuiz, solve, mode],
  )

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
          error={quizzes.error}
          onRetry={() => void quizzes.refetch()}
          loading={rows === undefined}
        >
          <DataTable
            listKey={mode === 'student' ? 'quizlerim' : 'cocuk-quizleri'}
            rows={rows ?? NONE}
            columns={columns}
            mobileColumns={MOBILE_COLUMNS}
            caption={title}
            searchKeys={['title', 'subject']}
            onRowClick={(row) => openQuiz(row.id)}
          />
        </TableGate>
      </section>
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Quiz sonucu"
      >
        {panel.selectedId ? (
          <QuizResultDetail
            key={panel.selectedId}
            quizId={panel.selectedId}
            studentId={student.id}
            mode={mode}
            onSolve={() => solve(panel.selectedId)}
          />
        ) : null}
      </SidePanel>
    </>
  )
}

type DetailProps = {
  quizId: string
  studentId: string
  mode: QuizViewMode
  onSolve: () => void
}

function QuizResultDetail({ quizId, studentId, mode, onSolve }: DetailProps) {
  // Tek kayıt ucu kapsamı uygular: kapsam dışı quiz 404 döner ve "bulunamadı" görünür.
  const item = useQuiz(quizId)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  const quiz = item.data?.data
  if (!quiz) return <SummaryLoading />
  const attempt = attemptOf(quiz, studentId)
  const phase = attemptPhase(attempt)
  return (
    <>
      <SummaryTitle
        icon="ListChecks"
        title={quiz.title}
        subtitle={`${quiz.subject} · ${quiz.questionCount} soru · ${quiz.duration} dk`}
      />
      <Facts
        items={[
          [
            'Durum',
            <StatusBadge key="durum" text={QUIZ_PHASE_TEXT[phase]} tone={PHASE_TONE[phase]} />,
          ],
          ['Son tarih', quizDueText(quiz.dueDate)],
          ['Süre', `${quiz.duration} dk`],
          ['Soru sayısı', quiz.questionCount],
        ]}
      />
      {attempt?.result ? (
        <AttemptResultView quiz={quiz} attempt={attempt} result={attempt.result} />
      ) : (
        <AttemptAction quiz={quiz} attempt={attempt} mode={mode} onSolve={onSolve} />
      )}
    </>
  )
}

/** Sonuçlanmamış deneme: öğrencide başlat/devam et, velide durum metni. */
function AttemptAction({
  quiz,
  attempt,
  mode,
  onSolve,
}: {
  quiz: QuizDetail
  attempt: QuizAttempt | undefined
  mode: QuizViewMode
  onSolve: () => void
}) {
  if (attempt?.status === 'in_progress')
    return mode === 'student' ? (
      <div className="grid justify-items-start gap-3">
        <p className="text-sm text-muted-foreground">
          Bu quizi çözmeye başladın; süre sunucu saatiyle işliyor.
        </p>
        <Button type="button" onClick={onSolve}>
          <Icon name="Play" size={16} aria-hidden="true" />
          Quize devam et
        </Button>
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">
        Bu quiz şu an çözülüyor; sonuç cevaplar gönderilince görünür.
      </p>
    )
  if (mode === 'parent')
    return <p className="text-sm text-muted-foreground">Bu quiz henüz çözülmedi.</p>
  if (!canStartQuiz(quiz, attempt))
    return (
      <p className="text-sm text-muted-foreground">
        Bu quizin son tarihi geçti; quiz artık başlatılamaz.
      </p>
    )
  return <StartQuiz quiz={quiz} onStarted={onSolve} />
}

function StartQuiz({ quiz, onStarted }: { quiz: QuizDetail; onStarted: () => void }) {
  const start = useStartQuiz()
  const [confirming, setConfirming] = useState(false)
  async function begin() {
    const outcome = await start.submit({ quizId: quiz.id })
    if (outcome.status === 'busy') return
    setConfirming(false)
    if (outcome.status === 'success') onStarted()
  }
  return (
    <div className="grid justify-items-start gap-3">
      <p className="text-sm text-muted-foreground">
        Quizi başlattığında {quiz.duration} dakikalık süre başlar ve durdurulamaz. Her quiz bir kez
        çözülür.
      </p>
      <Button type="button" onClick={() => setConfirming(true)}>
        <Icon name="Play" size={16} aria-hidden="true" />
        Quizi başlat
      </Button>
      <AlertDialog
        open={confirming}
        onOpenChange={(open) => (start.isPending ? undefined : setConfirming(open))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quiz başlatılsın mı?</AlertDialogTitle>
            <AlertDialogDescription>
              {quiz.questionCount} soru, {quiz.duration} dakika. Süre başlatınca işler; ekranı
              kapatsan da durmaz. Quiz yalnız bir kez çözülebilir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={start.isPending}>Vazgeç</AlertDialogCancel>
            <AlertDialogAction
              disabled={start.isPending}
              aria-busy={start.isPending || undefined}
              onClick={(event) => {
                event.preventDefault()
                void begin()
              }}
            >
              Başlat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/**
 * Sonuç (DOM-AKD-078): puan ve doğru sayısı her zaman; kendi cevapları ve konu yüzdeleri yalnız
 * inceleme açılınca (sunucu `answers` ve `topicScores` alanlarını o zaman gönderir). Doğru şık,
 * soru bazında doğru/yanlış ve çözüm hiç gösterilmez.
 */
function AttemptResultView({
  quiz,
  attempt,
  result,
}: {
  quiz: QuizDetail
  attempt: QuizAttempt
  result: NonNullable<QuizAttempt['result']>
}) {
  const answers = attempt.answers
  const reviewed = answers !== undefined
  const submittedAt = attempt.submittedAt ?? attempt.expiresAt
  return (
    <>
      <SummaryMetrics
        items={[
          { label: 'Puan', value: `%${result.score}` },
          { label: 'Doğru / soru', value: `${result.correctCount} / ${result.total}` },
        ]}
      />
      {attempt.status === 'expired' ? (
        <p className="mb-4 text-sm text-muted-foreground">
          Cevaplar süresinde gönderilmediği için deneme boş cevaplı sayıldı.
        </p>
      ) : null}
      {submittedAt ? (
        <p className="mb-6 text-sm text-muted-foreground">
          {attempt.status === 'expired' ? 'Süre bitişi' : 'Gönderilme tarihi'}:{' '}
          {dateLabel(submittedAt, { year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </p>
      ) : null}
      {reviewed ? (
        <>
          <SummarySection title="Konu bazında başarı">
            <SummaryList
              empty="Konu bazında sonuç yok."
              items={(result.topicScores ?? []).map((topic) => ({
                key: topic.topic,
                label: topic.topic,
                value: `%${topic.score}`,
              }))}
            />
          </SummarySection>
          <SummarySection title="Cevaplar">
            {quiz.questions ? (
              <ol aria-label="Quiz cevapları" className="grid gap-3">
                {quizReviewRows(quiz.questions, answers).map((row, index) => (
                  <li key={row.id} className="grid gap-1 rounded-xl border px-3.5 py-2.5 text-sm">
                    <span className="font-medium [overflow-wrap:anywhere]">
                      {index + 1}. {row.text}
                    </span>
                    <span className="text-muted-foreground">
                      {row.topic} · Verilen cevap: {row.chosen ?? 'Boş bırakıldı'}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">
                Quizin bazı soruları soru bankasında artık bulunmuyor.
              </p>
            )}
          </SummarySection>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{REVIEW_LOCKED_TEXT}</p>
      )}
    </>
  )
}
