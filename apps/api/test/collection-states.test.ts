import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
} from './support/app.ts'
import { sampleRows } from './support/collections-sample.ts'

/**
 * Durum süzgeçleri: ders programında `cancelled` (iptal edilen ders), teslimlerde `graded`
 * (`score` dolu). Liste ve sayım aynı süzgeci uygular; kapsam her rolde korunur.
 */

const lesson = (id: string, classId: string, extra: Record<string, unknown> = {}) => ({
  collection: 'schedule' as const,
  id,
  data: {
    id,
    classId,
    teacherId: 't1',
    subjectId: 'math',
    title: 'Matematik',
    date: '2026-10-07T07:40:00.000Z',
    ...extra,
  },
})
const submission = (id: string, studentId: string, extra: Record<string, unknown> = {}) => ({
  collection: 'submissions' as const,
  id,
  data: { id, homeworkId: 'test-hw', studentId, ...extra },
})

// Core: `cancelledAt` doğruluk değeridir; boş metin ve `null` iptal değildir.
const LESSONS = [
  lesson('test-l-a', 'c1'),
  lesson('test-l-b', 'c1', { cancelledAt: '2026-10-05T09:00:00.000Z' }),
  lesson('test-l-c', 'c1', { cancelledAt: '' }),
  lesson('test-l-d', 'c2', { cancelledAt: '2026-10-05T10:00:00.000Z' }),
  lesson('test-l-e', 'c2', { cancelledAt: null }),
]
// Core: `score == null` notlanmamıştır; `0` puandır.
const SUBMISSIONS = [
  submission('test-s-a', 's1', { score: 80 }),
  submission('test-s-b', 's1', { score: 0 }),
  submission('test-s-c', 's2', { score: null }),
  submission('test-s-d', 's2'),
  submission('test-s-e', 's11', { score: 55 }),
]

