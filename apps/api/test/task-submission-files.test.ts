import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { ResourceVersionInput } from '@kampus/school-core/content/resource.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { academicYears } from '../src/db/schema/academic-years.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { institutions } from '../src/db/schema/auth.ts'
import { files } from '../src/db/schema/files.ts'
import { records } from '../src/db/schema/records.ts'
import {
  rubricScores,
  rubrics,
  rubricVersions,
  submissionVersions,
} from '../src/db/schema/skills.ts'
import { filesPurgeExpiredJob } from '../src/jobs/files-purge-expired.ts'
import { recordFileCheck } from '../src/services/files.ts'
import { transcodeAudioFile } from '../src/services/media-transcode.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { MP3, multipart, PDF, png, tempStorage, uploadParts } from './support/files-sample.ts'
import { FakeTranscoder } from './support/media-sample.ts'
import { seedResource } from './support/resources-sample.ts'
import { sampleRubricData } from './support/skills-sample.ts'

/**
 * Beceri görevinde dosyalı (el yazısı) ve sesli (konuşma kaydı) teslim (OG-048; IST-051, IST-126;
 * ADR 0003 karar 5, 6, 9, 13; DOM-BEC-046, 050, 052, 053, 054). Dosya sürümle aynı transaction'da
 * sürüme bağlanır; ret hiçbir satırı değiştirmez. Konuşma kaydında rıza işlem anında yeniden
 * denetlenir, saklama sonu bağlanırken yazılır, erişim denetime düşer ve 18 yaşını doldurmuş
 * kursiyerin kaydı veliye açılmaz.
 */

type Json = ReturnType<typeof JSON.parse>

const DUE = '2026-10-20T20:59:00.000Z'
const FILE_NAME = 'Deniz-gizli-kayit.mp3'

const homework = (title: string): Partial<ResourceVersionInput> => ({
  title,
  content: {
    type: 'homework_template',
    instructions: 'Hafta sonunu anlat.',
    submissionKinds: ['text', 'file', 'audio'],
    criteria: 'Zaman ifadeleri ve akıcılık.',
    rubricId: null,
  },
  license: { kind: 'institution_original' },
  tags: { subjectId: 'ingilizce', gradeLevels: [9], primarySkill: 'writing', cefrLevel: 'A2' },
})

