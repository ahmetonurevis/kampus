import { sql } from 'drizzle-orm'

import type { Database } from './client.ts'
import { RECORDS_STORE, writeRecords, type CollectionStore, type RecordWrite } from './records.ts'

/**
 * Taksit ve sözleşmenin çift yazma deposu (ADR 0010 adım 3; ON-046e). Kaynak `records`'tır:
 * yükleme oradan yapılır, yazma önce `records`'a gider (`writeRecords`: sürüm denetimi, 409), sonra
 * yazılan kayıtlar aynı transaction'da tablolara eşitlenir (migration 0063
 * `kampus_mirror_finance_records`: sözleşme → taksit → `invoiceIds` bağı). Ayna kaynağın sürümünü,
 * sırasını ve arşiv durumunu taşır; okuma geçişi (046f) yükleme kaynağını tablolara çevirir.
 *
 * Tabloya sığmayan kaynak kaydı (eski ya da bozuk biçim; veri ve kısıt hatası) işlemi durdurmaz,
 * aynada yer almaz: kaynak `records` olduğu sürece davranış ON-046e öncesiyle aynıdır. Onaylı
 * sözleşmenin değişmezlik tetikleyicisi (55000) ise işlemi geri alır (DOM-FIN-010).
 */
export const FINANCE_MIRROR_STORE: CollectionStore = {
  name: 'finance-mirror',
  loadAll: RECORDS_STORE.loadAll,
  loadScoped: RECORDS_STORE.loadScoped,
  async write(db, institutionId, writes, now) {
    const written = await writeRecords(db, institutionId, writes, now)
    await mirrorFinanceRecords(db, institutionId, writes)
    return written
  },
}

const idsOf = (writes: readonly RecordWrite[], collection: 'contracts' | 'invoices') => [
  ...new Set(writes.filter((write) => write.collection === collection).map((write) => write.id)),
]

/** Yazılan taksit ve sözleşmeleri kaynaktan tablolara eşitler; atlanan (sığmayan) kayıt sayısı. */
export async function mirrorFinanceRecords(
  db: Database,
  institutionId: string,
  writes: readonly RecordWrite[],
): Promise<number> {
  const contractIds = idsOf(writes, 'contracts')
  const invoiceIds = idsOf(writes, 'invoices')
  if (contractIds.length === 0 && invoiceIds.length === 0) return 0
  const result = await db.execute(
    sql`select kampus_mirror_finance_records(${institutionId}, ${textArray(contractIds)}, ${textArray(invoiceIds)}) as skipped`,
  )
  const rows = (result as { rows?: { skipped?: unknown }[] }).rows
  return Number(rows?.[0]?.skipped ?? 0)
}

/** Kimlik listesi tek parametre olarak (drizzle diziyi değer listesine açar). */
const textArray = (ids: readonly string[]) =>
  sql`array(select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`
