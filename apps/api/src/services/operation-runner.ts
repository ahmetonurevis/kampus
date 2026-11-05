import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import { sql } from 'drizzle-orm'
import { z } from 'zod'

import type { State } from '@kampus/school-core/data/seed.ts'
import type { MakeId } from '@kampus/school-core/lib/domain.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'

import {
  isEphemeralCollection,
  isRecordCollection,
  isScalarStateKey,
  recordKey,
  type CollectionName,
  type RecordData,
  type ScalarStateKey,
} from '../db/collections.ts'
import type { Database } from '../db/client.ts'
import { FINANCE_MIRROR_STORE, FINANCE_TABLE_STORE } from '../db/finance-mirror-store.ts'
import {
  findIdempotentResponse,
  saveIdempotentResponse,
  tryLockIdempotencyKey,
} from '../db/idempotency.ts'
import { planPositions } from '../db/positions.ts'
import {
  lockInstitution,
  RECORDS_STORE,
  type CollectionStore,
  type RecordWrite,
  type StoredRecord,
  type StoreScope,
  type WrittenRecord,
} from '../db/records.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import {
  AppError,
  ConflictError,
  MESSAGES,
  NotFoundError,
  RuleViolationError,
  ValidationError,
  withDatabaseErrors,
  type Issue,
} from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'

/**
 * school-core işlemlerini sunucuda çalıştırır (ADR 0001 karar 6): gereken koleksiyonları kurum
 * kapsamında yükler, State şekline getirir, saf işlemi `now` ile çalıştırır, önceki ve sonraki
 * State'i kayıt düzeyinde farklar ve farkı sürüm kontrolüyle tek transaction'da yazar. Denetim
 * kaydı aynı transaction'dadır. Başarısızlıkta hiçbir kayıt değişmez. Transaction kurum
 * kilidiyle başlar; aynı kurumun işlemleri sırayla çalışır (`lockInstitution`).
 */

export interface OperationTools {
  /** İşlem anı, ISO 8601 UTC; core işlemlerinin `now` parametresi. */
  now: string
  makeId: MakeId
}

export interface ExpectedVersion {
  collection: CollectionName
  id: string
  version: number
}

export interface AuditEntity {
  type: string
  id: string
}

/**
 * Koleksiyonun kısmi yüklemesi: yalnız verilen kimlikler (`ids`) ya da süzgece uyan kayıtlar
 * (`match`, `loadRecords` süzgeçleri; hepsi sağlanmalı). Kısmi yüklenen koleksiyonda fark yalnız
 * yüklenen kayıtlar üzerinden hesaplanır: yüklenmeyen kayıt silinmiş veya arşivlenmiş sayılmaz,
 * ona hiç yazılmaz. Yeni kayıt koleksiyonun sonuna eklenir; yüklenen kayıtların sırası
 * değiştirilemez (koleksiyonun bütününü görmeyen işlem sıra planlayamaz, değiştirirse 500).
 * İşlem yalnız gördüğü kayıtlarla doğru karar verebilmelidir: tekillik denetimi gibi kurallar
 * için süzgeç, kuralın baktığı bütün kayıtları kapsamalıdır (ör. aynı öğrencinin yazışmaları).
 */
export type LoadScope = StoreScope

/**
 * Koleksiyon → depo kaydı (ADR 0010 karar 7; ON-046b). `stores` yazma sırasıdır: bağımlı olunan
 * depo önce yazılır (ör. tablo destekli koleksiyonun bağları `records`'tan sonra). `byCollection`'da
 * adı geçmeyen koleksiyon `records`'tadır; kayıttaki her depo `stores`'ta olmalıdır.
 */
export interface StoreRegistry {
  readonly stores: readonly CollectionStore[]
  readonly byCollection: Readonly<Partial<Record<CollectionName, CollectionStore>>>
}

/**
 * Çalıştırıcının varsayılan depo kaydı. Taksit ve sözleşme çift yazılır (ADR 0010 adım 3; ON-046e):
 * kaynak `records`, ayna tablolar (`FINANCE_MIRROR_STORE`). Öteki koleksiyonlar yalnız
 * `records`'tadır. İsteğin `stores`'u vermediği her işlem bunu kullanır.
 */
export const OPERATION_STORES: StoreRegistry = {
  stores: [RECORDS_STORE, FINANCE_MIRROR_STORE],
  byCollection: { invoices: FINANCE_MIRROR_STORE, contracts: FINANCE_MIRROR_STORE },
}

