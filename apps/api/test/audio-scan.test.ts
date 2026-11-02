import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'
import { after, before, describe, test } from 'node:test'

import { and, asc, eq, sql, type SQL } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertFile } from '../src/db/files.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { files } from '../src/db/schema/files.ts'
import { InlineScanScheduler, runScanRequeue, STALE_SCAN_MS } from '../src/jobs/file-scan.ts'
import {
  InlineTranscodeScheduler,
  requeueStaleTranscodes,
  STALE_TRANSCODE_MS,
} from '../src/jobs/media-transcode.ts'
import { scanStoredFile, type ScanDeps } from '../src/services/file-scan.ts'
import type { FileScanner, ScanVerdict } from '../src/services/file-scanner.ts'
import {
  purgeSupersededObjects,
  purgeUnattachedFiles,
  UNATTACHED_FILE_TTL_MS,
} from '../src/services/files.ts'
import { MediaContentError } from '../src/services/audio-transcoder.ts'
import { transcodeAudioFile, type TranscodeDeps } from '../src/services/media-transcode.ts'
import type { StorageDriver } from '../src/storage/storage.ts'
import {
  buildTestApp,
  createInstitution,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { MP3, multipart, tempStorage, uploadParts } from './support/files-sample.ts'
import { FakeTranscoder, RecordingScheduler } from './support/media-sample.ts'
import { FakeFileScanner, RecordingScanScheduler } from './support/scan-sample.ts'

/**
 * Ses dosyalarının virüs taraması (OG-988; ADR 0003 karar 8, 10; DOM-KYN-004, IST-027). Karar 8:
 * ses taramadan muaf değildir ama sonuç beklenmeden kodlamaya geçer; tarama bitene kadar dosya
 * `processing`'tir. Dönüştürücü ve tarayıcı sahtedir; iki işin yarışı sahtelerin ara kancalarıyla
 * deterministik kurulur (gerçek eşzamanlılık PGlite'ta yoktur, satır kilidi `test:pg`'dedir).
 */

const FILE_NAME = 'Deniz-konusma-gizli.mp3'
const MINUTE = 60_000

/** Taramanın ortasında (akış okunduktan sonra, sonuç dönmeden) kanca çalıştıran tarayıcı. */
class HookedScanner implements FileScanner {
  readonly inner = new FakeFileScanner()
  during: (() => Promise<void>) | null = null

  async scan(input: Readable): Promise<ScanVerdict> {
    const verdict = await this.inner.scan(input)
    const hook = this.during
    this.during = null
    await hook?.()
    return verdict
  }
}

describe('ses taraması (OG-988)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let inlineApp: App
  let offApp: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  const now = FIXED_NOW
  const logs: string[] = []
  const transcoder = new FakeTranscoder()
  const transcodeScheduler = new RecordingScheduler()
  const scanner = new HookedScanner()
  const scanScheduler = new RecordingScanScheduler()
  const inlineTranscoder = new FakeTranscoder()
  const inlineScanner = new FakeFileScanner()
  /** Taramanın açtığı depo anahtarları (taranan nesne hangisi). */
  const opened: string[] = []
  let serial = 0

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    store = await tempStorage()
    app = await buildTestApp(db, {
      storage: store.storage,
      clock: () => now,
      logs,
      media: { transcoder, scheduler: transcodeScheduler },
      fileScan: { scanner, scheduler: scanScheduler },
    })
    // Kuyruk kapalı: dönüşüm ve tarama yanıttan sonra süreç içinde, arka planda.
    inlineApp = await buildTestApp(db, {
      storage: store.storage,
      clock: () => now,
      logs,
      media: { transcoder: inlineTranscoder },
      fileScan: { scanner: inlineScanner },
    })
    // Tarayıcı kapalı (`FILE_SCANNER=off`).
    offApp = await buildTestApp(db, {
      storage: store.storage,
      clock: () => now,
      logs,
      media: { transcoder, scheduler: transcodeScheduler },
    })
  })
  after(async () => {
    await app.close()
    await inlineApp.close()
    await offApp.close()
    await close()
    await store.remove()
  })

  // Sürücünün özel alanları korunur: yalnız `open` kaydedilir.
  const recording = new Proxy({} as StorageDriver, {
    get(_target, property) {
      if (property === 'open')
        return (key: string) => {
          opened.push(key)
          return store.storage.open(key)
        }
      const value: unknown = Reflect.get(store.storage, property)
      return typeof value === 'function' ? value.bind(store.storage) : value
    },
  })
  const scanDeps = (): ScanDeps => ({ db, storage: recording, scanner, log: app.log })
  const transcodeDeps = (): TranscodeDeps => ({
    db,
    storage: store.storage,
    transcoder,
    log: app.log,
  })

  async function tenant() {
    const institution = await createInstitution(app)
    return { institution, cookie: await signInAs(app, institution.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  async function upload(t: Tenant, target: App = app) {
    const body = multipart(uploadParts('listening_audio', MP3, FILE_NAME, 'audio/mpeg'))
    const response = await target.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: {
        origin: TEST_ORIGIN,
        cookie: t.cookie,
        'content-type': body.contentType,
        'idempotency-key': `test-audio-scan-${String(++serial).padStart(6, '0')}`,
      },
      payload: body.payload,
    })
    assert.equal(response.statusCode, 201, response.body)
    return response.json().data.id as string
  }

  async function rowOf(t: Tenant, id: string) {
    const [row] = await db
      .select()
      .from(files)
      .where(and(eq(files.institutionId, t.institution.id), eq(files.id, id)))
    assert.ok(row)
    return row
  }
  const actionsOf = async (t: Tenant, id: string) =>
    (
      await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.institutionId, t.institution.id), eq(auditLog.entityId, id)))
        .orderBy(asc(auditLog.createdAt))
    ).map((item) => item.action)
  const urlStatus = async (t: Tenant, id: string) =>
    (
      await app.inject({
        method: 'GET',
        url: `/api/v1/files/${id}/url`,
        headers: { origin: TEST_ORIGIN, cookie: t.cookie },
      })
    ).statusCode
  const job = (t: Tenant, id: string) => ({ institutionId: t.institution.id, fileId: id })
  const objectsOf = async (id: string) => (await store.files()).filter((path) => path.includes(id))
  const at = (offset: number) => new Date(FIXED_NOW.getTime() + offset)
  const infected = async <T>(target: FakeFileScanner, work: () => Promise<T>) => {
    target.result = 'infected'
    try {
      return await work()
    } finally {
      target.result = 'clean'
    }
  }

  test('OG-988, ADR 0003 karar 8: tarayıcı açıkken ses yüklemesi dönüşüm ve taramayı aynı işlemde kuyruğa koyar; scanPending başlar, bağlantı 409', async () => {
    const t = await tenant()
    const id = await upload(t)
    assert.deepEqual(
      transcodeScheduler.queued.filter((item) => item.fileId === id),
      [job(t, id)],
    )
    assert.deepEqual(
      scanScheduler.queued.filter((item) => item.fileId === id),
      [job(t, id)],
    )
    const row = await rowOf(t, id)
    assert.equal(row.status, 'processing')
    assert.equal(row.scanPending, true)
    assert.equal(await urlStatus(t, id), 409)
  })

  test('OG-988: temiz ses, önce tarama biter; dosya processing kalır, ready yazımını dönüşüm yapar ve özgün nesneyi siler', async () => {
    const t = await tenant()
    const id = await upload(t)
    const original = (await rowOf(t, id)).storageKey
    opened.length = 0
    assert.deepEqual(await scanStoredFile(scanDeps(), job(t, id), at(MINUTE)), {
      outcome: 'clean',
    })
    // Taranan nesne yüklenen özgün nesnedir.
    assert.deepEqual(opened, [original])
    const scanned = await rowOf(t, id)
    assert.equal(scanned.status, 'processing')
    assert.equal(scanned.scanPending, false)
    assert.equal(scanned.readyAt, null)
    assert.equal(await urlStatus(t, id), 409)

    const outcome = await transcodeAudioFile(transcodeDeps(), job(t, id), at(2 * MINUTE))
    assert.equal(outcome.outcome, 'ready')
    const ready = await rowOf(t, id)
    assert.equal(ready.status, 'ready')
    assert.notEqual(ready.storageKey, original)
    // OG-995: bağsız dosyanın 24 saati sonra biten işin anından sayılır.
    assert.equal(ready.readyAt?.toISOString(), at(2 * MINUTE).toISOString())
    assert.equal(ready.supersededStorageKey, null)
    assert.equal(await store.storage.head(original), null)
    assert.deepEqual(await actionsOf(t, id), ['file.upload', 'file.scanned', 'file.ready'])
    assert.equal(await urlStatus(t, id), 200)
  })

  test('OG-988: temiz ses, önce dönüşüm biter; içerik yazılır ama dosya processing kalır, özgün nesne taramaya kalır; ready yazımını tarama yapar', async () => {
    const t = await tenant()
    const id = await upload(t)
    const original = (await rowOf(t, id)).storageKey
    const outcome = await transcodeAudioFile(transcodeDeps(), job(t, id), at(MINUTE))
    assert.equal(outcome.outcome, 'transcoded')
    const transcoded = await rowOf(t, id)
    assert.equal(transcoded.status, 'processing')
    assert.equal(transcoded.scanPending, true)
    assert.equal(transcoded.contentType, 'audio/mp4')
    assert.equal(transcoded.supersededStorageKey, original)
    assert.notEqual(await store.storage.head(original), null)
    assert.equal(await urlStatus(t, id), 409)
    // Saatlik temizlik taraması süren özgün nesneyi silmez; dönüşüm yinelenmez.
    await purgeSupersededObjects({
      db,
      storage: store.storage,
      log: app.log,
      institutionId: t.institution.id,
    })
    assert.notEqual(await store.storage.head(original), null)
    const calls = transcoder.calls.length
    assert.deepEqual(await transcodeAudioFile(transcodeDeps(), job(t, id), at(MINUTE)), {
      outcome: 'skipped',
      reason: 'awaiting_scan',
    })
    assert.equal(transcoder.calls.length, calls)

    opened.length = 0
    assert.deepEqual(await scanStoredFile(scanDeps(), job(t, id), at(3 * MINUTE)), {
      outcome: 'ready',
    })
    // Dönüşüm bitmiş olsa da taranan nesne yüklenen özgün nesnedir, dönüşmüş çıktı değil.
    assert.deepEqual(opened, [original])
    const ready = await rowOf(t, id)
    assert.equal(ready.status, 'ready')
    assert.equal(ready.scanPending, false)
    assert.equal(ready.readyAt?.toISOString(), at(3 * MINUTE).toISOString())
    assert.equal(ready.storageKey, transcoded.storageKey)
    assert.equal(ready.supersededStorageKey, null)
    assert.equal(await store.storage.head(original), null)
    assert.deepEqual(await objectsOf(id), [`${store.root}/${ready.storageKey}`])
    assert.deepEqual(await actionsOf(t, id), ['file.upload', 'file.transcoded', 'file.ready'])
    assert.equal(await urlStatus(t, id), 200)
  })

  test('OG-988, DOM-KYN-004: zararlı ses dönüşüm bitmiş olsa da rejected olur; dönüşmüş çıktı da özgün nesne de silinir', async () => {
    const t = await tenant()
    const id = await upload(t)
    await transcodeAudioFile(transcodeDeps(), job(t, id), at(MINUTE))
    assert.equal((await objectsOf(id)).length, 2)
    assert.deepEqual(
      await infected(scanner.inner, () => scanStoredFile(scanDeps(), job(t, id), at(2 * MINUTE))),
      { outcome: 'rejected', code: 'malware_found' },
    )
    const row = await rowOf(t, id)
    assert.equal(row.status, 'rejected')
    assert.equal(row.readyAt, null)
    assert.equal(row.supersededStorageKey, null)
    assert.deepEqual(await objectsOf(id), [])
    assert.deepEqual(await actionsOf(t, id), ['file.upload', 'file.transcoded', 'file.reject'])
    assert.equal(await urlStatus(t, id), 404)
  })

  test('OG-988: zararlı ses dönüşümden önce bulunursa rejected olur; sonra gelen dönüşüm dokunmaz, nesne kalmaz', async () => {
    const t = await tenant()
    const id = await upload(t)
    await infected(scanner.inner, () => scanStoredFile(scanDeps(), job(t, id), at(MINUTE)))
    assert.equal((await rowOf(t, id)).status, 'rejected')
    assert.deepEqual(await transcodeAudioFile(transcodeDeps(), job(t, id), at(2 * MINUTE)), {
      outcome: 'skipped',
      reason: 'not_processing',
    })
    assert.deepEqual(await objectsOf(id), [])
  })

  test('OG-988 yarış: tarama sürerken dönüşüm biter; dönüşüm kilit altında taramanın sürdüğünü görür, ready yazımını tarama yapar (tek file.ready)', async () => {
    const t = await tenant()
    const id = await upload(t)
    let during: unknown = null
    scanner.during = async () => {
      during = await transcodeAudioFile(transcodeDeps(), job(t, id), at(MINUTE))
    }
    assert.deepEqual(await scanStoredFile(scanDeps(), job(t, id), at(2 * MINUTE)), {
      outcome: 'ready',
    })
    assert.equal((during as { outcome: string } | null)?.outcome, 'transcoded')
    const row = await rowOf(t, id)
    assert.equal(row.status, 'ready')
    assert.equal(row.readyAt?.toISOString(), at(2 * MINUTE).toISOString())
    assert.equal(row.supersededStorageKey, null)
    assert.deepEqual(await objectsOf(id), [`${store.root}/${row.storageKey}`])
    assert.deepEqual(await actionsOf(t, id), ['file.upload', 'file.transcoded', 'file.ready'])
  })

  test('OG-988 yarış: dönüşüm sürerken tarama temiz biter; dönüşüm kilit altında taramanın bittiğini görür, ready yazımını dönüşüm yapar (tek file.ready)', async () => {
    const t = await tenant()
    const id = await upload(t)
    let during: unknown = null
    transcoder.during = async () => {
      transcoder.during = null
      during = await scanStoredFile(scanDeps(), job(t, id), at(MINUTE))
    }
    const outcome = await transcodeAudioFile(transcodeDeps(), job(t, id), at(2 * MINUTE))
    assert.equal(outcome.outcome, 'ready')
    assert.deepEqual(during, { outcome: 'clean' })
    const row = await rowOf(t, id)
    assert.equal(row.status, 'ready')
    assert.equal(row.scanPending, false)
    assert.equal(row.readyAt?.toISOString(), at(2 * MINUTE).toISOString())
    assert.deepEqual(await objectsOf(id), [`${store.root}/${row.storageKey}`])
    assert.deepEqual(await actionsOf(t, id), ['file.upload', 'file.scanned', 'file.ready'])
  })

  test('OG-988 yarış: dönüşüm sürerken tarama zararlı bulur; dönüşüm reddedilmiş satıra yazmaz ve çıktısını siler', async () => {
    const t = await tenant()
    const id = await upload(t)
    transcoder.during = async () => {
      transcoder.during = null
      await infected(scanner.inner, () => scanStoredFile(scanDeps(), job(t, id), at(MINUTE)))
    }
    assert.deepEqual(await transcodeAudioFile(transcodeDeps(), job(t, id), at(2 * MINUTE)), {
      outcome: 'skipped',
      reason: 'not_processing',
    })
    assert.equal((await rowOf(t, id)).status, 'rejected')
    assert.deepEqual(await objectsOf(id), [])
  })

  test('OG-988: dönüşüm başarısızsa bugünkü davranış korunur; dosya rejected, sonra gelen tarama yinelenmez', async () => {
    const t = await tenant()
    const id = await upload(t)
    transcoder.result = new MediaContentError('media_silent')
    try {
      const outcome = await transcodeAudioFile(transcodeDeps(), job(t, id), at(MINUTE))
      assert.equal(outcome.outcome, 'rejected')
    } finally {
      transcoder.result = { durationMs: 30_000, silent: false }
    }
    assert.equal((await rowOf(t, id)).status, 'rejected')
    const scans = scanner.inner.scanned.length
    assert.deepEqual(await scanStoredFile(scanDeps(), job(t, id), at(2 * MINUTE)), {
      outcome: 'skipped',
      reason: 'already_rejected',
    })
    assert.equal(scanner.inner.scanned.length, scans)
    assert.deepEqual(await objectsOf(id), [])
  })

  test('OG-988, FILE_SCANNER=off: ses bugünkü gibi yalnız dönüşüm kuyruğuna girer ve dönüşümle ready olur', async () => {
    const t = await tenant()
    const scansBefore = scanScheduler.queued.length
    const id = await upload(t, offApp)
    assert.equal(scanScheduler.queued.length, scansBefore)
    assert.deepEqual(
      transcodeScheduler.queued.filter((item) => item.fileId === id),
      [job(t, id)],
    )
    const original = (await rowOf(t, id)).storageKey
    assert.equal((await rowOf(t, id)).scanPending, false)
    const outcome = await transcodeAudioFile(transcodeDeps(), job(t, id), at(MINUTE))
    assert.equal(outcome.outcome, 'ready')
    const row = await rowOf(t, id)
    assert.equal(row.status, 'ready')
    assert.equal(await store.storage.head(original), null)
    assert.deepEqual(await actionsOf(t, id), ['file.upload', 'file.ready'])
    // Tarama işi gelse de (tarayıcı sonradan açıldı) taranmamış ses taranmaz.
    assert.deepEqual(await scanStoredFile(scanDeps(), job(t, id), at(MINUTE)), {
      outcome: 'skipped',
      reason: 'not_processing',
    })
  })

  test('OG-988 yeniden kuyruklama: taraması bitmemiş ses tarama kuyruğuna, yalnız dönüşüm bekleyen ses dönüşüm kuyruğuna girer', async () => {
    const t = await tenant()
    // a) iki iş de bekliyor; b) dönüşmüş, tarama bekliyor; c) tarama temiz, dönüşüm bekliyor;
    // d) tarayıcı kapalıyken yüklenmiş, dönüşüm bekliyor.
    const both = await upload(t)
    const scanOnly = await upload(t)
    await transcodeAudioFile(transcodeDeps(), job(t, scanOnly), FIXED_NOW)
    const transcodeOnly = await upload(t)
    await scanStoredFile(scanDeps(), job(t, transcodeOnly), FIXED_NOW)
    const offline = await upload(t, offApp)
    const ours = new Set([both, scanOnly, transcodeOnly, offline])

    const sent: { name: string; fileId: string }[] = []
    const boss = {
      send: async (name: string, data: { fileId: string }) => {
        if (ours.has(data.fileId)) sent.push({ name, fileId: data.fileId })
        return 'is-kimligi'
      },
    } as unknown as Parameters<typeof runScanRequeue>[0]['boss']
    await runScanRequeue({
      db,
      boss,
      log: app.log,
      clock: () => at(STALE_SCAN_MS + 1000),
      lock: async (work) => ({ acquired: true, value: await work() }),
    })
    assert.deepEqual(
      sent
        .filter((item) => item.name === 'file.scan')
        .map((item) => item.fileId)
        .sort(),
      [both, scanOnly].sort(),
    )
    sent.length = 0
    await requeueStaleTranscodes(db, boss, at(STALE_TRANSCODE_MS + 1000))
    assert.deepEqual(
      sent
        .filter((item) => item.name === 'media.transcode')
        .map((item) => item.fileId)
        .sort(),
      [both, transcodeOnly, offline].sort(),
    )
  })

  test('OG-988 kuyruksuz (JOBS_ENABLED kapalı): dönüşüm ve tarama süreç içinde çalışır; temiz ses ready, zararlı ses rejected ve nesnesiz', async () => {
    const t = await tenant()
    const transcodes = inlineApp.media.scheduler
    const scans = inlineApp.fileScan.scheduler
    assert.ok(transcodes instanceof InlineTranscodeScheduler)
    assert.ok(scans instanceof InlineScanScheduler)
    const idle = async () => {
      await transcodes.idle()
      await scans.idle()
    }

    const clean = await upload(t, inlineApp)
    await idle()
    const ready = await rowOf(t, clean)
    assert.equal(ready.status, 'ready')
    assert.equal(ready.scanPending, false)
    assert.equal(ready.supersededStorageKey, null)
    assert.deepEqual(await objectsOf(clean), [`${store.root}/${ready.storageKey}`])
    assert.equal(inlineScanner.scanned.at(-1)?.equals(MP3), true)

    const bad = await infected(inlineScanner, async () => {
      const id = await upload(t, inlineApp)
      await idle()
      return id
    })
    assert.equal((await rowOf(t, bad)).status, 'rejected')
    assert.deepEqual(await objectsOf(bad), [])
  })

  test('OG-988, OG-995: taraması süren ses 24 saatlik temizliğe girmez; ready olduktan 24 saat sonra silinir', async () => {
    const t = await tenant()
    const id = await upload(t)
    await transcodeAudioFile(transcodeDeps(), job(t, id), FIXED_NOW)
    const purge = (when: Date) =>
      purgeUnattachedFiles({
        db,
        storage: store.storage,
        institutionId: t.institution.id,
        now: when,
        log: app.log,
      })
    const scannedAt = at(30 * 60 * MINUTE)
    await purge(at(UNATTACHED_FILE_TTL_MS + MINUTE))
    assert.equal((await rowOf(t, id)).status, 'processing')
    assert.deepEqual(await scanStoredFile(scanDeps(), job(t, id), scannedAt), { outcome: 'ready' })
    await purge(new Date(scannedAt.getTime() + MINUTE))
    assert.equal((await rowOf(t, id)).status, 'ready')
    await purge(new Date(scannedAt.getTime() + UNATTACHED_FILE_TTL_MS + 1))
    assert.equal((await rowOf(t, id)).status, 'deleted')
    assert.deepEqual(await objectsOf(id), [])
  })

  test('migration 0044, OG-988: dönüşüm içeriği taraması süren seste bir kez yazar; ikinci içerik değişimi, izin boşaltılması ve taranmamış sesin ready yazımı reddedilir', async () => {
    const t = await tenant()
    const fileId = randomUUID()
    const storageKey = `${t.institution.id}/listening_audio/2026/10/${fileId}`
    await db.transaction((tx) =>
      insertFile(
        tx,
        t.institution.id,
        {
          id: fileId,
          purpose: 'listening_audio',
          storageKey,
          contentType: 'audio/mpeg',
          byteSize: 10,
          sha256: 'a'.repeat(64),
          originalName: null,
          uploadedByUserId: t.institution.admin.id,
        },
        now,
        'processing',
        { scanPending: true },
      ),
    )
    const update = (set: SQL) =>
      db.execute(
        sql`update files set ${set} where institution_id = ${t.institution.id} and id = ${fileId}`,
      )
    const codeOf = (error: unknown): unknown => {
      const cause: unknown = error instanceof Error ? error.cause : null
      return cause instanceof Error
        ? Reflect.get(cause, 'code')
        : Reflect.get(error as object, 'code')
    }
    const rejectedWith = (code: string) => (error: unknown) => codeOf(error) === code
    // Taraması bitmemiş ses ready olamaz (kısıt).
    await assert.rejects(update(sql`status = 'ready'`), rejectedWith('23514'))
    // processing kalırken özgün anahtar ize geçmeden içerik değişmez.
    await assert.rejects(update(sql`byte_size = 1`), rejectedWith('55000'))
    // Dönüşüm: içerik değişir, dosya processing kalır, özgün anahtar ize geçer.
    await update(
      sql`storage_key = ${`${storageKey}-m4a`}, content_type = 'audio/mp4', byte_size = 20, sha256 = ${'b'.repeat(64)}, superseded_storage_key = ${storageKey}`,
    )
    // İkinci içerik değişimi reddedilir.
    await assert.rejects(
      update(sql`storage_key = ${`${storageKey}-ikinci`}, sha256 = ${'c'.repeat(64)}`),
      rejectedWith('55000'),
    )
    // Tarama sürerken iz boşaltılamaz (tarama özgün nesneyi okur).
    await assert.rejects(update(sql`superseded_storage_key = null`), rejectedWith('55000'))
    // Tarama temiz: içerik değişmeden ready; iz ancak sonra boşalır.
    await update(sql`status = 'ready', scan_pending = false`)
    await update(sql`superseded_storage_key = null`)
    const [row] = await db.select().from(files).where(eq(files.id, fileId))
    assert.equal(row?.status, 'ready')
    assert.equal(row?.sha256, 'b'.repeat(64))
    assert.equal(row?.supersededStorageKey, null)
  })
})
