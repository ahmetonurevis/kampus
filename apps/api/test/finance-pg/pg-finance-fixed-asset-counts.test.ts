import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import type { App } from '../../src/app.ts'
import type { Database } from '../../src/db/client.ts'
import {
  fixedAssetCountItems,
  fixedAssetCounts,
} from '../../src/db/schema/finance-fixed-asset-counts.ts'
import {
  buildTestApp,
  createInstitution,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from '../support/app.ts'
import { createPgDatabase, PG_SKIP } from '../support/pg.ts'

/**
 * Demirbaş sayımının eşzamanlılığı (DOM-FIN-087, K-233, K-234; ON-237). Aynı kapsamda iki eşzamanlı
 * başlatmadan yalnız biri açılır; iki cihazın aynı etiketi aynı anda okutması tek okutma yazar,
 * öteki `already_counted` döner. PGlite tek bağlantılı olduğundan yarış yalnız PostgreSQL 16'da
 * sınanır.
 */

const FINANCE = '/api/v1/finance'
type Json = Record<string, unknown>

describe('PostgreSQL 16: demirbaş sayımı eşzamanlılığı', { skip: PG_SKIP }, () => {
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

  function call(cookie: string, url: string, payload: unknown) {
    return app.inject({
      method: 'POST',
      url: `${FINANCE}${url}`,
      remoteAddress: '10.87.0.1',
      headers: { origin: TEST_ORIGIN, cookie, 'content-type': 'application/json' },
      payload: JSON.stringify(payload),
    })
  }
  function ok(response: Awaited<ReturnType<typeof call>>, status = 201): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }

  async function tenant() {
    const created = await createInstitution(app)
    const admin = await signInAs(app, created.admin)
    const asset = ok(
      await call(admin, '/fixed-assets', {
        name: 'Mikroskop',
        category: 'laboratory',
        location: 'Fen laboratuvarı',
        acquisitionValueCents: 900_000,
        acquisitionDate: '2026-09-01',
      }),
    )
    return { id: created.id, admin, asset }
  }

  test('DOM-FIN-087: aynı kapsamda eşzamanlı iki başlatmadan biri açılır, öteki 409 (K-234)', async () => {
    const t = await tenant()
    const body = { scopeType: 'location', location: 'Fen laboratuvarı' }
    const results = await Promise.all([
      call(t.admin, '/fixed-asset-counts', body),
      call(t.admin, '/fixed-asset-counts', { ...body, location: 'FEN laboratuvarı' }),
    ])
    assert.deepEqual(results.map((response) => response.statusCode).sort(), [201, 409])
    const counts = await db
      .select()
      .from(fixedAssetCounts)
      .where(eq(fixedAssetCounts.institutionId, t.id))
    assert.equal(counts.length, 1)
  })

  test('DOM-FIN-087: iki cihaz aynı etiketi aynı anda okutunca tek okutma yazılır (K-233)', async () => {
    const t = await tenant()
    const count = ok(await call(t.admin, '/fixed-asset-counts', { scopeType: 'institution' }))
    const scan = (location: string) =>
      call(t.admin, `/fixed-asset-counts/${String(count.id)}/scans`, {
        code: t.asset.tagNumber,
        location,
      })
    const results = await Promise.all([scan('Fen laboratuvarı'), scan('Depo')])
    const outcomes = results.map((response) => ok(response, 200).outcome as string).sort()
    assert.equal(outcomes.filter((outcome) => outcome === 'already_counted').length, 1)
    const items = await db
      .select()
      .from(fixedAssetCountItems)
      .where(eq(fixedAssetCountItems.institutionId, t.id))
    assert.equal(items.length, 1)
    assert.notEqual(items[0]?.result, 'pending')
    assert.equal(items[0]?.version, 2)
  })
})
