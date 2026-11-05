import { and, eq, inArray, sql } from 'drizzle-orm'

import { ConflictError } from '../errors.ts'
import type { Database } from './client.ts'
import type { CollectionName } from './collections.ts'
import { contractRecordSchema, loadContracts, writeContractsAndInvoices } from './contract-store.ts'
import {
  invoiceRecordSchema,
  loadInvoices,
  programmingError,
  type StoreLoadOptions,
} from './invoice-store.ts'
import {
  loadRecords,
  loadRecordsByIds,
  RECORDS_STORE,
  writeRecords,
  type CollectionStore,
  type RecordWrite,
  type StoredRecord,
  type StoreScope,
  type WrittenRecord,
} from './records.ts'
import { contracts } from './schema/contracts.ts'
import { invoices } from './schema/invoices.ts'

type FinanceCollection = 'contracts' | 'invoices'

function financeCollection(collection: CollectionName): FinanceCollection {
  if (collection !== 'contracts' && collection !== 'invoices')
    throw programmingError(`collection is not table backed: ${collection}`)
  return collection
}

/**
 * Taksit ya da sözleşmenin tablodan yüklenmesi (ADR 0010 adım 4; ON-046f): kurum kapsamı,
 * arşivlenmemiş satırlar, core dizi sırası (`position`, kimlik). Kapsam `loadScope` biçimidir;
 * süzgeç kolon koşuluna çevrilir, çevrilemeyen süzgeç programlama hatasıdır (500). Finans
 * servisleri ve hatırlatma işi de taksit ve sözleşmeyi bununla okur.
 */
export function loadFinanceRecords(
  db: Database,
  institutionId: string,
  collection: CollectionName,
  options: StoreLoadOptions = {},
): Promise<StoredRecord[]> {
  return financeCollection(collection) === 'contracts'
    ? loadContracts(db, institutionId, options)
    : loadInvoices(db, institutionId, options)
}

const scopeOptions = (scope: StoreScope): StoreLoadOptions =>
  'ids' in scope ? { ids: scope.ids } : { match: scope.match }

/**
 * Taksit ve sözleşmenin `records` kaynaklı çift yazma deposu (ADR 0010 adım 3; ON-046e). Çalıştırıcı
 * varsayılanıdır (`OPERATION_STORES`): okuma geçişi (adım 4) kademelidir; finans servisleri tablo
 * kaynaklı depoyu (`FINANCE_TABLE_STORE`) seçer (046f), öteki yollar 046g'de geçer. Yükleme
 * `records`'tan yapılır, yazma önce `records`'a gider (`writeRecords`: sürüm denetimi, 409), sonra
 * yazılan kayıtlar aynı transaction'da tablolara eşitlenir (migration 0063
 * `kampus_mirror_finance_records`: sözleşme → taksit → `invoiceIds` bağı). Ayna kaynağın sürümünü,
 * sırasını ve arşiv durumunu taşır.
 *
 * Aynaya yalnız depo şemasına uyan kayıt girer: `invoiceRecordSchema` ve `contractRecordSchema`
 * core'un ürettiği biçimin kendisidir (vade günün 09:00Z anı, `toISOString` anları, tam tarife
 * grubu). Gevşek biçim (gün vadesi, yarım tarife grubu, eksik alan) core tarafından üretilmez, yalnız
 * eski ya da bozuk kayıttadır; SQL dönüşümü onu kabul edebileceği için süzgeç `mirrorFinanceIds`'te,
 * şemanın kendisiyle uygulanır. Tabloya sığmayan kaynak kaydı işlemi durdurmaz, aynada yer almaz;
 * onaylı sözleşmenin değişmezlik tetikleyicisi (55000) ise işlemi geri alır (DOM-FIN-010).
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

/**
 * Taksit ve sözleşmenin tablo kaynaklı deposu (ADR 0010 adım 4; ON-046f). Çalıştırıcı bu iki
 * koleksiyonu tablolardan yükler (`loadFinanceRecords`). Yazma önce tablolara gider
 * (`writeContractsAndInvoices`: bağımlılık sırası, sürüm denetimi, 409), sonra aynı yazmalar aynı
 * transaction'da `records`'a ayna olarak gider (`writeRecords`): genel okuma (046g) ve geri dönüş
 * (`git revert -m 1`) daralt adımına (046h) kadar `records`'u güncel bulur. Tablonun verdiği sıra
 * aynaya aynen yazılır; böylece iki depoda kayıt sırası da aynı kalır.
 *
 * Ayna kaynağın kopyasıdır: tablo yazmayı kabul ettiyse `records` da aynı sürümle kabul etmelidir.
 * Aynanın 409'u ya da farklı sürüm/tür sonucu iki deponun ayrıştığını gösterir; programlama
 * hatasıdır (500), işlem bütünüyle geri alınır. Depo şemasına uymayan eski ya da bozuk kayıt
 * (aynaya hiç girmedi) yalnız `records`'tadır; bu depoyu seçen işlem onu görmez ve ona yazmaz.
 */
