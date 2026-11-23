import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

import { and, asc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

import { MIGRATIONS_FOLDER, schema, type Database } from '../src/db/client.ts'
import type { RecordData } from '../src/db/collections.ts'
import { loadRecords } from '../src/db/records.ts'
import { contractInvoices } from '../src/db/schema/contract-invoices.ts'
import { contracts } from '../src/db/schema/contracts.ts'
import { invoices } from '../src/db/schema/invoices.ts'
import { records } from '../src/db/schema/records.ts'
import { buildTestApp, createInstitution, FIXED_NOW, newPGlite } from './support/app.ts'
import { assertFinanceMirror } from './support/finance-mirror.ts'

// ON-046e (ADR 0010 adım 3, açık soru 3; DOM-FIN-010, -012): migration 0063 `records` taksit ve
// sözleşmelerini tablolara kopyalar. Migration'dan önceki şemaya eski kayıt, kesin kayıt, ek protokol,
// onay ve ayrılış şekilleri yazılır, kalan migration'lar uygulanır; sözleşmesiz taksitin bağı,
// tabloların core kaydıyla eşliği ve tekrar çalıştırmanın etkisizliği sınanır.

const SLOW = { timeout: 180_000 }
const TAG = '0063_copy_contracts_invoices'
const PREVIOUS_TAG = '0062_rename_parent_relationship_legal_guardian'

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

const at = (day: number, hour = 9) => new Date(Date.UTC(2026, 8, day, hour)).toISOString()

const invoice = (id: string, studentId: string, installment: number, extra: RecordData = {}) => ({
  id,
  studentId,
  installment,
  amount: 1_000_000,
  dueDate: at(10 + installment),
  paidAt: null,
  method: null,
  reminderAt: null,
  ...extra,
})
const contract = (id: string, studentId: string, extra: RecordData = {}) => ({
  id,
  studentId,
  date: at(1, 10),
  amount: 3_000_000,
  title: 'Kayıt sözleşmesi',
  ...extra,
})
const planLine = (invoiceId: string | null, installment: number) => ({
  invoiceId,
  installment,
  amount: 1_000_000,
  dueDate: at(10 + installment),
  feeKind: 'tuition',
})

describe('0063: taksit ve sözleşme tablolarına kopyalama', SLOW, () => {
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

  test('ON-046e, açık soru 3: sözleşmesiz taksit invoiceIds sürümüne ya da tek sözleşmeye bağlanır; tablolar core kaydıyla aynı; tekrar çalıştırma etkisiz', async () => {
    const app = await buildTestApp(db)
    try {
      const a = await createInstitution(app, { academicYear: null })
      const b = await createInstitution(app, { academicYear: null })
      const tariffId = randomUUID()
      const programId = randomUUID()
      await db.execute(
        sql`insert into fee_tariffs (institution_id, id, academic_year, version_number, status, items) values (${a.id}, ${tariffId}, 2026, 1, 'draft', '[]'::jsonb)`,
      )
      await db.execute(
        sql`insert into scholarship_programs (institution_id, id, academic_year, name, conditions, termination_conditions, duration_note, percent_basis_points, capacity) values (${a.id}, ${programId}, 2026, 'Başarı bursu', 'Koşul', 'Bitiş', 'Bir yıl', 500, 10)`,
      )
      const signatory = {
        name: 'Kurucu Temsilcisi',
        role: 'founder_representative',
        recordedAt: at(2),
        recordedByUserId: 'u-yonetici',
      }
      const approval = {
        method: 'wet_signature',
        approvedAt: at(3),
        approvedByUserId: 'u-yonetici',
        payerName: 'Ayşe Yılmaz',
        plan: [planLine('inv-k1', 1), planLine('inv-k2', 2)],
      }
      const source: { collection: 'invoices' | 'contracts'; data: RecordData; archived?: true }[] =
        [
          // s1: örnek veri gibi tek sözleşme (invoiceIds yok) ve sözleşmesiz taksitler; biri arşivli.
          { collection: 'contracts', data: contract('contract-s1', 's1') },
          {
            collection: 'invoices',
            data: invoice('inv-s1-1', 's1', 1, { paidAt: at(9, 11), method: 'Banka havalesi' }),
          },
          { collection: 'invoices', data: invoice('inv-s1-2', 's1', 2) },
          { collection: 'invoices', data: invoice('inv-s1-x', 's1', 3), archived: true },
          // s2: iki sözleşme: sözleşmesiz taksit bağlanmaz.
          { collection: 'contracts', data: contract('contract-s2a', 's2') },
          { collection: 'contracts', data: contract('contract-s2b', 's2') },
          { collection: 'invoices', data: invoice('inv-s2-1', 's2', 1) },
          // s3: sözleşmesi olmayan öğrenci.
          { collection: 'invoices', data: invoice('inv-s3-1', 's3', 1) },
          // k: tarifeli, burslu, onaylı kesin kayıt; ek protokol (iki sürüm) ve invoiceIds'te
          // taşınan sözleşmesiz taksit (ilk sürüme bağlanır, tek sözleşme kuralından önce).
          {
            collection: 'contracts',
            data: contract('contract-k', 'k', {
              invoiceIds: ['inv-k1', 'inv-k2', 'inv-k-legacy'],
              academicYear: 2026,
              classId: 'c1',
              tariffId,
              tariffVersion: 1,
              grossCents: 3_200_000,
              netCents: 3_000_000,
              discounts: [{ kind: 'sibling', amountCents: 100_000 }],
              extras: [{ kind: 'meal', amountCents: 50_000 }],
              approvedByUserId: 'u-yonetici',
              payer: 'guardian',
              scholarship: { programId, amountCents: 100_000 },
              signatory,
              approval,
            }),
          },
          {
            collection: 'contracts',
            data: contract('contract-k-2', 'k', {
              invoiceIds: ['inv-k1', 'inv-k3'],
              revision: 2,
              amendsContractId: 'contract-k',
              amendmentReason: 'Taksit sayısı değişti',
              proposedPlan: {
                kept: [planLine('inv-k1', 1)],
                replacedInvoiceIds: ['inv-k2'],
                added: [planLine(null, 2)],
              },
            }),
          },
          {
            collection: 'invoices',
            data: invoice('inv-k1', 'k', 1, {
              contractId: 'contract-k',
              academicYear: 2026,
              feeKind: 'tuition',
              createdAt: at(1, 10),
              updatedAt: at(1, 10),
            }),
          },
          { collection: 'invoices', data: invoice('inv-k2', 'k', 2, { contractId: 'contract-k' }) },
          {
            collection: 'invoices',
            data: invoice('inv-k3', 'k', 3, { contractId: 'contract-k-2' }),
          },
          { collection: 'invoices', data: invoice('inv-k-legacy', 'k', 4) },
          // d: tek sözleşme, aynı taksit numarası canlı: bağlamak benzersizliği bozar, bağ boş kalır.
          { collection: 'contracts', data: contract('contract-d', 'd') },
          { collection: 'invoices', data: invoice('inv-d1', 'd', 1, { contractId: 'contract-d' }) },
          { collection: 'invoices', data: invoice('inv-d2', 'd', 1) },
          // İptal edilmiş, arşivlenmiş onaysız ek protokol (ayrılış/iptal şekli).
          {
            collection: 'contracts',
            data: contract('contract-d-2', 'd', {
              revision: 2,
              amendsContractId: 'contract-d',
              cancelledAt: at(5),
              cancelledByUserId: 'u-yonetici',
              cancelReason: 'Vazgeçildi',
            }),
            archived: true,
          },
        ]
      const rows = (institutionId: string) =>
        source.map((item, index) => ({
          institutionId,
          collection: item.collection,
          id: String(item.data.id),
          data: item.data,
          position: index * 1024,
          version: item.archived ? 2 : 1,
          createdAt: FIXED_NOW,
          updatedAt: FIXED_NOW,
          archivedAt: item.archived ? FIXED_NOW : null,
        }))
      // B: aynı kimlikler, tarifesiz (B'de tarife ve burs yok): yalnız kendi tablosuna kopyalanır.
      await db.insert(records).values(rows(a.id))
      await db.insert(records).values(
        rows(b.id)
          .filter(
            (row) =>
              row.id !== 'contract-k' && row.id !== 'contract-k-2' && !row.id.startsWith('inv-k'),
          )
          .map((row) => ({ ...row, data: { ...row.data, amount: 7 } })),
      )

      await migrate(pglite, { migrationsFolder: MIGRATIONS_FOLDER })

      const after = new Map(
        (await loadRecords(db, a.id, ['invoices'], { includeArchived: true })).map((row) => [
          row.id,
          row,
        ]),
      )
      const bound = (id: string) => [after.get(id)?.data.contractId, after.get(id)?.version]
      assert.deepEqual(bound('inv-s1-1'), ['contract-s1', 2])
      assert.deepEqual(bound('inv-s1-2'), ['contract-s1', 2])
      assert.deepEqual(bound('inv-s1-x'), ['contract-s1', 3])
      assert.deepEqual(bound('inv-s2-1'), [undefined, 1])
      assert.deepEqual(bound('inv-s3-1'), [undefined, 1])
      assert.deepEqual(bound('inv-k-legacy'), ['contract-k', 2])
      assert.deepEqual(bound('inv-k1'), ['contract-k', 1])
      assert.deepEqual(bound('inv-d1'), ['contract-d', 1])
      assert.deepEqual(bound('inv-d2'), [undefined, 1])

      // Tablolar core kaydının aynasıdır (veri, sürüm, sıra, arşiv); kökler ve bağ sırası doğru.
      await assertFinanceMirror(db, [a.id, b.id])
      const tableRows = await db
        .select({
          id: contracts.id,
          root: contracts.rootContractId,
          approved: contracts.approvedAt,
        })
        .from(contracts)
        .where(eq(contracts.institutionId, a.id))
        .orderBy(asc(contracts.id))
      assert.deepEqual(
        tableRows.map((row) => [row.id, row.root, row.approved !== null]),
        [
          ['contract-d', 'contract-d', false],
          ['contract-d-2', 'contract-d', false],
          ['contract-k', 'contract-k', true],
          ['contract-k-2', 'contract-k', false],
          ['contract-s1', 'contract-s1', false],
          ['contract-s2a', 'contract-s2a', false],
          ['contract-s2b', 'contract-s2b', false],
        ],
      )
      const links = await db
        .select({ invoiceId: contractInvoices.invoiceId, position: contractInvoices.position })
        .from(contractInvoices)
        .where(
          and(
            eq(contractInvoices.institutionId, a.id),
            eq(contractInvoices.contractId, 'contract-k'),
          ),
        )
        .orderBy(asc(contractInvoices.position))
      assert.deepEqual(links, [
        { invoiceId: 'inv-k1', position: 0 },
        { invoiceId: 'inv-k2', position: 1 },
        { invoiceId: 'inv-k-legacy', position: 2 },
      ])
      const [paid] = await db
        .select({ method: invoices.paymentMethod, due: invoices.dueDate })
        .from(invoices)
        .where(and(eq(invoices.institutionId, a.id), eq(invoices.id, 'inv-s1-1')))
      assert.deepEqual(paid, { method: 'bank_transfer', due: '2026-09-11' })
      const bAmounts = await db
        .select({ amount: invoices.amountCents })
        .from(invoices)
        .where(eq(invoices.institutionId, b.id))
      assert.ok(bAmounts.length > 0 && bAmounts.every((row) => row.amount === 7))

      // Tekrar çalıştırma: bağ adımı ve kopyalama hiçbir satırı değiştirmez.
      const snapshot = async () =>
        Promise.all([
          db
            .select()
            .from(records)
            .orderBy(asc(records.institutionId), asc(records.collection), asc(records.id)),
          db.select().from(contracts).orderBy(asc(contracts.institutionId), asc(contracts.id)),
          db.select().from(invoices).orderBy(asc(invoices.institutionId), asc(invoices.id)),
          db
            .select()
            .from(contractInvoices)
            .orderBy(
              asc(contractInvoices.institutionId),
              asc(contractInvoices.contractId),
              asc(contractInvoices.invoiceId),
            ),
        ])
      const before = await snapshot()
      const statements = (await readFile(path.join(MIGRATIONS_FOLDER, `${TAG}.sql`), 'utf8')).split(
        '--> statement-breakpoint',
      )
      const bind = statements[0] ?? ''
      const copyAll = statements.at(-1) ?? ''
      assert.ok(bind.includes('jsonb_set') && copyAll.includes('kampus_mirror_finance_records'))
      await db.execute(sql.raw(bind))
      await db.execute(sql.raw(copyAll))
      assert.deepEqual(await snapshot(), before)
    } finally {
      await app.close()
    }
  })
})
