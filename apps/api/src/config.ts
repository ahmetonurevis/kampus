import { isIP } from 'node:net'

import { z } from 'zod'

// Ortam değişkenleri yalnız bu dosyada okunur ve doğrulanır; eksik veya geçersizse süreç başlamaz.

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )

/** `.env` içindeki boş değer (`DEMO_PASSWORD=`) tanımsız sayılır. */
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema.optional())
}

const databaseUrl = z.url({ protocol: /^postgres(ql)?$/ })

/** `proxy-addr`'ın tanıdığı adres grupları (Fastify `trustProxy`). */
const PROXY_RANGE_NAMES = new Set(['loopback', 'linklocal', 'uniquelocal'])

function isProxyAddress(value: string): boolean {
  if (PROXY_RANGE_NAMES.has(value)) return true
  const [address = '', prefix, ...rest] = value.split('/')
  const version = isIP(address)
  if (version === 0 || rest.length > 0) return false
  if (prefix === undefined) return true
  if (!/^\d{1,3}$/.test(prefix)) return false
  return Number(prefix) <= (version === 4 ? 32 : 128)
}

/**
 * Hangi vekilin `X-Forwarded-For` başlığına güvenileceği. Boş/`false`/`0`: hiçbirine (varsayılan).
 * Pozitif tamsayı: istemciye en yakın o kadar vekil atlanır (hop). Aksi halde virgülle ayrılmış
 * vekil IP/CIDR listesi. `true` (bütün vekiller) reddedilir: başlığı istemci yazabilir ve hız
 * sınırı IP'si sahtelenir.
 */
const trustProxy = z
  .string()
  .default('')
  .transform((value, ctx): false | number | string[] => {
    const trimmed = value.trim()
    if (trimmed === '' || trimmed === 'false' || trimmed === '0') return false
    if (/^\d+$/.test(trimmed)) return Number(trimmed)
    const items = trimmed
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    if (items.length === 0 || !items.every(isProxyAddress)) {
      ctx.addIssue({ code: 'custom', message: 'invalid' })
      return z.NEVER
    }
    return items
  })

/** Örnek dosyalarda ve betiklerde geçen, gizli olmayan değerler; üretimde reddedilir. */
export const PLACEHOLDER_SECRET_PREFIX = 'CHANGE_ME'
const KNOWN_PUBLIC_SECRETS = new Set([
  'degistir-en-az-32-karakter-rastgele-deger',
  'cli-schema-generation-only-not-a-secret',
  'openapi-generation-only-not-a-secret',
  'test-secret-test-secret-test-secret-0123',
])

function isPlaceholderSecret(secret: string): boolean {
  return (
    secret.toUpperCase().startsWith(PLACEHOLDER_SECRET_PREFIX) || KNOWN_PUBLIC_SECRETS.has(secret)
  )
}

export const configSchema = z
  .object({
    /**
     * Varsayılanı yoktur: verilmezse süreç başlamaz. Böylece ortamı unutulmuş bir üretim sunucusu
     * geliştirme ayarlarıyla (Expo kökenleri, API belgesi) açılmaz.
     */
    NODE_ENV: z.enum(['development', 'test', 'production']),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Ters vekil arkasında hop sayısı veya vekil IP/CIDR listesi; varsayılan güvenme. */
    TRUST_PROXY: trustProxy,
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: z.string().min(32),
    /** API'nin dışarıdan görünen kök adresi; üretimde zorunlu. */
    BETTER_AUTH_URL: optional(z.url()),
    /** İzinli web kökenleri (tam eşleşme). CORS ve Better Auth `trustedOrigins` aynı listeyi kullanır. */
    CORS_ORIGINS: csv.pipe(z.array(z.url())),
    /**
     * Web uygulamasının dışarıdan görünen kök adresi; parola sıfırlama bağlantısı
     * (`/parola-sifirla?token=…`) buna kurulur, istek başlığından türetilmez (Host sahteleme).
     * Geliştirme/testte verilmezse `http://localhost:5174`; üretimde verilmezse iletisi gönderilmez.
     */
    WEB_URL: optional(z.url({ protocol: /^https?$/ })),
    /** Mobil uygulama şeması gibi tarayıcı dışı güvenilen kökenler. */
    TRUSTED_ORIGINS: csv.default(['kampus://']),
    /** Yalnız `db:seed`: demo kullanıcılarının parolası. Üretimde verilmezse tohum çalışmaz. */
    DEMO_PASSWORD: optional(z.string().min(12)),
    /**
     * Dosya deposu sürücüsü (ADR 0003 karar 1). Bugün yalnız `disk`.
     * TODO(F3c2-s3): `s3` sürücüsü ve `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
     * `S3_SECRET_ACCESS_KEY`, `STORAGE_PUBLIC_URL` doğrulaması.
     */
    STORAGE_DRIVER: z.enum(['disk']).default('disk'),
    /**
     * `disk` sürücüsünün kök klasörü (göreliyse API'nin çalışma klasörüne göre); verilmezse
     * `var/storage`. Disk sürücüsü üretimde kullanılmadığından (`assertStorageForEnvironment`)
     * üretimde zorunlu değildir.
     */
    STORAGE_DIR: optional(z.string().min(1)),
  })
  .superRefine((config, ctx) => {
    if (config.NODE_ENV !== 'production') return
    if (!config.BETTER_AUTH_URL)
      ctx.addIssue({ code: 'custom', path: ['BETTER_AUTH_URL'], message: 'required' })
    if (isPlaceholderSecret(config.BETTER_AUTH_SECRET))
      ctx.addIssue({ code: 'custom', path: ['BETTER_AUTH_SECRET'], message: 'placeholder' })
  })

