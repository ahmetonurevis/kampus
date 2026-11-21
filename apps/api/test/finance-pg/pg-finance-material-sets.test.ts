import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, isNull } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../../src/app.ts'
import type { Database } from '../../src/db/client.ts'
import { insertMissingRecords } from '../../src/db/records.ts'
import { stockMovements } from '../../src/db/schema/finance-inventory.ts'
import { materialDeliveries } from '../../src/db/schema/finance-material-sets.ts'
import {
  buildTestApp,
  createInstitution,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from '../support/app.ts'
import { createPgDatabase, PG_SKIP } from '../support/pg.ts'

/**
 * Materyal seti tesliminin eşzamanlılığı (DOM-FIN-080, K-181; ON-232). Teslim stok çıkışını kurum
 * kilidi altında denetler ve aynı öğrenciye ikinci teslimi engeller; PGlite tek bağlantılı
 * olduğundan yarış yalnız gerçek PostgreSQL 16'da sınanır.
 */

const FINANCE = '/api/v1/finance'
type Json = Record<string, unknown>

describe('PostgreSQL 16: materyal seti teslimi eşzamanlılığı', { skip: PG_SKIP }, () => {
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
      remoteAddress: '10.81.0.1',
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

  /** Kurum, 7-A sınıfında s1 ve s25, ana depoda tek kitap, kitaplı 7. sınıf seti. */
  async function tenant() {
    const created = await createInstitution(app)
    const seed = createSeed(FIXED_NOW)
    await insertMissingRecords(
      db,
      created.id,
      [
        ...seed.branches
          .filter((row) => row.id === 'b1')
          .map((data) => ({ collection: 'branches' as const, id: data.id, data })),
        ...seed.classes
          .filter((row) => row.id === 'c1')
          .map((data) => ({ collection: 'classes' as const, id: data.id, data })),
        ...seed.students
          .filter((row) => row.id === 's1' || row.id === 's25')
          .map((data) => ({ collection: 'students' as const, id: data.id, data })),
      ],
      FIXED_NOW,
    )
    const admin = await signInAs(app, created.admin)
    const warehouse = ok(
      await call(admin, '/stock-warehouses', { name: 'Ana depo', campusId: 'b1' }),
    )
    const book = ok(
      await call(admin, '/stock-items', {
        code: 'KIT-7',
        name: '7. sınıf kitabı',
        category: 'educational',
        unit: 'piece',
      }),
    )
    ok(
      await call(
        admin,
        '/stock-entries',
        {
          itemId: book.id,
          warehouseId: warehouse.id,
          quantity: 1,
          movementDate: '2026-10-01',
          reason: 'opening',
        },
        true,
      ),
    )
    const set = ok(
      await call(admin, '/material-sets', {
        name: '7. Sınıf Seti',
        academicYear: 2026,
        gradeLevel: 7,
        items: [{ stockItemId: book.id, quantity: 1 }],
      }),
    )
    const deliver = (studentId: string) =>
      call(
        admin,
        `/material-sets/${String(set.id)}/deliveries`,
        {
          studentId,
          warehouseId: warehouse.id,
          deliveryDate: '2026-10-06',
          recipientKind: 'student',
          signatureReceived: true,
        },
        true,
      )
    return { id: created.id, deliver }
  }

  const liveCount = async (institutionId: string) => {
    const [deliveries, movements] = await Promise.all([
      db
        .select({ id: materialDeliveries.id })
        .from(materialDeliveries)
        .where(
          and(
            eq(materialDeliveries.institutionId, institutionId),
            isNull(materialDeliveries.cancelledAt),
          ),
        ),
      db
        .select({ id: stockMovements.id })
        .from(stockMovements)
        .where(
          and(eq(stockMovements.institutionId, institutionId), eq(stockMovements.type, 'delivery')),
        ),
    ])
    return { deliveries: deliveries.length, movements: movements.length }
  }

  test('DOM-FIN-080, K-181: iki öğrenciye eşzamanlı teslim tek kitabı birlikte tüketemez', async () => {
    const t = await tenant()
    const responses = await Promise.all([t.deliver('s1'), t.deliver('s25')])
    assert.deepEqual(responses.map((response) => response.statusCode).sort(), [201, 422])
    assert.equal(
      responses.find((response) => response.statusCode === 422)?.json().code,
      'stock_insufficient',
    )
    assert.deepEqual(await liveCount(t.id), { deliveries: 1, movements: 1 })
  })

  test('DOM-FIN-080: aynı öğrenciye eşzamanlı iki teslim tek teslim yazar', async () => {
    const t = await tenant()
    const responses = await Promise.all([t.deliver('s1'), t.deliver('s1')])
    const codes = responses.map((response) => response.statusCode).sort()
    assert.equal(codes[0], 201)
    assert.ok(codes[1] === 409 || codes[1] === 422, String(codes[1]))
    assert.deepEqual(await liveCount(t.id), { deliveries: 1, movements: 1 })
  })
})
