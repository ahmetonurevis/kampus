import type { FastifyInstance } from 'fastify'
import { PgBoss, type Job, type QueueOptions } from 'pg-boss'

import type { StorageDriver } from '../storage/storage.ts'
import { dispatchInstitutionJobs, dispatchQueueName, type JobSender } from './dispatch.ts'
import { INSTITUTION_JOBS } from './registry.ts'
import { institutionJobDataSchema, type AnyInstitutionJob, type JobDeps } from './types.ts'

/**
 * Arka plan iş kuyruğu (ADR 0002, ADR 0003; `pg-boss`). Yalnız sunucu süreci açar
 * (`server.ts`, `JOBS_ENABLED`); test, OpenAPI üretimi ve tohum açmaz.
 *
 * - Şema: pg-boss kendi `pgboss` şemasını açılışta kurar ve sürümüne göre yükseltir; drizzle-kit
 *   migration'larına girmez, uygulama koduna doğrudan sorgu yazılmaz (veritabani.md "pg-boss").
 * - Zamanlama Europe/Istanbul'dadır. pg-boss zamanlamayı veritabanında tutar ve her oluşumu
 *   tekil anahtarla bir kez kuyruğa koyar: birden çok API örneği çalışsa da iş bir kez tetiklenir.
 *   Kapalıyken kaçırılan oluşum açılışta bir kez gönderilir (`missed: 'once'`).
 * - Uygulama kapanınca (`onClose`) çalışan işler bitene kadar beklenir (en çok 10 sn), havuz
 *   kapanır.
 * - Log yalnız iş adı, kurum kimliği ve sayıları taşır; yük ve hata kişisel veri içermez.
 */

export const JOB_SCHEMA = 'pgboss'
export const JOB_TIME_ZONE = 'Europe/Istanbul'
const STOP_TIMEOUT_MS = 10_000

/** Kurum başına işlerin ve dağıtım işlerinin yeniden deneme ayarı (geri çekilmeli, sınırlı). */
const QUEUE_OPTIONS: QueueOptions = {
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
  retryDelayMax: 3600,
  expireInSeconds: 900,
}

export interface StartJobsOptions {
  /** Kuyruğun bağlanacağı veritabanı (`DATABASE_URL`). */
  connectionString: string
  storage: StorageDriver
  /** Varsayılan `INSTITUTION_JOBS`; test daha dar liste verebilir. */
  jobs?: readonly AnyInstitutionJob[]
}

export interface JobQueue {
  boss: PgBoss
  jobs: readonly AnyInstitutionJob[]
}

/** Tek işi çalıştırır: yükü doğrular, `now`'ı uygulamanın saatinden alır, sonucu loglar. */
async function runInstitutionJob(
  app: FastifyInstance,
  deps: JobDeps,
  definition: AnyInstitutionJob,
  job: Job<unknown>,
) {
  const data = institutionJobDataSchema.parse(job.data)
  try {
    const result = await definition.run(deps, data, app.clock())
    deps.log.info({
      event: 'job.completed',
      job: definition.name,
      institutionId: data.institutionId,
      ...result,
    })
    return result
  } catch (error) {
    deps.log.error({
      event: 'job.failed',
      job: definition.name,
      institutionId: data.institutionId,
      retryCount: job.retryCount,
      err: error,
    })
    throw error
  }
}

/**
 * Kuyruğu açar, kuyrukları ve zamanlamaları kurar, işleyicileri bağlar; uygulama kapanınca
 * kuyruğu durdurur. `app.ready()`'den önce çağrılır (kapanış kancası eklenir).
 */
export async function startJobs(
  app: FastifyInstance,
  options: StartJobsOptions,
): Promise<JobQueue> {
  const jobs = options.jobs ?? INSTITUTION_JOBS
  const log = app.log.child({ component: 'jobs' })
  const deps: JobDeps = { db: app.db, storage: options.storage, log }
  const boss = new PgBoss({
    connectionString: options.connectionString,
    schema: JOB_SCHEMA,
    application_name: 'kampus-jobs',
    max: 4,
    // Bağlantı oturumu API havuzu gibi UTC'dedir (`connectPostgres`).
    options: '-c timezone=UTC',
  })
  boss.on('error', (error) => log.error({ event: 'jobs.error', err: error }))
  boss.on('warning', (warning) => log.warn({ event: 'jobs.warning', message: warning.message }))
  app.addHook('onClose', async () => {
    await boss.stop({ graceful: true, timeout: STOP_TIMEOUT_MS })
    log.info({ event: 'jobs.stopped' })
  })
  await boss.start()

  const sender: JobSender = {
    send: (name, data, sendOptions) => boss.send(name, data, sendOptions),
  }
  const scheduled = new Set<string>()
  for (const definition of jobs) {
    const dispatchName = dispatchQueueName(definition)
    scheduled.add(dispatchName)
    await boss.createQueue(definition.name, QUEUE_OPTIONS)
    await boss.createQueue(dispatchName, QUEUE_OPTIONS)
    await boss.schedule(dispatchName, definition.cron, null, {
      tz: JOB_TIME_ZONE,
      missed: 'once',
    })
    await boss.work(dispatchName, async () => {
      const result = await dispatchInstitutionJobs(app.db, sender, definition)
      log.info({ event: 'job.dispatched', job: definition.name, ...result })
      return result
    })
    await boss.work<unknown>(definition.name, async ([job]) =>
      job ? runInstitutionJob(app, deps, definition, job) : null,
    )
  }
  // Listeden çıkarılmış işin zamanlaması kalırsa boş kuyruğa iş bırakmaya sürerdi.
  for (const schedule of await boss.getSchedules())
    if (!scheduled.has(schedule.name)) await boss.unschedule(schedule.name, schedule.key)
  log.info({ event: 'jobs.started', jobs: jobs.map((job) => job.name) })
  return { boss, jobs }
}