/**
 * Taksit ve sözleşmenin kaynağı tablolardır (ADR 0010 adım 4; ON-046f): yükleme tablolardan, yazma
 * önce tablolara, sonra ayna olarak `records`'a (`FINANCE_TABLE_STORE`). Okuma geçişi kademelidir:
 * finans servisleri (tahsilat, ayrılış, sözleşme, yenileme, kesin kayıt, finans okumaları) bunu
 * isteğin `stores`'u olarak seçer; öteki yollar varsayılanda kalır ve 046g'de geçer. İki kayıt da
 * iki depoya yazdığı için birlikte kullanılabilir.
 */
export const FINANCE_TABLE_STORES: StoreRegistry = {
  stores: [RECORDS_STORE, FINANCE_TABLE_STORE],
  byCollection: { invoices: FINANCE_TABLE_STORE, contracts: FINANCE_TABLE_STORE },
}

/** İşlemin State'i değiştiren saf adımı (core işlemi). */
export type OperationRun<R> = (state: State, tools: OperationTools) => R

/** Kurum kilidinden sonra okunan ortamla kurulan işlem adımı (`OperationRequest.load`). */
export interface LoadedOperation<R> {
  /**
   * Dizi olmayan State alanları (`modules`, `academicYear` …). `records`'ta tutulmaz; çağıran
   * kurum ayarlarından verir. İşlem bunları değiştirirse değişiklik yazılamayacağı için işlem
   * geri alınır (500, `operation.scalar_changed` logu).
   */
  scalars?: Partial<Pick<State, ScalarStateKey>>
  run: OperationRun<R>
}

interface OperationBase<R> {
  /** Denetim kaydı eylemi, ör. `invoice.pay`. */
  action: string
  /**
   * Çalıştırıcının koleksiyon farkından yazdığı denetim satırının eylemi; verilmezse `action`.
   * Asıl kaydını `after`'da kendi denetimiyle yazan işlem, farktaki yan kaydı (ör. puanla açılan
   * bildirim, `notification.create`) ana eylemin ikinci satırı gibi göstermesin diye ayrı ad verir.
   */
  auditAction?: string
  /**
   * Denetim satırı yalnız kaydın ilk yazımında bırakılır; aynı kaydın sonraki güncellemelerinde
   * bırakılmaz. Bu, "bütün yazmalar ve audit_log tek transaction'da" kuralının belgelenmiş dar
   * istisnasıdır (docs/domain/kaynak-platformu.md DOM-KYN-005): her 15 sn'de bir yazılan ve tek
   * başına denetim değeri taşımayan teknik ilerleme kaydı denetim tablosunu şişirmesin. Yalnız
   * `FIRST_WRITE_AUDIT_ACTIONS` içindeki eylemler kullanabilir (başkası 500 programlama hatasıdır);
   * kullanıcı kararı veya veri değişikliği taşıyan işlemde kullanılmaz. Verilmezse her yazma
   * denetlenir.
   */
  auditPolicy?: 'firstWriteOnly'
  /**
   * İşlemin okuduğu ve yazabileceği koleksiyonlar; yüklenmeyen koleksiyona erişim 500'dür.
   * Core `audit` her zaman boş verilir ve yazılmaz; listede olması gerekmez.
   */
  collections: readonly CollectionName[]
  /**
   * Koleksiyon başına kısmi yükleme (`LoadScope`); verilmeyen koleksiyon bütünüyle yüklenir.
   * Anahtar `collections` listesinde olmalıdır (değilse 500). Büyük koleksiyonlarda (yazışma
   * mesajları) işlemin yalnız gereken kayıtları kurum kilidi altında yüklemesi içindir.
   */
  loadScope?: Partial<Record<CollectionName, LoadScope>>
  /**
   * İşlemin depo kaydı; verilmezse `OPERATION_STORES`. Taksit ve sözleşmeyi tablodan okuyan finans
   * işlemi `FINANCE_TABLE_STORES` verir (ADR 0010 adım 4; ON-046f).
   */
  stores?: StoreRegistry
  /** İstemcinin okuduğu sürümler (gövdedeki `version`); tutmazsa 409, kayıt yoksa 404. */
  expectedVersions?: readonly ExpectedVersion[]
  /**
   * `If-Match` ile gelen, koleksiyonu istemcinin bilmediği kaydın sürümü (iş akışı komutunun
   * `:recordId`'si). Kimlik yüklenen koleksiyonlarda aranır; yoksa 404, bulunan satırlardan
   * birinin sürümü tutmazsa 409.
   */
  expectedRecordVersion?: { id: string; version: number }
  /**
   * Denetim kaydının varlığı (işlemin konusu, ör. `{ type: 'prospects', id }`). Zorunlu: ilk
   * değişen kayıt çoğu zaman yan kayıttır (taksit, katılım) ve denetimi yanlış varlığa bağlar.
   */
  entity: AuditEntity | ((result: R) => AuditEntity)
  /**
   * Denetim satırının serbest metin gerekçesi (`audit_log.reason`, en çok 500 karakter): ders
   * iptali ve yedek görevlendirme gibi gerekçeli işlemler (DOM-YTK-069). Gövde değeri olduğu için
   * loglanmaz; yalnız denetim kaydına yazılır.
   */
  auditReason?: string
  makeId?: MakeId
  /**
   * İşlemden sonra aynı transaction'da çalışan ek yazma (ör. State değiştirmeyen işlemin kendi
   * denetim kaydı, `conversation.access`). Hata işlemi bütünüyle geri alır; `DomainError`
   * türüne göre HTTP hatasına çevrilir (`mapOperationError`).
   */
  after?: (tx: Database, result: R) => Promise<void>
}

