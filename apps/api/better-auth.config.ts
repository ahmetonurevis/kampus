/**
 * Yalnız Better Auth CLI şema üretimi için (`pnpm --filter @kampus/api auth:schema`).
 * Veritabanı bağlantısı açmaz; buradaki değerler gizli değildir.
 */
import { drizzle } from 'drizzle-orm/node-postgres'

import { createAuth } from './src/auth.ts'
import { loadConfig } from './src/config.ts'
import { schema } from './src/db/client.ts'

const config = loadConfig({
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://cli@localhost:5432/cli',
  BETTER_AUTH_SECRET: 'cli-schema-generation-only-not-a-secret',
})

export const auth = createAuth(config, drizzle.mock({ schema }))
