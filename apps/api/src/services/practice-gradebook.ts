import {
  practiceGradebook,
  practiceShownAttempt,
  type PracticeResult,
} from '@kampus/school-core/skills/practice.ts'
import type { ContentUnit, ResourceContent } from '@kampus/school-core/content/resource.ts'

import { loadAssignmentsAttempts, loadAttemptsAmong, type StoredAttempt } from '../db/skills.ts'
import { ForbiddenError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { contentRemoved } from './learner-content.ts'
import { completedOf } from './task-attempts.ts'
import { loadTaskAssignmentPage } from './task-assignments.ts'
import { loadLearnerNames } from './task-learner-names.ts'
import { loadWorkPairs, scoringContexts, workPairsOf } from './task-work.ts'

/**
 * Alıştırma not defteri (OG-085, IST-056; docs/domain/beceri-gelisimi.md DOM-BEC-048). Kişinin
 * gördüğü arşivsiz, otomatik puanlı alıştırma atamalarından (atama listesinin rol kapsamı;
 * DOM-YTK-028; tür, puanlama kipi ve hedef süzgeci sorgudadır) kursiyer başına son tamamlanan
 * deneme alınır; ünite, beceri ve kazanım kırılımı core `practiceGradebook` ile her okumada
 * hesaplanır, saklanmaz. Veli göremez (DOM-BEC-041): rota 403 verir, servis de reddeder. İçeriği
 * kaldırılmış ya da puanlama bağlamı kurulamayan atama girmez (DOM-KYN-051). Süzülmüş kümenin en
 * yeni `GRADEBOOK_ASSIGNMENT_LIMIT` ataması okunur; fazlası `truncated` ile söylenir.
 */

export const GRADEBOOK_ASSIGNMENT_LIMIT = 100

export interface PracticeGradebookInput {
  /** Hedef süzgeci: sınıf/şube, dil grubu ya da öğrenci hedefi kimliği. */
  targetId?: string | undefined
}

function unitOf(content: ResourceContent | null | undefined): ContentUnit | null {
  return content?.type === 'quiz' || content?.type === 'exercise_set' ? content.unit : null
}

export async function getPracticeGradebook(ctx: ServiceContext, input: PracticeGradebookInput) {
  const { viewer, rows, refs, total } = await loadTaskAssignmentPage(ctx, {
    page: 1,
    pageSize: GRADEBOOK_ASSIGNMENT_LIMIT,
    kind: 'practice',
    scoringMode: 'auto',
    targetId: input.targetId,
  })
  if (viewer.kind === 'learner' && viewer.role === 'veli') throw new ForbiddenError()
  const assignments = rows
  const pairs = await loadWorkPairs(ctx.db, ctx.institutionId, assignments)
  const contexts = scoringContexts(assignments, pairs)
  const ids = assignments.map((row) => row.id)
  const attempts =
    viewer.kind === 'learner'
      ? await loadAttemptsAmong(ctx.db, ctx.institutionId, ids, [...viewer.classOf.keys()])
      : await loadAssignmentsAttempts(ctx.db, ctx.institutionId, ids)
  const byAssignment = new Map<string, Map<string, StoredAttempt[]>>()
  for (const attempt of attempts) {
    const learners = byAssignment.get(attempt.assignmentId) ?? new Map<string, StoredAttempt[]>()
    learners.set(attempt.learnerId, [...(learners.get(attempt.learnerId) ?? []), attempt])
    byAssignment.set(attempt.assignmentId, learners)
  }
  const now = ctx.now.toISOString()
  const results: PracticeResult[] = []
  const shownAssignments = []
  for (const assignment of assignments) {
    const context = contexts.get(assignment.id)
    if (context === undefined || context instanceof Error) continue
    if (contentRemoved(workPairsOf(assignment, pairs))) continue
    const unit = unitOf(pairs.get(assignment.scoringVersionId)?.version.content)
    let completedLearners = 0
    for (const [learnerId, own] of byAssignment.get(assignment.id) ?? []) {
      const shown = practiceShownAttempt(completedOf(assignment, context, own, now))
      if (shown === null) continue
      completedLearners += 1
      results.push({
        learnerId,
        assignmentId: assignment.id,
        unit,
        items: context.items,
        score: shown.score,
      })
    }
    shownAssignments.push({
      id: assignment.id,
      title: refs.get(assignment.resourceVersionId)?.title ?? '',
      unit,
      learners: completedLearners,
    })
  }
  const book = practiceGradebook(results)
  const names = await loadLearnerNames(
    ctx,
    viewer,
    book.learners.map((learner) => learner.learnerId),
  )
  return {
    assignments: shownAssignments,
    learners: book.learners.map((learner) => ({
      ...learner,
      learnerName: names.get(learner.learnerId) ?? null,
    })),
    totals: book.totals,
    truncated: total > GRADEBOOK_ASSIGNMENT_LIMIT,
  }
}
