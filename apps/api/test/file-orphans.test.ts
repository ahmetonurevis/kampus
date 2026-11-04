import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertFile } from '../src/db/files.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { files } from '../src/db/schema/files.ts'
import { filesPurgeOrphansJob } from '../src/jobs/files-purge-orphans.ts'
import { INSTITUTION_JOBS } from '../src/jobs/registry.ts'
import { DAY_SECONDS, type JobDeps } from '../src/jobs/types.ts'
import {
  ORPHAN_FAILURE_LIMIT,
  ORPHAN_GRACE_MS,
  ORPHAN_PURGE_LIMIT,
  ORPHAN_SCAN_LIMIT,
  purgeOrphanObjects,
} from '../src/services/file-orphans.ts'
import { transcodeAudioFile } from '../src/services/media-transcode.ts'
import type { StorageDriver, StoredObjectInfo } from '../src/storage/storage.ts'
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
import { MP3, multipart, PDF, tempStorage, uploadParts } from './support/files-sample.ts'
import { FakeTranscoder } from './support/media-sample.ts'

/**
 * Yetim nesne taraması (OG-093, IST-027; ADR 0003 karar 4, 5, 13): disk sürücüsünün önek listesi,
 * `purgeOrphanObjects` ve `files.purge-orphans` işi. Depo geçici klasördedir; saat sabittir,
 * nesnelerin son değişiklik zamanı `utimes` ile verilir.
 */

const HOUR = 3600_000
const OLD = new Date(FIXED_NOW.getTime() - ORPHAN_GRACE_MS - HOUR)
const FRESH = new Date(FIXED_NOW.getTime() - HOUR)

