import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, asc, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { RECORD_COLLECTIONS, recordKey } from '../src/db/collections.ts'
import {
  findRecord,
  insertMissingRecords,
  loadRecords,
  writeRecords,
  type RecordWrite,
} from '../src/db/records.ts'
import { records } from '../src/db/schema/records.ts'
import { AppError, ConflictError, databaseErrorInfo } from '../src/errors.ts'
import { buildTestApp, createInstitution, createTestDatabase, FIXED_NOW } from './support/app.ts'

const LATER = new Date('2026-10-06T10:00:00.000Z')

describe('records deposu', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  /** Kurumun bütün satırları; başarısızlık testlerinde öncesi/sonrası karşılaştırılır. */
  function rowsOf(institutionId: string) {
    return db
      .select()
      .from(records)
      .where(eq(records.institutionId, institutionId))
      .orderBy(asc(records.collection), asc(records.id))
  }

  async function institutionWith(
    items: { collection: 'invoices' | 'students'; id: string; data: Record<string, unknown> }[],
  ) {
    const { id } = await createInstitution(app)
    await insertMissingRecords(db, id, items, FIXED_NOW)
    return id
  }

  const invoice = (id: string, extra: Record<string, unknown> = {}) => ({
    collection: 'invoices' as const,
    id,
    data: { id, studentId: 's1', amount: 1000, paidAt: null, ...extra },
  })

  test('koleksiyon listesi örnek verinin bütün dizi anahtarlarını kapsar', () => {
    const seed = createSeed(FIXED_NOW)
    const arrayKeys = Object.entries(seed)
      .filter(([, value]) => Array.isArray(value))
      .map(([key]) => key)
      .sort()
    assert.deepEqual([...RECORD_COLLECTIONS].sort(), arrayKeys)
    for (const collection of RECORD_COLLECTIONS) {
      const items: unknown = seed[collection]
      assert.ok(Array.isArray(items))
      const keys = items.map((item: Record<string, unknown>) => recordKey(collection, item))
      assert.ok(
        keys.every((key) => typeof key === 'string'),
        `${collection}: anahtarsız kayıt`,
      )
      assert.equal(new Set(keys).size, keys.length, `${collection}: yinelenen anahtar`)
    }
  })

  test('kurum A deposu B kayıtlarını görmez ve yazamaz', async () => {
    const a = await institutionWith([invoice('test-inv-a')])
    const b = await institutionWith([invoice('test-inv-b'), invoice('test-inv-shared')])
    const bBefore = await rowsOf(b)

    const loaded = await loadRecords(db, a, ['invoices'])
    assert.deepEqual(
      loaded.map((row) => row.id),
      ['test-inv-a'],
    )
    assert.equal(await findRecord(db, a, 'invoices', 'test-inv-b'), null)

    await assert.rejects(
      writeRecords(
        db,
        a,
        [
          {
            kind: 'update',
            collection: 'invoices',
            id: 'test-inv-b',
            data: invoice('test-inv-b', { paidAt: LATER.toISOString() }).data,
            expectedVersion: 1,
          },
        ],
        LATER,
      ),
      ConflictError,
    )
    await assert.rejects(
      writeRecords(
        db,
        a,
        [{ kind: 'archive', collection: 'invoices', id: 'test-inv-b', expectedVersion: 1 }],
        LATER,
      ),
      ConflictError,
    )
    // Aynı kimlik başka kurumda bağımsız bir kayıttır; A'nın eklemesi B'ye dokunmaz.
    await writeRecords(
      db,
      a,
      [{ kind: 'insert', ...invoice('test-inv-shared', { amount: 1 }) }],
      LATER,
    )
    assert.deepEqual(await rowsOf(b), bBefore)
    assert.equal((await findRecord(db, a, 'invoices', 'test-inv-shared'))?.data.amount, 1)
  })

  test('güncelleme ve arşiv sürümü artırır; arşivli kayıt varsayılan okumada yoktur', async () => {
    const id = await institutionWith([invoice('test-inv-1'), invoice('test-inv-2')])
    const written = await writeRecords(
      db,
      id,
      [
        {
          kind: 'update',
          collection: 'invoices',
          id: 'test-inv-1',
          data: invoice('test-inv-1', { paidAt: LATER.toISOString() }).data,
          expectedVersion: 1,
        },
        { kind: 'archive', collection: 'invoices', id: 'test-inv-2', expectedVersion: 1 },
      ],
      LATER,
    )
    assert.deepEqual(
      written.map((row) => [row.kind, row.id, row.version]),
      [
        ['update', 'test-inv-1', 2],
        ['archive', 'test-inv-2', 2],
      ],
    )
    const live = await loadRecords(db, id, ['invoices'])
    assert.deepEqual(
      live.map((row) => [row.id, row.version, row.data.paidAt]),
      [['test-inv-1', 2, LATER.toISOString()]],
    )
    assert.equal(live[0]?.updatedAt.toISOString(), LATER.toISOString())
    assert.equal(live[0]?.createdAt.toISOString(), FIXED_NOW.toISOString())
    const all = await loadRecords(db, id, ['invoices'], { includeArchived: true })
    assert.equal(
      all.find((row) => row.id === 'test-inv-2')?.archivedAt?.toISOString(),
      LATER.toISOString(),
    )
    assert.equal(await findRecord(db, id, 'invoices', 'test-inv-2'), null)

    // Arşivlenmiş kimlikle yeniden ekleme kaydı açar; sürüm sürer.
    const [revived] = await writeRecords(
      db,
      id,
      [{ kind: 'insert', ...invoice('test-inv-2', { amount: 5 }) }],
      LATER,
    )
    assert.equal(revived?.version, 3)
    const row = await findRecord(db, id, 'invoices', 'test-inv-2')
    assert.equal(row?.archivedAt, null)
    assert.equal(row?.data.amount, 5)
  })

  test('eski sürümle yazma 409 verir ve işlemdeki hiçbir kayıt değişmez', async () => {
    const id = await institutionWith([invoice('test-inv-1'), invoice('test-inv-2')])
    await writeRecords(
      db,
      id,
      [
        {
          kind: 'update',
          collection: 'invoices',
          id: 'test-inv-2',
          data: invoice('test-inv-2', { amount: 2000 }).data,
          expectedVersion: 1,
        },
      ],
      LATER,
    )
    const before = await rowsOf(id)
    const writes: RecordWrite[] = [
      { kind: 'insert', ...invoice('test-inv-3') },
      {
        kind: 'update',
        collection: 'invoices',
        id: 'test-inv-1',
        data: invoice('test-inv-1', { amount: 1 }).data,
        expectedVersion: 1,
      },
      // Başka bir yazar sürümü 2'ye çıkardı; bu yazma eski görüntüye dayanıyor.
      {
        kind: 'update',
        collection: 'invoices',
        id: 'test-inv-2',
        data: invoice('test-inv-2', { amount: 1 }).data,
        expectedVersion: 1,
      },
    ]
    await assert.rejects(writeRecords(db, id, writes, LATER), (error: unknown) => {
      assert.ok(error instanceof ConflictError)
      assert.equal(error.statusCode, 409)
      assert.equal(error.code, 'version_conflict')
      return true
    })
    assert.deepEqual(await rowsOf(id), before)
  })

  test('yazmalar verilen sırayla değil (koleksiyon, kimlik) sırasıyla yapılır', async () => {
    const id = await institutionWith([invoice('test-inv-2'), invoice('test-inv-4')])
    const written = await writeRecords(
      db,
      id,
      [
        { kind: 'insert', ...invoice('test-inv-5') },
        { kind: 'archive', collection: 'invoices', id: 'test-inv-4', expectedVersion: 1 },
        { kind: 'insert', collection: 'students', id: 'test-s-1', data: { id: 'test-s-1' } },
        { kind: 'insert', ...invoice('test-inv-1') },
        {
          kind: 'update',
          collection: 'invoices',
          id: 'test-inv-2',
          data: invoice('test-inv-2', { amount: 3 }).data,
          expectedVersion: 1,
        },
      ],
      LATER,
    )
    assert.deepEqual(
      written.map((row) => `${row.collection}:${row.id}`),
      [
        'invoices:test-inv-1',
        'invoices:test-inv-2',
        'invoices:test-inv-4',
        'invoices:test-inv-5',
        'students:test-s-1',
      ],
    )
    // Sırası verilmeyen eklemeler yine verilen sırayla sona eklenir.
    assert.deepEqual(
      (await loadRecords(db, id, ['invoices'])).map((row) => row.id),
      ['test-inv-2', 'test-inv-5', 'test-inv-1'],
    )
  })

  test('canlı kayıtla aynı anahtarda ekleme 409 verir', async () => {
    const id = await institutionWith([invoice('test-inv-1')])
    const before = await rowsOf(id)
    await assert.rejects(
      writeRecords(
        db,
        id,
        [
          { kind: 'insert', ...invoice('test-inv-new') },
          { kind: 'insert', ...invoice('test-inv-1', { amount: 9 }) },
        ],
        LATER,
      ),
      ConflictError,
    )
    assert.deepEqual(await rowsOf(id), before)
  })

  test('256 KB üstü kayıt 422 ile reddedilir ve hiçbir şey yazılmaz', async () => {
    const id = await institutionWith([invoice('test-inv-1')])
    const before = await rowsOf(id)
    await assert.rejects(
      writeRecords(
        db,
        id,
        [
          { kind: 'insert', ...invoice('test-inv-ok') },
          { kind: 'insert', ...invoice('test-inv-big', { note: 'x'.repeat(262_200) }) },
        ],
        LATER,
      ),
      (error: unknown) => {
        assert.ok(error instanceof AppError)
        assert.equal(error.statusCode, 422)
        assert.equal(error.code, 'record_too_large')
        return true
      },
    )
    assert.deepEqual(await rowsOf(id), before)
  })

  test('veritabanı boyut kısıtı jsonb ikili boyutunu sınar; ihlal 422 record_too_large olur', async () => {
    const id = await institutionWith([invoice('test-inv-1')])
    const before = await rowsOf(id)
    // JSON metni ~200 KB (uygulama denetimini geçer), jsonb ikili biçimi ~1,2 MB (kısıta takılır).
    const list = Array.from({ length: 100_000 }, () => 0)
    const dense = invoice('test-inv-dense', { list })
    assert.ok(Buffer.byteLength(JSON.stringify(dense.data)) < 262_144)

    // Kısıt doğrudan: uygulama denetimi olmadan da veritabanı reddeder.
    await assert.rejects(
      db.insert(records).values({
        institutionId: id,
        collection: 'invoices',
        id: dense.id,
        data: dense.data,
        position: 0,
      }),
      (error: unknown) => {
        assert.deepEqual(databaseErrorInfo(error), {
          code: '23514',
          constraint: 'records_data_size_check',
        })
        return true
      },
    )
    const isTooLarge = (error: unknown) => {
      assert.ok(error instanceof AppError, String(error))
      assert.equal(error.statusCode, 422)
      assert.equal(error.code, 'record_too_large')
      return true
    }
    await assert.rejects(
      writeRecords(
        db,
        id,
        [
          { kind: 'insert', ...invoice('test-inv-ok') },
          { kind: 'insert', ...dense },
        ],
        LATER,
      ),
      isTooLarge,
    )
    await assert.rejects(
      writeRecords(
        db,
        id,
        [
          {
            kind: 'update',
            ...invoice('test-inv-1', { list }),
            expectedVersion: 1,
          },
        ],
        LATER,
      ),
      isTooLarge,
    )
    await assert.rejects(insertMissingRecords(db, id, [dense], LATER), isTooLarge)
    assert.deepEqual(await rowsOf(id), before)
  })

  test('bilinmeyen koleksiyon programlama hatasıdır (500)', async () => {
    const { id } = await createInstitution(app)
    await assert.rejects(
      // @ts-expect-error: çalışma anı denetimi sınanıyor
      loadRecords(db, id, ['notACollection']),
      (error: unknown) => error instanceof AppError && error.statusCode === 500,
    )
  })

  test("core denetim koleksiyonu (audit) records'a yazılamaz (500)", async () => {
    const { id } = await createInstitution(app)
    const audit = { collection: 'audit' as const, id: 'test-audit-1', data: { id: 'test-audit-1' } }
    const isInternal = (error: unknown) => error instanceof AppError && error.statusCode === 500
    await assert.rejects(writeRecords(db, id, [{ kind: 'insert', ...audit }], LATER), isInternal)
    await assert.rejects(insertMissingRecords(db, id, [audit], LATER), isInternal)
    assert.deepEqual(await rowsOf(id), [])
  })

  test('eksik kayıt ekleme idempotenttir ve değişmiş kaydı ezmez', async () => {
    const id = await institutionWith([invoice('test-inv-1')])
    await writeRecords(
      db,
      id,
      [
        {
          kind: 'update',
          collection: 'invoices',
          id: 'test-inv-1',
          data: invoice('test-inv-1', { amount: 7 }).data,
          expectedVersion: 1,
        },
      ],
      LATER,
    )
    const inserted = await insertMissingRecords(
      db,
      id,
      [invoice('test-inv-1'), invoice('test-inv-2')],
      LATER,
    )
    assert.equal(inserted, 1)
    const [row] = await db
      .select()
      .from(records)
      .where(and(eq(records.institutionId, id), eq(records.id, 'test-inv-1')))
    assert.equal(row?.data.amount, 7)
    assert.equal(row?.version, 2)
  })
})
