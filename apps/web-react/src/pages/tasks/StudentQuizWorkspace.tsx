import { useMemo, useState } from 'react'
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import { learnerAttemptsQuery } from '@kampus/react-shared/use-learner-task-progress.ts'
import { useTaskAssignment } from '@kampus/react-shared/use-task-assignments.ts'
import {
  useStartTaskAttempt,
  useTaskAttempt,
  useTaskAttempts,
} from '@kampus/react-shared/use-task-attempts.ts'
import { EmptyState } from '@/components/EmptyState.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useNow } from '@/hooks/use-now.ts'
import { useStableCallback } from '@/hooks/use-stable-callback.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { Facts } from '../learning/LearningParts.tsx'
import { AttemptPlayer } from './AttemptPlayer.tsx'
import { AttemptResult } from './AttemptResult.tsx'
import {
  autoProgress,
  isLearnerAssignment,
  isNotFoundError,
  runningAttempt,
  scoreLabel,
  shownAttempt,
  taskKindLabel,
  taskTypeLabel,
} from './student-task-model.ts'

export const QUIZ_PARAM = 'coz'

/**
 * Otomatik puanlı görev çalışma alanı (`?coz=<atama>`): süren deneme varsa çözme ekranı, yoksa
 * kurallar, hak ve sonuç. Düğme kararı sunucunun denemelerinden ve atamanın ayarlarından türer;
 * hak dolmuş ya da teslim kapanmışsa neden gösterilir (DOM-BEC-042, 044). Kapsam dışı ya da
 * olmayan görev "bulunamadı" görünümüdür.
 */
