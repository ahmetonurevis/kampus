import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import type { ResourceVersionInput } from '@kampus/school-core/content/resource.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { coordinatorDuties } from '../src/db/schema/coordinator-duties.ts'
import { languageGroupMembers } from '../src/db/schema/language-groups.ts'
import { records } from '../src/db/schema/records.ts'
import { rubrics, rubricVersions } from '../src/db/schema/skills.ts'
import { insertSecondRatingRequest } from '../src/db/skills.ts'
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
 * Beceri ilerleme panosu ucu (OG-080; IST-057; DOM-BEC-035). Kural core `skills/progress.ts`'tedir;
 * burada rol × kapsam (öğrenci kendisi, veli çocuğu, öğretmen sınıfı, yönetici herkes; kapsam dışı
 * ve başka kurum 404), modül kapalı 403, noktaların görev sonucu kimlikleri, alıştırmanın ve
 * kesinleşmemiş puanın dışarıda kalması ve kaldırılmış içeriğin puansızlığı (DOM-KYN-051) denetlenir.
 */

type Json = ReturnType<typeof JSON.parse>

const MINUTE = 60_000
const DUE = '2026-10-20T20:59:00.000Z'

const tags = (skill: 'reading' | 'listening' | 'writing' | 'speaking') => ({
  subjectId: 'ingilizce',
  gradeLevels: [9],
  primarySkill: skill,
  cefrLevel: 'A2' as const,
})

const question = (
  stem: string,
  correctOptionId: string,
  skill: 'reading' | 'listening',
): Partial<ResourceVersionInput> => ({
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
  tags: tags(skill),
})

const homework = (): Partial<ResourceVersionInput> => ({
  title: 'Hafta sonu yazısı',
  content: {
    type: 'homework_template',
    instructions: 'Hafta sonunu anlatan kısa bir metin yaz.',
    submissionKinds: ['text'],
    criteria: 'Zaman ifadeleri ve yazım.',
    rubricId: null,
  },
  license: { kind: 'institution_original' },
  tags: tags('writing'),
})

const choice = (optionId: string) => ({ questionType: 'multiple_choice', optionId })

