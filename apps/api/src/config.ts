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

const flag = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((value) => value === 'true' || value === '1')

/** `.env` içindeki boş değer (`DEMO_PASSWORD=`) tanımsız sayılır. */
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema.optional())
}

const databaseUrl = z.url({ protocol: /^postgres(ql)?$/ })

export const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Ters vekil arkasında `true`; yalnız vekilin eklediği IP başlığına güvenilir. */
    TRUST_PROXY: flag,
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
    if (config.NODE_ENV === 'production' && !config.BETTER_AUTH_URL)
      ctx.addIssue({ code: 'custom', path: ['BETTER_AUTH_URL'], message: 'required' })
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