export function StudentQuizWorkspace({
  page,
  assignmentId,
}: {
  page: NavPage
  assignmentId: string
}) {
  useDocumentTitle(page.title)
  const workspace = useDetailPanel(QUIZ_PARAM)
  const assignmentQuery = useTaskAssignment(assignmentId)
  const attemptsQuery = useTaskAttempts(learnerAttemptsQuery(assignmentId))
  const start = useStartTaskAttempt()
  const [viewed, setViewed] = useState('')

  const assignment =
    assignmentQuery.data && isLearnerAssignment(assignmentQuery.data.data)
      ? assignmentQuery.data.data
      : undefined
  const attempts = useMemo(() => attemptsQuery.data?.data ?? [], [attemptsQuery.data])
  const running = runningAttempt(attempts)
  const finished = attempts.filter((attempt) => attempt.status !== 'in_progress')
  const result = viewed ? finished.find((attempt) => attempt.id === viewed) : shownAttempt(attempts)
  const detailId = running?.id ?? result?.id ?? ''
  const detail = useTaskAttempt(detailId)
  // Pencere kapanışı saate bağlıdır: yarım dakikada bir yeniden hesaplanır.
  const nowMs = useNow(true, 30_000)
  const progress = assignment ? autoProgress(assignment, attempts, new Date(nowMs)) : null
  // Sorgu sonucu nesneleri her render'da yenilenir; kimliği sabit işlev AttemptPlayer'ın süre dolum
  // zamanlayıcısının her saniye yeniden kurulmasını önler.
  const refreshExpired = useStableCallback(() => {
    void attemptsQuery.refetch()
    void detail.refetch()
  })

  const back = (
    <Button type="button" variant="secondary" onClick={workspace.close}>
      <Icon name="ArrowLeft" size={16} aria-hidden="true" />
      Listeye dön
    </Button>
  )
  const missing = isNotFoundError(assignmentQuery.error)
  const error = assignmentQuery.error ?? attemptsQuery.error
  if (error && !missing)
    return (
      <>
        <PageHeading title={page.title} actions={back} />
        <QueryError
          error={error}
          onRetry={() => {
            void assignmentQuery.refetch()
            void attemptsQuery.refetch()
          }}
        />
      </>
    )
  if (missing || (assignmentQuery.data && (!assignment || assignment.scoringMode !== 'auto')))
    return (
      <>
        <PageHeading title={page.title} actions={back} />
        <EmptyState
          title="Görev bulunamadı."
          description="Bu görev size atanmamış ya da deneme olarak çözülmüyor."
        />
      </>
    )
  if (!assignment || !progress)
    return (
      <>
        <PageHeading title={page.title} actions={back} />
        <p role="status" className="text-sm text-muted-foreground">
          Görev yükleniyor…
        </p>
      </>
    )

  const attempt = detail.data?.data
  async function begin() {
    await start.submit({ assignmentId })
  }

  return (
    <>
      <PageHeading
        title={assignment.title}
        description={`${taskTypeLabel(assignment)} · ${taskKindLabel(assignment)}`}
        actions={back}
      />
      {running ? (
        attempt && attempt.id === running.id ? (
          <AttemptPlayer
            key={attempt.id}
            title={assignment.title}
            attempt={attempt}
            fetchedAt={detail.dataUpdatedAt}
            onExpired={refreshExpired}
            onLeave={workspace.close}
          />
        ) : detail.error ? (
          <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            Deneme yükleniyor…
          </p>
        )
      ) : (
        <div className="grid gap-5">
          <section
            aria-labelledby="gorev-kurallari"
            className="panel rounded-card border bg-surface p-6 max-[650px]:p-4"
          >
            <h2 id="gorev-kurallari" className="mb-3 text-lg font-semibold">
              Görev bilgileri
            </h2>
            <Facts
              items={[
                ['Durum', <StatusBadge key="d" text={progress.status} tone={progress.tone} />],
                ['Deneme hakkı', progress.rights],
                [
                  'Süre sınırı',
                  assignment.timeLimitMinutes ? `${assignment.timeLimitMinutes} dk` : 'Yok',
                ],
                [
                  'Son teslim',
                  assignment.deadline.dueAt
                    ? `${dateLabel(assignment.deadline.dueAt, { year: 'numeric' })} ${timeLabel(assignment.deadline.dueAt)}`
                    : 'Belirtilmemiş',
                ],
                ['Puan', progress.score],
              ]}
            />
            {progress.canAct ? (
              <div className="grid gap-2">
                <Button
                  type="button"
                  className="justify-self-start"
                  disabled={start.isPending}
                  aria-busy={start.isPending}
                  onClick={() => void begin()}
                >
                  <Icon name="Play" size={16} aria-hidden="true" />
                  {attempts.length === 0 ? 'Denemeyi başlat' : 'Yeni deneme başlat'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {assignment.attempts.kind === 'evaluation'
                    ? 'Başlattığınızda bir deneme hakkınız kullanılır.'
                    : 'Alıştırma sınırsız denenebilir.'}
                  {assignment.timeLimitMinutes ? ' Süre başlar ve sunucu saatiyle işler.' : ''}
                </p>
              </div>
            ) : (
              <p role="status" className="text-sm text-muted-foreground">
                {progress.blockedReason ?? 'Yeni deneme başlatılamaz.'}
              </p>
            )}
          </section>

          {finished.length > 0 ? (
            <section
              aria-labelledby="deneme-gecmisi"
              className="panel rounded-card border bg-surface p-6 max-[650px]:p-4"
            >
              <h2 id="deneme-gecmisi" className="mb-3 text-lg font-semibold">
                Denemeleriniz
              </h2>
              <ul className="mb-5 flex flex-wrap gap-2">
                {[...finished]
                  .sort((a, b) => a.attemptNumber - b.attemptNumber)
                  .map((item) => (
                    <li key={item.id}>
                      <Button
                        type="button"
                        variant={item.id === result?.id ? 'default' : 'secondary'}
                        size="sm"
                        aria-pressed={item.id === result?.id}
                        onClick={() => setViewed(item.id)}
                      >
                        {item.attemptNumber}. deneme · {scoreLabel(item.result?.percent)}
                      </Button>
                    </li>
                  ))}
              </ul>
              {attempt && result && attempt.id === result.id ? (
                <AttemptResult attempt={attempt} title={assignment.title} />
              ) : detail.error ? (
                <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
              ) : (
                <p role="status" className="text-sm text-muted-foreground">
                  Sonuç yükleniyor…
                </p>
              )}
            </section>
          ) : null}
        </div>
      )}
    </>
  )
}
