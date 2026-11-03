import type { EvidenceCandidate } from '@kampus/school-core/cefr/suggestion.ts'

import {
  loadAssignmentsByIds,
  loadLearnerAttempts,
  loadLearnerSubmissions,
  type StoredAttempt,
} from '../db/skills.ts'
import type { Database } from '../db/client.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import type { Viewer } from './task-assignments.ts'
import { attemptScoring, countedAttemptResult } from './task-attempts.ts'
import { loadGrading, settledSubmissionResult } from './task-submissions.ts'
import { loadWorkPairs } from './task-work.ts'

/**
 * Seviye önerisinin görev kanıtları (OG-247; docs/domain/beceri-gelisimi.md DOM-BEC-031; ADR 0004
 * karar 5, 8). Kanıt değerlendirme türündeki atamanın kursiyer başına tek sonucudur: otomatik
 * görevde sayılan deneme (`countedAttemptResult`, DOM-BEC-042), öğretmen puanlı görevde
 * kesinleşmiş puanı olan son sürüm (`settledSubmissionResult`, DOM-BEC-040). Beceri ve hedef seviye
 * atamanın sabitlediği içerik sürümünün etiketlerindedir; seçim, pencere ve başarı core
 * `selectEvidence`'tadır.
 *
 * Görünüm (`audience`):
 * - `staff`: yönetici ve kursiyere ulaşan öğretmen aynı öneriyi görür (DOM-BEC-030: aynı girdi aynı
 *   öneri); kanıt atamayı kimin verdiğine bağlı değildir. Kesinleşmemiş teslim `unscored` adayıdır.
 * - `learner`: öğrenci ve veli yalnız geri bildirimi açılmış puanı kanıt görür (DOM-BEC-045); açılmamış
 *   puan tahmini seviyeden de çıkarılamaz.
 *
 * Alıştırma hiç aday olmaz (yalnız değerlendirme kanıttır, DOM-BEC-031): sınırsız tekrar edilen
 * alıştırmalar dışarıda kalan listesini doldurmasın diye servis eler. İptal edilen (arşivlenen)
 * atama ve kaldırılmış içerik (puanlama bağlamı kurulamaz) kanıt değildir.
 */
export type EvidenceAudience = 'staff' | 'learner'

/** Kanıt adayının kaynağı; ekran kanıt görevine bununla bağlanır. */
export type TaskEvidenceLink = { assignmentId: string; scoring: 'auto' | 'rubric' }

export async function loadTaskEvidence(
  db: Database,
  ctx: ServiceContext,
  studentId: string,
  audience: EvidenceAudience,
): Promise<{ candidates: EvidenceCandidate[]; links: Map<string, TaskEvidenceLink> }> {
  const [attempts, submissions] = await Promise.all([
    loadLearnerAttempts(db, ctx.institutionId, studentId),
    loadLearnerSubmissions(db, ctx.institutionId, studentId),
  ])
  const assignments = (
    await loadAssignmentsByIds(db, ctx.institutionId, [
      ...new Set([
        ...attempts.map((attempt) => attempt.assignmentId),
        ...submissions.map((work) => work.submission.assignmentId),
      ]),
    ])
  ).filter((assignment) => assignment.kind === 'evaluation' && assignment.archivedAt === null)
  const byId = new Set(assignments.map((assignment) => assignment.id))
  const own = submissions.filter((work) => byId.has(work.submission.assignmentId))
  const [pairs, book] = await Promise.all([
    loadWorkPairs(db, ctx.institutionId, assignments),
    loadGrading(
      db,
      ctx,
      own.map((work) => work.submission.id),
    ),
  ])
  // `settledSubmissionResult` görünümü yalnız türünden okur: personel kesinleşmiş, kursiyer açılmış puan.
  const viewer: Viewer =
    audience === 'staff'
      ? { kind: 'admin' }
      : { kind: 'learner', role: 'ogrenci', classOf: new Map([[studentId, '']]) }

  const attemptsOf = new Map<string, StoredAttempt[]>()
  for (const attempt of attempts)
    attemptsOf.set(attempt.assignmentId, [...(attemptsOf.get(attempt.assignmentId) ?? []), attempt])
  const workOf = new Map(own.map((work) => [work.submission.assignmentId, work]))

  const candidates: EvidenceCandidate[] = []
  const links = new Map<string, TaskEvidenceLink>()
  for (const assignment of assignments) {
    const tags = pairs.get(assignment.resourceVersionId)?.version?.tags
    const base = {
      taskId: assignment.id,
      title: pairs.get(assignment.resourceVersionId)?.version?.title ?? '',
      source: 'task' as const,
      kind: assignment.kind,
      preliminary: false,
      skill: tags?.primarySkill ?? null,
      targetLevel: tags?.cefrLevel ?? null,
    }
    if (assignment.scoringMode === 'auto') {
      let context: ReturnType<typeof attemptScoring>['context']
      try {
        context = attemptScoring(assignment, pairs).context
      } catch (error) {
        // Veri bütünlüğü sorunuyla puanlama bağlamı kurulamadı: kanıt yok, profil yine döner.
        ctx.log.warn({
          event: 'cefr_evidence.scoring_unavailable',
          assignmentId: assignment.id,
          cause: error instanceof Error ? error.name : 'unknown',
        })
        continue
      }
      if (context === null) continue
      const counted = countedAttemptResult(
        assignment,
        context,
        attemptsOf.get(assignment.id) ?? [],
        ctx.now,
      )
      if (counted === null) continue
      candidates.push({
        ...base,
        id: counted.attemptId,
        performedAt: counted.completedAt,
        appealPending: false,
        result: { mode: 'auto', score: counted.score },
      })
      links.set(counted.attemptId, { assignmentId: assignment.id, scoring: 'auto' })
      continue
    }
    const work = workOf.get(assignment.id)
    const latest = work?.versions.at(-1)
    if (work === undefined || latest === undefined) continue
    const settled = settledSubmissionResult(ctx, viewer, book, work)
    const id = settled?.versionId ?? latest.id
    const appeals = book.bySubmission.get(work.submission.id)?.appeals ?? []
    candidates.push({
      ...base,
      id,
      performedAt: settled?.submittedAt ?? latest.submittedAt,
      appealPending: appeals.some(
        (appeal) => appeal.submissionVersionId === id && appeal.outcome === null,
      ),
      result: settled === null ? null : { mode: 'rubric', score: settled.result },
    })
    links.set(id, { assignmentId: assignment.id, scoring: 'rubric' })
  }
  return { candidates, links }
}
