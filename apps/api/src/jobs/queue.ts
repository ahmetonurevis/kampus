import type { FastifyInstance } from 'fastify'
import { PgBoss, type Job, type JobResult, type QueueOptions } from 'pg-boss'

import type { StorageDriver } from '../storage/storage.ts'
import { dispatchInstitutionJobs, dispatchQueueName, type JobSender } from './dispatch.ts'
import { scanStoredFile, type ScanDeps } from '../services/file-scan.ts'
import { transcodeAudioFile, type TranscodeDeps } from '../services/media-transcode.ts'
import {
  FILE_SCAN_JOB,
  FILE_SCAN_REQUEUE_JOB,
  queuedScanScheduler,
  requeueStaleScans,
  runScanRequeue,
  SCAN_QUEUE_OPTIONS,
  SCAN_REQUEUE_CRON,
  SCAN_REQUEUE_LOCK_NAME,
  SCAN_REQUEUE_QUEUE_OPTIONS,
  SCAN_WORK_OPTIONS,
  scanJobDataSchema,
  scanSummary,
} from './file-scan.ts'
import { jobErrorInfo } from './job-error.ts'
import {
  MEDIA_QUEUE_OPTIONS,
  MEDIA_TRANSCODE_JOB,
  MEDIA_WORK_OPTIONS,
  postgresSessionLock,
  queuedTranscodeScheduler,
  requeueStaleTranscodes,
  transcodeJobDataSchema,
  transcodeSummary,
} from './media-transcode.ts'
import { INSTITUTION_JOBS, RETIRED_JOBS } from './registry.ts'
import {
  queuedStaffLinkScheduler,
  runStaffLinkJob,
  STAFF_LINK_QUEUE_OPTIONS,
  STAFF_LINK_WORK_OPTIONS,
  STAFF_PASSWORD_LINK_JOB,
} from './staff-password-link.ts'
import { institutionJobDataSchema, type AnyInstitutionJob, type JobDeps } from './types.ts'
import type { SessionLock } from './media-transcode.ts'

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

/**
 * Kurum başına işlerin işçi ayarı. pg-boss süre sınırını (`expireInSeconds`) iş başına değil çekim
 * başına uygular: çekimdeki en büyük süre bütün çekimin sınırıdır ve aşılınca çekimdeki işlerin
 * hepsi `failed` olur (pg-boss 12 `manager.js` `#processJobs`, `maxExpiration`). Bu yüzden her
 * çekim tek iştir (`batchSize: 1`) ve her iş kendi 900 sn'lik sınırını taşır; birinin hatası ya da
 * süre aşımı ötekini düşürmez.
 *
 * Çok kurumlu dağıtımın kurum sayısı × 2 sn yoklama aralığı kadar sürmemesi için işçi başına iki
 * eşzamanlı çekici çalışır (`localConcurrency`; API havuzundan en çok iki bağlantı) ve kuyrukta
 * bekleyen iş varken dolu çekimden sonra beklenmez (`burstWhenReadyExceeds`; kuyruk sayısı
 * pg-boss'un istatistik önbelleğinden gelir, sayım ve önbellek dakikada bir yenilenir). İlk boş
 * çekim normal yoklamaya döner.
 */
const INSTITUTION_WORK_OPTIONS = {
  batchSize: 1,
  localConcurrency: 2,
  burstWhenReadyExceeds: 1,
} as const

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
  /** `file.scan-requeue` işçisinin tekil kilidi; varsayılan ayrı adlı oturum kilidi. */
  scanRequeueLock?: SessionLock
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
    // Süre aşımında ya da kapanışta pg-boss `job.signal`'i iptal eder; uzun işler turlar arasında
    // durur (sonuç pg-boss'ta zaten `failed`, iş yeniden denenir ve idempotenttir).
    const result = await definition.run({ ...deps, signal: job.signal }, data, app.clock())
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
 * Tek `media.transcode` işini çalıştırır (ADR 0003 karar 10). Bozuk yük `deadletter`; geçici hata
 * `failed` (geri çekilmeli yeniden deneme); son denemede geçici hata dosyayı reddeder
 * (`finalAttempt`). İçerik hatası işi düşürmez: dosya reddedilir, iş `completed` olur.
 */
