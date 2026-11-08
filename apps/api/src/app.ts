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
import { InlineScanScheduler } from './jobs/file-scan.ts'
import { InlineTranscodeScheduler, inlineTranscodeScheduler } from './jobs/media-transcode.ts'
import { registerAuthenticate } from './plugins/authenticate.ts'
import { registerBetterAuth } from './plugins/better-auth.ts'
import { registerCsrfGuard } from './plugins/csrf.ts'
import { registerErrorHandler } from './plugins/error-handler.ts'
import { registerModuleGuard } from './plugins/modules.ts'
import { genRequestId, registerRequestContext } from './plugins/request-context.ts'
import { registerPlatformLateRoutes, registerPlatformRoutes } from './routes/platform-routes.ts'
import { requireMarkedHeaders } from './routes/commands.schemas.ts'
// Onur: kayıt ve finans
import { registerEnrollmentImportRoutes } from './routes/enrollment-imports.ts'
import { registerEnrollmentCertificateRoutes } from './routes/enrollment-certificates.ts'
import { registerEnrollmentFunnelRoutes } from './routes/enrollment-funnel.ts'
import { registerFeeTariffRoutes } from './routes/fee-tariffs.ts'
import { registerFinanceContractRoutes } from './routes/finance-contracts.ts'
import { registerFinanceCorporateRoutes } from './routes/finance-corporate.ts'
import { registerFinanceEOzelRoutes } from './routes/finance-e-ozel.ts'
import { registerFinanceDayClosingRoutes } from './routes/finance-day-closings.ts'
import { registerFinanceExportRoutes } from './routes/finance-exports.ts'
import { registerFinanceForecastRoutes } from './routes/finance-forecasts.ts'
import { registerFinanceInstallmentImportRoutes } from './routes/finance-installment-imports.ts'
import { registerFinanceOpeningWatchRoutes } from './routes/finance-opening-watch.ts'
import { registerFinanceReferralRoutes } from './routes/finance-referrals.ts'
import { registerFinancePackageRoutes } from './routes/finance-packages.ts'
import { registerFinancePayerChildrenRoutes } from './routes/finance-payer-children.ts'
import { registerFinanceReminderRoutes } from './routes/finance-reminders.ts'
import { registerFinanceRenewalRoutes } from './routes/finance-renewals.ts'
import { registerFinanceScholarshipRoutes } from './routes/finance-scholarships.ts'
import { registerPaymentRoutes } from './routes/payments.ts'
import { registerWithdrawalRoutes } from './routes/withdrawals.ts'
import { registerProspectRoutes } from './routes/prospects.ts'
// Onur: kayıt ve finans sonu
import { createFfmpegTranscoder, type AudioTranscoder } from './services/audio-transcoder.ts'
import { MAX_UPLOAD_BYTES } from './services/files.ts'
import type { Mailer } from './services/mailer.ts'
import type { FileScanRuntime, FileScanScheduler } from './services/file-scan.ts'
import { createFileScanner, type FileScanner } from './services/file-scanner.ts'
import type { MediaRuntime, MediaTranscodeScheduler } from './services/media-transcode.ts'
import { InlineStaffLinkScheduler, type StaffLinkRuntime } from './services/staff-password-links.ts'
import { createStorage } from './storage/create.ts'
import type { DiskStorage } from './storage/disk.ts'

// Şemada özel mesajı olmayan Zod hataları da Türkçe döner.
z.config(z.locales.tr())

export const API_VERSION = '0.1.0'

