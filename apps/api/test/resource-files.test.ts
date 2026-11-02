import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, asc, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { institutions } from '../src/db/schema/auth.ts'
import { files } from '../src/db/schema/files.ts'
import { records } from '../src/db/schema/records.ts'
import { resourceVersionFiles, resourceVersions } from '../src/db/schema/resources.ts'
import { taskAssignments } from '../src/db/schema/skills.ts'
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
import { multipart, PDF, png, tempStorage, uploadParts } from './support/files-sample.ts'
import { seedResource } from './support/resources-sample.ts'

/**
 * Kaynak sürümünün dosyaları (OG-250; DOM-KYN-006; ADR 0003 karar 5, 6). Dosya sürümle aynı
 * transaction'da bağlanır; ret hiçbir satırı değiştirmez. Dosyayı, ona bağ açan sürümlerden birini
 * okuyabilen okur: öğrenci yalnız kendisine paylaşılan yayının dosyasını; ötekiler 404. Yeni sürüm
 * ve kopya aynı dosyaya yeni bağ açar.
 */

type Json = ReturnType<typeof JSON.parse>

const outcomes = [{ outcomeId: 'M.9.1.1', outcomeSource: 'platform' as const }]
/** Okul türünde yayım koşullarını karşılayan metin; dosyalar `fileIds`, ana dosya `fileId`. */
const text = (fileIds: string[], fileId: string | null = fileIds[0] ?? null) => ({
  title: 'Kesirler çalışma notu',
  content: { type: 'text', body: 'Kesirler bütünün parçalarıdır.', fileId },
  license: { kind: 'institution_original' },
  tags: { subjectId: 'matematik', gradeLevels: [9], outcomes },
  fileIds,
})

/** Görselli çoktan seçmeli soru (atanabilen, otomatik puanlı tür); görsel `question_image`. */
const question = (imageFileId: string) => ({
  title: 'Kesir görseli sorusu',
  content: {
    type: 'question',
    question: {
      questionType: 'multiple_choice',
      stem: 'Görseldeki boyalı kısım kaçtır?',
      options: [
        { id: 'a', text: '1/2' },
        { id: 'b', text: '1/3' },
        { id: 'c', text: '1/4' },
        { id: 'd', text: '2/3' },
      ],
      imageFileId,
    },
  },
  answerKey: {
    questionType: 'multiple_choice',
    correctOptionId: 'c',
    explanation: 'Dört parçadan biri.',
  },
  license: { kind: 'institution_original' },
  tags: { subjectId: 'matematik', gradeLevels: [9], outcomes },
  fileIds: [imageFileId],
})
const DUE = '2026-10-20T20:59:00.000Z'