describe('yetim nesne taraması', () => {
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

  const pathOf = (key: string) => join(store.root, key)
  const exists = async (key: string) => (await store.storage.head(key)) !== null
  /** Nesneyi yazar ve son değişiklik zamanını verir. */
  async function putObject(key: string, modifiedAt: Date) {
    await store.storage.put(key, Readable.from([Buffer.from('nesne')]))
    await utimes(pathOf(key), modifiedAt, modifiedAt)
  }
  const orphanKey = (institutionId: string) => `${institutionId}/submission/2026/10/${randomUUID()}`
  async function listAll(storage: StorageDriver, prefix: string): Promise<StoredObjectInfo[]> {
    const objects: StoredObjectInfo[] = []
    for await (const object of storage.list(prefix)) objects.push(object)
    return objects.sort((a, b) => a.key.localeCompare(b.key))
  }

  let serial = 0
  /** Kurumda öğrenci olarak PDF yükler (`pending`); nesnesini eski gösterir. */
  async function uploadIn(institutionId: string, fileName = 'odev.pdf') {
    const user = await createMember(app, institutionId, 'ogrenci')
    const body = multipart(uploadParts('submission', PDF, fileName))
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: {
        origin: TEST_ORIGIN,
        cookie: await signInAs(app, user),
        'content-type': body.contentType,
        'idempotency-key': `test-orphans-${String(++serial).padStart(5, '0')}`,
      },
      payload: body.payload,
    })
    assert.equal(response.statusCode, 201, response.body)
    const id = (response.json() as { data: { id: string } }).data.id
    const [row] = await db
      .select()
      .from(files)
      .where(and(eq(files.institutionId, institutionId), eq(files.id, id)))
    assert.ok(row)
    await utimes(pathOf(row.storageKey), OLD, OLD)
    return row
  }
  const setStatus = (institutionId: string, id: string, status: 'deleted' | 'rejected') =>
    db
      .update(files)
      .set({ status, deletedAt: status === 'deleted' ? FIXED_NOW : null })
      .where(and(eq(files.institutionId, institutionId), eq(files.id, id)))

  test('OG-093: disk sürücüsü önek altındaki tamamlanmış nesneleri anahtar ve son değişiklikle verir; benzer adlı kurum, geçici .part ve biçim dışı dosya listeye girmez', async () => {
    const a = uniqueId('liste')
    const near = `${a}x`
    const first = `${a}/submission/2026/09/${randomUUID()}`
    const second = `${a}/document/2026/10/${randomUUID()}`
    await putObject(first, OLD)
    await putObject(second, FRESH)
    await putObject(`${near}/submission/2026/10/${randomUUID()}`, OLD)
    // Yazımı süren nesnenin geçici dosyası ve anahtar biçimine uymayan dosyalar.
    await writeFile(`${pathOf(first)}.${randomUUID()}.part`, 'yarım')
    await mkdir(join(store.root, a, 'submission', '2026', '09', 'alt'), { recursive: true })
    await writeFile(join(store.root, a, 'submission', 'kok-dosyasi'), 'x')

    assert.deepEqual(
      await listAll(store.storage, `${a}/`),
      [
        { key: first, lastModified: OLD },
        { key: second, lastModified: FRESH },
      ].sort((x, y) => x.key.localeCompare(y.key)),
    )
    assert.deepEqual(
      (await listAll(store.storage, `${a}/submission/`)).map((o) => o.key),
      [first],
    )
    assert.deepEqual(await listAll(store.storage, `${uniqueId('yok')}/`), [])
    for (const bad of [a, '../', `${a}/../`, '/', `${a}//`, `${first}/`]) {
      await assert.rejects(listAll(store.storage, bad), /invalid storage prefix/, bad)
    }
  })

  test('OG-093: liste akıştır; tüketici erken bırakınca kalan nesneler okunmaz', async () => {
    const a = uniqueId('akis')
    for (let index = 0; index < 3; index += 1) await putObject(orphanKey(a), OLD)
    let seen = 0
    for await (const object of store.storage.list(`${a}/`)) {
      assert.ok(object.key.startsWith(`${a}/`))
      seen += 1
      break
    }
    assert.equal(seen, 1)
    assert.equal((await listAll(store.storage, `${a}/`)).length, 3)
  })

  test('OG-093, IST-027: satırlı nesne kalır; satırsız eski nesne silinir, satırsız yeni nesne (güvenlik payı) ve başka kurumun öneki dokunulmaz; ikinci çalıştırma değişmez', async () => {
    const a = await createInstitution(app)
    const b = await createInstitution(app)
    const live = await uploadIn(a.id)
    const otherLive = await uploadIn(b.id)
    const old = orphanKey(a.id)
    const fresh = orphanKey(a.id)
    const otherOrphan = orphanKey(b.id)
    await putObject(old, OLD)
    await putObject(fresh, FRESH)
    await putObject(otherOrphan, OLD)

    assert.deepEqual(
      await purgeOrphanObjects({
        db,
        storage: store.storage,
        institutionId: a.id,
        now: FIXED_NOW,
        log: app.log,
      }),
      { scanned: 3, candidates: 1, purged: 1, failed: 0, recent: 1, stopped: null },
    )
    assert.equal(await exists(live.storageKey), true)
    assert.equal(await exists(old), false)
    assert.equal(await exists(fresh), true)
    assert.equal(await exists(otherOrphan), true)
    assert.equal(await exists(otherLive.storageKey), true)

    assert.deepEqual(
      await purgeOrphanObjects({
        db,
        storage: store.storage,
        institutionId: a.id,
        now: FIXED_NOW,
        log: app.log,
      }),
      { scanned: 2, candidates: 0, purged: 0, failed: 0, recent: 1, stopped: null },
    )
    // Güvenlik payı dolunca yeni nesne de yetimdir.
    const later = new Date(FRESH.getTime() + ORPHAN_GRACE_MS + 1)
    assert.equal(
      (
        await purgeOrphanObjects({
          db,
          storage: store.storage,
          institutionId: a.id,
          now: later,
          log: app.log,
        })
      ).purged,
      1,
    )
    assert.equal(await exists(fresh), false)
    assert.equal(await exists(live.storageKey), true)
  })

  test('OG-093, ADR 0003 karar 13: deleted ve rejected satırın silinemeyip kalan nesnesi yetimdir ve silinir (satır değişmez); log dosya adı taşımaz', async () => {
    const a = await createInstitution(app)
    const fileName = 'Deniz-Yilmaz-odev.pdf'
    const deleted = await uploadIn(a.id, fileName)
    const rejected = await uploadIn(a.id)
    const ready = await uploadIn(a.id)
    await setStatus(a.id, deleted.id, 'deleted')
    await setStatus(a.id, rejected.id, 'rejected')
    const from = logs.length

    assert.deepEqual(await filesPurgeOrphansJob.run(deps, { institutionId: a.id }, FIXED_NOW), {
      scanned: 3,
      candidates: 2,
      purged: 2,
      failed: 0,
      recent: 0,
      stopped: null,
    })
    assert.equal(await exists(deleted.storageKey), false)
    assert.equal(await exists(rejected.storageKey), false)
    assert.equal(await exists(ready.storageKey), true)
    const [row] = await db
      .select()
      .from(files)
      .where(and(eq(files.institutionId, a.id), eq(files.id, deleted.id)))
    assert.equal(row?.status, 'deleted')
    assert.equal(row?.version, deleted.version)
    const written = logs.slice(from).join('')
    assert.match(written, /file\.orphans_purged/)
    assert.equal(written.includes(fileName), false)
    assert.equal(written.includes('Deniz'), false)
  })

  test('OG-093, OG-262: dönüşmüş ses ve silinemeyip izde kalan özgün nesne (superseded_storage_key) tutulur (onu files.purge-unattached siler)', async () => {
    const a = await createInstitution(app)
    const body = multipart(uploadParts('listening_audio', MP3, 'dinleme.mp3', 'audio/mpeg'))
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: {
        origin: TEST_ORIGIN,
        cookie: await signInAs(app, a.admin),
        'content-type': body.contentType,
        'idempotency-key': `test-orphans-${String(++serial).padStart(5, '0')}`,
      },
      payload: body.payload,
    })
    assert.equal(response.statusCode, 201, response.body)
    const id = (response.json() as { data: { id: string } }).data.id
    const job = { institutionId: a.id, fileId: id }
    store.storage.failDeletes = true
    try {
      const outcome = await transcodeAudioFile(
        { db, storage: store.storage, transcoder: new FakeTranscoder(), log: app.log },
        job,
        FIXED_NOW,
      )
      assert.equal(outcome.outcome, 'ready')
    } finally {
      store.storage.failDeletes = false
    }
    const [row] = await db
      .select()
      .from(files)
      .where(and(eq(files.institutionId, a.id), eq(files.id, id)))
    assert.ok(row?.supersededStorageKey)
    for (const key of [row.storageKey, row.supersededStorageKey])
      await utimes(pathOf(key), OLD, OLD)

    assert.deepEqual(await filesPurgeOrphansJob.run(deps, { institutionId: a.id }, FIXED_NOW), {
      scanned: 2,
      candidates: 0,
      purged: 0,
      failed: 0,
      recent: 0,
      stopped: null,
    })
    assert.equal(await exists(row.storageKey), true)
    assert.equal(await exists(row.supersededStorageKey), true)
  })

  test('OG-093: tur başına silme sınırı; sınıra gelen tarama durur (stopped: limit), kalanlar sonraki çalıştırmalarda silinir; varsayılan sınır 500 ve 200lük arama gruplarını aşan tarama tamamlanır', async () => {
    assert.equal(ORPHAN_PURGE_LIMIT, 500)
    const a = await createInstitution(app)
    for (let index = 0; index < 5; index += 1) await putObject(orphanKey(a.id), OLD)
    const run = () =>
      purgeOrphanObjects({
        db,
        storage: store.storage,
        institutionId: a.id,
        now: FIXED_NOW,
        log: app.log,
        limit: 2,
      })
    assert.deepEqual(
      { ...(await run()), scanned: 0 },
      { scanned: 0, candidates: 2, purged: 2, failed: 0, recent: 0, stopped: 'limit' },
    )
    assert.equal((await listAll(store.storage, `${a.id}/`)).length, 3)
    assert.equal((await run()).stopped, 'limit')
    assert.deepEqual(await run(), {
      scanned: 1,
      candidates: 1,
      purged: 1,
      failed: 0,
      recent: 0,
      stopped: null,
    })
    assert.deepEqual(await listAll(store.storage, `${a.id}/`), [])

    const many = await createInstitution(app)
    for (let index = 0; index < 230; index += 1) await putObject(orphanKey(many.id), OLD)
    assert.deepEqual(
      await purgeOrphanObjects({
        db,
        storage: store.storage,
        institutionId: many.id,
        now: FIXED_NOW,
        log: app.log,
      }),
      { scanned: 230, candidates: 230, purged: 230, failed: 0, recent: 0, stopped: null },
    )
  })

  test('OG-093: silme hatası öteki nesneleri durdurmaz; hata yalnız kurum ve anahtarla loglanır, nesne sonraki çalıştırmada silinir', async () => {
    const a = await createInstitution(app)
    const broken = orphanKey(a.id)
    const others = [orphanKey(a.id), orphanKey(a.id)]
    for (const key of [broken, ...others]) await putObject(key, OLD)
    const remove = async (key: string) => {
      if (key === broken) throw new Error('EIO: simulated delete failure')
      return store.storage.delete(key)
    }
    const flaky = new Proxy(store.storage, {
      get(target, property) {
        if (property === 'delete') return remove
        const value: unknown = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) satisfies StorageDriver
    const from = logs.length

    assert.deepEqual(
      await purgeOrphanObjects({
        db,
        storage: flaky,
        institutionId: a.id,
        now: FIXED_NOW,
        log: app.log,
      }),
      { scanned: 3, candidates: 3, purged: 2, failed: 1, recent: 0, stopped: null },
    )
    assert.equal(await exists(broken), true)
    for (const key of others) assert.equal(await exists(key), false)
    const failure = logs
      .slice(from)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.event === 'file.orphan_delete_failed')
    assert.equal(failure?.institutionId, a.id)
    assert.equal(failure?.storageKey, broken)

    assert.equal(
      (await filesPurgeOrphansJob.run(deps, { institutionId: a.id }, FIXED_NOW)).purged,
      1,
    )
    assert.equal(await exists(broken), false)
  })

  /** Verilen anahtarların silinmesi hata veren, öteki işlemleri gerçek depoya ileten sarmalayıcı. */
  function flakyFor(broken: ReadonlySet<string>, onDelete?: (key: string) => void) {
    const remove = async (key: string) => {
      if (broken.has(key)) throw new Error('EIO: simulated delete failure')
      await store.storage.delete(key)
      onDelete?.(key)
    }
    return new Proxy(store.storage, {
      get(target, property) {
        if (property === 'delete') return remove
        const value: unknown = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) satisfies StorageDriver
  }
  const orphanAudits = (institutionId: string) =>
    db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, 'file.orphans_purge')),
      )

  test('OG-093: silinemeyen nesne başarılı silme sınırını doldurmaz; kalıcı hata veren nesneler varken arkadaki yetimler silinir', async () => {
    assert.equal(ORPHAN_FAILURE_LIMIT, 50)
    const a = await createInstitution(app)
    const broken = new Set<string>()
    const good: string[] = []
    for (let index = 0; index < 6; index += 1) {
      const key = orphanKey(a.id)
      await putObject(key, OLD)
      broken.add(key)
    }
    for (let index = 0; index < 3; index += 1) {
      const key = orphanKey(a.id)
      await putObject(key, OLD)
      good.push(key)
    }
    // Sınır 3 başarılı silme; eski davranışta (deneme sayan sınır) kalıcı hatalar turu tüketirdi.
    const result = await purgeOrphanObjects({
      db,
      storage: flakyFor(broken),
      institutionId: a.id,
      now: FIXED_NOW,
      log: app.log,
      limit: 3,
    })
    assert.equal(result.purged, 3)
    assert.ok(result.failed <= 6)
    for (const key of good) assert.equal(await exists(key), false)
    for (const key of broken) assert.equal(await exists(key), true)
  })

  test('OG-093: silme hatası sınırı aşılınca tur durur (stopped: failures) ve kalan nesneler denenmez', async () => {
    const a = await createInstitution(app)
    const keys = [orphanKey(a.id), orphanKey(a.id), orphanKey(a.id), orphanKey(a.id)]
    for (const key of keys) await putObject(key, OLD)
    const from = logs.length
    assert.deepEqual(
      await purgeOrphanObjects({
        db,
        storage: flakyFor(new Set(keys)),
        institutionId: a.id,
        now: FIXED_NOW,
        log: app.log,
        failureLimit: 2,
      }),
      { scanned: 4, candidates: 2, purged: 0, failed: 2, recent: 0, stopped: 'failures' },
    )
    for (const key of keys) assert.equal(await exists(key), true)
    const failures = logs.slice(from).filter((line) => line.includes('file.orphan_delete_failed'))
    assert.equal(failures.length, 2)
    // Hiçbir şey silinmediği için denetim satırı da yoktur.
    assert.deepEqual(await orphanAudits(a.id), [])
  })

  test('OG-093: tur başına taranan nesne sınırı; sınıra gelen tarama durur (stopped: scan_limit), taranan son grup işlenir, kalanı sonraki çalıştırmaya kalır', async () => {
    assert.equal(ORPHAN_SCAN_LIMIT, 100_000)
    const a = await createInstitution(app)
    for (let index = 0; index < 5; index += 1) await putObject(orphanKey(a.id), OLD)
    assert.deepEqual(
      await purgeOrphanObjects({
        db,
        storage: store.storage,
        institutionId: a.id,
        now: FIXED_NOW,
        log: app.log,
        scanLimit: 3,
      }),
      { scanned: 3, candidates: 3, purged: 3, failed: 0, recent: 0, stopped: 'scan_limit' },
    )
    assert.equal((await listAll(store.storage, `${a.id}/`)).length, 2)
    // Sınır tam nesne sayısına eşitse tarama tamamlanmış sayılır.
    assert.deepEqual(
      await purgeOrphanObjects({
        db,
        storage: store.storage,
        institutionId: a.id,
        now: FIXED_NOW,
        log: app.log,
        scanLimit: 2,
      }),
      { scanned: 2, candidates: 2, purged: 2, failed: 0, recent: 0, stopped: null },
    )
  })

  test('OG-093: iptal sinyaline silme döngüsünde de bakılır; iptalden sonra yeni nesne silinmez', async () => {
    const a = await createInstitution(app)
    const keys = [orphanKey(a.id), orphanKey(a.id), orphanKey(a.id)]
    for (const key of keys) await putObject(key, OLD)
    const controller = new AbortController()
    const result = await purgeOrphanObjects({
      db,
      storage: flakyFor(new Set(), () => controller.abort()),
      institutionId: a.id,
      now: FIXED_NOW,
      log: app.log,
      signal: controller.signal,
    })
    assert.equal(result.purged, 1)
    assert.equal(result.stopped, 'aborted')
    assert.equal((await listAll(store.storage, `${a.id}/`)).length, 2)
  })

  test('OG-093, KVKK (guvenlik-kvkk §10): en az bir silme varsa kurum başına tek toplu file.orphans_purge denetim satırı yazılır (aktör sistem, yalnız sayılar); silme yoksa satır yazılmaz', async () => {
    const a = await createInstitution(app)
    const b = await createInstitution(app)
    const keys = [orphanKey(a.id), orphanKey(a.id), orphanKey(a.id)]
    for (const key of keys) await putObject(key, OLD)
    await putObject(orphanKey(b.id), FRESH)
    const run = (institutionId: string, storage: StorageDriver = store.storage) =>
      purgeOrphanObjects({ db, storage, institutionId, now: FIXED_NOW, log: app.log })

    await run(b.id)
    assert.deepEqual(await orphanAudits(b.id), [])
    await run(a.id, flakyFor(new Set([keys[0] ?? ''])))

    const rows = await orphanAudits(a.id)
    assert.equal(rows.length, 1)
    const [row] = rows
    assert.equal(row?.actorUserId, null)
    assert.equal(row?.actorRole, null)
    assert.equal(row?.entityId, null)
    assert.equal(row?.reason, null)
    assert.equal(row?.createdAt.getTime(), FIXED_NOW.getTime())
    const purged = 3 - (await listAll(store.storage, `${a.id}/`)).length
    assert.deepEqual(row?.changes, { counts: { scanned: 3, purged, failed: 3 - purged } })
    // Anahtar, ad ve yol denetime girmez.
    const serialized = JSON.stringify(row)
    for (const key of keys) assert.equal(serialized.includes(key), false)
    assert.equal(serialized.includes('submission'), false)

    // Ertesi tur kalanı siler; her çalıştırma kendi satırını yazar, silme yoksa yazmaz.
    await run(a.id)
    assert.equal((await orphanAudits(a.id)).length, 2)
    await run(a.id)
    assert.equal((await orphanAudits(a.id)).length, 2)
  })

  test('OG-093: processing durumundaki (ses dışı, taraması süren) dosyanın nesnesi yetim sayılmaz ve silinmez', async () => {
    const a = await createInstitution(app)
    // Tarayıcı açıkken ses dışı yükleme `processing` başlar (ADR 0003 karar 8); satır doğrudan eklenir.
    const user = await createMember(app, a.id, 'ogrenci')
    const storageKey = orphanKey(a.id)
    await putObject(storageKey, OLD)
    const row = await insertFile(
      db,
      a.id,
      {
        id: randomUUID(),
        purpose: 'submission',
        storageKey,
        contentType: 'application/pdf',
        byteSize: 5,
        sha256: 'a'.repeat(64),
        originalName: 'odev.pdf',
        uploadedByUserId: user.id,
      },
      FIXED_NOW,
      'processing',
    )
    assert.equal(row.status, 'processing')
    const orphan = orphanKey(a.id)
    await putObject(orphan, OLD)
    assert.deepEqual(await filesPurgeOrphansJob.run(deps, { institutionId: a.id }, FIXED_NOW), {
      scanned: 2,
      candidates: 1,
      purged: 1,
      failed: 0,
      recent: 0,
      stopped: null,
    })
    assert.equal(await exists(storageKey), true)
    assert.equal(await exists(orphan), false)
  })

  test('OG-093: kurum klasörü kök dışını (ya da başka kurumu) gösteren sembolik bağsa liste boştur, uyarı loglanır ve hiçbir nesne silinmez', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'kampus-outside-'))
    try {
      const a = uniqueId('bag')
      const neighbour = uniqueId('komsu')
      const outsideKey = `${a}/submission/2026/10/${randomUUID()}`
      const neighbourKey = `${neighbour}/submission/2026/10/${randomUUID()}`
      // Kök dışında geçerli anahtar biçiminde bir nesne.
      await mkdir(join(outside, 'submission', '2026', '10'), { recursive: true })
      await writeFile(join(outside, outsideKey.slice(a.length + 1)), 'dis')
      await utimes(join(outside, outsideKey.slice(a.length + 1)), OLD, OLD)
      await symlink(outside, join(store.root, a), 'dir')
      await putObject(neighbourKey, OLD)
      const warnings: Record<string, unknown>[] = []
      const log = { warn: (object: Record<string, unknown>) => warnings.push(object) }

      const seen: string[] = []
      for await (const object of store.storage.list(`${a}/`, log)) seen.push(object.key)
      assert.equal(seen.length, 0)
      assert.deepEqual(warnings, [{ event: 'storage.list_outside_root', prefix: `${a}/` }])

      // Başka kurumun klasörüne işaret eden bağ da reddedilir (kök altında ama kendi yolu değil).
      const b = uniqueId('komsubag')
      await symlink(join(store.root, neighbour), join(store.root, b), 'dir')
      for await (const object of store.storage.list(`${b}/`, log)) seen.push(object.key)
      assert.equal(seen.length, 0)
      assert.equal(warnings.length, 2)

      // Normal klasörde (gerçek yol kök altında, bağsız) liste çalışır; macOS'ta /var → /private/var
      // gibi kökün kendi bağı sorun çıkarmaz.
      for await (const object of store.storage.list(`${neighbour}/`, log)) seen.push(object.key)
      assert.deepEqual(seen, [neighbourKey])

      // Tarama kök dışını silmez: kurum kimliği `a` bağı üzerinden hiçbir şey görülmez.
      assert.deepEqual(
        await purgeOrphanObjects({
          db,
          storage: store.storage,
          institutionId: a,
          now: FIXED_NOW,
          log: app.log,
        }),
        { scanned: 0, candidates: 0, purged: 0, failed: 0, recent: 0, stopped: null },
      )
      // Bağ üzerinden `exists` (head) kök dışına gitmez: kök dışı nesne yerinde durur.
      await stat(join(outside, outsideKey.slice(a.length + 1)))
      await rm(join(store.root, a))
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  test('OG-093: files.purge-orphans kayıtlı, günde bir (04:45) kurum başına çalışır; iptal edilen iş nesne silmez', async () => {
    assert.ok(INSTITUTION_JOBS.includes(filesPurgeOrphansJob))
    assert.equal(filesPurgeOrphansJob.name, 'files.purge-orphans')
    assert.equal(filesPurgeOrphansJob.cron, '45 4 * * *')
    assert.equal(filesPurgeOrphansJob.slotSeconds, DAY_SECONDS)

    const a = await createInstitution(app)
    const key = orphanKey(a.id)
    await putObject(key, OLD)
    const controller = new AbortController()
    controller.abort()
    assert.deepEqual(
      await filesPurgeOrphansJob.run(
        { ...deps, signal: controller.signal },
        { institutionId: a.id },
        FIXED_NOW,
      ),
      { scanned: 0, candidates: 0, purged: 0, failed: 0, recent: 0, stopped: 'aborted' },
    )
    assert.equal(await exists(key), true)
    assert.equal(
      (await filesPurgeOrphansJob.run(deps, { institutionId: a.id }, FIXED_NOW)).purged,
      1,
    )
    // Kurumun hiç nesnesi yoksa (önek klasörü yok) iş boş sonuçla biter.
    const empty = await createInstitution(app)
    assert.deepEqual(await filesPurgeOrphansJob.run(deps, { institutionId: empty.id }, FIXED_NOW), {
      scanned: 0,
      candidates: 0,
      purged: 0,
      failed: 0,
      recent: 0,
      stopped: null,
    })
  })
})
