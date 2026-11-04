import type { FastifyBaseLogger } from 'fastify'

import type { Database } from '../db/client.ts'
import { findHeldStorageKeys } from '../db/files.ts'
import { auditLog } from '../db/schema/audit-log.ts'
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
 * Bir çalıştırmada kurum başına en çok BAŞARILI silme. Sınıra gelen tarama durur, kalan yetimler
 * sonraki çalıştırmaya kalır: tek iş depoyu uzun süre meşgul etmez ve pg-boss süre sınırına
 * (900 sn) yaklaşmaz. Hatalı denemeler bu sınırı doldurmaz; yoksa kalıcı hata veren (ör. izin) 500
 * nesne her gün aynı sırayla denenir, arkadaki yetimlere hiç sıra gelmezdi.
 */
export const ORPHAN_PURGE_LIMIT = 500

/**
 * Bir çalıştırmada kurum başına en çok silme HATASI. Depo bütünüyle bozuksa (bağlantı, izin) her
 * nesne hata verir; bu sınır turu, boşuna on binlerce deneme ve log satırı üretmeden keser. Elli
 * hata sınırı, tek tük kalıcı hatayı (birkaç nesne) tolere edecek kadar geniş, depo arızasını
 * dakikalar değil saniyeler içinde anlayacak kadar dardır.
 */
export const ORPHAN_FAILURE_LIMIT = 50

/**
 * Bir çalıştırmada kurum başına en çok taranan nesne. Liste sırası sabittir ve satırı tutulan
 * nesneler de sayılır; sınırsız tarama çok büyük bir kurumda işi pg-boss süre sınırının ötesine
 * taşırdı. 100 000 nesne, 200'lük arama gruplarıyla 500 veritabanı sorgusu ve disk listesinde
 * saniyeler/dakikalar düzeyindedir. Sınıra gelen tarama durur (`stopped: 'scan_limit'`); sonraki
 * nesnelere ancak baştaki yetimler silindikçe sıra gelir (TODO: tarama imleci).
 */
export const ORPHAN_SCAN_LIMIT = 100_000

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
  /**
   * Tarama yarıda kaldıysa nedeni: başarılı silme sınırı (`limit`), hata sınırı (`failures`),
   * tarama sınırı (`scan_limit`) ya da işin iptali (`aborted`); tamamlandıysa `null`.
   */
  stopped: 'limit' | 'failures' | 'scan_limit' | 'aborted' | null
}

/**
 * Kurumun depo önekindeki (`<kurum>/`) yetim nesneleri siler (OG-093, IST-027; ADR 0003 karar 4,
 * 5, 13). Yetim: hiçbir `files` satırının tutmadığı nesne (`findHeldStorageKeys`): yüklemede
 * silinemeyen ya da satırı yazılmadan süreç çökmesiyle kalan nesne, satır yazılamadan kalan
 * dönüşmüş ses çıktısı ve `rejected`/`deleted` satırın silinemeyip kalan nesnesi. Son değişikliği
 * `ORPHAN_GRACE_MS`'den yeni nesneye dokunulmaz. Liste akışla okunur, anahtarlar `LOOKUP_BATCH`'lik
 * gruplarla veritabanında aranır; en çok `limit` nesne silinir, `failureLimit` hata ve `scanLimit`
 * taranan nesne turu durdurur. Silme hatası öteki nesneleri durdurmaz; yalnız kurum kimliği ve
 * depo anahtarıyla (kişisel veri taşımaz, karar 4) loglanır.
 *
 * KVKK (guvenlik-kvkk.md §10): satırsız nesne de kişisel veri taşıyabilir (yarım yüklenen belge);
 * en az bir nesne silindiyse kurum başına tek toplu `file.orphans_purge` denetim satırı yazılır:
 * aktör sistem (`actorUserId` boş), `changes.counts` yalnız taranan/silinen/hata sayıları; anahtar
 * listesi, ad ve içerik yok. İdempotenttir: silinen nesne sonraki taramada listelenmez.
 */
export async function purgeOrphanObjects(input: {
  db: Database
  storage: StorageDriver
  institutionId: string
  now: Date
  log: FastifyBaseLogger
  limit?: number
  failureLimit?: number
  scanLimit?: number
  signal?: AbortSignal
}): Promise<OrphanPurgeResult> {
  const { db, storage, institutionId, log, signal } = input
  const limit = input.limit ?? ORPHAN_PURGE_LIMIT
  const failureLimit = input.failureLimit ?? ORPHAN_FAILURE_LIMIT
  const scanLimit = input.scanLimit ?? ORPHAN_SCAN_LIMIT
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
      if (signal?.aborted === true) {
        result.stopped = 'aborted'
        return false
      }
      if (result.purged >= limit) {
        result.stopped = 'limit'
        return false
      }
      if (result.failed >= failureLimit) {
        result.stopped = 'failures'
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
  for await (const object of storage.list(prefix, log)) {
    if (signal?.aborted === true) {
      result.stopped = 'aborted'
      break
    }
    if (result.scanned >= scanLimit) {
      result.stopped = 'scan_limit'
      break
    }
    result.scanned += 1
    batch.push(object)
    if (batch.length < LOOKUP_BATCH) continue
    const next = await flush(batch)
    batch = []
    if (!next) break
  }
  // Tarama sınırında ya da liste bitince kalan grup da işlenir; öteki durma nedenlerinde işlenmez.
  if ((result.stopped === null || result.stopped === 'scan_limit') && batch.length > 0) {
    if (signal?.aborted === true) result.stopped = 'aborted'
    else await flush(batch)
  }
  log.info({ event: 'file.orphans_purged', institutionId, ...result })
  if (result.purged > 0) {
    await db.insert(auditLog).values({
      institutionId,
      action: 'file.orphans_purge',
      entityType: 'file',
      changes: {
        counts: { scanned: result.scanned, purged: result.purged, failed: result.failed },
      },
      createdAt: input.now,
    })
  }
  return result
}
