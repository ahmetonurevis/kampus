import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { dayKey } from '@kampus/school-core/lib/format.ts'

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
import { SAMPLE, sampleRows } from './support/collections-sample.ts'

/**
 * Tarih aralığı süzgeci: `dateField` ile seçilen alan (koleksiyon başına izin listesi),
 * `dateFrom`/`dateTo` Europe/Istanbul günü, iki uç dahil. Liste ve sayım aynı süzgeci uygular.
 */

const invoice = (id: string, studentId: string, dueDate: string, paidAt: string | null) => ({
  collection: 'invoices' as const,
  id,
  data: { id, studentId, dueDate, paidAt, amount: 100_00, installment: 1, method: null },
})

/**
 * Europe/Istanbul gün sınırları: 2026-10-05T21:00Z = 6 Ekim 00:00, 2026-10-31T21:00Z = 1 Kasım 00:00.
 * a ve b vadesi sınırın iki yanındadır; c ve d ödenmemiştir (`paidAt` boş).
 */
const INVOICES = [
  invoice('test-d-a', 's1', '2026-10-05T21:00:00.000Z', '2026-10-06T10:00:00.000Z'),
  invoice('test-d-b', 's1', '2026-10-05T20:59:59.999Z', '2026-10-31T20:59:59.999Z'),
  invoice('test-d-c', 's2', '2026-11-10', '2026-10-31T21:00:00.000Z'),
  invoice('test-d-d', 's11', '2026-10-06', null),
]

