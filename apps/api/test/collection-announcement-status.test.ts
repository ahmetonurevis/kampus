import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import type { MembershipLinkInput } from '../src/services/identity.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'

/**
 * Duyuru listesinin durum süzgeci (`status`, OG-218; DOM-ILT-003, DOM-ILT-004): durum okuyucuya
 * göre türetilir (geri çekildi > okunmadı > güncellendi > yayında), `meta.total` süzülmüş sayıdır,
 * bilinmeyen değer 400'dür ve kapsam süzgeçle genişlemez.
 */

const SEED = createSeed(FIXED_NOW)
const CLASS_IDS = ['c1', 'c12']
const STUDENT_IDS = new Set(
  SEED.students.filter((item) => CLASS_IDS.includes(item.classId)).map((item) => item.id),
)
const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  subjects: SEED.subjects,
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASS_IDS.includes(item.id)),
  students: SEED.students.filter((item) => STUDENT_IDS.has(item.id)),
  assignments: SEED.assignments.filter((item) => CLASS_IDS.includes(item.classId)),
}

function rows() {
  return Object.entries(SAMPLE).flatMap(([collection, items]) =>
    (items ?? []).map((data) => {
      const name = collection as CollectionName
      const id = recordKey(name, data)
      if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
      return { collection: name, id, data }
    }),
  )
}

