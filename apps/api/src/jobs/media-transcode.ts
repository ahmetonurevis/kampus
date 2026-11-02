import type { FastifyBaseLogger } from 'fastify'
import { sql, type SQL } from 'drizzle-orm'
import type { Db, PgBoss, QueueOptions, SendOptions } from 'pg-boss'
import { z } from 'zod'

import type { Database } from '../db/client.ts'
import { listStaleProcessingFiles } from '../db/files.ts'
import { listInstitutionIds } from '../db/institutions.ts'
import type { StorageDriver } from '../storage/storage.ts'
import { AUDIO_TRANSCODE_PROFILES, type TranscodedPurpose } from '../services/audio-transcoder.ts'
import {
  transcodeAudioFile,
  type MediaTranscodeScheduler,
  type TranscodeDeps,
  type TranscodeJobData,
  type TranscodeOutcome,
} from '../services/media-transcode.ts'
import { jobErrorInfo } from './job-error.ts'

/**
 * Olaya bağlı ses dönüştürme işi `media.transcode` (ADR 0003 karar 10; OG-262). Zamanlanmış kurum
 * işlerinden (`InstitutionJob`) farklı olarak yüklemeyle kuyruğa girer ve yükü dosya kimliğini de
 * taşır. İşleyici `services/media-transcode.ts`'tedir.
 *
 * - Kuyruk açıkken iş satırı yüklemeyi yazan transaction'da eklenir (pg-boss `send({ db })`):
 *   yükleme geri alınırsa iş yoktur, yükleme yazılırsa iş kaybolmaz.
 * - Geçici hata pg-boss'un yeniden denemesine kalır (3 kez, geri çekilmeli); son denemedeki geçici
 *   hata dosyayı reddeder (`media_retries_exhausted`). Süre aşımında son deneme de düşerse satır
 *   `processing` kalır ve açılışta yeniden kuyruğa girer (`requeueStaleTranscodes`); bağlanamayan
 *   dosya en geç 24 saatte `files.purge-unattached` ile silinir.
 * - Kuyruk kapalıyken (`JOBS_ENABLED=false` ya da açılamadı) dönüşüm yüklemenin transaction'ından
 *   sonra süreç içinde tek denemeyle çalışır ve her hata dosyayı reddeder; yarıda kalanlar (süreç
 *   çöktü) açılışta aynı yoldan işlenir (`bootJobs`). `Idempotency-Key` temizliğinin açılış yolu
 *   ile aynı desendir.
 */

export const MEDIA_TRANSCODE_JOB = 'media.transcode'

/** Yük: kurum ve dosya kimliği (katı şema; kişisel veri yok). */
export const transcodeJobDataSchema = z.strictObject({
  institutionId: z.string().min(1).max(200),
  fileId: z.uuid(),
})

/** Kuyruk ayarı: dönüşüm kısa sürer; süre sınırı iki süreç sınırının (120 sn) üstündedir. */
export const MEDIA_QUEUE_OPTIONS = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 900,
  expireInSeconds: 600,
} as const satisfies QueueOptions

/** İşçi: ffmpeg işlemciyi yoğun kullanır, süreç başına tek dönüşüm. */
export const MEDIA_WORK_OPTIONS = { batchSize: 1, localConcurrency: 1 } as const

/** Bu süredir `processing` kalan dosyanın işi kaybolmuş sayılır (açılışta yeniden kuyruğa). */
export const STALE_TRANSCODE_MS = 15 * 60 * 1000

/** Açılışta kurum başına en çok bu kadar dosyaya bakılır. */
export const RECOVERY_BATCH_SIZE = 100

const TRANSCODED_PURPOSES = Object.keys(AUDIO_TRANSCODE_PROFILES) as TranscodedPurpose[]

/** İşin sonucu (`job.completed` logu ve pg-boss çıktısı): yalnız kodlar ve süre. */
export function transcodeSummary(result: TranscodeOutcome): Record<string, string | number> {
  switch (result.outcome) {
    case 'ready':
      return { outcome: result.outcome, durationMs: result.durationMs }
    case 'rejected':
      return { outcome: result.outcome, code: result.code }
    case 'skipped':
      return { outcome: result.outcome, reason: result.reason }
    default:
      return result satisfies never
  }
}