async function runTranscodeJob(
  app: FastifyInstance,
  deps: Omit<TranscodeDeps, 'signal'>,
  job: Job<unknown>,
): Promise<JobResult> {
  const parsed = transcodeJobDataSchema.safeParse(job.data)
  if (!parsed.success) {
    deps.log.error({
      event: 'job.failed',
      job: MEDIA_TRANSCODE_JOB,
      retryCount: job.retryCount,
      reason: 'invalid_payload',
    })
    return { id: job.id, status: 'deadletter', output: { reason: 'invalid_payload' } }
  }
  const data = parsed.data
  try {
    const result = await transcodeAudioFile({ ...deps, signal: job.signal }, data, app.clock(), {
      finalAttempt: job.retryCount >= MEDIA_QUEUE_OPTIONS.retryLimit,
    })
    const summary = transcodeSummary(result)
    deps.log.info({ event: 'job.completed', job: MEDIA_TRANSCODE_JOB, ...data, ...summary })
    return { id: job.id, status: 'completed', output: summary }
  } catch (error) {
    const info = jobErrorInfo(error)
    deps.log.error({
      event: 'job.failed',
      job: MEDIA_TRANSCODE_JOB,
      ...data,
      retryCount: job.retryCount,
      code: info.code,
      message: info.message,
    })
    return { id: job.id, status: 'failed', output: info }
  }
}

/**
 * Tek `file.scan` işini çalıştırır (ADR 0003 karar 8). Bozuk yük `deadletter`; tarayıcıya
 * ulaşılamaması ve depo hatası `failed` (geri çekilmeli yeniden deneme). Son denemede de dosya
 * reddedilmez ve `ready` olmaz: `processing` kalır, açılışta yeniden kuyruğa girer. Zararlı dosya
 * işi düşürmez: dosya reddedilir, iş `completed` olur.
 */
