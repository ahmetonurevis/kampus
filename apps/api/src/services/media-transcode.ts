import { randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'

import type { FastifyBaseLogger } from 'fastify'

import { assertFileAllowed } from '@kampus/school-core/content/taxonomy.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'

import type { Database } from '../db/client.ts'
import { completeFileTranscode, findFile, type StoredFile } from '../db/files.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { AppError, ConflictError } from '../errors.ts'
import { meterUpload } from '../storage/meter.ts'
import { storageKeyFor, type StorageDriver } from '../storage/storage.ts'
import {
  AUDIO_TRANSCODE_PROFILES,
  MediaContentError,
  needsTranscode,
  TRANSCODED_CONTENT_TYPE,
  type AudioTranscoder,
  type MediaContentCode,
} from './audio-transcoder.ts'
import { recordFileCheck, releaseSupersededObject } from './files.ts'

/**
 * Yüklenen sesin dönüşümü (ADR 0003 karar 10; OG-262; DOM-BEC-054). `speaking_recording` ve
 * `listening_audio` yüklemesi `processing` başlar; `media.transcode` işi nesneyi geçici klasöre
 * indirir, tek biçime çevirir, süreyi ölçer, sessiz ya da boş kaydı reddeder, dönüşmüş nesneyi
 * yazar ve satırı tek transaction'da `ready` yapar (`file.ready` denetimi; özgün anahtar aynı
 * güncellemede `superseded_storage_key`'e geçer); sonra özgün nesneyi siler (en az veri). Silme
 * başarısızsa iz kalır ve nesneyi `files.purge-unattached` ya da imha siler. Teslim zamanı yükleme
 * zamanıdır; dönüşüm satırın `created_at`'ine dokunmaz.
 *
 * İdempotenttir: `processing` olmayan dosyada dönüşüm yapılmaz. `ready` dosyada yalnız özgün
 * nesnenin silinmesi yeniden denenir (silme idempotenttir); eşzamanlı iki teslimden kaybedenin
 * yazdığı nesne silinir (her deneme kendi anahtarına yazar). Log yalnız kimlik ve kod taşır.
 */

/** İş yükü: yalnız kimlikler (kişisel veri yok). */
export interface TranscodeJobData {
  institutionId: string
  fileId: string
}

/**
 * Dönüşümü kuyruğa koyan taraf. Kuyruk açıkken pg-boss iş satırı yüklemeyi yazan transaction'da
 * eklenir (yükleme geri alınırsa iş de yoktur); kuyruk kapalıyken dönüşüm transaction'dan sonra
 * süreç içinde, arka planda ve tek denemeyle çalışır (`jobs/media-transcode.ts`).
 */
export interface MediaTranscodeScheduler {
  /** Yüklemeyi yazan transaction içinde çağrılır. */
  enqueue(tx: Database, data: TranscodeJobData): Promise<void>
  /**
   * Transaction yazıldıktan sonra çağrılır; hata fırlatmaz. Yükleme yanıtı dönen promise'i
   * beklemez (dönüşüm arka planda sürer); promise yalnız testte ve kurtarmada beklenir.
   */
  afterCommit(data: TranscodeJobData): Promise<void>
}

/** Uygulamanın medya bağımlılıkları; kuyruk açılınca `scheduler` pg-boss'unkiyle değişir. */
export interface MediaRuntime {
  transcoder: AudioTranscoder
  scheduler: MediaTranscodeScheduler
}

export interface TranscodeDeps {
  db: Database
  storage: StorageDriver
  transcoder: AudioTranscoder
  log: FastifyBaseLogger
  signal?: AbortSignal
}

export type TranscodeOutcome =
  | { outcome: 'ready'; durationMs: number }
  | { outcome: 'rejected'; code: MediaContentCode | 'media_retries_exhausted' }
  | { outcome: 'skipped'; reason: 'missing' | 'not_audio' | 'not_processing' | 'already_ready' }

/** Dönüşmüş nesnenin anahtarı: her deneme kendi anahtarına yazar (eşzamanlı teslimler çakışmaz). */
function transcodedStorageKey(row: StoredFile): string {
  return storageKeyFor({
    institutionId: row.institutionId,
    purpose: row.purpose,
    fileId: `${row.id}-m4a-${randomBytes(4).toString('hex')}`,
    now: row.createdAt,
  })
}

function limitCode(error: unknown): MediaContentCode {
  if (error instanceof DomainError && error.code === 'file_too_large') return 'media_too_large'
  if (error instanceof DomainError && error.code === 'file_too_long') return 'media_too_long'
  return 'media_undecodable'
}

/** Dosyayı reddeder (nesne silinir, `file.reject` denetimi); bu arada denetlenmişse dokunulmaz. */
async function reject(
  deps: TranscodeDeps,
  data: TranscodeJobData,
  now: Date,
  code: MediaContentCode | 'media_retries_exhausted',
): Promise<TranscodeOutcome> {
  try {
    await recordFileCheck(deps.db, deps.storage, {
      ...data,
      outcome: 'rejected',
      now,
      log: deps.log,
    })
  } catch (error) {
    if (error instanceof AppError && error.code === 'file_already_checked')
      return { outcome: 'skipped', reason: 'not_processing' }
    throw error
  }
  deps.log.info({ event: 'media.transcode_rejected', ...data, code })
  return { outcome: 'rejected', code }
}

async function discard(deps: TranscodeDeps, data: TranscodeJobData, key: string) {
  try {
    await deps.storage.delete(key)
  } catch (error) {
    deps.log.error({ event: 'media.discard_object_failed', ...data, err: error })
  }
}

/**
 * Tek dönüşüm denemesi. İçerik hatası (`MediaContentError`, sessiz/boş kayıt, sınır aşımı) dosyayı
 * reddeder ve sonuç döner; geçici hata (depo, araç, süre aşımı, iptal) fırlatılır ve iş yeniden
 * denenir. `finalAttempt` verilirse (son deneme ya da kuyruksuz tek deneme) satır yazılmadan
 * önceki geçici hata da dosyayı reddeder: dosya sonsuza dek `processing` kalmaz. İptal
 * (`signal`) bunun dışındadır: dosya `processing` kalır, açılış kurtarması yeniden dener.
 */
export async function transcodeAudioFile(
  deps: TranscodeDeps,
  data: TranscodeJobData,
  now: Date,
  options: { finalAttempt?: boolean } = {},
): Promise<TranscodeOutcome> {
  const { db, storage, log } = deps
  const row = await findFile(db, data.institutionId, data.fileId)
  if (!row) return { outcome: 'skipped', reason: 'missing' }
  if (!needsTranscode(row.purpose)) return { outcome: 'skipped', reason: 'not_audio' }
  if (row.status === 'ready') {
    // Önceki deneme satırı yazdı ama özgün nesneyi silemediyse burada yeniden denenir.
    await releaseSupersededObject(deps, row)
    return { outcome: 'skipped', reason: 'already_ready' }
  }
  if (row.status !== 'processing') return { outcome: 'skipped', reason: 'not_processing' }

  const workDir = await mkdtemp(join(tmpdir(), 'kampus-media-'))
  let outputKey: string | null = null
  let committed = false
  try {
    deps.signal?.throwIfAborted()
    const opened = await storage.open(row.storageKey)
    if (opened === null) return await reject(deps, data, now, 'media_object_missing')
    const inputPath = join(workDir, 'input')
    const outputPath = join(workDir, 'output.m4a')
    await pipeline(
      opened.stream,
      createWriteStream(inputPath, { mode: 0o600 }),
      ...(deps.signal ? [{ signal: deps.signal }] : []),
    )
    let result
    try {
      result = await deps.transcoder.transcode({
        inputPath,
        outputPath,
        contentType: row.contentType,
        bitrateKbps: AUDIO_TRANSCODE_PROFILES[row.purpose].bitrateKbps,
        ...(deps.signal ? { signal: deps.signal } : {}),
      })
    } catch (error) {
      if (error instanceof MediaContentError) return await reject(deps, data, now, error.code)
      throw error
    }
    if (result.durationMs <= 0) return await reject(deps, data, now, 'media_empty')
    if (result.silent) return await reject(deps, data, now, 'media_silent')
    const { size } = await stat(outputPath)
    try {
      // Çıktı amaç sınırlarıyla yeniden denetlenir (ADR 0003 karar 3, 10).
      assertFileAllowed(row.purpose, {
        contentType: TRANSCODED_CONTENT_TYPE,
        byteSize: size,
        durationSeconds: result.durationMs / 1000,
      })
    } catch (error) {
      if (error instanceof DomainError) return await reject(deps, data, now, limitCode(error))
      throw error
    }

    const key = transcodedStorageKey(row)
    outputKey = key
    const metered = meterUpload(createReadStream(outputPath), size)
    await storage.put(key, metered.stream, { contentType: TRANSCODED_CONTENT_TYPE })
    const { byteSize, sha256 } = metered.result()
    deps.signal?.throwIfAborted()
    const updated = await db.transaction(async (tx) => {
      const current = await findFile(tx, data.institutionId, data.fileId, { lock: true })
      // Bu arada başka bir teslim bitirdiyse, dosya reddedildiyse ya da silindiyse dokunulmaz.
      if (!current || current.status !== 'processing' || current.storageKey !== row.storageKey)
        return null
      const next = await completeFileTranscode(
        tx,
        data.institutionId,
        current,
        {
          storageKey: key,
          contentType: TRANSCODED_CONTENT_TYPE,
          byteSize,
          sha256,
          durationMs: result.durationMs,
        },
        now,
      )
      if (!next) throw new ConflictError()
      await tx.insert(auditLog).values({
        institutionId: data.institutionId,
        action: 'file.ready',
        entityType: 'file',
        entityId: data.fileId,
        changes: {
          fields: ['status', 'storageKey', 'contentType', 'byteSize', 'sha256', 'durationMs'],
        },
        createdAt: now,
      })
      return next
    })
    if (!updated) return { outcome: 'skipped', reason: 'not_processing' }
    committed = true
    // Özgün nesne dönüşüm doğrulanıp yazıldıktan sonra silinir. Anahtarı `ready` ile aynı
    // güncellemede `superseded_storage_key`'e geçtiği için hiçbir an izsiz değildir; silme
    // başarısızsa iz kalır, nesneyi sonraki temizlik ya da imha siler (DOM-BEC-052).
    await releaseSupersededObject(deps, updated)
    log.info({ event: 'media.transcoded', ...data, durationMs: result.durationMs, byteSize })
    return { outcome: 'ready', durationMs: result.durationMs }
  } catch (error) {
    // İptal (kapanış, pg-boss süre aşımı) dosyayı reddetmez: dosya `processing` kalır ve açılışta
    // yeniden ele alınır.
    if (options.finalAttempt === true && !committed && deps.signal?.aborted !== true) {
      const code: unknown = typeof error === 'object' && error ? Reflect.get(error, 'code') : null
      log.warn({
        event: 'media.transcode_failed',
        ...data,
        code: typeof code === 'string' ? code : null,
      })
      if (outputKey !== null) await discard(deps, data, outputKey)
      outputKey = null
      return await reject(deps, data, now, 'media_retries_exhausted')
    }
    throw error
  } finally {
    if (outputKey !== null && !committed) await discard(deps, data, outputKey)
    await rm(workDir, { recursive: true, force: true })
  }
}
