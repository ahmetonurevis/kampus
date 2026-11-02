import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { ResourceVersionInput } from '@kampus/school-core/content/resource.ts'
import type { RubricVersionStatus } from '@kampus/school-core/skills/rubric.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { records } from '../src/db/schema/records.ts'
import {
  rubrics,
  rubricVersions,
  taskAssignments,
  taskAssignmentTargets,
} from '../src/db/schema/skills.ts'
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
import { sampleRubricData, seedSkillChain } from './support/skills-sample.ts'

/**
 * Görev atama uçları: liste, ayrıntı, oluşturma ve son teslim değişikliği (ADR 0004 karar 4;
 * DOM-KYN-032, DOM-BEC-041, 042, 044; IST-034). Kural core `skills/assignment.ts`'tedir; burada
 * rol × kapsam ızgarası, kurum sınırı, sıra (kapsam → yetki → sürüm), geçici API sınırları,
 * başarısızlıkta kaydın değişmediği ve kursiyer görünümünde iç alanların olmadığı denetlenir.
 */

type Json = ReturnType<typeof JSON.parse>

const DUE = '2026-10-20T20:59:00.000Z'
const LATER_DUE = '2026-10-27T20:59:00.000Z'
const SECRET_TITLE = 'Gizli hafta sonu yazısı'

const homework = (title = SECRET_TITLE): Partial<ResourceVersionInput> => ({
  title,
  content: {
    type: 'homework_template',
    instructions: 'Hafta sonunu anlatan kısa bir metin yaz.',
    submissionKinds: ['text', 'file', 'audio'],
    criteria: 'Zaman ifadeleri, paragraf düzeni ve yazım.',
    rubricId: null,
  },
  license: { kind: 'institution_original' },
  tags: { subjectId: 'ingilizce', gradeLevels: [9], primarySkill: 'writing', cefrLevel: 'A2' },
})

const listeningQuestion = (): Partial<ResourceVersionInput> => ({
  title: 'Dinleme sorusu',
  content: {
    type: 'question',
    question: {
      questionType: 'multiple_choice',
      stem: 'What does Tom do on Sundays?',
      options: [
        { id: 'a', text: 'He swims.' },
        { id: 'b', text: 'He reads.' },
        { id: 'c', text: 'He cooks.' },
        { id: 'd', text: 'He sleeps.' },
      ],
    },
  },
  answerKey: { questionType: 'multiple_choice', correctOptionId: 'b', explanation: 'GIZLI-COZUM' },
  license: { kind: 'institution_original' },
  tags: { subjectId: 'ingilizce', gradeLevels: [9], primarySkill: 'listening', cefrLevel: 'A2' },
})

