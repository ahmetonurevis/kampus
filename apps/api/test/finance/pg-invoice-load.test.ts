import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { after, before, describe, test, type TestContext } from 'node:test'

import { sql } from 'drizzle-orm'

import type { App } from '../../src/app.ts'
import type { Database } from '../../src/db/client.ts'
import { POSITION_STEP } from '../../src/db/positions.ts'
import { loadRecords, type LoadOptions } from '../../src/db/records.ts'
import type { CollectionName } from '../../src/db/collections.ts'
import { records } from '../../src/db/schema/records.ts'
import { buildTestApp, createInstitution, FIXED_NOW } from '../support/app.ts'
import { createPgDatabase, PG_SKIP } from '../support/pg.ts'

/**
 * ADR 0010 ölçüt 4 ölçümü (ON-046a): `invoice.pay`, `payment.reverse` ve `student.withdraw`
 * `loadScope` vermez; kurum kilidi altında kurumun bütün `invoices` ve `contracts` kayıtlarını
 * yükler. Bu test o yüklemeyi PostgreSQL 16'da iki kurum büyüklüğünde ölçer (p50/p95, yüklenen
 * JSON boyutu, `EXPLAIN (ANALYZE, BUFFERS)`) ve öğrenciyle daraltılmış yüklemeyle karşılaştırır.
 * Sonuçlar test tanılaması olarak yazılır; eşik denetlenmez (ölçüm karar değiştirmez, ADR 0010).
 */

const RUNS = 20
const WARMUP = 3
const DAY = (month: number) => new Date(Date.UTC(2026, 8 + month, 10, 9)).toISOString()
const TARIFF = '0b8f5c2e-6d0e-4a59-9a3c-0f3d2a4c1b7e'

interface Size {
  students: number
  installments: number
}

/** Kurum büyüklükleri: örnek verinin 8 taksiti ve DOM-FIN-011 üst sınırı 12 ile ölçüt 1 eşiği. */
const SIZES: readonly Size[] = [
  { students: 500, installments: 8 },
  { students: 1667, installments: 12 },
]

/** Tarifeli, onaylı sözleşme ve taksitleri: bugünkü en dolu core kayıt şekli. */
function financeRows(institutionId: string, { students, installments }: Size) {
  const contracts = []
  const invoices = []
  for (let s = 0; s < students; s += 1) {
    const studentId = `s-${s}`
    const contractId = `contract-${s}`
    const ids = Array.from({ length: installments }, (_, n) => `inv-${s}-${n}`)
    contracts.push({
      id: contractId,
      studentId,
      classId: `c-${s % 40}`,
      academicYear: 2026,
      date: DAY(0),
      amount: installments * 2_450_000,
      title: '2026–2027 eğitim sözleşmesi',
      invoiceIds: ids,
      tariffId: TARIFF,
      tariffVersion: 1,
      grossCents: installments * 2_600_000,
      netCents: installments * 2_450_000,
      discounts: [{ kind: 'sibling', amountCents: installments * 150_000 }],
      extras: [],
      approvedByUserId: 'u-yonetici',
      payer: 'guardian',
      signatory: {
        name: 'Kurucu Temsilcisi',
        role: 'founder_representative',
        recordedAt: DAY(0),
        recordedByUserId: 'u-yonetici',
      },
      approval: {
        method: 'electronic',
        approvedAt: DAY(0),
        approvedByUserId: 'u-veli',
        payerName: 'Ayşe Yılmaz',
        plan: ids.map((invoiceId, n) => ({
          invoiceId,
          installment: n + 1,
          amount: 2_450_000,
          dueDate: DAY(n),
          feeKind: 'tuition',
        })),
      },
    })
    for (let n = 0; n < installments; n += 1)
      invoices.push({
        id: ids[n],
        studentId,
        installment: n + 1,
        amount: 2_450_000,
        dueDate: DAY(n),
        paidAt: n < 3 ? DAY(n) : null,
        method: n < 3 ? 'Banka havalesi' : null,
        reminderAt: null,
        feeKind: 'tuition',
        contractId,
        academicYear: 2026,
        createdAt: DAY(0),
        updatedAt: DAY(0),
      })
  }
  const row =
    (collection: CollectionName) => (data: { id: string | undefined }, index: number) => ({
      institutionId,
      collection,
      id: String(data.id),
      data,
      position: index * POSITION_STEP,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
  return [...contracts.map(row('contracts')), ...invoices.map(row('invoices'))]
}

function percentile(sorted: readonly number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)] ?? Number.NaN
}

