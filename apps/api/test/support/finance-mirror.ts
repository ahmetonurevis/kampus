import assert from 'node:assert/strict'
import { afterEach, beforeEach } from 'node:test'
import { isDeepStrictEqual } from 'node:util'

import { sql } from 'drizzle-orm'

import type { Database } from '../../src/db/client.ts'
import { loadContracts, parseContractRecord } from '../../src/db/contract-store.ts'
import { loadInvoices, parseInvoiceRecord } from '../../src/db/invoice-store.ts'
import { loadRecords, type StoredRecord } from '../../src/db/records.ts'

/**
 * Çift yazma eşliği (ADR 0010 adım 3; ON-046e). Her kurumda:
 *
 * - depo şemasına uyan her kaynak kaydı (core'un ürettiği biçim) tablodan aynı okunur: veri, sürüm,
 *   sıra ve arşiv durumu (arşivliler dahil); tabloda kaynağı olmayan satır yoktur;
 * - uyan kayıt tabloda yoksa gerçekten tabloya sığmıyordur: bağlandığı tarife, burs programı,
 *   önceki sürüm veya sözleşme tabloda yoktur ya da taksit numarası zincirde yinelenir. Sığan kayıt
 *   atlanmışsa ayna hatalıdır ve kaydın kimliğiyle raporlanır.
 * - depo şemasının reddettiği kaynak kaydı (eski ya da bozuk biçim: yarım tarife grubu, gün vadesi,
 *   eksik alan; 046a `storeShapeMismatches`) eşlik dışıdır: SQL aynası onu atlayabilir ya da
 *   gevşek biçimde taşıyabilir. Okuma geçişinden (046f) önce bu kayıtlar ayıklanır.
 *
 * Finans servis testleri her testten sonra çağırır (`checkFinanceMirrorAfterEach`).
 */

const shape = (row: StoredRecord) => ({
  data: row.data,
  version: row.version,
  position: row.position,
  archived: row.archivedAt !== null,
})

