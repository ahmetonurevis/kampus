import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { and, count, eq, sql } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'
import type { FeeItem } from '@kampus/school-core/lib/fee-tariffs.ts'

import type { App } from '../../src/app.ts'
import type { Database } from '../../src/db/client.ts'
import { applyFeeTariffPublish, insertFeeTariff } from '../../src/db/fee-tariffs.ts'
import { markPaymentReversed } from '../../src/db/payments.ts'
import { findRecord, insertMissingRecords, lockInstitution } from '../../src/db/records.ts'
import { markRefundPaid } from '../../src/db/withdrawals.ts'
import { auditLog } from '../../src/db/schema/audit-log.ts'
import { feeTariffs } from '../../src/db/schema/fee-tariffs.ts'
import { paymentAllocations, payments } from '../../src/db/schema/payments.ts'
import { records } from '../../src/db/schema/records.ts'
import { studentWithdrawals } from '../../src/db/schema/withdrawals.ts'
import { AppError, databaseErrorInfo, mapDatabaseError } from '../../src/errors.ts'
import type { ServiceContext } from '../../src/plugins/authenticate.ts'
import { createFeeTariffCommand, publishFeeTariffCommand } from '../../src/services/fee-tariffs.ts'
import type { CommandResponse } from '../../src/services/operation-runner.ts'
import { recordPaymentCommand, reversePaymentCommand } from '../../src/services/payments.ts'
import { payRefundCommand, withdrawStudentCommand } from '../../src/services/withdrawals.ts'
import { buildTestApp, createInstitution, FIXED_NOW } from '../support/app.ts'
import { contractTerms, insertTestTariff } from '../support/finance-terms.ts'
import { createPgDatabase, PG_SKIP } from '../support/pg.ts'

/**
 * Finans komutlarının eşzamanlılığı (ON-107): tarife yayını (DOM-FIN-002), tahsilat iptali
 * (DOM-FIN-033) ve iade ödemesi (DOM-FIN-041). Her yarışta iki istek kurum kilidinde bekletilir,
 * kilit bırakılınca sırayla işlenir: tek kazanan olur, öteki 409 alır ve kayıtlar tek işlemin
 * izini taşır. Ayrıca kurum kilidi atlansa bile depo koşullarının (sürüm, durum, kısmi benzersiz
 * indeks) ikinci yazmayı durdurduğu kilitsiz iki transaction'la sınanır.
 */

const YEAR = FIXED_NOW.getUTCFullYear()
const TUITION: FeeItem = {
  kind: 'tuition',
  level: null,
  amountCents: 100_000,
  unit: 'year',
  vatBasisPoints: 1000,
  vatEffectiveDate: '2026-01-01',
  announcedAmountCents: 100_000,
}
const PUBLISH = { announcedDate: '2026-05-01', mebbisRecordedDate: '2026-05-02' }
const REVERSE = { reason: 'Mükerrer giriş düzeltmesi' }

const SEED = createSeed(FIXED_NOW)
const STUDENT = SEED.students.find((item) => item.classId === 'c1')
const PARENT_NAME = 'Test Ödeyici Veli'
const NET = 10_000_000
const REFUND = {
  paidDate: '2026-10-05',
  iban: 'TR330006100519786457841326',
  accountHolder: PARENT_NAME,
}

/** Dışarıdan çözülen söz: kilit sahibini test adımlarına göre bekletmek için. */
function gate() {
  let open = () => {}
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { open, opened }
}

/** Kilitsiz yarışta ikinci yazmanın `false`/`null` sonucu: transaction'ı geri almak için. */
class NotWritten extends Error {
  readonly result: unknown
  constructor(result: unknown) {
    super('ikinci yazma uygulanmadı')
    this.result = result
  }
}