const round = (value: number) => Math.round(value * 100) / 100

describe(
  'PostgreSQL 16: taksit ve sözleşme yükleme ölçümü (ADR 0010 ölçüt 4)',
  { skip: PG_SKIP },
  () => {
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

    async function measure(
      institutionId: string,
      collections: readonly CollectionName[],
      options: LoadOptions = {},
    ) {
      const timings: number[] = []
      let rows = await loadRecords(db, institutionId, collections, options)
      for (let run = 0; run < WARMUP + RUNS; run += 1) {
        const started = performance.now()
        rows = await loadRecords(db, institutionId, collections, options)
        if (run >= WARMUP) timings.push(performance.now() - started)
      }
      timings.sort((left, right) => left - right)
      const bytes = Buffer.byteLength(JSON.stringify(rows.map((row) => row.data)), 'utf8')
      return {
        rows: rows.length,
        p50Ms: round(percentile(timings, 50)),
        p95Ms: round(percentile(timings, 95)),
        megabytes: round(bytes / 1_000_000),
      }
    }

    /** Yüklemenin planı; sorgu deponun ürettiği SQL'in aynısıdır (parametreler literal). */
    async function explain(institutionId: string, studentId: string | null) {
      const filter =
        studentId === null
          ? sql``
          : sql` and (data ->> 'studentId') = ${studentId} and jsonb_typeof(data -> 'studentId') = 'string'`
      const collections = studentId === null ? sql`('invoices', 'contracts')` : sql`('invoices')`
      const result = await db.execute(
        sql`explain (analyze, buffers, format text) select * from ${records} where institution_id = ${institutionId} and collection in ${collections} and archived_at is null${filter} order by collection, position, id`,
      )
      return (result as unknown as { rows: { 'QUERY PLAN': string }[] }).rows
        .map((row) => row['QUERY PLAN'])
        .join('\n')
    }

    for (const size of SIZES)
      test(`${String(size.students)} öğrenci × ${String(size.installments)} taksit`, async (t: TestContext) => {
        const { id } = await createInstitution(app)
        // Başka kurumun kayıtları aynı tablodadır; yükleme onları taramamalıdır.
        const other = await createInstitution(app)
        const own = financeRows(id, size)
        for (const batch of [own, financeRows(other.id, { students: 200, installments: 8 })])
          for (let from = 0; from < batch.length; from += 1000)
            await db.insert(records).values(batch.slice(from, from + 1000))
        await db.execute(sql`analyze records`)

        const full = await measure(id, ['invoices', 'contracts'])
        assert.equal(full.rows, size.students * (size.installments + 1))
        const narrowed = await measure(id, ['invoices'], {
          match: [
            { kind: 'equals', field: 'studentId', values: [`s-${String(size.students - 1)}`] },
          ],
        })
        assert.equal(narrowed.rows, size.installments)

        t.diagnostic(`tam yükleme (invoices + contracts): ${JSON.stringify(full)}`)
        t.diagnostic(
          `öğrenciyle daraltılmış (invoices, equals studentId): ${JSON.stringify(narrowed)}`,
        )
        t.diagnostic(`EXPLAIN tam:\n${await explain(id, null)}`)
        t.diagnostic(`EXPLAIN daraltılmış:\n${await explain(id, `s-${String(size.students - 1)}`)}`)
      })
  },
)