/**
 * İşlem isteği. Ortamı (modül haritası, üyelik bağlantıları, kurum ayarı) okuyan işlem `load`
 * verir: ortam kurum kilidi alındıktan sonra aynı transaction'da okunur; eşzamanlı ayar veya
 * üyelik değişikliği işlemin gördüğü görüntüyü bayatlatamaz. Ortamsız işlem `run` ve isteğe
 * bağlı sabit `scalars` verir.
 */
export type OperationRequest<R> = OperationBase<R> &
  (
    | (LoadedOperation<R> & { load?: never })
    | { load: (tx: Database) => Promise<LoadedOperation<R>>; scalars?: never; run?: never }
  )

export interface OperationResult<R> {
  result: R
  changes: WrittenRecord[]
  /** Koleksiyon başına yüklenen kayıt sayısı (ölçüm ve log; kişisel veri yok). */
  loaded: Partial<Record<CollectionName, number>>
}

function programmingError(what: string, cause?: unknown): AppError {
  return new AppError(500, 'internal_error', MESSAGES.internal_error, {
    cause: new Error(what, { cause }),
  })
}

/** `auditPolicy: 'firstWriteOnly'` kullanabilen eylemler; yeni giriş belgelenmiş karar ister. */
const FIRST_WRITE_AUDIT_ACTIONS: ReadonlySet<string> = new Set(['video.progress'])

const defaultMakeId: MakeId = (prefix) => `${prefix}-${randomUUID()}`

/**
 * Yalnız yüklenen anahtarları açan State görünümü. Yüklenmemiş koleksiyonu okumak veya yeni
 * State anahtarı yazmak programlama hatasıdır: sessizce boş liste görmek veya yazılmayacak bir
 * değişiklik yapmak yerine işlem durur.
 */
function guardedState(target: Record<string, unknown>): State {
  const proxy = new Proxy(target, {
    get(object, key, receiver) {
      if (
        typeof key === 'string' &&
        !Object.hasOwn(object, key) &&
        (isRecordCollection(key) || isScalarStateKey(key))
      )
        throw programmingError(`state key not loaded: ${key}`)
      return Reflect.get(object, key, receiver)
    },
    set(object, key, value, receiver) {
      if (typeof key !== 'string' || !Object.hasOwn(object, key))
        throw programmingError(`state key not loaded: ${String(key)}`)
      return Reflect.set(object, key, value, receiver)
    },
    deleteProperty(_object, key) {
      throw programmingError(`state key deleted: ${String(key)}`)
    },
  })
  // Görünüm tam State değildir; eksik anahtarlar yukarıdaki tuzakla korunur. Core işlemleri
  // bugün tam `State` aldığı için tip burada daraltılamıyor (bkz. raporlanan core ihtiyacı).
  return proxy as unknown as State
}

function issuePath(path: readonly PropertyKey[]): (string | number)[] {
  return path.map((part) => (typeof part === 'number' ? part : String(part)))
}

/**
 * `DomainError.path` (core'un sabit alan yolu, kullanıcı girdisi değil) varsa 400 Zod yanıtıyla
 * aynı `issues` biçimini üretir; yoksa alan hiç çıkmaz (`issues` isteğe bağlıdır, boş dizi
 * "alan hatası yok" ile "yol bilinmiyor" ayrımını bulandırır). Mesaj core'un Türkçe metnidir.
 */
function domainIssues(error: DomainError): { issues?: Issue[] } {
  if (error.path === undefined) return {}
  return { issues: [{ path: error.path.slice(), code: error.code, message: error.message }] }
}

/**
 * school-core hatasını HTTP hatasına çevirir (api-tasarimi.md §5): `DomainError` türüne göre
 * 422/409/403/404, Zod 400. `path` taşıyan hata 422/409/403'te `issues` da taşır. Düz `Error` ve alt sınıfları kullanıcı hatası sayılmaz (api.md):
 * 500 `internal_error` olur; iç mesaj yanıta gitmez, logda da yalnız hata adı ve yığın kalır
 * (`loggableError`).
 */
