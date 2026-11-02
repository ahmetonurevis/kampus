import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import type { ResourceVersionInput } from '@kampus/school-core/content/resource.ts'
import type { Subskill } from '@kampus/school-core/content/taxonomy.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { resourceVersions } from '../src/db/schema/resources.ts'
import { taskAttempts } from '../src/db/schema/skills.ts'
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

/**
 * Okuma-anlama etkinliği (OG-051; IST-042; DOM-BEC-006, DOM-BEC-010, DOM-BEC-045, DOM-KYN-002).
 * Etkinlik okuma parçasına bağlı quiz/alıştırma setidir; mevcut atama ve deneme uçlarıyla teslim
 * edilir. Burada parçanın yalnız denemede ve anahtarsız dönmesi, puanın ve alt beceri dökümünün
 * cevaplardan hesaplanması, dökümün madde sonuçlarıyla aynı anda açılması, rol ve kurum kapsamı,
 * içerik yazma uçlarında sözlükçe, alt beceri ve parça bağının doğrulanması denetlenir.
 */

type Json = ReturnType<typeof JSON.parse>

const DUE = '2026-10-20T20:59:00.000Z'
const SECRET_EXPLANATION = 'GIZLI-COZUM'
const BODY = "Ann lives in Izmir. She takes the ferry to work every day. It's a well-known route."
const TAGS = {
  subjectId: 'english',
  gradeLevels: [9],
  primarySkill: 'reading' as const,
  cefrLevel: 'A2' as const,
  outcomes: [{ outcomeId: 'E9.1.R1', outcomeSource: 'platform' as const }],
}

const passage = (
  glossary: { term: string; meaning: string; example?: string }[] = [
    { term: 'ferry', meaning: 'vapur' },
  ],
): Partial<ResourceVersionInput> => ({
  title: "Ann's day",
  content: { type: 'reading_passage', body: BODY, glossary },
  license: { kind: 'institution_original' },
  tags: TAGS,
})

const question = (
  stem: string,
  correctOptionId: string,
  subskill: Subskill | null,
): Partial<ResourceVersionInput> => ({
  title: `Soru: ${stem}`,
  content: {
    type: 'question',
    question: {
      questionType: 'multiple_choice',
      stem,
      options: ['a', 'b', 'c', 'd'].map((id) => ({ id, text: `Option ${id}` })),
    },
  },
  answerKey: { questionType: 'multiple_choice', correctOptionId, explanation: SECRET_EXPLANATION },
  license: { kind: 'institution_original' },
  tags: { ...TAGS, subskill },
})

const choice = (optionId: string | null) => ({ questionType: 'multiple_choice', optionId })

