import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { ResourceVersionInput } from '@kampus/school-core/content/resource.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  rubrics,
  rubricVersions,
  taskAssignments,
  taskAssignmentTargets,
} from '../src/db/schema/skills.ts'
import type { ServiceContext } from '../src/plugins/authenticate.ts'
import { getContentAssignmentResults } from '../src/services/content-results.ts'
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
 * İçerikten toplu atama ve içeriğe bağlı sonuç özeti uçları (OG-089; IST-034; DOM-BEC-049,
 * DOM-BEC-036). Kural core `skills/assignment.ts` `planAssignmentBatch` ve
 * `skills/content-results.ts`'tedir; burada kimlik, rol, modül, kurum sınırı, tek transaction
 * (bir öğe reddedilince hiçbir atama yazılmaz), mükerrer istek ve rol kapsamlı özet denetlenir.
 */

type Json = ReturnType<typeof JSON.parse>

const DUE = '2026-10-20T20:59:00.000Z'
const LATER_DUE = '2026-10-27T20:59:00.000Z'

const tags = { subjectId: 'ingilizce', gradeLevels: [9], primarySkill: 'reading', cefrLevel: 'A2' }

const question = (stem: string, correctOptionId: string): Partial<ResourceVersionInput> => ({
  title: `Soru: ${stem}`,
  content: {
    type: 'question',
    question: {
      questionType: 'multiple_choice',
      stem,
      options: [
        { id: 'a', text: 'One.' },
        { id: 'b', text: 'Two.' },
        { id: 'c', text: 'Three.' },
        { id: 'd', text: 'Four.' },
      ],
    },
  },
  answerKey: { questionType: 'multiple_choice', correctOptionId, explanation: 'Metne bak.' },
  license: { kind: 'institution_original' },
  tags: tags as ResourceVersionInput['tags'],
})

const choice = (optionId: string) => ({ questionType: 'multiple_choice' as const, optionId })

