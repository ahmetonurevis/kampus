import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertFile, scheduleSubjectFilesPurge } from '../src/db/files.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { files } from '../src/db/schema/files.ts'
import { bootJobs } from '../src/jobs/boot.ts'
import { filesPurgeExpiredJob } from '../src/jobs/files-purge-expired.ts'
import { filesPurgeJob } from '../src/jobs/files-purge.ts'
import {
  InlineTranscodeScheduler,
  STALE_TRANSCODE_MS,
  transactionConnection,
  transcodeJobDataSchema,
} from '../src/jobs/media-transcode.ts'
import {
  AUDIO_TRANSCODE_PROFILES,
  MediaContentError,
  MediaToolError,
  TRANSCODED_CONTENT_TYPE,
} from '../src/services/audio-transcoder.ts'
import { transcodeAudioFile, type TranscodeDeps } from '../src/services/media-transcode.ts'
import { STORAGE_KEY_PATTERN } from '../src/storage/storage.ts'
import {
  buildTestApp,
  createInstitution,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { MP3, multipart, PDF, tempStorage, uploadParts } from './support/files-sample.ts'
import { FakeTranscoder, RecordingScheduler } from './support/media-sample.ts'

/**
 * Ses dönüştürme (OG-262; ADR 0003 karar 10; DOM-BEC-054). Dönüştürücü sahtedir; gerçek ffmpeg
 * `media-ffmpeg.test.ts`'te, gerçek kuyruk `pg-jobs.test.ts`'tedir. Varsayılan test uygulaması
 * kuyruk açıkmış gibi işi yalnız kaydeder; kuyruksuz (süreç içi) yol ayrı uygulamayla sınanır.
 */

const FILE_NAME = 'Ayse-dinleme-gizli.mp3'

describe('ses dönüştürme (media.transcode)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let inlineApp: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  let now = FIXED_NOW
  const logs: string[] = []
  const transcoder = new FakeTranscoder()
  const scheduler = new RecordingScheduler()
  const inlineTranscoder = new FakeTranscoder()
  let serial = 0

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    store = await tempStorage()
    app = await buildTestApp(db, {
      storage: store.storage,
      clock: () => now,
      logs,
      media: { transcoder, scheduler },
    })
    // Kuyruk kapalı: dönüşüm yanıttan sonra süreç içinde, arka planda, tek denemeyle.
    inlineApp = await buildTestApp(db, {
      storage: store.storage,
      clock: () => now,
      logs,
      media: { transcoder: inlineTranscoder },
    })
  })
  after(async () => {
    await app.close()
    await inlineApp.close()
    await close()
    await store.remove()
  })

  const deps = (extra: Partial<TranscodeDeps> = {}): TranscodeDeps => ({
    db,
    storage: store.storage,
    transcoder,
    log: app.log,
    ...extra,
  })

  async function tenant() {
    const institution = await createInstitution(app)
    return { institution, cookie: await signInAs(app, institution.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  async function upload(
    t: Tenant,
    target: App = app,
    key = `test-media-${String(++serial).padStart(6, '0')}`,
  ) {
    const body = multipart(uploadParts('listening_audio', MP3, FILE_NAME, 'audio/mpeg'))
    const response = await target.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: {
        origin: TEST_ORIGIN,
        cookie: t.cookie,
        'content-type': body.contentType,
        'idempotency-key': key,
      },
      payload: body.payload,
    })
    assert.equal(response.statusCode, 201, response.body)
    return response
  }
  const uploaded = async (t: Tenant) => (await upload(t)).json().data.id as string

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
  const url = (t: Tenant, id: string) =>
    app.inject({
      method: 'GET',
      url: `/api/v1/files/${id}/url`,
      headers: { origin: TEST_ORIGIN, cookie: t.cookie },
    })
  /** Dosyanın depodaki nesneleri (özgün ve dönüşmüş anahtarlar dosya kimliğiyle başlar). */
  const objectsOf = async (id: string) => (await store.files()).filter((path) => path.includes(id))
  const job = (t: Tenant, id: string) => ({ institutionId: t.institution.id, fileId: id })

  test('ADR 0003 karar 10: ses yüklemesi processing başlar ve iş aynı işlemde kuyruğa girer; aynı anahtar ikinci iş açmaz; processing dosyanın bağlantısı 409', async () => {
    const t = await tenant()
    const first = await upload(t, app, 'test-media-replay-0001')
    const id = first.json().data.id as string
    assert.equal(first.json().data.status, 'processing')
    assert.equal(first.json().data.durationMs, null)
    const replay = await upload(t, app, 'test-media-replay-0001')
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(
      scheduler.queued.filter((item) => item.fileId === id),
      [job(t, id)],
    )
    const response = await url(t, id)
    assert.equal(response.statusCode, 409)
    assert.equal(response.json().code, 'file_processing')
    assert.equal((await rowOf(t, id)).status, 'processing')
  })

  test('OG-262, DOM-BEC-054: iş süreyi yazar, türü audio/mp4 yapar, dönüşmüş nesneyi saklar ve özgün nesneyi siler; teslim zamanı yükleme zamanı kalır; denetime file.ready düşer', async () => {
    const t = await tenant()
    const id = await uploaded(t)
    const before = await rowOf(t, id)
    transcoder.result = { durationMs: 42_500, silent: false }
    now = new Date(FIXED_NOW.getTime() + 60_000)
    try {
      const result = await transcodeAudioFile(deps(), job(t, id), now)
      assert.deepEqual(result, { outcome: 'ready', durationMs: 42_500 })
    } finally {
      now = FIXED_NOW
    }
    const call = transcoder.calls.at(-1)
    assert.equal(call?.contentType, 'audio/mpeg')
    assert.equal(call?.bitrateKbps, AUDIO_TRANSCODE_PROFILES.listening_audio.bitrateKbps)
    // Çıktı amaç sınırı + 1 sn'de kesilir (dinleme sesi 15 dk).
    assert.equal(call?.maxOutputSeconds, 15 * 60 + 1)
    const row = await rowOf(t, id)
    assert.equal(row.status, 'ready')
    assert.equal(row.durationMs, 42_500)
    assert.equal(row.contentType, TRANSCODED_CONTENT_TYPE)
    assert.equal(row.createdAt.toISOString(), before.createdAt.toISOString())
    assert.notEqual(row.storageKey, before.storageKey)
    assert.match(row.storageKey, STORAGE_KEY_PATTERN)
    // Özgün nesne silindi, izi de kalmadı.
    assert.equal(row.supersededStorageKey, null)
    assert.equal(await store.storage.head(before.storageKey), null)
    assert.equal((await store.storage.head(row.storageKey))?.byteSize, row.byteSize)
    assert.deepEqual(await objectsOf(id), [`${store.root}/${row.storageKey}`])
    const audits = await auditsOf(t, id)
    assert.deepEqual(
      audits.map((item) => [item.action, item.actorUserId]),
      [
        ['file.upload', t.institution.admin.id],
        ['file.ready', null],
      ],
    )
    assert.deepEqual(audits[1]?.changes?.fields, [
      'status',
      'storageKey',
      'contentType',
      'byteSize',
      'sha256',
      'durationMs',
    ])
    const response = await url(t, id)
    assert.equal(response.statusCode, 200, response.body)
    const log = logs.join('')
    assert.ok(log.includes('"event":"media.transcoded"'))
    assert.equal(log.includes(FILE_NAME), false)
    transcoder.result = { durationMs: 30_000, silent: false }
  })

  test('OG-262: sessiz, boş, çözülemeyen ve sınırı aşan kayıt rejected olur; nesne silinir, bağlantı 404, denetime file.reject düşer', async () => {
    const t = await tenant()
    const cases = [
      [{ durationMs: 5_000, silent: true }, 'media_silent'],
      [{ durationMs: 0, silent: false }, 'media_empty'],
      [new MediaContentError('media_undecodable'), 'media_undecodable'],
      [new MediaContentError('media_no_audio'), 'media_no_audio'],
      [{ durationMs: 15 * 60_000 + 1, silent: false }, 'media_too_long'],
    ] as const
    for (const [result, code] of cases) {
      const id = await uploaded(t)
      transcoder.result = result instanceof Error ? result : { ...result }
      assert.deepEqual(await transcodeAudioFile(deps(), job(t, id), now), {
        outcome: 'rejected',
        code,
      })
      const row = await rowOf(t, id)
      assert.equal(row.status, 'rejected', code)
      assert.equal(row.durationMs, null)
      assert.deepEqual(await objectsOf(id), [], code)
      assert.equal((await url(t, id)).statusCode, 404)
      assert.deepEqual(
        (await auditsOf(t, id)).map((item) => item.action),
        ['file.upload', 'file.reject'],
      )
    }
    transcoder.result = { durationMs: 30_000, silent: false }
    assert.equal(logs.join('').includes(FILE_NAME), false)
  })

  test('OG-262: geçici hata (araç yok, süre aşımı) fırlar ve dosya processing kalır, geçici nesne kalmaz; son denemede dosya reddedilir', async () => {
    const t = await tenant()
    const id = await uploaded(t)
    const original = (await rowOf(t, id)).storageKey
    transcoder.result = new MediaToolError('media_tool_unavailable')
    try {
      await assert.rejects(transcodeAudioFile(deps(), job(t, id), now), MediaToolError)
      assert.equal((await rowOf(t, id)).status, 'processing')
      assert.deepEqual(await objectsOf(id), [`${store.root}/${original}`])
      assert.deepEqual(await transcodeAudioFile(deps(), job(t, id), now, { finalAttempt: true }), {
        outcome: 'rejected',
        code: 'media_retries_exhausted',
      })
    } finally {
      transcoder.result = { durationMs: 30_000, silent: false }
    }
    assert.equal((await rowOf(t, id)).status, 'rejected')
    assert.deepEqual(await objectsOf(id), [])
    assert.ok(logs.join('').includes('"code":"media_tool_unavailable"'))
  })

  test('OG-262: iptal edilen iş (pg-boss job.signal) dönüştürmez; dosya processing kalır, nesne değişmez', async () => {
    const t = await tenant()
    const id = await uploaded(t)
    const calls = transcoder.calls.length
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      transcodeAudioFile(deps({ signal: controller.signal }), job(t, id), now),
      (error: Error) => error.name === 'AbortError',
    )
    assert.equal(transcoder.calls.length, calls)
    const row = await rowOf(t, id)
    assert.equal(row.status, 'processing')
    assert.deepEqual(await objectsOf(id), [`${store.root}/${row.storageKey}`])
  })

  test('OG-262: aynı iş iki kez gelirse etkisizdir; eşzamanlı iki teslimden biri yazar, ötekinin nesnesi silinir', async () => {
    const t = await tenant()
    const id = await uploaded(t)
    assert.equal((await transcodeAudioFile(deps(), job(t, id), now)).outcome, 'ready')
    const ready = await rowOf(t, id)
    assert.deepEqual(await transcodeAudioFile(deps(), job(t, id), now), {
      outcome: 'skipped',
      reason: 'already_ready',
    })
    const again = await rowOf(t, id)
    assert.equal(again.version, ready.version)
    assert.equal(again.storageKey, ready.storageKey)
    assert.equal((await auditsOf(t, id)).length, 2)

    const twin = await uploaded(t)
    const results = await Promise.all([
      transcodeAudioFile(deps(), job(t, twin), now),
      transcodeAudioFile(deps(), job(t, twin), now),
    ])
    assert.deepEqual(results.map((result) => result.outcome).sort(), ['ready', 'skipped'])
    const row = await rowOf(t, twin)
    assert.deepEqual(await objectsOf(twin), [`${store.root}/${row.storageKey}`])
    assert.deepEqual(
      (await auditsOf(t, twin)).map((item) => item.action),
      ['file.upload', 'file.ready'],
    )
  })

  test('OG-262, DOM-BEC-052: özgün nesne silinemezse dosya ready olur ve özgün anahtar izde kalır; tekrarlanan iş ve saatlik temizlik nesneyi siler, izi kaldırır', async () => {
    const t = await tenant()
    const id = await uploaded(t)
    const original = (await rowOf(t, id)).storageKey
    store.storage.failDeletes = true
    try {
      assert.equal((await transcodeAudioFile(deps(), job(t, id), now)).outcome, 'ready')
      // Silme yine başarısız: tekrarlanan iş izi korur.
      assert.deepEqual(await transcodeAudioFile(deps(), job(t, id), now), {
        outcome: 'skipped',
        reason: 'already_ready',
      })
    } finally {
      store.storage.failDeletes = false
    }
    const row = await rowOf(t, id)
    assert.equal(row.status, 'ready')
    assert.equal(row.supersededStorageKey, original)
    assert.notEqual(await store.storage.head(original), null)
    const log = logs.join('')
    assert.ok(log.includes('"event":"file.superseded_object_failed"'))
    assert.equal(log.includes(FILE_NAME), false)

    // Tekrarlanan iş (`ready` dalı) nesneyi siler ve izi kaldırır; sürüm değişmez.
    assert.deepEqual(await transcodeAudioFile(deps(), job(t, id), now), {
      outcome: 'skipped',
      reason: 'already_ready',
    })
    assert.equal(await store.storage.head(original), null)
    const cleared = await rowOf(t, id)
    assert.equal(cleared.supersededStorageKey, null)
    assert.equal(cleared.version, row.version)
    assert.deepEqual(await objectsOf(id), [`${store.root}/${row.storageKey}`])

    // Saatlik `files.purge-unattached` işi de izdeki nesneleri siler (iş gelmese bile).
    const other = await uploaded(t)
    const otherOriginal = (await rowOf(t, other)).storageKey
    store.storage.failDeletes = true
    try {
      await transcodeAudioFile(deps(), job(t, other), now)
    } finally {
      store.storage.failDeletes = false
    }
    assert.equal((await rowOf(t, other)).supersededStorageKey, otherOriginal)
    const purge = await filesPurgeJob.run(
      { db, storage: store.storage, log: app.log },
      { institutionId: t.institution.id },
      now,
    )
    assert.equal(purge.released, 1)
    assert.equal(await store.storage.head(otherOriginal), null)
    assert.equal((await rowOf(t, other)).supersededStorageKey, null)
    assert.equal((await rowOf(t, other)).status, 'ready')
  })

  test('OG-262, DOM-BEC-052, DOM-YTK-059: saklama sonu imhası ve rıza geri çekme izdeki özgün nesneyi de siler', async () => {
    const t = await tenant()
    const id = await uploaded(t)
    const original = (await rowOf(t, id)).storageKey
    store.storage.failDeletes = true
    try {
      await transcodeAudioFile(deps(), job(t, id), now)
    } finally {
      store.storage.failDeletes = false
    }
    const ready = await rowOf(t, id)
    assert.equal(ready.supersededStorageKey, original)
    // Rıza geri çekme imha işaretini koyar (saklama sonu `now`), imha işi siler.
    await db.transaction((tx) =>
      scheduleSubjectFilesPurge(
        tx,
        t.institution.id,
        {
          purpose: 'listening_audio',
          dataSubjectId: 'yok',
          uploaderUserIds: [t.institution.admin.id],
        },
        now,
      ),
    )
    const result = await filesPurgeExpiredJob.run(
      { db, storage: store.storage, log: app.log },
      { institutionId: t.institution.id },
      now,
    )
    assert.equal(result.purged, 1)
    const row = await rowOf(t, id)
    assert.equal(row.status, 'deleted')
    assert.equal(row.supersededStorageKey, null)
    assert.deepEqual(await objectsOf(id), [])
  })

  test('OG-262, DOM-BEC-052: dönüşüm sürerken imha edilen ya da rızası geri çekilen kaydın hiçbir nesnesi kalmaz', async () => {
    const t = await tenant()
    const purgeNow = () =>
      filesPurgeExpiredJob.run(
        { db, storage: store.storage, log: app.log },
        { institutionId: t.institution.id },
        now,
      )
    const markForPurge = () =>
      db.transaction((tx) =>
        scheduleSubjectFilesPurge(
          tx,
          t.institution.id,
          {
            purpose: 'listening_audio',
            dataSubjectId: 'yok',
            uploaderUserIds: [t.institution.admin.id],
          },
          now,
        ),
      )
    try {
      // İmha dönüşüm sürerken çalışır: dönüşüm satırı yazmaz, kendi nesnesini siler.
      const purged = await uploaded(t)
      transcoder.during = async () => {
        await markForPurge()
        assert.equal((await purgeNow()).purged, 1)
      }
      assert.deepEqual(await transcodeAudioFile(deps(), job(t, purged), now), {
        outcome: 'skipped',
        reason: 'not_processing',
      })
      assert.equal((await rowOf(t, purged)).status, 'deleted')
      assert.deepEqual(await objectsOf(purged), [])

      // Rıza dönüşüm sürerken geri çekilir: dosya ready olur, imha işi iki nesneyi de siler.
      const withdrawn = await uploaded(t)
      transcoder.during = async () => {
        await markForPurge()
      }
      assert.equal((await transcodeAudioFile(deps(), job(t, withdrawn), now)).outcome, 'ready')
      transcoder.during = null
      assert.equal((await purgeNow()).purged, 1)
      const row = await rowOf(t, withdrawn)
      assert.equal(row.status, 'deleted')
      assert.equal(row.supersededStorageKey, null)
      assert.deepEqual(await objectsOf(withdrawn), [])
    } finally {
      transcoder.during = null
    }
  })

  test('OG-262: ses dışı, olmayan ve başka durumdaki dosyaya dokunulmaz', async () => {
    const t = await tenant()
    const calls = transcoder.calls.length
    assert.deepEqual(
      await transcodeAudioFile(deps(), job(t, '00000000-0000-4000-8000-000000000000'), now),
      { outcome: 'skipped', reason: 'missing' },
    )
    // Başka kurumun kimliğiyle gelen iş dosyayı bulmaz.
    const id = await uploaded(t)
    const other = await tenant()
    assert.deepEqual(await transcodeAudioFile(deps(), job(other, id), now), {
      outcome: 'skipped',
      reason: 'missing',
    })
    // Ses dışı amaç (kurum belgesi) dönüşüme girmez, `pending` kalır ve kuyruğa konmaz.
    const body = multipart(uploadParts('document', PDF))
    const document = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: {
        origin: TEST_ORIGIN,
        cookie: t.cookie,
        'content-type': body.contentType,
        'idempotency-key': `test-media-document-${++serial}`,
      },
      payload: body.payload,
    })
    assert.equal(document.statusCode, 201, document.body)
    const documentId = document.json().data.id as string
    assert.equal(document.json().data.status, 'pending')
    assert.equal(
      scheduler.queued.some((item) => item.fileId === documentId),
      false,
    )
    assert.deepEqual(await transcodeAudioFile(deps(), job(t, documentId), now), {
      outcome: 'skipped',
      reason: 'not_audio',
    })
    assert.equal(transcoder.calls.length, calls)
    assert.equal((await rowOf(t, id)).status, 'processing')
    assert.equal((await rowOf(t, documentId)).status, 'pending')
  })

  /** Kuyruksuz uygulamanın süreç içi zamanlayıcısı (arka plan dönüşümlerini beklemek için). */
  function inlineScheduler(target: App = inlineApp): InlineTranscodeScheduler {
    const current = target.media.scheduler
    assert.ok(current instanceof InlineTranscodeScheduler)
    return current
  }

  /** Dönüştürücüyü `release()` çağrılana dek bekletir. */
  function hold(target: FakeTranscoder) {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    let started = () => {}
    const entered = new Promise<void>((resolve) => (started = resolve))
    target.during = async () => {
      started()
      await gate
    }
    return {
      entered,
      release: () => {
        target.during = null
        release()
      },
    }
  }

  test('kuyruksuz: yükleme yanıtı dönüşümü beklemez; dönüşüm arka planda bitince ready olur, geçici hata kalıcı ret olur', async () => {
    const t = await tenant()
    const held = hold(inlineTranscoder)
    let id: string
    try {
      const response = await upload(t, inlineApp)
      id = response.json().data.id as string
      // Dönüşüm sürerken yanıt dönmüştür.
      assert.equal(response.json().data.status, 'processing')
      await held.entered
      assert.equal((await rowOf(t, id)).status, 'processing')
    } finally {
      held.release()
    }
    await inlineScheduler().idle()
    const row = await rowOf(t, id)
    assert.equal(row.status, 'ready')
    assert.equal(row.durationMs, 30_000)

    inlineTranscoder.result = new MediaToolError('media_timeout')
    try {
      const failed = (await upload(t, inlineApp)).json().data.id as string
      await inlineScheduler().idle()
      assert.equal((await rowOf(t, failed)).status, 'rejected')
      assert.deepEqual(await objectsOf(failed), [])
    } finally {
      inlineTranscoder.result = { durationMs: 30_000, silent: false }
    }
    const log = logs.join('')
    assert.ok(log.includes('"event":"media.transcode_failed"'))
    assert.equal(log.includes(FILE_NAME), false)
  })

  test('kuyruksuz, DOM-BEC-052: özgün nesne silinemezse dosya ready olur, nesne izde kalır ve kaybolmaz', async () => {
    const t = await tenant()
    store.storage.failDeletes = true
    let id: string
    try {
      id = (await upload(t, inlineApp)).json().data.id as string
      await inlineScheduler().idle()
    } finally {
      store.storage.failDeletes = false
    }
    const row = await rowOf(t, id)
    assert.equal(row.status, 'ready')
    assert.ok(row.supersededStorageKey)
    assert.notEqual(await store.storage.head(row.supersededStorageKey), null)
    assert.deepEqual(
      (await objectsOf(id)).sort(),
      [`${store.root}/${row.storageKey}`, `${store.root}/${row.supersededStorageKey}`].sort(),
    )
  })

  test('kuyruksuz açılış: kurtarma açılışı beklemez, kilit altında arka planda 15 dakikadır processing kalan dönüşümü işler; yeni olana dokunulmaz', async () => {
    const t = await tenant()
    const stale = await uploaded(t)
    now = new Date(FIXED_NOW.getTime() + STALE_TRANSCODE_MS + 1000)
    const held = hold(inlineTranscoder)
    let locks = 0
    try {
      const fresh = await uploaded(t)
      const queue = await bootJobs({
        app: inlineApp,
        db,
        log: inlineApp.log,
        enabled: false,
        connectionString: '',
        storage: store.storage,
        recoveryLock: async (work) => {
          locks += 1
          return { acquired: true, value: await work() }
        },
      })
      // bootJobs döndüğünde dönüşüm hâlâ sürüyor: `listen` kurtarmayı beklemez.
      assert.equal(queue, null)
      await held.entered
      assert.equal((await rowOf(t, stale)).status, 'processing')
      held.release()
      await inlineScheduler().idle()
      assert.equal(locks, 1)
      assert.equal((await rowOf(t, stale)).status, 'ready')
      assert.equal((await rowOf(t, fresh)).status, 'processing')
      assert.ok(logs.join('').includes('"event":"media.transcode_recovered"'))
    } finally {
      held.release()
      now = FIXED_NOW
    }
  })

  test('kuyruksuz açılış: kilit başka süreçteyse kurtarma atlanır, dosyaya dokunulmaz', async () => {
    const t = await tenant()
    const stale = await uploaded(t)
    now = new Date(FIXED_NOW.getTime() + STALE_TRANSCODE_MS + 1000)
    const calls = inlineTranscoder.calls.length
    try {
      await bootJobs({
        app: inlineApp,
        db,
        log: inlineApp.log,
        enabled: false,
        connectionString: '',
        storage: store.storage,
        recoveryLock: async () => ({ acquired: false }),
      })
      await inlineScheduler().idle()
    } finally {
      now = FIXED_NOW
    }
    assert.equal((await rowOf(t, stale)).status, 'processing')
    assert.equal(inlineTranscoder.calls.length, calls)
    assert.ok(logs.join('').includes('"event":"media.transcode_recovery_skipped"'))
  })

  test('kuyruksuz: kapanışta süren dönüşüm iptal edilir ve beklenir; dosya reddedilmez, processing kalır', async () => {
    const t = await tenant()
    const closingTranscoder = new FakeTranscoder()
    const closing = await buildTestApp(db, {
      storage: store.storage,
      clock: () => now,
      logs,
      media: { transcoder: closingTranscoder },
    })
    // Gerçek ffmpeg gibi: iptal sinyali gelince süreç öldürülür, geçici hata fırlar.
    let started = () => {}
    const entered = new Promise<void>((resolve) => (started = resolve))
    closingTranscoder.during = (input) =>
      new Promise((_resolve, reject) => {
        started()
        input.signal?.addEventListener('abort', () => reject(new MediaToolError('media_aborted')))
      })
    const cookie = await signInAs(closing, t.institution.admin)
    const body = multipart(uploadParts('listening_audio', MP3, FILE_NAME, 'audio/mpeg'))
    const response = await closing.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': body.contentType,
        'idempotency-key': `test-media-close-${++serial}`,
      },
      payload: body.payload,
    })
    assert.equal(response.statusCode, 201, response.body)
    const id = response.json().data.id as string
    await entered
    // `onClose` dönüşümü iptal eder ve bitmesini bekler.
    await closing.close()
    const row = await rowOf(t, id)
    assert.equal(row.status, 'processing')
    assert.notEqual(await store.storage.head(row.storageKey), null)
    assert.ok(logs.join('').includes('"event":"media.transcode_interrupted"'))
  })

  test('iş yükü yalnız kurum ve dosya kimliğidir; fazladan alan ve bozuk kimlik reddedilir', () => {
    const fileId = '00000000-0000-4000-8000-000000000000'
    assert.equal(transcodeJobDataSchema.safeParse({ institutionId: 'k', fileId }).success, true)
    assert.equal(
      transcodeJobDataSchema.safeParse({ institutionId: 'k', fileId: 'x' }).success,
      false,
    )
    assert.equal(
      transcodeJobDataSchema.safeParse({ institutionId: 'k', fileId, name: 'a.mp3' }).success,
      false,
    )
  })

  test('pg-boss bağlantısı transaction içinde $n yer tutucularını parametre olarak çalıştırır', async () => {
    const rows = await db.transaction(async (tx) => {
      const result = await transactionConnection(tx).executeSql(
        "select $1::text as a, $2::int + $2::int as b, '$' as c",
        ["x'; drop table files; --", 2],
      )
      return result.rows
    })
    assert.deepEqual(rows, [{ a: "x'; drop table files; --", b: 4, c: '$' }])
  })

  test("migration 0033: içerik kolonları yalnız ses amacında processing → ready geçişinde değişir; processing'e dönüş ve iki adımlı delme reddedilir", async () => {
    const t = await tenant()
    const id = await uploaded(t)
    const immutable = (error: unknown) =>
      JSON.stringify(error).includes('55000') || /immutable/.test(String(error))
    const otherSha = 'f'.repeat(64)
    // processing kalırken içerik değişmez.
    await assert.rejects(
      db.execute(sql`update files set byte_size = 1 where id = ${id}`),
      immutable,
    )
    await transcodeAudioFile(deps(), job(t, id), now)
    const ready = await rowOf(t, id)
    // ready dosyanın içeriği değişmez; amaç hiçbir geçişte değişmez.
    await assert.rejects(
      db.execute(sql`update files set byte_size = 1 where id = ${id}`),
      immutable,
    )
    // İki adımlı delme: ready → processing reddedilir, ardından içerik değişemez.
    await assert.rejects(
      db.execute(sql`update files set status = 'processing' where id = ${id}`),
      immutable,
    )
    await assert.rejects(
      db
        .execute(sql`update files set status = 'pending' where id = ${id}`)
        .then(() => db.execute(sql`update files set status = 'processing' where id = ${id}`)),
      immutable,
    )
    await db.execute(sql`update files set status = 'ready' where id = ${id}`)
    await assert.rejects(
      db.execute(
        sql`update files set status = 'processing', sha256 = ${otherSha} where id = ${id}`,
      ),
      immutable,
    )
    const after = await rowOf(t, id)
    assert.equal(after.storageKey, ready.storageKey)
    assert.equal(after.sha256, ready.sha256)
    // Silinecek özgün anahtar sonradan başka bir nesneye yöneltilemez; yalnız boşaltılır.
    await assert.rejects(
      db.execute(
        sql`update files set superseded_storage_key = ${`${t.institution.id}/x`} where id = ${id}`,
      ),
      immutable,
    )
    await assert.rejects(
      db.execute(sql`update files set superseded_storage_key = storage_key where id = ${id}`),
      (error: unknown) =>
        /files_superseded_storage_key_check|immutable|55000/.test(
          JSON.stringify(error) + String(error),
        ),
    )
    // Reddedilen dosya da processing'e dönmez.
    const rejected = await uploaded(t)
    transcoder.result = { durationMs: 5_000, silent: true }
    try {
      await transcodeAudioFile(deps(), job(t, rejected), now)
    } finally {
      transcoder.result = { durationMs: 30_000, silent: false }
    }
    assert.equal((await rowOf(t, rejected)).status, 'rejected')
    await assert.rejects(
      db.execute(sql`update files set status = 'processing' where id = ${rejected}`),
      immutable,
    )
    const next = await uploaded(t)
    await assert.rejects(
      db.execute(sql`update files set status = 'ready', purpose = 'material' where id = ${next}`),
      immutable,
    )
    // Ses dışı amaçta processing → ready geçişi içeriği değiştiremez (yalnız durum değişir).
    const documentId = randomUUID()
    await db.transaction((tx) =>
      insertFile(
        tx,
        t.institution.id,
        {
          id: documentId,
          purpose: 'document',
          storageKey: `${t.institution.id}/document/2026/10/${documentId}`,
          contentType: 'application/pdf',
          byteSize: 10,
          sha256: 'a'.repeat(64),
          originalName: null,
          uploadedByUserId: t.institution.admin.id,
        },
        now,
        'processing',
      ),
    )
    await assert.rejects(
      db.execute(
        sql`update files set status = 'ready', sha256 = ${otherSha} where id = ${documentId}`,
      ),
      immutable,
    )
    await db.execute(sql`update files set status = 'ready' where id = ${documentId}`)
    assert.equal((await rowOf(t, documentId)).sha256, 'a'.repeat(64))
  })
})
