import { buildApp } from './app.ts'
import { jobsEnabled, loadConfig } from './config.ts'
import { connectPostgres } from './db/client.ts'
import { bootJobs } from './jobs/boot.ts'
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
  await bootJobs({
    app,
    db,
    log: app.log,
    enabled: jobsEnabled(config),
    connectionString: config.DATABASE_URL,
    storage,
  })
  await app.listen({ host: config.HOST, port: config.PORT })
} catch (error) {
  app.log.fatal({ err: error }, 'server failed to start')
  await app.close().catch((closeError: unknown) => app.log.error({ err: closeError }))
  await close()
  process.exit(1)
}