describe('içerikten toplu atama ve sonuç özeti uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.2.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  /**
   * `t-eng` (İngilizce) 9-A ve 9-B'de ders verir; `t-mat` (matematik) 9-C'de. Deniz (`s-1`) ve Ece
   * (`s-2`) 9-A'da, Can (`s-3`) 9-B'de, Ada (`s-4`) 9-C'de. Quiz iki sorudur (1 + 3 puan).
   */
  async function tenant() {
    clientIp = `10.2.${(tenantCount += 1)}.1`
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
        ...[
          ['9-A', 't-eng'],
          ['9-B', 't-eng'],
          ['9-C', 't-mat'],
        ].map(([id, teacherId]) => ({
          collection: 'classes' as const,
          id: id!,
          data: { id, grade: 9, level: '9', branchId: 'b-1', teacherId },
        })),
        ...[
          ['s-1', 'Deniz Yılmaz', '9-A'],
          ['s-2', 'Ece Yılmaz', '9-A'],
          ['s-3', 'Can Arslan', '9-B'],
          ['s-4', 'Ada Kurt', '9-C'],
        ].map(([id, name, classId]) => ({
          collection: 'students' as const,
          id: id!,
          data: { id, name, classId, isActive: true },
        })),
        ...[
          ['as-1', '9-A', 't-eng', 'ingilizce'],
          ['as-2', '9-B', 't-eng', 'ingilizce'],
          ['as-3', '9-C', 't-mat', 'matematik'],
        ].map(([id, classId, teacherId, subjectId]) => ({
          collection: 'assignments' as const,
          id: id!,
          data: { id, classId, teacherId, subjectId },
        })),
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
    const seed = async (input: Partial<ResourceVersionInput>) => {
      const { resource, versions } = await seedResource(db, institution.id, {
        ownerUserId: teacher.id,
        // Kurum paylaşımı: ders vermeyen öğretmen de okur; özel içerik ayrı denenir (`hidden`).
        shareScope: 'institution',
        versions: [{ status: 'published', input }],
      })
      return { resourceId: resource.id, versionId: versions[0]!.id }
    }
    const first = await seed(question('Kaç kedi var?', 'a'))
    const second = await seed(question('Kaç köpek var?', 'b'))
    const quiz = await seed({
      title: 'Okuma quizi',
      content: {
        type: 'quiz',
        items: [
          { questionVersionId: first.versionId, points: 1 },
          { questionVersionId: second.versionId, points: 3 },
        ],
      },
      license: { kind: 'institution_original' },
      tags: tags as ResourceVersionInput['tags'],
    })
    const homework = await seed({
      title: 'Hafta sonu yazısı',
      content: {
        type: 'homework_template',
        instructions: 'Hafta sonunu anlatan kısa bir metin yaz.',
        submissionKinds: ['text'],
        criteria: 'Zaman ifadeleri ve paragraf düzeni.',
        rubricId: null,
      },
      license: { kind: 'institution_original' },
      tags: { ...tags, primarySkill: 'writing' } as ResourceVersionInput['tags'],
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
      ...at,
    })
    // Yalnız sahibinin gördüğü özel taslak (ders vermeyen öğretmen okuyamaz).
    const hidden = (
      await seedResource(db, institution.id, {
        ownerUserId: teacher.id,
        shareScope: 'private',
        versions: [{ status: 'draft', input: question('Gizli soru?', 'a') }],
      })
    ).resource.id
    return {
      institution,
      cookies,
      quiz,
      homework,
      rubricVersionId,
      hidden,
      items: [first.versionId, second.versionId] as const,
    }
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  function call(
    method: 'GET' | 'POST',
    url: string,
    cookie?: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url: `/api/v1${url}`,
      remoteAddress: clientIp,
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
  const match = (value: number) => ({ 'if-match': `"${value}"` })

  async function ok(response: Awaited<ReturnType<typeof call>>, status = 200) {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function fails(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
    assert.equal(response.statusCode, status, response.body)
    assert.equal(response.json().code, code, response.body)
  }

  const item = (t: Tenant, classId: string, dueAt = DUE) => ({
    resourceVersionId: t.quiz.versionId,
    settings: { deadline: { dueAt } },
    targets: [{ kind: 'class', id: classId }],
  })
  const batch = (cookie: string | undefined, payload: unknown, headers = key()) =>
    call('POST', '/task-assignments/batches', cookie, payload, headers)
  const results = (resourceId: string, cookie?: string) =>
    call('GET', `/resources/${resourceId}/assignment-results`, cookie)

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
      .select({ action: auditLog.action, entityId: auditLog.entityId })
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, institutionId), eq(auditLog.entityType, 'task_assignment')),
      )
      .orderBy(auditLog.entityId)
    return { assignments, targets, audits }
  }

  /** Öğrenci denemeyi başlatır ve verilen cevaplarla teslim eder. */
  async function solve(cookie: string, assignmentId: string, answers: Record<string, unknown>) {
    const attempt = await ok(
      await call('POST', `/task-assignments/${assignmentId}/attempts`, cookie, {}, key()),
      201,
    )
    await ok(
      await call(
        'POST',
        `/task-attempts/${attempt.id}/submit`,
        cookie,
        { answers },
        { ...key(), ...match(attempt.rowVersion) },
      ),
    )
  }

  test('DOM-BEC-049, IST-034: 401; öğrenci, veli ve ön büro 403; modül kapalıyken 403 module_disabled', async () => {
    const t = await tenant()
    const body = { items: [item(t, '9-A')] }
    fails(await batch(undefined, body), 401, 'unauthenticated')
    fails(await results(t.quiz.resourceId), 401, 'unauthenticated')
    for (const cookie of [t.cookies.student, t.cookies.parent, t.cookies.frontDesk]) {
      fails(await batch(cookie, body), 403, 'forbidden')
      fails(await results(t.quiz.resourceId, cookie), 403, 'forbidden')
    }
    const closed = await createInstitution(app, { enabledModules: { learning: false } })
    const cookie = await signInAs(app, closed.admin)
    fails(await batch(cookie, body), 403, 'module_disabled')
    fails(await results(t.quiz.resourceId, cookie), 403, 'module_disabled')
    assert.equal((await snapshot(t.institution.id)).assignments.length, 0)
  })

  test('DOM-BEC-049, IST-034: öğretmen aynı içeriği iki sınıfa ayrı son tarihle atar; tek istek, atama başına denetim, mükerrer istek aynı yanıt', async () => {
    const t = await tenant()
    const headers = key()
    const body = { items: [item(t, '9-A'), item(t, '9-B', LATER_DUE)] }
    const response = await batch(t.cookies.teacher, body, headers)
    const data = await ok(response, 201)
    assert.deepEqual(
      (data as Json[]).map((row) => [row.targets[0].id, row.deadline.dueAt, row.resourceId]),
      [
        ['9-A', DUE, t.quiz.resourceId],
        ['9-B', LATER_DUE, t.quiz.resourceId],
      ],
    )
    const stored = await snapshot(t.institution.id)
    assert.equal(stored.assignments.length, 2)
    assert.deepEqual(
      stored.audits.map((row) => row.action),
      ['task_assignment.create', 'task_assignment.create'],
    )
    const replay = await batch(t.cookies.teacher, body, headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json().data, data)
    assert.deepEqual(await snapshot(t.institution.id), stored)
    const list = await ok(
      await call('GET', `/task-assignments?resourceId=${t.quiz.resourceId}`, t.cookies.teacher),
    )
    assert.equal((list as Json[]).length, 2)
  })

  test('DOM-BEC-049: bir öğe reddedilince hiçbir atama yazılmaz; hata öğenin yoluyla döner', async () => {
    const t = await tenant()
    const before = await snapshot(t.institution.id)
    // Kapsam dışı sınıf (t-eng 9-C'de ders vermez).
    const denied = await batch(t.cookies.teacher, {
      items: [item(t, '9-A'), item(t, '9-C', LATER_DUE)],
    })
    fails(denied, 403, 'target_scope_denied')
    assert.deepEqual(denied.json().issues[0].path.slice(0, 2), ['items', '1'])
    // Olmayan hedef 404, ikinci öğede.
    const missing = await batch(t.cookies.admin, {
      items: [item(t, '9-A'), item(t, '9-Z', LATER_DUE)],
    })
    fails(missing, 404, 'not_found')
    // Aynı kursiyer iki öğede: önceki öğe çakışma sayılır.
    fails(
      await batch(t.cookies.teacher, {
        items: [
          item(t, '9-A'),
          { ...item(t, '9-B', LATER_DUE), targets: [{ kind: 'student', id: 's-1' }] },
        ],
      }),
      409,
      'assignment_overlap',
    )
    // Gövde (Zod): yinelenen hedef, boş liste, değerlendirmede son tarih yok, kökte kurum kimliği.
    for (const payload of [
      { items: [item(t, '9-A'), item(t, '9-A', LATER_DUE)] },
      { items: [] },
      { items: [{ ...item(t, '9-A'), settings: {} }] },
      { items: [item(t, '9-A')], institutionId: randomUUID() },
    ])
      fails(await batch(t.cookies.admin, payload), 400, 'validation_failed')
    fails(
      await call('POST', '/task-assignments/batches', t.cookies.admin, {
        items: [item(t, '9-A')],
      }),
      400,
      'idempotency_key_required',
    )
    assert.deepEqual(await snapshot(t.institution.id), before)
  })

  test('DOM-BEC-049: başka kurumun içeriği 404 ve o kurumda atama yazılmaz; öğedeki kurum kimliği etkisiz', async () => {
    const a = await tenant()
    const b = await tenant()
    const before = await snapshot(b.institution.id)
    fails(
      await batch(a.cookies.admin, {
        items: [{ ...item(b, '9-A'), institutionId: b.institution.id }],
      }),
      404,
      'not_found',
    )
    assert.deepEqual(await snapshot(b.institution.id), before)
    const data = await ok(
      await batch(a.cookies.admin, {
        items: [{ ...item(a, '9-A'), institutionId: b.institution.id }],
      }),
      201,
    )
    assert.equal((data as Json[]).length, 1)
    assert.equal((await snapshot(a.institution.id)).assignments.length, 1)
    assert.deepEqual(await snapshot(b.institution.id), before)
    fails(await results(b.quiz.resourceId, a.cookies.admin), 404, 'not_found')
    fails(await results(randomUUID(), a.cookies.admin), 404, 'not_found')
    fails(await results('gecersiz', a.cookies.admin), 400, 'validation_failed')
  })

  test('DOM-BEC-036, IST-034: sonuç özeti içeriğe bağlı, hedef başına; öğretmen yalnız kendi sınıflarını görür', async () => {
    const t = await tenant()
    const [first, second] = t.items
    const created = (await ok(
      await batch(t.cookies.admin, {
        items: [item(t, '9-A'), item(t, '9-B', LATER_DUE), item(t, '9-C', LATER_DUE)],
      }),
      201,
    )) as Json[]
    const [onA, onB] = created.map((row) => row.id as string)
    // Deniz tam puan (4/4), Can yalnız ilk soru (1/4).
    await solve(t.cookies.student, onA!, { [first]: choice('a'), [second]: choice('b') })
    await solve(t.cookies.otherStudent, onB!, { [first]: choice('a'), [second]: choice('a') })

    const admin = await ok(await results(t.quiz.resourceId, t.cookies.admin))
    assert.equal(admin.resourceId, t.quiz.resourceId)
    assert.equal(admin.truncated, false)
    const byTarget = (data: Json) =>
      Object.fromEntries(
        (data.assignments as Json[]).flatMap((row) =>
          (row.targets as Json[]).map((target) => [
            target.id,
            [target.learners, target.completed, target.averagePercent],
          ]),
        ),
      )
    assert.deepEqual(byTarget(admin), {
      '9-A': [2, 1, 100],
      '9-B': [1, 1, 25],
      '9-C': [1, 0, null],
    })
    assert.deepEqual(admin.totals, { learners: 4, completed: 2, scored: 2, averagePercent: 62.5 })

    const teacher = await ok(await results(t.quiz.resourceId, t.cookies.teacher))
    assert.deepEqual(byTarget(teacher), { '9-A': [2, 1, 100], '9-B': [1, 1, 25] })
    const other = await ok(await results(t.quiz.resourceId, t.cookies.otherTeacher))
    assert.deepEqual(byTarget(other), { '9-C': [1, 0, null] })
    assert.deepEqual(other.totals, { learners: 1, completed: 0, scored: 0, averagePercent: null })
  })

  test('DOM-BEC-036: öğretmenin okuyamadığı özel taslak içerikte özet 404 (boş liste değil); sahibi ve yönetici görür', async () => {
    const t = await tenant()
    fails(await results(t.hidden, t.cookies.otherTeacher), 404, 'not_found')
    const owner = await ok(await results(t.hidden, t.cookies.teacher))
    assert.deepEqual(owner.assignments, [])
  })

  test('DOM-BEC-036: atama sınırı aşılınca truncated olur ve üst toplam yalnız okunan atamayı kapsar', async () => {
    const t = await tenant()
    await ok(
      await batch(t.cookies.admin, { items: [item(t, '9-A'), item(t, '9-B', LATER_DUE)] }),
      201,
    )
    const ctx: ServiceContext = {
      db,
      institutionId: t.institution.id,
      actor: {
        userId: t.institution.admin.id,
        role: 'yonetici',
        membershipId: t.institution.adminMembershipId,
      },
      now: FIXED_NOW,
      log: app.log,
    }
    const all = await getContentAssignmentResults(ctx, t.quiz.resourceId)
    assert.equal(all.truncated, false)
    assert.equal(all.assignments.length, 2)
    const cut = await getContentAssignmentResults(ctx, t.quiz.resourceId, 1)
    assert.equal(cut.truncated, true)
    assert.equal(cut.assignments.length, 1)
    assert.deepEqual(cut.totals, cut.assignments[0]?.totals)
  })

  test('DOM-BEC-036, DOM-BEC-021: öğretmen puanlı atamada teslim tamamlandı sayılır, puan kesinleşince ortalamaya girer; öğrenci hedefi adıyla gelir, kapsam dışı öğretmen göremez', async () => {
    const t = await tenant()
    const created = (await ok(
      await batch(t.cookies.admin, {
        items: [
          {
            resourceVersionId: t.homework.versionId,
            settings: {
              deadline: { dueAt: DUE },
              submission: { submissionKind: 'text', maxVersions: 1 },
              rubricVersionId: t.rubricVersionId,
            },
            targets: [{ kind: 'student', id: 's-1' }],
          },
        ],
      }),
      201,
    )) as Json[]
    const assignmentId = created[0]!.id as string
    const only = (data: Json) => (data.assignments as Json[])[0]!.targets[0] as Json
    const tally = (target: Json) => [
      target.learners,
      target.completed,
      target.scored,
      target.averagePercent,
    ]

    assert.deepEqual(
      tally(only(await ok(await results(t.homework.resourceId, t.cookies.teacher)))),
      [1, 0, 0, null],
    )
    const submission = await ok(
      await call(
        'POST',
        `/task-assignments/${assignmentId}/submissions`,
        t.cookies.student,
        { submissionKind: 'text', body: 'My weekend was very nice.' },
        key(),
      ),
      201,
    )
    const submitted = only(await ok(await results(t.homework.resourceId, t.cookies.teacher)))
    assert.deepEqual(tally(submitted), [1, 1, 0, null])
    assert.equal(submitted.name, 'Deniz Yılmaz')

    await ok(
      await call(
        'POST',
        `/task-submissions/${submission.id}/scores`,
        t.cookies.teacher,
        {
          versionNumber: 1,
          criteria: [
            { criterionId: 'task', band: 4, comment: null },
            { criterionId: 'grammar', band: 2, comment: 'Zaman uyumuna dikkat.' },
          ],
          overallComment: 'İyi.',
        },
        { ...key(), ...match(1) },
      ),
      201,
    )
    const scored = await ok(await results(t.homework.resourceId, t.cookies.admin))
    assert.deepEqual(tally(only(scored)), [1, 1, 1, 60])
    assert.equal(only(scored).name, 'Deniz Yılmaz')
    assert.deepEqual(scored.totals, { learners: 1, completed: 1, scored: 1, averagePercent: 60 })
    // Ders vermediği sınıfın öğrencisini görmeyen öğretmen hedefi de adı da görmez.
    const other = await ok(await results(t.homework.resourceId, t.cookies.otherTeacher))
    assert.deepEqual(other.assignments, [])
  })
})
