import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

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
  type InstitutionOverrides,
} from './support/app.ts'
import { SEED, sampleRows } from './support/collections-sample.ts'

/**
 * Ödeyicisi olunan çocuklar (ON-313; K-04 kullanıcı kararı 2026-11-03; DOM-FIN-052, DOM-ILT-074).
 * Velayeti olmayan ödeyici veli çocuğu `/me` bağlantılarında ve öğrenci okumasında görmez; finans
 * seçicisi `GET /finance/payer-children` ile o çocuğu ad ve sınıf adıyla alır. Ödeyici olmayan
 * velayetsiz veli ve iletişim kısıtlı veli boş liste alır; akademik okumalar kapalı kalır.
 */

type Json = ReturnType<typeof JSON.parse>

const URL = '/api/v1/finance/payer-children'
/** B kurumuna özgü öğrenci: A kurumunda bu kimlikte kayıt yoktur. */
const B_STUDENT = 'test-on313-b-ogrenci'

const studentOf = (id: string) => SEED.students.find((row) => row.id === id)
const classNameOf = (studentId: string) =>
  SEED.classes.find((row) => row.id === studentOf(studentId)?.classId)?.name ?? null

describe('ödeyicisi olunan çocuklar (ON-313, K-04)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  const get = (url: string, cookie?: string) =>
    app.inject({
      method: 'GET',
      url,
      headers: { origin: TEST_ORIGIN, ...(cookie === undefined ? {} : { cookie }) },
    })
  async function data(url: string, cookie: string) {
    const response = await get(url, cookie)
    assert.equal(response.statusCode, 200, `${url}: ${response.body}`)
    return response.json().data as Json
  }

  async function setBond(
    adminCookie: string,
    studentId: string,
    membershipId: string,
    body: Record<string, unknown>,
  ) {
    const bonds = (await data(`/api/v1/students/${studentId}/guardians`, adminCookie)) as Json[]
    const own = bonds.find((bond) => bond.membershipId === membershipId)
    assert.ok(own)
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/students/${studentId}/guardians/${String(own.id)}`,
      headers: {
        origin: TEST_ORIGIN,
        cookie: adminCookie,
        'content-type': 'application/json',
        'if-match': `"${String(own.rowVersion)}"`,
      },
      payload: JSON.stringify(body),
    })
    assert.equal(response.statusCode, 200, response.body)
  }

  /**
   * Kurum: örnek kesit. `s1`'in velayetli velisi `keeper`; `payer` velayetsiz ödeyici, `bystander`
   * velayetsiz ve ödeyici değil, `restricted` iletişim kısıtlı. `mixed` `s2`'nin velayetli velisi
   * ve `s2`'nin ödeyicisidir (velayetli ödeyici).
   */
  async function world(overrides: Partial<InstitutionOverrides> = {}) {
    const institution = await createInstitution(app, overrides)
    await insertMissingRecords(db, institution.id, sampleRows(), FIXED_NOW)
    const admin = await signInAs(app, institution.admin)
    const parent = async (studentId = 's1') => {
      const user = await createMember(app, institution.id, 'veli', [
        { kind: 'child', recordId: studentId },
      ])
      return { ...user, cookie: await signInAs(app, user) }
    }
    const keeper = await parent()
    const payer = await parent()
    const bystander = await parent()
    const restricted = await parent()
    const mixed = await parent('s2')
    await setBond(admin, 's1', payer.membershipId, { custody: 'none', isPayer: true })
    await setBond(admin, 's1', bystander.membershipId, { custody: 'none' })
    await setBond(admin, 's1', restricted.membershipId, {
      custody: 'none',
      contactRestricted: true,
    })
    await setBond(admin, 's2', mixed.membershipId, { isPayer: true })
    return { institution, admin, keeper, payer, bystander, restricted, mixed }
  }

  test('DOM-FIN-052 DOM-ILT-074 velayetsiz ödeyici veli ödediği çocuğu yalnız ad ve sınıf adıyla alır', async () => {
    const w = await world()
    // Sorun: çocuk `/me` bağlantılarında ve öğrenci okumasında yoktur, seçici onu bulamazdı.
    const me = await data('/api/v1/me', w.payer.cookie)
    const links = me.activeMembership.links as Json[]
    assert.equal(
      links.some((link) => link.kind === 'child' && link.recordId === 's1'),
      false,
    )
    assert.equal((await get('/api/v1/collections/students/s1', w.payer.cookie)).statusCode, 404)

    const children = (await data(URL, w.payer.cookie)) as Json[]
    assert.deepEqual(children, [
      { id: 's1', name: studentOf('s1')?.name, className: classNameOf('s1') },
    ])
    assert.ok(classNameOf('s1'))
    // Seçilen çocuğun taksitleri açılır.
    const invoices = (await data(
      '/api/v1/collections/invoices?studentId=s1&pageSize=100',
      w.payer.cookie,
    )) as Json[]
    assert.ok(invoices.length > 0)
    assert.ok(invoices.every((row) => row.record.studentId === 's1'))
  })

  test('DOM-ILT-070 ödeyici bağı akademik kapsamı açmaz: not ve yoklama okunmaz', async () => {
    const w = await world()
    for (const collection of ['grades', 'attendance']) {
      const rows = (await data(
        `/api/v1/collections/${collection}?pageSize=100`,
        w.payer.cookie,
      )) as Json[]
      assert.deepEqual(rows, [], collection)
    }
  })

  test('DOM-ILT-070 ödeyici olmayan velayetsiz veli ve velayetli ama ödeyici olmayan veli boş liste alır', async () => {
    const w = await world()
    assert.deepEqual(await data(URL, w.bystander.cookie), [])
    assert.deepEqual(await data(URL, w.keeper.cookie), [])
  })

  test('DOM-ILT-074 iletişim kısıtlı veli boş liste alır', async () => {
    const w = await world()
    assert.deepEqual(await data(URL, w.restricted.cookie), [])
  })

  test('DOM-FIN-052 velayetli ödeyici veli çocuğunu listede görür', async () => {
    const w = await world()
    assert.deepEqual(
      ((await data(URL, w.mixed.cookie)) as Json[]).map((row) => row.id),
      ['s2'],
    )
  })

  test('başka kurumun öğrencisi listede yok, finans okuması 404', async () => {
    const a = await world()
    const b = await world()
    const bStudent = { ...studentOf('s11'), id: B_STUDENT, name: 'Başka Kurum Öğrencisi' }
    await insertMissingRecords(
      db,
      b.institution.id,
      [{ collection: 'students' as const, id: B_STUDENT, data: bStudent }],
      FIXED_NOW,
    )
    const bParent = await createMember(app, b.institution.id, 'veli', [
      { kind: 'child', recordId: B_STUDENT },
    ])
    await setBond(b.admin, B_STUDENT, bParent.membershipId, { isPayer: true })
    const bCookie = await signInAs(app, bParent)
    assert.deepEqual(
      ((await data(URL, bCookie)) as Json[]).map((row) => row.id),
      [B_STUDENT],
    )

    const listed = (await data(URL, a.payer.cookie)) as Json[]
    assert.deepEqual(
      listed.map((row) => row.id),
      ['s1'],
    )
    assert.equal(
      listed.some((row) => row.name === 'Başka Kurum Öğrencisi'),
      false,
    )
    assert.equal(
      (await get(`/api/v1/finance/students/${B_STUDENT}/balance`, a.payer.cookie)).statusCode,
      404,
    )
  })

  test('DOM-YTK-001 oturumsuz 401, veli dışı roller 403', async () => {
    const w = await world()
    assert.equal((await get(URL)).statusCode, 401)
    assert.equal((await get(URL, w.admin)).statusCode, 403)
    for (const role of ['ogretmen', 'ogrenci', 'onburo'] as const) {
      const member = await createMember(app, w.institution.id, role, [])
      assert.equal((await get(URL, await signInAs(app, member))).statusCode, 403, role)
    }
  })

  test('DOM-YTK-040 finans modülü kapalıyken 403', async () => {
    const w = await world({ enabledModules: { finance: false } })
    const response = await get(URL, w.payer.cookie)
    assert.equal(response.statusCode, 403)
    assert.equal(response.json().code, 'module_disabled')
  })
})
