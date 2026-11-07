import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

import { and, asc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

import { MIGRATIONS_FOLDER, schema, type Database } from '../src/db/client.ts'
import { idempotencyKeys } from '../src/db/schema/idempotency-keys.ts'
import { invoices } from '../src/db/schema/invoices.ts'
import { databaseErrorInfo } from '../src/errors.ts'
import { buildTestApp, createInstitution, FIXED_NOW, newPGlite } from './support/app.ts'

// ON-318: migration 0072 `invoices_fee_kind_check`'i `not valid` ekler (eski satırı taramaz),
// 0073 kısıtı doğrular (DOM-FIN-004) ve 0071'in `health` → `documented` çevirisini (ON-303, K-30)
// idempotency kayıtlarında saklanan ayrılış yanıtlarına da uygular. 0071'e kadar uygulanmış şemaya
// eski taksit ve saklı yanıtlar yazılır, kalan migration'lar adım adım uygulanır.

const SLOW = { timeout: 180_000 }

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

/** Ayrılış ve iade uçlarının saklanan yanıt gövdesi (`routes/withdrawals.ts`). */
const withdrawalBody = (id: string, reason: string) => ({
  data: {
    id,
    studentId: 's1',
    studentName: 'Test Öğrenci',
    contractId: 'c1',
    withdrawalDate: '2026-10-01',
    reason,
    targetSchool: null,
    breakdown: { refundCents: 0, debtCents: 0 },
    refundCents: 0,
    debtCents: 0,
    refundDueDate: '2026-11-01',
    refundPaidDate: null,
    refundStatus: 'none',
    version: 1,
  },
})

describe('0072–0073: kalem türü kısıtı ve eski ayrılış yanıtları', SLOW, () => {
  const client = newPGlite()
  const pglite = drizzle({ client, schema })
  const db: Database = pglite
  const folders: string[] = []

  before(async () => {
    const folder = await migrationsUpTo('0071_withdrawal_reason_documented')
    folders.push(folder)
    await migrate(pglite, { migrationsFolder: folder })
  })
  after(async () => {
    await client.close()
    for (const folder of folders) await rm(folder, { recursive: true, force: true })
  })

  const validated = async () => {
    const result = (await db.execute(
      sql`select convalidated as validated from pg_constraint where conname = 'invoices_fee_kind_check'`,
    )) as unknown as { rows: { validated: boolean }[] }
    return result.rows[0]?.validated
  }

  test('ON-318, DOM-FIN-004, K-30: 0072 eski etiketli taksitte düşmez; 0073 onu doğrulamada durdurur, düzeltilince geçer; saklı ayrılış yanıtı documented olur', async () => {
    const app = await buildTestApp(db)
    try {
      const { id } = await createInstitution(app, { academicYear: null })
      // Kısıttan önce yazılmış etiketli taksit (core etiketi; ON-316 öncesi şekil).
      await db.insert(invoices).values({
        institutionId: id,
        id: 'inv-eski',
        studentId: 's1',
        installment: 1,
        feeKind: 'Öğrenim ücreti',
        amountCents: 100_00,
        dueDate: '2026-09-15',
        position: 1,
      })
      const expiresAt = new Date(FIXED_NOW.getTime() + 60 * 60 * 1000)
      const stored = (key: string, body: unknown) => ({
        institutionId: id,
        userId: 'u-yonetici',
        key,
        requestHash: 'a'.repeat(64),
        responseStatus: 201,
        responseBody: body,
        createdAt: FIXED_NOW,
        expiresAt,
      })
      await db.insert(idempotencyKeys).values([
        stored('test-k-health', withdrawalBody('w1', 'health')),
        stored('test-k-transfer', withdrawalBody('w2', 'transfer')),
        // Ayrılış şekli olmayan yanıtın `health` değeri (ör. devamsızlık kategorisi) kalır.
        stored('test-k-absence', { data: { id: 'r1', reason: 'health', status: 'pending' } }),
      ])

      const until0072 = await migrationsUpTo('0072_invoices_fee_kind_check')
      folders.push(until0072)
      await migrate(pglite, { migrationsFolder: until0072 })
      assert.equal(await validated(), false, '0072 kısıtı not valid eklemeli')
      // Yeni yazma `not valid` kısıta yine takılır.
      await assert.rejects(
        db.insert(invoices).values({
          institutionId: id,
          id: 'inv-yeni',
          studentId: 's1',
          installment: 2,
          feeKind: 'Yemek',
          amountCents: 100_00,
          dueDate: '2026-10-15',
          position: 2,
        }),
        (error: unknown) => {
          assert.equal(databaseErrorInfo(error)?.constraint, 'invoices_fee_kind_check')
          return true
        },
      )

      // Doğrulama eski satırda durur; 0073'ün bütün adımları geri alınır.
      await assert.rejects(
        migrate(pglite, { migrationsFolder: MIGRATIONS_FOLDER }),
        (error: unknown) => {
          assert.equal(databaseErrorInfo(error)?.code, '23514', String(error))
          return true
        },
      )
      assert.equal(await validated(), false)
      const bodies = async () =>
        (
          await db
            .select({ key: idempotencyKeys.key, body: idempotencyKeys.responseBody })
            .from(idempotencyKeys)
            .where(eq(idempotencyKeys.institutionId, id))
            .orderBy(asc(idempotencyKeys.key))
        ).map((row) => [row.key, row.body] as const)
      assert.equal(JSON.stringify(await bodies()).match(/"health"/g)?.length, 2)

      await db
        .update(invoices)
        .set({ feeKind: 'tuition' })
        .where(and(eq(invoices.institutionId, id), eq(invoices.id, 'inv-eski')))
      await migrate(pglite, { migrationsFolder: MIGRATIONS_FOLDER })
      assert.equal(await validated(), true)
      assert.deepEqual(await bodies(), [
        ['test-k-absence', { data: { id: 'r1', reason: 'health', status: 'pending' } }],
        ['test-k-health', withdrawalBody('w1', 'documented')],
        ['test-k-transfer', withdrawalBody('w2', 'transfer')],
      ])
    } finally {
      await app.close()
    }
  })
})
