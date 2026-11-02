import type { FastifyBaseLogger } from 'fastify'
import type { PgBoss, Queue, SendOptions } from 'pg-boss'
import { z } from 'zod'

import { FILE_PURPOSES, type FilePurpose } from '@kampus/school-core/content/taxonomy.ts'

import type { Database } from '../db/client.ts'
import { listStaleProcessingFiles } from '../db/files.ts'
import { listInstitutionIds } from '../db/institutions.ts'
import {
  needsScan,
  scanStoredFile,
  type FileScanJobData,
  type FileScanScheduler,
  type ScanDeps,
  type ScanOutcome,
} from '../services/file-scan.ts'
import { jobErrorInfo } from './job-error.ts'
import { RECOVERY_BATCH_SIZE, transactionConnection, type SessionLock } from './media-transcode.ts'

/**
 * Olaya bağlı dosya tarama işi `file.scan` (ADR 0003 karar 8; OG-092, IST-027). Ses dönüşümüyle
 * (`media.transcode`) aynı desendir; işleyici `services/file-scan.ts`'tedir.
 *
 * - Kuyruk açıkken iş satırı yüklemeyi yazan transaction'da eklenir (pg-boss `send({ db })`).
 * - Tarayıcıya ulaşılamaz ya da süre aşılırsa iş geri çekilmeli yeniden denenir (6 kez, yaklaşık
 *   30 dk). Son deneme de düşerse dosya `processing` kalır (taramasız `ready` olmaz), iş `failed`
 *   olur; dosya açılışta yeniden kuyruğa girer (`requeueStaleScans`) ya da bağlanamadığı için en
 *   geç 24 saatte `files.purge-unattached` ile silinir.
 * - Kuyruk kapalıyken (`JOBS_ENABLED=false` ya da açılamadı) tarama yüklemenin transaction'ından
 *   sonra süreç içinde, arka planda tek denemeyle çalışır (`InlineScanScheduler`); geçici hatada
 *   dosya `processing` kalır ve açılış kurtarması (`recoverStaleScans`) yeniden dener.
 */

export const FILE_SCAN_JOB = 'file.scan'

/** Yük: kurum ve dosya kimliği (katı şema; kişisel veri yok). */
export const scanJobDataSchema = z.strictObject({
  institutionId: z.string().min(1).max(200),
  fileId: z.uuid(),
})

/**
 * Kuyruk ayarı. Politika `exclusive` (`MEDIA_QUEUE_OPTIONS` gerekçesi): dosya başına tek bekleyen,
 * yeniden denenecek ya da çalışan iş. Yeniden deneme `clamd` imza güncellemesi ya da yeniden
 * başlatma gibi kısa kesintileri aşacak kadar uzundur (30 sn'den 15 dk'ya geri çekilme).
 */
export const SCAN_QUEUE_OPTIONS = {
  policy: 'exclusive',
  retryLimit: 6,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 900,
  expireInSeconds: 600,
} as const satisfies Omit<Queue, 'name'>

/** İşçi: tarama `clamd`'de çalışır, API süreci yalnız akışı taşır. */
export const SCAN_WORK_OPTIONS = { batchSize: 1, localConcurrency: 2 } as const

/** Bu süredir `processing` kalan ses dışı dosyanın işi kaybolmuş sayılır (açılışta yeniden). */
export const STALE_SCAN_MS = 15 * 60 * 1000

/** Taranan amaçlar: ses dışındakiler (bayat satır sorgusu ses dönüşümünden ayrılır). */
export const SCANNED_PURPOSES = (Object.keys(FILE_PURPOSES) as FilePurpose[]).filter(needsScan)

/** İşin sonucu (`job.completed` logu ve pg-boss çıktısı): yalnız kodlar. */
export function scanSummary(result: ScanOutcome): Record<string, string> {
  switch (result.outcome) {
    case 'ready':
      return { outcome: result.outcome }
    case 'rejected':
      return { outcome: result.outcome, code: result.code }
    case 'skipped':
      return { outcome: result.outcome, reason: result.reason }
    default:
      return result satisfies never
  }
}

/** Kuyruk açıkken: iş yüklemenin transaction'ında, dosya kimliği tekil anahtarıyla eklenir. */
export function queuedScanScheduler(boss: Pick<PgBoss, 'send'>): FileScanScheduler {
  return {
    async enqueue(tx, data) {
      const options: SendOptions = { db: transactionConnection(tx), singletonKey: data.fileId }
      await boss.send(FILE_SCAN_JOB, data, options)
    },
    async afterCommit() {},
  }
}

export interface InlineScanDeps extends Omit<ScanDeps, 'signal'> {
  clock: () => Date
}

/**
 * Kuyruksuz tek deneme: hata fırlatmaz. Geçici hata dosyayı reddetmez ve `ready` yapmaz; dosya
 * `processing` kalır, yalnız kimlik ve hata kodu loglanır.
 */
