import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { asc, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import type { CollectionName } from '../src/db/collections.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { records } from '../src/db/schema/records.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
} from './support/app.ts'
import { sampleRows, SEED } from './support/collections-sample.ts'

/**
 * Koleksiyon okumalarının türetilmiş ve bağlı alanları: taksit durumu süzgeci, toplu sayım ucu,
 * bağlı adla arama ve sıralama. Kapsam ve alan ayıklaması her birinde ayrıca sabitlenir.
 * FIXED_NOW 2026-10-06T09:00Z: Europe/Istanbul günü 2026-10-06.
 */

/** Örnek kesitteki taksitler ödenmiştir; durum dağılımı için ödenmemiş taksitler eklenir. */
const EXTRA_INVOICES = [
  { id: 'test-inv-late-s1', studentId: 's1', dueDate: '2026-10-05', amount: 100_00 },
  { id: 'test-inv-today-s2', studentId: 's2', dueDate: '2026-10-06', amount: 200_00 },
  { id: 'test-inv-late-s11', studentId: 's11', dueDate: '2026-09-01', amount: 400_00 },
].map((item) => ({ ...item, installment: 9, paidAt: null, method: null, reminderAt: null }))

const PAID_SAMPLE = sampleRows().filter((row) => row.collection === 'invoices')

function extraRows(): { collection: CollectionName; id: string; data: Record<string, unknown> }[] {
  return [
    ...SEED.branches.slice(0, 2).map((data) => ({
      collection: 'branches' as const,
      id: data.id,
      data,
    })),
    ...EXTRA_INVOICES.map((data) => ({ collection: 'invoices' as const, id: data.id, data })),
  ]
}

describe('koleksiyon sorguları: durum, sayım, bağlı alan', () => {
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
    await insertMissingRecords(db, created.id, [...sampleRows(), ...extraRows()], FIXED_NOW)
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }

  async function memberCookie(
    institutionId: string,
    role: Role,
    links: Parameters<typeof createMember>[3] = [],
    target: App = app,
  ) {
    return signInAs(target, await createMember(target, institutionId, role, links))
  }

  function get(url: string, cookie?: string, target: App = app) {
    return target.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} })
  }

  async function ids(cookie: string, url: string, target: App = app): Promise<string[]> {
    const response = await get(url, cookie, target)
    assert.equal(response.statusCode, 200, `${url} ${response.body}`)
    const body = response.json()
    assert.equal(body.meta.total, body.data.length, url)
    return body.data.map((item: { id: string }) => item.id)
  }

  function rowsOf(institutionId: string) {
    return db
      .select()
      .from(records)
      .where(eq(records.institutionId, institutionId))
      .orderBy(asc(records.collection), asc(records.id))
  }

  const invoicesUrl = (query: string) => `/api/v1/collections/invoices?pageSize=100&${query}`
  const status = (label: string) => `status=${encodeURIComponent(label)}`

  describe('taksit durumu süzgeci', () => {
    test('durum core invoiceStatus ile türetilir; çoklu değer ve sıralama', async () => {
      const { adminCookie } = await institution()

      assert.deepEqual(await ids(adminCookie, invoicesUrl(status('Gecikmiş'))), [
        'test-inv-late-s1',
        'test-inv-late-s11',
      ])
      assert.deepEqual(await ids(adminCookie, invoicesUrl(status('Yaklaşan'))), [
        'test-inv-today-s2',
      ])
      assert.deepEqual(
        await ids(adminCookie, invoicesUrl(status('Ödendi'))),
        PAID_SAMPLE.map((row) => row.id),
      )
      assert.deepEqual(
        await ids(adminCookie, invoicesUrl(`${status('Yaklaşan')}&${status('Gecikmiş')}`)),
        ['test-inv-late-s1', 'test-inv-today-s2', 'test-inv-late-s11'],
      )
      // Türetilmiş durumla sıralama: Gecikmiş < Ödendi < Yaklaşan (tr-TR), eşitlikte depo sırası.
      const sortedIds = await ids(adminCookie, invoicesUrl('sort=status'))
      assert.deepEqual(sortedIds.slice(0, 2), ['test-inv-late-s1', 'test-inv-late-s11'])
      assert.equal(sortedIds.at(-1), 'test-inv-today-s2')
      // Diğer süzgeçlerle birlikte.
      assert.deepEqual(await ids(adminCookie, invoicesUrl(`${status('Gecikmiş')}&studentId=s11`)), [
        'test-inv-late-s11',
      ])
    })

    test('durum isteğin saatinden hesaplanır: ertesi gün bugünkü vade gecikmiş olur', async () => {
      const { id, admin } = await institution()
      const tomorrow = await buildTestApp(db, {
        clock: () => new Date('2026-10-06T21:00:00.000Z'),
      })
      try {
        const cookie = await signInAs(tomorrow, admin)
        assert.deepEqual(await ids(cookie, invoicesUrl(status('Gecikmiş')), tomorrow), [
          'test-inv-late-s1',
          'test-inv-today-s2',
          'test-inv-late-s11',
        ])
        // Bir milisaniye öncesi hâlâ 2026-10-06 (Europe/Istanbul 23:59:59.999).
        const sameDay = await buildTestApp(db, {
          clock: () => new Date('2026-10-06T20:59:59.999Z'),
        })
        try {
          const sameCookie = await signInAs(sameDay, admin)
          assert.deepEqual(await ids(sameCookie, invoicesUrl(status('Yaklaşan')), sameDay), [
            'test-inv-today-s2',
          ])
        } finally {
          await sameDay.close()
        }
      } finally {
        await tomorrow.close()
      }
      assert.ok(id)
    })

    test('DOM-YTK-025: veli yalnız kendi çocuklarının gecikmiş taksitini görür', async () => {
      const { id } = await institution()
      const cookie = await memberCookie(id, 'veli', [
        { kind: 'child', recordId: 's1' },
        { kind: 'child', recordId: 's2' },
      ])
      assert.deepEqual(await ids(cookie, invoicesUrl(status('Gecikmiş'))), ['test-inv-late-s1'])
      const student = await memberCookie(id, 'ogrenci', [{ kind: 'student', recordId: 's11' }])
      assert.deepEqual(await ids(student, invoicesUrl(status('Gecikmiş'))), ['test-inv-late-s11'])
      const teacher = await memberCookie(id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
      assert.equal((await get(invoicesUrl(status('Gecikmiş')), teacher)).statusCode, 403)
    })

    test('bilinmeyen durum değeri 400; kayıtlar değişmez', async () => {
      const { id, adminCookie } = await institution()
      const before = await rowsOf(id)
      for (const query of [status('gecikmis'), `${status('Ödendi')}&status=x`]) {
        const response = await get(invoicesUrl(query), adminCookie)
        assert.equal(response.statusCode, 400, query)
        assert.equal(response.json().code, 'validation_failed')
        assert.deepEqual(response.json().issues[0].path, ['status'])
      }
      // Durumu saklanan koleksiyonda `status` alan eşitliğidir.
      assert.equal(
        (await get('/api/v1/collections/attendance?status=absent', adminCookie)).statusCode,
        200,
      )
      assert.deepEqual(await rowsOf(id), before)
    })

    test('oturumsuz 401; başka kurumun taksiti durum süzgecinde görünmez', async () => {
      assert.equal((await get(invoicesUrl(status('Gecikmiş')))).statusCode, 401)
      const first = await institution()
      const other = await createInstitution(app)
      const cookie = await signInAs(app, other.admin)
      assert.deepEqual(await ids(cookie, invoicesUrl(status('Gecikmiş'))), [])
      assert.ok(first.id)
    })
  })
})
