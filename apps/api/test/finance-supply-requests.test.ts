import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, asc, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { stockMovements } from '../src/db/schema/finance-inventory.ts'
import {
  purchaseRequestItems,
  purchaseRequests,
} from '../src/db/schema/finance-purchase-requests.ts'
import {
  supplyRequestIssues,
  supplyRequestItems,
  supplyRequests,
} from '../src/db/schema/finance-supply-requests.ts'
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
 * Sarf malzeme talebi uçları (DOM-FIN-091; ON-233). Her test kendi kurumunu kurar: seed kampüsleri,
 * Ana depo (Kadıköy), A4 kâğıt (paket) ve lateks eldiven (koli) kartları, depoda 3 paket kâğıt,
 * bir öğretmen ve açık bütçe dönemi (dönüştürme için birim, gider kalemi). FIXED_NOW 2026-10-06.
 */

const SEED = createSeed(FIXED_NOW)
const FINANCE = '/api/v1/finance'
const REQUESTS = `${FINANCE}/supply-requests`
const CARDS = `${REQUESTS}/stock-items`
const TODAY = '2026-10-06'

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-091: sarf malzeme talebi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.91.0.1'

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
  const key = () => ({ 'idempotency-key': randomUUID() })
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
    clientIp = `10.91.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    const admin = await signInAs(app, created.admin)
    const teacher = await member(created.id, 'ogretmen')
    if (overrides.enabledModules?.finance === false)
      return { id: created.id, admin, teacher } as Tenant
    await insertMissingRecords(
      db,
      created.id,
      SEED.branches.map((data) => ({ collection: 'branches' as const, id: data.id, data })),
      FIXED_NOW,
    )
    const post = async (url: string, body: Json, headers: Record<string, string> = {}) =>
      ok(await call('POST', `${FINANCE}${url}`, admin, body, headers), 201)
    const main = await post('/stock-warehouses', { name: 'Ana depo', campusId: 'b1' })
    const paper = await post('/stock-items', {
      code: 'kag-a4',
      name: 'A4 kâğıt',
      category: 'stationery',
      unit: 'pack',
    })
    const glove = await post('/stock-items', {
      code: 'eld-m',
      name: 'Lateks eldiven',
      category: 'other',
      unit: 'box',
    })
    await post(
      '/stock-entries',
      {
        itemId: paper.id,
        warehouseId: main.id,
        quantity: 3,
        movementDate: '2026-10-01',
        reason: 'opening',
      },
      key(),
    )
    const center = await post('/cost-centers', { code: 'FEN', name: 'Fen Zümresi', type: 'unit' })
    const expense = await post('/budget-items', { code: 'G-200', name: 'Malzeme', kind: 'expense' })
    const period = await post('/budget-periods', { name: '2026–2027', academicYear: 2026 })
    ok(
      await call(
        'POST',
        `${FINANCE}/budget-periods/${String(period.id)}/open`,
        admin,
        undefined,
        ifMatch(period.version),
      ),
    )
    return { id: created.id, admin, teacher, main, paper, glove, center, expense, period }
  }
  type Tenant = {
    id: string
    admin: string
    teacher: string
    main: Json
    paper: Json
    glove: Json
    center: Json
    expense: Json
    period: Json
  }

  async function member(institutionId: string, role: Role) {
    return signInAs(app, await createMember(app, institutionId, role))
  }
  const create = (
    cookie: string,
    t: Tenant,
    extra: Json = {},
    headers: Record<string, string> = key(),
  ) =>
    call(
      'POST',
      REQUESTS,
      cookie,
      {
        neededDate: '2026-10-09',
        justification: '9-A fen deneyi için',
        items: [
          { stockItemId: t.paper.id, quantity: 4 },
          { stockItemId: t.glove.id, quantity: 2 },
        ],
        ...extra,
      },
      headers,
    )
  const act = (cookie: string, request: Json, verb: string, body?: Json) =>
    call('POST', `${REQUESTS}/${String(request.id)}/${verb}`, cookie, body ?? {}, {
      ...ifMatch(request.version),
      ...(verb === 'fulfill' || verb === 'convert' ? key() : {}),
    })
  const approved = async (t: Tenant) => {
    const request = ok(await create(t.teacher, t), 201)
    return ok(await act(t.admin, request, 'approve'))
  }
  const fulfill = (cookie: string, t: Tenant, request: Json, extra: Json = {}) =>
    act(cookie, request, 'fulfill', { warehouseId: t.main.id, movementDate: TODAY, ...extra })
  const convertBody = (t: Tenant, request: Json) => ({
    costCenterId: t.center.id,
    periodId: t.period.id,
    budgetItemId: t.expense.id,
    prices: (request.items as Json[])
      .filter((item) => Number(item.remainingQuantity) > 0)
      .map((item) => ({ itemId: item.id, estimatedUnitPriceCents: 15_000 })),
  })
  const convert = (cookie: string, t: Tenant, request: Json, extra: Json = {}) =>
    act(cookie, request, 'convert', { ...convertBody(t, request), ...extra })

  async function rows(institutionId: string) {
    const [requests, items, issues, movements, purchases] = await Promise.all([
      db
        .select()
        .from(supplyRequests)
        .where(eq(supplyRequests.institutionId, institutionId))
        .orderBy(asc(supplyRequests.id)),
      db
        .select()
        .from(supplyRequestItems)
        .where(eq(supplyRequestItems.institutionId, institutionId))
        .orderBy(asc(supplyRequestItems.id)),
      db
        .select()
        .from(supplyRequestIssues)
        .where(eq(supplyRequestIssues.institutionId, institutionId))
        .orderBy(asc(supplyRequestIssues.id)),
      db
        .select()
        .from(stockMovements)
        .where(eq(stockMovements.institutionId, institutionId))
        .orderBy(asc(stockMovements.id)),
      db
        .select()
        .from(purchaseRequests)
        .where(eq(purchaseRequests.institutionId, institutionId))
        .orderBy(asc(purchaseRequests.id)),
    ])
    return { requests, items, issues, movements, purchases }
  }

  test('DOM-FIN-091: kimliksiz 401, veli ve öğrenci 403, modül kapalı 403', async () => {
    const t = await institution()
    assertError(await get(REQUESTS, null), 401)
    assertError(await create(null as unknown as string, t), 401)
    for (const role of ['veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(REQUESTS, cookie), 403)
      assertError(await create(cookie, t), 403)
    }
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(REQUESTS, closed.teacher), 403, 'module_disabled')
    assertError(await get(CARDS, closed.admin), 403, 'module_disabled')
  })

  test('DOM-FIN-091: öğretmen kart listesinden seçip talep açar; Idempotency-Key zorunlu, tekrar aynı yanıt', async () => {
    const t = await institution()
    const cards = (await get(`${CARDS}?q=eldiven`, t.teacher)).json()
    assert.deepEqual(
      cards.data.map((card: Json) => card.code),
      ['ELD-M'],
    )
    assert.equal('quantity' in cards.data[0], false)
    assertError(await create(t.teacher, t, {}, {}), 400, 'idempotency_key_required')
    const headers = key()
    const response = await create(t.teacher, t, {}, headers)
    const created = ok(response, 201)
    assert.equal(response.headers.location, `${REQUESTS}/${String(created.id)}`)
    assert.equal(created.number, 'SM-0001')
    assert.equal(created.status, 'submitted')
    assert.equal(created.neededDate, '2026-10-09')
    assert.deepEqual(created.actions, {
      cancel: true,
      decide: false,
      fulfill: false,
      convert: false,
    })
    const items = created.items as Json[]
    assert.deepEqual(
      items.map((item) => [item.unit, item.quantity, item.remainingQuantity, item.stock]),
      [
        ['pack', 4, 4, null],
        ['box', 2, 2, null],
      ],
    )
    const replay = await create(t.teacher, t, {}, headers)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(ok(replay, 201).id, created.id)
    assert.equal((await rows(t.id)).requests.length, 1)
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'supply_request.create')))
    assert.ok(audit)
  })

  test('DOM-FIN-091: geçersiz talep 400/422 ve hiçbir kayıt yazılmaz', async () => {
    const t = await institution()
    const before = await rows(t.id)
    assertError(await create(t.teacher, t, { items: [] }), 400, 'validation_failed')
    const unknown = await create(t.teacher, t, {
      items: [{ stockItemId: randomUUID(), quantity: 1 }],
    })
    assertError(unknown, 400, 'validation_failed')
    assert.equal(unknown.json().issues[0].path.join('.'), 'items.0.stockItemId')
    assertError(
      await create(t.teacher, t, { neededDate: '2026-10-05' }),
      422,
      'supply_request_needed_date_past',
    )
    ok(
      await call(
        'PATCH',
        `${FINANCE}/stock-items/${String(t.glove.id)}`,
        t.admin,
        { isActive: false },
        ifMatch(t.glove.version),
      ),
    )
    assertError(await create(t.teacher, t), 422, 'supply_request_stock_item_inactive')
    assert.deepEqual(await rows(t.id), before)
  })

  test('DOM-FIN-091: öğretmen yalnız kendi talebini görür; ön büro ve yönetici hepsini süzer', async () => {
    const t = await institution()
    const other = await member(t.id, 'ogretmen')
    const front = await member(t.id, 'onburo')
    const mine = ok(await create(t.teacher, t), 201)
    const theirs = ok(
      await create(other, t, {
        justification: 'Kimya deneyi',
        items: [{ stockItemId: t.glove.id, quantity: 1 }],
      }),
      201,
    )
    const ids = async (cookie: string, query = '') =>
      ((await get(`${REQUESTS}${query}`, cookie)).json().data as Json[]).map((row) => row.id)
    assert.deepEqual(await ids(t.teacher), [mine.id])
    assert.deepEqual(await ids(other), [theirs.id])
    assert.deepEqual(await ids(front), [theirs.id, mine.id])
    assert.deepEqual(await ids(t.admin, `?stockItemId=${String(t.paper.id)}`), [mine.id])
    assert.deepEqual(await ids(t.admin, '?q=kimya'), [theirs.id])
    assert.deepEqual(await ids(t.admin, '?q=SM-0001'), [mine.id])
    assert.deepEqual(await ids(t.admin, '?q=kag-a4'), [mine.id])
    assert.deepEqual(await ids(t.admin, '?status=approved'), [])
    assert.deepEqual(await ids(front, '?mine=true'), [])
    // Öğretmen mine=false verse de yalnız kendininkini görür.
    assert.deepEqual(await ids(t.teacher, '?mine=false'), [mine.id])
    const page = (await get(`${REQUESTS}?pageSize=1&page=2`, front)).json()
    assert.deepEqual(page.meta, { page: 2, pageSize: 1, total: 2 })
    assertError(await get(`${REQUESTS}?sort=number`, front), 400)
    assertError(await get(`${REQUESTS}/${String(theirs.id)}`, t.teacher), 404, 'not_found')
    assertError(
      await act(t.teacher, theirs, 'cancel', { reason: 'Gerek kalmadı' }),
      404,
      'not_found',
    )
    const detail = ok(await get(`${REQUESTS}/${String(mine.id)}`, front))
    assert.deepEqual((detail.items as Json[])[0]?.stock, [
      { warehouseId: t.main.id, warehouseName: 'Ana depo', quantity: 3 },
    ])
  })

  test('DOM-FIN-091: onay ve ret yöneticide; iptal yalnız talep edende ve onaydan önce', async () => {
    const t = await institution()
    const front = await member(t.id, 'onburo')
    const request = ok(await create(t.teacher, t), 201)
    assertError(await act(t.teacher, request, 'approve'), 403)
    assertError(await act(front, request, 'approve'), 403)
    assertError(
      await act(t.admin, request, 'cancel', { reason: 'Yönetici iptali' }),
      403,
      'supply_request_not_owner',
    )
    assertError(await act(t.admin, request, 'reject', { reason: 'yok' }), 400)
    assertError(await act(t.admin, { ...request, version: 9 }, 'approve'), 409, 'version_conflict')
    const approvedRequest = ok(await act(t.admin, request, 'approve', { note: 'Uygun' }))
    assert.equal(approvedRequest.status, 'approved')
    assert.equal(approvedRequest.decisionNote, 'Uygun')
    assertError(
      await act(t.teacher, approvedRequest, 'cancel', { reason: 'Gerek kalmadı' }),
      422,
      'supply_request_not_cancellable',
    )
    assertError(await act(t.admin, approvedRequest, 'approve'), 422, 'supply_request_not_submitted')

    const second = ok(await create(t.teacher, t), 201)
    const rejected = ok(await act(t.admin, second, 'reject', { reason: 'Bu dönem bütçe yok' }))
    assert.equal(rejected.status, 'rejected')
    assert.equal(rejected.decisionNote, 'Bu dönem bütçe yok')

    const third = ok(await create(t.teacher, t), 201)
    const cancelled = ok(await act(t.teacher, third, 'cancel', { reason: 'Gerek kalmadı' }))
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.cancelReason, 'Gerek kalmadı')
  })

  test('DOM-FIN-091: karşılama stoktan karşılanabileni supply çıkışıyla yazar; kalan sonra karşılanır', async () => {
    const t = await institution()
    const front = await member(t.id, 'onburo')
    const request = await approved(t)
    assertError(await fulfill(t.teacher, t, request), 403)
    // Ön büro depo sorumlusu olarak karşılar (K-244); stok 3 paket, eldiven yok.
    ok(await fulfill(front, t, request))
    const partial = ok(await get(`${REQUESTS}/${String(request.id)}`, front))
    assert.equal(partial.status, 'approved')
    assert.deepEqual(
      (partial.items as Json[]).map((item) => [item.fulfilledQuantity, item.remainingQuantity]),
      [
        [3, 1],
        [0, 2],
      ],
    )
    const [movement] = (await rows(t.id)).movements.filter((row) => row.type === 'supply')
    assert.equal(movement?.quantity, 3)
    assert.equal((partial.issues as Json[]).length, 1)
    // Çıkış hareket listesinden iptal edilmez (K-245).
    const listed = (await get(`${FINANCE}/stock-movements?type=supply`, t.admin)).json().data
    assert.equal(listed[0].actions.cancel, false)
    assertError(
      await call(
        'POST',
        `${FINANCE}/stock-movements/${String(movement?.id)}/cancel`,
        t.admin,
        { reason: 'Yanlış çıkış' },
        ifMatch(movement?.version),
      ),
      422,
      'stock_movement_from_supply',
    )
    // Depoda kalmadı: ikinci karşılama 422, hiçbir şey yazılmaz.
    const before = await rows(t.id)
    assertError(await fulfill(t.admin, t, partial), 422, 'supply_request_nothing_available')
    assertError(
      await fulfill(t.admin, t, partial, {
        lines: [{ itemId: (partial.items as Json[])[0]?.id, quantity: 2 }],
      }),
      422,
      'supply_request_quantity_exceeds_remaining',
    )
    assertError(await fulfill(t.admin, t, request), 409, 'version_conflict')
    assert.deepEqual(await rows(t.id), before)
    // Mal gelince kalan karşılanır ve talep karşılandı olur.
    for (const [itemId, quantity] of [
      [t.paper.id, 5],
      [t.glove.id, 2],
    ] as const)
      ok(
        await call(
          'POST',
          `${FINANCE}/stock-entries`,
          t.admin,
          { itemId, warehouseId: t.main.id, quantity, movementDate: TODAY, reason: 'donation' },
          key(),
        ),
        201,
      )
    const done = ok(await fulfill(t.admin, t, partial))
    assert.equal(done.status, 'fulfilled')
    assert.equal(done.fullyFulfilled, true)
    assert.equal(done.fulfilledByName, 'Test Yönetici')
    assertError(await fulfill(t.admin, t, done), 422, 'supply_request_not_approved')
  })

  test('DOM-FIN-091: kalanı olan talep açıklamayla kısmi karşılanmış kapatılır', async () => {
    const t = await institution()
    const request = await approved(t)
    assertError(
      await fulfill(t.admin, t, request, { close: true }),
      422,
      'supply_request_close_note_required',
    )
    const closed = ok(
      await fulfill(t.admin, t, request, { close: true, closeNote: 'Eldiven alınmayacak' }),
    )
    assert.equal(closed.status, 'fulfilled')
    assert.equal(closed.fullyFulfilled, false)
    assert.equal(closed.fulfillmentNote, 'Eldiven alınmayacak')
    assert.equal(closed.actions && (closed.actions as Json).convert, false)
  })

  test('DOM-FIN-071, DOM-FIN-091: kalan satın alma talebine kart bağıyla dönüşür; iki talep bağlanır', async () => {
    const t = await institution()
    const request = await approved(t)
    const partial = ok(await fulfill(t.admin, t, request))
    assertError(await convert(t.admin, t, partial, { prices: [] }), 400, 'validation_failed')
    const before = await rows(t.id)
    assertError(
      await convert(t.admin, t, partial, { budgetItemId: randomUUID() }),
      422,
      'purchase_request_budget_item_not_found',
    )
    assert.deepEqual(await rows(t.id), before)
    const converted = ok(await convert(t.admin, t, partial))
    const link = converted.purchaseRequest as Json
    assert.equal(link.number, 'ST-0001')
    assert.equal(link.status, 'draft')
    assert.equal((converted.actions as Json).convert, false)
    const purchase = ok(await get(`${FINANCE}/purchase-requests/${String(link.id)}`, t.admin))
    assert.deepEqual(purchase.supplyRequest, { id: request.id, number: 'SM-0001' })
    assert.equal(purchase.justification, 'Sarf talebi SM-0001: 9-A fen deneyi için')
    const lines = await db
      .select()
      .from(purchaseRequestItems)
      .where(
        and(
          eq(purchaseRequestItems.institutionId, t.id),
          eq(purchaseRequestItems.requestId, String(link.id)),
        ),
      )
      .orderBy(asc(purchaseRequestItems.position))
    assert.deepEqual(
      lines.map((line) => [line.name, line.quantity, line.unit, line.stockItemId]),
      [
        ['A4 kâğıt (KAG-A4)', 1, 'pack', t.paper.id],
        ['Lateks eldiven (ELD-M)', 2, 'box', t.glove.id],
      ],
    )
    assertError(await convert(t.admin, t, converted), 409, 'supply_request_already_converted')
    // Satın alma talebi iptal edilirse kalan yeniden dönüştürülür.
    ok(
      await call(
        'POST',
        `${FINANCE}/purchase-requests/${String(link.id)}/cancel`,
        t.admin,
        { reason: 'Tedarikçi değişti' },
        ifMatch(purchase.version),
      ),
    )
    const again = ok(await get(`${REQUESTS}/${String(request.id)}`, t.admin))
    assert.equal((again.actions as Json).convert, true)
    const reconverted = ok(await convert(t.admin, t, again))
    assert.equal((reconverted.purchaseRequest as Json).number, 'ST-0002')
  })

  test('DOM-FIN-091: başka kurumun talebi 404 ve B değişmez; listede B yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bRequest = await approved(b)
    const bUrl = `${REQUESTS}/${String(bRequest.id)}`
    const before = await rows(b.id)

    assertError(await get(bUrl, a.admin), 404, 'not_found')
    for (const verb of ['approve', 'reject', 'cancel'])
      assertError(
        await act(a.admin, bRequest, verb, verb === 'approve' ? {} : { reason: 'Başka kurum' }),
        404,
        'not_found',
      )
    assertError(await fulfill(a.admin, a, bRequest), 404, 'not_found')
    assertError(await convert(a.admin, a, bRequest), 404, 'not_found')
    // B'nin kartı A'nın talebinde bilinmeyen karttır; gövdedeki institutionId şemada yoktur.
    assertError(
      await create(a.teacher, a, { items: [{ stockItemId: b.paper.id, quantity: 1 }] }),
      400,
      'validation_failed',
    )
    assertError(await create(a.teacher, a, { institutionId: b.id }), 400, 'validation_failed')
    assert.deepEqual(await rows(b.id), before)

    const listOf = async (cookie: string) =>
      ((await get(REQUESTS, cookie)).json().data as Json[]).map((row) => row.id)
    assert.equal((await listOf(a.admin)).includes(bRequest.id), false)
    const cardIds = ((await get(CARDS, a.teacher)).json().data as Json[]).map((row) => row.id)
    assert.equal(cardIds.includes(b.paper.id), false)
  })
})
