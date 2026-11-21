import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { institutions } from '../src/db/schema/auth.ts'
import { institutionSettings } from '../src/db/schema/institution-settings.ts'
import { buildTestApp, createInstitution, signInAs, TEST_ORIGIN } from './support/app.ts'
import { createPgDatabase, PG_SKIP } from './support/pg.ts'

describe('PostgreSQL 16: eşzamanlı modül değişikliği', { skip: PG_SKIP }, () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createPgDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  function patch(cookie: string, moduleKey: string, enabled: boolean, version: number) {
    return app.inject({
      method: 'PATCH',
      url: `/api/v1/modules/${moduleKey}`,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': 'application/json',
        'if-match': `"${version}"`,
        'idempotency-key': randomUUID(),
      },
      payload: JSON.stringify({ enabled }),
    })
  }

  async function stored(institutionId: string) {
    const [row] = await db
      .select({ modules: institutions.enabledModules, version: institutionSettings.version })
      .from(institutions)
      .innerJoin(institutionSettings, eq(institutionSettings.institutionId, institutions.id))
      .where(eq(institutions.id, institutionId))
    assert.ok(row)
    return { modules: row.modules as Record<string, boolean>, version: row.version }
  }

  test('aynı sürümle iki eşzamanlı değişiklikte biri 200, öteki 409 version_conflict alır', async () => {
    const institution = await createInstitution(app)
    const cookie = await signInAs(app, institution.admin)
    const [first, second] = await Promise.all([
      patch(cookie, 'meals', false, 1),
      patch(cookie, 'clubs', false, 1),
    ])
    const statuses = [first.statusCode, second.statusCode].sort()
    assert.deepEqual(statuses, [200, 409])
    const rejected = first.statusCode === 409 ? first : second
    assert.equal(rejected.json<{ code: string }>().code, 'version_conflict')

    // Yalnız kazanan yazıldı: bir modül kapalı, öteki hiç saklanmadı; sürüm bir kez arttı.
    const row = await stored(institution.id)
    assert.equal(row.version, 2)
    const closed = Object.entries(row.modules).filter(([, enabled]) => !enabled)
    assert.equal(closed.length, 1)
  })

  test('aynı modüle iki eşzamanlı kapatma: biri 200, öteki 409; veri tek kez değişir', async () => {
    const institution = await createInstitution(app)
    const cookie = await signInAs(app, institution.admin)
    const results = await Promise.all([
      patch(cookie, 'meals', false, 1),
      patch(cookie, 'meals', false, 1),
    ])
    assert.deepEqual(results.map((item) => item.statusCode).sort(), [200, 409])
    assert.deepEqual(await stored(institution.id), { modules: { meals: false }, version: 2 })
  })
})
