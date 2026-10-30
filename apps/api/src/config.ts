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
    /** Mobil uygulama şeması gibi tarayıcı dışı güvenilen kökenler. */
    TRUSTED_ORIGINS: csv.default(['kampus://']),
    /** Yalnız `db:seed`: demo kullanıcılarının parolası. Üretimde verilmezse tohum çalışmaz. */
    DEMO_PASSWORD: optional(z.string().min(12)),
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

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = configSchema.safeParse(env)
  if (!parsed.success) throw failure(parsed.error)
  return parsed.data
}

/** Migration betiği yalnız bağlantı adresine ihtiyaç duyar. */
export function loadDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  const parsed = z.object({ DATABASE_URL: databaseUrl }).safeParse(env)
  if (!parsed.success) throw failure(parsed.error)
  return parsed.data.DATABASE_URL
}

export function publicUrl(config: Config): string {
  return config.BETTER_AUTH_URL ?? `http://localhost:${config.PORT}`
}

/** Geliştirme kolaylıkları (Expo Go kökenleri, API belgesi) yalnız açıkça bu ortamlarda açılır. */
export function isDevelopmentLike(config: Config): boolean {
  return config.NODE_ENV === 'development' || config.NODE_ENV === 'test'
}

/** Çerez, üretimde ve dış adres https olduğunda her zaman `Secure` işaretlenir. */
export function useSecureCookies(config: Config): boolean {
  return config.NODE_ENV === 'production' || new URL(publicUrl(config)).protocol === 'https:'
}
