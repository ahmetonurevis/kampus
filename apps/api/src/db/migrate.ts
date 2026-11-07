import { migrate } from 'drizzle-orm/node-postgres/migrator'

import { loadDatabaseUrl } from '../config.ts'
import { connectPostgres, MIGRATIONS_FOLDER } from './client.ts'

// Betik: `pnpm --filter @kampus/api db:migrate`. Yalnız bağlantı adresi gerekir.
const { db, close } = connectPostgres(loadDatabaseUrl())
try {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  console.log('Migration tamamlandı.')
} finally {
  await close()
}
