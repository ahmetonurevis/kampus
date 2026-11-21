import { CEFR_LEVELS, type CefrLevel } from '@kampus/school-core/content/taxonomy.ts'
import {
  skillReport,
  type LearnerSkillResult,
  type ReportGrouping,
  type ReportGroup,
} from '@kampus/school-core/cefr/skill-report.ts'
import {
  canReadGroup,
  groupStatus,
  isGroupClosed,
} from '@kampus/school-core/lib/language-groups.ts'

import { listOverallLevelDecisions } from '../db/cefr.ts'
import { loadCourses } from '../db/courses.ts'
import { loadGroupMembers, loadGroups } from '../db/language-groups.ts'
import { loadRecordsByIds } from '../db/records.ts'
import {
  loadAssignmentsByIds,
  loadReportAttempts,
  loadReportSubmissions,
  type StoredAttempt,
  type StoredSubmissionWork,
} from '../db/skills.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { groupReaderOf } from './cefr.ts'
import { evidenceActiveSince } from './cefr-evidence.ts'
import { viewerOf } from './task-assignments.ts'
import { attemptScoring, countedAttemptResult } from './task-attempts.ts'
import { loadGrading, settledSubmissionResult } from './task-submissions.ts'
import { canReadLearner, loadWorkPairs, readableLearners } from './task-work.ts'

/**
 * Beceri ve CEFR raporu (OG-100; IST-118; docs/domain/beceri-gelisimi.md DOM-BEC-037). Kural core
 * `cefr/skill-report.ts`'tedir; burada kapsam (okunabilir gruplar ve etkin kursiyerleri), sonuçların
 * toplu okunması ve deneme/teslim uçlarının puan kuralları vardır. Rapor saklanmaz, her okumada
 * hesaplanır; yanıtta kişi adı ya da kişi puanı yoktur.
 *
 * Puan görünümü personeldir (`cefr-evidence.ts` `staff` ile aynı): kesinleşmemiş puan sayılmaz.
 * Kanıt kümesi kişinin kendi ilerleme panosunda gördüğüyle sınırlıdır (DOM-BEC-035; `canReadLearner`):
 * yönetici bütün atamaları, öğretmen yalnız atamasını gördüğü görevlerin sonuçlarını sayar; böylece
 * rapor öğretmene başka öğretmenin atamasının puanını ortalama yoluyla sızdırmaz (DOM-BEC-037).
 * Kanıt, seviye önerisiyle aynı pencereden okunur (`evidenceActiveSince`; DOM-BEC-031). Kapsam
 * grup düzeyindedir (core `canReadGroup`, DOM-YTK-028): öğretmen kendi grubunu ve koordinatörü
 * olduğu seviyenin gruplarını görür; kapanmış (tamamlanmış ya da iptal) grup raporda yoktur. Log:
 * kimlik ve başlık yazılmaz, yalnız atama kimliğiyle veri bütünlüğü uyarısı.
 *
 * TODO(rapor-ogretmen): öğretmen bazında kırılım (OG-147).
 * TODO(rapor-donem): seçilebilir dönem ve karşılaştırma (OG-147); şimdilik sabit kanıt penceresi
 * (seviye önerisiyle aynı) sayılır.
 */

const levelRank = (level: CefrLevel) => CEFR_LEVELS[level].rank

