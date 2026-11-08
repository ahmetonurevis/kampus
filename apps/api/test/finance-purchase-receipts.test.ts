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
import { stockMovements } from '../src/db/schema/finance-inventory.ts'
import { purchaseOrders } from '../src/db/schema/finance-purchase-orders.ts'
import {
  purchaseReceiptItems,
  purchaseReceipts,
} from '../src/db/schema/finance-purchase-receipts.ts'
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
 * Mal kabul uçları (DOM-FIN-074; ON-226). Her test kendi kurumunu kurar: birim, gider kalemi, açık
 * dönem ve 10.000 TL'lik bütçe satırı, tedarikçi, onaylanmış talep (10 klavye × 250 TL, 3 fare ×
 * 150 TL tahmini; toplam 2.950 TL), seçili teklif (klavye 190 TL, fare 120 TL, KDV hariç; sipariş
 * neti 2.260 TL) ve siparişi. FIXED_NOW 2026-10-06.
 */

const FINANCE = '/api/v1/finance'
const REQUESTS = `${FINANCE}/purchase-requests`
const ORDERS = `${FINANCE}/purchase-orders`
const ORDER_NET = 10 * 19_000 + 3 * 12_000

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-074: mal kabul uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.74.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
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

  /** Kurum, onaylı talep, seçili teklif ve taslak sipariş; `sent` ise gönderildi işaretli. */
  async function institution(overrides: Partial<InstitutionOverrides> & { sent?: boolean } = {}) {
    const { sent = true, ...institutionOverrides } = overrides
    clientIp = `10.74.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, institutionOverrides)
    const admin = await signInAs(app, created.admin)
    if (institutionOverrides.enabledModules?.finance === false)
      return { id: created.id, admin } as Tenant
    const post = async (url: string, body: Json) =>
      ok(await call('POST', `${FINANCE}${url}`, admin, body), 201)
    const center = await post('/cost-centers', { code: 'BT', name: 'Bilgi İşlem', type: 'unit' })
    const expense = await post('/budget-items', { code: 'G-200', name: 'Malzeme', kind: 'expense' })
    const period = await post('/budget-periods', { name: '2026–2027', academicYear: 2026 })
    const opened = ok(
      await call(
        'POST',
        `${FINANCE}/budget-periods/${String(period.id)}/open`,
        admin,
        undefined,
        ifMatch(period.version),
      ),
    )
    await post(`/budget-periods/${String(period.id)}/lines`, {
      costCenterId: center.id,
      itemId: expense.id,
      amountCents: 1_000_000,
    })
    const supplier = await post('/suppliers', {
      name: 'Beta Teknoloji Ltd.',
      type: 'company',
      taxNumber: '1111111114',
      taxOffice: 'Kadıköy',
      categories: ['it'],
    })
    const request = await approvedRequest(admin, { center, period, expense })
    const [keyboard, mouse] = (request.items as Json[]).map((item) => item.id)
    const board = ok(
      await call('POST', `${REQUESTS}/${String(request.id)}/quotes`, admin, {
        supplierId: supplier.id,
        deliveryDays: 7,
        validUntil: '2026-10-20',
        items: [
          { requestItemId: keyboard, unitPriceCents: 19_000, vatRate: 20 },
          { requestItemId: mouse, unitPriceCents: 12_000, vatRate: 20 },
        ],
      }),
      201,
    )
    const quote = (board.quotes as Json[])[0] as Json
    ok(
      await call(
        'POST',
        `${REQUESTS}/${String(request.id)}/quotes/${String(quote.id)}/select`,
        admin,
        {},
        ifMatch(quote.version),
      ),
    )
    let order = ok(await call('POST', ORDERS, admin, { quoteId: quote.id }, key()), 201)
    if (sent)
      order = ok(
        await call(
          'POST',
          `${ORDERS}/${String(order.id)}/send`,
          admin,
          undefined,
          ifMatch(order.version),
        ),
      )
    const items = order.items as Json[]
    return {
      id: created.id,
      admin,
      center,
      expense,
      period: opened,
      request,
      order,
      keyboard: String(items[0]?.id),
      mouse: String(items[1]?.id),
    }
  }
  type Tenant = {
    id: string
    admin: string
    center: Json
    expense: Json
    period: Json
    request: Json
    order: Json
    keyboard: string
    mouse: string
  }

  async function approvedRequest(
    admin: string,
    refs: { center: Json; period: Json; expense: Json },
  ) {
    const created = ok(
      await call('POST', REQUESTS, admin, {
        costCenterId: refs.center.id,
        periodId: refs.period.id,
        budgetItemId: refs.expense.id,
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
  const receiptsUrl = (t: Pick<Tenant, 'order'>) => `${ORDERS}/${String(t.order.id)}/receipts`
  const receiptBody = (lines: Json[], extra: Json = {}) => ({
    receiptDate: '2026-10-06',
    receivedBy: 'Hasan Usta',
    lines,
    ...extra,
  })
  const receive = (
    cookie: string,
    t: Pick<Tenant, 'order'>,
    body: unknown,
    headers: Record<string, string> = key(),
  ) => call('POST', receiptsUrl(t), cookie, body, headers)
  const cancel = (
    cookie: string,
    t: Pick<Tenant, 'order'>,
    receipt: Json,
    reason = 'Hatalı kayıt',
  ) =>
    call(
      'POST',
      `${receiptsUrl(t)}/${String(receipt.id)}/cancel`,
      cookie,
      { reason },
      ifMatch(receipt.version),
    )
  const rows = (institutionId: string) =>
    Promise.all([
      db.select().from(purchaseReceipts).where(eq(purchaseReceipts.institutionId, institutionId)),
      db
        .select()
        .from(purchaseReceiptItems)
        .where(eq(purchaseReceiptItems.institutionId, institutionId)),
      db.select().from(purchaseOrders).where(eq(purchaseOrders.institutionId, institutionId)),
    ])
  const budgetStatus = (t: Tenant) =>
    get(
      `${REQUESTS}/budget-status?periodId=${String(t.period.id)}&costCenterId=${String(t.center.id)}&budgetItemId=${String(t.expense.id)}`,
      t.admin,
    )
  const actuals = async (t: Tenant, basis = 'accrual') => {
    const report = ok(
      await get(`${FINANCE}/budget-periods/${String(t.period.id)}/actuals?basis=${basis}`, t.admin),
    )
    const row = (report.rows as Json[]).find((item) => item.itemCode === 'G-200') as Json
    return { report, row }
  }

  test('kimliksiz istek 401', async () => {
    const t = { order: { id: randomUUID() } }
    assertError(await get(receiptsUrl(t), null), 401)
    assertError(await receive(null as unknown as string, t, {}), 401)
    assertError(
      await call('POST', `${receiptsUrl(t)}/${randomUUID()}/cancel`, null, { reason: 'Hatalı' }),
      401,
    )
  })

  test('DOM-FIN-074: öğretmen, veli, öğrenci 403; ön büro kabul kaydeder ama iptal edemez (K-153)', async () => {
    const t = await institution()
    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(receiptsUrl(t), cookie), 403)
      assertError(
        await receive(cookie, t, receiptBody([{ orderItemId: t.keyboard, acceptedQuantity: 1 }])),
        403,
      )
    }
    const front = await member(t.id, 'onburo')
    const board = ok(
      await receive(front, t, receiptBody([{ orderItemId: t.keyboard, acceptedQuantity: 2 }])),
      201,
    )
    assert.deepEqual(board.actions, { receive: true })
    const receipt = (board.receipts as Json[])[0] as Json
    assert.deepEqual(receipt.actions, { cancel: false })
    assert.equal(receipt.createdByName !== null, true)
    assertError(await cancel(front, t, receipt), 403)
    const adminBoard = ok(await get(receiptsUrl(t), t.admin))
    assert.deepEqual(((adminBoard.receipts as Json[])[0] as Json).actions, { cancel: true })
  })

  test('DOM-FIN-074: finance modülü kapalıyken mal kabul uçları 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    const t = { order: { id: randomUUID() } }
    assertError(await get(receiptsUrl(t), closed.admin), 403, 'module_disabled')
    assertError(await receive(closed.admin, t, {}), 403, 'module_disabled')
  })

  test('DOM-FIN-074: kısmi kabuller siparişi kısmen teslim, sonra tamamlandı yapar; reddedilen karşılanmaz (K-150)', async () => {
    const t = await institution()
    const first = ok(
      await receive(
        t.admin,
        t,
        receiptBody(
          [
            {
              orderItemId: t.keyboard,
              acceptedQuantity: 6,
              rejectedQuantity: 2,
              rejectReason: 'Tuşları kırık',
            },
          ],
          { inspectionNote: 'Kutular hasarlı geldi' },
        ),
      ),
      201,
    )
    const order = first.order as Json
    assert.equal(order.status, 'partially_received')
    assert.equal(order.version, Number(t.order.version) + 1)
    assert.deepEqual(
      (first.items as Json[]).map((item) => [
        item.name,
        item.quantity,
        item.acceptedQuantity,
        item.rejectedQuantity,
        item.remainingQuantity,
      ]),
      [
        ['Klavye', 10, 6, 2, 4],
        ['Fare', 3, 0, 0, 3],
      ],
    )
    assert.equal(first.receivedNetCents, 6 * 19_000)
    const receipt = (first.receipts as Json[])[0] as Json
    assert.equal(receipt.receivedBy, 'Hasan Usta')
    assert.equal(receipt.inspectionNote, 'Kutular hasarlı geldi')
    assert.equal(receipt.netCents, 114_000)
    assert.equal(receipt.warehouseId, null)
    assert.deepEqual(receipt.lines, [
      {
        orderItemId: t.keyboard,
        name: 'Klavye',
        unit: 'piece',
        acceptedQuantity: 6,
        rejectedQuantity: 2,
        rejectReason: 'Tuşları kırık',
        stockItemId: null,
        stockItemName: null,
      },
    ])
    assert.deepEqual(ok(await get(receiptsUrl(t), t.admin)), first)
    const detail = ok(await get(`${ORDERS}/${String(t.order.id)}`, t.admin))
    assert.equal(detail.status, 'partially_received')
    // Kısmen teslim alınan sipariş iptal edilmez (DOM-FIN-073).
    assertError(
      await call(
        'POST',
        `${ORDERS}/${String(t.order.id)}/cancel`,
        t.admin,
        { reason: 'Vazgeçildi' },
        ifMatch(detail.version),
      ),
      422,
      'purchase_order_not_cancellable',
    )

    const second = ok(
      await receive(
        t.admin,
        t,
        receiptBody([
          { orderItemId: t.keyboard, acceptedQuantity: 4 },
          { orderItemId: t.mouse, acceptedQuantity: 3 },
        ]),
      ),
      201,
    )
    assert.equal((second.order as Json).status, 'completed')
    assert.equal(second.receivedNetCents, ORDER_NET)
    assert.deepEqual(second.actions, { receive: false })
    assertError(
      await receive(t.admin, t, receiptBody([{ orderItemId: t.mouse, acceptedQuantity: 1 }])),
      422,
      'purchase_receipt_order_completed',
    )
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'purchase_receipt.create')))
    assert.equal(audit.length, 2)
    const statusAudit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'purchase_order.receive')))
    assert.equal(statusAudit.length, 2, 'durum iki kez değişti')
  })

  test('DOM-FIN-074: kalanı aşan, geçersiz ya da kurala aykırı kabul 400/422 ve hiçbir kayıt değişmez', async () => {
    const t = await institution()
    ok(
      await receive(t.admin, t, receiptBody([{ orderItemId: t.keyboard, acceptedQuantity: 8 }])),
      201,
    )
    const before = await rows(t.id)
    const exceeded = await receive(
      t.admin,
      t,
      receiptBody([
        { orderItemId: t.mouse, acceptedQuantity: 1 },
        { orderItemId: t.keyboard, acceptedQuantity: 3 },
      ]),
    )
    assertError(exceeded, 422, 'purchase_receipt_quantity_exceeded')
    assert.match(exceeded.json().message, /kalan 2/)
    assertError(await receive(t.admin, t, receiptBody([])), 400)
    assertError(
      await receive(
        t.admin,
        t,
        receiptBody([{ orderItemId: t.keyboard, acceptedQuantity: 1, rejectedQuantity: 1 }]),
      ),
      400,
    )
    assertError(
      await receive(
        t.admin,
        t,
        receiptBody([{ orderItemId: t.keyboard, acceptedQuantity: 1 }], { receivedBy: '' }),
      ),
      400,
    )
    assertError(
      await receive(
        t.admin,
        t,
        receiptBody([{ orderItemId: t.keyboard, acceptedQuantity: 1 }], {
          receiptDate: '2026-10-07',
        }),
      ),
      422,
      'purchase_receipt_date_future',
    )
    assertError(
      await receive(
        t.admin,
        t,
        receiptBody([{ orderItemId: t.keyboard, acceptedQuantity: 1 }], {
          receiptDate: '2026-10-05',
        }),
      ),
      422,
      'purchase_receipt_date_before_order',
    )
    assertError(
      await receive(t.admin, t, receiptBody([{ orderItemId: randomUUID(), acceptedQuantity: 1 }])),
      422,
      'purchase_receipt_item_not_found',
    )
    assertError(
      await receive(t.admin, t, receiptBody([{ orderItemId: t.keyboard, acceptedQuantity: 1 }]), {
        ...key(),
        'if-match': '"1"',
      }),
      400,
    )
    assertError(
      await receive(
        t.admin,
        t,
        receiptBody([{ orderItemId: t.keyboard, acceptedQuantity: 1 }]),
        {},
      ),
      400,
    )
    assert.deepEqual(await rows(t.id), before)
  })

  test('DOM-FIN-074: taslak ve iptal edilmiş siparişe kabul yok', async () => {
    const t = await institution({ sent: false })
    const before = await rows(t.id)
    const body = receiptBody([{ orderItemId: t.keyboard, acceptedQuantity: 1 }])
    assertError(await receive(t.admin, t, body), 422, 'purchase_receipt_order_not_sent')
    ok(
      await call(
        'POST',
        `${ORDERS}/${String(t.order.id)}/cancel`,
        t.admin,
        { reason: 'Tedarikçi stokta yok' },
        ifMatch(t.order.version),
      ),
    )
    assertError(await receive(t.admin, t, body), 422, 'purchase_receipt_order_cancelled')
    assert.deepEqual((await rows(t.id)).slice(0, 2), before.slice(0, 2))
  })

  test('DOM-FIN-074: aynı Idempotency-Key ikinci kabul açmaz', async () => {
    const t = await institution()
    const headers = key()
    const body = receiptBody([{ orderItemId: t.keyboard, acceptedQuantity: 5 }])
    const first = ok(await receive(t.admin, t, body, headers), 201)
    const replay = await receive(t.admin, t, body, headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json().data, first)
    const [receipts] = await rows(t.id)
    assert.equal(receipts.length, 1)
  })

  test('DOM-FIN-074: kabul iptali gerekçeyle durumu geri alır, kayıt silinmez; tekrar iptal 409/422 (K-153)', async () => {
    const t = await institution()
    ok(
      await receive(t.admin, t, receiptBody([{ orderItemId: t.keyboard, acceptedQuantity: 10 }])),
      201,
    )
    const second = ok(
      await receive(t.admin, t, receiptBody([{ orderItemId: t.mouse, acceptedQuantity: 3 }])),
      201,
    )
    assert.equal((second.order as Json).status, 'completed')
    const withItem = (board: Json, itemId: string) =>
      (board.receipts as Json[]).find((receipt) =>
        (receipt.lines as Json[]).some((line) => line.orderItemId === itemId),
      ) as Json
    const mouseReceipt = withItem(second, t.mouse)
    assertError(await cancel(t.admin, t, mouseReceipt, 'kısa'), 400)
    const afterCancel = ok(await cancel(t.admin, t, mouseReceipt, 'Yanlış siparişe girildi'))
    assert.equal((afterCancel.order as Json).status, 'partially_received')
    const cancelled = withItem(afterCancel, t.mouse)
    assert.equal(cancelled.cancelReason, 'Yanlış siparişe girildi')
    assert.equal(cancelled.cancelledByName !== null, true)
    assert.deepEqual(cancelled.actions, { cancel: false })
    assert.equal(afterCancel.receivedNetCents, 10 * 19_000)
    assertError(await cancel(t.admin, t, mouseReceipt), 409, 'version_conflict')
    assertError(await cancel(t.admin, t, cancelled), 422, 'purchase_receipt_already_cancelled')
    const keyboardReceipt = withItem(afterCancel, t.keyboard)
    const reverted = ok(await cancel(t.admin, t, keyboardReceipt))
    assert.equal((reverted.order as Json).status, 'sent')
    assertError(
      await call(
        'POST',
        `${receiptsUrl(t)}/${randomUUID()}/cancel`,
        t.admin,
        { reason: 'Hatalı kayıt' },
        ifMatch(1),
      ),
      404,
    )
    const [receipts, lines] = await rows(t.id)
    assert.equal(receipts.length, 2, 'iptal silmez')
    assert.equal(lines.length, 2)
  })

  test('DOM-FIN-074: kapalı bütçe dönemine düşen kabul kaydedilmez ve iptal edilmez (K-153)', async () => {
    const t = await institution()
    const board = ok(
      await receive(t.admin, t, receiptBody([{ orderItemId: t.keyboard, acceptedQuantity: 1 }])),
      201,
    )
    const period = ok(await get(`${FINANCE}/budget-periods/${String(t.period.id)}`, t.admin))
    ok(
      await call(
        'POST',
        `${FINANCE}/budget-periods/${String(t.period.id)}/close`,
        t.admin,
        undefined,
        ifMatch(period.version),
      ),
    )
    assertError(
      await receive(t.admin, t, receiptBody([{ orderItemId: t.keyboard, acceptedQuantity: 1 }])),
      422,
      'purchase_receipt_period_closed',
    )
    assertError(
      await cancel(t.admin, t, (board.receipts as Json[])[0] as Json),
      422,
      'purchase_receipt_period_closed',
    )
  })

  test('DOM-FIN-071, DOM-FIN-074: siparişli talep bütçe kalanında sipariş tutarıyla, kabul edilen kısmı gerçekleşen olarak sayılır; çift sayım yok (K-145, K-154)', async () => {
    const t = await institution()
    assert.deepEqual(ok(await budgetStatus(t)), {
      plannedCents: 1_000_000,
      approvedCents: 0,
      pendingCents: 0,
      orderedCents: ORDER_NET,
      receivedCents: 0,
      committedCents: ORDER_NET,
      remainingCents: 1_000_000 - ORDER_NET,
    })
    const board = ok(
      await receive(t.admin, t, receiptBody([{ orderItemId: t.keyboard, acceptedQuantity: 6 }])),
      201,
    )
    assert.deepEqual(ok(await budgetStatus(t)), {
      plannedCents: 1_000_000,
      approvedCents: 0,
      pendingCents: 0,
      orderedCents: ORDER_NET - 114_000,
      receivedCents: 114_000,
      committedCents: ORDER_NET - 114_000,
      remainingCents: 1_000_000 - ORDER_NET,
    })
    const detail = ok(await get(`${REQUESTS}/${String(t.request.id)}`, t.admin))
    assert.equal((detail.budget as Json).receivedCents, 0, 'talep kendi tutarını hariç tutar')
    ok(await cancel(t.admin, t, (board.receipts as Json[])[0] as Json))
    assert.equal(ok(await budgetStatus(t)).receivedCents, 0)
    // Sipariş iptal edilince talep yeniden tahmini toplamıyla (KDV dahil, K-130) sayılır.
    const order = ok(await get(`${ORDERS}/${String(t.order.id)}`, t.admin))
    ok(
      await call(
        'POST',
        `${ORDERS}/${String(t.order.id)}/cancel`,
        t.admin,
        { reason: 'Tedarikçi teslim etmedi' },
        ifMatch(order.version),
      ),
    )
    const reopened = ok(await budgetStatus(t))
    assert.equal(reopened.approvedCents, 295_000)
    assert.equal(reopened.orderedCents, 0)
  })

  test('DOM-FIN-066, DOM-FIN-074: kabul edilen tutar kabul gününde gider gerçekleşeni olur; iptal düşer, nakit esasına girmez (K-151)', async () => {
    const t = await institution()
    const empty = await actuals(t)
    assert.equal(empty.report.expenseData, 'available')
    assert.equal(empty.row.actualCents, 0)
    assert.equal(empty.row.status, 'mapped')
    const board = ok(
      await receive(
        t.admin,
        t,
        receiptBody([
          {
            orderItemId: t.keyboard,
            acceptedQuantity: 6,
            rejectedQuantity: 1,
            rejectReason: 'Kırık',
          },
          { orderItemId: t.mouse, acceptedQuantity: 1 },
        ]),
      ),
      201,
    )
    const accrual = await actuals(t)
    assert.equal(accrual.row.actualCents, 6 * 19_000 + 12_000)
    const october = (accrual.row.months as Json[]).find((month) => month.month === '2026-10')
    assert.equal(october?.actualCents, 6 * 19_000 + 12_000)
    assert.equal(((accrual.report.totals as Json).expense as Json).actualCents, 126_000)
    assert.equal((await actuals(t, 'cash')).row.actualCents, 0, 'ödeme günü yok')
    ok(await cancel(t.admin, t, (board.receipts as Json[])[0] as Json))
    assert.equal((await actuals(t)).row.actualCents, 0)
  })

  test('DOM-FIN-074: başka kurumun siparişi ve kabulü 404 ve B değişmez', async () => {
    const a = await institution()
    const b = await institution()
    const bBoard = ok(
      await receive(b.admin, b, receiptBody([{ orderItemId: b.keyboard, acceptedQuantity: 1 }])),
      201,
    )
    const before = await rows(b.id)
    assertError(await get(receiptsUrl(b), a.admin), 404)
    assertError(
      await receive(a.admin, b, receiptBody([{ orderItemId: b.keyboard, acceptedQuantity: 1 }])),
      404,
    )
    const bReceipt = (bBoard.receipts as Json[])[0] as Json
    assertError(await cancel(a.admin, b, bReceipt), 404)
    // A'nın siparişi altında B'nin kabulü ve kalemi de bulunmaz.
    assertError(await cancel(a.admin, a, bReceipt), 404)
    assertError(
      await receive(
        a.admin,
        a,
        receiptBody([{ orderItemId: b.keyboard, acceptedQuantity: 1 }], { institutionId: b.id }),
      ),
      400,
    )
    assertError(
      await receive(a.admin, a, receiptBody([{ orderItemId: b.keyboard, acceptedQuantity: 1 }])),
      422,
      'purchase_receipt_item_not_found',
    )
    assert.deepEqual(await rows(b.id), before)
    assert.equal(((await actuals(a)).row as Json).actualCents, 0)
  })

  test('DOM-FIN-078, K-184: stok kartı seçilen kalem kabulde depoya girer; kabul iptali girişi geri alır, kullanılmış giriş iptali reddeder', async () => {
    const t = await institution()
    const branches = createSeed(FIXED_NOW).branches
    await insertMissingRecords(
      db,
      t.id,
      branches.map((data) => ({ collection: 'branches' as const, id: data.id, data })),
      FIXED_NOW,
    )
    const post = async (url: string, body: Json, headers: Record<string, string> = {}) =>
      ok(await call('POST', `${FINANCE}${url}`, t.admin, body, headers), 201)
    const warehouse = await post('/stock-warehouses', { name: 'BT deposu', campusId: 'b1' })
    const keyboardCard = await post('/stock-items', {
      code: 'KLV',
      name: 'Klavye',
      category: 'it',
      unit: 'piece',
    })
    const boxed = await post('/stock-items', {
      code: 'KLV-KOLI',
      name: 'Klavye kolisi',
      category: 'it',
      unit: 'box',
    })
    const stockRows = () =>
      db.select().from(stockMovements).where(eq(stockMovements.institutionId, t.id))
    const linked = (stockItemId: unknown, extra: Json = {}) =>
      receiptBody(
        [
          {
            orderItemId: t.keyboard,
            acceptedQuantity: 6,
            rejectedQuantity: 1,
            rejectReason: 'Kırık',
            stockItemId,
          },
          { orderItemId: t.mouse, acceptedQuantity: 3 },
        ],
        { warehouseId: warehouse.id, ...extra },
      )

    const before = await rows(t.id)
    assertError(await receive(t.admin, t, linked(boxed.id)), 422, 'stock_unit_mismatch')
    assertError(
      await receive(t.admin, t, linked(keyboardCard.id, { warehouseId: null })),
      400,
      'validation_failed',
    )
    assertError(await receive(t.admin, t, linked(randomUUID())), 422, 'stock_item_not_found')
    assert.deepEqual(await rows(t.id), before)
    assert.equal((await stockRows()).length, 0)

    const board = ok(await receive(t.admin, t, linked(keyboardCard.id)), 201)
    const receipt = (board.receipts as Json[])[0] as Json
    assert.equal(receipt.warehouseName, 'BT deposu')
    assert.deepEqual(
      (receipt.lines as Json[]).map((line) => [line.name, line.stockItemName]),
      [
        ['Klavye', 'Klavye'],
        ['Fare', null],
      ],
    )
    const movements = ok(await get(`${FINANCE}/stock-movements`, t.admin)) as unknown as Json[]
    assert.equal(movements.length, 1)
    const received = movements[0] as Json
    assert.deepEqual(
      [received.type, received.quantity, received.movementDate, received.orderNumber],
      ['receipt', 6, '2026-10-06', t.order.number],
    )
    assert.deepEqual(received.actions, { cancel: false })
    assertError(
      await call(
        'POST',
        `${FINANCE}/stock-movements/${String(received.id)}/cancel`,
        t.admin,
        { reason: 'Yanlış giriş' },
        ifMatch(received.version),
      ),
      422,
      'stock_movement_from_receipt',
    )

    const issued = await post(
      '/stock-issues',
      {
        itemId: keyboardCard.id,
        warehouseId: warehouse.id,
        quantity: 5,
        movementDate: '2026-10-06',
        reason: 'usage',
      },
      key(),
    )
    const blocked = await rows(t.id)
    assertError(await cancel(t.admin, t, receipt), 422, 'stock_cancel_negative')
    assert.deepEqual(await rows(t.id), blocked)

    ok(
      await call(
        'POST',
        `${FINANCE}/stock-movements/${String(issued.id)}/cancel`,
        t.admin,
        { reason: 'Yanlış çıkış' },
        ifMatch(issued.version),
      ),
    )
    ok(await cancel(t.admin, t, receipt))
    const card = ok(await get(`${FINANCE}/stock-items/${String(keyboardCard.id)}`, t.admin))
    assert.equal(card.quantity, 0)
    const [stored] = (await stockRows()).filter((row) => row.type === 'receipt')
    assert.equal(stored?.cancelReason, 'Hatalı kayıt')
  })
})