/** Sağlık ve acil bilgi içeriğinin alan adları (`healthProfileContentSchema`) ve şifreli paketi. */
const HEALTH_FIELDS = [
  'allergies',
  'chronicConditions',
  'medications',
  'supportNeeds',
  'emergencyInstructions',
  'contentCiphertext',
] as const

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
  // kvkk: K — vazgeçen adayın tercih ettiği kurum, serbest metin (DOM-KAY-005).
  'lostToInstitution',
  '*.lostToInstitution',
  // kvkk: Ç — kesin kayıtta öğrencinin kimliği, kimlik numarası ve doğum tarihi (DOM-KAY-012).
  'identity',
  '*.identity',
  'identityNumber',
  '*.identityNumber',
  'nationalId',
  '*.nationalId',
  'birthDate',
  '*.birthDate',
  // kvkk: Ç — pilot aktarım dosyası (IST-007): içerik hiçbir koşulda loglanmaz.
  'fileBase64',
  '*.fileBase64',
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
  // kvkk: Ç — kapatılmış günü yeniden açma gerekçesi (DOM-FIN-036); kapanış açıklaması `note`'tadır.
  'reopenReason',
  '*.reopenReason',
  // kvkk: K — sözleşmenin imza yetkilisi ve ödeyici adı; ek protokol gerekçesi serbest metindir.
  'signatory',
  '*.signatory',
  'payerName',
  '*.payerName',
  // Ayrılışta iade kararı ve gerekçesi (K-12).
  'payerDecision',
  '*.payerDecision',
  'amendmentReason',
  '*.amendmentReason',
  'cancelReason',
  '*.cancelReason',
  // kvkk: K — sözleşme satırının imza yetkilisi adı ve kesin kayıtta yeni velinin adı
  // (DOM-KAY-009); veli telefonu `*.phone` ile gizlenir.
  'signatoryName',
  '*.signatoryName',
  'guardian.name',
  '*.guardian.name',
  // Aday `interest` ve imza yetkilisi ucunun üst düzey `name` alanı yalnız istek gövdesinde gelir;
  // gövde loglanmadığından maske yok, genel `name` de başka kayıtların adıdır (ON-315, testte).
  // Paket uzatma ve kullanılan saat düzeltmesi (ON-300, DOM-DIL-051), ek protokol, tahsilat ters
  // kaydı ve gün sonu yeniden açma gövdesindeki gerekçe `reason` adıyla gelir: aşağıdaki
  // `reason`/`*.reason` gizler (finance-log-redaction.test.ts).
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
  // kvkk: Ç — ders iptali ve yedek görevlendirme gerekçesi (DOM-YTK-068).
  'cancelReason',
  '*.cancelReason',
  'substitutions',
  '*.substitutions',
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
  // kvkk: Ç — öğretmenin ödev teslimine geri bildirimi (DOM-AKD-073); teslim metni `note`
  // yukarıda.
  'feedback',
  '*.feedback',
  // kvkk: Ç — seviye ve kur sonu kararının gerekçesi ile ret gerekçesi; çoğu zaman reşit olmayan
  // kursiyerin ölçme yorumudur (DOM-BEC-034, DOM-DIL-070; `cefr.ts` tabloları).
  'rationale',
  '*.rationale',
  'rejectionReason',
  '*.rejectionReason',
  // kvkk: K — toplu personel aktarımının CSV içeriği: ad ve e-posta satırları (IST-007).
  'csv',
  '*.csv',
  // kvkk: K — kurum başarı belgesinin doğrulama kodu, iptal gerekçesi ve MEBBİS belge numarası
  // (DOM-DIL-080, DOM-DIL-082); kod kimliksiz doğrulama yolunda da gizlenir (`req` aşağıda).
  'verificationCode',
  '*.verificationCode',
  'cancellationReason',
  '*.cancellationReason',
  'certificateNumber',
  '*.certificateNumber',
  // kvkk: Ö — öğrencinin sağlık ve acil bilgisi (IST-020, DOM-ILT-035) ve şifreli paketi.
  'allergies',
  '*.allergies',
  'chronicConditions',
  '*.chronicConditions',
  'medications',
  '*.medications',
  'supportNeeds',
  '*.supportNeeds',
  'emergencyInstructions',
  '*.emergencyInstructions',
  'contentCiphertext',
  '*.contentCiphertext',
  // Sağlık alanları iç içe nesnede de maskelenir (ör. `profile.content.allergies`,
  // `req.body.allergies`, `data.profile.content.allergies`).
  ...HEALTH_FIELDS.flatMap((field) => [`*.*.${field}`, `*.*.*.${field}`]),
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

/** Kimliksiz doğrulama yolundaki belge kodu loglanmaz (DOM-DIL-082). */
const CERTIFICATE_VERIFICATION_PATH = /^(\/api\/v1\/certificate-verifications\/)[^/]+/

