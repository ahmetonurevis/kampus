import { buildApp } from './app.ts'
import { jobsEnabled, loadConfig } from './config.ts'
import { connectPostgres } from './db/client.ts'
import { purgeExpiredIdempotencyKeys } from './db/idempotency.ts'
import { startJobs } from './jobs/queue.ts'
import { createStorage } from './storage/create.ts'

const config = loadConfig()
const { db, close } = connectPostgres(config.DATABASE_URL)
const storage = createStorage(config)
const app = await buildApp({ config, db, storage })

let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  app.log.info({ signal }, 'server stopping')
  // `onClose`: önce iş kuyruğu durur (çalışan işler biter), sonra veritabanı havuzu kapanır.
  await app.close()
  await close()
}
process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

try {
  if (jobsEnabled(config)) {
    await startJobs(app, { connectionString: config.DATABASE_URL, storage })
  } else {
    // Kuyruk kapalıyken saklama sınırı (24 saat) açılışta uygulanır; açıkken günlük iş yapar.
    const purged = await purgeExpiredIdempotencyKeys(db, new Date())
    app.log.info({ event: 'idempotency.purged', purged })
  }
  await app.listen({ host: config.HOST, port: config.PORT })
} catch (error) {
  app.log.fatal({ err: error }, 'server failed to start')
  await app.close().catch((closeError: unknown) => app.log.error({ err: closeError }))
  await close()
  process.exit(1)
}
