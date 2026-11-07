import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { createApiClient, storageStatePath } from './api.ts'
import { recreateDatabase } from './database.ts'
import { e2e, roles } from './env.ts'
import { cleanEnv, run, startService, type Service } from './processes.ts'

/**
 * Uçtan uca ortamı sıfırdan kurar: ayrı veritabanı (`kampus_e2e`) → migrate → seed → API (test
 * portu) → web-react derleme + `vite preview` → rol başına oturum önbelleği. Dönen işlev hepsini
 * kapatır. `kampus` ve diğer veritabanlarına dokunulmaz.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const services: Service[] = []
  const stopAll = async () => {
    for (const service of services.reverse()) await service.stop().catch(() => undefined)
  }
  try {
    rmSync(e2e.paths.artifacts, { recursive: true, force: true })
    mkdirSync(e2e.paths.artifacts, { recursive: true })

    await recreateDatabase(e2e.adminDatabaseUrl, e2e.dbName)

    // Gizli anahtar yalnız bu koşunun ortamında yaşar; dosyaya yazılmaz.
    const apiEnv = cleanEnv({
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(e2e.apiPort),
      LOG_LEVEL: 'warn',
      DATABASE_URL: e2e.databaseUrl,
      BETTER_AUTH_SECRET: process.env.E2E_AUTH_SECRET ?? randomBytes(32).toString('base64'),
      FIELD_ENCRYPTION_KEY: e2e.fieldEncryptionKey,
      BETTER_AUTH_URL: e2e.webOrigin,
      CORS_ORIGINS: e2e.webOrigin,
      // Test istemcileri sahte `X-Forwarded-For` ile kendi hız sınırı kovasını alır (api.ts).
      TRUST_PROXY: '1',
      DEMO_PASSWORD: e2e.password,
    })
    await run('migrate', ['src/db/migrate.ts'], { cwd: e2e.paths.api, env: apiEnv })
    await run('seed', ['src/db/seed.ts'], { cwd: e2e.paths.api, env: apiEnv })

    services.push(
      await startService('api', ['src/server.ts'], {
        cwd: e2e.paths.api,
        env: apiEnv,
        readyUrl: `${e2e.apiOrigin}/api/v1/health`,
      }),
    )

    const vite = join(e2e.paths.web, 'node_modules/vite/bin/vite.js')
    const webEnv = cleanEnv({ NODE_ENV: 'production', KAMPUS_API_URL: e2e.apiOrigin })
    if (process.env.E2E_SKIP_BUILD !== '1')
      await run('web-build', [vite, 'build'], { cwd: e2e.paths.web, env: webEnv })
    services.push(
      await startService(
        'web',
        [vite, 'preview', '--host', '127.0.0.1', '--port', String(e2e.webPort), '--strictPort'],
        { cwd: e2e.paths.web, env: webEnv, readyUrl: `${e2e.webOrigin}/giris` },
      ),
    )

    // Rol başına bir giriş: dosya `storageState` olarak yeniden kullanılır (support/fixtures.ts).
    for (const role of roles) {
      const client = await createApiClient(role, { fresh: true })
      const path = storageStatePath(role)
      mkdirSync(dirname(path), { recursive: true })
      await client.context.storageState({ path })
      await client.dispose()
    }
  } catch (error) {
    await stopAll()
    throw error
  }
  return stopAll
}