/** Raporun satırları: okunabilir, kapanmamış (planlı, açık, süren) grupların etkin ve geçerli kursiyerleri. */
async function reportGroups(
  ctx: ServiceContext,
  groupBy: ReportGrouping,
): Promise<{ groups: ReportGroup[]; levelOf: ReadonlyMap<string, CefrLevel> }> {
  const [groups, courses, members, reader] = await Promise.all([
    loadGroups(ctx.db, ctx.institutionId),
    loadCourses(ctx.db, ctx.institutionId),
    loadGroupMembers(ctx.db, ctx.institutionId),
    groupReaderOf(ctx.db, ctx),
  ])
  const courseOf = new Map(courses.map((course) => [course.id, course]))
  const today = ctx.now.toISOString()
  const readable = groups.filter((group) => {
    const course = courseOf.get(group.courseId)
    return (
      !isGroupClosed(groupStatus(group, today)) &&
      course !== undefined &&
      canReadGroup(reader, group, course, members)
    )
  })
  const active = new Map<string, string[]>()
  for (const member of members) {
    if (member.status !== 'active') continue
    active.set(member.groupId, [...(active.get(member.groupId) ?? []), member.studentId])
  }

  // Geçerli kursiyer: kaydı arşivli olmayan ve pasif işaretlenmemiş öğrenci.
  const wanted = readable.flatMap((group) => active.get(group.id) ?? [])
  const students = await loadRecordsByIds(ctx.db, ctx.institutionId, 'students', wanted)
  const valid = new Set(
    students
      .filter((record) => (record.data as { isActive?: unknown }).isActive !== false)
      .map((record) => record.id),
  )
  const studentsOf = (groupId: string) =>
    (active.get(groupId) ?? []).filter((studentId) => valid.has(studentId))

  const levelOf = new Map<string, CefrLevel>()
  if (groupBy === 'class') {
    const rows = readable
      .map((group) => ({
        id: group.id,
        name: group.name,
        studentIds: studentsOf(group.id),
        level: courseOf.get(group.courseId)?.level ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr') || a.id.localeCompare(b.id))
    for (const row of rows) if (row.level !== null) levelOf.set(row.id, row.level)
    return {
      groups: rows.map(({ id, name, studentIds }) => ({ id, name, studentIds })),
      levelOf,
    }
  }
  const byLevel = new Map<CefrLevel, string[]>()
  for (const group of readable) {
    const level = courseOf.get(group.courseId)?.level
    if (level === undefined) continue
    byLevel.set(level, [...(byLevel.get(level) ?? []), ...studentsOf(group.id)])
  }
  const rows = [...byLevel.entries()]
    .sort(([a], [b]) => levelRank(a) - levelRank(b))
    .map(([level, studentIds]) => ({ id: level, name: CEFR_LEVELS[level].label, studentIds }))
  for (const level of byLevel.keys()) levelOf.set(level, level)
  return { groups: rows, levelOf }
}

/** Kursiyerlerin sayılan görev sonuçları (personel görünümü; DOM-BEC-035 kanıt kümesi). */
async function learnerResults(
  ctx: ServiceContext,
  learnerIds: readonly string[],
): Promise<LearnerSkillResult[]> {
  const activeSince = evidenceActiveSince(ctx.now)
  const [viewer, attempts, submissions] = await Promise.all([
    viewerOf(ctx),
    loadReportAttempts(ctx.db, ctx.institutionId, learnerIds, { activeSince }),
    loadReportSubmissions(ctx.db, ctx.institutionId, learnerIds, { activeSince }),
  ])
  const assignments = (
    await loadAssignmentsByIds(ctx.db, ctx.institutionId, [
      ...attempts.map((attempt) => attempt.assignmentId),
      ...submissions.map((work) => work.submission.assignmentId),
    ])
  ).filter(
    (assignment) =>
      assignment.kind === 'evaluation' &&
      assignment.archivedAt === null &&
      // Kişinin ilerleme panosunda göremediği atama kanıt değildir (öğretmen, DOM-BEC-035).
      readableLearners(viewer, assignment).kind !== 'none',
  )
  const known = new Set(assignments.map((assignment) => assignment.id))
  const [pairs, book] = await Promise.all([
    loadWorkPairs(ctx.db, ctx.institutionId, assignments),
    loadGrading(
      ctx.db,
      ctx,
      submissions
        .filter((work) => known.has(work.submission.assignmentId))
        .map((work) => work.submission.id),
    ),
  ])

  // Atama başına kursiyerin denemeleri ve teslimi: iş yükü atama × kursiyer değil, sonuç sayısıdır.
  const attemptsOf = new Map<string, Map<string, StoredAttempt[]>>()
  for (const attempt of attempts) {
    const byLearner = attemptsOf.get(attempt.assignmentId) ?? new Map<string, StoredAttempt[]>()
    const own = byLearner.get(attempt.learnerId) ?? []
    own.push(attempt)
    byLearner.set(attempt.learnerId, own)
    attemptsOf.set(attempt.assignmentId, byLearner)
  }
  const worksOf = new Map<string, StoredSubmissionWork[]>()
  for (const work of submissions) {
    const list = worksOf.get(work.submission.assignmentId) ?? []
    list.push(work)
    worksOf.set(work.submission.assignmentId, list)
  }

  const results: LearnerSkillResult[] = []
  for (const assignment of assignments) {
    const version = pairs.get(assignment.resourceVersionId)?.version
    // Kaldırılmış ya da okunamayan içerik kanıt değildir (DOM-KYN-051).
    if (version === undefined || version.removedAt !== null) continue
    const base = {
      skill: version.tags?.primarySkill ?? null,
      kind: assignment.kind,
      assignmentId: assignment.id,
      title: '',
      removed: false,
      cancelled: false,
    }
    if (assignment.scoringMode === 'auto') {
      let context: ReturnType<typeof attemptScoring>['context']
      try {
        context = attemptScoring(assignment, pairs).context
      } catch (error) {
        // Veri bütünlüğü sorunuyla puanlama bağlamı kurulamadı: kanıt yok, rapor yine döner.
        ctx.log.warn({
          event: 'skill_report.scoring_unavailable',
          assignmentId: assignment.id,
          cause: error instanceof Error ? error.name : 'unknown',
        })
        continue
      }
      if (context === null) continue
      for (const [learnerId, own] of attemptsOf.get(assignment.id) ?? []) {
        if (!canReadLearner(viewer, assignment, learnerId)) continue
        const counted = countedAttemptResult(assignment, context, own, ctx.now)
        if (counted === null) continue
        results.push({
          ...base,
          learnerId,
          attemptId: counted.attemptId,
          submissionId: null,
          performedAt: counted.completedAt,
          percent: counted.percent,
        })
      }
      continue
    }
    for (const work of worksOf.get(assignment.id) ?? []) {
      const learnerId = work.submission.learnerId
      if (!canReadLearner(viewer, assignment, learnerId)) continue
      const settled = settledSubmissionResult(ctx, { kind: 'admin' }, book, work)
      if (settled === null) continue
      results.push({
        ...base,
        learnerId,
        attemptId: null,
        submissionId: work.submission.id,
        performedAt: settled.submittedAt,
        percent: settled.percent,
      })
    }
  }
  return results
}

export async function getSkillReport(ctx: ServiceContext, query: { groupBy: ReportGrouping }) {
  const { groups, levelOf } = await reportGroups(ctx, query.groupBy)
  const learnerIds = [...new Set(groups.flatMap((group) => group.studentIds))]
  const [results, decisions] = await Promise.all([
    learnerResults(ctx, learnerIds),
    listOverallLevelDecisions(ctx.db, ctx.institutionId, learnerIds),
  ])
  // Güncel seviye: kursiyerin en yeni genel kararı (liste en yeniden eskiye).
  const levels = new Map<string, CefrLevel>()
  for (const decision of decisions)
    if (!levels.has(decision.learnerId)) levels.set(decision.learnerId, decision.level)

  const report = skillReport({ groups, results, levels, now: ctx.now })
  return {
    groupBy: query.groupBy,
    computedAt: report.computedAt,
    groups: report.groups.map((group) => ({
      ...group,
      // Sınıf satırında kurun seviyesi; seviye satırında satırın kendisi.
      level: levelOf.get(group.id) ?? null,
    })),
    totals: report.totals,
  }
}
