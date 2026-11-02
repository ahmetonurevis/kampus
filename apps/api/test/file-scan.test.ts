import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { files } from '../src/db/schema/files.ts'
import { bootJobs } from '../src/jobs/boot.ts'
import {
  InlineScanScheduler,
  SCANNED_PURPOSES,
  scanJobDataSchema,
  STALE_SCAN_MS,
} from '../src/jobs/file-scan.ts'
import type { ServiceContext } from '../src/plugins/authenticate.ts'
import { defineFileAttachment } from '../src/services/file-registry.ts'
import { scanStoredFile, type ScanDeps } from '../src/services/file-scan.ts'
import { attachFile } from '../src/services/files.ts'
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

  test('DOM-KYN-004, IST-027: zararlı dosya reddedilir, nesne silinir, file.reject yazılır; indirme ve okuma 404, bağlanamaz; log imza adını taşır, dosya adını taşımaz', async () => {
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
    assert.equal((await get(t, `/api/v1/files/${id}`)).statusCode, 404)
    assert.equal((await get(t, `/api/v1/files/${id}/url`)).statusCode, 404)
    await assert.rejects(attach(t, id), { code: 'file_unavailable' })
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
    for (const id of [clean, infected]) {
      const before = await rowOf(t, id)
      const auditsBefore = await auditsOf(t, id)
      // İkinci denemede tarayıcı zararlı dese de sonuç değişmez.
      scanner.result = 'infected'
      try {
        assert.deepEqual(await scanStoredFile(deps(), job(t, id), now), {
          outcome: 'skipped',
          reason: 'not_processing',
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

  test('iş yükü yalnız kimlik taşır: fazladan alan ve bozuk dosya kimliği reddedilir', () => {
    const fileId = '00000000-0000-4000-8000-000000000000'
    assert.ok(scanJobDataSchema.safeParse({ institutionId: 'kurum', fileId }).success)
    assert.ok(!scanJobDataSchema.safeParse({ institutionId: 'kurum', fileId: 'x' }).success)
    assert.ok(
      !scanJobDataSchema.safeParse({ institutionId: 'kurum', fileId, fileName: FILE_NAME }).success,
    )
  })
})
