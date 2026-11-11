import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/node-postgres'

import { buildApp } from './app.ts'
import { loadConfig, TEST_FIELD_ENCRYPTION_KEY } from './config.ts'
import { schema } from './db/client.ts'

// Betik: `pnpm --filter @kampus/api openapi` belgeyi yazar, `openapi:check` farkı denetler.
// Veritabanına bağlanmaz; buradaki değerler gizli değildir.
const OUTPUT = fileURLToPath(new URL('../openapi.json', import.meta.url))

const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://openapi@localhost:5432/openapi',
  BETTER_AUTH_SECRET: 'openapi-generation-only-not-a-secret',
  FIELD_ENCRYPTION_KEY: TEST_FIELD_ENCRYPTION_KEY,
  BETTER_AUTH_URL: 'http://localhost:3000',
})
const app = await buildApp({ config, db: drizzle.mock({ schema }) })
await app.ready()
const document = `${JSON.stringify(app.swagger(), null, 2)}\n`
await app.close()

if (process.argv.includes('--check')) {
  const current = await readFile(OUTPUT, 'utf8').catch(() => '')
  if (current !== document) {
    console.error('openapi.json güncel değil: pnpm --filter @kampus/api openapi')
    process.exit(1)
  }
  console.log('openapi.json güncel.')
} else {
  await writeFile(OUTPUT, document)
  console.log('openapi.json yazıldı.')
}
