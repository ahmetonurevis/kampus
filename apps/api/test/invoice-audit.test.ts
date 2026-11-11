import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { auditAllFinanceRecords, auditFinanceRecords } from '../src/db/invoice-audit.ts'
import { POSITION_STEP } from '../src/db/positions.ts'
import { records } from '../src/db/schema/records.ts'
import { buildTestApp, createInstitution, createTestDatabase, FIXED_NOW } from './support/app.ts'

/**
 * ADR 0010 ön denetimi (ON-046a): `records`'taki taksit ve sözleşmeleri yalnız sayar. Her sayaç
 * için bir sorunlu kayıt yazılır; sağlam kayıtlar hiçbir sayaca girmez ve hiçbir satır değişmez.
 */
const DAY = '2026-10-10T09:00:00.000Z'
const TARIFF = '0b8f5c2e-6d0e-4a59-9a3c-0f3d2a4c1b7e'

const invoice = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  studentId: 's1',
  installment: 1,
  amount: 100_00,
  dueDate: DAY,
  paidAt: null,
  method: null,
  reminderAt: null,
  ...extra,
})

const contract = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  studentId: 's1',
  date: DAY,
  amount: 100_00,
  title: 'Eğitim sözleşmesi',
  ...extra,
})

const terms = {
  tariffId: TARIFF,
  tariffVersion: 1,
  grossCents: 100_00,
  netCents: 100_00,
  discounts: [],
  extras: [],
  approvedByUserId: 'u1',
  payer: 'guardian',
}

