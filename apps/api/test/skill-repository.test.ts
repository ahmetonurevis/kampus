import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import type { FixedAssignment } from '@kampus/school-core/skills/assignment.ts'
import type { RubricScoreRow } from '@kampus/school-core/skills/rubric.ts'

import type { Database } from '../src/db/client.ts'
import {
  findAssignment,
  findRubricVersion,
  insertAppeal,
  insertAssignment,
  insertAttempt,
  insertResubmissionRequest,
  insertRubric,
  insertRubricScore,
  insertRubricVersion,
  insertScoreTransfer,
  insertSecondRatingRequest,
  insertSubmission,
  insertSubmissionVersion,
  isSecondRatingRequested,
  loadAppeals,
  loadAttempts,
  loadDraft,
  loadResourceAssignments,
  loadRubricVersions,
  loadScoreTransfers,
  loadSubmission,
  loadSubmissionScores,
  rubricVersionUsage,
  saveDraft,
  updateRubricVersionDraft,
} from '../src/db/skills.ts'
import { AppError } from '../src/errors.ts'
import { buildTestApp, createInstitution, createTestDatabase, FIXED_NOW } from './support/app.ts'
import { DUE_AT, LEARNER, sampleRubricData, seedSkillChain } from './support/skills-sample.ts'

/**
 * Beceri görevi deposu (`src/db/skills.ts`; ADR 0004 karar 4–7). Okuma yardımcıları kurumla
 * süzer, yazmalar iyimser kilit ve benzersizlik ihlalini core'un 409 kodlarına çevirir.
 */

const LATER = new Date(FIXED_NOW.getTime() + 60_000)
const iso = (value: Date) => value.toISOString()

/** `work` verilen durum ve kodla `AppError` fırlatır (eşzamanlı yazmanın kullanıcıya dönen yüzü). */
async function rejectsWith(work: () => Promise<unknown>, statusCode: number, code: string) {
  await assert.rejects(work, (error: unknown) => {
    assert.ok(error instanceof AppError, String(error))
    assert.equal(error.statusCode, statusCode)
    assert.equal(error.code, code)
    return true
  })
}

