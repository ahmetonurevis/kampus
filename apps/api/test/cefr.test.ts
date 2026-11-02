import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import type { ResourceVersionInput } from '@kampus/school-core/content/resource.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { levelDecisions, placementSessions } from '../src/db/schema/cefr.ts'
import { languageGroupMembers } from '../src/db/schema/language-groups.ts'
import { records } from '../src/db/schema/records.ts'
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
 * Seviye tespiti ve CEFR profili uçları (OG-054; IST-058, IST-060; DOM-DIL-010…012, DOM-BEC-034).
 * Kural core `cefr/placement.ts` ve `cefr/suggestion.ts`'tedir; burada kurum türü (okulda 404),
 * rol, başka kurum, gövdedeki `version` ile sürüm, mükerrer işlem, kalıcılık ve profilin rol
 * kapsamı (öğrenci kendisi, veli çocuğu, öğretmen grubu) denetlenir. Saat 6 Ekim 2026.
 */

type Json = ReturnType<typeof JSON.parse>
type Method = 'GET' | 'POST'

const question = (
  skill: 'language_use' | 'reading' | 'listening',
  n: number,
): Partial<ResourceVersionInput> => ({
  title: `Soru ${skill} ${n}`,
  content: {
    type: 'question',
    question: {
      questionType: 'multiple_choice',
      stem: `${skill} ${n}?`,
      options: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
        { id: 'c', text: 'C' },
        { id: 'd', text: 'D' },
      ],
    },
  },
  answerKey: { questionType: 'multiple_choice', correctOptionId: 'a', explanation: 'A doğrudur.' },
  license: { kind: 'institution_original' },
  tags: { subjectId: 'ingilizce', gradeLevels: [9], primarySkill: skill, cefrLevel: 'B1' },
})
const choice = (optionId: string) => ({ questionType: 'multiple_choice', optionId })
const bands = (band: number) => [
  { criterionId: 'task', band, comment: null },
  { criterionId: 'grammar', band, comment: null },
]

