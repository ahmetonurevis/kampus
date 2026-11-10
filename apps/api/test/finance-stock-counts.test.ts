import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { stockMovements } from '../src/db/schema/finance-inventory.ts'
import { stockCountLines, stockCounts } from '../src/db/schema/finance-stock-counts.ts'
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
 * Stok sayımı uçları (DOM-FIN-081; ON-231; K-228…K-231). Her test kendi kurumunu kurar: seed
 * kampüsleri, iki depo (Ana depo, Beşiktaş deposu), A4 kâğıt (paket, ana depoda 20) ve kalem (adet,
 * ana depoda 6) kartları. Saat testte ileri alınabilir (sayım sırasındaki hareketler, K-231);
 * FIXED_NOW 2026-10-06 09:00 UTC.
 */

const SEED = createSeed(FIXED_NOW)
const FINANCE = '/api/v1/finance'
const ITEMS = `${FINANCE}/stock-items`
const WAREHOUSES = `${FINANCE}/stock-warehouses`
const MOVEMENTS = `${FINANCE}/stock-movements`
const ENTRIES = `${FINANCE}/stock-entries`
const ISSUES = `${FINANCE}/stock-issues`
const COUNTS = `${FINANCE}/stock-counts`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-081: stok sayımı uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.81.0.1'
  let now = FIXED_NOW
  const minutesLater = (minutes: number) => {
    now = new Date(FIXED_NOW.getTime() + minutes * 60_000)
  }

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => now })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST',
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

  type Tenant = { id: string; admin: string; main: Json; annex: Json; paper: Json; pen: Json }

  async function institution(overrides: Partial<InstitutionOverrides> = {}): Promise<Tenant> {
    now = FIXED_NOW
    clientIp = `10.81.${String((tenantCount += 1))}.1`
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
    const card = (code: string, name: string, unit: string) =>
      call('POST', ITEMS, admin, { code, name, category: 'stationery', unit })
    const paper = ok(await card('KAG-A4', 'A4 kâğıt', 'pack'), 201)
    const pen = ok(await card('8690000000017', 'Tükenmez kalem', 'piece'), 201)
    for (const [item, quantity] of [
      [paper, 20],
      [pen, 6],
    ] as const)
      ok(
        await call(
          'POST',
          ENTRIES,
          admin,
          {
            itemId: item.id,
            warehouseId: main.id,
            quantity,
            movementDate: '2026-10-01',
            reason: 'opening',
          },
          key(),
        ),
        201,
      )
    return { id: created.id, admin, main, annex, paper, pen }
  }

  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))
  const start = (cookie: string, t: Tenant, extra: Json = {}) =>
    call('POST', COUNTS, cookie, { warehouseId: t.main.id, ...extra })
  const scan = (cookie: string, count: Json, body: Json, headers: Record<string, string> = key()) =>
    call('POST', `${COUNTS}/${String(count.id)}/scans`, cookie, body, headers)
  const setQuantity = (cookie: string, count: Json, body: Json) =>
    call('POST', `${COUNTS}/${String(count.id)}/quantities`, cookie, body)
  const detail = async (cookie: string, count: Json) =>
    ok(await get(`${COUNTS}/${String(count.id)}`, cookie))
  const complete = (cookie: string, count: Json, version: unknown = count.version) =>
    call('POST', `${COUNTS}/${String(count.id)}/complete`, cookie, {}, ifMatch(version))
  const cancel = (cookie: string, count: Json, reason = 'Yanlış depo seçildi') =>
    call('POST', `${COUNTS}/${String(count.id)}/cancel`, cookie, { reason }, ifMatch(count.version))
  const balanceOf = async (t: Tenant, item: Json, warehouse: Json = t.main) => {
    const data = ok(await get(`${ITEMS}/${String(item.id)}`, t.admin))
    return (data.balances as Json[]).find((row) => row.warehouseId === warehouse.id)?.quantity
  }
  const rows = (institutionId: string) =>
    Promise.all([
      db.select().from(stockCounts).where(eq(stockCounts.institutionId, institutionId)),
      db.select().from(stockCountLines).where(eq(stockCountLines.institutionId, institutionId)),
      db.select().from(stockMovements).where(eq(stockMovements.institutionId, institutionId)),
    ])

  test('DOM-FIN-081, K-228, K-229, K-230: başlatma anlık görüntü alır; okutma ve elle miktar fark raporuna, tamamlama düzeltme hareketine dönüşür', async () => {
    const t = await institution()
    const count = ok(await start(t.admin, t, { note: 'Yıl sonu sayımı' }), 201)
    assert.equal(count.status, 'open')
    assert.equal(count.warehouseName, 'Ana depo')
    assert.deepEqual(
      (count.uncounted as Json[]).map((row) => [row.itemCode, row.systemQuantity]),
      [
        ['8690000000017', 6],
        ['KAG-A4', 20],
      ],
    )
    assert.deepEqual(count.actions, { count: true, complete: true, cancel: true })

    // Barkod okuyucu kodu klavye gibi yazar ve Enter gönderir: küçük harf de bulunur.
    const scanned = ok(await scan(t.admin, count, { code: 'kag-a4' }))
    assert.equal(scanned.itemName, 'A4 kâğıt')
    assert.equal(scanned.countedQuantity, 1)
    assert.equal(
      ok(await scan(t.admin, count, { code: 'KAG-A4', quantity: 16 })).countedQuantity,
      17,
    )
    // Kalemde fazla bulundu; elle miktar.
    ok(await setQuantity(t.admin, count, { itemId: t.pen.id, countedQuantity: 8 }))
    assertError(await scan(t.admin, count, { code: 'YOK-KOD' }), 422, 'stock_count_item_not_found')

    const open = await detail(t.admin, count)
    assert.deepEqual(
      (open.counted as Json[]).map((row) => [
        row.itemCode,
        row.systemQuantity,
        row.countedQuantity,
        row.difference,
      ]),
      [
        ['8690000000017', 6, 8, 2],
        ['KAG-A4', 20, 17, -3],
      ],
    )
    assert.deepEqual(open.uncounted, [])
    assert.equal((open.totals as Json).differenceItems, 2)
    // Birim maliyet yalnız mal kabulden gelir (K-202); elle girişte fiyat yoktur.
    assert.equal((open.totals as Json).unpricedDifferenceItems, 2)

    const done = ok(await complete(t.admin, count, open.version))
    assert.equal(done.status, 'completed')
    assert.equal(done.adjustmentDate, '2026-10-06')
    assert.deepEqual(done.actions, { count: false, complete: false, cancel: false })
    assert.equal(await balanceOf(t, t.paper), 17)
    assert.equal(await balanceOf(t, t.pen), 8)

    const movements = (await get(`${MOVEMENTS}?warehouseId=${String(t.main.id)}`, t.admin)).json()
      .data as Json[]
    const adjustments = movements.filter((row) => String(row.type).startsWith('adjustment'))
    assert.deepEqual(
      adjustments.map((row) => [row.type, row.itemCode, row.quantity, row.countId]).sort(),
      [
        ['adjustment_in', '8690000000017', 2, count.id],
        ['adjustment_out', 'KAG-A4', 3, count.id],
      ],
    )
    assert.equal(
      adjustments.every((row) => (row.actions as Json).cancel === false),
      true,
    )
    const linked = (done.counted as Json[]).map((row) => row.movementId)
    assert.deepEqual(new Set(linked), new Set(adjustments.map((row) => row.id)))
    const adjustment = adjustments[0] as Json
    assertError(
      await call(
        'POST',
        `${MOVEMENTS}/${String(adjustment.id)}/cancel`,
        t.admin,
        { reason: 'Geri al' },
        ifMatch(adjustment.version),
      ),
      422,
      'stock_movement_from_count',
    )

    // Tamamlanan sayım değişmez.
    const before = await rows(t.id)
    assertError(await scan(t.admin, count, { code: 'KAG-A4' }), 422, 'stock_count_closed')
    assertError(
      await setQuantity(t.admin, count, { itemId: t.paper.id, countedQuantity: 1 }),
      422,
      'stock_count_closed',
    )
    assertError(await complete(t.admin, count, done.version), 422, 'stock_count_closed')
    assertError(await cancel(t.admin, done), 422, 'stock_count_closed')
    assert.deepEqual(await rows(t.id), before)

    const actions = (
      await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.institutionId, t.id))
    ).map((row) => row.action)
    for (const action of [
      'stock_count.start',
      'stock_count.scan',
      'stock_count.line',
      'stock_count.complete',
      'stock_movement.adjustment',
    ])
      assert.ok(actions.includes(action), action)
  })

  test('DOM-FIN-081, K-230: sayılmayan kalem değişmez; anlık görüntüde olmayan kart sayılınca fazla olarak girer', async () => {
    const t = await institution()
    const count = ok(await start(t.admin, t), 201)
    // Kâğıt sayılmadı; kalem sistemdeki gibi 6 sayıldı.
    ok(await setQuantity(t.admin, count, { itemId: t.pen.id, countedQuantity: 6 }))
    const done = ok(await complete(t.admin, count))
    assert.deepEqual(
      (done.uncounted as Json[]).map((row) => row.itemCode),
      ['KAG-A4'],
    )
    assert.equal((done.totals as Json).differenceItems, 0)
    assert.equal(await balanceOf(t, t.paper), 20)

    const annexCount = ok(await start(t.admin, t, { warehouseId: t.annex.id }), 201)
    assert.deepEqual(annexCount.uncounted, [])
    const line = ok(await scan(t.admin, annexCount, { code: '8690000000017', quantity: 4 }))
    assert.equal(line.systemQuantity, 0)
    // Hiç sayılmamış kartı "sayılmadı" yapmak satır açmaz.
    ok(await setQuantity(t.admin, annexCount, { itemId: t.paper.id, countedQuantity: null }))
    ok(await complete(t.admin, annexCount))
    assert.equal(await balanceOf(t, t.pen, t.annex), 4)
    const lines = await db
      .select()
      .from(stockCountLines)
      .where(eq(stockCountLines.countId, String(annexCount.id)))
    assert.equal(lines.length, 1)
  })

  test('DOM-FIN-081, K-231: sayım sırasındaki hareket kart sayılana kadar beklenene girer; sonrası düzeltmeye girmez', async () => {
    const t = await institution()
    const count = ok(await start(t.admin, t), 201)
    const issue = (quantity: number) =>
      call(
        'POST',
        ISSUES,
        t.admin,
        {
          itemId: t.paper.id,
          warehouseId: t.main.id,
          quantity,
          movementDate: '2026-10-06',
          reason: 'usage',
        },
        key(),
      )
    // Kâğıt sayılmadan 5 çıkış (depoda 15), sonra 15 sayıldı, sonra 3 çıkış daha (depoda 12).
    minutesLater(1)
    ok(await issue(5), 201)
    minutesLater(2)
    ok(await setQuantity(t.admin, count, { itemId: t.paper.id, countedQuantity: 15 }))
    minutesLater(3)
    ok(await issue(3), 201)
    minutesLater(4)
    const open = await detail(t.admin, count)
    const paper = (open.counted as Json[])[0] as Json
    assert.deepEqual(
      [paper.systemQuantity, paper.movementQuantity, paper.expectedQuantity, paper.difference],
      [20, -5, 15, 0],
    )
    ok(await complete(t.admin, count, open.version))
    // Fark yok: sayım sonrası çıkış korunur.
    assert.equal(await balanceOf(t, t.paper), 12)
  })

  test('DOM-FIN-081, K-231: kart sayıldıktan sonraki çıkış eksik düzeltmesini eksiye düşürecekse tamamlama reddedilir', async () => {
    const t = await institution()
    const count = ok(await start(t.admin, t), 201)
    minutesLater(1)
    // Kâğıt 4 sayıldı (beklenen 20, eksik 16); sonra 10 çıkış yazıldı, depoda 10 kaldı.
    ok(await setQuantity(t.admin, count, { itemId: t.paper.id, countedQuantity: 4 }))
    minutesLater(2)
    ok(
      await call(
        'POST',
        ISSUES,
        t.admin,
        {
          itemId: t.paper.id,
          warehouseId: t.main.id,
          quantity: 10,
          movementDate: '2026-10-06',
          reason: 'usage',
        },
        key(),
      ),
      201,
    )
    const before = await rows(t.id)
    const current = await detail(t.admin, count)
    assertError(await complete(t.admin, count, current.version), 422, 'stock_count_negative')
    assert.deepEqual(await rows(t.id), before)
    // Yeniden sayım farkı düzeltir: kâğıt şimdi 0 bulundu → beklenen 10, eksik 10.
    minutesLater(3)
    ok(await setQuantity(t.admin, count, { itemId: t.paper.id, countedQuantity: 0 }))
    ok(await complete(t.admin, count, current.version))
    assert.equal(await balanceOf(t, t.paper), 0)
  })

  test('DOM-FIN-081, K-228, K-230: aynı depoda tek açık sayım; iptal hareket yazmaz, yeni sayım başlatılır', async () => {
    const t = await institution()
    const count = ok(await start(t.admin, t), 201)
    assertError(await start(t.admin, t), 409, 'stock_count_open_exists')
    // Başka depoda sayım başlatılabilir.
    ok(await start(t.admin, t, { warehouseId: t.annex.id }), 201)
    ok(await scan(t.admin, count, { code: 'KAG-A4', quantity: 2 }))
    const movementsBefore = (await rows(t.id))[2]
    const cancelled = ok(await cancel(t.admin, count))
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.cancelReason, 'Yanlış depo seçildi')
    assert.deepEqual((await rows(t.id))[2], movementsBefore)
    assertError(await complete(t.admin, count, cancelled.version), 422, 'stock_count_closed')
    ok(await start(t.admin, t), 201)
    const list = ok(await get(`${COUNTS}?status=cancelled`, t.admin)) as unknown as Json[]
    assert.deepEqual(
      list.map((row) => [row.id, row.countedCount]),
      [[count.id, 1]],
    )
  })

  test('DOM-FIN-081: boş sayım tamamlanmaz; sürüm ve If-Match denetlenir; geçersiz gövde 400 ve kayıt değişmez', async () => {
    const t = await institution()
    const count = ok(await start(t.admin, t), 201)
    const before = await rows(t.id)
    assertError(await complete(t.admin, count), 422, 'stock_count_empty')
    assertError(await complete(t.admin, count, Number(count.version) + 1), 409, 'version_conflict')
    assertError(
      await call('POST', `${COUNTS}/${String(count.id)}/complete`, t.admin, {}),
      400,
      'if_match_required',
    )
    assertError(await scan(t.admin, count, { code: '' }), 400, 'validation_failed')
    assertError(
      await scan(t.admin, count, { code: 'KAG-A4', quantity: 0 }),
      400,
      'validation_failed',
    )
    assertError(await scan(t.admin, count, { code: 'KAG-A4' }, {}), 400)
    assertError(
      await setQuantity(t.admin, count, { itemId: t.paper.id, countedQuantity: -1 }),
      400,
      'validation_failed',
    )
    assertError(await cancel(t.admin, count, 'kısa'), 400, 'validation_failed')
    assertError(await start(t.admin, t, { warehouseId: 'depo' }), 400, 'validation_failed')
    assertError(
      await start(t.admin, t, { warehouseId: randomUUID() }),
      422,
      'stock_warehouse_not_found',
    )
    assertError(await get(`${COUNTS}/${randomUUID()}`, t.admin), 404, 'not_found')
    assert.deepEqual(await rows(t.id), before)
  })

  test('DOM-FIN-081: aynı Idempotency-Key ile okutma bir kez sayılır, ilk yanıt tekrarlanır', async () => {
    const t = await institution()
    const count = ok(await start(t.admin, t), 201)
    const headers = key()
    const first = await scan(t.admin, count, { code: 'KAG-A4', quantity: 3 }, headers)
    const second = await scan(t.admin, count, { code: 'KAG-A4', quantity: 3 }, headers)
    assert.equal(ok(first).countedQuantity, 3)
    assert.equal(ok(second).countedQuantity, 3)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    const current = await detail(t.admin, count)
    assert.equal(((current.counted as Json[])[0] as Json).countedQuantity, 3)
  })

  test('K-228: oturumsuz 401; öğretmen, veli ve öğrenci 403; ön büro okur ve okutur, başlatma, tamamlama ve iptal 403', async () => {
    const t = await institution()
    const count = ok(await start(t.admin, t), 201)
    assertError(await get(COUNTS, null), 401)
    assertError(await start('', t), 401)
    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(COUNTS, cookie), 403, 'forbidden')
      assertError(await get(`${COUNTS}/${String(count.id)}`, cookie), 403, 'forbidden')
      assertError(await scan(cookie, count, { code: 'KAG-A4' }), 403, 'forbidden')
    }
    const front = await member(t.id, 'onburo')
    assert.equal((ok(await get(COUNTS, front)) as unknown as Json[]).length, 1)
    const seen = await detail(front, count)
    assert.deepEqual(seen.actions, { count: true, complete: false, cancel: false })
    ok(await scan(front, count, { code: 'KAG-A4' }))
    ok(await setQuantity(front, count, { itemId: t.pen.id, countedQuantity: 6 }))
    const before = await rows(t.id)
    assertError(await start(front, t, { warehouseId: t.annex.id }), 403, 'forbidden')
    assertError(await complete(front, count), 403, 'forbidden')
    assertError(await cancel(front, count), 403, 'forbidden')
    assert.deepEqual(await rows(t.id), before)
  })

  test('DOM-FIN-081: finance modülü kapalıyken sayım uçları 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    const someCount = { id: randomUUID(), version: 1 }
    assertError(await get(COUNTS, closed.admin), 403, 'module_disabled')
    assertError(
      await call('POST', COUNTS, closed.admin, { warehouseId: randomUUID() }),
      403,
      'module_disabled',
    )
    assertError(await scan(closed.admin, someCount, { code: 'X' }), 403, 'module_disabled')
    assertError(await complete(closed.admin, someCount), 403, 'module_disabled')
  })

  test('DOM-FIN-081: başka kurumun sayımı 404 ve B değişmez; listede B yok; gövdedeki institutionId ve B kimlikleri etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bCount = ok(await start(b.admin, b), 201)
    ok(await scan(b.admin, bCount, { code: 'KAG-A4', quantity: 2 }))
    const bOnly = ok(
      await call('POST', ITEMS, b.admin, {
        code: 'YALNIZ-B',
        name: 'B kartı',
        category: 'stationery',
        unit: 'piece',
      }),
      201,
    )
    const bCountUrl = `${COUNTS}/${String(bCount.id)}`
    const before = await rows(b.id)

    assertError(await get(bCountUrl, a.admin), 404, 'not_found')
    assertError(await scan(a.admin, bCount, { code: 'KAG-A4' }), 404, 'not_found')
    assertError(
      await setQuantity(a.admin, bCount, { itemId: b.paper.id, countedQuantity: 1 }),
      404,
      'not_found',
    )
    assertError(await complete(a.admin, bCount), 404, 'not_found')
    assertError(await cancel(a.admin, bCount), 404, 'not_found')
    assertError(
      await start(a.admin, a, { warehouseId: b.main.id }),
      422,
      'stock_warehouse_not_found',
    )
    assertError(await start(a.admin, a, { institutionId: b.id }), 400, 'validation_failed')
    const aCount = ok(await start(a.admin, a), 201)
    assertError(
      await scan(a.admin, aCount, { code: 'YALNIZ-B' }),
      422,
      'stock_count_item_not_found',
    )
    assertError(
      await setQuantity(a.admin, aCount, { itemId: bOnly.id, countedQuantity: 1 }),
      422,
      'stock_item_not_found',
    )
    assert.deepEqual(await rows(b.id), before)

    const listOf = async () =>
      (ok(await get(COUNTS, a.admin)) as unknown as Json[]).map((row) => row.id)
    assert.deepEqual(await listOf(), [aCount.id])
  })
})
