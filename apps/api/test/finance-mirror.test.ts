import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, asc, eq, sql } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'
import { payInvoice } from '@kampus/school-core/lib/payments-demo.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import type { RecordData } from '../src/db/collections.ts'
import { mirrorFinanceRecords } from '../src/db/finance-mirror-store.ts'
import { auditFinanceRecords } from '../src/db/invoice-audit.ts'
import { loadInvoices } from '../src/db/invoice-store.ts'
import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { contractInvoices } from '../src/db/schema/contract-invoices.ts'
import { contracts } from '../src/db/schema/contracts.ts'
import { invoices } from '../src/db/schema/invoices.ts'
import type { ServiceContext } from '../src/plugins/authenticate.ts'
import { runOperation } from '../src/services/operation-runner.ts'
import { buildTestApp, createInstitution, createTestDatabase, FIXED_NOW } from './support/app.ts'
import { assertFinanceMirror } from './support/finance-mirror.ts'

/**
 * Taksit ve sözleşmenin çift yazması (ON-046e; ADR 0010 adım 3, karar 4; DOM-FIN-010, -012):
 * kaynak `records`, ayna tablolar. Tohum ve çalıştırıcı yazması aynayı aynı transaction'da
 * eşitler; tabloya sığmayan kaynak kaydı işlemi durdurmaz, onaylı sözleşme değişmezliği durdurur.
 */

const LATER = new Date('2026-10-06T10:00:00.000Z')
const seed = createSeed(FIXED_NOW)
const at = (day: number, hour = 9) => new Date(Date.UTC(2026, 9, day, hour)).toISOString()

const items = (collection: 'invoices' | 'contracts', list: readonly RecordData[]) =>
  list.map((data) => ({ collection, id: String(data.id), data }))

