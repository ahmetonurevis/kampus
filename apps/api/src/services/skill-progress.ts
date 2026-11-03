import { skillProgress, type SkillResult } from '@kampus/school-core/skills/progress.ts'

import { loadRecordsByIds } from '../db/records.ts'
import {
  loadAssignmentsByIds,
  loadLearnerAttempts,
  loadLearnerSubmissions,
  type StoredAssignment,
  type StoredAttempt,
} from '../db/skills.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { teacherReaches as groupReaches } from './cefr.ts'
import { contentRemoved } from './learner-content.ts'
import { viewerOf, type Viewer } from './task-assignments.ts'
import { attemptScoring, countedAttemptResult } from './task-attempts.ts'
import { loadGrading, settledSubmissionResult } from './task-submissions.ts'
import { canReadLearner, loadWorkPairs, workPairsOf, type WorkPairs } from './task-work.ts'

/**
 * Beceri ilerleme panosu (OG-080; IST-057; docs/domain/beceri-gelisimi.md DOM-BEC-035). Kural core
 * `skills/progress.ts`'tedir; burada kişi kapsamı, sonuçların toplu okunması ve deneme/teslim
 * uçlarının puan kuralları vardır. Pano saklanmaz, her okumada puanlardan hesaplanır.
 *
 * Kapsam: öğrenci kendisini, veli bağlı çocuğunu, öğretmen okuma kapsamındaki (ders verdiği sınıf)
 * ya da grubunu okuyabildiği (dil okulunda koordinatörlük dahil) öğrenciyi, yönetici herkesi görür;
 * göremediği ya da olmayan öğrenci 404 (varlık sızmaz). Noktalar deneme ve teslim okumasıyla aynı
 * kurala tabidir (`canReadLearner`): öğretmen yalnız atamasını gördüğü görevin sonucunu, böylece
 * her noktanın bağlandığı sonucu açabilir. Puanlar deneme ve teslim uçlarının fonksiyonlarıyla
 * hesaplanır; kursiyer ve veli geri bildirimi açılmamış puanı panodan da çıkaramaz (DOM-BEC-045).
 * Log: kimlik ve başlık yazılmaz, yalnız atama kimliğiyle veri bütünlüğü uyarısı.
 */

async function assertReach(ctx: ServiceContext, viewer: Viewer, studentId: string) {
  switch (viewer.kind) {
    case 'admin':
      return
    case 'learner':
      if (!viewer.classOf.has(studentId)) throw new NotFoundError()
      return
    case 'teacher':
      if (viewer.studentIds.has(studentId)) return
      if (!(await groupReaches(ctx.db, ctx, studentId))) throw new NotFoundError()
      return
    default:
      return viewer satisfies never
  }
}

/** Atamanın içerik başlığı ve birincil becerisi (sabitlenen sürümden). */
function contentOf(assignment: StoredAssignment, pairs: WorkPairs) {
  const version = pairs.get(assignment.resourceVersionId)?.version
  return { title: version?.title ?? '', skill: version?.tags.primarySkill ?? null }
}

export async function getSkillProgress(ctx: ServiceContext, studentId: string) {
  const [record] = await loadRecordsByIds(ctx.db, ctx.institutionId, 'students', [studentId])
  if (record === undefined) throw new NotFoundError()
  const viewer = await viewerOf(ctx)
  await assertReach(ctx, viewer, studentId)

  const [attempts, submissions] = await Promise.all([
    loadLearnerAttempts(ctx.db, ctx.institutionId, studentId),
    loadLearnerSubmissions(ctx.db, ctx.institutionId, studentId),
  ])
  const assignments = (
    await loadAssignmentsByIds(ctx.db, ctx.institutionId, [
      ...attempts.map((attempt) => attempt.assignmentId),
      ...submissions.map((work) => work.submission.assignmentId),
    ])
  ).filter((assignment) => canReadLearner(viewer, assignment, studentId))
  const byId = new Map(assignments.map((assignment) => [assignment.id, assignment]))
  const [pairs, book] = await Promise.all([
    loadWorkPairs(ctx.db, ctx.institutionId, assignments),
    loadGrading(
      ctx.db,
      ctx,
      submissions
        .filter((work) => byId.has(work.submission.assignmentId))
        .map((work) => work.submission.id),
    ),
  ])

  const attemptsOf = new Map<string, StoredAttempt[]>()
  for (const attempt of attempts)
    attemptsOf.set(attempt.assignmentId, [...(attemptsOf.get(attempt.assignmentId) ?? []), attempt])
  const workOf = new Map(submissions.map((work) => [work.submission.assignmentId, work]))
  const results: SkillResult[] = []
  for (const assignment of assignments) {
    const { title, skill } = contentOf(assignment, pairs)
    const base = {
      skill,
      kind: assignment.kind,
      assignmentId: assignment.id,
      title,
      removed: contentRemoved(workPairsOf(assignment, pairs)),
      cancelled: assignment.archivedAt !== null,
    }
    if (assignment.scoringMode === 'auto') {
      let scoring: ReturnType<typeof attemptScoring>
      try {
        scoring = attemptScoring(assignment, pairs)
      } catch (error) {
        // Bağlam veri bütünlüğü sorunuyla kurulamadı: nokta çizilmez, pano yine döner.
        ctx.log.warn({
          event: 'skill_progress.scoring_unavailable',
          assignmentId: assignment.id,
          cause: error instanceof Error ? error.name : 'unknown',
        })
        continue
      }
      if (scoring.context === null) continue
      const own = attemptsOf.get(assignment.id) ?? []
      const counted = countedAttemptResult(assignment, scoring.context, own, ctx.now)
      if (counted === null) continue
      results.push({
        ...base,
        attemptId: counted.attemptId,
        submissionId: null,
        performedAt: counted.completedAt,
        percent: counted.percent,
      })
      continue
    }
    const work = workOf.get(assignment.id)
    if (work === undefined) continue
    const settled = settledSubmissionResult(ctx, viewer, book, work)
    if (settled === null) continue
    results.push({
      ...base,
      attemptId: null,
      submissionId: work.submission.id,
      performedAt: settled.submittedAt,
      percent: settled.percent,
    })
  }

  return {
    studentId,
    computedAt: ctx.now.toISOString(),
    skills: skillProgress(results),
  }
}
