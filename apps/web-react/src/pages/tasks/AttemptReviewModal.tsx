import { useTaskAssignment } from '@kampus/react-shared/use-task-assignments.ts'
import { useTaskAttempt } from '@kampus/react-shared/use-task-attempts.ts'
import { EmptyState } from '@/components/EmptyState.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { SummaryMetrics } from '../management/SummaryParts.tsx'
import { AttemptResult } from './AttemptResult.tsx'
import { ListeningRecording } from './ListeningRecording.tsx'
import { ReadingPassage } from './ReadingPassage.tsx'
import { attemptStatusBadge, isNotFoundError } from './student-task-model.ts'
import { dateTimeLabel, learnerLabel } from './task-model.ts'

/** Deneme ayrıntısının adres parametresi (`?deneme=<deneme kimliği>`). */
export const ATTEMPT_PARAM = 'deneme'

type Props = {
  /** `''` kapalı; aksi hâlde incelenen denemenin kimliği. */
  attemptId: string
  onClose: () => void
}

/**
 * Personelin deneme görünümü (OG-983; DOM-BEC-006, DOM-BEC-045; DOM-YTK-028): geniş pencere,
 * adreste `?deneme=`. Okuma parçası, öğrencinin cevapları, madde sonuçları ve alt beceri dökümü
 * kursiyerin sonuç ekranıyla aynı bileşenlerdir (`ReadingPassage`, `AttemptResult`,
 * `SubskillBreakdown`); yalnız sunucunun açtığı alanlar çizilir. Süren denemede sonuç yoktur.
 * Dinleme kaydı (IST-045, DOM-BEC-005) personele her zaman dökümüyle açılır; bağlantısı sayılmaz.
 * Kapsam dışı, olmayan ya da başka kurumun denemesi 404 verir ve "Deneme bulunamadı" görünür.
 */
export function AttemptReviewModal({ attemptId, onClose }: Props) {
  return (
    <Modal
      open={attemptId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Deneme ayrıntısı"
      size="wide"
    >
      {attemptId ? <ReviewBody attemptId={attemptId} /> : null}
    </Modal>
  )
}

function ReviewBody({ attemptId }: { attemptId: string }) {
  const detail = useTaskAttempt(attemptId)
  const attempt = detail.data?.data
  const assignmentQuery = useTaskAssignment(attempt?.assignmentId ?? '')

  if (isNotFoundError(detail.error))
    return (
      <EmptyState
        title="Deneme bulunamadı."
        description="Bu deneme yok ya da görebileceğiniz sınıflardan birine ait değil."
      />
    )
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  if (!attempt)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Deneme yükleniyor…
      </p>
    )

  const learner = learnerLabel(attempt)
  const title = assignmentQuery.data?.data.title ?? ''
  const status = attemptStatusBadge(attempt)
  return (
    <div className="grid gap-6">
      <SummaryMetrics
        items={[
          { label: 'Öğrenci', value: learner },
          {
            label: 'Durum',
            value: <StatusBadge text={status.label} tone={status.tone} />,
          },
          { label: 'Başlangıç', value: dateTimeLabel(attempt.startedAt) },
          { label: 'Teslim', value: dateTimeLabel(attempt.completedAt) },
        ]}
      />
      {attempt.passage ? <ReadingPassage passage={attempt.passage} /> : null}
      {attempt.listeningRecording && !attempt.contentRemoved ? (
        <ListeningRecording
          recording={attempt.listeningRecording}
          listening={attempt.listening}
          mode="review"
          audience="staff"
        />
      ) : null}
      {attempt.status === 'in_progress' ? (
        <p role="status" className="text-sm text-muted-foreground">
          Deneme sürüyor; cevaplar ve sonuç teslimden sonra görünür.
        </p>
      ) : (
        <AttemptResult
          attempt={attempt}
          title={title ? `${learner} · ${title}` : learner}
          audience="staff"
        />
      )}
    </div>
  )
}