export function mapOperationError(error: unknown): Error {
  if (error instanceof AppError) return error
  if (error instanceof z.ZodError) {
    const issues: Issue[] = error.issues.map((issue) => ({
      path: issuePath(issue.path),
      code: issue.code,
      message: issue.message,
    }))
    return new ValidationError(issues)
  }
  if (error instanceof DomainError) {
    switch (error.kind) {
      case 'rule':
        return new RuleViolationError(error.code, error.message, {
          ...domainIssues(error),
          cause: error,
        })
      case 'conflict':
        return new AppError(409, error.code, error.message, {
          ...domainIssues(error),
          cause: error,
        })
      case 'forbidden':
        // Modül kapalıysa mesaj API'nin tek modül mesajıdır (`requireModule` ile aynı).
        return error.code === 'module_disabled'
          ? new AppError(403, 'module_disabled', MESSAGES.module_disabled, { cause: error })
          : new AppError(403, error.code, error.message, {
              ...domainIssues(error),
              cause: error,
            })
      case 'not_found':
        return new NotFoundError()
      default:
        return error.kind satisfies never
    }
  }
  if (error instanceof Error) return programmingError('operation failed', error)
  return programmingError('non-error thrown', error)
}

/** jsonb'nin saklayacağı biçim: `undefined` alanlar düşer, tarihler metne döner. */
function normalize(collection: CollectionName, item: unknown): RecordData {
  const json = JSON.stringify(item)
  if (json === undefined) throw programmingError(`${collection}: item is not serialisable`)
  const value: unknown = JSON.parse(json)
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw programmingError(`${collection}: item is not an object`)
  return Object.fromEntries(Object.entries(value))
}

/**
 * Değişen skaler alanların adları (değer değil). Nesne alanlarında bir alt düzey verilir
 * (`modules.transport`); log kişisel veri ve değer taşımaz.
 */
function changedScalars(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const changed: string[] = []
  for (const key of Object.keys(before)) {
    const old = before[key]
    const now = after[key]
    if (isDeepStrictEqual(old, now)) continue
    if (isPlainObject(old) && isPlainObject(now)) {
      const keys = new Set([...Object.keys(old), ...Object.keys(now)])
      for (const sub of keys)
        if (!isDeepStrictEqual(old[sub], now[sub])) changed.push(`${key}.${sub}`)
    } else changed.push(key)
  }
  return changed.sort()
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function changedFields(before: RecordData, after: RecordData): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys].filter((key) => !isDeepStrictEqual(before[key], after[key]))
}

interface Difference {
  writes: RecordWrite[]
  fields: Set<string>
}

/**
 * Önceki kayıtlar ile işlem sonrası State arasındaki kayıt düzeyindeki fark. Dizinin sırası da
 * farka girer: yeni kayıt core'un koyduğu yere göre sıra alır, yer değiştiren kayıt `move` ile
 * (verisi de değiştiyse güncellemenin içinde) yeni sırasını alır; yerinde kalan kayda yazılmaz.
 */
function difference(
  collections: readonly CollectionName[],
  before: ReadonlyMap<CollectionName, ReadonlyMap<string, StoredRecord>>,
  after: Record<string, unknown>,
  partial: ReadonlySet<CollectionName> = new Set(),
): Difference {
  const writes: RecordWrite[] = []
  const fields = new Set<string>()
  for (const collection of collections) {
    const items = after[collection]
    if (!Array.isArray(items)) throw programmingError(`${collection} is not an array`)
    const previous = before.get(collection) ?? new Map<string, StoredRecord>()
    const seen = new Set<string>()
    const entries = items.map((item) => {
      const data = normalize(collection, item)
      const id = recordKey(collection, data)
      if (id === null) throw programmingError(`${collection}: item without key`)
      if (seen.has(id)) throw programmingError(`${collection}: duplicate key`)
      seen.add(id)
      return { id, data, old: previous.get(id) }
    })
    const isPartial = partial.has(collection)
    if (isPartial) assertOrderKept(collection, entries)
    // Kısmi yükte sıra planlanmaz: yeni kayıt sona eklenir (`writeRecords`), eski yerinde kalır.
    const positions = isPartial
      ? entries.map((entry) => entry.old?.position ?? null)
      : planPositions(entries.map((entry) => entry.old?.position ?? null))
    entries.forEach(({ id, data, old }, index) => {
      const position = positions[index] ?? null
      if (!old) {
        writes.push(
          position === null
            ? { kind: 'insert', collection, id, data }
            : { kind: 'insert', collection, id, data, position },
        )
        for (const key of Object.keys(data)) fields.add(key)
        return
      }
      const moved = position !== null && position !== old.position
      const changed = changedFields(old.data, data)
      if (changed.length === 0) {
        if (moved && position !== null)
          writes.push({ kind: 'move', collection, id, position, expectedVersion: old.version })
        return
      }
      writes.push({
        kind: 'update',
        collection,
        id,
        data,
        expectedVersion: old.version,
        ...(moved && position !== null ? { position } : {}),
      })
      for (const key of changed) fields.add(key)
    })
    // Core'un listeden çıkardığı kayıt silinmez, arşivlenir (veritabani.md §7). `previous` yalnız
    // yüklenen kayıtlardır: kısmi yükte görülmeyen kayıt burada hiç yoktur, arşivlenmez.
    for (const [id, old] of previous)
      if (!seen.has(id))
        writes.push({ kind: 'archive', collection, id, expectedVersion: old.version })
  }
  return { writes, fields }
}

