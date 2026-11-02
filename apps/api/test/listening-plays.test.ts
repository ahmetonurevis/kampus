import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import type { ResourceVersionInput } from '@kampus/school-core/content/resource.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { files } from '../src/db/schema/files.ts'
import { attemptMediaPlays } from '../src/db/schema/skills.ts'
import { insertMediaPlay } from '../src/db/skills.ts'
import { AppError } from '../src/errors.ts'
import { defineFileAttachment } from '../src/services/file-registry.ts'
import {
  LISTENING_REPLAY_WINDOW_MS,
  planListeningPlay,
  RESOURCE_VERSION_ATTACHMENT,
} from '../src/services/listening-plays.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { tempStorage } from './support/files-sample.ts'
import { seedResource } from './support/resources-sample.ts'

/**
 * Dinleme hakkı sayımı (OG-049; IST-045; ADR 0003 karar 6, ADR 0004 karar 6; DOM-BEC-005).
 * Hak `GET /files/:fileId/url` ile verilen imzalı bağlantıda, öğrencinin süren denemesinde sayılır.
 * İçerik sürümüne dosya bağlama işlemi (F4b4) henüz olmadığından dinleme kaydı satırı doğrudan
 * yazılır ve kayıt türünün okuma kuralı testte herkese açıktır; kapsamı deneme ve kurum sağlar.
 */

type Json = ReturnType<typeof JSON.parse>

defineFileAttachment(RESOURCE_VERSION_ATTACHMENT, {
  purposes: ['listening_audio'],
  canRead: async () => true,
})

const DUE = '2026-10-20T20:59:00.000Z'
const AFTER_DUE = Date.parse(DUE) - FIXED_NOW.getTime() + 60_000

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
  answerKey: {
    questionType: 'multiple_choice',
    correctOptionId: 'b',
    explanation: 'Pazar günleri okur.',
  },
  license: { kind: 'institution_original' },
  tags: { subjectId: 'ingilizce', gradeLevels: [9], primarySkill: 'listening', cefrLevel: 'A2' },
})

