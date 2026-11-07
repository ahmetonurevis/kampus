import { after, before, describe, test } from 'node:test'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { buildTestApp } from './support/app.ts'
import { assertAuditLogAppendOnly } from './support/audit-log-append-only.ts'
import { createPgDatabase, PG_SKIP } from './support/pg.ts'

describe('PostgreSQL 16: audit_log yalnız eklenir (OG-200)', { skip: PG_SKIP }, () => {
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

  test('INSERT çalışır; UPDATE, DELETE, TRUNCATE, kurum silme ve imha ayarı 55000 ile reddedilir', async () => {
    await assertAuditLogAppendOnly(db, app)
  })
})