/**
 * Kısmi yüklenen koleksiyonda yüklenen kayıtların göreli sırası korunmalıdır; yeni kayıtlar
 * yalnız sona eklenebilir. Koleksiyonun bütününü görmeyen işlem başa/araya ekleyemez.
 */
function assertOrderKept(
  collection: CollectionName,
  entries: readonly { old: StoredRecord | undefined }[],
): void {
  let last: { position: number; id: string } | null = null
  let appended = false
  for (const { old } of entries) {
    if (!old) {
      appended = true
      continue
    }
    const out =
      appended ||
      (last !== null &&
        (old.position < last.position || (old.position === last.position && old.id < last.id)))
    if (out) throw programmingError(`${collection}: partial load cannot reorder records`)
    last = { position: old.position, id: old.id }
  }
}

/**
 * `audit_log.changes`: değişen alan adları; arşivden yeniden açılan kayıtlar ayrıca kimlikleriyle
 * (`restored`) yazılır, çünkü yeniden açma eski veriyi yenisiyle değiştirir ve sürümü sürdürür.
 */
function auditChanges(fields: ReadonlySet<string>, changes: readonly WrittenRecord[]) {
  const restored = changes
    .filter((change) => change.kind === 'restore')
    .map((change) => ({ collection: change.collection, id: change.id }))
  const sorted = [...fields].sort()
  return restored.length > 0 ? { fields: sorted, restored } : { fields: sorted }
}

/**
 * Çekirdek işleminin çalışacağı State: skalerler ve koleksiyon dizileri yüklenen satırların
 * kopyasıdır. Core State'i yerinde değiştirir; yüklenen satırlar fark için dokunulmadan kalır.
 */
function stateTarget(
  scalars: NonNullable<LoadedOperation<unknown>['scalars']>,
  collections: readonly CollectionName[],
  before: ReadonlyMap<CollectionName, ReadonlyMap<string, StoredRecord>>,
): Record<string, unknown> {
  for (const key of Object.keys(scalars))
    if (!isScalarStateKey(key)) throw programmingError(`unknown scalar state key: ${key}`)
  const target: Record<string, unknown> = structuredClone(scalars)
  // Core denetimi yalnız bu işlem içinde yaşar: boş başlar, farka girmez (collections.ts).
  target.audit = []
  for (const collection of collections)
    target[collection] = [...(before.get(collection)?.values() ?? [])].map((row) =>
      structuredClone(row.data),
    )
  return target
}

/**
 * Sürüm tutmadığında core hatası mı, 409 mu döner: yetki ve kapsam reddi (403, 404) sürümden
 * önce gelir ki kayıt varlığı sızmasın; iş kuralı ve çakışma hataları bayat görüntüden
 * kaynaklanabileceği için 409 `version_conflict` olur (api-tasarimi.md §5). Programlama hatası
 * (500) gizlenmez.
 */
function staleOrDenied(error: Error, stale: boolean): Error {
  if (!stale || !(error instanceof AppError)) return error
  const denied = error.statusCode === 403 || error.statusCode === 404
  return denied || error.statusCode >= 500 ? error : new ConflictError()
}

