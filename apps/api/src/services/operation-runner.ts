import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import { z } from 'zod'

import type { State } from '@kampus/school-core/data/seed.ts'
import type { MakeId } from '@kampus/school-core/lib/domain.ts'

import {
  isEphemeralCollection,
  isRecordCollection,
  isScalarStateKey,
  recordKey,
  type CollectionName,
  type RecordData,
  type ScalarStateKey,
} from '../db/collections.ts'
import { planPositions } from '../db/positions.ts'
import {
  loadRecords,
  lockInstitution,
  writeRecords,
  type RecordWrite,
  type StoredRecord,
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

export interface OperationRequest<R> {
  /** Denetim kaydı eylemi, ör. `invoice.pay`. */
  action: string
  /**
   * İşlemin okuduğu ve yazabileceği koleksiyonlar; yüklenmeyen koleksiyona erişim 500'dür.
   * Core `audit` her zaman boş verilir ve yazılmaz; listede olması gerekmez.
   */
  collections: readonly CollectionName[]
  /**
   * Dizi olmayan State alanları (`modules`, `academicYear` …). `records`'ta tutulmaz; çağıran
   * kurum ayarlarından verir. İşlem bunları değiştirirse değişiklik yazılamayacağı için işlem
   * geri alınır (500, `operation.scalar_changed` logu).
   */
  scalars?: Partial<Pick<State, ScalarStateKey>>
  /** İstemcinin okuduğu sürümler (gövdedeki `version`); tutmazsa 409, kayıt yoksa 404. */
  expectedVersions?: readonly ExpectedVersion[]
  /**
   * Denetim kaydının varlığı (işlemin konusu, ör. `{ type: 'prospects', id }`). Zorunlu: ilk
   * değişen kayıt çoğu zaman yan kayıttır (taksit, katılım) ve denetimi yanlış varlığa bağlar.
   */
  entity: { type: string; id: string }
  makeId?: MakeId
  run: (state: State, tools: OperationTools) => R
}

export interface OperationResult<R> {
  result: R
  changes: WrittenRecord[]
}

function programmingError(what: string, cause?: unknown): AppError {
  return new AppError(500, 'internal_error', MESSAGES.internal_error, {
    cause: new Error(what, { cause }),
  })
}

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

const DOMAIN_ERROR_KINDS = ['rule', 'conflict', 'forbidden', 'not_found'] as const
type DomainErrorKind = (typeof DOMAIN_ERROR_KINDS)[number]

function isDomainErrorKind(value: unknown): value is DomainErrorKind {
  return DOMAIN_ERROR_KINDS.some((kind) => kind === value)
}

/**
 * school-core hatasını HTTP hatasına çevirir (kod-yazim.md hata tablosu).
 * TODO(C2-DomainError): core `DomainError`'ı dışa aktarınca yapısal denetim `instanceof` olur ve
 * düz `Error` eşlemesi kalkar (düz `Error` o zaman 500'dür).
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
  if (error instanceof Error && error.name === 'DomainError') {
    const code: unknown = Reflect.get(error, 'code')
    const kind: unknown = Reflect.get(error, 'kind')
    if (typeof code === 'string' && isDomainErrorKind(kind)) {
      switch (kind) {
        case 'rule':
          return new RuleViolationError(code, error.message, { cause: error })
        case 'conflict':
          return new AppError(409, code, error.message, { cause: error })
        case 'forbidden':
          return new AppError(403, code, error.message, { cause: error })
        case 'not_found':
          return new NotFoundError()
        default:
          return kind satisfies never
      }
    }
  }
  // Geçici: core bugün iş kuralı reddini düz `Error` + Türkçe mesajla fırlatıyor. Yalnız tam
  // `Error` örneği kural reddi sayılır; TypeError gibi alt sınıflar programlama hatasıdır.
  if (error instanceof Error && Object.getPrototypeOf(error) === Error.prototype)
    return new RuleViolationError('rule_violation', error.message, { cause: error })
  if (error instanceof Error) return error
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
    const positions = planPositions(entries.map((entry) => entry.old?.position ?? null))
    entries.forEach(({ id, data, old }, index) => {
      const position = positions[index] ?? 0
      if (!old) {
        writes.push({ kind: 'insert', collection, id, data, position })
        for (const key of Object.keys(data)) fields.add(key)
        return
      }
      const moved = position !== old.position
      const changed = changedFields(old.data, data)
      if (changed.length === 0) {
        if (moved)
          writes.push({ kind: 'move', collection, id, position, expectedVersion: old.version })
        return
      }
      writes.push({
        kind: 'update',
        collection,
        id,
        data,
        expectedVersion: old.version,
        ...(moved ? { position } : {}),
      })
      for (const key of changed) fields.add(key)
    })
    // Core'un listeden çıkardığı kayıt silinmez, arşivlenir (veritabani.md §7).
    for (const [id, old] of previous)
      if (!seen.has(id))
        writes.push({ kind: 'archive', collection, id, expectedVersion: old.version })
  }
  return { writes, fields }
}

export async function runOperation<R>(
  ctx: ServiceContext,
  request: OperationRequest<R>,
): Promise<OperationResult<R>> {
  const collections = [...new Set(request.collections)].filter(
    (collection) => !isEphemeralCollection(collection),
  )
  for (const key of Object.keys(request.scalars ?? {}))
    if (!isScalarStateKey(key)) throw programmingError(`unknown scalar state key: ${key}`)
  const now = ctx.now.toISOString()
  const tools: OperationTools = { now, makeId: request.makeId ?? defaultMakeId }

  // Kilit beklerken veya yüklerken oluşan kilitlenme de 409 `conflict` olur.
  const work = ctx.db.transaction(async (tx) => {
    // Yüklemeden önce: aynı kurumun eşzamanlı işlemi bu görüntüyü bayatlatamaz.
    await lockInstitution(tx, ctx.institutionId)
    const loaded = await loadRecords(tx, ctx.institutionId, collections)
    const before = new Map<CollectionName, Map<string, StoredRecord>>(
      collections.map((collection) => [collection, new Map()]),
    )
    for (const row of loaded) before.get(row.collection)?.set(row.id, row)

    for (const expected of request.expectedVersions ?? []) {
      const row = before.get(expected.collection)?.get(expected.id)
      if (!row) throw new NotFoundError()
      if (row.version !== expected.version) throw new ConflictError()
    }

    // Core State'i yerinde değiştirir; yüklenen satırlar fark için dokunulmadan kalır.
    const target: Record<string, unknown> = structuredClone(request.scalars ?? {})
    // Core denetimi yalnız bu işlem içinde yaşar: boş başlar, farka girmez (collections.ts).
    target.audit = []
    for (const collection of collections)
      target[collection] = [...(before.get(collection)?.values() ?? [])].map((row) =>
        structuredClone(row.data),
      )

    let result: R
    try {
      result = request.run(guardedState(target), tools)
    } catch (error) {
      throw mapOperationError(error)
    }

    // Skaler alan `records`'ta tutulmaz; değişikliği sessizce düşürmek yerine işlem geri alınır.
    const scalarChanges = changedScalars(request.scalars ?? {}, target)
    if (scalarChanges.length > 0) {
      ctx.log.error({
        event: 'operation.scalar_changed',
        action: request.action,
        fields: scalarChanges,
      })
      throw programmingError(`operation changed scalar state: ${scalarChanges.join(', ')}`)
    }

    const { writes, fields } = difference(collections, before, target)
    const changes = await writeRecords(tx, ctx.institutionId, writes, ctx.now)
    const first = changes[0]
    if (first) {
      await tx.insert(auditLog).values({
        institutionId: ctx.institutionId,
        actorUserId: ctx.actor.userId,
        actorRole: ctx.actor.role,
        action: request.action,
        entityType: request.entity.type,
        entityId: request.entity.id,
        changes: { fields: [...fields].sort() },
        createdAt: ctx.now,
      })
    }
    ctx.log.info({
      event: 'operation.applied',
      action: request.action,
      inserted: changes.filter((change) => change.kind === 'insert').length,
      updated: changes.filter((change) => change.kind === 'update').length,
      archived: changes.filter((change) => change.kind === 'archive').length,
      moved: changes.filter((change) => change.kind === 'move').length,
    })
    return { result, changes }
  })
  return withDatabaseErrors(work)
}
