import {
  tallyOutcomes,
  type LearnerOutcome,
  type ResultTally,
} from '@kampus/school-core/skills/content-results.ts'
import { practiceShownAttempt } from '@kampus/school-core/skills/practice.ts'

import { findResource } from '../db/resources.ts'
import {
  loadAssignmentsAttempts,
  loadSubmissionsAmong,
  type StoredAssignment,
  type StoredAttempt,
  type StoredSubmissionWork,
} from '../db/skills.ts'
import { ForbiddenError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { readSource } from './read-scope.ts'
import { loadTaskAssignmentPage, staffAssignmentView } from './task-assignments.ts'
import { attemptScoring, completedOf, countedAttemptResult } from './task-attempts.ts'
import { loadGrading, settledSubmissionResult } from './task-submissions.ts'
import { loadWorkPairs } from './task-work.ts'

/**
 * İçeriğe bağlı sonuç özeti (DOM-BEC-036, IST-034): bir içeriğin kişinin gördüğü atamalarında hedef
 * başına kursiyer, tamamlayan ve puan ortalaması. Her okumada hesaplanır, saklanmaz (core
 * `tallyOutcomes`). Puan deneme ve teslim uçlarının kurallarıyla çıkar: değerlendirmede sayılan
 * deneme (`countedAttemptResult`), alıştırmada son tamamlanan deneme (`practiceShownAttempt`),
 * öğretmen puanlıda kesinleşmiş puanı olan son sürüm (`settledSubmissionResult`). Tamamlandı:
 * tamamlanmış deneme ya da gönderilmiş teslim sürümü.
 *
 * Kapsam (DOM-YTK-028): yalnız personel (yönetici ve öğretmen; öğrenci ve veli 403). Atamalar atama
 * listesinin rol kapsamıyla gelir; atayan olmayan öğretmen yalnız kendi kapsamındaki hedefleri
 * (ders verdiği ya da rehberi olduğu sınıf ve öğrencileri) görür. Sınıf hedefinin kursiyerleri
 * sınıfın güncel öğrencileridir. Olmayan ya da başka kurumun içeriği 404. En yeni
 * `RESULTS_ASSIGNMENT_LIMIT` atama okunur; fazlası `truncated`. Kişisel veri ve başlık loglanmaz.
 */

export const RESULTS_ASSIGNMENT_LIMIT = 100

type Target = StoredAssignment['targets'][number]

function attemptsByKey(attempts: readonly StoredAttempt[]) {
  const byKey = new Map<string, StoredAttempt[]>()
  for (const attempt of attempts) {
    const key = `${attempt.assignmentId}:${attempt.learnerId}`
    byKey.set(key, [...(byKey.get(key) ?? []), attempt])
  }
  return byKey
}

export async function getContentAssignmentResults(ctx: ServiceContext, resourceId: string) {
  const resource = await findResource(ctx.db, ctx.institutionId, resourceId)
  if (!resource) throw new NotFoundError()
  const { viewer, rows, refs, total } = await loadTaskAssignmentPage(ctx, {
    page: 1,
    pageSize: RESULTS_ASSIGNMENT_LIMIT,
    resourceId,
  })
  if (viewer.kind === 'learner') throw new ForbiddenError()

  const source = await readSource(ctx)
  const studentsOf = new Map<string, string[]>()
  for (const student of source.students)
    studentsOf.set(student.classId, [...(studentsOf.get(student.classId) ?? []), student.id])
  const learnersOf = (target: Target) =>
    target.kind === 'student' ? [target.id] : (studentsOf.get(target.id) ?? [])

  // Atayan olmayan öğretmen kapsam dışı hedefi görmez (personel görünümünün süzgeci).
  const shown = rows.map((assignment) => ({
    assignment,
    view: staffAssignmentView(ctx, viewer, assignment, refs),
  }))
  const auto = rows.filter((row) => row.scoringMode === 'auto')
  const written = rows.filter((row) => row.scoringMode === 'teacher')
  const learnerIds = [
    ...new Set(shown.flatMap(({ view }) => view.targets.flatMap((t) => learnersOf(t)))),
  ]
  const [attempts, submissions, pairs] = await Promise.all([
    loadAssignmentsAttempts(
      ctx.db,
      ctx.institutionId,
      auto.map((row) => row.id),
    ),
    loadSubmissionsAmong(
      ctx.db,
      ctx.institutionId,
      written.map((row) => row.id),
      learnerIds,
    ),
    loadWorkPairs(ctx.db, ctx.institutionId, rows),
  ])
  const book = await loadGrading(
    ctx.db,
    ctx,
    submissions.map((work) => work.submission.id),
  )
  const attemptsOf = attemptsByKey(attempts)
  const workOf = new Map<string, StoredSubmissionWork>(
    submissions.map((work) => [
      `${work.submission.assignmentId}:${work.submission.learnerId}`,
      work,
    ]),
  )
  const now = ctx.now.toISOString()

  type Context = ReturnType<typeof attemptScoring>['context']
  const contexts = new Map<string, Context>()
  /** Atamanın puanlama bağlamı, atama başına bir kez; kaldırılmış içerikte `null`. */
  const scoringOf = (assignment: StoredAssignment): Context => {
    if (contexts.has(assignment.id)) return contexts.get(assignment.id) ?? null
    let context: Context = null
    try {
      context = attemptScoring(assignment, pairs).context
    } catch (error) {
      // Bağlam veri bütünlüğü sorunuyla kurulamadı: puan yok, özet yine döner.
      ctx.log.warn({
        event: 'content_results.scoring_unavailable',
        assignmentId: assignment.id,
        cause: error instanceof Error ? error.name : 'unknown',
      })
    }
    contexts.set(assignment.id, context)
    return context
  }

  const outcomeOf = (assignment: StoredAssignment, learnerId: string): LearnerOutcome => {
    const key = `${assignment.id}:${learnerId}`
    if (assignment.scoringMode === 'teacher') {
      const work = workOf.get(key)
      if (work === undefined) return { learnerId, completed: false, percent: null }
      const settled = settledSubmissionResult(ctx, viewer, book, work)
      return { learnerId, completed: work.versions.length > 0, percent: settled?.percent ?? null }
    }
    const own = attemptsOf.get(key) ?? []
    const context = scoringOf(assignment)
    if (context === null)
      return { learnerId, completed: own.some((a) => a.submittedAt !== null), percent: null }
    const completed = completedOf(assignment, context, own, now)
    const percent =
      assignment.kind === 'evaluation'
        ? (countedAttemptResult(assignment, context, own, ctx.now)?.percent ?? null)
        : (practiceShownAttempt(completed)?.score.percent ?? null)
    return { learnerId, completed: completed.length > 0, percent }
  }

  const all: LearnerOutcome[] = []
  const assignments = shown.map(({ assignment, view }) => {
    const outcomes: LearnerOutcome[] = []
    const targets = view.targets.map((target) => {
      const rows = learnersOf(target).map((learnerId) => outcomeOf(assignment, learnerId))
      outcomes.push(...rows)
      return { kind: target.kind, id: target.id, ...tallyOutcomes(rows) }
    })
    // Bütün içerik toplamında aynı kursiyer farklı atamalarda ayrı sonuçtur.
    all.push(...outcomes.map((row) => ({ ...row, learnerId: `${assignment.id}:${row.learnerId}` })))
    return {
      assignmentId: assignment.id,
      title: view.title,
      kind: assignment.kind,
      scoringMode: assignment.scoringMode,
      deadline: assignment.deadline,
      createdAt: assignment.createdAt,
      targets,
      totals: tallyOutcomes(outcomes) satisfies ResultTally,
    }
  })
  return {
    resourceId,
    computedAt: now,
    assignments,
    totals: tallyOutcomes(all),
    truncated: total > RESULTS_ASSIGNMENT_LIMIT,
  }
}