async function applyOperation<R>(
  tx: Database,
  ctx: ServiceContext,
  request: OperationRequest<R>,
  collections: readonly CollectionName[],
  tools: OperationTools,
): Promise<OperationResult<R>> {
  if (request.auditPolicy !== undefined && !FIRST_WRITE_AUDIT_ACTIONS.has(request.action))
    throw programmingError(`auditPolicy not allowed for action: ${request.action}`)
  // TODO(perf-video-progress): her video ilerleme isteği (öğrenci başına 15 sn'de bir) kurumun tek
  // danışma kilidini alır; 300 eşzamanlı izleyici ≈ 20 işlem/sn ile yoklama, ödeme gibi bütün
  // yazmalarla aynı kuyruğa girer (ölçülmedi). Çözüm adayı: tek kayıt upsert'i için kurum yerine
  // kayıt (öğrenci/video) düzeyinde kilit ya da kilitsiz yol; ölçüm sonrası karar.
  // Yüklemeden önce: aynı kurumun eşzamanlı işlemi bu görüntüyü bayatlatamaz.
  await lockInstitution(tx, ctx.institutionId)
  const registry = request.stores ?? OPERATION_STORES
  const { rows, partial } = await loadOperationRecords(
    tx,
    ctx.institutionId,
    collections,
    request.loadScope,
    registry,
  )
  const before = new Map<CollectionName, Map<string, StoredRecord>>(
    collections.map((collection) => [collection, new Map()]),
  )
  for (const row of rows) before.get(row.collection)?.set(row.id, row)
  const loaded = Object.fromEntries(
    collections.map((collection) => [collection, before.get(collection)?.size ?? 0]),
  )

  // Olmayan kayıt hemen 404'tür; sürüm farkı ise core yetki ve kapsam denetiminden sonra
  // bildirilir: kapsam dışı kullanıcı yanlış sürümle 409 alsaydı kaydın varlığını öğrenirdi.
  let stale = false
  for (const expected of request.expectedVersions ?? []) {
    const row = before.get(expected.collection)?.get(expected.id)
    if (!row) throw new NotFoundError()
    if (row.version !== expected.version) stale = true
  }
  if (request.expectedRecordVersion) {
    const { id, version } = request.expectedRecordVersion
    const rows = collections.flatMap((collection) => before.get(collection)?.get(id) ?? [])
    if (rows.length === 0) throw new NotFoundError()
    if (rows.some((row) => row.version !== version)) stale = true
  }

  const operation: LoadedOperation<R> = request.load ? await request.load(tx) : request
  const scalars = operation.scalars ?? {}
  const target = stateTarget(scalars, collections, before)

  let result: R
  try {
    result = operation.run(guardedState(target), tools)
  } catch (error) {
    throw staleOrDenied(mapOperationError(error), stale)
  }
  // Core işlemi bayat görüntü üzerinde kabul etse de istemcinin okuduğu sürüm geçersizdir.
  if (stale) throw new ConflictError()

  // Skaler alan `records`'ta tutulmaz; değişikliği sessizce düşürmek yerine işlem geri alınır.
  const scalarChanges = changedScalars(scalars, target)
  if (scalarChanges.length > 0) {
    ctx.log.error({
      event: 'operation.scalar_changed',
      action: request.action,
      fields: scalarChanges,
    })
    throw programmingError(`operation changed scalar state: ${scalarChanges.join(', ')}`)
  }

  const { writes, fields } = difference(collections, before, target, partial)
  const changes = await writeOperationRecords(tx, ctx.institutionId, writes, ctx.now, registry)
  const first = changes[0]
  // `firstWriteOnly`: kayıt bu işlemde açılmadıysa (yalnız güncelleme) denetim satırı yazılmaz.
  const audited =
    request.auditPolicy !== 'firstWriteOnly' || changes.some((c) => c.kind === 'insert')
  if (first && audited) {
    // Yeni kaydın kimliği işlem çalışınca belli olur (ör. oluşturulan hedef).
    const entity = typeof request.entity === 'function' ? request.entity(result) : request.entity
    await tx.insert(auditLog).values({
      institutionId: ctx.institutionId,
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action: request.auditAction ?? request.action,
      entityType: entity.type,
      entityId: entity.id,
      changes: auditChanges(fields, changes),
      ...(request.auditReason === undefined ? {} : { reason: request.auditReason }),
      createdAt: ctx.now,
    })
  }
  if (request.after) {
    try {
      await request.after(tx, result)
    } catch (error) {
      // `after`'daki depo kuralı da kullanıcı hatasıdır (ör. birleştirmede açık kur kararı,
      // `moveGroupMembers`); veritabanı ve uygulama hataları olduğu gibi yukarı gider.
      throw error instanceof DomainError ? mapOperationError(error) : error
    }
  }
  ctx.log.info({
    event: 'operation.applied',
    action: request.action,
    inserted: changes.filter((change) => change.kind === 'insert').length,
    updated: changes.filter((change) => change.kind === 'update').length,
    archived: changes.filter((change) => change.kind === 'archive').length,
    moved: changes.filter((change) => change.kind === 'move').length,
    restored: changes.filter((change) => change.kind === 'restore').length,
    loaded,
  })
  return { result, changes, loaded }
}

