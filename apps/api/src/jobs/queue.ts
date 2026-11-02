import type { FastifyInstance } from 'fastify'
import { PgBoss, type Job, type JobResult, type QueueOptions } from 'pg-boss'

import type { StorageDriver } from '../storage/storage.ts'
import { dispatchInstitutionJobs, dispatchQueueName, type JobSender } from './dispatch.ts'
import { jobErrorInfo } from './job-error.ts'
import { INSTITUTION_JOBS, RETIRED_JOBS } from './registry.ts'
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
 * - Zamanlama silme yalnız açık `RETIRED_JOBS` listesindendir: listede olmayan zamanlamaya
 *   dokunulmaz (kademeli dağıtımda eski sürüm yeni işin zamanlamasını silmesin).
 * - Log yalnız iş adı, kurum kimliği, sayılar ve hata `code`/`message`'ı taşır; hata nesnesi
 *   (pg `detail`, sorgu parametreleri) ne loga ne pg-boss çıktısına gider (`jobErrorInfo`).
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
  /** Zamanlaması silinecek emekli iş adları; varsayılan `RETIRED_JOBS`. */
  retiredJobs?: readonly string[]
}

export interface JobQueue {
  boss: PgBoss
  jobs: readonly AnyInstitutionJob[]
}

/**
 * Tek işi çalıştırır ve pg-boss'a iş sonucunu bildirir (`perJobResults`): hata fırlatılmaz, böylece
 * pg-boss hata nesnesini saklamaz. Bozuk yük yeniden denemeye değmez (`deadletter`: kalan
 * denemeler atlanır); işleyici hatası geri çekilmeli yeniden denenir (`failed`).
 */
async function runInstitutionJob(
  app: FastifyInstance,
  deps: JobDeps,
  definition: AnyInstitutionJob,
  job: Job<unknown>,
): Promise<JobResult> {
  const parsed = institutionJobDataSchema.safeParse(job.data)
  if (!parsed.success) {
    deps.log.error({
      event: 'job.failed',
      job: definition.name,
      retryCount: job.retryCount,
      reason: 'invalid_payload',
    })
    return { id: job.id, status: 'deadletter', output: { reason: 'invalid_payload' } }
  }
  const data = parsed.data
  try {
    const result = await definition.run(deps, data, app.clock())
    deps.log.info({
      event: 'job.completed',
      job: definition.name,
      institutionId: data.institutionId,
      ...result,
    })
    return { id: job.id, status: 'completed', output: result }
  } catch (error) {
    const info = jobErrorInfo(error)
    deps.log.error({
      event: 'job.failed',
      job: definition.name,
      institutionId: data.institutionId,
      retryCount: job.retryCount,
      code: info.code,
      message: info.message,
    })
    return { id: job.id, status: 'failed', output: info }
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
  boss.on('error', (error) => log.error({ event: 'jobs.error', ...jobErrorInfo(error) }))
  boss.on('warning', (warning) => log.warn({ event: 'jobs.warning', message: warning.message }))
  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    await boss.stop({ graceful: true, timeout: STOP_TIMEOUT_MS })
    log.info({ event: 'jobs.stopped' })
  }
  app.addHook('onClose', stop)

  const sender: JobSender = {
    send: (name, data, sendOptions) => boss.send(name, data, sendOptions),
  }
  try {
    await boss.start()
    for (const definition of jobs) {
      const dispatchName = dispatchQueueName(definition)
      await boss.createQueue(definition.name, QUEUE_OPTIONS)
      await boss.createQueue(dispatchName, QUEUE_OPTIONS)
      await boss.schedule(dispatchName, definition.cron, null, {
        tz: JOB_TIME_ZONE,
        missed: 'once',
      })
      await boss.work(dispatchName, async () => {
        try {
          const result = await dispatchInstitutionJobs(app.db, sender, definition)
          log.info({ event: 'job.dispatched', job: definition.name, ...result })
          return result
        } catch (error) {
          const info = jobErrorInfo(error)
          log.error({ event: 'job.failed', job: definition.name, stage: 'dispatch', ...info })
          // pg-boss hata nesnesini saklar; yalnız süzülmüş mesaj gider (`cause` bilerek yok).
          // eslint-disable-next-line preserve-caught-error
          throw new Error(info.message)
        }
      })
      await boss.work<unknown>(definition.name, { perJobResults: true }, async (batch) =>
        Promise.all(batch.map((job) => runInstitutionJob(app, deps, definition, job))),
      )
    }
    // Yalnız açıkça emekli edilen işlerin zamanlaması silinir; listede olmayan zamanlamaya
    // dokunulmaz (başka sürümün işi olabilir).
    for (const name of options.retiredJobs ?? RETIRED_JOBS)
      for (const schedule of await boss.getSchedules(dispatchQueueName({ name })))
        await boss.unschedule(schedule.name, schedule.key)
  } catch (error) {
    // Yarım kurulu kuyruk açık kalmaz; çağıran hatayı ele alır (`bootJobs`).
    await stop().catch(() => undefined)
    throw error
  }
  log.info({ event: 'jobs.started', jobs: jobs.map((job) => job.name) })
  return { boss, jobs }
}
