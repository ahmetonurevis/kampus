import type { FastifyBaseLogger, FastifyInstance } from 'fastify'

import type { Database } from '../db/client.ts'
import { purgeExpiredIdempotencyKeys } from '../db/idempotency.ts'
import type { StorageDriver } from '../storage/storage.ts'
import { InlineScanScheduler, recoverStaleScans, SCAN_RECOVERY_LOCK_NAME } from './file-scan.ts'
import { jobErrorInfo } from './job-error.ts'
import {
  InlineTranscodeScheduler,
  postgresSessionLock,
  recoverStaleTranscodes,
  type SessionLock,
} from './media-transcode.ts'
import { startJobs, type JobQueue, type StartJobsOptions } from './queue.ts'

export interface BootJobsInput {
  app: FastifyInstance
  db: Database
  log: FastifyBaseLogger
  enabled: boolean
  connectionString: string
  storage: StorageDriver
  /** Testte başlatma hatası taklit etmek için; varsayılan `startJobs`. */
  start?: (app: FastifyInstance, options: StartJobsOptions) => Promise<JobQueue>
  /** Kuyruksuz açılış kurtarmasının tekil kilidi; varsayılan `connectionString` üstünde oturum kilidi. */
  recoveryLock?: SessionLock
  /** Kuyruksuz tarama kurtarmasının tekil kilidi; varsayılan ayrı adlı oturum kilidi. */
  scanRecoveryLock?: SessionLock
}

/**
 * Sunucu açılışında iş kuyruğunu açar. Kuyruk kapalıysa ya da açılamazsa API yine açılır: hata
 * yalnız `code` ve `message` ile `error` düzeyinde loglanır (hata nesnesi loglanmaz) ve
 * `Idempotency-Key` saklama sınırı (24 saat) açılışta eski yoldan uygulanır. Dönen değer kuyruk
 * açıksa kuyruktur, değilse `null`.
 *
 * Kuyruksuz açılışta ses dönüşümü yüklemeden sonra süreç içinde çalışır (`app.media.scheduler`
 * olduğu gibi kalır); yarıda kalmış (`processing`, 15 dakikadan eski) dönüşümler açılışı
 * beklemeden arka planda ve `pg_try_advisory_lock` altında tek denemeyle işlenir (kilit başka
 * süreçteyse atlanır), başarısız olan dosya reddedilir (ADR 0003 karar 10). `listen` gecikmez;
 * bitişi `InlineTranscodeScheduler.idle()` ile beklenir.
 *
 * Tarayıcı açıkken (`FILE_SCANNER=clamav`) dosya taraması da aynı biçimde süreç içinde çalışır;
 * yarıda kalmış taramalar (`processing`, ses dışı, 15 dakikadan eski) ayrı bir kilit altında
 * yeniden denenir. Tarama hatası dosyayı reddetmez ve `ready` yapmaz (ADR 0003 karar 8).
 */
export async function bootJobs(input: BootJobsInput): Promise<JobQueue | null> {
  const { app, db, log } = input
  if (input.enabled) {
    try {
      return await (input.start ?? startJobs)(app, {
        connectionString: input.connectionString,
        storage: input.storage,
      })
    } catch (error) {
      log.error({ event: 'jobs.start_failed', ...jobErrorInfo(error) })
    }
  }
  // Kuyruk kapalıyken ya da açılamadığında günlük iş çalışmaz; açılışta bir kez temizlenir.
  const purged = await purgeExpiredIdempotencyKeys(db, new Date())
  log.info({ event: 'idempotency.purged', purged })
  const scheduler = app.media.scheduler
  if (scheduler instanceof InlineTranscodeScheduler) {
    const lock = input.recoveryLock ?? postgresSessionLock(input.connectionString)
    void scheduler.background(async () => {
      try {
        await recoverStaleTranscodes({
          db,
          storage: input.storage,
          log,
          clock: app.clock,
          scheduler,
          lock,
        })
      } catch (error) {
        log.error({ event: 'media.transcode_recovery_failed', ...jobErrorInfo(error) })
      }
    })
  }
  const scanScheduler = app.fileScan.scheduler
  if (scanScheduler instanceof InlineScanScheduler) {
    const lock =
      input.scanRecoveryLock ?? postgresSessionLock(input.connectionString, SCAN_RECOVERY_LOCK_NAME)
    void scanScheduler.background(async () => {
      try {
        await recoverStaleScans({ db, log, clock: app.clock, scheduler: scanScheduler, lock })
      } catch (error) {
        log.error({ event: 'file.scan_recovery_failed', ...jobErrorInfo(error) })
      }
    })
  }
  return null
}
