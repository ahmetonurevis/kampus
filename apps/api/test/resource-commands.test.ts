import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { resources, resourceShares, resourceVersions } from '../src/db/schema/resources.ts'
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
 * İçerik havuzu yazma uçları: oluşturma, taslak düzenleme, yeni sürüm, durum geçişleri,
 * kaldırma, paylaşım ve kopya (DOM-KYN-001, 021, 025, 030, 031, 032, 040, 050, 051).
 */

const outcomes = [{ outcomeId: 'M.9.1.1', outcomeSource: 'platform' as const }]
/** Okul türünde yayım koşullarını karşılayan metin (ders, düzey, kazanım, lisans). */
const publishable = (title = 'Kesirlerle okuma') => ({
  title,
  content: { type: 'text', body: 'Kesirler bütünün parçalarıdır.' },
  license: { kind: 'institution_original' },
  tags: { subjectId: 'matematik', gradeLevels: [9], outcomes },
})
const question = (title = 'Işık sorusu') => ({
  title,
  content: {
    type: 'question',
    question: {
      questionType: 'multiple_choice',
      stem: 'Işık hangi hızla yayılır?',
      options: [
        { id: 'a', text: 'Ses hızıyla' },
        { id: 'b', text: 'Saniyede yaklaşık 300.000 km' },
        { id: 'c', text: 'Saniyede 1 km' },
        { id: 'd', text: 'Yayılmaz' },
      ],
    },
  },
  answerKey: { questionType: 'multiple_choice', correctOptionId: 'b', explanation: 'Gizli çözüm' },
  license: { kind: 'institution_original' },
  tags: { subjectId: 'matematik', gradeLevels: [9], outcomes },
})

/** Yanıt gövdesi `inject().json()` gibi gevşek erişilir (okuma testleriyle aynı); alanları assert doğrular. */
type Json = ReturnType<typeof JSON.parse>

