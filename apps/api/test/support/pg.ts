import { migrate } from 'drizzle-orm/node-postgres/migrator'

import { loadTestPgUrl } from '../../src/config.ts'
import { connectPostgres, MIGRATIONS_FOLDER, type Database } from '../../src/db/client.ts'

/**
 * `test:pg` takımı: gerçek PostgreSQL 16 (`TEST_PG_URL`). PGlite tek bağlantılı olduğundan
 * eşzamanlılık ve kilit beklemesi yalnız burada sınanır. Adres yoksa takım atlanır.
 */
export const TEST_PG_URL = loadTestPgUrl()
export const PG_SKIP = TEST_PG_URL === null ? 'TEST_PG_URL verilmedi' : false

/** Üretim migration'larını uygular; her test kendi kurumunu kurduğu için tablo boşaltılmaz. */
export async function createPgDatabase(): Promise<{ db: Database; close: () => Promise<void> }> {
  if (TEST_PG_URL === null) throw new Error('TEST_PG_URL verilmedi')
  const { db, close } = connectPostgres(TEST_PG_URL)
  // `node --test` dosyaları paralel çalıştırır; boş veritabanında iki dosya aynı anda migrate
  // ederse biri benzersizlik hatası alır. Öteki bitirince yeniden deneme uygulanmış sürümü görür.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
      break
    } catch (error) {
      if (attempt >= 5) throw error
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt))
    }
  }
  return { db, close }
}
