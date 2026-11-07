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
import { checkFinanceMirrorAfterEach } from './support/finance-mirror.ts'
import { SEED, sampleRows } from './support/collections-sample.ts'
import { lazySession } from './support/finance-sessions.ts'

/**
 * Ödeyici velinin finans okuması (ON-291; K-04 kullanıcı kararı 2026-11-03; DOM-FIN-052,
 * DOM-ILT-074). Velayeti olmayan ödeyici veli ödediği öğrencinin faturasını, tahsilatını (dekont
 * kaynağı), bakiyesini, ekstresini ve sözleşmesini okur. Başka öğrencinin finansı 404'tür; iletişim
 * kısıtlı veli finans okumaz; akademik okumalar ve kayıt koleksiyonları velayette kalır. Ödeyici
 * bağlantısının kurulması OG-1002'dedir (`test/payer-scope.test.ts`).
 */

type Json = ReturnType<typeof JSON.parse>

/** Sözleşmeler örnek kesitte yoktur: `s1` (ödenen) ve `s2` (başka öğrenci) için seed satırları. */
const CONTRACTS = SEED.contracts.filter((row) => ['s1', 's2'].includes(row.studentId))
const contractOf = (studentId: string) => CONTRACTS.find((row) => row.studentId === studentId)
const invoiceOf = (studentId: string) => SEED.invoices.find((row) => row.studentId === studentId)
/** Örnek kesitteki faturalar ödenmiştir; tahsilat için her öğrenciye bir açık taksit eklenir. */
const OPEN_INVOICES = ['s1', 's2'].map((studentId) => ({
  id: `test-on291-inv-${studentId}`,
  studentId,
  installment: 9,
  amount: 10_000,
  dueDate: '2026-11-15T09:00:00.000Z',
  paidAt: null,
  method: null,
  reminderAt: null,
}))

