import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import type { ResourceVersionInput } from '@kampus/school-core/content/resource.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { rubrics, rubricVersions } from '../src/db/schema/skills.ts'
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
 * Seviye önerisinin görev kanıtları (OG-247; DOM-BEC-030…034; IST-060). Profil ucu
 * (`GET /students/:id/cefr-profile`) "Tahmini seviye"yi değerlendirme görevlerinin sonuçlarından da
 * hesaplar: otomatik görevde sayılan deneme, öğretmen puanlıda kesinleşmiş puan. Kanıt görevine
 * atama ve puanlama türüyle bağlanır; alıştırma kanıt adayı olmaz, puanlanmamış teslim "Sonuç henüz
 * puanlanmadı" nedeniyle dışarıda listelenir, öneri saklanmaz. Rol ve kurum kapsamının tamamı
 * `cefr.test.ts`'tedir; burada yanıtın yeni alanları ve öneri hesabı denetlenir.
 */

type Json = ReturnType<typeof JSON.parse>

const DAY = 24 * 60 * 60_000
const DUE = '2026-10-30T20:59:00.000Z'

const tags = (skill: 'reading' | 'writing') => ({
  subjectId: 'ingilizce',
  gradeLevels: [9],
  primarySkill: skill,
  cefrLevel: 'B1' as const,
})

const question = (stem: string): Partial<ResourceVersionInput> => ({
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
  answerKey: { questionType: 'multiple_choice', correctOptionId: 'a', explanation: 'Metne bak.' },
  license: { kind: 'institution_original' },
  tags: tags('reading'),
})

