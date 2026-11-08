import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import type { App } from '../../src/app.ts'
import type { Database } from '../../src/db/client.ts'
import { purchaseOrders } from '../../src/db/schema/finance-purchase-orders.ts'
import {
  buildTestApp,
  createInstitution,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from '../support/app.ts'
import { createPgDatabase, PG_SKIP } from '../support/pg.ts'

/**
 * Satın alma siparişi numarasının eşzamanlı tekilliği (DOM-FIN-073, K-139; ON-225). PGlite tek
 * bağlantılıdır; kurum kilidi ve tekil indeks yalnız gerçek PostgreSQL 16'da yarışır.
 */

const FINANCE = '/api/v1/finance'
type Json = Record<string, unknown>

describe('PostgreSQL 16: satın alma siparişi eşzamanlılığı', { skip: PG_SKIP }, () => {
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
      remoteAddress: '10.73.0.1',
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

  /** Kurum, tedarikçi ve `count` onaylı talebin her birinde seçili bir teklif. */
  async function tenant(count: number) {
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
    // Talepler bütçe satırının içinde kalır; gönderim bütçe uyarısı vermez (ON-245).
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
    const quotes: Json[] = []
    for (let index = 0; index < count; index += 1) {
      const request = await ok(
        await post('/purchase-requests', {
          costCenterId: center.id,
          periodId: period.id,
          budgetItemId: item.id,
          justification: 'Eşzamanlılık deneme talebi',
          items: [{ name: 'Klavye', quantity: 1, unit: 'piece', estimatedUnitPriceCents: 1_000 }],
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
      const selected = await ok(
        await call(
          admin,
          'POST',
          `${url}/quotes/${String(quote.id)}/select`,
          {},
          ifMatch(quote.version),
        ),
      )
      quotes.push((selected.quotes as Json[])[0] as Json)
    }
    return { id: created.id, admin, quotes }
  }

  const order = (cookie: string, quote: Json) =>
    call(
      cookie,
      'POST',
      `${FINANCE}/purchase-orders`,
      { quoteId: quote.id },
      {
        'idempotency-key': randomUUID(),
      },
    )

  test('DOM-FIN-073: farklı taleplerden eşzamanlı siparişler ardışık ve tekil numara alır (K-139)', async () => {
    const t = await tenant(5)
    const responses = await Promise.all(t.quotes.map((quote) => order(t.admin, quote)))
    assert.deepEqual(
      responses.map((response) => response.statusCode),
      [201, 201, 201, 201, 201],
    )
    const numbers = responses.map((response) => (response.json().data as Json).number).sort()
    assert.deepEqual(numbers, [
      'SA-2026-0001',
      'SA-2026-0002',
      'SA-2026-0003',
      'SA-2026-0004',
      'SA-2026-0005',
    ])
    const rows = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.institutionId, t.id))
    assert.equal(new Set(rows.map((row) => row.numberSequence)).size, 5)
  })

  test('DOM-FIN-073: aynı teklif için eşzamanlı iki sipariş: biri yazılır, öteki 409 (K-140)', async () => {
    const t = await tenant(1)
    const quote = t.quotes[0] as Json
    const responses = await Promise.all([order(t.admin, quote), order(t.admin, quote)])
    assert.deepEqual(responses.map((response) => response.statusCode).sort(), [201, 409])
    const rejected = responses.find((response) => response.statusCode === 409)
    assert.equal(rejected?.json().code, 'purchase_order_exists')
    const rows = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.institutionId, t.id))
    assert.equal(rows.length, 1)
  })
})