describe('beceri ilerleme panosu ucu', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let now = FIXED_NOW
  let tenantCount = 0
  let clientIp = '10.1.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => now })
  })
  after(async () => {
    await app.close()
    await close()
  })

  /**
   * `t-eng` 9-A'nın, `t-mat` 9-B'nin öğretmenidir. Deniz (`s-1`) 9-A'da, Can (`s-3`) 9-B'de; veli
   * Deniz'in velisidir. Okuma ve dinleme quizleri, okuma alıştırması (iki soru, 1 + 3 puan) ve rubrikli yazma ödevi
   * yayındadır.
   */
  async function tenant() {
    now = FIXED_NOW
    clientIp = `10.1.${(tenantCount += 1)}.1`
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
      otherParent: await signInAs(app, await member('veli', 'child', 's-3')),
      frontDesk: await signInAs(app, await createMember(app, institution.id, 'onburo')),
    }
    const seed = async (input: Partial<ResourceVersionInput>) => {
      const { resource, versions } = await seedResource(db, institution.id, {
        ownerUserId: teacher.id,
        versions: [{ status: 'published', input }],
      })
      return { resourceId: resource.id, versionId: versions[0]!.id }
    }
    const quiz = async (title: string, skill: 'reading' | 'listening') => {
      const first = await seed(question(`${title} 1`, 'a', skill))
      const second = await seed(question(`${title} 2`, 'b', skill))
      const created = await seed({
        title,
        content: {
          type: 'quiz',
          items: [
            { questionVersionId: first.versionId, points: 1 },
            { questionVersionId: second.versionId, points: 3 },
          ],
        },
        license: { kind: 'institution_original' },
        tags: tags(skill),
      })
      return { ...created, items: [first.versionId, second.versionId] as const }
    }
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
      reading: await quiz('Okuma quizi', 'reading'),
      listening: await quiz('Dinleme quizi', 'listening'),
      practice: await quiz('Okuma alıştırması', 'reading'),
      homework: await seed(homework()),
      rubricVersionId,
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

  const progress = (studentId: string, cookie?: string) =>
    call('GET', `/students/${studentId}/skill-progress`, cookie)
  const curve = (data: Json, skill: string) =>
    (data.skills as Json[]).find((item) => item.skill === skill)

  /** Yönetici 9-A'ya atar. */
  async function assign(t: Tenant, versionId: string, settings: Record<string, unknown> = {}) {
    const data = await ok(
      await call(
        'POST',
        '/task-assignments',
        t.cookies.admin,
        {
          resourceVersionId: versionId,
          settings: { deadline: { dueAt: DUE }, ...settings },
          targets: [{ kind: 'class', id: '9-A' }],
        },
        key(),
      ),
      201,
    )
    return data.id as string
  }

  /** Deniz denemeyi başlatır ve verilen cevaplarla teslim eder; deneme kimliği döner. */
  async function solve(t: Tenant, assignmentId: string, answers: Record<string, unknown>) {
    const attempt = await ok(
      await call(
        'POST',
        `/task-assignments/${assignmentId}/attempts`,
        t.cookies.student,
        {},
        key(),
      ),
      201,
    )
    await ok(
      await call(
        'POST',
        `/task-attempts/${attempt.id}/submit`,
        t.cookies.student,
        { answers },
        { ...key(), ...match(attempt.rowVersion) },
      ),
    )
    return attempt.id as string
  }

  /** Deniz yazma görevini teslim eder; teslim kimliği ve satır sürümü döner. */
  async function submitWriting(t: Tenant, assignmentId: string) {
    const submission = await ok(
      await call(
        'POST',
        `/task-assignments/${assignmentId}/submissions`,
        t.cookies.student,
        { submissionKind: 'text', body: 'My weekend was busy and nice.' },
        key(),
      ),
      201,
    )
    return submission
  }

  /** Öğretmen ilk sürümü puanlar: `task` 4, `grammar` 2 → %60. */
  const score = (submissionId: string, cookie: string, rowVersion: number) =>
    call(
      'POST',
      `/task-submissions/${submissionId}/scores`,
      cookie,
      {
        versionNumber: 1,
        criteria: [
          { criterionId: 'task', band: 4, comment: null },
          { criterionId: 'grammar', band: 2, comment: 'Zaman ekleri eksik.' },
        ],
        overallComment: 'İyi.',
      },
      { ...key(), ...match(rowVersion) },
    )

  async function writingTask(t: Tenant) {
    return assign(t, t.homework.versionId, {
      submission: { submissionKind: 'text', maxVersions: 1 },
      rubricVersionId: t.rubricVersionId,
    })
  }

  test('DOM-BEC-035, IST-057: 401; ön büro 403; modül kapalıyken 403 module_disabled', async () => {
    const t = await tenant()
    fails(await progress('s-1'), 401, 'unauthenticated')
    fails(await progress('s-1', t.cookies.frontDesk), 403, 'forbidden')
    const closed = await createInstitution(app, { enabledModules: { learning: false } })
    fails(await progress('s-1', await signInAs(app, closed.admin)), 403, 'module_disabled')
  })

  test('DOM-BEC-035: kapsam — öğrenci yalnız kendisi, veli yalnız çocuğu, öğretmen sınıfı; kapsam dışı, olmayan ve başka kurum 404', async () => {
    const t = await tenant()
    for (const cookie of [t.cookies.admin, t.cookies.teacher, t.cookies.student, t.cookies.parent])
      assert.equal((await ok(await progress('s-1', cookie))).studentId, 's-1')
    fails(await progress('s-1', t.cookies.otherStudent), 404, 'not_found')
    fails(await progress('s-1', t.cookies.otherParent), 404, 'not_found')
    fails(await progress('s-1', t.cookies.otherTeacher), 404, 'not_found')
    fails(await progress('s-3', t.cookies.student), 404, 'not_found')
    fails(await progress('s-3', t.cookies.parent), 404, 'not_found')
    fails(await progress('s-3', t.cookies.teacher), 404, 'not_found')
    fails(await progress('yok', t.cookies.admin), 404, 'not_found')
    const other = await createInstitution(app)
    fails(await progress('s-1', await signInAs(app, other.admin)), 404, 'not_found')
  })

  test('DOM-BEC-035: veri yokken dört beceri boş eğri döner', async () => {
    const t = await tenant()
    const data = await ok(await progress('s-1', t.cookies.parent))
    assert.deepEqual(
      data.skills.map((item: Json) => [item.skill, item.label, item.points.length, item.latest]),
      [
        ['reading', 'Okuma', 0, null],
        ['listening', 'Dinleme', 0, null],
        ['writing', 'Yazma', 0, null],
        ['speaking', 'Konuşma', 0, null],
      ],
    )
    assert.equal(data.computedAt, FIXED_NOW.toISOString())
  })

  test('DOM-BEC-035, DOM-BEC-042: sayılan deneme ve kesinleşmiş yazma puanı ayrı becerilere nokta olur; noktalar görev sonucuna bağlanır, alıştırma girmez', async () => {
    const t = await tenant()
    const [r1, r2] = t.reading.items
    const readingTask = await assign(t, t.reading.versionId, {
      attempts: { kind: 'evaluation', maxAttempts: 1 },
    })
    const readingAttempt = await solve(t, readingTask, { [r1]: choice('a'), [r2]: choice('a') })
    now = new Date(FIXED_NOW.getTime() + 10 * MINUTE)
    const [l1, l2] = t.listening.items
    const listeningTask = await assign(t, t.listening.versionId, {
      attempts: { kind: 'evaluation', maxAttempts: 1 },
    })
    const listeningAttempt = await solve(t, listeningTask, {
      [l1]: choice('a'),
      [l2]: choice('b'),
    })
    // Alıştırma (DOM-BEC-041) panoya girmez.
    const [p1, p2] = t.practice.items
    const practice = await assign(t, t.practice.versionId, { attempts: { kind: 'practice' } })
    await solve(t, practice, { [p1]: choice('a'), [p2]: choice('b') })
    now = new Date(FIXED_NOW.getTime() + 20 * MINUTE)
    const writingAssignment = await writingTask(t)
    const submission = await submitWriting(t, writingAssignment)
    now = new Date(FIXED_NOW.getTime() + 30 * MINUTE)
    await ok(await score(submission.id, t.cookies.teacher, submission.rowVersion ?? 1), 201)

    for (const cookie of [
      t.cookies.parent,
      t.cookies.student,
      t.cookies.teacher,
      t.cookies.admin,
    ]) {
      const data = await ok(await progress('s-1', cookie))
      assert.deepEqual(
        curve(data, 'reading').points.map((p: Json) => [
          p.assignmentId,
          p.attemptId,
          p.submissionId,
          p.percent,
          p.title,
        ]),
        [[readingTask, readingAttempt, null, 25, 'Okuma quizi']],
      )
      assert.deepEqual(
        curve(data, 'listening').points.map((p: Json) => [p.attemptId, p.percent]),
        [[listeningAttempt, 100]],
      )
      assert.deepEqual(
        curve(data, 'writing').points.map((p: Json) => [
          p.assignmentId,
          p.attemptId,
          p.submissionId,
          p.percent,
        ]),
        [[writingAssignment, null, submission.id, 60]],
      )
      assert.equal(curve(data, 'writing').latest, 60)
      assert.deepEqual(curve(data, 'speaking').points, [])
    }
  })

  test('DOM-BEC-035, DOM-BEC-045: ikinci puan bekleyen (kesinleşmemiş) yazma puanı kimseye nokta olmaz', async () => {
    const t = await tenant()
    const writingAssignment = await writingTask(t)
    const submission = await submitWriting(t, writingAssignment)
    await insertSecondRatingRequest(
      db,
      t.institution.id,
      {
        submissionId: submission.id,
        source: 'manual',
        requestedByUserId: t.institution.admin.id,
        requestedAt: now.toISOString(),
      },
      now,
    )
    now = new Date(FIXED_NOW.getTime() + MINUTE)
    const staff = await ok(
      await call('GET', `/task-submissions/${submission.id}`, t.cookies.teacher),
    )
    await ok(await score(submission.id, t.cookies.teacher, staff.rowVersion), 201)
    for (const cookie of [t.cookies.parent, t.cookies.student, t.cookies.teacher, t.cookies.admin])
      assert.deepEqual(curve(await ok(await progress('s-1', cookie)), 'writing').points, [])
  })

  test('DOM-BEC-035, DOM-KYN-051: kaldırılmış quizin puanı panoda yok', async () => {
    const t = await tenant()
    const [r1, r2] = t.reading.items
    const readingTask = await assign(t, t.reading.versionId, {
      attempts: { kind: 'evaluation', maxAttempts: 1 },
    })
    await solve(t, readingTask, { [r1]: choice('a'), [r2]: choice('b') })
    assert.equal(curve(await ok(await progress('s-1', t.cookies.parent)), 'reading').latest, 100)

    const removed = await call(
      'POST',
      `/resources/${t.reading.resourceId}/remove`,
      t.cookies.admin,
      { reason: 'Telif bildirimi doğrulandı.' },
      key(),
    )
    assert.equal(removed.statusCode, 200, removed.body)
    for (const cookie of [
      t.cookies.parent,
      t.cookies.student,
      t.cookies.teacher,
      t.cookies.admin,
    ]) {
      const data = await ok(await progress('s-1', cookie))
      assert.deepEqual(curve(data, 'reading').points, [])
      assert.equal(curve(data, 'reading').latest, null)
    }
  })

  test('DOM-BEC-035, DOM-YTK-028: sınıf değiştiren öğrencinin eski sınıf görevi yeni öğretmene nokta olmaz; öğrenci ve veli görmeye devam eder', async () => {
    const t = await tenant()
    const [r1, r2] = t.reading.items
    const readingTask = await assign(t, t.reading.versionId, {
      attempts: { kind: 'evaluation', maxAttempts: 1 },
    })
    await solve(t, readingTask, { [r1]: choice('a'), [r2]: choice('b') })
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
    // Yeni sınıfın öğretmeni öğrenciye ulaşır ama 9-A atamasını görmez.
    const otherTeacher = await ok(await progress('s-1', t.cookies.otherTeacher))
    assert.deepEqual(curve(otherTeacher, 'reading').points, [])
    fails(await progress('s-1', t.cookies.teacher), 404, 'not_found')
    for (const cookie of [t.cookies.parent, t.cookies.student, t.cookies.admin])
      assert.equal(curve(await ok(await progress('s-1', cookie)), 'reading').latest, 100)
  })

  test('DOM-BEC-035, IST-060: dil okulunda grup öğretmeni ve seviye koordinatörü kursiyeri görür; grubu olmayan öğretmen 404', async () => {
    clientIp = `10.1.${(tenantCount += 1)}.1`
    const institution = await createInstitution(app, { type: 'language_school' })
    const teacher = await createMember(app, institution.id, 'ogretmen')
    const coordinator = await createMember(app, institution.id, 'ogretmen')
    const other = await createMember(app, institution.id, 'ogretmen')
    await db.insert(coordinatorDuties).values({
      institutionId: institution.id,
      id: randomUUID(),
      membershipId: coordinator.membershipId,
      kind: 'academic_coordinator',
      scopeId: 'B1',
      assignedByUserId: institution.admin.id,
    })
    await insertMissingRecords(
      db,
      institution.id,
      [{ collection: 'students', id: 's-deniz', data: { id: 's-deniz', name: 'Deniz Yılmaz' } }],
      FIXED_NOW,
    )
    const admin = await signInAs(app, institution.admin)
    const course = await ok(
      await call(
        'POST',
        '/courses',
        admin,
        {
          name: 'Genel İngilizce B1.1',
          level: 'B1',
          totalHours: 12,
          weeklyHours: 4,
          minLearners: 2,
          maxLearners: 12,
        },
        key(),
      ),
      201,
    )
    await ok(await call('POST', `/courses/${course.id}/activate`, admin, {}, match(1)))
    const group = await ok(
      await call(
        'POST',
        '/groups',
        admin,
        {
          courseId: course.id,
          name: 'B1 Akşam',
          ageBand: 'adult',
          teacherMembershipId: teacher.membershipId,
          delivery: 'in_person',
          room: 'Derslik 1',
          schedule: [
            { weekday: 1, startTime: '18:00' },
            { weekday: 1, startTime: '18:45' },
            { weekday: 3, startTime: '18:00' },
            { weekday: 3, startTime: '18:45' },
          ],
          startDate: '2026-10-12',
          capacity: 10,
        },
        key(),
      ),
      201,
    )
    await db.insert(languageGroupMembers).values({
      institutionId: institution.id,
      id: randomUUID(),
      groupId: group.id,
      studentId: 's-deniz',
      status: 'active',
      joinedAt: FIXED_NOW,
    })
    for (const member of [teacher, coordinator]) {
      const data = await ok(await progress('s-deniz', await signInAs(app, member)))
      assert.equal(data.studentId, 's-deniz')
      assert.equal(data.skills.length, 4)
    }
    fails(await progress('s-deniz', await signInAs(app, other)), 404, 'not_found')
  })
})