const homework = (title: string): Partial<ResourceVersionInput> => ({
  title,
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

describe('seviye önerisinin görev kanıtları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let now = FIXED_NOW
  let tenantCount = 0
  let clientIp = '10.247.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => now })
  })
  after(async () => {
    await app.close()
    await close()
  })

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

  /** Dil okulu: Deniz (`k-1`) B1-1 grubunda; öğretmen `t-dil` grubun öğretmenidir. */
  async function tenant() {
    now = FIXED_NOW
    clientIp = `10.247.${(tenantCount += 1)}.1`
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
        {
          collection: 'classes',
          id: 'B1-1',
          data: { id: 'B1-1', grade: 0, level: 'B1', branchId: 'b-1', teacherId: 't-dil' },
        },
        {
          collection: 'students',
          id: 'k-1',
          data: { id: 'k-1', name: 'Deniz Yılmaz', classId: 'B1-1', isActive: true },
        },
        {
          collection: 'assignments',
          id: 'as-dil',
          data: { id: 'as-dil', classId: 'B1-1', teacherId: 't-dil', subjectId: 'ingilizce' },
        },
      ],
      FIXED_NOW,
    )
    const teacher = await createMember(app, institution.id, 'ogretmen', [
      { kind: 'teacher', recordId: 't-dil' },
    ])
    const cookies = {
      admin: await signInAs(app, institution.admin),
      teacher: await signInAs(app, teacher),
      student: await signInAs(
        app,
        await createMember(app, institution.id, 'ogrenci', [{ kind: 'student', recordId: 'k-1' }]),
      ),
      parent: await signInAs(
        app,
        await createMember(app, institution.id, 'veli', [{ kind: 'child', recordId: 'k-1' }]),
      ),
      frontDesk: await signInAs(app, await createMember(app, institution.id, 'onburo')),
    }
    const seed = async (input: Partial<ResourceVersionInput>) =>
      (
        await seedResource(db, institution.id, {
          ownerUserId: institution.admin.id,
          shareScope: 'institution',
          versions: [{ status: 'published', input }],
        })
      ).versions[0]!.id
    const items = [await seed(question('Bir')), await seed(question('İki'))]
    const quiz = await seed({
      title: 'Okuma değerlendirmesi',
      content: {
        type: 'quiz',
        items: items.map((questionVersionId) => ({ questionVersionId, points: 1 })),
      },
      license: { kind: 'institution_original' },
      tags: tags('reading'),
    })
    const practice = await seed({
      title: 'Okuma alıştırması',
      content: {
        type: 'quiz',
        items: items.map((questionVersionId) => ({ questionVersionId, points: 1 })),
      },
      license: { kind: 'institution_original' },
      tags: tags('reading'),
    })
    const essays = [
      await seed(homework('Yazma 1')),
      await seed(homework('Yazma 2')),
      await seed(homework('Yazma 3')),
      await seed(homework('Yazma 4')),
    ]
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
    return { institution, cookies, items, quiz, practice, essays, rubricVersionId }
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  const profile = (cookie?: string) => call('GET', '/students/k-1/cefr-profile', cookie)

  async function assign(t: Tenant, versionId: string, settings: Record<string, unknown>) {
    const data = await ok(
      await call(
        'POST',
        '/task-assignments',
        t.cookies.admin,
        {
          resourceVersionId: versionId,
          settings: { deadline: { dueAt: DUE }, ...settings },
          targets: [{ kind: 'group', id: 'B1-1' }],
        },
        key(),
      ),
      201,
    )
    return data.id as string
  }

  async function solve(t: Tenant, assignmentId: string) {
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
    const answers = Object.fromEntries(
      t.items.map((id) => [id, { questionType: 'multiple_choice', optionId: 'a' }]),
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

  /** Yazma görevi atanır ve teslim edilir; `band` verilirse öğretmen iki kritere o bandı verir. */
  async function essay(t: Tenant, versionId: string, band: number | null) {
    const assignmentId = await assign(t, versionId, {
      submission: { submissionKind: 'text', maxVersions: 1 },
      rubricVersionId: t.rubricVersionId,
    })
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
    if (band !== null)
      await ok(
        await call(
          'POST',
          `/task-submissions/${submission.id}/scores`,
          t.cookies.teacher,
          {
            versionNumber: 1,
            criteria: [
              { criterionId: 'task', band, comment: null },
              { criterionId: 'grammar', band, comment: null },
            ],
            overallComment: 'İyi.',
          },
          { ...key(), ...match(submission.rowVersion ?? 1) },
        ),
        201,
      )
    return { assignmentId, submissionId: submission.id as string }
  }

  const skillOf = (data: Json, skill: string) =>
    (data.estimate.skills as Json[]).find((row) => row.skill === skill)

  test('IST-060 OG-247 profil ucu: oturumsuz 401, ön büro 403, başka kurum 404', async () => {
    const t = await tenant()
    fails(await profile(), 401, 'unauthenticated')
    fails(await profile(t.cookies.frontDesk), 403, 'forbidden')
    const other = await createInstitution(app, { type: 'language_school' })
    fails(await profile(await signInAs(app, other.admin)), 404, 'not_found')
  })

  test('DOM-BEC-031 OG-247 sayılan deneme kanıttır ve görevine bağlanır; alıştırma kanıt adayı olmaz', async () => {
    const t = await tenant()
    const readingTask = await assign(t, t.quiz, {
      attempts: { kind: 'evaluation', maxAttempts: 1 },
    })
    const attemptId = await solve(t, readingTask)
    const practiceTask = await assign(t, t.practice, { attempts: { kind: 'practice' } })
    await solve(t, practiceTask)

    for (const cookie of [t.cookies.admin, t.cookies.student, t.cookies.parent]) {
      const data = await ok(await profile(cookie))
      assert.deepEqual(
        data.estimate.evidence.map((row: Json) => [
          row.id,
          row.source,
          row.skill,
          row.targetLevel,
          row.percent,
          row.successful,
          row.task,
        ]),
        [
          [
            attemptId,
            'task',
            'reading',
            'B1',
            100,
            true,
            { assignmentId: readingTask, scoring: 'auto' },
          ],
        ],
      )
      assert.deepEqual(data.estimate.excluded, [])
      // DOM-BEC-032: tek kanıt seviye göstermez; eksik kanıt ve okumada eksik madde sayısı söylenir.
      const reading = skillOf(data, 'reading')
      assert.equal(reading.status, 'insufficient')
      assert.equal(reading.missingEvidence, 2)
      assert.equal(reading.missingItems, 8)
      assert.equal(data.estimate.overall.status, 'insufficient')
    }
  })

  test('DOM-BEC-032 DOM-BEC-030 OG-247 üç başarılı yazma kanıtı iki günde B1 önerir; puanlanmamış teslim dışarıda listelenir; öneri saklanmaz', async () => {
    const t = await tenant()
    const first = await essay(t, t.essays[0]!, 4)
    const second = await essay(t, t.essays[1]!, 3)
    const pending = await essay(t, t.essays[2]!, null)

    const before = await ok(await profile(t.cookies.admin))
    assert.equal(skillOf(before, 'writing').status, 'insufficient')
    assert.equal(skillOf(before, 'writing').missingEvidence, 1)
    assert.deepEqual(
      before.estimate.excluded.map((row: Json) => [row.reason, row.task]),
      [['unscored', { assignmentId: pending.assignmentId, scoring: 'rubric' }]],
    )

    // Ertesi gün üçüncü yazma puanlanır: üç kanıt, iki gün, hepsi başarılı (DOM-BEC-032).
    now = new Date(FIXED_NOW.getTime() + DAY)
    const third = await essay(t, t.essays[3]!, 3)
    for (const cookie of [t.cookies.admin, t.cookies.student]) {
      const data = await ok(await profile(cookie))
      const writing = skillOf(data, 'writing')
      assert.equal(writing.status, 'suggested')
      assert.equal(writing.level, 'B1')
      assert.equal(writing.evidenceIds.length, 3)
      assert.deepEqual(
        data.estimate.evidence
          .map((row: Json) => row.task.assignmentId)
          .sort((a: string, b: string) => a.localeCompare(b)),
        [first.assignmentId, second.assignmentId, third.assignmentId].sort((a, b) =>
          a.localeCompare(b),
        ),
      )
      assert.ok(data.estimate.evidence.every((row: Json) => row.task.scoring === 'rubric'))
      // DOM-BEC-033: dört beceride öneri yoksa genel öneri yok; eksik beceriler söylenir.
      assert.equal(data.estimate.overall.status, 'insufficient')
      assert.deepEqual(data.estimate.overall.missingSkills, ['reading', 'listening', 'speaking'])
    }

    // DOM-BEC-031: 120 günlük pencere dolunca kanıt geçersizdir; öneri yeniden hesaplanır.
    now = new Date(FIXED_NOW.getTime() + 125 * DAY)
    const later = await ok(await profile(t.cookies.admin))
    assert.equal(skillOf(later, 'writing').status, 'insufficient')
    assert.equal(later.estimate.evidence.length, 0)
    assert.ok(later.estimate.excluded.some((row: Json) => row.reason === 'expired'))
  })
})
