import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { buildApp, type App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertFile } from '../src/db/files.ts'
import { files } from '../src/db/schema/files.ts'
import { idempotencyKeys } from '../src/db/schema/idempotency-keys.ts'
import { dispatchQueueName } from '../src/jobs/dispatch.ts'
import {
  MEDIA_TRANSCODE_JOB,
  postgresSessionLock,
  requeueStaleTranscodes,
  STALE_TRANSCODE_MS,
} from '../src/jobs/media-transcode.ts'
import { FILE_SCAN_JOB } from '../src/jobs/file-scan.ts'
import { filesPurgeExpiredJob } from '../src/jobs/files-purge-expired.ts'
import { idempotencyPurgeJob } from '../src/jobs/idempotency-purge.ts'
import { HOUR_SECONDS, type AnyInstitutionJob } from '../src/jobs/types.ts'
import {
  JOB_SCHEMA,
  JOB_TIME_ZONE,
  startJobs,
  type JobQueue,
  type StartJobsOptions,
} from '../src/jobs/queue.ts'
import { storageKeyFor } from '../src/storage/storage.ts'
import {
  createInstitution,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  testConfig,
  uniqueId,
} from './support/app.ts'
import { MP3, multipart, PDF, tempStorage, uploadParts } from './support/files-sample.ts'
import { FakeTranscoder } from './support/media-sample.ts'
import { FakeFileScanner } from './support/scan-sample.ts'
import { createPgDatabase, PG_SKIP } from './support/pg.ts'

/**
 * PostgreSQL 16: gerçek pg-boss kuyruğu (OG-094). Kuyruk kendi şemasını kurar, zamanlamayı
 * Europe/Istanbul ile kaydeder, dağıtım kurum başına tek iş açar, işleyici çalışır ve uygulama
 * kapanınca kuyruk durur. İşleyici kuralları PGlite'ta (`jobs.test.ts`) sınanır.
 */

const HOUR = 3600_000
const PURGE_DISPATCH = dispatchQueueName(idempotencyPurgeJob)