describe('görev atama uçları', () => {
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
   * Okul: `t-eng` (İngilizce) 9-A'da ders verir ve rehberidir; `t-mat` (matematik) 9-B'de. `t-fiz`
   * hiçbir sınıfta ders vermez. Deniz (`s-1`) ve Ece (`s-2`) 9-A'da, Can (`s-3`) 9-B'de. Veli
   * Deniz'in velisidir.
   */
  async function tenant() {
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
        {
          collection: 'teachers',
          id: 't-fiz',
          data: { id: 't-fiz', name: 'Leyla Şahin', subjectId: 'fizik', branchId: 'b-1' },
        },
        {
          collection: 'classes',
          id: '9-A',
          data: { id: '9-A', grade: 9, level: '9', branchId: 'b-1', teacherId: 't-eng' },
        },
        {
          collection: 'classes',
          id: '9-B',
          data: { id: '9-B', grade: 9, level: '9', branchId: 'b-1', teacherId: 't-mat' },
        },
        ...[
          ['s-1', 'Deniz Yılmaz', '9-A'],
          ['s-2', 'Ece Yılmaz', '9-A'],
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
    const teacher = await createMember(app, institution.id, 'ogretmen', [
      { kind: 'teacher', recordId: 't-eng' },
    ])
    const otherTeacher = await createMember(app, institution.id, 'ogretmen', [
      { kind: 'teacher', recordId: 't-mat' },
    ])
    const outsideTeacher = await createMember(app, institution.id, 'ogretmen', [
      { kind: 'teacher', recordId: 't-fiz' },
    ])
    const student = await createMember(app, institution.id, 'ogrenci', [
      { kind: 'student', recordId: 's-1' },
    ])
    const otherStudent = await createMember(app, institution.id, 'ogrenci', [
      { kind: 'student', recordId: 's-3' },
    ])
    const parent = await createMember(app, institution.id, 'veli', [
      { kind: 'child', recordId: 's-1' },
    ])
    const frontDesk = await createMember(app, institution.id, 'onburo')
    const cookies = {
      admin: await signInAs(app, institution.admin),
      teacher: await signInAs(app, teacher),
      otherTeacher: await signInAs(app, otherTeacher),
      outsideTeacher: await signInAs(app, outsideTeacher),
      student: await signInAs(app, student),
      otherStudent: await signInAs(app, otherStudent),
      parent: await signInAs(app, parent),
      frontDesk: await signInAs(app, frontDesk),
    }
    const { resource, versions } = await seedResource(db, institution.id, {
      ownerUserId: teacher.id,
      versions: [
        { status: 'archived', input: homework('Eski yazı') },
        { status: 'published', input: homework() },
        { status: 'draft', input: homework('Taslak yazı') },
      ],
    })
    const rubric = async (status: RubricVersionStatus) => {
      const rubricId = randomUUID()
      const id = randomUUID()
      const at = { createdAt: FIXED_NOW, updatedAt: FIXED_NOW }
      await db
        .insert(rubrics)
        .values({ institutionId: institution.id, id: rubricId, ownerUserId: teacher.id, ...at })
      await db.insert(rubricVersions).values({
        institutionId: institution.id,
        id,
        rubricId,
        versionNumber: 1,
        status,
        ...sampleRubricData(),
        publishedAt: status === 'draft' ? null : FIXED_NOW,
        archivedAt: status === 'archived' ? FIXED_NOW : null,
        ...at,
      })
      return id
    }
    return {
      institution,
      teacher,
      otherTeacher,
      cookies,
      resourceId: resource.id,
      archivedVersionId: versions[0]!.id,
      versionId: versions[1]!.id,
      draftVersionId: versions[2]!.id,
      rubricVersionId: await rubric('published'),
      draftRubricVersionId: await rubric('draft'),
      archivedRubricVersionId: await rubric('archived'),
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
  const create = (
    cookie: string | undefined,
    payload: unknown,
    headers: Record<string, string> = key(),
  ) => call('POST', '/task-assignments', cookie, payload, headers)
  const change = (id: string, cookie: string | undefined, payload: unknown, version?: number) =>
    call(
      'PATCH',
      `/task-assignments/${id}`,
      cookie,
      payload,
      version === undefined ? {} : { 'if-match': `"${version}"` },
    )

  async function ok(response: Awaited<ReturnType<typeof call>>, status = 200) {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function fails(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
    assert.equal(response.statusCode, status, response.body)
    assert.equal(response.json().code, code, response.body)
  }

  const writing = (t: Tenant, overrides: Record<string, unknown> = {}) => ({
    resourceVersionId: t.versionId,
    settings: {
      deadline: { dueAt: DUE },
      submission: { submissionKind: 'text', maxVersions: 3 },
      rubricVersionId: t.rubricVersionId,
    },
    targets: [{ kind: 'class', id: '9-A' }],
    ...overrides,
  })
  const settingsWith = (t: Tenant, settings: Record<string, unknown>) =>
    writing(t, { settings: { ...writing(t).settings, ...settings } })

  /**
   * Listenin sırası: en yeni önce, eşitlikte kimlik (depo `listAssignments`). Test saati sabittir;
   * aynı anda yazılan atamaların sırası kimlikten hesaplanır, rastgele uuid sırasına güvenilmez.
   */
  const newestFirst = (...rows: Json[]): Json[] =>
    [...rows].sort((a, b) =>
      a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? 1 : -1,
    )

  /** Kurumun atama, hedef ve denetim satırları (değişmezlik denetimi). */
  async function snapshot(institutionId: string) {
    const assignments = await db
      .select()
      .from(taskAssignments)
      .where(eq(taskAssignments.institutionId, institutionId))
      .orderBy(taskAssignments.id)
    const targets = await db
      .select()
      .from(taskAssignmentTargets)
      .where(eq(taskAssignmentTargets.institutionId, institutionId))
      .orderBy(taskAssignmentTargets.assignmentId, taskAssignmentTargets.targetId)
    const audits = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.institutionId, institutionId))
    return { assignments, targets, audits: audits.length }
  }

  test('IST-034: 401 oturumsuz; ön büro bütün uçlarda, öğrenci ve veli yazmada 403; modül kapalıyken bütün uçlar 403 module_disabled', async () => {
    const t = await tenant()
    const created = await ok(await create(t.cookies.teacher, writing(t)), 201)
    const url = `/task-assignments/${created.id}`
    const requests = [
      { write: false, send: (c?: string) => call('GET', '/task-assignments', c) },
      { write: false, send: (c?: string) => call('GET', url, c) },
      { write: true, send: (c?: string) => create(c, writing(t)) },
      {
        write: true,
        send: (c?: string) => change(created.id, c, { deadline: { dueAt: LATER_DUE } }, 1),
      },
    ]
    const before = await snapshot(t.institution.id)
    for (const request of requests) {
      fails(await request.send(), 401, 'unauthenticated')
      fails(await request.send(t.cookies.frontDesk), 403, 'forbidden')
      if (request.write)
        for (const cookie of [t.cookies.student, t.cookies.parent])
          fails(await request.send(cookie), 403, 'forbidden')
    }
    assert.deepEqual(await snapshot(t.institution.id), before)

    // Kapalı kurum: modül kapısı kayıt aramadan önce çalışır.
    const closed = await createInstitution(app, { enabledModules: { learning: false } })
    const admin = await signInAs(app, closed.admin)
    const id = '00000000-0000-4000-8000-000000000001'
    const closedRequests = [
      call('GET', '/task-assignments', admin),
      call('GET', `/task-assignments/${id}`, admin),
      create(admin, writing(t)),
      change(id, admin, { deadline: { dueAt: LATER_DUE } }, 1),
    ]
    for (const response of await Promise.all(closedRequests))
      fails(response, 403, 'module_disabled')
  })

  test('DOM-KYN-032, DOM-BEC-022: oluşturma içerik ve rubrik sürümünü sabitler, scoringVersionId içerik sürümüdür; 201 + Location; denetim kaydı yalnız alan adları; gövdedeki institutionId etkisiz', async () => {
    const t = await tenant()
    const response = await create(t.cookies.teacher, {
      ...writing(t),
      institutionId: 'baska-kurum',
    })
    const data = await ok(response, 201)
    assert.equal(response.headers.location, `/api/v1/task-assignments/${data.id}`)
    assert.deepEqual(
      {
        view: data.view,
        resourceId: data.resourceId,
        resourceVersionId: data.resourceVersionId,
        scoringVersionId: data.scoringVersionId,
        rubricVersionId: data.rubricVersionId,
        title: data.title,
        contentType: data.contentType,
        scoringMode: data.scoringMode,
        kind: data.kind,
        attempts: data.attempts,
        deadline: data.deadline,
        submission: data.submission,
        assignedByUserId: data.assignedByUserId,
        targets: data.targets,
        rowVersion: data.rowVersion,
      },
      {
        view: 'staff',
        resourceId: t.resourceId,
        resourceVersionId: t.versionId,
        scoringVersionId: t.versionId,
        rubricVersionId: t.rubricVersionId,
        title: SECRET_TITLE,
        contentType: 'homework_template',
        scoringMode: 'teacher',
        kind: 'evaluation',
        attempts: { kind: 'evaluation', maxAttempts: 1, countPolicy: 'first' },
        deadline: { dueAt: DUE, lateAcceptanceDays: 0 },
        submission: { submissionKind: 'text', maxVersions: 3, minWords: null, maxWords: null },
        assignedByUserId: t.teacher.id,
        targets: [{ kind: 'class', id: '9-A' }],
        rowVersion: 1,
      },
    )
    const [stored] = await db
      .select({ institutionId: taskAssignments.institutionId })
      .from(taskAssignments)
      .where(eq(taskAssignments.id, data.id))
    assert.equal(stored?.institutionId, t.institution.id)
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.institution.id), eq(auditLog.entityId, data.id)))
    assert.equal(audit?.action, 'task_assignment.create')
    assert.equal(audit?.entityType, 'task_assignment')
    assert.deepEqual(audit?.changes, {
      fields: ['resourceVersionId', 'scoringVersionId', 'rubricVersionId', 'settings', 'targets'],
    })
    // Kalıcılık: ayrıntı aynı görünümü döndürür.
    assert.deepEqual(
      await ok(await call('GET', `/task-assignments/${data.id}`, t.cookies.teacher)),
      data,
    )
  })

  test('IST-034: Idempotency-Key zorunlu; aynı anahtar ilk yanıtı tekrarlar, farklı gövde 422; If-Match oluşturmada 400', async () => {
    const t = await tenant()
    const before = await snapshot(t.institution.id)
    fails(await create(t.cookies.teacher, writing(t), {}), 400, 'idempotency_key_required')
    fails(
      await create(t.cookies.teacher, writing(t), { ...key(), 'if-match': '"1"' }),
      400,
      'if_match_not_supported',
    )
    assert.deepEqual(await snapshot(t.institution.id), before)
    const headers = key()
    const first = await create(t.cookies.teacher, writing(t), headers)
    const replay = await create(t.cookies.teacher, writing(t), headers)
    assert.equal(first.statusCode, 201, first.body)
    assert.equal(replay.statusCode, 201, replay.body)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json(), first.json())
    // Tekrar da kaynağın adresini verir (istemci yönlendirmesi ilk yanıtla aynı).
    assert.equal(replay.headers.location, `/api/v1/task-assignments/${first.json().data.id}`)
    assert.equal(replay.headers.location, first.headers.location)
    fails(
      await create(
        t.cookies.teacher,
        writing(t, { targets: [{ kind: 'student', id: 's-2' }] }),
        headers,
      ),
      422,
      'idempotency_key_reused',
    )
    assert.equal((await snapshot(t.institution.id)).assignments.length, 1)
  })

  test('DOM-YTK-022, IST-034: öğretmen yalnız ders verdiği sınıfa ve öğrencilerine atar (403); olmayan hedef 404; görmediği içerik 404; hiçbir satır yazılmaz', async () => {
    const t = await tenant()
    const before = await snapshot(t.institution.id)
    fails(
      await create(t.cookies.teacher, writing(t, { targets: [{ kind: 'class', id: '9-B' }] })),
      403,
      'target_scope_denied',
    )
    fails(
      await create(t.cookies.teacher, writing(t, { targets: [{ kind: 'student', id: 's-3' }] })),
      403,
      'target_scope_denied',
    )
    const missing = await create(
      t.cookies.teacher,
      writing(t, {
        targets: [
          { kind: 'class', id: '9-A' },
          { kind: 'class', id: '12-Z' },
        ],
      }),
    )
    fails(missing, 404, 'not_found')
    assert.equal(missing.json().message, 'Seçilen hedef bulunamadı.')
    assert.deepEqual(missing.json().issues?.[0]?.path, ['targets', '1'])
    // Kapsam yetkiden, yetki sürümden önce: kapsam dışı hedef + taslak sürüm 403, 409 değil.
    fails(
      await create(
        t.cookies.teacher,
        writing(t, {
          resourceVersionId: t.draftVersionId,
          targets: [{ kind: 'class', id: '9-B' }],
        }),
      ),
      403,
      'target_scope_denied',
    )
    // Okulda dil grubu hedefi yoktur.
    fails(
      await create(t.cookies.teacher, writing(t, { targets: [{ kind: 'group', id: '9-A' }] })),
      422,
      'target_kind_invalid',
    )
    // Matematik öğretmeni İngilizce öğretmeninin özel içeriğini görmez: 404 (kapsam yetkiden önce).
    fails(
      await create(t.cookies.otherTeacher, writing(t, { targets: [{ kind: 'class', id: '9-B' }] })),
      404,
      'not_found',
    )
    // Olmayan ve uuid olmayan sürüm.
    fails(
      await create(t.cookies.admin, writing(t, { resourceVersionId: randomUUID() })),
      404,
      'not_found',
    )
    fails(
      await create(t.cookies.admin, writing(t, { resourceVersionId: 'rv-yok' })),
      404,
      'not_found',
    )
    assert.deepEqual(await snapshot(t.institution.id), before)
    // Yönetici kurumun her sınıfına atar.
    const data = await ok(
      await create(
        t.cookies.admin,
        writing(t, {
          targets: [
            { kind: 'class', id: '9-B' },
            { kind: 'student', id: 's-1' },
          ],
        }),
      ),
      201,
    )
    assert.equal(data.assignedByUserId, t.institution.admin.id)
  })

  test('DOM-KYN-032, DOM-BEC-022: taslak ve arşivli içerik sürümü, taslak ve arşivli rubrik sürümü 409; hiçbir satır yazılmaz', async () => {
    const t = await tenant()
    const before = await snapshot(t.institution.id)
    for (const resourceVersionId of [t.draftVersionId, t.archivedVersionId])
      fails(
        await create(t.cookies.teacher, writing(t, { resourceVersionId })),
        409,
        'resource_version_not_assignable',
      )
    for (const rubricVersionId of [t.draftRubricVersionId, t.archivedRubricVersionId])
      fails(
        await create(t.cookies.teacher, settingsWith(t, { rubricVersionId })),
        409,
        'rubric_version_not_assignable',
      )
    fails(
      await create(t.cookies.teacher, settingsWith(t, { rubricVersionId: randomUUID() })),
      404,
      'not_found',
    )
    // Yazma görevi rubriksiz atanmaz (DOM-BEC-020).
    fails(
      await create(t.cookies.teacher, settingsWith(t, { rubricVersionId: null })),
      422,
      'rubric_required',
    )
    assert.deepEqual(await snapshot(t.institution.id), before)
  })

  test('ADR 0004 karar 6: dosyalı ve sesli teslim 422 submission_kind_unavailable; DOM-BEC-005 (OG-049): dinleme hakkı core varsayılanıyla 2, 1 ve sınırsız seçilebilir, 3 400', async () => {
    const t = await tenant()
    const before = await snapshot(t.institution.id)
    for (const submission of [
      { submissionKind: 'file', maxVersions: 2 },
      { submissionKind: 'audio', maxVersions: 1, speakingSeconds: 60 },
    ]) {
      const rejected = await create(t.cookies.teacher, settingsWith(t, { submission }))
      fails(rejected, 422, 'submission_kind_unavailable')
      assert.deepEqual(rejected.json().issues?.[0]?.path, [
        'settings',
        'submission',
        'submissionKind',
      ])
    }
    const { versions } = await seedResource(db, t.institution.id, {
      ownerUserId: t.teacher.id,
      versions: [{ status: 'published', input: listeningQuestion() }],
    })
    const others = await Promise.all(
      [0, 1].map(() =>
        seedResource(db, t.institution.id, {
          ownerUserId: t.teacher.id,
          versions: [{ status: 'published', input: listeningQuestion() }],
        }),
      ),
    )
    const listening = (settings: Record<string, unknown>, versionId = versions[0]!.id) => ({
      resourceVersionId: versionId,
      settings: { deadline: { dueAt: DUE }, ...settings },
      targets: [{ kind: 'class', id: '9-A' }],
    })
    const invalid = await create(t.cookies.teacher, listening({ listeningPlays: 3 }))
    assert.equal(invalid.statusCode, 400, invalid.body)
    assert.deepEqual(await snapshot(t.institution.id), before)
    // Gönderilmeyen hak core varsayılanıdır (2).
    const data = await ok(await create(t.cookies.teacher, listening({})), 201)
    assert.equal(data.listeningPlays, 2)
    assert.equal(data.scoringMode, 'auto')
    const storedPlays = async (assignmentId: string) =>
      (
        await db
          .select({ listeningPlays: taskAssignments.listeningPlays })
          .from(taskAssignments)
          .where(eq(taskAssignments.id, assignmentId))
      )[0]?.listeningPlays
    assert.equal(await storedPlays(data.id), 2)
    // 1 ve açık sınırsız da kabul edilir.
    const once = await ok(
      await create(t.cookies.teacher, listening({ listeningPlays: 1 }, others[0]!.versions[0]!.id)),
      201,
    )
    assert.equal(await storedPlays(once.id), 1)
    const unlimited = await ok(
      await create(
        t.cookies.teacher,
        listening({ listeningPlays: null }, others[1]!.versions[0]!.id),
      ),
      201,
    )
    assert.equal(await storedPlays(unlimited.id), null)
    // Aynı kursiyerlere ikinci açık atama 409.
    fails(
      await create(t.cookies.teacher, listening({ listeningPlays: 1 })),
      409,
      'assignment_duplicate',
    )
    // Cevap anahtarı hiçbir atama yanıtında yoktur (DOM-BEC-045).
    assert.ok(!JSON.stringify(data).includes('GIZLI-COZUM'))
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const detail = await ok(await call('GET', `/task-assignments/${data.id}`, cookie))
      assert.equal(detail.view, 'learner')
      assert.equal(detail.listeningPlays, 2)
      for (const text of ['GIZLI-COZUM', 'correctOptionId', 'answerKey'])
        assert.ok(!JSON.stringify(detail).includes(text), `${text} kursiyere gitti`)
    }
  })

  test('DOM-KYN-021: lisansı dolmuş içerik 409 resource_license_expired; açık atama çakışmasından önce denetlenir; hiçbir satır yazılmaz', async () => {
    const t = await tenant()
    const license = {
      kind: 'licensed_publication' as const,
      publisher: 'Örnek Yayınevi',
      contractNumber: 'SZ-2026-01',
      coverage: 'Kurumun bütün öğrencileri',
      expiryDate: '2026-10-05',
      restrictedToBookOwners: false,
    }
    const { versions } = await seedResource(db, t.institution.id, {
      ownerUserId: t.teacher.id,
      versions: [{ status: 'published', input: { ...homework('Lisanslı yazı'), license } }],
    })
    const before = await snapshot(t.institution.id)
    const expired = writing(t, { resourceVersionId: versions[0]!.id })
    const response = await create(t.cookies.teacher, expired)
    fails(response, 409, 'resource_license_expired')
    assert.match(response.json().message, /lisans süresi dolmuş/)
    assert.deepEqual(await snapshot(t.institution.id), before)
    // Lisans süresinin son günü atanabilir (`expiryDate` gün sonuna kadar geçerli).
    const { versions: valid } = await seedResource(db, t.institution.id, {
      ownerUserId: t.teacher.id,
      versions: [
        {
          status: 'published',
          input: {
            ...homework('Geçerli lisanslı yazı'),
            license: { ...license, expiryDate: '2026-10-06' },
          },
        },
      ],
    })
    await ok(await create(t.cookies.teacher, writing(t, { resourceVersionId: valid[0]!.id })), 201)
    // Aynı kursiyerlere açık atama varken de lisans hatası önce gelir.
    fails(await create(t.cookies.teacher, expired), 409, 'resource_license_expired')
  })

  test('DOM-YTK-025: veli yalnız kendi çocuğuna hedeflenen atamayı görür; aynı sınıftaki başka çocuğa hedeflenen görünmez', async () => {
    const t = await tenant()
    const toEce = await ok(
      await create(t.cookies.teacher, writing(t, { targets: [{ kind: 'student', id: 's-2' }] })),
      201,
    )
    for (const cookie of [t.cookies.parent, t.cookies.student]) {
      assert.deepEqual(await ok(await call('GET', '/task-assignments', cookie)), [])
      fails(await call('GET', `/task-assignments/${toEce.id}`, cookie), 404, 'not_found')
    }
    // Sınıf hedefinde velinin gördüğü kursiyer listesi yalnız kendi çocuğudur.
    const { versions } = await seedResource(db, t.institution.id, {
      ownerUserId: t.teacher.id,
      versions: [{ status: 'published', input: homework('Sınıf yazısı') }],
    })
    const toClass = await ok(
      await create(t.cookies.teacher, writing(t, { resourceVersionId: versions[0]!.id })),
      201,
    )
    const [row] = await ok(await call('GET', '/task-assignments', t.cookies.parent))
    assert.equal(row.id, toClass.id)
    assert.deepEqual(row.learnerIds, ['s-1'])
  })

  test('DOM-YTK-028, IST-034: dil okulunda görev gruba atanır; grubun kursiyeri ve grubun öğretmeni görür, başka grup görmez; sınıf hedefi 422', async () => {
    const institution = await createInstitution(app, { type: 'language_school' })
    await insertMissingRecords(
      db,
      institution.id,
      [
        {
          collection: 'teachers',
          id: 't-dil',
          data: { id: 't-dil', name: 'Selin Kaya', subjectId: 'ingilizce', branchId: 'b-1' },
        },
        ...['A2-1', 'B1-1'].map((id) => ({
          collection: 'classes' as const,
          id,
          data: { id, grade: 0, level: id.slice(0, 2), branchId: 'b-1', teacherId: 't-dil' },
        })),
        ...[
          ['k-1', 'Deniz Yılmaz', 'A2-1'],
          ['k-2', 'Can Arslan', 'B1-1'],
        ].map(([id, name, classId]) => ({
          collection: 'students' as const,
          id: id!,
          data: { id, name, classId, isActive: true },
        })),
        {
          collection: 'assignments',
          id: 'as-dil',
          data: { id: 'as-dil', classId: 'A2-1', teacherId: 't-dil', subjectId: 'ingilizce' },
        },
      ],
      FIXED_NOW,
    )
    const teacher = await createMember(app, institution.id, 'ogretmen', [
      { kind: 'teacher', recordId: 't-dil' },
    ])
    const learner = await createMember(app, institution.id, 'ogrenci', [
      { kind: 'student', recordId: 'k-1' },
    ])
    const otherLearner = await createMember(app, institution.id, 'ogrenci', [
      { kind: 'student', recordId: 'k-2' },
    ])
    const cookies = {
      admin: await signInAs(app, institution.admin),
      teacher: await signInAs(app, teacher),
      learner: await signInAs(app, learner),
      otherLearner: await signInAs(app, otherLearner),
    }
    const { versions } = await seedResource(db, institution.id, {
      ownerUserId: institution.admin.id,
      shareScope: 'institution',
      versions: [{ status: 'published', input: homework() }],
    })
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
      archivedAt: null,
      ...at,
    })
    const body = (targets: unknown) => ({
      resourceVersionId: versions[0]!.id,
      settings: {
        deadline: { dueAt: DUE },
        submission: { submissionKind: 'text', maxVersions: 3 },
        rubricVersionId,
      },
      targets,
    })
    fails(
      await create(cookies.admin, body([{ kind: 'class', id: 'A2-1' }])),
      422,
      'target_kind_invalid',
    )
    const data = await ok(await create(cookies.admin, body([{ kind: 'group', id: 'A2-1' }])), 201)
    assert.deepEqual(data.targets, [{ kind: 'group', id: 'A2-1' }])
    const seen = await ok(await call('GET', '/task-assignments', cookies.learner))
    assert.deepEqual(
      seen.map((row: Json) => [row.id, row.view, row.learnerIds]),
      [[data.id, 'learner', ['k-1']]],
    )
    assert.deepEqual(await ok(await call('GET', '/task-assignments', cookies.otherLearner)), [])
    fails(await call('GET', `/task-assignments/${data.id}`, cookies.otherLearner), 404, 'not_found')
    // Grubun öğretmeni yöneticinin atamasını görür (DOM-YTK-028), değiştiremez.
    const staff = await ok(await call('GET', `/task-assignments/${data.id}`, cookies.teacher))
    assert.deepEqual(staff.targets, [{ kind: 'group', id: 'A2-1' }])
    fails(
      await change(data.id, cookies.teacher, { deadline: { dueAt: LATER_DUE } }, 1),
      403,
      'forbidden',
    )
  })

  test('IST-034: aynı içerik farklı sınıfa farklı son tarihle ayrı atamadır; açık atamadaki kursiyere ikinci kez 409', async () => {
    const t = await tenant()
    const first = await ok(await create(t.cookies.teacher, writing(t)), 201)
    fails(await create(t.cookies.teacher, writing(t)), 409, 'assignment_duplicate')
    fails(
      await create(t.cookies.teacher, settingsWith(t, { deadline: { dueAt: LATER_DUE } })),
      409,
      'assignment_overlap',
    )
    const second = await ok(
      await create(
        t.cookies.admin,
        writing(t, {
          settings: { ...writing(t).settings, deadline: { dueAt: LATER_DUE } },
          targets: [{ kind: 'class', id: '9-B' }],
        }),
      ),
      201,
    )
    assert.notEqual(second.id, first.id)
    assert.equal(second.resourceVersionId, first.resourceVersionId)
    const list = await call('GET', `/task-assignments?resourceId=${t.resourceId}`, t.cookies.admin)
    assert.equal(list.statusCode, 200, list.body)
    assert.deepEqual(
      list.json().data.map((row: Json) => [row.id, row.deadline.dueAt]),
      newestFirst(first, second).map((row) => [row.id, row.deadline.dueAt]),
    )
  })

  test('IST-034, DOM-YTK-028: rol × kapsam: yönetici hepsini, öğretmen kendi atamalarını ve kapsamındaki hedefleri, öğrenci kendisine, veli çocuğuna hedeflenenleri görür; kursiyer görünümünde iç alan ve anahtar yok', async () => {
    const t = await tenant()
    const toClass = await ok(await create(t.cookies.teacher, writing(t)), 201)
    const toOther = await ok(
      await create(
        t.cookies.admin,
        writing(t, {
          settings: { ...writing(t).settings, deadline: { dueAt: LATER_DUE } },
          targets: [{ kind: 'student', id: 's-3' }],
        }),
      ),
      201,
    )
    const ids = async (cookie: string, query = '') => {
      const response = await call('GET', `/task-assignments${query}`, cookie)
      assert.equal(response.statusCode, 200, response.body)
      const body = response.json()
      return { ids: body.data.map((row: Json) => row.id), total: body.meta.total, body }
    }
    const ordered = newestFirst(toClass, toOther).map((row) => row.id)
    assert.deepEqual((await ids(t.cookies.admin)).ids, ordered)
    assert.deepEqual((await ids(t.cookies.teacher)).ids, [toClass.id])
    // Matematik öğretmeni 9-B'de ders verir: Can'a hedeflenen atamayı görür, 9-A'nınkini görmez.
    assert.deepEqual((await ids(t.cookies.otherTeacher)).ids, [toOther.id])
    assert.deepEqual((await ids(t.cookies.outsideTeacher)).ids, [])
    assert.deepEqual((await ids(t.cookies.otherStudent)).ids, [toOther.id])
    assert.deepEqual((await ids(t.cookies.admin, '?pageSize=1&page=2')).ids, [ordered[1]])
    assert.equal((await ids(t.cookies.admin, '?pageSize=1')).total, 2)
    assert.equal((await ids(t.cookies.admin, '?kind=practice')).total, 0)
    fails(
      await call('GET', '/task-assignments?status=open', t.cookies.admin),
      400,
      'validation_failed',
    )

    const internal = [
      'targets',
      'scoringVersionId',
      'rubricVersionId',
      'highStakes',
      'secondRatingPercent',
      'assignedByUserId',
      'rowVersion',
      'archivedAt',
    ]
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const { ids: seen, body } = await ids(cookie)
      assert.deepEqual(seen, [toClass.id])
      const [row] = body.data
      assert.equal(row.view, 'learner')
      assert.deepEqual(row.learnerIds, ['s-1'])
      assert.equal(row.title, SECRET_TITLE)
      for (const field of internal) assert.ok(!(field in row), `${field} kursiyere gitti`)
      const detail = await ok(await call('GET', `/task-assignments/${toClass.id}`, cookie))
      const { content, contentUnavailable, ...summary } = detail
      assert.deepEqual(summary, row)
      // Ayrıntı sabitlenen sürümün kursiyere dönük yönergesini taşır; ölçüt ve rubrik bağı yok.
      assert.equal(contentUnavailable, null)
      assert.equal(content.versionId, toClass.resourceVersionId)
      assert.equal(content.body.instructions, 'Hafta sonunu anlatan kısa bir metin yaz.')
      assert.deepEqual(Object.keys(content.body).sort(), [
        'instructions',
        'submissionKinds',
        'type',
      ])
      for (const text of [
        t.rubricVersionId,
        t.teacher.id,
        'answerKey',
        's-2',
        '9-A',
        'Zaman ifadeleri',
        'criteria',
        'rubricId',
      ])
        assert.ok(!JSON.stringify(detail).includes(text), `${text} kursiyere gitti`)
      fails(await call('GET', `/task-assignments/${toOther.id}`, cookie), 404, 'not_found')
    }
    // Kapsam dışındaki başka öğretmenin ataması 404; yönetici her atamayı görür.
    for (const cookie of [t.cookies.otherTeacher, t.cookies.outsideTeacher])
      fails(await call('GET', `/task-assignments/${toClass.id}`, cookie), 404, 'not_found')
    assert.equal(
      (await ok(await call('GET', `/task-assignments/${toOther.id}`, t.cookies.admin))).view,
      'staff',
    )
    fails(await call('GET', '/task-assignments/rv-yok', t.cookies.admin), 400, 'validation_failed')
  })

  test('IST-034 (F4b2b kararı): sınıf hedefli atama sınıfın güncel öğrencilerine görünür; sınıf değiştiren öğrenci yeni sınıfınınkini görür, eskisini görmez', async () => {
    const t = await tenant()
    const toA = await ok(await create(t.cookies.teacher, writing(t)), 201)
    const toB = await ok(
      await create(
        t.cookies.admin,
        writing(t, {
          settings: { ...writing(t).settings, deadline: { dueAt: LATER_DUE } },
          targets: [{ kind: 'class', id: '9-B' }],
        }),
      ),
      201,
    )
    const seen = async (cookie: string) =>
      (await ok(await call('GET', '/task-assignments', cookie))).map((row: Json) => row.id)
    assert.deepEqual(await seen(t.cookies.student), [toA.id])
    // Deniz 9-A'dan 9-B'ye geçer (kayıt doğrudan güncellenir; geçiş ucu bu testin konusu değil).
    await db
      .update(records)
      .set({ data: { id: 's-1', name: 'Deniz Yılmaz', classId: '9-B', isActive: true } })
      .where(
        and(
          eq(records.institutionId, t.institution.id),
          eq(records.collection, 'students'),
          eq(records.id, 's-1'),
        ),
      )
    // Atama listesi yalnız güncel hedefi izler; eski sınıfta yapılan deneme ve teslim deneme/teslim
    // uçlarında görünür (F4b3a; test/task-attempts.test.ts, test/task-submissions.test.ts).
    for (const cookie of [t.cookies.student, t.cookies.parent])
      assert.deepEqual(await seen(cookie), [toB.id])
    fails(await call('GET', `/task-assignments/${toA.id}`, t.cookies.student), 404, 'not_found')
  })

  test('DOM-YTK-028: öğretmen ders verdiği sınıfı ve o sınıfın öğrencilerini hedefleyen atamayı görür, hedef listesinde yalnız kendi kapsamı; atayan değilse değiştiremez: kapsam dışı 404 → yetkisiz 403 → sürüm 409', async () => {
    const t = await tenant()
    const mixed = await ok(
      await create(
        t.cookies.admin,
        writing(t, {
          targets: [
            { kind: 'class', id: '9-A' },
            { kind: 'student', id: 's-3' },
          ],
        }),
      ),
      201,
    )
    const url = `/task-assignments/${mixed.id}`
    const seen = async (cookie: string) =>
      (await ok(await call('GET', '/task-assignments', cookie))).map((row: Json) => [
        row.id,
        row.targets,
      ])
    // Sınıf hedefi üzerinden İngilizce öğretmeni, öğrenci hedefi üzerinden matematik öğretmeni görür.
    assert.deepEqual(await seen(t.cookies.teacher), [[mixed.id, [{ kind: 'class', id: '9-A' }]]])
    assert.deepEqual(await seen(t.cookies.otherTeacher), [
      [mixed.id, [{ kind: 'student', id: 's-3' }]],
    ])
    assert.deepEqual(await seen(t.cookies.outsideTeacher), [])
    const detail = await ok(await call('GET', url, t.cookies.otherTeacher))
    assert.equal(detail.view, 'staff')
    assert.equal(detail.assignedByUserId, t.institution.admin.id)
    assert.deepEqual(detail.targets, [{ kind: 'student', id: 's-3' }])
    assert.deepEqual((await ok(await call('GET', url, t.cookies.admin))).targets, mixed.targets)
    fails(await call('GET', url, t.cookies.outsideTeacher), 404, 'not_found')

    const before = await snapshot(t.institution.id)
    const extend = { deadline: { dueAt: LATER_DUE } }
    for (const version of [1, 9]) {
      // Kapsam: atamayı göremeyen öğretmen sürümden bağımsız 404.
      fails(await change(mixed.id, t.cookies.outsideTeacher, extend, version), 404, 'not_found')
      // Yetki: görebilen ama atayan olmayan öğretmen sürümden bağımsız 403.
      for (const cookie of [t.cookies.teacher, t.cookies.otherTeacher])
        fails(await change(mixed.id, cookie, extend, version), 403, 'forbidden')
    }
    // Sürüm: yetkili yönetici yanlış sürümle 409.
    fails(await change(mixed.id, t.cookies.admin, extend, 9), 409, 'version_conflict')
    assert.deepEqual(await snapshot(t.institution.id), before)
    assert.deepEqual(
      (await ok(await change(mixed.id, t.cookies.admin, extend, 1))).deadline.dueAt,
      LATER_DUE,
    )
  })

  test('DOM-BEC-041, 042, 044: değişiklik yalnız son teslimi uzatır; If-Match zorunlu ve sürüm 409; kısaltma 422; sabit alan 409; başka öğretmen 404; kayıt değişmez', async () => {
    const t = await tenant()
    const created = await ok(await create(t.cookies.teacher, writing(t)), 201)
    const before = await snapshot(t.institution.id)
    const extend = { deadline: { dueAt: LATER_DUE, lateAcceptanceDays: 2 } }
    fails(await change(created.id, t.cookies.teacher, extend), 400, 'if_match_required')
    fails(await change(created.id, t.cookies.teacher, extend, 2), 409, 'version_conflict')
    fails(await change(created.id, t.cookies.teacher, {}, 1), 400, 'validation_failed')
    fails(
      await change(
        created.id,
        t.cookies.teacher,
        { deadline: { dueAt: '2026-10-10T20:59:00.000Z' } },
        1,
      ),
      422,
      'deadline_shortened',
    )
    for (const frozen of [
      { kind: 'practice' },
      { resourceVersionId: t.draftVersionId },
      { scoringVersionId: t.draftVersionId },
      { rubricVersionId: t.draftRubricVersionId },
      { attempts: { kind: 'evaluation', maxAttempts: 3, countPolicy: 'highest' } },
      { ...extend, targets: [{ kind: 'class', id: '9-B' }] },
    ])
      fails(
        await change(created.id, t.cookies.teacher, frozen, 1),
        409,
        'assignment_setting_frozen',
      )
    // Kapsam sürümden önce: başka öğretmen yanlış sürümle de 404 alır.
    for (const version of [1, 9])
      fails(await change(created.id, t.cookies.otherTeacher, extend, version), 404, 'not_found')
    fails(await change(randomUUID(), t.cookies.admin, extend, 1), 404, 'not_found')
    assert.deepEqual(await snapshot(t.institution.id), before)

    const updated = await ok(await change(created.id, t.cookies.teacher, extend, 1))
    assert.deepEqual(updated.deadline, extend.deadline)
    assert.equal(updated.rowVersion, 2)
    assert.equal(updated.resourceVersionId, t.versionId)
    assert.equal(updated.scoringVersionId, t.versionId)
    assert.equal(updated.rubricVersionId, t.rubricVersionId)
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.institution.id),
          eq(auditLog.action, 'task_assignment.update'),
        ),
      )
    assert.deepEqual(audit?.changes, { fields: ['deadline'] })
    // Yönetici de uzatır; idempotent tekrar aynı yanıtı verir.
    const headers = { 'if-match': '"2"', ...key() }
    const again = { deadline: { dueAt: LATER_DUE, lateAcceptanceDays: 3 } }
    const first = await call(
      'PATCH',
      `/task-assignments/${created.id}`,
      t.cookies.admin,
      again,
      headers,
    )
    const replay = await call(
      'PATCH',
      `/task-assignments/${created.id}`,
      t.cookies.admin,
      again,
      headers,
    )
    assert.equal(first.statusCode, 200, first.body)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(replay.json().data.rowVersion, 3)
  })

  test('DOM-BEC-045: değerlendirmenin cevap anahtarı açılınca son teslim uzatılamaz 409 answer_key_released; yazma görevi ve kapanış öncesi uzar; kayıt değişmez', async () => {
    const t = await tenant()
    const { versions } = await seedResource(db, t.institution.id, {
      ownerUserId: t.teacher.id,
      versions: [{ status: 'published', input: listeningQuestion() }],
    })
    const quiz = await ok(
      await create(t.cookies.teacher, {
        resourceVersionId: versions[0]!.id,
        settings: { deadline: { dueAt: DUE } },
        targets: [{ kind: 'class', id: '9-A' }],
      }),
      201,
    )
    const written = await ok(await create(t.cookies.teacher, writing(t)), 201)
    try {
      // Kapanıştan sonra (geç kabul yok): anahtar açık, uzatma kopyaya kapı açardı.
      now = new Date(new Date(DUE).getTime() + 60_000)
      const before = await snapshot(t.institution.id)
      for (const deadline of [{ dueAt: LATER_DUE }, { dueAt: DUE, lateAcceptanceDays: 2 }])
        for (const cookie of [t.cookies.teacher, t.cookies.admin])
          fails(await change(quiz.id, cookie, { deadline }, 1), 409, 'answer_key_released')
      assert.deepEqual(await snapshot(t.institution.id), before)
      // Anahtarı olmayan yazma görevi kapanıştan sonra da uzatılır.
      const extended = await ok(
        await change(written.id, t.cookies.teacher, { deadline: { dueAt: LATER_DUE } }, 1),
      )
      assert.equal(extended.deadline.dueAt, LATER_DUE)
      // Kapanış anında teslim hâlâ alınır, anahtar kapalıdır: uzatma serbest.
      now = new Date(DUE)
      const open = await ok(
        await change(quiz.id, t.cookies.teacher, { deadline: { dueAt: LATER_DUE } }, 1),
      )
      assert.equal(open.deadline.dueAt, LATER_DUE)
    } finally {
      now = FIXED_NOW
    }
  })

  test('IST-034: kurumlar arası: B kurumunun atamasına, içerik ve rubrik sürümüne erişim 404; listede B kaydı yok; B satırları değişmez', async () => {
    const t = await tenant()
    const other = await createInstitution(app)
    const chain = await seedSkillChain(db, other.id, other.admin.id)
    const before = await snapshot(other.id)
    const extend = { deadline: { dueAt: LATER_DUE } }
    fails(
      await call('GET', `/task-assignments/${chain.assignmentId}`, t.cookies.admin),
      404,
      'not_found',
    )
    fails(await change(chain.assignmentId, t.cookies.admin, extend, 1), 404, 'not_found')
    fails(
      await create(t.cookies.admin, writing(t, { resourceVersionId: chain.resourceVersionId })),
      404,
      'not_found',
    )
    fails(
      await create(t.cookies.admin, settingsWith(t, { rubricVersionId: chain.rubricVersionId })),
      404,
      'not_found',
    )
    const list = await call('GET', '/task-assignments', t.cookies.admin)
    assert.equal(list.statusCode, 200, list.body)
    assert.ok(!list.body.includes(chain.assignmentId))
    assert.deepEqual(await snapshot(other.id), before)
    assert.deepEqual((await snapshot(t.institution.id)).assignments, [])
  })

  test('ADR 0004 karar 4: log ve denetim kaydında içerik başlığı, öğrenci ve hedef kimliği yok', async () => {
    const t = await tenant()
    const start = logs.length
    const data = await ok(
      await create(t.cookies.teacher, writing(t, { targets: [{ kind: 'student', id: 's-2' }] })),
      201,
    )
    await ok(await change(data.id, t.cookies.teacher, { deadline: { dueAt: LATER_DUE } }, 1))
    await ok(await call('GET', '/task-assignments', t.cookies.student))
    const written = logs.slice(start).join('\n')
    assert.ok(written.includes('task_assignment.create'), 'işlem logu yok')
    for (const text of [SECRET_TITLE, 's-2', 'Hafta sonunu anlatan'])
      assert.ok(!written.includes(text), `${text} loglandı`)
    const audits = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(eq(auditLog.institutionId, t.institution.id))
    assert.ok(!JSON.stringify(audits).includes('s-2'))
    assert.ok(!JSON.stringify(audits).includes(SECRET_TITLE))
  })
})