describe('tarih aralığı süzgeci: dateField', () => {
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
    const rows = [...sampleRows().filter((row) => row.collection !== 'invoices'), ...INVOICES]
    await insertMissingRecords(db, created.id, rows, FIXED_NOW)
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }

  async function member(
    institutionId: string,
    role: Role,
    links: Parameters<typeof createMember>[3] = [],
  ) {
    return signInAs(app, await createMember(app, institutionId, role, links))
  }

  const get = (url: string, cookie: string) =>
    app.inject({ method: 'GET', url, headers: { cookie } })

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

  describe('taksit: dueDate ve paidAt', () => {
    test('varsayılan alan dueDate; gün Europe/Istanbul gün başlangıcına göre, iki uç dahil', async () => {
      const { adminCookie } = await institution()
      const day = 'dateFrom=2026-10-06&dateTo=2026-10-06'
      // a: 6 Ekim 00:00 (dahil), b: 5 Ekim 23:59 (dışarıda), d: gün biçimli 6 Ekim.
      assert.deepEqual(await ids(adminCookie, 'invoices', day), ['test-d-a', 'test-d-d'])
      assert.deepEqual(await ids(adminCookie, 'invoices', `dateField=dueDate&${day}`), [
        'test-d-a',
        'test-d-d',
      ])
      assert.deepEqual(await ids(adminCookie, 'invoices', 'dateTo=2026-10-05'), ['test-d-b'])
      assert.deepEqual(await ids(adminCookie, 'invoices', 'dateFrom=2026-11-01'), ['test-d-c'])
    })

    test('paidAt aralığı: ödenmemiş taksit eşleşmez; gün sınırı 1 Kasım 00:00 İstanbul', async () => {
      const { adminCookie } = await institution()
      const paid = (query: string) => ids(adminCookie, 'invoices', `dateField=paidAt&${query}`)
      assert.deepEqual(await paid('dateFrom=2026-10-01&dateTo=2026-10-31'), [
        'test-d-a',
        'test-d-b',
      ])
      assert.deepEqual(await paid('dateFrom=2026-11-01&dateTo=2026-11-30'), ['test-d-c'])
      // Ödenmemiş (`paidAt` boş) hiçbir aralığa girmez.
      assert.deepEqual(await paid('dateFrom=2020-01-01'), ['test-d-a', 'test-d-b', 'test-d-c'])
      assert.deepEqual(await paid('dateTo=2030-01-01'), ['test-d-a', 'test-d-b', 'test-d-c'])
    })

    test('durum ve öğrenci süzgeciyle birleşir; sayım ucu aynı kayıtları sayar', async () => {
      const { adminCookie } = await institution()
      const query = 'dateField=paidAt&dateFrom=2026-10-01&dateTo=2026-10-31'
      assert.deepEqual(await ids(adminCookie, 'invoices', `${query}&studentId=s1`), [
        'test-d-a',
        'test-d-b',
      ])
      assert.deepEqual(
        await ids(adminCookie, 'invoices', `${query}&status=${encodeURIComponent('Gecikmiş')}`),
        [],
      )
      assert.equal(await counted(adminCookie, 'invoices', query), 2)
      assert.equal(
        await counted(adminCookie, 'invoices', 'dateFrom=2026-10-06&dateTo=2026-10-06'),
        2,
      )
      const sums = await get(
        `/api/v1/collections/invoices/counts?groupBy=status&sum=amount&${query}`,
        adminCookie,
      )
      assert.deepEqual(sums.json().data, [{ value: 'Ödendi', count: 2, sum: 200_00 }])
    })

    test('DOM-YTK-025: veli yalnız kendi çocuklarının taksitini aralıkta görür', async () => {
      const { id } = await institution()
      const parent = await member(id, 'veli', [{ kind: 'child', recordId: 's1' }])
      const student = await member(id, 'ogrenci', [{ kind: 'student', recordId: 's11' }])
      const query = 'dateFrom=2026-10-01&dateTo=2026-12-31'
      assert.deepEqual(await ids(parent, 'invoices', query), ['test-d-a', 'test-d-b'])
      assert.deepEqual(await ids(parent, 'invoices', `dateField=paidAt&${query}`), [
        'test-d-a',
        'test-d-b',
      ])
      assert.deepEqual(await ids(student, 'invoices', query), ['test-d-d'])
      assert.equal(await counted(parent, 'invoices', query), 2)
      assert.equal(await counted(student, 'invoices', `dateField=paidAt&${query}`), 0)
    })

    test('başka kurumun taksitleri aralıkta görünmez', async () => {
      await institution()
      const other = await createInstitution(app)
      const cookie = await signInAs(app, other.admin)
      assert.deepEqual(await ids(cookie, 'invoices', 'dateFrom=2020-01-01'), [])
      assert.equal(await counted(cookie, 'invoices', 'dateFrom=2020-01-01'), 0)
    })
  })

  describe('genel alan seçimi', () => {
    test('hedef: deadline ve createdAt seçilebilir; sonuç çekirdek gün anahtarıyla aynı', async () => {
      const { adminCookie } = await institution()
      const goals = SAMPLE.studentGoals ?? []
      const inRange = (field: string, from: string, to: string) =>
        goals
          .filter((goal) => {
            const value = goal[field]
            if (typeof value !== 'string') return false
            const day = dayKey(value)
            return day >= from && day <= to
          })
          .map((goal) => String(goal.id))
      for (const [field, from, to] of [
        ['deadline', '2026-11-01', '2026-12-31'],
        ['createdAt', '2026-10-01', '2026-10-31'],
      ] as const) {
        const expected = inRange(field, from, to)
        assert.ok(expected.length > 0, field)
        const actual = await ids(
          adminCookie,
          'studentGoals',
          `dateField=${field}&dateFrom=${from}&dateTo=${to}`,
        )
        assert.deepEqual([...actual].sort(), [...expected].sort(), field)
      }
    })

    test('varsayılan (dateField yok) eski davranışı korur: date alanı', async () => {
      const { adminCookie } = await institution()
      const day = '2026-10-06'
      const explicit = await ids(adminCookie, 'attendance', `dateField=date&dateFrom=${day}`)
      assert.deepEqual(await ids(adminCookie, 'attendance', `dateFrom=${day}`), explicit)
    })

    test('izin listesinde olmayan alan 400 ve Türkçe mesaj; aralık olmasa da denetlenir', async () => {
      const { adminCookie } = await institution()
      const cases: [string, string][] = [
        ['invoices', 'dateField=date&dateFrom=2026-10-06'],
        ['grades', 'dateField=dueDate'],
        ['grades', 'dateField=paidAt&dateFrom=2026-10-06'],
        ['attendance', 'dateField=dueDate'],
        ['students', 'dateField=date'],
      ]
      for (const [collection, query] of cases) {
        const response = await get(`/api/v1/collections/${collection}?${query}`, adminCookie)
        assert.equal(response.statusCode, 400, `${collection}?${query}`)
        const body = response.json()
        assert.equal(body.code, 'validation_failed')
        assert.equal(body.issues[0].path[0], 'dateField')
        assert.equal(typeof body.issues[0].message, 'string')
        const counts = await get(
          `/api/v1/collections/${collection}/counts?groupBy=studentId&${query}`,
          adminCookie,
        )
        assert.equal(counts.statusCode, 400, `counts ${collection}?${query}`)
      }
      // Hiçbir koleksiyonda tanımlı olmayan alan şemada reddedilir.
      const unknown = await get('/api/v1/collections/invoices?dateField=secret', adminCookie)
      assert.equal(unknown.statusCode, 400)
      assert.equal(unknown.json().code, 'validation_failed')
    })

    test('oturumsuz 401; modül/rol reddi aralıktan önce gelir', async () => {
      const { id } = await institution()
      const unauthenticated = await app.inject({
        method: 'GET',
        url: '/api/v1/collections/invoices?dateField=paidAt&dateFrom=2026-10-06',
      })
      assert.equal(unauthenticated.statusCode, 401)
      const teacher = await member(id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
      const denied = await get(
        '/api/v1/collections/invoices?dateField=paidAt&dateFrom=2026-10-06',
        teacher,
      )
      assert.equal(denied.statusCode, 403)
    })
  })
})
