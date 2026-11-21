import pg from 'pg'

/**
 * `name` veritabanını (varsa) düşürür ve boş olarak yeniden oluşturur. Ad `env.ts`'te
 * `kampus_e2e` önekiyle sınırlandığı için başka veritabanlarına dokunulmaz; burada ikinci kez
 * denetlenir çünkü DROP geri alınamaz.
 */
export async function recreateDatabase(adminUrl: string, name: string): Promise<void> {
  if (!/^kampus_e2e[a-z0-9_]*$/.test(name)) throw new Error(`Güvensiz veritabanı adı: ${name}`)
  const client = new pg.Client({ connectionString: adminUrl })
  try {
    await client.connect()
  } catch (error) {
    throw new Error(
      'PostgreSQL 16 bağlantısı kurulamadı. Yerelde `docker compose up -d` çalıştırın ' +
        `(host portu 5433) ya da E2E_ADMIN_DATABASE_URL verin. Ayrıntı: ${String(error)}`,
      { cause: error },
    )
  }
  try {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    await client.query(`CREATE DATABASE "${name}"`)
  } finally {
    await client.end()
  }
}
