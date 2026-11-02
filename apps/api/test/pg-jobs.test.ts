import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import { buildApp, type App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { idempotencyKeys } from '../src/db/schema/idempotency-keys.ts'
import { dispatchQueueName } from '../src/jobs/dispatch.ts'
import { idempotencyPurgeJob } from '../src/jobs/idempotency-purge.ts'
import {
  JOB_SCHEMA,
  JOB_TIME_ZONE,
  startJobs,
  type JobQueue,
  type StartJobsOptions,
} from '../src/jobs/queue.ts'
import { createInstitution, FIXED_NOW, testConfig, uniqueId } from './support/app.ts'
import { tempStorage } from './support/files-sample.ts'
import { createPgDatabase, PG_SKIP, TEST_PG_URL } from './support/pg.ts'

/**
 * PostgreSQL 16: gerçek pg-boss kuyruğu (OG-094). Kuyruk kendi şemasını kurar, zamanlamayı
 * Europe/Istanbul ile kaydeder, dağıtım kurum başına tek iş açar, işleyici çalışır ve uygulama
 * kapanınca kuyruk durur. İşleyici kuralları PGlite'ta (`jobs.test.ts`) sınanır.
 */

const HOUR = 3600_000
const PURGE_DISPATCH = dispatchQueueName(idempotencyPurgeJob)

describe('PostgreSQL 16: iş kuyruğu', { skip: PG_SKIP }, () => {
  let db: Database
  let close: () => Promise<void>
  let store: Awaited<ReturnType<typeof tempStorage>>
  const apps: App[] = []

  before(async () => {
    ;({ db, close } = await createPgDatabase())
    store = await tempStorage()
  })
  after(async () => {
    for (const app of apps) await app.close()
    await close()
    await store.remove()
  })

  /** Kuyruklu uygulama: `startJobs` hazır olmadan çağrılır (kapanış kancası). */
  async function appWithJobs(
    extra: Partial<StartJobsOptions> = {},
  ): Promise<{ app: App; queue: JobQueue }> {
    const app = await buildApp({
      config: testConfig(),
      db,
      clock: () => FIXED_NOW,
      storage: store.storage,
    })
    apps.push(app)
    const queue = await startJobs(app, {
      connectionString: TEST_PG_URL ?? '',
      storage: store.storage,
      jobs: [idempotencyPurgeJob],
      ...extra,
    })
    await app.ready()
    return { app, queue }
  }

  async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const value = await read()
      if (done(value)) return value
      await delay(250)
    }
    throw new Error('beklenen durum 15 sn içinde oluşmadı')
  }

  test('kuyruk kendi şemasını kurar; zamanlama Europe/Istanbul, iki örnekte tek kayıt', async () => {
    const { queue } = await appWithJobs()
    assert.equal(await queue.boss.isInstalled(), true)
    const { rows } = await queue.boss
      .getDb()
      .executeSql('select 1 from information_schema.schemata where schema_name = $1', [JOB_SCHEMA])
    assert.equal(rows.length, 1)

    await appWithJobs()
    const schedules = (await queue.boss.getSchedules()).filter(
      (item) => item.name === PURGE_DISPATCH,
    )
    assert.equal(schedules.length, 1)
    assert.equal(schedules[0]?.cron, idempotencyPurgeJob.cron)
    assert.equal(schedules[0]?.timezone, JOB_TIME_ZONE)
  })

  test('dağıtım kurum başına tek iş açar, işleyici çalışır; ikinci dağıtım iş açmaz', async () => {
    const { queue } = await appWithJobs()
    const institution = await createInstitution(apps[0] as App)
    await db.insert(idempotencyKeys).values({
      institutionId: institution.id,
      userId: uniqueId('test-user'),
      key: uniqueId('test-key'),
      requestHash: 'h',
      responseStatus: 200,
      responseBody: {},
      createdAt: new Date(FIXED_NOW.getTime() - 25 * HOUR),
      expiresAt: new Date(FIXED_NOW.getTime() - HOUR),
    })
    const keys = () =>
      db
        .select({ key: idempotencyKeys.key })
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.institutionId, institution.id))

    await queue.boss.send(PURGE_DISPATCH, {})
    await until(keys, (rows) => rows.length === 0)
    const jobsOf = () =>
      queue.boss.findJobs<{ institutionId: string }>(idempotencyPurgeJob.name, {
        key: institution.id,
      })
    const [job] = await until(jobsOf, (found) => found[0]?.state === 'completed')
    assert.deepEqual(job?.data, { institutionId: institution.id })

    const second = await queue.boss.send(PURGE_DISPATCH, {})
    assert.ok(second)
    await until(
      () => queue.boss.findJobs(PURGE_DISPATCH, { id: second }),
      (found) => found[0]?.state === 'completed',
    )
    assert.equal((await jobsOf()).length, 1)
  })

  test('uygulama kapanınca kuyruk durur', async () => {
    const { app, queue } = await appWithJobs()
    let stopped = false
    queue.boss.on('stopped', () => {
      stopped = true
    })
    await app.close()
    apps.splice(apps.indexOf(app), 1)
    assert.equal(stopped, true)
    await assert.rejects(queue.boss.send(PURGE_DISPATCH, {}))
  })

  test('RETIRED_JOBS: listede olmayan zamanlama korunur, emekli işin zamanlaması silinir', async () => {
    const { queue } = await appWithJobs()
    const suffix = uniqueId('t').replaceAll(/[^a-z0-9]/g, '')
    const kept = `test-kept-${suffix}.dispatch`
    const retired = `test-retired-${suffix}.dispatch`
    for (const name of [kept, retired]) {
      await queue.boss.createQueue(name)
      await queue.boss.schedule(name, '0 4 * * *', null, { tz: JOB_TIME_ZONE })
    }
    try {
      // Dar iş listesi (yalnız idempotency.purge) ortak veritabanındaki başka zamanlamayı silmez.
      await appWithJobs({ retiredJobs: [`test-retired-${suffix}`] })
      const names = (await queue.boss.getSchedules()).map((item) => item.name)
      assert.ok(names.includes(kept), 'listede olmayan zamanlama korunmalı')
      assert.ok(!names.includes(retired), 'emekli işin zamanlaması silinmeli')
      assert.ok(names.includes(PURGE_DISPATCH))
    } finally {
      for (const name of [kept, retired]) {
        await queue.boss.unschedule(name)
        await queue.boss.deleteQueue(name)
      }
    }
  })

  test('bozuk yük yeniden denenmeden düşer: iş failed olur, deneme sayısı artmaz', async () => {
    const { queue } = await appWithJobs()
    const id = await queue.boss.send(idempotencyPurgeJob.name, { institutionId: 1, fazla: true })
    assert.ok(id)
    const [job] = await until(
      () => queue.boss.findJobs(idempotencyPurgeJob.name, { id }),
      (found) => found[0]?.state === 'failed' || found[0]?.state === 'retry',
    )
    assert.equal(job?.state, 'failed')
    assert.equal(job?.retryCount, 0)
  })
})