describe('dinleme hakkı sayımı', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  let now = FIXED_NOW
  const logs: string[] = []

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    store = await tempStorage()
    app = await buildTestApp(db, { storage: store.storage, clock: () => now, logs })
  })
  after(async () => {
    await app.close()
    await close()
    await store.remove()
  })

  const at = (offsetMs: number) => {
    now = new Date(FIXED_NOW.getTime() + offsetMs)
  }

  /** Deniz (`s-1`) 9-A'da, öğretmeni `t-eng`; veli Deniz'in velisi. Dinleme sorusu yayında. */
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
          collection: 'classes',
          id: '9-A',
          data: { id: '9-A', grade: 9, level: '9', branchId: 'b-1', teacherId: 't-eng' },
        },
        {
          collection: 'students',
          id: 's-1',
          data: { id: 's-1', name: 'Deniz Yılmaz', classId: '9-A', isActive: true },
        },
        {
          collection: 'assignments',
          id: 'as-1',
          data: { id: 'as-1', classId: '9-A', teacherId: 't-eng', subjectId: 'ingilizce' },
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
      student: await signInAs(app, await member('ogrenci', 'student', 's-1')),
      parent: await signInAs(app, await member('veli', 'child', 's-1')),
    }
    const { versions } = await seedResource(db, institution.id, {
      ownerUserId: teacher.id,
      versions: [{ status: 'published', input: listeningQuestion() }],
    })
    const versionId = versions[0]!.id
    const fileId = randomUUID()
    await db.insert(files).values({
      institutionId: institution.id,
      id: fileId,
      purpose: 'listening_audio',
      status: 'ready',
      storageKey: `${institution.id}/listening_audio/2026/10/${fileId}`,
      contentType: 'audio/mpeg',
      byteSize: 2048,
      sha256: 'b'.repeat(64),
      uploadedByUserId: teacher.id,
      attachedType: RESOURCE_VERSION_ATTACHMENT,
      attachedId: versionId,
      attachedAt: FIXED_NOW,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    return { institution, cookies, versionId, fileId }
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  function call(method: 'GET' | 'POST', url: string, cookie: string, payload?: unknown) {
    return app.inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  async function ok(response: Awaited<ReturnType<typeof call>>, status = 200) {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function fails(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
    assert.equal(response.statusCode, status, response.body)
    assert.equal(response.json().code, code, response.body)
    return response.json() as Json
  }

  async function assign(t: Tenant, settings: Record<string, unknown> = {}) {
    const data = await ok(
      await call('POST', '/task-assignments', t.cookies.teacher, {
        resourceVersionId: t.versionId,
        settings: { deadline: { dueAt: DUE }, ...settings },
        targets: [{ kind: 'class', id: '9-A' }],
      }),
      201,
    )
    return data.id as string
  }
  const start = async (t: Tenant, assignmentId: string) =>
    ok(await call('POST', `/task-assignments/${assignmentId}/attempts`, t.cookies.student, {}), 201)
  const url = (t: Tenant, cookie: string, fileId = t.fileId) =>
    call('GET', `/files/${fileId}/url`, cookie)
  const playsOf = async (institutionId: string) =>
    db
      .select({ attemptId: attemptMediaPlays.attemptId, playNumber: attemptMediaPlays.playNumber })
      .from(attemptMediaPlays)
      .where(eq(attemptMediaPlays.institutionId, institutionId))
      .orderBy(attemptMediaPlays.playNumber)

  test('IST-045, DOM-BEC-005: süren denemede bağlantı hakkı sayar; pencere içinde yeniden bağlantı sayılmaz ve bitiş aynı kalır; hak bitince 422 listening_plays_exhausted; deneme okumasında kalan hak', async () => {
    const t = await tenant()
    const assignmentId = await assign(t)
    const attempt = await start(t, assignmentId)
    assert.deepEqual(attempt.listening, {
      limit: 2,
      media: [{ fileId: t.fileId, used: 0, remaining: 2 }],
    })

    const first = await ok(await url(t, t.cookies.student))
    assert.deepEqual(first.listening, {
      attemptId: attempt.id,
      limit: 2,
      used: 1,
      remaining: 1,
      counted: true,
    })
    const expiresAt = new Date(FIXED_NOW.getTime() + LISTENING_REPLAY_WINDOW_MS).toISOString()
    assert.equal(first.expiresAt, expiresAt)

    // Sayfa yenileme: pencere içinde yeni bağlantı sayılmaz, bitiş ilk sayımın bitişidir.
    at(LISTENING_REPLAY_WINDOW_MS - 1000)
    const replay = await ok(await url(t, t.cookies.student))
    assert.equal(replay.listening.counted, false)
    assert.equal(replay.listening.used, 1)
    assert.equal(replay.expiresAt, expiresAt)
    assert.equal((await playsOf(t.institution.id)).length, 1)

    at(LISTENING_REPLAY_WINDOW_MS)
    const second = await ok(await url(t, t.cookies.student))
    assert.deepEqual([second.listening.used, second.listening.remaining], [2, 0])
    assert.equal(second.listening.counted, true)

    // Son dinlemenin penceresinde yeniden bağlantı hâlâ verilir, sonra hak biter.
    at(2 * LISTENING_REPLAY_WINDOW_MS - 1)
    assert.equal((await ok(await url(t, t.cookies.student))).listening.counted, false)
    at(2 * LISTENING_REPLAY_WINDOW_MS)
    const exhausted = fails(await url(t, t.cookies.student), 422, 'listening_plays_exhausted')
    assert.match(exhausted.message, /dinleme hakkı doldu/)
    assert.deepEqual(await playsOf(t.institution.id), [
      { attemptId: attempt.id, playNumber: 1 },
      { attemptId: attempt.id, playNumber: 2 },
    ])

    const detail = await ok(await call('GET', `/task-attempts/${attempt.id}`, t.cookies.student))
    assert.deepEqual(detail.listening, {
      limit: 2,
      media: [{ fileId: t.fileId, used: 2, remaining: 0 }],
    })
    // Öğretmen de aynı sayımı görür (dinleme sayısı teslimle kaydedilir).
    const staff = await ok(await call('GET', `/task-attempts/${attempt.id}`, t.cookies.teacher))
    assert.deepEqual(staff.listening, detail.listening)
    // Sayım logu yalnız sayım bilgisini taşır; dosya ve kursiyer kimliği yoktur.
    const events = logs.filter((line) => line.includes('listening.play'))
    assert.ok(events.length > 0)
    for (const secret of [t.fileId, 's-1', attempt.id])
      assert.ok(!events.join('\n').includes(secret), secret)
  })

  test('IST-045 (OG-049): eşzamanlı iki istek hakkı aşmaz; çift sayım tekil indeksle 409 listening_play_conflict', async () => {
    const t = await tenant()
    const assignmentId = await assign(t, { listeningPlays: 1 })
    const attempt = await start(t, assignmentId)
    const responses = await Promise.all([url(t, t.cookies.student), url(t, t.cookies.student)])
    const bodies = await Promise.all(responses.map((response) => ok(response)))
    assert.deepEqual(bodies.map((body) => body.listening.counted).sort(), [false, true])
    assert.equal(bodies[0].expiresAt, bodies[1].expiresAt)
    assert.equal((await playsOf(t.institution.id)).length, 1)
    at(LISTENING_REPLAY_WINDOW_MS)
    const late = await Promise.all([url(t, t.cookies.student), url(t, t.cookies.student)])
    for (const response of late) fails(response, 422, 'listening_plays_exhausted')
    assert.equal((await playsOf(t.institution.id)).length, 1)

    // Kilit atlanırsa veritabanı aynı sırayı ikinci kez yazmaz.
    await assert.rejects(
      db.transaction((tx) =>
        insertMediaPlay(tx, t.institution.id, {
          id: randomUUID(),
          attemptId: attempt.id,
          fileId: t.fileId,
          playNumber: 1,
          playedAt: now,
        }),
      ),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 409 &&
        error.code === 'listening_play_conflict',
    )
  })

  test('IST-045: öğretmen, yönetici ve veli bağlantısı sayılmaz; sınırsız atamada öğrenci de sayılmaz', async () => {
    const t = await tenant()
    const assignmentId = await assign(t)
    await start(t, assignmentId)
    for (const cookie of [t.cookies.teacher, t.cookies.admin, t.cookies.parent]) {
      const data = await ok(await url(t, cookie))
      assert.equal(data.listening, null)
    }
    assert.deepEqual(await playsOf(t.institution.id), [])

    const u = await tenant()
    const unlimited = await assign(u, { listeningPlays: null })
    const attempt = await start(u, unlimited)
    assert.equal(attempt.listening, null)
    for (let i = 0; i < 3; i++) {
      at(i * LISTENING_REPLAY_WINDOW_MS)
      assert.equal((await ok(await url(u, u.cookies.student))).listening, null)
    }
    assert.deepEqual(await playsOf(u.institution.id), [])
  })

  test('IST-045: süren deneme yokken açık görevde 422 listening_attempt_required; teslim edilmiş deneme sayılmaz; teslim kapanınca bağlantı sayılmadan verilir', async () => {
    const t = await tenant()
    const assignmentId = await assign(t)
    fails(await url(t, t.cookies.student), 422, 'listening_attempt_required')
    const attempt = await start(t, assignmentId)
    await ok(await url(t, t.cookies.student))
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/v1/task-attempts/${attempt.id}/submit`,
      headers: {
        origin: TEST_ORIGIN,
        cookie: t.cookies.student,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
        'if-match': `"${attempt.rowVersion}"`,
      },
      payload: JSON.stringify({}),
    })
    assert.equal(submitted.statusCode, 200, submitted.body)
    // Teslimden sonra pencere içinde de bağlantı verilmez ve sayılmaz.
    const blocked = fails(await url(t, t.cookies.student), 422, 'listening_attempt_required')
    assert.match(blocked.message, /önce görevi başlatın/)
    assert.equal((await playsOf(t.institution.id)).length, 1)

    at(AFTER_DUE)
    for (let i = 0; i < 3; i++) {
      const data = await ok(await url(t, t.cookies.student))
      assert.equal(data.listening, null)
    }
    assert.equal((await playsOf(t.institution.id)).length, 1)
    const detail = await ok(await call('GET', `/task-attempts/${attempt.id}`, t.cookies.student))
    assert.deepEqual(detail.listening.media, [{ fileId: t.fileId, used: 1, remaining: 1 }])
  })

  test('IST-002, IST-045: başka kurumun dinleme kaydı ve denemesi 404; sayım yazılmaz', async () => {
    const t = await tenant()
    const attempt = await start(t, await assign(t))
    const other = await tenant()
    const otherAttempt = await start(other, await assign(other))
    for (const cookie of [other.cookies.student, other.cookies.admin])
      fails(await url(t, cookie), 404, 'not_found')
    fails(
      await call('GET', `/task-attempts/${attempt.id}`, other.cookies.student),
      404,
      'not_found',
    )
    assert.deepEqual(await playsOf(t.institution.id), [])
    assert.deepEqual(await playsOf(other.institution.id), [])
    // Kendi kurumunda sayım kendi denemesine düşer.
    const own = await ok(await url(other, other.cookies.student))
    assert.equal(own.listening.attemptId, otherAttempt.id)
  })

  test('DOM-BEC-005: yeniden bağlantı penceresi son sayılan dinlemenin bağlantı ömrüdür (saf karar)', () => {
    const plays = [{ playNumber: 1, playedAt: FIXED_NOW.toISOString() }]
    const inWindow = new Date(FIXED_NOW.getTime() + LISTENING_REPLAY_WINDOW_MS - 1)
    assert.deepEqual(planListeningPlay({ limit: 1, plays, now: inWindow }), {
      kind: 'reuse',
      expiresAt: new Date(FIXED_NOW.getTime() + LISTENING_REPLAY_WINDOW_MS),
    })
    const outside = new Date(FIXED_NOW.getTime() + LISTENING_REPLAY_WINDOW_MS)
    assert.throws(
      () => planListeningPlay({ limit: 1, plays, now: outside }),
      (error: unknown) => error instanceof AppError && error.code === 'listening_plays_exhausted',
    )
    assert.deepEqual(planListeningPlay({ limit: 2, plays, now: outside }), {
      kind: 'count',
      playNumber: 2,
      expiresAt: new Date(outside.getTime() + LISTENING_REPLAY_WINDOW_MS),
    })
    assert.deepEqual(planListeningPlay({ limit: 1, plays: [], now: FIXED_NOW }), {
      kind: 'count',
      playNumber: 1,
      expiresAt: new Date(FIXED_NOW.getTime() + LISTENING_REPLAY_WINDOW_MS),
    })
  })
})
