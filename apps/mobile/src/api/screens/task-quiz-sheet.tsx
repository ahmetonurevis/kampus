import { useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import { isApiError } from '@kampus/api-client/errors.ts'
import {
  autoProgress,
  isLearnerAssignment,
  isNotFoundError,
  runningAttempt,
  scoreLabel,
  shownAttempt,
  taskKindLabel,
} from '@kampus/react-shared/student-task-model.ts'
import { dateTimeLabel, taskTypeLabel } from '@kampus/react-shared/task-labels.ts'
import { learnerAttemptsQuery } from '@kampus/react-shared/use-learner-task-progress.ts'
import {
  TASK_CONTENT_UNAVAILABLE_MESSAGE,
  useTaskAssignment,
} from '@kampus/react-shared/use-task-assignments.ts'
import {
  TASK_ATTEMPT_MESSAGES,
  useStartTaskAttempt,
  useTaskAttempt,
  useTaskAttempts,
} from '@kampus/react-shared/use-task-attempts.ts'
import { Badge, Button, Sheet, T } from '../../ui/components.tsx'
import { DetailPair, Notice, Section } from '../../ui/SchoolLayout.tsx'
import { useNow } from '../../ui/use-now.ts'
import { commandFailure } from '../command-failure.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import { START_TEXTS, quizTaskAccess, solveGate, startDescription } from '../student-quiz-task.ts'
import { mobileTone } from '../student-writing.ts'
import { FooterHost, useFooterSlot } from './footer-slot.tsx'
import { TaskAttemptResult } from './task-attempt-result.tsx'
import { TaskAttemptSolve } from './task-attempt-solve.tsx'

/**
 * Otomatik puanlı görev penceresi (web `StudentQuizWorkspace`; IST-051, IST-124): ayrıntı, onaylı
 * başlatma, çözme, teslim ve sonuç tek `Sheet`'te yalnız içerik değiştirerek akar (iOS'ta bir Modal
 * kapanıp başkası açılınca ikincisi görünmeyebilir). Kapsam ve hak kararı sunucudadır; durum ve
 * kurallar `autoProgress` ile web'le ortaktır. Dinleme kaydı içerebilecek görev telefonda başlatılmaz
 * (Sabah kararı 92); süren deneme dinleme kaydı taşıyorsa çözme açılmaz. Cevaplar yalnız bellekte
 * ve sunucudadır.
 */
export function TaskQuizSheet({
  assignmentId,
  onClose,
}: {
  assignmentId: string
  onClose: () => void
}) {
  const assignmentQuery = useTaskAssignment(assignmentId)
  const attemptsQuery = useTaskAttempts(learnerAttemptsQuery(assignmentId))
  const start = useStartTaskAttempt()
  const slot = useFooterSlot()
  const closeRef = useRef<(() => void) | null>(null)
  const now = useNow(30_000)
  const [viewed, setViewed] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const assignment =
    assignmentQuery.data && isLearnerAssignment(assignmentQuery.data.data)
      ? assignmentQuery.data.data
      : undefined
  const attempts = useMemo(() => attemptsQuery.data?.data ?? [], [attemptsQuery.data])
  const running = runningAttempt(attempts)
  const finished = attempts.filter((item) => item.status !== 'in_progress')
  const result = viewed ? finished.find((item) => item.id === viewed) : shownAttempt(attempts)
  const progress = assignment ? autoProgress(assignment, attempts, now) : null
  const access = assignment ? quizTaskAccess(assignment) : null
  // Kapalı içerikteki süren deneme açılmaz: ayrıntısı da istenmez.
  const runningBlocked = !!running && (progress?.canAct === false || access?.open === false)
  const detailId = runningBlocked ? '' : (running?.id ?? result?.id ?? '')
  const detail = useTaskAttempt(detailId)
  const attempt = detail.data?.data
  const gate = running && attempt && attempt.id === running.id ? solveGate(attempt) : null
  const solving = gate?.kind === 'solve'

  const missing = isNotFoundError(assignmentQuery.error)
  // Teslim listesi `useQuery` ile okunur (hata tipi genel); istek katmanı yalnız `ApiError` fırlatır.
  const error = [assignmentQuery.error, attemptsQuery.error].find(isApiError) ?? null

  function refresh() {
    void attemptsQuery.refetch()
    void detail.refetch()
  }

  async function begin() {
    if (start.isPending) return
    setFailure(null)
    const outcome = await start.submit({ assignmentId }, { silent: () => true })
    if (outcome.status === 'busy') return
    setConfirming(false)
    if (outcome.status === 'failed')
      setFailure(
        commandFailure(outcome.error, TASK_ATTEMPT_MESSAGES).message ?? outcome.error.message,
      )
  }

  function requestClose() {
    if (solving && closeRef.current) return closeRef.current()
    onClose()
  }

  const body = () => {
    if (missing || (assignmentQuery.data && (!assignment || assignment.scoringMode !== 'auto')))
      return (
        <Notice
          tone="amber"
          title="Görev bulunamadı."
          text="Bu görev sana atanmamış ya da deneme olarak çözülmüyor."
        />
      )
    if (error)
      return (
        <QueryError
          error={error}
          onRetry={() => {
            void assignmentQuery.refetch()
            void attemptsQuery.refetch()
          }}
        />
      )
    if (!assignment || !progress || !access || !attemptsQuery.data)
      return <ListLoading label="Görev yükleniyor…" />

    if (running) {
      if (runningBlocked)
        return (
          <Notice
            tone="amber"
            title="Deneme sürdürülemiyor"
            text={
              progress.blockedReason ??
              (access.open ? TASK_CONTENT_UNAVAILABLE_MESSAGE : access.text)
            }
          />
        )
      if (detail.error && !attempt)
        return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
      if (!attempt || attempt.id !== running.id) return <ListLoading label="Deneme yükleniyor…" />
      if (gate?.kind === 'blocked')
        return <Notice tone="amber" title="Deneme açılamıyor" text={gate.text} />
      if (gate?.kind === 'solve')
        return (
          <TaskAttemptSolve
            key={attempt.id}
            assignment={assignment}
            attempt={attempt}
            fetchedAt={detail.dataUpdatedAt}
            slot={slot}
            closeRef={closeRef}
            onRefresh={refresh}
            onLeave={onClose}
          />
        )
      return <ListLoading label="Sonuç yükleniyor…" />
    }

    return (
      <>
        <Badge text={progress.status} tone={mobileTone(progress.tone)} />
        <Section title="Görev bilgileri" panel>
          <View style={{ gap: 12 }}>
            <DetailPair
              label="Tür"
              value={`${taskTypeLabel(assignment)} · ${taskKindLabel(assignment)}`}
            />
            <DetailPair label="Deneme hakkı" value={progress.rights} />
            <DetailPair
              label="Süre sınırı"
              value={assignment.timeLimitMinutes ? `${assignment.timeLimitMinutes} dk` : 'Yok'}
            />
            <DetailPair
              label="Son teslim"
              value={
                assignment.deadline.dueAt
                  ? dateTimeLabel(assignment.deadline.dueAt)
                  : 'Belirtilmemiş'
              }
            />
            <DetailPair label="Puan" value={progress.score} />
          </View>
        </Section>
        {!!failure && <Notice tone="red" title="Deneme başlatılamadı" text={failure} />}
        {!access.open ? (
          <Notice tone="amber" title="Telefonda açılmaz" text={access.text} />
        ) : progress.canAct ? (
          confirming ? (
            <Notice title={START_TEXTS.title} text={startDescription(assignment)}>
              <Button
                accent
                icon="Play"
                disabled={start.isPending}
                label={start.isPending ? 'Deneme başlatılıyor' : START_TEXTS.confirm}
                onPress={() => void begin()}
              >
                {start.isPending ? 'Başlatılıyor…' : START_TEXTS.confirm}
              </Button>
              <Button disabled={start.isPending} onPress={() => setConfirming(false)}>
                {START_TEXTS.cancel}
              </Button>
            </Notice>
          ) : (
            <Button accent icon="Play" onPress={() => setConfirming(true)}>
              {attempts.length === 0 ? 'Denemeyi başlat' : 'Yeni deneme başlat'}
            </Button>
          )
        ) : (
          <T muted size={14}>
            {progress.blockedReason ?? 'Yeni deneme başlatılamaz.'}
          </T>
        )}
        {finished.length > 0 && (
          <>
            <Section title="Denemelerin" panel>
              <View style={{ gap: 8 }}>
                {[...finished]
                  .sort((a, b) => a.attemptNumber - b.attemptNumber)
                  .map((item) => (
                    <Button
                      key={item.id}
                      primary={item.id === result?.id}
                      label={`${item.attemptNumber}. deneme, ${scoreLabel(item.result?.percent)}`}
                      onPress={() => setViewed(item.id)}
                    >
                      {item.attemptNumber}. deneme · {scoreLabel(item.result?.percent)}
                    </Button>
                  ))}
              </View>
            </Section>
            {attempt && result && attempt.id === result.id ? (
              <TaskAttemptResult attempt={attempt} />
            ) : detail.error ? (
              <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
            ) : (
              <ListLoading label="Sonuç yükleniyor…" />
            )}
          </>
        )}
      </>
    )
  }

  return (
    <Sheet
      visible
      title={assignment?.title ?? 'Görev'}
      onClose={requestClose}
      footer={solving ? <FooterHost slot={slot} /> : undefined}
      pinFooter={solving}
    >
      {body()}
    </Sheet>
  )
}
