import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql, type SQL } from 'drizzle-orm'

import type { Database } from '../src/db/client.ts'
import { files } from '../src/db/schema/files.ts'
import {
  attemptItemChecks,
  attemptMediaPlays,
  resubmissionRequests,
  rubrics,
  rubricScores,
  rubricVersions,
  scoreAppeals,
  scoreTransfers,
  secondRatingRequests,
  submissionDrafts,
  submissionVersions,
  taskAssignments,
  taskAssignmentTargets,
  taskAttempts,
  taskSubmissions,
} from '../src/db/schema/skills.ts'
import { databaseErrorInfo } from '../src/errors.ts'
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

/**
 * Değişmez satır tetikleyicisinin reddi (`kampus_reject_immutable_change`): 55000 ve tablo adı.
 * İleti teknik ve İngilizcedir; kullanıcıya gösterilmez.
 */
async function rejectsImmutable(work: Promise<unknown>, table: string) {
  await assert.rejects(work, (error: unknown) => {
    assert.equal(databaseErrorInfo(error)?.code, '55000')
    const cause = (error as { cause?: { message?: string } }).cause
    assert.match(cause?.message ?? String(error), new RegExp(`${table} rows are immutable`))
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

  test('ADR 0004 karar 1: başka kurumun rubriğine, atamasına, teslimine, teslim sürümüne, denemesine ve puanına bağlanan rubrik sürümü, hedef, taslak, sürüm, yeniden teslim, ikinci puan, puan, itiraz ve aktarım reddedilir', async () => {
    const { institutionId: aId, owner: aOwner, chain: a } = await chain()
    const { institutionId: bId, owner: bOwner, chain: b } = await chain()
    const scoreRow = (institutionId: string, rater: string, columns: Record<string, unknown>) => ({
      institutionId,
      id: randomUUID(),
      raterUserId: rater,
      raterRole: 'first' as const,
      criteria: [{ criterionId: 'task', band: 3, comment: null }],
      overallComment: 'İyi.',
      scoredAt: FIXED_NOW,
      ...at,
      submissionVersionId: '',
      rubricVersionId: '',
      ...columns,
    })
    const aScore = scoreRow(aId, aOwner, {
      submissionVersionId: a.submissionVersionId,
      rubricVersionId: a.rubricVersionId,
    })
    const bScore = scoreRow(bId, bOwner, {
      submissionVersionId: b.submissionVersionId,
      rubricVersionId: b.rubricVersionId,
    })
    await db.insert(rubricScores).values([aScore, bScore])
    const aAttemptId = randomUUID()
    await db.insert(taskAttempts).values({
      institutionId: aId,
      id: aAttemptId,
      assignmentId: a.assignmentId,
      learnerId: LEARNER,
      attemptNumber: 1,
      startedAt: FIXED_NOW,
      ...at,
    })

    await violates(
      db.insert(rubricVersions).values({
        institutionId: bId,
        id: randomUUID(),
        rubricId: a.rubricId,
        versionNumber: 9,
        status: 'draft',
        ...sampleRubricData(),
        ...at,
      }),
      'rubric_versions_rubric_fkey',
      '23503',
    )
    await violates(
      db.insert(taskAssignmentTargets).values({
        institutionId: bId,
        assignmentId: a.assignmentId,
        targetKind: 'student',
        targetId: LEARNER,
        ...at,
      }),
      'task_assignment_targets_assignment_fkey',
    )
    await violates(
      db.insert(submissionDrafts).values({
        institutionId: bId,
        assignmentId: a.assignmentId,
        learnerId: LEARNER,
        savedAt: FIXED_NOW,
        ...at,
      }),
      'submission_drafts_assignment_fkey',
    )
    await violates(
      db.insert(submissionVersions).values({
        institutionId: bId,
        id: randomUUID(),
        submissionId: a.submissionId,
        versionNumber: 2,
        submittedAt: FIXED_NOW,
        body: 'Metin',
        ...at,
      }),
      'submission_versions_submission_fkey',
    )
    await violates(
      db.insert(resubmissionRequests).values({
        institutionId: bId,
        submissionId: a.submissionId,
        versionNumber: 1,
        dueAt: LATER,
        requestedByUserId: bOwner,
        requestedAt: FIXED_NOW,
        ...at,
      }),
      'resubmission_requests_version_fkey',
    )
    await violates(
      db.insert(secondRatingRequests).values({
        institutionId: bId,
        submissionId: a.submissionId,
        source: 'sample',
        requestedAt: FIXED_NOW,
        ...at,
      }),
      'second_rating_requests_submission_fkey',
    )
    await violates(
      db.insert(rubricScores).values(
        scoreRow(bId, bOwner, {
          submissionVersionId: b.submissionVersionId,
          rubricVersionId: a.rubricVersionId,
          raterRole: 'final',
        }),
      ),
      'rubric_scores_rubric_version_fkey',
    )
    await violates(
      db.insert(scoreAppeals).values({
        institutionId: bId,
        id: randomUUID(),
        submissionVersionId: a.submissionVersionId,
        learnerId: LEARNER,
        filedByUserId: bOwner,
        reason: 'Dilbilgisi puanı yanlış hesaplandı.',
        filedAt: FIXED_NOW,
        ...at,
      }),
      'score_appeals_submission_version_fkey',
    )
    const transfer = (columns: Record<string, unknown>) =>
      db.insert(scoreTransfers).values({
        institutionId: bId,
        id: randomUUID(),
        assignmentId: b.assignmentId,
        learnerId: LEARNER,
        gradeType: 'performans',
        score: 85,
        sourceRubricScoreId: bScore.id,
        gradeRecordId: 'test-grade-1',
        transferredByUserId: bOwner,
        transferredAt: LATER,
        ...at,
        ...columns,
      })
    await violates(transfer({ assignmentId: a.assignmentId }), 'score_transfers_assignment_fkey')
    await violates(
      transfer({ sourceRubricScoreId: aScore.id }),
      'score_transfers_source_rubric_score_fkey',
    )
    await violates(
      transfer({ sourceRubricScoreId: null, sourceAttemptId: aAttemptId }),
      'score_transfers_source_attempt_fkey',
    )
    // B'nin kendi kaynağıyla aktarım geçer; A'nın satırları değişmedi.
    await transfer({})
    const [aRubric] = await db.select().from(rubrics).where(eq(rubrics.institutionId, aId))
    assert.equal(aRubric?.version, 1)
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
    await rejectsImmutable(
      db
        .update(submissionVersions)
        .set({ body: 'Değişti', version: sql`${submissionVersions.version} + 1`, updatedAt: LATER })
        .where(where),
      'submission_versions',
    )
    await rejectsImmutable(
      db.update(submissionVersions).set({ archivedAt: LATER }).where(where),
      'submission_versions',
    )
    // Sürüm ve zaman kolonlarına dokunmayan tek kolon güncellemesi de reddedilir.
    await rejectsImmutable(
      db.update(submissionVersions).set({ body: 'x' }).where(where),
      'submission_versions',
    )
    await rejectsImmutable(db.delete(submissionVersions).where(where), 'submission_versions')
    // Eklenen satır ilk sürümüyle ve arşivsiz gelir.
    await violates(
      db.insert(submissionVersions).values({
        institutionId,
        id: randomUUID(),
        submissionId: c.submissionId,
        versionNumber: 2,
        submittedAt: FIXED_NOW,
        body: 'Arşivli',
        ...at,
        archivedAt: FIXED_NOW,
      }),
      'submission_versions_version_check',
      '23514',
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
    await violates(version({ title: 'x'.repeat(201) }), 'rubric_versions_title_check')
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
      db.insert(rubricScores).values({
        institutionId,
        id: randomUUID(),
        submissionVersionId: c.submissionVersionId,
        rubricVersionId: c.rubricVersionId,
        raterUserId: owner,
        raterRole: 'final',
        criteria: [{ criterionId: 'task', band: 3, comment: null }],
        overallComment: 'x'.repeat(5001),
        scoredAt: FIXED_NOW,
        ...at,
      }),
      'rubric_scores_overall_comment_check',
    )
    await rejectsImmutable(
      db
        .update(rubricScores)
        .set({ overallComment: 'Değişti' })
        .where(eq(rubricScores.institutionId, institutionId)),
      'rubric_scores',
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

  test('IST-045, DOM-BEC-005 (OG-049): dinleme sayımı deneme × dosya × sırada tekil, en çok 2; deneme ve dosya aynı kurumun; satır değişmez, yalnız imha siler', async () => {
    const { institutionId, owner, chain: c } = await chain()
    const other = await chain()
    const attemptOf = async (institution: string, assignmentId: string) => {
      const id = randomUUID()
      await db.insert(taskAttempts).values({
        institutionId: institution,
        id,
        assignmentId,
        learnerId: LEARNER,
        attemptNumber: 1,
        startedAt: FIXED_NOW,
        ...at,
      })
      return id
    }
    const fileOf = async (institution: string, uploader: string) => {
      const id = randomUUID()
      await db.insert(files).values({
        institutionId: institution,
        id,
        purpose: 'listening_audio',
        status: 'ready',
        storageKey: `${institution}/listening_audio/2026/10/${id}`,
        contentType: 'audio/mpeg',
        byteSize: 1024,
        sha256: 'a'.repeat(64),
        uploadedByUserId: uploader,
        ...at,
      })
      return id
    }
    const attemptId = await attemptOf(institutionId, c.assignmentId)
    const fileId = await fileOf(institutionId, owner)
    const otherAttempt = await attemptOf(other.institutionId, other.chain.assignmentId)
    const otherFile = await fileOf(other.institutionId, other.owner)
    const play = (columns: Record<string, unknown> = {}) =>
      db.insert(attemptMediaPlays).values({
        institutionId,
        id: randomUUID(),
        attemptId,
        fileId,
        playNumber: 1,
        playedAt: FIXED_NOW,
        ...at,
        ...columns,
      })
    await play()
    await violates(play(), 'attempt_media_plays_attempt_file_number_key', '23505')
    await play({ playNumber: 2 })
    await violates(play({ playNumber: 3 }), 'attempt_media_plays_play_number_check')
    await violates(play({ playNumber: 0 }), 'attempt_media_plays_play_number_check')
    await violates(
      play({ attemptId: otherAttempt, playNumber: 1 }),
      'attempt_media_plays_attempt_fkey',
      '23503',
    )
    await violates(
      play({ fileId: otherFile, playNumber: 1 }),
      'attempt_media_plays_file_fkey',
      '23503',
    )
    await violates(
      play({ fileId: otherFile, attemptId: randomUUID(), version: 2 }),
      'attempt_media_plays_version_check',
    )
    const own = sql`attempt_media_plays.institution_id = ${institutionId}`
    await rejectsImmutable(
      db.execute(sql`update attempt_media_plays set play_number = 1 where ${own}`),
      'attempt_media_plays',
    )
    await rejectsImmutable(
      db.execute(sql`delete from attempt_media_plays where ${own}`),
      'attempt_media_plays',
    )
    await rejectsImmutable(db.execute(sql`truncate attempt_media_plays`), 'attempt_media_plays')
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local kampus.allow_immutable_purge = 'on'`)
      await tx.execute(sql`delete from attempt_media_plays where ${own}`)
    })
    const [remaining] = await rows<{ n: number }>(
      sql`select count(*)::int as n from attempt_media_plays where ${own}`,
    )
    assert.equal(remaining?.n, 0)
  })

  test('DOM-BEC-047 (OG-085): madde kontrolü deneme × soru × sırada tekil, en çok 2; deneme aynı kurumun; satır değişmez, yalnız imha siler', async () => {
    const { institutionId, chain: c } = await chain()
    const other = await chain()
    const attemptOf = async (institution: string, assignmentId: string) => {
      const id = randomUUID()
      await db.insert(taskAttempts).values({
        institutionId: institution,
        id,
        assignmentId,
        learnerId: LEARNER,
        attemptNumber: 1,
        startedAt: FIXED_NOW,
        ...at,
      })
      return id
    }
    const attemptId = await attemptOf(institutionId, c.assignmentId)
    const otherAttempt = await attemptOf(other.institutionId, other.chain.assignmentId)
    const checkRow = (columns: Record<string, unknown> = {}) =>
      db.insert(attemptItemChecks).values({
        institutionId,
        attemptId,
        questionVersionId: 'test-q-1',
        checkNumber: 1,
        response: { questionType: 'multiple_choice', optionId: 'a' },
        checkedAt: FIXED_NOW,
        ...at,
        ...columns,
      })
    await checkRow()
    await violates(checkRow(), 'attempt_item_checks_pkey', '23505')
    await checkRow({ checkNumber: 2 })
    await violates(checkRow({ checkNumber: 3 }), 'attempt_item_checks_number_check')
    await violates(checkRow({ checkNumber: 0 }), 'attempt_item_checks_number_check')
    await violates(checkRow({ response: [] }), 'attempt_item_checks_response_check')
    await violates(
      checkRow({ attemptId: otherAttempt }),
      'attempt_item_checks_attempt_fkey',
      '23503',
    )
    await violates(
      checkRow({ questionVersionId: 'test-q-2', version: 2 }),
      'attempt_item_checks_version_check',
    )
    const own = sql`attempt_item_checks.institution_id = ${institutionId}`
    await rejectsImmutable(
      db.execute(sql`update attempt_item_checks set check_number = 1 where ${own}`),
      'attempt_item_checks',
    )
    await rejectsImmutable(
      db.execute(sql`delete from attempt_item_checks where ${own}`),
      'attempt_item_checks',
    )
    await rejectsImmutable(db.execute(sql`truncate attempt_item_checks`), 'attempt_item_checks')
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local kampus.allow_immutable_purge = 'on'`)
      await tx.execute(sql`delete from attempt_item_checks where ${own}`)
    })
    const [remaining] = await rows<{ n: number }>(
      sql`select count(*)::int as n from attempt_item_checks where ${own}`,
    )
    assert.equal(remaining?.n, 0)
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
    await rejectsImmutable(
      db
        .update(resubmissionRequests)
        .set({ dueAt: new Date(LATER.getTime() + 1) })
        .where(eq(resubmissionRequests.institutionId, institutionId)),
      'resubmission_requests',
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
    await violates(appeal({ reason: 'x'.repeat(2001) }), 'score_appeals_reason_check')
    await violates(
      appeal({
        outcome: 'rejected',
        decidedAt: LATER,
        decidedByUserId: owner,
        decisionReason: 'x'.repeat(2001),
      }),
      'score_appeals_decision_reason_check',
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
    // Sahiplik: kaynak deneme aynı atamanın ve aynı kursiyerin denemesidir.
    const otherLearnerAttempt = randomUUID()
    const otherAssignment = randomUUID()
    const otherAssignmentAttempt = randomUUID()
    await db.insert(taskAssignments).values({
      institutionId,
      id: otherAssignment,
      ...teacherAssignment(c.resourceId, c.resourceVersionId, c.rubricVersionId),
      assignedByUserId: owner,
      ...at,
    })
    await db.insert(taskAttempts).values([
      {
        institutionId,
        id: otherLearnerAttempt,
        assignmentId: c.assignmentId,
        learnerId: 'test-s-diger',
        attemptNumber: 1,
        startedAt: FIXED_NOW,
        ...at,
      },
      {
        institutionId,
        id: otherAssignmentAttempt,
        assignmentId: otherAssignment,
        learnerId: LEARNER,
        attemptNumber: 1,
        startedAt: FIXED_NOW,
        ...at,
      },
    ])
    await violates(
      transfer({ sourceAttemptId: otherLearnerAttempt }),
      'score_transfers_source_attempt_fkey',
      '23503',
    )
    await violates(
      transfer({ sourceAttemptId: otherAssignmentAttempt }),
      'score_transfers_source_attempt_fkey',
    )
    await violates(transfer({ gradeType: 'katilim' }), 'score_transfers_grade_type_check')
    await violates(transfer({ score: 101 }), 'score_transfers_score_check')
    await transfer({})
    await violates(transfer({}), 'score_transfers_assignment_learner_key', '23505')
    await rejectsImmutable(
      db
        .update(scoreTransfers)
        .set({ score: 100 })
        .where(eq(scoreTransfers.institutionId, institutionId)),
      'score_transfers',
    )
    // Aktarımın kaynağı olan deneme silinemez.
    await violates(
      db.delete(taskAttempts).where(eq(taskAttempts.id, attemptId)),
      'score_transfers_source_attempt_fkey',
    )
  })

  test('DOM-BEC-040, 021, 060: değişmez dört tabloda kolon güncellemesi, silme ve truncate tetikleyiciyle reddedilir; imha işinin set local atlatması yalnız silmeye izin verir', async () => {
    const { institutionId, owner, chain: c } = await chain()
    const scoreId = randomUUID()
    await db.insert(rubricScores).values({
      institutionId,
      id: scoreId,
      submissionVersionId: c.submissionVersionId,
      rubricVersionId: c.rubricVersionId,
      raterUserId: owner,
      raterRole: 'first',
      criteria: [{ criterionId: 'task', band: 3, comment: null }],
      overallComment: 'İyi.',
      scoredAt: FIXED_NOW,
      ...at,
    })
    await db.insert(resubmissionRequests).values({
      institutionId,
      submissionId: c.submissionId,
      versionNumber: 1,
      dueAt: LATER,
      requestedByUserId: owner,
      requestedAt: FIXED_NOW,
      ...at,
    })
    await db.insert(scoreTransfers).values({
      institutionId,
      id: randomUUID(),
      assignmentId: c.assignmentId,
      learnerId: LEARNER,
      gradeType: 'performans',
      score: 80,
      sourceRubricScoreId: scoreId,
      gradeRecordId: 'test-grade-1',
      transferredByUserId: owner,
      transferredAt: LATER,
      ...at,
    })
    const own = (table: string) => sql`${sql.identifier(table)}.institution_id = ${institutionId}`
    // Silme sırası yabancı anahtarlara uyar: aktarım → puan → yeniden teslim isteği → sürüm.
    const tables = [
      ['score_transfers', sql`score = 100`],
      ['rubric_scores', sql`overall_comment = 'Değişti'`],
      ['resubmission_requests', sql`due_at = due_at + interval '1 day'`],
      ['submission_versions', sql`body = 'x'`],
    ] as const
    for (const [table, assignment] of tables) {
      await rejectsImmutable(
        db.execute(sql`update ${sql.identifier(table)} set ${assignment} where ${own(table)}`),
        table,
      )
      await rejectsImmutable(
        db.execute(sql`delete from ${sql.identifier(table)} where ${own(table)}`),
        table,
      )
    }
    await rejectsImmutable(db.execute(sql`truncate score_transfers`), 'score_transfers')

    // Atlatma güncellemeyi açmaz.
    await rejectsImmutable(
      db.transaction(async (tx) => {
        await tx.execute(sql`set local kampus.allow_immutable_purge = 'on'`)
        await tx.execute(
          sql`update score_transfers set score = 100 where ${own('score_transfers')}`,
        )
      }),
      'score_transfers',
    )
    // İmha işi: atlatma yalnız kendi transaction'ında geçerlidir.
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local kampus.allow_immutable_purge = 'on'`)
      for (const [table] of tables)
        await tx.execute(sql`delete from ${sql.identifier(table)} where ${own(table)}`)
    })
    for (const [table] of tables) {
      const [remaining] = await rows<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)} where ${own(table)}`,
      )
      assert.equal(remaining?.n, 0, table)
    }
    const [setting] = await rows<{ value: string | null }>(
      sql`select current_setting('kampus.allow_immutable_purge', true) as value`,
    )
    assert.notEqual(setting?.value, 'on')
  })
})
