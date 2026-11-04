import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import type { ResourceVersionInput } from '@kampus/school-core/content/resource.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { coordinatorDuties } from '../src/db/schema/coordinator-duties.ts'
import { levelDecisions } from '../src/db/schema/cefr.ts'
import { languageGroupMembers } from '../src/db/schema/language-groups.ts'
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
 * Beceri ve CEFR raporu ucu (OG-100; IST-118; DOM-BEC-037). Kural core `cefr/skill-report.ts`'tedir
 * (`tests/skill-report.test.ts`); burada kapsam (rol, kurum türü, modül, öğretmen grubu, başka
 * kurum), sorgu doğrulaması ve rakamların doğruluğu (ortalama, kanıt ve kursiyer sayısı, seviye
 * dağılımı, sayılmayan sonuçlar) uçtan uca denetlenir.
 */

type Json = ReturnType<typeof JSON.parse>

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

describe('beceri ve CEFR raporu ucu', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.100.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
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

  const report = (cookie?: string, query = '') => call('GET', `/reports/skills${query}`, cookie)
  const skillOf = (group: Json, skill: string) =>
    (group.skills as Json[]).find((row) => row.skill === skill)

  /**
   * Dil okulu. Öğretmen Selin `B1 Akşam` grubunun (B1) öğretmenidir: Deniz (`k-1`), Ece (`k-2`) ve
   * pasif Fatma (`k-5`) üyedir. Öğretmen Can `A2 Sabah` (A2, Can'ın öğrencisi `k-3`) ve
   * `B1 Hafta Sonu` (B1, `k-4`, hiç görev yapmadı) gruplarının öğretmenidir.
   */
  async function tenant(options: { learning?: boolean } = {}) {
    clientIp = `10.100.${(tenantCount += 1)}.1`
    const institution = await createInstitution(app, {
      type: 'language_school',
      ...(options.learning === false ? { enabledModules: { learning: false } } : {}),
    })
    // Görev hedefi dil okulunda sınıf kaydıdır (`group` türü); kursiyerin `classId`'si onu seçer.
    const classes = { evening: 'B1-E', morning: 'A2-S', weekend: 'B1-W' }
    await insertMissingRecords(
      db,
      institution.id,
      [
        ...Object.entries({
          [classes.evening]: 'B1',
          [classes.morning]: 'A2',
          [classes.weekend]: 'B1',
        }).map(([id, level]) => ({
          collection: 'classes' as const,
          id,
          data: { id, grade: 0, level, branchId: 'b-1', teacherId: 't-x' },
        })),
        ...[
          ['k-1', 'Deniz Yılmaz', true, classes.evening],
          ['k-2', 'Ece Yılmaz', true, classes.evening],
          ['k-3', 'Can Arslan', true, classes.morning],
          ['k-4', 'Ayşe Demir', true, classes.weekend],
          ['k-5', 'Fatma Kara', false, classes.evening],
        ].map(([id, name, isActive, classId]) => ({
          collection: 'students' as const,
          id: id as string,
          data: { id, name, isActive, classId },
        })),
      ],
      FIXED_NOW,
    )
    const users = {
      selin: await createMember(app, institution.id, 'ogretmen'),
      can: await createMember(app, institution.id, 'ogretmen'),
    }
    const student = (recordId: string) =>
      createMember(app, institution.id, 'ogrenci', [{ kind: 'student', recordId }])
    const cookies = {
      admin: await signInAs(app, institution.admin),
      selin: await signInAs(app, users.selin),
      can: await signInAs(app, users.can),
      deniz: await signInAs(app, await student('k-1')),
      ece: await signInAs(app, await student('k-2')),
      canStudent: await signInAs(app, await student('k-3')),
      parent: await signInAs(
        app,
        await createMember(app, institution.id, 'veli', [{ kind: 'child', recordId: 'k-1' }]),
      ),
      frontDesk: await signInAs(app, await createMember(app, institution.id, 'onburo')),
    }

    const course = async (name: string, level: 'A2' | 'B1') => {
      const created = await ok(
        await call(
          'POST',
          '/courses',
          cookies.admin,
          { name, level, totalHours: 12, weeklyHours: 4, minLearners: 2, maxLearners: 12 },
          key(),
        ),
        201,
      )
      await ok(await call('POST', `/courses/${created.id}/activate`, cookies.admin, {}, match(1)))
      return created.id as string
    }
    const group = async (
      courseId: string,
      name: string,
      teacher: { membershipId: string },
      room: string,
      days: [number, number],
      members: [string, ...string[]],
    ) => {
      const created = await ok(
        await call(
          'POST',
          '/groups',
          cookies.admin,
          {
            courseId,
            name,
            ageBand: 'adult',
            teacherMembershipId: teacher.membershipId,
            delivery: 'in_person',
            room,
            schedule: days.flatMap((weekday) => [
              { weekday, startTime: '10:00' },
              { weekday, startTime: '10:45' },
            ]),
            startDate: '2026-10-12',
            capacity: 10,
          },
          key(),
        ),
        201,
      )
      for (const studentId of members)
        await db.insert(languageGroupMembers).values({
          institutionId: institution.id,
          id: randomUUID(),
          groupId: created.id,
          studentId,
          status: 'active' as const,
          joinedAt: FIXED_NOW,
        })
      return created.id as string
    }
    const b1 = await course('Genel İngilizce B1', 'B1')
    const a2 = await course('Genel İngilizce A2', 'A2')
    const groups = {
      evening: await group(b1, 'B1 Akşam', users.selin, 'Derslik 1', [1, 3], ['k-1', 'k-2', 'k-5']),
      morning: await group(a2, 'A2 Sabah', users.can, 'Derslik 2', [2, 4], ['k-3']),
      weekend: await group(b1, 'B1 Hafta Sonu', users.can, 'Derslik 3', [5, 6], ['k-4']),
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
    const quizOf = (title: string) =>
      seed({
        title,
        content: {
          type: 'quiz',
          items: items.map((questionVersionId) => ({ questionVersionId, points: 1 })),
        },
        license: { kind: 'institution_original' },
        tags: tags('reading'),
      })
    const rubricId = randomUUID()
    const rubricVersionId = randomUUID()
    const at = { createdAt: FIXED_NOW, updatedAt: FIXED_NOW }
    await db
      .insert(rubrics)
      .values({ institutionId: institution.id, id: rubricId, ownerUserId: users.selin.id, ...at })
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
      users,
      cookies,
      groups,
      classes,
      items,
      quiz: await quizOf('Okuma değerlendirmesi'),
      quizA2: await quizOf('Okuma değerlendirmesi A2'),
      practice: await quizOf('Okuma alıştırması'),
      essay: await seed(homework('Yazma 1')),
      rubricVersionId,
    }
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  async function assign(
    t: Tenant,
    versionId: string,
    groupId: string,
    settings: Record<string, unknown>,
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

  /** Kursiyer denemeyi başlatır ve ilk `correct` soruya doğru, kalanına yanlış cevap verir. */
  async function solve(t: Tenant, cookie: string, assignmentId: string, correct: number) {
    const attempt = await ok(
      await call('POST', `/task-assignments/${assignmentId}/attempts`, cookie, {}, key()),
      201,
    )
    const answers = Object.fromEntries(
      t.items.map((id, index) => [
        id,
        { questionType: 'multiple_choice', optionId: index < correct ? 'a' : 'b' },
      ]),
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

  const decide = (
    t: Tenant,
    learnerId: string,
    level: string,
    decidedAt: Date,
    skill: string | null = null,
  ) =>
    db.insert(levelDecisions).values({
      institutionId: t.institution.id,
      id: randomUUID(),
      learnerKind: 'student',
      learnerId,
      kind: 'correction',
      placementSessionId: null,
      skill: skill as never,
      level: level as never,
      rationale: 'Kur içi sonuçlara göre.',
      decidedByUserId: t.institution.admin.id,
      decidedAt,
      evidenceSnapshot: {
        schemaVersion: 2,
        context: 'general',
        computedAt: decidedAt.toISOString(),
        overall: { status: 'suggested', level: level as never },
        skills: [],
        evidence: [],
      },
    })

  /**
   * Veriyi kurar: B1 Akşam'da okuma değerlendirmesi (Deniz 2/2, Ece 1/2), Deniz'in puanlı yazma
   * ödevi, Deniz'in sayılmayan alıştırması; A2 Sabah'ta Can 0/2. Seviye kararları: Deniz B1 (eski
   * A2 kararından sonra), Ece yalnız okuma becerisinde B2 (genel karar yok), Can A2.
   */
  async function populate(t: Tenant) {
    const reading = await assign(t, t.quiz, t.classes.evening, {
      attempts: { kind: 'evaluation', maxAttempts: 1 },
    })
    await solve(t, t.cookies.deniz, reading, 2)
    await solve(t, t.cookies.ece, reading, 1)
    const practice = await assign(t, t.practice, t.classes.evening, {
      attempts: { kind: 'practice' },
    })
    await solve(t, t.cookies.deniz, practice, 0)
    const readingA2 = await assign(t, t.quizA2, t.classes.morning, {
      attempts: { kind: 'evaluation', maxAttempts: 1 },
    })
    await solve(t, t.cookies.canStudent, readingA2, 0)

    const essay = await assign(t, t.essay, t.classes.evening, {
      submission: { submissionKind: 'text', maxVersions: 1 },
      rubricVersionId: t.rubricVersionId,
    })
    const submission = await ok(
      await call(
        'POST',
        `/task-assignments/${essay}/submissions`,
        t.cookies.deniz,
        { submissionKind: 'text', body: 'My weekend was busy and nice.' },
        key(),
      ),
      201,
    )
    await ok(
      await call(
        'POST',
        `/task-submissions/${submission.id}/scores`,
        t.cookies.admin,
        {
          versionNumber: 1,
          criteria: [
            { criterionId: 'task', band: 4, comment: null },
            { criterionId: 'grammar', band: 2, comment: 'Zaman ekleri eksik.' },
          ],
          overallComment: 'İyi.',
        },
        { ...key(), ...match(submission.rowVersion ?? 1) },
      ),
      201,
    )
    // Yazma yüzdesi puanlama kuralından gelir; beklenen değer ilerleme panosundan okunur.
    const progress = await ok(await call('GET', '/students/k-1/skill-progress', t.cookies.admin))
    const writing = (progress.skills as Json[]).find((row) => row.skill === 'writing')!.latest

    const day = 24 * 60 * 60_000
    await decide(t, 'k-1', 'A2', new Date(FIXED_NOW.getTime() - 20 * day))
    await decide(t, 'k-1', 'B1', new Date(FIXED_NOW.getTime() - 10 * day))
    await decide(t, 'k-2', 'B2', new Date(FIXED_NOW.getTime() - 5 * day), 'reading')
    await decide(t, 'k-3', 'A2', new Date(FIXED_NOW.getTime() - 5 * day))
    return { writing: writing as number }
  }

  test('IST-118 DOM-BEC-037 uç: oturumsuz 401; öğrenci, veli ve ön büro 403', async () => {
    const t = await tenant()
    fails(await report(), 401, 'unauthenticated')
    for (const cookie of [t.cookies.deniz, t.cookies.parent, t.cookies.frontDesk])
      fails(await report(cookie), 403, 'forbidden')
  })

  test('IST-118 DOM-BEC-037 modül kapalıysa 403 module_disabled; okul türünde yönetici için de 404', async () => {
    const closed = await tenant({ learning: false })
    fails(await report(closed.cookies.admin), 403, 'module_disabled')

    clientIp = `10.100.${(tenantCount += 1)}.1`
    const school = await createInstitution(app, { type: 'school' })
    const cookie = await signInAs(app, school.admin)
    fails(await report(cookie), 404, 'not_found')
    fails(await report(cookie, '?groupBy=level'), 404, 'not_found')
  })

  test('IST-118 DOM-BEC-037 bilinmeyen ya da geçersiz sorgu 400', async () => {
    const t = await tenant()
    for (const query of ['?foo=1', '?groupBy=teacher', '?groupBy=class&page=2', '?groupBy='])
      assert.equal((await report(t.cookies.admin, query)).statusCode, 400, query)
  })

  test('DOM-BEC-037 grup raporu: ortalama, kanıt ve kursiyer sayısı, seviye dağılımı; alıştırma, pasif kursiyer ve beceri kararı sayılmaz', async () => {
    const t = await tenant()
    const { writing } = await populate(t)
    const response = await report(t.cookies.admin)
    const data = await ok(response)
    assert.equal(data.groupBy, 'class')
    assert.equal(data.computedAt, FIXED_NOW.toISOString())
    // Gruplar ada göre: A2 Sabah, B1 Akşam, B1 Hafta Sonu.
    assert.deepEqual(
      (data.groups as Json[]).map((group) => group.name),
      ['A2 Sabah', 'B1 Akşam', 'B1 Hafta Sonu'],
    )
    const [morning, evening, weekend] = data.groups as Json[]

    assert.equal(evening.id, t.groups.evening)
    assert.equal(evening.level, 'B1')
    // Pasif kursiyer (k-5) sayılmaz.
    assert.equal(evening.studentCount, 2)
    assert.deepEqual(skillOf(evening, 'reading'), {
      skill: 'reading',
      label: skillOf(evening, 'reading').label,
      // Deniz %100, Ece %50: kursiyer başına eşit ağırlıkla %75; alıştırma (Deniz %0) girmez.
      average: 75,
      evidenceCount: 2,
      studentCount: 2,
    })
    assert.equal(skillOf(evening, 'writing').average, writing)
    assert.equal(skillOf(evening, 'writing').evidenceCount, 1)
    assert.equal(skillOf(evening, 'writing').studentCount, 1)
    for (const skill of ['listening', 'speaking']) {
      assert.equal(skillOf(evening, skill).average, null)
      assert.equal(skillOf(evening, skill).evidenceCount, 0)
    }
    // Deniz'in güncel genel kararı B1 (eski A2 değil); Ece'nin yalnız beceri kararı var → seviyesiz.
    assert.deepEqual(
      (evening.levels as Json[]).map((row) => [row.level, row.count]),
      [['B1', 1]],
    )
    assert.equal(evening.noLevelCount, 1)

    assert.equal(morning.level, 'A2')
    assert.equal(morning.studentCount, 1)
    assert.equal(skillOf(morning, 'reading').average, 0)
    assert.deepEqual(
      (morning.levels as Json[]).map((row) => [row.level, row.count]),
      [['A2', 1]],
    )

    // Hiç görev yapmayan kursiyer sayılır; ortalamalar sıfır değil boştur.
    assert.equal(weekend.studentCount, 1)
    for (const row of weekend.skills as Json[]) assert.equal(row.average, null)
    assert.equal(weekend.noLevelCount, 1)

    // Toplam her kursiyeri bir kez sayar (k-1, k-2, k-3, k-4).
    assert.equal(data.totals.studentCount, 4)
    assert.equal(skillOf(data.totals, 'reading').evidenceCount, 3)
    assert.equal(skillOf(data.totals, 'reading').studentCount, 3)
    // Kursiyer ortalamaları 100, 50, 0 → %50.
    assert.equal(skillOf(data.totals, 'reading').average, 50)
    assert.deepEqual(
      (data.totals.levels as Json[]).map((row) => [row.level, row.count]),
      [
        ['A2', 1],
        ['B1', 1],
      ],
    )
    assert.equal(data.totals.noLevelCount, 2)

    // Kişi adı, kişi kimliği ve kişi puanı yanıtta yoktur.
    for (const secret of ['Deniz', 'Ece', 'Can', 'Fatma', 'k-1', 'k-2', 'k-5'])
      assert.equal(response.body.includes(secret), false, secret)
  })

  test('DOM-BEC-037 kur raporu: aynı seviyenin grupları birleşir, satır seviye sırasındadır', async () => {
    const t = await tenant()
    await populate(t)
    const data = await ok(await report(t.cookies.admin, '?groupBy=level'))
    assert.equal(data.groupBy, 'level')
    assert.deepEqual(
      (data.groups as Json[]).map((group) => [
        group.id,
        group.name,
        group.level,
        group.studentCount,
      ]),
      [
        ['A2', 'A2', 'A2', 1],
        ['B1', 'B1', 'B1', 3],
      ],
    )
    const b1 = (data.groups as Json[])[1]!
    assert.equal(skillOf(b1, 'reading').average, 75)
    assert.equal(skillOf(b1, 'reading').studentCount, 2)
    // k-1 B1, k-2 ve k-4 seviyesiz.
    assert.equal(b1.noLevelCount, 2)
    assert.equal(data.totals.studentCount, 4)
    // Varsayılan gruplama `class`'tır.
    assert.equal((await ok(await report(t.cookies.admin))).groupBy, 'class')
  })

  test('IST-118 DOM-YTK-028 öğretmen yalnız kendi gruplarının raporunu görür; toplam da onlarla sınırlı', async () => {
    const t = await tenant()
    await populate(t)

    const selin = await ok(await report(t.cookies.selin))
    assert.deepEqual(
      (selin.groups as Json[]).map((group) => group.name),
      ['B1 Akşam'],
    )
    assert.equal(selin.totals.studentCount, 2)
    assert.equal(skillOf(selin.groups[0], 'reading').average, 75)
    // Can'ın öğrencisinin sonucu Selin'in toplamına girmez.
    assert.equal(skillOf(selin.totals, 'reading').evidenceCount, 2)

    const can = await ok(await report(t.cookies.can))
    assert.deepEqual(
      (can.groups as Json[]).map((group) => group.name),
      ['A2 Sabah', 'B1 Hafta Sonu'],
    )
    assert.equal(can.totals.studentCount, 2)
    assert.equal(skillOf(can.totals, 'reading').evidenceCount, 1)

    const byLevel = await ok(await report(t.cookies.selin, '?groupBy=level'))
    assert.deepEqual(
      (byLevel.groups as Json[]).map((group) => [group.id, group.studentCount]),
      [['B1', 2]],
    )
  })

  test('IST-118 DOM-YTK-028 koordinatör öğretmen görevli olduğu seviyenin bütün gruplarını görür', async () => {
    const t = await tenant()
    await populate(t)
    await db.insert(coordinatorDuties).values({
      institutionId: t.institution.id,
      id: randomUUID(),
      membershipId: t.users.can.membershipId,
      kind: 'academic_coordinator',
      scopeId: 'B1',
      assignedByUserId: t.institution.admin.id,
    })
    const data = await ok(await report(t.cookies.can))
    assert.deepEqual(
      (data.groups as Json[]).map((group) => group.name),
      ['A2 Sabah', 'B1 Akşam', 'B1 Hafta Sonu'],
    )
  })

  test('IST-118 DOM-BEC-037 başka kurumun grubu, kursiyeri ve sonucu görünmez; boş kurum boş rapor alır', async () => {
    const t = await tenant()
    await populate(t)
    clientIp = `10.100.${(tenantCount += 1)}.1`
    const other = await createInstitution(app, { type: 'language_school' })
    const cookie = await signInAs(app, other.admin)
    const response = await report(cookie)
    const data = await ok(response)
    assert.deepEqual(data.groups, [])
    assert.equal(data.totals.studentCount, 0)
    for (const row of data.totals.skills as Json[]) {
      assert.equal(row.average, null)
      assert.equal(row.evidenceCount, 0)
    }
    assert.deepEqual(data.totals.levels, [])
    for (const id of Object.values(t.groups)) assert.equal(response.body.includes(id), false)
  })
})
