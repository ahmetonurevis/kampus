import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'
import { asc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

import { MIGRATIONS_FOLDER, schema, type Database } from '../src/db/client.ts'
import { stateRecords, demoState } from '../src/db/demo-seed.ts'
import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { records } from '../src/db/schema/records.ts'
import { buildTestApp, createInstitution, createMember, FIXED_NOW } from './support/app.ts'

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
  const client = new PGlite()
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
  const client = new PGlite()
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

      await migrate(pglite, { migrationsFolder: MIGRATIONS_FOLDER })

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
  const client = new PGlite()
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
