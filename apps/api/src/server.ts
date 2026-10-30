import { buildApp } from './app.ts'
import { loadConfig } from './config.ts'
import { connectPostgres } from './db/client.ts'
import { purgeExpiredIdempotencyKeys } from './db/idempotency.ts'

const config = loadConfig()
const { db, close } = connectPostgres(config.DATABASE_URL)
const app = await buildApp({ config, db })

let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  app.log.info({ signal }, 'server stopping')
  await app.close()
  await close()
}
process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

try {
  // Saklama sınırı (24 saat): iş kuyruğu kurulana kadar açılışta da temizlenir (TODO(jobs)).
  const purged = await purgeExpiredIdempotencyKeys(db, new Date())
  app.log.info({ event: 'idempotency.purged', purged })
  await app.listen({ host: config.HOST, port: config.PORT })
} catch (error) {
  app.log.fatal({ err: error }, 'server failed to start')
  await close()
  process.exit(1)
}
