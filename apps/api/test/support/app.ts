import { randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'

import { PGlite } from '@electric-sql/pglite'
import { btree_gin } from '@electric-sql/pglite/contrib/btree_gin'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

import { buildApp, type App, type BuildAppOptions, type Clock } from '../../src/app.ts'
import type { InstitutionType, Role } from '../../src/auth.ts'
import { parseConfig, type Config } from '../../src/config.ts'
import { MIGRATIONS_FOLDER, schema, type Database } from '../../src/db/client.ts'
import type { Mailer } from '../../src/services/mailer.ts'
import type { DiskStorage } from '../../src/storage/disk.ts'
import {
  ensureInstitution,
  ensureInstitutionSettings,
  ensureMember,
  ensureMembershipLinks,
  ensureUser,
  type MembershipLinkInput,
} from '../../src/services/identity.ts'
import { FakeTranscoder, RecordingScheduler } from './media-sample.ts'

export const TEST_ORIGIN = 'http://localhost:5173'
export const TEST_PASSWORD = 'Sinama-Parolasi-42!'
export const FIXED_NOW = new Date('2026-10-06T09:00:00.000Z')

/**
 * Test ortamı ayarı. Şema doğrulaması `parseConfig`'tedir: üretim güvenlik varsayılanlarını sınayan
 * testler `NODE_ENV=production` ile uygulama kurar; disk deposunun üretimde reddi başlangıç
 * denetimidir (`loadConfig`) ve ayrıca `config.test.ts`'te sınanır.
 */
export function testConfig(overrides: Record<string, string> = {}): Config {
  return parseConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://test@localhost:5432/test',
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    BETTER_AUTH_URL: 'http://localhost:3000',
    CORS_ORIGINS: TEST_ORIGIN,
    ...overrides,
  })
}

/**
 * Bellek içi PostgreSQL. `btree_gin` içerik havuzu arama indeksi içindir (migration 0010); üretim
 * PostgreSQL'inde contrib paketiyle gelir.
 */
export function newPGlite(): PGlite {
  return new PGlite({ extensions: { btree_gin } })
}

/**
 * Süreç içi şablon (OG-202): aynı süreçte ikinci kez veritabanı kurulunca migrate edilmiş veri
 * dizini bir kez dökülür, sonrakiler onu yükler. Boş PGlite açıp 44 migration uygulamak yükte
 * yüklemeye göre ~3 kat yavaştır. Her test dosyası ayrı süreçtir ve çoğu tek veritabanı kurar;
 * bu yüzden ilk kurulum şablon için ek iş yapmaz, döküm ikinci kurulumda (birden çok
 * veritabanı kuran dosyada) bir kez alınır.
 */
let migratedTemplate: Promise<Blob | File> | undefined
let databasesCreated = 0

/** Dosya başına bellek içi PostgreSQL (PGlite) ve üretim migration'ları. */
export async function createTestDatabase(): Promise<{ db: Database; close: () => Promise<void> }> {
  databasesCreated += 1
  if (migratedTemplate !== undefined) {
    const client = new PGlite({ extensions: { btree_gin }, loadDataDir: await migratedTemplate })
    return { db: drizzle({ client, schema }), close: () => client.close() }
  }
  const client = newPGlite()
  const db = drizzle({ client, schema })
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  // Döküm hiçbir test verisi yazılmadan, migrate'in hemen arkasında alınır.
  if (databasesCreated > 1) migratedTemplate = Promise.resolve(await client.dumpDataDir('none'))
  return { db, close: () => client.close() }
}

export interface TestAppOptions {
  config?: Config
  clock?: Clock
  /** Log satırlarını yakalar (redaksiyon testleri). */
  logs?: string[]
  /** Dosya deposu (ör. geçici klasörde `DiskStorage`); verilmezse ortamın varsayılanı. */
  storage?: DiskStorage
  /** `ready` öncesi yalnız teste özgü rota eklemek için. */
  extend?: (app: App) => void
  /** Parola sıfırlama iletisi (ör. `MemoryMailer`; kutusu testten okunur). */
  mailer?: Mailer
  /** Sıfırlama iletisi arka planda mı gönderilsin; testte varsayılan `false` (ileti beklenir). */
  backgroundMail?: boolean
  /**
   * Ses dönüşümü; varsayılan sahte dönüştürücü ve işi yalnız kaydeden sahte kuyruk (yüklenen ses
   * `processing` kalır, kuyruk açıkmış gibi). Kuyruksuz yol için `inlineTranscodeScheduler`.
   */
  media?: BuildAppOptions['media']
  /** Dosya taraması; varsayılan ortamınki (testte `off`: yüklenen dosya `pending` kalır). */
  fileScan?: BuildAppOptions['fileScan']
}