describe('okuma-anlama etkinliği', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let now = FIXED_NOW

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => now })
  })
  after(async () => {
    await app.close()
    await close()
  })

  /**
   * `t-eng` 9-A'nın, `t-mat` 9-B'nin öğretmeni. Deniz (`s-1`) 9-A'da, Can (`s-3`) 9-B'de; veli
   * Deniz'in velisidir. Yayındaki parça (sözlükçeli) ve üç soru (ana fikir 1, ayrıntı 1 + 2 puan)
   * okuma quiz'inde birleşir.
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
          data: { id: 't-eng', name: 'Selin Kaya', subjectId: 'english', branchId: 'b-1' },
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
          data: { id: 'as-1', classId: '9-A', teacherId: 't-eng', subjectId: 'english' },
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
    const seed = async (
      input: Partial<ResourceVersionInput>,
      status: 'published' | 'draft' = 'published',
    ) => {
      const seeded = await seedResource(db, institution.id, {
        ownerUserId: teacher.id,
        versions: [{ status, input }],
      })
      return { resourceId: seeded.resource.id, versionId: seeded.versions[0]!.id }
    }
    const text = await seed(passage())
    const main = (await seed(question('What is the text mainly about?', 'a', 'main_idea')))
      .versionId
    const detail = (await seed(question('Where does Ann live?', 'b', 'detail'))).versionId
    const transport = (await seed(question('How does Ann go to work?', 'c', 'detail'))).versionId
    const quiz = await seed({
      title: 'Okuma etkinliği',
      content: {
        type: 'quiz',
        items: [
          { questionVersionId: main, points: 1 },
          { questionVersionId: detail, points: 1 },
          { questionVersionId: transport, points: 2 },
        ],
        passageVersionId: text.versionId,
      },
      license: { kind: 'institution_original' },
      tags: TAGS,
    })
    return {
      institution,
      cookies,
      seed,
      passage: text,
      quizId: quiz.versionId,
      items: { main, detail, transport },
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
  async function ok(response: Awaited<ReturnType<typeof call>>, status = 200) {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function fails(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
    assert.equal(response.statusCode, status, response.body)
    assert.equal(response.json().code, code, response.body)
  }

  async function assign(t: Tenant, settings: Record<string, unknown> = {}) {
    const data = await ok(
      await call(
        'POST',
        '/task-assignments',
        t.cookies.teacher,
        {
          resourceVersionId: t.quizId,
          settings: { deadline: { dueAt: DUE }, ...settings },
          targets: [{ kind: 'class', id: '9-A' }],
        },
        key(),
      ),
      201,
    )
    return data.id as string
  }
  const start = (assignmentId: string, cookie?: string) =>
    call('POST', `/task-assignments/${assignmentId}/attempts`, cookie, {}, key())
  const submit = (id: string, cookie: string | undefined, payload: unknown, rowVersion = 1) =>
    call('POST', `/task-attempts/${id}/submit`, cookie, payload, {
      ...key(),
      'if-match': `"${rowVersion}"`,
    })
  const detail = (id: string, cookie?: string) => call('GET', `/task-attempts/${id}`, cookie)

  async function attemptRows(institutionId: string) {
    return db
      .select({
        id: taskAttempts.id,
        version: taskAttempts.version,
        answers: taskAttempts.answers,
        submittedAt: taskAttempts.submittedAt,
      })
      .from(taskAttempts)
      .where(eq(taskAttempts.institutionId, institutionId))
  }
  async function versionRows(institutionId: string) {
    return db
      .select({ id: resourceVersions.id, version: resourceVersions.version })
      .from(resourceVersions)
      .where(eq(resourceVersions.institutionId, institutionId))
      .orderBy(resourceVersions.id)
  }

  test('IST-042, DOM-YTK-028: deneme ucu 401; ön büro 403; veli yazamaz 403; başka sınıfın öğrencisi ve öğretmeni, başka kurum 404; kayıt değişmez', async () => {
    const t = await tenant()
    const assignmentId = await assign(t)
    fails(await start(assignmentId), 401, 'unauthenticated')
    fails(await start(assignmentId, t.cookies.frontDesk), 403, 'forbidden')
    fails(await start(assignmentId, t.cookies.parent), 403, 'forbidden')
    fails(await start(assignmentId, t.cookies.otherStudent), 404, 'not_found')
    assert.deepEqual(await attemptRows(t.institution.id), [])

    const attempt = await ok(await start(assignmentId, t.cookies.student), 201)
    fails(await detail(attempt.id), 401, 'unauthenticated')
    fails(await detail(attempt.id, t.cookies.frontDesk), 403, 'forbidden')
    fails(await detail(attempt.id, t.cookies.otherStudent), 404, 'not_found')
    fails(await detail(attempt.id, t.cookies.otherTeacher), 404, 'not_found')
    const other = await createInstitution(app)
    const otherAdmin = await signInAs(app, other.admin)
    fails(await detail(attempt.id, otherAdmin), 404, 'not_found')
    const before = await attemptRows(t.institution.id)
    fails(await submit(attempt.id, t.cookies.parent, {}), 403, 'forbidden')
    fails(await submit(attempt.id, t.cookies.otherStudent, {}), 404, 'not_found')
    assert.deepEqual(await attemptRows(t.institution.id), before)
  })

  test('IST-042, DOM-KYN-002, DOM-BEC-045: parça yalnız denemede gelir; seviye, kelime sayısı, sözlükçe ve alt beceri etiketleri var; cevap ve açıklama yok', async () => {
    const t = await tenant()
    const assignmentId = await assign(t)
    // Atama ayrıntısı yalnız soru sayısını verir; metin süreyle birlikte denemede açılır.
    const assigned = await call('GET', `/task-assignments/${assignmentId}`, t.cookies.student)
    assert.equal(assigned.statusCode, 200, assigned.body)
    assert.equal(assigned.json().data.content.body.questionCount, 3)
    assert.ok(!assigned.body.includes('ferry to work'), 'metin denemeden önce sızdı')

    const response = await start(assignmentId, t.cookies.student)
    const attempt = await ok(response, 201)
    assert.deepEqual(attempt.passage, {
      versionId: t.passage.versionId,
      title: "Ann's day",
      body: BODY,
      wordCount: 16,
      cefrLevel: 'A2',
      glossary: [{ term: 'ferry', meaning: 'vapur', example: null }],
      attributions: [],
    })
    assert.deepEqual(
      attempt.questions.map((q: Json) => [q.questionVersionId, q.subskill]),
      [
        [t.items.main, 'main_idea'],
        [t.items.detail, 'detail'],
        [t.items.transport, 'detail'],
      ],
    )
    assert.ok(!response.body.includes(SECRET_EXPLANATION), 'açıklama sızdı')
    assert.ok(!response.body.includes('correctOptionId'), 'anahtar sızdı')
    // Veli çocuğunun denemesini aynı görünümle okur; öğretmen sınıfının denemesini okur.
    for (const cookie of [t.cookies.parent, t.cookies.teacher]) {
      const read = await ok(await detail(attempt.id, cookie))
      assert.equal(read.passage.versionId, t.passage.versionId)
      assert.equal(read.result, null)
    }
  })

  test('IST-042, DOM-BEC-006, DOM-BEC-010: puan ve alt beceri dökümü cevaplardan hesaplanır; istemci puanı 400 ve kayıt değişmez; ikinci teslim 409; döküm saklanmaz', async () => {
    const t = await tenant()
    const assignmentId = await assign(t, {
      attempts: { kind: 'evaluation', maxAttempts: 1 },
    })
    const attempt = await ok(await start(assignmentId, t.cookies.student), 201)
    const answers = {
      [t.items.main]: choice('a'),
      [t.items.detail]: choice('a'),
      [t.items.transport]: choice('c'),
    }
    const before = await attemptRows(t.institution.id)
    for (const payload of [
      { answers, score: 100 },
      { answers, result: { subskills: [] } },
      { answers: { [t.items.main]: { questionType: 'multiple_choice' } } },
    ])
      fails(await submit(attempt.id, t.cookies.student, payload), 400, 'validation_failed')
    assert.deepEqual(await attemptRows(t.institution.id), before)

    const submitted = await ok(await submit(attempt.id, t.cookies.student, { answers }))
    assert.equal(submitted.status, 'submitted')
    // Değerlendirme kapanmadan kursiyer yalnız toplamı görür: döküm madde sonuçlarıyla açılır.
    assert.deepEqual(
      [submitted.result.earned, submitted.result.possible, submitted.result.percent],
      [3, 4, 75],
    )
    assert.equal(submitted.result.items, null)
    assert.equal(submitted.result.subskills, null)
    fails(
      await submit(attempt.id, t.cookies.student, { answers }, 2),
      409,
      'attempt_already_submitted',
    )
    const [row] = await attemptRows(t.institution.id)
    assert.deepEqual(row!.answers, answers, 'cevaplar kalıcı')
    assert.ok(row!.submittedAt !== null)
    assert.equal(Object.hasOwn(row!, 'score'), false)

    const breakdown = [
      { subskill: 'main_idea', items: 1, earned: 1, possible: 1, percent: 100 },
      { subskill: 'detail', items: 2, earned: 2, possible: 3, percent: 67 },
    ]
    // Öğretmen sınıfının sonuçlarını dökümle görür (liste ve ayrıntı); anahtar kapanışa kadar yok.
    const [listed] = await ok(
      await call('GET', `/task-attempts?assignmentId=${assignmentId}`, t.cookies.teacher),
    )
    assert.deepEqual(listed.result.subskills, breakdown)
    assert.equal(listed.result.answerKey, null)
    assert.deepEqual(
      (await ok(await detail(attempt.id, t.cookies.admin))).result.subskills,
      breakdown,
    )
    assert.equal((await ok(await detail(attempt.id, t.cookies.parent))).result.subskills, null)

    // Kapanıştan sonra kursiyer ve veli dökümü, madde sonuçlarını ve anahtarı görür.
    now = new Date(Date.parse(DUE) + 60_000)
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const result = (await ok(await detail(attempt.id, cookie))).result
      assert.deepEqual(result.subskills, breakdown)
      assert.equal(result.items.length, 3)
      assert.equal(result.answerKey.length, 3)
    }
  })

  test('DOM-BEC-006, DOM-BEC-045: alıştırmada döküm deneme bitince kursiyere açılır', async () => {
    const t = await tenant()
    const assignmentId = await assign(t, { attempts: { kind: 'practice' } })
    const attempt = await ok(await start(assignmentId, t.cookies.student), 201)
    const submitted = await ok(
      await submit(attempt.id, t.cookies.student, { answers: { [t.items.main]: choice('b') } }),
    )
    assert.deepEqual(submitted.result.subskills, [
      { subskill: 'main_idea', items: 1, earned: 0, possible: 1, percent: 0 },
      { subskill: 'detail', items: 2, earned: 0, possible: 3, percent: 0 },
    ])
  })

  test('DOM-KYN-002, DOM-BEC-006: içerik yazma ucu sözlükçeyi, alt beceriyi ve parça bağını doğrular; hatada kayıt yok; başarı kalıcı', async () => {
    const t = await tenant()
    const post = (body: unknown, cookie: string | undefined = t.cookies.teacher) =>
      call('POST', '/resources', cookie, body)
    const before = await versionRows(t.institution.id)
    fails(await call('POST', '/resources', undefined, passage()), 401, 'unauthenticated')
    fails(await post(passage(), t.cookies.student), 403, 'forbidden')
    fails(
      await post(
        passage([
          { term: 'Ferry', meaning: 'vapur' },
          { term: 'ferry', meaning: 'feribot' },
        ]),
      ),
      400,
      'validation_failed',
    )
    fails(
      await post({ ...passage(), tags: { ...TAGS, subskill: 'detail' } }),
      400,
      'validation_failed',
    )
    const quiz = (passageVersionId: string) => ({
      title: 'Okuma etkinliği 2',
      content: {
        type: 'quiz',
        items: [{ questionVersionId: t.items.main }],
        passageVersionId,
      },
      license: { kind: 'institution_original' },
      tags: TAGS,
    })
    fails(await post(quiz(randomUUID())), 422, 'passage_missing')
    // Başka kurumun parçası bağlanamaz (varlığı da sızmaz).
    const other = await tenant()
    fails(await post(quiz(other.passage.versionId)), 422, 'passage_missing')
    assert.deepEqual(await versionRows(t.institution.id), before)

    const created = await ok(
      await post(question('What does "ferry" mean?', 'd', 'vocabulary')),
      201,
    )
    assert.equal(created.version.tags.subskill, 'vocabulary')
    const read = await ok(
      await call(
        'GET',
        `/resources/${created.resource.id}/versions/${created.version.id}`,
        t.cookies.teacher,
      ),
    )
    assert.equal(read.version.tags.subskill, 'vocabulary', 'alt beceri kalıcı')
    const text = await ok(
      await post(passage([{ term: 'route', meaning: 'güzergâh', example: 'A long route.' }])),
      201,
    )
    assert.deepEqual(text.version.content.glossary, [
      { term: 'route', meaning: 'güzergâh', example: 'A long route.' },
    ])
    const linked = await ok(await post(quiz(text.version.id)), 201)
    assert.equal(linked.version.content.passageVersionId, text.version.id)
  })

  test('IST-042: taslak parçaya bağlı etkinlik onaya gönderilemez (422 passage_not_published); kayıt değişmez', async () => {
    const t = await tenant()
    const draft = await t.seed(passage(), 'draft')
    const created = await ok(
      await call('POST', '/resources', t.cookies.teacher, {
        title: 'Taslak parçalı etkinlik',
        content: {
          type: 'quiz',
          items: [{ questionVersionId: t.items.main }],
          passageVersionId: draft.versionId,
        },
        license: { kind: 'institution_original' },
        tags: TAGS,
      }),
      201,
    )
    const before = await versionRows(t.institution.id)
    fails(
      await call(
        'POST',
        `/resources/${created.resource.id}/versions/${created.version.id}/submit`,
        t.cookies.teacher,
        {},
      ),
      422,
      'passage_not_published',
    )
    assert.deepEqual(await versionRows(t.institution.id), before)
  })

  test('IST-042, DOM-KYN-002: parça yerine soru sürümü bağlanan etkinlik onaya gönderilemez (422 passage_not_reading); kayıt değişmez', async () => {
    const t = await tenant()
    const created = await ok(
      await call('POST', '/resources', t.cookies.teacher, {
        title: 'Parçası soru olan etkinlik',
        content: {
          type: 'quiz',
          items: [{ questionVersionId: t.items.detail }],
          passageVersionId: t.items.main,
        },
        license: { kind: 'institution_original' },
        tags: TAGS,
      }),
      201,
    )
    const before = await versionRows(t.institution.id)
    fails(
      await call(
        'POST',
        `/resources/${created.resource.id}/versions/${created.version.id}/submit`,
        t.cookies.teacher,
        {},
      ),
      422,
      'passage_not_reading',
    )
    assert.deepEqual(await versionRows(t.institution.id), before)
  })

  test('IST-042, DOM-KYN-013: başka öğretmenin özel (paylaşılmamış) parçası bağlanamaz (422 passage_missing); kayıt değişmez', async () => {
    const t = await tenant()
    const colleague = await createMember(app, t.institution.id, 'ogretmen', [
      { kind: 'teacher', recordId: 't-mat' } as never,
    ])
    const seeded = await seedResource(db, t.institution.id, {
      ownerUserId: colleague.id,
      versions: [{ status: 'published', input: passage() }],
    })
    const before = await versionRows(t.institution.id)
    fails(
      await call('POST', '/resources', t.cookies.teacher, {
        title: 'Özel parçalı etkinlik',
        content: {
          type: 'quiz',
          items: [{ questionVersionId: t.items.main }],
          passageVersionId: seeded.versions[0]!.id,
        },
        license: { kind: 'institution_original' },
        tags: TAGS,
      }),
      422,
      'passage_missing',
    )
    assert.deepEqual(await versionRows(t.institution.id), before)
  })

  const save = (id: string, cookie: string, answers: unknown, rowVersion = 1) =>
    call('PATCH', `/task-attempts/${id}`, cookie, { answers }, { 'if-match': `"${rowVersion}"` })

  test('DOM-KYN-051, DOM-KYN-025, IST-042: parça kaldırılınca bağlı etkinlik etkilenen içerik olur; yeni deneme, süren denemenin cevap kaydı ve teslimi 422 content_unavailable; kayıt değişmez', async () => {
    const t = await tenant()
    const assignmentId = await assign(t, { attempts: { kind: 'practice' } })
    const attempt = await ok(await start(assignmentId, t.cookies.student), 201)
    const removed = await call(
      'POST',
      `/resources/${t.passage.resourceId}/remove`,
      t.cookies.admin,
      { reason: 'Telif bildirimi doğrulandı.' },
      key(),
    )
    assert.equal(removed.statusCode, 200, removed.body)
    assert.deepEqual(removed.json().data.affectedContainerVersionIds, [t.quizId])
    const before = await attemptRows(t.institution.id)
    fails(await start(assignmentId, t.cookies.student), 422, 'content_unavailable')
    fails(
      await save(
        attempt.id,
        t.cookies.student,
        { [t.items.main]: choice('a') },
        attempt.rowVersion,
      ),
      422,
      'content_unavailable',
    )
    fails(
      await submit(
        attempt.id,
        t.cookies.student,
        { answers: { [t.items.main]: choice('a') } },
        attempt.rowVersion,
      ),
      422,
      'content_unavailable',
    )
    assert.deepEqual(await attemptRows(t.institution.id), before)
  })

  test('DOM-KYN-025, IST-042: parça telif bildirimiyle askıya alınınca yeni deneme 422 content_unavailable; süren deneme kaydedilir ve teslim edilir', async () => {
    const t = await tenant()
    const assignmentId = await assign(t, { attempts: { kind: 'practice' } })
    const attempt = await ok(await start(assignmentId, t.cookies.student), 201)
    await ok(
      await call(
        'POST',
        `/resources/${t.passage.resourceId}/versions/${t.passage.versionId}/report`,
        t.cookies.teacher,
        { reason: 'Telif ihlali şüphesi' },
      ),
    )
    const before = await attemptRows(t.institution.id)
    fails(await start(assignmentId, t.cookies.student), 422, 'content_unavailable')
    assert.deepEqual(await attemptRows(t.institution.id), before)
    const saved = await ok(
      await save(
        attempt.id,
        t.cookies.student,
        { [t.items.main]: choice('a') },
        attempt.rowVersion,
      ),
    )
    const done = await ok(
      await submit(
        attempt.id,
        t.cookies.student,
        { answers: { [t.items.main]: choice('a') } },
        saved.rowVersion,
      ),
    )
    assert.equal(done.result.earned, 1)
  })
})
