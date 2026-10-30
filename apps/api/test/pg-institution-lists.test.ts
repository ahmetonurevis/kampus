import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { createPgDatabase, PG_SKIP } from './support/pg.ts'

/**
 * PostgreSQL 16: kullanıcı listesi ve işlem geçmişi SQL'i (Türkçe harf katlama, türetilmiş durum,
 * Istanbul günü sınırı) PGlite ile aynı sonucu verir (DOM-YTK-020, DOM-YTK-053).
 */
describe('PostgreSQL 16: kurum kullanıcıları ve işlem geçmişi', { skip: PG_SKIP }, () => {
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

  const get = (url: string, cookie: string) =>
    app.inject({ method: 'GET', url, headers: { origin: TEST_ORIGIN, cookie } })

  test('arama Türkçe harfleri katlar, pasif durum bağlı kişi kaydından türer', async () => {
    const institution = await createInstitution(app)
    const cookie = await signInAs(app, institution.admin)
    await insertMissingRecords(
      db,
      institution.id,
      [
        {
          collection: 'students',
          id: 's-pg',
          data: { id: 's-pg', name: 'Pasif Öğrenci', isActive: false },
        },
      ],
      FIXED_NOW,
    )
    const passive = await createMember(app, institution.id, 'ogrenci', [
      { kind: 'student', recordId: 's-pg' },
    ])
    const response = await get('/api/v1/institution-members?status=passive', cookie)
    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(
      response.json<{ data: { userId: string }[] }>().data.map((row) => row.userId),
      [passive.id],
    )
    // `Test Yönetici` adı; İ/ı/Ö katlamaları PostgreSQL'de de eşleşir.
    for (const q of ['TEST YÖNETİCİ', 'test yonetici', 'yönetıcı']) {
      const found = await get(`/api/v1/institution-members?q=${encodeURIComponent(q)}`, cookie)
      assert.deepEqual(
        found.json<{ data: { userId: string }[] }>().data.map((row) => row.userId),
        [institution.admin.id],
        q,
      )
    }
  })

  test('işlem geçmişi Istanbul günü sınırını ve rehberlik maskesini uygular', async () => {
    const institution = await createInstitution(app)
    const cookie = await signInAs(app, institution.admin)
    const base = { institutionId: institution.id, actorUserId: institution.admin.id }
    await db.insert(auditLog).values([
      { ...base, action: 'pg.sinir-icinde', createdAt: new Date('2026-09-30T21:00:00.000Z') },
      { ...base, action: 'pg.sinir-disinda', createdAt: new Date('2026-10-01T21:00:00.000Z') },
      {
        ...base,
        action: 'workflow.guidance-note',
        entityType: 'guidanceCases',
        entityId: 'pg-gizli',
        changes: { fields: ['notes'] },
        createdAt: new Date('2026-10-01T10:00:00.000Z'),
      },
    ])
    const response = await get('/api/v1/audit-events?dateFrom=2026-10-01&dateTo=2026-10-01', cookie)
    assert.equal(response.statusCode, 200, response.body)
    assert.ok(!response.body.includes('pg-gizli'))
    assert.deepEqual(
      response.json<{ data: { action: string }[] }>().data.map((row) => row.action),
      ['workflow.guidance', 'pg.sinir-icinde'],
    )
  })
})
