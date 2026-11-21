import type { TaskAttempt } from '@kampus/react-shared/use-task-attempts.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

/**
 * Öğrencinin görev ekranlarının saf modeli (IST-051; DOM-BEC-040…046). Durum, hak ve düğme
 * kararları sunucunun döndürdüğü kayıtlardan (deneme, teslim, `allowance`) türetilir; saklanmaz.
 * Puan ve geri bildirim yalnız sunucu açtıysa (`result`, `score` dolu) gösterilir: açılmamış
 * puana dair hiçbir ifade üretilmez (DOM-BEC-045). Burada yalnız deneme çözme ve sonuç gösterimi
 * kalır; liste, yazma durumu ve yönerge react-shared'dedir.
 */

// Görev listesi, yazma durumu ve yönerge web ve mobil için ortaktır; gerçek tanım
// `@kampus/react-shared/student-task-model.ts`'tedir (davranış değişmeden taşındı, IST-124).
export {
  autoProgress,
  blockedByMessage,
  FAILED,
  isLearnerAssignment,
  isNotFoundError,
  LAPSED_REASON,
  type LearnerAttribution,
  releasedScore,
  responseLabel,
  resubmissionPending,
  type ResultAudience,
  runningAttempt,
  scoreLabel,
  shownAttempt,
  type StudentTaskMode,
  type StudentTaskRow,
  studentTaskRow,
  submittedTextLabel,
  summaryBlockedReason,
  summaryProgress,
  taskClosed,
  taskKindLabel,
  type TaskProgress,
  type TaskTone,
  versionLimit,
  type WritingBrief,
  writingBrief,
  writingInitialBody,
  writingProgress,
} from '@kampus/react-shared/student-task-model.ts'
export { isSpeakingTask, taskTypeLabel } from '@kampus/react-shared/task-labels.ts'

// Deneme çözme ve sonuç gösteriminin saf modeli web ve mobil için ortaktır (`attempt-model.ts`).
export {
  acceptedText,
  answeredCount,
  answersFingerprint,
  type AttemptQuestion,
  attemptClock,
  attemptContentNote,
  attemptResultHeading,
  describeKey,
  describeResponse,
  formatPoints,
  formatRemaining,
  isAnswered,
  itemOutcome,
  newerRowVersion,
  splitGapStem,
  type StemPart,
  TASK_CONTENT_REMOVED_MESSAGE,
} from '@kampus/react-shared/attempt-model.ts'

/** Personelin deneme listesindeki durum (DOM-BEC-042, 043): süren, teslim, süre dolunca teslim. */
export function attemptStatusBadge(
  attempt: Pick<TaskAttempt, 'status' | 'late' | 'autoSubmitted'>,
): { label: string; tone: BadgeTone } {
  if (attempt.status === 'in_progress') return { label: 'Sürüyor', tone: 'amber' }
  if (attempt.late) return { label: 'Geç teslim', tone: 'red' }
  if (attempt.status === 'expired' || attempt.autoSubmitted)
    return { label: 'Süre dolunca teslim', tone: 'gray' }
  return { label: 'Teslim edildi', tone: 'purple' }
}
