import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'

import { AppError, ConflictError, MESSAGES, RuleViolationError } from '../errors.ts'
import type { Database } from './client.ts'
import { isRecordCollection, type CollectionName, type RecordData } from './collections.ts'
import { RECORD_MAX_BYTES, records } from './schema/records.ts'

/**
 * Kurum kapsamlı `records` deposu (veritabani.md §3). Her fonksiyonun ilk parametresi
 * `institutionId`'dir ve yalnız servis bağlamından gelir; sorgular onu her zaman süzer.
 */

export interface StoredRecord {
  collection: CollectionName
  id: string
  data: RecordData
  version: number
  createdAt: Date
  updatedAt: Date
  archivedAt: Date | null
}

export interface LoadOptions {
  /** Arşivlenmişler varsayılan olarak dışarıda kalır. */
  includeArchived?: boolean
}

/**
 * Yazmadan önceki biçim denetimi: düz JSON nesnesi ve anahtar.
 * TODO(C2-record-schemas): school-core koleksiyon başına Zod şeması verince onunla doğrulanır.
 */
const recordIdSchema = z.string().min(1).max(200)
const recordDataSchema = z.record(z.string(), z.unknown())

function programmingError(what: string, cause?: unknown): AppError {
  return new AppError(500, 'internal_error', MESSAGES.internal_error, {
    cause: new Error(what, { cause }),
  })
}

function assertCollections(collections: readonly string[]): void {
  for (const collection of collections)
    if (!isRecordCollection(collection)) throw programmingError(`unknown collection ${collection}`)
}

function toStored(row: typeof records.$inferSelect): StoredRecord {
  if (!isRecordCollection(row.collection))
    throw programmingError(`unknown stored collection ${row.collection}`)
  return {
    collection: row.collection,
    id: row.id,
    data: row.data,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  }
}

/**
 * İki anahtarlı danışma kilidinin ad alanı ("KMPR"). İki anahtarlı ve tek anahtarlı (bigint)
 * kilitlerin anahtar uzayları ayrıdır; pg-boss gibi tek anahtarlı kilit kullananlarla çakışmaz.
 */
const INSTITUTION_LOCK_NAMESPACE = 0x4b4d5052

/**
 * Kurumun yazma işlemlerini sıraya sokar: aynı kurumda aynı anda yalnız bir işlem yükleyip
 * yazabilir. READ COMMITTED altında kilitsiz iki işlem aynı görüntüyü yükleyip farklı yeni
 * kimlikle ekleme yapabilir (aynı gün iki yoklama, son boş yere iki kayıt); sürüm denetimi
 * yalnız var olan satırı korur. Kilit transaction sonunda kendiliğinden bırakılır, bu yüzden
 * yalnız transaction içinde çağrılır. Kurum başına tek kilit olduğundan sıralama (kilitlenme)
 * sorunu yoktur; `hashtext` çakışması iki kurumu yalnız gereksiz yere sıraya sokar.
 */