describe('kaynak sürümü dosyaları', () => {
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

  /** `t-mat` 9-A'nın öğretmeni; Deniz (`s-1`) 9-A'da, Ece (`s-2`) 10-B'de; veli Deniz'in velisi. */
  async function tenant() {
    const institution = await createInstitution(app)
    await insertMissingRecords(
      db,
      institution.id,
      [
        {
          collection: 'teachers',
          id: 't-mat',
          data: { id: 't-mat', name: 'Selin Kaya', subjectId: 'matematik', branchId: 'b-1' },
        },
        ...['9-A', '10-B'].map((id, index) => ({
          collection: 'classes' as const,
          id,
          data: { id, grade: 9 + index, level: '9', branchId: 'b-1', teacherId: 't-mat' },
        })),
        {
          collection: 'students',
          id: 's-1',
          data: { id: 's-1', name: 'Deniz Yılmaz', classId: '9-A', isActive: true },
        },
        {
          collection: 'students',
          id: 's-2',
          data: { id: 's-2', name: 'Ece Yılmaz', classId: '10-B', isActive: true },
        },
        {
          collection: 'assignments',
          id: 'as-1',
          data: { id: 'as-1', classId: '9-A', teacherId: 't-mat', subjectId: 'matematik' },
        },
      ],
      FIXED_NOW,
    )
    const member = (role: 'ogretmen' | 'ogrenci' | 'veli', kind?: string, recordId?: string) =>
      createMember(app, institution.id, role, kind ? [{ kind, recordId } as never] : [])
    const teacher = await member('ogretmen', 'teacher', 't-mat')
    const cookies = {
      admin: await signInAs(app, institution.admin),
      teacher: await signInAs(app, teacher),
      otherTeacher: await signInAs(app, await member('ogretmen')),
      student: await signInAs(app, await member('ogrenci', 'student', 's-1')),
      otherStudent: await signInAs(app, await member('ogrenci', 'student', 's-2')),
      parent: await signInAs(app, await member('veli', 'child', 's-1')),
      // Deniz ve Ece'nin velisi (kardeşler; DOM-YTK-028).
      siblingsParent: await signInAs(
        app,
        await createMember(app, institution.id, 'veli', [
          { kind: 'child', recordId: 's-1' },
          { kind: 'child', recordId: 's-2' },
        ] as never),
      ),
      frontDesk: await signInAs(app, await createMember(app, institution.id, 'onburo')),
    }
    return { institution, teacher, cookies }
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  function call(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    cookie?: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    })
  }
  const post = (url: string, cookie: string | undefined, body: unknown = {}, headers = {}) =>
    call('POST', url, cookie, body, headers)
  const patch = (url: string, cookie: string, body: unknown, version: number) =>
    call('PATCH', url, cookie, body, { 'if-match': `"${version}"` })

  async function ok(response: Awaited<ReturnType<typeof call>>, status = 200) {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function fails(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
    assert.equal(response.statusCode, status, response.body)
    assert.equal(response.json().code, code, response.body)
    return response.json() as Json
  }

  /** Yükler; `ready: false` verilmezse tarama sonucunu (`ready`) yazar. */
  async function upload(
    t: Tenant,
    cookie: string,
    options: { purpose?: string; ready?: boolean; name?: string } = {},
  ) {
    const purpose = options.purpose ?? 'material'
    const parts =
      purpose === 'question_image'
        ? uploadParts(purpose, png(), 'gorsel.png', 'image/png')
        : uploadParts(purpose, PDF, options.name ?? 'kesirler.pdf')
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
    return id
  }

  async function create(t: Tenant, body: unknown, cookie = t.cookies.teacher) {
    return ok(await post('/resources', cookie, body), 201)
  }
  /** Kendi sınıfıyla paylaşıp onaysız yayımlar (DOM-KYN-031). */
  async function publishToClass(t: Tenant, data: Json) {
    await ok(
      await post(`/resources/${data.resource.id}/share`, t.cookies.teacher, {
        scope: 'classes',
        classIds: ['9-A'],
      }),
    )
    return ok(
      await post(
        `/resources/${data.resource.id}/versions/${data.version.id}/publish`,
        t.cookies.teacher,
      ),
    )
  }
  const fileUrl = (cookie: string, fileId: string) => call('GET', `/files/${fileId}/url`, cookie)

  async function snapshot(institutionId: string) {
    const [versions, links, rows] = await Promise.all([
      db
        .select({ id: resourceVersions.id, version: resourceVersions.version })
        .from(resourceVersions)
        .where(eq(resourceVersions.institutionId, institutionId))
        .orderBy(asc(resourceVersions.id)),
      db
        .select({
          versionId: resourceVersionFiles.versionId,
          fileId: resourceVersionFiles.fileId,
          archivedAt: resourceVersionFiles.archivedAt,
          version: resourceVersionFiles.version,
        })
        .from(resourceVersionFiles)
        .where(eq(resourceVersionFiles.institutionId, institutionId))
        .orderBy(asc(resourceVersionFiles.versionId), asc(resourceVersionFiles.fileId)),
      db
        .select({ id: files.id, attachedId: files.attachedId, version: files.version })
        .from(files)
        .where(eq(files.institutionId, institutionId))
        .orderBy(asc(files.id)),
    ])
    return { versions, links, rows }
  }
  const fileRow = async (institutionId: string, fileId: string) =>
    (
      await db
        .select()
        .from(files)
        .where(and(eq(files.institutionId, institutionId), eq(files.id, fileId)))
    )[0]!
  const linksOf = async (institutionId: string, fileId: string) =>
    (
      await db
        .select({ versionId: resourceVersionFiles.versionId })
        .from(resourceVersionFiles)
        .where(
          and(
            eq(resourceVersionFiles.institutionId, institutionId),
            eq(resourceVersionFiles.fileId, fileId),
          ),
        )
    )
      .map((row) => row.versionId)
      .sort()

  test('DOM-KYN-006: 401 oturumsuz; öğrenci materyal yükleyemez ve kaynak yazamaz 403; modül kapalı 403', async () => {
    const t = await tenant()
    const fileId = await upload(t, t.cookies.teacher)
    const before = await snapshot(t.institution.id)
    assert.equal((await post('/resources', undefined, text([fileId]))).statusCode, 401)
    const body = multipart(uploadParts('material', PDF))
    const studentUpload = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: {
        origin: TEST_ORIGIN,
        cookie: t.cookies.student,
        'content-type': body.contentType,
        'idempotency-key': randomUUID(),
      },
      payload: body.payload,
    })
    assert.equal(studentUpload.statusCode, 403, studentUpload.body)
    for (const cookie of [t.cookies.student, t.cookies.parent, t.cookies.frontDesk])
      fails(await post('/resources', cookie, text([fileId])), 403, 'forbidden')
    assert.deepEqual(await snapshot(t.institution.id), before)

    const closed = await createInstitution(app, { enabledModules: { learning: false } })
    fails(
      await post('/resources', await signInAs(app, closed.admin), text([randomUUID()])),
      403,
      'module_disabled',
    )
  })

  test('DOM-KYN-006: başarı; dosya sürümle aynı işlemde bağlanır, meta veri yanıtta ve okumada kalıcı; mükerrer istek tek kayıt', async () => {
    const t = await tenant()
    const main = await upload(t, t.cookies.teacher, { name: 'kesirler.pdf' })
    const extra = await upload(t, t.cookies.teacher, { name: 'cevaplar.pdf' })
    const key = { 'idempotency-key': randomUUID() }
    const response = await post('/resources', t.cookies.teacher, text([main, extra]), key)
    const data = await ok(response, 201)
    const expected = (id: string, name: string) => ({
      id,
      name,
      contentType: 'application/pdf',
      byteSize: PDF.length,
      purpose: 'material',
      durationMs: null,
      status: 'ready',
    })
    assert.deepEqual(data.version.files, [
      expected(main, 'kesirler.pdf'),
      expected(extra, 'cevaplar.pdf'),
    ])
    // Şemada olmayan alan istemciye gitmez: depo anahtarı, özet ve yükleyen yoktur.
    for (const secret of ['storageKey', 'sha256', 'uploadedByUserId', t.institution.id + '/'])
      assert.equal(response.body.includes(secret), false, secret)

    for (const id of [main, extra]) {
      const row = await fileRow(t.institution.id, id)
      assert.equal(row.attachedType, 'resource_version')
      assert.equal(row.attachedId, data.version.id)
    }
    assert.deepEqual(await linksOf(t.institution.id, main), [data.version.id])
    const detail = await ok(await call('GET', `/resources/${data.resource.id}`, t.cookies.teacher))
    assert.deepEqual(detail.head.files, data.version.files)
    const version = await ok(
      await call(
        'GET',
        `/resources/${data.resource.id}/versions/${data.version.id}`,
        t.cookies.teacher,
      ),
    )
    assert.deepEqual(version.version.files, data.version.files)

    // Aynı anahtar ilk yanıtı tekrarlar; dosya ikinci kez bağlanmaz.
    const before = await snapshot(t.institution.id)
    const replay = await post('/resources', t.cookies.teacher, text([main, extra]), key)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(replay.json().data.resource.id, data.resource.id)
    assert.deepEqual(await snapshot(t.institution.id), before)
    // Yeni anahtarla aynı dosya: başka kayda bağlı (422), kayıt değişmez.
    const again = fails(
      await post('/resources', t.cookies.teacher, text([main])),
      422,
      'file_already_attached',
    )
    assert.deepEqual(again.issues[0].path, ['fileIds', '0'])
    assert.deepEqual(await snapshot(t.institution.id), before)
  })

  test('DOM-KYN-006: başkasının, başka kurumun, yanlış amaçlı, hazır olmayan dosyası ve sınır aşımı 422; hiçbir kayıt değişmez', async () => {
    const t = await tenant()
    const other = await tenant()
    const own = await upload(t, t.cookies.teacher)
    const colleagues = await upload(t, t.cookies.otherTeacher)
    const foreign = await upload(other, other.cookies.teacher)
    const image = await upload(t, t.cookies.teacher, { purpose: 'question_image' })
    const pending = await upload(t, t.cookies.teacher, { ready: false })
    const before = await snapshot(t.institution.id)
    const cases: [unknown, string][] = [
      [text([colleagues]), 'file_unavailable'],
      [text([foreign]), 'file_unavailable'],
      [text([randomUUID()]), 'file_unavailable'],
      [text([own, image], own), 'file_purpose_mismatch'],
      [text([pending]), 'file_not_ready'],
      [text(Array.from({ length: 11 }, () => randomUUID())), 'resource_files_limit'],
      [text([own], image), 'resource_file_unlinked'],
      [
        {
          ...text([own], null),
          content: { type: 'reading_passage', body: 'Kısa bir okuma parçası.' },
        },
        'resource_files_not_allowed',
      ],
    ]
    for (const [body, code] of cases)
      fails(await post('/resources', t.cookies.teacher, body), 422, code)
    assert.deepEqual(await snapshot(t.institution.id), before)
    // Ret, sonraki geçerli bağlamayı engellemez.
    const data = await create(t, text([own]))
    assert.equal(data.version.files[0].id, own)
  })

  test('DOM-KYN-006, DOM-KYN-030: taslak düzenleme listeyi bütün olarak değiştirir; çıkan dosyanın bağı kalkar, yazar olmayan yönetici 404, sahip ayrılınca 403; hatada kayıt değişmez', async () => {
    const t = await tenant()
    const first = await upload(t, t.cookies.teacher)
    const second = await upload(t, t.cookies.teacher)
    const pending = await upload(t, t.cookies.teacher, { ready: false })
    const data = await create(t, text([first]))
    const url = `/resources/${data.resource.id}/versions/${data.version.id}`

    // İçerik değişmeden başlık düzenlemesi dosyalara dokunmaz.
    const titled = await ok(await patch(url, t.cookies.teacher, { title: 'Kesirler 2' }, 1))
    assert.deepEqual(
      titled.version.files.map((file: Json) => file.id),
      [first],
    )

    const before = await snapshot(t.institution.id)
    fails(
      await patch(url, t.cookies.teacher, { fileIds: [first, pending] }, 2),
      422,
      'file_not_ready',
    )
    // Ana dosya listeden çıkarılamaz.
    fails(
      await patch(url, t.cookies.teacher, { fileIds: [second] }, 2),
      422,
      'resource_file_unlinked',
    )
    fails(
      await patch(url, t.cookies.otherTeacher, { fileIds: [first, second] }, 2),
      404,
      'not_found',
    )
    assert.deepEqual(await snapshot(t.institution.id), before)

    const swapped = await ok(
      await patch(
        url,
        t.cookies.teacher,
        {
          content: { type: 'text', body: 'Kesirler bütünün parçalarıdır.', fileId: second },
          fileIds: [second],
        },
        2,
      ),
    )
    assert.deepEqual(
      swapped.version.files.map((file: Json) => file.id),
      [second],
    )
    assert.equal((await fileRow(t.institution.id, second)).attachedId, data.version.id)
    // Çıkan dosyanın bağı kalkar: yalnız yükleyen görür, bağsız dosya temizliği siler.
    assert.equal((await fileRow(t.institution.id, first)).attachedId, null)
    assert.deepEqual(await linksOf(t.institution.id, first), [data.version.id], 'arşivli bağ kalır')
    const detail = await ok(await call('GET', `/resources/${data.resource.id}`, t.cookies.teacher))
    assert.deepEqual(
      detail.head.files.map((file: Json) => file.id),
      [second],
    )

    // Taslağı yalnız yazarı düzenler (DOM-KYN-030): sahip etkinken yönetici taslağı görmez (404);
    // sahip ayrılınca görür (DOM-KYN-052) ama düzenleyemez (403). Kayıt değişmez.
    const draftBefore = await snapshot(t.institution.id)
    fails(await patch(url, t.cookies.admin, { fileIds: [first, second] }, 3), 404, 'not_found')
    await db
      .update(records)
      .set({ archivedAt: FIXED_NOW })
      .where(
        and(
          eq(records.institutionId, t.institution.id),
          eq(records.collection, 'teachers'),
          eq(records.id, 't-mat'),
        ),
      )
    fails(
      await patch(url, t.cookies.admin, { fileIds: [first, second] }, 3),
      403,
      'resource_action_forbidden',
    )
    assert.deepEqual(await snapshot(t.institution.id), draftBefore)
  })

  test('DOM-KYN-006, DOM-KYN-024, DOM-YTK-028: paylaşılan öğrenci, velisi ve kardeş velisi dosyayı okur; taslak başka öğretmene, paylaşılmayan, ön büro ve başka kurum 404; modül kapalı 403', async () => {
    const t = await tenant()
    const other = await tenant()
    const fileId = await upload(t, t.cookies.teacher)
    const data = await create(t, text([fileId]))
    // Taslak öğrenciye ve kaynağı göremeyen başka öğretmene görünmez.
    for (const cookie of [t.cookies.student, t.cookies.otherTeacher])
      fails(await fileUrl(cookie, fileId), 404, 'not_found')
    await publishToClass(t, data)

    const learner = await ok(await call('GET', `/resources/${data.resource.id}`, t.cookies.student))
    assert.equal(learner.view, 'learner')
    assert.deepEqual(
      learner.version.files.map((file: Json) => [file.id, file.name]),
      [[fileId, 'kesirler.pdf']],
    )
    // Kardeşlerin velisi paylaşılan çocuğu (Deniz) üzerinden açar (DOM-YTK-028).
    for (const cookie of [
      t.cookies.student,
      t.cookies.parent,
      t.cookies.siblingsParent,
      t.cookies.teacher,
      t.cookies.admin,
    ]) {
      const link = await ok(await fileUrl(cookie, fileId))
      assert.match(link.url, /^http:\/\/localhost:3000\//)
    }
    for (const cookie of [t.cookies.otherStudent, t.cookies.frontDesk, other.cookies.admin])
      fails(await fileUrl(cookie, fileId), 404, 'not_found')
    fails(
      await call('GET', `/resources/${data.resource.id}`, other.cookies.admin),
      404,
      'not_found',
    )
    fails(
      await post(`/resources/${data.resource.id}/versions`, other.cookies.admin),
      404,
      'not_found',
    )

    await db
      .update(institutions)
      .set({ enabledModules: { learning: false } })
      .where(eq(institutions.id, t.institution.id))
    fails(await fileUrl(t.cookies.student, fileId), 403, 'module_disabled')
    fails(await fileUrl(t.cookies.otherStudent, fileId), 404, 'not_found')
  })

  test('DOM-KYN-006, DOM-KYN-032, DOM-KYN-050: yeni sürüm ve kopya aynı dosyaya yeni bağ açar; kopyanın okuyucusu dosyayı okur; kaldırılan kaynağın dosyası kopyadan da açılmaz', async () => {
    const t = await tenant()
    const fileId = await upload(t, t.cookies.teacher)
    const added = await upload(t, t.cookies.teacher)
    const pending = await upload(t, t.cookies.teacher, { ready: false })
    const data = await create(t, text([fileId]))
    await publishToClass(t, data)
    const base = `/resources/${data.resource.id}`

    // Yeni sürüm: hatalı liste 422, sürüm açılmaz.
    const before = await snapshot(t.institution.id)
    fails(
      await post(`${base}/versions`, t.cookies.teacher, { fileIds: [fileId, pending] }),
      422,
      'file_not_ready',
    )
    fails(
      await post(`${base}/versions`, t.cookies.teacher, { fileIds: [added] }),
      422,
      'resource_file_unlinked',
    )
    assert.deepEqual(await snapshot(t.institution.id), before)

    // Temel sürümün dosyası yeniden denetlenmez (zaten bağlı); yeni dosya yeni sürüme bağlanır.
    const next = await ok(
      await post(`${base}/versions`, t.cookies.teacher, { fileIds: [fileId, added] }),
      201,
    )
    assert.deepEqual(
      next.version.files.map((file: Json) => file.id),
      [fileId, added],
    )
    assert.equal((await fileRow(t.institution.id, fileId)).attachedId, data.version.id)
    assert.equal((await fileRow(t.institution.id, added)).attachedId, next.version.id)
    assert.deepEqual(
      await linksOf(t.institution.id, fileId),
      [data.version.id, next.version.id].sort(),
    )

    // Kopya: dosya kopyalanmaz, aynı dosyaya bağ açılır.
    const copy = await ok(await post(`${base}/copy`, t.cookies.admin), 201)
    assert.deepEqual(
      copy.version.files.map((file: Json) => file.id),
      [fileId],
    )
    assert.equal((await fileRow(t.institution.id, fileId)).attachedId, data.version.id)
    assert.equal((await linksOf(t.institution.id, fileId)).includes(copy.version.id), true)

    // Ece'nin sınıfına (10-B) paylaşılmış yayındaki bir kopya: kopyanın okuyucusu dosyayı açar.
    fails(await fileUrl(t.cookies.otherStudent, fileId), 404, 'not_found')
    await seedResource(db, t.institution.id, {
      ownerUserId: t.teacher.id,
      shareScope: 'classes',
      sharedClassIds: ['10-B'],
      derivedFromVersionId: data.version.id,
      // Öğrenci yalnız düzeyine uygun yayını görür: kopya 10. sınıfa uyarlanmış.
      versions: [
        {
          status: 'published',
          input: {
            ...text([fileId]),
            tags: { subjectId: 'matematik', gradeLevels: [10] },
          } as never,
        },
      ],
    })
    await ok(await fileUrl(t.cookies.otherStudent, fileId))

    // Kaynağın yayından kaldırılması (arşiv) kopyaya dokunmaz: kopyanın okuyucusu açmaya devam eder.
    await ok(await post(`${base}/versions/${data.version.id}/archive`, t.cookies.teacher))
    await ok(await fileUrl(t.cookies.otherStudent, fileId))

    // Kaldırma (DOM-KYN-051, sabah kararı 36): dosya kopyalar dahil hiçbir yoldan açılmaz. Bağ
    // satırları ve dosya satırı kalır: karar geri alınabilir, imha işi bağlı dosyayı bulur.
    const linksBefore = await linksOf(t.institution.id, fileId)
    const removed = await ok(
      await post(`${base}/remove`, t.cookies.admin, { reason: 'Telif bildirimi doğrulandı.' }),
    )
    assert.equal(removed.affectedCopyIds.length, 2)
    for (const cookie of [
      t.cookies.student,
      t.cookies.otherStudent,
      t.cookies.parent,
      t.cookies.teacher,
      t.cookies.admin,
    ])
      fails(await fileUrl(cookie, fileId), 404, 'not_found')
    assert.deepEqual(await linksOf(t.institution.id, fileId), linksBefore)
    const row = await fileRow(t.institution.id, fileId)
    assert.equal(row.attachedId, data.version.id)
    assert.equal(row.status, 'ready')
    const staff = await ok(
      await call('GET', `${base}/versions/${data.version.id}`, t.cookies.admin),
    )
    assert.deepEqual(staff.version.files, [], 'kaldırılan sürümün dosya listesi gösterilmez')
  })

  test('DOM-KYN-006: eski sürümdeki dosya aynı kaynağın yeni sürümüne geri eklenir; başka kaynağa bağlı dosya 422', async () => {
    const t = await tenant()
    const main = await upload(t, t.cookies.teacher)
    const old = await upload(t, t.cookies.teacher)
    const data = await create(t, text([main, old], main))
    await publishToClass(t, data)
    const base = `/resources/${data.resource.id}`
    // İkinci sürüm eski dosyayı bırakır ve yayımlanır.
    const second = await ok(
      await post(`${base}/versions`, t.cookies.teacher, { fileIds: [main] }),
      201,
    )
    await ok(await post(`${base}/versions/${second.version.id}/publish`, t.cookies.teacher))

    // Yeni sürüm ucu: birinci sürümün dosyası geri eklenir, yeni bağ açılır, dosya satırı değişmez.
    const third = await ok(
      await post(`${base}/versions`, t.cookies.teacher, { fileIds: [main, old] }),
      201,
    )
    assert.deepEqual(
      third.version.files.map((file: Json) => file.id),
      [main, old],
    )
    assert.equal((await fileRow(t.institution.id, old)).attachedId, data.version.id)
    assert.deepEqual(
      await linksOf(t.institution.id, old),
      [data.version.id, third.version.id].sort(),
    )

    // Taslak düzenleme: çıkarılan eski dosyanın bağı birinci sürümde kalır, yeniden eklenebilir.
    const url = `${base}/versions/${third.version.id}`
    await ok(await patch(url, t.cookies.teacher, { fileIds: [main] }, 1))
    assert.equal((await fileRow(t.institution.id, old)).attachedId, data.version.id)
    const readded = await ok(await patch(url, t.cookies.teacher, { fileIds: [main, old] }, 2))
    assert.deepEqual(
      readded.version.files.map((file: Json) => file.id),
      [main, old],
    )

    // Başka kaynağa bağlı dosya yeni dosya gibi denetlenir: 422, kayıt değişmez.
    const foreign = await upload(t, t.cookies.teacher)
    await create(t, text([foreign]))
    const before = await snapshot(t.institution.id)
    const rejected = fails(
      await patch(url, t.cookies.teacher, { fileIds: [main, foreign] }, 3),
      422,
      'file_already_attached',
    )
    assert.deepEqual(rejected.issues[0].path, ['fileIds', '1'])
    assert.deepEqual(await snapshot(t.institution.id), before)
  })

  test('DOM-KYN-006: silinmiş dosya yeni sürüme taşınmaz (422 file_unavailable); liste verilmese de; kayıt değişmez', async () => {
    const t = await tenant()
    const main = await upload(t, t.cookies.teacher)
    const extra = await upload(t, t.cookies.teacher)
    const data = await create(t, text([main, extra], main))
    await publishToClass(t, data)
    await db
      .update(files)
      .set({ status: 'deleted', deletedAt: FIXED_NOW })
      .where(and(eq(files.institutionId, t.institution.id), eq(files.id, extra)))
    const base = `/resources/${data.resource.id}`
    const before = await snapshot(t.institution.id)
    const listed = fails(
      await post(`${base}/versions`, t.cookies.teacher, { fileIds: [main, extra] }),
      422,
      'file_unavailable',
    )
    assert.deepEqual(listed.issues[0].path, ['fileIds', '1'])
    fails(await post(`${base}/versions`, t.cookies.teacher), 422, 'file_unavailable')
    assert.deepEqual(await snapshot(t.institution.id), before)
    const next = await ok(
      await post(`${base}/versions`, t.cookies.teacher, { fileIds: [main] }),
      201,
    )
    assert.deepEqual(
      next.version.files.map((file: Json) => file.id),
      [main],
    )
    // Taslakta kalan silinmiş dosya, liste düzenlenirken de taşınmaz.
    fails(
      await patch(
        `${base}/versions/${next.version.id}`,
        t.cookies.teacher,
        { fileIds: [main, extra] },
        1,
      ),
      422,
      'file_unavailable',
    )
  })

  /** Görevi yönetici atar (kurumdaki her sınıfa, DOM-BEC-041); atama kimliği. */
  async function assign(t: Tenant, resourceVersionId: string, classId: string) {
    const data = await ok(
      await post(
        '/task-assignments',
        t.cookies.admin,
        {
          resourceVersionId,
          settings: { deadline: { dueAt: DUE } },
          targets: [{ kind: 'class', id: classId }],
        },
        { 'idempotency-key': randomUUID() },
      ),
      201,
    )
    return data.id as string
  }
  const publish = async (cookie: string, data: Json) =>
    ok(await post(`/resources/${data.resource.id}/versions/${data.version.id}/publish`, cookie))

  test('DOM-KYN-006, DOM-YTK-028: atanmış görevin sürümündeki dosya paylaşılmasa da açılır (kardeş veli, quiz sorusu); atanmamış kişi ve sonradan yayımlanan sürümün dosyası 404', async () => {
    const t = await tenant()
    const image = await upload(t, t.cookies.teacher, { purpose: 'question_image' })
    const data = await create(t, question(image))
    await publish(t.cookies.teacher, data)
    // Paylaşılmayan kaynak kursiyere açılmaz.
    for (const cookie of [
      t.cookies.student,
      t.cookies.otherStudent,
      t.cookies.parent,
      t.cookies.siblingsParent,
    ])
      fails(await fileUrl(cookie, image), 404, 'not_found')

    // Ece'nin sınıfına (10-B) atanır: Ece ve kardeşlerin velisi açar; Deniz ve yalnız Deniz'in
    // velisi, sınıfı olmayan öğretmen ve ön büro açamaz.
    await assign(t, data.version.id, '10-B')
    await ok(await fileUrl(t.cookies.otherStudent, image))
    await ok(await fileUrl(t.cookies.siblingsParent, image))
    for (const cookie of [
      t.cookies.student,
      t.cookies.parent,
      t.cookies.otherTeacher,
      t.cookies.frontDesk,
    ])
      fails(await fileUrl(cookie, image), 404, 'not_found')

    // Soru görseli quiz üzerinden de atanır: Deniz'in sınıfına (9-A) atanan quiz.
    const quiz = await ok(
      await post('/resources', t.cookies.admin, {
        title: 'Kesir quizi',
        content: { type: 'quiz', items: [{ questionVersionId: data.version.id, points: 1 }] },
        license: { kind: 'institution_original' },
        tags: { subjectId: 'matematik', gradeLevels: [9], outcomes },
      }),
      201,
    )
    await publish(t.cookies.admin, quiz)
    fails(await fileUrl(t.cookies.student, image), 404, 'not_found')
    await assign(t, quiz.version.id, '9-A')
    await ok(await fileUrl(t.cookies.student, image))
    await ok(await fileUrl(t.cookies.parent, image))

    // Sonradan yayımlanan sürümün yeni görseli atanmamıştır; atanan sürümün görseli açık kalır.
    const replaced = await upload(t, t.cookies.teacher, { purpose: 'question_image' })
    const next = await ok(
      await post(`/resources/${data.resource.id}/versions`, t.cookies.teacher),
      201,
    )
    const url = `/resources/${data.resource.id}/versions/${next.version.id}`
    await ok(
      await patch(
        url,
        t.cookies.teacher,
        { content: question(replaced).content, fileIds: [replaced] },
        1,
      ),
    )
    await ok(await post(`${url}/publish`, t.cookies.teacher))
    await ok(await fileUrl(t.cookies.otherStudent, image))
    for (const cookie of [t.cookies.otherStudent, t.cookies.siblingsParent, t.cookies.student])
      fails(await fileUrl(cookie, replaced), 404, 'not_found')

    // Kaldırılan kaynağın sürümü atanmış olsa da dosya açmaz (DOM-KYN-051).
    await ok(
      await post(`/resources/${data.resource.id}/remove`, t.cookies.admin, {
        reason: 'Kişisel veri içeriyor.',
      }),
    )
    for (const cookie of [t.cookies.otherStudent, t.cookies.siblingsParent, t.cookies.student])
      fails(await fileUrl(cookie, image), 404, 'not_found')
  })

  test('DOM-KYN-006, DOM-YTK-028: sınıfın öğretmeni paylaşılmayan kaynağın dosyasını atama üzerinden açar; arşivlenen atama dosyayı kapatır', async () => {
    const t = await tenant()
    // Yöneticinin özel kaynağı: öğretmen ve kursiyer içerik havuzundan okuyamaz.
    const fileId = await upload(t, t.cookies.admin, { purpose: 'question_image' })
    const data = await create(t, question(fileId), t.cookies.admin)
    await publish(t.cookies.admin, data)
    for (const cookie of [t.cookies.teacher, t.cookies.student, t.cookies.parent])
      fails(await fileUrl(cookie, fileId), 404, 'not_found')

    // Yönetici 9-A'ya atar: sınıfın öğretmeni (atayan değil), öğrenci ve velisi açar.
    const assignmentId = await assign(t, data.version.id, '9-A')
    for (const cookie of [t.cookies.teacher, t.cookies.student, t.cookies.parent])
      await ok(await fileUrl(cookie, fileId))
    for (const cookie of [t.cookies.otherTeacher, t.cookies.otherStudent])
      fails(await fileUrl(cookie, fileId), 404, 'not_found')

    // Arşivlenen atama hiçbir kişiye dosya açmaz; kaynağı okuyabilen yönetici açmaya devam eder.
    await db
      .update(taskAssignments)
      .set({ archivedAt: FIXED_NOW })
      .where(
        and(
          eq(taskAssignments.institutionId, t.institution.id),
          eq(taskAssignments.id, assignmentId),
        ),
      )
    for (const cookie of [t.cookies.teacher, t.cookies.student, t.cookies.parent])
      fails(await fileUrl(cookie, fileId), 404, 'not_found')
    await ok(await fileUrl(t.cookies.admin, fileId))
  })

  /** Yayınevi lisansı (DOM-KYN-021); bitiş günü `FIXED_NOW`'un günüdür. */
  const licensed = (restrictedToBookOwners: boolean) => ({
    kind: 'licensed_publication' as const,
    publisher: 'Örnek Yayınevi',
    contractNumber: 'SZ-2026-01',
    coverage: 'Kitap sahibi öğrenciler',
    expiryDate: '2026-10-06',
    restrictedToBookOwners,
  })

  /**
   * Yayındaki lisanslı soruyu depo fonksiyonuyla ekler (lisanslı yayın onayla yayımlanır) ve
   * görseli sürüme bağlar.
   */
  async function seedLicensedQuestion(
    t: Tenant,
    image: string,
    license: ReturnType<typeof licensed>,
    share: { shareScope?: 'students'; sharedStudentIds?: string[]; gradeLevels?: number[] } = {},
  ) {
    const seeded = await seedResource(db, t.institution.id, {
      ownerUserId: t.institution.admin.id,
      ...(share.shareScope ? { shareScope: share.shareScope } : {}),
      sharedStudentIds: share.sharedStudentIds ?? [],
      versions: [
        {
          status: 'published',
          input: {
            ...question(image),
            license,
            tags: { subjectId: 'matematik', gradeLevels: share.gradeLevels ?? [9], outcomes },
          } as never,
        },
      ],
    })
    const versionId = seeded.versions[0]!.id
    await db
      .update(files)
      .set({ attachedType: 'resource_version', attachedId: versionId, attachedAt: FIXED_NOW })
      .where(and(eq(files.institutionId, t.institution.id), eq(files.id, image)))
    return versionId
  }

  test('DOM-KYN-006, DOM-KYN-021: lisansı dolmuş içeriğin dosyası görevden yalnız süren işi olana açılır; personel açmaya devam eder', async () => {
    const t = await tenant()
    const image = await upload(t, t.cookies.admin, { purpose: 'question_image' })
    const versionId = await seedLicensedQuestion(t, image, licensed(false))
    const assignmentId = await assign(t, versionId, '9-A')
    // Bitiş günü dahil geçerlidir.
    for (const cookie of [t.cookies.student, t.cookies.parent])
      await ok(await fileUrl(cookie, image))

    const expire = async (check: () => Promise<void>) => {
      now = new Date('2026-10-07T09:00:00.000Z')
      try {
        await check()
      } finally {
        now = FIXED_NOW
      }
    }
    // Süren işi olmayan kursiyere görev içeriği gibi dosya da kapanır (`license_expired`).
    await expire(async () => {
      for (const cookie of [t.cookies.student, t.cookies.parent])
        fails(await fileUrl(cookie, image), 404, 'not_found')
      for (const cookie of [t.cookies.teacher, t.cookies.admin])
        await ok(await fileUrl(cookie, image))
    })
    // Süren deneme işi bitirir: öğrenci ve velisi dosyayı açar.
    await ok(
      await post(
        `/task-assignments/${assignmentId}/attempts`,
        t.cookies.student,
        {},
        { 'idempotency-key': randomUUID() },
      ),
      201,
    )
    await expire(async () => {
      for (const cookie of [t.cookies.student, t.cookies.parent])
        await ok(await fileUrl(cookie, image))
    })
  })

  test('DOM-KYN-006, DOM-KYN-021: kitap sahibiyle sınırlı lisansta görevden dosya yalnız kitap sahibine açılır', async () => {
    const t = await tenant()
    const image = await upload(t, t.cookies.admin, { purpose: 'question_image' })
    // Deniz kitap sahibidir; içerik 10. sınıfa etiketli olduğundan havuzdan okuyamaz.
    const versionId = await seedLicensedQuestion(t, image, licensed(true), {
      shareScope: 'students',
      sharedStudentIds: ['s-1'],
      gradeLevels: [10],
    })
    for (const cookie of [t.cookies.student, t.cookies.otherStudent])
      fails(await fileUrl(cookie, image), 404, 'not_found')
    const assigned = await ok(
      await post(
        '/task-assignments',
        t.cookies.admin,
        {
          resourceVersionId: versionId,
          settings: { deadline: { dueAt: DUE } },
          targets: [
            { kind: 'class', id: '9-A' },
            { kind: 'class', id: '10-B' },
          ],
        },
        { 'idempotency-key': randomUUID() },
      ),
      201,
    )
    // Atama iki sınıfa da gider; dosya yalnız kitap sahibi Deniz'e ve velilerine açılır.
    for (const cookie of [t.cookies.student, t.cookies.parent, t.cookies.siblingsParent])
      await ok(await fileUrl(cookie, image))
    fails(await fileUrl(t.cookies.otherStudent, image), 404, 'not_found')
    await ok(await fileUrl(t.cookies.teacher, image))
    // Görev içeriği de aynı kuraldan geçer: kitap sahibi olmayana `unavailable`.
    const detail = async (cookie: string) =>
      (await ok(await call('GET', `/task-assignments/${assigned.id}`, cookie))).contentUnavailable
    assert.equal(await detail(t.cookies.student), null)
    assert.equal(await detail(t.cookies.otherStudent), 'unavailable')
  })

  test('DOM-KYN-006, DOM-KYN-051: kopyanın kaldırılması aşağı yayılır; orijinal ve kardeş kopya açık kalır, kopyanın kopyası kapanır', async () => {
    const t = await tenant()
    const fileId = await upload(t, t.cookies.teacher)
    // Orijinal: 9-A ile paylaşılır, Deniz okur.
    const data = await create(t, text([fileId]))
    await publishToClass(t, data)
    const copier = await createMember(app, t.institution.id, 'ogretmen')
    const sibling = await createMember(app, t.institution.id, 'ogretmen')
    const cookies = { copier: await signInAs(app, copier), sibling: await signInAs(app, sibling) }
    const copyOf = (ownerUserId: string, derivedFromVersionId: string, gradeLevels = [9]) =>
      seedResource(db, t.institution.id, {
        ownerUserId,
        derivedFromVersionId,
        ...(gradeLevels[0] === 10 ? { shareScope: 'classes', sharedClassIds: ['10-B'] } : {}),
        versions: [
          {
            status: 'published',
            input: {
              ...text([fileId]),
              tags: { subjectId: 'matematik', gradeLevels, outcomes },
            } as never,
          },
        ],
      })
    // Kopya (sahibi okur), kopyanın kopyası (10-B ile paylaşılır, Ece okur), kardeş kopya.
    const copy = await copyOf(copier.id, data.version.id)
    await copyOf(t.institution.admin.id, copy.versions[0]!.id, [10])
    await copyOf(sibling.id, data.version.id)
    for (const cookie of [
      t.cookies.student,
      cookies.copier,
      t.cookies.otherStudent,
      cookies.sibling,
    ])
      await ok(await fileUrl(cookie, fileId))

    // Kopya kaldırılır (sabah kararı 39): kopya ve ondan türeyen kopya kapanır; orijinal (ata) ve
    // kardeş kopya açık kalır. Orijinal de aynı içeriği taşıyorsa yönetici onu ayrıca kaldırır.
    const removed = await ok(
      await post(`/resources/${copy.resource.id}/remove`, t.cookies.admin, {
        reason: 'Telif bildirimi doğrulandı.',
      }),
    )
    assert.equal(removed.affectedCopyIds.length, 1)
    for (const cookie of [t.cookies.student, t.cookies.parent, t.cookies.teacher, cookies.sibling])
      await ok(await fileUrl(cookie, fileId))
    for (const cookie of [cookies.copier, t.cookies.otherStudent])
      fails(await fileUrl(cookie, fileId), 404, 'not_found')
  })
})
