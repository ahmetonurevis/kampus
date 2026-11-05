import { sql } from 'drizzle-orm'

import type { Database } from './client.ts'
import { contractRecordSchema } from './contract-store.ts'
import { invoiceRecordSchema } from './invoice-store.ts'
import {
  loadRecords,
  loadRecordsByIds,
  RECORDS_STORE,
  writeRecords,
  type CollectionStore,
  type RecordWrite,
} from './records.ts'

/**
 * Taksit ve sözleşmenin çift yazma deposu (ADR 0010 adım 3; ON-046e). Kaynak `records`'tır:
 * yükleme oradan yapılır, yazma önce `records`'a gider (`writeRecords`: sürüm denetimi, 409), sonra
 * yazılan kayıtlar aynı transaction'da tablolara eşitlenir (migration 0063
 * `kampus_mirror_finance_records`: sözleşme → taksit → `invoiceIds` bağı). Ayna kaynağın sürümünü,
 * sırasını ve arşiv durumunu taşır; okuma geçişi (046f) yükleme kaynağını tablolara çevirir.
 *
 * Aynaya yalnız depo şemasına uyan kayıt girer (ON-046f): `invoiceRecordSchema` ve
 * `contractRecordSchema` core'un ürettiği biçimin kendisidir (vade günün 09:00Z anı, `toISOString`
 * anları, tam tarife grubu). Gevşek biçim (gün vadesi, yarım tarife grubu, eksik alan) core
 * tarafından üretilmez, yalnız eski ya da bozuk kayıttadır; SQL dönüşümü onu kabul edebileceği için
 * süzgeç burada, şemanın kendisiyle uygulanır. Böylece tablodaki her satır core kaydına hatasız
 * döner ve kaynakla birebir aynıdır. Tabloya sığmayan kaynak kaydı işlemi durdurmaz, aynada yer
 * almaz; onaylı sözleşmenin değişmezlik tetikleyicisi (55000) ise işlemi geri alır (DOM-FIN-010).
 */
export const FINANCE_MIRROR_STORE: CollectionStore = {
  name: 'finance-mirror',
  loadAll: (db, institutionId, collections) =>
    RECORDS_STORE.loadAll(db, institutionId, collections),
  loadScoped: (db, institutionId, collection, scope) =>
    RECORDS_STORE.loadScoped(db, institutionId, collection, scope),
  async write(db, institutionId, writes, now) {
    const written = await writeRecords(db, institutionId, writes, now)
    await mirrorFinanceRecords(db, institutionId, writes)
    return written
  },
}

const idsOf = (writes: readonly RecordWrite[], collection: 'contracts' | 'invoices') => [
  ...new Set(writes.filter((write) => write.collection === collection).map((write) => write.id)),
]

/** Yazılan taksit ve sözleşmeleri kaynaktan tablolara eşitler; aynaya girmeyen kayıt sayısı. */
export function mirrorFinanceRecords(
  db: Database,
  institutionId: string,
  writes: readonly RecordWrite[],
): Promise<number> {
  return mirrorFinanceIds(db, institutionId, {
    contracts: idsOf(writes, 'contracts'),
    invoices: idsOf(writes, 'invoices'),
  })
}

/**
 * Verilen kimliklerin güncel kaynak kaydını (arşivliler dahil) şemayla süzer, uyanları SQL aynasıyla
 * tablolara eşitler. Tohum (`records.ts` `insertMissingRecords`) ve çalıştırıcı yazması kullanır.
 * Aynaya girmeyen (şemaya uymayan ya da tabloda reddedilen) kayıt sayısını döner.
 */
export async function mirrorFinanceIds(
  db: Database,
  institutionId: string,
  ids: { contracts: readonly string[]; invoices: readonly string[] } | 'all',
): Promise<number> {
  if (ids !== 'all' && ids.contracts.length === 0 && ids.invoices.length === 0) return 0
  const [contractRows, invoiceRows] =
    ids === 'all'
      ? await Promise.all(
          (['contracts', 'invoices'] as const).map((collection) =>
            loadRecords(db, institutionId, [collection], { includeArchived: true }),
          ),
        )
      : await Promise.all([
          loadRecordsByIds(db, institutionId, 'contracts', ids.contracts, {
            includeArchived: true,
          }),
          loadRecordsByIds(db, institutionId, 'invoices', ids.invoices, { includeArchived: true }),
        ])
  if (!contractRows || !invoiceRows) return 0
  const contracts = contractRows
    .filter((row) => contractRecordSchema.safeParse(row.data).success)
    .map((row) => row.id)
  const invoices = invoiceRows
    .filter((row) => invoiceRecordSchema.safeParse(row.data).success)
    .map((row) => row.id)
  const rejected = contractRows.length - contracts.length + invoiceRows.length - invoices.length
  if (contracts.length === 0 && invoices.length === 0) return rejected
  const result = await db.execute(
    sql`select kampus_mirror_finance_records(${institutionId}, ${textArray(contracts)}, ${textArray(invoices)}) as skipped`,
  )
  const rows = (result as { rows?: { skipped?: unknown }[] }).rows
  return rejected + Number(rows?.[0]?.skipped ?? 0)
}

/** Kimlik listesi tek parametre olarak (drizzle diziyi değer listesine açar). */
const textArray = (ids: readonly string[]) =>
  sql`array(select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`