function storeOf(registry: StoreRegistry, collection: CollectionName): CollectionStore {
  const store = registry.byCollection[collection] ?? RECORDS_STORE
  if (!registry.stores.includes(store))
    throw programmingError(`store ${store.name} for ${collection} is not registered`)
  return store
}

/**
 * İşlemin kayıtları, koleksiyonun deposundan: kısmi yükleme verilmeyen koleksiyonlar depo başına
 * tek çağrıda, kısmi olanlar kendi kapsamıyla (kimlikle ya da süzgeçle). Hepsi aynı
 * transaction'da, kurum kilidinden sonra. `loadScope` anahtarı `collections`'ta olmalıdır.
 */
export async function loadOperationRecords(
  tx: Database,
  institutionId: string,
  collections: readonly CollectionName[],
  loadScope: OperationBase<unknown>['loadScope'],
  registry: StoreRegistry = OPERATION_STORES,
): Promise<{ rows: StoredRecord[]; partial: Set<CollectionName> }> {
  const scopes = Object.entries(loadScope ?? {})
  const partial = new Set<CollectionName>()
  for (const [collection] of scopes) {
    if (!isRecordCollection(collection) || !collections.includes(collection))
      throw programmingError(`load scope for unlisted collection: ${collection}`)
    partial.add(collection)
  }
  const full = collections.filter((collection) => !partial.has(collection))
  const rows: StoredRecord[] = []
  for (const store of registry.stores) {
    const own = full.filter((collection) => storeOf(registry, collection) === store)
    if (own.length > 0) rows.push(...(await store.loadAll(tx, institutionId, own)))
  }
  // Tek depodaki tek sorgunun sırası (koleksiyon, sonra deponun sırası) depolar arasında da korunur.
  rows.sort((left, right) => compareText(left.collection, right.collection))
  for (const [collection, scope] of scopes) {
    if (!scope || !isRecordCollection(collection)) continue
    rows.push(
      ...(await storeOf(registry, collection).loadScoped(tx, institutionId, collection, scope)),
    )
  }
  return { rows, partial }
}

/**
 * Farkı depolara dağıtır ve depo kaydının sırasıyla yazar (ADR 0010 karar 7); her depo kendi
 * içindeki sırayı belirler (`records`: koleksiyon, kimlik). Yazılanlar depo sırasıyla döner.
 */
export async function writeOperationRecords(
  tx: Database,
  institutionId: string,
  writes: readonly RecordWrite[],
  now: Date,
  registry: StoreRegistry = OPERATION_STORES,
): Promise<WrittenRecord[]> {
  const grouped = new Map<CollectionStore, RecordWrite[]>()
  for (const write of writes) {
    const store = storeOf(registry, write.collection)
    const group = grouped.get(store)
    if (group) group.push(write)
    else grouped.set(store, [write])
  }
  const written: WrittenRecord[] = []
  for (const store of registry.stores) {
    const group = grouped.get(store)
    if (group) written.push(...(await store.write(tx, institutionId, group, now)))
  }
  // Yazılanlar `writeRecords`'un sırasıyla (koleksiyon, kimlik) döner; depo sayısından bağımsız.
  return written.sort(
    (left, right) =>
      compareText(left.collection, right.collection) || compareText(left.id, right.id),
  )
}

/** Kod birimi karşılaştırması (`records.ts` `compareKeys` ile aynı). */
const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)

function prepare(
  ctx: ServiceContext,
  request: { collections: readonly CollectionName[]; makeId?: MakeId },
) {
  const collections = [...new Set(request.collections)].filter(
    (collection) => !isEphemeralCollection(collection),
  )
  const tools: OperationTools = {
    now: ctx.now.toISOString(),
    makeId: request.makeId ?? defaultMakeId,
  }
  return { collections, tools }
}

/** Yalnız okuyan işlem isteği: yazma, sürüm, denetim kaydı ve `after` yoktur. */
export interface ReadOnlyOperationRequest<R> {
  /** Günlük eylem adı; yalnız log için. */
  action: string
  collections: readonly CollectionName[]
  loadScope?: OperationBase<R>['loadScope']
  /** Depo kaydı; verilmezse `OPERATION_STORES` (`OperationBase.stores`). */
  stores?: StoreRegistry
  load: (tx: Database) => Promise<LoadedOperation<R>>
}

