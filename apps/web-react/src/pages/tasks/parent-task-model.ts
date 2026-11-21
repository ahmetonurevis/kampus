import type { LearnerTaskProgress } from '@kampus/react-shared/use-learner-task-progress.ts'
import type {
  TaskAssignment,
  TaskAssignmentLearner,
} from '@kampus/react-shared/use-task-assignments.ts'
import {
  isLearnerAssignment,
  studentTaskRow,
  summaryProgress,
  type StudentTaskRow,
} from './student-task-model.ts'

/**
 * Velinin beceri görevleri (OG-992; IST-051, DOM-YTK-028, DOM-BEC-045): atama listesi velide her
 * çocuğun durum özetini (`learnerIds`, `progress`) taşır; seçili çocuğa daraltma bu alanlarla
 * istemcide yapılır, kapsamı (yalnız velinin çocukları) sunucu uygular. Veli salt okurdur: düğme
 * kararı (`canAct`, engel metni) burada üretilmez, yalnız durum, hak ve açılmış puan gösterilir.
 */

/** Seçili çocuğa hedeflenen kursiyer görünümündeki atamalar. */
export function childAssignments(
  items: readonly TaskAssignment[],
  childId: string,
): TaskAssignmentLearner[] {
  return items
    .filter(isLearnerAssignment)
    .filter((item) => childId !== '' && item.learnerIds.includes(childId))
}

/** Çocuğun durum özeti; sunucu döndürmediyse `null`. */
export const childProgress = (
  assignment: TaskAssignmentLearner,
  childId: string,
): LearnerTaskProgress | null =>
  assignment.progress.find((entry) => entry.learnerId === childId) ?? null

/** Liste satırları: durum, hak ve açılmış puan çocuğun özetinden (satır başına istek yok). */
export function parentTaskRows(
  assignments: readonly TaskAssignmentLearner[],
  childId: string,
  now: Date,
): StudentTaskRow[] {
  return assignments.map((assignment) =>
    studentTaskRow(assignment, summaryProgress(assignment, now, childId)),
  )
}

/**
 * Panelde gösterilecek sonuç: tamamlanan deneme (otomatik puanlı), teslim (öğretmen puanlı) ya da
 * süren deneme notu. Süren deneme okunmaz (çocuğun cevapları değişebilir ve sonuç yoktur);
 * başlanmamış ya da yapılmamış görevde sonuç yoktur.
 */
export type ParentResult =
  | { kind: 'attempt'; attemptId: string }
  | { kind: 'submission'; submissionId: string }
  | { kind: 'running' }
  | { kind: 'none' }

export function parentResultOf(
  assignment: Pick<TaskAssignmentLearner, 'scoringMode'>,
  progress: LearnerTaskProgress | null,
): ParentResult {
  if (!progress) return { kind: 'none' }
  if (assignment.scoringMode === 'auto') {
    if (progress.status === 'in_progress') return { kind: 'running' }
    return progress.attemptId && (progress.status === 'submitted' || progress.status === 'late')
      ? { kind: 'attempt', attemptId: progress.attemptId }
      : { kind: 'none' }
  }
  return progress.submissionId && progress.used > 0
    ? { kind: 'submission', submissionId: progress.submissionId }
    : { kind: 'none' }
}
