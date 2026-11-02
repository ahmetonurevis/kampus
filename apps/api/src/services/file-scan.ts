import type { FastifyBaseLogger } from 'fastify'

import type { FilePurpose } from '@kampus/school-core/content/taxonomy.ts'

import type { Database } from '../db/client.ts'
import { findFile, type StoredFile } from '../db/files.ts'
import { AppError } from '../errors.ts'
import type { StorageDriver } from '../storage/storage.ts'
import { needsTranscode } from './audio-transcoder.ts'
import { ScanLimitExceededError, type FileScanner } from './file-scanner.ts'
import { recordAudioScanClean, recordFileCheck } from './files.ts'

/**
 * Yüklenen dosyanın virüs taraması (ADR 0003 karar 8; OG-092, OG-988, IST-027; DOM-KYN-004).
 * Tarayıcı açıkken yükleme `processing` başlar ve `file.scan` işi satırla aynı transaction'da
 * kuyruğa girer; iş nesneyi depodan akışla okuyup tarayıcıya verir:
 *
 * - temiz: `recordFileCheck` → `ready` (`file.ready` denetimi; dosya artık bağlanabilir);
 * - zararlı (imza ya da sezgi bulgusu): `rejected`, nesne silinir, `file.reject` denetimi; log
 *   yalnız kimlik ve imza adını taşır, dosya adı yazılmaz;
 * - içerik tarama sınırını aşıyor (`clamd` `INSTREAM size limit exceeded`): `rejected`
 *   (`scan_limit_exceeded`; Sabah kararı 43: sınırı aşan içerik taramasız `ready` olamaz);
 * - nesne yok: taranamaz, `rejected` (`scan_object_missing`);
 * - tarayıcıya ulaşılamadı, süre aşıldı ya da depo okunamadı: hata fırlatılır (geçici), iş yeniden
 *   denenir; dosya `processing` kalır ve hiçbir yolda taramasız `ready` olmaz.
 *
 * Ret kaydı yazılıp nesne silinemezse (`recordFileCheck` hatayı fırlatır, iş yeniden denenir)
 * yeniden denemede satır `rejected`'tır: tarama tekrarlanmaz, yalnız nesne silme yeniden çalışır
 * (`recordFileCheck` sözleşmesi; sonuç `skipped`/`already_rejected`).
 *
 * İdempotenttir: `processing` olmayan dosya taranmaz.
 *
 * Ses (OG-988): tarayıcı açıkken yüklenen ses `scanPending` başlar, `media.transcode` ile aynı
 * transaction'da kuyruğa girer ve dönüşümü beklemeden taranır. Taranan nesne yüklenen özgün
 * nesnedir (`scannedStorageKey`): ClamAV'nin imza ve sezgileri kullanıcının gönderdiği bayta
 * bakar ve `ffmpeg`'i hedefleyen bozuk kayıt da odur; dönüşmüş çıktıyı bizim `ffmpeg`'imiz
 * yazdığından onu taramak yüklemeyi denetlemez. Dönüşüm önce biterse özgün anahtar
 * `superseded_storage_key`'e geçer ve tarama bitene kadar silinmez (`listSupersededObjects`
 * `processing` satırı atlar); bitmemişse hâlâ `storage_key`'dir. Temiz sonuç
 * `recordAudioScanClean`'le yazılır: dönüşüm bitmişse `ready`'yi tarama, bitmemişse dönüşüm
 * yazar. Zararlı ses `rejected` olur; dönüşmüş çıktı da özgün nesne de silinir. Tarayıcı kapalıyken
 * yüklenen ses (`scanPending` yok) taranmaz (`not_scanned`).
 */

/** İş yükü: yalnız kimlikler (kişisel veri yok). */
export interface FileScanJobData {
  institutionId: string
  fileId: string
}

/**
 * Taramayı kuyruğa koyan taraf (`MediaTranscodeScheduler` ile aynı sözleşme). Kuyruk açıkken
 * pg-boss iş satırı yüklemeyi yazan transaction'da eklenir; kuyruk kapalıyken tarama
 * transaction'dan sonra süreç içinde, arka planda tek denemeyle çalışır (`jobs/file-scan.ts`).
 */
export interface FileScanScheduler {
  /** Yüklemeyi yazan transaction içinde çağrılır. */
  enqueue(tx: Database, data: FileScanJobData): Promise<void>
  /** Transaction yazıldıktan sonra çağrılır; hata fırlatmaz, yükleme yanıtı beklemez. */
  afterCommit(data: FileScanJobData): Promise<void>
}

/**
 * Uygulamanın tarama bağımlılıkları. `scanner` `null` ise tarama kapalıdır (`FILE_SCANNER=off`):
 * yüklenen dosya `pending` kalır, iş açılmaz. Kuyruk açılınca `scheduler` pg-boss'unkiyle değişir.
 */
export interface FileScanRuntime {
  scanner: FileScanner | null
  scheduler: FileScanScheduler | null
}

export interface ScanDeps {
  db: Database
  storage: StorageDriver
  scanner: FileScanner
  log: FastifyBaseLogger
  signal?: AbortSignal
}

