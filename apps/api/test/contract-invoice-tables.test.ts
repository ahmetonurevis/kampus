import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import { FEE_ITEM_KINDS } from '@kampus/school-core/lib/fee-tariffs.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { contractInvoices } from '../src/db/schema/contract-invoices.ts'
import { contracts } from '../src/db/schema/contracts.ts'
import { invoices } from '../src/db/schema/invoices.ts'
import { databaseErrorInfo } from '../src/errors.ts'
import { buildTestApp, createInstitution, createTestDatabase, FIXED_NOW } from './support/app.ts'

/**
 * Taksit ve sözleşme tabloları (ON-046c; migration 0061; ADR 0010 karar 1, 4, 6; IST-092,
 * DOM-FIN-010, -012). Tablolar boş açılır, hiçbir kod yazmaz; satırlar doğrudan Drizzle ile yazılır
 * ve ihlal kısıt adıyla doğrulanır. Her test kendi kurumunu kurar.
 */

const TABLES = ['contracts', 'invoices', 'contract_invoices'] as const
const AT = FIXED_NOW

type ContractRow = typeof contracts.$inferInsert
type InvoiceRow = typeof invoices.$inferInsert

async function violates(work: Promise<unknown>, constraint: string, code?: string) {
  await assert.rejects(work, (error: unknown) => {
    const info = databaseErrorInfo(error)
    assert.equal(info?.constraint, constraint, JSON.stringify(info))
    if (code) assert.equal(info?.code, code)
    return true
  })
}

async function rejectsImmutable(work: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(work, (error: unknown) => {
    assert.equal(databaseErrorInfo(error)?.code, '55000')
    const cause = (error as { cause?: { message?: string } }).cause
    assert.match(cause?.message ?? String(error), pattern)
    return true
  })
}