describe('seviye tespiti ve CEFR profili uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '127.0.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: Method,
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
  async function ok(response: Awaited<ReturnType<typeof call>>, status = 200) {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function fails(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
    assert.equal(response.statusCode, status, response.body)
    assert.equal(response.json().code, code, response.body)
  }

  /**
   * Dil okulu: Deniz (`s-deniz`) öğretmenin grubundadır, Ece (`s-ece`) hiçbir grupta değildir.
   * Aday `p-aday`. Form üç otomatik bölümde ikişer B1 sorusu taşır; yazma ve konuşma rubrikleri yayındadır.
   */
  async function tenant(type: 'school' | 'language_school' = 'language_school') {
    clientIp = `10.54.${(tenantCount += 1)}.1`
    const institution = await createInstitution(app, { type })
    const users = {
      frontDesk: await createMember(app, institution.id, 'onburo'),
      teacher: await createMember(app, institution.id, 'ogretmen'),
      other: await createMember(app, institution.id, 'ogretmen'),
      student: await createMember(app, institution.id, 'ogrenci', [
        { kind: 'student', recordId: 's-deniz' },
      ]),
      parent: await createMember(app, institution.id, 'veli', [
        { kind: 'child', recordId: 's-deniz' },
      ]),
    }
    const cookies = {
      admin: await signInAs(app, institution.admin),
      frontDesk: await signInAs(app, users.frontDesk),
      teacher: await signInAs(app, users.teacher),
      other: await signInAs(app, users.other),
      student: await signInAs(app, users.student),
      parent: await signInAs(app, users.parent),
    }
    await db
      .insert(records)
      .values(
        [
          ['students', 's-deniz'],
          ['students', 's-ece'],
          ['prospects', 'p-aday'],
        ].map(([collection, id]) => ({
          institutionId: institution.id,
          collection: collection!,
          id: id!,
          data: { id },
          position: 1,
        })),
      )
      .onConflictDoNothing()
    const seed = async (input: Partial<ResourceVersionInput>) =>
      (
        await seedResource(db, institution.id, {
          ownerUserId: institution.admin.id,
          versions: [{ status: 'published', input }],
        })
      ).versions[0]!
    const questions: Record<string, string[]> = {}
    for (const skill of ['language_use', 'reading', 'listening'] as const)
      questions[skill] = [(await seed(question(skill, 1))).id, (await seed(question(skill, 2))).id]
    const form = await seed({
      title: 'Seviye tespit formu',
      content: {
        type: 'quiz',
        items: Object.values(questions)
          .flat()
          .map((questionVersionId) => ({ questionVersionId, points: 1 })),
      },
      license: { kind: 'institution_original' },
      tags: { subjectId: 'ingilizce', gradeLevels: [9] },
    })
    // Yazma ve konuşma için birer yayındaki rubrik; kriter kimlikleri ortaktır (`bands`).
    const at = { createdAt: FIXED_NOW, updatedAt: FIXED_NOW }
    const writing = sampleRubricData()
    const speaking = {
      ...writing,
      title: 'Konuşma rubriği',
      skill: 'speaking' as const,
      criteria: writing.criteria.map((criterion, index) => ({
        ...criterion,
        aspect: index === 0 ? 'range' : 'accuracy',
      })),
    }
    const rubricVersionIds: Record<string, string> = {}
    for (const [section, data] of [
      ['writing', writing],
      ['speaking', speaking],
    ] as const) {
      const rubricId = randomUUID()
      rubricVersionIds[section] = randomUUID()
      await db.insert(rubrics).values({
        institutionId: institution.id,
        id: rubricId,
        ownerUserId: institution.admin.id,
        ...at,
      })
      await db.insert(rubricVersions).values({
        institutionId: institution.id,
        id: rubricVersionIds[section]!,
        rubricId,
        versionNumber: 1,
        status: 'published',
        ...data,
        publishedAt: FIXED_NOW,
        ...at,
      })
    }
    const openBody = (overrides: Record<string, unknown> = {}) => ({
      learnerKind: 'student',
      learnerId: 's-deniz',
      formId: form.resourceId,
      formVersionId: form.id,
      mode: 'in_person',
      ...overrides,
    })
    const t = { institution, users, cookies, questions, openBody, rubricVersionIds }
    if (type === 'language_school') await joinTeacherGroup(t)
    return t
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  /** Deniz öğretmenin (`teacher`) grubuna eklenir; `other` öğretmenin grubu yoktur. */
  async function joinTeacherGroup(t: {
    institution: { id: string }
    users: { teacher: { membershipId: string } }
    cookies: { admin: string }
  }) {
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
    await ok(
      await call(
        'POST',
        `/courses/${course.id}/activate`,
        t.cookies.admin,
        {},
        {
          'if-match': '"1"',
        },
      ),
    )
    const group = await ok(
      await call(
        'POST',
        '/groups',
        t.cookies.admin,
        {
          courseId: course.id,
          name: 'B1 Akşam',
          ageBand: 'adult',
          teacherMembershipId: t.users.teacher.membershipId,
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
      institutionId: t.institution.id,
      id: randomUUID(),
      groupId: group.id,
      studentId: 's-deniz',
      status: 'active',
      joinedAt: FIXED_NOW,
    })
  }

  const open = (t: Tenant, overrides: Record<string, unknown> = {}, cookie = t.cookies.teacher) =>
    call('POST', '/placement-sessions', cookie, t.openBody(overrides), key())
  const command = (
    cookie: string,
    sessionId: string,
    verb: string,
    body: unknown,
    headers: Record<string, string> = key(),
  ) => call('POST', `/placement-sessions/${sessionId}/${verb}`, cookie, body, headers)
  const autoBody = (t: Tenant, section: string, version: number, option = 'a') => ({
    version,
    section,
    answers: Object.fromEntries((t.questions[section] ?? []).map((id) => [id, choice(option)])),
  })
  const rubricBody = (t: Tenant, section: string, version: number, band = 3) => ({
    version,
    section,
    rubricVersionId: t.rubricVersionIds[section],
    targetLevel: 'B1',
    criteria: bands(band),
  })
  const sessionRows = (institutionId: string) =>
    db.select().from(placementSessions).where(eq(placementSessions.institutionId, institutionId))
  const decisionRows = (institutionId: string) =>
    db.select().from(levelDecisions).where(eq(levelDecisions.institutionId, institutionId))

  /** Bütün bölümleri girilmiş ve bitmiş oturum. */
  async function scoredSession(t: Tenant) {
    let session = await ok(await open(t), 201)
    for (const section of ['language_use', 'reading', 'listening'])
      session = await ok(
        await command(
          t.cookies.teacher,
          session.id,
          'score',
          autoBody(t, section, session.version),
        ),
      )
    session = await ok(
      await command(t.cookies.teacher, session.id, 'complete', { version: session.version }),
    )
    for (const section of ['writing', 'speaking'])
      session = await ok(
        await command(
          t.cookies.admin,
          session.id,
          'score',
          rubricBody(t, section, session.version),
        ),
      )
    return session
  }
  const decideBody = (version: number) => ({
    version,
    level: 'B1',
    skillLevels: [{ skill: 'speaking', level: 'B1+' }],
    rationale: 'Konuşma görüşmesi akıcı; yazma B1 hedefinde.',
  })

  test('IST-058 oturumsuz 401', async () => {
    const t = await tenant()
    fails(await call('GET', `/placement-sessions/${randomUUID()}`), 401, 'unauthenticated')
    fails(
      await call('POST', '/placement-sessions', undefined, t.openBody()),
      401,
      'unauthenticated',
    )
    fails(await call('GET', '/students/s-deniz/cefr-profile'), 401, 'unauthenticated')
  })

  test('DOM-YTK-012 okulda tespit ve profil uçları her rol için 404', async () => {
    const t = await tenant('school')
    for (const cookie of [t.cookies.admin, t.cookies.frontDesk, t.cookies.student]) {
      fails(await open(t, {}, cookie), 404, 'not_found')
      fails(await call('GET', `/placement-sessions/${randomUUID()}`, cookie), 404, 'not_found')
      fails(await call('GET', '/students/s-deniz/cefr-profile', cookie), 404, 'not_found')
    }
    assert.equal((await sessionRows(t.institution.id)).length, 0)
  })

  test('DOM-DIL-010 IST-060 ön büro, öğrenci ve veli tespit uçlarında 403; ön büro profili göremez', async () => {
    const t = await tenant()
    const session = await ok(await open(t), 201)
    for (const cookie of [t.cookies.frontDesk, t.cookies.student, t.cookies.parent]) {
      fails(
        await call('GET', '/placement-sessions?learnerKind=student&learnerId=s-deniz', cookie),
        403,
        'forbidden',
      )
      fails(await call('GET', `/placement-sessions/${session.id}`, cookie), 403, 'forbidden')
      fails(await open(t, {}, cookie), 403, 'forbidden')
      fails(await command(cookie, session.id, 'score', autoBody(t, 'reading', 1)), 403, 'forbidden')
      fails(await command(cookie, session.id, 'complete', { version: 1 }), 403, 'forbidden')
      fails(await command(cookie, session.id, 'decide', decideBody(1)), 403, 'forbidden')
    }
    fails(
      await call('GET', '/students/s-deniz/cefr-profile', t.cookies.frontDesk),
      403,
      'forbidden',
    )
    const rows = await sessionRows(t.institution.id)
    assert.equal(rows.length, 1)
    assert.deepEqual(
      [rows[0]?.version, rows[0]?.sectionEntries, rows[0]?.completedAt],
      [1, [], null],
    )
    assert.equal((await decisionRows(t.institution.id)).length, 0)
  })

  test('IST-058 geçersiz gövde 400 ve kayıt değişmez; bilinmeyen kişi ve form 404', async () => {
    const t = await tenant()
    fails(await open(t, { mode: 'online' }), 400, 'validation_failed')
    fails(await open(t, { institutionId: randomUUID() }), 400, 'validation_failed')
    fails(await open(t, { learnerId: 's-yok' }), 404, 'not_found')
    fails(await open(t, { formVersionId: randomUUID() }), 404, 'not_found')
    assert.equal((await sessionRows(t.institution.id)).length, 0)
    const session = await ok(await open(t), 201)
    fails(
      await command(t.cookies.teacher, session.id, 'score', {
        version: 1,
        section: 'reading',
        percent: 90,
      }),
      400,
      'validation_failed',
    )
    const [row] = await sessionRows(t.institution.id)
    assert.deepEqual(row?.sectionEntries, [])
    assert.equal(row?.version, 1)
  })

  test('DOM-DIL-010 DOM-DIL-012 IST-058 tespit akışı: aç, puanla, bitir, karar ver; kalıcı', async () => {
    const t = await tenant()
    const response = await open(t)
    const opened = await ok(response, 201)
    assert.equal(response.headers.location, `/api/v1/placement-sessions/${opened.id}`)
    assert.equal(opened.validity.status, 'in_progress')
    assert.deepEqual(
      opened.sections.map((s: Json) => [s.section, s.status]),
      [
        ['language_use', 'pending'],
        ['reading', 'pending'],
        ['listening', 'pending'],
        ['writing', 'pending'],
        ['speaking', 'pending'],
      ],
    )
    // Süren oturum varken ikincisi açılmaz.
    fails(await open(t), 409, 'placement_in_progress')

    // Puan cevaplardan hesaplanır: iki sorudan biri doğru.
    const half = await ok(
      await command(t.cookies.teacher, opened.id, 'score', {
        version: 1,
        section: 'reading',
        answers: {
          [t.questions.reading![0]!]: choice('a'),
          [t.questions.reading![1]!]: choice('b'),
        },
      }),
    )
    const reading = half.sections.find((s: Json) => s.section === 'reading')
    assert.deepEqual([reading.status, reading.percent, reading.targetLevel], ['scored', 50, 'B1'])
    assert.equal(half.version, 2)
    // Başka bölümün sorusu bu bölümün cevabı olamaz.
    fails(
      await command(t.cookies.teacher, opened.id, 'score', {
        version: 2,
        section: 'listening',
        answers: { [t.questions.reading![0]!]: choice('a') },
      }),
      422,
      'answer_invalid',
    )

    const scored = await scoredSessionFrom(t, half)
    assert.equal(scored.validity.status, 'valid')
    assert.ok(scored.sections.every((s: Json) => s.status === 'scored'))
    assert.equal(scored.suggestion.context, 'placement')

    const decided = await ok(
      await command(t.cookies.teacher, scored.id, 'decide', decideBody(scored.version)),
    )
    assert.deepEqual(
      decided.decisions.map((d: Json) => [d.skill, d.level, d.kind]),
      [
        [null, 'B1', 'placement'],
        ['speaking', 'B1+', 'placement'],
      ],
    )
    const rows = await decisionRows(t.institution.id)
    assert.equal(rows.length, 2)
    assert.ok(rows.every((row) => row.evidenceSnapshot.context === 'placement'))
    const audit = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, scored.id))
    assert.ok(audit.some((row) => row.action === 'placement_session.decide'))

    // Kalıcılık: okuma aynı oturumu, listeyi ve profili verir.
    const read = await ok(await call('GET', `/placement-sessions/${scored.id}`, t.cookies.admin))
    assert.equal(read.decisions.length, 2)
    const list = await call(
      'GET',
      '/placement-sessions?learnerKind=student&learnerId=s-deniz',
      t.cookies.teacher,
    )
    assert.equal(list.json().meta.total, 1)
    const profile = await ok(await call('GET', '/students/s-deniz/cefr-profile', t.cookies.admin))
    assert.deepEqual(
      profile.current.map((c: Json) => [c.skill, c.level]),
      [
        [null, 'B1'],
        ['speaking', 'B1+'],
      ],
    )
    assert.equal(profile.timeline.length, 2)
    assert.equal(profile.estimate.label, 'Tahmini seviye')
    assert.equal(profile.placements.length, 1)

    // Karar değişmez; ikinci karar ve karardan sonra bölüm girişi 409.
    fails(
      await command(t.cookies.admin, scored.id, 'decide', decideBody(decided.version)),
      409,
      'placement_already_decided',
    )
    assert.equal((await decisionRows(t.institution.id)).length, 2)
  })

  async function scoredSessionFrom(t: Tenant, session: Json) {
    let current = session
    for (const section of ['language_use', 'listening'])
      current = await ok(
        await command(
          t.cookies.teacher,
          current.id,
          'score',
          autoBody(t, section, current.version),
        ),
      )
    current = await ok(
      await command(t.cookies.teacher, current.id, 'complete', { version: current.version }),
    )
    for (const section of ['writing', 'speaking'])
      current = await ok(
        await command(
          t.cookies.admin,
          current.id,
          'score',
          rubricBody(t, section, current.version),
        ),
      )
    return current
  }

  test('DOM-DIL-010 sürüm tutmazsa 409; bölüm bir kez, otomatik bölüm bitişten sonra girilmez; rubrik becerisi bölümle aynı', async () => {
    const t = await tenant()
    const session = await ok(await open(t), 201)
    fails(
      await command(t.cookies.teacher, session.id, 'score', autoBody(t, 'reading', 5)),
      409,
      'version_conflict',
    )
    const scored = await ok(
      await command(t.cookies.teacher, session.id, 'score', autoBody(t, 'reading', 1)),
    )
    fails(
      await command(t.cookies.teacher, session.id, 'score', autoBody(t, 'reading', scored.version)),
      409,
      'placement_section_scored',
    )
    const done = await ok(
      await command(t.cookies.teacher, session.id, 'complete', { version: scored.version }),
    )
    fails(
      await command(t.cookies.teacher, session.id, 'complete', { version: done.version }),
      409,
      'placement_completed',
    )
    fails(
      await command(t.cookies.teacher, session.id, 'score', autoBody(t, 'listening', done.version)),
      409,
      'placement_completed',
    )
    // Yazma ve konuşma puanlanmadan karar verilmez.
    fails(
      await command(t.cookies.teacher, session.id, 'decide', decideBody(done.version)),
      422,
      'placement_production_missing',
    )
    // Taslak rubrik sürümüyle puanlanmaz.
    await db
      .update(rubricVersions)
      .set({ status: 'draft', publishedAt: null })
      .where(eq(rubricVersions.id, t.rubricVersionIds.speaking!))
    fails(
      await command(
        t.cookies.teacher,
        session.id,
        'score',
        rubricBody(t, 'speaking', done.version),
      ),
      409,
      'rubric_version_unpublished',
    )
    // Rubriğin becerisi bölümle aynı olmalı: yazma rubriğiyle konuşma puanlanmaz.
    fails(
      await command(t.cookies.teacher, session.id, 'score', {
        ...rubricBody(t, 'speaking', done.version),
        rubricVersionId: t.rubricVersionIds.writing,
      }),
      422,
      'placement_rubric_skill_mismatch',
    )
    fails(
      await command(t.cookies.teacher, session.id, 'score', {
        ...rubricBody(t, 'writing', done.version),
        rubricVersionId: randomUUID(),
      }),
      404,
      'not_found',
    )
    const [row] = await sessionRows(t.institution.id)
    assert.equal(row?.sectionEntries.length, 1)
    assert.equal(row?.version, done.version)
    assert.equal((await decisionRows(t.institution.id)).length, 0)
  })

  test('IST-058 mükerrer işlem: aynı Idempotency-Key aynı yanıtı verir, ikinci yazma olmaz', async () => {
    const t = await tenant()
    const headers = key()
    const first = await call(
      'POST',
      '/placement-sessions',
      t.cookies.teacher,
      t.openBody(),
      headers,
    )
    const again = await call(
      'POST',
      '/placement-sessions',
      t.cookies.teacher,
      t.openBody(),
      headers,
    )
    assert.equal(first.statusCode, 201)
    assert.equal(again.statusCode, 201)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assert.equal(again.json().data.id, first.json().data.id)
    assert.equal((await sessionRows(t.institution.id)).length, 1)
    const id = first.json().data.id
    const scoreKey = key()
    const scored = await ok(
      await command(t.cookies.teacher, id, 'score', autoBody(t, 'reading', 1), scoreKey),
    )
    const replay = await ok(
      await command(t.cookies.teacher, id, 'score', autoBody(t, 'reading', 1), scoreKey),
    )
    assert.equal(replay.version, scored.version)
    const [row] = await sessionRows(t.institution.id)
    assert.equal(row?.sectionEntries.length, 1)
  })

  test('IST-058 IST-060 başka kurumun oturumu ve öğrencisi 404, B değişmez', async () => {
    const a = await tenant()
    const b = await tenant()
    const session = await ok(await open(b), 201)
    clientIp = '10.54.250.1'
    fails(await call('GET', `/placement-sessions/${session.id}`, a.cookies.admin), 404, 'not_found')
    fails(
      await command(a.cookies.admin, session.id, 'score', autoBody(b, 'reading', 1)),
      404,
      'not_found',
    )
    fails(await command(a.cookies.admin, session.id, 'complete', { version: 1 }), 404, 'not_found')
    fails(await command(a.cookies.admin, session.id, 'decide', decideBody(1)), 404, 'not_found')
    const list = await call(
      'GET',
      '/placement-sessions?learnerKind=student&learnerId=s-deniz',
      a.cookies.admin,
    )
    assert.equal(list.json().meta.total, 0)
    // Gövdedeki B formu A kurumunda yok.
    fails(await open(a, { formVersionId: b.openBody().formVersionId }), 404, 'not_found')
    const [row] = await sessionRows(b.institution.id)
    assert.equal(row?.version, 1)
    assert.equal(row?.completedAt, null)
    fails(await call('GET', '/students/s-yok/cefr-profile', a.cookies.admin), 404, 'not_found')
  })

  test('DOM-DIL-010 IST-060 öğretmen yalnız grubundaki öğrencinin tespitine erişir; kapsam dışı 404, kayıt değişmez', async () => {
    const t = await tenant()
    const session = await scoredSession(t)
    const other = t.cookies.other
    fails(
      await call('GET', '/placement-sessions?learnerKind=student&learnerId=s-deniz', other),
      404,
      'not_found',
    )
    fails(await call('GET', `/placement-sessions/${session.id}`, other), 404, 'not_found')
    fails(await open(t, {}, other), 404, 'not_found')
    fails(
      await command(other, session.id, 'score', autoBody(t, 'reading', session.version)),
      404,
      'not_found',
    )
    fails(
      await command(other, session.id, 'complete', { version: session.version }),
      404,
      'not_found',
    )
    fails(await command(other, session.id, 'decide', decideBody(session.version)), 404, 'not_found')
    // Grubu olan öğretmen de gruba girmemiş öğrenciye ulaşamaz.
    fails(await open(t, { learnerId: 's-ece' }), 404, 'not_found')
    fails(
      await call(
        'GET',
        '/placement-sessions?learnerKind=student&learnerId=s-ece',
        t.cookies.teacher,
      ),
      404,
      'not_found',
    )
    const [row] = await sessionRows(t.institution.id)
    assert.equal(row?.version, session.version)
    assert.equal((await sessionRows(t.institution.id)).length, 1)
    assert.equal((await decisionRows(t.institution.id)).length, 0)
    // Aday gruba bağlı değildir; her öğretmen açabilir. Yönetici gruptan bağımsızdır.
    await ok(await open(t, { learnerKind: 'prospect', learnerId: 'p-aday' }, other), 201)
    await ok(await open(t, { learnerId: 's-ece' }, t.cookies.admin), 201)
  })

  test('IST-060 profil görünümü: öğrenci ve veli kararın gerekçesini ve vereni görmez, personel görür', async () => {
    const t = await tenant()
    const session = await scoredSession(t)
    await ok(await command(t.cookies.teacher, session.id, 'decide', decideBody(session.version)))
    const profile = async (cookie: string) =>
      ok(await call('GET', '/students/s-deniz/cefr-profile', cookie))
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const view = await profile(cookie)
      assert.equal(view.view, 'learner')
      assert.equal(view.timeline.length, 2)
      for (const decision of view.timeline) {
        assert.ok(!('rationale' in decision), JSON.stringify(decision))
        assert.ok(!('decidedByUserId' in decision), JSON.stringify(decision))
      }
      assert.deepEqual(
        view.current.map((c: Json) => [c.skill, c.level]),
        [
          [null, 'B1'],
          ['speaking', 'B1+'],
        ],
      )
    }
    for (const cookie of [t.cookies.teacher, t.cookies.admin]) {
      const view = await profile(cookie)
      assert.equal(view.view, 'staff')
      assert.ok(
        view.timeline.every(
          (d: Json) =>
            d.rationale === decideBody(1).rationale && d.decidedByUserId === t.users.teacher.id,
        ),
      )
    }
  })

  test('IST-060 profil kapsamı: öğrenci kendisi, veli çocuğu, öğretmen grubundaki kursiyer', async () => {
    const t = await tenant()
    await scoredSession(t)
    const profile = (studentId: string, cookie: string) =>
      call('GET', `/students/${studentId}/cefr-profile`, cookie)
    for (const cookie of [t.cookies.student, t.cookies.parent, t.cookies.teacher, t.cookies.admin])
      assert.equal((await ok(await profile('s-deniz', cookie))).studentId, 's-deniz')
    for (const cookie of [t.cookies.student, t.cookies.parent, t.cookies.teacher])
      fails(await profile('s-ece', cookie), 404, 'not_found')
    fails(await profile('s-deniz', t.cookies.other), 404, 'not_found')
    assert.equal((await ok(await profile('s-ece', t.cookies.admin))).current.length, 0)
  })
})
