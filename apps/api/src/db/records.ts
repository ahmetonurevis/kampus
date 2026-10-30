import { and, asc, eq, inArray, isNull, max, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'

import {
  AppError,
  ConflictError,
  MESSAGES,
  RuleViolationError,
  withDatabaseErrors,
} from '../errors.ts'
import type { Database } from './client.ts'
import {
  isEphemeralCollection,
  isRecordCollection,
  type CollectionName,
  type RecordData,
} from './collections.ts'
import { planPositions, POSITION_STEP } from './positions.ts'
import { RECORD_MAX_BYTES, records } from './schema/records.ts'

/**
 * Kurum kapsamlı `records` deposu (veritabani.md §3). Her fonksiyonun ilk parametresi
 * `institutionId`'dir ve yalnız servis bağlamından gelir; sorgular onu her zaman süzer.
 */

export interface StoredRecord {
  collection: CollectionName
  id: string
  data: RecordData
  /** Core dizisindeki sıra; yalnız aynı koleksiyonda anlamlıdır (`positions.ts`). */
  position: number
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

/** Geçici koleksiyon (`audit`) `records`'a yazılmaz; yazma girişimi programlama hatasıdır. */
function assertWritable(collections: readonly string[]): void {
  assertCollections(collections)
  for (const collection of collections)
    if (isEphemeralCollection(collection))
      throw programmingError(`collection is not stored: ${collection}`)
}

function toStored(row: typeof records.$inferSelect): StoredRecord {
  if (!isRecordCollection(row.collection))
    throw programmingError(`unknown stored collection ${row.collection}`)
  return {
    collection: row.collection,
    id: row.id,
    data: row.data,
    position: row.position,
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

/** Koleksiyonların kayıtları; koleksiyon içinde core dizisinin sırasıyla (`position`, kimlik). */
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
    .orderBy(asc(records.collection), asc(records.position), asc(records.id))
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

/**
 * Yazma türleri. `position` verilmezse ekleme koleksiyonun sonuna gider, güncelleme sırayı
 * korur. `move` yalnız sırayı değiştirir: veri değişmediği için sürüm artmaz, ama okunan sürüm
 * yine denetlenir.
 */
export type RecordWrite =
  | { kind: 'insert'; collection: CollectionName; id: string; data: RecordData; position?: number }
  | {
      kind: 'update'
      collection: CollectionName
      id: string
      data: RecordData
      expectedVersion: number
      position?: number
    }
  | {
      kind: 'move'
      collection: CollectionName
      id: string
      position: number
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

/** Yazma sırası: (koleksiyon, kimlik), kod birimi karşılaştırması; bütün çağıranlarda aynı. */
function compareKeys(
  left: { collection: string; id: string },
  right: { collection: string; id: string },
): number {
  if (left.collection !== right.collection) return left.collection < right.collection ? -1 : 1
  if (left.id !== right.id) return left.id < right.id ? -1 : 1
  return 0
}

/**
 * Değişiklikleri tek transaction'da yazar (çağıran zaten transaction içindeyse kayıt noktası).
 * Güncelleme ve arşiv `version = beklenen` ile; tutmazsa 409 ve hiçbir yazma kalmaz. Ekleme,
 * aynı anahtarda arşivlenmiş kayıt varsa onu yeniden açar; canlı kayıt varsa 409.
 *
 * Satırlar verilen sırayla değil (koleksiyon, kimlik) sırasıyla yazılır: aynı satırları farklı
 * sırada kilitleyen iki transaction birbirini beklemez (kilitlenme yok). Yine de oluşan
 * kilitlenme/serileştirme hatası 409 `conflict` olur (`mapDatabaseError`).
 */
export async function writeRecords(
  db: Database,
  institutionId: string,
  writes: readonly RecordWrite[],
  now: Date,
): Promise<WrittenRecord[]> {
  if (writes.length === 0) return []
  assertWritable(writes.map((write) => write.collection))
  const prepared = writes.map((write) =>
    write.kind === 'archive' || write.kind === 'move'
      ? write
      : { ...write, data: checkData(write) },
  )
  const work = db.transaction(async (tx) => {
    // Sırası verilmemiş eklemeler verilen sırayla sona eklenir; değerler yazmadan önce belirlenir.
    const inserts = prepared.filter((write) => write.kind === 'insert')
    const appended = await appendPositions(tx, institutionId, inserts)
    const positions = new Map(inserts.map((write, index) => [write, appended[index] ?? 0]))

    const written: WrittenRecord[] = []
    for (const write of [...prepared].sort(compareKeys)) {
      if (write.kind === 'insert') {
        const [row] = await tx
          .insert(records)
          .values({
            institutionId,
            collection: write.collection,
            id: write.id,
            data: write.data,
            position: positions.get(write) ?? 0,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [records.institutionId, records.collection, records.id],
            set: {
              data: sql`excluded.data`,
              position: sql`excluded.position`,
              version: sql`${records.version} + 1`,
              updatedAt: now,
              archivedAt: null,
            },
            setWhere: sql`${records.archivedAt} is not null`,
          })
          .returning({ version: records.version })
        // Canlı kayıtla çakışan ekleme satır döndürmez: eşzamanlı ekleme veya görülmemiş kayıt.
        if (!row) throw new ConflictError()
        written.push({
          kind: 'insert',
          collection: write.collection,
          id: write.id,
          version: row.version,
        })
        continue
      }
      const [row] = await tx
        .update(records)
        .set(updateSet(write, now))
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
  return withDatabaseErrors(work)
}

function updateSet(write: Exclude<RecordWrite, { kind: 'insert' }>, now: Date) {
  const bump = { version: sql`${records.version} + 1`, updatedAt: now }
  switch (write.kind) {
    case 'update':
      return write.position === undefined
        ? { data: write.data, ...bump }
        : { data: write.data, position: write.position, ...bump }
    case 'move':
      return { position: write.position }
    case 'archive':
      return { archivedAt: now, ...bump }
    default:
      return write satisfies never
  }
}

/** Sırası verilmemiş eklemeler koleksiyonun (arşivliler dahil) en büyük sırasından sonra gelir. */
async function appendPositions(
  tx: Database,
  institutionId: string,
  inserts: readonly { collection: CollectionName; position?: number | undefined }[],
): Promise<number[]> {
  if (inserts.length === 0) return []
  const missing = [
    ...new Set(inserts.filter((w) => w.position === undefined).map((w) => w.collection)),
  ]
  const next = new Map<string, number>()
  if (missing.length > 0) {
    const rows = await tx
      .select({ collection: records.collection, last: max(records.position) })
      .from(records)
      .where(and(eq(records.institutionId, institutionId), inArray(records.collection, missing)))
      .groupBy(records.collection)
    for (const collection of missing) {
      const last = rows.find((row) => row.collection === collection)?.last
      next.set(collection, last === null || last === undefined ? 0 : Number(last) + POSITION_STEP)
    }
  }
  return inserts.map((write) => {
    if (write.position !== undefined) return write.position
    const position = next.get(write.collection) ?? 0
    next.set(write.collection, position + POSITION_STEP)
    return position
  })
}

/**
 * Tohum için: yoksa ekler, varsa verisine dokunmaz (idempotent; değiştirilmiş kayıt ezilmez).
 * Sıra verilen dizinin koleksiyon içindeki sırasıdır: eksik kayıt komşularının arasına girer,
 * sırası bozulmuş mevcut kayıt (ör. migration dolgusundan) yalnız sıra değeriyle düzeltilir;
 * sırası doğru kayda yazılmaz. Verilmeyen kayıtlar sıra hesabına girmez. Tek transaction,
 * parametre sınırı için parçalar halinde. Eklenen satır sayısını döndürür.
 */
export async function insertMissingRecords(
  db: Database,
  institutionId: string,
  items: readonly { collection: CollectionName; id: string; data: RecordData }[],
  now: Date,
  chunkSize = 1000,
): Promise<number> {
  const collections = [...new Set(items.map((item) => item.collection))]
  assertWritable(collections)
  const work = db.transaction(async (tx) => {
    const stored = new Map<string, number>()
    if (collections.length > 0) {
      const rows = await tx
        .select({ collection: records.collection, id: records.id, position: records.position })
        .from(records)
        .where(
          and(eq(records.institutionId, institutionId), inArray(records.collection, collections)),
        )
      for (const row of rows) stored.set(`${row.collection}\u0000${row.id}`, row.position)
    }
    const planned = new Map<string, number>()
    for (const collection of collections) {
      const keys = items
        .filter((item) => item.collection === collection)
        .map((item) => `${collection}\u0000${item.id}`)
      const positions = planPositions(keys.map((key) => stored.get(key) ?? null))
      keys.forEach((key, index) => planned.set(key, positions[index] ?? 0))
    }
    const positionOf = (item: { collection: CollectionName; id: string }) =>
      planned.get(`${item.collection}\u0000${item.id}`) ?? 0

    for (const item of items) {
      const key = `${item.collection}\u0000${item.id}`
      const current = stored.get(key)
      if (current === undefined || current === positionOf(item)) continue
      await tx
        .update(records)
        .set({ position: positionOf(item) })
        .where(
          and(
            eq(records.institutionId, institutionId),
            eq(records.collection, item.collection),
            eq(records.id, item.id),
          ),
        )
    }

    const missing = items.filter((item) => !stored.has(`${item.collection}\u0000${item.id}`))
    let inserted = 0
    for (let start = 0; start < missing.length; start += chunkSize) {
      const chunk = missing.slice(start, start + chunkSize).map((item) => ({
        institutionId,
        collection: item.collection,
        id: item.id,
        data: checkData(item),
        position: positionOf(item),
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
  return withDatabaseErrors(work)
}
