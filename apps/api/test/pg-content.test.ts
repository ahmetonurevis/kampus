import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { resourceVersions } from '../src/db/schema/resources.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { createPgDatabase, PG_SKIP } from './support/pg.ts'

/** İçerik havuzu durum geçişlerinin gerçek PostgreSQL 16'da eşzamanlılığı (DOM-KYN-031). */
describe('PostgreSQL 16: eşzamanlı içerik onayı', { skip: PG_SKIP }, () => {
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

  function post(url: string, cookie: string, body: unknown = {}, headers = {}) {
    return app.inject({
      method: 'POST',
      url: `/api/v1${url}`,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
        ...headers,
      },
      payload: JSON.stringify(body),
    })
  }

  test('DOM-KYN-031: aynı sürüme eşzamanlı iki onayda biri 200, öteki 409; sürüm tek kez yayımlanır', async () => {
    const institution = await createInstitution(app)
    await insertMissingRecords(
      db,
      institution.id,
      [
        {
          collection: 'teachers',
          id: 't-mat',
          data: { id: 't-mat', name: 'Selin Kaya', subjectId: 'matematik', branchId: 'b-1' },
        },
      ],
      FIXED_NOW,
    )
    const teacher = await createMember(app, institution.id, 'ogretmen', [
      { kind: 'teacher', recordId: 't-mat' },
    ])
    const teacherCookie = await signInAs(app, teacher)
    const adminCookie = await signInAs(app, institution.admin)

    const created = await post('/resources', teacherCookie, {
      title: 'Kesirlerle okuma',
      content: { type: 'text', body: 'Kesirler bütünün parçalarıdır.' },
      license: { kind: 'institution_original' },
      tags: {
        subjectId: 'matematik',
        gradeLevels: [9],
        outcomes: [{ outcomeId: 'MAT.9.1.1', outcomeSource: 'platform' }],
      },
    })
    assert.equal(created.statusCode, 201, created.body)
    const { resource, version } = created.json<{
      data: { resource: { id: string }; version: { id: string } }
    }>().data
    const base = `/resources/${resource.id}`
    const share = await post(`${base}/share`, teacherCookie, { scope: 'institution' })
    assert.equal(share.statusCode, 200, share.body)
    const submit = await post(`${base}/versions/${version.id}/submit`, teacherCookie)
    assert.equal(submit.statusCode, 200, submit.body)

    const results = await Promise.all([
      post(`${base}/versions/${version.id}/approve`, adminCookie),
      post(`${base}/versions/${version.id}/approve`, adminCookie),
    ])
    assert.deepEqual(results.map((item) => item.statusCode).sort(), [200, 409])
    const rejected = results.find((item) => item.statusCode === 409)
    assert.ok(rejected)
    assert.ok(
      ['resource_transition_invalid', 'version_conflict'].includes(
        rejected.json<{ code: string }>().code,
      ),
      rejected.body,
    )

    const [row] = await db
      .select({ status: resourceVersions.status })
      .from(resourceVersions)
      .where(eq(resourceVersions.id, version.id))
    assert.equal(row?.status, 'published')
    const audits = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institution.id), eq(auditLog.entityId, resource.id)))
    // Oluşturma, paylaşım, gönderme ve tek onay: dört denetim kaydı; kaybeden istek yazmadı.
    assert.equal(audits.length, 4)
  })
})