/** Komut yanıtındaki kaydın kimliği ve sürümü. */
function written(response: CommandResponse): { id: string; version: number } {
  const data: unknown = (response.body as { data?: unknown }).data
  assert.ok(typeof data === 'object' && data !== null, JSON.stringify(response.body))
  const { id, version } = data as { id?: unknown; version?: unknown }
  assert.ok(typeof id === 'string' && typeof version === 'number', JSON.stringify(data))
  return { id, version }
}

/** Yarışın tek kazananı 200 döner; öteki 409 ve verilen kodla reddedilir. */
function assertSingleWinner(settled: PromiseSettledResult<CommandResponse>[], code: string) {
  assert.deepEqual(
    settled.filter((item) => item.status === 'fulfilled').map((item) => item.value.statusCode),
    [200],
  )
  const reason: unknown = settled.find((item) => item.status === 'rejected')?.reason
  assert.ok(
    reason instanceof AppError && reason.statusCode === 409 && reason.code === code,
    String(reason),
  )
}

async function assertRejected(work: Promise<unknown>, status: number, code: string) {
  await assert.rejects(work, (error: unknown) => {
    assert.ok(
      error instanceof AppError && error.statusCode === status && error.code === code,
      String(error),
    )
    return true
  })
}

describe('PostgreSQL 16: finans komutlarının eşzamanlılığı', { skip: PG_SKIP }, () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const keyed = () => {
    const key = `pg-fin-${String(++serial).padStart(5, '0')}`
    return { key, fingerprint: key }
  }

  before(async () => {
    ;({ db, close } = await createPgDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  /** Yönetici bağlamı; her test kendi kurumunu kurar. */
  async function context(): Promise<ServiceContext> {
    const created = await createInstitution(app)
    return {
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
  }

  /**
   * Bu veritabanındaki bağlantılardan en az `minimum` tanesi kilit bekleyene kadar yoklar (sabit
   * uyku yerine koşul). `pg_locks` küme geneli olduğundan paralel koşan başka dosyaların
   * bekleyişleri sayılmaz.
   */
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

  /**
   * Kurum kilidi tutulurken iki komutu başlatır; ikisi de kilitte bekleyince bırakır. Komutlar
   * sırayla işlenir ve ikincisi birincinin yazdığını görür.
   */
  async function raceUnderInstitutionLock(
    ctx: ServiceContext,
    commands: readonly (() => Promise<CommandResponse>)[],
  ): Promise<PromiseSettledResult<CommandResponse>[]> {
    const held = gate()
    const release = gate()
    const holder = db.transaction(async (tx) => {
      await lockInstitution(tx, ctx.institutionId)
      held.open()
      await release.opened
    })
    await held.opened
    const outcomes = Promise.allSettled(commands.map((run) => run()))
    try {
      await untilLockWait('advisory', commands.length)
    } finally {
      release.open()
      await holder
    }
    return outcomes
  }

  /**
   * Kurum kilidi olmadan iki transaction: birincisi yazar ve açık kalır, ikincisi aynı satırda
   * (satır kilidi veya benzersiz indeks) bekleyince birincisi işlenir. Depo koşulu tek başına
   * ikinci yazmayı durdurmalıdır. `false`/`null` dönen ikinci yazma geri alınır.
   */
  async function locklessPair<T>(
    write: (tx: Database) => Promise<T>,
  ): Promise<[PromiseSettledResult<T>, PromiseSettledResult<T>]> {
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
    const second = db.transaction(async (tx) => {
      const result = await write(tx)
      // Servis yazılmayan sonuçta hata fırlatıp geri alır; burada da geri alınır.
      if (result === false || result === null) throw new NotWritten(result)
      return result
    })
    try {
      await untilLockWait('transactionid')
    } finally {
      release.open()
    }
    const [firstSettled, secondSettled] = await Promise.allSettled([first, second])
    assert.ok(firstSettled && secondSettled)
    if (secondSettled.status === 'rejected' && secondSettled.reason instanceof NotWritten)
      return [firstSettled, { status: 'fulfilled', value: secondSettled.reason.result as T }]
    return [firstSettled, secondSettled]
  }

  async function auditCount(institutionId: string, action: string) {
    const [row] = await db
      .select({ n: count() })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
    return row?.n
  }

  async function tariffsOf(institutionId: string) {
    return db
      .select({
        id: feeTariffs.id,
        versionNumber: feeTariffs.versionNumber,
        status: feeTariffs.status,
        version: feeTariffs.version,
      })
      .from(feeTariffs)
      .where(and(eq(feeTariffs.institutionId, institutionId), eq(feeTariffs.academicYear, YEAR)))
      .orderBy(feeTariffs.versionNumber)
  }

  /** Yayındaki 1. sürüm ve onun ardından açılmış 2. sürüm taslağı. */
  async function publishedAndDraft(ctx: ServiceContext) {
    await db.insert(feeTariffs).values({
      institutionId: ctx.institutionId,
      id: randomUUID(),
      academicYear: YEAR,
      versionNumber: 1,
      status: 'published',
      items: [TUITION],
      announcedDate: '2026-05-01',
      publishedByUserId: ctx.actor.userId,
      publishedAt: FIXED_NOW,
    })
    const created = await createFeeTariffCommand(
      ctx,
      {
        academicYear: YEAR,
        items: [{ ...TUITION, amountCents: 95_000 }],
        discounts: [],
        paymentTerms: [
          {
            kind: 'installment',
            minInstallments: 2,
            maxInstallments: 12,
            discountPercentBasisPoints: null,
            discountAmountCents: null,
          },
        ],
      },
      keyed(),
    )
    assert.equal(created.statusCode, 201)
    return written(created)
  }

  test('DOM-FIN-002, DOM-FIN-006: aynı taslağın eşzamanlı iki yayını: biri 200, öteki 409 version_conflict; yılda tek yayındaki sürüm', async () => {
    const ctx = await context()
    const draft = await publishedAndDraft(ctx)
    const publish = () => publishFeeTariffCommand(ctx, draft.id, PUBLISH, draft.version, keyed())
    assertSingleWinner(await raceUnderInstitutionLock(ctx, [publish, publish]), 'version_conflict')

    const rows = await tariffsOf(ctx.institutionId)
    assert.deepEqual(
      rows.map((row) => [row.versionNumber, row.status]),
      [
        [1, 'superseded'],
        [2, 'published'],
      ],
    )
    // Taslak bir kez yayımlandı: sürüm yalnız bir artar, tek denetim kaydı yazılır.
    assert.equal(rows[1]?.version, draft.version + 1)
    assert.equal(await auditCount(ctx.institutionId, 'tariff.publish'), 1)
    // Güncel sürümle yeniden denemek iş kuralıyla reddedilir.
    await assertRejected(
      publishFeeTariffCommand(ctx, draft.id, PUBLISH, draft.version + 1, keyed()),
      409,
      'tariff_not_draft',
    )
  })

  test('DOM-FIN-002: aynı yıla eşzamanlı iki taslak: yalnız biri 201, öteki 409 open_tariff_draft', async () => {
    const ctx = await context()
    const create = () =>
      createFeeTariffCommand(ctx, { academicYear: YEAR, items: [TUITION], discounts: [] }, keyed())
    const settled = await raceUnderInstitutionLock(ctx, [create, create])
    assert.deepEqual(
      settled.filter((item) => item.status === 'fulfilled').map((item) => item.value.statusCode),
      [201],
    )
    const reason: unknown = settled.find((item) => item.status === 'rejected')?.reason
    assert.ok(
      reason instanceof AppError &&
        reason.statusCode === 409 &&
        reason.code === 'open_tariff_draft',
      String(reason),
    )
    assert.deepEqual(
      (await tariffsOf(ctx.institutionId)).map((row) => [row.versionNumber, row.status]),
      [[1, 'draft']],
    )
    assert.equal(await auditCount(ctx.institutionId, 'tariff.create'), 1)
  })

  test('DOM-FIN-002: kurum kilidi atlansa da kısmi benzersiz indeksler yılda tek taslak ve tek yayın bırakır', async () => {
    const ctx = await context()
    const insertDraft = (versionNumber: number) => (tx: Database) =>
      insertFeeTariff(tx, ctx.institutionId, {
        id: randomUUID(),
        academicYear: YEAR,
        versionNumber,
        items: [TUITION],
        discounts: [],
        now: FIXED_NOW,
      })
    let drafts = 0
    const [firstDraft, secondDraft] = await locklessPair((tx) => insertDraft(++drafts)(tx))
    assert.equal(firstDraft.status, 'fulfilled')
    assert.equal(secondDraft.status, 'rejected')
    assert.equal(databaseErrorInfo(secondDraft.reason)?.constraint, 'fee_tariffs_draft_key')
    // Kısıt `retry` sınıfındadır: kullanıcı 409 conflict alır, ham veritabanı hatası değil.
    const mapped = mapDatabaseError(secondDraft.reason)
    assert.ok(mapped instanceof AppError && mapped.statusCode === 409 && mapped.code === 'conflict')

    let published = 10
    const [firstPublished, secondPublished] = await locklessPair(async (tx) => {
      await tx.insert(feeTariffs).values({
        institutionId: ctx.institutionId,
        id: randomUUID(),
        academicYear: YEAR,
        versionNumber: ++published,
        status: 'published',
        items: [TUITION],
        announcedDate: '2026-05-01',
        publishedByUserId: ctx.actor.userId,
        publishedAt: FIXED_NOW,
      })
    })
    assert.equal(firstPublished.status, 'fulfilled')
    assert.equal(secondPublished.status, 'rejected')
    assert.equal(databaseErrorInfo(secondPublished.reason)?.constraint, 'fee_tariffs_published_key')
    assert.deepEqual(
      (await tariffsOf(ctx.institutionId)).map((row) => row.status),
      ['draft', 'published'],
    )
  })

  test('DOM-FIN-002: kurum kilidi atlansa da aynı taslağı iki transaction yayımlayamaz', async () => {
    const ctx = await context()
    const draft = await publishedAndDraft(ctx)
    const [first, second] = await locklessPair((tx) =>
      applyFeeTariffPublish(tx, ctx.institutionId, {
        id: draft.id,
        academicYear: YEAR,
        expectedVersion: draft.version,
        announcedDate: PUBLISH.announcedDate,
        mebbisRecordedDate: PUBLISH.mebbisRecordedDate,
        publishedByUserId: ctx.actor.userId,
        now: FIXED_NOW,
      }),
    )
    assert.deepEqual(
      [first, second].map((item) => (item.status === 'fulfilled' ? item.value : item.reason)),
      [true, false],
    )
    const rows = await tariffsOf(ctx.institutionId)
    assert.deepEqual(
      rows.map((row) => [row.versionNumber, row.status, row.version]),
      [
        [1, 'superseded', 2],
        [2, 'published', draft.version + 1],
      ],
    )
  })

  /** Öğrenci, sözleşme ve iki taksit; tahsilat taksit 1'i kapatır. */
  async function paidStudent(ctx: ServiceContext) {
    assert.ok(STUDENT)
    const invoice = (id: string, installment: number) => ({
      id,
      studentId: STUDENT.id,
      installment,
      amount: NET / 2,
      dueDate: '2026-09-15T09:00:00.000Z',
      paidAt: null,
      method: null,
      reminderAt: null,
      feeKind: 'tuition',
    })
    // Taksit ve sözleşme tablodan okunur (ON-046f): sözleşme core biçiminde, kurumun tarifesine bağlı.
    await insertTestTariff(db, ctx.institutionId)
    await insertMissingRecords(
      db,
      ctx.institutionId,
      [
        {
          collection: 'classes' as const,
          id: 'c1',
          data: { ...SEED.classes.find((item) => item.id === 'c1') },
        },
        { collection: 'students' as const, id: STUDENT.id, data: { ...STUDENT } },
        {
          collection: 'parents' as const,
          id: STUDENT.parentId,
          data: { id: STUDENT.parentId, name: PARENT_NAME, studentIds: [STUDENT.id] },
        },
        {
          collection: 'contracts' as const,
          id: 'pg-fin-contract',
          data: {
            id: 'pg-fin-contract',
            studentId: STUDENT.id,
            date: '2026-01-01T09:00:00.000Z',
            amount: NET,
            title: 'Sözleşme',
            invoiceIds: ['pg-fin-inv-1', 'pg-fin-inv-2'],
            ...contractTerms({ grossCents: NET, netCents: NET }),
          },
        },
        { collection: 'invoices' as const, id: 'pg-fin-inv-1', data: invoice('pg-fin-inv-1', 1) },
        { collection: 'invoices' as const, id: 'pg-fin-inv-2', data: invoice('pg-fin-inv-2', 2) },
      ],
      FIXED_NOW,
    )
    const paid = await recordPaymentCommand(
      ctx,
      {
        studentId: STUDENT.id,
        amountCents: NET / 2,
        method: 'Banka havalesi',
        reference: 'TR-PG-FIN',
      },
      { idempotency: keyed(), expectedVersion: null },
    )
    assert.equal(paid.statusCode, 201)
    const invoice1 = await findRecord(db, ctx.institutionId, 'invoices', 'pg-fin-inv-1')
    assert.notEqual(invoice1?.data.paidAt, null)
    return { payment: written(paid), invoiceVersion: invoice1?.version ?? 0 }
  }

  async function allocatedCents(institutionId: string) {
    const [row] = await db
      .select({ total: sql<string | null>`sum(${paymentAllocations.amountCents})` })
      .from(paymentAllocations)
      .innerJoin(
        payments,
        and(
          eq(payments.institutionId, paymentAllocations.institutionId),
          eq(payments.id, paymentAllocations.paymentId),
        ),
      )
      .where(
        and(
          eq(paymentAllocations.institutionId, institutionId),
          sql`${payments.reversedAt} is null`,
        ),
      )
    return Number(row?.total ?? 0)
  }

  test('DOM-FIN-033: aynı tahsilatın eşzamanlı iki iptali: biri 200, öteki 409 version_conflict; taksit bir kez açılır', async () => {
    const ctx = await context()
    const { payment, invoiceVersion } = await paidStudent(ctx)
    const reverse = () => reversePaymentCommand(ctx, payment.id, REVERSE, payment.version, keyed())
    assertSingleWinner(await raceUnderInstitutionLock(ctx, [reverse, reverse]), 'version_conflict')

    const [row] = await db
      .select({ version: payments.version, reversedAt: payments.reversedAt })
      .from(payments)
      .where(and(eq(payments.institutionId, ctx.institutionId), eq(payments.id, payment.id)))
    assert.equal(row?.version, payment.version + 1)
    assert.notEqual(row?.reversedAt, null)
    // Taksit yalnız bir kez yeniden açıldı; geçerli dağılım kalmadı, tek denetim kaydı var.
    const invoice1 = await findRecord(db, ctx.institutionId, 'invoices', 'pg-fin-inv-1')
    assert.equal(invoice1?.data.paidAt, null)
    assert.equal(invoice1?.version, invoiceVersion + 1)
    assert.equal(await allocatedCents(ctx.institutionId), 0)
    assert.equal(await auditCount(ctx.institutionId, 'payment.reverse'), 1)
    await assertRejected(
      reversePaymentCommand(ctx, payment.id, REVERSE, payment.version + 1, keyed()),
      409,
      'payment_already_reversed',
    )
  })

  test('DOM-FIN-033: kurum kilidi atlansa da aynı tahsilatı iki transaction iptal edemez', async () => {
    const ctx = await context()
    const { payment } = await paidStudent(ctx)
    const [first, second] = await locklessPair((tx) =>
      markPaymentReversed(tx, ctx.institutionId, {
        id: payment.id,
        expectedVersion: payment.version,
        reversedByUserId: ctx.actor.userId,
        reason: REVERSE.reason,
        now: FIXED_NOW,
      }),
    )
    assert.deepEqual(
      [first, second].map((item) => (item.status === 'fulfilled' ? item.value : item.reason)),
      [{ version: payment.version + 1 }, null],
    )
  })

  /** Ayrılış onaylı, 30.000 ₺ iade bekleyen öğrenci (yarı ödenmiş 100.000 ₺ sözleşme). */
  async function pendingRefund(ctx: ServiceContext) {
    await paidStudent(ctx)
    assert.ok(STUDENT)
    const withdrawn = await withdrawStudentCommand(
      ctx,
      STUDENT.id,
      {
        withdrawalDate: '2026-10-01',
        termStartDate: '2026-09-07',
        attendedUnits: 18,
        totalUnits: 180,
        reason: 'relocation',
        targetSchool: 'Test Okulu',
      },
      { idempotency: keyed(), expectedVersion: null },
    )
    assert.equal(withdrawn.statusCode, 201)
    const refundCents = (withdrawn.body as { data: { refundCents: number } }).data.refundCents
    assert.equal(refundCents, 3_000_000)
    return written(withdrawn)
  }

  test('DOM-FIN-041: aynı iadenin eşzamanlı iki ödemesi: biri 200, öteki 409 version_conflict; iade bir kez ödenir', async () => {
    const ctx = await context()
    const withdrawal = await pendingRefund(ctx)
    const pay = () => payRefundCommand(ctx, withdrawal.id, REFUND, withdrawal.version, keyed())
    assertSingleWinner(await raceUnderInstitutionLock(ctx, [pay, pay]), 'version_conflict')

    const [row] = await db
      .select({
        version: studentWithdrawals.version,
        refundPaidDate: studentWithdrawals.refundPaidDate,
        refundPaidByUserId: studentWithdrawals.refundPaidByUserId,
      })
      .from(studentWithdrawals)
      .where(
        and(
          eq(studentWithdrawals.institutionId, ctx.institutionId),
          eq(studentWithdrawals.id, withdrawal.id),
        ),
      )
    assert.deepEqual(row, {
      version: withdrawal.version + 1,
      refundPaidDate: REFUND.paidDate,
      refundPaidByUserId: ctx.actor.userId,
    })
    assert.equal(await auditCount(ctx.institutionId, 'student.withdraw.refund_paid'), 1)
    const [notified] = await db
      .select({ n: count() })
      .from(records)
      .where(
        and(
          eq(records.institutionId, ctx.institutionId),
          eq(records.collection, 'notifications'),
          sql`${records.data}->>'kind' = 'refund_paid'`,
        ),
      )
    assert.equal(notified?.n, 1)
    await assertRejected(
      payRefundCommand(ctx, withdrawal.id, REFUND, withdrawal.version + 1, keyed()),
      409,
      'refund_already_paid',
    )
  })

  test('DOM-FIN-041: kurum kilidi atlansa da aynı iadeyi iki transaction ödeyemez', async () => {
    const ctx = await context()
    const withdrawal = await pendingRefund(ctx)
    const [first, second] = await locklessPair((tx) =>
      markRefundPaid(tx, ctx.institutionId, {
        id: withdrawal.id,
        expectedVersion: withdrawal.version,
        paidDate: REFUND.paidDate,
        iban: REFUND.iban,
        accountHolder: REFUND.accountHolder,
        paidByUserId: ctx.actor.userId,
        now: FIXED_NOW,
      }),
    )
    assert.deepEqual(
      [first, second].map((item) => (item.status === 'fulfilled' ? item.value : item.reason)),
      [true, false],
    )
  })
})
