import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, asc, eq, sql } from 'drizzle-orm'

import type { ResourceVersionInput } from '@kampus/school-core/content/resource.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertLessonHourAttendances } from '../src/db/progression.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { progressionDecisions } from '../src/db/schema/cefr.ts'
import { languageGroupMembers } from '../src/db/schema/language-groups.ts'
import { records } from '../src/db/schema/records.ts'
import { rubrics, rubricVersions, taskAssignments } from '../src/db/schema/skills.ts'
import { EVIDENCE_READ_DAYS } from '../src/services/cefr-evidence.ts'
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
 * puanlanmadı" nedeniyle dışarıda listelenir, öneri saklanmaz. Dışarıda kalanlar yalnız personel
 * yanıtındadır; öğrenci ve veli yalnız geri bildirimi açılmış puanı kanıt görür (DOM-BEC-045).
 * Bağlantı (`task.linkable`) görev uçlarının kapsam kuralıyla çizilir. Rol ve kurum kapsamının
 * tamamı `cefr.test.ts`'tedir; burada yanıtın yeni alanları ve öneri hesabı denetlenir.
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

  /**
   * Dil okulu: Deniz (`k-1`) B1-1 grubunda; öğretmen `t-dil` grubun öğretmenidir. `outsider`
   * (`t-baska`) A2-1'in öğretmenidir, Deniz'e ulaşmaz.
   */
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
          collection: 'teachers',
          id: 't-baska',
          data: { id: 't-baska', name: 'Can Demir', subjectId: 'ingilizce', branchId: 'b-1' },
        },
        {
          collection: 'classes',
          id: 'A2-1',
          data: { id: 'A2-1', grade: 0, level: 'A2', branchId: 'b-1', teacherId: 't-baska' },
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
    const outsider = await createMember(app, institution.id, 'ogretmen', [
      { kind: 'teacher', recordId: 't-baska' },
    ])
    const cookies = {
      admin: await signInAs(app, institution.admin),
      teacher: await signInAs(app, teacher),
      outsider: await signInAs(app, outsider),
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
    const resourceOf = new Map<string, string>()
    const seed = async (input: Partial<ResourceVersionInput>) => {
      const seeded = await seedResource(db, institution.id, {
        ownerUserId: institution.admin.id,
        shareScope: 'institution',
        versions: [{ status: 'published', input }],
      })
      resourceOf.set(seeded.versions[0]!.id, seeded.resource.id)
      return seeded.versions[0]!.id
    }
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
      await seed(homework('Yazma 5')),
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
    return {
      institution,
      teacher,
      cookies,
      items,
      quiz,
      practice,
      essays,
      rubricVersionId,
      resourceOf,
    }
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  const profile = (cookie?: string) => call('GET', '/students/k-1/cefr-profile', cookie)

  async function assign(
    t: Tenant,
    versionId: string,
    settings: Record<string, unknown>,
    groupId = 'B1-1',
  ) {
    const data = await ok(
      await call(
        'POST',
        '/task-assignments',
        t.cookies.admin,
        {
          resourceVersionId: versionId,
          settings: { deadline: { dueAt: DUE }, ...settings },
          targets: [{ kind: 'group', id: groupId }],
        },
        key(),
      ),
      201,
    )
    return data.id as string
  }

  async function solve(t: Tenant, assignmentId: string, submit = true) {
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
    if (!submit) return attempt.id as string
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
    if (band !== null) await score(t, submission.id, band, submission.rowVersion ?? 1)
    return {
      assignmentId,
      submissionId: submission.id as string,
      rowVersion: (submission.rowVersion ?? 1) as number,
    }
  }

  /** Öğretmen teslimin ilk sürümünün iki kriterine `band` verir. */
  async function score(t: Tenant, submissionId: string, band: number, rowVersion: number) {
    await ok(
      await call(
        'POST',
        `/task-submissions/${submissionId}/scores`,
        t.cookies.teacher,
        {
          versionNumber: 1,
          criteria: [
            { criterionId: 'task', band, comment: null },
            { criterionId: 'grammar', band, comment: null },
          ],
          overallComment: 'İyi.',
        },
        { ...key(), ...match(rowVersion) },
      ),
      201,
    )
  }

  /**
   * Deniz'i `t-dil`'in dil grubuna kaydeder (12 ders saatlik B1 kuru). CEFR profilinde öğretmen
   * kapsamı etkin grup üyeliğidir (`services/cefr.ts` `teacherReaches`).
   */
  async function enroll(t: Tenant) {
    const course = await ok(
      await call(
        'POST',
        '/courses',
        t.cookies.admin,
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
    await ok(await call('POST', `/courses/${course.id}/activate`, t.cookies.admin, {}, match(1)))
    const group = await ok(
      await call(
        'POST',
        '/groups',
        t.cookies.admin,
        {
          courseId: course.id,
          name: 'B1 Akşam',
          ageBand: 'adult',
          teacherMembershipId: t.teacher.membershipId,
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
    const enrollmentId = randomUUID()
    await db.insert(languageGroupMembers).values({
      institutionId: t.institution.id,
      id: enrollmentId,
      groupId: group.id,
      studentId: 'k-1',
      status: 'active',
      joinedAt: FIXED_NOW,
    })
    return { enrollmentId, groupId: group.id as string }
  }

  const skillOf = (data: Json, skill: string) =>
    (data.estimate.skills as Json[]).find((row) => row.skill === skill)

  /** Kursiyerin güncel sınıfı/grubu (sınıf değişikliği; görev hedefi güncel sınıfa bakar). */
  const moveTo = (t: Tenant, classId: string) =>
    db
      .update(records)
      .set({
        data: sql`jsonb_set(${records.data}, '{classId}', ${JSON.stringify(classId)}::jsonb)`,
        version: sql`${records.version} + 1`,
      })
      .where(
        and(
          eq(records.institutionId, t.institution.id),
          eq(records.collection, 'students'),
          eq(records.id, 'k-1'),
        ),
      )

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
    // Puanlanmamış teslim personelde dışarıda kalanlardadır; kursiyer yanıtında alan yoktur.
    const pending = await essay(t, t.essays[0]!, null)

    const staff = await ok(await profile(t.cookies.admin))
    assert.deepEqual(
      staff.estimate.excluded.map((row: Json) => [row.reason, row.task]),
      [['unscored', { assignmentId: pending.assignmentId, scoring: 'rubric', linkable: true }]],
    )
    for (const cookie of [t.cookies.admin, t.cookies.student, t.cookies.parent]) {
      const response = await profile(cookie)
      const data = await ok(response)
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
            { assignmentId: readingTask, scoring: 'auto', linkable: true },
          ],
        ],
      )
      if (cookie !== t.cookies.admin) {
        assert.equal(data.view, 'learner')
        assert.equal('excluded' in data.estimate, false)
        assert.equal(response.body.includes(pending.assignmentId), false)
      }
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
      [['unscored', { assignmentId: pending.assignmentId, scoring: 'rubric', linkable: true }]],
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

  test('DOM-BEC-045 OG-247 kesinleşmiş ama açılmamış rubrik puanı personelde kanıttır; öğrenci ve veliye kanıt, puan ve ayrıntı sızmaz', async () => {
    const t = await tenant()
    await enroll(t)
    // Geri bildirim puanlama tamamlandığı an açılır (core `teacherFeedbackReleased`); personel
    // kesinleşmiş puanı açılma anından bağımsız görür. Teslim bugün, puan iki saat sonra verilir,
    // profil arada (bir saat sonra) okunur: puan kesinleşmiş, geri bildirim açılmamıştır.
    const work = await essay(t, t.essays[0]!, null)
    now = new Date(FIXED_NOW.getTime() + 2 * 60 * 60_000)
    await score(t, work.submissionId, 4, work.rowVersion)
    now = new Date(FIXED_NOW.getTime() + 60 * 60_000)

    let versionId = ''
    for (const cookie of [t.cookies.admin, t.cookies.teacher]) {
      const data = await ok(await profile(cookie))
      assert.equal(data.view, 'staff')
      assert.deepEqual(
        data.estimate.evidence.map((row: Json) => [row.percent, row.successful, row.task]),
        [[80, true, { assignmentId: work.assignmentId, scoring: 'rubric', linkable: true }]],
      )
      assert.deepEqual(data.estimate.excluded, [])
      versionId = data.estimate.evidence[0].id
    }
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const response = await profile(cookie)
      const data = await ok(response)
      assert.equal(data.view, 'learner')
      assert.deepEqual(data.estimate.evidence, [])
      assert.equal('excluded' in data.estimate, false)
      assert.deepEqual(skillOf(data, 'writing').evidenceIds, [])
      for (const secret of [versionId, work.submissionId, work.assignmentId])
        assert.equal(response.body.includes(secret), false, secret)
    }

    // Puan verildikten sonra geri bildirim açılır: kursiyer de aynı kanıtı görür.
    now = new Date(FIXED_NOW.getTime() + 3 * 60 * 60_000)
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const data = await ok(await profile(cookie))
      assert.deepEqual(
        data.estimate.evidence.map((row: Json) => [row.id, row.percent]),
        [[versionId, 80]],
      )
    }
  })

  test('IST-060 OG-247 grubu dışındaki kursiyerin profili öğretmene 404', async () => {
    const t = await tenant()
    await enroll(t)
    const readingTask = await assign(t, t.quiz, {
      attempts: { kind: 'evaluation', maxAttempts: 1 },
    })
    await solve(t, readingTask)
    const response = await profile(t.cookies.outsider)
    fails(response, 404, 'not_found')
    assert.equal(response.body.includes(readingTask), false)
  })

  test('DOM-BEC-031 OG-247 iptal edilen (arşivlenen) atama ve kaldırılmış içerik kanıt olmaz, dışarıda da listelenmez', async () => {
    const t = await tenant()
    const archived = await assign(t, t.quiz, { attempts: { kind: 'evaluation', maxAttempts: 1 } })
    await solve(t, archived)
    const removed = await essay(t, t.essays[0]!, 4)
    const kept = await essay(t, t.essays[1]!, 3)
    const before = await ok(await profile(t.cookies.admin))
    assert.equal(before.estimate.evidence.length, 3)

    await db
      .update(taskAssignments)
      .set({ archivedAt: FIXED_NOW })
      .where(
        and(eq(taskAssignments.institutionId, t.institution.id), eq(taskAssignments.id, archived)),
      )
    // Kaldırma içeriği ve cevap anahtarını siler (DOM-KYN-051); rubrik puanı durur ama görev
    // gösterilemez, kanıt da değildir.
    await ok(
      await call(
        'POST',
        `/resources/${t.resourceOf.get(t.essays[0]!)}/remove`,
        t.cookies.admin,
        { reason: 'Telif bildirimi doğrulandı.' },
        key(),
      ),
    )
    for (const cookie of [t.cookies.admin, t.cookies.student]) {
      const data = await ok(await profile(cookie))
      assert.deepEqual(
        data.estimate.evidence.map((row: Json) => row.task.assignmentId),
        [kept.assignmentId],
      )
      if (data.view === 'staff') assert.deepEqual(data.estimate.excluded, [])
      assert.ok(![archived, removed.assignmentId].some((id) => JSON.stringify(data).includes(id)))
    }
  })

  test('DOM-BEC-031 OG-247 okuma en uzun kanıt penceresi ve payla sınırlı: süresi çoktan dolan sonuç birikmez, sayılan deneme değişmez', async () => {
    const t = await tenant()
    const farDue = '2027-06-30T20:59:00.000Z'
    // Tek denemeli görev, bugün teslim edilir.
    const single = await assign(t, t.quiz, { attempts: { kind: 'evaluation', maxAttempts: 1 } })
    const singleAttempt = await solve(t, single)
    // İki denemeli, ilk deneme sayılır: ilk deneme bugün, ikincisi 100 gün sonra.
    const first = await assign(t, t.practice, {
      deadline: { dueAt: farDue },
      attempts: { kind: 'evaluation', maxAttempts: 2, countPolicy: 'first' },
    })
    const firstAttempt = await solve(t, first)
    // Yazma bugün teslim edilir, puanlanmaz.
    const pending = await essay(t, t.essays[0]!, null)
    now = new Date(FIXED_NOW.getTime() + 100 * DAY)
    await solve(t, first)

    const reasons = (data: Json) =>
      (data.estimate.excluded as Json[])
        .map((row) => `${row.task.assignmentId}:${row.reason}`)
        .sort((a, b) => a.localeCompare(b))

    // 125. gün: bugünkü sonuçların süresi doldu; pay içinde oldukları için nedeniyle görünürler.
    now = new Date(FIXED_NOW.getTime() + 125 * DAY)
    const expired = await ok(await profile(t.cookies.admin))
    assert.deepEqual(reasons(expired), [
      ...[`${single}:expired`, `${first}:expired`, `${pending.assignmentId}:unscored`].sort(
        (a, b) => a.localeCompare(b),
      ),
    ])
    assert.equal(
      expired.estimate.excluded.find((row: Json) => row.task.assignmentId === single).id,
      singleAttempt,
    )

    // Pencere ve pay geçti: bugünkü sonuçlar okunmaz. İkinci denemesi yeni olan görev bütünüyle
    // okunur; ilk deneme sayıldığı için sonuç yine süresi dolan ilk denemedir.
    now = new Date(FIXED_NOW.getTime() + (EVIDENCE_READ_DAYS + 1) * DAY)
    const later = await ok(await profile(t.cookies.admin))
    assert.deepEqual(later.estimate.evidence, [])
    assert.deepEqual(
      later.estimate.excluded.map((row: Json) => [row.id, row.reason, row.task.assignmentId]),
      [[firstAttempt, 'expired', first]],
    )
  })

  test('DOM-BEC-031 OG-247 süre ya da pencereyle tamamlanan teslim edilmemiş deneme pencere sınırında okunur', async () => {
    const t = await tenant()
    const due = new Date(FIXED_NOW.getTime() + 140 * DAY).toISOString()
    const task = await assign(t, t.quiz, {
      deadline: { dueAt: due },
      attempts: { kind: 'evaluation', maxAttempts: 1 },
    })
    const attemptId = await solve(t, task, false)
    // Deneme bugün başladı, teslim edilmedi; teslim penceresi 140. günde kapanınca tamamlanır.
    now = new Date(FIXED_NOW.getTime() + (EVIDENCE_READ_DAYS + 2) * DAY)
    const data = await ok(await profile(t.cookies.admin))
    assert.deepEqual(
      data.estimate.evidence.map((row: Json) => [row.id, row.performedAt, row.successful]),
      [[attemptId, due, false]],
    )
  })

  test('DOM-BEC-034 OG-247 bağlantı yalnız izleyicinin görebildiği atamaya: eski grubun görevi öğretmene ve öğrenciye bağlantısız', async () => {
    const t = await tenant()
    await enroll(t)
    await moveTo(t, 'A2-1')
    const oldTask = await assign(
      t,
      t.quiz,
      { attempts: { kind: 'evaluation', maxAttempts: 1 } },
      'A2-1',
    )
    const attemptId = await solve(t, oldTask)
    await moveTo(t, 'B1-1')
    const ownTask = await assign(t, t.practice, {
      attempts: { kind: 'evaluation', maxAttempts: 1 },
    })
    const ownAttempt = await solve(t, ownTask)

    const links = async (cookie: string) =>
      Object.fromEntries(
        ((await ok(await profile(cookie))).estimate.evidence as Json[]).map((row) => [
          row.id,
          row.task.linkable,
        ]),
      )
    assert.deepEqual(await links(t.cookies.admin), { [attemptId]: true, [ownAttempt]: true })
    // Öğretmen kanıtı görür ama A2-1'in görevini görev ucunda göremez; öğrenci eski grubunun
    // görevini artık görmez (`visible`). Kanıt yine sayılır.
    assert.deepEqual(await links(t.cookies.teacher), { [attemptId]: false, [ownAttempt]: true })
    assert.deepEqual(await links(t.cookies.student), { [attemptId]: false, [ownAttempt]: true })
    fails(await call('GET', `/task-assignments/${oldTask}`, t.cookies.teacher), 404, 'not_found')
  })

  test('DOM-DIL-070 OG-247 kur sonu kararının kanıt kopyasına görev kanıtı girer', async () => {
    const t = await tenant()
    const readingTask = await assign(t, t.quiz, {
      attempts: { kind: 'evaluation', maxAttempts: 1 },
    })
    const attemptId = await solve(t, readingTask)
    const scored = await essay(t, t.essays[0]!, 4)

    const { enrollmentId, groupId } = await enroll(t)
    await insertLessonHourAttendances(
      db,
      t.institution.id,
      { id: enrollmentId, groupId, studentId: 'k-1' },
      Array.from({ length: 12 }, (_, index) => ({
        lessonHourId: `ders-${index + 1}`,
        status: index < 3 ? ('absent' as const) : ('present' as const),
      })),
      { userId: t.teacher.id, at: FIXED_NOW },
    )
    await ok(
      await call(
        'POST',
        '/progression-decisions',
        t.cookies.teacher,
        {
          enrollmentId,
          outcome: 'incomplete_attendance',
          rationale: 'Devam şartı sağlanmadı.',
        },
        key(),
      ),
      201,
    )
    const [row] = await db
      .select({ snapshot: progressionDecisions.evidenceSnapshot })
      .from(progressionDecisions)
      .where(eq(progressionDecisions.institutionId, t.institution.id))
      .orderBy(asc(progressionDecisions.id))
    const staff = await ok(await profile(t.cookies.admin))
    const versionId = staff.estimate.evidence.find(
      (row: Json) => row.task.assignmentId === scored.assignmentId,
    ).id
    assert.deepEqual(
      row!.snapshot.evidence
        .map((item) => [item.id, item.taskId, item.source, item.skill])
        .sort((a, b) => a[0]!.localeCompare(b[0]!)),
      [
        [attemptId, readingTask, 'task', 'reading'],
        [versionId, scored.assignmentId, 'task', 'writing'],
      ].sort((a, b) => a[0]!.localeCompare(b[0]!)),
    )
  })
})
