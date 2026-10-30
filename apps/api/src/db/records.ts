import { and, asc, count, eq, inArray, isNotNull, isNull, max, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'

import {
  INVOICE_STATUS_LABELS as CORE_INVOICE_STATUS_LABELS,
  type InvoiceStatus,
} from '@kampus/school-core/lib/format.ts'

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

/**
 * Veri alanı ön süzgeci: alanın metin değeri (`data ->> alan`) değerlerden biri olmalı ya da alan
 * dizi olmalı (dizi üyeliği SQL'de denetlenmez). Gerekli koşuldur, yeter koşul değil: çağıran
 * satırları yine kendi kuralıyla süzer. Alan adı ve değerler sorgu parametresidir.
 */
export interface FieldMatch {
  kind?: 'in'
  field: string
  values: readonly string[]
}

/**
 * Birleşik eşitlik süzgeci: alan eşleşmelerinden biri yeter (`or`). Kapsam ön süzgecinde satırın
 * öğrenci veya sınıf anahtarından biriyle kapsama girdiği kurallar için (ör. not: verildiği
 * sınıf ya da öğrencinin güncel sınıfı). Her eşleşme `FieldMatch` gibi gerekli koşuldur.
 */
export interface AnyMatch {
  kind: 'any'
  matches: readonly FieldMatch[]
}

/**
 * Etkinlik süzgeci (`isActive`): `active: false` yalnız alanı `false` olanı, `active: true`
 * alanı `false` olmayanı (eksik alan dahil; core'da alanı olmayan kayıt etkindir) eşler. Kesin
 * koşuldur: bellekteki `matchesActive` ile aynı sonucu verir.
 */
export interface ActiveMatch {
  kind: 'active'
  field: string
  active: boolean
}

/**
 * Gün aralığı süzgeci (`dateFrom`/`dateTo`, Europe/Istanbul günü, iki uç dahil). Değer ya
 * `YYYY-MM-DD` günüdür (günle karşılaştırılır) ya da `toISOString` biçiminde an (aralığın UTC
 * sınırlarıyla karşılaştırılır); başka biçim eşleşmez. Karşılaştırma bayt sırasıyladır
 * (`collate "C"`); bellekteki `matchesDayRange` ile aynı sonucu verir.
 */
export interface DayRangeMatch {
  kind: 'dayRange'
  field: string
  fromDay: string | null
  toDay: string | null
  /** `fromDay` gününün başladığı an (UTC, dahil). */
  fromInstant: string | null
  /** `toDay`'den sonraki günün başladığı an (UTC, hariç). */
  toInstant: string | null
}

/**
 * Taksit durumu süzgeci (`status`; durum saklanmaz, core `invoiceStatus` ile `paidAt`, vade ve
 * isteğin saatinden türetilir). SQL koşulu core kuralının çevirisidir: `paidAt` doluysa (JS
 * doğruluk değeri) "Ödendi"; değilse vade günü bugünden önceyse "Gecikmiş", değilse "Yaklaşan".
 * Vade `YYYY-MM-DD` ise günle, `toISOString` biçiminde an ise bugünün başladığı anla
 * karşılaştırılır; başka biçimli vade SQL'de ödenmemiş her durumun adayıdır. Karar bellekte core
 * fonksiyonuyla verilir (`list-filters.ts`); testler iki biçimde iki tarafın aynı olduğunu
 * sınır günleriyle doğrular.
 */
export interface InvoiceStatusMatch {
  kind: 'invoiceStatus'
  statuses: readonly InvoiceStatusLabel[]
  /** İsteğin Europe/Istanbul günü (`YYYY-MM-DD`). */
  today: string
  /** `today` gününün başladığı an (UTC ISO). */
  todayStart: string
}

/** Core `invoiceStatus` etiketleri (`lib/format.ts`), core'un tanım sırasıyla. */
export const INVOICE_STATUS_LABELS: readonly InvoiceStatus[] = Object.values(
  CORE_INVOICE_STATUS_LABELS,
)
export type InvoiceStatusLabel = InvoiceStatus

export type RecordFilter = FieldMatch | AnyMatch | ActiveMatch | DayRangeMatch | InvoiceStatusMatch

/** Gün ve an biçimleri; SQL (`~`) ve bellek (`RegExp`) aynı metni kullanır. */
export const DAY_PATTERN = '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
export const INSTANT_PATTERN = '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'

/**
 * Arama aday süzgeci (`q`, yalnız SQL); gerekli koşuldur, karar bellekte ayıklanmış kayıtta
 * `searchKey` ile verilir. Kaydın gizli alanları çıkarılmış JSON metni şöyle katlanır: NFD,
 * yalnız ASCII harflerde küçük harf (`collate "C"`, veritabanı yerel ayarından bağımsız),
 * `ı` → `i`, ASCII dışı her karakter silinir. Aranan metin yazdırılabilir ASCII ve `"`/`\\`
 * içermiyorsa (`collection-reads.ts` `SQL_SAFE_NEEDLE`) bu katlama bellekte eşleşen her kaydı
 * bulur: `searchKey`'in her karakterden ürettiği ASCII kısım SQL'dekiyle aynıdır, silinen ASCII
 * dışı karakterler yalnız fazladan aday üretir; JSON kaçışları (`\\n`, `\\"`) aranan metinde
 * olmayan karakterlerin yerine geçer. Sayının JSON metni yalnız üstel biçimde (`1e+21`,
 * `1e-7`) JS'den ayrılır; aranan metin sayı karakterlerinden oluşuyorsa üstel aralıktaki sayısı
 * olan kayıt da adaydır. Bağlı adı eşleşen kayıtlar kimlik alanıyla aday olur.
 */
export interface SearchMatch {
  needle: string
  /** Aramaya girmeyen (ayıklanan) üst düzey alanlar. */
  exclude: readonly string[]
  /** Bağlı adı eşleşen kayıtların kimlikleri, kimlik alanı başına. */
  keys: readonly FieldMatch[]
}

export interface LoadOptions {
  /** Arşivlenmişler varsayılan olarak dışarıda kalır. */
  includeArchived?: boolean
  /** Hepsi sağlanmalı (`and`); boş değer listesinde yalnız alanı dizi olan satırlar kalır. */
  match?: readonly RecordFilter[]
  search?: SearchMatch
}

/** JS'nin üstel yazdığı sayılar (`String(n)`); JSON metninde ondalık yazılırlar. */
const EXPONENT_NUMBER =
  '$.* ? (@.type() == "number" && (@.abs() >= 1e21 || (@ != 0 && @.abs() < 1e-6)))'
/** ASCII dışı karakterler (PostgreSQL düzenli ifadesi). */
const NON_ASCII = '[^\\x01-\\x7f]'
const NUMBER_TEXT = /^[0-9.e+-]+$/

function searchMatch({ needle, exclude, keys }: SearchMatch): SQL {
  const visible = exclude.reduce<SQL>(
    (document, field) => sql`(${document} - ${field}::text)`,
    sql`${records.data}`,
  )
  const folded = sql`regexp_replace(translate(lower(normalize(${visible}::text, NFD) collate "C"), 'ı', 'i'), ${NON_ASCII}::text, '', 'g')`
  const parts = [sql`(strpos(${folded}, ${needle}::text) > 0)`]
  if (NUMBER_TEXT.test(needle))
    parts.push(sql`jsonb_path_exists(${visible}, ${EXPONENT_NUMBER}::jsonpath)`)
  for (const key of keys)
    if (key.values.length > 0)
      parts.push(inArray(sql`(${records.data} ->> ${key.field}::text)`, [...key.values]))
  return sql`(${sql.join(parts, sql` or `)})`
}

function fieldMatch({ field, values }: FieldMatch): SQL {
  const text = sql`(${records.data} ->> ${field}::text)`
  const array = sql`jsonb_typeof(${records.data} -> ${field}::text) = 'array'`
  return values.length === 0 ? array : sql`(${inArray(text, [...values])} or ${array})`
}

function activeMatch({ field, active }: ActiveMatch): SQL {
  const value = sql`(${records.data} -> ${field}::text)`
  return active
    ? sql`coalesce(${value}, 'null'::jsonb) <> 'false'::jsonb`
    : sql`${value} = 'false'::jsonb`
}

function dayRangeMatch(match: DayRangeMatch): SQL {
  const text = sql`(${records.data} ->> ${match.field}::text)`
  const ordered = sql`(${text} collate "C")`
  const bound = (value: string | null, op: SQL) =>
    value === null ? sql`true` : sql`${ordered} ${op} (${value}::text collate "C")`
  const day = sql`(${text} ~ ${DAY_PATTERN} and ${bound(match.fromDay, sql`>=`)} and ${bound(match.toDay, sql`<=`)})`
  const instant = sql`(${text} ~ ${INSTANT_PATTERN} and ${bound(match.fromInstant, sql`>=`)} and ${bound(match.toInstant, sql`<`)})`
  return sql`(jsonb_typeof(${records.data} -> ${match.field}::text) = 'string' and (${day} or ${instant}))`
}

/** JS'de yanlış sayılan JSON değerleri; `paidAt` bunlardan biri değilse taksit ödenmiştir. */
const FALSY_JSON = sql`('null'::jsonb, 'false'::jsonb, '""'::jsonb, '0'::jsonb)`

function invoiceStatusMatch(match: InvoiceStatusMatch): SQL {
  const paid = sql`(coalesce(${records.data} -> 'paidAt', 'null'::jsonb) not in ${FALSY_JSON})`
  const due = sql`(${records.data} ->> 'dueDate')`
  const ordered = sql`(${due} collate "C")`
  const dayForm = sql`(jsonb_typeof(${records.data} -> 'dueDate') = 'string' and ${due} ~ ${DAY_PATTERN})`
  const instantForm = sql`(jsonb_typeof(${records.data} -> 'dueDate') = 'string' and ${due} ~ ${INSTANT_PATTERN})`
  const otherForm = sql`(not ${dayForm} and not ${instantForm})`
  const today = sql`(${match.today}::text collate "C")`
  const todayStart = sql`(${match.todayStart}::text collate "C")`
  const overdue = sql`((${dayForm} and ${ordered} < ${today}) or (${instantForm} and ${ordered} < ${todayStart}) or ${otherForm})`
  const upcoming = sql`((${dayForm} and ${ordered} >= ${today}) or (${instantForm} and ${ordered} >= ${todayStart}) or ${otherForm})`
  const parts = match.statuses.map((status) => {
    switch (status) {
      case 'Ödendi':
        return paid
      case 'Gecikmiş':
        return sql`(not ${paid} and ${overdue})`
      case 'Yaklaşan':
        return sql`(not ${paid} and ${upcoming})`
      default:
        return status satisfies never
    }
  })
  return parts.length === 0 ? sql`false` : sql`(${sql.join(parts, sql` or `)})`
}

/** Süzgecin SQL koşulu (alan adı ve değerler parametredir). */
export function recordFilter(filter: RecordFilter): SQL {
  switch (filter.kind) {
    case undefined:
    case 'in':
      return fieldMatch(filter)
    case 'any':
      return filter.matches.length === 0
        ? sql`false`
        : sql`(${sql.join(filter.matches.map(fieldMatch), sql` or `)})`
    case 'active':
      return activeMatch(filter)
    case 'dayRange':
      return dayRangeMatch(filter)
    case 'invoiceStatus':
      return invoiceStatusMatch(filter)
    default:
      return filter satisfies never
  }
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
  for (const match of options.match ?? []) filters.push(recordFilter(match))
  if (options.search) filters.push(searchMatch(options.search))
  const rows = await db
    .select()
    .from(records)
    .where(and(...filters))
    .orderBy(asc(records.collection), asc(records.position), asc(records.id))
  return rows.map(toStored)
}

/**
 * Koleksiyonun bir sayfası ve toplamı, deponun sırasıyla (`position`, kimlik). Yalnız süzgeçsiz,
 * sıralamasız ve aktörün koleksiyonun tamamını okuduğu listede kullanılır
 * (`collection-reads.ts`); diğer listeler aday satırları yükler.
 */
export async function loadRecordPage(
  db: Database,
  institutionId: string,
  collection: CollectionName,
  options: { archived?: 'include' | 'only' | undefined; offset: number; limit: number },
): Promise<{ rows: StoredRecord[]; total: number }> {
  assertCollections([collection])
  const filters: SQL[] = [
    eq(records.institutionId, institutionId),
    eq(records.collection, collection),
  ]
  if (options.archived === undefined) filters.push(isNull(records.archivedAt))
  if (options.archived === 'only') filters.push(isNotNull(records.archivedAt))
  const where = and(...filters)
  const [rows, [counted]] = await Promise.all([
    db
      .select()
      .from(records)
      .where(where)
      .orderBy(asc(records.position), asc(records.id))
      .limit(options.limit)
      .offset(options.offset),
    db.select({ total: count() }).from(records).where(where),
  ])
  return { rows: rows.map(toStored), total: counted?.total ?? 0 }
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

/**
 * Yazılan kayıt. `restore`: ekleme, aynı anahtarda arşivlenmiş kaydı yeniden açtı; veri yenisiyle
 * değişti, sürüm arşivdeki sürümden devam etti (denetimde "yeniden açıldı").
 */
export interface WrittenRecord {
  kind: RecordWrite['kind'] | 'restore'
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
        // Yeni satır sürüm 1 ile başlar; arşivlenmiş satır en az 2'dedir (arşiv sürümü artırır).
        written.push({
          kind: row.version > 1 ? 'restore' : 'insert',
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
