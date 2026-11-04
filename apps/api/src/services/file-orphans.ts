import type { FastifyBaseLogger } from 'fastify'

import type { Database } from '../db/client.ts'
import { findHeldStorageKeys } from '../db/files.ts'
import {
  STORAGE_KEY_SEGMENT,
  type StorageDriver,
  type StoredObjectInfo,
} from '../storage/storage.ts'

/**
 * Güvenlik payı: son değişikliği bundan yeni nesne yetim sayılmaz. Yükleme nesneyi önce depoya
 * yazar, satırı sonra (`services/files.ts` `storeStream` → `insertFile`); ses dönüşümü de çıktıyı
 * yazıp satırı ardından günceller (`media-transcode.ts`). Yazım sürerken ya da satır transaction'ı
 * bitmeden listelenen nesne bu pay sayesinde silinmez. 24 saat, bağlanmamış dosyanın ömrüyle
 * (ADR 0003 karar 5) aynıdır ve yükleme/dönüşüm süre sınırlarının (dakikalar) çok üstündedir.
 */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000

/**
 * Bir çalıştırmada kurum başına en çok silme denemesi (başarılı ya da hatalı). Sınıra gelen tarama
 * durur, kalan yetimler sonraki çalıştırmaya kalır: tek iş depoyu uzun süre meşgul etmez ve pg-boss
 * süre sınırına (900 sn) yaklaşmaz.
 */
export const ORPHAN_PURGE_LIMIT = 500

/** Veritabanında birlikte aranan anahtar sayısı (tek `in` sorgusu). */
const LOOKUP_BATCH = 200

export interface OrphanPurgeResult {
  /** Listelenen nesne sayısı. */
  scanned: number
  /** Güvenlik payından eski, hiçbir satırın tutmadığı ve silinmesi denenen nesneler. */
  candidates: number
  purged: number
  /** Silme hatası (loglandı, nesne sonraki çalıştırmada yeniden denenir). */
  failed: number
  /** Satırsız ama güvenlik payından yeni olduğu için atlanan nesneler. */
  recent: number
  /** Tarama yarıda kaldıysa nedeni: silme sınırı ya da işin iptali; tamamlandıysa `null`. */
  stopped: 'limit' | 'aborted' | null
}

/**
 * Kurumun depo önekindeki (`<kurum>/`) yetim nesneleri siler (OG-093, IST-027; ADR 0003 karar 4,
 * 5, 13). Yetim: hiçbir `files` satırının tutmadığı nesne (`findHeldStorageKeys`): yüklemede
 * silinemeyen ya da satırı yazılmadan süreç çökmesiyle kalan nesne, satır yazılamadan kalan
 * dönüşmüş ses çıktısı ve `rejected`/`deleted` satırın silinemeyip kalan nesnesi. Son değişikliği
 * `ORPHAN_GRACE_MS`'den yeni nesneye dokunulmaz. Liste akışla okunur, anahtarlar `LOOKUP_BATCH`'lik
 * gruplarla veritabanında aranır; en çok `limit` silme denenir. Silme hatası öteki nesneleri
 * durdurmaz; yalnız kurum kimliği ve depo anahtarıyla (kişisel veri taşımaz, karar 4) loglanır.
 * Satır ve denetim kaydı yazılmaz: satırsız nesnenin varlığı yoktur, satırlı olanın imhası kendi
 * işinde denetlenmiştir. İdempotenttir: silinen nesne sonraki taramada listelenmez.
 */
export async function purgeOrphanObjects(input: {
  db: Database
  storage: StorageDriver
  institutionId: string
  now: Date
  log: FastifyBaseLogger
  limit?: number
  signal?: AbortSignal
}): Promise<OrphanPurgeResult> {
  const { db, storage, institutionId, log, signal } = input
  const limit = input.limit ?? ORPHAN_PURGE_LIMIT
  const cutoff = input.now.getTime() - ORPHAN_GRACE_MS
  const result: OrphanPurgeResult = {
    scanned: 0,
    candidates: 0,
    purged: 0,
    failed: 0,
    recent: 0,
    stopped: null,
  }
  // Anahtar bölümüne uymayan kurum kimliğiyle hiç nesne yazılamaz (`storageKeyFor`).
  if (!STORAGE_KEY_SEGMENT.test(institutionId)) return result
  const prefix = `${institutionId}/`

  /** Grubu veritabanında arar ve yetimleri siler; sınıra gelince `false` döner. */
  const flush = async (batch: StoredObjectInfo[]): Promise<boolean> => {
    const held = await findHeldStorageKeys(
      db,
      institutionId,
      batch.map((object) => object.key),
    )
    for (const object of batch) {
      if (held.has(object.key) || !object.key.startsWith(prefix)) continue
      if (object.lastModified.getTime() > cutoff) {
        result.recent += 1
        continue
      }
      if (result.candidates >= limit) {
        result.stopped = 'limit'
        return false
      }
      result.candidates += 1
      try {
        await storage.delete(object.key)
        result.purged += 1
      } catch (error) {
        result.failed += 1
        log.error({
          event: 'file.orphan_delete_failed',
          institutionId,
          storageKey: object.key,
          err: error,
        })
      }
    }
    return true
  }

  let batch: StoredObjectInfo[] = []
  for await (const object of storage.list(prefix)) {
    if (signal?.aborted === true) {
      result.stopped = 'aborted'
      break
    }
    result.scanned += 1
    batch.push(object)
    if (batch.length < LOOKUP_BATCH) continue
    const next = await flush(batch)
    batch = []
    if (!next) break
  }
  if (result.stopped === null && batch.length > 0) {
    if (signal?.aborted === true) result.stopped = 'aborted'
    else await flush(batch)
  }
  log.info({ event: 'file.orphans_purged', institutionId, ...result })
  return result
}
