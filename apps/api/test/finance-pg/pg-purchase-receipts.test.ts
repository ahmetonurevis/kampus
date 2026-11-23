import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import type { App } from '../../src/app.ts'
import type { Database } from '../../src/db/client.ts'
import { purchaseOrders } from '../../src/db/schema/finance-purchase-orders.ts'
import {
  purchaseReceiptItems,
  purchaseReceipts,
} from '../../src/db/schema/finance-purchase-receipts.ts'
import {
  buildTestApp,
  createInstitution,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from '../support/app.ts'
import { createPgDatabase, PG_SKIP } from '../support/pg.ts'

/**
 * Mal kabulün eşzamanlı miktar denetimi (DOM-FIN-074, K-150; ON-226). Kalan miktar kurum kilidi
 * altında hesaplanır; PGlite tek bağlantılı olduğundan yarış yalnız gerçek PostgreSQL 16'da sınanır.
 */

const FINANCE = '/api/v1/finance'
type Json = Record<string, unknown>

describe('PostgreSQL 16: mal kabul eşzamanlılığı', { skip: PG_SKIP }, () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createPgDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function call(
    cookie: string,
    method: 'POST' | 'GET',
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url,
      remoteAddress: '10.75.0.1',
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  async function ok(response: Awaited<ReturnType<typeof call>>, status = 200): Promise<Json> {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })

  /** Kurum ve 10 adetlik tek kalemli, gönderilmiş sipariş. */
  async function tenant() {
    const created = await createInstitution(app)
    const admin = await signInAs(app, created.admin)
    const post = (url: string, body: Json) => call(admin, 'POST', `${FINANCE}${url}`, body)
    const center = await ok(
      await post('/cost-centers', { code: 'BT', name: 'Bilgi İşlem', type: 'unit' }),
      201,
    )
    const item = await ok(
      await post('/budget-items', { code: 'G-1', name: 'Malzeme', kind: 'expense' }),
      201,
    )
    const period = await ok(
      await post('/budget-periods', { name: '2026', academicYear: 2026 }),
      201,
    )
    await ok(
      await call(
        admin,
        'POST',
        `${FINANCE}/budget-periods/${String(period.id)}/open`,
        undefined,
        ifMatch(period.version),
      ),
    )
    await ok(
      await post(`/budget-periods/${String(period.id)}/lines`, {
        costCenterId: center.id,
        itemId: item.id,
        amountCents: 1_000_000,
      }),
      201,
    )
    const supplier = await ok(
      await post('/suppliers', {
        name: 'Alfa Bilişim A.Ş.',
        type: 'company',
        taxNumber: '1234567890',
        taxOffice: 'Kadıköy',
        categories: ['it'],
      }),
      201,
    )
    const request = await ok(
      await post('/purchase-requests', {
        costCenterId: center.id,
        periodId: period.id,
        budgetItemId: item.id,
        justification: 'Eşzamanlılık deneme talebi',
        items: [{ name: 'Klavye', quantity: 10, unit: 'piece', estimatedUnitPriceCents: 1_000 }],
      }),
      201,
    )
    const url = `${FINANCE}/purchase-requests/${String(request.id)}`
    const submitted = await ok(
      await call(admin, 'POST', `${url}/submit`, undefined, ifMatch(request.version)),
    )
    await ok(await call(admin, 'POST', `${url}/approve`, {}, ifMatch(submitted.version)))
    const lines = request.items as Json[]
    const board = await ok(
      await call(admin, 'POST', `${url}/quotes`, {
        supplierId: supplier.id,
        deliveryDays: 3,
        validUntil: '2026-10-31',
        items: [{ requestItemId: lines[0]?.id, unitPriceCents: 900, vatRate: 20 }],
      }),
      201,
    )
    const quote = (board.quotes as Json[])[0] as Json
    await ok(
      await call(
        admin,
        'POST',
        `${url}/quotes/${String(quote.id)}/select`,
        {},
        ifMatch(quote.version),
      ),
    )
    const order = await ok(
      await call(
        admin,
        'POST',
        `${FINANCE}/purchase-orders`,
        { quoteId: quote.id },
        { 'idempotency-key': randomUUID() },
      ),
      201,
    )
    const sent = await ok(
      await call(
        admin,
        'POST',
        `${FINANCE}/purchase-orders/${String(order.id)}/send`,
        undefined,
        ifMatch(order.version),
      ),
    )
    return {
      id: created.id,
      admin,
      orderId: String(sent.id),
      itemId: String((sent.items as Json[])[0]?.id),
    }
  }

  const receive = (t: Awaited<ReturnType<typeof tenant>>, acceptedQuantity: number) =>
    call(
      t.admin,
      'POST',
      `${FINANCE}/purchase-orders/${t.orderId}/receipts`,
      {
        receiptDate: '2026-10-06',
        receivedBy: 'Depo Sorumlusu',
        lines: [{ orderItemId: t.itemId, acceptedQuantity }],
      },
      { 'idempotency-key': randomUUID() },
    )

  async function accepted(institutionId: string): Promise<number> {
    const rows = await db
      .select({ quantity: purchaseReceiptItems.acceptedQuantity })
      .from(purchaseReceiptItems)
      .where(eq(purchaseReceiptItems.institutionId, institutionId))
    return rows.reduce((total, row) => total + row.quantity, 0)
  }

  test('DOM-FIN-074: eşzamanlı iki kabul kalanı birlikte aşamaz; ikincisi 422 alır ve yazılmaz (K-150)', async () => {
    const t = await tenant()
    const responses = await Promise.all([receive(t, 6), receive(t, 6)])
    assert.deepEqual(responses.map((response) => response.statusCode).sort(), [201, 422])
    const rejected = responses.find((response) => response.statusCode === 422)
    assert.equal(rejected?.json().code, 'purchase_receipt_quantity_exceeded')
    assert.equal(await accepted(t.id), 6)
    const receipts = await db
      .select()
      .from(purchaseReceipts)
      .where(eq(purchaseReceipts.institutionId, t.id))
    assert.equal(receipts.length, 1)
  })

  test('DOM-FIN-074: beş eşzamanlı kabulden yalnız kalana sığanlar yazılır; durum tutarlı (K-150)', async () => {
    const t = await tenant()
    const responses = await Promise.all([3, 3, 3, 3, 3].map((quantity) => receive(t, quantity)))
    const codes = responses.map((response) => response.statusCode).sort()
    assert.deepEqual(codes, [201, 201, 201, 422, 422])
    assert.equal(await accepted(t.id), 9)
    const [order] = await db
      .select({ status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.institutionId, t.id))
    assert.equal(order?.status, 'partially_received')
  })
})