describe('PostgreSQL 16: iş kuyruğu', { skip: PG_SKIP }, () => {
  let db: Database
  let url = ''
  let close: () => Promise<void>
  let store: Awaited<ReturnType<typeof tempStorage>>
  const apps: App[] = []
  const transcoder = new FakeTranscoder()
  const scanner = new FakeFileScanner()

  before(async () => {
    ;({ db, url, close } = await createPgDatabase())
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
    // Ortak kuyruktaki `media.transcode` işini hangi örnek çekerse çeksin sahte dönüştürücü
    // kullanılır (gerçek ffmpeg `media-ffmpeg.test.ts`'te). `file.scan` için de sahte tarayıcı.
    const app = await buildApp({
      config: testConfig(),
      db,
      clock: () => FIXED_NOW,
      storage: store.storage,
      media: { transcoder },
      fileScan: { scanner },
    })
    apps.push(app)
    const queue = await startJobs(app, {
      connectionString: url,
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

  /**
   * Bu teste özgü adlı kurum işi: ortak veritabanındaki öteki kuyrukların birikmiş işleri (dağıtım
   * bütün kurumlara iş koyar) bu testin işinin önüne geçmez. Kuyruk ve zamanlaması sonunda silinir.
   */
  async function withTestJob(
    run: AnyInstitutionJob['run'],
    body: (queue: JobQueue, definition: AnyInstitutionJob) => Promise<void>,
  ) {
    const definition: AnyInstitutionJob = {
      name: `test-${uniqueId('job').replaceAll(/[^a-z0-9]/g, '')}`,
      cron: '0 4 * * *',
      slotSeconds: HOUR_SECONDS,
      run,
    }
    const { app, queue } = await appWithJobs({ jobs: [definition] })
    try {
      await body(queue, definition)
    } finally {
      for (const name of [definition.name, dispatchQueueName(definition)]) {
        await queue.boss.unschedule(name)
        await queue.boss.deleteQueue(name)
      }
      await app.close()
      apps.splice(apps.indexOf(app), 1)
    }
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

  test('dağıtım kurum başına tek iş açar (yük yalnız kurum kimliği); ikinci dağıtım iş açmaz', async () => {
    // İşleyici kayıt tutar; dağıtım ortak veritabanındaki bütün kurumlara iş koyar, bu yüzden
    // test kendi kurumunun işinin tamamlanmasını beklemez (işleyicinin kuyruktan çalışması aşağıdaki
    // testlerde doğrudan gönderilen işle sınanır).
    await withTestJob(
      async () => ({ ok: 1 }),
      async (queue, definition) => {
        const institution = await createInstitution(apps[0] as App)
        const dispatch = dispatchQueueName(definition)
        const dispatched = async () => {
          const id = await queue.boss.send(dispatch, {})
          assert.ok(id)
          await until(
            () => queue.boss.findJobs(dispatch, { id }),
            (found) => found[0]?.state === 'completed',
          )
        }
        const jobsOf = () =>
          queue.boss.findJobs<{ institutionId: string }>(definition.name, { key: institution.id })

        await dispatched()
        const [job] = await jobsOf()
        assert.deepEqual(job?.data, { institutionId: institution.id })
        await dispatched()
        assert.equal((await jobsOf()).length, 1)
      },
    )
  })

  test('idempotency.purge kuyruktan çalışır: kurumun süresi geçmiş anahtarı silinir', async () => {
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

    const id = await queue.boss.send(idempotencyPurgeJob.name, { institutionId: institution.id })
    assert.ok(id)
    await until(keys, (rows) => rows.length === 0)
    await until(
      () => queue.boss.findJobs(idempotencyPurgeJob.name, { id }),
      (found) => found[0]?.state === 'completed',
    )
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

  test('DOM-BEC-052, DOM-YTK-059: files.purge-expired kuyruktan çalışır; saklama sonu gelen konuşma kaydı imha edilir, gelecektekine dokunulmaz', async () => {
    const { queue } = await appWithJobs({ jobs: [filesPurgeExpiredJob] })
    const institution = await createInstitution(apps[0] as App)
    const recording = async (retentionUntil: Date) => {
      const id = randomUUID()
      const storageKey = storageKeyFor({
        institutionId: institution.id,
        purpose: 'speaking_recording',
        fileId: id,
        now: FIXED_NOW,
      })
      await store.storage.put(storageKey, Readable.from(MP3))
      await insertFile(
        db,
        institution.id,
        {
          id,
          purpose: 'speaking_recording',
          storageKey,
          contentType: 'audio/mpeg',
          byteSize: MP3.length,
          sha256: '0'.repeat(64),
          originalName: 'kayit.mp3',
          uploadedByUserId: uniqueId('test-user'),
        },
        FIXED_NOW,
      )
      await db
        .update(files)
        .set({ status: 'ready', retentionUntil })
        .where(and(eq(files.institutionId, institution.id), eq(files.id, id)))
      return { id, storageKey }
    }
    const expired = await recording(new Date(FIXED_NOW.getTime() - HOUR))
    const kept = await recording(new Date(FIXED_NOW.getTime() + HOUR))
    const statusOf = async (id: string) =>
      (
        await db
          .select({ status: files.status })
          .from(files)
          .where(and(eq(files.institutionId, institution.id), eq(files.id, id)))
      )[0]?.status

    // Kurum işi doğrudan kuyruğa konur: dağıtım (bütün kurumlar) önceki testte sınanır; sonuç
    // ortak veritabanındaki kurum sayısına bağlı kalmaz.
    await queue.boss.send(filesPurgeExpiredJob.name, { institutionId: institution.id })
    // İş önce satırı `deleted` yapıp commit eder, nesneyi depodan ondan sonra siler; yalnız durumu
    // beklemek nesne silinmeden önce bakıp yarışa düşer. İkisi birlikte beklenir.
    await until(
      async () => ({
        status: await statusOf(expired.id),
        object: await store.storage.head(expired.storageKey),
      }),
      ({ status, object }) => status === 'deleted' && object === null,
    )
    assert.equal(await statusOf(kept.id), 'ready')
    assert.notEqual(await store.storage.head(kept.storageKey), null)
  })

  test('her iş ayrı çekilir: bozuk yük yeniden denenmeden düşer, hata veren iş yeniden denenir, öteki iş tamamlanır', async () => {
    const failing = uniqueId('hata')
    const passing = uniqueId('basari')
    await withTestJob(
      async (_deps, { institutionId }) => {
        if (institutionId === failing) throw new Error('beklenen test hatası')
        return { ok: 1 }
      },
      async (queue, definition) => {
        const ids = {
          invalid: await queue.boss.send(definition.name, { institutionId: 1, fazla: true }),
          failed: await queue.boss.send(definition.name, { institutionId: failing }),
          completed: await queue.boss.send(definition.name, { institutionId: passing }),
        }
        const stateOf = async (id: string | null) => {
          assert.ok(id)
          return (await queue.boss.findJobs(definition.name, { id }))[0]
        }
        const settled = await until(
          async () => Promise.all([ids.invalid, ids.failed, ids.completed].map(stateOf)),
          (jobs) =>
            jobs.every((job) => job !== undefined && !['created', 'active'].includes(job.state)),
        )
        const [invalid, failed, completed] = settled
        // Bozuk yük `deadletter` sonucuyla kalan denemeleri atlar: `failed`, deneme sayısı 0.
        assert.equal(invalid?.state, 'failed')
        assert.equal(invalid?.retryCount, 0)
        // İşleyici hatası geri çekilmeli yeniden denemeye düşer; öteki işler etkilenmez.
        assert.equal(failed?.state, 'retry')
        assert.equal(completed?.state, 'completed')
        assert.deepEqual(completed?.output, { ok: 1 })
      },
    )
  })
  test('OG-262: ses yüklemesi media.transcode işini aynı işlemde açar; iş kuyruktan çalışır, dosya ölçülür ve ready olur', async () => {
    const { app, queue } = await appWithJobs()
    const institution = await createInstitution(app)
    const cookie = await signInAs(app, institution.admin)
    const body = multipart(uploadParts('listening_audio', MP3, 'dinleme.mp3', 'audio/mpeg'))
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': body.contentType,
        'idempotency-key': `test-pg-media-${randomUUID()}`,
      },
      payload: body.payload,
    })
    assert.equal(response.statusCode, 201, response.body)
    const fileId = response.json().data.id as string
    assert.equal(response.json().data.status, 'processing')
    const row = await until(
      async () =>
        (
          await db
            .select()
            .from(files)
            .where(and(eq(files.institutionId, institution.id), eq(files.id, fileId)))
        )[0],
      (value) => value?.status !== 'processing',
    )
    assert.equal(row?.status, 'ready')
    assert.equal(row?.durationMs, 30_000)
    assert.equal(row?.contentType, 'audio/mp4')
    const jobs = await queue.boss.findJobs(MEDIA_TRANSCODE_JOB, {
      data: { institutionId: institution.id, fileId },
    })
    assert.equal(jobs.length, 1)
    assert.deepEqual(jobs[0]?.data, { institutionId: institution.id, fileId })
  })

  test("OG-262: iş satırı yüklemeyle aynı transaction'dadır; geri alınan işlem iş bırakmaz", async () => {
    const { app, queue } = await appWithJobs()
    const institution = await createInstitution(app)
    const kept = { institutionId: institution.id, fileId: randomUUID() }
    const dropped = { institutionId: institution.id, fileId: randomUUID() }
    await db.transaction(async (tx) => app.media.scheduler.enqueue(tx, kept))
    await assert.rejects(
      db.transaction(async (tx) => {
        await app.media.scheduler.enqueue(tx, dropped)
        throw new Error('geri al')
      }),
      /geri al/,
    )
    const find = (data: object) => queue.boss.findJobs(MEDIA_TRANSCODE_JOB, { data })
    assert.equal((await find(kept)).length, 1)
    assert.equal((await find(dropped)).length, 0)
  })

  test('OG-262: kuyruksuz açılış kurtarmasının oturum kilidi tekildir; ikinci süreç atlar, kilit iş bitince ya da hatada bırakılır', async () => {
    const name = `test-recovery-${randomUUID()}`
    const first = postgresSessionLock(url, name)
    const second = postgresSessionLock(url, name)
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    let entered = () => {}
    const inside = new Promise<void>((resolve) => (entered = resolve))
    const holder = first(async () => {
      entered()
      await gate
      return 'birinci'
    })
    await inside
    let ran = false
    assert.deepEqual(
      await second(async () => {
        ran = true
      }),
      { acquired: false },
    )
    assert.equal(ran, false)
    release()
    assert.deepEqual(await holder, { acquired: true, value: 'birinci' })
    await assert.rejects(
      second(async () => {
        throw new Error('kurtarma hatası')
      }),
      /kurtarma hatası/,
    )
    assert.deepEqual(await first(async () => 'yeniden'), { acquired: true, value: 'yeniden' })
  })

  test('OG-262: media.transcode kuyruğu exclusive; dosyanın bekleyen ya da çalışan işi varken ne ikinci gönderim ne açılış kurtarması yeni iş açar, işi olmayan bayat dosyaya tek iş açılır', async () => {
    const { app, queue } = await appWithJobs()
    assert.equal((await queue.boss.getQueue(MEDIA_TRANSCODE_JOB))?.policy, 'exclusive')
    const institution = await createInstitution(app)
    const insert = async () => {
      const id = randomUUID()
      const storageKey = storageKeyFor({
        institutionId: institution.id,
        purpose: 'listening_audio',
        fileId: id,
        now: FIXED_NOW,
      })
      await store.storage.put(storageKey, Readable.from(MP3))
      await db.transaction((tx) =>
        insertFile(
          tx,
          institution.id,
          {
            id,
            purpose: 'listening_audio',
            storageKey,
            contentType: 'audio/mpeg',
            byteSize: MP3.length,
            sha256: 'a'.repeat(64),
            originalName: null,
            uploadedByUserId: institution.admin.id,
          },
          FIXED_NOW,
          'processing',
        ),
      )
      return { institutionId: institution.id, fileId: id }
    }
    // Dönüşüm kapıda bekler: kurtarmanın açtığı iş, işçi onu ne zaman çekerse çeksin, test
    // boyunca bitmez (`created` ya da `active`). Kapı yokken iş iki kurtarma arasında bitebilir;
    // ikinci kurtarma dosyayı bütün kurumları taramadan önce `processing` okuyup iş bittikten sonra
    // gönderirse ikinci bir iş açılır (zararsız: iş `not_processing` ile atlanır). Sonuç işçinin
    // hızına ve ortak veritabanındaki kurum sayısına bağlı kalmasın diye kapı kullanılır.
    let open = () => {}
    const gate = new Promise<void>((resolve) => (open = resolve))
    transcoder.during = () => gate
    try {
      const waiting = await insert()
      const orphan = await insert()
      // İşçi bekleyen işi bir saat çekmez: iş `created` durumunda kalır.
      const options = { singletonKey: waiting.fileId, startAfter: 3600 }
      assert.notEqual(await queue.boss.send(MEDIA_TRANSCODE_JOB, waiting, options), null)
      assert.equal(await queue.boss.send(MEDIA_TRANSCODE_JOB, waiting, options), null)
      // Kurtarma iki dosyayı da bayat bulur; bekleyen işi olana yeni iş açmaz.
      const later = new Date(FIXED_NOW.getTime() + STALE_TRANSCODE_MS + 60_000)
      await requeueStaleTranscodes(db, queue.boss, later)
      const find = (data: object) => queue.boss.findJobs(MEDIA_TRANSCODE_JOB, { data })
      assert.equal((await find(waiting)).length, 1)
      assert.equal((await find(orphan)).length, 1)
      // İkinci kurtarma da iş açmaz: öksüz dosyanın işi bekliyor ya da çalışıyor, `exclusive`
      // engeller.
      await requeueStaleTranscodes(db, queue.boss, later)
      assert.equal((await find(waiting)).length, 1)
      const jobs = await find(orphan)
      assert.equal(jobs.length, 1)
      assert.ok(['created', 'active'].includes(jobs[0]?.state ?? ''), jobs[0]?.state)
    } finally {
      transcoder.during = null
      open()
    }
  })

  /** Öğrencinin ödev dosyası yüklemesi (ses dışı amaç: `file.scan`). */
  async function uploadSubmission(app: App) {
    const institution = await createInstitution(app)
    const cookie = await signInAs(app, institution.admin)
    const body = multipart(uploadParts('material', PDF, 'materyal.pdf'))
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': body.contentType,
        'idempotency-key': `test-pg-scan-${randomUUID()}`,
      },
      payload: body.payload,
    })
    assert.equal(response.statusCode, 201, response.body)
    assert.equal(response.json().data.status, 'processing')
    const fileId = response.json().data.id as string
    const rowOf = async () =>
      (
        await db
          .select()
          .from(files)
          .where(and(eq(files.institutionId, institution.id), eq(files.id, fileId)))
      )[0]
    const row = await rowOf()
    assert.ok(row)
    return { institutionId: institution.id, fileId, storageKey: row.storageKey, rowOf }
  }

  test('OG-092, IST-027: ses dışı yükleme file.scan işini aynı işlemde açar; kuyruk exclusive; iş kuyruktan çalışır, temiz dosya ready olur', async () => {
    const { app, queue } = await appWithJobs()
    assert.equal((await queue.boss.getQueue(FILE_SCAN_JOB))?.policy, 'exclusive')
    const uploaded = await uploadSubmission(app)
    const row = await until(uploaded.rowOf, (value) => value?.status !== 'processing')
    assert.equal(row?.status, 'ready')
    assert.notEqual(await store.storage.head(uploaded.storageKey), null)
    const data = { institutionId: uploaded.institutionId, fileId: uploaded.fileId }
    const jobs = await until(
      () => queue.boss.findJobs(FILE_SCAN_JOB, { data }),
      (found) => found[0]?.state === 'completed',
    )
    assert.equal(jobs.length, 1)
    assert.deepEqual(jobs[0]?.data, data)
    assert.deepEqual(jobs[0]?.output, { outcome: 'ready' })
  })

  test('OG-092, DOM-KYN-004: zararlı dosya kuyruktan reddedilir ve nesnesi silinir; tarayıcıya ulaşılamazsa iş yeniden denenir, dosya processing kalır', async () => {
    const { app, queue } = await appWithJobs()
    scanner.result = 'infected'
    try {
      const infected = await uploadSubmission(app)
      // İş önce satırı `rejected` yapıp commit eder, nesneyi ondan sonra siler: ikisi birlikte
      // beklenir (purge testindeki yarış).
      await until(
        async () => ({
          status: (await infected.rowOf())?.status,
          object: await store.storage.head(infected.storageKey),
        }),
        ({ status, object }) => status === 'rejected' && object === null,
      )
    } finally {
      scanner.result = 'clean'
    }

    scanner.result = 'unavailable'
    try {
      const deferred = await uploadSubmission(app)
      const data = { institutionId: deferred.institutionId, fileId: deferred.fileId }
      // Geçici hata geri çekilmeli yeniden denemeye düşer (ilk gecikme 30 sn); dosya taramasız
      // `ready` olmaz, nesnesi silinmez.
      const jobs = await until(
        () => queue.boss.findJobs(FILE_SCAN_JOB, { data }),
        (found) => found[0]?.state === 'retry',
      )
      assert.equal(jobs.length, 1)
      assert.equal((await deferred.rowOf())?.status, 'processing')
      assert.notEqual(await store.storage.head(deferred.storageKey), null)
    } finally {
      scanner.result = 'clean'
    }
  })
})