function maskCertificateCode(url: string): string {
  return url.replace(CERTIFICATE_VERIFICATION_PATH, '$1[gizli]')
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
          url: maskCertificateCode(request.url.split('?')[0] ?? ''),
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
    /** Ses dönüştürücü ve dönüşüm kuyruğu; kuyruk açılınca `scheduler` değişir (`startJobs`). */
    media: MediaRuntime
    /** Dosya tarayıcısı ve tarama kuyruğu (`null`: tarama kapalı); kuyruk açılınca değişir. */
    fileScan: FileScanRuntime
    /** Personel davetinin parola bağlantıları; kuyruk açılınca `scheduler` değişir (`startJobs`). */
    staffLinks: StaffLinkRuntime
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
  /** Parola sıfırlama iletisi; verilmezse ortamın varsayılanı (testte bellek kutusu). */
  mailer?: Mailer
  /** Sıfırlama iletisi yanıttan sonra gönderilir (varsayılan `true`); `false` iletiyi bekler. */
  backgroundMail?: boolean
  /**
   * Ses dönüşümü (ADR 0003 karar 10). Verilmezse dönüştürücü ortamdaki `ffmpeg`/`ffprobe`'dur
   * (`FFMPEG_PATH`, `FFPROBE_PATH`) ve kuyruk açılana kadar dönüşüm süreç içinde çalışır.
   */
  media?: { transcoder?: AudioTranscoder; scheduler?: MediaTranscodeScheduler }
  /**
   * Dosya taraması (ADR 0003 karar 8). Verilmezse tarayıcı ortamdandır (`FILE_SCANNER`; testte
   * `off`); `scanner: null` taramayı kapatır. Tarayıcı varken kuyruk açılana kadar tarama süreç
   * içinde çalışır. Testte sahte tarayıcı buradan verilir.
   */
  fileScan?: { scanner?: FileScanner | null; scheduler?: FileScanScheduler }
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
  if (config.fieldEncryptionKeyIsDevelopmentDefault && config.NODE_ENV !== 'test')
    app.log.warn(
      'FIELD_ENCRYPTION_KEY verilmedi: herkesçe bilinen geliştirme anahtarı kullanılıyor; gerçek veri için openssl rand -base64 32 ile anahtar üretin.',
    )
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const auth = createAuth(config, db, {
    log: app.log,
    ...(options.mailer ? { mailer: options.mailer } : {}),
    ...(options.backgroundMail === undefined ? {} : { background: options.backgroundMail }),
  })
  app.addHook('onClose', () => auth.flushBackground())
  app.decorate('auth', auth)
  app.decorate('db', db)
  app.decorate('config', config)
  app.decorate('clock', clock)
  const storage = options.storage ?? createStorage(config)
  const transcoder =
    options.media?.transcoder ??
    createFfmpegTranscoder({ ffmpegPath: config.FFMPEG_PATH, ffprobePath: config.FFPROBE_PATH })
  const scheduler =
    options.media?.scheduler ??
    inlineTranscodeScheduler({ db, storage, transcoder, log: app.log, clock })
  // Kuyruksuz dönüşümler kapanışta iptal edilir ve bitmeleri beklenir (veritabanı sonra kapanır).
  if (scheduler instanceof InlineTranscodeScheduler) app.addHook('onClose', () => scheduler.close())
  const media: MediaRuntime = { transcoder, scheduler }
  app.decorate('media', media)
  const scanner =
    options.fileScan?.scanner === undefined ? createFileScanner(config) : options.fileScan.scanner
  const scanScheduler =
    scanner === null
      ? null
      : (options.fileScan?.scheduler ??
        new InlineScanScheduler({ db, storage, scanner, log: app.log, clock }))
  // Kuyruksuz taramalar kapanışta iptal edilir; dosya `processing` kalır (açılışta yeniden).
  if (scanScheduler instanceof InlineScanScheduler)
    app.addHook('onClose', () => scanScheduler.close())
  const fileScan: FileScanRuntime = { scanner, scheduler: scanScheduler }
  app.decorate('fileScan', fileScan)

  // Kuyruksuz parola bağlantıları yanıttan sonra gider; kapanışta bitmeleri beklenir.
  const inlineLinks = new InlineStaffLinkScheduler({ db, auth, log: app.log })
  app.addHook('onClose', () => inlineLinks.close())
  const staffLinks: StaffLinkRuntime = { scheduler: inlineLinks, inline: inlineLinks }
  app.decorate('staffLinks', staffLinks)

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
  // Rota kayıt sırası OpenAPI yol sırasıdır; platform uçları iki adımda, Onur bloğu arasında
  // (`routes/platform-routes.ts`). Bir kayıt fonksiyonu iki kaynakta bulunamaz.
  registerPlatformRoutes(app)
  // Onur: kayıt ve finans
  registerFeeTariffRoutes(app)
  registerFinanceContractRoutes(app)
  registerFinanceEOzelRoutes(app)
  registerFinanceDayClosingRoutes(app)
  registerFinanceExportRoutes(app)
  registerFinancePackageRoutes(app)
  registerFinanceReminderRoutes(app)
  registerFinanceRenewalRoutes(app)
  registerFinanceScholarshipRoutes(app)
  registerFinanceReferralRoutes(app)
  registerPaymentRoutes(app)
  registerWithdrawalRoutes(app)
  registerProspectRoutes(app)
  registerEnrollmentImportRoutes(app)
  registerFinanceInstallmentImportRoutes(app)
  registerEnrollmentFunnelRoutes(app)
  registerEnrollmentCertificateRoutes(app)
  registerFinancePayerChildrenRoutes(app)
  registerFinanceCorporateRoutes(app)
  registerFinanceForecastRoutes(app)
  registerFinanceOpeningWatchRoutes(app)
  // Onur: kayıt ve finans sonu
  registerPlatformLateRoutes(app, storage)

  return app
}
