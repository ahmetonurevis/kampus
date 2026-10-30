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
import { records } from '../src/db/schema/records.ts'
import { buildTestApp, createInstitution, FIXED_NOW } from './support/app.ts'

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
    folder = await migrationsUpTo('0002_create_records')
    await migrate(pglite, { migrationsFolder: folder })
  })
  after(async () => {
    await client.close()
    await rm(folder, { recursive: true, force: true })
  })

  test('0003: mevcut sıra korunarak numaralanır; tohum sırayı veri ve sürüme dokunmadan core dizisine eşitler', async () => {
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

      await migrate(pglite, { migrationsFolder: MIGRATIONS_FOLDER })

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
