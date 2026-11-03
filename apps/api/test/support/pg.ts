import { randomBytes } from 'node:crypto'

import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

import { loadTestPgUrl } from '../../src/config.ts'
import { connectPostgres, MIGRATIONS_FOLDER, type Database } from '../../src/db/client.ts'

/**
 * `test:pg` takımı: gerçek PostgreSQL 16 (`TEST_PG_URL`). PGlite tek bağlantılı olduğundan
 * eşzamanlılık ve kilit beklemesi yalnız burada sınanır. Adres yoksa takım atlanır.
 */
export const TEST_PG_URL = loadTestPgUrl()
export const PG_SKIP = TEST_PG_URL === null ? 'TEST_PG_URL verilmedi' : false

/** Geçici veritabanı öneki: temizlik yalnız bu önekli adlara dokunur. */
const TEMP_PREFIX = 'kampus_pg_t_'
/** Yarıda kesilmiş koşudan kalan veritabanı, bu süreden eskiyse silinir (eşzamanlı koşuya dokunulmaz). */
const STALE_AFTER_SECONDS = 30 * 60

export interface PgDatabase {
  db: Database
  /** Bu dosyaya özel veritabanının adresi; pg-boss ve oturum kilidi gibi kendi bağlantısını açanlar için. */
  url: string
  close: () => Promise<void>
}

function urlFor(base: string, name: string): string {
  const url = new URL(base)
  url.pathname = `/${name}`
  return url.toString()
}

/** Yönetim bağlantısı `TEST_PG_URL`'in kendi veritabanındandır (her ortamda vardır). */
async function withAdmin<T>(run: (admin: pg.Client) => Promise<T>): Promise<T> {
  if (TEST_PG_URL === null) throw new Error('TEST_PG_URL verilmedi')
  const admin = new pg.Client({ connectionString: TEST_PG_URL })
  await admin.connect()
  try {
    return await run(admin)
  } finally {
    await admin.end()
  }
}

/** `kampus_pg_t_<zaman>_<rastgele>` biçimindeki adın üretim zamanı (saniye); biçim tutmazsa `null`. */
function createdAtSeconds(name: string): number | null {
  const match = /^kampus_pg_t_([0-9a-z]+)_[0-9a-f]{8}$/.exec(name)
  const seconds = match?.[1] === undefined ? Number.NaN : Number.parseInt(match[1], 36)
  return Number.isFinite(seconds) ? seconds : null
}

/**
 * Önceki koşudan (kesilmiş süreç, SIGKILL) kalan geçici veritabanlarını siler. Yalnız
 * `kampus_pg_t_` önekli, eski ve bağlantısız olanlara dokunulur; başka veritabanı silinmez.
 */
async function dropStaleDatabases(): Promise<void> {
  await withAdmin(async (admin) => {
    const { rows } = await admin.query<{ datname: string }>(
      `select d.datname from pg_database d
       where d.datname like $1
         and not exists (select 1 from pg_stat_activity a where a.datname = d.datname)`,
      [`${TEMP_PREFIX.replaceAll('_', '\\_')}%`],
    )
    const limit = Math.floor(Date.now() / 1000) - STALE_AFTER_SECONDS
    for (const { datname } of rows) {
      const created = createdAtSeconds(datname)
      if (created === null || created > limit) continue
      // Eşzamanlı bir koşu aynı adı bu arada silmiş ya da bağlanmış olabilir; temizlik zorunlu değil.
      await admin.query(`drop database if exists "${datname}"`).catch(() => undefined)
    }
  })
}

/**
 * Bu test dosyasına özel geçici veritabanı: açar, üretim migration'larını uygular, `close`
 * bağlantıyı kapatıp veritabanını siler. `node --test` dosyaları ayrı süreçte paralel çalıştırır;
 * ortak bir veritabanında kurum sayısı koşudan koşuya birikir ve bütün kurumlara iş açan dağıtım
 * ile bütün kurumları tarayan kurtarma testlerini yavaşlatıp kararsızlaştırırdı (#17, OG-094).
 * Her test yine kendi kurumunu kurar; tablo boşaltılmaz.
 */
export async function createPgDatabase(): Promise<PgDatabase> {
  if (TEST_PG_URL === null) throw new Error('TEST_PG_URL verilmedi')
  const baseUrl = TEST_PG_URL
  await dropStaleDatabases()
  const name = `${TEMP_PREFIX}${Math.floor(Date.now() / 1000).toString(36)}_${randomBytes(4).toString('hex')}`
  await withAdmin((admin) => admin.query(`create database "${name}"`))
  const url = urlFor(baseUrl, name)
  const { db, close: closePool } = connectPostgres(url)
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  } catch (error) {
    await closePool()
    await dropDatabase(name)
    throw error
  }
  return {
    db,
    url,
    close: async () => {
      await closePool()
      await waitForBackendsToExit(name)
      await dropDatabase(name)
    },
  }
}

/**
 * `pool.end()` istemcileri havuzdan atıp `Terminate` gönderir ama soketlerin kapanmasını beklemeden
 * çözülür. Hemen ardından `drop database … with (force)` sunucu tarafında hâlâ kapanmakta olan
 * bağlantıları `pg_terminate_backend` ile keserse istemciye "terminating connection due to
 * administrator command" hatası döner ve dinleyicisiz olduğundan yakalanmamış istisna olup bir sonraki
 * testin (ya da `after` kancasının) üstüne yazılır. Backend'ler kendiliğinden çıkana kadar beklenir;
 * `force` yalnız gerçekten unutulmuş bağlantılar (pg-boss havuzu) için yedek kalır.
 */
async function waitForBackendsToExit(name: string): Promise<void> {
  const deadline = Date.now() + 5000
  await withAdmin(async (admin) => {
    for (;;) {
      const { rows } = await admin.query<{ n: string }>(
        'select count(*) as n from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
        [name],
      )
      if (Number(rows[0]?.n ?? 0) === 0 || Date.now() > deadline) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  })
}

async function dropDatabase(name: string): Promise<void> {
  // `force`: kapanışta unutulmuş bağlantı (pg-boss havuzu) silmeyi engellemesin; veritabanı bu dosyanın.
  await withAdmin((admin) => admin.query(`drop database if exists "${name}" with (force)`))
}
