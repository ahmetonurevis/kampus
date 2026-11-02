import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api'
import { asc, eq } from 'drizzle-orm'

import type { Database } from '../db/client.ts'
import { institutions, memberships, users } from '../db/schema/auth.ts'
import { isWeakPassword } from '../lib/password-policy.ts'
import { recordAudit } from './audit.ts'

interface HookContext {
  db: Database
  secret: string
}

/** Better Auth'a iletilen isteklerde Fastify'nin yazdığı başlıklar (bkz. plugins/better-auth.ts). */
export const FORWARDED_IP_HEADER = 'x-kampus-client-ip'
export const FORWARDED_REQUEST_ID_HEADER = 'x-request-id'

/** Oturum açılırken etkin kurum: kullanıcının en eski üyeliği. */
export async function defaultInstitutionId(db: Database, userId: string): Promise<string | null> {
  const [first] = await db
    .select({ institutionId: memberships.institutionId })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt), asc(memberships.id))
    .limit(1)
  return first?.institutionId ?? null
}

async function institutionNames(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ name: institutions.name })
    .from(memberships)
    .innerJoin(institutions, eq(institutions.id, memberships.institutionId))
    .where(eq(memberships.userId, userId))
  return rows.map((row) => row.name)
}

function stringField(body: unknown, key: string): string | null {
  if (typeof body !== 'object' || body === null || !(key in body)) return null
  const value: unknown = Reflect.get(body, key)
  return typeof value === 'string' ? value : null
}

const PASSWORD_PATHS = new Set(['/sign-up/email', '/reset-password', '/change-password'])

export const WEAK_PASSWORD_MESSAGE =
  'Bu parola çok yaygın veya kişisel bilgilerinize fazla benziyor. Başka bir parola seçin.'

/** Parola politikası ve çıkış kaydı. Çıkıştan sonra oturum silindiği için sahibi önceden okunur. */
export function authBeforeHook(ctx: HookContext) {
  return createAuthMiddleware(async (context) => {
    if (PASSWORD_PATHS.has(context.path)) {
      const password =
        stringField(context.body, 'newPassword') ?? stringField(context.body, 'password')
      if (!password) return
      const session = await getSessionFromCtx(context).catch(() => null)
      const email = session?.user.email ?? stringField(context.body, 'email')
      const names = session ? await institutionNames(ctx.db, session.user.id) : []
      if (isWeakPassword(password, { email, institutionNames: names }))
        throw new APIError('BAD_REQUEST', {
          code: 'PASSWORD_TOO_COMMON',
          message: WEAK_PASSWORD_MESSAGE,
        })
      return
    }
    if (context.path === '/sign-out') {
      const session = await getSessionFromCtx(context).catch(() => null)
      if (!session) return
      await recordAudit(ctx, {
        action: 'auth.logout',
        actorUserId: session.user.id,
        institutionId: session.session.activeOrganizationId,
        requestId: context.headers?.get(FORWARDED_REQUEST_ID_HEADER),
        ip: context.headers?.get(FORWARDED_IP_HEADER),
      })
    }
  })
}

type HookEndpointContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]

/**
 * Sonra-kancasında uç bağlamındaki `session` görünmez; yeni oturum (çerez yenilendiyse) ya da
 * istek çerezindeki oturum okunur.
 */
async function hookSession(context: HookEndpointContext) {
  const created = context.context.newSession
  if (created) return created
  return getSessionFromCtx(context).catch(() => null)
}

/** Giriş başarısı/başarısızlığı, kurum değişimi ve parola değişimi. Parola ve belirteç yazılmaz. */
export function authAfterHook(ctx: HookContext) {
  return createAuthMiddleware(async (context) => {
    const requestId = context.headers?.get(FORWARDED_REQUEST_ID_HEADER)
    const ip = context.headers?.get(FORWARDED_IP_HEADER)
    const failed = isAPIError(context.context.returned)
    switch (context.path) {
      case '/sign-in/email': {
        const created = context.context.newSession
        if (created && !failed) {
          await recordAudit(ctx, {
            action: 'auth.login_succeeded',
            actorUserId: created.user.id,
            institutionId: created.session.activeOrganizationId,
            requestId,
            ip,
          })
          return
        }
        const email = stringField(context.body, 'email')?.trim().toLowerCase()
        const [user] = email
          ? await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
          : []
        await recordAudit(ctx, {
          action: 'auth.login_failed',
          actorUserId: user?.id,
          requestId,
          ip,
          changes: { reason: user ? 'invalid_password' : 'unknown_user' },
        })
        return
      }
      case '/organization/set-active': {
        if (failed) return
        const session = await hookSession(context)
        if (!session) return
        const returned: unknown = context.context.returned
        await recordAudit(ctx, {
          action: 'auth.institution_switched',
          actorUserId: session.user.id,
          institutionId: stringField(returned, 'id'),
          requestId,
          ip,
        })
        return
      }
      case '/change-password': {
        if (failed) return
        const session = await hookSession(context)
        if (!session) return
        await recordAudit(ctx, {
          action: 'auth.password_changed',
          actorUserId: session.user.id,
          institutionId: session.session.activeOrganizationId,
          requestId,
          ip,
        })
        return
      }
      case '/request-password-reset': {
        // Hesap varsa kayıt gönderimde yazılır (`deliverPasswordReset`); burada yalnız bilinmeyen
        // e-posta (hesap tarama denemesi). Yanıt iki durumda da aynıdır.
        if (failed) return
        const email = stringField(context.body, 'email')?.trim().toLowerCase()
        const [user] = email
          ? await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
          : []
        if (user) return
        await recordAudit(ctx, {
          action: 'auth.password_reset_requested',
          requestId,
          ip,
          changes: { reason: 'unknown_user' },
        })
        return
      }
      default:
        return
    }
  })
}
