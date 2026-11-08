import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { and, count, eq, sql } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../../src/app.ts'
import type { Database } from '../../src/db/client.ts'
import { markBankTransactionIgnored } from '../../src/db/finance-bank-transactions.ts'
import { insertMissingRecords, lockInstitution } from '../../src/db/records.ts'
import { auditLog } from '../../src/db/schema/audit-log.ts'
import { bankTransactions } from '../../src/db/schema/finance-bank-transactions.ts'
import { bankAccounts, paymentAllocations, payments } from '../../src/db/schema/payments.ts'
import { AppError } from '../../src/errors.ts'
import type { ServiceContext } from '../../src/plugins/authenticate.ts'
import { matchBankTransactionCommand } from '../../src/services/finance-bank-matching.ts'
import type { CommandResponse } from '../../src/services/operation-runner.ts'
import { buildTestApp, createInstitution, FIXED_NOW } from '../support/app.ts'
import { createPgDatabase, PG_SKIP } from '../support/pg.ts'

/**
 * Banka hareketi onayının eşzamanlılığı (IST-115, ON-099; DOM-FIN-069, DOM-FIN-031). Aynı hareketi
 * iki kişi aynı anda onaylarsa kurum kilidinde sıraya girer: biri tahsilat yazar, öteki 409 alır,
 * tek tahsilat ve tek dağılım kalır. Kurum kilidi atlansa da durum ve sürüm koşullu güncelleme
 * ikinci yazmayı durdurur.
 */

const SEED = createSeed(FIXED_NOW)
const STUDENT = SEED.students.find((item) => item.id === 's1')
const INVOICE = {
  id: 'test-pg-inv-1',
  studentId: 's1',
  installment: 1,
  amount: 1_000_000,
  dueDate: '2026-10-15T09:00:00.000Z',
  paidAt: null,
  method: null,
  reminderAt: null,
}

function gate() {
  let open = () => {}
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { open, opened }
}

describe('PostgreSQL 16: banka hareketi eşleştirme', { skip: PG_SKIP }, () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const keyed = () => {
    const key = `pg-bank-${String(++serial).padStart(5, '0')}`
    return { key, fingerprint: key }
  }

  before(async () => {
    ;({ db, close } = await createPgDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app?.close()
    await close?.()
  })

  async function setup() {
    assert.ok(STUDENT)
    const created = await createInstitution(app)
    await insertMissingRecords(
      db,
      created.id,
      [
        { collection: 'classes', id: 'c1', data: { ...SEED.classes.find((c) => c.id === 'c1') } },
        { collection: 'students', id: 's1', data: { ...STUDENT } },
        { collection: 'invoices', id: INVOICE.id, data: { ...INVOICE } },
      ],
      FIXED_NOW,
    )
    const accountId = randomUUID()
    await db.insert(bankAccounts).values({
      institutionId: created.id,
      id: accountId,
      bankName: 'Örnek Bankası',
      iban: 'TR330006100519786457841326',
      accountHolder: 'Akademi Özel Okulları',
    })
    const transactionId = randomUUID()
    await db.insert(bankTransactions).values({
      institutionId: created.id,
      id: transactionId,
      bankAccountId: accountId,
      bookingDate: '2026-10-01',
      amountCents: 1_000_000,
      statementDescription: 'HAVALE DENIZ YILMAZ',
      bankReference: 'PG-EFT-1',
      fingerprint: 'a'.repeat(64),
      sourceFormat: 'csv',
      importBatchId: randomUUID(),
      sourceLine: 2,
      importedByUserId: created.admin.id,
    })
    const ctx: ServiceContext = {
      db,
      institutionId: created.id,
      actor: {
        userId: created.admin.id,
        role: 'yonetici',
        membershipId: created.adminMembershipId,
      },
      now: FIXED_NOW,
      log: app.log,
    }
    return { ctx, transactionId }
  }

  async function untilLockWait(locktype: 'advisory' | 'transactionid', minimum = 1) {
    for (let attempt = 0; ; attempt += 1) {
      const [waiting] = await db
        .select({ n: count() })
        .from(sql`pg_locks`)
        .where(
          sql`locktype = ${locktype} and not granted and pid in (select pid from pg_stat_activity where datname = current_database())`,
        )
      if ((waiting?.n ?? 0) >= minimum) return
      assert.ok(attempt < 300, 'işlem kilidi beklemedi')
      await delay(10)
    }
  }

  async function rowsOf(institutionId: string) {
    const [paid] = await db
      .select({ n: count() })
      .from(payments)
      .where(eq(payments.institutionId, institutionId))
    const [allocated] = await db
      .select({ n: count() })
      .from(paymentAllocations)
      .where(eq(paymentAllocations.institutionId, institutionId))
    const [matched] = await db
      .select({ n: count() })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, institutionId),
          eq(auditLog.action, 'bank_transaction.match'),
        ),
      )
    return { payments: paid?.n, allocations: allocated?.n, audits: matched?.n }
  }

  test('DOM-FIN-069, DOM-FIN-031: aynı hareketin eşzamanlı iki onayı: biri 201, öteki 409; tek tahsilat', async () => {
    const { ctx, transactionId } = await setup()
    const body = { studentId: 's1', invoiceId: INVOICE.id }
    const confirm = () => matchBankTransactionCommand(ctx, transactionId, body, 1, keyed())
    const held = gate()
    const release = gate()
    const holder = db.transaction(async (tx) => {
      await lockInstitution(tx, ctx.institutionId)
      held.open()
      await release.opened
    })
    await held.opened
    const outcomes = Promise.allSettled<CommandResponse>([confirm(), confirm()])
    try {
      await untilLockWait('advisory', 2)
    } finally {
      release.open()
      await holder
    }
    const settled = await outcomes
    assert.deepEqual(
      settled.filter((item) => item.status === 'fulfilled').map((item) => item.value.statusCode),
      [201],
    )
    const reason: unknown = settled.find((item) => item.status === 'rejected')?.reason
    assert.ok(reason instanceof AppError && reason.statusCode === 409, String(reason))
    assert.deepEqual(await rowsOf(ctx.institutionId), { payments: 1, allocations: 1, audits: 1 })
    const [row] = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.institutionId, ctx.institutionId))
    assert.equal(row?.status, 'matched')
    assert.equal(row?.version, 2)
  })

  test('DOM-FIN-069: kilitsiz iki durum yazması: koşullu güncelleme ikinciyi durdurur', async () => {
    const { ctx, transactionId } = await setup()
    const write = (tx: Database) =>
      markBankTransactionIgnored(tx, ctx.institutionId, {
        id: transactionId,
        expectedVersion: 1,
        reason: 'Kira geliri',
        userId: ctx.actor.userId,
        now: FIXED_NOW,
      })
    const wrote = gate()
    const release = gate()
    const first = db.transaction(async (tx) => {
      try {
        return await write(tx)
      } finally {
        wrote.open()
        await release.opened
      }
    })
    await wrote.opened
    const second = db.transaction((tx) => write(tx))
    try {
      await untilLockWait('transactionid')
    } finally {
      release.open()
    }
    assert.deepEqual(await first, { version: 2 })
    assert.equal(await second, null)
  })
})
