import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { resourceVersions } from '../src/db/schema/resources.ts'
import { attemptMediaPlays, taskAssignments, taskAttempts } from '../src/db/schema/skills.ts'
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
import {
  LISTENING_TAGS,
  LISTENING_TRANSCRIPT,
  listeningAudio,
  linkVersionFile,
  listeningQuiz,
  seedListeningActivity,
  seedListeningFile,
} from './support/listening-sample.ts'
import { seedResource } from './support/resources-sample.ts'

/**
 * Dinleme etkinliği (OG-052; IST-045; DOM-BEC-005, DOM-KYN-003, DOM-KYN-051). Etkinlik dinleme
 * kaydına (`listeningVersionId`) bağlı quiz/alıştırma setidir; mevcut içerik, atama, deneme ve dosya
 * uçlarıyla çalışır. Burada bağın içerik yazma ve yayım uçlarında doğrulanması, atamada dinleme
 * hakkının yalnız sayılabilir kayıtta sınırlanması, dökümün kursiyere kural izin verince dönmesi,
 * kaydın dosyasının atamayla açılması ve kayıt kaldırılınca etkinliğin kapanması denetlenir. Hak
 * sayımının kendisi `listening-plays.test.ts`'tedir.
 */

type Json = ReturnType<typeof JSON.parse>

const DUE = '2026-10-20T20:59:00.000Z'
const AFTER_DUE = new Date(Date.parse(DUE) + 60_000)