/**
 * Drizzle transaction'ını pg-boss'un bağlantı arayüzüne çevirir: pg-boss iş satırını yüklemeyle
 * aynı transaction'da yazar. pg-boss'un kendi ürettiği SQL metnindeki `$n` yer tutucuları Drizzle
 * parametrelerine çevrilir; metin kullanıcı girdisi taşımaz, değerler parametre olarak gider.
 */
export function transactionConnection(tx: Database): Db {
  return {
    async executeSql(text, values = []) {
      const parts = text.split(/\$(\d+)/)
      const chunks: SQL[] = parts.map((part, index) =>
        index % 2 === 0 ? sql.raw(part) : sql`${values[Number(part) - 1]}`,
      )
      const result: unknown = await tx.execute(sql.join(chunks))
      const rows: unknown = typeof result === 'object' && result ? Reflect.get(result, 'rows') : []
      return { rows: Array.isArray(rows) ? rows : [] }
    },
  }
}

/** Kuyruk açıkken: iş yüklemenin transaction'ında eklenir; aynı dosya için ikinci iş açılmaz. */
export function queuedTranscodeScheduler(boss: Pick<PgBoss, 'send'>): MediaTranscodeScheduler {
  return {
    async enqueue(tx, data) {
      const options: SendOptions = { db: transactionConnection(tx), singletonKey: data.fileId }
      await boss.send(MEDIA_TRANSCODE_JOB, data, options)
    },
    async afterCommit() {},
  }
}

export interface InlineTranscodeDeps extends Omit<TranscodeDeps, 'signal'> {
  clock: () => Date
}

/** Kuyruksuz tek deneme: hata fırlatmaz, her hata dosyayı reddeder; yalnız kimlik ve kod loglanır. */
export async function runInlineTranscode(
  deps: InlineTranscodeDeps,
  data: TranscodeJobData,
): Promise<TranscodeOutcome | null> {
  try {
    const result = await transcodeAudioFile(deps, data, deps.clock(), { finalAttempt: true })
    deps.log.info({ event: 'media.transcode_inline', ...data, ...transcodeSummary(result) })
    return result
  } catch (error) {
    deps.log.error({ event: 'media.transcode_failed', ...data, ...jobErrorInfo(error) })
    return null
  }
}

/** Kuyruk kapalıyken: iş eklenmez, dönüşüm yanıt dönmeden süreç içinde bir kez denenir. */
export function inlineTranscodeScheduler(deps: InlineTranscodeDeps): MediaTranscodeScheduler {
  return {
    async enqueue() {},
    async afterCommit(data) {
      await runInlineTranscode(deps, data)
    },
  }
}

/** Kurumların uzun süredir `processing` kalan ses dosyaları (işi kaybolmuş dönüşümler). */
async function staleTranscodes(
  db: Database,
  now: Date,
): Promise<{ institutionId: string; fileId: string }[]> {
  const before = new Date(now.getTime() - STALE_TRANSCODE_MS)
  const found: { institutionId: string; fileId: string }[] = []
  for (const institutionId of await listInstitutionIds(db)) {
    const rows = await listStaleProcessingFiles(
      db,
      institutionId,
      TRANSCODED_PURPOSES,
      before,
      RECOVERY_BATCH_SIZE,
    )
    for (const row of rows) found.push({ institutionId, fileId: row.id })
  }
  return found
}

/** Kuyruk açılışında: işi kaybolmuş dönüşümler yeniden kuyruğa girer. Sayı döner. */
export async function requeueStaleTranscodes(
  db: Database,
  boss: Pick<PgBoss, 'send'>,
  now: Date,
): Promise<number> {
  let queued = 0
  for (const data of await staleTranscodes(db, now)) {
    if ((await boss.send(MEDIA_TRANSCODE_JOB, data, { singletonKey: data.fileId })) !== null)
      queued += 1
  }
  return queued
}

/** Kuyruk kapalıyken açılışta: yarıda kalmış dönüşümler süreç içinde tek denemeyle işlenir. */
export async function recoverStaleTranscodes(input: {
  db: Database
  storage: StorageDriver
  transcoder: TranscodeDeps['transcoder']
  log: FastifyBaseLogger
  clock: () => Date
}): Promise<number> {
  const stale = await staleTranscodes(input.db, input.clock())
  for (const data of stale) await runInlineTranscode(input, data)
  return stale.length
}