describe('0061: taksit ve sözleşme tabloları', () => {
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

  const rows = async <T>(query: ReturnType<typeof sql>) =>
    ((await db.execute(query)) as unknown as { rows: T[] }).rows
  const tableList = sql.join(
    TABLES.map((table) => sql`${table}`),
    sql`, `,
  )

  const contract = (institutionId: string, id: string, extra: Partial<ContractRow> = {}) =>
    ({
      institutionId,
      id,
      studentId: 's1',
      rootContractId: id,
      title: 'Eğitim sözleşmesi',
      contractAt: AT,
      amountCents: 300_00,
      position: 0,
      ...extra,
    }) satisfies ContractRow

  const signatory = {
    signatoryName: 'Kurucu',
    signatoryRole: 'founder',
    signatoryRecordedAt: AT,
    signatoryRecordedByUserId: 'u1',
  } satisfies Partial<ContractRow>
  const approval = {
    ...signatory,
    approvalMethod: 'wet_signature',
    approvedAt: AT,
    approvedByUserId: 'u1',
    approvalPayerName: 'Ayşe Yılmaz',
    approvalPlan: [],
  } satisfies Partial<ContractRow>

  const invoice = (
    institutionId: string,
    id: string,
    contractId: string | null,
    extra: Partial<InvoiceRow> = {},
  ) =>
    ({
      institutionId,
      id,
      studentId: 's1',
      contractId,
      rootContractId: contractId,
      installment: 1,
      amountCents: 100_00,
      dueDate: '2026-10-10',
      position: 0,
      ...extra,
    }) satisfies InvoiceRow

  /** Onaylı c1, onu değiştiren onaysız c2 ve c1'in iki taksiti (biri c2'nin listesinde de). */
  async function chain() {
    const { id } = await createInstitution(app)
    await db.insert(contracts).values(contract(id, 'c1', approval))
    await db.insert(contracts).values(
      contract(id, 'c2', {
        rootContractId: 'c1',
        amendsContractId: 'c1',
        revision: 2,
        amendmentReason: 'Plan değişti',
        position: 1024,
      }),
    )
    await db
      .insert(invoices)
      .values([
        invoice(id, 'i1', 'c1', { paidAt: AT, paymentMethod: 'cash' }),
        invoice(id, 'i2', 'c1', { installment: 2, position: 1024 }),
      ])
    await db.insert(contractInvoices).values([
      { institutionId: id, contractId: 'c1', invoiceId: 'i1', position: 0 },
      { institutionId: id, contractId: 'c1', invoiceId: 'i2', position: 1 },
      { institutionId: id, contractId: 'c2', invoiceId: 'i1', position: 0 },
    ])
    return id
  }

  test('kurum kolonları zorunlu, zamanlar timestamptz, her tablo ve kolonun Türkçe yorumu var', async () => {
    const columns = await rows<{
      table_name: string
      column_name: string
      data_type: string
      is_nullable: 'YES' | 'NO'
      comment: string | null
    }>(
      sql`select c.table_name, c.column_name, c.data_type, c.is_nullable,
            col_description(format('%I', c.table_name)::regclass, c.ordinal_position::int) as comment
          from information_schema.columns c
          where c.table_schema = 'public' and c.table_name in (${tableList})`,
    )
    for (const table of TABLES) {
      const own = columns.filter((column) => column.table_name === table)
      assert.ok(own.length > 0, `${table} yok`)
      const byName = new Map(own.map((column) => [column.column_name, column]))
      for (const required of ['institution_id', 'created_at', 'updated_at', 'version'])
        assert.equal(byName.get(required)?.is_nullable, 'NO', `${table}.${required}`)
      assert.equal(byName.get('archived_at')?.is_nullable, 'YES', `${table}.archived_at`)
      for (const column of own) {
        assert.notEqual(column.data_type, 'timestamp without time zone', column.column_name)
        assert.ok(column.comment, `${table}.${column.column_name} yorumsuz`)
      }
      const [described] = await rows<{ comment: string | null }>(
        sql`select obj_description(${table}::regclass, 'pg_class') as comment`,
      )
      assert.ok(described?.comment, `${table} yorumsuz`)
    }
    // Para kuruş bigint; vade takvim günü.
    const typeOf = (table: string, column: string) =>
      columns.find((item) => item.table_name === table && item.column_name === column)?.data_type
    assert.equal(typeOf('invoices', 'amount_cents'), 'bigint')
    assert.equal(typeOf('contracts', 'amount_cents'), 'bigint')
    assert.equal(typeOf('invoices', 'due_date'), 'date')
  })

  test('her indeks institution_id ile başlar; her yabancı anahtar kurumla başlar, indekslidir ve restrict', async () => {
    const indexes = await rows<{ tablename: string; indexname: string; indexdef: string }>(
      sql`select tablename, indexname, indexdef from pg_indexes
          where schemaname = 'public' and tablename in (${tableList})`,
    )
    for (const index of indexes) {
      assert.match(index.indexdef, /\(institution_id[,)]/, index.indexname)
      assert.ok(index.indexname.startsWith(`${index.tablename}_`), index.indexname)
      assert.match(index.indexname, /_(idx|key|pkey)$/, index.indexname)
    }
    const foreignKeys = await rows<{
      table_name: string
      conname: string
      columns: string[]
      confdeltype: string
      confrelid: string
    }>(
      sql`select c.conrelid::regclass::text as table_name, c.conname, c.confdeltype::text as confdeltype,
            c.confrelid::regclass::text as confrelid,
            array(select a.attname::text from unnest(c.conkey) with ordinality k(attnum, n)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
              order by k.n) as columns
          from pg_constraint c
          where c.conrelid::regclass::text in (${tableList}) and c.contype = 'f'`,
    )
    const indexColumns = await rows<{ table_name: string; columns: string[] }>(
      sql`select i.indrelid::regclass::text as table_name,
            array(select a.attname::text from unnest(i.indkey) with ordinality k(attnum, n)
              join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
              order by k.n) as columns
          from pg_index i where i.indrelid::regclass::text in (${tableList})`,
    )
    assert.equal(foreignKeys.length, 10)
    for (const key of foreignKeys) {
      assert.equal(key.columns[0], 'institution_id', key.conname)
      if (key.confrelid !== 'institutions') assert.equal(key.confdeltype, 'r', key.conname)
      const covered = indexColumns.some(
        (index) =>
          index.table_name === key.table_name &&
          key.columns.every((column, position) => index.columns[position] === column),
      )
      assert.ok(covered, `${key.conname} indeksli olmalı`)
    }
  })

  test('IST-092, DOM-FIN-010: onaylı sözleşmede koşullar 55000 alır; sınıf, sıra ve sürüm değişir', async () => {
    const id = await chain()
    const where = and(eq(contracts.institutionId, id), eq(contracts.id, 'c1'))
    await rejectsImmutable(
      db.update(contracts).set({ title: 'Değişti' }).where(where),
      /contracts rows are immutable/,
    )
    await rejectsImmutable(
      db.update(contracts).set({ amountCents: 1 }).where(where),
      /contracts rows are immutable/,
    )
    await rejectsImmutable(
      db.update(contracts).set({ archivedAt: AT }).where(where),
      /contracts rows are immutable/,
    )
    // Ödeme koşulu da sözleşmenin koşuludur; onaydan sonra değişmez (DOM-FIN-013).
    await rejectsImmutable(
      db
        .update(contracts)
        .set({
          paymentTerm: {
            kind: 'upfront',
            minInstallments: 1,
            maxInstallments: 1,
            discountPercentBasisPoints: null,
            discountAmountCents: null,
            installmentCount: 1,
          },
        })
        .where(where),
      /contracts rows are immutable/,
    )
    await db
      .update(contracts)
      .set({ classId: 'c-yeni', position: 2048, version: 2, updatedAt: new Date() })
      .where(where)
    const [row] = await db.select().from(contracts).where(where)
    assert.equal(row?.classId, 'c-yeni')
    assert.equal(row?.title, 'Eğitim sözleşmesi')
  })

  test('DOM-FIN-010: onaysız sürüm düzeltilir; iptal edilen ek protokol donar', async () => {
    const id = await chain()
    const where = and(eq(contracts.institutionId, id), eq(contracts.id, 'c2'))
    await db
      .update(contracts)
      .set({ amountCents: 250_00, ...signatory })
      .where(where)
    await db
      .update(contracts)
      .set({ cancelledAt: AT, cancelledByUserId: 'u1', cancelReason: 'Vazgeçildi' })
      .where(where)
    await rejectsImmutable(
      db.update(contracts).set({ amendmentReason: 'Başka' }).where(where),
      /contracts rows are immutable/,
    )
  })

  test('ADR 0010 cevap 6: onaylı sürüme bağlı taksitin tutarı ve vadesi 55000; ödeme önbelleği değişir', async () => {
    const id = await chain()
    const where = (invoiceId: string) =>
      and(eq(invoices.institutionId, id), eq(invoices.id, invoiceId))
    await rejectsImmutable(
      db.update(invoices).set({ amountCents: 1 }).where(where('i2')),
      /invoices rows of an approved contract are immutable/,
    )
    await rejectsImmutable(
      db.update(invoices).set({ dueDate: '2026-11-10' }).where(where('i2')),
      /invoices rows of an approved contract are immutable/,
    )
    await db
      .update(invoices)
      .set({ paidAt: AT, paymentMethod: 'card', reminderAt: AT, archivedAt: AT, version: 2 })
      .where(where('i2'))

    // Onaylı sürüme yalnız bağ satırıyla bağlı (contract_id'si onaysız sürüm) taksit de donar.
    await db.insert(contracts).values(contract(id, 'c3', { studentId: 's1', position: 4096 }))
    await db.insert(invoices).values(invoice(id, 'i3', 'c3', { position: 4096 }))
    await db.update(invoices).set({ amountCents: 90_00 }).where(where('i3'))
    await db
      .insert(contractInvoices)
      .values({ institutionId: id, contractId: 'c1', invoiceId: 'i3', position: 2 })
    await rejectsImmutable(
      db.update(invoices).set({ amountCents: 80_00 }).where(where('i3')),
      /invoices rows of an approved contract are immutable/,
    )
  })

  test('onaylanmamış sürümün ve sözleşmesiz taksitin koşulları düzeltilir', async () => {
    const { id } = await createInstitution(app)
    await db.insert(contracts).values(contract(id, 'c1'))
    await db
      .insert(invoices)
      .values([invoice(id, 'i1', 'c1'), invoice(id, 'i-eski', null, { feeKind: null })])
    await db
      .update(invoices)
      .set({ amountCents: 120_00, dueDate: '2026-12-10', feeKind: 'tuition' })
      .where(eq(invoices.institutionId, id))
    const stored = await db.select().from(invoices).where(eq(invoices.institutionId, id))
    assert.deepEqual(
      stored.map((row) => row.amountCents),
      [120_00, 120_00],
    )
  })

  test('core contract_amendment_open: ikinci açık ek protokol 23505; iptal edilen yer bırakır', async () => {
    const id = await chain()
    const amendment = contract(id, 'c4', {
      rootContractId: 'c1',
      amendsContractId: 'c1',
      revision: 2,
      position: 8192,
    })
    await violates(db.insert(contracts).values(amendment), 'contracts_amendment_open_key', '23505')
    await db
      .update(contracts)
      .set({ cancelledAt: AT, cancelledByUserId: 'u1', cancelReason: 'Vazgeçildi' })
      .where(and(eq(contracts.institutionId, id), eq(contracts.id, 'c2')))
    await db.insert(contracts).values(amendment)
  })

  test('zincirde yinelenen taksit numarası 23505; arşivlenen taksit numarasını bırakır', async () => {
    const id = await chain()
    // c2'nin taksiti c1 zincirindedir; 2 numara i2'de.
    const replacement = invoice(id, 'i5', 'c2', { rootContractId: 'c1', installment: 2 })
    await violates(db.insert(invoices).values(replacement), 'invoices_installment_key', '23505')
    await db
      .update(invoices)
      .set({ archivedAt: AT, version: 2 })
      .where(and(eq(invoices.institutionId, id), eq(invoices.id, 'i2')))
    await db.insert(invoices).values(replacement)
    // Sözleşmesiz eski taksitler numara tekilliğine girmez.
    await db
      .insert(invoices)
      .values([invoice(id, 'i-a', null), invoice(id, 'i-b', null, { position: 1 })])
  })

  test('kök kopyası sürümün kökünden ayrışamaz; başka kurumun sözleşmesine bağlanılamaz', async () => {
    const id = await chain()
    await violates(
      db.insert(invoices).values(invoice(id, 'i9', 'c2', { rootContractId: 'c2' })),
      'invoices_contract_fkey',
      '23503',
    )
    await violates(
      db.insert(contracts).values(
        contract(id, 'c9', {
          rootContractId: 'c2',
          amendsContractId: 'c2',
          revision: 3,
          position: 9000,
        }),
      ),
      'contracts_amends_contract_fkey',
      '23503',
    )
    const other = await createInstitution(app)
    await violates(
      db.insert(invoices).values(invoice(other.id, 'i1', 'c1')),
      'invoices_contract_fkey',
      '23503',
    )
    await violates(
      db
        .insert(contractInvoices)
        .values({ institutionId: other.id, contractId: 'c1', invoiceId: 'i1', position: 0 }),
      'contract_invoices_contract_fkey',
      '23503',
    )
    await violates(
      db.insert(contracts).values(
        contract(id, 'c-tarife', {
          tariffId: randomUUID(),
          tariffVersion: 1,
          grossCents: 1,
          netCents: 1,
          discounts: [],
          extras: [],
          termsApprovedByUserId: 'u1',
          payer: 'guardian',
          position: 9100,
        }),
      ),
      'contracts_tariff_fkey',
      '23503',
    )
  })

  test('alan grupları ve durum kısıtları', async () => {
    const { id } = await createInstitution(app)
    const cases: [Partial<ContractRow>, string][] = [
      [{ approvedAt: AT }, 'contracts_approval_check'],
      [
        {
          approvalMethod: 'electronic',
          approvedAt: AT,
          approvedByUserId: 'u1',
          approvalPayerName: 'Ayşe',
          approvalPlan: [],
        },
        'contracts_approval_requires_signatory_check',
      ],
      [{ tariffVersion: 1 }, 'contracts_terms_check'],
      [{ revision: 2 }, 'contracts_revision_check'],
      [{ rootContractId: 'c-baska' }, 'contracts_revision_check'],
      [
        { cancelledAt: AT, cancelledByUserId: 'u1', cancelReason: 'Yanlış' },
        'contracts_cancel_check',
      ],
      [{ signatoryName: 'Kurucu' }, 'contracts_signatory_check'],
      [{ ...signatory, signatoryRole: 'mudur' }, 'contracts_signatory_role_check'],
      [{ payer: 'kardes' }, 'contracts_payer_check'],
      [{ amountCents: -1 }, 'contracts_amounts_check'],
      [{ currency: 'USD' }, 'contracts_currency_check'],
      [
        { proposedPlan: { kept: [], replacedInvoiceIds: [], added: [] } },
        'contracts_proposed_plan_check',
      ],
      [{ scholarshipCents: 100 }, 'contracts_scholarship_check'],
      [
        {
          paymentTerm: {
            kind: 'upfront',
            minInstallments: 1,
            maxInstallments: 1,
            discountPercentBasisPoints: null,
            discountAmountCents: null,
            installmentCount: 1,
          },
        },
        'contracts_payment_term_check',
      ],
    ]
    for (const [extra, constraint] of cases)
      await violates(
        db.insert(contracts).values(contract(id, `c-${constraint}`, extra)),
        constraint,
        '23514',
      )

    await db.insert(contracts).values(contract(id, 'c1'))
    const invoiceCases: [Partial<InvoiceRow>, string][] = [
      [{ amountCents: 0 }, 'invoices_amount_cents_check'],
      [{ installment: 0 }, 'invoices_installment_check'],
      [{ currency: 'EUR' }, 'invoices_currency_check'],
      [{ paidAt: AT }, 'invoices_paid_check'],
      [{ paidAt: AT, paymentMethod: 'Nakit' }, 'invoices_payment_method_check'],
      [{ rootContractId: null }, 'invoices_contract_root_check'],
    ]
    for (const [extra, constraint] of invoiceCases)
      await violates(
        db.insert(invoices).values(invoice(id, `i-${constraint}`, 'c1', extra)),
        constraint,
        '23514',
      )
    assert.deepEqual(await db.select().from(invoices).where(eq(invoices.institutionId, id)), [])
  })

  test('ON-316, DOM-FIN-004: kalem türü core FEE_ITEM_KINDS anahtarıdır ya da boştur; etiket 23514', async () => {
    const [constraint] = await rows<{ definition: string; comment: string | null }>(
      sql`select pg_get_constraintdef(oid) as definition, obj_description(oid, 'pg_constraint') as comment
            from pg_constraint where conname = 'invoices_fee_kind_check'`,
    )
    assert.ok(constraint, 'invoices_fee_kind_check yok')
    const listed = [...constraint.definition.matchAll(/'([^']+)'/g)].map((match) => match[1])
    assert.deepEqual(listed.toSorted(), [...FEE_ITEM_KINDS].toSorted())
    assert.match(constraint.comment ?? '', /FEE_ITEM_KINDS/)

    const { id } = await createInstitution(app)
    await db.insert(contracts).values(contract(id, 'c1'))
    await db
      .insert(invoices)
      .values([
        ...FEE_ITEM_KINDS.map((feeKind, index) =>
          invoice(id, `i-${feeKind}`, 'c1', { feeKind, installment: index + 1 }),
        ),
        invoice(id, 'i-eski', null, { feeKind: null }),
      ])
    for (const feeKind of ['Öğrenim ücreti', 'registration', 'Tuition', ''])
      await violates(
        db.insert(invoices).values(invoice(id, `i-x-${feeKind}`, null, { feeKind })),
        'invoices_fee_kind_check',
        '23514',
      )
    // Ödeme önbelleği değişen (onaylı olmayan) taksitin kalemi de etikete çevrilemez.
    await violates(
      db
        .update(invoices)
        .set({ feeKind: 'Yemek' })
        .where(and(eq(invoices.institutionId, id), eq(invoices.id, 'i-meal'))),
      'invoices_fee_kind_check',
      '23514',
    )
    const stored = await db
      .select({ feeKind: invoices.feeKind })
      .from(invoices)
      .where(eq(invoices.institutionId, id))
    assert.equal(stored.length, FEE_ITEM_KINDS.length + 1)
  })

  test('silme ve boşaltma reddedilir; imha istisnası yalnız silmeyi, yabancı anahtar sırasıyla açar', async () => {
    const id = await chain()
    await rejectsImmutable(
      db.delete(invoices).where(and(eq(invoices.institutionId, id), eq(invoices.id, 'i2'))),
      /invoices rows are immutable \(DELETE\)/,
    )
    await rejectsImmutable(
      db.delete(contractInvoices).where(eq(contractInvoices.institutionId, id)),
      /contract_invoices rows are immutable \(DELETE\)/,
    )
    await rejectsImmutable(
      db.delete(contracts).where(eq(contracts.institutionId, id)),
      /contracts rows are immutable \(DELETE\)/,
    )
    for (const table of TABLES)
      await rejectsImmutable(
        db.execute(sql.raw(`truncate table ${table} cascade`)),
        new RegExp(`${table} rows are immutable \\(TRUNCATE\\)`),
      )

    // İmha: bağlı taksit önce bağ silinmeden silinemez (restrict).
    await violates(
      db.transaction(async (tx) => {
        await tx.execute(sql`set local kampus.allow_immutable_purge = 'on'`)
        await tx.delete(invoices).where(and(eq(invoices.institutionId, id), eq(invoices.id, 'i2')))
      }),
      'contract_invoices_invoice_fkey',
      // restrict_violation
      '23001',
    )
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local kampus.allow_immutable_purge = 'on'`)
      await tx.delete(contractInvoices).where(eq(contractInvoices.institutionId, id))
      await tx.delete(invoices).where(eq(invoices.institutionId, id))
      await tx.delete(contracts).where(and(eq(contracts.institutionId, id), eq(contracts.id, 'c2')))
      await tx.delete(contracts).where(eq(contracts.institutionId, id))
    })
    assert.deepEqual(await db.select().from(contracts).where(eq(contracts.institutionId, id)), [])
    // İstisna transaction'la düşer.
    await db.insert(contracts).values(contract(id, 'c1'))
    await rejectsImmutable(
      db.delete(contracts).where(eq(contracts.institutionId, id)),
      /contracts rows are immutable \(DELETE\)/,
    )
  })
})