export async function buildTestApp(db: Database, options: TestAppOptions = {}): Promise<App> {
  const logs = options.logs
  const logStream = logs
    ? new Writable({
        write(chunk: Buffer, _encoding, callback) {
          logs.push(chunk.toString())
          callback()
        },
      })
    : undefined
  const config = options.config ?? (logs ? testConfig({ LOG_LEVEL: 'debug' }) : testConfig())
  const app = await buildApp({
    config,
    db,
    clock: options.clock ?? (() => FIXED_NOW),
    ...(options.storage ? { storage: options.storage } : {}),
    ...(logStream ? { logStream } : {}),
    ...(options.mailer ? { mailer: options.mailer } : {}),
    backgroundMail: options.backgroundMail ?? false,
    media: options.media ?? {
      transcoder: new FakeTranscoder(),
      scheduler: new RecordingScheduler(),
    },
    ...(options.fileScan ? { fileScan: options.fileScan } : {}),
  })
  options.extend?.(app)
  await app.ready()
  return app
}

/** Test kimlikleri benzersiz ve önekli; her test kendi kurumunu kurar. */
export function uniqueId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`
}

export interface TestUser {
  id: string
  email: string
  password: string
}

export async function createUser(
  app: App,
  overrides: Partial<{ name: string; email: string; password: string }> = {},
): Promise<TestUser> {
  const email = overrides.email ?? `${uniqueId('test-user')}@kampus.example`
  const password = overrides.password ?? TEST_PASSWORD
  const user = await ensureUser(app.auth, {
    name: overrides.name ?? 'Test Kullanıcı',
    email,
    password,
  })
  return { id: user.id, email, password }
}

export interface TestInstitution {
  id: string
  admin: TestUser
  adminMembershipId: string
}

export interface InstitutionOverrides {
  name: string
  type: InstitutionType
  enabledModules: Record<string, boolean>
  /** Kurum ayar satırı; `null` verilirse satır açılmaz. Varsayılan `FIXED_NOW` yılı. */
  academicYear: number | null
}

export async function createInstitution(
  app: App,
  overrides: Partial<InstitutionOverrides> = {},
): Promise<TestInstitution> {
  const admin = await createUser(app, { name: 'Test Yönetici' })
  const slug = uniqueId('test-kurum')
  const institution = await ensureInstitution(app.auth, app.db, {
    name: overrides.name ?? `Test Kurumu ${slug}`,
    slug,
    type: overrides.type ?? 'school',
    creatorUserId: admin.id,
    ...(overrides.enabledModules ? { enabledModules: overrides.enabledModules } : {}),
  })
  const academicYear =
    overrides.academicYear === undefined ? FIXED_NOW.getUTCFullYear() : overrides.academicYear
  if (academicYear !== null)
    await ensureInstitutionSettings(app.db, institution.id, { academicYear })
  const membership = await ensureMember(app.auth, app.db, {
    institutionId: institution.id,
    userId: admin.id,
    role: 'yonetici',
  })
  return { id: institution.id, admin, adminMembershipId: membership.id }
}

export async function createMember(
  app: App,
  institutionId: string,
  role: Role,
  links: readonly MembershipLinkInput[] = [],
): Promise<TestUser & { membershipId: string }> {
  const user = await createUser(app)
  const membership = await ensureMember(app.auth, app.db, { institutionId, userId: user.id, role })
  await ensureMembershipLinks(app.db, institutionId, membership.id, links)
  return { ...user, membershipId: membership.id }
}

/** Her giriş ayrı istemci IP'si kullanır; Better Auth giriş hız sınırı testler arasında paylaşılmaz. */
let ipCounter = 0
export function nextIp(): string {
  ipCounter += 1
  return `10.0.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`
}

export function signIn(app: App, email: string, password: string, ip = nextIp()) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in/email',
    headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
    remoteAddress: ip,
    payload: { email, password },
  })
}

/** Better Auth girişiyle oturum açar ve `cookie` başlık değerini döndürür. */
export async function signInAs(
  app: App,
  user: { email: string; password: string },
): Promise<string> {
  const response = await signIn(app, user.email, user.password)
  if (response.statusCode !== 200) throw new Error(`Giriş başarısız: ${response.statusCode}`)
  return response.cookies.map((item) => `${item.name}=${item.value}`).join('; ')
}
