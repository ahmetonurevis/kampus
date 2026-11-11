import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { stockChemicalProfiles, stockMovementLots } from '../src/db/schema/finance-chemicals.ts'
import { stockMovements } from '../src/db/schema/finance-inventory.ts'
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
 * Laboratuvar kimyasal envanteri uçları (DOM-FIN-090; ON-234; K-240…K-243). Her test kendi kurumunu
 * kurar: iki depo (Kadıköy laboratuvar, Beşiktaş deposu), hidroklorik asit (litre, kimyasal) ve A4
 * kâğıt (paket, kimyasal değil). FIXED_NOW 2026-10-06.
 */

const SEED = createSeed(FIXED_NOW)
const FINANCE = '/api/v1/finance'
const ITEMS = `${FINANCE}/stock-items`
const WAREHOUSES = `${FINANCE}/stock-warehouses`
const MOVEMENTS = `${FINANCE}/stock-movements`
const ENTRIES = `${FINANCE}/stock-entries`
const ISSUES = `${FINANCE}/stock-issues`
const TRANSFERS = `${FINANCE}/stock-transfers`
const LOTS = `${FINANCE}/chemical-lots`
const REPORT = `${FINANCE}/chemical-inventory`
const profileUrl = (item: Json) => `${ITEMS}/${String(item.id)}/chemical-profile`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

const ACID_PROFILE = {
  hazardPictograms: ['GHS07', 'GHS05'],
  signalWord: 'danger',
  casNumber: '7647-01-0',
  storageClass: 'Asit dolabı',
  incompatibilityNote: 'Bazlar ve metallerden ayrı tutulur.',
  sdsUrl: 'https://tedarikci.example/gbf/hcl.pdf',
  sdsDocumentNumber: 'GBF-07',
  sdsRevisionDate: '2026-01-15',
}

