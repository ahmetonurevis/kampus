import { expo } from '@better-auth/expo'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createAccessControl } from 'better-auth/plugins/access'
import { organization } from 'better-auth/plugins/organization'
import { defaultStatements } from 'better-auth/plugins/organization/access'
import { z } from 'zod'

import { publicUrl, type Config } from './config.ts'
import { schema, type Database } from './db/client.ts'
import {
  authAfterHook,
  authBeforeHook,
  defaultInstitutionId,
  FORWARDED_IP_HEADER,
} from './services/auth-hooks.ts'

// Better Auth yapılandırmasının tek yeri (ADR 0002, docs/muhendislik/guvenlik-kvkk.md §1–4).

export const AUTH_BASE_PATH = '/api/v1/auth'

/**
 * Kurum rolleri: school-core rol kaydındaki anahtarlar
 * (`packages/school-core/src/modules/navigation.js` → `roles`). Veri olduğu için değiştirilmez.
 */
export const ROLES = ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli'] as const
export const roleSchema = z.enum(ROLES)
export type Role = z.infer<typeof roleSchema>

/** `school` ders + kazanım, `language_school` CEFR A1–C2 + beceri. */
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
 * Parola sıfırlama e-postası bağlanınca `/reset-password/:token` ayrıca değerlendirilir.
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
  // Expo Go geliştirme kökenleri yalnız üretim dışında.
  const development = config.NODE_ENV === 'production' ? [] : ['exp://', 'exp://**']
  return [...config.CORS_ORIGINS, ...config.TRUSTED_ORIGINS, ...development]
}

const DAY = 60 * 60 * 24

export function createAuth(config: Config, db: Database) {
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
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 30 * 60,
    },
    session: {
      expiresIn: 14 * DAY,
      updateAge: DAY,
      freshAge: 15 * 60,
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
      useSecureCookies: config.NODE_ENV === 'production',
      ipAddress: { ipAddressHeaders: [FORWARDED_IP_HEADER] },
    },
    databaseHooks: {
      session: {
        create: {
          // Çok üyelikte varsayılan etkin kurum en eski üyeliktir; değişim `/organization/set-active`.
          before: async (session) => ({
            data: {
              ...session,
              activeOrganizationId: await defaultInstitutionId(db, session.userId),
            },
          }),
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
