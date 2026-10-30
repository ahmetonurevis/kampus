import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql, type SQL } from 'drizzle-orm'

import type { Database } from '../src/db/client.ts'
import {
  resubmissionRequests,
  rubricScores,
  rubricVersions,
  scoreAppeals,
  scoreTransfers,
  secondRatingRequests,
  submissionDrafts,
  submissionVersions,
  taskAssignments,
  taskAttempts,
  taskSubmissions,
} from '../src/db/schema/skills.ts'
import { buildTestApp, createInstitution, createTestDatabase, FIXED_NOW } from './support/app.ts'
import { seedResource } from './support/resources-sample.ts'
import {
  autoAssignment,
  LEARNER,
  sampleRubricData,
  seedSkillChain,
  teacherAssignment,
  type SkillChain,
} from './support/skills-sample.ts'

/**
 * Beceri görevi tablolarının veritabanı kısıtları (ADR 0004 karar 4–7, migration 0013). Yazma
 * ucu bu dilimde yok; satırlar doğrudan yazılır ve ihlal kısıt adıyla doğrulanır.
 */

const at = { createdAt: FIXED_NOW, updatedAt: FIXED_NOW }
const LATER = new Date(FIXED_NOW.getTime() + 60_000)

/** Sürücüden bağımsız kısıt ihlali beklentisi: PGlite ve node-postgres hatası `cause`'ta. */
async function violates(work: Promise<unknown>, constraint: string, code?: string) {
  await assert.rejects(work, (error: unknown) => {
    const cause = (error as { cause?: { constraint?: string; code?: string } }).cause
    assert.equal(cause?.constraint ?? (error as { constraint?: string }).constraint, constraint)
    if (code !== undefined) assert.equal(cause?.code ?? (error as { code?: string }).code, code)
    return true
  })
}

