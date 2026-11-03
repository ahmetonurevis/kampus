import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import type { ResourceVersionInput } from '@kampus/school-core/content/resource.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { taskExtraTimes } from '../src/db/schema/skills.ts'
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
 * Bireysel ek süre uçları (OG-248; DOM-BEC-043; DOM-YTK-028). Kural core `skills/extra-time.ts`'te
 * sınanır; burada rol × kapsam, sıra (kapsam → rol → sürüm → kural), kalıcılık, `Idempotency-Key`,
 * süren denemenin bitişinin uzaması, biten denemenin açılmaması, gerekçenin öğrenciye
 * gitmemesi ve kaydın değişmezliği denetlenir.
 */

type Json = ReturnType<typeof JSON.parse>

const MINUTE = 60_000
const DUE = '2026-10-20T20:59:00.000Z'
const LIMIT = 10

const question = (): Partial<ResourceVersionInput> => ({
  title: 'Soru: Where does Ann live?',
  content: {
    type: 'question',
    question: {
      questionType: 'multiple_choice',
      stem: 'Where does Ann live?',
      options: [
        { id: 'a', text: 'In Ankara.' },
        { id: 'b', text: 'In Izmir.' },
        { id: 'c', text: 'In Bursa.' },
        { id: 'd', text: 'In Adana.' },
      ],
    },
  },
  answerKey: { questionType: 'multiple_choice', correctOptionId: 'b', explanation: 'Metin.' },
  license: { kind: 'institution_original' },
  tags: { subjectId: 'ingilizce', gradeLevels: [9], primarySkill: 'reading', cefrLevel: 'A2' },
})