describe('DOM-FIN-090: kimyasal envanter uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.90.0.1'

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
  const get = (url: string, cookie: string | null, headers: Record<string, string> = {}) =>
    call('GET', url, cookie, undefined, headers)
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
  const key = () => ({ 'idempotency-key': randomUUID() })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  type Tenant = { id: string; admin: string; lab: Json; annex: Json; acid: Json; paper: Json }

  async function institution(overrides: Partial<InstitutionOverrides> = {}): Promise<Tenant> {
    clientIp = `10.90.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    const admin = await signInAs(app, created.admin)
    if (overrides.enabledModules?.finance === false)
      return { id: created.id, admin, lab: {}, annex: {}, acid: {}, paper: {} }
    await insertMissingRecords(
      db,
      created.id,
      SEED.branches.map((data) => ({ collection: 'branches' as const, id: data.id, data })),
      FIXED_NOW,
    )
    const lab = ok(
      await call('POST', WAREHOUSES, admin, { name: 'Laboratuvar', campusId: 'b1' }),
      201,
    )
    const annex = ok(
      await call('POST', WAREHOUSES, admin, { name: 'Beşiktaş deposu', campusId: 'b2' }),
      201,
    )
    const item = (code: string, name: string, unit: string, category: string) =>
      call('POST', ITEMS, admin, { code, name, category, unit })
    const acid = ok(await item('HCL', 'Hidroklorik asit', 'liter', 'educational'), 201)
    const paper = ok(await item('KAG', 'A4 kâğıt', 'pack', 'stationery'), 201)
    return { id: created.id, admin, lab, annex, acid, paper }
  }

  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))
  const mark = (cookie: string, item: Json, body: unknown = ACID_PROFILE) =>
    call('POST', profileUrl(item), cookie, body)
  const entry = (cookie: string, t: Tenant, extra: Json = {}) =>
    call(
      'POST',
      ENTRIES,
      cookie,
      {
        itemId: t.acid.id,
        warehouseId: t.lab.id,
        quantity: 5,
        movementDate: '2026-10-01',
        reason: 'opening',
        lotNumber: 'L-A',
        expiryDate: '2027-06-30',
        ...extra,
      },
      key(),
    )
  const issue = (cookie: string, t: Tenant, extra: Json = {}) =>
    call(
      'POST',
      ISSUES,
      cookie,
      {
        itemId: t.acid.id,
        warehouseId: t.lab.id,
        quantity: 1,
        movementDate: '2026-10-06',
        reason: 'usage',
        ...extra,
      },
      key(),
    )
  const rows = (institutionId: string) =>
    Promise.all([
      db
        .select()
        .from(stockChemicalProfiles)
        .where(eq(stockChemicalProfiles.institutionId, institutionId)),
      db.select().from(stockMovementLots).where(eq(stockMovementLots.institutionId, institutionId)),
      db.select().from(stockMovements).where(eq(stockMovements.institutionId, institutionId)),
    ])
  const lotsOf = async (cookie: string, query = '') =>
    ((await get(`${LOTS}${query}`, cookie)).json().data as Json[]).map((row) => [
      row.warehouseName,
      row.code,
      row.lotNumber,
      row.quantity,
      row.status,
    ])

  test('DOM-FIN-090, K-240: yönetici kartı kimyasal işaretler; ikinci işaret 409, geçersiz CAS 400 ve kayıt değişmez; düzeltme If-Match ister', async () => {
    const t = await institution()
    const marked = ok(await mark(t.admin, t.acid), 201)
    assert.equal(marked.isChemical, true)
    const chemical = marked.chemical as Json
    assert.deepEqual(chemical.hazardPictograms, ['GHS05', 'GHS07'])
    assert.equal(chemical.casNumber, '7647-01-0')
    assert.equal(chemical.version, 1)
    const detail = ok(await get(`${ITEMS}/${String(t.paper.id)}`, t.admin))
    assert.equal(detail.chemical, null)
    assert.equal(detail.isChemical, false)
    const listed = (await get(`${ITEMS}?chemical=true`, t.admin)).json()
    assert.deepEqual(
      (listed.data as Json[]).map((row) => [row.code, row.isChemical]),
      [['HCL', true]],
    )

    const before = await rows(t.id)
    assertError(await mark(t.admin, t.acid), 409, 'stock_item_chemical_exists')
    assertError(await mark(t.admin, t.paper, { casNumber: '7647-01-1' }), 400, 'validation_failed')
    assertError(
      await mark(t.admin, t.paper, { sdsUrl: 'http://example.com/gbf.pdf' }),
      400,
      'validation_failed',
    )
    assertError(
      await mark(t.admin, t.paper, { sdsRevisionDate: '2026-10-07' }),
      422,
      'chemical_sds_date_future',
    )
    assertError(await mark(t.admin, { id: randomUUID() }), 404, 'not_found')
    assertError(
      await call('PATCH', profileUrl(t.acid), t.admin, { storageClass: 'Dolap 2' }),
      400,
      'if_match_required',
    )
    assertError(
      await call('PATCH', profileUrl(t.acid), t.admin, { storageClass: 'Dolap 2' }, ifMatch(9)),
      409,
      'version_conflict',
    )
    assertError(
      await call('PATCH', profileUrl(t.paper), t.admin, { storageClass: 'Dolap 2' }, ifMatch(1)),
      404,
      'not_found',
    )
    assert.deepEqual(await rows(t.id), before)

    const updated = ok(
      await call(
        'PATCH',
        profileUrl(t.acid),
        t.admin,
        { storageClass: 'Asit dolabı 2', hazardPictograms: ['GHS05'] },
        ifMatch(1),
      ),
    )
    const after = updated.chemical as Json
    assert.equal(after.storageClass, 'Asit dolabı 2')
    assert.deepEqual(after.hazardPictograms, ['GHS05'])
    assert.equal(after.casNumber, '7647-01-0')
    assert.equal(after.version, 2)
    const audit = await db
      .select({ action: auditLog.action, changes: auditLog.changes })
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, t.id), eq(auditLog.entityType, 'stock_chemical_profiles')),
      )
    assert.deepEqual(
      audit.map((row) => row.action),
      ['stock_chemical_profile.create', 'stock_chemical_profile.update'],
    )
  })

  test('DOM-FIN-090, K-241: kimyasal girişi parti ister, kimyasal olmayan girişte parti 422; parti hareket listesinde görünür', async () => {
    const t = await institution()
    ok(await mark(t.admin, t.acid), 201)
    const before = await rows(t.id)
    assertError(
      await entry(t.admin, t, { lotNumber: null, expiryDate: null }),
      422,
      'stock_lot_required',
    )
    assertError(await entry(t.admin, t, { itemId: t.paper.id }), 422, 'stock_lot_not_allowed')
    assertError(await entry(t.admin, t, { expiryDate: null }), 400, 'validation_failed')
    assert.deepEqual(await rows(t.id), before)

    const entered = ok(await entry(t.admin, t), 201)
    assert.equal(entered.lotNumber, 'L-A')
    assert.equal(entered.expiryDate, '2027-06-30')
    const plain = ok(
      await entry(t.admin, t, { itemId: t.paper.id, lotNumber: null, expiryDate: null }),
      201,
    )
    assert.equal(plain.lotNumber, null)
    const listed = (await get(`${MOVEMENTS}?itemId=${String(t.acid.id)}`, t.admin)).json()
    assert.deepEqual(
      (listed.data as Json[]).map((row) => [row.type, row.lotNumber, row.expiryDate]),
      [['in', 'L-A', '2027-06-30']],
    )
    const [, lots] = await rows(t.id)
    assert.equal(lots.length, 1)
    const audit = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.entityId, String(entered.id))))
    assert.ok(JSON.stringify(audit).includes('lotNumber'))
  })

  test('DOM-FIN-090, K-242, K-243: çıkış FEFO ile düşer, transfer partiyi taşır; uyarı listesi süresi geçen ve 30 gün içinde dolanı verir', async () => {
    const t = await institution()
    ok(await mark(t.admin, t.acid), 201)
    ok(await entry(t.admin, t, { lotNumber: 'L-UZAK', expiryDate: '2027-06-30', quantity: 5 }), 201)
    ok(
      await entry(t.admin, t, { lotNumber: 'L-YAKIN', expiryDate: '2026-10-20', quantity: 3 }),
      201,
    )
    ok(
      await entry(t.admin, t, { lotNumber: 'L-GECMIS', expiryDate: '2026-10-05', quantity: 2 }),
      201,
    )
    const front = await member(t.id, 'onburo')
    // FEFO: önce süresi geçen parti, sonra yakın olan düşer.
    // Test saati sabittir; aynı gün hareketlerinin kayıt sırası belirsiz kalmasın diye günler ayrı.
    ok(await issue(front, t, { quantity: 3, movementDate: '2026-10-05' }), 201)
    ok(
      await call(
        'POST',
        TRANSFERS,
        t.admin,
        {
          itemId: t.acid.id,
          fromWarehouseId: t.lab.id,
          toWarehouseId: t.annex.id,
          quantity: 3,
          movementDate: '2026-10-06',
        },
        key(),
      ),
      201,
    )
    // Çıkış süresi geçen ikiyi ve yakın partiden biri düşer; transfer kalan yakın partiyi ve bir
    // uzak parti taşır.
    assert.deepEqual(await lotsOf(front), [
      ['Beşiktaş deposu', 'HCL', 'L-YAKIN', 2, 'expiring'],
      ['Beşiktaş deposu', 'HCL', 'L-UZAK', 1, 'ok'],
      ['Laboratuvar', 'HCL', 'L-UZAK', 4, 'ok'],
    ])
    // Transfer iptali partileri geri getirir; uyarı listesi yalnız yakın ve geçmiş partilerdir.
    ok(await issue(t.admin, t, { quantity: 1, movementDate: '2026-10-02' }), 201)
    const transfers = (await get(`${MOVEMENTS}?type=transfer_out`, t.admin)).json().data as Json[]
    const transferOut = transfers[0] as Json
    ok(
      await call(
        'POST',
        `${MOVEMENTS}/${String(transferOut.id)}/cancel`,
        t.admin,
        { reason: 'Hatalı transfer' },
        ifMatch(transferOut.version),
      ),
    )
    assert.deepEqual(await lotsOf(front, '?status=attention'), [
      ['Laboratuvar', 'HCL', 'L-YAKIN', 1, 'expiring'],
    ])
    assert.deepEqual(await lotsOf(front), [
      ['Laboratuvar', 'HCL', 'L-YAKIN', 1, 'expiring'],
      ['Laboratuvar', 'HCL', 'L-UZAK', 5, 'ok'],
    ])
    const attention = (await get(`${LOTS}?status=attention`, front)).json().data as Json[]
    assert.equal(attention[0]?.daysLeft, 14)
    assert.deepEqual(attention[0]?.hazardPictograms, ['GHS05', 'GHS07'])
    // Bugün giren süresi geçmiş parti uyarı listesinde ilk sıradadır.
    ok(
      await entry(t.admin, t, {
        lotNumber: 'L-ESKI',
        expiryDate: '2026-09-30',
        quantity: 4,
        movementDate: '2026-10-06',
      }),
      201,
    )
    assert.deepEqual(await lotsOf(front, '?status=attention'), [
      ['Laboratuvar', 'HCL', 'L-ESKI', 4, 'expired'],
      ['Laboratuvar', 'HCL', 'L-YAKIN', 1, 'expiring'],
    ])
    assert.deepEqual(await lotsOf(front, '?status=expired&q=hcl'), [
      ['Laboratuvar', 'HCL', 'L-ESKI', 4, 'expired'],
    ])
    assert.deepEqual(await lotsOf(front, `?itemId=${String(t.paper.id)}`), [])
    assertError(await get(`${LOTS}?status=bozuk`, front), 400, 'validation_failed')
  })

  test('DOM-FIN-090: envanter raporu depo × kimyasal partileriyle; CSV parti başına satır, BOM ve formül kaçışı', async () => {
    const t = await institution()
    ok(await mark(t.admin, t.acid), 201)
    const ethanol = ok(
      await call('POST', ITEMS, t.admin, {
        code: 'ETANOL',
        name: '=Etanol',
        category: 'educational',
        unit: 'liter',
      }),
      201,
    )
    ok(
      await mark(t.admin, ethanol, { hazardPictograms: ['GHS02', 'GHS07'], signalWord: 'danger' }),
      201,
    )
    ok(await entry(t.admin, t, { lotNumber: 'L-1', expiryDate: '2026-10-01', quantity: 2 }), 201)
    ok(await entry(t.admin, t, { lotNumber: 'L-2', expiryDate: '2027-01-31', quantity: 3 }), 201)
    ok(
      await entry(t.admin, t, {
        itemId: ethanol.id,
        warehouseId: t.annex.id,
        lotNumber: 'E-1',
        expiryDate: '2026-11-01',
        quantity: 4,
      }),
      201,
    )
    const front = await member(t.id, 'onburo')
    const report = (await get(REPORT, front)).json()
    assert.equal(report.meta.total, 2)
    const data = report.data as Json[]
    assert.deepEqual(
      data.map((row) => [
        row.warehouseName,
        row.code,
        row.quantity,
        row.expiredQuantity,
        row.hasSds,
      ]),
      [
        ['Beşiktaş deposu', 'ETANOL', 4, 0, false],
        ['Laboratuvar', 'HCL', 5, 2, true],
      ],
    )
    assert.equal(data[1]?.nearestExpiryDate, '2026-10-01')
    assert.equal(data[0]?.expiringQuantity, 4)
    assert.equal(
      (await get(`${REPORT}?warehouseId=${String(t.lab.id)}`, front)).json().meta.total,
      1,
    )
    assert.equal((await get(`${REPORT}?q=7647`, front)).json().meta.total, 1)

    const csv = await get(`${REPORT}?page=2&pageSize=1`, front, { accept: 'text/csv' })
    assert.equal(csv.statusCode, 200, csv.body)
    assert.match(String(csv.headers['content-type']), /^text\/csv/)
    assert.match(String(csv.headers['content-disposition']), /kimyasal-envanter-2026-10-06\.csv/)
    assert.equal(csv.body.charCodeAt(0), 0xfeff)
    const lines = csv.body.slice(1).trimEnd().split('\r\n')
    assert.equal(lines.length, 4)
    assert.match(lines[1] ?? '', /"ETANOL";"'=Etanol";"";"GHS02, GHS07";"Tehlike"/)
    assert.match(lines[2] ?? '', /"L-1";"2026-10-01";"Süresi geçti";2;"Litre"/i)
    const before = await rows(t.id)
    ok(await get(REPORT, t.admin))
    assert.deepEqual(await rows(t.id), before)
  })

  test('K-180, K-240: oturumsuz 401; öğretmen, veli ve öğrenci 403; ön büro okur, kimyasal bilgisi yazamaz; modül kapalı 403', async () => {
    const t = await institution()
    for (const url of [LOTS, REPORT]) assertError(await get(url, null), 401)
    assertError(await mark('', t.acid), 401)
    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(LOTS, cookie), 403, 'forbidden')
      assertError(await get(REPORT, cookie), 403, 'forbidden')
      assertError(await mark(cookie, t.acid), 403, 'forbidden')
    }
    const front = await member(t.id, 'onburo')
    ok(await get(LOTS, front))
    ok(await get(REPORT, front))
    const before = await rows(t.id)
    assertError(await mark(front, t.acid), 403, 'forbidden')
    assertError(
      await call('PATCH', profileUrl(t.acid), front, { storageClass: 'X' }, ifMatch(1)),
      403,
      'forbidden',
    )
    assert.deepEqual(await rows(t.id), before)

    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(LOTS, closed.admin), 403, 'module_disabled')
    assertError(await get(REPORT, closed.admin), 403, 'module_disabled')
    assertError(await mark(closed.admin, { id: randomUUID() }), 403, 'module_disabled')
  })

  test('DOM-FIN-090: başka kurumun kartı kimyasal işaretlenmez ve düzeltilmez (404, B değişmez); partiler ve raporda B yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    ok(await mark(b.admin, b.acid), 201)
    ok(await entry(b.admin, b), 201)
    ok(await mark(a.admin, a.acid), 201)
    ok(await entry(a.admin, a, { lotNumber: 'A-1' }), 201)
    const before = await rows(b.id)
    assertError(await mark(a.admin, b.paper), 404, 'not_found')
    assertError(
      await call('PATCH', profileUrl(b.acid), a.admin, { storageClass: 'Sızma' }, ifMatch(1)),
      404,
      'not_found',
    )
    assertError(
      await mark(a.admin, a.paper, { ...ACID_PROFILE, institutionId: b.id }),
      400,
      'validation_failed',
    )
    assertError(
      await entry(a.admin, a, { itemId: b.acid.id, institutionId: b.id }),
      400,
      'validation_failed',
    )
    assert.deepEqual(await rows(b.id), before)

    const lots = (await get(`${LOTS}?itemId=${String(b.acid.id)}`, a.admin)).json()
    assert.equal(lots.meta.total, 0)
    assert.deepEqual(await lotsOf(a.admin), [['Laboratuvar', 'HCL', 'A-1', 5, 'ok']])
    const report = (await get(REPORT, a.admin)).json().data as Json[]
    assert.deepEqual(
      report.map((row) => row.itemId),
      [a.acid.id],
    )
    const bReport = (await get(`${REPORT}?warehouseId=${String(b.lab.id)}`, a.admin)).json()
    assert.equal(bReport.meta.total, 0)
    const csv = await get(REPORT, a.admin, { accept: 'text/csv' })
    assert.equal(csv.body.includes('L-A'), false)
  })
})
