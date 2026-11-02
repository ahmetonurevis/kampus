import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import type { FastifyBaseLogger } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { DrizzleQueryError } from 'drizzle-orm/errors'

import type { App } from '../src/app.ts'
import { jobsEnabled, parseConfig } from '../src/config.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { files } from '../src/db/schema/files.ts'
import { idempotencyKeys } from '../src/db/schema/idempotency-keys.ts'
import { dispatchInstitutionJobs, dispatchQueueName, type JobSender } from '../src/jobs/dispatch.ts'
import { filesPurgeExpiredJob } from '../src/jobs/files-purge-expired.ts'
import { filesPurgeJob } from '../src/jobs/files-purge.ts'
import { idempotencyPurgeJob } from '../src/jobs/idempotency-purge.ts'
import { bootJobs } from '../src/jobs/boot.ts'
import { jobErrorInfo } from '../src/jobs/job-error.ts'
import { permissionRemindersJob } from '../src/jobs/permission-reminders.ts'
import { INSTITUTION_JOBS, RETIRED_JOBS } from '../src/jobs/registry.ts'
import { DAY_SECONDS, type JobDeps } from '../src/jobs/types.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  uniqueId,
} from './support/app.ts'
import { multipart, PDF, tempStorage, uploadParts } from './support/files-sample.ts'

/**
 * Arka plan işleri (OG-094): kurum başına dağıtım ve saf işleyiciler. Kuyruğun kendisi (pg-boss)
 * gerçek PostgreSQL ister ve `pg-jobs.test.ts`'tedir; burada işleyiciler bellek içi PGlite'ta
 * doğrudan, sabit `now` ile çağrılır.
 */

const HOUR = 3600_000

