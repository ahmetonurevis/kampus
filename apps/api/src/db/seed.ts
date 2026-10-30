import { createAuth } from '../auth.ts'
import { loadConfig } from '../config.ts'
import { connectPostgres } from './client.ts'
import { DEFAULT_DEMO_PASSWORD, DEMO_MEMBERS, seedDemo } from './demo-seed.ts'

// Betik: `pnpm --filter @kampus/api db:seed`. İki kez çalıştırmak güvenlidir.
const config = loadConfig()
if (config.NODE_ENV === 'production' && !config.DEMO_PASSWORD) {
  console.error('Üretimde demo tohumu yalnız DEMO_PASSWORD verilerek çalışır.')
  process.exit(1)
}
const password = config.DEMO_PASSWORD ?? DEFAULT_DEMO_PASSWORD

const { db, close } = connectPostgres(config.DATABASE_URL)
try {
  const { insertedRecords } = await seedDemo(createAuth(config, db), db, password, {
    now: new Date(),
  })
  console.log(`Demo verisi hazır: ${DEMO_MEMBERS.length} kullanıcı, 2 kurum.`)
  for (const [slug, count] of Object.entries(insertedRecords))
    console.log(`  ${slug}: ${count} yeni kayıt`)
  for (const member of DEMO_MEMBERS)
    console.log(`  ${member.email} (${member.memberships.map((item) => item.role).join(', ')})`)
  if (!config.DEMO_PASSWORD) console.log(`Parola: ${DEFAULT_DEMO_PASSWORD}`)
} finally {
  await close()
}
