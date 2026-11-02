import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { files } from '../src/db/schema/files.ts'
import { bootJobs } from '../src/jobs/boot.ts'
import type { Job } from 'pg-boss'

import {
  InlineScanScheduler,
  runScanRequeue,
  SCAN_QUEUE_OPTIONS,
  SCANNED_PURPOSES,
  scanJobDataSchema,
  STALE_SCAN_MS,
} from '../src/jobs/file-scan.ts'
import { runScanJob } from '../src/jobs/queue.ts'
import type { ServiceContext } from '../src/plugins/authenticate.ts'
import { defineFileAttachment } from '../src/services/file-registry.ts'
import { scanStoredFile, type ScanDeps } from '../src/services/file-scan.ts'
import {
  attachFile,
  PROCESSING_FILE_TTL_MS,
  purgeUnattachedFiles,
  UNATTACHED_FILE_TTL_MS,
} from '../src/services/files.ts'
import { planFiles } from '../src/services/resource-files.ts'
import { usableFiles } from '../src/services/task-submission-files.ts'
import type { StorageDriver } from '../src/storage/storage.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type TestUser,
} from './support/app.ts'
import { MP3, multipart, PDF, png, tempStorage, uploadParts } from './support/files-sample.ts'
import { RecordingScheduler } from './support/media-sample.ts'
import { FAKE_SIGNATURE, FakeFileScanner, RecordingScanScheduler } from './support/scan-sample.ts'

/**
 * Dosya taraması `file.scan` (OG-092, IST-027; ADR 0003 karar 8; DOM-KYN-004). Tarayıcı sahtedir;
 * `clamd` sürücüsünün protokol yolu `file-scanner.test.ts`'te, gerçek kuyruk `pg-jobs.test.ts`'te
 * sınanır. Varsayılan uygulama kuyruk açıkmış gibi işi yalnız kaydeder; kuyruksuz (süreç içi) ve
 * kapalı (`off`) yollar ayrı uygulamalarla sınanır.
 */

const FILE_NAME = 'Deniz-Yilmaz-gizli-odev.pdf'

/** Testin bağlı kayıt türü: taranmış dosyanın bağlanabildiğini gösterir. */
const TEST_ATTACHMENT = 'test_scan_record'
defineFileAttachment(TEST_ATTACHMENT, {
  purposes: ['submission', 'material'],
  canRead: async () => true,
})