describe('beceri görevi deposu', () => {
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

  async function setup() {
    const own = await createInstitution(app)
    const other = await createInstitution(app)
    const chain = await seedSkillChain(db, own.id, own.admin.id)
    return { institutionId: own.id, owner: own.admin.id, otherId: other.id, chain }
  }

  test('DOM-BEC-022: rubrik sürümleri sırayla okunur; ikinci açık taslak ve yayımlanmış sürümü düzenlemek 409', async () => {
    const { institutionId, owner, otherId, chain: c } = await setup()
    const rubricId = randomUUID()
    await insertRubric(db, institutionId, { id: rubricId, ownerUserId: owner }, FIXED_NOW)
    const draft = {
      ...sampleRubricData(),
      id: randomUUID(),
      rubricId,
      versionNumber: 1,
      status: 'draft' as const,
      createdAt: iso(FIXED_NOW),
      publishedAt: null,
      archivedAt: null,
    }
    await insertRubricVersion(db, institutionId, draft, FIXED_NOW)
    await rejectsWith(
      () =>
        insertRubricVersion(
          db,
          institutionId,
          { ...draft, id: randomUUID(), versionNumber: 2 },
          FIXED_NOW,
        ),
      409,
      'open_rubric_version_exists',
    )

    await updateRubricVersionDraft(
      db,
      institutionId,
      draft.id,
      1,
      { ...sampleRubricData(), title: 'Yazma rubriği (B1)' },
      LATER,
    )
    const [stored] = await loadRubricVersions(db, institutionId, rubricId)
    assert.deepEqual(stored, {
      ...draft,
      title: 'Yazma rubriği (B1)',
      updatedAt: iso(LATER),
      rowVersion: 2,
    })
    // Eski sürümle yazma ve yayımlanmış sürümü düzenleme 0 satır → 409.
    await rejectsWith(
      () => updateRubricVersionDraft(db, institutionId, draft.id, 1, sampleRubricData(), LATER),
      409,
      'version_conflict',
    )
    await rejectsWith(
      () =>
        updateRubricVersionDraft(
          db,
          institutionId,
          c.rubricVersionId,
          1,
          sampleRubricData(),
          LATER,
        ),
      409,
      'version_conflict',
    )
    // Başka kurumun bağlamından aynı kimlik görünmez ve yazılmaz.
    await rejectsWith(
      () => updateRubricVersionDraft(db, otherId, draft.id, 2, sampleRubricData(), LATER),
      409,
      'version_conflict',
    )
    assert.equal(await findRubricVersion(db, otherId, draft.id), null)
    assert.deepEqual(await loadRubricVersions(db, otherId, rubricId), [])
    assert.equal(
      (await findRubricVersion(db, institutionId, c.rubricVersionId))?.status,
      'published',
    )

    assert.deepEqual(await rubricVersionUsage(db, institutionId, c.rubricVersionId), {
      assignmentCount: 1,
      scoreCount: 0,
    })
    assert.deepEqual(await rubricVersionUsage(db, institutionId, draft.id), {
      assignmentCount: 0,
      scoreCount: 0,
    })
    assert.deepEqual(await rubricVersionUsage(db, otherId, c.rubricVersionId), {
      assignmentCount: 0,
      scoreCount: 0,
    })
  })

  test('ADR 0004 karar 4: atama sabit ayarları ve etkin hedefleriyle geri okunur; deneme numarası tekil', async () => {
    const { institutionId, owner, otherId, chain: c } = await setup()
    const assignment: FixedAssignment = {
      resourceId: c.resourceId,
      resourceVersionId: c.resourceVersionId,
      scoringVersionId: c.resourceVersionId,
      rubricVersionId: null,
      scoringMode: 'auto',
      kind: 'evaluation',
      attempts: { kind: 'evaluation', maxAttempts: 2, countPolicy: 'highest' },
      deadline: { dueAt: iso(DUE_AT), lateAcceptanceDays: 2 },
      timeLimitMinutes: 30,
      listeningPlays: 2,
      showTranscript: false,
      submission: null,
      highStakes: false,
      secondRatingPercent: 0,
    }
    const id = randomUUID()
    const targets = [
      { kind: 'student' as const, id: LEARNER },
      { kind: 'class' as const, id: 'test-c-beceri' },
    ]
    await insertAssignment(
      db,
      institutionId,
      { id, assignedByUserId: owner, assignment, targets },
      FIXED_NOW,
    )
    assert.deepEqual(await findAssignment(db, institutionId, id), {
      ...assignment,
      id,
      assignedByUserId: owner,
      targets: [targets[1], targets[0]],
      createdAt: iso(FIXED_NOW),
      updatedAt: iso(FIXED_NOW),
      archivedAt: null,
      rowVersion: 1,
    })
    assert.equal(await findAssignment(db, otherId, id), null)
    const ofResource = await loadResourceAssignments(db, institutionId, c.resourceId)
    assert.deepEqual(
      ofResource.map((row) => [row.id, row.attempts.kind, row.targets.length]),
      [
        [c.assignmentId, 'evaluation', 0],
        [id, 'evaluation', 2],
      ].sort((left, right) => (left[0]! < right[0]! ? -1 : 1)),
    )
    assert.deepEqual(await loadResourceAssignments(db, otherId, c.resourceId), [])

    const attempt = (attemptNumber: number) => ({
      id: randomUUID(),
      assignmentId: id,
      learnerId: LEARNER,
      attemptNumber,
      startedAt: iso(FIXED_NOW),
    })
    const second = attempt(2)
    await insertAttempt(db, institutionId, second, FIXED_NOW)
    await insertAttempt(db, institutionId, attempt(1), FIXED_NOW)
    await rejectsWith(
      () => insertAttempt(db, institutionId, attempt(2), FIXED_NOW),
      409,
      'attempt_in_progress',
    )
    const attempts = await loadAttempts(db, institutionId, id, LEARNER)
    assert.deepEqual(
      attempts.map((row) => row.attemptNumber),
      [1, 2],
    )
    assert.deepEqual(attempts[1], {
      ...second,
      submittedAt: null,
      answers: {},
      rowVersion: 1,
    })
    assert.deepEqual(await loadAttempts(db, otherId, id, LEARNER), [])
  })

  test('DOM-BEC-040: teslim tek; sürüm numarası tekil; yeniden teslim isteği son istekten okunur; dosyalı sürüm henüz saklanmaz', async () => {
    const { institutionId, owner, otherId, chain: c } = await setup()
    await rejectsWith(
      () =>
        insertSubmission(
          db,
          institutionId,
          { id: randomUUID(), assignmentId: c.assignmentId, learnerId: LEARNER },
          FIXED_NOW,
        ),
      409,
      'submission_exists',
    )
    const version = (number: number) => ({
      id: randomUUID(),
      number,
      submittedAt: iso(LATER),
      body: `Sürüm ${number}`,
      fileIds: [] as string[],
    })
    await rejectsWith(
      () => insertSubmissionVersion(db, institutionId, c.submissionId, version(1), LATER),
      409,
      'version_conflict',
    )
    // TODO(F3c2-files) kapanana kadar dosyalı sürüm yazılmadan reddedilir.
    await rejectsWith(
      async () =>
        insertSubmissionVersion(
          db,
          institutionId,
          c.submissionId,
          { ...version(2), fileIds: ['file-1'] },
          LATER,
        ),
      500,
      'internal_error',
    )
    const second = version(2)
    await insertSubmissionVersion(db, institutionId, c.submissionId, second, LATER)

    const request = (versionNumber: number, dueAt: Date) => ({
      versionNumber,
      dueAt: iso(dueAt),
      requestedByUserId: owner,
      requestedAt: iso(LATER),
    })
    const firstDue = new Date(LATER.getTime() + 86_400_000)
    const secondDue = new Date(LATER.getTime() + 2 * 86_400_000)
    await insertResubmissionRequest(db, institutionId, c.submissionId, request(1, firstDue), LATER)
    await insertResubmissionRequest(db, institutionId, c.submissionId, request(2, secondDue), LATER)
    await rejectsWith(
      () =>
        insertResubmissionRequest(db, institutionId, c.submissionId, request(2, firstDue), LATER),
      409,
      'resubmission_exists',
    )

    const loaded = await loadSubmission(db, institutionId, c.assignmentId, LEARNER)
    assert.deepEqual(loaded?.submission, {
      id: c.submissionId,
      assignmentId: c.assignmentId,
      learnerId: LEARNER,
      resubmissionRequestedForVersion: 2,
      resubmissionDueAt: iso(secondDue),
      rowVersion: 1,
    })
    assert.deepEqual(
      loaded?.versions.map((row) => row.number),
      [1, 2],
    )
    assert.deepEqual(loaded?.versions[1], second)
    assert.deepEqual(loaded?.resubmissions, [request(1, firstDue), request(2, secondDue)])
    assert.equal(await loadSubmission(db, otherId, c.assignmentId, LEARNER), null)
    assert.equal(await loadSubmission(db, institutionId, c.assignmentId, 'test-s-yok'), null)
  })

  test('IST-047: taslak beklenen revizyonla yazılır; eski revizyon 409 draft_conflict', async () => {
    const { institutionId, otherId, chain: c } = await setup()
    assert.equal(await loadDraft(db, institutionId, c.assignmentId, LEARNER), null)
    const draft = (revision: number, body: string) => ({
      learnerId: LEARNER,
      body,
      revision,
      savedAt: iso(LATER),
    })
    assert.deepEqual(
      await saveDraft(db, institutionId, c.assignmentId, draft(1, 'İlk'), LATER),
      draft(1, 'İlk'),
    )
    // İki pencere aynı revizyondan başladı: ikinci yazma kaybeder.
    await rejectsWith(
      () => saveDraft(db, institutionId, c.assignmentId, draft(1, 'Öteki pencere'), LATER),
      409,
      'draft_conflict',
    )
    await saveDraft(db, institutionId, c.assignmentId, draft(2, 'İkinci'), LATER)
    await rejectsWith(
      () => saveDraft(db, institutionId, c.assignmentId, draft(2, 'Eski'), LATER),
      409,
      'draft_conflict',
    )
    assert.deepEqual(
      await loadDraft(db, institutionId, c.assignmentId, LEARNER),
      draft(2, 'İkinci'),
    )
    assert.equal(await loadDraft(db, otherId, c.assignmentId, LEARNER), null)
    await rejectsWith(
      () => saveDraft(db, otherId, c.assignmentId, draft(3, 'Başka kurum'), LATER),
      409,
      'draft_conflict',
    )
  })

  test('DOM-BEC-021, 024, 025, 060: puan, ikinci puan isteği, itiraz ve not aktarımı teslim başına tekil', async () => {
    const { institutionId, owner, otherId, chain: c } = await setup()
    const score = (raterRole: RubricScoreRow['raterRole'], scoredAt: Date): RubricScoreRow => ({
      id: randomUUID(),
      submissionVersionId: c.submissionVersionId,
      rubricVersionId: c.rubricVersionId,
      raterUserId: owner,
      raterRole,
      criteria: [
        { criterionId: 'task', band: 4, comment: null },
        { criterionId: 'grammar', band: 3, comment: 'Zaman uyumu.' },
      ],
      overallComment: 'Genel olarak iyi.',
      scoredAt: iso(scoredAt),
    })
    const first = score('first', FIXED_NOW)
    const final = score('final', LATER)
    await insertRubricScore(db, institutionId, final, LATER)
    await insertRubricScore(db, institutionId, first, FIXED_NOW)
    await rejectsWith(
      () => insertRubricScore(db, institutionId, score('first', LATER), LATER),
      409,
      'rubric_score_exists',
    )
    assert.deepEqual(await loadSubmissionScores(db, institutionId, c.submissionId), [first, final])
    assert.deepEqual(await loadSubmissionScores(db, otherId, c.submissionId), [])
    assert.deepEqual(await rubricVersionUsage(db, institutionId, c.rubricVersionId), {
      assignmentCount: 1,
      scoreCount: 2,
    })

    assert.equal(await isSecondRatingRequested(db, institutionId, c.submissionId), false)
    const secondRating = {
      submissionId: c.submissionId,
      source: 'sample' as const,
      requestedByUserId: null,
      requestedAt: iso(FIXED_NOW),
    }
    assert.equal(await insertSecondRatingRequest(db, institutionId, secondRating, FIXED_NOW), true)
    // Örneklem yeniden çekilirse var olan istek korunur.
    assert.equal(await insertSecondRatingRequest(db, institutionId, secondRating, LATER), false)
    assert.equal(await isSecondRatingRequested(db, institutionId, c.submissionId), true)
    assert.equal(await isSecondRatingRequested(db, otherId, c.submissionId), false)

    const appeal = {
      id: randomUUID(),
      submissionVersionId: c.submissionVersionId,
      learnerId: LEARNER,
      filedByUserId: owner,
      reason: 'Dilbilgisi puanı yanlış hesaplandı.',
      filedAt: iso(LATER),
    }
    await insertAppeal(db, institutionId, appeal, LATER)
    await rejectsWith(
      () => insertAppeal(db, institutionId, { ...appeal, id: randomUUID() }, LATER),
      409,
      'appeal_exists',
    )
    assert.deepEqual(await loadAppeals(db, institutionId, c.submissionId), [
      {
        ...appeal,
        decidedByUserId: null,
        decidedAt: null,
        outcome: null,
        decisionReason: null,
        rowVersion: 1,
      },
    ])
    assert.deepEqual(await loadAppeals(db, otherId, c.submissionId), [])

    const transfer = {
      id: randomUUID(),
      assignmentId: c.assignmentId,
      learnerId: LEARNER,
      gradeType: 'performans' as const,
      score: 70,
      sourceAttemptId: null,
      sourceRubricScoreId: final.id,
      gradeRecordId: 'test-grade-beceri',
      transferredByUserId: owner,
      transferredAt: iso(LATER),
    }
    await insertScoreTransfer(db, institutionId, transfer, LATER)
    await rejectsWith(
      () => insertScoreTransfer(db, institutionId, { ...transfer, id: randomUUID() }, LATER),
      409,
      'score_transfer_exists',
    )
    assert.deepEqual(await loadScoreTransfers(db, institutionId, c.assignmentId), [transfer])
    assert.deepEqual(await loadScoreTransfers(db, otherId, c.assignmentId), [])
  })
})
