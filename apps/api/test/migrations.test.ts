import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

import { asc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

import { MIGRATIONS_FOLDER, schema, type Database } from '../src/db/client.ts'
import { stateRecords, demoState } from '../src/db/demo-seed.ts'
import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { records } from '../src/db/schema/records.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  newPGlite,
} from './support/app.ts'
import { seedResource } from './support/resources-sample.ts'

interface Journal {
  entries: { tag: string }[]
}

/** Yalnız `lastTag`'e kadarki migration'ları içeren geçici klasör: veri dönüştüren adımı sınamak için. */
async function migrationsUpTo(lastTag: string): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), 'kampus-migrations-'))
  const journal: Journal = JSON.parse(
    await readFile(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
  )
  const last = journal.entries.findIndex((entry) => entry.tag === lastTag)
  assert.ok(last >= 0, `${lastTag} yok`)
  const entries = journal.entries.slice(0, last + 1)
  await mkdir(path.join(folder, 'meta'))
  await writeFile(
    path.join(folder, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries }),
  )
  for (const entry of entries)
    await copyFile(
      path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`),
      path.join(folder, `${entry.tag}.sql`),
    )
  return folder
}

describe('veri dönüştüren migration’lar', () => {
  const client = newPGlite()
  const pglite = drizzle({ client, schema })
  const db: Database = pglite
  let folder: string

  before(async () => {
    folder = await migrationsUpTo('0003_create_institution_settings')
    await migrate(pglite, { migrationsFolder: folder })
  })
  after(async () => {
    await client.close()
    await rm(folder, { recursive: true, force: true })
  })

  test('0004–0005: mevcut sıra korunarak numaralanır; tohum sırayı veri ve sürüme dokunmadan core dizisine eşitler; core denetimi arşivlenir', async () => {
    const app = await buildTestApp(db)
    try {
      const { id } = await createInstitution(app)
      const items = stateRecords(demoState('akademi', FIXED_NOW)).filter(
        (item) => item.collection === 'students' || item.collection === 'invoices',
      )
      // Eski tohum: sıra kolonu yokken tek çok satırlı ekleme, core sırasında.
      for (let start = 0; start < items.length; start += 1000) {
        const values = items
          .slice(start, start + 1000)
          .map(
            (item) =>
              sql`(${id}, ${item.collection}, ${item.id}, ${JSON.stringify(item.data)}::jsonb, ${FIXED_NOW}, ${FIXED_NOW})`,
          )
        await db.execute(
          sql`insert into records (institution_id, collection, id, data, created_at, updated_at) values ${sql.join(values, sql`, `)}`,
        )
      }
      const updated = items.find((item) => item.collection === 'students')
      assert.ok(updated)
      await db.execute(
        sql`update records set data = data || '{"progress": 1}'::jsonb, version = version + 1 where institution_id = ${id} and collection = 'students' and id = ${updated.id}`,
      )

      // Eski sürümün yazdığı core denetim satırı (değerleri maskesiz).
      await db.execute(
        sql`insert into records (institution_id, collection, id, data, created_at, updated_at) values (${id}, 'audit', 'audit-legacy', '{"id": "audit-legacy"}'::jsonb, ${FIXED_NOW}, ${FIXED_NOW})`,
      )

      await migrate(pglite, { migrationsFolder: MIGRATIONS_FOLDER })

      // 0005: core denetim satırları arşivlenir ve yüklenmez.
      assert.deepEqual(await loadRecords(db, id, ['audit']), [])
      const [legacy] = await loadRecords(db, id, ['audit'], { includeArchived: true })
      assert.equal(legacy?.version, 2)
      assert.ok(legacy?.archivedAt)

      // Dolgu, sıra kolonundan önceki yükleme sırasını (kimlik) korur; core sırası SQL'de bilinmez.
      const coreOrder = (collection: string) =>
        items.filter((item) => item.collection === collection).map((item) => item.id)
      for (const collection of ['students', 'invoices'] as const)
        assert.deepEqual(
          (await loadRecords(db, id, [collection])).map((row) => row.id),
          coreOrder(collection).sort(),
        )

      // Tohumu yeniden çalıştırmak yalnız sırası bozuk satırı düzeltir; veri ve sürüm değişmez.
      const snapshot = () =>
        db
          .select()
          .from(records)
          .where(eq(records.institutionId, id))
          .orderBy(asc(records.collection), asc(records.id))
      const before = await snapshot()
      assert.equal(await insertMissingRecords(db, id, items, FIXED_NOW), 0)
      const afterSeed = await snapshot()
      for (const collection of ['students', 'invoices'] as const)
        assert.deepEqual(
          (await loadRecords(db, id, [collection])).map((row) => row.id),
          coreOrder(collection),
        )
      assert.deepEqual(
        afterSeed.map((row) => ({ ...row, position: 0 })),
        before.map((row) => ({ ...row, position: 0 })),
      )
      assert.equal(await insertMissingRecords(db, id, items, FIXED_NOW), 0)
      assert.deepEqual(await snapshot(), afterSeed)
    } finally {
      await app.close()
    }
  })
})

describe('0007: veli kimliği olmayan yazışmaların doldurulması', () => {
  const client = newPGlite()
  const pglite = drizzle({ client, schema })
  const db: Database = pglite
  let folder: string

  before(async () => {
    folder = await migrationsUpTo('0006_create_idempotency_keys')
    await migrate(pglite, { migrationsFolder: folder })
  })
  after(async () => {
    await client.close()
    await rm(folder, { recursive: true, force: true })
  })

  test('tek veli hesabı olan öğrencinin eski yazışması o hesapla dolar; iki veya sıfır hesapta boş kalır', async () => {
    const app = await buildTestApp(db)
    try {
      const { id } = await createInstitution(app)
      const only = await createMember(app, id, 'veli', [{ kind: 'child', recordId: 's1' }])
      await createMember(app, id, 'veli', [{ kind: 'child', recordId: 's2' }])
      await createMember(app, id, 'veli', [{ kind: 'child', recordId: 's2' }])
      const conversation = (key: string, studentId: string, extra: Record<string, unknown>) => ({
        id: key,
        data: { id: key, studentId, teacherId: 't1', audience: 'parent', messages: [], ...extra },
      })
      const rows = [
        conversation('conv-tek', 's1', {}),
        conversation('conv-iki', 's2', {}),
        conversation('conv-yok', 's3', {}),
        conversation('conv-dolu', 's1', { parentUserId: 'u-baska' }),
        conversation('conv-ogrenci', 's1', { audience: 'student' }),
      ]
      for (const row of rows)
        await db.execute(
          sql`insert into records (institution_id, collection, id, data, position, created_at, updated_at) values (${id}, 'conversations', ${row.id}, ${JSON.stringify(row.data)}::jsonb, 1024, ${FIXED_NOW}, ${FIXED_NOW})`,
        )

      // Yalnız 0007; 0009 gömülü mesaj dizisini kaldırıp sürümü artırır (ayrı test).
      const upTo0007 = await migrationsUpTo('0007_backfill_conversation_parent_user')
      try {
        await migrate(pglite, { migrationsFolder: upTo0007 })
      } finally {
        await rm(upTo0007, { recursive: true, force: true })
      }

      const stored = new Map(
        (await loadRecords(db, id, ['conversations'])).map((row) => [row.id, row]),
      )
      const parentOf = (key: string) => stored.get(key)?.data.parentUserId
      assert.equal(parentOf('conv-tek'), only.id)
      assert.equal(stored.get('conv-tek')?.version, 2)
      assert.equal(parentOf('conv-iki'), undefined)
      assert.equal(parentOf('conv-yok'), undefined)
      assert.equal(parentOf('conv-dolu'), 'u-baska')
      assert.equal(parentOf('conv-ogrenci'), undefined)
      for (const key of ['conv-iki', 'conv-yok', 'conv-dolu', 'conv-ogrenci'])
        assert.equal(stored.get(key)?.version, 1, key)
    } finally {
      await app.close()
    }
  })
})

describe('0008: denetim kaydı gerekçe kolonu', () => {
  const client = newPGlite()
  const pglite = drizzle({ client, schema })
  const db: Database = pglite
  let folder: string

  before(async () => {
    folder = await migrationsUpTo('0007_backfill_conversation_parent_user')
    await migrate(pglite, { migrationsFolder: folder })
  })
  after(async () => {
    await client.close()
    await rm(folder, { recursive: true, force: true })
  })

  test('yazışma erişim gerekçesi changes içinden reason kolonuna taşınır; diğer kayıtlar değişmez; 500 karakter sınırı', async () => {
    const REASON = 'Veli şikâyeti üzerine inceleme'
    const insert = (action: string, changes: unknown) =>
      db.execute(
        sql`insert into audit_log (action, entity_type, entity_id, changes) values (${action}, 'conversations', 'conv-1', ${JSON.stringify(changes)}::jsonb)`,
      )
    await insert('conversation.access', { reason: REASON })
    await insert('conversation.access', { reason: REASON, fields: ['messages'] })
    await insert('message.send', { fields: ['messages'] })

    await migrate(pglite, { migrationsFolder: MIGRATIONS_FOLDER })

    const rows = await db
      .select({ action: auditLog.action, reason: auditLog.reason, changes: auditLog.changes })
      .from(auditLog)
      .orderBy(auditLog.id)
    const access = rows.filter((row) => row.action === 'conversation.access')
    assert.deepEqual(
      access.map((row) => row.reason),
      [REASON, REASON],
    )
    assert.deepEqual(
      access.map((row) => row.changes).sort(),
      [null, { fields: ['messages'] }].sort(),
    )
    const other = rows.find((row) => row.action === 'message.send')
    assert.equal(other?.reason, null)
    assert.deepEqual(other?.changes, { fields: ['messages'] })

    // Gerekçe en çok 500 karakter (core şemasıyla aynı sınır).
    await db.execute(
      sql`insert into audit_log (action, reason) values ('conversation.access', ${'x'.repeat(500)})`,
    )
    await assert.rejects(
      db.execute(
        sql`insert into audit_log (action, reason) values ('conversation.access', ${'x'.repeat(501)})`,
      ),
    )
  })
})

describe('0009: yazışma mesajlarının ayrı kayıtlara bölünmesi', () => {
  const client = newPGlite()
  const pglite = drizzle({ client, schema })
  const db: Database = pglite
  let folder: string

  before(async () => {
    folder = await migrationsUpTo('0008_add_audit_log_reason')
    await migrate(pglite, { migrationsFolder: folder })
  })
  after(async () => {
    await client.close()
    await rm(folder, { recursive: true, force: true })
  })

  test('mesajlar kimlik ve sırayla bölünür, taraf anahtarlarını taşır; dizi kalkar, son mesaj anı yazılır; tekrar etkisiz; taşınamayan öğe veri kaybettirmez', async () => {
    const app = await buildTestApp(db)
    try {
      const { id } = await createInstitution(app)
      const message = (key: string, sender: string, date: string, extra = {}) => ({
        id: key,
        text: `Metin ${key}`,
        sender,
        date,
        ...extra,
      })
      const rows = [
        {
          id: 'conv-b',
          position: 2048,
          archived: false,
          data: {
            id: 'conv-b',
            studentId: 's1',
            teacherId: 't1',
            audience: 'parent',
            parentUserId: 'u-veli',
            createdAt: '2026-10-01T08:00:00.000Z',
            messages: [
              message('b-1', 'parent', '2026-10-02T08:00:00.000Z', { senderUserId: 'u-veli' }),
              message('b-2', 'teacher', '2026-10-03T08:00:00.000Z', {
                readAt: '2026-10-03T09:00:00.000Z',
              }),
            ],
          },
        },
        {
          id: 'conv-a',
          position: 1024,
          archived: false,
          data: {
            id: 'conv-a',
            studentId: 's2',
            teacherId: 't1',
            audience: 'student',
            messages: [message('a-1', 'student', '2026-10-04T08:00:00.000Z')],
          },
        },
        {
          id: 'conv-bos',
          position: 3072,
          archived: false,
          data: {
            id: 'conv-bos',
            studentId: 's3',
            teacherId: 't1',
            audience: 'student',
            messages: [],
          },
        },
        {
          id: 'conv-arsiv',
          position: 4096,
          archived: true,
          data: {
            id: 'conv-arsiv',
            studentId: 's4',
            teacherId: 't1',
            audience: 'student',
            messages: [message('arsiv-1', 'teacher', '2026-09-01T08:00:00.000Z')],
          },
        },
        {
          // Kimliksiz öğe taşınamaz: dizi yerinde kalır, hiçbir mesajı kaybolmaz.
          id: 'conv-bozuk',
          position: 5120,
          archived: false,
          data: {
            id: 'conv-bozuk',
            studentId: 's5',
            teacherId: 't1',
            audience: 'student',
            messages: [message('bozuk-1', 'student', '2026-10-05T08:00:00.000Z'), { text: 'x' }],
          },
        },
      ]
      for (const row of rows)
        await db.execute(
          sql`insert into records (institution_id, collection, id, data, position, created_at, updated_at, archived_at) values (${id}, 'conversations', ${row.id}, ${JSON.stringify(row.data)}::jsonb, ${row.position}, ${FIXED_NOW}, ${FIXED_NOW}, ${row.archived ? FIXED_NOW : null})`,
        )

      await migrate(pglite, { migrationsFolder: MIGRATIONS_FOLDER })

      const stored = await loadRecords(db, id, ['conversations', 'conversationMessages'], {
        includeArchived: true,
      })
      const conversations = new Map(
        stored.filter((r) => r.collection === 'conversations').map((r) => [r.id, r]),
      )
      const messages = stored.filter((r) => r.collection === 'conversationMessages')
      // Kurum içinde yazışma sırası (position), sonra dizideki sıra.
      assert.deepEqual(
        messages.map((r) => r.id),
        ['a-1', 'b-1', 'b-2', 'arsiv-1', 'bozuk-1'],
      )
      assert.deepEqual(messages.find((r) => r.id === 'b-1')?.data, {
        id: 'b-1',
        text: 'Metin b-1',
        sender: 'parent',
        senderUserId: 'u-veli',
        date: '2026-10-02T08:00:00.000Z',
        conversationId: 'conv-b',
        studentId: 's1',
        teacherId: 't1',
        audience: 'parent',
        parentUserId: 'u-veli',
      })
      assert.equal(messages.find((r) => r.id === 'b-2')?.data.readAt, '2026-10-03T09:00:00.000Z')
      assert.equal('parentUserId' in (messages.find((r) => r.id === 'a-1')?.data ?? {}), false)
      assert.notEqual(messages.find((r) => r.id === 'arsiv-1')?.archivedAt, null)
      assert.equal(messages.find((r) => r.id === 'a-1')?.archivedAt, null)

      const b = conversations.get('conv-b')
      assert.deepEqual(b?.data, {
        id: 'conv-b',
        studentId: 's1',
        teacherId: 't1',
        audience: 'parent',
        parentUserId: 'u-veli',
        createdAt: '2026-10-01T08:00:00.000Z',
        lastMessageAt: '2026-10-03T08:00:00.000Z',
      })
      assert.equal(b?.version, 2)
      assert.equal(conversations.get('conv-a')?.data.lastMessageAt, '2026-10-04T08:00:00.000Z')
      const empty = conversations.get('conv-bos')?.data
      assert.equal(empty !== undefined && ('messages' in empty || 'lastMessageAt' in empty), false)
      assert.equal('messages' in (conversations.get('conv-arsiv')?.data ?? {}), false)
      const broken = conversations.get('conv-bozuk')
      assert.equal(Array.isArray(broken?.data.messages), true)
      assert.equal(broken?.version, 1)

      // Tekrar çalıştırmak (dizisi kalmamış kayıtlarda) hiçbir şeyi değiştirmez.
      const statements = (
        await readFile(path.join(MIGRATIONS_FOLDER, '0009_split_conversation_messages.sql'), 'utf8')
      )
        .split('--> statement-breakpoint')
        .filter((statement) => !/CREATE INDEX/.test(statement))
      for (const statement of statements) await db.execute(sql.raw(statement))
      const again = await loadRecords(db, id, ['conversations', 'conversationMessages'], {
        includeArchived: true,
      })
      assert.deepEqual(
        again.map((r) => [r.collection, r.id, r.version, r.position]),
        stored.map((r) => [r.collection, r.id, r.version, r.position]),
      )
    } finally {
      await app.close()
    }
  })
})

describe('0010–0012: içerik havuzu tabloları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: Awaited<ReturnType<typeof buildTestApp>>

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  /** Sürücüden bağımsız `execute` sonucu: PGlite ve node-postgres ikisi de `rows` döndürür. */
  const rows = async <T>(query: ReturnType<typeof sql>) =>
    ((await db.execute(query)) as unknown as { rows: T[] }).rows

  test('arama indeksi kurumla başlayan bileşik GIN; her indeks institution_id ile başlar; btree_gin kurulu', async () => {
    const extensions = await rows<{ extname: string }>(
      sql`select extname from pg_extension where extname = 'btree_gin'`,
    )
    assert.equal(extensions.length, 1)
    const indexes = await rows<{ indexname: string; indexdef: string }>(
      sql`select indexname, indexdef from pg_indexes
          where tablename in ('resources', 'resource_versions', 'resource_version_outcomes',
            'resource_version_items', 'resource_shares')
          order by indexname`,
    )
    assert.ok(indexes.length >= 10)
    for (const index of indexes)
      assert.match(index.indexdef, /\(institution_id[,)]/, `${index.indexname} kurumla başlamalı`)
    const search = indexes.find((index) => index.indexname === 'resource_versions_search_idx')
    assert.match(search?.indexdef ?? '', /USING gin \(institution_id, search_vector\)/)
  })

  test('DOM-KYN-051: kısıtlar başka kurumun sürümüne bağlanmayı, içeriksiz canlı sürümü ve ikinci açık taslağı reddeder', async () => {
    const a = await createInstitution(app)
    const b = await createInstitution(app)
    const owner = a.admin.id
    const { resource, versions } = await seedResource(db, a.id, {
      ownerUserId: owner,
      versions: [{ status: 'published' }, { status: 'draft' }],
    })
    const published = versions[0]!
    const stored = await rows<{ current_version_id: string; license_kind: string }>(
      sql`select r.current_version_id, v.license_kind from resources r
          join resource_versions v on v.institution_id = r.institution_id and v.id = r.current_version_id
          where r.institution_id = ${a.id} and r.id = ${resource.id}`,
    )
    assert.deepEqual(stored, [
      { current_version_id: published.id, license_kind: 'institution_original' },
    ])

    const violates = async (query: ReturnType<typeof sql>, constraint: string) => {
      await assert.rejects(db.execute(query), (error: unknown) => {
        const cause = (error as { cause?: { constraint?: string } }).cause
        assert.equal(cause?.constraint ?? (error as { constraint?: string }).constraint, constraint)
        return true
      })
    }
    // Başka kurumun sürümünü güncel yapmak: bileşik yabancı anahtar.
    const { resource: other } = await seedResource(db, b.id, { ownerUserId: b.admin.id })
    await violates(
      sql`update resources set current_version_id = ${published.id}
          where institution_id = ${b.id} and id = ${other.id}`,
      'resources_current_version_fkey',
    )
    await violates(
      sql`update resource_versions set content = null
          where institution_id = ${a.id} and id = ${published.id}`,
      'resource_versions_content_check',
    )
    await violates(
      sql`insert into resource_versions (institution_id, id, resource_id, version_number, status,
            author_user_id, title, content, search_vector)
          values (${a.id}, gen_random_uuid(), ${resource.id}, 3, 'rejected', ${owner}, 'Başlık',
            '{"type":"text","body":"x","fileId":null}', to_tsvector('simple', 'baslik'))`,
      'resource_versions_editable_key',
    )
    await violates(
      sql`update resource_versions set status = 'published', published_at = null
          where institution_id = ${a.id} and id = ${versions[1]!.id}`,
      'resource_versions_published_check',
    )
    // 0012: sözlük kolonları core sabitleriyle sınırlı; türetilmiş lisans türü dahil.
    for (const [assignment, constraint] of [
      [sql`activity_mode = 'dance'`, 'resource_versions_activity_mode_check'],
      [sql`interaction_channel = 'telepathy'`, 'resource_versions_interaction_channel_check'],
      [sql`license = '{"kind":"stolen"}'::jsonb`, 'resource_versions_license_kind_check'],
    ] as const)
      await violates(
        sql`update resource_versions set ${assignment}
            where institution_id = ${a.id} and id = ${published.id}`,
        constraint,
      )
    await db.execute(
      sql`update resource_versions set activity_mode = 'mediation', interaction_channel = 'online',
            license = null
          where institution_id = ${a.id} and id = ${versions[1]!.id}`,
    )
  })
})

describe('0013: beceri görevi tabloları', () => {
  const skillTables = [
    'rubrics',
    'rubric_versions',
    'task_assignments',
    'task_assignment_targets',
    'task_attempts',
    'task_submissions',
    'submission_versions',
    'submission_drafts',
    'resubmission_requests',
    'rubric_scores',
    'second_rating_requests',
    'score_appeals',
    'score_transfers',
  ]
  let db: Database
  let close: () => Promise<void>

  before(async () => {
    ;({ db, close } = await createTestDatabase())
  })
  after(async () => {
    await close()
  })

  const rows = async <T>(query: ReturnType<typeof sql>) =>
    ((await db.execute(query)) as unknown as { rows: T[] }).rows
  const tableList = sql.join(
    skillTables.map((table) => sql`${table}`),
    sql`, `,
  )

  test('her tabloda kurum kolonları zorunlu; zaman kolonları timestamptz', async () => {
    const columns = await rows<{
      table_name: string
      column_name: string
      data_type: string
      is_nullable: 'YES' | 'NO'
    }>(
      sql`select table_name, column_name, data_type, is_nullable from information_schema.columns
          where table_schema = 'public' and table_name in (${tableList})`,
    )
    for (const table of skillTables) {
      const own = columns.filter((column) => column.table_name === table)
      assert.ok(own.length > 0, `${table} yok`)
      const byName = new Map(own.map((column) => [column.column_name, column]))
      for (const required of ['institution_id', 'created_at', 'updated_at', 'version'])
        assert.equal(byName.get(required)?.is_nullable, 'NO', `${table}.${required} zorunlu`)
      assert.equal(byName.get('archived_at')?.is_nullable, 'YES', `${table}.archived_at`)
      for (const column of own)
        assert.notEqual(
          column.data_type,
          'timestamp without time zone',
          `${table}.${column.column_name} timestamptz olmalı`,
        )
    }
  })

  test('her indeks institution_id ile başlar ve <tablo>_…_idx|_key|_pkey adını taşır', async () => {
    const indexes = await rows<{ tablename: string; indexname: string; indexdef: string }>(
      sql`select tablename, indexname, indexdef from pg_indexes
          where schemaname = 'public' and tablename in (${tableList})`,
    )
    assert.ok(indexes.length >= skillTables.length * 2)
    for (const index of indexes) {
      assert.match(index.indexdef, /\(institution_id[,)]/, `${index.indexname} kurumla başlamalı`)
      assert.ok(index.indexname.startsWith(`${index.tablename}_`), index.indexname)
      assert.match(index.indexname, /_(idx|key|pkey)$/, index.indexname)
    }
  })

  test('kısıt adları türüne uygun; her yabancı anahtar institution_id ile başlar ve bir indeksin önekidir', async () => {
    const constraints = await rows<{
      table_name: string
      conname: string
      contype: string
      columns: string[]
    }>(
      sql`select c.conrelid::regclass::text as table_name, c.conname, c.contype::text as contype,
            coalesce(array(select a.attname::text from unnest(c.conkey) with ordinality k(attnum, n)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
              order by k.n), '{}') as columns
          from pg_constraint c
          where c.conrelid::regclass::text in (${tableList}) and c.contype in ('p', 'u', 'f', 'c')`,
    )
    const indexColumns = await rows<{ table_name: string; columns: string[] }>(
      sql`select i.indrelid::regclass::text as table_name,
            array(select a.attname::text from unnest(i.indkey) with ordinality k(attnum, n)
              join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
              order by k.n) as columns
          from pg_index i where i.indrelid::regclass::text in (${tableList})`,
    )
    const suffix: Record<string, RegExp> = {
      p: /_pkey$/,
      u: /_key$/,
      f: /(_fkey|_institution_id_institutions_id_fk)$/,
      c: /_check$/,
    }
    let foreignKeys = 0
    for (const constraint of constraints) {
      assert.ok(constraint.conname.startsWith(`${constraint.table_name}_`), constraint.conname)
      assert.match(constraint.conname, suffix[constraint.contype]!, constraint.conname)
      if (constraint.contype !== 'f') continue
      foreignKeys += 1
      assert.equal(constraint.columns[0], 'institution_id', `${constraint.conname} kurumla başlar`)
      const covered = indexColumns.some(
        (index) =>
          index.table_name === constraint.table_name &&
          constraint.columns.every((column, position) => index.columns[position] === column),
      )
      assert.ok(covered, `${constraint.conname} indeksli olmalı`)
    }
    assert.ok(foreignKeys >= 30, `yabancı anahtar sayısı ${foreignKeys}`)
  })

  test('DOM-BEC-040, 060: değişmez dört tabloda satır ve truncate tetikleyicisi kurulu, etkin ve ortak fonksiyonu çağırır', async () => {
    const triggers = await rows<{
      table_name: string
      tgname: string
      tgtype: number
      tgenabled: string
      proname: string
    }>(
      sql`select c.relname::text as table_name, t.tgname::text as tgname, t.tgtype::int as tgtype,
            t.tgenabled::text as tgenabled, p.proname::text as proname
          from pg_trigger t
          join pg_class c on c.oid = t.tgrelid
          join pg_proc p on p.oid = t.tgfoid
          where not t.tgisinternal and c.relname in (${tableList})
          order by c.relname, t.tgname`,
    )
    // pg_trigger.tgtype bitleri: ROW 1, BEFORE 2, DELETE 8, UPDATE 16, TRUNCATE 32.
    const ROW_UPDATE_DELETE = 1 | 2 | 8 | 16
    const STATEMENT_TRUNCATE = 2 | 32
    const immutableTables = [
      'resubmission_requests',
      'rubric_scores',
      'score_transfers',
      'submission_versions',
    ]
    assert.deepEqual(
      triggers.map(({ table_name, tgname, tgtype }) => [table_name, tgname, tgtype]),
      immutableTables.flatMap((table) => [
        [table, `${table}_immutable_trigger`, ROW_UPDATE_DELETE],
        [table, `${table}_truncate_trigger`, STATEMENT_TRUNCATE],
      ]),
    )
    for (const trigger of triggers) {
      assert.equal(trigger.tgenabled, 'O', `${trigger.tgname} etkin olmalı`)
      assert.equal(trigger.proname, 'kampus_reject_immutable_change')
    }
  })

  test('migration ikinci kez uygulanınca hiçbir adım yeniden çalışmaz', async () => {
    const client = newPGlite()
    try {
      const fresh = drizzle({ client, schema })
      await migrate(fresh, { migrationsFolder: MIGRATIONS_FOLDER })
      const count = async () =>
        (
          (await fresh.execute(
            sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
          )) as unknown as { rows: { n: number }[] }
        ).rows[0]!.n
      const first = await count()
      const journal: Journal = JSON.parse(
        await readFile(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
      )
      assert.equal(first, journal.entries.length)
      assert.equal(journal.entries.at(-1)?.tag, '0013_create_skill_tasks')
      await migrate(fresh, { migrationsFolder: MIGRATIONS_FOLDER })
      assert.equal(await count(), first)
    } finally {
      await client.close()
    }
  })
})
