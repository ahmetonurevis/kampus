import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod'
import { z } from 'zod'

import { createAuth, type Auth } from './auth.ts'
import { isDevelopmentLike, publicUrl, type Config } from './config.ts'
import type { Database } from './db/client.ts'
import { registerAuthenticate } from './plugins/authenticate.ts'
import { registerBetterAuth } from './plugins/better-auth.ts'
import { registerCsrfGuard } from './plugins/csrf.ts'
import { registerErrorHandler } from './plugins/error-handler.ts'
import { registerModuleGuard } from './plugins/modules.ts'
import { genRequestId, registerRequestContext } from './plugins/request-context.ts'
import { registerCollectionRoutes } from './routes/collections.ts'
import { registerCommandRoutes } from './routes/commands.ts'
import { requireMarkedHeaders } from './routes/commands.schemas.ts'
import { registerHealthRoutes } from './routes/health.ts'
import { registerMeRoutes } from './routes/me.ts'
import { registerMembershipRoutes } from './routes/memberships.ts'

// Şemada özel mesajı olmayan Zod hataları da Türkçe döner.
z.config(z.locales.tr())

export const API_VERSION = '0.1.0'

/**
 * Logda asla görünmemesi gereken alanlar (docs/muhendislik/kod-yazim.md §6,
 * guvenlik-kvkk.md §13). Yeni hassas alan aynı committe buraya eklenir.
 */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'password',
  '*.password',
  'currentPassword',
  '*.currentPassword',
  'newPassword',
  '*.newPassword',
  'token',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.idToken',
  'email',
  '*.email',
  '*.phone',
  '*.nationalId',
  '*.cookie',
  '*.authorization',
]

/** Uygulama logunda IP'nin son okteti sıfırlanır (guvenlik-kvkk.md §13). */
export function maskIp(ip: string | undefined): string | undefined {
  if (!ip) return ip
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return ip.replace(/\.\d{1,3}$/, '.0')
  const v4 = /^::ffff:((\d{1,3}\.){3})\d{1,3}$/i.exec(ip)
  if (v4) return `::ffff:${v4[1]}0`
  // IPv6: ilk dört grup (/64) korunur.
  const groups = ip.split(':')
  return groups.length > 4 ? `${groups.slice(0, 4).join(':')}::` : ip
}

function loggerOptions(config: Config, stream?: NodeJS.WritableStream) {
  return {
    level: config.LOG_LEVEL,
    redact: { paths: REDACTED_PATHS, censor: '[gizli]' },
    serializers: {
      // Varsayılan serileştirici yerine: sorgu dizesi ve tam IP loglanmaz.
      req(request: FastifyRequest) {
        return {
          method: request.method,
          url: request.url.split('?')[0],
          remoteAddress: maskIp(request.ip),
        }
      },
    },
    ...(stream ? { stream } : {}),
  }
}

/**
 * Hop sayısı `proxy-addr`'ın sayı davranışıyla aynı işleve çevrilir (Fastify tipleri sayıyı
 * kabul etmez): istemciye en yakın `hops` vekil güvenilir, `X-Forwarded-For`'un geri kalanı yok
 * sayılır.
 */
function trustProxyOption(value: Config['TRUST_PROXY']) {
  if (typeof value !== 'number') return value
  return (_address: string, hop: number) => hop < value
}

/** Saat kaynağı; testler sabit bir an verir. */
export type Clock = () => Date

declare module 'fastify' {
  interface FastifyInstance {
    auth: Auth
    db: Database
    config: Config
    clock: Clock
  }
}

export interface BuildAppOptions {
  config: Config
  db: Database
  clock?: Clock
  /** Testlerde log çıktısını yakalamak için. */
  logStream?: NodeJS.WritableStream
}

export type App = FastifyInstance

/** Uygulama fabrikası: sunucu, testler ve OpenAPI üretimi aynısını kullanır. */
export async function buildApp(options: BuildAppOptions): Promise<App> {
  const { config, db } = options
  const clock = options.clock ?? (() => new Date())
  const base = publicUrl(config)

  const app: FastifyInstance = Fastify({
    logger: loggerOptions(config, options.logStream),
    trustProxy: trustProxyOption(config.TRUST_PROXY),
    genReqId: genRequestId,
    bodyLimit: 1024 * 1024,
  })
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const auth = createAuth(config, db)
  app.decorate('auth', auth)
  app.decorate('db', db)
  app.decorate('config', config)
  app.decorate('clock', clock)

  registerErrorHandler(app)
  registerRequestContext(app)

  await app.register(helmet)
  await app.register(cors, {
    origin: config.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    exposedHeaders: ['x-request-id', 'retry-after', 'idempotent-replayed'],
  })
  await app.register(cookie)
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' })

  const docs = isDevelopmentLike(config)
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Kampüs API',
        version: API_VERSION,
        description:
          'Kampüs okul–veli–öğrenci platformu API’si. Kimlik uçları (`/api/v1/auth/*`) Better Auth’undur ve bu belgede yer almaz.',
      },
      servers: [{ url: base }],
    },
    // Zorunlu `Idempotency-Key` belgede `required: true` görünür (`requireMarkedHeaders`).
    transform: (input) => requireMarkedHeaders(jsonSchemaTransform(input)),
    // `.meta({ id })` taşıyan şemalar `components.schemas` altında ortak tanım olur.
    transformObject: jsonSchemaTransformObject,
  })
  if (docs) {
    // Belge arayüzü yalnız açıkça geliştirme/test ortamında; kendi CSP başlığını kullanır.
    await app.register(swaggerUi, { routePrefix: '/api/docs', staticCSP: true })
    app.get('/api/v1/openapi.json', { schema: { hide: true } }, async () => app.swagger())
  }

  registerCsrfGuard(app, [...config.CORS_ORIGINS, new URL(base).origin])
  registerAuthenticate(app)
  registerModuleGuard(app)
  await registerBetterAuth(app, auth, base)
  registerHealthRoutes(app)
  registerMeRoutes(app)
  registerMembershipRoutes(app)
  registerCollectionRoutes(app)
  registerCommandRoutes(app)

  return app
}
