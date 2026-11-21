import { after, before, describe, test } from 'node:test'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { buildTestApp, createTestDatabase } from './support/app.ts'
import { assertAuditLogAppendOnly } from './support/audit-log-append-only.ts'

describe('0043: audit_log yalnız eklenir (OG-200)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
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