/**
 * Saf önizleme için salt okunur çalıştırma. Kurum kilidi alınmaz: önizleme hiçbir şey yazmadığı
 * için kurumun yazan işlemlerini sıraya sokmamalı, ardışık büyük önizlemeler de yazmaları
 * bekletmemelidir. Transaction `REPEATABLE READ READ ONLY`'dir: ortam ve koleksiyonlar tek
 * görüntüden okunur (yazan işlemin yarım durumu görülmez) ve yazma girişimi veritabanında
 * reddedilir. Core işlemi State kopyası üzerinde çalışır; sonuç hiçbir yere yazılmaz.
 */
export async function runReadOnly<R>(
  ctx: ServiceContext,
  request: ReadOnlyOperationRequest<R>,
): Promise<R> {
  const { collections, tools } = prepare(ctx, request)
  const work = ctx.db.transaction(async (tx) => {
    // İlk ifade olmalı: görüntü ilk sorguda sabitlenir.
    await tx.execute(sql`set transaction isolation level repeatable read read only`)
    const { rows } = await loadOperationRecords(
      tx,
      ctx.institutionId,
      collections,
      request.loadScope,
      request.stores,
    )
    const before = new Map<CollectionName, Map<string, StoredRecord>>(
      collections.map((collection) => [collection, new Map()]),
    )
    for (const row of rows) before.get(row.collection)?.set(row.id, row)
    const operation = await request.load(tx)
    const target = stateTarget(operation.scalars ?? {}, collections, before)
    try {
      return operation.run(guardedState(target), tools)
    } catch (error) {
      throw mapOperationError(error)
    }
  })
  return withDatabaseErrors(work)
}

export async function runOperation<R>(
  ctx: ServiceContext,
  request: OperationRequest<R>,
): Promise<OperationResult<R>> {
  const { collections, tools } = prepare(ctx, request)
  // Kilit beklerken veya yüklerken oluşan kilitlenme de 409 `conflict` olur.
  const work = ctx.db.transaction((tx) => applyOperation(tx, ctx, request, collections, tools))
  return withDatabaseErrors(work)
}

/** İstemcinin `Idempotency-Key`'i ve isteğin özeti (`requestFingerprint`). */
export interface IdempotencyRequest {
  key: string
  fingerprint: string
}

/** Uçun döndüreceği başarılı yanıt; idempotent istekte aynen saklanır ve tekrarlanır. */
export interface OperationResponse {
  statusCode: number
  body: unknown
}

export interface CommandResponse extends OperationResponse {
  /** Yanıt saklanan ilk yanıtın tekrarı mı (`Idempotent-Replayed: true`). */
  replayed: boolean
}

/**
 * İşlemi çalıştırır ve uç yanıtını üretir. Anahtar verilirse (api-tasarimi.md §7) anahtar
 * kilidi, kurum kilidi, saklanan yanıt araması, işlem ve yanıtın saklanması tek
 * transaction'dadır: aynı anahtar + aynı özet ilk yanıtı tekrarlar, farklı özet 422
 * `idempotency_key_reused`, aynı anahtarla süren istek 409 `idempotency_in_progress`. Hata
 * yanıtı saklanmaz (transaction geri alınır); aynı anahtarla düzeltilmiş istek gönderilebilir.
 */
export async function runCommand<R>(
  ctx: ServiceContext,
  request: OperationRequest<R>,
  respond: (outcome: OperationResult<R>) => OperationResponse,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  if (idempotency === null) return { ...respond(await runOperation(ctx, request)), replayed: false }
  const { key, fingerprint } = idempotency
  const { collections, tools } = prepare(ctx, request)
  const work = ctx.db.transaction(async (tx): Promise<CommandResponse> => {
    const { institutionId } = ctx
    const { userId } = ctx.actor
    if (!(await tryLockIdempotencyKey(tx, institutionId, userId, key)))
      throw new AppError(409, 'idempotency_in_progress', MESSAGES.idempotency_in_progress)
    // Kurum kilidi aramadan önce: aynı anahtarlı önceki istek bu noktada ya tamamlanmış ya da
    // hiç yazmamıştır.
    await lockInstitution(tx, institutionId)
    const stored = await findIdempotentResponse(tx, institutionId, userId, key, ctx.now)
    if (stored) {
      if (stored.requestHash !== fingerprint)
        throw new AppError(422, 'idempotency_key_reused', MESSAGES.idempotency_key_reused)
      ctx.log.info({ event: 'operation.replayed', action: request.action })
      return { statusCode: stored.statusCode, body: stored.body, replayed: true }
    }
    const response = respond(await applyOperation(tx, ctx, request, collections, tools))
    await saveIdempotentResponse(
      tx,
      institutionId,
      userId,
      key,
      { requestHash: fingerprint, ...response },
      ctx.now,
    )
    return { ...response, replayed: false }
  })
  return withDatabaseErrors(work)
}
