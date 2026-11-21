import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, isNull } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../../src/app.ts'
import type { Database } from '../../src/db/client.ts'
import { insertMissingRecords } from '../../src/db/records.ts'
import { stockMovements } from '../../src/db/schema/finance-inventory.ts'
import {
  buildTestApp,
  createInstitution,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from '../support/app.ts'
import { createPgDatabase, PG_SKIP } from '../support/pg.ts'

/**
 * Stok çıkışının eşzamanlı miktar denetimi (DOM-FIN-078, K-181; ON-229). Depodaki miktar kurum
 * kilidi altında hesaplanır; PGlite tek bağlantılı olduğundan yarış yalnız gerçek PostgreSQL 16'da
 * sınanır.
 */

const FINANCE = '/api/v1/finance'
type Json = Record<string, unknown>

describe('PostgreSQL 16: stok hareketi eşzamanlılığı', { skip: PG_SKIP }, () => {
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

  function call(cookie: string, url: string, payload: unknown, idempotent = false) {
    return app.inject({
      method: 'POST',
      url: `${FINANCE}${url}`,
      remoteAddress: '10.78.0.1',
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': 'application/json',
        ...(idempotent ? { 'idempotency-key': randomUUID() } : {}),
      },
      payload: JSON.stringify(payload),
    })
  }
  function ok(response: Awaited<ReturnType<typeof call>>, status = 201): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }

  /** Kurum, Kadıköy ve Beşiktaş depoları, 10 paket A4 kâğıt (Kadıköy). */
  async function tenant() {
    const created = await createInstitution(app)
    await insertMissingRecords(
      db,
      created.id,
      createSeed(FIXED_NOW).branches.map((data) => ({
        collection: 'branches' as const,
        id: data.id,
        data,
      })),
      FIXED_NOW,
    )
    const admin = await signInAs(app, created.admin)
    const main = ok(await call(admin, '/stock-warehouses', { name: 'Ana depo', campusId: 'b1' }))
    const annex = ok(await call(admin, '/stock-warehouses', { name: 'Ek depo', campusId: 'b2' }))
    const item = ok(
      await call(admin, '/stock-items', {
        code: 'KAG',
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
          itemId: item.id,
          warehouseId: main.id,
          quantity: 10,
          movementDate: '2026-10-01',
          reason: 'opening',
        },
        true,
      ),
    )
    return { id: created.id, admin, main, annex, item }
  }

  async function quantityIn(institutionId: string, warehouseId: unknown): Promise<number> {
    const rows = await db
      .select({ type: stockMovements.type, quantity: stockMovements.quantity })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.institutionId, institutionId),
          eq(stockMovements.warehouseId, String(warehouseId)),
          isNull(stockMovements.cancelledAt),
        ),
      )
    return rows.reduce(
      (total, row) =>
        total + (row.type === 'out' || row.type === 'transfer_out' ? -row.quantity : row.quantity),
      0,
    )
  }

  test('DOM-FIN-078, K-181: eşzamanlı iki çıkış miktarı birlikte aşamaz; ikincisi 422 alır ve yazılmaz', async () => {
    const t = await tenant()
    const issue = () =>
      call(
        t.admin,
        '/stock-issues',
        {
          itemId: t.item.id,
          warehouseId: t.main.id,
          quantity: 6,
          movementDate: '2026-10-06',
          reason: 'usage',
        },
        true,
      )
    const responses = await Promise.all([issue(), issue()])
    assert.deepEqual(responses.map((response) => response.statusCode).sort(), [201, 422])
    assert.equal(
      responses.find((response) => response.statusCode === 422)?.json().code,
      'stock_insufficient',
    )
    assert.equal(await quantityIn(t.id, t.main.id), 4)
  })

  test('DOM-FIN-078, K-181: eşzamanlı çıkış ve transfer aynı miktarı tüketemez; stok eksiye düşmez', async () => {
    const t = await tenant()
    const responses = await Promise.all([
      call(
        t.admin,
        '/stock-issues',
        {
          itemId: t.item.id,
          warehouseId: t.main.id,
          quantity: 7,
          movementDate: '2026-10-06',
          reason: 'usage',
        },
        true,
      ),
      call(
        t.admin,
        '/stock-transfers',
        {
          itemId: t.item.id,
          fromWarehouseId: t.main.id,
          toWarehouseId: t.annex.id,
          quantity: 7,
          movementDate: '2026-10-06',
        },
        true,
      ),
    ])
    assert.deepEqual(responses.map((response) => response.statusCode).sort(), [201, 422])
    assert.equal(await quantityIn(t.id, t.main.id), 3)
    assert.ok((await quantityIn(t.id, t.annex.id)) >= 0)
  })
})
