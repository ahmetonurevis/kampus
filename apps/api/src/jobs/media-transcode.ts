import type { FastifyBaseLogger } from 'fastify'
import { sql, type SQL } from 'drizzle-orm'
import type { Db, PgBoss, QueueOptions, SendOptions } from 'pg-boss'
import pg from 'pg'
import { z } from 'zod'

import type { Database } from '../db/client.ts'
import { listStaleProcessingFiles } from '../db/files.ts'
import { listInstitutionIds } from '../db/institutions.ts'
import type { StorageDriver } from '../storage/storage.ts'
import { AUDIO_TRANSCODE_PROFILES, type TranscodedPurpose } from '../services/audio-transcoder.ts'
import { purgeSupersededObjects } from '../services/files.ts'
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
 *   sonra süreç içinde, arka planda (yanıt beklemez) tek denemeyle çalışır ve her hata dosyayı
 *   reddeder (`InlineTranscodeScheduler`); yarıda kalanlar (süreç çöktü ya da kapandı) açılıştan
 *   sonra arka planda, tekil kilit altında aynı yoldan işlenir (`recoverStaleTranscodes`).
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

/**
 * Kuyruksuz tek deneme: hata fırlatmaz, her hata dosyayı reddeder; yalnız kimlik ve kod loglanır.
 * Kapanışta iptal edilen deneme (`signal`) dosyayı reddetmez: dosya `processing` kalır ve sonraki
 * açılışın kurtarmasına girer.
 */
export async function runInlineTranscode(
  deps: InlineTranscodeDeps & { signal?: AbortSignal },
  data: TranscodeJobData,
): Promise<TranscodeOutcome | null> {
  try {
    const result = await transcodeAudioFile(deps, data, deps.clock(), { finalAttempt: true })
    deps.log.info({ event: 'media.transcode_inline', ...data, ...transcodeSummary(result) })
    return result
  } catch (error) {
    if (deps.signal?.aborted === true)
      deps.log.warn({ event: 'media.transcode_interrupted', ...data })
    else deps.log.error({ event: 'media.transcode_failed', ...data, ...jobErrorInfo(error) })
    return null
  }
}

/**
 * Kuyruk kapalıyken dönüşüm (ADR 0003 karar 10): iş eklenmez; yükleme yanıtı dönüşümü beklemez,
 * dönüşüm transaction'dan sonra süreç içinde tek denemeyle ve arka planda çalışır (hata
 * fırlatmaz, loglanır). Dönüşümler sırayla, birer birer çalışır (ffmpeg işlemciyi yoğun kullanır;
 * kuyruktaki `localConcurrency: 1` ile aynı). İstemci durumu `GET /files/{id}` ile izler.
 *
 * `afterCommit`'in döndürdüğü promise o dosyanın dönüşümü bitince çözülür; `idle()` başlatılmış
 * bütün işler (açılış kurtarması dahil) bitene kadar bekler (test ve kapanış için deterministik
 * bekleme). `close()` (uygulama `onClose`) yeni işi almaz, sürenleri iptal eder ve bitmelerini
 * bekler; yarım kalan dosya `processing` kalır.
 */
export class InlineTranscodeScheduler implements MediaTranscodeScheduler {
  readonly #deps: InlineTranscodeDeps
  readonly #controller = new AbortController()
  readonly #pending = new Set<Promise<unknown>>()
  #tail: Promise<unknown> = Promise.resolve()

  constructor(deps: InlineTranscodeDeps) {
    this.#deps = deps
  }

  async enqueue(): Promise<void> {}

  afterCommit(data: TranscodeJobData): Promise<void> {
    if (this.#controller.signal.aborted) return Promise.resolve()
    const signal = this.#controller.signal
    const run = this.#tail.then(async () => {
      await runInlineTranscode({ ...this.#deps, signal }, data)
    })
    this.#tail = run.catch(() => undefined)
    return this.background(() => run)
  }

  /** Arka plan işini izler: `idle()` ve `close()` onu da bekler. İşin hatası loglanır, fırlamaz. */
  background<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    const tracked = work(this.#controller.signal).catch((error: unknown) => {
      this.#deps.log.error({ event: 'media.background_failed', ...jobErrorInfo(error) })
      return undefined
    })
    this.#pending.add(tracked)
    void tracked.finally(() => this.#pending.delete(tracked))
    return tracked
  }

