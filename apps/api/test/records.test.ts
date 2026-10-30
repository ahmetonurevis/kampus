import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, asc, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'
import { invoiceStatus } from '@kampus/school-core/lib/format.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { RECORD_COLLECTIONS, recordKey } from '../src/db/collections.ts'
import {
  findRecord,
  INVOICE_STATUS_LABELS,
  insertMissingRecords,
  loadRecords,
  writeRecords,
  type RecordFilter,
  type RecordWrite,
  type SearchMatch,
} from '../src/db/records.ts'
import { records } from '../src/db/schema/records.ts'
import { AppError, ConflictError, databaseErrorInfo } from '../src/errors.ts'
import { matchesSearch, searchKey, SQL_SAFE_NEEDLE } from '../src/services/collection-reads.ts'
import {
  dayRange,
  invoiceStatusFilter,
  invoiceStatusOf,
  istanbulDayStart,
  matchesRecordFilter,
} from '../src/services/list-filters.ts'
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
    assert.equal(revived?.kind, 'restore')
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

  test('gün başlangıcı Europe/Istanbul saatine göredir (yaz saati dönemi dahil)', () => {
    assert.equal(istanbulDayStart('2026-10-06'), '2026-10-05T21:00:00.000Z')
    assert.equal(istanbulDayStart('2026-01-01'), '2025-12-31T21:00:00.000Z')
    // 2016 öncesinde yaz saati vardı: 2015-07-01 UTC+3, 2015-01-01 UTC+2.
    assert.equal(istanbulDayStart('2015-07-01'), '2015-06-30T21:00:00.000Z')
    assert.equal(istanbulDayStart('2015-01-01'), '2014-12-31T22:00:00.000Z')
  })

  test('etkinlik ve gün aralığı süzgeci SQL ile bellekte aynı sonucu verir', async () => {
    const data: Record<string, Record<string, unknown>> = {
      'test-f-a': { date: '2026-10-05T20:59:59.999Z', isActive: true },
      'test-f-b': { date: '2026-10-05T21:00:00.000Z', isActive: false },
      'test-f-c': { date: '2026-10-06' },
      'test-f-d': { date: '2026-10-06T20:59:59.999Z', isActive: 'false' },
      'test-f-e': { date: '2026-10-06T21:00:00.000Z', isActive: null },
      'test-f-f': { date: '2026-10-06T12:00:00Z' },
      'test-f-g': { date: 'bozuk' },
      'test-f-h': { date: 20261006 },
      'test-f-i': { date: ['2026-10-06'] },
      'test-f-j': { date: '2026-10-07' },
      'test-f-k': {},
    }
    const id = await institutionWith(
      Object.entries(data).map(([key, extra]) => invoice(key, { studentId: 's1', ...extra })),
    )
    const filters: [string, RecordFilter][] = [
      ['etkin', { kind: 'active', field: 'isActive', active: true }],
      ['pasif', { kind: 'active', field: 'isActive', active: false }],
      ['tek gün', dayRange('date', '2026-10-06', '2026-10-06') ?? assert.fail()],
      ['başlangıçtan', dayRange('date', '2026-10-06', undefined) ?? assert.fail()],
      ['bitişe kadar', dayRange('date', undefined, '2026-10-05') ?? assert.fail()],
    ]
    const stored = await loadRecords(db, id, ['invoices'])
    for (const [label, filter] of filters) {
      const sqlIds = (await loadRecords(db, id, ['invoices'], { match: [filter] })).map((r) => r.id)
      const memoryIds = stored
        .filter((row) => matchesRecordFilter(row.data, filter))
        .map((r) => r.id)
      assert.deepEqual(sqlIds, memoryIds, label)
    }
    const only = async (filter: RecordFilter) =>
      (await loadRecords(db, id, ['invoices'], { match: [filter] })).map((row) => row.id)
    assert.deepEqual(await only(filters[2]?.[1] ?? assert.fail()), [
      'test-f-b',
      'test-f-c',
      'test-f-d',
    ])
    assert.deepEqual(await only(filters[1]?.[1] ?? assert.fail()), ['test-f-b'])
    assert.deepEqual(await only(filters[0]?.[1] ?? assert.fail()), [
      'test-f-a',
      'test-f-c',
      'test-f-d',
      'test-f-e',
      'test-f-f',
      'test-f-g',
      'test-f-h',
      'test-f-i',
      'test-f-j',
      'test-f-k',
    ])
  })

  test('gün aralığı seçilen alanda (paidAt, dueDate) SQL ile bellekte aynı sonucu verir', async () => {
    const shapes = [
      '2026-10-05T20:59:59.999Z',
      '2026-10-05T21:00:00.000Z',
      '2026-10-06',
      '2026-10-06T20:59:59.999Z',
      '2026-10-06T21:00:00.000Z',
      'bozuk',
      20261006,
      null,
      ['2026-10-06'],
    ]
    // Her alan kendi sütununda bütün biçimleri, diğer alan tarih olmayan bir değerle taşır.
    const items = (['paidAt', 'dueDate'] as const).flatMap((field) =>
      shapes.map((value, index) =>
        invoice(`test-${field}-${index}`, {
          dueDate: 'yok',
          paidAt: 'yok',
          [field]: value,
        }),
      ),
    )
    const id = await institutionWith(items)
    const stored = await loadRecords(db, id, ['invoices'])
    for (const field of ['paidAt', 'dueDate']) {
      for (const [from, to] of [
        ['2026-10-06', '2026-10-06'],
        ['2026-10-06', undefined],
        [undefined, '2026-10-05'],
      ] as const) {
        const filter = dayRange(field, from, to) ?? assert.fail()
        const sqlIds = (await loadRecords(db, id, ['invoices'], { match: [filter] })).map(
          (row) => row.id,
        )
        const memoryIds = stored
          .filter((row) => matchesRecordFilter(row.data, filter))
          .map((row) => row.id)
        assert.deepEqual(sqlIds, memoryIds, `${field} ${from} ${to}`)
        // Süzgeç yalnız kendi alanına bakar: diğer alanın değeri eşleşme üretmez.
        assert.ok(
          sqlIds.every((key) => key.startsWith(`test-${field}-`)),
          `${field} ${from} ${to}`,
        )
      }
    }
  })

  test('taksit durumu süzgeci SQL ile core invoiceStatus aynı sonucu verir; sınır günleri dahil', async () => {
    // FIXED_NOW 2026-10-06T09:00Z: Europe/Istanbul günü 2026-10-06, gün 2026-10-05T21:00Z'de başlar.
    const exact: Record<string, [Record<string, unknown>, string]> = {
      'test-s-dun': [{ dueDate: '2026-10-05' }, 'Gecikmiş'],
      'test-s-bugun': [{ dueDate: '2026-10-06' }, 'Yaklaşan'],
      'test-s-yarin': [{ dueDate: '2026-10-07' }, 'Yaklaşan'],
      'test-s-an-dun-son': [{ dueDate: '2026-10-05T20:59:59.999Z' }, 'Gecikmiş'],
      'test-s-an-bugun-ilk': [{ dueDate: '2026-10-05T21:00:00.000Z' }, 'Yaklaşan'],
      'test-s-an-bugun-son': [{ dueDate: '2026-10-06T20:59:59.999Z' }, 'Yaklaşan'],
      'test-s-odendi': [{ dueDate: '2026-10-01', paidAt: '2026-10-01T08:00:00.000Z' }, 'Ödendi'],
      'test-s-odendi-vadesiz': [{ dueDate: undefined, paidAt: '2026-10-01' }, 'Ödendi'],
      'test-s-bos-odeme': [{ dueDate: '2026-10-01', paidAt: '' }, 'Gecikmiş'],
      'test-s-yanlis-odeme': [{ dueDate: '2026-10-09', paidAt: false }, 'Yaklaşan'],
      'test-s-sifir-odeme': [{ dueDate: '2026-10-01', paidAt: 0 }, 'Gecikmiş'],
      // Metin olmayan doğru değerler core'da (`invoice.paidAt ?`) ve SQL'de ödenmiştir.
      'test-s-dizi-odeme': [{ dueDate: '2026-10-01', paidAt: [] }, 'Ödendi'],
      'test-s-nesne-odeme': [{ dueDate: '2026-10-01', paidAt: {} }, 'Ödendi'],
      'test-s-dogru-odeme': [{ dueDate: '2026-10-09', paidAt: true }, 'Ödendi'],
      'test-s-sayi-odeme': [{ dueDate: '2026-10-01', paidAt: 1 }, 'Ödendi'],
    }
    // Başka biçimli vade SQL'de adaydır; karar core'undur.
    const loose: Record<string, [Record<string, unknown>, string | null]> = {
      'test-s-bozuk': [{ dueDate: 'bozuk' }, null],
      'test-s-vadesiz': [{ dueDate: undefined }, null],
      'test-s-milisaniyesiz': [{ dueDate: '2026-10-05T20:59:59Z' }, 'Gecikmiş'],
      'test-s-sayi': [{ dueDate: Date.parse('2026-10-07T00:00:00.000Z') }, 'Yaklaşan'],
    }
    const id = await institutionWith(
      Object.entries({ ...exact, ...loose }).map(([key, [extra]]) => invoice(key, extra)),
    )
    const stored = await loadRecords(db, id, ['invoices'])
    const today = '2026-10-06'
    for (const row of stored) {
      const expected = (exact[row.id] ?? loose[row.id])?.[1]
      assert.equal(invoiceStatusOf(row.data, today), expected, row.id)
      const { paidAt, dueDate } = row.data
      if (row.id in exact)
        assert.equal(
          invoiceStatus(
            // Core'a kayıttaki değerin kendisi verilir: karar onun doğruluk değerlendirmesidir.
            { paidAt: (paidAt || null) as string | null, dueDate: String(dueDate) },
            today,
          ),
          expected,
          `core ${row.id}`,
        )
    }
    for (const label of INVOICE_STATUS_LABELS) {
      const filter = invoiceStatusFilter([label], FIXED_NOW)
      assert.equal(filter.today, today)
      assert.equal(filter.todayStart, '2026-10-05T21:00:00.000Z')
      const sqlIds = (await loadRecords(db, id, ['invoices'], { match: [filter] })).map((r) => r.id)
      const memoryIds = stored.filter((r) => matchesRecordFilter(r.data, filter)).map((r) => r.id)
      const isExact = (key: string) => key in exact
      assert.deepEqual(sqlIds.filter(isExact), memoryIds.filter(isExact), label)
      assert.ok(
        memoryIds.every((key) => sqlIds.includes(key)),
        `${label}: SQL bellekteki sonucun üst kümesi`,
      )
    }
    const both = invoiceStatusFilter(['Gecikmiş', 'Ödendi'], FIXED_NOW)
    const sqlBoth = (await loadRecords(db, id, ['invoices'], { match: [both] })).map((r) => r.id)
    assert.deepEqual(
      sqlBoth.filter((key) => key in exact),
      Object.keys(exact)
        .filter((key) => ['Gecikmiş', 'Ödendi'].includes(exact[key]?.[1] ?? ''))
        .sort((a, b) => sqlBoth.indexOf(a) - sqlBoth.indexOf(b)),
    )
    assert.deepEqual(
      await loadRecords(db, id, ['invoices'], { match: [invoiceStatusFilter([], FIXED_NOW)] }),
      [],
    )
  })

  test('alan ön süzgeci metin, sayı ve mantıksal değeri eşler; dizi alanı adaydır', async () => {
    const id = await institutionWith([
      invoice('test-inv-a', { studentId: 's1', installment: 1, paidAt: null }),
      invoice('test-inv-b', { studentId: 's2', installment: 2, waived: true }),
      invoice('test-inv-c', { studentId: ['s3'], installment: 3 }),
      invoice('test-inv-d', { studentId: undefined, installment: 10 }),
    ])
    const ids = async (match: { field: string; values: string[] }[]) =>
      (await loadRecords(db, id, ['invoices'], { match })).map((row) => row.id)

    assert.deepEqual(await ids([{ field: 'studentId', values: ['s1'] }]), [
      'test-inv-a',
      'test-inv-c',
    ])
    assert.deepEqual(await ids([{ field: 'installment', values: ['2', '10'] }]), [
      'test-inv-b',
      'test-inv-d',
    ])
    assert.deepEqual(await ids([{ field: 'waived', values: ['true'] }]), ['test-inv-b'])
    // Eksik alan ve null hiçbir değerle eşleşmez; boş değer listesinde yalnız dizi kalır.
    assert.deepEqual(await ids([{ field: 'paidAt', values: ['null'] }]), [])
    assert.deepEqual(await ids([{ field: 'studentId', values: [] }]), ['test-inv-c'])
    assert.deepEqual(
      await ids([
        { field: 'studentId', values: ['s1', 's2'] },
        { field: 'installment', values: ['2'] },
      ]),
      ['test-inv-b'],
    )
    // Alan adı da parametredir: tırnak veya işleç taşıyan ad yalnız eşleşmez.
    assert.deepEqual(await ids([{ field: "studentId' or '1'='1", values: ['s1'] }]), [])
  })

  describe('arama aday süzgeci (SQL)', () => {
    /** Katlamanın zor durumları: Türkçe harfler, aksan, ASCII dışı işaret, kaçış, üstel sayı. */
    const TEXTS: Record<string, Record<string, unknown>> = {
      'test-q-turkce': { name: 'İSTANBUL Işık ŞÜKRÜ Öğün Çağla IĞDIR', city: 'ığdır' },
      'test-q-buyuk': { name: 'MATEMATİK', other: 'matematık' },
      'test-q-aksan': { name: 'café résumé', composed: 'café Ångström' },
      // U+20D7 \p{M}'dir ama U+0300–U+036F dışındadır; Kelvin işareti NFD'de K olur.
      'test-q-isaret': { name: 'a⃗b Kelvin ﬁne ΣΟΦΙΑ Жук' },
      'test-q-kacis': { name: 'satır\nsonu\tsekme "tırnak" ters\\eğik' },
      'test-q-sayi': { big: 1e21, small: 1.5e-7, negative: -42, ratio: 0.1, number: 1234567 },
      'test-q-dizi': { tags: ['Etiket Bir', 'iki'], nested: { inner: 'ic-deger' }, flag: true },
      'test-q-gizli': { sharedNote: 'acik metin', internalNote: 'ozel-not' },
      'test-q-bos': {},
    }

    async function seeded() {
      return institutionWith(
        Object.entries(TEXTS).map(([id, data]) => ({
          collection: 'students' as const,
          id,
          data: { id, ...data },
        })),
      )
    }

    /** Kayıtların arama metinlerinden çıkan, SQL'e uygun bütün kısa alt dizgiler. */
    function needles(): string[] {
      const found = new Set<string>(['1e+21', '1.5e-7', 'e-7', '-7', 'e+', '-42', '0.1', ' '])
      for (const data of Object.values(TEXTS))
        for (const value of Object.values(data)) {
          const texts =
            typeof value === 'string'
              ? [value]
              : typeof value === 'number'
                ? [String(value)]
                : Array.isArray(value)
                  ? value.filter((item) => typeof item === 'string')
                  : []
          for (const text of texts) {
            const key = searchKey(text)
            for (let start = 0; start < key.length; start += 1)
              for (const length of [1, 2, 3, 5, 8])
                if (start + length <= key.length) found.add(key.slice(start, start + length))
          }
        }
      return [...found].filter((needle) => SQL_SAFE_NEEDLE.test(needle))
    }

    test('SQL adayı bellekteki searchKey eşleşmesinin üst kümesidir', async () => {
      const id = await seeded()
      const stored = await loadRecords(db, id, ['students'])
      const all = needles()
      assert.ok(all.length > 150, String(all.length))
      for (const needle of all) {
        const search: SearchMatch = { needle, exclude: [], keys: [] }
        const sqlIds = new Set(
          (await loadRecords(db, id, ['students'], { search })).map((row) => row.id),
        )
        for (const row of stored)
          if (matchesSearch(row.data, needle))
            assert.ok(sqlIds.has(row.id), `${JSON.stringify(needle)} ${row.id}`)
      }
      // Belirli durumlar bellekte de eşleşir (aday boş geçmez).
      const memory = (needle: string) =>
        stored.filter((row) => matchesSearch(row.data, needle)).map((row) => row.id)
      assert.deepEqual(memory('istanbul isik sukru ogun cagla igdir'), ['test-q-turkce'])
      assert.deepEqual(memory('ab kelvin'), ['test-q-isaret'])
      assert.deepEqual(memory('1e+21'), ['test-q-sayi'])
      assert.deepEqual(memory('e-7'), ['test-q-sayi'])
    })

    test('ayıklanan alan ve bağlı kimlik: aday yalnız görünen metinden ve verilen kimliklerden', async () => {
      const id = await seeded()
      const sqlIds = async (search: SearchMatch) =>
        (await loadRecords(db, id, ['students'], { search })).map((row) => row.id)
      assert.deepEqual(await sqlIds({ needle: 'ozel-not', exclude: [], keys: [] }), [
        'test-q-gizli',
      ])
      // İç not çıkarıldığında aday değildir (DOM-YTK-020); görünen alan yine aday üretir.
      const hidden = ['internalNote', 'notes']
      assert.deepEqual(await sqlIds({ needle: 'ozel-not', exclude: hidden, keys: [] }), [])
      assert.deepEqual(await sqlIds({ needle: 'acik metin', exclude: hidden, keys: [] }), [
        'test-q-gizli',
      ])
      // Bağlı ad eşleşen kimlik metinden bağımsız adaydır; boş kimlik listesi koşul eklemez.
      assert.deepEqual(
        await sqlIds({
          needle: 'hicbir-yerde-yok',
          exclude: [],
          keys: [
            { field: 'id', values: ['test-q-bos'] },
            { field: 'classId', values: [] },
          ],
        }),
        ['test-q-bos'],
      )
      // Aranan metin parametredir.
      assert.deepEqual(await sqlIds({ needle: "' or '1'='1", exclude: [], keys: [] }), [])
    })
  })
})
