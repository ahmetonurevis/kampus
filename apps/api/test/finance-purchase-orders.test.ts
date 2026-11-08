import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, isNull } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  purchaseOrderItems,
  purchaseOrders,
  purchaseQuoteItems,
  purchaseQuotes,
} from '../src/db/schema/finance-purchase-orders.ts'
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
 * Satın alma teklifi ve siparişi uçları (DOM-FIN-072, DOM-FIN-073; ON-224, ON-225). Her test kendi
 * kurumunu kurar: birim, gider kalemi, açık dönem, iki şirket ve bir şahıs tedarikçi, onaylanmış
 * iki kalemli talep (10 klavye, 3 fare). FIXED_NOW 2026-10-06.
 */

const FINANCE = '/api/v1/finance'
const REQUESTS = `${FINANCE}/purchase-requests`
const ORDERS = `${FINANCE}/purchase-orders`
const TCKN = '10000000146'

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-072, DOM-FIN-073: teklif ve sipariş uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.72.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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
    clientIp = `10.72.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    const admin = await signInAs(app, created.admin)
    if (overrides.enabledModules?.finance === false)
      return { id: created.id, admin } as Tenant & { id: string; admin: string }
    const post = async (url: string, body: Json) =>
      ok(await call('POST', `${FINANCE}${url}`, admin, body), 201)
    const center = await post('/cost-centers', { code: 'BT', name: 'Bilgi İşlem', type: 'unit' })
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
    const supplier = (name: string, taxNumber: string, extra: Json = {}) =>
      post('/suppliers', {
        name,
        type: 'company',
        taxNumber,
        taxOffice: 'Kadıköy',
        categories: ['it'],
        ...extra,
      })
    const alpha = await supplier('Alfa Bilişim A.Ş.', '1234567890')
    const beta = await supplier('Beta Teknoloji Ltd.', '1111111114')
    const person = await supplier('Ayla Örnek', TCKN, { type: 'individual', taxOffice: 'Üsküdar' })
    const request = await approvedRequest(admin, center, period, expense)
    return { id: created.id, admin, center, period, expense, alpha, beta, person, request }
  }
  type Tenant = {
    id: string
    admin: string
    center: Json
    period: Json
    expense: Json
    alpha: Json
    beta: Json
    person: Json
    request: Json
  }

  async function approvedRequest(admin: string, center: Json, period: Json, expense: Json) {
    const created = ok(
      await call('POST', REQUESTS, admin, {
        costCenterId: center.id,
        periodId: period.id,
        budgetItemId: expense.id,
        justification: 'Bilgisayar laboratuvarı için yedek parça',
        items: [
          { name: 'Klavye', quantity: 10, unit: 'piece', estimatedUnitPriceCents: 25_000 },
          { name: 'Fare', quantity: 3, unit: 'piece', estimatedUnitPriceCents: 15_000 },
        ],
      }),
      201,
    )
    const submitted = ok(
      await call(
        'POST',
        `${REQUESTS}/${String(created.id)}/submit`,
        admin,
        undefined,
        ifMatch(created.version),
      ),
    )
    return ok(
      await call(
        'POST',
        `${REQUESTS}/${String(created.id)}/approve`,
        admin,
        {},
        ifMatch(submitted.version),
      ),
    )
  }

  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))
  const quotesUrl = (t: Pick<Tenant, 'request'>) => `${REQUESTS}/${String(t.request.id)}/quotes`
  const itemIds = (t: Pick<Tenant, 'request'>) => (t.request.items as Json[]).map((i) => i.id)
  const quoteBody = (
    t: Tenant,
    supplier: Json,
    [keyboard, mouse]: [number, number],
    overrides: Json = {},
  ) => {
    const [keyboardId, mouseId] = itemIds(t)
    return {
      supplierId: supplier.id,
      deliveryDays: 7,
      validUntil: '2026-10-20',
      items: [
        { requestItemId: keyboardId, unitPriceCents: keyboard, vatRate: 20 },
        { requestItemId: mouseId, unitPriceCents: mouse, vatRate: 20 },
      ],
      ...overrides,
    }
  }
  const addQuote = async (cookie: string, t: Tenant, body: Json) =>
    ok(await call('POST', quotesUrl(t), cookie, body), 201)
  const quoteOf = (board: Json, supplier: Json) =>
    (board.quotes as Json[]).find((quote) => (quote.supplier as Json).id === supplier.id) as Json
  const select = (cookie: string, t: Tenant, quote: Json, payload: Json = {}) =>
    call(
      'POST',
      `${quotesUrl(t)}/${String(quote.id)}/select`,
      cookie,
      payload,
      ifMatch(quote.version),
    )
  const order = (cookie: string, quote: Json, headers: Record<string, string> = key()) =>
    call('POST', ORDERS, cookie, { quoteId: quote.id }, headers)
  const actOrder = (cookie: string, row: Json, verb: string, payload?: Json) =>
    call('POST', `${ORDERS}/${String(row.id)}/${verb}`, cookie, payload, ifMatch(row.version))
  const quoteRows = (institutionId: string) =>
    db.select().from(purchaseQuotes).where(eq(purchaseQuotes.institutionId, institutionId))
  const orderRows = (institutionId: string) =>
    db.select().from(purchaseOrders).where(eq(purchaseOrders.institutionId, institutionId))

  /** İki teklif girilmiş, en düşük (Beta) seçili kurum. */
  async function selectedTenant() {
    const t = await institution()
    await addQuote(t.admin, t, quoteBody(t, t.alpha, [20_000, 10_000]))
    const board = await addQuote(t.admin, t, quoteBody(t, t.beta, [19_000, 12_000]))
    const selected = ok(await select(t.admin, t, quoteOf(board, t.beta)))
    return { ...t, board: selected, quote: quoteOf(selected, t.beta) }
  }

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    assertError(await get(`${REQUESTS}/${id}/quotes`, null), 401)
    assertError(await call('POST', `${REQUESTS}/${id}/quotes`, null, {}), 401)
    assertError(await call('DELETE', `${REQUESTS}/${id}/quotes/${id}`, null), 401)
    assertError(await get(ORDERS, null), 401)
    assertError(await get(`${ORDERS}/${id}`, null), 401)
    assertError(await call('POST', ORDERS, null, {}, key()), 401)
  })

  test('DOM-FIN-072, DOM-FIN-073: öğretmen, veli, öğrenci 403; ön büro teklif girer ama seçemez, sipariş açamaz (K-136, K-141)', async () => {
    const t = await institution()
    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(quotesUrl(t), cookie), 403)
      assertError(await call('POST', quotesUrl(t), cookie, quoteBody(t, t.alpha, [1, 1])), 403)
      assertError(await get(ORDERS, cookie), 403)
    }
    const front = await member(t.id, 'onburo')
    const board = await addQuote(front, t, quoteBody(t, t.alpha, [20_000, 10_000]))
    const quote = quoteOf(board, t.alpha)
    assert.deepEqual(quote.actions, { edit: true, remove: true, select: false })
    assert.deepEqual(board.actions, { add: true, order: false })
    assertError(await select(front, t, quote), 403)
    const adminBoard = await addQuote(t.admin, t, quoteBody(t, t.beta, [19_000, 12_000]))
    const adminQuote = quoteOf(adminBoard, t.beta)
    assertError(
      await call(
        'PATCH',
        `${quotesUrl(t)}/${String(adminQuote.id)}`,
        front,
        { deliveryDays: 1 },
        ifMatch(adminQuote.version),
      ),
      403,
      'purchase_quote_not_owner',
    )
    const chosen = ok(await select(t.admin, t, adminQuote))
    assertError(await order(front, quoteOf(chosen, t.beta)), 403)
    assert.equal((await orderRows(t.id)).length, 0)
    assert.equal(
      (await quoteRows(t.id)).find((row) => row.supplierId === t.beta.id)?.deliveryDays,
      7,
    )
  })

  test('DOM-FIN-072: finance modülü kapalıyken teklif ve sipariş uçları 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(
      await get(`${REQUESTS}/${randomUUID()}/quotes`, closed.admin),
      403,
      'module_disabled',
    )
    assertError(await get(ORDERS, closed.admin), 403, 'module_disabled')
    assertError(await call('POST', ORDERS, closed.admin, { quoteId: randomUUID() }, key()), 403)
  })

  test('DOM-FIN-072: teklifler kalem × tedarikçi karşılaştırılır; KDV kalemde yuvarlanır, en düşük vurgulanır', async () => {
    const t = await institution()
    await addQuote(t.admin, t, quoteBody(t, t.alpha, [20_000, 10_005], { note: 'Kargo dahil' }))
    const board = await addQuote(t.admin, t, quoteBody(t, t.beta, [19_000, 12_000]))
    assert.deepEqual(board.request, {
      id: t.request.id,
      number: t.request.number,
      status: 'approved',
    })
    assert.equal((board.items as Json[]).length, 2)
    const alpha = quoteOf(board, t.alpha)
    const beta = quoteOf(board, t.beta)
    // Alfa: 200.000 + 30.015 net; fare KDV'si 6.003 (kalemde yuvarlama).
    assert.deepEqual(
      [alpha.netCents, alpha.vatCents, alpha.grossCents, alpha.lowest, alpha.note],
      [230_015, 46_003, 276_018, false, 'Kargo dahil'],
    )
    assert.deepEqual([beta.grossCents, beta.lowest, beta.expired], [271_200, true, false])
    assert.deepEqual(
      (alpha.lines as Json[]).map((line) => [line.grossCents, line.lowest]),
      [
        [240_000, false],
        [36_018, true],
      ],
    )
    assert.equal(board.lowestGrossCents, 271_200)
    assert.equal(alpha.createdByName, 'Test Yönetici')
    assert.deepEqual(board.orders, [])
    assert.deepEqual(ok(await get(quotesUrl(t), t.admin)), board)
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'purchase_quote.create')))
    assert.equal(audit.length, 2)
  })

  test('DOM-FIN-072: geçersiz teklif 400/422/409 ve hiçbir kayıt değişmez (K-135)', async () => {
    const t = await institution()
    await addQuote(t.admin, t, quoteBody(t, t.alpha, [20_000, 10_000]))
    const before = await quoteRows(t.id)
    const [keyboardId] = itemIds(t)
    assertError(
      await call('POST', quotesUrl(t), t.admin, quoteBody(t, t.beta, [1, 1], { deliveryDays: -1 })),
      400,
    )
    assertError(
      await call(
        'POST',
        quotesUrl(t),
        t.admin,
        quoteBody(t, t.beta, [1, 1], {
          items: [{ requestItemId: keyboardId, unitPriceCents: 1, vatRate: 20 }],
        }),
      ),
      422,
      'purchase_quote_item_missing',
    )
    assertError(
      await call('POST', quotesUrl(t), t.admin, quoteBody(t, t.alpha, [1, 1])),
      409,
      'purchase_quote_supplier_exists',
    )
    assertError(
      await call(
        'POST',
        quotesUrl(t),
        t.admin,
        quoteBody(t, t.beta, [1, 1], { validUntil: '2026-10-05' }),
      ),
      422,
      'purchase_quote_valid_until_past',
    )
    assertError(
      await call('POST', quotesUrl(t), t.admin, quoteBody(t, t.beta, [1, 1]), ifMatch(1)),
      400,
      'if_match_not_supported',
    )
    assert.deepEqual(await quoteRows(t.id), before)
    // Onaylanmamış talebe teklif girilmez.
    const draft = ok(
      await call('POST', REQUESTS, t.admin, {
        costCenterId: t.center.id,
        periodId: t.period.id,
        budgetItemId: t.expense.id,
        justification: 'Taslak talep gerekçesi',
        items: [{ name: 'Kalem', quantity: 1, unit: 'piece', estimatedUnitPriceCents: 100 }],
      }),
      201,
    )
    const draftItem = (draft.items as Json[])[0]
    assertError(
      await call('POST', `${REQUESTS}/${String(draft.id)}/quotes`, t.admin, {
        supplierId: t.beta.id,
        deliveryDays: 1,
        validUntil: '2026-10-20',
        items: [{ requestItemId: draftItem?.id, unitPriceCents: 100, vatRate: 20 }],
      }),
      422,
      'purchase_quote_request_not_approved',
    )
    assertError(await get(`${REQUESTS}/${randomUUID()}/quotes`, t.admin), 404)
  })

  test('DOM-FIN-072: en düşük olmayan teklif gerekçesiz seçilmez; seçim tektir, düzeltme seçimi düşürür (K-137)', async () => {
    const t = await institution()
    await addQuote(t.admin, t, quoteBody(t, t.alpha, [20_000, 10_000]))
    const board = await addQuote(t.admin, t, quoteBody(t, t.beta, [19_000, 12_000]))
    const alpha = quoteOf(board, t.alpha)
    assertError(
      await select(t.admin, t, alpha, { reason: 'kısa' }),
      422,
      'purchase_quote_reason_required',
    )
    assert.equal((await quoteRows(t.id)).filter((row) => row.selectedAt !== null).length, 0)
    const withAlpha = ok(
      await select(t.admin, t, alpha, { reason: 'Teslim süresi daha kısa ve yerel servis var' }),
    )
    const selectedAlpha = quoteOf(withAlpha, t.alpha)
    assert.equal(selectedAlpha.selected, true)
    assert.equal(selectedAlpha.selectionReason, 'Teslim süresi daha kısa ve yerel servis var')
    assert.equal(selectedAlpha.selectedByName, 'Test Yönetici')
    assert.deepEqual(withAlpha.actions, { add: true, order: true })
    assertError(await select(t.admin, t, alpha), 409, 'version_conflict')
    // Başka teklif seçilince önceki seçim düşer.
    const withBeta = ok(await select(t.admin, t, quoteOf(withAlpha, t.beta)))
    assert.deepEqual(
      [quoteOf(withBeta, t.alpha).selected, quoteOf(withBeta, t.beta).selected],
      [false, true],
    )
    const beta = quoteOf(withBeta, t.beta)
    const edited = ok(
      await call(
        'PATCH',
        `${quotesUrl(t)}/${String(beta.id)}`,
        t.admin,
        { validUntil: '2026-11-01', note: 'Güncel fiyat listesi' },
        ifMatch(beta.version),
      ),
    )
    assert.equal(quoteOf(edited, t.beta).selected, false)
    assert.equal(quoteOf(edited, t.beta).validUntil, '2026-11-01')
    const rows = await quoteRows(t.id)
    assert.equal(rows.filter((row) => row.selectedAt !== null).length, 0)
    assert.equal(rows.find((row) => row.supplierId === t.beta.id)?.selectionReason, null)
    // Silinen teklif karşılaştırmadan çıkar; fiyatları da arşivlenir.
    const removed = ok(
      await call(
        'DELETE',
        `${quotesUrl(t)}/${String(quoteOf(edited, t.alpha).id)}`,
        t.admin,
        undefined,
        ifMatch(quoteOf(edited, t.alpha).version),
      ),
    )
    assert.equal((removed.quotes as Json[]).length, 1)
    const items = await db
      .select()
      .from(purchaseQuoteItems)
      .where(and(eq(purchaseQuoteItems.institutionId, t.id), isNull(purchaseQuoteItems.archivedAt)))
    assert.equal(items.length, 2)
  })

  test('DOM-FIN-073: seçili tekliften SA-<yıl>-<sıra> numaralı sipariş; tutar kopyası, talep kilitlenir (K-139, K-140)', async () => {
    const t = await selectedTenant()
    assertError(await order(t.admin, t.quote, {}), 400, 'idempotency_key_required')
    const headers = key()
    const response = await order(t.admin, t.quote, headers)
    const created = ok(response, 201)
    assert.equal(response.headers.location, `${ORDERS}/${String(created.id)}`)
    assert.equal(created.number, 'SA-2026-0001')
    assert.equal(created.status, 'draft')
    assert.deepEqual(created.request, { id: t.request.id, number: t.request.number })
    assert.deepEqual(
      [created.netCents, created.vatCents, created.grossCents, created.itemCount],
      [226_000, 45_200, 271_200, 2],
    )
    assert.equal(created.expectedDeliveryDate, '2026-10-13')
    assert.deepEqual(created.supplier, {
      id: t.beta.id,
      name: 'Beta Teknoloji Ltd.',
      type: 'company',
      taxNumber: '1111111114',
      taxOffice: 'Kadıköy',
    })
    assert.deepEqual(
      (created.items as Json[]).map((item) => [item.name, item.quantity, item.unitPriceCents]),
      [
        ['Klavye', 10, 19_000],
        ['Fare', 3, 12_000],
      ],
    )
    assert.deepEqual(created.actions, { send: true, cancel: true })
    // Aynı anahtar ilk yanıtı tekrarlar; ikinci sipariş açılmaz.
    const replay = await order(t.admin, t.quote, headers)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(ok(replay, 201).id, created.id)
    assertError(await order(t.admin, t.quote), 409, 'purchase_order_exists')
    assert.equal((await orderRows(t.id)).length, 1)
    // Etkin siparişi olan talebin teklifleri kilitli.
    const board = ok(await get(quotesUrl(t), t.admin))
    assert.deepEqual(board.orders, [{ id: created.id, number: 'SA-2026-0001', status: 'draft' }])
    assert.deepEqual(board.actions, { add: false, order: false })
    const beta = quoteOf(board, t.beta)
    assertError(
      await call(
        'PATCH',
        `${quotesUrl(t)}/${String(beta.id)}`,
        t.admin,
        { deliveryDays: 1 },
        ifMatch(beta.version),
      ),
      422,
      'purchase_quote_locked',
    )
    // Talep onaylı kalır, iptal edilemez (K-132, K-140).
    const request = ok(await get(`${REQUESTS}/${String(t.request.id)}`, t.admin))
    assert.equal(request.status, 'approved')
    assertError(
      await call(
        'POST',
        `${REQUESTS}/${String(t.request.id)}/cancel`,
        t.admin,
        { reason: 'Vazgeçildi' },
        ifMatch(request.version),
      ),
      422,
      'purchase_request_not_cancellable',
    )
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'purchase_order.create')))
    assert.equal(audit.length, 1)
  })

  test('DOM-FIN-073: seçilmemiş teklif ve başka talebin teklifi sipariş olmaz, kayıt yazılmaz', async () => {
    const t = await institution()
    const board = await addQuote(t.admin, t, quoteBody(t, t.alpha, [20_000, 10_000]))
    assertError(
      await order(t.admin, quoteOf(board, t.alpha)),
      422,
      'purchase_order_quote_not_selected',
    )
    assertError(await order(t.admin, { id: randomUUID() }), 422, 'purchase_order_quote_not_found')
    assertError(await call('POST', ORDERS, t.admin, { quoteId: 'x' }, key()), 400)
    assert.equal((await orderRows(t.id)).length, 0)
  })

  test('DOM-FIN-073: gönderildi işareti ön büroda, iptal yönetimde; iptal talebi yeniden açar, numara ardışık', async () => {
    const t = await selectedTenant()
    const created = ok(await order(t.admin, t.quote), 201)
    const front = await member(t.id, 'onburo')
    assertError(await actOrder(front, created, 'cancel', { reason: 'Gerekli değil' }), 403)
    const sent = ok(await actOrder(front, created, 'send'))
    assert.equal(sent.status, 'sent')
    assert.equal(typeof sent.sentAt, 'string')
    assert.equal(sent.sentByName, 'Test Kullanıcı')
    assertError(await actOrder(t.admin, sent, 'send'), 422, 'purchase_order_not_draft')
    assertError(await actOrder(t.admin, created, 'cancel', { reason: 'Eski sürüm' }), 409)
    assertError(await actOrder(t.admin, sent, 'cancel', { reason: 'x' }), 400)
    const cancelled = ok(
      await actOrder(t.admin, sent, 'cancel', { reason: 'Tedarikçi stokta yok' }),
    )
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.cancelReason, 'Tedarikçi stokta yok')
    assert.deepEqual(cancelled.actions, { send: false, cancel: false })
    // Talep yeniden açılır: başka teklif gerekçeyle seçilir, yeni numara verilir.
    const board = ok(await get(quotesUrl(t), t.admin))
    assert.deepEqual(board.actions, { add: true, order: true })
    const alpha = quoteOf(board, t.alpha)
    const reselected = ok(
      await select(t.admin, t, alpha, { reason: 'Beta stokta yok, ikinci teklif' }),
    )
    const second = ok(await order(t.admin, quoteOf(reselected, t.alpha)), 201)
    assert.equal(second.number, 'SA-2026-0002')
    const list = (await get(ORDERS, t.admin)).json() as { data: Json[]; meta: { total: number } }
    assert.equal(list.meta.total, 2)
    assert.deepEqual(
      list.data.map((row) => [row.number, row.status]),
      [
        ['SA-2026-0002', 'draft'],
        ['SA-2026-0001', 'cancelled'],
      ],
    )
    const search = async (query: string) =>
      ((await get(`${ORDERS}?${query}`, t.admin)).json() as { data: Json[] }).data.map(
        (row) => row.number,
      )
    assert.deepEqual(await search('q=SA-2026-0001'), ['SA-2026-0001'])
    assert.deepEqual(await search('q=alfa'), ['SA-2026-0002'])
    assert.deepEqual(await search('status=cancelled'), ['SA-2026-0001'])
    assert.deepEqual(await search(`supplierId=${String(t.alpha.id)}`), ['SA-2026-0002'])
    assertError(await get(`${ORDERS}?unknown=1`, t.admin), 400)
    const rows = await orderRows(t.id)
    assert.deepEqual(rows.map((row) => [row.numberYear, row.numberSequence]).sort(), [
      [2026, 1],
      [2026, 2],
    ])
    const items = await db
      .select()
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.institutionId, t.id))
    assert.equal(items.length, 4)
  })

  test('DOM-FIN-073: şahıs tedarikçinin TCKN’si ön büroya maskeli, yöneticiye açık (K-141)', async () => {
    const t = await institution()
    const board = await addQuote(t.admin, t, quoteBody(t, t.person, [20_000, 10_000]))
    const chosen = ok(await select(t.admin, t, quoteOf(board, t.person)))
    const created = ok(await order(t.admin, quoteOf(chosen, t.person)), 201)
    assert.equal((created.supplier as Json).taxNumber, TCKN)
    const front = await member(t.id, 'onburo')
    const seen = ok(await get(`${ORDERS}/${String(created.id)}`, front))
    assert.equal((seen.supplier as Json).taxNumber, '*******0146')
    assert.deepEqual(seen.actions, { send: true, cancel: false })
  })

  test('DOM-FIN-072, DOM-FIN-073: başka kurumun teklifi ve siparişi 404 ve B değişmez; listede yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await selectedTenant()
    const bOrder = ok(await order(b.admin, b.quote), 201)
    const bQuotes = quotesUrl(b)
    const bQuote = `${bQuotes}/${String(b.quote.id)}`
    assertError(await get(bQuotes, a.admin), 404)
    assertError(await call('POST', bQuotes, a.admin, quoteBody(b, a.alpha, [1, 1])), 404)
    assertError(await call('PATCH', bQuote, a.admin, { deliveryDays: 1 }, ifMatch(1)), 404)
    assertError(await call('DELETE', bQuote, a.admin, undefined, ifMatch(1)), 404)
    assertError(await call('POST', `${bQuote}/select`, a.admin, {}, ifMatch(1)), 404)
    const bUrl = `${ORDERS}/${String(bOrder.id)}`
    assertError(await get(bUrl, a.admin), 404)
    assertError(await call('POST', `${bUrl}/send`, a.admin, undefined, ifMatch(1)), 404)
    assertError(await call('POST', `${bUrl}/cancel`, a.admin, { reason: 'Sızma' }, ifMatch(1)), 404)
    assertError(await order(a.admin, b.quote), 422, 'purchase_order_quote_not_found')
    assertError(
      await call('POST', quotesUrl(a), a.admin, quoteBody(a as Tenant, b.alpha, [1, 1])),
      422,
      'purchase_quote_supplier_not_found',
    )
    assertError(
      await call('POST', quotesUrl(a), a.admin, {
        ...quoteBody(a as Tenant, a.alpha, [1, 1]),
        institutionId: b.id,
      }),
      400,
    )
    assertError(
      await call('POST', ORDERS, a.admin, { quoteId: b.quote.id, institutionId: b.id }, key()),
      400,
    )
    const list = (await get(ORDERS, a.admin)).json() as { meta: { total: number } }
    assert.equal(list.meta.total, 0)
    const [bRow] = await orderRows(b.id)
    assert.deepEqual([bRow?.status, bRow?.version], ['draft', 1])
    assert.equal(
      (await quoteRows(b.id)).every((row) => row.archivedAt === null),
      true,
    )
    assert.equal((await quoteRows(a.id)).length, 0)
    assert.equal((await orderRows(a.id)).length, 0)
  })
})
