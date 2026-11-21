import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../../src/app.ts'
import type { Database } from '../../src/db/client.ts'
import { insertMissingRecords } from '../../src/db/records.ts'
import { stockCountLines, stockCounts } from '../../src/db/schema/finance-stock-counts.ts'
import {
  buildTestApp,
  createInstitution,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from '../support/app.ts'
import { createPgDatabase, PG_SKIP } from '../support/pg.ts'

/**
 * Stok sayımının eşzamanlılığı (DOM-FIN-081, K-228, K-229; ON-231). Depoda tek açık sayım kurum
 * kilidi ve kısmi tekil indeksle korunur; eşzamanlı okutmalar aynı satıra eklenir, biri ötekini
 * ezmez. PGlite tek bağlantılı olduğundan yarış yalnız gerçek PostgreSQL 16'da sınanır.
 */

const FINANCE = '/api/v1/finance'
type Json = Record<string, unknown>

describe('PostgreSQL 16: stok sayımı eşzamanlılığı', { skip: PG_SKIP }, () => {
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
      remoteAddress: '10.81.0.2',
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

  /** Kurum, ana depo ve 10 paket A4 kâğıt. */
  async function tenant() {
    const created = await createInstitution(app)
    const seed = createSeed(FIXED_NOW)
    await insertMissingRecords(
      db,
      created.id,
      seed.branches
        .filter((row) => row.id === 'b1')
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
          quantity: 10,
          movementDate: '2026-10-01',
          reason: 'opening',
        },
        true,
      ),
    )
    return { id: created.id, admin, warehouse, paper }
  }

  test('DOM-FIN-081, K-228: aynı depoda eşzamanlı iki başlatma tek açık sayım yazar', async () => {
    const t = await tenant()
    const responses = await Promise.all([
      call(t.admin, '/stock-counts', { warehouseId: t.warehouse.id }),
      call(t.admin, '/stock-counts', { warehouseId: t.warehouse.id }),
    ])
    assert.deepEqual(responses.map((response) => response.statusCode).sort(), [201, 409])
    const open = await db
      .select({ id: stockCounts.id })
      .from(stockCounts)
      .where(and(eq(stockCounts.institutionId, t.id), eq(stockCounts.status, 'open')))
    assert.equal(open.length, 1)
  })

  test('DOM-FIN-081, K-229: eşzamanlı okutmalar aynı satıra eklenir, sayım kaybolmaz', async () => {
    const t = await tenant()
    const count = ok(await call(t.admin, '/stock-counts', { warehouseId: t.warehouse.id }))
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        call(t.admin, `/stock-counts/${String(count.id)}/scans`, { code: 'KAG-A4' }, true),
      ),
    )
    assert.deepEqual(
      responses.map((response) => response.statusCode),
      [200, 200, 200, 200, 200],
    )
    const [line] = await db
      .select({ countedQuantity: stockCountLines.countedQuantity })
      .from(stockCountLines)
      .where(
        and(eq(stockCountLines.institutionId, t.id), eq(stockCountLines.countId, String(count.id))),
      )
    assert.equal(line?.countedQuantity, 5)
  })
})