describe('dinleme etkinliği', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  let now = FIXED_NOW

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    store = await tempStorage()
    app = await buildTestApp(db, { storage: store.storage, clock: () => now })
  })
  after(async () => {
    await app.close()
    await close()
    await store.remove()
  })

  /**
   * `t-eng` 9-A'nın İngilizce, `t-mat` 9-B'nin öğretmeni. Deniz (`s-1`) 9-A'da, Can (`s-3`) 9-B'de;
   * veli Deniz'in velisidir. Dinleme etkinliği (ses, dosya, soru, quiz) `t-eng`'de, yayında.
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
      ],
      FIXED_NOW,
    )
    const member = (role: 'ogretmen' | 'ogrenci' | 'veli', kind: string, recordId: string) =>
      createMember(app, institution.id, role, [{ kind, recordId } as never])
    const teacher = await member('ogretmen', 'teacher', 't-eng')
    const colleague = await member('ogretmen', 'teacher', 't-mat')
    const cookies = {
      admin: await signInAs(app, institution.admin),
      teacher: await signInAs(app, teacher),
      otherTeacher: await signInAs(app, colleague),
      student: await signInAs(app, await member('ogrenci', 'student', 's-1')),
      otherStudent: await signInAs(app, await member('ogrenci', 'student', 's-3')),
      parent: await signInAs(app, await member('veli', 'child', 's-1')),
      frontDesk: await signInAs(app, await createMember(app, institution.id, 'onburo')),
    }
    const activity = await seedListeningActivity(db, institution.id, { ownerUserId: teacher.id })
    return { institution, cookies, teacherId: teacher.id, colleagueId: colleague.id, activity }
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
    return response.json() as Json
  }

  const assignBody = (versionId: string, settings: Record<string, unknown> = {}) => ({
    resourceVersionId: versionId,
    settings: { deadline: { dueAt: DUE }, ...settings },
    targets: [{ kind: 'class', id: '9-A' }],
  })
  const createAssignment = (t: Tenant, body: unknown, cookie = t.cookies.teacher) =>
    call('POST', '/task-assignments', cookie, body, key())
  async function assign(t: Tenant, settings: Record<string, unknown> = {}) {
    const data = await ok(
      await createAssignment(t, assignBody(t.activity.quiz.versionId, settings)),
      201,
    )
    return data
  }
  const start = (assignmentId: string, cookie: string) =>
    call('POST', `/task-assignments/${assignmentId}/attempts`, cookie, {}, key())
  const detail = (id: string, cookie?: string) => call('GET', `/task-attempts/${id}`, cookie)
  const fileUrl = (t: Tenant, cookie?: string) =>
    call('GET', `/files/${t.activity.fileId}/url`, cookie)

  const assignmentRows = (institutionId: string) =>
    db
      .select({ id: taskAssignments.id, listeningPlays: taskAssignments.listeningPlays })
      .from(taskAssignments)
      .where(eq(taskAssignments.institutionId, institutionId))
  const versionRows = (institutionId: string) =>
    db
      .select({ id: resourceVersions.id, version: resourceVersions.version })
      .from(resourceVersions)
      .where(eq(resourceVersions.institutionId, institutionId))
      .orderBy(resourceVersions.id)
  const attemptRows = (institutionId: string) =>
    db
      .select({ id: taskAttempts.id, version: taskAttempts.version })
      .from(taskAttempts)
      .where(eq(taskAttempts.institutionId, institutionId))
  const playRows = (institutionId: string) =>
    db
      .select({ playNumber: attemptMediaPlays.playNumber })
      .from(attemptMediaPlays)
      .where(eq(attemptMediaPlays.institutionId, institutionId))

  const quizBody = (listeningVersionId: string, questionVersionId: string) => ({
    title: 'Dinleme etkinliği 2',
    ...listeningQuiz(questionVersionId, listeningVersionId),
  })

  test('IST-045, DOM-KYN-013: içerik yazma ucu dinleme kaydı bağını doğrular; olmayan, başka kurumun ve başkasının özel kaydı 422 listening_missing; hatada kayıt yok; başarı kalıcı', async () => {
    const t = await tenant()
    const question = t.activity.questionVersionId
    const post = (body: unknown, cookie: string | undefined = t.cookies.teacher) =>
      call('POST', '/resources', cookie, body)
    const other = await tenant()
    const colleagueAudio = await seedResource(db, t.institution.id, {
      ownerUserId: t.colleagueId,
      versions: [{ status: 'published', input: listeningAudio(randomUUID()) }],
    })
    const before = await versionRows(t.institution.id)
    const linked = quizBody(t.activity.audio.versionId, question)
    fails(await call('POST', '/resources', undefined, linked), 401, 'unauthenticated')
    fails(await post(linked, t.cookies.student), 403, 'forbidden')
    fails(
      await post({ ...linked, content: { ...linked.content, listeningVersionId: 42 } }),
      400,
      'validation_failed',
    )
    const missing = fails(await post(quizBody(randomUUID(), question)), 422, 'listening_missing')
    assert.deepEqual(missing.issues?.[0]?.path, ['content', 'listeningVersionId'])
    fails(await post(quizBody(other.activity.audio.versionId, question)), 422, 'listening_missing')
    fails(await post(quizBody(colleagueAudio.versions[0]!.id, question)), 422, 'listening_missing')
    assert.deepEqual(await versionRows(t.institution.id), before)
    assert.deepEqual(
      await versionRows(other.institution.id),
      await versionRows(other.institution.id),
    )

    const created = await ok(await post(quizBody(t.activity.audio.versionId, question)), 201)
    assert.equal(created.version.content.listeningVersionId, t.activity.audio.versionId)
    const read = await ok(
      await call(
        'GET',
        `/resources/${created.resource.id}/versions/${created.version.id}`,
        t.cookies.teacher,
      ),
    )
    assert.equal(read.version.content.listeningVersionId, t.activity.audio.versionId, 'bağ kalıcı')
  })

  test('DOM-BEC-005: dökümsüz (yalnız altyazılı), taslak, dinleme becerisi olmayan ya da ses olmayan kayda bağlı etkinlik onaya gönderilemez; kayıt değişmez', async () => {
    const t = await tenant()
    const seedAudio = async (
      status: 'published' | 'draft',
      transcript: string | null,
      primarySkill: 'listening' | 'reading' = 'listening',
    ) => {
      const fileId = randomUUID()
      const seeded = await seedResource(db, t.institution.id, {
        ownerUserId: t.teacherId,
        versions: [
          {
            status,
            input: {
              ...listeningAudio(fileId, transcript),
              tags: { ...LISTENING_TAGS, primarySkill },
            },
          },
        ],
      })
      await seedListeningFile(db, t.institution.id, {
        uploadedByUserId: t.teacherId,
        versionId: seeded.versions[0]!.id,
        fileId,
      })
      return seeded.versions[0]!.id
    }
    const cases: [string, string][] = [
      [await seedAudio('published', null), 'listening_transcript_required'],
      [await seedAudio('draft', LISTENING_TRANSCRIPT), 'listening_not_published'],
      [await seedAudio('published', LISTENING_TRANSCRIPT, 'reading'), 'listening_skill_required'],
      [t.activity.questionVersionId, 'listening_not_audio'],
    ]
    for (const [listeningVersionId, code] of cases) {
      const created = await ok(
        await call(
          'POST',
          '/resources',
          t.cookies.teacher,
          quizBody(listeningVersionId, t.activity.questionVersionId),
        ),
        201,
      )
      const before = await versionRows(t.institution.id)
      const rejected = fails(
        await call(
          'POST',
          `/resources/${created.resource.id}/versions/${created.version.id}/submit`,
          t.cookies.teacher,
          {},
        ),
        422,
        code,
      )
      assert.match(rejected.message, /./)
      assert.deepEqual(await versionRows(t.institution.id), before, code)
    }
    // Dökümü olan yayındaki kayda bağlı etkinlik onaya gider.
    const created = await ok(
      await call(
        'POST',
        '/resources',
        t.cookies.teacher,
        quizBody(t.activity.audio.versionId, t.activity.questionVersionId),
      ),
      201,
    )
    const submitted = await ok(
      await call(
        'POST',
        `/resources/${created.resource.id}/versions/${created.version.id}/submit`,
        t.cookies.teacher,
        {},
      ),
    )
    assert.notEqual(submitted.version.status, 'draft')
  })

  test('IST-045, DOM-BEC-005: kayda bağlı etkinlikte hak gönderilmezse 2, seçilirse 1 ya da sınırsız; kaydı olmayan ya da sayılamayan (material) kayıtta 1/2 hak 422 listening_plays_unavailable, gönderilmeyen hak sınırsız; hatada atama yazılmaz', async () => {
    const t = await tenant()
    fails(
      await call(
        'POST',
        '/task-assignments',
        undefined,
        assignBody(t.activity.quiz.versionId),
        key(),
      ),
      401,
      'unauthenticated',
    )
    fails(
      await createAssignment(t, assignBody(t.activity.quiz.versionId), t.cookies.student),
      403,
      'forbidden',
    )
    assert.equal((await assign(t)).listeningPlays, 2)

    for (const listeningPlays of [1, null] as const) {
      const u = await tenant()
      assert.equal((await assign(u, { listeningPlays })).listeningPlays, listeningPlays)
    }

    // Sesi `material` amaçlı yüklenmiş etkinlik: dosya dinleme kaydı değildir, hak sayılamaz.
    const m = await tenant()
    const material = await seedListeningActivity(db, m.institution.id, {
      ownerUserId: m.teacherId,
      purpose: 'material',
    })
    // Kaydı olmayan dinleme quiz'i: birincil beceri dinleme, ama bağ yok.
    const bare = await seedResource(db, m.institution.id, {
      ownerUserId: m.teacherId,
      versions: [{ status: 'published', input: listeningQuiz(m.activity.questionVersionId, null) }],
    })
    for (const versionId of [material.quiz.versionId, bare.versions[0]!.id]) {
      const before = await assignmentRows(m.institution.id)
      for (const listeningPlays of [1, 2]) {
        const rejected = fails(
          await createAssignment(m, assignBody(versionId, { listeningPlays })),
          422,
          'listening_plays_unavailable',
        )
        assert.deepEqual(rejected.issues?.[0]?.path, ['settings', 'listeningPlays'])
      }
      assert.deepEqual(await assignmentRows(m.institution.id), before)
      const unlimited = await ok(await createAssignment(m, assignBody(versionId)), 201)
      assert.equal(unlimited.listeningPlays, null)
      const [stored] = (await assignmentRows(m.institution.id)).filter(
        (row) => row.id === unlimited.id,
      )
      assert.equal(stored?.listeningPlays, null)
      // Aynı içeriğin açık ataması çakışmasın diye kapatılır.
      await db
        .update(taskAssignments)
        .set({ dueAt: new Date(FIXED_NOW.getTime() - 60_000) })
        .where(eq(taskAssignments.id, unlimited.id as string))
    }
  })

  test('DOM-BEC-005: deneme ayrıntısı kaydın dosyasını ve kalan hakkı verir; döküm kursiyer ve veliye görev kapanmadan dönmez, öğretmen ve yönetici hep görür; görev kapanınca kursiyer de görür', async () => {
    const t = await tenant()
    const assignment = await assign(t)
    const attempt = await ok(await start(assignment.id as string, t.cookies.student), 201)
    const recording = {
      versionId: t.activity.audio.versionId,
      title: "Tom's week",
      fileId: t.activity.fileId,
      cefrLevel: 'A2',
      attributions: [],
    }
    assert.deepEqual(attempt.listeningRecording, {
      ...recording,
      transcript: null,
      captionsVtt: null,
      transcriptShown: false,
    })
    assert.deepEqual(attempt.listening, {
      limit: 2,
      media: [{ fileId: t.activity.fileId, used: 0, remaining: 2 }],
    })
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const response = await detail(attempt.id, cookie)
      const data = await ok(response)
      assert.equal(data.listeningRecording.transcriptShown, false)
      assert.ok(!response.body.includes(LISTENING_TRANSCRIPT), 'döküm kursiyere sızmaz')
    }
    // Görev ayrıntısı ve listesi de dökümü taşımaz.
    for (const url of [`/task-assignments/${assignment.id}`, '/task-assignments']) {
      const response = await call('GET', url, t.cookies.student)
      assert.equal(response.statusCode, 200, response.body)
      assert.ok(!response.body.includes(LISTENING_TRANSCRIPT), url)
    }
    for (const cookie of [t.cookies.teacher, t.cookies.admin]) {
      const data = await ok(await detail(attempt.id, cookie))
      assert.deepEqual(data.listeningRecording, {
        ...recording,
        transcript: LISTENING_TRANSCRIPT,
        captionsVtt: null,
        transcriptShown: true,
      })
    }

    now = AFTER_DUE
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const data = await ok(await detail(attempt.id, cookie))
      assert.equal(data.listeningRecording.transcript, LISTENING_TRANSCRIPT)
      assert.equal(data.listeningRecording.transcriptShown, true)
    }
  })

  test('DOM-BEC-005: alıştırmada öğretmen dökümü açtıysa kursiyer denemede görür; değerlendirmede açılamaz (400)', async () => {
    const t = await tenant()
    const before = await assignmentRows(t.institution.id)
    fails(
      await createAssignment(t, assignBody(t.activity.quiz.versionId, { showTranscript: true })),
      400,
      'validation_failed',
    )
    assert.deepEqual(await assignmentRows(t.institution.id), before)
    const practice = await assign(t, { attempts: { kind: 'practice' }, showTranscript: true })
    const attempt = await ok(await start(practice.id as string, t.cookies.student), 201)
    assert.equal(attempt.listeningRecording.transcript, LISTENING_TRANSCRIPT)
    assert.equal(attempt.listeningRecording.transcriptShown, true)
  })

  test('IST-045, DOM-YTK-028: özel kaydın dosyası atanan kursiyere atamayla açılır; atanmamış sınıfın öğrencisi, ön büro ve başka kurum 404; oturumsuz 401; sayım yazılmaz', async () => {
    const t = await tenant()
    const assignment = await assign(t)
    fails(await fileUrl(t, t.cookies.student), 422, 'listening_attempt_required')
    await ok(await start(assignment.id as string, t.cookies.student), 201)
    fails(await fileUrl(t), 401, 'unauthenticated')
    const other = await tenant()
    for (const cookie of [
      t.cookies.otherStudent,
      t.cookies.frontDesk,
      other.cookies.student,
      other.cookies.admin,
    ])
      fails(await fileUrl(t, cookie), 404, 'not_found')
    assert.deepEqual(await playRows(t.institution.id), [])
    // Veli çocuğunun görevindeki kaydı dinler; sayılmaz.
    assert.equal((await ok(await fileUrl(t, t.cookies.parent))).listening, null)
    const counted = await ok(await fileUrl(t, t.cookies.student))
    assert.equal(counted.listening.counted, true)
    assert.equal((await playRows(t.institution.id)).length, 1)
  })

  test('IST-045, DOM-YTK-028: kapsam dışı veli (başka çocuğun velisi) ve atamayı görmeyen öğretmen kaydın dosyasını ve deneme ayrıntısını 404 alır; deneme kimliği verilse de; sayım yazılmaz', async () => {
    const t = await tenant()
    const assignment = await assign(t)
    const attempt = await ok(await start(assignment.id as string, t.cookies.student), 201)
    // Can (`s-3`, 9-B) velisi Deniz'in görevini görmez; `t-mat` görevi atamadı, 9-A'ya ders vermez.
    const otherParent = await signInAs(
      app,
      await createMember(app, t.institution.id, 'veli', [
        { kind: 'child', recordId: 's-3' } as never,
      ]),
    )
    for (const cookie of [otherParent, t.cookies.otherTeacher]) {
      fails(await fileUrl(t, cookie), 404, 'not_found')
      fails(
        await call('GET', `/files/${t.activity.fileId}/url?attemptId=${attempt.id}`, cookie),
        404,
        'not_found',
      )
      fails(await detail(attempt.id, cookie), 404, 'not_found')
    }
    assert.deepEqual(await playRows(t.institution.id), [])
    // Deniz'in velisi ve öğretmeni açar; sayılmaz.
    for (const cookie of [t.cookies.parent, t.cookies.teacher])
      assert.equal((await ok(await fileUrl(t, cookie))).listening, null)
    assert.deepEqual(await playRows(t.institution.id), [])
  })

  test('DOM-KYN-025, IST-045 (Sabah kararı 40): kayıt telif bildirimiyle askıya alınınca yeni deneme 422 content_unavailable; süren deneme kaydedilir ve teslim edilir; askıdaki kaydın dosyası süren denemeye de açılmaz, sayım yazılmaz', async () => {
    const t = await tenant()
    const assignment = await assign(t, { attempts: { kind: 'practice' } })
    const attempt = await ok(await start(assignment.id as string, t.cookies.student), 201)
    await ok(await fileUrl(t, t.cookies.student))
    await ok(
      await call(
        'POST',
        `/resources/${t.activity.audio.resourceId}/versions/${t.activity.audio.versionId}/report`,
        t.cookies.teacher,
        { reason: 'Telif ihlali şüphesi' },
        key(),
      ),
    )
    const before = await attemptRows(t.institution.id)
    fails(await start(assignment.id as string, t.cookies.student), 422, 'content_unavailable')
    assert.deepEqual(await attemptRows(t.institution.id), before)
    fails(await fileUrl(t, t.cookies.student), 404, 'not_found')
    fails(
      await call(
        'GET',
        `/files/${t.activity.fileId}/url?attemptId=${attempt.id}`,
        t.cookies.student,
      ),
      404,
      'not_found',
    )
    assert.equal((await playRows(t.institution.id)).length, 1, 'askıdaki kayıtta sayım yazılmaz')
    const answers = {
      [t.activity.questionVersionId]: { questionType: 'multiple_choice', optionId: 'b' },
    }
    const saved = await ok(
      await call(
        'PATCH',
        `/task-attempts/${attempt.id}`,
        t.cookies.student,
        { answers },
        { 'if-match': `"${attempt.rowVersion}"` },
      ),
    )
    const done = await ok(
      await call(
        'POST',
        `/task-attempts/${attempt.id}/submit`,
        t.cookies.student,
        { answers },
        { ...key(), 'if-match': `"${saved.rowVersion}"` },
      ),
    )
    assert.equal(done.status, 'submitted')
    assert.equal(done.result.earned, 1)
  })

  test('DOM-KYN-051, IST-045: atası kaldırılan kopya kaydın dosyası kopyayı bağlayan etkinliğin atamasıyla da açılmaz; süren denemede sayım yazılmaz', async () => {
    const t = await tenant()
    // Kopya ses atanın dosyasını taşır (DOM-KYN-006); etkinlik kopyayı bağlar.
    const copy = await seedResource(db, t.institution.id, {
      ownerUserId: t.teacherId,
      derivedFromVersionId: t.activity.audio.versionId,
      versions: [{ status: 'published', input: listeningAudio(t.activity.fileId) }],
    })
    const copyVersionId = copy.versions[0]!.id
    await linkVersionFile(db, t.institution.id, copyVersionId, t.activity.fileId)
    const quiz = await seedResource(db, t.institution.id, {
      ownerUserId: t.teacherId,
      versions: [
        {
          status: 'published',
          input: listeningQuiz(t.activity.questionVersionId, copyVersionId),
        },
      ],
    })
    const assignment = await ok(
      await createAssignment(t, assignBody(quiz.versions[0]!.id, { listeningPlays: 2 })),
      201,
    )
    const attempt = await ok(await start(assignment.id as string, t.cookies.student), 201)
    const counted = await ok(
      await call(
        'GET',
        `/files/${t.activity.fileId}/url?attemptId=${attempt.id}`,
        t.cookies.student,
      ),
    )
    assert.equal(counted.listening.attemptId, attempt.id)

    await ok(
      await call(
        'POST',
        `/resources/${t.activity.audio.resourceId}/remove`,
        t.cookies.admin,
        { reason: 'Telif bildirimi doğrulandı.' },
        key(),
      ),
    )
    now = new Date(FIXED_NOW.getTime() + 60 * 60_000)
    for (const cookie of [t.cookies.student, t.cookies.teacher, t.cookies.admin])
      fails(await fileUrl(t, cookie), 404, 'not_found')
    fails(
      await call(
        'GET',
        `/files/${t.activity.fileId}/url?attemptId=${attempt.id}`,
        t.cookies.student,
      ),
      404,
      'not_found',
    )
    assert.equal((await playRows(t.institution.id)).length, 1, 'kapalı kayıtta sayım yazılmaz')
  })

  test('DOM-KYN-051, DOM-KYN-025, IST-045: kayıt kaldırılınca etkinlik etkilenen içerik olur; yeni deneme 422 content_unavailable; süren denemenin ayrıntısı kaydı ve soruları göstermez, sayılmış dinleme görünür; dosya kursiyere kapanır; kayıt değişmez', async () => {
    const t = await tenant()
    const assignment = await assign(t, { attempts: { kind: 'practice' } })
    const attempt = await ok(await start(assignment.id as string, t.cookies.student), 201)
    await ok(await fileUrl(t, t.cookies.student))
    const removed = await ok(
      await call(
        'POST',
        `/resources/${t.activity.audio.resourceId}/remove`,
        t.cookies.admin,
        { reason: 'Telif bildirimi doğrulandı.' },
        key(),
      ),
    )
    assert.deepEqual(removed.affectedContainerVersionIds, [t.activity.quiz.versionId])
    const before = await attemptRows(t.institution.id)
    fails(await start(assignment.id as string, t.cookies.student), 422, 'content_unavailable')
    assert.deepEqual(await attemptRows(t.institution.id), before)
    for (const cookie of [t.cookies.student, t.cookies.teacher]) {
      const data = await ok(await detail(attempt.id, cookie))
      assert.equal(data.contentRemoved, true)
      assert.equal(data.listeningRecording, null)
      assert.deepEqual(data.questions, [])
      assert.deepEqual(data.listening, {
        limit: 2,
        media: [{ fileId: t.activity.fileId, used: 1, remaining: 1 }],
      })
    }
    fails(await fileUrl(t, t.cookies.student), 404, 'not_found')
    assert.equal((await playRows(t.institution.id)).length, 1, 'kapalı kayıtta sayım yazılmaz')
  })
})