describe('ON-046a: taksit ve sözleşme ön denetimi', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function put(
    institutionId: string,
    collection: 'invoices' | 'contracts',
    items: readonly Record<string, unknown>[],
    archived: readonly string[] = [],
  ) {
    await db.insert(records).values(
      items.map((data, index) => ({
        institutionId,
        collection,
        id: String(data.id),
        data,
        position: index * POSITION_STEP,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
        archivedAt: archived.includes(String(data.id)) ? FIXED_NOW : null,
      })),
    )
  }

  test('sağlam zincir hiçbir sayaca girmez', async () => {
    const { id } = await createInstitution(app)
    await put(id, 'contracts', [
      contract('c1', { ...terms, invoiceIds: ['i1', 'i2'] }),
      contract('c2', { ...terms, revision: 2, amendsContractId: 'c1', invoiceIds: ['i1', 'i3'] }),
    ])
    await put(
      id,
      'invoices',
      [
        invoice('i1', {
          contractId: 'c1',
          paidAt: DAY,
          method: 'Banka havalesi',
          feeKind: 'tuition',
        }),
        invoice('i2', { contractId: 'c1', installment: 2 }),
        invoice('i3', { contractId: 'c2', installment: 2 }),
      ],
      ['i2'],
    )

    const report = await auditFinanceRecords(db, id)
    assert.deepEqual(report, {
      institutionId: id,
      contracts: { total: 2, archived: 0 },
      invoices: { total: 3, archived: 1 },
      invoicesWithoutContractId: 0,
      unlinkedInvoices: { total: 0, archived: 0 },
      unlinkedWithSingleContract: 0,
      contractsWithoutInvoiceIds: 0,
      // Ek protokolde korunan taksit iki sürümdedir.
      multiLinkedInvoices: 1,
      dueDateNotNineOClock: 0,
      nonUuidTariffIds: 0,
      nonPositiveAmounts: 0,
      unknownMethods: 0,
      paidMethodMismatch: 0,
      // Arşivli i2 ile canlı i3 aynı numarayı taşır; arşivli satır sayılmaz.
      duplicateInstallments: 0,
      danglingInvoiceContracts: 0,
      danglingContractInvoiceIds: 0,
      danglingAmendments: 0,
      studentMismatches: 0,
      danglingAllocations: 0,
      danglingWithdrawals: 0,
      invalidInvoiceFields: 0,
      invalidContractFields: 0,
      storedPaidCents: 0,
      storeShapeMismatches: { invoices: 0, contracts: 0 },
    })
  })

  test('her sorunlu kayıt kendi sayacına girer; kayıtlar değişmez', async () => {
    const { id, admin } = await createInstitution(app)
    await put(id, 'contracts', [
      // Eski kayıt: invoiceIds yok; öğrencinin tek sözleşmesi.
      contract('c-old', { studentId: 's-old' }),
      contract('c1', { ...terms, tariffId: 'tarife-1', invoiceIds: ['i-dup-a', 'i-missing'] }),
      contract('c2', { amendsContractId: 'c-yok', revision: 2, invoiceIds: [] }),
      // Tarife grubu yarım, sürüm tutarsız.
      contract('c3', { tariffId: TARIFF, revision: 3, invoiceIds: ['i-other'] }),
      contract('c4', { studentId: 's-two', invoiceIds: [] }),
      contract('c5', { studentId: 's-two', invoiceIds: [] }),
    ])
    await put(id, 'invoices', [
      invoice('i-old', { studentId: 's-old' }),
      invoice('i-two', { studentId: 's-two' }),
      invoice('i-dup-a', { contractId: 'c1' }),
      invoice('i-dup-b', { contractId: 'c1', dueDate: '2026-10-10' }),
      invoice('i-zero', { contractId: 'c1', installment: 3, amount: 0 }),
      invoice('i-demo', {
        contractId: 'c1',
        installment: 4,
        paidAt: DAY,
        method: 'Demo Sanal POS',
      }),
      invoice('i-half', { contractId: 'c1', installment: 5, paidAt: DAY }),
      invoice('i-noon', { contractId: 'c1', installment: 6, dueDate: '2026-10-10T12:00:00.000Z' }),
      invoice('i-lost', { contractId: 'c-yok', installment: 7 }),
      invoice('i-other', { studentId: 's-other', contractId: 'c3', installment: 8 }),
      invoice('i-cents', { contractId: 'c1', installment: 9, paidCents: 0 }),
    ])
    const paymentId = randomUUID()
    await db.execute(
      sql`insert into payments (institution_id, id, student_id, amount_cents, method, paid_at, receipt_year, receipt_number, recorded_by_user_id) values (${id}, ${paymentId}, 's1', 100, 'cash', ${FIXED_NOW}, 2026, 1, ${admin.id})`,
    )
    await db.execute(
      sql`insert into payment_allocations (institution_id, payment_id, invoice_id, amount_cents) values (${id}, ${paymentId}, 'i-yok', 100), (${id}, ${paymentId}, 'i-dup-a', 100)`,
    )
    await db.execute(
      sql`insert into student_withdrawals (institution_id, id, student_id, contract_id, withdrawal_date, reason, breakdown, refund_cents, debt_cents, refund_due_date, approved_by_user_id) values (${id}, ${randomUUID()}, 's1', 'c-silinmis', '2026-10-10', 'other', '{}'::jsonb, 0, 0, '2026-10-20', ${admin.id})`,
    )
    const before = await db.select().from(records).orderBy(records.id)

    const report = await auditFinanceRecords(db, id)
    assert.deepEqual(await db.select().from(records).orderBy(records.id), before)
    assert.deepEqual(report.contracts, { total: 6, archived: 0 })
    assert.deepEqual(report.invoices, { total: 11, archived: 0 })
    assert.equal(report.invoicesWithoutContractId, 2)
    assert.deepEqual(report.unlinkedInvoices, { total: 2, archived: 0 })
    // i-old'un öğrencisinin tek sözleşmesi var; i-two'nunkinin iki.
    assert.equal(report.unlinkedWithSingleContract, 1)
    assert.equal(report.contractsWithoutInvoiceIds, 1)
    assert.equal(report.multiLinkedInvoices, 0)
    // Gün biçimi ve öğlen vadesi.
    assert.equal(report.dueDateNotNineOClock, 2)
    assert.equal(report.nonUuidTariffIds, 1)
    assert.equal(report.nonPositiveAmounts, 1)
    assert.equal(report.unknownMethods, 1)
    assert.equal(report.paidMethodMismatch, 1)
    // c1 zincirinde 1 numara iki kez (i-dup-a, i-dup-b); i-lost kopuk zincirde sayılmaz.
    assert.equal(report.duplicateInstallments, 1)
    assert.equal(report.danglingInvoiceContracts, 1)
    assert.equal(report.danglingContractInvoiceIds, 1)
    assert.equal(report.danglingAmendments, 1)
    // c3 başka öğrencinin taksitini taşır: hem contractId hem invoiceIds bağı.
    assert.equal(report.studentMismatches, 2)
    assert.equal(report.danglingAllocations, 1)
    assert.equal(report.danglingWithdrawals, 1)
    // Gün biçimli vade.
    assert.equal(report.invalidInvoiceFields, 1)
    // c1 (tarife grubu tam, uuid değil ama alan geçerli) geçerli; c3 yarım grup ve sürüm.
    assert.equal(report.invalidContractFields, 1)
    assert.equal(report.storedPaidCents, 1)
    // Depo şeması: gün vadesi, sıfır tutar, demo yöntemi, yarım ödeme, öğlen vadesi, paidCents;
    // uuid olmayan tarife ve yarım tarife grubu.
    assert.deepEqual(report.storeShapeMismatches, { invoices: 6, contracts: 2 })
  })

  test('kurum listesi verilmezse bütün kurumlar, verilirse yalnız onlar; başka kurum karışmaz', async () => {
    const first = await createInstitution(app)
    const second = await createInstitution(app)
    await put(first.id, 'invoices', [invoice('i1')])
    await put(second.id, 'invoices', [invoice('i1'), invoice('i2', { installment: 2 })])

    const only = await auditAllFinanceRecords(db, [second.id])
    assert.deepEqual(
      only.map((report) => [report.institutionId, report.invoices.total]),
      [[second.id, 2]],
    )
    const all = await auditAllFinanceRecords(db)
    assert.equal(all.find((report) => report.institutionId === first.id)?.invoices.total, 1)
    assert.ok(all.length >= 2)
  })
})
