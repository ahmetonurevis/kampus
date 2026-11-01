import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
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
import { registerAssessmentRoutes } from './routes/assessment.ts'
import { registerCommandRoutes } from './routes/commands.ts'
import { registerCommunicationRoutes } from './routes/communication.ts'
import { registerDashboardRoutes } from './routes/dashboard.ts'
import { registerFileRoutes } from './routes/files.ts'
import { requireMarkedHeaders } from './routes/commands.schemas.ts'
import { registerHealthRoutes } from './routes/health.ts'
import { registerMeRoutes } from './routes/me.ts'
import { registerAuditEventRoutes } from './routes/audit-events.ts'
import { registerInstitutionMemberRoutes } from './routes/institution-members.ts'
import { registerMembershipRoutes } from './routes/memberships.ts'
import { registerModuleRoutes } from './routes/modules.ts'
import { registerResourceCommandRoutes } from './routes/resource-commands.ts'
import { registerQuestionRoutes } from './routes/questions.ts'
import { registerRequestRoutes } from './routes/requests.ts'
import { registerAppointmentRoutes } from './routes/appointments.ts'
import { registerFeeTariffRoutes } from './routes/fee-tariffs.ts'
import { registerFinanceExportRoutes } from './routes/finance-exports.ts'
import { registerPaymentRoutes } from './routes/payments.ts'
import { registerWithdrawalRoutes } from './routes/withdrawals.ts'
import { registerProspectRoutes } from './routes/prospects.ts'
import { registerResourceRoutes } from './routes/resources.ts'
import { registerRubricRoutes } from './routes/rubrics.ts'
import { registerTaskAssignmentRoutes } from './routes/task-assignments.ts'
import { registerTaskAttemptRoutes } from './routes/task-attempts.ts'
import { registerTaskSubmissionRoutes } from './routes/task-submissions.ts'
import { MAX_UPLOAD_BYTES } from './services/files.ts'
import { createStorage } from './storage/create.ts'
import type { DiskStorage } from './storage/disk.ts'

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
  // kvkk: K — aday veya velisinin telefonu ve 18 yaş altı adayın veli adı (DOM-KAY-003, -009).
  'phone',
  '*.phone',
  'guardianName',
  '*.guardianName',
  // kvkk: Ç — kesin kayıtta öğrencinin kimliği, kimlik numarası ve doğum tarihi (DOM-KAY-012).
  'identity',
  '*.identity',
  'identityNumber',
  '*.identityNumber',
  'nationalId',
  '*.nationalId',
  'birthDate',
  '*.birthDate',
  // Finans: dekont/havale referansı, iade IBAN'ı ve hesap sahibi, nakil okulu, iptal gerekçesi.
  'reference',
  '*.reference',
  'iban',
  '*.iban',
  'accountHolder',
  '*.accountHolder',
  'targetSchool',
  '*.targetSchool',
  'reversalReason',
  '*.reversalReason',
  // pino `*.x` yalnız ikinci düzeyi yakalar; üst düzey alan ayrıca yazılır. Daha derin yol
  // (ör. `a.b.note`) desenle yakalanmaz: kayıt verisi ve gövde loga hiç verilmez.
  // kvkk: Ç — izin/mazeret gerekçe kategorisi (DOM-ILT-053).
  'reasonCategory',
  '*.reasonCategory',
  // kvkk: Ç — randevu görüşme konusu ve red/iptal gerekçesi; gerekçe durum geçmişinde de
  // durur (DOM-ILT-100, DOM-ILT-102).
  'note',
  '*.note',
  'reason',
  '*.reason',
  'history[*].reason',
  '*.history[*].reason',
  // kvkk: Ç — öğrenci sorusunun ilk yanıtı ve ek yanıtları (DOM-ILT-092). Soru başlığı ve metni
  // (`title`, `text`) başka koleksiyonlarla ortak adlardır; gövde zaten loglanmaz.
  'answer',
  '*.answer',
  'followUps',
  '*.followUps',
  // kvkk: K — aday kartı notları (ön büro görüşme notu, DOM-KAY-032). Not metni (`text`) başka
  // koleksiyonlarla ortak addır; aday kaydı loglanırsa `notes` dizisi bütünüyle gizlenir.
  'notes',
  '*.notes',
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
  /** Dosya deposu; verilmezse ortamdan kurulur (`STORAGE_DRIVER`, `STORAGE_DIR`). */
  storage?: DiskStorage
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
  // Dosya yükleme (ADR 0003 karar 2): gövde belleğe alınmaz, rota akışı depoya aktarır. Sınırlar
  // amaca göre rotada daraltılır; burada üst sınırdır.
  await app.register(multipart, {
    limits: { files: 1, fields: 2, parts: 3, fieldSize: 100, fileSize: MAX_UPLOAD_BYTES + 1 },
  })

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
  registerInstitutionMemberRoutes(app)
  registerAuditEventRoutes(app)
  registerModuleRoutes(app)
  registerCollectionRoutes(app)
  registerDashboardRoutes(app)
  registerCommandRoutes(app)
  registerAssessmentRoutes(app)
  // Komut uçlarından sonra: ham gövde süsü (`commandInput`) orada tanımlanır.
  registerCommunicationRoutes(app)
  registerRequestRoutes(app)
  registerAppointmentRoutes(app)
  registerFeeTariffRoutes(app)
  registerFinanceExportRoutes(app)
  registerPaymentRoutes(app)
  registerWithdrawalRoutes(app)
  registerProspectRoutes(app)
  registerQuestionRoutes(app)
  registerResourceRoutes(app)
  registerResourceCommandRoutes(app)
  registerRubricRoutes(app)
  registerTaskAssignmentRoutes(app)
  registerTaskAttemptRoutes(app)
  registerTaskSubmissionRoutes(app)
  registerFileRoutes(app, options.storage ?? createStorage(config))

  return app
}
