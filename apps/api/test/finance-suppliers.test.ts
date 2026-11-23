import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { suppliers } from '../src/db/schema/finance-suppliers.ts'
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

/**
 * Tedarikçi uçları (DOM-FIN-070; ON-221). Her test kendi kurumunu kurar. FIXED_NOW 2026-10-06.
 * Örnek numaralar kontrol hanesi geçerli uydurma değerlerdir.
 */

const SUPPLIERS = '/api/v1/finance/suppliers'
const VKN = '1234567890'
const VKN_2 = '0000000001'
const TCKN = '10000000146'
const IBAN = 'TR330006100519786457841326'
const COMPANY = {
  name: 'Örnek Kırtasiye Ltd. Şti.',
  type: 'company',
  taxNumber: VKN,
  taxOffice: 'Kadıköy',
  categories: ['stationery', 'educational'],
  contactName: 'Mert Aydın',
  contactPhone: '02161234567',
  contactEmail: 'satis@ornek-kirtasiye.test',
}
const PERSON = {
  name: 'Ali Usta Tesisat',
  type: 'individual',
  taxNumber: TCKN,
  taxOffice: 'Üsküdar',
  categories: ['maintenance'],
  address: 'Örnek Mah. Deneme Sok. No: 3 Üsküdar İstanbul',
  iban: IBAN,
  documents: [
    { name: 'Vergi levhası', expiryDate: '2026-10-20' },
    { name: 'Ustalık belgesi', expiryDate: '2026-01-01', note: 'Yenilenecek' },
    { name: 'Sözleşme' },
  ],
}

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-070: tedarikçi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.70.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    cookie: string | null,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url,
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie === null ? {} : { cookie }),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const get = (url: string, cookie: string | null) => call('GET', url, cookie)
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.70.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))
  const create = async (t: Tenant, body: Json) =>
    ok(await call('POST', SUPPLIERS, t.admin, body), 201)
  const rowsOf = (institutionId: string) =>
    db.select().from(suppliers).where(eq(suppliers.institutionId, institutionId))
  const listOf = async (cookie: string, query = '') => {
    const response = await get(`${SUPPLIERS}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }

  test('kimliksiz istek 401', async () => {
    assertError(await get(SUPPLIERS, null), 401)
    assertError(await call('POST', SUPPLIERS, null, COMPANY), 401)
    assertError(await get(`${SUPPLIERS}/${randomUUID()}`, null), 401)
  })

  test('DOM-FIN-070: öğretmen, veli, öğrenci 403; ön büro listeyi okur, yazamaz ve ayrıntıyı göremez (K-126)', async () => {
    const t = await institution()
    const saved = await create(t, PERSON)
    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const)
      assertError(await get(SUPPLIERS, await member(t.id, role)), 403)
    const front = await member(t.id, 'onburo')
    const list = await listOf(front)
    assert.equal(list.meta.total, 1)
    assert.equal(list.data[0]?.taxNumber, '*******0146')
    assertError(await call('POST', SUPPLIERS, front, { ...COMPANY, taxNumber: VKN_2 }), 403)
    assertError(await get(`${SUPPLIERS}/${String(saved.id)}`, front), 403)
    assertError(
      await call(
        'PATCH',
        `${SUPPLIERS}/${String(saved.id)}`,
        front,
        { isActive: false },
        ifMatch(saved.version),
      ),
      403,
    )
    assert.equal((await rowsOf(t.id)).length, 1)
    assert.equal((await rowsOf(t.id))[0]?.isActive, true)
  })

  test('DOM-FIN-070: finance modülü kapalıyken tedarikçi uçları 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(SUPPLIERS, closed.admin), 403, 'module_disabled')
    assertError(await call('POST', SUPPLIERS, closed.admin, COMPANY), 403, 'module_disabled')
    assert.equal((await rowsOf(closed.id)).length, 0)
  })

  test('DOM-FIN-070: tedarikçi kaydedilir; ayrıntı tam, liste şahıs TCKN ve IBAN maskeli; denetime alan adı yazılır', async () => {
    const t = await institution()
    const response = await call('POST', SUPPLIERS, t.admin, PERSON)
    const person = ok(response, 201)
    assert.equal(response.headers.location, `${SUPPLIERS}/${String(person.id)}`)
    assert.equal(person.taxNumber, TCKN)
    assert.equal(person.iban, IBAN)
    assert.deepEqual(
      (person.documents as Json[]).map((document) => document.status),
      ['expiring', 'expired', 'open-ended'],
    )
    const company = await create(t, COMPANY)
    assert.deepEqual(company.categories, ['stationery', 'educational'])
    const detail = ok(await get(`${SUPPLIERS}/${String(person.id)}`, t.admin))
    assert.equal(detail.address, PERSON.address)

    const list = await listOf(t.admin)
    assert.equal(list.meta.total, 2)
    const byName = new Map(list.data.map((row) => [row.name, row]))
    const personRow = byName.get(PERSON.name)
    assert.equal(personRow?.taxNumber, '*******0146')
    assert.equal(personRow?.iban, `TR${'*'.repeat(20)}1326`)
    assert.equal(personRow?.expiredDocumentCount, 1)
    assert.equal(personRow?.expiringDocumentCount, 1)
    assert.equal('address' in (personRow ?? {}), false)
    assert.equal(byName.get(COMPANY.name)?.taxNumber, VKN)

    const audits = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'supplier.create')))
    assert.equal(audits.length, 2)
    assert.equal(JSON.stringify(audits).includes(TCKN), false)
    assert.equal(JSON.stringify(audits).includes(IBAN), false)
  })

  test('DOM-FIN-070: geçersiz vergi numarası, türe uymayan numara ve IBAN 400; kayıt yazılmaz', async () => {
    const t = await institution()
    for (const body of [
      { ...COMPANY, taxNumber: '1234567891' },
      { ...COMPANY, taxNumber: TCKN },
      { ...PERSON, taxNumber: VKN },
      { ...PERSON, iban: 'TR330006100519786457841327' },
      { ...COMPANY, categories: [] },
      { ...COMPANY, categories: ['weapons'] },
    ])
      assertError(await call('POST', SUPPLIERS, t.admin, body), 400, 'validation_failed')
    assert.equal((await rowsOf(t.id)).length, 0)
  })

  test('DOM-FIN-070: vergi numarası kurumda tekil, pasif tedarikçi dahil (409)', async () => {
    const t = await institution()
    const saved = await create(t, COMPANY)
    ok(
      await call(
        'PATCH',
        `${SUPPLIERS}/${String(saved.id)}`,
        t.admin,
        { isActive: false },
        ifMatch(saved.version),
      ),
    )
    assertError(
      await call('POST', SUPPLIERS, t.admin, { ...COMPANY, name: 'Başka Ad' }),
      409,
      'supplier_tax_number_exists',
    )
    const other = await create(t, { ...COMPANY, name: 'İkinci', taxNumber: VKN_2 })
    assertError(
      await call(
        'PATCH',
        `${SUPPLIERS}/${String(other.id)}`,
        t.admin,
        { type: 'company', taxNumber: VKN },
        ifMatch(other.version),
      ),
      409,
      'supplier_tax_number_exists',
    )
    assert.equal((await rowsOf(t.id)).length, 2)
  })

  test('DOM-FIN-070: düzeltme If-Match ister, sürüm tutmazsa 409; pasifleştirme ve süzgeçler', async () => {
    const t = await institution()
    const saved = await create(t, COMPANY)
    await create(t, PERSON)
    const url = `${SUPPLIERS}/${String(saved.id)}`
    assertError(await call('PATCH', url, t.admin, { name: 'Yeni Ad' }), 400, 'if_match_required')
    assertError(
      await call('PATCH', url, t.admin, { name: 'Yeni Ad' }, ifMatch(Number(saved.version) + 5)),
      409,
      'version_conflict',
    )
    assertError(
      await call('PATCH', url, t.admin, { taxNumber: VKN_2 }, ifMatch(saved.version)),
      400,
    )
    const updated = ok(
      await call(
        'PATCH',
        url,
        t.admin,
        { name: 'Yeni Kırtasiye', isActive: false, documents: [{ name: 'Faaliyet belgesi' }] },
        ifMatch(saved.version),
      ),
    )
    assert.equal(updated.name, 'Yeni Kırtasiye')
    assert.equal(updated.isActive, false)
    assert.equal(updated.version, Number(saved.version) + 1)
    assert.equal((await listOf(t.admin, '?status=inactive')).meta.total, 1)
    assert.equal((await listOf(t.admin, '?status=active')).data[0]?.name, PERSON.name)
    assert.equal((await listOf(t.admin, '?category=maintenance')).meta.total, 1)
    assert.equal((await listOf(t.admin, '?type=company')).data[0]?.name, 'Yeni Kırtasiye')
    assert.equal((await listOf(t.admin, '?q=kirtasiye')).meta.total, 1)
    assertError(await get(`${SUPPLIERS}?sort=name`, t.admin), 400)
  })

  test('DOM-FIN-070: vergi numarasında arama yalnız yöneticide; ön büro TCKN ile arayamaz', async () => {
    const t = await institution()
    await create(t, PERSON)
    assert.equal((await listOf(t.admin, `?q=${TCKN}`)).meta.total, 1)
    const front = await member(t.id, 'onburo')
    assert.equal((await listOf(front, `?q=${TCKN}`)).meta.total, 0)
  })

  test('DOM-FIN-070: başka kurumun tedarikçisi 404 ve B değişmez; listede yok; gövdedeki institutionId 400', async () => {
    const a = await institution()
    const b = await institution()
    const bSupplier = await create(b, COMPANY)
    const bUrl = `${SUPPLIERS}/${String(bSupplier.id)}`
    assertError(await get(bUrl, a.admin), 404)
    assertError(
      await call('PATCH', bUrl, a.admin, { name: 'Sızma' }, ifMatch(bSupplier.version)),
      404,
    )
    assert.equal((await listOf(a.admin)).meta.total, 0)
    assertError(await call('POST', SUPPLIERS, a.admin, { ...COMPANY, institutionId: b.id }), 400)
    // Aynı vergi numarası başka kurumda serbesttir.
    await create(a, COMPANY)
    const [bRow] = await rowsOf(b.id)
    assert.equal(bRow?.name, COMPANY.name)
    assert.equal(bRow?.version, 1)
  })

  test('DOM-FIN-070: Idempotency-Key ile yinelenen kayıt aynı yanıtı döner, tek satır yazılır', async () => {
    const t = await institution()
    const key = { 'idempotency-key': randomUUID() }
    const first = await call('POST', SUPPLIERS, t.admin, COMPANY, key)
    const second = await call('POST', SUPPLIERS, t.admin, COMPANY, key)
    assert.equal(first.statusCode, 201)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal(second.json().data.id, first.json().data.id)
    assert.equal((await rowsOf(t.id)).length, 1)
  })
})