describe('0013: beceri görevi tabloları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: Awaited<ReturnType<typeof buildTestApp>>

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function chain(): Promise<{ institutionId: string; owner: string; chain: SkillChain }> {
    const institution = await createInstitution(app)
    const owner = institution.admin.id
    return {
      institutionId: institution.id,
      owner,
      chain: await seedSkillChain(db, institution.id, owner),
    }
  }

  const rows = async <T>(query: SQL) => ((await db.execute(query)) as unknown as { rows: T[] }).rows

  test('ADR 0004 karar 1: başka kurumun içerik, atama, teslim ve rubrik sürümüne bağlanmak bileşik yabancı anahtarla reddedilir', async () => {
    const a = await chain()
    const b = await createInstitution(app)
    const { resource: own, versions } = await seedResource(db, b.id, {
      ownerUserId: b.admin.id,
      versions: [{ status: 'published' }],
    })
    const ownVersion = versions[0]!.id
    const assignment = (overrides: Record<string, unknown>) =>
      db.insert(taskAssignments).values({
        institutionId: b.id,
        id: randomUUID(),
        ...teacherAssignment(own.id, ownVersion, null),
        assignedByUserId: b.admin.id,
        ...at,
        ...overrides,
      })
    await violates(
      assignment({ resourceVersionId: a.chain.resourceVersionId }),
      'task_assignments_resource_version_fkey',
      '23503',
    )
    await violates(
      assignment({ scoringVersionId: a.chain.resourceVersionId }),
      'task_assignments_scoring_version_fkey',
    )
    await violates(
      assignment({ rubricVersionId: a.chain.rubricVersionId }),
      'task_assignments_rubric_version_fkey',
    )
    await violates(assignment({ resourceId: a.chain.resourceId }), 'task_assignments_resource_fkey')
    await violates(
      db.insert(taskSubmissions).values({
        institutionId: b.id,
        id: randomUUID(),
        assignmentId: a.chain.assignmentId,
        learnerId: LEARNER,
        ...at,
      }),
      'task_submissions_assignment_fkey',
    )
    await violates(
      db.insert(taskAttempts).values({
        institutionId: b.id,
        id: randomUUID(),
        assignmentId: a.chain.assignmentId,
        learnerId: LEARNER,
        attemptNumber: 1,
        startedAt: FIXED_NOW,
        ...at,
      }),
      'task_attempts_assignment_fkey',
    )
    await violates(
      db.insert(rubricScores).values({
        institutionId: b.id,
        id: randomUUID(),
        submissionVersionId: a.chain.submissionVersionId,
        rubricVersionId: a.chain.rubricVersionId,
        raterUserId: b.admin.id,
        raterRole: 'first',
        criteria: [{ criterionId: 'task', band: 3, comment: null }],
        overallComment: 'İyi.',
        scoredAt: FIXED_NOW,
        ...at,
      }),
      'rubric_scores_submission_version_fkey',
    )
    // A'nın satırları değişmedi.
    const [stored] = await db
      .select()
      .from(taskSubmissions)
      .where(eq(taskSubmissions.institutionId, a.institutionId))
    assert.equal(stored?.id, a.chain.submissionId)
    assert.equal(stored?.version, 1)
  })

  test('DOM-BEC-040: kursiyer × atama başına tek teslim; sürüm numarası teslimde tekil; teslim sürümü değişmez ve arşivlenmez', async () => {
    const { institutionId, chain: c } = await chain()
    await violates(
      db.insert(taskSubmissions).values({
        institutionId,
        id: randomUUID(),
        assignmentId: c.assignmentId,
        learnerId: LEARNER,
        ...at,
      }),
      'task_submissions_assignment_learner_key',
      '23505',
    )
    await violates(
      db.insert(submissionVersions).values({
        institutionId,
        id: randomUUID(),
        submissionId: c.submissionId,
        versionNumber: 1,
        submittedAt: FIXED_NOW,
        body: 'Yeni metin',
        ...at,
      }),
      'submission_versions_submission_number_key',
    )
    const where = and(
      eq(submissionVersions.institutionId, institutionId),
      eq(submissionVersions.id, c.submissionVersionId),
    )
    await violates(
      db
        .update(submissionVersions)
        .set({ body: 'Değişti', version: sql`${submissionVersions.version} + 1`, updatedAt: LATER })
        .where(where),
      'submission_versions_immutable_check',
      '23514',
    )
    await violates(
      db.update(submissionVersions).set({ archivedAt: LATER }).where(where),
      'submission_versions_immutable_check',
    )
    await violates(
      db.update(submissionVersions).set({ body: 'Değişti', updatedAt: LATER }).where(where),
      'submission_versions_immutable_check',
    )
    const [stored] = await db.select().from(submissionVersions).where(where)
    assert.equal(stored?.body, 'My weekend was busy.')
    assert.equal(stored?.version, 1)
  })

  test('DOM-BEC-022: kullanılmış rubrik sürümü silinemez; rubrikte tek açık taslak ve tek yayındaki sürüm; durum ve yayım anı tutarlı', async () => {
    const { institutionId, chain: c } = await chain()
    await violates(
      db
        .delete(rubricVersions)
        .where(
          and(
            eq(rubricVersions.institutionId, institutionId),
            eq(rubricVersions.id, c.rubricVersionId),
          ),
        ),
      'task_assignments_rubric_version_fkey',
      '23001', // restrict_violation: on delete restrict
    )
    const version = (overrides: Record<string, unknown>) =>
      db.insert(rubricVersions).values({
        institutionId,
        id: randomUUID(),
        rubricId: c.rubricId,
        versionNumber: 2,
        status: 'draft',
        ...sampleRubricData(),
        ...at,
        ...overrides,
      })
    await violates(version({ versionNumber: 1 }), 'rubric_versions_rubric_number_key')
    await violates(
      version({ status: 'published', publishedAt: FIXED_NOW }),
      'rubric_versions_published_key',
    )
    await violates(version({ status: 'published' }), 'rubric_versions_published_check')
    await violates(
      version({ status: 'archived', publishedAt: FIXED_NOW }),
      'rubric_versions_published_check',
    )
    await violates(version({ skill: 'reading' }), 'rubric_versions_skill_check')
    await violates(version({ criteria: [] }), 'rubric_versions_criteria_check')
    await version({})
    await violates(version({ versionNumber: 3 }), 'rubric_versions_draft_key')
    // Silinen (arşivlenen) taslağın yerine yeni taslak açılabilir.
    await db
      .update(rubricVersions)
      .set({ archivedAt: LATER, version: sql`${rubricVersions.version} + 1` })
      .where(
        and(
          eq(rubricVersions.institutionId, institutionId),
          eq(rubricVersions.rubricId, c.rubricId),
          eq(rubricVersions.versionNumber, 2),
        ),
      )
    await version({ versionNumber: 3 })
  })

  test('DOM-BEC-021, 024: sürüm başına tek ilk ve tek ikinci puan, son puan birden çok; puan değişmez; kullanılan rubrik sürümü puan yabancı anahtarıyla da korunur', async () => {
    const { institutionId, owner, chain: c } = await chain()
    const score = (raterRole: string) =>
      db.insert(rubricScores).values({
        institutionId,
        id: randomUUID(),
        submissionVersionId: c.submissionVersionId,
        rubricVersionId: c.rubricVersionId,
        raterUserId: owner,
        raterRole: raterRole as 'first',
        criteria: [
          { criterionId: 'task', band: 3, comment: null },
          { criterionId: 'grammar', band: 2, comment: 'Zaman uyumu.' },
        ],
        overallComment: 'Genel olarak iyi.',
        scoredAt: FIXED_NOW,
        ...at,
      })
    await score('first')
    await violates(score('first'), 'rubric_scores_version_role_key', '23505')
    await score('second')
    await violates(score('second'), 'rubric_scores_version_role_key')
    await score('final')
    await score('final')
    await violates(score('coordinator'), 'rubric_scores_rater_role_check')
    await violates(
      db
        .update(rubricScores)
        .set({ overallComment: 'Değişti', version: sql`${rubricScores.version} + 1` })
        .where(eq(rubricScores.institutionId, institutionId)),
      'rubric_scores_immutable_check',
    )
    // Atama arşivlenip rubrik bağı kalksa da puan rubrik sürümünü korur.
    await db
      .update(taskAssignments)
      .set({
        rubricVersionId: null,
        version: sql`${taskAssignments.version} + 1`,
      })
      .where(eq(taskAssignments.institutionId, institutionId))
    await violates(
      db.delete(rubricVersions).where(eq(rubricVersions.institutionId, institutionId)),
      'rubric_scores_rubric_version_fkey',
    )
  })

  test('ADR 0004 karar 4: atama ayarları core kurallarıyla sınırlı; teslim türü ayardan türetilir', async () => {
    const { institutionId, owner, chain: c } = await chain()
    const insert = (columns: Record<string, unknown>) =>
      db.insert(taskAssignments).values({
        institutionId,
        id: randomUUID(),
        ...teacherAssignment(c.resourceId, c.resourceVersionId, c.rubricVersionId),
        assignedByUserId: owner,
        ...at,
        ...columns,
      })
    const auto = autoAssignment(c.resourceId, c.resourceVersionId)
    // DOM-BEC-041, 042: alıştırmada hak ve politika yok; "en yüksek" yalnız hak > 1.
    await violates(insert({ ...auto, kind: 'practice' }), 'task_assignments_attempts_check')
    await violates(insert({ ...auto, maxAttempts: 1 }), 'task_assignments_attempts_check')
    await violates(insert({ ...auto, maxAttempts: 4 }), 'task_assignments_attempts_check')
    await violates(insert({ maxAttempts: 2 }), 'task_assignments_attempts_check')
    // DOM-BEC-044: değerlendirmede son teslim zorunlu, geç kabul en çok 7 gün.
    await violates(insert({ dueAt: null }), 'task_assignments_deadline_check')
    await violates(insert({ lateAcceptanceDays: 8 }), 'task_assignments_deadline_check')
    // DOM-BEC-005: değerlendirmede döküm yok; dinleme hakkı 1, 2 veya sınırsız.
    await violates(insert({ ...auto, showTranscript: true }), 'task_assignments_transcript_check')
    await violates(insert({ ...auto, listeningPlays: 3 }), 'task_assignments_listening_plays_check')
    // DOM-BEC-024: yüksek sonuçlu öğretmen puanlı görevde en az %10; otomatik görevde ikinci puan yok.
    await violates(
      insert({ highStakes: true, secondRatingPercent: 5 }),
      'task_assignments_second_rating_check',
    )
    await violates(
      insert({ ...auto, secondRatingPercent: 10 }),
      'task_assignments_second_rating_check',
    )
    // Otomatik görevde teslim ayarı ve rubrik yok; öğretmen puanlı görev süresiz.
    await violates(
      insert({ ...auto, submissionSettings: teacherAssignment('', '', null).submissionSettings }),
      'task_assignments_mode_check',
    )
    await violates(
      insert({ ...auto, rubricVersionId: c.rubricVersionId }),
      'task_assignments_mode_check',
    )
    await violates(insert({ timeLimitMinutes: 30 }), 'task_assignments_mode_check')

    const practiceId = randomUUID()
    await insert({
      ...auto,
      id: practiceId,
      kind: 'practice',
      maxAttempts: null,
      countPolicy: null,
      dueAt: null,
    })
    await insert({ highStakes: true, secondRatingPercent: 10 })
    const kinds = await rows<{ scoring_mode: string; submission_kind: string | null }>(
      sql`select scoring_mode, submission_kind from task_assignments
          where institution_id = ${institutionId} order by scoring_mode`,
    )
    assert.deepEqual(
      kinds.map((row) => row.submission_kind),
      [null, 'text', 'text'],
    )
  })

  test('DOM-BEC-042, 043: deneme numarası kursiyerin atamasında tekil; teslim başlangıçtan önce olamaz', async () => {
    const { institutionId, chain: c } = await chain()
    const attempt = (columns: Record<string, unknown> = {}) =>
      db.insert(taskAttempts).values({
        institutionId,
        id: randomUUID(),
        assignmentId: c.assignmentId,
        learnerId: LEARNER,
        attemptNumber: 1,
        startedAt: FIXED_NOW,
        ...at,
        ...columns,
      })
    await attempt()
    await violates(attempt(), 'task_attempts_assignment_learner_number_key', '23505')
    await attempt({ learnerId: 'test-s-diger' })
    await violates(
      attempt({ attemptNumber: 2, submittedAt: new Date(FIXED_NOW.getTime() - 1) }),
      'task_attempts_submitted_check',
    )
    await violates(attempt({ attemptNumber: 0 }), 'task_attempts_number_check')
    await violates(attempt({ attemptNumber: 2, answers: [] }), 'task_attempts_answers_check')
  })

  test('IST-047: taslak kursiyer × atama başına tek satır; metin sınırı', async () => {
    const { institutionId, chain: c } = await chain()
    const draft = (body: string) =>
      db.insert(submissionDrafts).values({
        institutionId,
        assignmentId: c.assignmentId,
        learnerId: LEARNER,
        body,
        savedAt: FIXED_NOW,
        ...at,
      })
    await violates(draft('x'.repeat(50_001)), 'submission_drafts_body_check')
    await draft('Taslak')
    await violates(draft('İkinci'), 'submission_drafts_pkey', '23505')
  })

  test('DOM-BEC-040, 024, 025: yeniden teslim isteği var olan sürüme bağlı ve değişmez; ikinci puan isteği ve itiraz tutarlı', async () => {
    const { institutionId, owner, chain: c } = await chain()
    const request = (columns: Record<string, unknown> = {}) =>
      db.insert(resubmissionRequests).values({
        institutionId,
        submissionId: c.submissionId,
        versionNumber: 1,
        dueAt: LATER,
        requestedByUserId: owner,
        requestedAt: FIXED_NOW,
        ...at,
        ...columns,
      })
    await violates(request({ versionNumber: 2 }), 'resubmission_requests_version_fkey', '23503')
    await violates(request({ dueAt: FIXED_NOW }), 'resubmission_requests_due_check')
    await request()
    await violates(request(), 'resubmission_requests_pkey')
    await violates(
      db
        .update(resubmissionRequests)
        .set({ dueAt: new Date(LATER.getTime() + 1), version: 2 })
        .where(eq(resubmissionRequests.institutionId, institutionId)),
      'resubmission_requests_immutable_check',
    )

    const secondRating = (columns: Record<string, unknown>) =>
      db.insert(secondRatingRequests).values({
        institutionId,
        submissionId: c.submissionId,
        requestedAt: FIXED_NOW,
        ...at,
        source: 'manual',
        requestedByUserId: owner,
        ...columns,
      })
    await violates(
      secondRating({ requestedByUserId: null }),
      'second_rating_requests_requester_check',
    )
    await violates(secondRating({ source: 'sample' }), 'second_rating_requests_requester_check')
    await secondRating({ source: 'sample', requestedByUserId: null })
    await violates(secondRating({}), 'second_rating_requests_pkey')

    const appeal = (columns: Record<string, unknown>) =>
      db.insert(scoreAppeals).values({
        institutionId,
        id: randomUUID(),
        submissionVersionId: c.submissionVersionId,
        learnerId: LEARNER,
        filedByUserId: owner,
        reason: 'Dilbilgisi puanı yanlış hesaplandı.',
        filedAt: FIXED_NOW,
        ...at,
        ...columns,
      })
    await violates(appeal({ outcome: 'upheld' }), 'score_appeals_decision_check')
    await violates(
      appeal({
        outcome: 'partly',
        decidedAt: LATER,
        decidedByUserId: owner,
        decisionReason: 'Gerekçe',
      }),
      'score_appeals_outcome_check',
    )
    await appeal({})
    await violates(appeal({}), 'score_appeals_submission_version_key', '23505')
  })

  test('DOM-BEC-060: not aktarımı görev ve kursiyer başına tek, tek kaynaklı ve değişmez', async () => {
    const { institutionId, owner, chain: c } = await chain()
    const attemptId = randomUUID()
    await db.insert(taskAttempts).values({
      institutionId,
      id: attemptId,
      assignmentId: c.assignmentId,
      learnerId: LEARNER,
      attemptNumber: 1,
      startedAt: FIXED_NOW,
      submittedAt: LATER,
      ...at,
    })
    const transfer = (columns: Record<string, unknown>) =>
      db.insert(scoreTransfers).values({
        institutionId,
        id: randomUUID(),
        assignmentId: c.assignmentId,
        learnerId: LEARNER,
        gradeType: 'performans',
        score: 85,
        sourceAttemptId: attemptId,
        gradeRecordId: 'test-grade-1',
        transferredByUserId: owner,
        transferredAt: LATER,
        ...at,
        ...columns,
      })
    await violates(transfer({ sourceAttemptId: null }), 'score_transfers_source_check')
    await violates(transfer({ gradeType: 'katilim' }), 'score_transfers_grade_type_check')
    await violates(transfer({ score: 101 }), 'score_transfers_score_check')
    await transfer({})
    await violates(transfer({}), 'score_transfers_assignment_learner_key', '23505')
    await violates(
      db
        .update(scoreTransfers)
        .set({ score: 90, version: sql`${scoreTransfers.version} + 1`, updatedAt: LATER })
        .where(eq(scoreTransfers.institutionId, institutionId)),
      'score_transfers_immutable_check',
    )
    // Aktarımın kaynağı olan deneme silinemez.
    await violates(
      db.delete(taskAttempts).where(eq(taskAttempts.id, attemptId)),
      'score_transfers_source_attempt_fkey',
    )
  })
})
