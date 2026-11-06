import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../../src/app.ts'
import type { Database } from '../../src/db/client.ts'
import { insertMissingRecords } from '../../src/db/records.ts'
import { enrollmentFreezes } from '../../src/db/schema/enrollment-freezes.ts'
import {
  buildTestApp,
  createInstitution,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from '../support/app.ts'
import { createPgDatabase, PG_SKIP } from '../support/pg.ts'

type Json = ReturnType<typeof JSON.parse>

const BASE = '/api/v1/finance/enrollment-freezes'
const REQUEST = {
  studentId: 's-1',
  reason: 'relocation',
  reasonNote: 'Başka ile taşınıyorum',
  startDate: '2026-10-20',
  returnDate: '2026-12-20',
}

/**
 * Kayıt dondurma gerçek PostgreSQL 16'da (DOM-DIL-052). PGlite tek bağlantılı olduğundan eşzamanlı
 * yazma yalnız burada sınanır: talep ve kararlar kurum kilidi altında sıraya girer, ikinci işlem
 * birincinin sonucunu görür ve reddedilir; tek açık kayıt kısmi tekil indeksle de korunur.
 */
describe('PostgreSQL 16: kayıt dondurma eşzamanlılığı', { skip: PG_SKIP }, () => {
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

  async function tenant() {
    const institution = await createInstitution(app, { type: 'language_school' })
    await insertMissingRecords(
      db,
      institution.id,
      [
        {
          collection: 'students' as const,
          id: 's-1',
          data: { id: 's-1', name: 'Deniz Yılmaz', classId: 'c-dil', isActive: true },
        },
      ],
      FIXED_NOW,
    )
    return { id: institution.id, cookie: await signInAs(app, institution.admin) }
  }

  const post = (cookie: string, url: string, body: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url,
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json', cookie, ...headers },
      payload: JSON.stringify(body),
    })

  test('DOM-DIL-052: eşzamanlı iki talepten biri açılır, öteki 409', async () => {
    const t = await tenant()
    const responses = await Promise.all([
      post(t.cookie, BASE, REQUEST),
      post(t.cookie, BASE, REQUEST),
    ])
    assert.deepEqual(responses.map((item) => item.statusCode).sort(), [201, 409])
    const rows = await db
      .select()
      .from(enrollmentFreezes)
      .where(eq(enrollmentFreezes.institutionId, t.id))
    assert.equal(rows.length, 1)
  })

  test('DOM-DIL-052: eşzamanlı onay ve retten yalnız biri geçer', async () => {
    const t = await tenant()
    const created = await post(t.cookie, BASE, REQUEST)
    assert.equal(created.statusCode, 201, created.body)
    const id: string = created.json<Json>().data.id
    const headers = { 'if-match': '"1"' }
    const responses = await Promise.all([
      post(t.cookie, `${BASE}/${id}/approve`, { note: 'Belgeler uygun' }, headers),
      post(t.cookie, `${BASE}/${id}/reject`, { note: 'Belge eksik' }, headers),
    ])
    assert.deepEqual(responses.map((item) => item.statusCode).sort(), [200, 409])
    const [row] = await db
      .select()
      .from(enrollmentFreezes)
      .where(and(eq(enrollmentFreezes.institutionId, t.id), eq(enrollmentFreezes.id, id)))
    assert.equal(row?.version, 2)
  })
})
