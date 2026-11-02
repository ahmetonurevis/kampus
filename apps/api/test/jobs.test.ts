import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import { jobsEnabled, parseConfig } from '../src/config.ts'
import type { Database } from '../src/db/client.ts'
import { idempotencyKeys } from '../src/db/schema/idempotency-keys.ts'
import { dispatchInstitutionJobs, dispatchQueueName, type JobSender } from '../src/jobs/dispatch.ts'
import { idempotencyPurgeJob } from '../src/jobs/idempotency-purge.ts'
import { INSTITUTION_JOBS } from '../src/jobs/registry.ts'
import { DAY_SECONDS, type JobDeps } from '../src/jobs/types.ts'
import {
  buildTestApp,
  createInstitution,
  createTestDatabase,
  FIXED_NOW,
  uniqueId,
} from './support/app.ts'
import { tempStorage } from './support/files-sample.ts'

/**
 * Arka plan işleri (OG-094): kurum başına dağıtım ve saf işleyiciler. Kuyruğun kendisi (pg-boss)
 * gerçek PostgreSQL ister ve `pg-jobs.test.ts`'tedir; burada işleyiciler bellek içi PGlite'ta
 * doğrudan, sabit `now` ile çağrılır.
 */

const HOUR = 3600_000

/** Gönderilen işleri kaydeden sahte kuyruk; aynı ad + tekil anahtar ikinci kez `null` döner. */
function recordingSender() {
  const sent: { name: string; data: unknown; singletonKey: string; singletonSeconds: number }[] = []
  const sender: JobSender = {
    send: async (name, data, options) => {
      if (sent.some((item) => item.name === name && item.singletonKey === options.singletonKey))
        return null
      sent.push({ name, data, ...options })
      return `job-${sent.length}`
    },
  }
  return { sender, sent }
}

describe('arka plan işleri', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let deps: JobDeps
  let store: Awaited<ReturnType<typeof tempStorage>>

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
    store = await tempStorage()
    deps = { db, storage: store.storage, log: app.log }
  })
  after(async () => {
    await app.close()
    await close()
    await store.remove()
  })

  test('JOBS_ENABLED verilmezse testte kapalı, geliştirme ve üretimde açık; açık değer üstün', () => {
    const base = {
      DATABASE_URL: 'postgres://test@localhost:5432/test',
      BETTER_AUTH_SECRET: 'yalniz-test-icin-otuz-iki-karakter-sir',
    }
    assert.equal(jobsEnabled(parseConfig({ ...base, NODE_ENV: 'test' })), false)
    assert.equal(jobsEnabled(parseConfig({ ...base, NODE_ENV: 'development' })), true)
    assert.equal(
      jobsEnabled(parseConfig({ ...base, NODE_ENV: 'test', JOBS_ENABLED: 'true' })),
      true,
    )
    assert.equal(
      jobsEnabled(parseConfig({ ...base, NODE_ENV: 'development', JOBS_ENABLED: 'false' })),
      false,
    )
    assert.equal(jobsEnabled(parseConfig({ ...base, NODE_ENV: 'test', JOBS_ENABLED: '' })), false)
    assert.throws(
      () => parseConfig({ ...base, NODE_ENV: 'test', JOBS_ENABLED: 'evet' }),
      /JOBS_ENABLED/,
    )
  })

  test('iş kayıtları: adlar tekil ve pg-boss adı kuralına uyar, cron beş alanlı', () => {
    const names = INSTITUTION_JOBS.flatMap((job) => [job.name, dispatchQueueName(job)])
    assert.equal(new Set(names).size, names.length)
    for (const name of names) assert.match(name, /^[a-z][a-z0-9.-]+$/)
    for (const job of INSTITUTION_JOBS) {
      assert.equal(job.cron.split(' ').length, 5, job.name)
      assert.ok(job.slotSeconds >= 3600, job.name)
    }
  })

  test('dağıtım her kuruma tek iş koyar; yük yalnız kurum kimliği, ikinci dağıtım iş açmaz', async () => {
    const a = await createInstitution(app)
    const b = await createInstitution(app)
    const { sender, sent } = recordingSender()
    const first = await dispatchInstitutionJobs(db, sender, idempotencyPurgeJob)
    assert.ok(first.institutions >= 2)
    assert.equal(first.queued, first.institutions)
    for (const institution of [a, b]) {
      const jobs = sent.filter((item) => item.singletonKey === institution.id)
      assert.equal(jobs.length, 1)
      assert.deepEqual(jobs[0], {
        name: 'idempotency.purge',
        data: { institutionId: institution.id },
        singletonKey: institution.id,
        singletonSeconds: DAY_SECONDS,
      })
    }
    const again = await dispatchInstitutionJobs(db, sender, idempotencyPurgeJob)
    assert.equal(again.queued, 0)
    assert.equal(sent.length, first.queued)
  })

  async function keyRow(institutionId: string, expiresAt: Date) {
    await db.insert(idempotencyKeys).values({
      institutionId,
      userId: uniqueId('test-user'),
      key: uniqueId('test-key'),
      requestHash: 'h',
      responseStatus: 200,
      responseBody: {},
      createdAt: new Date(expiresAt.getTime() - 24 * HOUR),
      expiresAt,
    })
  }
  const keysOf = async (institutionId: string) =>
    (
      await db
        .select({ expiresAt: idempotencyKeys.expiresAt })
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.institutionId, institutionId))
    ).map((row) => row.expiresAt.toISOString())

  test('idempotency.purge kurumun süresi dolan anahtarlarını siler; taze anahtar ve başka kurum kalır, ikinci çalıştırma 0', async () => {
    const a = await createInstitution(app)
    const b = await createInstitution(app)
    const expired = new Date(FIXED_NOW.getTime() - HOUR)
    const fresh = new Date(FIXED_NOW.getTime() + HOUR)
    await keyRow(a.id, expired)
    await keyRow(a.id, FIXED_NOW)
    await keyRow(a.id, fresh)
    await keyRow(b.id, expired)

    const result = await idempotencyPurgeJob.run(deps, { institutionId: a.id }, FIXED_NOW)
    assert.deepEqual(result, { purged: 2 })
    assert.deepEqual(await keysOf(a.id), [fresh.toISOString()])
    assert.deepEqual(await keysOf(b.id), [expired.toISOString()])

    assert.deepEqual(await idempotencyPurgeJob.run(deps, { institutionId: a.id }, FIXED_NOW), {
      purged: 0,
    })
  })
})
