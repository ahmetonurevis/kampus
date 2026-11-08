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
import { stockItems, stockMovements, stockWarehouses } from '../src/db/schema/finance-inventory.ts'
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
 * Stok kartı, depo ve stok hareketi uçları (DOM-FIN-077, DOM-FIN-078; ON-228, ON-229). Her test
 * kendi kurumunu kurar: seed kampüsleri (b1 Kadıköy, b2 Beşiktaş, b3 Ataşehir), iki depo (Kadıköy
 * ana depo, Beşiktaş deposu) ve A4 kâğıt (paket) kartı. FIXED_NOW 2026-10-06.
 */

const SEED = createSeed(FIXED_NOW)
const FINANCE = '/api/v1/finance'
const ITEMS = `${FINANCE}/stock-items`
const CRITICAL = `${ITEMS}/critical`
const WAREHOUSES = `${FINANCE}/stock-warehouses`
const MOVEMENTS = `${FINANCE}/stock-movements`
const ENTRIES = `${FINANCE}/stock-entries`
const ISSUES = `${FINANCE}/stock-issues`
const TRANSFERS = `${FINANCE}/stock-transfers`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-077, DOM-FIN-078: stok uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.77.0.1'

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
  const key = () => ({ 'idempotency-key': randomUUID() })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.77.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    const admin = await signInAs(app, created.admin)
    if (overrides.enabledModules?.finance === false) return { id: created.id, admin } as Tenant
    await insertMissingRecords(
      db,
      created.id,
      SEED.branches.map((data) => ({ collection: 'branches' as const, id: data.id, data })),
      FIXED_NOW,
    )
    const main = ok(
      await call('POST', WAREHOUSES, admin, { name: 'Ana depo', campusId: 'b1' }),
      201,
    )
    const annex = ok(
      await call('POST', WAREHOUSES, admin, { name: 'Beşiktaş deposu', campusId: 'b2' }),
      201,
    )
    const paper = ok(
      await call('POST', ITEMS, admin, {
        code: 'kag-a4',
        name: 'A4 kâğıt',
        category: 'stationery',
        unit: 'pack',
        minQuantity: 5,
      }),
      201,
    )
    return { id: created.id, admin, main, annex, paper }
  }
  type Tenant = { id: string; admin: string; main: Json; annex: Json; paper: Json }

  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))
  const entry = (
    cookie: string,
    t: Tenant,
    extra: Json = {},
    headers: Record<string, string> = key(),
  ) =>
    call(
      'POST',
      ENTRIES,
      cookie,
      {
        itemId: t.paper.id,
        warehouseId: t.main.id,
        quantity: 20,
        movementDate: '2026-10-01',
        reason: 'opening',
        ...extra,
      },
      headers,
    )
  const issue = (
    cookie: string,
    t: Tenant,
    extra: Json = {},
    headers: Record<string, string> = key(),
  ) =>
    call(
      'POST',
      ISSUES,
      cookie,
      {
        itemId: t.paper.id,
        warehouseId: t.main.id,
        quantity: 5,
        movementDate: '2026-10-06',
        reason: 'usage',
        ...extra,
      },
      headers,
    )
  const transfer = (cookie: string, t: Tenant, extra: Json = {}) =>
    call(
      'POST',
      TRANSFERS,
      cookie,
      {
        itemId: t.paper.id,
        fromWarehouseId: t.main.id,
        toWarehouseId: t.annex.id,
        quantity: 8,
        movementDate: '2026-10-03',
        ...extra,
      },
      key(),
    )
  const cancel = (cookie: string, movement: Json, reason = 'Hatalı kayıt') =>
    call(
      'POST',
      `${MOVEMENTS}/${String(movement.id)}/cancel`,
      cookie,
      { reason },
      ifMatch(movement.version),
    )
  const rows = (institutionId: string) =>
    Promise.all([
      db.select().from(stockItems).where(eq(stockItems.institutionId, institutionId)),
      db.select().from(stockWarehouses).where(eq(stockWarehouses.institutionId, institutionId)),
      db.select().from(stockMovements).where(eq(stockMovements.institutionId, institutionId)),
    ])
  const itemOf = async (t: Tenant) => ok(await get(`${ITEMS}/${String(t.paper.id)}`, t.admin))
  const balanceIn = (detail: Json, warehouse: Json) =>
    (detail.balances as Json[]).find((row) => row.warehouseId === warehouse.id)?.quantity

  test('DOM-FIN-077: kart kodu büyük harfe çevrilir ve tekildir; depo kampüse bağlıdır, adı tekildir', async () => {
    const t = await institution()
    assert.equal(t.paper.code, 'KAG-A4')
    assert.equal(t.paper.quantity, 0)
    assert.equal(t.paper.isBelowMinimum, true)
    assert.equal(t.main.campusName, SEED.branches[0]?.name)
    const before = await rows(t.id)
    assertError(
      await call('POST', ITEMS, t.admin, {
        code: 'KAG-A4',
        name: 'Kopya',
        category: 'stationery',
        unit: 'pack',
      }),
      409,
      'stock_item_code_exists',
    )
    assertError(
      await call('POST', WAREHOUSES, t.admin, { name: 'ANA DEPO', campusId: 'b3' }),
      409,
      'stock_warehouse_name_exists',
    )
    assertError(
      await call('POST', WAREHOUSES, t.admin, { name: 'Yeni depo', campusId: 'b9' }),
      422,
      'stock_warehouse_campus_not_found',
    )
    assertError(
      await call('POST', ITEMS, t.admin, {
        code: 'DNS',
        name: 'Danışmanlık',
        category: 'services',
        unit: 'hour',
      }),
      400,
      'validation_failed',
    )
    assert.deepEqual(await rows(t.id), before)
    const audit = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.entityType, 'stock_items')))
    assert.deepEqual(
      audit.map((row) => row.action),
      ['stock_item.create'],
    )
  })

  test('DOM-FIN-078: giriş ve çıkış miktarı değiştirir; kritik seviye ve depo başına miktar görünür', async () => {
    const t = await institution()
    const entered = ok(await entry(t.admin, t), 201)
    assert.equal(entered.type, 'in')
    assert.equal(entered.itemCode, 'KAG-A4')
    assert.equal(entered.warehouseName, 'Ana depo')
    assert.equal(entered.campusName, SEED.branches[0]?.name)
    const front = await member(t.id, 'onburo')
    const issued = ok(await issue(front, t, { quantity: 16 }), 201)
    assert.equal(issued.type, 'out')
    assert.deepEqual(issued.actions, { cancel: false })
    const detail = await itemOf(t)
    assert.equal(detail.quantity, 4)
    assert.equal(detail.isBelowMinimum, true)
    assert.equal(balanceIn(detail, t.main), 4)
    assert.equal(balanceIn(detail, t.annex), 0)
    const critical = await get(`${ITEMS}?critical=true`, front)
    assert.deepEqual(
      (critical.json().data as Json[]).map((row) => row.code),
      ['KAG-A4'],
    )
    const listed = await get(`${MOVEMENTS}?itemId=${String(t.paper.id)}`, front)
    assert.equal(listed.json().meta.total, 2)
    assert.deepEqual(
      (listed.json().data as Json[]).map((row) => row.type),
      ['out', 'in'],
    )
    const warehouses = await get(`${WAREHOUSES}?status=active`, front)
    assert.deepEqual(
      (warehouses.json().data as Json[]).map((row) => [row.name, row.itemCount]),
      [
        ['Ana depo', 1],
        ['Beşiktaş deposu', 0],
      ],
    )
  })

  test('DOM-FIN-078, K-181: çıkış miktarı aşamaz, geriye tarihli çıkış sonraki günü eksiye düşüremez; kayıt değişmez', async () => {
    const t = await institution()
    ok(await entry(t.admin, t), 201)
    ok(await issue(t.admin, t, { quantity: 15, movementDate: '2026-10-05' }), 201)
    const before = await rows(t.id)
    const over = await issue(t.admin, t, { quantity: 6 })
    assertError(over, 422, 'stock_insufficient')
    assert.match(over.json().message, /en çok 5 paket/)
    assertError(
      await issue(t.admin, t, { quantity: 6, movementDate: '2026-10-02' }),
      422,
      'stock_insufficient',
    )
    assertError(
      await issue(t.admin, t, { movementDate: '2026-10-07' }),
      422,
      'stock_movement_date_future',
    )
    assertError(await issue(t.admin, t, { reason: 'other' }), 400, 'validation_failed')
    assertError(await issue(t.admin, t, {}, {}), 400, 'idempotency_key_required')
    assert.deepEqual(await rows(t.id), before)
  })

  test('DOM-FIN-078: aynı Idempotency-Key ikinci hareket açmaz, ilk yanıtı tekrarlar', async () => {
    const t = await institution()
    const headers = key()
    const first = await entry(t.admin, t, {}, headers)
    const second = await entry(t.admin, t, {}, headers)
    assert.equal(first.statusCode, 201)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal(second.json().data.id, first.json().data.id)
    const [, , movements] = await rows(t.id)
    assert.equal(movements.length, 1)
  })

  test('DOM-FIN-078, K-183: transfer tek işlemde iki hareket; iptal ikisini birlikte geri alır, eksiye düşürecek iptal reddedilir', async () => {
    const t = await institution()
    const entered = ok(await entry(t.admin, t), 201)
    const moved = ok(await transfer(t.admin, t), 201)
    const [out, inLeg] = moved.movements as Json[]
    assert.equal(out?.type, 'transfer_out')
    assert.equal(inLeg?.type, 'transfer_in')
    assert.equal(out?.counterpartWarehouseName, 'Beşiktaş deposu')
    assert.equal(inLeg?.transferId, moved.transferId)
    let detail = await itemOf(t)
    assert.equal(balanceIn(detail, t.main), 12)
    assert.equal(balanceIn(detail, t.annex), 8)
    assertError(await transfer(t.admin, t, { quantity: 13 }), 422, 'stock_insufficient')
    assertError(await transfer(t.admin, t, { toWarehouseId: t.main.id }), 400, 'validation_failed')

    // Beşiktaş'tan 6 çıkılınca transfer iptali Beşiktaş'ı eksiye düşürür.
    const used = ok(await issue(t.admin, t, { warehouseId: t.annex.id, quantity: 6 }), 201)
    const before = await rows(t.id)
    assertError(await cancel(t.admin, out ?? {}), 422, 'stock_cancel_negative')
    assertError(await cancel(t.admin, entered), 422, 'stock_cancel_negative')
    assert.deepEqual(await rows(t.id), before)

    ok(await cancel(t.admin, used))
    const cancelled = ok(await cancel(t.admin, inLeg ?? {}))
    assert.deepEqual(
      (cancelled as unknown as Json[]).map((row) => [row.type, row.cancelReason]),
      [
        ['transfer_out', 'Hatalı kayıt'],
        ['transfer_in', 'Hatalı kayıt'],
      ],
    )
    detail = await itemOf(t)
    assert.equal(balanceIn(detail, t.main), 20)
    assert.equal(balanceIn(detail, t.annex), 0)
    assertError(await cancel(t.admin, used), 409, 'version_conflict')
    assertError(
      await cancel(t.admin, { ...used, version: Number(used.version) + 1 }),
      422,
      'stock_movement_already_cancelled',
    )
  })

  test('DOM-FIN-077, K-182: hareketi olan kartın birimi değişmez, stoklu kart ve depo pasifleşmez', async () => {
    const t = await institution()
    const patchItem = (body: Json, version = t.paper.version) =>
      call('PATCH', `${ITEMS}/${String(t.paper.id)}`, t.admin, body, ifMatch(version))
    const renamed = ok(await patchItem({ name: 'A4 fotokopi kâğıdı', unit: 'box' }))
    assert.equal(renamed.unit, 'box')
    ok(await entry(t.admin, t), 201)
    const before = await rows(t.id)
    assertError(await patchItem({ unit: 'pack' }, renamed.version), 422, 'stock_item_unit_locked')
    assertError(await patchItem({ isActive: false }, renamed.version), 422, 'stock_item_has_stock')
    assertError(await patchItem({ name: 'Eski sürüm' }), 409, 'version_conflict')
    assertError(
      await call(
        'PATCH',
        `${WAREHOUSES}/${String(t.main.id)}`,
        t.admin,
        { isActive: false },
        ifMatch(t.main.version),
      ),
      422,
      'stock_warehouse_has_stock',
    )
    assertError(
      await call(
        'PATCH',
        `${WAREHOUSES}/${String(t.main.id)}`,
        t.admin,
        { campusId: 'b3' },
        ifMatch(t.main.version),
      ),
      422,
      'stock_warehouse_has_stock',
    )
    assert.deepEqual(await rows(t.id), before)

    const annex = ok(
      await call(
        'PATCH',
        `${WAREHOUSES}/${String(t.annex.id)}`,
        t.admin,
        { isActive: false, campusId: 'b3' },
        ifMatch(t.annex.version),
      ),
    )
    assert.equal(annex.isActive, false)
    assert.equal(annex.campusName, SEED.branches[2]?.name)
    assertError(
      await entry(t.admin, t, { warehouseId: t.annex.id }),
      422,
      'stock_warehouse_inactive',
    )
  })

  test('DOM-FIN-079, K-200, K-201: kritik stok listesi kurum toplamına göre, aciliyet sırasında; depo kırılımı ve öneri miktarı verir', async () => {
    const t = await institution()
    const card = async (body: Json) => ok(await call('POST', ITEMS, t.admin, body), 201)
    const toner = await card({
      code: 'TONER',
      name: 'Yazıcı toneri',
      category: 'it',
      unit: 'piece',
      minQuantity: 4,
    })
    const soap = await card({
      code: 'SABUN',
      name: 'Sıvı sabun',
      category: 'cleaning',
      unit: 'liter',
      minQuantity: 10,
    })
    const chalk = await card({
      code: 'TEBESIR',
      name: 'Tebeşir',
      category: 'stationery',
      unit: 'box',
      minQuantity: 2,
    })
    await card({ code: 'SERBEST', name: 'Sınırsız kart', category: 'other', unit: 'piece' })
    // Kâğıt: ana depoda 3, Beşiktaş'ta 2 → toplam 5 = kritik seviye 5 (kritik, oran 1).
    ok(await entry(t.admin, t, { quantity: 3 }), 201)
    ok(await entry(t.admin, t, { quantity: 2, warehouseId: t.annex.id }), 201)
    // Sabun: 2 / 10 litre (oran 0,2). Toner: 0 (tükendi). Tebeşir: 9 > 2 (kritik değil).
    ok(await entry(t.admin, t, { itemId: soap.id, quantity: 2 }), 201)
    ok(await entry(t.admin, t, { itemId: chalk.id, quantity: 9 }), 201)
    // Pasif kart listelenmez: stoksuz pasif kart.
    const old = await card({
      code: 'ESKI',
      name: 'Eski ürün',
      category: 'other',
      unit: 'piece',
      minQuantity: 1,
    })
    ok(
      await call(
        'PATCH',
        `${ITEMS}/${String(old.id)}`,
        t.admin,
        { isActive: false },
        ifMatch(old.version),
      ),
    )

    const front = await member(t.id, 'onburo')
    const response = await get(CRITICAL, front)
    const list = response.json()
    assert.equal(list.meta.total, 3)
    assert.deepEqual(
      (list.data as Json[]).map((row) => [
        row.code,
        row.quantity,
        row.minQuantity,
        row.shortage,
        row.suggestedQuantity,
      ]),
      [
        ['TONER', 0, 4, 4, 8],
        ['SABUN', 2, 10, 8, 18],
        ['KAG-A4', 5, 5, 0, 5],
      ],
    )
    const paper = (list.data as Json[])[2] as Json
    assert.equal(paper.id, t.paper.id)
    assert.equal(paper.unit, 'pack')
    assert.equal(paper.lastUnitPriceCents, null)
    assert.equal(paper.lastReceiptDate, null)
    assert.deepEqual(
      (paper.warehouses as Json[]).map((row) => [row.warehouseName, row.campusName, row.quantity]),
      [
        ['Ana depo', SEED.branches[0]?.name, 3],
        ['Beşiktaş deposu', SEED.branches[1]?.name, 2],
      ],
    )
    assert.equal(toner.id, (list.data as Json[])[0]?.id)

    // Arama, kategori ve sayfa; bilinmeyen parametre 400.
    const codes = async (query: string) =>
      ((await get(`${CRITICAL}?${query}`, t.admin)).json().data as Json[]).map((row) => row.code)
    assert.deepEqual(await codes('q=sabun'), ['SABUN'])
    assert.deepEqual(await codes('category=it'), ['TONER'])
    assert.deepEqual(await codes('page=2&pageSize=2'), ['KAG-A4'])
    assertError(await get(`${CRITICAL}?critical=true`, t.admin), 400, 'validation_failed')

    // Giriş kartı kritik seviyenin üstüne çıkarınca listeden düşer; okuma kayıt değiştirmez.
    ok(await entry(t.admin, t, { itemId: toner.id, quantity: 5 }), 201)
    const before = await rows(t.id)
    assert.deepEqual(await codes(''), ['SABUN', 'KAG-A4'])
    assert.deepEqual(await rows(t.id), before)
  })

  test('K-180: oturumsuz 401; öğretmen, veli ve öğrenci 403; ön büro okur ve çıkış yazar, gerisi 403', async () => {
    const t = await institution()
    assertError(await get(ITEMS, null), 401)
    assertError(await get(MOVEMENTS, null), 401)
    assertError(await get(CRITICAL, null), 401)
    assertError(await entry('', t), 401)
    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(ITEMS, cookie), 403, 'forbidden')
      assertError(await get(WAREHOUSES, cookie), 403, 'forbidden')
      assertError(await get(MOVEMENTS, cookie), 403, 'forbidden')
      assertError(await get(CRITICAL, cookie), 403, 'forbidden')
      assertError(await issue(cookie, t), 403, 'forbidden')
    }
    const front = await member(t.id, 'onburo')
    ok(await get(ITEMS, front))
    ok(await get(`${ITEMS}/${String(t.paper.id)}`, front))
    ok(await get(WAREHOUSES, front))
    ok(await get(CRITICAL, front))
    const entered = ok(await entry(t.admin, t), 201)
    const before = await rows(t.id)
    assertError(
      await call('POST', ITEMS, front, {
        code: 'X',
        name: 'Kalem',
        category: 'stationery',
        unit: 'piece',
      }),
      403,
      'forbidden',
    )
    assertError(
      await call(
        'PATCH',
        `${ITEMS}/${String(t.paper.id)}`,
        front,
        { name: 'Değişti' },
        ifMatch(t.paper.version),
      ),
      403,
      'forbidden',
    )
    assertError(
      await call('POST', WAREHOUSES, front, { name: 'Depo', campusId: 'b1' }),
      403,
      'forbidden',
    )
    assertError(
      await call(
        'PATCH',
        `${WAREHOUSES}/${String(t.main.id)}`,
        front,
        { name: 'Değişti' },
        ifMatch(t.main.version),
      ),
      403,
      'forbidden',
    )
    assertError(await entry(front, t), 403, 'forbidden')
    assertError(await transfer(front, t), 403, 'forbidden')
    assertError(await cancel(front, entered), 403, 'forbidden')
    assert.deepEqual(await rows(t.id), before)
  })

  test('DOM-FIN-078: finance modülü kapalıyken stok uçları 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(ITEMS, closed.admin), 403, 'module_disabled')
    assertError(await get(WAREHOUSES, closed.admin), 403, 'module_disabled')
    assertError(await get(MOVEMENTS, closed.admin), 403, 'module_disabled')
    assertError(await get(CRITICAL, closed.admin), 403, 'module_disabled')
    assertError(await call('POST', ISSUES, closed.admin, {}, key()), 403, 'module_disabled')
  })

  test('DOM-FIN-077, DOM-FIN-078: başka kurumun kartı, deposu ve hareketi 404 ve B değişmez; listede B yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bEntry = ok(await entry(b.admin, b), 201)
    // B'nin stoksuz kartı kritik listededir (DOM-FIN-079); A'nın listesinde görünmez.
    const bCritical = ok(
      await call('POST', ITEMS, b.admin, {
        code: 'KALEM',
        name: 'Tükenmez kalem',
        category: 'stationery',
        unit: 'piece',
        minQuantity: 3,
      }),
      201,
    )
    const bItemUrl = `${ITEMS}/${String(b.paper.id)}`
    const bWarehouseUrl = `${WAREHOUSES}/${String(b.main.id)}`
    const before = await rows(b.id)

    const patchB = (url: string, version: unknown) =>
      call('PATCH', url, a.admin, { name: 'Ele geçirildi' }, ifMatch(version))
    assertError(await get(bItemUrl, a.admin), 404, 'not_found')
    assertError(await patchB(bItemUrl, b.paper.version), 404, 'not_found')
    assertError(await patchB(bWarehouseUrl, b.main.version), 404, 'not_found')
    assertError(await cancel(a.admin, bEntry), 404, 'not_found')
    // B'nin kart ve depo kimlikleri A'nın hareketinde etkisizdir.
    assertError(
      await entry(a.admin, a, { itemId: b.paper.id, institutionId: b.id }),
      400,
      'validation_failed',
    )
    assertError(await entry(a.admin, a, { itemId: b.paper.id }), 422, 'stock_item_not_found')
    assertError(
      await issue(a.admin, a, { warehouseId: b.main.id }),
      422,
      'stock_warehouse_not_found',
    )
    assertError(
      await transfer(a.admin, a, { toWarehouseId: b.main.id }),
      422,
      'stock_warehouse_not_found',
    )
    assertError(
      await call('POST', ITEMS, a.admin, {
        code: 'KAG-A4',
        name: 'A4',
        category: 'stationery',
        unit: 'pack',
        institutionId: b.id,
      }),
      400,
      'validation_failed',
    )
    const warehouseBody = { name: 'Sızma deposu', campusId: 'b1', institutionId: b.id }
    assertError(await call('POST', WAREHOUSES, a.admin, warehouseBody), 400, 'validation_failed')
    assert.deepEqual(await rows(b.id), before)

    const listOf = async (url: string) =>
      (await get(url, a.admin)).json().data.map((row: Json) => row.id) as string[]
    assert.equal((await listOf(ITEMS)).includes(String(b.paper.id)), false)
    assert.equal((await listOf(WAREHOUSES)).includes(String(b.main.id)), false)
    assert.equal((await listOf(MOVEMENTS)).includes(String(bEntry.id)), false)
    const critical = await listOf(CRITICAL)
    assert.deepEqual(critical, [a.paper.id])
    assert.equal(critical.includes(String(bCritical.id)), false)
    assert.deepEqual(
      ((await get(CRITICAL, b.admin)).json().data as Json[]).map((row) => row.id),
      [bCritical.id],
    )
    // Kod kurum içinde tekildir: A ve B aynı kodu taşır.
    assert.equal(a.paper.code, b.paper.code)
  })
})