export type Config = z.infer<typeof configSchema>

function failure(error: z.ZodError): Error {
  // Değerler (gizli bilgiler) yazdırılmaz; yalnız değişken adları.
  const names = [...new Set(error.issues.map((issue) => issue.path.join('.')))]
  return new Error(`Geçersiz veya eksik ortam değişkenleri: ${names.join(', ')}`)
}

/** Ortamı yalnız şemayla doğrular; başlangıç denetimleri `loadConfig`'tedir. */
export function parseConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = configSchema.safeParse(env)
  if (!parsed.success) throw failure(parsed.error)
  return parsed.data
}

export const DISK_STORAGE_IN_PRODUCTION_MESSAGE =
  'STORAGE_DRIVER=disk üretimde kullanılmaz (ADR 0003 karar 1: disk yalnız test ve yerel geliştirme içindir). S3 sürücüsü gelene kadar API üretim ortamında başlatılamaz.'

/**
 * ADR 0003 karar 1: `disk` sürücüsü yalnız test ve yerel geliştirme içindir; üretimde seçiliyse
 * süreç başlangıçta açık bir hatayla durur. Bugün tek sürücü disk olduğundan API üretimde
 * başlamaz. TODO(F3c2-s3): S3 sürücüsü gelince üretimde `s3` zorunlu olur ve bu denetim onun
 * ortam değişkenlerini ister.
 */
export function assertStorageForEnvironment(config: Config): void {
  if (config.NODE_ENV === 'production' && config.STORAGE_DRIVER === 'disk')
    throw new Error(DISK_STORAGE_IN_PRODUCTION_MESSAGE)
}

/** Süreç başlangıcı (sunucu, tohum): şema doğrulaması ve ortam denetimleri. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const config = parseConfig(env)
  assertStorageForEnvironment(config)
  return config
}

/** Migration betiği yalnız bağlantı adresine ihtiyaç duyar. */
export function loadDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  const parsed = z.object({ DATABASE_URL: databaseUrl }).safeParse(env)
  if (!parsed.success) throw failure(parsed.error)
  return parsed.data.DATABASE_URL
}

/**
 * `test:pg` takımının PostgreSQL 16 adresi (`TEST_PG_URL`). Verilmezse gerçek veritabanı testleri
 * atlanır; adres her test koşusunda tabloları değiştirdiğinden yalnız atılabilir veritabanı verilir.
 */
export function loadTestPgUrl(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const parsed = z.object({ TEST_PG_URL: optional(databaseUrl) }).safeParse(env)
  if (!parsed.success) throw failure(parsed.error)
  return parsed.data.TEST_PG_URL ?? null
}

export function publicUrl(config: Config): string {
  return config.BETTER_AUTH_URL ?? `http://localhost:${config.PORT}`
}

/** `WEB_URL` verilmediğinde geliştirme ve testte web-react geliştirme sunucusu. */
export const DEFAULT_DEV_WEB_URL = 'http://localhost:5174'

/** Web kök adresi (sonda `/` yok); üretimde `WEB_URL` yoksa `null` (bağlantı kurulmaz). */
export function webUrl(config: Config): string | null {
  const value = config.WEB_URL ?? (isDevelopmentLike(config) ? DEFAULT_DEV_WEB_URL : null)
  return value ? value.replace(/\/+$/, '') : null
}

/** Yerel geliştirme ve testte `STORAGE_DIR` verilmezse kullanılan klasör (git'e girmez). */
export const DEFAULT_STORAGE_DIR = 'var/storage'

/** Disk deposunun kök klasörü: verilen değer veya varsayılan (disk üretimde kullanılmaz). */
export function storageDir(config: Config): string {
  return config.STORAGE_DIR ?? DEFAULT_STORAGE_DIR
}

/** Geliştirme kolaylıkları (Expo Go kökenleri, API belgesi) yalnız açıkça bu ortamlarda açılır. */
export function isDevelopmentLike(config: Config): boolean {
  return config.NODE_ENV === 'development' || config.NODE_ENV === 'test'
}

/** Çerez, üretimde ve dış adres https olduğunda her zaman `Secure` işaretlenir. */
export function useSecureCookies(config: Config): boolean {
  return config.NODE_ENV === 'production' || new URL(publicUrl(config)).protocol === 'https:'
}