describe('ON-046e: taksit ve sözleşme çift yazması', () => {
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

  async function institution(
    extra: { collection: 'invoices' | 'contracts'; id: string; data: RecordData }[] = [],
  ) {
    const created = await createInstitution(app)
    await insertMissingRecords(
      db,
      created.id,
      [...items('contracts', seed.contracts), ...items('invoices', seed.invoices), ...extra],
      FIXED_NOW,
    )
    const ctx: ServiceContext = {
      db,
      institutionId: created.id,
      actor: {
        userId: created.admin.id,
        role: 'yonetici',
        membershipId: created.adminMembershipId,
      },
      now: LATER,
      log: app.log,
    }
    return ctx
  }

  const tables = (institutionId: string) =>
    Promise.all([
      db
        .select()
        .from(contracts)
        .where(eq(contracts.institutionId, institutionId))
        .orderBy(asc(contracts.id)),
      db
        .select()
        .from(invoices)
        .where(eq(invoices.institutionId, institutionId))
        .orderBy(asc(invoices.id)),
      db
        .select()
        .from(contractInvoices)
        .where(eq(contractInvoices.institutionId, institutionId))
        .orderBy(asc(contractInvoices.contractId), asc(contractInvoices.invoiceId)),
    ])

  test('tohum taksit ve sözleşmeyi tablolara da yazar; ikinci tohum ve sıra düzeltmesi aynayı korur', async () => {
    const ctx = await institution()
    const [contractRows, invoiceRows] = await tables(ctx.institutionId)
    assert.equal(contractRows.length, seed.contracts.length)
    assert.equal(invoiceRows.length, seed.invoices.length)
    await assertFinanceMirror(db, [ctx.institutionId])

    const before = await tables(ctx.institutionId)
    await insertMissingRecords(db, ctx.institutionId, items('invoices', seed.invoices), FIXED_NOW)
    assert.deepEqual(await tables(ctx.institutionId), before)

    // Ters sırayla tohum: records sırayı düzeltir (sürüm artmaz), ayna aynı sırayı alır.
    const reversed = items('invoices', seed.invoices.slice(0, 3)).reverse()
    await insertMissingRecords(db, ctx.institutionId, reversed, FIXED_NOW)
    await assertFinanceMirror(db, [ctx.institutionId])
  })

  test('DOM-FIN-030: çalıştırıcı yazması iki yere aynı sürümle gider; başka kurumun aynası değişmez', async () => {
    const ctx = await institution()
    const other = await institution()
    const otherBefore = await tables(other.institutionId)
    const unpaid = seed.invoices.find((invoice) => !invoice.paidAt)
    assert.ok(unpaid)
    const outcome = await runOperation(ctx, {
      action: 'invoice.pay',
      entity: { type: 'invoices', id: unpaid.id },
      collections: ['invoices'],
      run: (state, { now }) => payInvoice(state, unpaid.id, 'Kredi kartı', now),
    })
    assert.deepEqual(outcome.changes, [
      { kind: 'update', collection: 'invoices', id: unpaid.id, version: 2 },
    ])
    const [row] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.institutionId, ctx.institutionId), eq(invoices.id, unpaid.id)))
    assert.equal(row?.version, 2)
    assert.equal(row?.paymentMethod, 'card')
    assert.equal(row?.paidAt?.toISOString(), LATER.toISOString())
    await assertFinanceMirror(db, [ctx.institutionId, other.institutionId])
    assert.deepEqual(await tables(other.institutionId), otherBefore)
  })

  test('DOM-FIN-012: yeni sözleşme, taksitleri, invoiceIds bağı ve arşiv aynaya aynı işlemde yazılır', async () => {
    const ctx = await institution()
    const [dropped] = seed.invoices
    assert.ok(dropped)
    await runOperation(ctx, {
      action: 'contract.create',
      entity: { type: 'contracts', id: 'test-contract' },
      collections: ['contracts', 'invoices'],
      run: (state) => {
        state.contracts.push({
          id: 'test-contract',
          studentId: 's1',
          date: at(1, 10),
          amount: 2_000_000,
          title: 'Yenileme sözleşmesi',
          invoiceIds: ['test-inv-2', 'test-inv-1'],
        } as (typeof state.contracts)[number])
        for (const installment of [1, 2])
          state.invoices.push({
            id: `test-inv-${String(installment)}`,
            studentId: 's1',
            contractId: 'test-contract',
            installment,
            amount: 1_000_000,
            dueDate: at(10 + installment),
            paidAt: null,
            method: null,
            reminderAt: null,
          } as (typeof state.invoices)[number])
        state.invoices = state.invoices.filter((invoice) => invoice.id !== dropped.id)
      },
    })
    await assertFinanceMirror(db, [ctx.institutionId])
    const links = await db
      .select({ invoiceId: contractInvoices.invoiceId, position: contractInvoices.position })
      .from(contractInvoices)
      .where(
        and(
          eq(contractInvoices.institutionId, ctx.institutionId),
          eq(contractInvoices.contractId, 'test-contract'),
        ),
      )
      .orderBy(asc(contractInvoices.position))
    assert.deepEqual(links, [
      { invoiceId: 'test-inv-2', position: 0 },
      { invoiceId: 'test-inv-1', position: 1 },
    ])
    const [archived] = await db
      .select({ archivedAt: invoices.archivedAt, version: invoices.version })
      .from(invoices)
      .where(and(eq(invoices.institutionId, ctx.institutionId), eq(invoices.id, dropped.id)))
    assert.deepEqual(archived, { archivedAt: LATER, version: 2 })

    // invoiceIds'ten düşen bağ arşivlenir (ayrılış), satır silinmez.
    await runOperation(ctx, {
      action: 'contract.drop',
      entity: { type: 'contracts', id: 'test-contract' },
      collections: ['contracts'],
      run: (state) => {
        const contract = state.contracts.find((item) => item.id === 'test-contract')
        assert.ok(contract)
        contract.invoiceIds = ['test-inv-1']
      },
    })
    await assertFinanceMirror(db, [ctx.institutionId])
    const [dropLink] = await db
      .select({ archivedAt: contractInvoices.archivedAt })
      .from(contractInvoices)
      .where(
        and(
          eq(contractInvoices.institutionId, ctx.institutionId),
          eq(contractInvoices.invoiceId, 'test-inv-2'),
        ),
      )
    assert.ok(dropLink?.archivedAt)
  })

  test('tabloya sığmayan kaynak kaydı işlemi durdurmaz, aynada yer almaz; öteki kayıtlar eşitlenir', async () => {
    // Tarifesi yarım (kısıt) sözleşme ve taksit numarası olmayan bozuk eski taksit.
    const broken = [
      {
        collection: 'contracts' as const,
        id: 'test-broken-contract',
        data: {
          id: 'test-broken-contract',
          studentId: 's2',
          date: at(1),
          amount: 1,
          title: 'Bozuk',
          payer: 'guardian',
        },
      },
      {
        collection: 'invoices' as const,
        id: 'test-broken-invoice',
        data: {
          id: 'test-broken-invoice',
          studentId: 's2',
          amount: 1,
          dueDate: at(9),
          paidAt: null,
          method: null,
          reminderAt: null,
        },
      },
    ]
    const ctx = await institution(broken)
    const [contractRows, invoiceRows] = await tables(ctx.institutionId)
    assert.equal(contractRows.length, seed.contracts.length)
    assert.equal(invoiceRows.length, seed.invoices.length)
    assert.ok(!invoiceRows.some((row) => row.id === 'test-broken-invoice'))

    const unpaid = seed.invoices.find((invoice) => !invoice.paidAt)
    assert.ok(unpaid)
    const outcome = await runOperation(ctx, {
      action: 'invoice.touch',
      entity: { type: 'invoices', id: unpaid.id },
      collections: ['invoices'],
      run: (state, { now }) => {
        payInvoice(state, unpaid.id, 'Nakit', now)
        const bad = state.invoices.find((invoice) => invoice.id === 'test-broken-invoice')
        assert.ok(bad)
        bad.reminderAt = now
      },
    })
    assert.equal(outcome.changes.length, 2)
    const source = await loadRecords(db, ctx.institutionId, ['invoices'])
    assert.equal(source.find((row) => row.id === 'test-broken-invoice')?.version, 2)
    const [paid] = await db
      .select({ method: invoices.paymentMethod, version: invoices.version })
      .from(invoices)
      .where(and(eq(invoices.institutionId, ctx.institutionId), eq(invoices.id, unpaid.id)))
    assert.deepEqual(paid, { method: 'cash', version: 2 })
    assert.equal(
      await mirrorFinanceRecords(db, ctx.institutionId, [
        { kind: 'archive', collection: 'invoices', id: 'test-broken-invoice', expectedVersion: 2 },
        {
          kind: 'archive',
          collection: 'contracts',
          id: 'test-broken-contract',
          expectedVersion: 1,
        },
      ]),
      2,
    )
  })

  test('ON-046f okuma geçişi ön koşulu: örnek veri ve core biçimli fikstürde 046a şema uyumsuzluğu 0, ayna birebir', async () => {
    const ctx = await institution([
      {
        collection: 'contracts',
        id: 'test-precheck',
        data: {
          id: 'test-precheck',
          studentId: 's4',
          date: at(1, 10),
          amount: 2_000_000,
          title: 'Kayıt sözleşmesi',
          academicYear: 2026,
          invoiceIds: ['test-precheck-1'],
        },
      },
      {
        collection: 'invoices',
        id: 'test-precheck-1',
        data: {
          id: 'test-precheck-1',
          studentId: 's4',
          contractId: 'test-precheck',
          academicYear: 2026,
          installment: 1,
          amount: 2_000_000,
          dueDate: at(11),
          paidAt: at(5, 12),
          method: 'Banka havalesi',
          reminderAt: null,
          feeKind: 'tuition',
          createdAt: at(1, 10),
          updatedAt: at(5, 12),
        },
      },
    ])
    const report = await auditFinanceRecords(db, ctx.institutionId)
    assert.deepEqual(report.storeShapeMismatches, { invoices: 0, contracts: 0 })
    await assertFinanceMirror(db, [ctx.institutionId])
  })

  test('ON-046f: gevşek biçimli kaynak kaydı (gün başı vadesi, eksik alan) aynaya girmez; tablo satırı core kaydına hatasız döner', async () => {
    const lenient = {
      id: 'test-lenient',
      studentId: 's1',
      installment: 9,
      amount: 10_000,
      dueDate: '2026-11-15T00:00:00.000Z',
      paidAt: null,
      method: null,
    }
    const ctx = await institution([{ collection: 'invoices', id: lenient.id, data: lenient }])
    const report = await auditFinanceRecords(db, ctx.institutionId)
    assert.deepEqual(report.storeShapeMismatches, { invoices: 1, contracts: 0 })
    const [, invoiceRows] = await tables(ctx.institutionId)
    assert.ok(!invoiceRows.some((row) => row.id === lenient.id))
    await assertFinanceMirror(db, [ctx.institutionId])
    const loaded = await loadInvoices(db, ctx.institutionId, { includeArchived: true })
    assert.equal(loaded.length, seed.invoices.length)
  })

  test('DOM-FIN-010: onaylı sözleşmenin taksit koşulunu değiştiren yazma aynada 55000 alır; records de geri alınır', async () => {
    const approved = {
      id: 'test-approved',
      studentId: 's3',
      date: at(1, 10),
      amount: 1_000_000,
      title: 'Kayıt sözleşmesi',
      invoiceIds: ['test-approved-inv'],
      signatory: {
        name: 'Kurucu',
        role: 'founder',
        recordedAt: at(2),
        recordedByUserId: 'u-yonetici',
      },
      approval: {
        method: 'wet_signature',
        approvedAt: at(3),
        approvedByUserId: 'u-yonetici',
        payerName: 'Ayşe Yılmaz',
        plan: [
          {
            invoiceId: 'test-approved-inv',
            installment: 1,
            amount: 1_000_000,
            dueDate: at(11),
            feeKind: 'tuition',
          },
        ],
      },
    }
    const invoice = {
      id: 'test-approved-inv',
      studentId: 's3',
      contractId: 'test-approved',
      installment: 1,
      amount: 1_000_000,
      dueDate: at(11),
      paidAt: null,
      method: null,
      reminderAt: null,
    }
    const ctx = await institution([
      { collection: 'contracts', id: approved.id, data: approved },
      { collection: 'invoices', id: invoice.id, data: invoice },
    ])
    await assertFinanceMirror(db, [ctx.institutionId])
    const before = await loadRecords(db, ctx.institutionId, ['invoices'])
    await assert.rejects(
      runOperation(ctx, {
        action: 'invoice.amend',
        entity: { type: 'invoices', id: invoice.id },
        collections: ['invoices'],
        loadScope: { invoices: { ids: [invoice.id] } },
        run: (state) => {
          const target = state.invoices[0]
          assert.ok(target)
          target.amount = 1
        },
      }),
    )
    assert.deepEqual(await loadRecords(db, ctx.institutionId, ['invoices']), before)
    await assertFinanceMirror(db, [ctx.institutionId])
    const [{ count } = { count: -1 }] =
      (
        (await db.execute(
          sql`select count(*)::int as count from invoices where institution_id = ${ctx.institutionId} and amount_cents = 1`,
        )) as { rows?: { count: number }[] }
      ).rows ?? []
    assert.equal(count, 0)
  })
})