/**
 * Gönderilen işleri kaydeden sahte kuyruk. Tekilliği (aynı ad + `singletonKey` ikinci kez `null`)
 * bu sahte uygular; pg-boss'un gerçek `singletonSeconds` davranışı `pg-jobs.test.ts`'te sınanır.
 * Burada sınanan, dağıtımın kurum başına doğru ad, yük ve tekil anahtarla gönderdiğidir.
 */
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
  const logs: string[] = []

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    store = await tempStorage()
    app = await buildTestApp(db, { storage: store.storage, logs })
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

  test('dağıtım her kuruma doğru yük ve tekil anahtarla bir iş gönderir; sahte gönderici tekilliği uyguladığı için ikinci dağıtım 0 sayar', async () => {
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

  let serial = 0
  /** Kurumda öğrenci olarak bağlanmamış PDF yükler; dosya kimliğini döndürür. */
  async function uploadIn(institutionId: string, fileName?: string): Promise<string> {
    const user = await createMember(app, institutionId, 'ogrenci')
    const body = multipart(uploadParts('submission', PDF, fileName))
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: {
        origin: TEST_ORIGIN,
        cookie: await signInAs(app, user),
        'content-type': body.contentType,
        'idempotency-key': `test-jobs-${String(++serial).padStart(5, '0')}`,
      },
      payload: body.payload,
    })
    assert.equal(response.statusCode, 201, response.body)
    return (response.json() as { data: { id: string } }).data.id
  }
  const fileOf = async (institutionId: string, id: string) => {
    const [row] = await db.select().from(files).where(eq(files.id, id))
    assert.equal(row?.institutionId, institutionId)
    return row
  }

  test('ADR 0003 karar 5: files.purge-unattached 24 saati geçen bağlanmamış dosyayı siler; başka kurum ve yeni dosya kalır, ikinci çalıştırma 0', async () => {
    const a = await createInstitution(app)
    const b = await createInstitution(app)
    const stale = await uploadIn(a.id)
    const other = await uploadIn(b.id)

    const early = await filesPurgeJob.run(
      deps,
      { institutionId: a.id },
      new Date(FIXED_NOW.getTime() + 23 * HOUR),
    )
    assert.deepEqual(early, { purged: 0, rounds: 1 })
    assert.equal((await fileOf(a.id, stale))?.status, 'pending')

    const later = new Date(FIXED_NOW.getTime() + 25 * HOUR)
    assert.deepEqual(await filesPurgeJob.run(deps, { institutionId: a.id }, later), {
      purged: 1,
      rounds: 1,
    })
    const purged = await fileOf(a.id, stale)
    assert.equal(purged?.status, 'deleted')
    assert.ok(purged && (await store.storage.head(purged.storageKey)) === null)
    const kept = await fileOf(b.id, other)
    assert.equal(kept?.status, 'pending')
    assert.ok(kept && (await store.storage.head(kept.storageKey)) !== null)

    assert.deepEqual(await filesPurgeJob.run(deps, { institutionId: a.id }, later), {
      purged: 0,
      rounds: 1,
    })
  })

  /** Saklama sonunu (ve verilirse bağı) doğrudan yazar; imha işinin girdisi. */
  async function setRetention(
    institutionId: string,
    id: string,
    retentionUntil: Date | null,
    attachedId?: string,
  ) {
    await db
      .update(files)
      .set({
        retentionUntil,
        status: 'ready',
        ...(attachedId === undefined
          ? {}
          : {
              attachedType: 'task_submission_version',
              attachedId,
              attachedAt: FIXED_NOW,
              dataSubjectId: 's-1',
            }),
      })
      .where(and(eq(files.institutionId, institutionId), eq(files.id, id)))
  }
  const purgeAudits = async (institutionId: string) =>
    (
      await db
        .select({ entityId: auditLog.entityId, changes: auditLog.changes })
        .from(auditLog)
        .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, 'file.purge')))
    ).map((row) => row.entityId)

  test('DOM-BEC-052, DOM-YTK-059, ADR 0003 karar 13: files.purge-expired saklama sonu gelen (bağlı ya da bağsız) dosyayı imha eder, bağ ve süre kalır, denetime file.purge düşer; gelecek ve boş saklama sonu, başka kurum kalır; ikinci çalıştırma 0', async () => {
    const a = await createInstitution(app)
    const b = await createInstitution(app)
    const past = new Date(FIXED_NOW.getTime() - HOUR)
    const future = new Date(FIXED_NOW.getTime() + HOUR)
    const attached = await uploadIn(a.id)
    const withdrawn = await uploadIn(a.id)
    const fresh = await uploadIn(a.id)
    const unset = await uploadIn(a.id)
    const other = await uploadIn(b.id)
    await setRetention(a.id, attached, past, 'surum-1')
    await setRetention(a.id, withdrawn, FIXED_NOW)
    await setRetention(a.id, fresh, future, 'surum-2')
    await setRetention(a.id, unset, null)
    await setRetention(b.id, other, past)

    assert.deepEqual(await filesPurgeExpiredJob.run(deps, { institutionId: a.id }, FIXED_NOW), {
      purged: 2,
      rounds: 1,
    })
    for (const id of [attached, withdrawn]) {
      const row = await fileOf(a.id, id)
      assert.equal(row?.status, 'deleted')
      assert.equal(row?.deletedAt?.toISOString(), FIXED_NOW.toISOString())
      assert.equal(row?.originalName, null)
      assert.ok(row && (await store.storage.head(row.storageKey)) === null)
    }
    // Bağlı kayıt teslim sürümünde `deleted` görünür; bağ ve veri sahibi kalır.
    const kept = await fileOf(a.id, attached)
    assert.equal(kept?.attachedId, 'surum-1')
    assert.equal(kept?.dataSubjectId, 's-1')
    for (const [institutionId, id] of [
      [a.id, fresh],
      [a.id, unset],
      [b.id, other],
    ] as const) {
      const row = await fileOf(institutionId, id)
      assert.equal(row?.status, 'ready')
      assert.ok(row && (await store.storage.head(row.storageKey)) !== null)
    }
    assert.deepEqual((await purgeAudits(a.id)).sort(), [attached, withdrawn].sort())
    assert.deepEqual(await purgeAudits(b.id), [])

    assert.deepEqual(await filesPurgeExpiredJob.run(deps, { institutionId: a.id }, FIXED_NOW), {
      purged: 0,
      rounds: 1,
    })
    assert.equal((await purgeAudits(a.id)).length, 2)
    // Saklama sonu gelince ertesi çalıştırma siler.
    assert.deepEqual(await filesPurgeExpiredJob.run(deps, { institutionId: a.id }, future), {
      purged: 1,
      rounds: 1,
    })
    assert.equal((await fileOf(a.id, fresh))?.status, 'deleted')
  })

  test('files.purge-expired: nesne silinemezse satır deleted kalır, hata yalnız kimliklerle loglanır (dosya adı yok); iş düşmez ve tekrar çalıştırma satırı yeniden işlemez', async () => {
    const a = await createInstitution(app)
    const fileName = 'Deniz-imha-kaydi.pdf'
    const id = await uploadIn(a.id, fileName)
    await setRetention(a.id, id, FIXED_NOW)
    const from = logs.length
    store.storage.failDeletes = true
    try {
      assert.deepEqual(await filesPurgeExpiredJob.run(deps, { institutionId: a.id }, FIXED_NOW), {
        purged: 1,
        rounds: 1,
      })
    } finally {
      store.storage.failDeletes = false
    }
    const row = await fileOf(a.id, id)
    assert.equal(row?.status, 'deleted')
    assert.equal(row?.originalName, null)
    const written = logs.slice(from).join('')
    assert.match(written, /file\.purge_object_failed/)
    assert.ok(written.includes(id))
    assert.equal(written.includes(fileName), false)
    assert.equal(written.includes('Deniz'), false)
    assert.deepEqual(await filesPurgeExpiredJob.run(deps, { institutionId: a.id }, FIXED_NOW), {
      purged: 0,
      rounds: 1,
    })
    assert.deepEqual(await purgeAudits(a.id), [id])
  })

  test("DOM-ILT-039: izin formu hatırlatması İstanbul saatiyle 07:00'den önce (gece tetiklemesi) hiçbir şey yazmadan çıkar", async () => {
    const a = await createInstitution(app)
    // 03:30 UTC = 06:30 İstanbul; 04:00 UTC = 07:00 İstanbul.
    const night = new Date('2026-09-14T03:30:00.000Z')
    assert.deepEqual(await permissionRemindersJob.run(deps, { institutionId: a.id }, night), {
      forms: 0,
      reminded: 0,
      created: 0,
      deduplicated: 0,
      skipped: 'before_morning',
    })
    // 21:30 UTC bir önceki gün = 00:30 İstanbul (gece yarısı sonrası).
    const midnight = new Date('2026-09-13T21:30:00.000Z')
    const early = await permissionRemindersJob.run(deps, { institutionId: a.id }, midnight)
    assert.equal(early.skipped, 'before_morning')
    const morning = new Date('2026-09-14T04:00:00.000Z')
    const result = await permissionRemindersJob.run(deps, { institutionId: a.id }, morning)
    assert.notEqual(result.skipped, 'before_morning')
  })

  test('hata özeti yalnız code ve message taşır; Drizzle sorgu parametreleri ve pg detail sızmaz', () => {
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint "x"'), {
      code: '23505',
      detail: 'Key (email)=(ayse@ornek.test) already exists.',
    })
    const wrapped = new DrizzleQueryError('insert into t values ($1)', ['ayse@ornek.test'], pgError)
    const info = jobErrorInfo(wrapped)
    assert.deepEqual(info, {
      code: '23505',
      message: 'duplicate key value violates unique constraint "x"',
    })
    assert.ok(!JSON.stringify(info).includes('ayse@ornek.test'))
    assert.deepEqual(jobErrorInfo('düz metin'), { code: null, message: 'unknown error' })
  })

  test('RETIRED_JOBS şimdilik boştur; hiçbir iş hem kayıtta hem emekli listesinde değildir', () => {
    assert.equal(RETIRED_JOBS.length, 0)
    for (const job of INSTITUTION_JOBS) assert.ok(!RETIRED_JOBS.includes(job.name), job.name)
  })

  describe('açılışta kuyruk', () => {
    const stub = (lines: Record<string, unknown>[]) =>
      ({
        error: (line: Record<string, unknown>) => lines.push(line),
        info: (line: Record<string, unknown>) => lines.push(line),
      }) as unknown as FastifyBaseLogger

    test('kuyruk açılamazsa API düşmez: hata yalnız code ve message ile loglanır, Idempotency-Key temizliği eski yoldan çalışır', async () => {
      const a = await createInstitution(app)
      await keyRow(a.id, new Date(Date.now() - HOUR))
      const lines: Record<string, unknown>[] = []
      const failure = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5433'), {
        code: 'ECONNREFUSED',
        detail: 'gizli-ayrinti',
      })
      const queue = await bootJobs({
        app,
        db,
        log: stub(lines),
        enabled: true,
        connectionString: 'postgres://kullanici:gizli-sifre@localhost/x',
        storage: store.storage,
        start: () => Promise.reject(failure),
      })
      assert.equal(queue, null)
      assert.deepEqual(lines[0], {
        event: 'jobs.start_failed',
        code: 'ECONNREFUSED',
        message: 'connect ECONNREFUSED 127.0.0.1:5433',
      })
      assert.equal(lines[1]?.event, 'idempotency.purged')
      assert.ok(Number(lines[1]?.purged) >= 1)
      assert.deepEqual(await keysOf(a.id), [])
      const text = JSON.stringify(lines)
      assert.ok(!text.includes('gizli'))
    })

    test('kuyruk kapalıyken başlatıcı çağrılmaz, temizlik çalışır', async () => {
      let called = false
      const lines: Record<string, unknown>[] = []
      const queue = await bootJobs({
        app,
        db,
        log: stub(lines),
        enabled: false,
        connectionString: 'x',
        storage: store.storage,
        start: () => {
          called = true
          return Promise.reject(new Error('çağrılmamalı'))
        },
      })
      assert.equal(queue, null)
      assert.equal(called, false)
      assert.equal(lines[0]?.event, 'idempotency.purged')
    })
  })
})
