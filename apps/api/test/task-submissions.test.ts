import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import type { ResourceVersionInput } from '@kampus/school-core/content/resource.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { records } from '../src/db/schema/records.ts'
import { resourceVersions } from '../src/db/schema/resources.ts'
import { insertRubricScore, insertSecondRatingRequest } from '../src/db/skills.ts'
import {
  rubrics,
  rubricVersions,
  submissionDrafts,
  submissionVersions,
  taskSubmissions,
} from '../src/db/schema/skills.ts'
import { AppError } from '../src/errors.ts'
import type { ServiceContext } from '../src/plugins/authenticate.ts'
import { taskAssignmentDetailResponseSchema } from '../src/routes/task-assignments.schemas.ts'
import {
  getTaskDraft,
  saveTaskDraft,
  submitTaskSubmission,
} from '../src/services/task-submissions.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { seedResource } from './support/resources-sample.ts'
import { sampleRubricData } from './support/skills-sample.ts'

/**
 * Yazma görevinin taslak ve teslim uçları (F4b3a; ADR 0004 karar 6; DOM-BEC-023, 040, 044, 046;
 * IST-047, IST-051; DOM-YTK-028). Kural core `skills/submission.ts`'tedir; burada rol × kapsam,
 * taslak iyimser kilidi (ilk kayıt başlıksız, sonra `If-Match`), tek teslim kaydı ve değişmez
 * sürümler, `maxVersions`, teslim penceresi ve geç kabul, sınıf değişimi, taslağın teslim
 * okumasında dönmemesi ve log/denetimde metin ile öğrenci kimliğinin olmadığı denetlenir.
 */

type Json = ReturnType<typeof JSON.parse>

const MINUTE = 60_000
const DUE = '2026-10-20T20:59:00.000Z'
const SECRET_TEXT = 'GIZLI-YAZI my weekend was very nice'
const DRAFT_TEXT = 'GIZLI-TASLAK first lines'

const homework = (): Partial<ResourceVersionInput> => ({
  title: 'Hafta sonu yazısı',
  content: {
    type: 'homework_template',
    instructions: 'Hafta sonunu anlatan kısa bir metin yaz.',
    submissionKinds: ['text'],
    criteria: 'Zaman ifadeleri, paragraf düzeni ve yazım.',
    rubricId: null,
  },
  license: { kind: 'institution_original' },
  tags: { subjectId: 'ingilizce', gradeLevels: [9], primarySkill: 'writing', cefrLevel: 'A2' },
})

const question = (): Partial<ResourceVersionInput> => ({
  title: 'Soru',
  content: {
    type: 'question',
    question: {
      questionType: 'multiple_choice',
      stem: 'What does Tom do?',
      options: [
        { id: 'a', text: 'He swims.' },
        { id: 'b', text: 'He reads.' },
        { id: 'c', text: 'He cooks.' },
        { id: 'd', text: 'He sleeps.' },
      ],
    },
  },
  answerKey: { questionType: 'multiple_choice', correctOptionId: 'b', explanation: 'Okuyor.' },
  license: { kind: 'institution_original' },
  tags: { subjectId: 'ingilizce', gradeLevels: [9], primarySkill: 'reading', cefrLevel: 'A2' },
})

