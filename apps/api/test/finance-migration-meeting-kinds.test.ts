import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

import { MIGRATIONS_FOLDER, schema, type Database } from '../src/db/client.ts'
import { buildTestApp, createInstitution, newPGlite } from './support/app.ts'

// ON-218 (DOM-FIN-135, K-460): `add_meeting_kinds` migration'ı mevcut zümre tutanaklarını
// (kesinleşmiş olanlar dahil) `department` kurul türüne taşır; kesinleşmiş tutanak tetikleyicisi
// çalışmaz, satır değişmez. Migration numarası birleştirmede değişebildiği için adından bulunur.

const SLOW = { timeout: 180_000 }
const TAG_SUFFIX = '_add_meeting_kinds'

interface Journal {
  entries: { tag: string }[]
}

async function journal(): Promise<Journal> {
  return JSON.parse(await readFile(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'))
}

/** Yalnız ilk `count` migration'ı içeren geçici klasör. */
async function firstMigrations(count: number): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), 'kampus-migrations-'))
  const full = await journal()
  const entries = full.entries.slice(0, count)
  await mkdir(path.join(folder, 'meta'))
  await writeFile(path.join(folder, 'meta', '_journal.json'), JSON.stringify({ ...full, entries }))
  for (const entry of entries)
    await copyFile(
      path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`),
      path.join(folder, `${entry.tag}.sql`),
    )
  return folder
}

type Rows<T> = { rows: T[] }

describe('add_meeting_kinds: mevcut zümre tutanakları kurul türü alır', SLOW, () => {
  const client = newPGlite()
  const pglite = drizzle({ client, schema })
  const db: Database = pglite
  const folders: string[] = []

  before(async () => {
    const index = (await journal()).entries.findIndex((entry) => entry.tag.endsWith(TAG_SUFFIX))
    assert.ok(index > 0, `${TAG_SUFFIX} yok`)
    const folder = await firstMigrations(index)
    folders.push(folder)
    await migrate(pglite, { migrationsFolder: folder })
  })
  after(async () => {
    await client.close()
    for (const folder of folders) await rm(folder, { recursive: true, force: true })
  })

  test('DOM-FIN-135: K-460 taslak ve kesinleşmiş tutanak department olur, satır değişmez; varsayılan kalkar', async () => {
    const app = await buildTestApp(db)
    try {
      const {
        id: institutionId,
        admin,
        adminMembershipId,
      } = await createInstitution(app, {
        academicYear: null,
      })
      const insert = (id: string, finalized: boolean) =>
        db.execute(sql`insert into department_meetings (institution_id, id, subject_id,
            subject_name, kind, meeting_date, location, chair_membership_id, agenda, status,
            signed_date, finalized_at, finalized_by_user_id, created_by_user_id)
          values (${institutionId}, ${id}, 'math', 'Matematik', 'term_start', '2026-09-10',
            'Öğretmenler odası', ${adminMembershipId},
            ${JSON.stringify([{ id: '00000000-0000-4000-8000-00000000000a', title: 'Açılış', discussion: null }])}::jsonb,
            ${finalized ? 'finalized' : 'draft'}, ${finalized ? '2026-09-12' : null},
            ${finalized ? '2026-09-12T09:00:00.000Z' : null}, ${finalized ? admin.id : null},
            ${admin.id})`)
      await insert('11111111-1111-4111-8111-111111111111', false)
      await insert('22222222-2222-4222-8222-222222222222', true)

      await migrate(pglite, { migrationsFolder: MIGRATIONS_FOLDER })

      const result = (await db.execute(
        sql`select id, board, subject_id, class_id, class_collection, class_name,
            agenda_template_id, status, version
          from department_meetings where institution_id = ${institutionId} order by id`,
      )) as unknown as Rows<Record<string, unknown>>
      assert.deepEqual(
        result.rows.map((row) => [row.board, row.subject_id, row.class_id, row.class_collection]),
        [
          ['department', 'math', null, 'classes'],
          ['department', 'math', null, 'classes'],
        ],
      )
      assert.deepEqual(
        result.rows.map((row) => [row.status, row.version, row.agenda_template_id]),
        [
          ['draft', 1, null],
          ['finalized', 1, null],
        ],
      )
      // Varsayılan yalnız dolum içindi: yeni satır kurul türünü açıkça yazar.
      const column = (await db.execute(
        sql`select column_default from information_schema.columns
          where table_name = 'department_meetings' and column_name = 'board'`,
      )) as unknown as Rows<{ column_default: string | null }>
      assert.equal(column.rows[0]?.column_default, null)
    } finally {
      await app.close()
    }
  })
})