describe('içerik havuzu yazma uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

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
        {
          collection: 'classes',
          id: '9-A',
          data: { id: '9-A', grade: 9, level: 'B1', branchId: 'b-1', teacherId: 't-mat' },
        },
        {
          collection: 'classes',
          id: '10-B',
          data: { id: '10-B', grade: 10, level: 'A2', branchId: 'b-1', teacherId: 't-x' },
        },
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
    const teacher = await createMember(app, institution.id, 'ogretmen', [
      { kind: 'teacher', recordId: 't-mat' },
    ])
    const otherTeacher = await createMember(app, institution.id, 'ogretmen')
    const student = await createMember(app, institution.id, 'ogrenci', [
      { kind: 'student', recordId: 's-1' },
    ])
    const parent = await createMember(app, institution.id, 'veli', [
      { kind: 'child', recordId: 's-1' },
    ])
    const frontDesk = await createMember(app, institution.id, 'onburo')
    const cookies = {
      admin: await signInAs(app, institution.admin),
      teacher: await signInAs(app, teacher),
      otherTeacher: await signInAs(app, otherTeacher),
      student: await signInAs(app, student),
      parent: await signInAs(app, parent),
      frontDesk: await signInAs(app, frontDesk),
    }
    return { institution, teacher, otherTeacher, cookies }
  }

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
  const patch = (url: string, cookie: string, body: unknown, version?: number) =>
    call('PATCH', url, cookie, body, version === undefined ? {} : { 'if-match': `"${version}"` })

  async function create(cookie: string, body: unknown = publishable()) {
    const response = await post('/resources', cookie, body)
    assert.equal(response.statusCode, 201, response.body)
    return response.json().data as Json
  }
  async function act(cookie: string, data: Json, action: string, body: unknown = {}) {
    return post(
      `/resources/${data.resource.id}/versions/${data.version.id}/${action}`,
      cookie,
      body,
    )
  }
  async function ok(response: Awaited<ReturnType<typeof post>>, status = 200) {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  /** Kurumun kaynak ve sürüm sayısı ile kayıtların özeti (değişmezlik denetimi). */
  async function snapshot(institutionId: string) {
    const rows = await db
      .select({
        id: resourceVersions.id,
        status: resourceVersions.status,
        title: resourceVersions.title,
        version: resourceVersions.version,
      })
      .from(resourceVersions)
      .where(eq(resourceVersions.institutionId, institutionId))
      .orderBy(resourceVersions.id)
    const owners = await db
      .select({ id: resources.id, scope: resources.shareScope, version: resources.version })
      .from(resources)
      .where(eq(resources.institutionId, institutionId))
      .orderBy(resources.id)
    return { rows, owners }
  }

  test('401 oturumsuz; öğrenci, veli ve ön büro 403; modül kapalı 403', async () => {
    const t = await tenant()
    const data = await create(t.cookies.teacher)
    const urls = [
      '/resources',
      `/resources/${data.resource.id}/versions`,
      `/resources/${data.resource.id}/versions/${data.version.id}/submit`,
      `/resources/${data.resource.id}/share`,
      `/resources/${data.resource.id}/copy`,
      `/resources/${data.resource.id}/remove`,
    ]
    for (const url of urls) {
      assert.equal((await post(url, undefined, publishable())).statusCode, 401, url)
      for (const cookie of [t.cookies.student, t.cookies.parent, t.cookies.frontDesk]) {
        const response = await post(url, cookie, publishable())
        assert.equal(response.statusCode, 403, url)
        assert.equal(response.json().code, 'forbidden')
      }
    }
    const denied = await patch(
      `/resources/${data.resource.id}/versions/${data.version.id}`,
      t.cookies.student,
      { title: 'Değişti' },
      1,
    )
    assert.equal(denied.statusCode, 403)
    const closed = await createInstitution(app, { enabledModules: { learning: false } })
    const response = await post('/resources', await signInAs(app, closed.admin), publishable())
    assert.equal(response.statusCode, 403)
    assert.equal(response.json().code, 'module_disabled')
  })

  test('DOM-KYN-001: oluşturma 201 + Location, kalıcı, denetim kaydı; 400/422 hiçbir kayıt yazmaz', async () => {
    const t = await tenant()
    const before = await snapshot(t.institution.id)
    for (const body of [{ ...publishable(), title: 'x' }, { title: 'Eksik içerik' }]) {
      const response = await post('/resources', t.cookies.teacher, body)
      assert.equal(response.statusCode, 400, JSON.stringify(body))
      assert.equal(response.json().code, 'validation_failed')
    }
    const file = await post('/resources', t.cookies.teacher, {
      ...publishable(),
      content: { type: 'file', fileId: 'dosya-1' },
    })
    assert.equal(file.statusCode, 422)
    assert.equal(file.json().code, 'resource_files_unsupported')
    const quiz = await post('/resources', t.cookies.teacher, {
      ...publishable(),
      content: {
        type: 'quiz',
        items: [{ questionVersionId: randomUUID() }, { questionVersionId: 'yok' }],
      },
    })
    assert.equal(quiz.statusCode, 422)
    assert.equal(quiz.json().code, 'quiz_item_missing')
    assert.equal(quiz.json().issues.length, 2)
    assert.equal(
      (await post('/resources', t.cookies.teacher, publishable(), { 'if-match': '"1"' }))
        .statusCode,
      400,
    )
    assert.deepEqual(await snapshot(t.institution.id), before)

    // Gövdedeki kurum kimliği etkisizdir: kurum yalnız oturumdan gelir.
    const response = await post('/resources', t.cookies.teacher, {
      ...publishable(),
      institutionId: 'baska',
    })
    assert.equal(response.statusCode, 201)
    const data = response.json().data
    const [stored] = await db
      .select({ institutionId: resources.institutionId })
      .from(resources)
      .where(eq(resources.id, data.resource.id))
    assert.equal(stored?.institutionId, t.institution.id)
    assert.equal(response.headers.location, `/api/v1/resources/${data.resource.id}`)
    assert.equal(data.resource.ownerUserId, t.teacher.id)
    assert.equal(data.resource.shareScope, 'private')
    assert.equal(data.resource.currentVersionId, null)
    assert.equal(data.version.status, 'draft')
    assert.equal(data.version.versionNumber, 1)
    assert.equal(data.version.authorUserId, t.teacher.id)
    assert.equal(data.version.rowVersion, 1)
    const detail = (await call('GET', `/resources/${data.resource.id}`, t.cookies.teacher)).json()
    assert.equal(detail.data.head.title, 'Kesirlerle okuma')
    assert.deepEqual(detail.data.head.tags.outcomes, outcomes)
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, t.institution.id), eq(auditLog.action, 'resource.create')),
      )
    assert.equal(audit?.entityId, data.resource.id)
    assert.equal(audit?.actorUserId, t.teacher.id)
    // Arama yeni kaydı bulur (search_vector core `searchDocument`'tan yazıldı).
    const found = (await call('GET', '/resources?q=kesir', t.cookies.teacher)).json()
    assert.deepEqual(
      found.data.map((item: Json) => item.id),
      [data.resource.id],
    )
  })

  test('Idempotency-Key: aynı istek ilk yanıtı tekrarlar ve tek kayıt yazar; farklı istek 422', async () => {
    const t = await tenant()
    const key = randomUUID()
    const first = await post('/resources', t.cookies.teacher, publishable(), {
      'idempotency-key': key,
    })
    const second = await post('/resources', t.cookies.teacher, publishable(), {
      'idempotency-key': key,
    })
    assert.equal(first.statusCode, 201)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal(second.headers.location, first.headers.location)
    assert.deepEqual(second.json(), first.json())
    assert.equal((await snapshot(t.institution.id)).owners.length, 1)
    const reused = await post('/resources', t.cookies.teacher, publishable('Başka'), {
      'idempotency-key': key,
    })
    assert.equal(reused.statusCode, 422)
    assert.equal(reused.json().code, 'idempotency_key_reused')

    // Geçiş de anahtarla tek kez uygulanır.
    const data = first.json().data
    const submitKey = { 'idempotency-key': randomUUID() }
    const url = `/resources/${data.resource.id}/versions/${data.version.id}/submit`
    assert.equal((await post(url, t.cookies.teacher, {}, submitKey)).statusCode, 200)
    const again = await post(url, t.cookies.teacher, {}, submitKey)
    assert.equal(again.statusCode, 200)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assert.equal(
      (await post(url, t.cookies.teacher, {})).statusCode,
      409,
      'anahtarsız ikinci gönderim',
    )
  })

  test('DOM-KYN-041/043: başka kurumun ve okunamayan kaynağın yazma uçları 404; kayıt değişmez', async () => {
    const a = await tenant()
    const b = await tenant()
    const foreign = await create(b.cookies.teacher)
    const own = await create(a.cookies.teacher)
    const before = await snapshot(b.institution.id)
    for (const [cookie, data] of [
      [a.cookies.admin, foreign],
      [a.cookies.teacher, foreign],
      // Aynı kurumda başka öğretmenin özel taslağı okunamaz; varlığı da sızmaz.
      [a.cookies.otherTeacher, own],
    ] as const) {
      const base = `/resources/${data.resource.id}`
      const version = `${base}/versions/${data.version.id}`
      for (const response of [
        await post(`${base}/versions`, cookie),
        await post(`${version}/submit`, cookie),
        await post(`${version}/report`, cookie, { reason: 'Telif ihlali şüphesi' }),
        await post(`${base}/share`, cookie, { scope: 'institution' }),
        await post(`${base}/copy`, cookie),
        await post(`${base}/remove`, cookie, { reason: 'Telif ihlali kabul edildi' }),
        await patch(version, cookie, { title: 'Ele geçirildi' }, 1),
      ])
        assert.equal(response.statusCode, 404, response.body)
    }
    assert.deepEqual(await snapshot(b.institution.id), before)
  })

  test('DOM-KYN-030/032: taslak düzenleme If-Match ister; yayımlanmış sürüm değişmez, yeni sürüm açılır', async () => {
    const t = await tenant()
    const data = await create(t.cookies.teacher, question())
    const url = `/resources/${data.resource.id}/versions/${data.version.id}`
    const missing = await patch(url, t.cookies.teacher, { title: 'Yeni başlık' })
    assert.equal(missing.statusCode, 400)
    assert.equal(missing.json().code, 'if_match_required')
    assert.equal((await patch(url, t.cookies.teacher, { title: 'Yeni başlık' }, 7)).statusCode, 409)
    assert.equal((await patch(url, t.cookies.teacher, {}, 1)).statusCode, 400)
    const typeChange = await patch(
      url,
      t.cookies.teacher,
      { content: publishable().content, answerKey: null },
      1,
    )
    assert.equal(typeChange.statusCode, 422)
    assert.equal(typeChange.json().code, 'content_type_immutable')
    const edited = await ok(await patch(url, t.cookies.teacher, { title: 'Işık ve hız' }, 1))
    assert.equal(edited.version.title, 'Işık ve hız')
    assert.equal(edited.version.rowVersion, 2)
    assert.equal(edited.version.answerKey.correctOptionId, 'b', 'verilmeyen alan aynen kalır')

    // Kendi sınıfıyla paylaşılan kurum özgün içerik onaysız yayımlanır (DOM-KYN-031).
    await ok(
      await post(`/resources/${data.resource.id}/share`, t.cookies.teacher, {
        scope: 'classes',
        classIds: ['9-A'],
      }),
    )
    const published = await ok(await act(t.cookies.teacher, data, 'publish'))
    assert.equal(published.version.status, 'published')
    assert.equal(published.resource.currentVersionId, data.version.id)
    assert.equal(published.version.publishedAt, FIXED_NOW.toISOString())

    // DOM-KYN-024: öğrenci ve veli yayını cevap anahtarsız görür.
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const seen = await call('GET', `/resources/${data.resource.id}`, cookie)
      assert.equal(seen.statusCode, 200)
      assert.equal(seen.body.includes('correctOptionId'), false)
      assert.equal(seen.body.includes('Gizli çözüm'), false)
    }

    const immutable = await patch(url, t.cookies.teacher, { title: 'Sessizce değişti' }, 3)
    assert.equal(immutable.statusCode, 409)
    assert.equal(immutable.json().code, 'version_immutable')
    const [row] = await db
      .select({ title: resourceVersions.title, version: resourceVersions.version })
      .from(resourceVersions)
      .where(eq(resourceVersions.id, data.version.id))
    assert.deepEqual(row, { title: 'Işık ve hız', version: 3 })

    const next = await ok(
      await post(`/resources/${data.resource.id}/versions`, t.cookies.teacher),
      201,
    )
    assert.equal(next.version.versionNumber, 2)
    assert.equal(next.version.status, 'draft')
    assert.equal(next.version.title, 'Işık ve hız')
    const second = await post(`/resources/${data.resource.id}/versions`, t.cookies.teacher)
    assert.equal(second.statusCode, 409)
    assert.equal(second.json().code, 'open_version_exists')
    const draftUrl = `/resources/${data.resource.id}/versions/${next.version.id}`
    await ok(await patch(draftUrl, t.cookies.teacher, { title: 'Işık ve hız (taslak)' }, 1))
    // Öğrenci taslağı görmez; yayındaki sürüm değişmedi.
    const learner = (await call('GET', `/resources/${data.resource.id}`, t.cookies.student)).json()
    assert.equal(learner.data.version.id, data.version.id)
    assert.equal(learner.data.version.title, 'Işık ve hız')
    assert.equal((await call('GET', draftUrl, t.cookies.student)).statusCode, 404)

    // İkinci yayın öncekini aynı işlemde arşivler (DOM-KYN-032).
    const republished = await ok(await act(t.cookies.teacher, next, 'publish'))
    assert.equal(republished.resource.currentVersionId, next.version.id)
    const versions = (await call('GET', `/resources/${data.resource.id}`, t.cookies.teacher)).json()
      .data.versions
    assert.deepEqual(
      versions.map((v: Json) => [v.versionNumber, v.status]),
      [
        [1, 'archived'],
        [2, 'published'],
      ],
    )
  })

  test('DOM-KYN-031: onay akışı; yazar/sahip onaylayamaz, ret gerekçe ister, düzenlenen ret taslağa döner', async () => {
    const t = await tenant()
    const data = await create(t.cookies.teacher)
    await ok(
      await post(`/resources/${data.resource.id}/share`, t.cookies.teacher, {
        scope: 'institution',
      }),
    )
    const direct = await act(t.cookies.teacher, data, 'publish')
    assert.equal(direct.statusCode, 403)
    assert.equal(direct.json().code, 'review_required')
    const incomplete = await create(t.cookies.teacher, { ...publishable(), tags: {} })
    const missing = await act(t.cookies.teacher, incomplete, 'submit')
    assert.equal(missing.statusCode, 422)
    assert.equal(missing.json().code, 'subject_required')
    // İçerik yayım sorunu da core yolunu `issues` olarak taşır (DOM-KYN-010).
    assert.deepEqual(missing.json().issues, [
      { path: ['tags', 'subjectId'], code: 'subject_required', message: 'Dersi seçin.' },
    ])

    assert.equal(
      (await ok(await act(t.cookies.teacher, data, 'submit'))).version.status,
      'in_review',
    )
    const own = await act(t.cookies.teacher, data, 'approve')
    assert.equal(own.statusCode, 403)
    assert.equal(own.json().code, 'resource_action_forbidden')
    assert.equal(
      (await act(t.cookies.otherTeacher, data, 'approve')).statusCode,
      404,
      'inceleme yetkisi yok, görmez',
    )
    const noReason = await act(t.cookies.admin, data, 'reject', { reason: '' })
    assert.equal(noReason.statusCode, 422)
    assert.equal(noReason.json().code, 'reason_required')
    const rejected = await ok(
      await act(t.cookies.admin, data, 'reject', { reason: 'Kazanım eşleşmiyor.' }),
    )
    assert.equal(rejected.version.status, 'rejected')
    assert.equal(rejected.version.rejectionReason, 'Kazanım eşleşmiyor.')
    const edited = await ok(
      await patch(
        `/resources/${data.resource.id}/versions/${data.version.id}`,
        t.cookies.teacher,
        { title: 'Kesirler düzeltildi' },
        rejected.version.rowVersion,
      ),
    )
    assert.equal(edited.version.status, 'draft')
    await ok(await act(t.cookies.teacher, data, 'submit'))
    const stale = await post(
      `/resources/${data.resource.id}/versions/${data.version.id}/approve`,
      t.cookies.admin,
      {},
      { 'if-match': '"1"' },
    )
    assert.equal(stale.statusCode, 409)
    assert.equal(stale.json().code, 'version_conflict')
    const approved = await ok(await act(t.cookies.admin, data, 'approve'))
    assert.equal(approved.version.status, 'published')
    assert.equal(approved.version.reviewedByUserId, t.institution.admin.id)
    assert.equal(approved.resource.currentVersionId, data.version.id)
    const invalid = await act(t.cookies.admin, data, 'approve')
    assert.equal(invalid.statusCode, 409)
    assert.equal(invalid.json().code, 'resource_transition_invalid')
    // Kurum kapsamında yayındaki içeriği öğrenci görür.
    const list = (await call('GET', '/resources', t.cookies.student)).json()
    assert.deepEqual(
      list.data.map((item: Json) => item.id),
      [data.resource.id],
    )
  })

  test('DOM-KYN-025/051: telif bildirimi yayından düşürür; arşiv kaynağı arşivler, yeni sürüm yeniden açar', async () => {
    const t = await tenant()
    const data = await create(t.cookies.teacher)
    await ok(
      await post(`/resources/${data.resource.id}/share`, t.cookies.teacher, {
        scope: 'institution',
      }),
    )
    await ok(await act(t.cookies.teacher, data, 'submit'))
    await ok(await act(t.cookies.admin, data, 'approve'))
    const noReason = await act(t.cookies.otherTeacher, data, 'report', {})
    assert.equal(noReason.statusCode, 400, 'reason gövdede zorunlu')
    const reported = await ok(
      await act(t.cookies.otherTeacher, data, 'report', { reason: 'Kitaptan birebir alınmış.' }),
    )
    assert.equal(reported.version.status, 'in_review')
    assert.equal(
      (await call('GET', `/resources/${data.resource.id}`, t.cookies.student)).statusCode,
      404,
    )
    const republished = await ok(await act(t.cookies.admin, data, 'approve'))
    assert.equal(republished.version.publishedAt, FIXED_NOW.toISOString(), 'ilk yayın anı korunur')

    const foreign = await act(t.cookies.otherTeacher, data, 'archive')
    assert.equal(foreign.statusCode, 403, 'yalnız sahip, zümre başkanı veya yönetici arşivler')
    const archived = await ok(await act(t.cookies.teacher, data, 'archive'))
    assert.equal(archived.version.status, 'archived')
    assert.equal(archived.resource.archivedAt, FIXED_NOW.toISOString())
    assert.equal((await call('GET', '/resources', t.cookies.teacher)).json().meta.total, 0)
    assert.equal(
      (await call('GET', '/resources?status=archived', t.cookies.teacher)).json().meta.total,
      1,
    )
    const reopened = await ok(
      await post(`/resources/${data.resource.id}/versions`, t.cookies.teacher),
      201,
    )
    assert.equal(reopened.resource.archivedAt, null)
    assert.equal(reopened.version.versionNumber, 2)
  })

  /** Sürüm ve kaynak satırlarının tam hali (satır sürümü, arşiv/yayın tarihleri) ve denetim sayısı. */
  async function rowsOf(institutionId: string, resourceId: string) {
    const versions = await db
      .select({
        id: resourceVersions.id,
        number: resourceVersions.versionNumber,
        status: resourceVersions.status,
        rowVersion: resourceVersions.version,
        archivedAt: resourceVersions.archivedAt,
        publishedAt: resourceVersions.publishedAt,
      })
      .from(resourceVersions)
      .where(eq(resourceVersions.resourceId, resourceId))
      .orderBy(resourceVersions.versionNumber)
    const [resource] = await db
      .select({
        rowVersion: resources.version,
        currentVersionId: resources.currentVersionId,
        archivedAt: resources.archivedAt,
      })
      .from(resources)
      .where(eq(resources.id, resourceId))
    const audits = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.institutionId, institutionId))
    return { versions, resource, audits: audits.length }
  }

  test('DOM-KYN-032: sahibi arşivlediği önceki sürüm, yeni sürüm yayımlanınca yeniden arşivlenmez', async () => {
    const t = await tenant()
    const data = await create(t.cookies.teacher)
    await ok(await act(t.cookies.teacher, data, 'submit'))
    await ok(await act(t.cookies.admin, data, 'approve'))
    await ok(await act(t.cookies.teacher, data, 'archive'))
    const v2 = await ok(
      await post(`/resources/${data.resource.id}/versions`, t.cookies.teacher),
      201,
    )
    await ok(await act(t.cookies.teacher, v2, 'submit'))
    const before = await rowsOf(t.institution.id, data.resource.id)
    const [first] = before.versions
    assert.equal(first?.status, 'archived')
    assert.equal(
      before.resource?.currentVersionId,
      data.version.id,
      'arşiv güncel sürümü değiştirmez',
    )

    const published = await ok(await act(t.cookies.admin, v2, 'approve'))
    assert.equal(published.resource.currentVersionId, v2.version.id)
    const after = await rowsOf(t.institution.id, data.resource.id)
    assert.deepEqual(after.versions[0], first, 'önceki sürümün arşiv tarihi ve satır sürümü sabit')
    assert.equal(after.versions[1]?.status, 'published')
  })

  test('DOM-KYN-032: arşivli olmayan kaynakta yeni sürüm kaynak satırına dokunmaz; eldeki If-Match geçerli kalır', async () => {
    const t = await tenant()
    const data = await create(t.cookies.teacher)
    await ok(await act(t.cookies.teacher, data, 'submit'))
    const approved = await ok(await act(t.cookies.admin, data, 'approve'))
    const before = await rowsOf(t.institution.id, data.resource.id)
    const opened = await ok(
      await post(`/resources/${data.resource.id}/versions`, t.cookies.teacher),
      201,
    )
    assert.equal(opened.resource.rowVersion, approved.resource.rowVersion)
    const after = await rowsOf(t.institution.id, data.resource.id)
    assert.deepEqual(after.resource, before.resource)
    const shared = await post(
      `/resources/${data.resource.id}/share`,
      t.cookies.teacher,
      { scope: 'private' },
      { 'if-match': `"${approved.resource.rowVersion}"` },
    )
    assert.equal(shared.statusCode, 200, shared.body)
  })

  test('DOM-KYN-032: geçiş ortasında hata çıkarsa hiçbir satır ve denetim kaydı değişmez', async () => {
    const t = await tenant()
    const data = await create(t.cookies.teacher)
    await ok(await act(t.cookies.teacher, data, 'submit'))
    await ok(await act(t.cookies.admin, data, 'approve'))
    const v2 = await ok(
      await post(`/resources/${data.resource.id}/versions`, t.cookies.teacher),
      201,
    )
    await ok(await act(t.cookies.teacher, v2, 'submit'))
    const before = await rowsOf(t.institution.id, data.resource.id)
    // Önceki sürümün arşivlenmesi, yeni sürüm ve kaynak satırı yazıldıktan sonra serileştirme hatası verir.
    await db.execute(sql`
      CREATE FUNCTION f3b_fail_archive() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'önceki sürüm çakışması' USING ERRCODE = '40001';
      END $$ LANGUAGE plpgsql`)
    await db.execute(
      sql.raw(`CREATE TRIGGER f3b_fail_archive BEFORE UPDATE ON resource_versions
        FOR EACH ROW WHEN (NEW.id = '${data.version.id}' AND NEW.status = 'archived')
        EXECUTE FUNCTION f3b_fail_archive()`),
    )
    try {
      const failed = await act(t.cookies.admin, v2, 'approve')
      assert.equal(failed.statusCode, 409, failed.body)
    } finally {
      await db.execute(sql`DROP TRIGGER f3b_fail_archive ON resource_versions`)
      await db.execute(sql`DROP FUNCTION f3b_fail_archive()`)
    }
    assert.deepEqual(await rowsOf(t.institution.id, data.resource.id), before)
    // Hata giderilince aynı istek geçer.
    const published = await ok(await act(t.cookies.admin, v2, 'approve'))
    assert.equal(published.resource.currentVersionId, v2.version.id)
  })

  test('DOM-KYN-051: kaldırma yalnız yönetici, gerekçeyle; içerik silinir, kopyalar ve quizler listelenir', async () => {
    const t = await tenant()
    const item = await create(t.cookies.teacher, question())
    await ok(
      await post(`/resources/${item.resource.id}/share`, t.cookies.teacher, {
        scope: 'classes',
        classIds: ['9-A'],
      }),
    )
    await ok(await act(t.cookies.teacher, item, 'publish'))
    const quiz = await create(t.cookies.teacher, {
      ...publishable('Işık quizi'),
      content: { type: 'quiz', items: [{ questionVersionId: item.version.id, points: 5 }] },
    })
    // Kurum kapsamındaki yayından başka öğretmenin kopyası (DOM-KYN-050).
    const source = await seedResource(db, t.institution.id, {
      ownerUserId: t.teacher.id,
      shareScope: 'institution',
      versions: [{ status: 'published', input: publishable('Kaynak metin') as never }],
    })
    const copy = await ok(
      await post(`/resources/${source.resource.id}/copy`, t.cookies.otherTeacher),
      201,
    )

    const base = `/resources/${item.resource.id}/remove`
    assert.equal(
      (await post(base, t.cookies.teacher, { reason: 'Telif ihlali kabul edildi.' })).statusCode,
      403,
    )
    const short = await post(base, t.cookies.admin, { reason: 'x' })
    assert.equal(short.statusCode, 422)
    assert.equal(short.json().code, 'reason_required')
    const removed = await ok(
      await post(base, t.cookies.admin, { reason: 'Telif ihlali kabul edildi.' }),
    )
    assert.deepEqual(removed.versionIds, [item.version.id])
    assert.deepEqual(removed.affectedContainerVersionIds, [quiz.version.id])
    assert.deepEqual(removed.affectedCopyIds, [])
    assert.equal(removed.resource.archivedAt, FIXED_NOW.toISOString())
    const [row] = await db
      .select({
        status: resourceVersions.status,
        content: resourceVersions.content,
        answerKey: resourceVersions.answerKey,
        title: resourceVersions.title,
        reason: resourceVersions.removalReason,
        found: sql<boolean>`${resourceVersions.searchVector} @@ to_tsquery('simple', 'isik:*')`,
        hidden: sql<boolean>`${resourceVersions.searchVector} @@ to_tsquery('simple', 'hiz:*')`,
      })
      .from(resourceVersions)
      .where(eq(resourceVersions.id, item.version.id))
    assert.deepEqual(row, {
      status: 'removed',
      content: null,
      answerKey: null,
      title: 'Işık sorusu',
      reason: 'Telif ihlali kabul edildi.',
      found: true,
      hidden: false,
    })
    assert.equal(
      (await call('GET', `/resources/${item.resource.id}`, t.cookies.student)).statusCode,
      404,
    )
    assert.equal(
      (await call('GET', `/resources/${item.resource.id}`, t.cookies.otherTeacher)).statusCode,
      404,
    )
    const again = await post(base, t.cookies.admin, { reason: 'Telif ihlali kabul edildi.' })
    assert.equal(again.statusCode, 409)
    assert.equal(again.json().code, 'resource_removed')

    const sourceRemoved = await ok(
      await post(`/resources/${source.resource.id}/remove`, t.cookies.admin, {
        reason: 'Kişisel veri içeriyor.',
      }),
    )
    assert.deepEqual(sourceRemoved.affectedCopyIds, [copy.resource.id])
  })

  test('DOM-KYN-040: paylaşım öğretmen kapsamıyla sınırlı; kurumda olmayan hedef 422; hedef değişince eskisi arşivlenir', async () => {
    const t = await tenant()
    const data = await create(t.cookies.teacher)
    const url = `/resources/${data.resource.id}/share`
    const before = await snapshot(t.institution.id)
    const outside = await post(url, t.cookies.teacher, { scope: 'classes', classIds: ['10-B'] })
    assert.equal(outside.statusCode, 403)
    assert.equal(outside.json().code, 'share_target_out_of_scope')
    assert.equal((await post(url, t.cookies.teacher, { scope: 'students' })).statusCode, 400)
    assert.equal((await post(url, t.cookies.teacher, { scope: 'everyone' })).statusCode, 400)
    assert.deepEqual(await snapshot(t.institution.id), before)

    const shared = await ok(
      await post(url, t.cookies.teacher, { scope: 'classes', classIds: ['9-A'] }),
    )
    assert.equal(shared.resource.shareScope, 'classes')
    assert.deepEqual(shared.resource.sharedClassIds, ['9-A'])
    assert.equal(shared.resource.rowVersion, 2)
    const stale = await post(url, t.cookies.teacher, { scope: 'private' }, { 'if-match': '"1"' })
    assert.equal(stale.statusCode, 409)
    // Yönetici yayındaki kaynağı görür ve kurumun her hedefine paylaşabilir.
    await ok(await act(t.cookies.teacher, data, 'publish'))
    const missing = await post(url, t.cookies.admin, { scope: 'classes', classIds: ['12-Z'] })
    assert.equal(missing.statusCode, 422)
    assert.equal(missing.json().code, 'share_target_not_found')
    const students = await ok(
      await post(url, t.cookies.admin, { scope: 'students', studentIds: ['s-1'] }),
    )
    assert.deepEqual(students.resource.sharedClassIds, [])
    assert.deepEqual(students.resource.sharedStudentIds, ['s-1'])
    const shares = await db
      .select({ kind: resourceShares.targetKind, archivedAt: resourceShares.archivedAt })
      .from(resourceShares)
      .where(eq(resourceShares.resourceId, data.resource.id))
      .orderBy(resourceShares.targetKind)
    assert.deepEqual(
      shares.map((share) => [share.kind, share.archivedAt === null]),
      [
        ['class', false],
        ['student', true],
      ],
    )
    assert.equal((await post(url, t.cookies.otherTeacher, { scope: 'private' })).statusCode, 404)
  })

  test('DOM-KYN-040: öğretmen ders vermediği öğrenciyle paylaşamaz; ders verdiğiyle paylaşır, hiçbir kayıt değişmez', async () => {
    const t = await tenant()
    const data = await create(t.cookies.teacher)
    const url = `/resources/${data.resource.id}/share`
    const before = await snapshot(t.institution.id)
    const outside = await post(url, t.cookies.teacher, {
      scope: 'students',
      studentIds: ['s-1', 's-2'],
    })
    assert.equal(outside.statusCode, 403)
    assert.equal(outside.json().code, 'share_target_out_of_scope')
    assert.deepEqual(await snapshot(t.institution.id), before)
    const own = await ok(
      await post(url, t.cookies.teacher, { scope: 'students', studentIds: ['s-1'] }),
    )
    assert.deepEqual(own.resource.sharedStudentIds, ['s-1'])
    // Yönetici yayındaki kaynağı görür ve kurumdaki her öğrenciyle paylaşabilir.
    await ok(await act(t.cookies.teacher, data, 'publish'))
    const admin = await ok(
      await post(url, t.cookies.admin, { scope: 'students', studentIds: ['s-1', 's-2'] }),
    )
    assert.deepEqual(admin.resource.sharedStudentIds, ['s-1', 's-2'])
  })

  test('DOM-KYN-025/051: denetim kaydı yalnız alan adlarını taşır; gerekçe ve içerik değeri yazılmaz', async () => {
    const t = await tenant()
    const data = await create(t.cookies.teacher, question())
    await ok(
      await post(`/resources/${data.resource.id}/share`, t.cookies.teacher, {
        scope: 'institution',
      }),
    )
    await ok(await act(t.cookies.teacher, data, 'submit'))
    const rejected = await ok(
      await act(t.cookies.admin, data, 'reject', { reason: 'Gerekçe-gizli-ret' }),
    )
    await ok(
      await patch(
        `/resources/${data.resource.id}/versions/${data.version.id}`,
        t.cookies.teacher,
        { title: 'Işık sorusu düzeltildi' },
        rejected.version.rowVersion,
      ),
    )
    await ok(await act(t.cookies.teacher, data, 'submit'))
    await ok(await act(t.cookies.admin, data, 'approve'))
    await ok(
      await act(t.cookies.otherTeacher, data, 'report', { reason: 'Gerekçe-gizli-bildirim' }),
    )
    await ok(
      await post(`/resources/${data.resource.id}/remove`, t.cookies.admin, {
        reason: 'Gerekçe-gizli-kaldırma',
      }),
    )
    const rows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.institutionId, t.institution.id))
    const resourceRows = rows.filter((row) => row.action.startsWith('resource.'))
    const actions = resourceRows.map((row) => row.action)
    for (const action of ['reject', 'report', 'remove'])
      assert.ok(actions.includes(`resource.${action}`), `${action} denetim kaydı var`)
    for (const row of resourceRows) {
      assert.deepEqual(Object.keys(row.changes as object), ['fields'], row.action)
      const text = JSON.stringify(row.changes)
      for (const secret of ['Gerekçe-gizli', 'Gizli çözüm', 'Işık hangi', 'Saniyede'])
        assert.ok(!text.includes(secret), `${row.action}: ${secret} yazılmamalı`)
      for (const field of (row.changes as { fields: unknown[] }).fields)
        assert.equal(typeof field, 'string')
    }
  })

  test('DOM-KYN-050: kopya soyu ve lisans mirası; kopyalanamayan kaynaklar', async () => {
    const t = await tenant()
    const attribution = {
      work: 'Kesirler Kitabı',
      author: 'A. Yazar',
      source: 'Yayınevi',
      year: 2020,
    }
    const license = {
      kind: 'licensed_publication',
      publisher: 'Örnek Yayınevi',
      contractNumber: 'SZ-2026-01',
      coverage: 'Tüm öğrenciler',
      expiryDate: '2027-06-30',
      restrictedToBookOwners: false,
      allowsAdaptation: true,
    }
    const source = await seedResource(db, t.institution.id, {
      ownerUserId: t.teacher.id,
      shareScope: 'institution',
      versions: [
        {
          status: 'published',
          input: {
            ...publishable('Lisanslı metin'),
            license,
            attributions: [attribution],
          } as never,
        },
      ],
    })
    const copy = await ok(
      await post(`/resources/${source.resource.id}/copy`, t.cookies.otherTeacher),
      201,
    )
    assert.equal(copy.resource.ownerUserId, t.otherTeacher.id)
    assert.equal(copy.resource.shareScope, 'private')
    assert.equal(copy.resource.derivedFromVersionId, source.versions[0]!.id)
    assert.equal(copy.version.status, 'draft')
    assert.deepEqual(copy.version.license, license)
    assert.deepEqual(copy.version.attributions, [attribution])
    const url = `/resources/${copy.resource.id}/versions/${copy.version.id}`
    const changed = await patch(
      url,
      t.cookies.otherTeacher,
      { license: { kind: 'institution_original' } },
      1,
    )
    assert.equal(changed.statusCode, 422)
    assert.equal(changed.json().code, 'license_inherited')
    const dropped = await patch(url, t.cookies.otherTeacher, { attributions: [] }, 1)
    assert.equal(dropped.statusCode, 422)
    assert.equal(dropped.json().code, 'attribution_inherited')
    await ok(await patch(url, t.cookies.otherTeacher, { title: 'Uyarlanmış metin' }, 1))

    const draftOnly = await create(t.cookies.teacher)
    const unpublished = await post(`/resources/${draftOnly.resource.id}/copy`, t.cookies.teacher)
    assert.equal(unpublished.statusCode, 409)
    assert.equal(unpublished.json().code, 'copy_source_not_published')
    const locked = await seedResource(db, t.institution.id, {
      ownerUserId: t.teacher.id,
      shareScope: 'institution',
      versions: [
        {
          status: 'published',
          input: {
            ...publishable('Kilitli'),
            license: { ...license, allowsAdaptation: false },
            attributions: [attribution],
          } as never,
        },
      ],
    })
    const forbidden = await post(`/resources/${locked.resource.id}/copy`, t.cookies.otherTeacher)
    assert.equal(forbidden.statusCode, 403)
    assert.equal(forbidden.json().code, 'license_forbids_copy')
  })
})
