import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
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
 * İçerik havuzu okuma uçları (`GET /resources`, `/resources/:id`, `/resources/:id/versions/:id`).
 * Kayıtlar depo fonksiyonuyla eklenir (yazma ucu sonraki dilimde).
 */

const question = {
  content: {
    type: 'question' as const,
    question: {
      questionType: 'multiple_choice' as const,
      stem: 'Işık hangi hızla yayılır?',
      options: [
        { id: 'a', text: 'Ses hızıyla' },
        { id: 'b', text: 'Saniyede yaklaşık 300.000 km' },
        { id: 'c', text: 'Saniyede 1 km' },
        { id: 'd', text: 'Yayılmaz' },
      ],
    },
  },
  answerKey: {
    questionType: 'multiple_choice' as const,
    correctOptionId: 'b',
    explanation: 'Gizli çözüm açıklaması',
  },
}

describe('içerik havuzu okuma uçları', () => {
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

  async function tenant(
    overrides: { type?: InstitutionType; enabledModules?: Record<string, boolean> } = {},
  ) {
    const institution = await createInstitution(app, overrides)
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
          collection: 'students',
          id: 's-1',
          data: { id: 's-1', name: 'Deniz Yılmaz', classId: '9-A', isActive: true },
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
    return { institution, teacher, otherTeacher, student, parent, cookies }
  }

  const get = (url: string, cookie?: string) =>
    app.inject({
      method: 'GET',
      url: `/api/v1${url}`,
      headers: { origin: TEST_ORIGIN, ...(cookie ? { cookie } : {}) },
    })

  test('401 oturumsuz; ön büro 403; modül kapalı 403 module_disabled', async () => {
    const t = await tenant()
    const { resource } = await seedResource(db, t.institution.id, { ownerUserId: t.teacher.id })
    for (const url of ['/resources', `/resources/${resource.id}`]) {
      assert.equal((await get(url)).statusCode, 401)
      const denied = await get(url, t.cookies.frontDesk)
      assert.equal(denied.statusCode, 403)
      assert.equal(denied.json().code, 'forbidden')
    }
    const closed = await createInstitution(app, { enabledModules: { learning: false } })
    const response = await get('/resources', await signInAs(app, closed.admin))
    assert.equal(response.statusCode, 403)
    assert.equal(response.json().code, 'module_disabled')
  })

  test('400: beyaz liste dışı süzgeç, geçersiz değer ve kimlik; öğrenciye personel süzgeci', async () => {
    const t = await tenant()
    for (const query of [
      'institutionId=x',
      'sort=owner',
      'gradeLevel=3',
      'pageSize=101',
      'skill=x',
    ]) {
      const response = await get(`/resources?${query}`, t.cookies.admin)
      assert.equal(response.statusCode, 400, query)
      assert.equal(response.json().code, 'validation_failed')
    }
    assert.equal((await get('/resources/not-a-uuid', t.cookies.admin)).statusCode, 400)
    const staffOnly = await get('/resources?status=draft', t.cookies.student)
    assert.equal(staffOnly.statusCode, 400)
    assert.equal(staffOnly.json().issues[0].code, 'staff_only_filter')
    assert.equal((await get('/resources?status=draft', t.cookies.teacher)).statusCode, 200)
  })

  test('DOM-KYN-041: başka kurumun kaynağı 404 ve listede yok', async () => {
    const a = await tenant()
    const b = await tenant()
    const { resource, versions } = await seedResource(db, b.institution.id, {
      ownerUserId: b.teacher.id,
      shareScope: 'institution',
      versions: [{ status: 'published' }],
    })
    assert.equal((await get(`/resources/${resource.id}`, a.cookies.admin)).statusCode, 404)
    assert.equal(
      (await get(`/resources/${resource.id}/versions/${versions[0]!.id}`, a.cookies.admin))
        .statusCode,
      404,
    )
    const list = await get('/resources', a.cookies.admin)
    assert.equal(list.statusCode, 200)
    assert.deepEqual(list.json().data, [])
    assert.equal(
      (await get(`/resources/${randomUUID()}`, a.cookies.admin)).statusCode,
      404,
      'olmayan kimlik',
    )
  })

  test('DOM-KYN-024/030/041: öğrenci ve veliye taslak ve answerKey gitmez; personel tam sürümü görür', async () => {
    const t = await tenant()
    const { resource, versions } = await seedResource(db, t.institution.id, {
      ownerUserId: t.teacher.id,
      shareScope: 'classes',
      sharedClassIds: ['9-A'],
      versions: [
        { status: 'published', input: { title: 'Işık soruları', ...question } },
        { status: 'draft', input: { title: 'Işık soruları taslak', ...question } },
      ],
    })
    const [published, draft] = versions as [(typeof versions)[0], (typeof versions)[0]]
    const hidden = await seedResource(db, t.institution.id, {
      ownerUserId: t.teacher.id,
      shareScope: 'classes',
      sharedClassIds: ['9-A'],
      versions: [{ status: 'draft', input: { title: 'Yalnız taslak' } }],
    })

    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const list = await get('/resources', cookie)
      assert.equal(list.statusCode, 200)
      const body = list.json()
      assert.equal(body.meta.total, 1)
      assert.deepEqual(Object.keys(body.data[0]).sort(), ['contentType', 'id', 'version', 'view'])
      assert.equal(body.data[0].view, 'learner')
      assert.equal(body.data[0].version.id, published.id)

      const detail = await get(`/resources/${resource.id}`, cookie)
      assert.equal(detail.statusCode, 200)
      const text = detail.body
      assert.equal(detail.json().data.view, 'learner')
      assert.equal(detail.json().data.version.id, published.id)
      for (const secret of ['answerKey', 'correctOptionId', 'Gizli çözüm', 'taslak', 'license"'])
        assert.equal(text.includes(secret), false, secret)

      assert.equal(
        (await get(`/resources/${resource.id}/versions/${draft.id}`, cookie)).statusCode,
        404,
      )
      const version = await get(`/resources/${resource.id}/versions/${published.id}`, cookie)
      assert.equal(version.statusCode, 200)
      assert.equal(version.body.includes('correctOptionId'), false)
      assert.equal((await get(`/resources/${hidden.resource.id}`, cookie)).statusCode, 404)
    }

    // Kişiye sabit karıştırma: aynı kişi iki okumada aynı sırayı görür.
    const first = (await get(`/resources/${resource.id}`, t.cookies.student)).json()
    const second = (await get(`/resources/${resource.id}`, t.cookies.student)).json()
    assert.deepEqual(first.data.version.content, second.data.version.content)

    // Sahip baş sürüm olarak taslağı, cevap anahtarıyla görür; başka öğretmen hiçbirini görmez
    // (kapsam `classes`, kendi öğrencileri değil).
    const owner = (await get(`/resources/${resource.id}`, t.cookies.teacher)).json().data
    assert.equal(owner.view, 'staff')
    assert.equal(owner.head.id, draft.id)
    assert.equal(owner.head.answerKey.correctOptionId, 'b')
    assert.deepEqual(
      owner.versions.map((v: { id: string }) => v.id),
      [published.id, draft.id],
    )
    assert.deepEqual(owner.resource.sharedClassIds, ['9-A'])
    // Taslağın yayım eksikleri listelenir (ders ve kazanım etiketi yok; DOM-KYN-010).
    assert.ok(
      owner.publicationIssues.some((issue: { code: string }) => issue.code === 'subject_required'),
    )
    const ownerList = (await get('/resources', t.cookies.teacher)).json()
    assert.equal(ownerList.meta.total, 2)
    assert.equal((await get(`/resources/${resource.id}`, t.cookies.otherTeacher)).statusCode, 404)
    // Yönetici yayındaki sürümü okur; sahibi etkin olduğundan taslağı görmez (DOM-KYN-052).
    const admin = (await get(`/resources/${resource.id}`, t.cookies.admin)).json().data
    assert.equal(admin.head.id, published.id)
    assert.equal(
      (await get(`/resources/${resource.id}/versions/${draft.id}`, t.cookies.admin)).statusCode,
      404,
    )
  })

  test('arama: Türkçe karakter ve NFKD duyarsız önek; cevap anahtarı aranmaz', async () => {
    const t = await tenant()
    const light = await seedResource(db, t.institution.id, {
      ownerUserId: t.teacher.id,
      versions: [{ input: { title: 'IŞIK ve gölge', ...question } }],
    })
    const file = await seedResource(db, t.institution.id, {
      ownerUserId: t.teacher.id,
      versions: [
        { input: { title: 'Dosya düzeni', content: { type: 'text', body: 'ﬁlm şeridi' } } },
      ],
    })
    const ids = async (q: string) =>
      (await get(`/resources?q=${encodeURIComponent(q)}`, t.cookies.teacher))
        .json()
        .data.map((item: { id: string }) => item.id)
    for (const q of ['isik', 'ışık', 'IŞIK', 'Isı', 'golge ISIK'])
      assert.deepEqual(await ids(q), [light.resource.id], q)
    assert.deepEqual(await ids('film'), [file.resource.id])
    assert.deepEqual(await ids('ﬁlm'), [file.resource.id])
    assert.deepEqual(await ids('şerit'), [])
    assert.deepEqual(await ids('çözüm'), [], 'cevap anahtarındaki açıklama aranmaz')
    assert.deepEqual(await ids('isik dosya'), [])
  })

  test('sayfalama, sıralama ve süzgeçler baş sürüme uygulanır', async () => {
    const t = await tenant()
    const titles = ['Ağaç', 'Bulut', 'Çiçek', 'Deniz', 'Elma']
    const seeded = []
    for (const [index, title] of titles.entries())
      seeded.push(
        await seedResource(
          db,
          t.institution.id,
          {
            ownerUserId: t.teacher.id,
            versions: [{ input: { title, tags: { gradeLevels: [index % 2 === 0 ? 9 : 10] } } }],
          },
          new Date(FIXED_NOW.getTime() + index * 60_000),
        ),
      )
    const page = async (query: string) => {
      const response = await get(`/resources?${query}`, t.cookies.teacher)
      assert.equal(response.statusCode, 200, query)
      return response.json() as {
        data: { version: { title: string } }[]
        meta: { page: number; pageSize: number; total: number }
      }
    }
    const titleOf = (body: Awaited<ReturnType<typeof page>>) =>
      body.data.map((item) => item.version.title)
    const first = await page('pageSize=2')
    assert.deepEqual(first.meta, { page: 1, pageSize: 2, total: 5 })
    assert.deepEqual(titleOf(first), ['Elma', 'Deniz'])
    assert.deepEqual(titleOf(await page('pageSize=2&page=3')), ['Ağaç'])
    assert.deepEqual(titleOf(await page('pageSize=2&page=4')), [])
    assert.deepEqual(titleOf(await page('sort=title&pageSize=3')), ['Ağaç', 'Bulut', 'Çiçek'])
    const grade10 = await page('gradeLevel=10')
    assert.deepEqual(titleOf(grade10), ['Deniz', 'Bulut'])
    assert.equal(grade10.meta.total, 2)
    assert.equal((await page('status=published')).meta.total, 0)
    assert.equal((await page(`ownerUserId=${t.teacher.id}`)).meta.total, 5)
    assert.equal((await page('contentType=quiz')).meta.total, 0)
  })

  test('dil okulu öğrencisi sınıf seviyesine uyan güncel yayını görür', async () => {
    const t = await tenant({ type: 'language_school' })
    const match = await seedResource(db, t.institution.id, {
      ownerUserId: t.teacher.id,
      shareScope: 'institution',
      versions: [{ status: 'published', input: { tags: { cefrLevel: 'B1' } } }],
    })
    await seedResource(db, t.institution.id, {
      ownerUserId: t.teacher.id,
      shareScope: 'institution',
      versions: [{ status: 'published', input: { tags: { cefrLevel: 'A2' } } }],
    })
    const list = (await get('/resources', t.cookies.student)).json()
    assert.deepEqual(
      list.data.map((item: { id: string }) => item.id),
      [match.resource.id],
    )
    assert.equal((await get('/resources?cefrLevel=A2', t.cookies.student)).json().meta.total, 0)
  })
})
