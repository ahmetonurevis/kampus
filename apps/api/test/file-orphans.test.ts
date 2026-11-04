import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { files } from '../src/db/schema/files.ts'
import { filesPurgeOrphansJob } from '../src/jobs/files-purge-orphans.ts'
import { INSTITUTION_JOBS } from '../src/jobs/registry.ts'
import { DAY_SECONDS, type JobDeps } from '../src/jobs/types.ts'
import {
  ORPHAN_GRACE_MS,
  ORPHAN_PURGE_LIMIT,
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
