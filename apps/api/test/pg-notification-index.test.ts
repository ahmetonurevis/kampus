import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, desc, sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { visibleTo } from '../src/db/notifications.ts'
import { POSITION_STEP } from '../src/db/positions.ts'
import { records } from '../src/db/schema/records.ts'
import { buildTestApp, createInstitution, FIXED_NOW } from './support/app.ts'
import { createPgDatabase, PG_SKIP } from './support/pg.ts'

/**
 * PostgreSQL 16: bildirim görünürlük süzgeci `records_notifications_idx` ifade indeksini seçer
 * (IST-065; veritabani.md "yeni indeks EXPLAIN ile gerekçelendirilir"). Sorgu ifadesi sabit anahtar
 * adı kullanır; parametreli ifade indeksle eşleşmez ve kurumun bütün bildirimlerini tarar.
 */
describe('PostgreSQL 16: bildirim indeksi', { skip: PG_SKIP }, () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createPgDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  test('süzgeç ve sıra indeksten gelir, kurumun bildirimleri taranmaz', async () => {
    const institution = await createInstitution(app)
    const other = await createInstitution(app)
    const STUDENTS = 400
    const rows = (institutionId: string, total: number) =>
      Array.from({ length: total }, (_, index) => ({
        institutionId,
        collection: 'notifications',
        id: `n-${institutionId}-${index}`,
        data: {
          id: `n-${institutionId}-${index}`,
          kind: 'feedback_released',
          audience: index % 2 === 0 ? 'student' : 'parent',
          studentId: `s-${index % STUDENTS}`,
          createdAt: FIXED_NOW.toISOString(),
        },
        position: index * POSITION_STEP,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      }))
    for (const batch of [rows(institution.id, 6000), rows(other.id, 2000)])
      for (let from = 0; from < batch.length; from += 1000)
        await db.insert(records).values(batch.slice(from, from + 1000) as never)
    await db.execute(sql`analyze records`)

    const visible = visibleTo(institution.id, { student: ['s-7'], parent: ['s-7', 's-9'] })
    assert.ok(visible)
    const query = db
      .select({ data: records.data })
      .from(records)
      .where(and(visible))
      .orderBy(desc(records.position), desc(records.id))
      .limit(21)
      .toSQL()
    const plan = await db.execute(
      sql.raw(
        `explain (format json) ${query.sql.replace(/\$(\d+)/g, (_, n: string) =>
          pgLiteral(query.params[Number(n) - 1]),
        )}`,
      ),
    )
    const text = JSON.stringify((plan as { rows: unknown[] }).rows)
    assert.match(text, /records_notifications_idx/)
    assert.doesNotMatch(text, /Seq Scan/)
    assert.doesNotMatch(text, /records_pkey/)
  })
})

function pgLiteral(value: unknown): string {
  return `'${String(value).replaceAll("'", "''")}'`
}
