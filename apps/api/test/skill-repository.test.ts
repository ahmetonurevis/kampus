import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import type { FixedAssignment } from '@kampus/school-core/skills/assignment.ts'
import type { RubricScoreRow } from '@kampus/school-core/skills/rubric.ts'

import type { Database } from '../src/db/client.ts'
import {
  scoreAppeals,
  submissionDrafts,
  taskAssignments,
  taskAttempts,
  taskSubmissions,
} from '../src/db/schema/skills.ts'
import {
  applyRubricArchive,
  applyRubricPublish,
  assignmentContentRefs,
  findAssignment,
  findAttempt,
  findRubric,
  findRubricVersion,
  findSubmission,
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
  listAssignments,
  listAttempts,
  listSubmissions,
  loadAppeals,
  loadAttempts,
  loadDraft,
  loadLearnersAttempts,
  loadResourceAssignments,
  loadRubricVersions,
  loadScoreTransfers,
  loadSubmission,
  loadSubmissionScores,
  rubricUsageByVersion,
  rubricVersionUsage,
  saveAttemptAnswers,
  saveDraft,
  submitAttempt,
  updateAssignmentDeadline,
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

/** Kullanıcı silmesinin karşılığı: satırı arşivler (`archived_at`, `version + 1`). */
const archive = { archivedAt: LATER, version: sql`version + 1` }

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

  test('DOM-BEC-022: rubrik sürümleri sırayla okunur; ikinci açık taslak, alınmış numara, ikinci yayındaki sürüm ve yayımlanmış sürümü düzenlemek 409', async () => {
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
    // Aynı numara (arşivli sürüm dahil) ve ikinci yayındaki sürüm 409.
    await rejectsWith(
      () =>
        insertRubricVersion(
          db,
          institutionId,
          {
            ...draft,
            id: randomUUID(),
            status: 'archived',
            publishedAt: iso(FIXED_NOW),
            archivedAt: iso(LATER),
          },
          LATER,
        ),
      409,
      'rubric_version_exists',
    )
    await rejectsWith(
      () =>
        insertRubricVersion(
          db,
          institutionId,
          {
            ...draft,
            id: randomUUID(),
            rubricId: c.rubricId,
            versionNumber: 2,
            status: 'published',
            publishedAt: iso(LATER),
          },
          LATER,
        ),
      409,
      'published_rubric_version_exists',
    )
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

  test('DOM-BEC-022: yayım önceki yayındaki sürümü aynı işlemde arşivler; eski satır sürümü ve plan dışı yayındaki sürüm 409; arşiv yalnız yayındakini', async () => {
    const { institutionId, owner, otherId, chain: c } = await setup()
    const draft = {
      ...sampleRubricData(),
      id: randomUUID(),
      rubricId: c.rubricId,
      versionNumber: 2,
      status: 'draft' as const,
      createdAt: iso(FIXED_NOW),
      publishedAt: null,
      archivedAt: null,
    }
    await insertRubricVersion(db, institutionId, draft, FIXED_NOW)
    const states = async () =>
      (await loadRubricVersions(db, institutionId, c.rubricId)).map((v) => ({
        id: v.id,
        status: v.status,
        publishedAt: v.publishedAt,
        archivedAt: v.archivedAt,
        rowVersion: v.rowVersion,
      }))
    const before = await states()
    const published = { id: c.rubricVersionId, rowVersion: 1 }
    const target = { id: draft.id, rowVersion: 1 }
    const plan = { publishedAt: iso(LATER), archiveVersionIds: [c.rubricVersionId] }

    // Plan önceki yayındaki sürümü atlarsa benzersiz indeks yayımı reddeder.
    await rejectsWith(
      () =>
        applyRubricPublish(
          db,
          institutionId,
          target,
          [published, target],
          { ...plan, archiveVersionIds: [] },
          LATER,
        ),
      409,
      'published_rubric_version_exists',
    )
    // Eski satır sürümü 0 satır görür; transaction önceki sürümün arşivini de geri alır.
    for (const [stale, versions] of [
      [{ ...target, rowVersion: 7 }, [published]],
      [target, [{ ...published, rowVersion: 7 }]],
      [target, []],
    ] as const) {
      await rejectsWith(
        () =>
          db.transaction((tx) =>
            applyRubricPublish(tx, institutionId, stale, versions, plan, LATER),
          ),
        409,
        'version_conflict',
      )
    }
    // Başka kurumun bağlamından aynı kimlikler yazılmaz.
    await rejectsWith(
      () =>
        db.transaction((tx) => applyRubricPublish(tx, otherId, target, [published], plan, LATER)),
      409,
      'version_conflict',
    )
    assert.deepEqual(await states(), before)

    await db.transaction((tx) =>
      applyRubricPublish(tx, institutionId, target, [published], plan, LATER),
    )
    assert.deepEqual(await states(), [
      {
        id: c.rubricVersionId,
        status: 'archived',
        publishedAt: iso(FIXED_NOW),
        archivedAt: iso(LATER),
        rowVersion: 2,
      },
      {
        id: draft.id,
        status: 'published',
        publishedAt: iso(LATER),
        archivedAt: null,
        rowVersion: 2,
      },
    ])
    // Yayımlanmış sürüm yeniden yayımlanmaz; arşivli sürüm yeniden arşivlenmez.
    await rejectsWith(
      () => applyRubricPublish(db, institutionId, { ...target, rowVersion: 2 }, [], plan, LATER),
      409,
      'version_conflict',
    )
    await rejectsWith(
      () =>
        applyRubricArchive(
          db,
          institutionId,
          { ...published, rowVersion: 2 },
          { archivedAt: iso(LATER) },
          LATER,
        ),
      409,
      'version_conflict',
    )
    await rejectsWith(
      () =>
        applyRubricArchive(
          db,
          otherId,
          { ...target, rowVersion: 2 },
          { archivedAt: iso(LATER) },
          LATER,
        ),
      409,
      'version_conflict',
    )
    await applyRubricArchive(
      db,
      institutionId,
      { ...target, rowVersion: 2 },
      { archivedAt: iso(LATER) },
      LATER,
    )
    const archived = await findRubricVersion(db, institutionId, draft.id)
    assert.equal(archived?.status, 'archived')
    assert.equal(archived?.archivedAt, iso(LATER))
    assert.equal(archived?.rowVersion, 3)

    // Kullanım tek sorguda sürüm başına sayılır; başka kurumda sıfırdır.
    const unknown = randomUUID()
    assert.deepEqual(
      [...(await rubricUsageByVersion(db, institutionId, [c.rubricVersionId, draft.id, unknown]))],
      [
        [c.rubricVersionId, { assignmentCount: 1, scoreCount: 0 }],
        [draft.id, { assignmentCount: 0, scoreCount: 0 }],
        [unknown, { assignmentCount: 0, scoreCount: 0 }],
      ],
    )
    assert.deepEqual(
      [...(await rubricUsageByVersion(db, otherId, [c.rubricVersionId]))],
      [[c.rubricVersionId, { assignmentCount: 0, scoreCount: 0 }]],
    )
    assert.deepEqual(await rubricUsageByVersion(db, institutionId, []), new Map())
    assert.deepEqual(await findRubric(db, institutionId, c.rubricId), {
      id: c.rubricId,
      ownerUserId: owner,
      createdAt: iso(FIXED_NOW),
    })
    assert.equal(await findRubric(db, otherId, c.rubricId), null)
  })

  test('ADR 0004 karar 4: atama sabit ayarları ve etkin hedefleriyle geri okunur; aynı hedef iki kez 409; deneme numarası tekil; arşivli deneme okunmaz', async () => {
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
    // Aynı hedef iki kez: hedef birincil anahtarı 409; transaction'la atama da yazılmaz.
    const duplicateId = randomUUID()
    await rejectsWith(
      () =>
        db.transaction((tx) =>
          insertAssignment(
            tx,
            institutionId,
            {
              id: duplicateId,
              assignedByUserId: owner,
              assignment,
              targets: [targets[0]!, targets[0]!],
            },
            FIXED_NOW,
          ),
        ),
      409,
      'assignment_target_exists',
    )
    assert.equal(await findAssignment(db, institutionId, duplicateId), null)

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
    await db
      .update(taskAttempts)
      .set(archive)
      .where(and(eq(taskAttempts.institutionId, institutionId), eq(taskAttempts.id, second.id)))
    assert.deepEqual(
      (await loadAttempts(db, institutionId, id, LEARNER)).map((row) => row.attemptNumber),
      [1],
    )
  })

  test('IST-034, DOM-BEC-044: atama listesi kurum, sahip, hedef, içerik ve tür süzgeciyle sayfalı; içerik başlığı okunur; son teslim beklenen sürümle yazılır, eski sürüm ve arşivli atama 409', async () => {
    const { institutionId, owner, otherId, chain: c } = await setup()
    const base: FixedAssignment = {
      resourceId: c.resourceId,
      resourceVersionId: c.resourceVersionId,
      scoringVersionId: c.resourceVersionId,
      rubricVersionId: null,
      scoringMode: 'auto',
      kind: 'practice',
      attempts: { kind: 'practice' },
      deadline: { dueAt: null, lateAcceptanceDays: 0 },
      timeLimitMinutes: null,
      listeningPlays: null,
      showTranscript: false,
      submission: null,
      highStakes: false,
      secondRatingPercent: 0,
    }
    const add = async (
      assignedByUserId: string,
      targets: { kind: 'student' | 'class' | 'group'; id: string }[],
      at: Date,
    ) => {
      const id = randomUUID()
      await insertAssignment(
        db,
        institutionId,
        { id, assignedByUserId, assignment: base, targets },
        at,
      )
      return id
    }
    const minute = (n: number) => new Date(FIXED_NOW.getTime() + n * 60_000)
    const toStudent = await add('test-teacher-a', [{ kind: 'student', id: 'test-s1' }], minute(1))
    const toClass = await add('test-teacher-b', [{ kind: 'class', id: 'test-c1' }], minute(2))
    const toOther = await add('test-teacher-a', [{ kind: 'student', id: 'test-s9' }], minute(3))
    // Başka kurumda aynı hedefe atama: hiçbir süzgeçte görünmez.
    const foreign = await seedSkillChain(db, otherId, owner)
    await insertAssignment(
      db,
      otherId,
      {
        id: randomUUID(),
        assignedByUserId: 'test-teacher-a',
        assignment: {
          ...base,
          resourceId: foreign.resourceId,
          resourceVersionId: foreign.resourceVersionId,
          scoringVersionId: foreign.resourceVersionId,
        },
        targets: [{ kind: 'student', id: 'test-s1' }],
      },
      minute(4),
    )
    const ids = async (query: Partial<Parameters<typeof listAssignments>[2]> = {}) => {
      const page = await listAssignments(db, institutionId, { page: 1, pageSize: 20, ...query })
      return { ids: page.rows.map((row) => row.id), total: page.total }
    }
    // En yeni önce; zincirin hedefsiz ataması da kurumdadır.
    assert.deepEqual(await ids(), { ids: [toOther, toClass, toStudent, c.assignmentId], total: 4 })
    assert.deepEqual(await ids({ pageSize: 2, page: 2 }), {
      ids: [toStudent, c.assignmentId],
      total: 4,
    })
    assert.deepEqual(await ids({ assignedByUserId: 'test-teacher-a' }), {
      ids: [toOther, toStudent],
      total: 2,
    })
    assert.deepEqual(
      await ids({ learnerTargets: { studentIds: ['test-s1'], classIds: ['test-c1'] } }),
      { ids: [toClass, toStudent], total: 2 },
    )
    // Sınıf kimliği öğrenci hedefiyle, öğrenci kimliği sınıf hedefiyle eşleşmez.
    assert.deepEqual(
      await ids({ learnerTargets: { studentIds: ['test-c1'], classIds: ['test-s1'] } }),
      { ids: [], total: 0 },
    )
    assert.deepEqual(await ids({ learnerTargets: { studentIds: [], classIds: [] } }), {
      ids: [],
      total: 0,
    })
    // DOM-YTK-028: öğretmen süzgeci "veya"dır: kendi ataması veya kapsamındaki hedef.
    assert.deepEqual(
      await ids({
        assignedByUserId: 'test-teacher-a',
        learnerTargets: { studentIds: [], classIds: ['test-c1'] },
      }),
      { ids: [toOther, toClass, toStudent], total: 3 },
    )
    assert.deepEqual(
      await ids({
        assignedByUserId: 'test-teacher-x',
        learnerTargets: { studentIds: [], classIds: [] },
      }),
      { ids: [], total: 0 },
    )
    assert.deepEqual(await ids({ kind: 'evaluation' }), { ids: [c.assignmentId], total: 1 })
    assert.deepEqual((await ids({ resourceId: foreign.resourceId })).total, 0)

    const refs = await assignmentContentRefs(db, institutionId, [
      c.resourceVersionId,
      foreign.resourceVersionId,
    ])
    assert.deepEqual(
      [...refs.entries()],
      [[c.resourceVersionId, { title: 'Okuma metni', contentType: 'text' }]],
    )
    assert.equal((await assignmentContentRefs(db, institutionId, [])).size, 0)

    // Son teslim: beklenen sürümle yazılır; eski sürüm ve başka kurum 409, satır değişmez.
    const deadline = { dueAt: iso(DUE_AT), lateAcceptanceDays: 3 }
    await updateAssignmentDeadline(
      db,
      institutionId,
      { id: toStudent, rowVersion: 1 },
      deadline,
      LATER,
    )
    const updated = await findAssignment(db, institutionId, toStudent)
    assert.deepEqual(
      [updated?.deadline, updated?.rowVersion, updated?.updatedAt],
      [deadline, 2, iso(LATER)],
    )
    await rejectsWith(
      () =>
        updateAssignmentDeadline(
          db,
          institutionId,
          { id: toStudent, rowVersion: 1 },
          base.deadline,
          LATER,
        ),
      409,
      'version_conflict',
    )
    await rejectsWith(
      () => updateAssignmentDeadline(db, otherId, { id: toClass, rowVersion: 1 }, deadline, LATER),
      409,
      'version_conflict',
    )
    assert.deepEqual((await findAssignment(db, institutionId, toClass))?.deadline, base.deadline)
    // Arşivli atama listede yok ve değiştirilemez.
    await db
      .update(taskAssignments)
      .set(archive)
      .where(and(eq(taskAssignments.institutionId, institutionId), eq(taskAssignments.id, toClass)))
    assert.deepEqual((await ids()).total, 3)
    await rejectsWith(
      () =>
        updateAssignmentDeadline(
          db,
          institutionId,
          { id: toClass, rowVersion: 2 },
          deadline,
          LATER,
        ),
      409,
      'version_conflict',
    )
  })

  test('DOM-BEC-010, DOM-BEC-042, DOM-BEC-043: deneme kimlikle ve sayfalı listede okunur; cevap ve teslim beklenen sürümle yazılır; teslimden sonra ve eski sürümle 409', async () => {
    const { institutionId, otherId, chain: c } = await setup()
    const other = 'test-s-diger'
    const rows = [
      { id: randomUUID(), learnerId: LEARNER, attemptNumber: 1 },
      { id: randomUUID(), learnerId: LEARNER, attemptNumber: 2 },
      { id: randomUUID(), learnerId: other, attemptNumber: 1 },
    ]
    for (const row of rows) {
      await insertAttempt(
        db,
        institutionId,
        { ...row, assignmentId: c.assignmentId, startedAt: iso(FIXED_NOW) },
        FIXED_NOW,
      )
    }
    const [first, second, third] = rows as [(typeof rows)[0], (typeof rows)[0], (typeof rows)[0]]
    const found = await findAttempt(db, institutionId, first.id)
    assert.equal(found?.attemptNumber, 1)
    assert.equal(found?.rowVersion, 1)
    assert.equal(await findAttempt(db, otherId, first.id), null)
    assert.equal(await findAttempt(db, institutionId, 'uuid-degil'), null)
    assert.equal(await findAttempt(db, institutionId, randomUUID()), null)

    const query = { assignmentId: c.assignmentId, page: 1, pageSize: 2 }
    const all = await listAttempts(db, institutionId, query)
    assert.equal(all.total, 3)
    assert.equal(all.rows.length, 2)
    const pageTwo = await listAttempts(db, institutionId, { ...query, page: 2 })
    assert.equal(pageTwo.rows.length, 1)
    const own = await listAttempts(db, institutionId, { ...query, learnerIds: [LEARNER] })
    assert.deepEqual(
      own.rows.map((row) => [row.learnerId, row.attemptNumber]),
      [
        [LEARNER, 1],
        [LEARNER, 2],
      ],
    )
    assert.deepEqual(await listAttempts(db, institutionId, { ...query, learnerIds: [] }), {
      rows: [],
      total: 0,
    })
    assert.equal((await listAttempts(db, otherId, query)).total, 0)
    assert.deepEqual(
      (await loadLearnersAttempts(db, institutionId, c.assignmentId, [other, other])).map(
        (row) => row.id,
      ),
      [third.id],
    )
    assert.deepEqual(await loadLearnersAttempts(db, institutionId, c.assignmentId, []), [])

    const answers = { q1: { kind: 'choice', optionId: 'a' } } as never
    const saved = await saveAttemptAnswers(
      db,
      institutionId,
      { id: first.id, rowVersion: 1 },
      answers,
      LATER,
    )
    assert.equal(saved, 2)
    await rejectsWith(
      () => saveAttemptAnswers(db, institutionId, { id: first.id, rowVersion: 1 }, answers, LATER),
      409,
      'version_conflict',
    )
    const submitted = await submitAttempt(
      db,
      institutionId,
      { id: first.id, rowVersion: 2 },
      { answers, submittedAt: iso(LATER) },
      LATER,
    )
    assert.equal(submitted, 3)
    const after = await findAttempt(db, institutionId, first.id)
    assert.deepEqual(
      [after?.submittedAt, after?.answers, after?.rowVersion],
      [iso(LATER), answers, 3],
    )
    // Teslim edilmiş deneme değişmez: güncel sürümle bile cevap ve ikinci teslim 409.
    await rejectsWith(
      () => saveAttemptAnswers(db, institutionId, { id: first.id, rowVersion: 3 }, {}, LATER),
      409,
      'version_conflict',
    )
    await rejectsWith(
      () =>
        submitAttempt(
          db,
          institutionId,
          { id: first.id, rowVersion: 3 },
          { answers: {}, submittedAt: iso(LATER) },
          LATER,
        ),
      409,
      'version_conflict',
    )
    await rejectsWith(
      () => saveAttemptAnswers(db, otherId, { id: second.id, rowVersion: 1 }, {}, LATER),
      409,
      'version_conflict',
    )
    await db
      .update(taskAttempts)
      .set(archive)
      .where(and(eq(taskAttempts.institutionId, institutionId), eq(taskAttempts.id, second.id)))
    assert.equal(await findAttempt(db, institutionId, second.id), null)
    assert.equal((await listAttempts(db, institutionId, query)).total, 2)
  })

  test('DOM-BEC-040: teslim kimlikle ve sayfalı listede sürümleriyle okunur; kapsam süzgeci, başka kurum ve arşivli teslim boş', async () => {
    const { institutionId, otherId, chain: c } = await setup()
    const found = await findSubmission(db, institutionId, c.submissionId)
    assert.equal(found?.submission.learnerId, LEARNER)
    assert.deepEqual(
      found?.versions.map((row) => row.id),
      [c.submissionVersionId],
    )
    assert.deepEqual(found, await loadSubmission(db, institutionId, c.assignmentId, LEARNER))
    assert.equal(await findSubmission(db, otherId, c.submissionId), null)
    assert.equal(await findSubmission(db, institutionId, 'uuid-degil'), null)

    const query = { assignmentId: c.assignmentId, page: 1, pageSize: 20 }
    const listed = await listSubmissions(db, institutionId, query)
    assert.equal(listed.total, 1)
    assert.deepEqual(listed.rows, [found])
    assert.deepEqual(
      await listSubmissions(db, institutionId, { ...query, learnerIds: ['test-s-yok'] }),
      { rows: [], total: 0 },
    )
    assert.deepEqual(await listSubmissions(db, institutionId, { ...query, learnerIds: [] }), {
      rows: [],
      total: 0,
    })
    assert.equal((await listSubmissions(db, otherId, query)).total, 0)
    await db
      .update(taskSubmissions)
      .set(archive)
      .where(
        and(
          eq(taskSubmissions.institutionId, institutionId),
          eq(taskSubmissions.id, c.submissionId),
        ),
      )
    assert.equal(await findSubmission(db, institutionId, c.submissionId), null)
    assert.equal((await listSubmissions(db, institutionId, query)).total, 0)
  })

  test('DOM-BEC-040: teslim tek; sürüm numarası tekil; yeniden teslim isteği son istekten okunur; dosyalı sürüm 422; arşivli teslim okunmaz', async () => {
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
    // TODO(F3c2-files) kapanana kadar dosyalı ve sesli sürüm yazılmadan 422 ile reddedilir.
    await rejectsWith(
      () =>
        insertSubmissionVersion(
          db,
          institutionId,
          c.submissionId,
          { ...version(2), fileIds: ['file-1'] },
          LATER,
        ),
      422,
      'submission_kind_unavailable',
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
    await db
      .update(taskSubmissions)
      .set(archive)
      .where(
        and(
          eq(taskSubmissions.institutionId, institutionId),
          eq(taskSubmissions.id, c.submissionId),
        ),
      )
    assert.equal(await loadSubmission(db, institutionId, c.assignmentId, LEARNER), null)
  })

  test('IST-047: taslak beklenen revizyonla yazılır; eski revizyon 409 draft_conflict; arşivli taslak okunmaz', async () => {
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
    await db
      .update(submissionDrafts)
      .set(archive)
      .where(
        and(
          eq(submissionDrafts.institutionId, institutionId),
          eq(submissionDrafts.assignmentId, c.assignmentId),
        ),
      )
    assert.equal(await loadDraft(db, institutionId, c.assignmentId, LEARNER), null)
  })

  test('DOM-BEC-021, 024, 025, 060: puan, ikinci puan isteği, itiraz ve not aktarımı teslim başına tekil; arşivli itiraz okunmaz', async () => {
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
    await db
      .update(scoreAppeals)
      .set(archive)
      .where(and(eq(scoreAppeals.institutionId, institutionId), eq(scoreAppeals.id, appeal.id)))
    assert.deepEqual(await loadAppeals(db, institutionId, c.submissionId), [])

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

  test('DOM-BEC-022, 025, 060: sahiplik: puanın rubrik sürümü atamanınkidir, itiraz kursiyerin kendi teslimine, aktarım aynı görev ve kursiyerin kaynağından; değilse 422, kaynak yoksa 404', async () => {
    const { institutionId, owner, chain: c } = await setup()
    // Aynı kurumda başka bir rubrik sürümü: atamaya sabitlenmemiş.
    const rubricId = randomUUID()
    await insertRubric(db, institutionId, { id: rubricId, ownerUserId: owner }, FIXED_NOW)
    const otherVersionId = randomUUID()
    await insertRubricVersion(
      db,
      institutionId,
      {
        ...sampleRubricData(),
        id: otherVersionId,
        rubricId,
        versionNumber: 1,
        status: 'draft',
        createdAt: iso(FIXED_NOW),
        publishedAt: null,
        archivedAt: null,
      },
      FIXED_NOW,
    )
    const score: RubricScoreRow = {
      id: randomUUID(),
      submissionVersionId: c.submissionVersionId,
      rubricVersionId: c.rubricVersionId,
      raterUserId: owner,
      raterRole: 'first',
      criteria: [{ criterionId: 'task', band: 4, comment: null }],
      overallComment: 'İyi.',
      scoredAt: iso(FIXED_NOW),
    }
    await rejectsWith(
      () =>
        insertRubricScore(db, institutionId, { ...score, rubricVersionId: otherVersionId }, LATER),
      422,
      'rubric_version_mismatch',
    )
    await rejectsWith(
      () =>
        insertRubricScore(
          db,
          institutionId,
          { ...score, submissionVersionId: randomUUID() },
          LATER,
        ),
      404,
      'not_found',
    )
    await insertRubricScore(db, institutionId, score, LATER)

    const appeal = {
      id: randomUUID(),
      submissionVersionId: c.submissionVersionId,
      learnerId: 'test-s-diger',
      filedByUserId: owner,
      reason: 'Dilbilgisi puanı yanlış hesaplandı.',
      filedAt: iso(LATER),
    }
    await rejectsWith(
      () => insertAppeal(db, institutionId, appeal, LATER),
      422,
      'appeal_learner_mismatch',
    )
    await rejectsWith(
      () =>
        insertAppeal(
          db,
          institutionId,
          { ...appeal, learnerId: LEARNER, submissionVersionId: randomUUID() },
          LATER,
        ),
      404,
      'not_found',
    )
    assert.deepEqual(await loadAppeals(db, institutionId, c.submissionId), [])

    const otherLearnerAttempt = {
      id: randomUUID(),
      assignmentId: c.assignmentId,
      learnerId: 'test-s-diger',
      attemptNumber: 1,
      startedAt: iso(FIXED_NOW),
    }
    await insertAttempt(db, institutionId, otherLearnerAttempt, FIXED_NOW)
    const transfer = {
      id: randomUUID(),
      assignmentId: c.assignmentId,
      learnerId: 'test-s-diger',
      gradeType: 'performans' as const,
      score: 70,
      sourceAttemptId: null,
      sourceRubricScoreId: score.id,
      gradeRecordId: 'test-grade-beceri',
      transferredByUserId: owner,
      transferredAt: iso(LATER),
    }
    // Rubrik puanı LEARNER'ındır; başka kursiyere aktarılamaz (depo denetimi).
    await rejectsWith(
      () => insertScoreTransfer(db, institutionId, transfer, LATER),
      422,
      'score_transfer_source_mismatch',
    )
    await rejectsWith(
      () =>
        insertScoreTransfer(
          db,
          institutionId,
          { ...transfer, sourceRubricScoreId: randomUUID() },
          LATER,
        ),
      404,
      'not_found',
    )
    // Başka kursiyerin denemesi LEARNER'a aktarılamaz (bileşik yabancı anahtar).
    await rejectsWith(
      () =>
        insertScoreTransfer(
          db,
          institutionId,
          {
            ...transfer,
            learnerId: LEARNER,
            sourceRubricScoreId: null,
            sourceAttemptId: otherLearnerAttempt.id,
          },
          LATER,
        ),
      422,
      'score_transfer_source_mismatch',
    )
    assert.deepEqual(await loadScoreTransfers(db, institutionId, c.assignmentId), [])
    await insertScoreTransfer(
      db,
      institutionId,
      { ...transfer, sourceRubricScoreId: null, sourceAttemptId: otherLearnerAttempt.id },
      LATER,
    )
    await insertScoreTransfer(
      db,
      institutionId,
      { ...transfer, id: randomUUID(), learnerId: LEARNER },
      LATER,
    )
    assert.equal((await loadScoreTransfers(db, institutionId, c.assignmentId)).length, 2)
  })
})