const rejects = (parse: () => unknown) => {
  try {
    parse()
    return false
  } catch {
    return true
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value : null)

async function idSet(db: Database, query: ReturnType<typeof sql>): Promise<Set<string>> {
  const result = await db.execute(query)
  const rows = (result as { rows?: { id: string }[] }).rows ?? []
  return new Set(rows.map((row) => row.id))
}

/** Verilen kurumlarda (verilmezse taksit ya da sözleşmesi olan bütün kurumlarda) eşliği doğrular. */
export async function assertFinanceMirror(
  db: Database,
  institutionIds?: readonly string[],
): Promise<void> {
  const ids =
    institutionIds ??
    (await idSet(
      db,
      sql`select institution_id as id from records where collection in ('invoices', 'contracts')
          union select institution_id from invoices union select institution_id from contracts`,
    ))
  for (const institutionId of ids) {
    const source = await loadRecords(db, institutionId, ['invoices', 'contracts'], {
      includeArchived: true,
    })
    const [invoiceRows, contractRows, tariffs, programs] = await Promise.all([
      loadInvoices(db, institutionId, { includeArchived: true }),
      loadContracts(db, institutionId, { includeArchived: true }),
      idSet(
        db,
        sql`select id::text as id from fee_tariffs where institution_id = ${institutionId}`,
      ),
      idSet(
        db,
        sql`select id::text as id from scholarship_programs where institution_id = ${institutionId}`,
      ),
    ])
    const mirroredContracts = new Map(contractRows.map((row) => [row.id, row]))
    const mirroredInvoices = new Map(invoiceRows.map((row) => [row.id, row]))
    const rootRows = await db.execute(
      sql`select id, root_contract_id as root from contracts where institution_id = ${institutionId}`,
    )
    const roots = new Map(
      ((rootRows as { rows?: { id: string; root: string }[] }).rows ?? []).map((row) => [
        row.id,
        row.root,
      ]),
    )
    const liveInstallments = new Map<string, number>()
    for (const row of invoiceRows) {
      const root = roots.get(text(row.data.contractId) ?? '')
      if (row.archivedAt === null && root !== undefined) {
        const key = `${root}\u0000${String(row.data.installment)}`
        liveInstallments.set(key, (liveInstallments.get(key) ?? 0) + 1)
      }
    }

    const contractUnfit = (row: StoredRecord) => {
      const data = row.data
      const scholarship = data.scholarship as { programId?: unknown } | undefined
      const amends = text(data.amendsContractId)
      return (
        (text(data.tariffId) !== null && !tariffs.has(String(data.tariffId))) ||
        (text(scholarship?.programId) !== null && !programs.has(String(scholarship?.programId))) ||
        (amends !== null && !mirroredContracts.has(amends))
      )
    }
    const invoiceUnfit = (row: StoredRecord) => {
      const contractId = text(row.data.contractId)
      const root = roots.get(contractId ?? '')
      return (
        (contractId !== null && !mirroredContracts.has(contractId)) ||
        (row.archivedAt === null &&
          root !== undefined &&
          liveInstallments.has(`${root}\u0000${String(row.data.installment)}`))
      )
    }
    /** Bağ eşitlenemediyse (bağlı taksit aynada yok) sözleşmenin `invoiceIds`'i eksik kalır. */
    const linksUnfit = (row: StoredRecord) =>
      Array.isArray(row.data.invoiceIds) &&
      row.data.invoiceIds.some((id) => !mirroredInvoices.has(String(id)))

    const problems: string[] = []
    for (const [collection, mirrored, unfit, parse] of [
      ['contracts', mirroredContracts, contractUnfit, parseContractRecord],
      ['invoices', mirroredInvoices, invoiceUnfit, parseInvoiceRecord],
    ] as const) {
      const all = source.filter((row) => row.collection === collection)
      const seen = new Set(all.map((row) => row.id))
      for (const id of mirrored.keys())
        if (!seen.has(id)) problems.push(`${collection}/${id}: tabloda var, kaynakta yok`)
      // Depo şemasının reddettiği eski ya da bozuk kayıt eşlik dışıdır.
      const own = all.filter((row) => !rejects(() => parse(row.data)))
      for (const row of own) {
        const twin = mirrored.get(row.id)
        if (twin === undefined) {
          if (!unfit(row)) problems.push(`${collection}/${row.id}: tabloya sığıyor ama aynada yok`)
          continue
        }
        if (isDeepStrictEqual(shape(twin), shape(row))) continue
        const linkOnly =
          collection === 'contracts' &&
          linksUnfit(row) &&
          isDeepStrictEqual(
            { ...shape(twin), data: { ...twin.data, invoiceIds: undefined } },
            { ...shape(row), data: { ...row.data, invoiceIds: undefined } },
          )
        if (!linkOnly) {
          assert.deepEqual(shape(twin), shape(row), `${collection}/${row.id} aynası kaydı`)
        }
      }
    }
    assert.deepEqual(problems, [], `ayna kaydı: ${institutionId}`)
  }
}

async function institutionIds(db: Database): Promise<string[]> {
  const result = await db.execute(sql`select id from institutions`)
  const rows = (result as { rows?: { id: string }[] }).rows ?? []
  return rows.map((row) => row.id)
}

/**
 * Finans servis testlerinde her testten sonra o testin açtığı kurumların aynasını doğrular (her test
 * kendi kurumunu kurar; testler.md). `describe` içinde çağrılır; veritabanı `before`'da kurulduğu
 * için tembel okunur.
 */
export function checkFinanceMirrorAfterEach(database: () => Database): void {
  let known = new Set<string>()
  beforeEach(async () => {
    known = new Set(await institutionIds(database()))
  })
  afterEach(async () => {
    const fresh = (await institutionIds(database())).filter((id) => !known.has(id))
    await assertFinanceMirror(database(), fresh)
  })
}
