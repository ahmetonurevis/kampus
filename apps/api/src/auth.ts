import { expo } from '@better-auth/expo'
import { betterAuth, getCurrentAdapter } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createAccessControl } from 'better-auth/plugins/access'
import { organization } from 'better-auth/plugins/organization'
import { defaultStatements } from 'better-auth/plugins/organization/access'
import { z } from 'zod'

import { isDevelopmentLike, publicUrl, useSecureCookies, webUrl, type Config } from './config.ts'
import { schema, type Database } from './db/client.ts'
import {
  authAfterHook,
  authBeforeHook,
  defaultInstitutionId,
  defaultInstitutionIdFromAdapter,
  FORWARDED_IP_HEADER,
} from './services/auth-hooks.ts'
import { createMailer, SILENT_MAIL_LOG, type MailLog, type Mailer } from './services/mailer.ts'
import { deliverPasswordReset, recordPasswordResetCompleted } from './services/password-reset.ts'

// Better Auth yapılandırmasının tek yeri (ADR 0002, docs/muhendislik/guvenlik-kvkk.md §1–4).

export const AUTH_BASE_PATH = '/api/v1/auth'

/**
 * Kurum rolleri: school-core rol kaydındaki anahtarlar
 * (`packages/school-core/src/modules/navigation.js` → `roles`). Veri olduğu için değiştirilmez.
 */
export const ROLES = ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli'] as const
export const roleSchema = z.enum(ROLES)
export type Role = z.infer<typeof roleSchema>

/** `school` ders + kazanım, `language_school` CEFR (Pre-A1, A1–C2, A2+/B1+/B2+) + beceri. */
export const INSTITUTION_TYPES = ['school', 'language_school'] as const
export type InstitutionType = (typeof INSTITUTION_TYPES)[number]

export const ac = createAccessControl(defaultStatements)

/**
 * Organization eklentisinin kurum/üyelik yetkileri yalnız yöneticidedir. Okul verisine erişim
 * rota düzeyinde `requireRole`, kayıt düzeyinde school-core kapsam kurallarıyla çözülür.
 */
export const roles = {
  yonetici: ac.newRole({
    organization: ['update'],
    member: ['create', 'update', 'delete'],
    invitation: ['create', 'cancel'],
  }),
  onburo: ac.newRole({}),
  ogretmen: ac.newRole({}),
  ogrenci: ac.newRole({}),
  veli: ac.newRole({}),
} satisfies Record<Role, unknown>

/**
 * HTTP'den erişilebilen Better Auth uçları (izin listesi; `AUTH_BASE_PATH`'e göre tam yol).
 * Listede olmayan her yol, Better Auth'a iletilmeden 404 döner (`plugins/better-auth.ts`); sürüm
 * yükseltmesiyle gelen yeni uç da kendiliğinden kapalı kalır. Test, kayıtlı bütün uçları dolaşır.
 *
 * Kapalı kalanlar ve nedeni: açık kayıt yok; üye/davet listeleri öğrenci ve velinin kurumdaki
 * diğer kişileri görmesine yol açar; kurum ve üyelik yönetimi rol kapsamıyla bizde yazılır; kendi
 * rolü `/me`'den gelir (`get-active-member-role` `?userId=` ile başkasının rolünü verir); sosyal
 * giriş olmadığından Expo yetkilendirme vekili (`/expo-authorization-proxy`) açık yönlendirmedir.
 * `GET /reset-password/:token` kapalıdır: sıfırlama bağlantısı API'ye değil doğrudan web'in
 * `/parola-sifirla?token=…` sayfasına gider (`services/password-reset.ts`), belirteç orada
 * `POST /reset-password` ile tüketilir. Yönlendirme ucu `callbackURL` alır; açmak gereksiz bir
 * yönlendirme yüzeyi ve belirtecin API erişim loglarına düşmesi demektir.
 */
export const OPEN_AUTH_PATHS: ReadonlySet<string> = new Set([
  '/sign-in/email',
  '/sign-out',
  '/get-session',
  '/change-password',
  '/request-password-reset',
  '/reset-password',
  '/list-sessions',
  '/revoke-session',
  '/revoke-sessions',
  '/revoke-other-sessions',
  '/organization/list',
  '/organization/set-active',
  '/organization/get-active-member',
])

/** `pathname` Better Auth'a iletilecek isteğin yoludur; sorgu dizesi içermez. */
export function isOpenAuthPath(pathname: string): boolean {
  if (!pathname.startsWith(`${AUTH_BASE_PATH}/`)) return false
  return OPEN_AUTH_PATHS.has(pathname.slice(AUTH_BASE_PATH.length))
}

export function trustedOrigins(config: Config): string[] {
  // Expo Go geliştirme kökenleri yalnız açıkça geliştirme/test ortamında.
  const development = isDevelopmentLike(config) ? ['exp://', 'exp://**'] : []
  return [...config.CORS_ORIGINS, ...config.TRUSTED_ORIGINS, ...development]
}