describe('duyuru listesi: durum süzgeci', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-annst-${String(++serial).padStart(5, '0')}` })

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function member(institutionId: string, role: Role, links: MembershipLinkInput[] = []) {
    return signInAs(app, await createMember(app, institutionId, role, links))
  }

  function send(method: 'POST' | 'PATCH', url: string, cookie: string, body: unknown, extra = {}) {
    return app.inject({
      method,
      url,
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json', cookie, ...extra },
      payload: JSON.stringify(body),
    })
  }
  const get = (cookie: string, query: string) =>
    app.inject({
      method: 'GET',
      url: `/api/v1/collections/announcements?${query}`,
      headers: { origin: TEST_ORIGIN, cookie },
    })

  async function titles(cookie: string, query: string) {
    const response = await get(cookie, `pageSize=100&sort=title&${query}`)
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json()
    assert.equal(body.meta.total, body.data.length, query)
    return (body.data as { record: { title: string } }[]).map((item) => item.record.title)
  }

  /**
   * Kurum: 7-A velisine dört duyuru (okunmadı, okunmuş, düzeltilmiş+okunmuş, geri çekilmiş) ve
   * düzeltilmiş ama okunmamış bir beşinci; 8-B velisine ayrı duyuru.
   */
  async function setup() {
    const created = await createInstitution(app)
    await insertMissingRecords(db, created.id, rows(), FIXED_NOW)
    const admin = await signInAs(app, created.admin)
    const mother = await member(created.id, 'veli', [{ kind: 'child', recordId: 's1' }])
    const other = await member(created.id, 'veli', [{ kind: 'child', recordId: 's12' }])
    const student = await member(created.id, 'ogrenci', [{ kind: 'student', recordId: 's1' }])
    const publish = async (title: string, classId = 'c1', roles = ['veli']) => {
      const response = await send(
        'POST',
        '/api/v1/announcements',
        admin,
        {
          title,
          text: `${title} metni`,
          category: 'Akademik',
          target: { classIds: [classId], roles },
        },
        key(),
      )
      assert.equal(response.statusCode, 201, response.body)
      return response.json().data.entity.id as string
    }
    const read = async (cookie: string, id: string) =>
      assert.equal(
        (await send('POST', `/api/v1/announcements/${id}/read`, cookie, {})).statusCode,
        200,
      )
    const revise = async (id: string) =>
      assert.equal(
        (
          await send('PATCH', `/api/v1/announcements/${id}`, admin, {
            text: `${id} düzeltilmiş metin`,
          })
        ).statusCode,
        200,
      )
    const ids = {
      unread: await publish('A okunmadı'),
      read: await publish('B okundu'),
      revisedRead: await publish('C düzeltildi okundu'),
      withdrawn: await publish('D geri çekildi'),
      revisedUnread: await publish('E düzeltildi okunmadı'),
      theirs: await publish('F 8-B duyurusu', 'c12'),
    }
    await read(mother, ids.read)
    await read(mother, ids.revisedRead)
    await read(other, ids.theirs)
    await revise(ids.revisedRead)
    await revise(ids.revisedUnread)
    const withdraw = await send('POST', `/api/v1/announcements/${ids.withdrawn}/withdraw`, admin, {
      reason: 'Tarih yanlış yazıldı',
    })
    assert.equal(withdraw.statusCode, 200, withdraw.body)
    return { institutionId: created.id, admin, mother, other, student, ids }
  }

  const q = (...values: string[]) => values.map((value) => `status=${encodeURIComponent(value)}`)

  test('DOM-ILT-003, DOM-ILT-004: veli durumu kendi okumasına göre süzer; meta.total süzülmüş sayıdır', async () => {
    const { mother } = await setup()
    assert.deepEqual(await titles(mother, ''), [
      'A okunmadı',
      'B okundu',
      'C düzeltildi okundu',
      'D geri çekildi',
      'E düzeltildi okunmadı',
    ])
    assert.deepEqual(await titles(mother, q('Okunmadı').join('&')), [
      'A okunmadı',
      'E düzeltildi okunmadı',
    ])
    assert.deepEqual(await titles(mother, q('Güncellendi').join('&')), ['C düzeltildi okundu'])
    assert.deepEqual(await titles(mother, q('Yayında').join('&')), ['B okundu'])
    assert.deepEqual(await titles(mother, q('Geri çekildi').join('&')), ['D geri çekildi'])
    // Çoklu değer birleşimdir.
    assert.deepEqual(await titles(mother, q('Güncellendi', 'Geri çekildi').join('&')), [
      'C düzeltildi okundu',
      'D geri çekildi',
    ])
  })

  test('sunucu sayfalaması süzülmüş sayıya göre çalışır', async () => {
    const { mother } = await setup()
    const response = await get(mother, 'page=2&pageSize=1&sort=title&status=Okunmad%C4%B1')
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json()
    assert.equal(body.meta.total, 2)
    assert.equal(body.meta.pageSize, 1)
    assert.deepEqual(
      body.data.map((item: { record: { title: string } }) => item.record.title),
      ['E düzeltildi okunmadı'],
    )
  })

  test('yönetici okunmadı durumu görmez: aynı duyurular yayında ya da güncellendi sayılır', async () => {
    const { admin } = await setup()
    assert.deepEqual(await titles(admin, q('Okunmadı').join('&')), [])
    assert.deepEqual(await titles(admin, q('Güncellendi').join('&')), [
      'C düzeltildi okundu',
      'E düzeltildi okunmadı',
    ])
    assert.deepEqual(await titles(admin, q('Yayında').join('&')), [
      'A okunmadı',
      'B okundu',
      'F 8-B duyurusu',
    ])
    assert.deepEqual(await titles(admin, q('Geri çekildi').join('&')), ['D geri çekildi'])
  })

  test('kapsam: süzgeç başka sınıfın duyurusunu göstermez', async () => {
    const { mother, other } = await setup()
    for (const status of ['Okunmadı', 'Güncellendi', 'Yayında', 'Geri çekildi']) {
      const mine = await titles(mother, q(status).join('&'))
      assert.ok(!mine.includes('F 8-B duyurusu'), status)
    }
    assert.deepEqual(await titles(other, q('Yayında').join('&')), ['F 8-B duyurusu'])
    assert.deepEqual(
      await titles(other, q('Okunmadı', 'Güncellendi', 'Geri çekildi').join('&')),
      [],
    )
  })

  test('öğrenci hedef kitlede değilse süzgeçle de duyuru görmez', async () => {
    const { student } = await setup()
    assert.deepEqual(await titles(student, ''), [])
    assert.deepEqual(await titles(student, q('Okunmadı', 'Yayında').join('&')), [])
  })

  test('başka kurum: süzgeç yalnız etkin kurumun duyurusunu döndürür', async () => {
    await setup()
    const other = await createInstitution(app)
    await insertMissingRecords(db, other.id, rows(), FIXED_NOW)
    const admin = await signInAs(app, other.admin)
    for (const status of ['Okunmadı', 'Güncellendi', 'Yayında', 'Geri çekildi'])
      assert.deepEqual(await titles(admin, q(status).join('&')), [], status)
  })

  test('400: bilinmeyen durum değeri; kayıtlar değişmez', async () => {
    const { mother } = await setup()
    for (const query of ['status=Bilinmiyor', 'status=Okunmad%C4%B1&status=Taslak', 'status=%27']) {
      const response = await get(mother, query)
      assert.equal(response.statusCode, 400, query)
      assert.equal(response.json().code, 'validation_failed')
    }
    assert.equal((await titles(mother, '')).length, 5)
  })

  test('sayım ucu liste ile aynı süzgeci uygular', async () => {
    const { mother } = await setup()
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/collections/announcements/counts?groupBy=category&status=Okunmad%C4%B1',
      headers: { origin: TEST_ORIGIN, cookie: mother },
    })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().meta.total, 2)
  })

  test('401: oturumsuz istek', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/collections/announcements?status=Okunmad%C4%B1',
    })
    assert.equal(response.statusCode, 401)
  })
})
