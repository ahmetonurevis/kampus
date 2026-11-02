import type { FastifyBaseLogger, FastifyInstance } from 'fastify'

import type { Database } from '../db/client.ts'
import { purgeExpiredIdempotencyKeys } from '../db/idempotency.ts'
import type { StorageDriver } from '../storage/storage.ts'
import { jobErrorInfo } from './job-error.ts'
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
}

/**
 * Sunucu açılışında iş kuyruğunu açar. Kuyruk kapalıysa ya da açılamazsa API yine açılır: hata
 * yalnız `code` ve `message` ile `error` düzeyinde loglanır (hata nesnesi loglanmaz) ve
 * `Idempotency-Key` saklama sınırı (24 saat) açılışta eski yoldan uygulanır. Dönen değer kuyruk
 * açıksa kuyruktur, değilse `null`.
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
  return null
}