export async function runScanJob(
  app: FastifyInstance,
  deps: Omit<ScanDeps, 'signal'>,
  job: Job<unknown>,
): Promise<JobResult> {
  const parsed = scanJobDataSchema.safeParse(job.data)
  if (!parsed.success) {
    deps.log.error({
      event: 'job.failed',
      job: FILE_SCAN_JOB,
      retryCount: job.retryCount,
      reason: 'invalid_payload',
    })
    return { id: job.id, status: 'deadletter', output: { reason: 'invalid_payload' } }
  }
  const data = parsed.data
  try {
    const result = await scanStoredFile({ ...deps, signal: job.signal }, data, app.clock())
    const summary = scanSummary(result)
    deps.log.info({ event: 'job.completed', job: FILE_SCAN_JOB, ...data, ...summary })
    return { id: job.id, status: 'completed', output: summary }
  } catch (error) {
    const info = jobErrorInfo(error)
    const exhausted = job.retryCount >= SCAN_QUEUE_OPTIONS.retryLimit
    deps.log.error({
      event: exhausted ? 'file.scan_retries_exhausted' : 'job.failed',
      job: FILE_SCAN_JOB,
      ...data,
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
      await boss.work<unknown>(
        definition.name,
        { perJobResults: true, ...INSTITUTION_WORK_OPTIONS },
        async (batch) =>
          Promise.all(batch.map((job) => runInstitutionJob(app, deps, definition, job))),
      )
    }
    // Olaya bağlı ses dönüşümü: yükleme işi kendi transaction'ında ekler; açılışta işi kaybolmuş
    // dönüşümler yeniden kuyruğa girer.
    await boss.createQueue(MEDIA_TRANSCODE_JOB, MEDIA_QUEUE_OPTIONS)
    // `createQueue` var olan kuyruğun politikasını değiştirmez (`updateQueue` de reddeder): eski
    // politikayla kurulmuş kuyrukta tekillik yoktur, işleyici yine idempotenttir.
    const mediaQueue = await boss.getQueue(MEDIA_TRANSCODE_JOB)
    if (mediaQueue?.policy !== MEDIA_QUEUE_OPTIONS.policy)
      log.warn({
        event: 'media.queue_policy_mismatch',
        policy: mediaQueue?.policy ?? null,
        expected: MEDIA_QUEUE_OPTIONS.policy,
      })
    const mediaDeps = {
      db: app.db,
      storage: options.storage,
      transcoder: app.media.transcoder,
      log,
    }
    await boss.work<unknown>(
      MEDIA_TRANSCODE_JOB,
      { perJobResults: true, ...MEDIA_WORK_OPTIONS },
      async (batch) => Promise.all(batch.map((job) => runTranscodeJob(app, mediaDeps, job))),
    )
    // Personel davetinin parola bağlantısı: davet işi kendi transaction'ında ekler (OG-060).
    await boss.createQueue(STAFF_PASSWORD_LINK_JOB, STAFF_LINK_QUEUE_OPTIONS)
    const linkDeps = { db: app.db, auth: app.auth, log }
    await boss.work<unknown>(
      STAFF_PASSWORD_LINK_JOB,
      { perJobResults: true, ...STAFF_LINK_WORK_OPTIONS },
      async (batch) => Promise.all(batch.map((job) => runStaffLinkJob(linkDeps, job))),
    )
    // Olaya bağlı dosya taraması (tarayıcı kapalıysa kuyruk kurulmaz, dosyalar `pending` kalır).
    const scanner = app.fileScan.scanner
    if (scanner !== null) {
      await boss.createQueue(FILE_SCAN_JOB, SCAN_QUEUE_OPTIONS)
      const scanQueue = await boss.getQueue(FILE_SCAN_JOB)
      if (scanQueue?.policy !== SCAN_QUEUE_OPTIONS.policy)
        log.warn({
          event: 'file.scan_queue_policy_mismatch',
          policy: scanQueue?.policy ?? null,
          expected: SCAN_QUEUE_OPTIONS.policy,
        })
      const scanDeps = { db: app.db, storage: options.storage, scanner, log }
      await boss.work<unknown>(
        FILE_SCAN_JOB,
        { perJobResults: true, ...SCAN_WORK_OPTIONS },
        async (batch) => Promise.all(batch.map((job) => runScanJob(app, scanDeps, job))),
      )
      // Denemeleri biten taramalar süreç yeniden başlamadan kuyruğa döner (15 dakikada bir).
      await boss.createQueue(FILE_SCAN_REQUEUE_JOB, SCAN_REQUEUE_QUEUE_OPTIONS)
      await boss.schedule(FILE_SCAN_REQUEUE_JOB, SCAN_REQUEUE_CRON, null, {
        tz: JOB_TIME_ZONE,
        missed: 'once',
      })
      const lock =
        options.scanRequeueLock ??
        postgresSessionLock(options.connectionString, SCAN_REQUEUE_LOCK_NAME)
      await boss.work(FILE_SCAN_REQUEUE_JOB, async () => {
        try {
          return { queued: await runScanRequeue({ db: app.db, boss, log, clock: app.clock, lock }) }
        } catch (error) {
          const info = jobErrorInfo(error)
          log.error({ event: 'file.scan_requeue_failed', ...info })
          // pg-boss hata nesnesini saklar; yalnız süzülmüş mesaj gider (`cause` bilerek yok).
          // eslint-disable-next-line preserve-caught-error
          throw new Error(info.message)
        }
      })
    } else {
      // Tarayıcı kapalı ortamda eski zamanlama işçisiz kuyrukta iş biriktirmesin.
      for (const schedule of await boss.getSchedules(FILE_SCAN_REQUEUE_JOB))
        await boss.unschedule(schedule.name, schedule.key)
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
  // Kuyruk tümüyle kurulduktan sonra yükleme dönüşümü ve taramayı kuyruğa koyar (kurulum düşerse
  // süreç içi yol kalır).
  app.media.scheduler = queuedTranscodeScheduler(boss)
  app.staffLinks.scheduler = queuedStaffLinkScheduler(boss)
  const scanning = app.fileScan.scanner !== null
  if (scanning) app.fileScan.scheduler = queuedScanScheduler(boss)
  try {
    const requeued = await requeueStaleTranscodes(app.db, boss, app.clock())
    log.info({ event: 'media.transcode_requeued', count: requeued })
  } catch (error) {
    log.error({ event: 'media.transcode_requeue_failed', ...jobErrorInfo(error) })
  }
  if (scanning)
    try {
      const requeued = await requeueStaleScans(app.db, boss, app.clock())
      log.info({ event: 'file.scan_requeued', count: requeued })
    } catch (error) {
      log.error({ event: 'file.scan_requeue_failed', ...jobErrorInfo(error) })
    }
  log.info({
    event: 'jobs.started',
    jobs: [
      ...jobs.map((job) => job.name),
      MEDIA_TRANSCODE_JOB,
      STAFF_PASSWORD_LINK_JOB,
      ...(scanning ? [FILE_SCAN_JOB, FILE_SCAN_REQUEUE_JOB] : []),
    ],
  })
  return { boss, jobs }
}
