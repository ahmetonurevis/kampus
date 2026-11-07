import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { academicYears } from '../src/db/schema/academic-years.ts'
import { buildTestApp, createInstitution, signInAs, TEST_ORIGIN } from './support/app.ts'
import { createPgDatabase, PG_SKIP } from './support/pg.ts'

/**
 * Eğitim yılı uçları gerçek PostgreSQL 16'da (DOM-YTK-064, -065): eşzamanlı etkinleştirme kurum
 * kilidi ve sürümle sıraya girer; dönem adı tekilliği veritabanının yerel ayarından bağımsızdır
 * (`name_key`, core `academicTermNameKey`).
 */
describe('PostgreSQL 16: eğitim yılı', { skip: PG_SKIP }, () => {
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

  function call(cookie: string, url: string, payload: unknown, headers: Record<string, string>) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/academic-years${url}`,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
        ...headers,
      },
      payload: JSON.stringify(payload),
    })
  }

  test('DOM-YTK-065: iki eşzamanlı etkinleştirmeden biri 200, öteki 409; tek etkin yıl kalır', async () => {
    const institution = await createInstitution(app, { academicYear: null })
    const cookie = await signInAs(app, institution.admin)
    const created = await call(
      cookie,
      '',
      {
        startYear: 2026,
        terms: [{ name: 'Güz', startDate: '2026-09-14', endDate: '2027-01-22' }],
      },
      {},
    )
    assert.equal(created.statusCode, 201, created.body)
    const results = await Promise.all([
      call(cookie, '/2026/activate', {}, { 'if-match': '"1"' }),
      call(cookie, '/2026/activate', {}, { 'if-match': '"1"' }),
    ])
    assert.deepEqual(results.map((item) => item.statusCode).sort(), [200, 409])
    const rows = await db
      .select({ status: academicYears.status, version: academicYears.version })
      .from(academicYears)
      .where(eq(academicYears.institutionId, institution.id))
    assert.deepEqual(rows, [{ status: 'active', version: 2 }])
  })

  test('DOM-YTK-064: "I." ile "ı." aynı ad (409 academic_term_name_exists), "i." ayrı ad', async () => {
    const institution = await createInstitution(app, { academicYear: null })
    const cookie = await signInAs(app, institution.admin)
    const created = await call(
      cookie,
      '',
      {
        startYear: 2026,
        terms: [{ name: 'I. dönem', startDate: '2026-09-14', endDate: '2027-01-22' }],
      },
      {},
    )
    assert.equal(created.statusCode, 201, created.body)
    const term = (name: string) => ({ name, startDate: '2027-02-08', endDate: '2027-06-25' })
    const same = await call(cookie, '/2026/terms', term('ı. DÖNEM'), { 'if-match': '"1"' })
    assert.equal(same.statusCode, 409, same.body)
    assert.equal(same.json<{ code: string }>().code, 'academic_term_name_exists')
    const other = await call(cookie, '/2026/terms', term('i. dönem'), { 'if-match': '"1"' })
    assert.equal(other.statusCode, 201, other.body)
  })
})
