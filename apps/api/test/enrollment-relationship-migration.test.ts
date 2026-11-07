import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

import { and, asc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

import { MIGRATIONS_FOLDER, schema, type Database } from '../src/db/client.ts'
import { records } from '../src/db/schema/records.ts'
import { buildTestApp, createInstitution, FIXED_NOW, newPGlite } from './support/app.ts'

// ON-127, DOM-KAY-012: veli yakınlığındaki eski `'guardian'` değeri migration 0062 ile
// `'legal_guardian'` olur. Migration'dan önceki şemaya eski değerli veli kayıtları yazılır, kalan
// migration'lar uygulanır; dönüşüm ve tekrar çalıştırmanın bir şey değiştirmediği sınanır.

const SLOW = { timeout: 180_000 }
const TAG = '0062_rename_parent_relationship_legal_guardian'
const PREVIOUS_TAG = '0061_create_contracts_invoices'

interface Journal {
  entries: { tag: string }[]
}

/** Yalnız `lastTag`'e kadarki migration'ları içeren geçici klasör. */
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

describe('0062: veli yakınlığı guardian → legal_guardian', SLOW, () => {
  const client = newPGlite()
  const pglite = drizzle({ client, schema })
  const db: Database = pglite
  let folder: string

  before(async () => {
    folder = await migrationsUpTo(PREVIOUS_TAG)
    await migrate(pglite, { migrationsFolder: folder })
  })
  after(async () => {
    await client.close()
    await rm(folder, { recursive: true, force: true })
  })

  test('ON-127, DOM-KAY-012: eski guardian yakınlığı legal_guardian olur, sürüm artar; diğer kayıtlar ve tekrar çalıştırma değişmez', async () => {
    const app = await buildTestApp(db)
    try {
      const a = await createInstitution(app, { academicYear: null })
      const b = await createInstitution(app, { academicYear: null })
      const parent = (id: string, relationship?: string) => ({
        id,
        name: `Veli ${id}`,
        studentIds: [],
        phone: '05559990127',
        ...(relationship === undefined ? {} : { relationship }),
      })
      const rows = [
        // Yeniden adlandırmadan önce kesin kayıtla açılmış vasi veli kayıtları (iki kurumda).
        {
          institutionId: a.id,
          collection: 'parents',
          id: 'p-eski',
          data: parent('p-eski', 'guardian'),
        },
        {
          institutionId: b.id,
          collection: 'parents',
          id: 'p-eski-b',
          data: parent('p-eski-b', 'guardian'),
        },
        {
          institutionId: a.id,
          collection: 'parents',
          id: 'p-arsiv',
          data: parent('p-arsiv', 'guardian'),
          archived: true,
        },
        // Dokunulmayacaklar: başka yakınlıklar, yakınlığı olmayan veli, kursiyerin kendisi.
        {
          institutionId: a.id,
          collection: 'parents',
          id: 'p-anne',
          data: parent('p-anne', 'mother'),
        },
        {
          institutionId: a.id,
          collection: 'parents',
          id: 'p-vasi',
          data: parent('p-vasi', 'legal_guardian'),
        },
        {
          institutionId: a.id,
          collection: 'parents',
          id: 'p-self',
          data: parent('p-self', 'self'),
        },
        { institutionId: a.id, collection: 'parents', id: 'p-yok', data: parent('p-yok') },
        // Başka koleksiyonda aynı adlı alan veli yakınlığı değildir.
        {
          institutionId: a.id,
          collection: 'contracts',
          id: 'k-1',
          data: { id: 'k-1', payer: 'guardian', relationship: 'guardian' },
        },
      ]
      for (const [index, row] of rows.entries())
        await db.execute(
          sql`insert into records (institution_id, collection, id, data, position, created_at, updated_at, archived_at) values (${row.institutionId}, ${row.collection}, ${row.id}, ${JSON.stringify(row.data)}::jsonb, ${(index + 1) * 1024}, ${FIXED_NOW}, ${FIXED_NOW}, ${'archived' in row ? FIXED_NOW : null})`,
        )

      const snapshot = () =>
        db
          .select()
          .from(records)
          .where(sql`${records.institutionId} in (${a.id}, ${b.id})`)
          .orderBy(asc(records.institutionId), asc(records.collection), asc(records.id))
      const before = await snapshot()

      await migrate(pglite, { migrationsFolder: MIGRATIONS_FOLDER })

      const migrated = await snapshot()
      const byId = new Map(migrated.map((row) => [row.id, row]))
      const relationshipOf = (id: string) =>
        (byId.get(id)?.data as { relationship?: string } | undefined)?.relationship
      for (const id of ['p-eski', 'p-eski-b', 'p-arsiv']) {
        assert.equal(relationshipOf(id), 'legal_guardian', id)
        assert.equal(byId.get(id)?.version, 2, id)
        assert.notEqual(byId.get(id)?.updatedAt.getTime(), FIXED_NOW.getTime(), id)
      }
      // Kaydın diğer alanları korunur; arşivli kayıt arşivde kalır.
      assert.deepEqual(byId.get('p-eski')?.data, parent('p-eski', 'legal_guardian'))
      assert.ok(byId.get('p-arsiv')?.archivedAt)
      const changed = new Set(['p-eski', 'p-eski-b', 'p-arsiv'])
      assert.deepEqual(
        migrated.filter((row) => !changed.has(row.id)),
        before.filter((row) => !changed.has(row.id)),
      )

      // İdempotent: aynı SQL yeniden çalışınca hiçbir satır (veri, sürüm, zaman) değişmez.
      const statement = await readFile(path.join(MIGRATIONS_FOLDER, `${TAG}.sql`), 'utf8')
      await db.execute(sql.raw(statement))
      assert.deepEqual(await snapshot(), migrated)

      // Eski değerli kayıt kalmadı.
      const left = await db
        .select({ id: records.id })
        .from(records)
        .where(
          and(
            eq(records.collection, 'parents'),
            sql`${records.data} ->> 'relationship' = 'guardian'`,
          ),
        )
      assert.deepEqual(left, [])
    } finally {
      await app.close()
    }
  })
})