describe('beceri görevinde dosyalı ve sesli teslim', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  const logs: string[] = []
  // Puanlama ve itiraz testleri saati ilerletir; her test sonunda `FIXED_NOW`'a döner.
  let now = FIXED_NOW

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

  /**
   * `t-eng` 9-A'nın, `t-mat` 9-B'nin öğretmenidir. Deniz (`s-1`, 17 yaşında) 9-A'da, Can (`s-3`)
   * 9-B'de; veli Deniz'in velisidir. İki ayrı ödev şablonu (dosyalı ve sesli görev) ve yayında bir
   * rubrik sürümü vardır.
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
        ...['9-A', '9-B'].map((id, index) => ({
          collection: 'classes' as const,
          id,
          data: { id, grade: 9, level: '9', branchId: 'b-1', teacherId: ['t-eng', 't-mat'][index] },
        })),
        {
          collection: 'students',
          id: 's-1',
          data: {
            id: 's-1',
            name: 'Deniz Yılmaz',
            classId: '9-A',
            isActive: true,
            birthDate: '2009-10-07',
          },
        },
        {
          collection: 'students',
          id: 's-3',
          data: { id: 's-3', name: 'Can Arslan', classId: '9-B', isActive: true },
        },
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
      frontDesk: await signInAs(app, await createMember(app, institution.id, 'onburo')),
    }
    const seed = async (title: string) =>
      (
        await seedResource(db, institution.id, {
          ownerUserId: teacher.id,
          versions: [{ status: 'published', input: homework(title) }],
        })
      ).versions[0]!.id
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
      fileTaskId: await seed('El yazısı'),
      audioTaskId: await seed('Konuşma'),
      rubricVersionId,
    }
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  function call(
    method: 'GET' | 'POST',
    url: string,
    cookie: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
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

  async function assign(t: Tenant, kind: 'file' | 'audio') {
    const data = await ok(
      await call(
        'POST',
        '/task-assignments',
        t.cookies.teacher,
        {
          resourceVersionId: kind === 'file' ? t.fileTaskId : t.audioTaskId,
          settings: {
            deadline: { dueAt: DUE },
            submission: { submissionKind: kind, maxVersions: 3 },
            rubricVersionId: t.rubricVersionId,
          },
          targets: [{ kind: 'class', id: '9-A' }],
        },
        key(),
      ),
      201,
    )
    return data.id as string
  }

  /** Yükler; `ready` verilirse tarama sonucunu yazar, `durationMs` verilirse süreyi (ölçüm). */
  async function upload(
    t: Tenant,
    cookie: string,
    parts: ReturnType<typeof uploadParts>,
    options: { ready?: boolean; durationMs?: number } = {},
  ) {
    const body = multipart(parts)
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': body.contentType,
        'idempotency-key': randomUUID(),
      },
      payload: body.payload,
    })
    assert.equal(response.statusCode, 201, response.body)
    const id = response.json().data.id as string
    if (options.ready !== false)
      await recordFileCheck(db, store.storage, {
        institutionId: t.institution.id,
        fileId: id,
        outcome: 'ready',
        now: FIXED_NOW,
        log: app.log,
      })
    if (options.durationMs !== undefined)
      await db
        .update(files)
        .set({ durationMs: options.durationMs })
        .where(and(eq(files.institutionId, t.institution.id), eq(files.id, id)))
    return id
  }
  const recording = (t: Tenant, durationMs?: number) =>
    upload(
      t,
      t.cookies.student,
      uploadParts('speaking_recording', MP3, FILE_NAME, 'audio/mpeg'),
      durationMs === undefined ? {} : { durationMs },
    )

  /** Kurumun konuşma kaydı rıza metni ve velinin rızası (Deniz 18 yaş altı). */
  async function consent(t: Tenant) {
    const text = await ok(
      await call(
        'POST',
        '/privacy-notices',
        t.cookies.admin,
        {
          kind: 'consent_text',
          purpose: 'speaking_recording',
          title: 'Konuşma kaydı rızası',
          body: 'Ses kaydı yalnız değerlendirme için işlenir.',
        },
        key(),
      ),
      201,
    )
    const given = async () =>
      (
        await ok(
          await call(
            'POST',
            '/consents',
            t.cookies.parent,
            { purpose: 'speaking_recording', studentId: 's-1', textId: text.id, channel: 'web' },
            key(),
          ),
          201,
        )
      ).id as string
    return { given, consentId: await given() }
  }

  const submit = (
    assignmentId: string,
    cookie: string,
    payload: unknown,
    headers: Record<string, string> = key(),
  ) => call('POST', `/task-assignments/${assignmentId}/submissions`, cookie, payload, headers)
  const urlOf = (cookie: string, fileId: string) => call('GET', `/files/${fileId}/url`, cookie)

  async function fileRow(t: Tenant, id: string) {
    const [row] = await db
      .select()
      .from(files)
      .where(and(eq(files.institutionId, t.institution.id), eq(files.id, id)))
    assert.ok(row)
    return row
  }
  const versionRows = (t: Tenant) =>
    db
      .select()
      .from(submissionVersions)
      .where(eq(submissionVersions.institutionId, t.institution.id))

  test('DOM-BEC-046, OG-048: el yazısı teslimi dosyaları gönderim sırasıyla sürüme bağlar; aynı anahtar yeni sürüm açmaz; başkasının dosyası genel 404, hazır olmayan 422, bağlı dosya 409 ve ret satır değiştirmez', async () => {
    const t = await tenant()
    const assignmentId = await assign(t, 'file')
    const image = await upload(
      t,
      t.cookies.student,
      uploadParts('submission', png(), 'sayfa.png', 'image/png'),
    )
    const pdf = await upload(t, t.cookies.student, uploadParts('submission', PDF))

    const headers = key()
    const payload = { submissionKind: 'file', fileIds: [image, pdf] }
    const created = await ok(await submit(assignmentId, t.cookies.student, payload, headers), 201)
    assert.equal(created.versions.length, 1)
    assert.equal(created.versions[0].body, null)
    assert.deepEqual(
      created.versions[0].files.map((file: Json) => [file.id, file.purpose, file.status]),
      [
        [image, 'submission', 'ready'],
        [pdf, 'submission', 'ready'],
      ],
    )
    assert.equal(created.versions[0].files[1].contentType, 'application/pdf')
    assert.equal('originalName' in created.versions[0].files[0], false)

    const replay = await submit(assignmentId, t.cookies.student, payload, headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    const [version, ...rest] = await versionRows(t)
    assert.equal(rest.length, 0)
    assert.deepEqual(version?.fileIds, [image, pdf])
    for (const id of [image, pdf]) {
      const row = await fileRow(t, id)
      assert.equal(row.attachedType, 'task_submission_version')
      assert.equal(row.attachedId, version?.id)
      assert.equal(row.dataSubjectId, 's-1')
      // El yazısı dosyasının saklama süresi henüz yok (Açık soru 3).
      assert.equal(row.retentionUntil, null)
    }
    const detail = await ok(await call('GET', `/task-submissions/${created.id}`, t.cookies.teacher))
    assert.deepEqual(
      detail.versions[0].files.map((file: Json) => file.id),
      [image, pdf],
    )

    // Başkasının, olmayan, hazır olmayan ve zaten bağlı dosyası; hiçbiri yeni sürüm yazmaz.
    const foreign = await upload(t, t.cookies.otherStudent, uploadParts('submission', PDF))
    const pending = await upload(t, t.cookies.student, uploadParts('submission', PDF), {
      ready: false,
    })
    for (const [fileIds, status, code] of [
      [[foreign], 404, 'not_found'],
      [[randomUUID()], 404, 'not_found'],
      [[pending], 422, 'file_not_ready'],
      [[image], 409, 'file_already_attached'],
    ] as const)
      fails(
        await submit(assignmentId, t.cookies.student, { submissionKind: 'file', fileIds }),
        status,
        code,
      )
    assert.equal((await versionRows(t)).length, 1)
    for (const id of [foreign, pending]) assert.equal((await fileRow(t, id)).attachedId, null)
    // Sesli gövde dosyalı göreve uymaz.
    fails(
      await submit(assignmentId, t.cookies.student, {
        submissionKind: 'audio',
        recordingFileId: pending,
      }),
      422,
      'submission_kind_mismatch',
    )
  })

  test('DOM-BEC-050, DOM-BEC-052, DOM-BEC-054, DOM-YTK-059: sesli teslim işlem anında rıza ister (403, satır değişmez); geri çekmeyle imhaya işaretli kayıt yeni rızayla da 422; ölçülmemiş, boş ve sınırı aşan kayıt 422; kayıt sürüme bağlanır, veri sahibi ve saklama sonu yazılır', async () => {
    const t = await tenant()
    const assignmentId = await assign(t, 'audio')
    const { given, consentId } = await consent(t)
    const fileId = await recording(t)

    fails(
      await submit(assignmentId, t.cookies.student, {
        submissionKind: 'audio',
        recordingFileId: fileId,
      }),
      422,
      'recording_not_measured',
    )
    for (const [durationMs, code] of [
      [400, 'recording_empty'],
      [181_000, 'recording_too_long'],
    ] as const) {
      const id = await recording(t, durationMs)
      fails(
        await submit(assignmentId, t.cookies.student, {
          submissionKind: 'audio',
          recordingFileId: id,
        }),
        422,
        code,
      )
    }
    await db
      .update(files)
      .set({ durationMs: 42_000 })
      .where(and(eq(files.institutionId, t.institution.id), eq(files.id, fileId)))

    // Yüklemeden sonra geri çekilen rıza: teslim reddedilir, hiçbir satır değişmez. Geri çekme
    // yüklenmiş kayda erken imha işareti koyar; yeni rızayla yeni kayıt teslim edilir.
    await ok(await call('POST', `/consents/${consentId}/withdraw`, t.cookies.parent, {}, key()))
    const before = await fileRow(t, fileId)
    assert.equal(before.retentionUntil?.toISOString(), FIXED_NOW.toISOString())
    fails(
      await submit(assignmentId, t.cookies.student, {
        submissionKind: 'audio',
        recordingFileId: fileId,
      }),
      403,
      'consent_required',
    )
    assert.equal((await versionRows(t)).length, 0)
    assert.deepEqual(await fileRow(t, fileId), before)

    // DOM-YTK-059: yeni rızadan sonra da imhaya işaretli eski kayıt bağlanmaz (422, satır
    // değişmez); kursiyer yeniden kaydeder.
    await given()
    fails(
      await submit(assignmentId, t.cookies.student, {
        submissionKind: 'audio',
        recordingFileId: fileId,
      }),
      422,
      'file_unavailable',
    )
    assert.equal((await versionRows(t)).length, 0)
    assert.deepEqual(await fileRow(t, fileId), before)

    const recordingId = await recording(t, 42_000)
    const created = await ok(
      await submit(assignmentId, t.cookies.student, {
        submissionKind: 'audio',
        recordingFileId: recordingId,
      }),
      201,
    )
    assert.deepEqual(created.versions[0].files, [
      {
        id: recordingId,
        purpose: 'speaking_recording',
        contentType: 'audio/mpeg',
        byteSize: MP3.length,
        durationMs: 42_000,
        status: 'ready',
      },
    ])
    const [version] = await versionRows(t)
    const row = await fileRow(t, recordingId)
    assert.equal(row.attachedType, 'task_submission_version')
    assert.equal(row.attachedId, version?.id)
    assert.equal(row.dataSubjectId, 's-1')
    // Dönem sonu (ders yılı tanımı yok: 31 Ağustos 2027) puanlama/itiraz kapanışından geç;
    // + 6 ay, İstanbul gün sonu.
    assert.equal(row.retentionUntil?.toISOString(), '2028-02-29T20:59:59.999Z')
    // Konuşma hakkı varsayılan 1: ikinci kayıt reddedilir.
    fails(
      await submit(assignmentId, t.cookies.student, {
        submissionKind: 'audio',
        recordingFileId: await recording(t, 30_000),
      }),
      422,
      'version_limit_reached',
    )
  })

  test('OG-262, DOM-BEC-054: gerçek yükleme yolunda kayıt dönüşüm işinden geçince ölçülür; sesli teslim recording_not_measured almaz, sürüm dönüşmüş kaydı ve yükleme anını taşır', async () => {
    const t = await tenant()
    const assignmentId = await assign(t, 'audio')
    await consent(t)
    // Tarama sonucu yazılmaz: dosya yalnız dönüşüm işiyle hazır olur.
    const fileId = await upload(
      t,
      t.cookies.student,
      uploadParts('speaking_recording', MP3, FILE_NAME, 'audio/mpeg'),
      { ready: false },
    )
    const uploaded = await fileRow(t, fileId)
    assert.equal(uploaded.status, 'processing')
    // İşlenirken süre yoktur: teslim "Kayıt henüz işleniyor" ile reddedilir, satır değişmez.
    fails(
      await submit(assignmentId, t.cookies.student, {
        submissionKind: 'audio',
        recordingFileId: fileId,
      }),
      422,
      'recording_not_measured',
    )
    assert.deepEqual(await fileRow(t, fileId), uploaded)
    const transcoded = await transcodeAudioFile(
      { db, storage: store.storage, transcoder: app.media.transcoder, log: app.log },
      { institutionId: t.institution.id, fileId },
      FIXED_NOW,
    )
    assert.equal(transcoded.outcome, 'ready')
    // Konuşma kaydı ~64 kbps'e çevrilir (dinleme ~96 kbps).
    assert.ok(app.media.transcoder instanceof FakeTranscoder)
    assert.equal(app.media.transcoder.calls.at(-1)?.bitrateKbps, 64)
    const created = await ok(
      await submit(assignmentId, t.cookies.student, {
        submissionKind: 'audio',
        recordingFileId: fileId,
      }),
      201,
    )
    const [file] = created.versions[0].files
    assert.equal(file.id, fileId)
    assert.equal(file.status, 'ready')
    assert.equal(file.contentType, 'audio/mp4')
    assert.equal(file.durationMs, 30_000)
    const row = await fileRow(t, fileId)
    assert.equal(row.attachedType, 'task_submission_version')
    assert.equal(row.createdAt.toISOString(), uploaded.createdAt.toISOString())
    assert.equal(await store.storage.head(uploaded.storageKey), null)
  })

  test('DOM-BEC-053, DOM-YTK-052: kaydı öğrenci, 18 yaş altı velisi, atamayı gören öğretmen ve yönetici açar; başka öğrenci/öğretmen, ön büro ve başka kurum 404; erişim denetime düşer, logda ad yok; 18 yaşını dolduran kursiyerin kaydı veliye kapanır; modül kapalıyken 403', async () => {
    const t = await tenant()
    const other = await tenant()
    const audioTask = await assign(t, 'audio')
    const fileTask = await assign(t, 'file')
    await consent(t)
    const audioId = await recording(t, 42_000)
    await ok(
      await submit(audioTask, t.cookies.student, {
        submissionKind: 'audio',
        recordingFileId: audioId,
      }),
      201,
    )
    const imageId = await upload(
      t,
      t.cookies.student,
      uploadParts('submission', png(), 'a.png', 'image/png'),
    )
    await ok(
      await submit(fileTask, t.cookies.student, { submissionKind: 'file', fileIds: [imageId] }),
      201,
    )

    const readers = [t.cookies.student, t.cookies.parent, t.cookies.teacher, t.cookies.admin]
    for (const cookie of readers) {
      const data = await ok(await urlOf(cookie, audioId))
      assert.equal(typeof data.url, 'string')
      // Konuşma kaydının bağlantısı 2 dk yaşar.
      assert.equal(data.expiresAt, new Date(FIXED_NOW.getTime() + 120_000).toISOString())
    }
    for (const cookie of [
      t.cookies.otherStudent,
      t.cookies.otherTeacher,
      t.cookies.frontDesk,
      other.cookies.admin,
      other.cookies.student,
    ])
      for (const id of [audioId, imageId]) fails(await urlOf(cookie, id), 404, 'not_found')

    const accesses = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.institution.id), eq(auditLog.action, 'file.access')))
    assert.equal(accesses.length, readers.length)
    assert.ok(accesses.every((row) => row.entityId === audioId))
    assert.equal(JSON.stringify(accesses).includes(FILE_NAME), false)
    assert.equal(
      logs.some((line) => line.includes(FILE_NAME) || line.includes('Deniz')),
      false,
    )

    // Deniz 18 yaşını doldurdu: kaydı veliye kapanır; el yazısı teslimi açık kalır.
    await db
      .update(records)
      .set({
        data: {
          id: 's-1',
          name: 'Deniz Yılmaz',
          classId: '9-A',
          isActive: true,
          birthDate: '2008-01-01',
        },
      })
      .where(
        and(
          eq(records.institutionId, t.institution.id),
          eq(records.collection, 'students'),
          eq(records.id, 's-1'),
        ),
      )
    fails(await urlOf(t.cookies.parent, audioId), 404, 'not_found')
    await ok(await urlOf(t.cookies.parent, imageId))
    await ok(await urlOf(t.cookies.student, audioId))

    await db
      .update(institutions)
      .set({ enabledModules: { learning: false } })
      .where(eq(institutions.id, t.institution.id))
    fails(await urlOf(t.cookies.student, audioId), 403, 'module_disabled')
    fails(await urlOf(t.cookies.otherStudent, audioId), 404, 'not_found')
  })

  // --- Puanlama, itiraz ve saklama sonu ---------------------------------------------------

  const SCORE = {
    versionNumber: 1,
    criteria: [
      { criterionId: 'task', band: 4, comment: null },
      { criterionId: 'grammar', band: 2, comment: 'Zaman uyumuna dikkat.' },
    ],
    overallComment: 'Akıcı bir anlatım.',
  }
  const DISAGREEING = {
    ...SCORE,
    criteria: [
      { criterionId: 'task', band: 1, comment: 'Görev eksik kaldı.' },
      { criterionId: 'grammar', band: 2, comment: 'Zaman hataları var.' },
    ],
  }
  const rowVersionOf = async (cookie: string, submissionId: string) =>
    (await ok(await call('GET', `/task-submissions/${submissionId}`, cookie))).rowVersion as number
  /** `If-Match` teslimin güncel `rowVersion`'ı (okuyan personelle). */
  const write = async (
    path: string,
    cookie: string,
    submissionId: string,
    payload: unknown,
    reader = cookie,
  ) =>
    call('POST', `/task-submissions/${submissionId}/${path}`, cookie, payload, {
      'if-match': `"${await rowVersionOf(reader, submissionId)}"`,
      ...key(),
    })
  const at = (iso: string) => {
    now = new Date(iso)
  }
  const purge = (t: Tenant, on: string) =>
    filesPurgeExpiredJob.run(
      { db, storage: store.storage, log: app.log },
      { institutionId: t.institution.id },
      new Date(on),
    )

  /** Rızalı sesli teslim; teslim kimliği ve kayıt dosyası. */
  async function spoken(t: Tenant, assignmentId: string) {
    const recordingId = await recording(t, 42_000)
    const created = await ok(
      await submit(assignmentId, t.cookies.student, {
        submissionKind: 'audio',
        recordingFileId: recordingId,
      }),
      201,
    )
    return { submissionId: created.id as string, recordingId }
  }

  test('DOM-BEC-052, DOM-BEC-025: geç puanlama, itiraz açılışı ve kararı konuşma kaydının saklama sonunu ileri alır; açık itirazlı kayıt imha edilmez, karardan sonraki saklama sonunda edilir', async () => {
    const t = await tenant()
    // Ders yılı 10 Ekim'de biter: saklama puanlama ve itiraz kapanışından başlar.
    await db
      .update(academicYears)
      .set({ startDate: '2026-01-01', endDate: '2026-10-10' })
      .where(
        and(eq(academicYears.institutionId, t.institution.id), eq(academicYears.startYear, 2026)),
      )
    const colleague = await signInAs(
      app,
      await createMember(app, t.institution.id, 'ogretmen', [
        { kind: 'teacher', recordId: 't-eng' } as never,
      ]),
    )
    const assignmentId = await assign(t, 'audio')
    await consent(t)
    const { submissionId, recordingId } = await spoken(t, assignmentId)
    const retention = async () => (await fileRow(t, recordingId)).retentionUntil?.toISOString()
    try {
      // Bağlamada beklenen takvim: son teslim 20 Ekim + 7 gün puanlama (27 Ekim), 5 iş günü itiraz
      // (3 Kasım) + 6 ay.
      assert.equal(await retention(), '2027-05-03T20:59:59.999Z')

      // Geç puanlama: sonuç 1 Aralık Salı duyurulur, itiraz 8 Aralık'ta kapanır.
      at('2026-12-01T10:00:00.000Z')
      await ok(await write('scores', t.cookies.teacher, submissionId, SCORE), 201)
      assert.equal(await retention(), '2027-06-08T20:59:59.999Z')

      // İtiraz 3 Aralık'ta açılır: karar süresi açılıştan 5 iş günü (10 Aralık) varsayılır.
      at('2026-12-03T10:00:00.000Z')
      const filed = await ok(
        await call(
          'POST',
          `/task-submissions/${submissionId}/appeals`,
          t.cookies.student,
          { versionNumber: 1, reason: 'Kriterler yeniden okunmalı.' },
          key(),
        ),
        201,
      )
      assert.equal(await retention(), '2027-06-10T20:59:59.999Z')

      // Karar gecikse de açık itirazlı kayıt imha edilmez.
      assert.deepEqual(await purge(t, '2027-07-01T00:00:00.000Z'), {
        purged: 0,
        held: 1,
        rounds: 1,
      })
      assert.equal((await fileRow(t, recordingId)).status, 'ready')

      // Karar 10 Ocak'ta: saklama karardan 6 ay sonra biter.
      at('2027-01-10T10:00:00.000Z')
      await ok(
        await write(
          `appeals/${filed.versions[0].appeal.id}/decision`,
          colleague,
          submissionId,
          { outcome: 'rejected', reason: 'Puan kriterlerle uyumlu.' },
          t.cookies.teacher,
        ),
      )
      assert.equal(await retention(), '2027-07-10T20:59:59.999Z')
      assert.deepEqual(await purge(t, '2027-07-10T20:00:00.000Z'), {
        purged: 0,
        held: 0,
        rounds: 1,
      })
      assert.deepEqual(await purge(t, '2027-07-11T00:00:00.000Z'), {
        purged: 1,
        held: 0,
        rounds: 1,
      })
      assert.equal((await fileRow(t, recordingId)).status, 'deleted')
    } finally {
      now = FIXED_NOW
    }
  })

  test('DOM-BEC-052, DOM-YTK-059: puanlanmamış teslimin saklama sonu gelmiş kaydı imha edilmez; veri sahibi rızasını geri çekince edilir (erken silme itiraz hakkını kaldırır)', async () => {
    const t = await tenant()
    const assignmentId = await assign(t, 'audio')
    const { consentId } = await consent(t)
    const { recordingId } = await spoken(t, assignmentId)
    const after = '2028-03-01T00:00:00.000Z'
    assert.ok(Date.parse(after) > ((await fileRow(t, recordingId)).retentionUntil?.getTime() ?? 0))

    assert.deepEqual(await purge(t, after), { purged: 0, held: 1, rounds: 1 })
    assert.equal((await fileRow(t, recordingId)).status, 'ready')

    await ok(await call('POST', `/consents/${consentId}/withdraw`, t.cookies.parent, {}, key()))
    assert.deepEqual(await purge(t, after), { purged: 1, held: 0, rounds: 1 })
    assert.equal((await fileRow(t, recordingId)).status, 'deleted')
  })

  test('DOM-BEC-053, DOM-YTK-027: atamayı görmeyen koordinatör yalnız uyuşmazlıklı teslimin kaydını dinler; puansız ve ikinci puan bekleyen teslimin kaydı 404', async () => {
    const t = await tenant()
    await insertMissingRecords(
      db,
      t.institution.id,
      [
        {
          collection: 'teachers',
          id: 't-head',
          data: { id: 't-head', name: 'Zeynep Ak', subjectId: 'ingilizce', branchId: 'b-1' },
        },
      ],
      FIXED_NOW,
    )
    const head = await createMember(app, t.institution.id, 'ogretmen', [
      { kind: 'teacher', recordId: 't-head' } as never,
    ])
    const headCookie = await signInAs(app, head)
    const colleague = await signInAs(
      app,
      await createMember(app, t.institution.id, 'ogretmen', [
        { kind: 'teacher', recordId: 't-eng' } as never,
      ]),
    )
    await ok(
      await call(
        'POST',
        '/coordinator-duties',
        t.cookies.admin,
        { membershipId: head.membershipId, scopeId: 'ingilizce' },
        key(),
      ),
      201,
    )
    await consent(t)
    const { submissionId, recordingId } = await spoken(t, await assign(t, 'audio'))
    try {
      // Uyuşmazlık yokken (puansız, ikinci puan bekleyen) koordinatör kaydı göremez.
      fails(await urlOf(headCookie, recordingId), 404, 'not_found')
      at('2026-10-21T09:00:00.000Z')
      await ok(
        await write('second-rating-requests', t.cookies.admin, submissionId, {
          versionNumber: 1,
        }),
        201,
      )
      await ok(await write('scores', t.cookies.teacher, submissionId, SCORE), 201)
      fails(await urlOf(headCookie, recordingId), 404, 'not_found')
      // İkinci puan uyuşmaz: kayıt koordinatöre açılır, erişim denetime düşer.
      await ok(
        await write('second-scores', colleague, submissionId, DISAGREEING, t.cookies.admin),
        201,
      )
      await ok(await urlOf(headCookie, recordingId))
      const [access] = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.institutionId, t.institution.id),
            eq(auditLog.action, 'file.access'),
            eq(auditLog.actorUserId, head.id),
          ),
        )
      assert.equal(access?.entityId, recordingId)
    } finally {
      now = FIXED_NOW
    }
  })
  // --- Sesli geri bildirim (DOM-BEC-056) -------------------------------------------------------

  /** Öğretmenin yüklediği sesli geri bildirim; `ready: false` işlenmekte kalır. */
  const feedbackAudio = (t: Tenant, cookie = t.cookies.teacher, ready = true) =>
    upload(t, cookie, uploadParts('feedback_audio', MP3, 'Selin-geri-bildirim.mp3', 'audio/mpeg'), {
      ready,
      ...(ready ? { durationMs: 20_000 } : {}),
    })
  const scoreRows = (t: Tenant) =>
    db.select().from(rubricScores).where(eq(rubricScores.institutionId, t.institution.id))

  test('DOM-BEC-056: sesli geri bildirim puanla aynı işlemde puana bağlanır; geçersiz kimlik 400, başkasının dosyası, başka amaç ve hazır olmayan dosya 422, ret hiçbir satırı değiştirmez; aynı anahtar ikinci puan açmaz', async () => {
    const t = await tenant()
    const other = await tenant()
    await consent(t)
    const { submissionId, recordingId } = await spoken(t, await assign(t, 'audio'))
    const audioId = await feedbackAudio(t)
    const pending = await feedbackAudio(t, t.cookies.teacher, false)
    const foreign = await feedbackAudio(other, other.cookies.teacher)
    const material = await upload(
      t,
      t.cookies.teacher,
      uploadParts('material', MP3, 'dinleme.mp3', 'audio/mpeg'),
    )

    fails(
      await write('scores', t.cookies.teacher, submissionId, {
        ...SCORE,
        feedbackAudioFileId: 'ses.mp3',
      }),
      400,
      'validation_failed',
    )
    for (const [fileId, status, code] of [
      [recordingId, 422, 'file_unavailable'],
      [foreign, 422, 'file_unavailable'],
      [material, 422, 'file_purpose_mismatch'],
      [pending, 422, 'file_not_ready'],
    ] as const) {
      // Öğrencinin kaydı ve başka kurumun sesi puanlayanın değildir: varlığı sızmaz.
      fails(
        await write('scores', t.cookies.teacher, submissionId, {
          ...SCORE,
          feedbackAudioFileId: fileId,
        }),
        status,
        code,
      )
    }
    assert.equal((await scoreRows(t)).length, 0)
    assert.equal((await fileRow(t, audioId)).attachedId, null)

    const headers = {
      'if-match': `"${await rowVersionOf(t.cookies.teacher, submissionId)}"`,
      ...key(),
    }
    const payload = { ...SCORE, feedbackAudioFileId: audioId }
    const path = `/task-submissions/${submissionId}/scores`
    const created = await ok(await call('POST', path, t.cookies.teacher, payload, headers), 201)
    const score = created.versions[0].score
    assert.equal(score.feedbackAudio.id, audioId)
    assert.equal(score.feedbackAudio.durationMs, 20_000)
    assert.equal(score.feedbackAudio.status, 'ready')
    assert.equal('purpose' in score.feedbackAudio, false)
    const replay = await ok(await call('POST', path, t.cookies.teacher, payload, headers), 201)
    assert.deepEqual(replay, created)
    const [row] = await scoreRows(t)
    assert.equal((await scoreRows(t)).length, 1)
    const attached = await fileRow(t, audioId)
    assert.equal(attached.attachedType, 'task_rubric_score')
    assert.equal(attached.attachedId, row?.id)
    assert.equal(
      JSON.stringify(
        await db.select().from(auditLog).where(eq(auditLog.institutionId, t.institution.id)),
      ).includes('Selin-geri-bildirim'),
      false,
    )
  })

  test('DOM-BEC-056, DOM-BEC-045, DOM-BEC-024: sesli geri bildirimi puanı gören dinler; puanlayan hemen, kursiyer, veli ve yönetici puan kesinleşip geri bildirim açılınca; ikinci puanlayıcı ilk puanın sesini duymaz; başka öğrenci, ilgisiz öğretmen, ön büro ve başka kurum 404; 18 yaşını dolduran kursiyerin velisi de dinler', async () => {
    const t = await tenant()
    const other = await tenant()
    const colleague = await signInAs(
      app,
      await createMember(app, t.institution.id, 'ogretmen', [
        { kind: 'teacher', recordId: 't-eng' } as never,
      ]),
    )
    await consent(t)
    const { submissionId } = await spoken(t, await assign(t, 'audio'))
    const audioId = await feedbackAudio(t)
    try {
      at('2026-10-21T09:00:00.000Z')
      await ok(
        await write('second-rating-requests', t.cookies.admin, submissionId, {
          versionNumber: 1,
        }),
        201,
      )
      await ok(
        await write('scores', t.cookies.teacher, submissionId, {
          ...SCORE,
          feedbackAudioFileId: audioId,
        }),
        201,
      )
      // İkinci puan bekleniyor: puan kesinleşmedi. Yalnız puanlayan dinler; yönetici koordinatör
      // değildir ve kör puanlamada ilk puanı görmez (DOM-BEC-024), sesi de duymaz.
      await ok(await urlOf(t.cookies.teacher, audioId))
      const pending = await ok(
        await call('GET', `/task-submissions/${submissionId}`, t.cookies.admin),
      )
      assert.equal(JSON.stringify(pending).includes(audioId), false)
      for (const cookie of [
        t.cookies.admin,
        t.cookies.student,
        t.cookies.parent,
        colleague,
        t.cookies.otherStudent,
        t.cookies.otherTeacher,
        t.cookies.frontDesk,
        other.cookies.admin,
        other.cookies.teacher,
      ])
        fails(await urlOf(cookie, audioId), 404, 'not_found')
      const own = await ok(
        await call('GET', `/task-submissions/${submissionId}`, t.cookies.student),
      )
      assert.equal(own.versions[0].score, null)
      const blind = await ok(await call('GET', `/task-submissions/${submissionId}`, colleague))
      assert.equal(JSON.stringify(blind).includes(audioId), false)

      // Uyuşan ikinci puan sonucu kesinleştirir: geri bildirim ve ses kursiyere ve veliye açılır.
      await ok(await write('second-scores', colleague, submissionId, SCORE, t.cookies.admin), 201)
      for (const cookie of [t.cookies.student, t.cookies.parent, t.cookies.admin]) {
        const data = await ok(await urlOf(cookie, audioId))
        assert.equal(data.expiresAt, new Date(now.getTime() + 120_000).toISOString())
        const detail = await ok(await call('GET', `/task-submissions/${submissionId}`, cookie))
        assert.equal(detail.versions[0].score.feedbackAudio.id, audioId)
      }
      for (const cookie of [
        t.cookies.otherStudent,
        t.cookies.otherTeacher,
        t.cookies.frontDesk,
        other.cookies.admin,
      ])
        fails(await urlOf(cookie, audioId), 404, 'not_found')

      // Ses öğretmenindir: 18 yaşını dolduran kursiyerin velisi yazılı geri bildirim gibi dinler.
      await db
        .update(records)
        .set({
          data: {
            id: 's-1',
            name: 'Deniz Yılmaz',
            classId: '9-A',
            isActive: true,
            birthDate: '2008-01-01',
          },
        })
        .where(
          and(
            eq(records.institutionId, t.institution.id),
            eq(records.collection, 'students'),
            eq(records.id, 's-1'),
          ),
        )
      await ok(await urlOf(t.cookies.parent, audioId))
      const accesses = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.institutionId, t.institution.id),
            eq(auditLog.action, 'file.access'),
            eq(auditLog.entityId, audioId),
          ),
        )
      assert.equal(accesses.length, 5)
    } finally {
      now = FIXED_NOW
    }
  })
  // --- Sesli geri bildirim: ikinci ve son puan, kör puanlama, bağlama, yetki, saklama ----------

  /** Aynı kadrodan ikinci öğretmen ve atamayı görmeyen zümre başkanı (koordinatör görevli). */
  async function raters(t: Tenant) {
    await insertMissingRecords(
      db,
      t.institution.id,
      [
        {
          collection: 'teachers',
          id: 't-head',
          data: { id: 't-head', name: 'Zeynep Ak', subjectId: 'ingilizce', branchId: 'b-1' },
        },
      ],
      FIXED_NOW,
    )
    const head = await createMember(app, t.institution.id, 'ogretmen', [
      { kind: 'teacher', recordId: 't-head' } as never,
    ])
    const colleague = await signInAs(
      app,
      await createMember(app, t.institution.id, 'ogretmen', [
        { kind: 'teacher', recordId: 't-eng' } as never,
      ]),
    )
    await ok(
      await call(
        'POST',
        '/coordinator-duties',
        t.cookies.admin,
        { membershipId: head.membershipId, scopeId: 'ingilizce' },
        key(),
      ),
      201,
    )
    return { colleague, head: await signInAs(app, head) }
  }
  const requestSecondRating = async (t: Tenant, submissionId: string) =>
    ok(
      await write('second-rating-requests', t.cookies.admin, submissionId, { versionNumber: 1 }),
      201,
    )
  const withAudio = (feedbackAudioFileId: string, body: object = SCORE) => ({
    ...body,
    feedbackAudioFileId,
  })

  test('DOM-BEC-056, DOM-BEC-024: ikinci puan sesli geri bildirimi puanla aynı işlemde bağlar; geri bildirim açılınca kursiyer dinler', async () => {
    const t = await tenant()
    const { colleague } = await raters(t)
    await consent(t)
    const { submissionId } = await spoken(t, await assign(t, 'audio'))
    const firstAudio = await feedbackAudio(t)
    try {
      at('2026-10-21T09:00:00.000Z')
      await requestSecondRating(t, submissionId)
      await ok(await write('scores', t.cookies.teacher, submissionId, withAudio(firstAudio)), 201)
      // İkinci puanlayıcı kendi dosyasını yükler: öğretmenin dosyası ona ait değildir (422).
      fails(
        await write(
          'second-scores',
          colleague,
          submissionId,
          withAudio(firstAudio),
          t.cookies.admin,
        ),
        422,
        'file_unavailable',
      )
      const own = await upload(
        t,
        colleague,
        uploadParts('feedback_audio', MP3, 'Meral-geri-bildirim.mp3', 'audio/mpeg'),
        { durationMs: 15_000 },
      )
      const created = await ok(
        await write('second-scores', colleague, submissionId, withAudio(own), t.cookies.admin),
        201,
      )
      const scores = await scoreRows(t)
      assert.equal(scores.length, 2)
      const secondRow = scores.find((row) => row.raterRole === 'second')
      const attached = await fileRow(t, own)
      assert.equal(attached.attachedType, 'task_rubric_score')
      assert.equal(attached.attachedId, secondRow?.id)
      assert.equal(attached.dataSubjectId, 's-1')
      assert.equal(JSON.stringify(created).includes(own), true)
      // Uyuşan ikinci puan geri bildirimi açar: kursiyer ilk puanın sesini dinler.
      await ok(await urlOf(t.cookies.student, firstAudio))
    } finally {
      now = FIXED_NOW
    }
  })

  test('DOM-BEC-056, DOM-BEC-024, DOM-YTK-027: son puan sesli geri bildirimi puanla aynı işlemde bağlar ve kesinleşen sonucu kursiyere açar; geçersiz dosya puanı yazdırmaz', async () => {
    const t = await tenant()
    const { colleague, head } = await raters(t)
    await consent(t)
    const { submissionId } = await spoken(t, await assign(t, 'audio'))
    const finalAudio = await upload(
      t,
      head,
      uploadParts('feedback_audio', MP3, 'Zeynep-geri-bildirim.mp3', 'audio/mpeg'),
      { durationMs: 12_000 },
    )
    try {
      at('2026-10-21T09:00:00.000Z')
      await requestSecondRating(t, submissionId)
      await ok(await write('scores', t.cookies.teacher, submissionId, SCORE), 201)
      await ok(
        await write('second-scores', colleague, submissionId, DISAGREEING, t.cookies.admin),
        201,
      )
      // Koordinatörün kendi olmayan (öğretmenin) sesi ve hazır olmayan ses puan yazdırmaz.
      const foreign = await feedbackAudio(t)
      const before = (await scoreRows(t)).length
      fails(
        await write('final-scores', head, submissionId, withAudio(foreign), head),
        422,
        'file_unavailable',
      )
      assert.equal((await scoreRows(t)).length, before)

      const created = await ok(
        await write('final-scores', head, submissionId, withAudio(finalAudio), head),
        201,
      )
      assert.equal(JSON.stringify(created).includes(finalAudio), true)
      const finalRow = (await scoreRows(t)).find((row) => row.raterRole === 'final')
      const attached = await fileRow(t, finalAudio)
      assert.equal(attached.attachedType, 'task_rubric_score')
      assert.equal(attached.attachedId, finalRow?.id)
      assert.equal(attached.dataSubjectId, 's-1')
      // Son puan sonucu kesinleştirir: kursiyer ve veli sesi dinler.
      await ok(await urlOf(t.cookies.student, finalAudio))
      await ok(await urlOf(t.cookies.parent, finalAudio))
      await ok(await urlOf(head, finalAudio))
    } finally {
      now = FIXED_NOW
    }
  })

  test('DOM-BEC-056, DOM-BEC-024: uyuşmazlıkta ilk puanlayıcı ikinci puanlayıcının sesini, ikinci puanlayıcı ilkinin sesini duymaz (dosya ucu 404, teslim yanıtında alan yok); koordinatör ikisini de dinler', async () => {
    const t = await tenant()
    const { colleague, head } = await raters(t)
    await consent(t)
    const { submissionId } = await spoken(t, await assign(t, 'audio'))
    const firstAudio = await feedbackAudio(t)
    const secondAudio = await upload(
      t,
      colleague,
      uploadParts('feedback_audio', MP3, 'Meral-geri-bildirim.mp3', 'audio/mpeg'),
      { durationMs: 15_000 },
    )
    try {
      at('2026-10-21T09:00:00.000Z')
      await requestSecondRating(t, submissionId)
      await ok(await write('scores', t.cookies.teacher, submissionId, withAudio(firstAudio)), 201)
      await ok(
        await write(
          'second-scores',
          colleague,
          submissionId,
          withAudio(secondAudio, DISAGREEING),
          t.cookies.admin,
        ),
        201,
      )
      // Puanlayan kendi sesini dinler; öbür puanlayıcının sesi kör puanlamada kapalıdır.
      await ok(await urlOf(t.cookies.teacher, firstAudio))
      await ok(await urlOf(colleague, secondAudio))
      fails(await urlOf(t.cookies.teacher, secondAudio), 404, 'not_found')
      fails(await urlOf(colleague, firstAudio), 404, 'not_found')
      const teacherView = await ok(
        await call('GET', `/task-submissions/${submissionId}`, t.cookies.teacher),
      )
      assert.equal(JSON.stringify(teacherView).includes(secondAudio), false)
      const colleagueView = await ok(
        await call('GET', `/task-submissions/${submissionId}`, colleague),
      )
      assert.equal(JSON.stringify(colleagueView).includes(firstAudio), false)
      // Uyuşmazlıkta sonuç kursiyere kapalıdır; ses de kapalıdır.
      fails(await urlOf(t.cookies.student, firstAudio), 404, 'not_found')
      fails(await urlOf(t.cookies.student, secondAudio), 404, 'not_found')

      // Uyuşmazlığı çözecek koordinatör iki sesi de duyar.
      await ok(await urlOf(head, firstAudio))
      await ok(await urlOf(head, secondAudio))
      const headView = await ok(await call('GET', `/task-submissions/${submissionId}`, head))
      assert.equal(JSON.stringify(headView).includes(firstAudio), true)
      assert.equal(JSON.stringify(headView).includes(secondAudio), true)
    } finally {
      now = FIXED_NOW
    }
  })

  test('DOM-BEC-056: aynı ses ikinci bir teslimin puanına bağlanamaz (409 file_already_attached), ikinci puan yazılmaz', async () => {
    const t = await tenant()
    await consent(t)
    const first = await spoken(t, await assign(t, 'audio'))
    // İkinci teslim aynı öğrencinin el yazısı görevindedir (aynı içerik iki kez atanamaz).
    const image = await upload(
      t,
      t.cookies.student,
      uploadParts('submission', png(), 'sayfa.png', 'image/png'),
    )
    const second = {
      submissionId: (
        await ok(
          await submit(await assign(t, 'file'), t.cookies.student, {
            submissionKind: 'file',
            fileIds: [image],
          }),
          201,
        )
      ).id as string,
    }
    const audioId = await feedbackAudio(t)
    await ok(await write('scores', t.cookies.teacher, first.submissionId, withAudio(audioId)), 201)
    const bound = await fileRow(t, audioId)
    assert.equal(bound.attachedType, 'task_rubric_score')

    fails(
      await write('scores', t.cookies.teacher, second.submissionId, withAudio(audioId)),
      409,
      'file_already_attached',
    )
    assert.equal((await scoreRows(t)).length, 1)
    assert.equal((await fileRow(t, audioId)).attachedId, bound.attachedId)
    // Sesiz puan yazılabilir: ret hiçbir kaydı bozmamıştır.
    await ok(await write('scores', t.cookies.teacher, second.submissionId, SCORE), 201)
  })

  test('DOM-BEC-056: öğrenci ve veli feedback_audio yükleyemez (403); yönetici ve öğretmen yükler; oturumsuz yükleme ve puan 401', async () => {
    const t = await tenant()
    const parts = () => uploadParts('feedback_audio', MP3, 'Selin-geri-bildirim.mp3', 'audio/mpeg')
    const send = (cookie: string | null) => {
      const body = multipart(parts())
      return app.inject({
        method: 'POST',
        url: '/api/v1/files',
        headers: {
          origin: TEST_ORIGIN,
          ...(cookie === null ? {} : { cookie }),
          'content-type': body.contentType,
          'idempotency-key': randomUUID(),
        },
        payload: body.payload,
      })
    }
    for (const cookie of [t.cookies.student, t.cookies.parent, t.cookies.otherStudent])
      fails(await send(cookie), 403, 'forbidden')
    assert.equal((await send(t.cookies.teacher)).statusCode, 201)
    assert.equal((await send(t.cookies.admin)).statusCode, 201)

    const anonymous = await send(null)
    assert.equal(anonymous.statusCode, 401, anonymous.body)
    await consent(t)
    const { submissionId } = await spoken(t, await assign(t, 'audio'))
    const audioId = await feedbackAudio(t)
    for (const path of ['scores', 'second-scores', 'final-scores']) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/task-submissions/${submissionId}/${path}`,
        headers: {
          origin: TEST_ORIGIN,
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
          'if-match': '"1"',
        },
        payload: JSON.stringify(withAudio(audioId)),
      })
      assert.equal(response.statusCode, 401, response.body)
    }
    assert.equal((await scoreRows(t)).length, 0)
    assert.equal((await fileRow(t, audioId)).attachedId, null)
  })

  test('DOM-BEC-056: öğrenme modülü kapalıyken feedback_audio yükleme ve puana ses bağlama 403 module_disabled', async () => {
    const t = await tenant()
    await consent(t)
    const { submissionId } = await spoken(t, await assign(t, 'audio'))
    const audioId = await feedbackAudio(t)
    await db
      .update(institutions)
      .set({ enabledModules: { learning: false } })
      .where(eq(institutions.id, t.institution.id))
    const body = multipart(
      uploadParts('feedback_audio', MP3, 'Selin-geri-bildirim.mp3', 'audio/mpeg'),
    )
    fails(
      await app.inject({
        method: 'POST',
        url: '/api/v1/files',
        headers: {
          origin: TEST_ORIGIN,
          cookie: t.cookies.teacher,
          'content-type': body.contentType,
          'idempotency-key': randomUUID(),
        },
        payload: body.payload,
      }),
      403,
      'module_disabled',
    )
    fails(
      await app.inject({
        method: 'POST',
        url: `/api/v1/task-submissions/${submissionId}/scores`,
        headers: {
          origin: TEST_ORIGIN,
          cookie: t.cookies.teacher,
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
          'if-match': '"1"',
        },
        payload: JSON.stringify(withAudio(audioId)),
      }),
      403,
      'module_disabled',
    )
    assert.equal((await scoreRows(t)).length, 0)
    assert.equal((await fileRow(t, audioId)).attachedId, null)
  })

  test('DOM-BEC-056, DOM-BEC-052, DOM-YTK-059, DOM-BEC-050: sesli geri bildirim öğrencinin veri sahibine ve konuşma kaydının saklama süresine bağlanır; puanı kesinleşmemişken imha bekler, rıza geri çekilince konuşma kaydıyla birlikte silinir', async () => {
    const t = await tenant()
    const { consentId } = await consent(t)
    const { submissionId, recordingId } = await spoken(t, await assign(t, 'audio'))
    const audioId = await feedbackAudio(t)
    const subject = async () =>
      (
        await db
          .select()
          .from(files)
          .where(and(eq(files.institutionId, t.institution.id), eq(files.dataSubjectId, 's-1')))
      )
        .filter((row) => row.status !== 'deleted')
        .map((row) => row.id)
        .sort()
    try {
      at('2026-10-21T09:00:00.000Z')
      await requestSecondRating(t, submissionId)
      await ok(await write('scores', t.cookies.teacher, submissionId, withAudio(audioId)), 201)

      // Veri sahibi öğrencidir (öğretmen değil, boş değil) ve süre konuşma kaydınınkiyle aynıdır.
      const audio = await fileRow(t, audioId)
      const spokenRow = await fileRow(t, recordingId)
      assert.equal(audio.dataSubjectId, 's-1')
      assert.notEqual(audio.retentionUntil, null)
      assert.equal(audio.retentionUntil?.toISOString(), spokenRow.retentionUntil?.toISOString())
      assert.deepEqual(await subject(), [audioId, recordingId].sort())

      // Saklama sonu geçse de ikinci puan bekliyor: konuşma kaydı gibi ses de bekletilir.
      const later = '2028-03-01T00:00:00.000Z'
      assert.ok(Date.parse(later) > (audio.retentionUntil?.getTime() ?? 0))
      assert.deepEqual(await purge(t, later), { purged: 0, held: 2, rounds: 1 })

      // Rıza geri çekilince ikisi de imhaya işaretlenir ve silinir; yazılı geri bildirim kalır.
      await ok(await call('POST', `/consents/${consentId}/withdraw`, t.cookies.parent, {}, key()))
      assert.equal((await fileRow(t, audioId)).retentionUntil?.toISOString(), now.toISOString())
      assert.deepEqual(await purge(t, later), { purged: 2, held: 0, rounds: 1 })
      assert.equal((await fileRow(t, audioId)).status, 'deleted')
      assert.equal((await fileRow(t, recordingId)).status, 'deleted')
      assert.deepEqual(await subject(), [])
      const detail = await ok(
        await call('GET', `/task-submissions/${submissionId}`, t.cookies.teacher),
      )
      assert.equal(detail.versions[0].score.feedbackAudio, null)
      assert.equal(detail.versions[0].score.overallComment, SCORE.overallComment)
    } finally {
      now = FIXED_NOW
    }
  })
  test('DOM-BEC-056, DOM-BEC-052, DOM-BEC-025: sesli geri bildirimin saklama sonu konuşma kaydıyla birlikte geç puanlamada ve itirazda ileri alınır; açık itirazlı ses imha edilmez', async () => {
    const t = await tenant()
    await db
      .update(academicYears)
      .set({ startDate: '2026-01-01', endDate: '2026-10-10' })
      .where(
        and(eq(academicYears.institutionId, t.institution.id), eq(academicYears.startYear, 2026)),
      )
    await consent(t)
    const { submissionId, recordingId } = await spoken(t, await assign(t, 'audio'))
    const audioId = await feedbackAudio(t)
    const retention = async (id: string) => (await fileRow(t, id)).retentionUntil?.toISOString()
    try {
      // Geç puanlama: sonuç 1 Aralık'ta duyurulur, itiraz 8 Aralık'ta kapanır; ses de aynı gün.
      at('2026-12-01T10:00:00.000Z')
      await ok(await write('scores', t.cookies.teacher, submissionId, withAudio(audioId)), 201)
      assert.equal(await retention(recordingId), '2027-06-08T20:59:59.999Z')
      assert.equal(await retention(audioId), '2027-06-08T20:59:59.999Z')

      at('2026-12-03T10:00:00.000Z')
      await ok(
        await call(
          'POST',
          `/task-submissions/${submissionId}/appeals`,
          t.cookies.student,
          { versionNumber: 1, reason: 'Kriterler yeniden okunmalı.' },
          key(),
        ),
        201,
      )
      assert.equal(await retention(recordingId), '2027-06-10T20:59:59.999Z')
      assert.equal(await retention(audioId), '2027-06-10T20:59:59.999Z')

      // Karar gecikse de açık itirazlı sürümün sesi de kaydı gibi imha edilmez.
      assert.deepEqual(await purge(t, '2027-07-01T00:00:00.000Z'), {
        purged: 0,
        held: 2,
        rounds: 1,
      })
      assert.equal((await fileRow(t, audioId)).status, 'ready')
    } finally {
      now = FIXED_NOW
    }
  })
})
