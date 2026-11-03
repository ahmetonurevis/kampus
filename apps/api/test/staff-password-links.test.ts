import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import type { Job } from 'pg-boss'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import {
  queuedStaffLinkScheduler,
  runStaffLinkJob,
  STAFF_PASSWORD_LINK_JOB,
} from '../src/jobs/staff-password-link.ts'
import { MemoryMailer } from '../src/services/mailer.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'

/**
 * Personel davetinin parola bağlantısı işi `staff.password-link` (OG-060, DOM-YTK-070). Kuyruk
 * açıkken iş davetin transaction'ında eklenir; yük yalnız kimlik taşır, işleyici yeni hesabı
 * davet satırından ayırır (karar 73).
 */
describe('personel parola bağlantısı işi (DOM-YTK-070)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  const mailer = new MemoryMailer()

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { mailer })
  })
  after(async () => {
    await app.close()
    await close()
  })

  const job = (data: unknown): Job<unknown> =>
    ({ id: randomUUID(), name: STAFF_PASSWORD_LINK_JOB, data, retryCount: 0 }) as Job<unknown>
  const deps = () => ({ db, auth: app.auth, log: app.log })

  test('DOM-YTK-070: kuyruk açıkken her davet transaction içinde işe girer; yanıttan sonra gönderim olmaz', async () => {
    const sent: { name: string; data: unknown; singletonKey: unknown; db: boolean }[] = []
    const scheduler = queuedStaffLinkScheduler({
      send: async (name: string, data: unknown, options?: Record<string, unknown>) => {
        sent.push({
          name,
          data,
          singletonKey: options?.singletonKey,
          db: options?.db !== undefined,
        })
        return 'job-id'
      },
    } as never)
    await db.transaction((tx) =>
      scheduler.enqueue(tx, { institutionId: 'kurum-1', invitationId: 'davet-1' }),
    )
    assert.deepEqual(sent, [
      {
        name: STAFF_PASSWORD_LINK_JOB,
        data: { institutionId: 'kurum-1', invitationId: 'davet-1' },
        singletonKey: 'davet-1',
        db: true,
      },
    ])
  })

  test('DOM-YTK-070: işleyici yalnız yeni hesabın bekleyen davetine gönderir; bozuk yük deadletter', async () => {
    const institution = await createInstitution(app)
    const other = await createInstitution(app)
    const existing = await createMember(app, other.id, 'onburo')
    const cookie = await signInAs(app, institution.admin)
    const invite = async (address: string) => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/institution-members/invitations',
        headers: {
          origin: TEST_ORIGIN,
          cookie,
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
        },
        payload: { email: address, name: 'Kişi', role: 'onburo' },
      })
      assert.equal(response.statusCode, 201, response.body)
      await app.staffLinks.inline.idle()
      return String(response.json().data.id)
    }
    const fresh = `yeni-${randomUUID().slice(0, 8)}@kampus.example`
    const freshId = await invite(fresh)
    const elsewhereId = await invite(existing.email)
    // Kuyruksuz yol aynı işleyiciyi çağırdı: yalnız yeni hesaba ileti.
    assert.ok(mailer.lastTo(fresh))
    assert.equal(mailer.lastTo(existing.email), undefined)

    // Yinelenen teslim (pg-boss en az bir kez) soğuma süresinde ikinci ileti göndermez.
    const sentBefore = mailer.outbox.length
    const sentResult = await runStaffLinkJob(
      deps(),
      job({ institutionId: institution.id, invitationId: freshId }),
    )
    assert.equal(sentResult.status, 'completed')
    assert.deepEqual(sentResult.output, { outcome: 'sent' })
    assert.equal(mailer.outbox.length, sentBefore)

    const skipped = await runStaffLinkJob(
      deps(),
      job({ institutionId: institution.id, invitationId: elsewhereId }),
    )
    assert.deepEqual(skipped.output, { outcome: 'skipped' })
    // Başka kurumun kimliğiyle aynı davet okunmaz.
    const foreign = await runStaffLinkJob(
      deps(),
      job({ institutionId: other.id, invitationId: freshId }),
    )
    assert.deepEqual(foreign.output, { outcome: 'skipped' })
    assert.equal(mailer.lastTo(existing.email), undefined)

    const invalid = await runStaffLinkJob(deps(), job({ invitationId: freshId, email: fresh }))
    assert.equal(invalid.status, 'deadletter')
  })
})