describe('bireysel ek süre uçları', () => {
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

  const at = (offsetMs: number) => {
    now = new Date(FIXED_NOW.getTime() + offsetMs)
  }

  /**
   * `t-eng` 9-A'nın öğretmenidir, `t-mat` 9-B'nin. Deniz (`s-1`) 9-A'da, Can (`s-3`) 9-B'de.
   * Öğretmen `t-eng` ilk görevi kendisi atar; ikinci atamayı yönetici yapar.
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
      parent: await signInAs(app, await member('veli', 'child', 's-1')),
      frontDesk: await signInAs(app, await createMember(app, institution.id, 'onburo')),
    }
    // Aynı içerik aynı kursiyerlere açık ikinci atamada verilemez; her atama kendi içeriğini alır.
    const seed = async () =>
      (
        await seedResource(db, institution.id, {
          ownerUserId: teacher.id,
          versions: [{ status: 'published', input: question() }],
        })
      ).versions[0]!.id
    return { institution, cookies, seed }
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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
  const version = (rowVersion: number) => ({ 'if-match': `"${rowVersion}"` })

  async function ok(response: Awaited<ReturnType<typeof call>>, status = 200) {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function fails(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
    assert.equal(response.statusCode, status, response.body)
    assert.equal(response.json().code, code, response.body)
  }

  /** Atama; `by` kim atar (varsayılan atayan öğretmen). */
  async function assign(
    t: Tenant,
    settings: Record<string, unknown> = { timeLimitMinutes: LIMIT },
    by: string = t.cookies.teacher,
  ) {
    const data = await ok(
      await call(
        'POST',
        '/task-assignments',
        by,
        {
          resourceVersionId: await t.seed(),
          settings: { deadline: { dueAt: DUE }, ...settings },
          targets: [{ kind: 'class', id: '9-A' }],
        },
        key(),
      ),
      201,
    )
    return data.id as string
  }

  const path = (assignmentId: string, learnerId?: string) =>
    `/task-assignments/${assignmentId}/extra-times${learnerId === undefined ? '' : `/${learnerId}`}`
  const list = (assignmentId: string, cookie?: string) => call('GET', path(assignmentId), cookie)
  const grant = (
    assignmentId: string,
    cookie: string | undefined,
    body: unknown,
    headers: Record<string, string> = {},
  ) => call('POST', path(assignmentId), cookie, body, headers)
  const change = (
    assignmentId: string,
    cookie: string | undefined,
    learnerId: string,
    body: unknown,
    rowVersion: number,
  ) => call('PATCH', path(assignmentId, learnerId), cookie, body, version(rowVersion))
  const remove = (
    assignmentId: string,
    cookie: string | undefined,
    learnerId: string,
    rowVersion: number,
  ) => call('DELETE', path(assignmentId, learnerId), cookie, undefined, version(rowVersion))

  const ACCOMMODATION = { learnerId: 's-1', minutes: 5, reason: 'accommodation' }

  async function stored(institutionId: string) {
    const extra = await db
      .select()
      .from(taskExtraTimes)
      .where(eq(taskExtraTimes.institutionId, institutionId))
    const audits = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.institutionId, institutionId))
    return { extra, audits: audits.length }
  }

  const startAttempt = (assignmentId: string, cookie: string) =>
    call('POST', `/task-assignments/${assignmentId}/attempts`, cookie, {}, key())
  const attemptOf = async (attemptId: string, cookie: string) =>
    ok(await call('GET', `/task-attempts/${attemptId}`, cookie))

  test('DOM-BEC-043, DOM-YTK-028: 401; öğrenci, veli ve ön büro 403; atayan olmayan öğretmen yazamaz; atamayı görmeyen öğretmen ve başka kurum 404; modül kapalıyken 403', async () => {
    const t = await tenant()
    const own = await assign(t)
    const byAdmin = await assign(t, { timeLimitMinutes: LIMIT }, t.cookies.admin)
    const calls = (id: string, cookie?: string) => [
      list(id, cookie),
      grant(id, cookie, ACCOMMODATION),
      change(id, cookie, 's-1', { minutes: 5, reason: 'other' }, 1),
      remove(id, cookie, 's-1', 1),
    ]
    for (const response of await Promise.all(calls(own))) fails(response, 401, 'unauthenticated')
    for (const cookie of [t.cookies.student, t.cookies.parent, t.cookies.frontDesk])
      for (const response of await Promise.all(calls(own, cookie)))
        fails(response, 403, 'forbidden')
    // Atamayı görmeyen öğretmen (9-B) ve başka kurumun yöneticisi: varlık sızmaz.
    const other = await createInstitution(app)
    const foreignAdmin = await signInAs(app, other.admin)
    for (const cookie of [t.cookies.otherTeacher, foreignAdmin])
      for (const response of await Promise.all(calls(own, cookie)))
        fails(response, 404, 'not_found')

    // Atamayı sınıfı yüzünden gören ama atamayan öğretmen okur, yazamaz.
    const read = await ok(await list(byAdmin, t.cookies.teacher))
    assert.equal(read.canManage, false)
    assert.deepEqual(
      read.learners.map((row: Json) => row.learnerId),
      ['s-1'],
    )
    fails(await grant(byAdmin, t.cookies.teacher, ACCOMMODATION), 403, 'forbidden')
    fails(
      await change(byAdmin, t.cookies.teacher, 's-1', { minutes: 5, reason: 'other' }, 1),
      403,
      'forbidden',
    )
    fails(await remove(byAdmin, t.cookies.teacher, 's-1', 1), 403, 'forbidden')
    assert.deepEqual((await stored(t.institution.id)).extra, [])

    const closed = await createInstitution(app, { enabledModules: { learning: false } })
    const closedAdmin = await signInAs(app, closed.admin)
    for (const response of await Promise.all(calls(own, closedAdmin)))
      fails(response, 403, 'module_disabled')
  })

  test('DOM-BEC-043: 400 geçersiz gövde ve If-Match yok, kayıt değişmez; hedeflenmeyen kursiyer 404; süresiz görev 422', async () => {
    const t = await tenant()
    const id = await assign(t)
    const untimed = await assign(t, {})
    const before = await stored(t.institution.id)
    for (const body of [
      { ...ACCOMMODATION, minutes: 0 },
      { ...ACCOMMODATION, minutes: 301 },
      { ...ACCOMMODATION, minutes: 2.5 },
      { ...ACCOMMODATION, reason: undefined },
      { ...ACCOMMODATION, reason: 'çocuğun teşhisi' },
      { ...ACCOMMODATION, learnerId: '' },
      { minutes: 5, reason: 'other' },
    ])
      assert.equal((await grant(id, t.cookies.teacher, body)).statusCode, 400)
    fails(
      await call('PATCH', path(id, 's-1'), t.cookies.teacher, { minutes: 5, reason: 'other' }),
      400,
      'if_match_required',
    )
    fails(await call('DELETE', path(id, 's-1'), t.cookies.teacher), 400, 'if_match_required')
    assert.equal(
      (await call('GET', '/task-assignments/not-a-uuid/extra-times', t.cookies.teacher)).statusCode,
      400,
    )
    // Atamanın hedefinde olmayan öğrenci (Can 9-B'de) ve olmayan kimlik.
    fails(
      await grant(id, t.cookies.admin, { ...ACCOMMODATION, learnerId: 's-3' }),
      404,
      'not_found',
    )
    fails(
      await grant(id, t.cookies.admin, { ...ACCOMMODATION, learnerId: 'yok' }),
      404,
      'not_found',
    )
    // Süresiz görevde ek süre tanımlanmaz.
    fails(await grant(untimed, t.cookies.teacher, ACCOMMODATION), 422, 'extra_time_untimed')
    assert.deepEqual(await stored(t.institution.id), before)
  })

  test('DOM-BEC-043: verme, listeleme, değiştirme ve kaldırma kalıcıdır; kayıt geçmişi gerekçesiyle görünür; sürüm ve mükerrer verme 409; sınır 422', async () => {
    const t = await tenant()
    const id = await assign(t)
    const empty = await ok(await list(id, t.cookies.teacher))
    assert.deepEqual(
      [empty.timeLimitMinutes, empty.canManage, empty.learners.length],
      [LIMIT, true, 1],
    )
    assert.deepEqual(
      [empty.learners[0].current, empty.learners[0].version, empty.learners[0].learnerName],
      [null, 0, 'Deniz Yılmaz'],
    )

    now = new Date(FIXED_NOW.getTime() + MINUTE)
    const granted = await ok(await grant(id, t.cookies.teacher, ACCOMMODATION), 201)
    assert.equal(granted.version, 1)
    assert.deepEqual(
      [granted.current.minutes, granted.current.reason, granted.current.grantedAt],
      [5, 'accommodation', now.toISOString()],
    )
    fails(await grant(id, t.cookies.teacher, ACCOMMODATION), 409, 'extra_time_exists')
    fails(
      await change(id, t.cookies.teacher, 's-1', { minutes: 6, reason: 'other' }, 7),
      409,
      'version_conflict',
    )
    // Görevin süresini aşan ek süre.
    fails(
      await change(id, t.cookies.teacher, 's-1', { minutes: LIMIT + 1, reason: 'other' }, 1),
      422,
      'extra_time_too_long',
    )
    assert.equal((await stored(t.institution.id)).extra.length, 1)

    const changed = await ok(
      await change(id, t.cookies.admin, 's-1', { minutes: 8, reason: 'technical_issue' }, 1),
    )
    assert.deepEqual(
      [changed.version, changed.current.minutes, changed.current.reason],
      [2, 8, 'technical_issue'],
    )
    const removed = await ok(await remove(id, t.cookies.teacher, 's-1', 2))
    assert.deepEqual([removed.version, removed.current], [3, null])
    // Kaldırılmış ek süreyi tekrar değiştirmek ya da kaldırmak: kayıt yok.
    fails(
      await change(id, t.cookies.teacher, 's-1', { minutes: 5, reason: 'other' }, 3),
      404,
      'not_found',
    )
    fails(await remove(id, t.cookies.teacher, 's-1', 3), 404, 'not_found')

    // Kayıtlar yalnız eklenir; GET kalıcı geçmişi gerekçesiyle yeniden eskiye verir.
    const after = (await ok(await list(id, t.cookies.teacher))).learners[0]
    assert.deepEqual(
      after.history.map((entry: Json) => [entry.sequence, entry.minutes, entry.reason]),
      [
        [3, 0, null],
        [2, 8, 'technical_issue'],
        [1, 5, 'accommodation'],
      ],
    )
    assert.equal(after.current, null)
    assert.deepEqual(
      (await stored(t.institution.id)).extra.map((row) => row.sequence).sort(),
      [1, 2, 3],
    )
    // Kaldırıldıktan sonra yeniden verilebilir.
    const again = await ok(await grant(id, t.cookies.teacher, ACCOMMODATION), 201)
    assert.equal(again.version, 4)

    // Denetim yalnız alan adlarını taşır; gerekçe kategorisi ve dakika loglanmaz.
    const audits = await db
      .select({ action: auditLog.action, changes: auditLog.changes })
      .from(auditLog)
      .where(eq(auditLog.entityType, 'task_extra_time'))
    const mine = audits.filter((row) => row.action.startsWith('task_extra_time.'))
    assert.deepEqual(mine.map((row) => row.action).sort(), [
      'task_extra_time.change',
      'task_extra_time.grant',
      'task_extra_time.grant',
      'task_extra_time.remove',
    ])
    assert.ok(!JSON.stringify(mine).includes('technical_issue'))
    assert.ok(!logs.join('\n').includes('technical_issue'), 'gerekçe loga sızdı')
  })

  test('DOM-BEC-043: mükerrer Idempotency-Key ikinci kayıt yazmaz; farklı işlemle aynı anahtar 422', async () => {
    const t = await tenant()
    const id = await assign(t)
    const headers = key()
    const created = await ok(await grant(id, t.cookies.teacher, ACCOMMODATION, headers), 201)
    const replay = await grant(id, t.cookies.teacher, ACCOMMODATION, headers)
    assert.equal(replay.statusCode, 201, replay.body)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json().data, created)
    assert.equal((await stored(t.institution.id)).extra.length, 1)
    fails(
      await grant(id, t.cookies.teacher, { ...ACCOMMODATION, minutes: 6 }, headers),
      422,
      'idempotency_key_reused',
    )
    assert.equal((await stored(t.institution.id)).extra.length, 1)
  })

  test('DOM-BEC-043: süren denemenin bitişi ek süreyle uzar; biten deneme yeniden açılmaz; gerekçe öğrenci yanıtında yok', async () => {
    const t = await tenant()
    const id = await assign(t, { timeLimitMinutes: LIMIT, attempts: { kind: 'practice' } })
    const attempt = await ok(await startAttempt(id, t.cookies.student), 201)
    assert.equal(attempt.extraMinutes, 0)
    assert.equal(attempt.remainingMs, LIMIT * MINUTE)

    at(8 * MINUTE)
    await ok(await grant(id, t.cookies.teacher, ACCOMMODATION), 201)
    const longer = await attemptOf(attempt.id, t.cookies.student)
    assert.equal(longer.status, 'in_progress')
    assert.equal(longer.extraMinutes, 5)
    assert.equal(longer.endsAt, new Date(FIXED_NOW.getTime() + 15 * MINUTE).toISOString())
    assert.equal(longer.remainingMs, 7 * MINUTE)
    // Öğrenci ek süre gerekçesini hiçbir yanıtta görmez.
    for (const response of [
      await call('GET', `/task-attempts/${attempt.id}`, t.cookies.student),
      await call('GET', `/task-attempts?assignmentId=${id}`, t.cookies.student),
      await call('GET', `/task-assignments/${id}`, t.cookies.student),
      await call('GET', '/task-assignments', t.cookies.student),
    ]) {
      assert.equal(response.statusCode, 200, response.body)
      assert.ok(!response.body.includes('accommodation'), 'gerekçe öğrenciye gitti')
      assert.ok(!response.body.includes('"reason"'), 'gerekçe alanı öğrenciye gitti')
    }
    // 12. dakikada 10 + 1 dakikalık sınır denemeyi geçmişte bitirirdi: reddedilir.
    at(12 * MINUTE)
    fails(
      await change(id, t.cookies.teacher, 's-1', { minutes: 1, reason: 'other' }, 1),
      422,
      'extra_time_below_elapsed',
    )

    // Yeni sürede de süre dolunca deneme kapanır (10 + 5 dk).
    at(16 * MINUTE)
    const over = await attemptOf(attempt.id, t.cookies.student)
    assert.deepEqual([over.status, over.autoSubmitted], ['expired', true])
    assert.equal(over.completedAt, new Date(FIXED_NOW.getTime() + 15 * MINUTE).toISOString())

    // Biten deneme sonradan verilen ek süreyle yeniden açılmaz (DOM-BEC-043).
    const second = await assign(t, { timeLimitMinutes: LIMIT, attempts: { kind: 'practice' } })
    at(20 * MINUTE)
    const ended = await ok(await startAttempt(second, t.cookies.student), 201)
    at(32 * MINUTE)
    assert.equal((await attemptOf(ended.id, t.cookies.student)).status, 'expired')
    await ok(await grant(second, t.cookies.teacher, ACCOMMODATION), 201)
    const stillEnded = await attemptOf(ended.id, t.cookies.student)
    assert.equal(stillEnded.status, 'expired')
    assert.equal(stillEnded.completedAt, new Date(FIXED_NOW.getTime() + 30 * MINUTE).toISOString())
    assert.equal(stillEnded.extraMinutes, 0)
    // Yeni deneme ise güncel ek süreyle başlar.
    const fresh = await ok(await startAttempt(second, t.cookies.student), 201)
    assert.equal(fresh.extraMinutes, 5)
    assert.equal(fresh.remainingMs, 15 * MINUTE)
  })

  test('DOM-BEC-043: kayıtlar değişmez; güncelleme, silme ve boşaltma veritabanında reddedilir', async () => {
    const t = await tenant()
    const id = await assign(t)
    await ok(await grant(id, t.cookies.teacher, ACCOMMODATION), 201)
    for (const work of [db.update(taskExtraTimes).set({ minutes: 1 }), db.delete(taskExtraTimes)])
      await assert.rejects(work, (error: unknown) => {
        const cause = (error as { cause?: { code?: string; message?: string } }).cause
        assert.equal(cause?.code, '55000')
        assert.match(cause?.message ?? '', /task_extra_times rows are immutable/)
        return true
      })
    assert.equal((await stored(t.institution.id)).extra.length, 1)
  })
})
