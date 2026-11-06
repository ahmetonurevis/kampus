import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, asc, eq, sql } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import type { RecordData } from '../src/db/collections.ts'
import {
  contractFilter,
  contractToColumns,
  loadContracts,
  rowToContract,
  writeContractsAndInvoices,
  type ContractRow,
} from '../src/db/contract-store.ts'
import {
  invoiceFilter,
  invoiceToColumns,
  loadInvoices,
  rowToInvoice,
  type InvoiceRow,
} from '../src/db/invoice-store.ts'
import type { RecordWrite } from '../src/db/records.ts'
import { contractInvoices } from '../src/db/schema/contract-invoices.ts'
import { contracts } from '../src/db/schema/contracts.ts'
import { invoices } from '../src/db/schema/invoices.ts'
import { AppError } from '../src/errors.ts'
import { buildTestApp, createInstitution, createTestDatabase, FIXED_NOW } from './support/app.ts'

/**
 * Taksit ve sözleşme depoları (ON-046d; ADR 0010 karar 3, 7, 8; DOM-FIN-010, -012, -025, -051):
 * core kaydı → satır → core kaydı aynı kayıttır; `invoiceIds` sırası korunur; `loadScope`
 * süzgeçleri kolon koşuluna çevrilir, çevrilemeyen süzgeç programlama hatasıdır. Depolar henüz
 * çalıştırıcıya bağlı değildir; yazma ve okuma doğrudan depo fonksiyonlarıyla sınanır.
 */

const at = (day: number, hour = 9) => new Date(Date.UTC(2026, 9, day, hour)).toISOString()
const NOW = FIXED_NOW

const SYSTEM = {
  institutionId: 'kurum',
  currency: 'TRY',
  position: 0,
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  version: 1,
}

/** Satır üzerinden gidiş-dönüş (veritabanısız). */
function invoiceRoundTrip(data: RecordData, root: string | null) {
  return rowToInvoice({ ...SYSTEM, ...invoiceToColumns(data, root) } as InvoiceRow)
}
function contractRoundTrip(data: RecordData, root: string) {
  const { columns, invoiceIds } = contractToColumns(data, root)
  return rowToContract({ ...SYSTEM, ...columns } as ContractRow, invoiceIds ?? [])
}

const rejectsProgramming = (run: () => unknown) =>
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof AppError)
    assert.equal(error.statusCode, 500)
    return true
  })

// Core işlemlerinin ürettiği şekiller (enrollment.ts, renewals.ts, contract-approval.ts, withdrawals.ts).
const legacyInvoice = {
  id: 'inv-s1-0',
  studentId: 's1',
  installment: 1,
  amount: 2_450_000,
  dueDate: at(10),
  paidAt: at(8),
  method: 'Banka havalesi',
  reminderAt: null,
}
const renewalInvoice = (id: string, installment: number, extra: RecordData = {}) => ({
  id,
  studentId: 's1',
  contractId: 'contract-r1',
  academicYear: 2026,
  paidAt: null,
  method: null,
  reminderAt: null,
  createdAt: at(1, 10),
  updatedAt: at(1, 10),
  installment,
  amount: 1_000_000,
  dueDate: at(10 + installment),
  feeKind: 'tuition',
  ...extra,
})
const terms = (tariffId: string, programId: string) => ({
  tariffId,
  tariffVersion: 1,
  grossCents: 3_200_000,
  netCents: 3_000_000,
  discounts: [{ kind: 'sibling', amountCents: 100_000 }],
  extras: [{ kind: 'meal', amountCents: 50_000 }],
  approvedByUserId: 'u-yonetici',
  payer: 'guardian',
  scholarship: { programId, amountCents: 100_000 },
})
const signatory = {
  name: 'Kurucu Temsilcisi',
  role: 'founder_representative',
  recordedAt: at(2),
  recordedByUserId: 'u-yonetici',
}
const planLine = (invoiceId: string | null, installment: number, extra: RecordData = {}) => ({
  invoiceId,
  installment,
  amount: 1_000_000,
  dueDate: at(10 + installment),
  feeKind: 'tuition',
  ...extra,
})

