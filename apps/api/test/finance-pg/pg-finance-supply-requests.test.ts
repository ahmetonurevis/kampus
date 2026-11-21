import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../../src/app.ts'
import type { Database } from '../../src/db/client.ts'
import { insertMissingRecords } from '../../src/db/records.ts'
import { stockMovements } from '../../src/db/schema/finance-inventory.ts'
import { purchaseRequests } from '../../src/db/schema/finance-purchase-requests.ts'
import {
  buildTestApp,
  createInstitution,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from '../support/app.ts'
import { createPgDatabase, PG_SKIP } from '../support/pg.ts'

/**
 * Sarf talebi karşılamasının ve dönüştürmenin eşzamanlılığı (DOM-FIN-091, K-181, K-245, K-246;
 * ON-233). Karşılama stok miktarını kurum kilidi altında denetler; aynı talebin iki dönüştürmesi
 * tek satın alma talebi açar. PGlite tek bağlantılı olduğundan yarış yalnız PostgreSQL 16'da sınanır.
 */

const FINANCE = '/api/v1/finance'
type Json = Record<string, unknown>

describe('PostgreSQL 16: sarf talebi eşzamanlılığı', { skip: PG_SKIP }, () => {
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

  function call(
    cookie: string,
    url: string,
    payload: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method: 'POST',
      url: `${FINANCE}${url}`,
      remoteAddress: '10.91.0.1',
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': 'application/json',
        ...headers,
      },
      payload: JSON.stringify(payload),
    })
  }
  const key = () => ({ 'idempotency-key': randomUUID() })
  function ok(response: Awaited<ReturnType<typeof call>>, status = 201): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }

  /** Kurum, ana depoda 3 paket kâğıt, açık bütçe dönemi ve 3'er paketlik iki onaylı talep. */
  async function tenant() {
    const created = await createInstitution(app)
    await insertMissingRecords(
      db,
      created.id,
      createSeed(FIXED_NOW)
        .branches.filter((row) => row.id === 'b1')
        .map((data) => ({ collection: 'branches' as const, id: data.id, data })),
      FIXED_NOW,
    )
    const admin = await signInAs(app, created.admin)
    const warehouse = ok(
      await call(admin, '/stock-warehouses', { name: 'Ana depo', campusId: 'b1' }),
    )
    const paper = ok(
      await call(admin, '/stock-items', {
        code: 'KAG-A4',
        name: 'A4 kâğıt',
        category: 'stationery',
        unit: 'pack',
      }),
    )
    ok(
      await call(
        admin,
        '/stock-entries',
        {
          itemId: paper.id,
          warehouseId: warehouse.id,
          quantity: 3,
          movementDate: '2026-10-01',
          reason: 'opening',
        },
        key(),
      ),
    )
    const center = ok(
      await call(admin, '/cost-centers', { code: 'FEN', name: 'Fen', type: 'unit' }),
    )
    const expense = ok(
      await call(admin, '/budget-items', { code: 'G-1', name: 'Malzeme', kind: 'expense' }),
    )
    const period = ok(
      await call(admin, '/budget-periods', { name: '2026–2027', academicYear: 2026 }),
    )
    ok(
      await call(
        admin,
        `/budget-periods/${String(period.id)}/open`,
        {},
        {
          'if-match': `"${String(period.version)}"`,
        },
      ),
      200,
    )
    const approved = async () => {
      const request = ok(
        await call(
          admin,
          '/supply-requests',
          {
            neededDate: '2026-10-07',
            justification: 'Sınav kâğıdı',
            items: [{ stockItemId: paper.id, quantity: 3 }],
          },
          key(),
        ),
      )
      return ok(
        await call(
          admin,
          `/supply-requests/${String(request.id)}/approve`,
          {},
          {
            'if-match': `"${String(request.version)}"`,
          },
        ),
        200,
      )
    }
    const act = (request: Json, verb: string, body: Json) =>
      call(admin, `/supply-requests/${String(request.id)}/${verb}`, body, {
        ...key(),
        'if-match': `"${String(request.version)}"`,
      })
    const fulfill = (request: Json) =>
      act(request, 'fulfill', {
        warehouseId: warehouse.id,
        movementDate: '2026-10-06',
        lines: [{ itemId: (request.items as Json[])[0]?.id, quantity: 3 }],
      })
    const convert = (request: Json) =>
      act(request, 'convert', {
        costCenterId: center.id,
        periodId: period.id,
        budgetItemId: expense.id,
        prices: [{ itemId: (request.items as Json[])[0]?.id, estimatedUnitPriceCents: 10_000 }],
      })
    return { id: created.id, approved, fulfill, convert }
  }

  test('DOM-FIN-091, K-181: iki talebin eşzamanlı karşılaması aynı stoku birlikte tüketemez', async () => {
    const t = await tenant()
    const [first, second] = [await t.approved(), await t.approved()]
    const responses = await Promise.all([t.fulfill(first), t.fulfill(second)])
    assert.deepEqual(responses.map((response) => response.statusCode).sort(), [200, 422])
    assert.equal(
      responses.find((response) => response.statusCode === 422)?.json().code,
      'stock_insufficient',
    )
    const supply = await db
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(and(eq(stockMovements.institutionId, t.id), eq(stockMovements.type, 'supply')))
    assert.equal(supply.length, 1)
  })

  test('DOM-FIN-091, K-246: aynı talebin eşzamanlı iki dönüştürmesi tek satın alma talebi açar', async () => {
    const t = await tenant()
    const request = await t.approved()
    const responses = await Promise.all([t.convert(request), t.convert(request)])
    assert.deepEqual(responses.map((response) => response.statusCode).sort(), [200, 409])
    const purchases = await db
      .select({ id: purchaseRequests.id })
      .from(purchaseRequests)
      .where(eq(purchaseRequests.institutionId, t.id))
    assert.equal(purchases.length, 1)
  })
})