/** Hassas işlemlerde oturumun en çok yaşı (guvenlik-kvkk.md). */
export const SESSION_FRESH_AGE_SECONDS = 15 * 60
const DAY = 60 * 60 * 24

export interface AuthOptions {
  /** Parola sıfırlama iletisi; verilmezse ortamın varsayılanı (`createMailer`). */
  mailer?: Mailer
  /** Yapılandırılmış log (Fastify logger'ı); verilmezse sessiz. */
  log?: MailLog
}

export function createAuth(config: Config, db: Database, options: AuthOptions = {}) {
  const log = options.log ?? SILENT_MAIL_LOG
  const reset = {
    db,
    secret: config.BETTER_AUTH_SECRET,
    mailer: options.mailer ?? createMailer(config, log),
    webUrl: webUrl(config),
    log,
  }
  return betterAuth({
    appName: 'Kampüs',
    baseURL: publicUrl(config),
    basePath: AUTH_BASE_PATH,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: trustedOrigins(config),
    telemetry: { enabled: false },
    // Better Auth kendi konsol logunu yazar; testte (LOG_LEVEL=silent) susturulur.
    logger: { disabled: config.LOG_LEVEL === 'silent', level: 'warn' },
    database: drizzleAdapter(db, { provider: 'pg', schema, usePlural: true, transaction: true }),
    emailAndPassword: {
      enabled: true,
      // Hesabı kurum açar; herkese açık kayıt yok.
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      // Sıfırlama sonrası bütün oturumlar kapanır; belirteç 30 dk geçerli ve tek kullanımlıktır
      // (Better Auth tüketirken siler).
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 30 * 60,
      // Better Auth'un API'ye işaret eden `url`'i kullanılmaz; bağlantı web sayfasına kurulur.
      sendResetPassword: async ({ user, token }, request) => {
        await deliverPasswordReset(reset, { user, token }, request)
      },
      onPasswordReset: async ({ user }, request) => {
        await recordPasswordResetCompleted(reset, user.id, request)
      },
    },
    verification: {
      // Sıfırlama belirteci veritabanında özetiyle tutulur; tablo sızsa da bağlantı üretilemez.
      storeIdentifier: { default: 'plain', overrides: { 'reset-password:': 'hashed' } },
    },
    session: {
      expiresIn: 14 * DAY,
      updateAge: DAY,
      freshAge: SESSION_FRESH_AGE_SECONDS,
      // Oturum, üyelik ve rol her istekte veritabanından doğrulanır.
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      // v1 tek sunucu örneği; birden çok örnekte paylaşılan depo dağıtım ADR'sinde seçilir.
      storage: 'memory',
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 60 * 60, max: 3 },
        '/reset-password': { window: 15 * 60, max: 5 },
        '/change-password': { window: 15 * 60, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: 'kampus',
      useSecureCookies: useSecureCookies(config),
      ipAddress: { ipAddressHeaders: [FORWARDED_IP_HEADER] },
    },
    databaseHooks: {
      session: {
        create: {
          // Çok üyelikte varsayılan etkin kurum en eski üyeliktir; değişim `/organization/set-active`.
          // Parola değişiminde ("diğer cihazlardan çık") oturum Better Auth işlemi içinde açılır;
          // üyelik o işlemin bağdaştırıcısından okunur (dışarıdan sorgu tek bağlantıda kilitlenir).
          before: async (session, context) => {
            // Aynı kullanıcının oturumu yenileniyorsa (parola değişimi) etkin kurum korunur.
            const previous = context?.context.session
            const kept: unknown = previous
              ? Reflect.get(previous.session, 'activeOrganizationId')
              : null
            if (previous?.user.id === session.userId && typeof kept === 'string')
              return { data: { ...session, activeOrganizationId: kept } }
            const base = context?.context.adapter
            const current = base ? await getCurrentAdapter(base) : undefined
            const activeOrganizationId =
              current && current !== base
                ? await defaultInstitutionIdFromAdapter(current, session.userId)
                : await defaultInstitutionId(db, session.userId)
            return { data: { ...session, activeOrganizationId } }
          },
        },
      },
    },
    hooks: {
      before: authBeforeHook({ db, secret: config.BETTER_AUTH_SECRET }),
      after: authAfterHook({ db, secret: config.BETTER_AUTH_SECRET }),
    },
    plugins: [
      organization({
        ac,
        roles,
        creatorRole: 'yonetici',
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        membershipLimit: 100_000,
        schema: {
          organization: {
            modelName: 'institution',
            additionalFields: {
              type: { type: [...INSTITUTION_TYPES], required: true, defaultValue: 'school' },
              // Modül anahtarı → açık mı. Kurum oluşturma ve güncelleme HTTP uçları kapalıdır.
              enabledModules: { type: 'json', required: true, defaultValue: () => ({}) },
            },
          },
          member: { modelName: 'membership', fields: { organizationId: 'institutionId' } },
          invitation: { fields: { organizationId: 'institutionId' } },
          session: { fields: { activeOrganizationId: 'activeInstitutionId' } },
        },
      }),
      expo(),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