export async function lockInstitution(tx: Database, institutionId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${INSTITUTION_LOCK_NAMESPACE}::int, hashtext(${institutionId}))`,
  )
}

/** Koleksiyonların kayıtları; sıra kararlı (koleksiyon, kimlik). */
export async function loadRecords(
  db: Database,
  institutionId: string,
  collections: readonly CollectionName[],
  options: LoadOptions = {},
): Promise<StoredRecord[]> {
  if (collections.length === 0) return []
  assertCollections(collections)
  const filters: SQL[] = [
    eq(records.institutionId, institutionId),
    inArray(records.collection, [...collections]),
  ]
  if (!options.includeArchived) filters.push(isNull(records.archivedAt))
  const rows = await db
    .select()
    .from(records)
    .where(and(...filters))
    .orderBy(asc(records.collection), asc(records.id))
  return rows.map(toStored)
}

/** Tek kayıt; yoksa veya başka kurumdaysa `null` (rota 404'e çevirir). */
export async function findRecord(
  db: Database,
  institutionId: string,
  collection: CollectionName,
  id: string,
  options: LoadOptions = {},
): Promise<StoredRecord | null> {
  assertCollections([collection])
  const filters: SQL[] = [
    eq(records.institutionId, institutionId),
    eq(records.collection, collection),
    eq(records.id, id),
  ]
  if (!options.includeArchived) filters.push(isNull(records.archivedAt))
  const [row] = await db
    .select()
    .from(records)
    .where(and(...filters))
    .limit(1)
  return row ? toStored(row) : null
}

export type RecordWrite =
  | { kind: 'insert'; collection: CollectionName; id: string; data: RecordData }
  | {
      kind: 'update'
      collection: CollectionName
      id: string
      data: RecordData
      expectedVersion: number
    }
  | { kind: 'archive'; collection: CollectionName; id: string; expectedVersion: number }

export interface WrittenRecord {
  kind: RecordWrite['kind']
  collection: CollectionName
  id: string
  version: number
}

function checkData(write: { id: string; data: RecordData }): RecordData {
  if (!recordIdSchema.safeParse(write.id).success) throw programmingError('invalid record id')
  const parsed = recordDataSchema.safeParse(write.data)
  if (!parsed.success) throw programmingError('invalid record data', parsed.error)
  let json: string
  try {
    json = JSON.stringify(parsed.data)
  } catch (error) {
    throw programmingError('record data is not serialisable', error)
  }
  // pg_column_size sıkıştırılmış boyuttur; metin boyutu onun üst sınırıdır, erken ve kesin ret.
  if (Buffer.byteLength(json, 'utf8') > RECORD_MAX_BYTES)
    throw new RuleViolationError('record_too_large', MESSAGES.record_too_large)
  return parsed.data
}

/**
 * Değişiklikleri tek transaction'da yazar (çağıran zaten transaction içindeyse kayıt noktası).
 * Güncelleme ve arşiv `version = beklenen` ile; tutmazsa 409 ve hiçbir yazma kalmaz. Ekleme,
 * aynı anahtarda arşivlenmiş kayıt varsa onu yeniden açar; canlı kayıt varsa 409.
 */
export async function writeRecords(
  db: Database,
  institutionId: string,
  writes: readonly RecordWrite[],
  now: Date,
): Promise<WrittenRecord[]> {
  if (writes.length === 0) return []
  assertCollections(writes.map((write) => write.collection))
  const prepared = writes.map((write) =>
    write.kind === 'archive' ? write : { ...write, data: checkData(write) },
  )
  return db.transaction(async (tx) => {
    const written: WrittenRecord[] = []
    const inserts = prepared.filter((write) => write.kind === 'insert')
    if (inserts.length > 0) {
      const rows = await tx
        .insert(records)
        .values(
          inserts.map((write) => ({
            institutionId,
            collection: write.collection,
            id: write.id,
            data: write.data,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [records.institutionId, records.collection, records.id],
          set: {
            data: sql`excluded.data`,
            version: sql`${records.version} + 1`,
            updatedAt: now,
            archivedAt: null,
          },
          setWhere: sql`${records.archivedAt} is not null`,
        })
        .returning({ collection: records.collection, id: records.id, version: records.version })
      // Canlı kayıtla çakışan ekleme satır döndürmez: eşzamanlı ekleme veya görülmemiş kayıt.
      if (rows.length !== inserts.length) throw new ConflictError()
      const versions = new Map(rows.map((row) => [`${row.collection}\u0000${row.id}`, row.version]))
      for (const write of inserts) {
        const version = versions.get(`${write.collection}\u0000${write.id}`)
        if (version === undefined) throw new ConflictError()
        written.push({ kind: 'insert', collection: write.collection, id: write.id, version })
      }
    }
    for (const write of prepared) {
      if (write.kind === 'insert') continue
      const set =
        write.kind === 'update'
          ? { data: write.data, version: sql`${records.version} + 1`, updatedAt: now }
          : { archivedAt: now, version: sql`${records.version} + 1`, updatedAt: now }
      const [row] = await tx
        .update(records)
        .set(set)
        .where(
          and(
            eq(records.institutionId, institutionId),
            eq(records.collection, write.collection),
            eq(records.id, write.id),
            eq(records.version, write.expectedVersion),
            isNull(records.archivedAt),
          ),
        )
        .returning({ version: records.version })
      if (!row) throw new ConflictError()
      written.push({
        kind: write.kind,
        collection: write.collection,
        id: write.id,
        version: row.version,
      })
    }
    return written
  })
}

/**
 * Tohum için: yoksa ekler, varsa dokunmaz (idempotent; değiştirilmiş kayıt ezilmez).
 * Tek transaction, parametre sınırı için parçalar halinde. Eklenen satır sayısını döndürür.
 */
export async function insertMissingRecords(
  db: Database,
  institutionId: string,
  items: readonly { collection: CollectionName; id: string; data: RecordData }[],
  now: Date,
  chunkSize = 1000,
): Promise<number> {
  assertCollections([...new Set(items.map((item) => item.collection))])
  return db.transaction(async (tx) => {
    let inserted = 0
    for (let start = 0; start < items.length; start += chunkSize) {
      const chunk = items.slice(start, start + chunkSize).map((item) => ({
        institutionId,
        collection: item.collection,
        id: item.id,
        data: checkData(item),
        createdAt: now,
        updatedAt: now,
      }))
      const rows = await tx
        .insert(records)
        .values(chunk)
        .onConflictDoNothing()
        .returning({ id: records.id })
      inserted += rows.length
    }
    return inserted
  })
}