export type ScanOutcome =
  | { outcome: 'ready' }
  /** Ses temiz, dönüşüm sürüyor: `ready`'yi dönüşüm yazar (OG-988). */
  | { outcome: 'clean' }
  | { outcome: 'rejected'; code: 'malware_found' | 'scan_limit_exceeded' | 'scan_object_missing' }
  | {
      outcome: 'skipped'
      reason: 'missing' | 'not_scanned' | 'not_processing' | 'already_rejected'
    }

/**
 * Taraması `status` ile izlenen amaç: ses dönüşen amaçlar dışındaki her amaç. Ses de taranır
 * (OG-988) ama dönüşümle paralel yürüdüğünden durumu `scanPending`'dedir.
 */
export function needsScan(purpose: FilePurpose): boolean {
  return !needsTranscode(purpose)
}

/**
 * Taranacak nesnenin anahtarı: her zaman yüklenen özgün nesne. Seste dönüşüm önce bittiyse özgün
 * nesne `superseded_storage_key`'dedir (tarama bitene kadar silinmez), yoksa `storage_key`'dir.
 */
export function scannedStorageKey(
  row: Pick<StoredFile, 'purpose' | 'storageKey' | 'supersededStorageKey'>,
): string {
  return needsTranscode(row.purpose) ? (row.supersededStorageKey ?? row.storageKey) : row.storageKey
}

async function check(
  deps: ScanDeps,
  data: FileScanJobData,
  now: Date,
  outcome: 'ready' | 'rejected',
  audio = false,
): Promise<StoredFile | null> {
  try {
    // Sesin temiz sonucu dönüşümle yarışır; `ready`'yi kimin yazdığını kilit altındaki satır
    // belirler ve dönen satır onu taşır (OG-988).
    if (outcome === 'ready' && audio)
      return await recordAudioScanClean(deps.db, deps.storage, { ...data, now, log: deps.log })
    return await recordFileCheck(deps.db, deps.storage, { ...data, outcome, now, log: deps.log })
  } catch (error) {
    // Bu arada denetlenmiş ya da silinmiş (bağlanmamış dosya temizliği) dosyaya dokunulmaz.
    if (error instanceof AppError && error.code === 'file_already_checked') return null
    throw error
  }
}

/**
 * Tek tarama denemesi. Sonuç dosyaya yazılır ve döner; geçici hata (tarayıcı, depo, iptal)
 * fırlatılır ve dosya `processing` kalır.
 */
export async function scanStoredFile(
  deps: ScanDeps,
  data: FileScanJobData,
  now: Date,
): Promise<ScanOutcome> {
  const row = await findFile(deps.db, data.institutionId, data.fileId)
  if (!row) return { outcome: 'skipped', reason: 'missing' }
  const audio = !needsScan(row.purpose)
  // Tarayıcı kapalıyken yüklenen ses (ya da OG-988'den önceki satır) taranmaz.
  if (audio && !row.scanPending && row.status === 'processing')
    return { outcome: 'skipped', reason: 'not_scanned' }
  if (row.status === 'rejected') {
    // Önceki denemede ret yazıldı ama nesne silinemedi: yalnız silme yeniden çalışır (idempotent).
    await recordFileCheck(deps.db, deps.storage, {
      ...data,
      outcome: 'rejected',
      now,
      log: deps.log,
    })
    return { outcome: 'skipped', reason: 'already_rejected' }
  }
  if (row.status !== 'processing') return { outcome: 'skipped', reason: 'not_processing' }
  deps.signal?.throwIfAborted()
  const opened = await deps.storage.open(scannedStorageKey(row))
  if (opened === null) {
    if ((await check(deps, data, now, 'rejected')) === null)
      return { outcome: 'skipped', reason: 'not_processing' }
    deps.log.warn({ event: 'file.scan_rejected', ...data, code: 'scan_object_missing' })
    return { outcome: 'rejected', code: 'scan_object_missing' }
  }
  let verdict
  try {
    verdict = await deps.scanner.scan(opened.stream, deps.signal ? { signal: deps.signal } : {})
  } catch (error) {
    if (!(error instanceof ScanLimitExceededError)) throw error
    if ((await check(deps, data, now, 'rejected')) === null)
      return { outcome: 'skipped', reason: 'not_processing' }
    // Yapılandırma hatası da olabilir (`StreamMaxLength` < amaç sınırı): `error` düzeyinde görünür.
    deps.log.error({ event: 'file.scan_rejected', ...data, code: 'scan_limit_exceeded' })
    return { outcome: 'rejected', code: 'scan_limit_exceeded' }
  } finally {
    opened.stream.destroy()
  }
  if (verdict.infected) {
    if ((await check(deps, data, now, 'rejected')) === null)
      return { outcome: 'skipped', reason: 'not_processing' }
    // İmza adı (ör. `Eicar-Test-Signature`, `Heuristics.Encrypted.PDF`) kişisel veri taşımaz.
    deps.log.warn({
      event: 'file.scan_rejected',
      ...data,
      code: 'malware_found',
      signature: verdict.signature,
    })
    return { outcome: 'rejected', code: 'malware_found' }
  }
  const checked = await check(deps, data, now, 'ready', audio)
  if (checked === null) return { outcome: 'skipped', reason: 'not_processing' }
  const ready = checked.status === 'ready'
  deps.log.info({ event: 'file.scanned', ...data, ...(audio ? { awaitingTranscode: !ready } : {}) })
  return ready ? { outcome: 'ready' } : { outcome: 'clean' }
}