  /** Başlatılmış bütün işler (bu arada başlayanlar dahil) bitince çözülür. */
  async idle(): Promise<void> {
    while (this.#pending.size > 0) await Promise.allSettled([...this.#pending])
  }

  async close(): Promise<void> {
    this.#controller.abort()
    await this.idle()
  }
}

export function inlineTranscodeScheduler(deps: InlineTranscodeDeps): InlineTranscodeScheduler {
  return new InlineTranscodeScheduler(deps)
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

/**
 * Oturum düzeyi tekil kilit: kilit alınırsa iş çalışır ve sonucu döner, alınamazsa iş çalışmaz.
 * Kilit iş bitince (hata dahil) bırakılır; süreç çökerse bağlantıyla birlikte düşer.
 */
export type SessionLock = <T>(
  work: () => Promise<T>,
) => Promise<{ acquired: true; value: T } | { acquired: false }>

/** Kuyruksuz açılış kurtarmasının kilidi (`pg_try_advisory_lock` iki tamsayılı biçim). */
export const RECOVERY_LOCK_NAMESPACE = 0x4b4d504d
export const RECOVERY_LOCK_NAME = 'media.transcode-recovery'

/**
 * PostgreSQL oturum kilidi: kendi bağlantısını açar (havuzdaki bağlantılar sorgudan sorguya
 * değiştiğinden oturum kilidi havuzla tutulamaz), `pg_try_advisory_lock` alınamazsa hemen döner.
 * Böylece birden çok API süreci aynı anda açılsa da kurtarmayı yalnız biri yapar.
 */
export function postgresSessionLock(
  connectionString: string,
  name: string = RECOVERY_LOCK_NAME,
): SessionLock {
  return async (work) => {
    const client = new pg.Client({ connectionString, application_name: 'kampus-recovery' })
    // Bağlantı kopması kilidi düşürür; olay yakalanmazsa süreç çöker.
    client.on('error', () => undefined)
    await client.connect()
    try {
      const { rows } = await client.query<{ locked: boolean }>(
        'select pg_try_advisory_lock($1::int, hashtext($2)) as locked',
        [RECOVERY_LOCK_NAMESPACE, name],
      )
      if (rows[0]?.locked !== true) return { acquired: false }
      try {
        return { acquired: true, value: await work() }
      } finally {
        await client.query('select pg_advisory_unlock($1::int, hashtext($2))', [
          RECOVERY_LOCK_NAMESPACE,
          name,
        ])
      }
    } finally {
      await client.end()
    }
  }
}

/**
 * Kuyruk kapalıyken açılış kurtarması (`bootJobs` arka planda başlatır; `listen`'i geciktirmez).
 * Tekil kilit altında: önce silinemeyip izde kalan özgün nesneler silinir (kuyruksuzken saatlik
 * `files.purge-unattached` çalışmaz), sonra yarıda kalmış dönüşümler süreç içi sıraya girer ve
 * bitmeleri beklenir (kilit o süre boyunca tutulur: başka süreç aynı dosyaları dönüştürmez).
 * Kilit alınamazsa (başka süreç kurtarıyor) atlanır ve `null` döner; yoksa işlenen dönüşüm sayısı.
 */
export async function recoverStaleTranscodes(input: {
  db: Database
  storage: StorageDriver
  log: FastifyBaseLogger
  clock: () => Date
  scheduler: InlineTranscodeScheduler
  lock: SessionLock
}): Promise<number | null> {
  const outcome = await input.lock(async () => {
    for (const institutionId of await listInstitutionIds(input.db))
      await purgeSupersededObjects({ ...input, institutionId })
    const stale = await staleTranscodes(input.db, input.clock())
    await Promise.all(stale.map((data) => input.scheduler.afterCommit(data)))
    return stale.length
  })
  if (!outcome.acquired) {
    input.log.info({ event: 'media.transcode_recovery_skipped' })
    return null
  }
  input.log.info({ event: 'media.transcode_recovered', count: outcome.value })
  return outcome.value
}