describe('ON-046d: taksit ve sözleşme depoları', () => {
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

  async function tenant() {
    const { id } = await createInstitution(app)
    const tariffId = randomUUID()
    const programId = randomUUID()
    await db.execute(
      sql`insert into fee_tariffs (institution_id, id, academic_year, version_number, status, items) values (${id}, ${tariffId}, 2026, 1, 'draft', '[]'::jsonb)`,
    )
    await db.execute(
      sql`insert into scholarship_programs (institution_id, id, academic_year, name, conditions, termination_conditions, duration_note, percent_basis_points, capacity) values (${id}, ${programId}, 2026, 'Başarı bursu', 'Koşul', 'Bitiş', 'Bir yıl', 500, 10)`,
    )
    return { id, tariffId, programId }
  }

  const insert = (collection: 'contracts' | 'invoices', data: RecordData): RecordWrite => ({
    kind: 'insert',
    collection,
    id: String(data.id),
    data,
  })
  const update = (
    collection: 'contracts' | 'invoices',
    data: RecordData,
    expectedVersion: number,
  ): RecordWrite => ({ kind: 'update', collection, id: String(data.id), data, expectedVersion })

  const dataOf = async (id: string, collection: 'contracts' | 'invoices') =>
    (collection === 'contracts' ? await loadContracts(db, id) : await loadInvoices(db, id)).map(
      (row) => row.data,
    )

  test('gidiş-dönüş (satır): örnek veri, yenileme, ödenmiş, eski kayıt ve sözleşme sürümleri aynı kalır', () => {
    const seed = createSeed(NOW)
    for (const invoice of seed.invoices.slice(0, 24))
      assert.deepEqual(invoiceRoundTrip(invoice, null), invoice)
    for (const contract of seed.contracts)
      assert.deepEqual(contractRoundTrip(contract, contract.id), contract)

    const tariffId = randomUUID()
    const programId = randomUUID()
    // DOM-FIN-013: ödeme koşulu kopyası sözleşmeyle gidip döner; eski kayıtta alan oluşmaz.
    const withTerm = {
      id: 'contract-kosul',
      studentId: 's1',
      date: at(1),
      amount: 3_000_000,
      title: 'Özel okul eğitim sözleşmesi',
      invoiceIds: [],
      ...terms(tariffId, programId),
      paymentTerm: {
        kind: 'installment',
        minInstallments: 2,
        maxInstallments: 4,
        discountPercentBasisPoints: 300,
        discountAmountCents: null,
        installmentCount: 3,
      },
    }
    assert.deepEqual(contractRoundTrip(withTerm, 'contract-kosul'), withTerm)
    const cases: [RecordData, string | null][] = [
      [legacyInvoice, null],
      [{ ...legacyInvoice, id: 'inv-eski', paidAt: null, method: null, reminderAt: at(9) }, null],
      [renewalInvoice('inv-r1', 1), 'contract-r1'],
      [
        renewalInvoice('inv-r2', 2, { feeKind: 'meal', paidAt: at(12), method: 'Senet' }),
        'contract-r1',
      ],
      // Ayrılış borcu: zaman alanı ve yıl yok, kalem öğrenim.
      [
        {
          id: 'inv-borc',
          studentId: 's1',
          installment: 9,
          amount: 300_000,
          dueDate: at(20),
          paidAt: null,
          method: null,
          reminderAt: null,
          feeKind: 'tuition',
          contractId: 'contract-r2',
        },
        'contract-r1',
      ],
    ]
    for (const [invoice, root] of cases) assert.deepEqual(invoiceRoundTrip(invoice, root), invoice)

    const enrolled = {
      id: 'contract-r1',
      studentId: 's1',
      date: at(1, 10),
      amount: 3_050_000,
      title: 'Kayıt sözleşmesi',
      invoiceIds: ['inv-r1', 'inv-r2'],
      academicYear: 2026,
      ...terms(tariffId, programId),
    }
    const approved = {
      ...enrolled,
      classId: 'c-9a',
      signatory,
      approval: {
        method: 'electronic',
        approvedAt: at(3),
        approvedByUserId: 'u-veli',
        payerName: 'Ayşe Yılmaz',
        plan: [planLine('inv-r1', 1), planLine('inv-r2', 2, { feeKind: undefined })].map(
          ({ feeKind, ...line }) => (feeKind === undefined ? line : { ...line, feeKind }),
        ),
      },
    }
    const amendment = {
      ...enrolled,
      id: 'contract-r2',
      date: at(5),
      title: 'Kayıt sözleşmesi · Ek protokol 1',
      invoiceIds: [],
      revision: 2,
      amendsContractId: 'contract-r1',
      amendmentReason: 'Taksit sayısı değişti',
      proposedPlan: {
        kept: [planLine('inv-r1', 1)],
        replacedInvoiceIds: ['inv-r2'],
        added: [planLine(null, 2), planLine(null, 3)],
      },
    }
    const cancelled = {
      ...amendment,
      id: 'contract-r3',
      cancelledAt: at(6),
      cancelledByUserId: 'u-yonetici',
      cancelReason: 'Veli vazgeçti',
    }
    // Tarifesiz ilk sürüm: terim alanları ve invoiceIds hiç yok.
    const legacy = { id: 'contract-s1', studentId: 's1', date: at(1), amount: 0, title: 'Eski' }
    for (const contract of [enrolled, approved, legacy])
      assert.deepEqual(contractRoundTrip(contract, contract.id), contract)
    for (const contract of [amendment, cancelled])
      assert.deepEqual(contractRoundTrip(contract, 'contract-r1'), contract)
  })

  test('şemaya uymayan kayıt programlama hatasıdır (500)', () => {
    const bad: RecordData[] = [
      { ...legacyInvoice, paidCents: 0 },
      { ...legacyInvoice, method: 'Demo Sanal POS' },
      { ...legacyInvoice, method: null },
      { ...legacyInvoice, dueDate: at(10, 12) },
      { ...legacyInvoice, dueDate: '2026-10-10' },
      { ...legacyInvoice, amount: 0 },
      { ...legacyInvoice, deletedAt: at(1) },
    ]
    for (const invoice of bad) rejectsProgramming(() => invoiceToColumns(invoice, null))
    // Kök sözleşme bağıyla tutarlı olmalı.
    rejectsProgramming(() => invoiceToColumns(renewalInvoice('inv-r1', 1), null))
    rejectsProgramming(() => invoiceToColumns(legacyInvoice, 'contract-r1'))

    const contract = { id: 'c1', studentId: 's1', date: at(1), amount: 0, title: 'Sözleşme' }
    for (const invalid of [
      { ...contract, tariffId: randomUUID() },
      { ...contract, revision: 2 },
      { ...contract, tariffId: 'tarife-1', tariffVersion: 1 },
      { ...contract, invoiceIds: ['i1', 'i1'] },
      { ...contract, cancelledAt: at(2) },
      { ...contract, date: '2026-10-01' },
    ])
      rejectsProgramming(() => contractToColumns(invalid, 'c1'))
    rejectsProgramming(() => contractToColumns(contract, 'c0'))
  })

  test('DOM-FIN-010, -012, -051: kayıt, onay, ek protokol, onayı ve ayrılış tablodan core kaydıyla geri okunur', async () => {
    const { id, tariffId, programId } = await tenant()
    const enrolled = {
      id: 'contract-r1',
      studentId: 's1',
      date: at(1, 10),
      amount: 3_050_000,
      title: 'Kayıt sözleşmesi',
      invoiceIds: ['inv-r1', 'inv-r2', 'inv-r3'],
      academicYear: 2026,
      ...terms(tariffId, programId),
    }
    const legacyContract = {
      id: 'contract-s2',
      studentId: 's2',
      date: at(1),
      amount: 100,
      title: 'Eski',
    }
    const legacy = { ...legacyInvoice, id: 'inv-s2-0', studentId: 's2' }
    const r = [1, 2, 3].map((n) => renewalInvoice(`inv-r${String(n)}`, n))

    // Kesin kayıt: sözleşme taksitlerinden önce yazılmak zorunda değildir; depo sıralar.
    const first = await writeContractsAndInvoices(
      db,
      id,
      [
        ...r.map((item) => insert('invoices', item)),
        insert('contracts', enrolled),
        insert('contracts', legacyContract),
        insert('invoices', legacy),
      ],
      new Date(NOW),
    )
    assert.ok(first.every((item) => item.kind === 'insert' && item.version === 1))
    assert.deepEqual(await dataOf(id, 'contracts'), [enrolled, legacyContract])
    assert.deepEqual(await dataOf(id, 'invoices'), [...r, legacy])

    // İmza yetkilisi ve onay (onay planı kopyası); taksit ödemesi önbelleği.
    const approved = {
      ...enrolled,
      signatory,
      approval: {
        method: 'wet_signature',
        approvedAt: at(3),
        approvedByUserId: 'u-yonetici',
        payerName: 'Ayşe Yılmaz',
        plan: r.map((item) => planLine(item.id, item.installment)),
      },
    }
    const paid = { ...r[0]!, paidAt: at(4), method: 'Kredi kartı', updatedAt: at(4) }
    await writeContractsAndInvoices(
      db,
      id,
      [update('contracts', approved, 1), update('invoices', paid, 1)],
      new Date(NOW),
    )

    // Ek protokol taslağı: önceki sürümün koşullarıyla yeni sürüm, boş taksit listesi; imza ve onay
    // yeniden alınır (core `amendContract`).
    const amendmentBase = {
      ...enrolled,
      id: 'contract-r2',
      date: at(5),
      title: 'Kayıt sözleşmesi · Ek protokol 1',
      amount: 3_000_000,
      revision: 2,
      amendsContractId: 'contract-r1',
      amendmentReason: 'Taksit sayısı değişti',
    }
    const draft = {
      ...amendmentBase,
      invoiceIds: [],
      proposedPlan: {
        kept: [planLine('inv-r1', 1)],
        replacedInvoiceIds: ['inv-r2', 'inv-r3'],
        added: [planLine(null, 2), planLine(null, 3), planLine(null, 4)],
      },
    }
    await writeContractsAndInvoices(db, id, [insert('contracts', draft)], new Date(NOW))
    assert.deepEqual((await loadContracts(db, id, { ids: ['contract-r2'] }))[0]?.data, draft)

    // Onay: açık taksitler arşivlenir, yeni taksitler eklenir; önceki sürüm listesini korur.
    const added = [2, 3, 4].map((n) => ({
      id: `inv-a${String(n)}`,
      studentId: 's1',
      installment: n,
      amount: 1_000_000,
      dueDate: at(10 + n),
      paidAt: null,
      method: null,
      reminderAt: null,
      feeKind: 'tuition',
      contractId: 'contract-r2',
      academicYear: 2026,
    }))
    const approvedAmendment = {
      ...amendmentBase,
      invoiceIds: ['inv-r1', ...added.map((item) => item.id)],
      signatory,
      approval: { ...approved.approval, approvedAt: at(6), plan: [planLine('inv-r1', 1)] },
    }
    await writeContractsAndInvoices(
      db,
      id,
      [
        update('contracts', approvedAmendment, 1),
        { kind: 'archive', collection: 'invoices', id: 'inv-r2', expectedVersion: 1 },
        { kind: 'archive', collection: 'invoices', id: 'inv-r3', expectedVersion: 1 },
        ...added.map((item) => insert('invoices', item)),
      ],
      new Date(NOW),
    )
    assert.deepEqual(await dataOf(id, 'contracts'), [approved, legacyContract, approvedAmendment])
    assert.deepEqual(await dataOf(id, 'invoices'), [paid, legacy, ...added])
    // Arşivli taksit kendi değerleriyle okunur; önceki sürüm onu listesinde taşımayı sürdürür.
    const archived = await loadInvoices(db, id, { ids: ['inv-r2'], includeArchived: true })
    assert.deepEqual(archived[0]?.data, r[1])
    assert.ok(archived[0]?.archivedAt)

    // Ayrılış: kalan açık taksitler düşer, borç taksiti eklenir; sınıf arşivi onaylı sürümün sınıfını aktarır.
    const debt = {
      id: 'inv-borc',
      studentId: 's1',
      installment: 5,
      amount: 300_000,
      dueDate: at(20),
      paidAt: null,
      method: null,
      reminderAt: null,
      feeKind: 'tuition',
      contractId: 'contract-r2',
    }
    const withdrawn = { ...approvedAmendment, invoiceIds: ['inv-r1', 'inv-borc'] }
    const moved = { ...approved, classId: 'c-10a' }
    const written = await writeContractsAndInvoices(
      db,
      id,
      [
        update('contracts', withdrawn, 2),
        update('contracts', moved, 2),
        ...added.map((item): RecordWrite => ({
          kind: 'archive',
          collection: 'invoices',
          id: item.id,
          expectedVersion: 1,
        })),
        insert('invoices', debt),
      ],
      new Date(NOW),
    )
    assert.deepEqual(
      written
        .filter((item) => item.collection === 'contracts')
        .map((item) => [item.id, item.version]),
      [
        ['contract-r1', 3],
        ['contract-r2', 3],
      ],
    )
    assert.deepEqual(await dataOf(id, 'contracts'), [moved, legacyContract, withdrawn])
    assert.deepEqual(await dataOf(id, 'invoices'), [paid, legacy, debt])

    // Diziden düşen bağ silinmez, arşivlenir.
    const links = await db
      .select()
      .from(contractInvoices)
      .where(
        and(eq(contractInvoices.institutionId, id), eq(contractInvoices.contractId, 'contract-r2')),
      )
      .orderBy(asc(contractInvoices.invoiceId))
    assert.deepEqual(
      links.map((link) => [link.invoiceId, link.position, link.archivedAt !== null]),
      [
        ['inv-a2', 1, true],
        ['inv-a3', 2, true],
        ['inv-a4', 3, true],
        ['inv-borc', 1, false],
        ['inv-r1', 0, false],
      ],
    )
  })

  test('sürüm çakışması 409, canlı kayda ekleme 409, şemasız kayıt 500; hiçbir satır yazılmaz', async () => {
    const { id } = await tenant()
    const contract = {
      id: 'c1',
      studentId: 's1',
      date: at(1),
      amount: 0,
      title: 'Sözleşme',
      invoiceIds: ['i1'],
    }
    const invoice = { ...legacyInvoice, id: 'i1', contractId: 'c1' }
    await writeContractsAndInvoices(
      db,
      id,
      [insert('contracts', contract), insert('invoices', invoice)],
      new Date(NOW),
    )
    const snapshot = async () => ({
      contracts: await db.select().from(contracts).where(eq(contracts.institutionId, id)),
      invoices: await db.select().from(invoices).where(eq(invoices.institutionId, id)),
      links: await db.select().from(contractInvoices).where(eq(contractInvoices.institutionId, id)),
    })
    const before = await snapshot()
    const expectStatus = async (writes: RecordWrite[], status: number) => {
      await assert.rejects(
        writeContractsAndInvoices(db, id, writes, new Date(NOW)),
        (error: unknown) => {
          assert.ok(error instanceof AppError)
          assert.equal(error.statusCode, status)
          return true
        },
      )
      assert.deepEqual(await snapshot(), before)
    }
    await expectStatus([update('contracts', { ...contract, title: 'Yeni' }, 5)], 409)
    await expectStatus([insert('invoices', { ...invoice, amount: 5 })], 409)
    await expectStatus(
      [
        update('contracts', { ...contract, invoiceIds: [] }, 1),
        update('invoices', { ...invoice, paidCents: 1 }, 1),
      ],
      500,
    )
    await expectStatus([insert('students' as 'invoices', { id: 's9' })], 500)
    // Taksitin sözleşmesi tabloda yoksa (kopyalanmamış eski kayıt) programlama hatasıdır.
    await expectStatus(
      [insert('invoices', { ...invoice, id: 'i2', installment: 2, contractId: 'c-yok' })],
      500,
    )
  })

  test('ADR 0010 karar 8: loadScope süzgeçleri kolon koşuluna çevrilir; çevrilemeyen süzgeç 500', async () => {
    const { id } = await tenant()
    const contract = (key: string, studentId: string) => ({
      id: key,
      studentId,
      date: at(1),
      amount: 0,
      title: 'Sözleşme',
      invoiceIds: [],
      classId: `class-${studentId}`,
    })
    const invoice = (key: string, studentId: string, extra: RecordData = {}) => ({
      ...legacyInvoice,
      id: key,
      studentId,
      paidAt: null,
      method: null,
      ...extra,
    })
    await writeContractsAndInvoices(
      db,
      id,
      [
        insert('contracts', contract('ca', 'sa')),
        insert('contracts', contract('cb', 'sb')),
        insert(
          'invoices',
          invoice('ia-paid', 'sa', { contractId: 'ca', paidAt: at(5), method: 'Nakit' }),
        ),
        insert(
          'invoices',
          invoice('ia-late', 'sa', { contractId: 'ca', installment: 2, dueDate: at(5) }),
        ),
        insert(
          'invoices',
          invoice('ia-due', 'sa', { contractId: 'ca', installment: 3, dueDate: at(6) }),
        ),
        insert('invoices', invoice('ib', 'sb', { dueDate: at(20) })),
      ],
      new Date(NOW),
    )
    const ids = async (match: Parameters<typeof loadInvoices>[2]) =>
      (await loadInvoices(db, id, match)).map((row) => row.id)
    const studentA = { kind: 'equals' as const, field: 'studentId', values: ['sa'] }
    assert.deepEqual(await ids({ match: [studentA] }), ['ia-paid', 'ia-late', 'ia-due'])
    assert.deepEqual(await ids({ match: [{ field: 'studentId', values: ['sb'] }] }), ['ib'])
    assert.deepEqual(await ids({ match: [{ field: 'studentId', values: [] }] }), [])
    assert.deepEqual(
      await ids({ match: [{ kind: 'equals', field: 'contractId', values: ['ca'] }] }),
      ['ia-paid', 'ia-late', 'ia-due'],
    )
    assert.deepEqual(
      await ids({
        match: [
          {
            kind: 'any',
            matches: [
              { field: 'contractId', values: ['zz'] },
              { field: 'studentId', values: ['sb'] },
            ],
          },
        ],
      }),
      ['ib'],
    )
    assert.deepEqual(await ids({ ids: ['ib', 'ia-due', 'yok'] }), ['ia-due', 'ib'])
    assert.deepEqual(await ids({ ids: [] }), [])
    // Durum: bugün 6 Ekim (İstanbul). Vade 5'i gecikmiş, 6'sı yaklaşan.
    const status = (statuses: ('Ödendi' | 'Gecikmiş' | 'Yaklaşan')[]) =>
      ids({
        match: [
          {
            kind: 'invoiceStatus',
            statuses,
            today: '2026-10-06',
            todayStart: '2026-10-05T21:00:00.000Z',
          },
        ],
      })
    assert.deepEqual(await status(['Ödendi']), ['ia-paid'])
    assert.deepEqual(await status(['Gecikmiş']), ['ia-late'])
    assert.deepEqual(await status(['Yaklaşan']), ['ia-due', 'ib'])
    assert.deepEqual(await status([]), [])
    const range = (field: string, fromDay: string, toDay: string) =>
      ids({
        match: [
          {
            kind: 'dayRange',
            field,
            fromDay,
            toDay,
            fromInstant: `${fromDay}T00:00:00.000Z`,
            toInstant: `${toDay}T23:59:59.999Z`,
          },
        ],
      })
    // ia-paid'in vadesi 10 Ekim, ia-late'inki 5 Ekim.
    assert.deepEqual(await range('dueDate', '2026-10-06', '2026-10-20'), [
      'ia-paid',
      'ia-due',
      'ib',
    ])
    assert.deepEqual(await range('paidAt', '2026-10-05', '2026-10-05'), ['ia-paid'])

    assert.deepEqual(
      (
        await loadContracts(db, id, {
          match: [{ kind: 'equals', field: 'studentId', values: ['sb'] }],
        })
      ).map((row) => row.id),
      ['cb'],
    )
    assert.deepEqual(
      (await loadContracts(db, id, { match: [{ field: 'classId', values: ['class-sa'] }] })).map(
        (row) => row.id,
      ),
      ['ca'],
    )

    for (const run of [
      () => invoiceFilter({ kind: 'active', field: 'isActive', active: true }),
      () => invoiceFilter({ field: 'feeKind', values: ['tuition'] }),
      () => invoiceFilter({ kind: 'settled', expiredBefore: at(1) }),
      () =>
        invoiceFilter({
          kind: 'dayRange',
          field: 'reminderAt',
          fromDay: null,
          toDay: null,
          fromInstant: null,
          toInstant: null,
        }),
      () =>
        contractFilter({
          kind: 'invoiceStatus',
          statuses: [],
          today: '2026-10-06',
          todayStart: at(5, 21),
        }),
      () => contractFilter({ field: 'title', values: ['x'] }),
    ])
      rejectsProgramming(run)
  })

  test('başka kurumun satırı yüklenmez', async () => {
    const first = await tenant()
    const second = await tenant()
    const contract = {
      id: 'c1',
      studentId: 's1',
      date: at(1),
      amount: 0,
      title: 'Sözleşme',
      invoiceIds: ['i1'],
    }
    const invoice = { ...legacyInvoice, id: 'i1', contractId: 'c1' }
    await writeContractsAndInvoices(
      db,
      first.id,
      [insert('contracts', contract), insert('invoices', invoice)],
      new Date(NOW),
    )
    assert.deepEqual(await loadContracts(db, second.id), [])
    assert.deepEqual(await loadInvoices(db, second.id), [])
    assert.deepEqual(await dataOf(first.id, 'contracts'), [contract])
  })
})