describe('dosya taraması (file.scan)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let inlineApp: App
  let offApp: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  let now = FIXED_NOW
  const logs: string[] = []
  const scanner = new FakeFileScanner()
  const scanScheduler = new RecordingScanScheduler()
  const transcodeScheduler = new RecordingScheduler()
  const inlineScanner = new FakeFileScanner()
  let serial = 0

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    store = await tempStorage()
    app = await buildTestApp(db, {
      storage: store.storage,
      clock: () => now,
      logs,
      media: { scheduler: transcodeScheduler },
      fileScan: { scanner, scheduler: scanScheduler },
    })
    // Kuyruk kapalı: tarama yanıttan sonra süreç içinde, arka planda, tek denemeyle.
    inlineApp = await buildTestApp(db, {
      storage: store.storage,
      clock: () => now,
      logs,
      fileScan: { scanner: inlineScanner },
    })
    // Tarayıcı kapalı (`FILE_SCANNER=off`, testin varsayılanı).
    offApp = await buildTestApp(db, { storage: store.storage, clock: () => now })
  })
  after(async () => {
    await app.close()
    await inlineApp.close()
    await offApp.close()
    await close()
    await store.remove()
  })

  const deps = (extra: Partial<ScanDeps> = {}): ScanDeps => ({
    db,
    storage: store.storage,
    scanner,
    log: app.log,
    ...extra,
  })

  async function tenant() {
    const institution = await createInstitution(app)
    const student = await createMember(app, institution.id, 'ogrenci')
    return {
      institution,
      admin: { ...institution.admin, cookie: await signInAs(app, institution.admin) },
      student: { ...student, cookie: await signInAs(app, student) },
    }
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  async function upload(
    t: Tenant,
    options: {
      target?: App
      parts?: ReturnType<typeof uploadParts>
      key?: string
      cookie?: string
    } = {},
  ) {
    const body = multipart(options.parts ?? uploadParts('submission', PDF, FILE_NAME))
    const response = await (options.target ?? app).inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: {
        origin: TEST_ORIGIN,
        cookie: options.cookie ?? t.student.cookie,
        'content-type': body.contentType,
        'idempotency-key': options.key ?? `test-scan-${String(++serial).padStart(6, '0')}`,
      },
      payload: body.payload,
    })
    assert.equal(response.statusCode, 201, response.body)
    return response
  }
  const uploaded = async (t: Tenant, target: App = app) =>
    (await upload(t, { target })).json().data.id as string

  async function rowOf(t: Tenant, id: string) {
    const [row] = await db
      .select()
      .from(files)
      .where(and(eq(files.institutionId, t.institution.id), eq(files.id, id)))
    assert.ok(row)
    return row
  }
  const auditsOf = (t: Tenant, id: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.institution.id), eq(auditLog.entityId, id)))
  const get = (t: Tenant, url: string, cookie = t.student.cookie) =>
    app.inject({ method: 'GET', url, headers: { origin: TEST_ORIGIN, cookie } })
  const job = (t: Tenant, id: string) => ({ institutionId: t.institution.id, fileId: id })
  const objectsOf = async (id: string) => (await store.files()).filter((path) => path.includes(id))

  function contextFor(t: Tenant, user: TestUser & { membershipId: string }, role: Role) {
    return {
      db,
      institutionId: t.institution.id,
      actor: { userId: user.id, role, membershipId: user.membershipId },
      now,
      log: app.log,
    } satisfies ServiceContext
  }
  const attach = (t: Tenant, fileId: string) =>
    db.transaction((tx) =>
      attachFile(tx, contextFor(t, t.student, 'ogrenci'), {
        fileId,
        attachedType: TEST_ATTACHMENT,
        attachedId: `kayit-${fileId}`,
        dataSubjectId: t.student.id,
      }),
    )
  const inlineScheduler = () => {
    const scheduler = inlineApp.fileScan.scheduler
    assert.ok(scheduler instanceof InlineScanScheduler)
    return scheduler
  }

  test('ADR 0003 karar 8, IST-027: tarayıcı açıkken ses dışı yükleme processing başlar ve file.scan işi aynı işlemde kuyruğa girer; aynı anahtar ikinci iş açmaz; taranmamış dosya bağlantı almaz ve bağlanamaz', async () => {
    const t = await tenant()
    const first = await upload(t, { key: 'test-scan-replay-0001' })
    const id = first.json().data.id as string
    assert.equal(first.json().data.status, 'processing')
    const replay = await upload(t, { key: 'test-scan-replay-0001' })
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(
      scanScheduler.queued.filter((item) => item.fileId === id),
      [job(t, id)],
    )
    // Ses dışı dosya dönüşüm kuyruğuna girmez.
    assert.equal(transcodeScheduler.queued.filter((item) => item.fileId === id).length, 0)
    const url = await get(t, `/api/v1/files/${id}/url`)
    assert.equal(url.statusCode, 409)
    assert.equal(url.json().code, 'file_processing')
    await assert.rejects(attach(t, id), { code: 'file_not_ready' })
    const row = await rowOf(t, id)
    assert.equal(row.status, 'processing')
    assert.equal(row.attachedId, null)
  })

  test('DOM-KYN-004, IST-027: temiz dosya ready olur, file.ready denetimi yazılır, dosya bağlanabilir ve bağlantı alır', async () => {
    const t = await tenant()
    const id = await uploaded(t)
    const before = await rowOf(t, id)
    now = new Date(FIXED_NOW.getTime() + 60_000)
    try {
      assert.deepEqual(await scanStoredFile(deps(), job(t, id), now), { outcome: 'ready' })
    } finally {
      now = FIXED_NOW
    }
    // Tarayıcı nesnenin kendisini akışla okudu.
    assert.deepEqual(scanner.scanned.at(-1), PDF)
    const row = await rowOf(t, id)
    assert.equal(row.status, 'ready')
    // İçerik değişmez; yalnız durum.
    assert.equal(row.storageKey, before.storageKey)
    assert.equal(row.sha256, before.sha256)
    assert.equal(row.createdAt.toISOString(), before.createdAt.toISOString())
    const audits = await auditsOf(t, id)
    assert.deepEqual(
      audits.map((item) => [item.action, item.actorUserId]),
      [
        ['file.upload', t.student.id],
        ['file.ready', null],
      ],
    )
    assert.deepEqual(audits[1]?.changes?.fields, ['status'])
    assert.equal((await get(t, `/api/v1/files/${id}/url`)).statusCode, 200)
    const attached = await attach(t, id)
    assert.equal(attached.attachedId, `kayit-${id}`)
    assert.ok(logs.join('').includes('"event":"file.scanned"'))
  })

  test('DOM-KYN-004, IST-027: zararlı dosya reddedilir, nesne silinir, file.reject yazılır; indirme 404, yükleyen okuma ve bağlamada 422 file_rejected, başkası 404 (Sabah kararı 42); log imza adını taşır, dosya adını taşımaz', async () => {
    const t = await tenant()
    const id = await uploaded(t)
    const before = await rowOf(t, id)
    // İndirme belirteci tarama sürerken üretilmiş olsa da reddedilen dosya indirilmez.
    const signed = new URL(
      await store.storage.signedGetUrl(before.storageKey, {
        institutionId: t.institution.id,
        fileId: id,
        expiresAt: new Date(FIXED_NOW.getTime() + 5 * 60_000),
        disposition: 'attachment',
      }),
    )
    assert.equal((await objectsOf(id)).length, 1)
    scanner.result = 'infected'
    const mark = logs.length
    try {
      assert.deepEqual(await scanStoredFile(deps(), job(t, id), now), {
        outcome: 'rejected',
        code: 'malware_found',
      })
    } finally {
      scanner.result = 'clean'
    }
    const row = await rowOf(t, id)
    assert.equal(row.status, 'rejected')
    assert.equal(await store.storage.head(before.storageKey), null)
    assert.deepEqual(await objectsOf(id), [])
    assert.deepEqual(
      (await auditsOf(t, id)).map((item) => item.action),
      ['file.upload', 'file.reject'],
    )
    const download = await app.inject({ method: 'GET', url: signed.pathname + signed.search })
    assert.equal(download.statusCode, 404)
    // Sabah kararı 42: yükleyen ayrı kod alır; başkası (aynı kurumun yöneticisi) yine 404.
    for (const url of [`/api/v1/files/${id}`, `/api/v1/files/${id}/url`]) {
      const own = await get(t, url)
      assert.equal(own.statusCode, 422, own.body)
      assert.equal(own.json().code, 'file_rejected')
      assert.equal(
        own.json().message,
        'Dosya güvenlik taramasından geçmedi. Başka bir dosya yükleyin.',
      )
      assert.equal((await get(t, url, t.admin.cookie)).statusCode, 404)
    }
    await assert.rejects(attach(t, id), { code: 'file_rejected', statusCode: 422 })
    const written = logs.slice(mark).join('')
    assert.ok(written.includes('"event":"file.scan_rejected"'))
    assert.ok(written.includes(`"signature":"${FAKE_SIGNATURE}"`))
    assert.ok(written.includes(`"fileId":"${id}"`))
    assert.ok(!logs.join('').includes('Deniz-Yilmaz'))
  })

  test('ADR 0003 karar 8: tarayıcıya ulaşılamazsa hata fırlar, dosya processing kalır; satır, denetim ve nesne değişmez (taramasız ready olmaz)', async () => {
    const t = await tenant()
    const id = await uploaded(t)
    const before = await rowOf(t, id)
    const auditsBefore = await auditsOf(t, id)
    scanner.result = 'unavailable'
    try {
      await assert.rejects(scanStoredFile(deps(), job(t, id), now), {
        name: 'ScannerUnavailableError',
        code: 'scanner_unavailable',
      })
    } finally {
      scanner.result = 'clean'
    }
    assert.deepEqual(await rowOf(t, id), before)
    assert.deepEqual(await auditsOf(t, id), auditsBefore)
    assert.equal((await store.storage.head(before.storageKey))?.byteSize, before.byteSize)
    await assert.rejects(attach(t, id), { code: 'file_not_ready' })
  })

  test('IST-027: iş idempotenttir; yeniden koşunca ready ya da rejected dosya yeniden taranmaz, kayıt değişmez', async () => {
    const t = await tenant()
    const clean = await uploaded(t)
    await scanStoredFile(deps(), job(t, clean), now)
    const infected = await uploaded(t)
    scanner.result = 'infected'
    try {
      await scanStoredFile(deps(), job(t, infected), now)
    } finally {
      scanner.result = 'clean'
    }
    const scans = scanner.scanned.length
    for (const [id, reason] of [
      [clean, 'not_processing'],
      [infected, 'already_rejected'],
    ] as const) {
      const before = await rowOf(t, id)
      const auditsBefore = await auditsOf(t, id)
      // İkinci denemede tarayıcı zararlı dese de sonuç değişmez.
      scanner.result = 'infected'
      try {
        assert.deepEqual(await scanStoredFile(deps(), job(t, id), now), {
          outcome: 'skipped',
          reason,
        })
      } finally {
        scanner.result = 'clean'
      }
      assert.deepEqual(await rowOf(t, id), before)
      assert.deepEqual(await auditsOf(t, id), auditsBefore)
    }
    assert.equal(scanner.scanned.length, scans)
    assert.deepEqual(
      await scanStoredFile(deps(), job(t, '00000000-0000-4000-8000-000000000000'), now),
      { outcome: 'skipped', reason: 'missing' },
    )
  })

  test('ADR 0003 karar 8: nesnesi depoda olmayan dosya taranamaz ve reddedilir', async () => {
    const t = await tenant()
    const id = await uploaded(t)
    await store.storage.delete((await rowOf(t, id)).storageKey)
    assert.deepEqual(await scanStoredFile(deps(), job(t, id), now), {
      outcome: 'rejected',
      code: 'scan_object_missing',
    })
    assert.equal((await rowOf(t, id)).status, 'rejected')
  })

  test('ADR 0003 karar 8, 10: ses amaçları değişmedi; dönüşüm kuyruğuna girer, tarama işi açılmaz ve tarama ses dosyasını atlar', async () => {
    const t = await tenant()
    const response = await upload(t, {
      parts: uploadParts('listening_audio', MP3, 'dinleme.mp3', 'audio/mpeg'),
      cookie: t.admin.cookie,
    })
    const id = response.json().data.id as string
    assert.equal(response.json().data.status, 'processing')
    assert.deepEqual(
      transcodeScheduler.queued.filter((item) => item.fileId === id),
      [job(t, id)],
    )
    assert.equal(scanScheduler.queued.filter((item) => item.fileId === id).length, 0)
    const before = await rowOf(t, id)
    assert.deepEqual(await scanStoredFile(deps(), job(t, id), now), {
      outcome: 'skipped',
      reason: 'not_scanned',
    })
    assert.deepEqual(await rowOf(t, id), before)
    assert.ok(!SCANNED_PURPOSES.includes('listening_audio'))
    assert.ok(!SCANNED_PURPOSES.includes('speaking_recording'))
    assert.ok(SCANNED_PURPOSES.includes('submission'))
  })

  test('FILE_SCANNER=off: bugünkü davranış; yükleme pending kalır, tarama işi açılmaz', async () => {
    const t = await tenant()
    assert.equal(offApp.fileScan.scanner, null)
    assert.equal(offApp.fileScan.scheduler, null)
    const queued = scanScheduler.queued.length
    const response = await upload(t, {
      target: offApp,
      parts: uploadParts('material', png(), 'gorsel.png', 'image/png'),
      cookie: t.admin.cookie,
    })
    assert.equal(response.json().data.status, 'pending')
    assert.equal(scanScheduler.queued.length, queued)
    assert.equal((await rowOf(t, response.json().data.id as string)).status, 'pending')
  })

  test('kuyruksuz: tarama yanıttan sonra süreç içinde çalışır; temiz ready, zararlı rejected, erişilemezse processing kalır', async () => {
    const t = await tenant()
    const clean = await uploaded(t, inlineApp)
    await inlineScheduler().idle()
    assert.equal((await rowOf(t, clean)).status, 'ready')

    inlineScanner.result = 'infected'
    try {
      const infected = await uploaded(t, inlineApp)
      await inlineScheduler().idle()
      assert.equal((await rowOf(t, infected)).status, 'rejected')
      assert.deepEqual(await objectsOf(infected), [])
    } finally {
      inlineScanner.result = 'clean'
    }

    inlineScanner.result = 'unavailable'
    try {
      const deferred = await uploaded(t, inlineApp)
      await inlineScheduler().idle()
      assert.equal((await rowOf(t, deferred)).status, 'processing')
      assert.ok(logs.join('').includes('"event":"file.scan_deferred"'))
    } finally {
      inlineScanner.result = 'clean'
    }
  })

  test('kuyruksuz açılış: 15 dakikadır processing kalan tarama kilit altında yeniden denenir; taze dosyaya ve kilit başkasındayken dokunulmaz', async () => {
    const t = await tenant()
    inlineScanner.result = 'unavailable'
    let stale: string
    try {
      stale = await uploaded(t, inlineApp)
      await inlineScheduler().idle()
    } finally {
      inlineScanner.result = 'clean'
    }
    assert.equal((await rowOf(t, stale)).status, 'processing')
    const boot = (lock: Parameters<typeof bootJobs>[0]['scanRecoveryLock']) =>
      bootJobs({
        app: inlineApp,
        db,
        log: inlineApp.log,
        enabled: false,
        connectionString: '',
        storage: store.storage,
        recoveryLock: async (work) => ({ acquired: true, value: await work() }),
        ...(lock ? { scanRecoveryLock: lock } : {}),
      })
    now = new Date(FIXED_NOW.getTime() + STALE_SCAN_MS + 1000)
    try {
      // Kilit başka süreçteyse atlanır.
      await boot(async () => ({ acquired: false }))
      await inlineScheduler().idle()
      assert.equal((await rowOf(t, stale)).status, 'processing')
      assert.ok(logs.join('').includes('"event":"file.scan_recovery_skipped"'))

      inlineScanner.result = 'unavailable'
      let fresh: string
      try {
        fresh = await uploaded(t, inlineApp)
        await inlineScheduler().idle()
      } finally {
        inlineScanner.result = 'clean'
      }
      let locks = 0
      assert.equal(
        await boot(async (work) => {
          locks += 1
          return { acquired: true, value: await work() }
        }),
        null,
      )
      await inlineScheduler().idle()
      assert.equal(locks, 1)
      assert.equal((await rowOf(t, stale)).status, 'ready')
      assert.equal((await rowOf(t, fresh)).status, 'processing')
      assert.ok(logs.join('').includes('"event":"file.scan_recovered"'))
    } finally {
      now = FIXED_NOW
    }
  })

  test('ADR 0003 karar 8: ret yazılıp nesne silinemezse yeniden denemede yalnız silme tekrar çalışır; tarama ve denetim yinelenmez', async () => {
    const t = await tenant()
    const id = await uploaded(t)
    const key = (await rowOf(t, id)).storageKey
    let failures = 1
    const remove = async (target: string) => {
      if (failures > 0) {
        failures -= 1
        throw new Error('depo geçici olarak erişilemez')
      }
      return store.storage.delete(target)
    }
    // Sürücünün özel alanları korunur: yalnız `delete` değişir, öteki yöntemler sürücüye bağlıdır.
    const flaky = new Proxy(store.storage, {
      get(target, property) {
        if (property === 'delete') return remove
        const value: unknown = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) satisfies StorageDriver
    scanner.result = 'infected'
    try {
      await assert.rejects(scanStoredFile(deps({ storage: flaky }), job(t, id), now), {
        message: 'depo geçici olarak erişilemez',
      })
      assert.equal((await rowOf(t, id)).status, 'rejected')
      assert.notEqual(await store.storage.head(key), null)
      const scans = scanner.scanned.length
      assert.deepEqual(await scanStoredFile(deps({ storage: flaky }), job(t, id), now), {
        outcome: 'skipped',
        reason: 'already_rejected',
      })
      assert.equal(scanner.scanned.length, scans)
    } finally {
      scanner.result = 'clean'
    }
    assert.equal(await store.storage.head(key), null)
    assert.deepEqual(
      (await auditsOf(t, id)).map((item) => item.action),
      ['file.upload', 'file.reject'],
    )
  })

  test('Sabah kararı 43: tarama sınırını aşan içerik taramasız ready olmaz; reddedilir ve nesnesi silinir', async () => {
    const t = await tenant()
    const id = await uploaded(t)
    const key = (await rowOf(t, id)).storageKey
    scanner.result = 'limit'
    try {
      assert.deepEqual(await scanStoredFile(deps(), job(t, id), now), {
        outcome: 'rejected',
        code: 'scan_limit_exceeded',
      })
    } finally {
      scanner.result = 'clean'
    }
    assert.equal((await rowOf(t, id)).status, 'rejected')
    assert.equal(await store.storage.head(key), null)
  })

  test('ADR 0003 karar 8: son deneme de tarayıcıya ulaşamazsa iş failed olur, dosya processing kalır ve nesnesi silinmez', async () => {
    const t = await tenant()
    const id = await uploaded(t)
    const before = await rowOf(t, id)
    const mark = logs.length
    scanner.result = 'unavailable'
    try {
      const scanJob = {
        id: 'test-scan-job',
        name: 'file.scan',
        data: job(t, id),
        retryCount: SCAN_QUEUE_OPTIONS.retryLimit,
        signal: new AbortController().signal,
      } as unknown as Job<unknown>
      const result = await runScanJob(
        app,
        { db, storage: store.storage, scanner, log: app.log },
        scanJob,
      )
      assert.equal(result.status, 'failed')
    } finally {
      scanner.result = 'clean'
    }
    assert.deepEqual(await rowOf(t, id), before)
    assert.notEqual(await store.storage.head(before.storageKey), null)
    assert.ok(logs.slice(mark).join('').includes('"event":"file.scan_retries_exhausted"'))
  })

  test('periyodik yeniden kuyruklama: denemeleri biten bayat tarama kilit altında yeniden kuyruğa girer; kilit başkasındaysa tur atlanır', async () => {
    const t = await tenant()
    const id = await uploaded(t)
    const sent: { name: string; data: object }[] = []
    const boss = {
      send: async (name: string, data: object) => {
        sent.push({ name, data })
        return 'is-kimligi'
      },
    } as unknown as Parameters<typeof runScanRequeue>[0]['boss']
    const later = () => new Date(FIXED_NOW.getTime() + STALE_SCAN_MS + 1000)
    assert.equal(
      await runScanRequeue({
        db,
        boss,
        log: app.log,
        clock: later,
        lock: async () => ({ acquired: false }),
      }),
      null,
    )
    assert.equal(sent.length, 0)
    const queued = await runScanRequeue({
      db,
      boss,
      log: app.log,
      clock: later,
      lock: async (work) => ({ acquired: true, value: await work() }),
    })
    assert.ok((queued ?? 0) >= 1)
    assert.ok(
      sent.some(
        (item) => item.name === 'file.scan' && 'fileId' in item.data && item.data.fileId === id,
      ),
    )
    // Taze dosya (15 dakikadan yeni) kuyruğa alınmaz.
    sent.length = 0
    await runScanRequeue({
      db,
      boss,
      log: app.log,
      clock: () => FIXED_NOW,
      lock: async (work) => ({ acquired: true, value: await work() }),
    })
    assert.ok(!sent.some((item) => 'fileId' in item.data && item.data.fileId === id))
  })

  test('bağsız dosya temizliği: tarama bekleyen dosya 24 saatte silinmez, 7 gün sonra silinir; hazır dosya 24 saatte silinir', async () => {
    const t = await tenant()
    const waiting = await uploaded(t)
    const clean = await uploaded(t)
    await scanStoredFile(deps(), job(t, clean), now)
    const purge = (offset: number) =>
      purgeUnattachedFiles({
        db,
        storage: store.storage,
        institutionId: t.institution.id,
        now: new Date(FIXED_NOW.getTime() + offset),
        log: app.log,
      })
    await purge(UNATTACHED_FILE_TTL_MS + 60_000)
    assert.equal((await rowOf(t, waiting)).status, 'processing')
    assert.equal((await rowOf(t, clean)).status, 'deleted')
    await purge(PROCESSING_FILE_TTL_MS + 60_000)
    assert.equal((await rowOf(t, waiting)).status, 'deleted')
    assert.deepEqual(await objectsOf(waiting), [])
  })

  test('OG-995, ADR 0003 karar 5: yüklemeden 30 saat sonra taranan bağsız dosyanın 24 saati taramadan sayılır', async () => {
    const t = await tenant()
    const HOUR = 3600_000
    // T anında yüklenir; clamd kesintisi yüzünden T+30 saatte temiz bulunur.
    const late = await uploaded(t)
    // Aynı anda yüklenip hemen taranan dosya eskisi gibi yüklemeden 24 saat sonra silinir.
    const onTime = await uploaded(t)
    await scanStoredFile(deps(), job(t, onTime), FIXED_NOW)
    const scannedAt = new Date(FIXED_NOW.getTime() + 30 * HOUR)
    assert.deepEqual(await scanStoredFile(deps(), job(t, late), scannedAt), { outcome: 'ready' })
    const ready = await rowOf(t, late)
    assert.equal(ready.readyAt?.toISOString(), scannedAt.toISOString())
    const purge = (at: number) =>
      purgeUnattachedFiles({
        db,
        storage: store.storage,
        institutionId: t.institution.id,
        now: new Date(at),
        log: app.log,
      })
    // T+31 saat: bir sonraki saatlik temizlik geç taranan dosyayı silmez.
    await purge(FIXED_NOW.getTime() + 31 * HOUR)
    assert.equal((await rowOf(t, late)).status, 'ready')
    assert.equal((await store.storage.head(ready.storageKey))?.byteSize, ready.byteSize)
    assert.equal((await rowOf(t, onTime)).status, 'deleted')
    // Tam 24 saat dolduğunda silinmez; ε sonra silinir.
    await purge(scannedAt.getTime() + UNATTACHED_FILE_TTL_MS)
    assert.equal((await rowOf(t, late)).status, 'ready')
    await purge(scannedAt.getTime() + UNATTACHED_FILE_TTL_MS + 1)
    const purged = await rowOf(t, late)
    assert.equal(purged.status, 'deleted')
    assert.equal(await store.storage.head(ready.storageKey), null)
  })

  test('OG-995: taramasız (pending) dosyada ready anı yazılmaz, süre yüklemeden sayılır', async () => {
    const t = await tenant()
    const id = (
      await upload(t, {
        target: offApp,
        parts: uploadParts('material', png(), 'gorsel.png', 'image/png'),
        cookie: t.admin.cookie,
      })
    ).json().data.id as string
    assert.equal((await rowOf(t, id)).readyAt, null)
    await purgeUnattachedFiles({
      db,
      storage: store.storage,
      institutionId: t.institution.id,
      now: new Date(FIXED_NOW.getTime() + UNATTACHED_FILE_TTL_MS + 1),
      log: app.log,
    })
    assert.equal((await rowOf(t, id)).status, 'deleted')
  })

  test('Sabah kararı 42: teslim, soru ve kaynak sürümü yollarında yükleyenin reddedilen dosyası 422 file_rejected (alan yolu), başkasınınki ayırt edilmez', async () => {
    const t = await tenant()
    const id = await uploaded(t)
    scanner.result = 'infected'
    try {
      await scanStoredFile(deps(), job(t, id), now)
    } finally {
      scanner.result = 'clean'
    }
    const own = contextFor(t, t.student, 'ogrenci')
    const other = await createMember(app, t.institution.id, 'ogrenci')
    await db.transaction(async (tx) => {
      await assert.rejects(usableFiles(tx, own, [id]), (error: unknown) => {
        assert.ok(error instanceof Error && 'code' in error && error.code === 'file_rejected')
        assert.deepEqual((error as unknown as { issues: { path: unknown[] }[] }).issues[0]?.path, [
          'fileIds',
          0,
        ])
        return true
      })
      // Başkasının reddedilen dosyası listede yoktur (core genel 404'e çevirir).
      assert.deepEqual(await usableFiles(tx, contextFor(t, other, 'ogrenci'), [id]), [])
    })
    const row = await rowOf(t, id)
    const fileRow = {
      id,
      purpose: row.purpose,
      status: row.status,
      uploadedByUserId: row.uploadedByUserId,
      attached: false,
      contentType: row.contentType,
      byteSize: row.byteSize,
      durationSeconds: null,
    }
    const content = { type: 'text', body: 'metin' } as unknown as Parameters<
      typeof planFiles
    >[1]['content']
    assert.throws(() => planFiles(own, { content, fileIds: [id], files: [fileRow], kept: [] }), {
      code: 'file_rejected',
    })
    assert.throws(
      () =>
        planFiles(contextFor(t, other, 'ogrenci'), {
          content,
          fileIds: [id],
          files: [fileRow],
          kept: [],
        }),
      (error: unknown) =>
        error instanceof Error && 'code' in error && error.code !== 'file_rejected',
    )
  })

  test('iş yükü yalnız kimlik taşır: fazladan alan ve bozuk dosya kimliği reddedilir', () => {
    const fileId = '00000000-0000-4000-8000-000000000000'
    assert.ok(scanJobDataSchema.safeParse({ institutionId: 'kurum', fileId }).success)
    assert.ok(!scanJobDataSchema.safeParse({ institutionId: 'kurum', fileId: 'x' }).success)
    assert.ok(
      !scanJobDataSchema.safeParse({ institutionId: 'kurum', fileId, fileName: FILE_NAME }).success,
    )
  })
})