export const FINANCE_TABLE_STORE: CollectionStore = {
  name: 'finance-tables',
  async loadAll(db, institutionId, collections) {
    // Tek sorgulu `records` yüklemesi gibi koleksiyon sırasıyla (`contracts` < `invoices`).
    const rows: StoredRecord[] = []
    for (const collection of [...new Set(collections)].sort())
      rows.push(...(await loadFinanceRecords(db, institutionId, collection)))
    return rows
  },
  loadScoped: (db, institutionId, collection, scope) =>
    loadFinanceRecords(db, institutionId, collection, scopeOptions(scope)),
  async write(db, institutionId, writes, now) {
    const written = await writeContractsAndInvoices(db, institutionId, writes, now)
    if (written.length === 0) return written
    const positions = await appendedPositions(db, institutionId, writes)
    let mirrored: WrittenRecord[]
    try {
      mirrored = await writeRecords(
        db,
        institutionId,
        writes.map((write) =>
          write.kind === 'insert' && write.position === undefined
            ? { ...write, position: positionOf(positions, write) }
            : write,
        ),
        now,
      )
    } catch (error) {
      if (error instanceof ConflictError)
        throw programmingError('records mirror diverged from finance tables', error)
      throw error
    }
    assertSameOutcome(written, mirrored)
    return written
  },
}

const keyOf = (record: { collection: CollectionName; id: string }) =>
  `${record.collection}\u0000${record.id}`

/** Sırası verilmeden eklenen kayıtların tabloda aldığı sıra (aynaya aynen yazılır). */
async function appendedPositions(
  db: Database,
  institutionId: string,
  writes: readonly RecordWrite[],
): Promise<Map<string, number>> {
  const ids = (collection: FinanceCollection) =>
    writes
      .filter(
        (write) =>
          write.kind === 'insert' &&
          write.position === undefined &&
          write.collection === collection,
      )
      .map((write) => write.id)
  const positions = new Map<string, number>()
  const [contractIds, invoiceIds] = [ids('contracts'), ids('invoices')]
  if (contractIds.length > 0)
    for (const row of await db
      .select({ id: contracts.id, position: contracts.position })
      .from(contracts)
      .where(and(eq(contracts.institutionId, institutionId), inArray(contracts.id, contractIds))))
      positions.set(keyOf({ collection: 'contracts', id: row.id }), row.position)
  if (invoiceIds.length > 0)
    for (const row of await db
      .select({ id: invoices.id, position: invoices.position })
      .from(invoices)
      .where(and(eq(invoices.institutionId, institutionId), inArray(invoices.id, invoiceIds))))
      positions.set(keyOf({ collection: 'invoices', id: row.id }), row.position)
  return positions
}

function positionOf(positions: ReadonlyMap<string, number>, write: RecordWrite): number {
  const position = positions.get(keyOf(write))
  if (position === undefined) throw programmingError(`table position missing: ${write.collection}`)
  return position
}

/** Tablo ve ayna yazmasının sonucu (tür, sürüm) kayıt kayıt aynı olmalıdır. */
function assertSameOutcome(
  written: readonly WrittenRecord[],
  mirrored: readonly WrittenRecord[],
): void {
  const outcome = (list: readonly WrittenRecord[]) =>
    new Map(list.map((change) => [keyOf(change), `${change.kind}:${String(change.version)}`]))
  const [table, source] = [outcome(written), outcome(mirrored)]
  const same =
    table.size === source.size && [...table].every(([key, value]) => source.get(key) === value)
  if (!same) throw programmingError('records mirror version differs from finance tables')
}

const idsOf = (writes: readonly RecordWrite[], collection: 'contracts' | 'invoices') => [
  ...new Set(writes.filter((write) => write.collection === collection).map((write) => write.id)),
]

/** Verilen yazmaların taksit ve sözleşmelerini `records`'tan tablolara eşitler; aynaya girmeyen kayıt sayısı. */
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
 * Verilen kimliklerin güncel `records` kaydını (arşivliler dahil) şemayla süzer, uyanları SQL
 * aynasıyla tablolara eşitler. Tohum (`records.ts` `insertMissingRecords`) kullanır: tohum kayıtları
 * `records`'a yazar, tablolar buradan eşitlenir. Aynaya yalnız depo şemasına uyan kayıt girer
 * (`invoiceRecordSchema`, `contractRecordSchema`: core'un ürettiği biçim); gevşek biçimli eski ya da
 * bozuk kayıt yalnız `records`'ta kalır.
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
