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

  describe('aday: deneme dersi tarihi (trialLesson.date), IST-091', () => {
    const prospect = (id: string, trialDate: unknown, extra: Record<string, unknown> = {}) => ({
      collection: 'prospects' as const,
      id,
      data: {
        id,
        name: id,
        stage: 'Deneme dersi',
        ...(trialDate === undefined
          ? {}
          : { trialLesson: { lessonId: 'l1', classId: 'c1', date: trialDate, duration: 45 } }),
        ...extra,
      },
    })

    /**
     * Europe/Istanbul gün sınırı: 2026-10-05T21:00Z = 6 Ekim 00:00. a ve b sınırın iki yanında,
     * c gün biçimli, d ayın sonunda (30 Ekim 23:59 İstanbul = 20:59Z), e deneme dersi yok ama
     * görüşme (`trialAt`) aynı günde: `dateField` seçilmedikçe ve seçilince farklı alanı süzer.
     */
    const PROSPECTS = [
      prospect('test-p-a', '2026-10-05T21:00:00.000Z'),
      prospect('test-p-b', '2026-10-05T20:59:59.999Z'),
      prospect('test-p-c', '2026-10-06'),
      prospect('test-p-d', '2026-10-30T20:59:59.999Z'),
      prospect('test-p-e', undefined, { trialAt: '2026-10-06T10:00:00.000Z' }),
    ]

    async function withProspects() {
      const created = await createInstitution(app, { type: 'language_school' })
      await insertMissingRecords(db, created.id, PROSPECTS, FIXED_NOW)
      return { ...created, adminCookie: await signInAs(app, created.admin) }
    }

    const trial = (query: string) => `dateField=trialLesson.date&${query}`

    test('gün aralığı Europe/Istanbul gün başlangıcına göre, iki uç dahil', async () => {
      const { adminCookie } = await withProspects()
      const day = trial('dateFrom=2026-10-06&dateTo=2026-10-06')
      // a: 6 Ekim 00:00 İstanbul (dahil), b: 5 Ekim 23:59 (dışarıda), c: gün biçimli, e: deneme yok.
      assert.deepEqual(await ids(adminCookie, 'prospects', day), ['test-p-a', 'test-p-c'])
      assert.deepEqual(await ids(adminCookie, 'prospects', trial('dateTo=2026-10-05')), [
        'test-p-b',
      ])
      assert.deepEqual(await ids(adminCookie, 'prospects', trial('dateFrom=2026-10-31')), [])
      assert.deepEqual(
        await ids(adminCookie, 'prospects', trial('dateFrom=2026-10-30&dateTo=2026-10-30')),
        ['test-p-d'],
      )
      assert.deepEqual(
        await ids(adminCookie, 'prospects', trial('dateFrom=2026-10-01&dateTo=2026-10-31')),
        ['test-p-a', 'test-p-b', 'test-p-c', 'test-p-d'],
      )
    })

    test('görüşme alanı (trialAt) ve deneme dersi alanı birbirinden bağımsızdır', async () => {
      const { adminCookie } = await withProspects()
      const day = 'dateFrom=2026-10-06&dateTo=2026-10-06'
      assert.deepEqual(await ids(adminCookie, 'prospects', `dateField=trialAt&${day}`), [
        'test-p-e',
      ])
      assert.deepEqual(await ids(adminCookie, 'prospects', `dateField=createdAt&${day}`), [])
    })

    test('sayım ucu aynı kayıtları sayar', async () => {
      const { adminCookie } = await withProspects()
      const query = trial('dateFrom=2026-10-06&dateTo=2026-10-06')
      const response = await get(
        `/api/v1/collections/prospects/counts?groupBy=stage&${query}`,
        adminCookie,
      )
      assert.equal(response.statusCode, 200, response.body)
      assert.deepEqual(response.json().data, [{ value: 'Deneme dersi', count: 2 }])
      assert.equal(response.json().meta.total, 2)
      // Aylık gruplama aynı iç içe alanı okur.
      const monthly = await get(
        `/api/v1/collections/prospects/counts?groupBy=trialLesson.date:month`,
        adminCookie,
      )
      assert.equal(monthly.statusCode, 200, monthly.body)
      assert.deepEqual(monthly.json().data, [
        { value: '2026-10', count: 4 },
        { value: null, count: 1 },
      ])
    })

    test('izin listesi dışı alan 400: başka koleksiyonun alanı, nesne yolu ve enjeksiyon denemesi', async () => {
      const { adminCookie } = await withProspects()
      const cases: [string, string][] = [
        ['prospects', 'dateField=deadline&dateFrom=2026-10-06'],
        ['prospects', 'dateField=trialLesson&dateFrom=2026-10-06'],
        ['prospects', 'dateField=trialLesson.duration&dateFrom=2026-10-06'],
        ['prospects', `dateField=${encodeURIComponent("trialLesson.date' or true --")}`],
        // Alan yalnız aday koleksiyonunda izinlidir.
        ['students', trial('dateFrom=2026-10-06')],
        ['invoices', trial('dateFrom=2026-10-06')],
      ]
      for (const [collection, query] of cases) {
        for (const suffix of ['', '/counts?groupBy=stage&']) {
          const url = suffix
            ? `/api/v1/collections/${collection}${suffix}${query}`
            : `/api/v1/collections/${collection}?${query}`
          const response = await get(url, adminCookie)
          assert.equal(response.statusCode, 400, url)
          assert.equal(response.json().code, 'validation_failed', url)
          assert.equal(response.json().issues[0].path[0], 'dateField', url)
        }
      }
    })

    test('DOM-YTK-021: öğretmen yalnız kendi deneme sınıfının adayını aralıkta görür', async () => {
      const { id } = await withProspects()
      await insertMissingRecords(
        db,
        id,
        [
          ...sampleRows().filter((row) =>
            ['teachers', 'classes', 'assignments'].includes(row.collection),
          ),
          prospect('test-p-x', '2026-10-06', {
            trialLesson: { lessonId: 'l9', classId: 'c9', date: '2026-10-06', duration: 45 },
          }),
        ],
        FIXED_NOW,
      )
      const teacher = await member(id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
      const found = await ids(teacher, 'prospects', trial('dateFrom=2026-10-06&dateTo=2026-10-06'))
      assert.ok(!found.includes('test-p-x'), JSON.stringify(found))
      assert.deepEqual(found, ['test-p-a', 'test-p-c'])
    })

    test('başka kurumun adayı aralıkta görünmez', async () => {
      await withProspects()
      const other = await signInAs(app, (await createInstitution(app)).admin)
      const query = trial('dateFrom=2020-01-01')
      assert.deepEqual(await ids(other, 'prospects', query), [])
      const counts = await get(`/api/v1/collections/prospects/counts?groupBy=stage&${query}`, other)
      assert.equal(counts.statusCode, 200)
      assert.equal(counts.json().meta.total, 0)
    })
  })

  describe('aylık gruplama: groupBy=<tarih alanı>:month', () => {
    const monthly = async (cookie: string, query: string) => {
      const response = await get(`/api/v1/collections/invoices/counts?${query}`, cookie)
      assert.equal(response.statusCode, 200, `${query} ${response.body}`)
      return response.json() as {
        data: { value: unknown; count: number; sum?: number }[]
        meta: { total: number; sum?: number }
      }
    }

    test('sayı ve toplam Europe/Istanbul ayına göre; tarihsiz değer null grubunda sonda', async () => {
      const { adminCookie } = await institution()
      assert.deepEqual(await monthly(adminCookie, 'groupBy=dueDate:month&sum=amount'), {
        data: [
          { value: '2026-10', count: 3, sum: 300_00 },
          { value: '2026-11', count: 1, sum: 100_00 },
        ],
        meta: { total: 4, sum: 400_00 },
      })
      // c'nin ödemesi UTC'de ekimde, Istanbul'da 1 Kasım 00:00'dır; d ödenmemiştir.
      assert.deepEqual(await monthly(adminCookie, 'groupBy=paidAt:month&sum=amount'), {
        data: [
          { value: '2026-10', count: 2, sum: 200_00 },
          { value: '2026-11', count: 1, sum: 100_00 },
          { value: null, count: 1, sum: 100_00 },
        ],
        meta: { total: 4, sum: 400_00 },
      })
    })

    test('ay sınırı Istanbul gününe göredir: 30 Eylül 21:00Z ekim, 20:59:59.999Z eylül', async () => {
      const { id, adminCookie } = await institution()
      await insertMissingRecords(
        db,
        id,
        [
          invoice('test-d-e', 's1', '2026-09-30T21:00:00.000Z', null),
          invoice('test-d-f', 's1', '2026-09-30T20:59:59.999Z', null),
          invoice('test-d-g', 's1', '2026-12-31T21:00:00.000Z', null),
          invoice('test-d-h', 's1', 'bozuk', null),
        ],
        FIXED_NOW,
      )
      const { data } = await monthly(adminCookie, 'groupBy=dueDate:month')
      assert.deepEqual(data, [
        { value: '2026-09', count: 1 },
        { value: '2026-10', count: 4 },
        { value: '2026-11', count: 1 },
        { value: '2027-01', count: 1 },
        { value: null, count: 1 },
      ])
    })

    test('süzgeç ve arama liste ucuyla aynıdır: grup toplamı liste toplamına eşit', async () => {
      const { adminCookie } = await institution()
      const filter = 'dateField=paidAt&dateFrom=2026-10-01&dateTo=2026-10-31&studentId=s1'
      const grouped = await monthly(adminCookie, `groupBy=paidAt:month&${filter}`)
      assert.deepEqual(grouped.data, [{ value: '2026-10', count: 2 }])
      assert.equal(grouped.meta.total, (await ids(adminCookie, 'invoices', filter)).length)
      const status = encodeURIComponent('Ödendi')
      const paid = await monthly(adminCookie, `groupBy=dueDate:month&status=${status}`)
      assert.equal(paid.meta.total, (await ids(adminCookie, 'invoices', `status=${status}`)).length)
    })

    test('DOM-YTK-025: veli yalnız kendi çocuğunun taksitlerini aylara böler', async () => {
      const { id } = await institution()
      const parent = await member(id, 'veli', [{ kind: 'child', recordId: 's2' }])
      assert.deepEqual(await monthly(parent, 'groupBy=paidAt:month&sum=amount'), {
        data: [{ value: '2026-11', count: 1, sum: 100_00 }],
        meta: { total: 1, sum: 100_00 },
      })
      const student = await member(id, 'ogrenci', [{ kind: 'student', recordId: 's11' }])
      assert.deepEqual((await monthly(student, 'groupBy=paidAt:month')).data, [
        { value: null, count: 1 },
      ])
    })

    test('başka kurum sayılmaz; oturumsuz 401', async () => {
      await institution()
      const other = await signInAs(app, (await createInstitution(app)).admin)
      assert.deepEqual(await monthly(other, 'groupBy=dueDate:month'), {
        data: [],
        meta: { total: 0 },
      })
      const anonymous = await app.inject({
        method: 'GET',
        url: '/api/v1/collections/invoices/counts?groupBy=dueDate:month',
      })
      assert.equal(anonymous.statusCode, 401)
    })

    test('izin dışı tarih alanı ve geçersiz biçim 400', async () => {
      const { adminCookie } = await institution()
      for (const [collection, groupBy] of [
        ['invoices', 'date:month'],
        ['grades', 'paidAt:month'],
        ['invoices', 'studentId:month'],
        ['invoices', 'dueDate:year'],
        ['invoices', 'dueDate:'],
        ['invoices', ':month'],
      ]) {
        const response = await get(
          `/api/v1/collections/${collection}/counts?groupBy=${groupBy}`,
          adminCookie,
        )
        assert.equal(response.statusCode, 400, `${collection} ${groupBy}`)
        const body = response.json()
        assert.equal(body.code, 'validation_failed')
        assert.equal(body.issues[0].path[0], 'groupBy')
      }
    })
  })
})