describe('ödeyici velinin finans okuması (ON-291, K-04)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  // ON-046e: her testten sonra taksit ve sözleşme aynası kaynakla aynıdır.
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function send(method: 'GET' | 'POST' | 'PATCH', url: string, cookie: string, body?: unknown) {
    return app.inject({
      method,
      url,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        ...(method === 'POST'
          ? { 'idempotency-key': `test-on291-${String(++serial).padStart(5, '0')}` }
          : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    })
  }
  const get = (cookie: string, url: string) => send('GET', url, cookie)
  async function data(cookie: string, url: string) {
    const response = await get(cookie, url)
    assert.equal(response.statusCode, 200, `${url}: ${response.body}`)
    return response.json().data as Json
  }
  const studentsIn = async (cookie: string, collection: string) =>
    [
      ...new Set(
        ((await data(cookie, `/api/v1/collections/${collection}?pageSize=100`)) as Json[]).map(
          (row) => row.record.studentId as string,
        ),
      ),
    ].sort()

  /**
   * Kurum: örnek kesit (`s1`, `s2`, `s11` faturalı) ve `s1`/`s2` sözleşmesi. `s1`'in iki velisi
   * vardır: velayetli `keeper` ve `payer`; `payer` ödeyici yapılınca velayeti kaldırılır.
   * `restricted` `s1`'in iletişim kısıtlı velisidir. `s1` ve `s2` için birer tahsilat yazılır.
   */
  async function world(overrides: Partial<InstitutionOverrides> = {}) {
    const institution = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      institution.id,
      [
        ...sampleRows(),
        ...CONTRACTS.map((row) => ({ collection: 'contracts' as const, id: row.id, data: row })),
        ...OPEN_INVOICES.map((row) => ({ collection: 'invoices' as const, id: row.id, data: row })),
      ],
      FIXED_NOW,
    )
    const admin = await signInAs(app, institution.admin)
    const parent = async () => {
      const user = await createMember(app, institution.id, 'veli', [
        { kind: 'child', recordId: 's1' },
      ])
      return { ...user, session: lazySession(app, user) }
    }
    const keeper = await parent()
    const payer = await parent()
    const restricted = await parent()
    await setBond(admin, payer.membershipId, { custody: 'none', isPayer: true })
    await setBond(admin, restricted.membershipId, { custody: 'none', contactRestricted: true })
    return { institution, admin, keeper, payer, restricted }
  }

  async function setBond(adminCookie: string, membershipId: string, body: Record<string, unknown>) {
    const bonds = (await data(adminCookie, '/api/v1/students/s1/guardians')) as Json[]
    const own = bonds.find((bond) => bond.membershipId === membershipId)
    assert.ok(own)
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/students/s1/guardians/${String(own.id)}`,
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

  async function pay(adminCookie: string, studentId: string) {
    const response = await send('POST', '/api/v1/payments', adminCookie, {
      studentId,
      amountCents: 1_000,
      method: 'Banka havalesi',
      reference: `TR-ON291-${studentId}`,
    })
    assert.equal(response.statusCode, 201, response.body)
    return response.json().data as Json
  }

  test('DOM-FIN-052 DOM-ILT-074 velayetsiz ödeyici veli ödediği öğrencinin fatura ve sözleşmesini okur, başkasınınkini okumaz', async () => {
    const w = await world()
    assert.deepEqual(await studentsIn(await w.payer.session(), 'invoices'), ['s1'])
    assert.deepEqual(await studentsIn(await w.payer.session(), 'contracts'), ['s1'])
    const own = invoiceOf('s1')
    const other = invoiceOf('s2')
    assert.ok(own && other)
    assert.equal(
      (await get(await w.payer.session(), `/api/v1/collections/invoices/${own.id}`)).statusCode,
      200,
    )
    assert.equal(
      (await get(await w.payer.session(), `/api/v1/collections/invoices/${other.id}`)).statusCode,
      404,
    )
    const ownContract = contractOf('s1')
    const otherContract = contractOf('s2')
    assert.ok(ownContract && otherContract)
    assert.equal(
      (await get(await w.payer.session(), `/api/v1/collections/contracts/${ownContract.id}`))
        .statusCode,
      200,
    )
    assert.equal(
      (await get(await w.payer.session(), `/api/v1/collections/contracts/${otherContract.id}`))
        .statusCode,
      404,
    )
    // Velayetli veli etkilenmez.
    assert.deepEqual(await studentsIn(await w.keeper.session(), 'invoices'), ['s1'])
  })

  test('DOM-FIN-052 DOM-ILT-074 ödeyici veli ödediği öğrencinin tahsilatını ve dekontunu okur; başka öğrencinin tahsilatı 404', async () => {
    const w = await world()
    const own = await pay(w.admin, 's1')
    const other = await pay(w.admin, 's2')
    const listed = await get(await w.payer.session(), '/api/v1/payments')
    assert.equal(listed.statusCode, 200, listed.body)
    assert.deepEqual(
      (listed.json().data as Json[]).map((item) => item.id),
      [own.id],
    )
    assert.equal(listed.json().meta.total, 1)
    const detail = await data(await w.payer.session(), `/api/v1/payments/${String(own.id)}`)
    assert.equal(detail.studentId, 's1')
    assert.equal(detail.receiptNumber, own.receiptNumber)
    assert.equal(detail.amountCents, 1_000)
    assert.equal(
      (await get(await w.payer.session(), `/api/v1/payments/${String(other.id)}`)).statusCode,
      404,
    )
  })

  test('DOM-FIN-052 IST-107 ödeyici veli bakiye ve ekstreyi okur; başka öğrenci 404', async () => {
    const w = await world()
    const before = await data(await w.payer.session(), '/api/v1/finance/students/s1/balance')
    await pay(w.admin, 's1')
    const balance = await data(await w.payer.session(), '/api/v1/finance/students/s1/balance')
    assert.deepEqual(
      balance,
      await data(await w.keeper.session(), '/api/v1/finance/students/s1/balance'),
    )
    assert.equal(balance.paidCents - before.paidCents, 1_000)
    const statement = await data(await w.payer.session(), '/api/v1/finance/students/s1/statement')
    assert.deepEqual(
      statement,
      await data(await w.keeper.session(), '/api/v1/finance/students/s1/statement'),
    )
    for (const studentId of ['s2', 's11', 'olmayan-ogrenci'])
      for (const kind of ['balance', 'statement'])
        assert.equal(
          (await get(await w.payer.session(), `/api/v1/finance/students/${studentId}/${kind}`))
            .statusCode,
          404,
          `${studentId} ${kind}`,
        )
  })

  test('DOM-ILT-074 iletişim kısıtlı veli fatura, tahsilat, bakiye, ekstre ve sözleşme okumaz', async () => {
    const w = await world()
    const paid = await pay(w.admin, 's1')
    assert.deepEqual(await studentsIn(await w.restricted.session(), 'invoices'), [])
    assert.deepEqual(await studentsIn(await w.restricted.session(), 'contracts'), [])
    assert.equal((await get(await w.restricted.session(), '/api/v1/payments')).json().meta.total, 0)
    assert.equal(
      (await get(await w.restricted.session(), `/api/v1/payments/${String(paid.id)}`)).statusCode,
      404,
    )
    for (const kind of ['balance', 'statement'])
      assert.equal(
        (await get(await w.restricted.session(), `/api/v1/finance/students/s1/${kind}`)).statusCode,
        404,
        kind,
      )
  })

  test('DOM-ILT-070 ödeyici bağı akademik okumaları ve kayıt koleksiyonlarını açmaz', async () => {
    const w = await world()
    assert.deepEqual(await studentsIn(await w.payer.session(), 'grades'), [])
    assert.deepEqual(await studentsIn(await w.payer.session(), 'attendance'), [])
    assert.deepEqual(await studentsIn(await w.payer.session(), 'renewals'), [])
    assert.deepEqual(await studentsIn(await w.payer.session(), 'enrollmentHistory'), [])
    assert.equal(
      (await get(await w.payer.session(), '/api/v1/collections/students/s1')).statusCode,
      404,
    )
    assert.deepEqual(await studentsIn(await w.keeper.session(), 'grades'), ['s1'])
  })

  test('DOM-YTK-040 finans modülü kapalıyken ödeyici veli finans okuyamaz (403)', async () => {
    const w = await world({ enabledModules: { finance: false } })
    for (const url of [
      '/api/v1/collections/invoices',
      '/api/v1/collections/contracts',
      '/api/v1/payments',
      '/api/v1/finance/students/s1/balance',
      '/api/v1/finance/students/s1/statement',
    ])
      assert.equal((await get(await w.payer.session(), url)).statusCode, 403, url)
  })
})