describe('yazma görevi taslak ve teslim uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let now = FIXED_NOW
  const logs: string[] = []

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { logs, clock: () => now })
  })
  after(async () => {
    await app.close()
    await close()
  })

  /**
   * `t-eng` 9-A'nın öğretmenidir, `t-mat` 9-B'nin. Deniz (`s-1`) 9-A'da, Can (`s-3`) 9-B'de.
   * Veli Deniz'in velisidir. Yazma şablonu, tek soru ve yayında bir rubrik sürümü vardır.
   */
  async function tenant() {
    now = FIXED_NOW
    const institution = await createInstitution(app)
    await insertMissingRecords(
      db,
      institution.id,
      [
        {
          collection: 'teachers',
          id: 't-eng',
          data: { id: 't-eng', name: 'Selin Kaya', subjectId: 'ingilizce', branchId: 'b-1' },
        },
        {
          collection: 'teachers',
          id: 't-mat',
          data: { id: 't-mat', name: 'Murat Demir', subjectId: 'matematik', branchId: 'b-1' },
        },
        ...['9-A', '9-B'].map((id, index) => ({
          collection: 'classes' as const,
          id,
          data: { id, grade: 9, level: '9', branchId: 'b-1', teacherId: ['t-eng', 't-mat'][index] },
        })),
        ...[
          ['s-1', 'Deniz Yılmaz', '9-A'],
          ['s-3', 'Can Arslan', '9-B'],
        ].map(([id, name, classId]) => ({
          collection: 'students' as const,
          id: id!,
          data: { id, name, classId, isActive: true },
        })),
        {
          collection: 'assignments',
          id: 'as-1',
          data: { id: 'as-1', classId: '9-A', teacherId: 't-eng', subjectId: 'ingilizce' },
        },
        {
          collection: 'assignments',
          id: 'as-2',
          data: { id: 'as-2', classId: '9-B', teacherId: 't-mat', subjectId: 'matematik' },
        },
      ],
      FIXED_NOW,
    )
    const member = (role: 'ogretmen' | 'ogrenci' | 'veli', kind: string, recordId: string) =>
      createMember(app, institution.id, role, [{ kind, recordId } as never])
    const teacher = await member('ogretmen', 'teacher', 't-eng')
    const cookies = {
      admin: await signInAs(app, institution.admin),
      teacher: await signInAs(app, teacher),
      otherTeacher: await signInAs(app, await member('ogretmen', 'teacher', 't-mat')),
      student: await signInAs(app, await member('ogrenci', 'student', 's-1')),
      otherStudent: await signInAs(app, await member('ogrenci', 'student', 's-3')),
      parent: await signInAs(app, await member('veli', 'child', 's-1')),
      frontDesk: await signInAs(app, await createMember(app, institution.id, 'onburo')),
    }
    const seed = async (input: Partial<ResourceVersionInput>) =>
      (
        await seedResource(db, institution.id, {
          ownerUserId: teacher.id,
          versions: [{ status: 'published', input }],
        })
      ).versions[0]!.id
    const rubricId = randomUUID()
    const rubricVersionId = randomUUID()
    const at = { createdAt: FIXED_NOW, updatedAt: FIXED_NOW }
    await db
      .insert(rubrics)
      .values({ institutionId: institution.id, id: rubricId, ownerUserId: teacher.id, ...at })
    await db.insert(rubricVersions).values({
      institutionId: institution.id,
      id: rubricVersionId,
      rubricId,
      versionNumber: 1,
      status: 'published',
      ...sampleRubricData(),
      publishedAt: FIXED_NOW,
      ...at,
    })
    return {
      institution,
      cookies,
      seed,
      teacherId: teacher.id,
      homeworkId: await seed(homework()),
      otherHomeworkId: await seed(homework()),
      questionId: await seed(question()),
      rubricVersionId,
    }
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  function call(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    cookie?: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie ? { cookie } : {}),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const key = () => ({ 'idempotency-key': randomUUID() })
  const revision = (value: number) => ({ 'if-match': `"${value}"` })

  async function ok(response: Awaited<ReturnType<typeof call>>, status = 200) {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function fails(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
    assert.equal(response.statusCode, status, response.body)
    assert.equal(response.json().code, code, response.body)
  }

  /** Öğretmen 9-A'ya yazma görevi atar; teslim ayarı core `submissionSettingsSchema`. */
  async function assign(
    t: Tenant,
    settings: Record<string, unknown> = {},
    resourceVersionId = t.homeworkId,
  ) {
    const data = await ok(
      await call(
        'POST',
        '/task-assignments',
        t.cookies.teacher,
        {
          resourceVersionId,
          settings: {
            deadline: { dueAt: DUE },
            submission: { submissionKind: 'text', maxVersions: 3 },
            rubricVersionId: t.rubricVersionId,
            ...settings,
          },
          targets: [{ kind: 'class', id: '9-A' }],
        },
        key(),
      ),
      201,
    )
    return data.id as string
  }
  async function assignQuestion(t: Tenant) {
    const data = await ok(
      await call(
        'POST',
        '/task-assignments',
        t.cookies.teacher,
        {
          resourceVersionId: t.questionId,
          settings: { deadline: { dueAt: DUE } },
          targets: [{ kind: 'class', id: '9-A' }],
        },
        key(),
      ),
      201,
    )
    return data.id as string
  }
  const submit = (
    assignmentId: string,
    cookie = '',
    payload: unknown = { submissionKind: 'text', body: SECRET_TEXT },
    headers: Record<string, string> = key(),
  ) => call('POST', `/task-assignments/${assignmentId}/submissions`, cookie, payload, headers)
  const saveDraft = (
    assignmentId: string,
    cookie: string,
    body: string,
    headers: Record<string, string> = {},
  ) => call('PATCH', `/task-assignments/${assignmentId}/draft`, cookie, { body }, headers)
  const readDraft = (assignmentId: string, cookie: string) =>
    call('GET', `/task-assignments/${assignmentId}/draft`, cookie)
  const list = (assignmentId: string, cookie: string, extra = '') =>
    call('GET', `/task-submissions?assignmentId=${assignmentId}${extra}`, cookie)
  const detail = (submissionId: string, cookie: string) =>
    call('GET', `/task-submissions/${submissionId}`, cookie)

  async function storedRows(institutionId: string) {
    const [submissions, versions, drafts] = await Promise.all([
      db.select().from(taskSubmissions).where(eq(taskSubmissions.institutionId, institutionId)),
      db
        .select()
        .from(submissionVersions)
        .where(eq(submissionVersions.institutionId, institutionId)),
      db.select().from(submissionDrafts).where(eq(submissionDrafts.institutionId, institutionId)),
    ])
    return { submissions: submissions.length, versions: versions.length, drafts: drafts.length }
  }

  /** Teslim, sürüm, taslak satırları (taslak revizyonuyla) ve denetim kayıtları. */
  async function snapshot(institutionId: string) {
    const [drafts, audits] = await Promise.all([
      db
        .select({ version: submissionDrafts.version, body: submissionDrafts.body })
        .from(submissionDrafts)
        .where(eq(submissionDrafts.institutionId, institutionId)),
      db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(eq(auditLog.institutionId, institutionId)),
    ])
    return { ...(await storedRows(institutionId)), drafts, audits: audits.length }
  }

  /** Öğretmenin yayındaki yazma şablonu; kaynak ve sürüm kimliğiyle. */
  async function seedOwned(
    t: Tenant,
    input: Partial<ResourceVersionInput> = homework(),
    share: { shareScope?: 'students'; sharedStudentIds?: string[] } = {},
  ) {
    const { resource, versions } = await seedResource(db, t.institution.id, {
      ownerUserId: t.teacherId,
      ...share,
      versions: [{ status: 'published', input }],
    })
    return { resourceId: resource.id, versionId: versions[0]!.id }
  }

  /** Yönetici 9-A ve 9-B'ye yazma görevi atar: Deniz ve Can hedeflenir. */
  async function assignBoth(t: Tenant, resourceVersionId: string) {
    const data = await ok(
      await call(
        'POST',
        '/task-assignments',
        t.cookies.admin,
        {
          resourceVersionId,
          settings: {
            deadline: { dueAt: DUE },
            submission: { submissionKind: 'text', maxVersions: 3 },
            rubricVersionId: t.rubricVersionId,
          },
          targets: [
            { kind: 'class', id: '9-A' },
            { kind: 'class', id: '9-B' },
          ],
        },
        key(),
      ),
      201,
    )
    return data.id as string
  }

  /** Başka kurumda aynı kayıt kimliğine (`s-1`) bağlı öğrenci. */
  async function foreignStudent() {
    const other = await createInstitution(app)
    await insertMissingRecords(
      db,
      other.id,
      [
        {
          collection: 'classes',
          id: '9-A',
          data: { id: '9-A', grade: 9, level: '9', branchId: 'b-1' },
        },
        {
          collection: 'students',
          id: 's-1',
          data: { id: 's-1', name: 'Deniz Yılmaz', classId: '9-A', isActive: true },
        },
      ],
      FIXED_NOW,
    )
    return signInAs(
      app,
      await createMember(app, other.id, 'ogrenci', [{ kind: 'student', recordId: 's-1' } as never]),
    )
  }

  test('DOM-BEC-040, DOM-YTK-028: 401; ön büro 403; yazma ve taslak yalnız öğrenci; hedeflenmeyen öğrenci ve başka kurum 404; modül kapalıyken 403 module_disabled', async () => {
    const t = await tenant()
    const assignmentId = await assign(t)
    fails(await submit(assignmentId), 401, 'unauthenticated')
    fails(await list(assignmentId, t.cookies.frontDesk), 403, 'forbidden')
    for (const cookie of [
      t.cookies.parent,
      t.cookies.teacher,
      t.cookies.admin,
      t.cookies.frontDesk,
    ]) {
      fails(await submit(assignmentId, cookie), 403, 'forbidden')
      fails(await saveDraft(assignmentId, cookie, 'x'), 403, 'forbidden')
      fails(await readDraft(assignmentId, cookie), 403, 'forbidden')
    }
    fails(await submit(assignmentId, t.cookies.otherStudent), 404, 'not_found')
    fails(await saveDraft(assignmentId, t.cookies.otherStudent, 'x'), 404, 'not_found')
    fails(await readDraft(assignmentId, t.cookies.otherStudent), 404, 'not_found')
    fails(await list(assignmentId, t.cookies.otherStudent), 404, 'not_found')
    fails(await list(assignmentId, t.cookies.otherTeacher), 404, 'not_found')
    fails(
      await submit(assignmentId, t.cookies.student, undefined, {}),
      400,
      'idempotency_key_required',
    )
    fails(
      await submit(assignmentId, t.cookies.student, undefined, { ...key(), ...revision(1) }),
      400,
      'if_match_not_supported',
    )
    // Gövde katı: istemci puanı veya sürüm numarası 400; boş metin 400.
    fails(
      await submit(assignmentId, t.cookies.student, {
        submissionKind: 'text',
        body: 'a',
        score: 9,
      }),
      400,
      'validation_failed',
    )
    fails(
      await submit(assignmentId, t.cookies.student, { submissionKind: 'text', body: '   ' }),
      400,
      'validation_failed',
    )
    // Görevin türünden başka teslim (metin görevine dosya) 422 (OG-048).
    fails(
      await submit(assignmentId, t.cookies.student, {
        submissionKind: 'file',
        fileIds: ['f-1'],
      }),
      422,
      'submission_kind_mismatch',
    )
    assert.deepEqual(await storedRows(t.institution.id), { submissions: 0, versions: 0, drafts: 0 })

    const created = await ok(await submit(assignmentId, t.cookies.student), 201)
    const other = await createInstitution(app)
    const otherAdmin = await signInAs(app, other.admin)
    fails(await detail(created.id, otherAdmin), 404, 'not_found')
    fails(await list(assignmentId, otherAdmin), 404, 'not_found')
    fails(await detail(created.id, t.cookies.otherTeacher), 404, 'not_found')
    fails(await detail(created.id, t.cookies.otherStudent), 404, 'not_found')

    const closed = await createInstitution(app, { enabledModules: { learning: false } })
    const admin = await signInAs(app, closed.admin)
    const id = '00000000-0000-4000-8000-000000000001'
    for (const response of await Promise.all([
      list(id, admin),
      detail(id, admin),
      readDraft(id, admin),
      saveDraft(id, admin, 'x'),
      submit(id, admin),
    ]))
      fails(response, 403, 'module_disabled')
  })

  test('IST-047: taslak ilk kayıtta If-Match istemez; taslak varken başlıksız 400 if_match_required, eski revizyon 409 draft_conflict; yalnız öğrenci görür, teslim okumasında dönmez', async () => {
    const t = await tenant()
    const assignmentId = await assign(t, {
      submission: { submissionKind: 'text', maxVersions: 3, minWords: 3, maxWords: 50 },
    })
    assert.equal(await ok(await readDraft(assignmentId, t.cookies.student)), null)
    fails(await saveDraft(assignmentId, t.cookies.student, 'x', revision(1)), 409, 'draft_conflict')

    const first = await ok(await saveDraft(assignmentId, t.cookies.student, 'one'))
    assert.equal(first.revision, 1)
    assert.deepEqual(first.wordCount, {
      count: 1,
      status: 'below',
      warning: 'Metin 1 sözcük; en az 3 sözcük isteniyor.',
    })
    fails(await saveDraft(assignmentId, t.cookies.student, 'two'), 400, 'if_match_required')
    const second = await ok(
      await saveDraft(assignmentId, t.cookies.student, DRAFT_TEXT, revision(1)),
    )
    assert.equal(second.revision, 2)
    fails(
      await saveDraft(assignmentId, t.cookies.student, 'stale', revision(1)),
      409,
      'draft_conflict',
    )
    const stored = await ok(await readDraft(assignmentId, t.cookies.student))
    assert.equal(stored.body, DRAFT_TEXT)
    assert.equal(stored.revision, 2)

    const created = await ok(await submit(assignmentId, t.cookies.student), 201)
    for (const cookie of [t.cookies.student, t.cookies.teacher, t.cookies.parent])
      assert.ok(!(await detail(created.id, cookie)).body.includes('GIZLI-TASLAK'))
    // Taslak kaydı denetime yazılmaz.
    const audits = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, t.institution.id), eq(auditLog.entityType, 'task_draft')),
      )
    assert.deepEqual(audits, [])

    // Otomatik puanlı görevde taslak ve teslim yoktur.
    const auto = await assignQuestion(t)
    fails(await saveDraft(auto, t.cookies.student, 'x'), 422, 'draft_not_supported')
    fails(await submit(auto, t.cookies.student), 422, 'submission_not_expected')
  })

  test('DOM-BEC-040, DOM-BEC-046: tek teslim kaydı ve değişmez sürümler; maxVersions dolunca 422; aynı anahtar tekrarı yeni sürüm açmaz; yazma puanlanmaz', async () => {
    const t = await tenant()
    const assignmentId = await assign(t, {
      submission: { submissionKind: 'text', maxVersions: 2, minWords: 10, maxWords: null },
    })
    const headers = key()
    const response = await submit(assignmentId, t.cookies.student, undefined, headers)
    const first = await ok(response, 201)
    assert.equal(response.headers.location, `/api/v1/task-submissions/${first.id}`)
    assert.equal(first.status, 'submitted')
    assert.equal(first.versionCount, 1)
    assert.equal(first.learnerId, 's-1')
    assert.equal(first.versions[0].body, SECRET_TEXT)
    assert.equal(first.versions[0].late, false)
    // Sözcük sınırı dışındaki metin uyarıyla kabul edilir.
    assert.equal(first.versions[0].wordCount.status, 'below')
    assert.deepEqual(first.allowance, {
      limit: 2,
      used: 1,
      remaining: 1,
      resubmissionOpen: false,
      canSubmit: true,
      blockedBy: null,
    })
    assert.equal('score' in first, false)
    const replay = await submit(assignmentId, t.cookies.student, undefined, headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')

    const second = await ok(
      await submit(assignmentId, t.cookies.student, {
        submissionKind: 'text',
        body: 'Second version of the text.',
      }),
      201,
    )
    assert.equal(second.id, first.id)
    assert.deepEqual(
      second.versions.map((v: Json) => [v.number, v.body]),
      [
        [1, SECRET_TEXT],
        [2, 'Second version of the text.'],
      ],
    )
    fails(await submit(assignmentId, t.cookies.student), 422, 'version_limit_reached')
    assert.deepEqual(await storedRows(t.institution.id), { submissions: 1, versions: 2, drafts: 0 })

    // Teslim metni değişmez (tetikleyici).
    await assert.rejects(
      db
        .update(submissionVersions)
        .set({ body: 'değişti' })
        .where(eq(submissionVersions.institutionId, t.institution.id)),
    )

    // Öğretmen, yönetici ve veli okur; liste metin taşımaz.
    for (const cookie of [
      t.cookies.teacher,
      t.cookies.admin,
      t.cookies.parent,
      t.cookies.student,
    ]) {
      const rows = await ok(await list(assignmentId, cookie))
      assert.deepEqual(
        rows.map((row: Json) => [row.id, row.versionCount, row.latestVersion.number]),
        [[first.id, 2, 2]],
      )
      assert.equal('body' in rows[0].latestVersion, false)
      assert.equal((await ok(await detail(first.id, cookie))).versions.length, 2)
    }
    assert.deepEqual(await ok(await list(assignmentId, t.cookies.teacher, '&learnerId=s-3')), [])
  })

  test('IST-019 DOM-ILT-074 OG-032: iletişimi kısıtlanan veli çocuğun görevini ve teslimini okuyamaz (404); kısıt kalkınca yeniden okur', async () => {
    const t = await tenant()
    const assignmentId = await assign(t)
    const submission = await ok(await submit(assignmentId, t.cookies.student), 201)
    // İkinci veli; öbür veli velayetli kalır (öğrencide velayet sahibi bulunur, DOM-ILT-075).
    const second = await createMember(app, t.institution.id, 'veli', [
      { kind: 'child', recordId: 's-1' },
    ])
    const parent = await signInAs(app, second)
    const bond = async (body: Record<string, unknown>) => {
      const bonds = await ok(await call('GET', '/students/s-1/guardians', t.cookies.admin))
      const own = bonds.find((row: Json) => row.membershipId === second.membershipId)
      assert.ok(own)
      await ok(
        await call('PATCH', `/students/s-1/guardians/${own.id}`, t.cookies.admin, body, {
          'if-match': `"${own.rowVersion}"`,
        }),
      )
    }
    const visible = async () => {
      const assignments = await ok(await call('GET', '/task-assignments', parent))
      assert.deepEqual(
        assignments.map((row: Json) => row.id),
        [assignmentId],
      )
      await ok(await call('GET', `/task-assignments/${assignmentId}`, parent))
      const rows = await ok(await list(assignmentId, parent))
      assert.deepEqual(
        rows.map((row: Json) => row.id),
        [submission.id],
      )
      await ok(await detail(submission.id, parent))
    }
    await visible()

    await bond({ custody: 'none', contactRestricted: true })
    assert.deepEqual(await ok(await call('GET', '/task-assignments', parent)), [])
    fails(await call('GET', `/task-assignments/${assignmentId}`, parent), 404, 'not_found')
    fails(await list(assignmentId, parent), 404, 'not_found')
    fails(await detail(submission.id, parent), 404, 'not_found')

    await bond({ custody: 'full', contactRestricted: false })
    await visible()
  })

  test('DOM-BEC-044: son teslimden sonra geç kabulde sürüm late; geç kabul bitince teslim ve taslak 422 submission_closed', async () => {
    const t = await tenant()
    const assignmentId = await assign(t, { deadline: { dueAt: DUE, lateAcceptanceDays: 1 } })
    now = new Date(new Date(DUE).getTime() + 60 * MINUTE)
    const late = await ok(await submit(assignmentId, t.cookies.student), 201)
    assert.equal(late.status, 'late')
    assert.equal(late.versions[0].late, true)

    now = new Date(new Date(DUE).getTime() + 3 * 24 * 60 * MINUTE)
    fails(await submit(assignmentId, t.cookies.student), 422, 'submission_closed')
    fails(await saveDraft(assignmentId, t.cookies.student, 'x'), 422, 'submission_closed')
    assert.deepEqual(await storedRows(t.institution.id), { submissions: 1, versions: 1, drafts: 0 })
  })

  test('DOM-YTK-028: sınıf değiştiren öğrenci ve velisi eski teslimi görür, yeni sürüm gönderemez; teslimi olmayan atama 404', async () => {
    const t = await tenant()
    const assignmentId = await assign(t)
    const empty = await assign(t, {}, t.otherHomeworkId)
    const created = await ok(await submit(assignmentId, t.cookies.student), 201)
    await db
      .update(records)
      .set({
        data: sql`jsonb_set(${records.data}, '{classId}', '"9-B"')`,
        version: sql`${records.version} + 1`,
      })
      .where(
        and(
          eq(records.institutionId, t.institution.id),
          eq(records.collection, 'students'),
          eq(records.id, 's-1'),
        ),
      )
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const rows = await ok(await list(assignmentId, cookie))
      assert.deepEqual(
        rows.map((row: Json) => row.id),
        [created.id],
      )
      assert.equal((await ok(await detail(created.id, cookie))).versions[0].body, SECRET_TEXT)
      fails(await list(empty, cookie), 404, 'not_found')
    }
    fails(await submit(assignmentId, t.cookies.student), 404, 'not_found')
    fails(await saveDraft(assignmentId, t.cookies.student, 'x'), 404, 'not_found')
    fails(await detail(created.id, t.cookies.otherTeacher), 404, 'not_found')
  })

  test('DOM-BEC-045: geri bildirim açılmadan kursiyer ve veli puanlandığını göremez: hak puanlamadan öncekiyle aynı, yeni sürüm genel 409 submission_locked; personel graded görür; puan kesinleşince graded', async () => {
    const t = await tenant()
    const assignmentId = await assign(t)
    const submitted = await ok(await submit(assignmentId, t.cookies.student), 201)
    const [version] = submitted.versions
    const unscored = new Map<string, Json>()
    for (const cookie of [t.cookies.student, t.cookies.parent])
      unscored.set(cookie, (await ok(await detail(submitted.id, cookie))).allowance)
    const score = (raterRole: 'first' | 'second', band: number) => ({
      id: randomUUID(),
      submissionVersionId: version.id,
      rubricVersionId: t.rubricVersionId,
      raterUserId: t.institution.admin.id,
      raterRole,
      criteria: [
        { criterionId: 'task', band, comment: null },
        { criterionId: 'grammar', band, comment: null },
      ],
      overallComment: 'GIZLI-GERI-BILDIRIM',
      scoredAt: now.toISOString(),
    })
    // İkinci puanlama istendi, ilk puan verildi: puanlama sürüyor, geri bildirim kapalı.
    await insertSecondRatingRequest(
      db,
      t.institution.id,
      {
        submissionId: submitted.id,
        source: 'manual',
        requestedByUserId: t.institution.admin.id,
        requestedAt: now.toISOString(),
      },
      now,
    )
    await insertRubricScore(db, t.institution.id, score('first', 3), now)
    const blockedBy = async (cookie: string) =>
      (await ok(await detail(submitted.id, cookie))).allowance
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const allowance = await blockedBy(cookie)
      assert.deepEqual(allowance, unscored.get(cookie))
      assert.equal(allowance.resubmissionOpen, false)
      const body = (await detail(submitted.id, cookie)).body
      for (const text of ['graded', '"locked"', 'GIZLI-GERI-BILDIRIM'])
        assert.ok(!body.includes(text), text)
    }
    for (const cookie of [t.cookies.teacher, t.cookies.admin])
      assert.equal((await blockedBy(cookie)).blockedBy, 'graded')
    const before = await storedRows(t.institution.id)
    const locked = await submit(assignmentId, t.cookies.student)
    fails(locked, 409, 'submission_locked')
    assert.ok(!locked.body.includes('puanlandı'))
    assert.deepEqual(await storedRows(t.institution.id), before)
    // İkinci puan uyuşur: puan kesinleşir, geri bildirim açılır; neden artık gizlenmez.
    await insertRubricScore(db, t.institution.id, score('second', 3), now)
    for (const cookie of [t.cookies.student, t.cookies.parent])
      assert.equal((await blockedBy(cookie)).blockedBy, 'graded')
    fails(await submit(assignmentId, t.cookies.student), 409, 'resubmission_not_requested')
  })

  test('DOM-KYN-024, DOM-KYN-021, IST-051: atama ayrıntısı sabitlenen yönergeyi ve kaynak gösterimini kursiyere verir (ölçüt yok); lisansı dolmuş içerikte taslak veya teslim yoksa içerik yok, taslak varsa yönerge görünür', async () => {
    const t = await tenant()
    const attribution = {
      work: 'Short Stories',
      author: 'A. Writer',
      source: 'Örnek Yayınevi, s. 12',
      year: 2020,
    }
    const quoted = await t.seed({
      ...homework(),
      license: {
        kind: 'licensed_publication',
        publisher: 'Örnek Yayınevi',
        contractNumber: 'SZ-2026-02',
        coverage: 'Kurumun bütün öğrencileri',
        expiryDate: '2026-10-06',
        restrictedToBookOwners: false,
      },
      attributions: [attribution],
    })
    const assignmentId = await assign(t, {}, quoted)
    const read = (cookie: string) => call('GET', `/task-assignments/${assignmentId}`, cookie)
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const seen = await ok(await read(cookie))
      assert.equal(seen.contentUnavailable, null)
      assert.equal(seen.content.body.instructions, 'Hafta sonunu anlatan kısa bir metin yaz.')
      assert.deepEqual(seen.content.attributions, [attribution])
      for (const text of ['Zaman ifadeleri', 'SZ-2026-02', 'criteria'])
        assert.ok(!JSON.stringify(seen).includes(text), text)
    }
    // Personel görünümünde içerik eki yoktur (içeriği kaynak uçlarından okur).
    assert.ok(!('content' in (await ok(await read(t.cookies.teacher)))))

    // Lisans bitiş gününden sonra: süren iş yoksa içerik gösterilmez ve ilk taslak açılmaz
    // (yeni iş; IST-036).
    const expiredAt = new Date('2026-10-07T09:00:00.000Z')
    now = expiredAt
    try {
      for (const cookie of [t.cookies.student, t.cookies.parent]) {
        const expired = await ok(await read(cookie))
        assert.deepEqual([expired.content, expired.contentUnavailable], [null, 'license_expired'])
      }
      fails(
        await saveDraft(assignmentId, t.cookies.student, 'İlk taslak'),
        409,
        'resource_license_expired',
      )
      // Öğrencinin taslağı varsa süren iş sayılır: yönerge görünür (veli taslağı göremez).
      now = FIXED_NOW
      await ok(await saveDraft(assignmentId, t.cookies.student, 'İlk taslak'))
      now = expiredAt
      assert.equal((await ok(await read(t.cookies.student))).contentUnavailable, null)
      assert.equal((await ok(await read(t.cookies.parent))).contentUnavailable, 'license_expired')
    } finally {
      now = FIXED_NOW
    }
  })

  test('IST-051: kursiyer içerik gövdesi tür başına yalnız izinli alanları taşır; yanıt şeması fazladan alanı (öğretmen notu, ölçüt, rubrik bağı) süzer', async () => {
    const t = await tenant()
    const assignmentId = await assign(t)
    const detail = await ok(
      await call('GET', `/task-assignments/${assignmentId}`, t.cookies.student),
    )
    assert.deepEqual(Object.keys(detail.content.body).sort(), [
      'instructions',
      'submissionKinds',
      'type',
    ])
    const leaked = structuredClone(detail)
    Object.assign(leaked.content.body, {
      criteria: 'GIZLI-OLCUT',
      rubricId: randomUUID(),
      teacherNote: 'GIZLI-NOT',
    })
    const parsed = taskAssignmentDetailResponseSchema.parse({ data: leaked })
    assert.deepEqual(parsed.data, detail)
  })

  test('DOM-KYN-025, DOM-KYN-051: kaynağın başka sürümü telif bildirimiyle incelemedeyse arşivli sürüme sabitlenen atamanın içeriği yalnız taslağı olan öğrenciye gösterilir (veli taslağı görmez); kaldırıldıysa kimseye; ilk onaydaki yeni taslak etkilemez', async () => {
    const t = await tenant()
    const assignmentId = await assign(t)
    await ok(await saveDraft(assignmentId, t.cookies.student, 'İlk taslak'))
    const [pinned] = await db
      .select()
      .from(resourceVersions)
      .where(
        and(
          eq(resourceVersions.institutionId, t.institution.id),
          eq(resourceVersions.id, t.homeworkId),
        ),
      )
    const nextId = randomUUID()
    // v2 ilk onay sürecinde (yayın geçmişi yok): sabitlenen v1 gösterilmeye devam eder.
    await db.insert(resourceVersions).values({
      ...pinned!,
      id: nextId,
      versionNumber: 2,
      status: 'in_review',
      publishedAt: null,
      submittedAt: FIXED_NOW,
    })
    const contentOf = async (cookie: string) => {
      const seen = await ok(await call('GET', `/task-assignments/${assignmentId}`, cookie))
      return [seen.contentUnavailable, seen.content?.versionId ?? null]
    }
    for (const cookie of [t.cookies.student, t.cookies.parent])
      assert.deepEqual(await contentOf(cookie), [null, t.homeworkId])
    const setStatus = (versionId: string, values: Partial<typeof resourceVersions.$inferInsert>) =>
      db
        .update(resourceVersions)
        .set(values)
        .where(
          and(
            eq(resourceVersions.institutionId, t.institution.id),
            eq(resourceVersions.id, versionId),
          ),
        )
    // v2 yayımlanır, v1 arşive geçer: atama arşivli v1'i göstermeye devam eder.
    await setStatus(t.homeworkId, { status: 'archived', archivedAt: FIXED_NOW })
    await setStatus(nextId, { status: 'published', publishedAt: FIXED_NOW })
    for (const cookie of [t.cookies.student, t.cookies.parent])
      assert.deepEqual(await contentOf(cookie), [null, t.homeworkId])
    // v2'ye telif bildirimi: kaynak askıdadır. Taslağı olan öğrenci v1'in yönergesini görmeye
    // devam eder (Sabah kararı 47); veli taslağı görmez, süren işi yok sayılır.
    await setStatus(nextId, { status: 'in_review' })
    assert.deepEqual(await contentOf(t.cookies.student), [null, t.homeworkId])
    assert.deepEqual(await contentOf(t.cookies.parent), ['unavailable', null])
    // Yönetici yeniden yayına alır: içerik geri gelir; kaynak kaldırılırsa yine gösterilmez.
    await setStatus(nextId, { status: 'published' })
    assert.deepEqual(await contentOf(t.cookies.student), [null, t.homeworkId])
    // Kaldırma kaynak düzeyindedir; burada yalnız v2 işaretlenir, sabitlenen v1'in içeriği dursa da.
    await setStatus(nextId, {
      status: 'removed',
      content: null,
      answerKey: null,
      removedAt: FIXED_NOW,
      removalReason: 'Telif',
    })
    for (const cookie of [t.cookies.student, t.cookies.parent])
      assert.deepEqual(await contentOf(cookie), ['unavailable', null])
  })

  test('DOM-KYN-025, OG-985: telif askısında süren işi olan öğrenci yönergeyi görür ve özette teslim edebilir; işi olmayan görmez, özeti content_unavailable; kaldırılınca kimse görmez; başka kurum 404', async () => {
    const t = await tenant()
    const { resourceId, versionId } = await seedOwned(t)
    const assignmentId = await assignBoth(t, versionId)
    await ok(await saveDraft(assignmentId, t.cookies.student, DRAFT_TEXT))
    await ok(
      await call(
        'POST',
        `/resources/${resourceId}/versions/${versionId}/report`,
        t.cookies.teacher,
        {
          reason: 'Telif ihlali şüphesi',
        },
      ),
    )
    const detail = async (cookie: string) =>
      ok(await call('GET', `/task-assignments/${assignmentId}`, cookie))
    const listed = async (cookie: string) =>
      (await ok(await call('GET', '/task-assignments', cookie))).find(
        (item: Json) => item.id === assignmentId,
      )
    const gate = (seen: Json) => [
      seen.contentUnavailable,
      seen.content?.body.instructions ?? null,
      seen.progress[0].canAct,
      seen.progress[0].blockedBy,
    ]
    // Askıda + süren iş (taslak): yönerge görünür, teslim açık.
    assert.deepEqual(gate(await detail(t.cookies.student)), [
      null,
      'Hafta sonunu anlatan kısa bir metin yaz.',
      true,
      null,
    ])
    // Askıda + iş yok: içerik kapalı, özet yeni işi önermez (yazma ucu 422 verir).
    assert.deepEqual(gate(await detail(t.cookies.otherStudent)), [
      'unavailable',
      null,
      false,
      'content_unavailable',
    ])
    const row = await listed(t.cookies.otherStudent)
    assert.deepEqual(
      [row.progress[0].canAct, row.progress[0].blockedBy, row.progress[0].actionableUntil],
      [false, 'content_unavailable', null],
    )
    assert.deepEqual([(await listed(t.cookies.student)).progress[0].canAct], [true])
    // Kaldırılmış: süren işi olan da göremez ve yazamaz.
    await ok(
      await call('POST', `/resources/${resourceId}/remove`, t.cookies.admin, {
        reason: 'Telif ihlali kabul edildi',
      }),
    )
    for (const cookie of [t.cookies.student, t.cookies.otherStudent])
      assert.deepEqual(gate(await detail(cookie)), [
        'unavailable',
        null,
        false,
        'content_unavailable',
      ])
    fails(
      await call('GET', `/task-assignments/${assignmentId}`, await foreignStudent()),
      404,
      'not_found',
    )
  })

  test('DOM-KYN-025, DOM-KYN-051, IST-036: kaldırılan kaynakta taslak ve teslim 422 content_unavailable (taslak ve teslim olsa da); kayıt değişmez; aynı anahtarla mükerrer teslim yeni sürüm açmaz; başka kurum 404', async () => {
    const t = await tenant()
    const { resourceId, versionId } = await seedOwned(t)
    const assignmentId = await assign(t, {}, versionId)
    const draft = await ok(await saveDraft(assignmentId, t.cookies.student, DRAFT_TEXT))
    const once = key()
    const first = await ok(await submit(assignmentId, t.cookies.student, undefined, once), 201)
    await ok(
      await call('POST', `/resources/${resourceId}/remove`, t.cookies.admin, {
        reason: 'Telif ihlali kabul edildi',
      }),
    )
    const before = await snapshot(t.institution.id)
    fails(
      await saveDraft(assignmentId, t.cookies.student, 'Yeni satır', revision(draft.revision)),
      422,
      'content_unavailable',
    )
    fails(await submit(assignmentId, t.cookies.student), 422, 'content_unavailable')
    assert.deepEqual(await snapshot(t.institution.id), before)
    // Mükerrer istek (aynı anahtar) kaydedilmiş yanıtı döner, yeni sürüm açmaz.
    const replay = await ok(await submit(assignmentId, t.cookies.student, undefined, once), 201)
    assert.deepEqual(replay, first)
    assert.deepEqual(await snapshot(t.institution.id), before)
    const foreign = await foreignStudent()
    fails(await submit(assignmentId, foreign), 404, 'not_found')
    fails(await saveDraft(assignmentId, foreign, 'Taslak'), 404, 'not_found')
    assert.deepEqual(await snapshot(t.institution.id), before)
  })

  test('DOM-KYN-051, OG-996: kaldırılmış içerikte eski revizyonla taslak 409 draft_conflict (sürüm içerik kuralından önce), güncel revizyonla 422 content_unavailable; kayıt değişmez', async () => {
    const t = await tenant()
    const { resourceId, versionId } = await seedOwned(t)
    const assignmentId = await assign(t, {}, versionId)
    const first = await ok(await saveDraft(assignmentId, t.cookies.student, DRAFT_TEXT))
    const draft = await ok(
      await saveDraft(assignmentId, t.cookies.student, 'İkinci satır', revision(first.revision)),
    )
    await ok(
      await call('POST', `/resources/${resourceId}/remove`, t.cookies.admin, {
        reason: 'Telif ihlali kabul edildi',
      }),
    )
    const before = await snapshot(t.institution.id)
    fails(
      await saveDraft(assignmentId, t.cookies.student, 'Eski pencere', revision(first.revision)),
      409,
      'draft_conflict',
    )
    fails(
      await saveDraft(assignmentId, t.cookies.student, 'Güncel', revision(draft.revision)),
      422,
      'content_unavailable',
    )
    assert.deepEqual(await snapshot(t.institution.id), before)
  })

  test('DOM-KYN-025, IST-036: telif bildirimiyle incelemedeki kaynakta taslağı ve teslimi olmayan öğrenci taslak açamaz ve teslim edemez (422 content_unavailable); taslağı olan teslimini tamamlar; yeniden yayında açılır', async () => {
    const t = await tenant()
    const { resourceId, versionId } = await seedOwned(t)
    const assignmentId = await assignBoth(t, versionId)
    const draft = await ok(await saveDraft(assignmentId, t.cookies.student, DRAFT_TEXT))
    const version = `/resources/${resourceId}/versions/${versionId}`
    await ok(
      await call('POST', `${version}/report`, t.cookies.teacher, {
        reason: 'Telif ihlali şüphesi',
      }),
    )
    const before = await snapshot(t.institution.id)
    fails(
      await saveDraft(assignmentId, t.cookies.otherStudent, 'Taslak'),
      422,
      'content_unavailable',
    )
    fails(await submit(assignmentId, t.cookies.otherStudent), 422, 'content_unavailable')
    assert.deepEqual(await snapshot(t.institution.id), before)
    // Süren iş biter (sabah kararı adayı): taslağı olan öğrenci kaydeder ve teslim eder.
    await ok(
      await saveDraft(assignmentId, t.cookies.student, 'İkinci satır', revision(draft.revision)),
    )
    await ok(await submit(assignmentId, t.cookies.student), 201)
    // Yönetici yeniden yayına alır (onay koşulları bu testin konusu değil).
    await db
      .update(resourceVersions)
      .set({ status: 'published' })
      .where(
        and(
          eq(resourceVersions.institutionId, t.institution.id),
          eq(resourceVersions.id, versionId),
        ),
      )
    await ok(await submit(assignmentId, t.cookies.otherStudent), 201)
  })

  test('DOM-KYN-021, IST-036: kitap sahibiyle sınırlı lisansta kitap sahibi olmayan öğrenci taslak açamaz ve teslim edemez (422 content_unavailable); kitap sahibi teslim eder', async () => {
    const t = await tenant()
    const { versionId } = await seedOwned(
      t,
      {
        ...homework(),
        license: {
          kind: 'licensed_publication',
          publisher: 'Örnek Yayınevi',
          contractNumber: 'SZ-2026-02',
          coverage: 'Basılı kitap sahibi öğrenciler',
          expiryDate: '2027-06-30',
          restrictedToBookOwners: true,
        },
      },
      { shareScope: 'students', sharedStudentIds: ['s-1'] },
    )
    const assignmentId = await assignBoth(t, versionId)
    const before = await snapshot(t.institution.id)
    fails(
      await saveDraft(assignmentId, t.cookies.otherStudent, 'Taslak'),
      422,
      'content_unavailable',
    )
    fails(await submit(assignmentId, t.cookies.otherStudent), 422, 'content_unavailable')
    assert.deepEqual(await snapshot(t.institution.id), before)
    // Özet yazma ucuyla aynı kapıdan geçer (OG-985).
    const blockedOf = async (cookie: string) => {
      const { progress } = await ok(await call('GET', `/task-assignments/${assignmentId}`, cookie))
      return [progress[0].canAct, progress[0].blockedBy]
    }
    assert.deepEqual(await blockedOf(t.cookies.otherStudent), [false, 'content_unavailable'])
    assert.deepEqual(await blockedOf(t.cookies.student), [true, null])
    await ok(await submit(assignmentId, t.cookies.student), 201)
  })

  test('DOM-KYN-021, IST-036: lisansı dolmuş içerikte taslağı ve teslimi olmayan öğrenci 409 resource_license_expired; taslağı olan teslim eder, teslimi olan yeni sürüm gönderir', async () => {
    const t = await tenant()
    const { versionId } = await seedOwned(t, {
      ...homework(),
      license: {
        kind: 'licensed_publication',
        publisher: 'Örnek Yayınevi',
        contractNumber: 'SZ-2026-01',
        coverage: 'Kurumun bütün öğrencileri',
        expiryDate: '2026-10-06',
        restrictedToBookOwners: false,
      },
    })
    const assignmentId = await assignBoth(t, versionId)
    await ok(await saveDraft(assignmentId, t.cookies.student, DRAFT_TEXT))
    now = new Date(FIXED_NOW.getTime() + 24 * 60 * MINUTE)
    try {
      const before = await snapshot(t.institution.id)
      fails(
        await saveDraft(assignmentId, t.cookies.otherStudent, 'Taslak'),
        409,
        'resource_license_expired',
      )
      fails(await submit(assignmentId, t.cookies.otherStudent), 409, 'resource_license_expired')
      assert.deepEqual(await snapshot(t.institution.id), before)
      // Özet yazma ucuyla aynı kapıdan geçer (OG-985): taslağı olana açık, olmayana lisans engeli.
      const blockedOf = async (cookie: string) => {
        const { progress } = await ok(
          await call('GET', `/task-assignments/${assignmentId}`, cookie),
        )
        return [progress[0].canAct, progress[0].blockedBy]
      }
      assert.deepEqual(await blockedOf(t.cookies.otherStudent), [false, 'license_expired'])
      assert.deepEqual(await blockedOf(t.cookies.student), [true, null])
      await ok(await submit(assignmentId, t.cookies.student), 201)
      await ok(await submit(assignmentId, t.cookies.student), 201)
    } finally {
      now = FIXED_NOW
    }
  })

  test('DOM-KYN-021, OG-985: lisansı dolmuş ve teslim penceresi kapanmış yazma görevinde işi olmayan öğrencinin özeti locked değil license_expired (yazma ucu içerik kuralını pencereden önce sınar: 409 resource_license_expired)', async () => {
    const t = await tenant()
    const { versionId } = await seedOwned(t, {
      ...homework(),
      license: {
        kind: 'licensed_publication',
        publisher: 'Örnek Yayınevi',
        contractNumber: 'SZ-2026-01',
        coverage: 'Kurumun bütün öğrencileri',
        expiryDate: '2026-10-06',
        restrictedToBookOwners: false,
      },
    })
    const assignmentId = await assignBoth(t, versionId)
    // Son teslimden (20 Ekim) sonra: pencere kapalı, lisans dolmuş, Can'ın taslağı ve teslimi yok.
    now = new Date('2026-10-25T09:00:00.000Z')
    try {
      const before = await snapshot(t.institution.id)
      fails(
        await saveDraft(assignmentId, t.cookies.otherStudent, 'Taslak'),
        409,
        'resource_license_expired',
      )
      fails(await submit(assignmentId, t.cookies.otherStudent), 409, 'resource_license_expired')
      assert.deepEqual(await snapshot(t.institution.id), before)
      const detail = await ok(
        await call('GET', `/task-assignments/${assignmentId}`, t.cookies.otherStudent),
      )
      const row = (await ok(await call('GET', '/task-assignments', t.cookies.otherStudent))).find(
        (item: Json) => item.id === assignmentId,
      )
      for (const progress of [detail.progress[0], row.progress[0]])
        assert.deepEqual(
          [progress.canAct, progress.blockedBy, progress.actionableUntil],
          [false, 'license_expired', null],
        )
    } finally {
      now = FIXED_NOW
    }
  })

  test('DOM-YTK-028, IST-047: servis de yalnız öğrenciye yazdırır: veli çocuğunun taslağını okuyamaz ve kaydedemez, teslim gönderemez (403); kayıt değişmez', async () => {
    const t = await tenant()
    const assignmentId = await assign(t)
    await ok(await saveDraft(assignmentId, t.cookies.student, 'Taslak'))
    const parent = await createMember(app, t.institution.id, 'veli', [
      { kind: 'child', recordId: 's-1' } as never,
    ])
    const ctx: ServiceContext = {
      db,
      institutionId: t.institution.id,
      actor: { userId: parent.id, role: 'veli', membershipId: parent.membershipId },
      now,
      log: app.log,
    }
    const forbidden = (error: unknown) =>
      error instanceof AppError && error.statusCode === 403 && error.code === 'forbidden'
    const before = await storedRows(t.institution.id)
    await assert.rejects(getTaskDraft(ctx, assignmentId), forbidden)
    await assert.rejects(
      saveTaskDraft(ctx, { assignmentId, body: 'Veli yazdı', expectedRevision: 1 }, null),
      forbidden,
    )
    await assert.rejects(
      submitTaskSubmission(ctx, assignmentId, { submissionKind: 'text', body: 'Veli' }, null),
      forbidden,
    )
    assert.deepEqual(await storedRows(t.institution.id), before)
    assert.equal((await ok(await readDraft(assignmentId, t.cookies.student))).body, 'Taslak')
  })

  test('DOM-BEC-040: log ve denetimde metin ve öğrenci kimliği yok; denetime yalnız teslim, alan adlarıyla', async () => {
    const t = await tenant()
    const assignmentId = await assign(t)
    const from = logs.length
    await ok(await saveDraft(assignmentId, t.cookies.student, DRAFT_TEXT))
    const created = await ok(await submit(assignmentId, t.cookies.student), 201)
    fails(
      await submit(assignmentId, t.cookies.student, { submissionKind: 'text', body: '' }),
      400,
      'validation_failed',
    )
    await ok(await list(assignmentId, t.cookies.teacher))
    await ok(await detail(created.id, t.cookies.teacher))
    const written = logs.slice(from).join('\n')
    assert.ok(written.includes('task_submission.submit'), 'işlem logu yok')
    for (const text of ['s-1', 'GIZLI-YAZI', 'GIZLI-TASLAK'])
      assert.ok(!written.includes(text), `${text} loglandı`)
    const audits = await db
      .select({ action: auditLog.action, entityId: auditLog.entityId, changes: auditLog.changes })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.institution.id),
          eq(auditLog.entityType, 'task_submission'),
        ),
      )
    assert.deepEqual(audits, [
      {
        action: 'task_submission.submit',
        entityId: created.id,
        changes: { fields: ['body', 'versionNumber', 'submittedAt'] },
      },
    ])
  })
})
