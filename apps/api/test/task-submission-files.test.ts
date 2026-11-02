import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { ResourceVersionInput } from '@kampus/school-core/content/resource.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { institutions } from '../src/db/schema/auth.ts'
import { files } from '../src/db/schema/files.ts'
import { records } from '../src/db/schema/records.ts'
import { rubrics, rubricVersions, submissionVersions } from '../src/db/schema/skills.ts'
import { recordFileCheck } from '../src/services/files.ts'
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

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    store = await tempStorage()
    app = await buildTestApp(db, { storage: store.storage, clock: () => FIXED_NOW, logs })
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
})