describe('durum süzgeçleri: cancelled ve graded', () => {
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

  async function institution() {
    const created = await createInstitution(app)
    await insertMissingRecords(
      db,
      created.id,
      [...sampleRows(), ...LESSONS, ...SUBMISSIONS],
      FIXED_NOW,
    )
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }

  async function member(
    institutionId: string,
    role: Role,
    links: Parameters<typeof createMember>[3] = [],
  ) {
    return signInAs(app, await createMember(app, institutionId, role, links))
  }

  const get = (url: string, cookie?: string) =>
    app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} })

  async function ids(cookie: string, collection: string, query: string) {
    const response = await get(`/api/v1/collections/${collection}?pageSize=100&${query}`, cookie)
    assert.equal(response.statusCode, 200, `${query} ${response.body}`)
    const body = response.json()
    assert.equal(body.meta.total, body.data.length, query)
    return body.data.map((item: { id: string }) => item.id)
  }

  async function counted(cookie: string, collection: string, query: string) {
    const response = await get(
      `/api/v1/collections/${collection}/counts?groupBy=studentId&${query}`,
      cookie,
    )
    assert.equal(response.statusCode, 200, `${query} ${response.body}`)
    return response.json().meta.total as number
  }

  describe('schedule: cancelled', () => {
    test('iptal edilen ders yalnız true ile gelir, false ile dışlanır; boş metin ve null iptal değildir', async () => {
      const { adminCookie } = await institution()
      const all = await ids(adminCookie, 'schedule', '')
      assert.deepEqual(all, ['test-l-a', 'test-l-b', 'test-l-c', 'test-l-d', 'test-l-e'])
      assert.deepEqual(await ids(adminCookie, 'schedule', 'cancelled=true'), [
        'test-l-b',
        'test-l-d',
      ])
      assert.deepEqual(await ids(adminCookie, 'schedule', 'cancelled=false'), [
        'test-l-a',
        'test-l-c',
        'test-l-e',
      ])
      // Diğer süzgeçlerle birleşir.
      assert.deepEqual(await ids(adminCookie, 'schedule', 'cancelled=false&classId=c2'), [
        'test-l-e',
      ])
      assert.deepEqual(
        await ids(adminCookie, 'schedule', 'cancelled=true&dateFrom=2026-10-07&dateTo=2026-10-07'),
        ['test-l-b', 'test-l-d'],
      )
    })

    test('sayım ucu listeyle aynı kayıtları sayar', async () => {
      const { adminCookie } = await institution()
      const response = await get(
        '/api/v1/collections/schedule/counts?groupBy=classId&cancelled=false',
        adminCookie,
      )
      assert.equal(response.statusCode, 200, response.body)
      assert.deepEqual(response.json().data, [
        { value: 'c1', count: 2 },
        { value: 'c2', count: 1 },
      ])
      assert.equal(response.json().meta.total, 3)
    })

    test('DOM-YTK-024/025: veli ve öğrenci yalnız kendi sınıfının dersini görür', async () => {
      const { id } = await institution()
      const parent = await member(id, 'veli', [{ kind: 'child', recordId: 's1' }])
      const student = await member(id, 'ogrenci', [{ kind: 'student', recordId: 's2' }])
      assert.deepEqual(await ids(parent, 'schedule', 'cancelled=true'), ['test-l-b'])
      assert.deepEqual(await ids(parent, 'schedule', 'cancelled=false'), ['test-l-a', 'test-l-c'])
      assert.deepEqual(await ids(student, 'schedule', 'cancelled=true'), ['test-l-d'])
      assert.equal(await counted(parent, 'schedule', 'cancelled=true'), 1)
      assert.equal(await counted(student, 'schedule', 'cancelled=false'), 1)
    })

    test('başka kurumun dersleri görünmez', async () => {
      await institution()
      const cookie = await signInAs(app, (await createInstitution(app)).admin)
      assert.deepEqual(await ids(cookie, 'schedule', 'cancelled=true'), [])
      assert.equal(await counted(cookie, 'schedule', 'cancelled=false'), 0)
    })
  })

  describe('submissions: graded', () => {
    test('score dolu notlanmıştır (0 dahil), boş ya da eksik notlanmamıştır', async () => {
      const { adminCookie } = await institution()
      assert.deepEqual(await ids(adminCookie, 'submissions', 'graded=true'), [
        'test-s-a',
        'test-s-b',
        'test-s-e',
      ])
      assert.deepEqual(await ids(adminCookie, 'submissions', 'graded=false'), [
        'test-s-c',
        'test-s-d',
      ])
      assert.deepEqual(await ids(adminCookie, 'submissions', 'graded=false&studentId=s1'), [])
      assert.equal(await counted(adminCookie, 'submissions', 'graded=true'), 3)
      assert.equal(await counted(adminCookie, 'submissions', 'graded=false'), 2)
    })

    test('DOM-YTK-022/025: öğretmen kapsamındaki, öğrenci ve veli kendi teslimini süzer', async () => {
      const { id } = await institution()
      const teacher = await member(id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
      const parent = await member(id, 'veli', [{ kind: 'child', recordId: 's2' }])
      const student = await member(id, 'ogrenci', [{ kind: 'student', recordId: 's11' }])
      // `s11` öğretmen t1'in sınıflarında değildir.
      assert.deepEqual(await ids(teacher, 'submissions', 'graded=true'), ['test-s-a', 'test-s-b'])
      assert.deepEqual(await ids(parent, 'submissions', 'graded=false'), ['test-s-c', 'test-s-d'])
      assert.deepEqual(await ids(parent, 'submissions', 'graded=true'), [])
      assert.deepEqual(await ids(student, 'submissions', 'graded=true'), ['test-s-e'])
      assert.equal(await counted(teacher, 'submissions', 'graded=true'), 2)
    })

    test('başka kurumun teslimleri görünmez', async () => {
      await institution()
      const cookie = await signInAs(app, (await createInstitution(app)).admin)
      assert.deepEqual(await ids(cookie, 'submissions', 'graded=false'), [])
    })
  })

  test('geçersiz kullanım 400 ve Türkçe mesaj: başka koleksiyon, geçersiz değer', async () => {
    const { adminCookie } = await institution()
    const cases: [string, string, string][] = [
      ['grades', 'cancelled=true', 'cancelled'],
      ['submissions', 'cancelled=false', 'cancelled'],
      ['schedule', 'graded=true', 'graded'],
      ['invoices', 'graded=false', 'graded'],
      ['schedule', 'cancelled=evet', 'cancelled'],
      ['submissions', 'graded=1', 'graded'],
    ]
    for (const [collection, query, field] of cases) {
      for (const path of [
        `/api/v1/collections/${collection}?${query}`,
        `/api/v1/collections/${collection}/counts?groupBy=studentId&${query}`,
      ]) {
        const response = await get(path, adminCookie)
        assert.equal(response.statusCode, 400, path)
        const body = response.json()
        assert.equal(body.code, 'validation_failed', path)
        assert.equal(body.issues[0].path[0], field, path)
      }
    }
    const wrong = await get('/api/v1/collections/grades?cancelled=true', adminCookie)
    assert.equal(wrong.json().issues[0].message, 'Bu süzgeç yalnız ders programında kullanılır.')
  })

  test('oturumsuz 401', async () => {
    assert.equal((await get('/api/v1/collections/schedule?cancelled=true')).statusCode, 401)
    assert.equal(
      (await get('/api/v1/collections/submissions/counts?groupBy=studentId&graded=true'))
        .statusCode,
      401,
    )
  })
})