export async function runInlineScan(
  deps: InlineScanDeps & { signal?: AbortSignal },
  data: FileScanJobData,
): Promise<ScanOutcome | null> {
  try {
    const result = await scanStoredFile(deps, data, deps.clock())
    deps.log.info({ event: 'file.scan_inline', ...data, ...scanSummary(result) })
    return result
  } catch (error) {
    if (deps.signal?.aborted === true) deps.log.warn({ event: 'file.scan_interrupted', ...data })
    else deps.log.warn({ event: 'file.scan_deferred', ...data, ...jobErrorInfo(error) })
    return null
  }
}

/**
 * Kuyruk kapalıyken tarama: iş eklenmez; yükleme yanıtı taramayı beklemez, tarama
 * transaction'dan sonra süreç içinde sırayla ve arka planda çalışır. `afterCommit`'in promise'i o
 * dosyanın taraması bitince çözülür; `idle()` bütün işler bitene kadar bekler (test ve kapanış).
 * `close()` (uygulama `onClose`) yeni işi almaz, sürenleri iptal eder ve bitmelerini bekler.
 */
export class InlineScanScheduler implements FileScanScheduler {
  readonly #deps: InlineScanDeps
  readonly #controller = new AbortController()
  readonly #pending = new Set<Promise<unknown>>()
  #tail: Promise<unknown> = Promise.resolve()

  constructor(deps: InlineScanDeps) {
    this.#deps = deps
  }

  async enqueue(): Promise<void> {}

  afterCommit(data: FileScanJobData): Promise<void> {
    if (this.#controller.signal.aborted) return Promise.resolve()
    const signal = this.#controller.signal
    const run = this.#tail.then(async () => {
      await runInlineScan({ ...this.#deps, signal }, data)
    })
    this.#tail = run.catch(() => undefined)
    return this.background(() => run)
  }

  /** Arka plan işini izler: `idle()` ve `close()` onu da bekler. İşin hatası loglanır, fırlamaz. */
  background<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    const tracked = work(this.#controller.signal).catch((error: unknown) => {
      this.#deps.log.error({ event: 'file.scan_background_failed', ...jobErrorInfo(error) })
      return undefined
    })
    this.#pending.add(tracked)
    void tracked.finally(() => this.#pending.delete(tracked))
    return tracked
  }

  async idle(): Promise<void> {
    while (this.#pending.size > 0) await Promise.allSettled([...this.#pending])
  }

  async close(): Promise<void> {
    this.#controller.abort()
    await this.idle()
  }
}

/** Kurumların uzun süredir `processing` kalan ses dışı dosyaları (işi kaybolmuş taramalar). */
async function staleScans(db: Database, now: Date): Promise<FileScanJobData[]> {
  const before = new Date(now.getTime() - STALE_SCAN_MS)
  const found: FileScanJobData[] = []
  for (const institutionId of await listInstitutionIds(db)) {
    const rows = await listStaleProcessingFiles(
      db,
      institutionId,
      SCANNED_PURPOSES,
      before,
      RECOVERY_BATCH_SIZE,
    )
    for (const row of rows) found.push({ institutionId, fileId: row.id })
  }
  return found
}

/**
 * Kuyruk açılışında: işi kaybolmuş ya da denemeleri bitmiş taramalar yeniden kuyruğa girer;
 * dosyanın bekleyen, yeniden denenecek ya da çalışan işi varsa yenisi açılmaz (`exclusive`).
 */
export async function requeueStaleScans(
  db: Database,
  boss: Pick<PgBoss, 'send'>,
  now: Date,
): Promise<number> {
  let queued = 0
  for (const data of await staleScans(db, now)) {
    if ((await boss.send(FILE_SCAN_JOB, data, { singletonKey: data.fileId })) !== null) queued += 1
  }
  return queued
}

/** Kuyruksuz açılış kurtarmasının kilit adı (ses dönüşümünün kilidinden ayrı). */
export const SCAN_RECOVERY_LOCK_NAME = 'file.scan-recovery'

/**
 * Kuyruk kapalıyken açılış kurtarması (`bootJobs` arka planda başlatır). Tekil kilit altında
 * yarıda kalmış taramalar süreç içi sıraya girer ve bitmeleri beklenir; kilit alınamazsa (başka
 * süreç kurtarıyor) atlanır ve `null` döner, yoksa ele alınan dosya sayısı.
 */
export async function recoverStaleScans(input: {
  db: Database
  log: FastifyBaseLogger
  clock: () => Date
  scheduler: InlineScanScheduler
  lock: SessionLock
}): Promise<number | null> {
  const outcome = await input.lock(async () => {
    const stale = await staleScans(input.db, input.clock())
    await Promise.all(stale.map((data) => input.scheduler.afterCommit(data)))
    return stale.length
  })
  if (!outcome.acquired) {
    input.log.info({ event: 'file.scan_recovery_skipped' })
    return null
  }
  input.log.info({ event: 'file.scan_recovered', count: outcome.value })
  return outcome.value
}
