import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api'
import type { DBTransactionAdapter } from 'better-auth'
import { getOrgAdapter } from 'better-auth/plugins/organization'
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'

import type { Database } from '../db/client.ts'
import { institutions, memberships, sessions, users } from '../db/schema/auth.ts'
import { isWeakPassword } from '../lib/password-policy.ts'
import { recordAudit } from './audit.ts'

/** Parola sıfırlama kancaları (`services/password-reset.ts`); döngüsel içe aktarma olmasın diye dışarıdan verilir. */
export interface PasswordResetHooks {
  throttle(user: { id: string; email: string }): Promise<'cooldown' | 'rate_limited' | null>
  revokeTokens(userId: string): Promise<void>
}

interface HookContext {
  db: Database
  secret: string
  passwordReset?: PasswordResetHooks
}

/** Better Auth'un `request-password-reset` yanıtıyla aynı: hesabın varlığı yanıttan anlaşılmaz. */
const RESET_REQUEST_RESPONSE = {
  status: true,
  message: 'If this email exists in our system, check your email for the reset link',
}

/** Better Auth'a iletilen isteklerde Fastify'nin yazdığı başlıklar (bkz. plugins/better-auth.ts). */
export const FORWARDED_IP_HEADER = 'x-kampus-client-ip'
export const FORWARDED_REQUEST_ID_HEADER = 'x-request-id'

/** Oturum açılırken etkin kurum: kullanıcının en eski etkin (pasifleştirilmemiş) üyeliği. */
export async function defaultInstitutionId(db: Database, userId: string): Promise<string | null> {
  const [first] = await db
    .select({ institutionId: memberships.institutionId })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), isNull(memberships.deactivatedAt)))
    .orderBy(asc(memberships.createdAt), asc(memberships.id))
    .limit(1)
  return first?.institutionId ?? null
}

/**
 * `defaultInstitutionId`'nin Better Auth işlem bağdaştırıcısıyla yazılmışı (yalnız işlem içinde
 * açılan oturum için). Sıra: en eski üyelik, eşitlikte kimlik.
 */
export async function defaultInstitutionIdFromAdapter(
  adapter: DBTransactionAdapter,
  userId: string,
): Promise<string | null> {
  const all = await adapter.findMany<{
    id: string
    organizationId: string
    createdAt: Date
    deactivatedAt?: Date | null
  }>({
    model: 'member',
    where: [{ field: 'userId', value: userId }],
  })
  const rows = all.filter((row) => !row.deactivatedAt)
  rows.sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  return rows[0]?.organizationId ?? null
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

/**
 * Better Auth organization uçları üyeliğin pasifliğini bilmez. Pasifleştirilen üyelik (DOM-YTK-070)
 * bu uçlarda üyelik yokmuş gibi reddedilir: kişi pasif olduğu kuruma geçemez, üyeliğini okuyamaz.
 */
const MEMBERSHIP_PATHS = new Set(['/organization/set-active', '/organization/get-active-member'])

/** Uç hangi kurumun üyeliğine bakacak: `set-active` gövdeden (kimlik ya da kısa ad), öteki oturumdan. */
async function requestedInstitutionId(
  db: Database,
  context: HookEndpointContext,
  activeInstitutionId: string | null,
): Promise<string | null> {
  if (context.path !== '/organization/set-active') return activeInstitutionId
  const body: unknown = context.body
  // `organizationId: null` etkin kurumu kaldırır; üyelik gerekmez.
  if (typeof body === 'object' && body !== null && Reflect.get(body, 'organizationId') === null)
    return null
  const id = stringField(body, 'organizationId')
  if (id) return id
  const slug = stringField(body, 'organizationSlug')
  if (!slug) return activeInstitutionId
  const [row] = await db
    .select({ id: institutions.id })
    .from(institutions)
    .where(eq(institutions.slug, slug))
    .limit(1)
  return row?.id ?? null
}

async function isDeactivatedMember(
  db: Database,
  institutionId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.institutionId, institutionId),
        eq(memberships.userId, userId),
        isNotNull(memberships.deactivatedAt),
      ),
    )
    .limit(1)
  return row !== undefined
}

/**
 * Oturum yönetimi uçları (IST-025). Better Auth `/list-sessions`'ı taze oturumla sınırlar, kapatma
 * uçlarını yalnız geçerli oturumla; burada kapatma da taze oturum ister: ele geçirilmiş eski bir
 * çerez sahibin öteki cihazlarını kapatamaz, sahibi yeniden giriş yapıp hepsini kapatabilir.
 */
const SESSION_REVOKE_PATHS = new Set([
  '/revoke-session',
  '/revoke-sessions',
  '/revoke-other-sessions',
])

/** Better Auth `freshSessionMiddleware`'in kodu ve mesajı (çevirisi `plugins/better-auth.ts`). */
function sessionNotFresh() {
  return new APIError('FORBIDDEN', {
    code: 'SESSION_NOT_FRESH',
    message: 'Session is not fresh',
  })
}

/**
 * `/revoke-session` gövdesindeki oturum kimliğinin belirteci; yalnız isteği yapanın kendi
 * oturumundan. Başkasının ya da olmayan oturum boş belirteç olur, Better Auth hiçbir şey silmez ve
 * yanıt aynıdır (kimliğin varlığı belli olmaz).
 */
async function ownSessionToken(db: Database, userId: string, sessionId: string): Promise<string> {
  const [row] = await db
    .select({ token: sessions.token })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .limit(1)
  return row?.token ?? ''
}

/**
 * Parolası değişecek hesap: oturumdan, sıfırlamada belirtecin doğrulama kaydından (geçersiz
 * belirteçte `null`; Better Auth `INVALID_TOKEN` döndürür).
 */
async function passwordOwner(
  db: Database,
  context: HookEndpointContext,
): Promise<{ id: string; email: string } | null> {
  const session = await getSessionFromCtx(context).catch(() => null)
  if (session) return { id: session.user.id, email: session.user.email }
  if (context.path !== '/reset-password') return null
  const queryToken: unknown = context.query ? Reflect.get(context.query, 'token') : undefined
  const token =
    stringField(context.body, 'token') ?? (typeof queryToken === 'string' ? queryToken : null)
  if (!token) return null
  const verification = await context.context.internalAdapter.findVerificationValue(
    `reset-password:${token}`,
  )
  if (!verification || verification.expiresAt < new Date()) return null
  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, verification.value))
    .limit(1)
  return user ?? null
}

export const WEAK_PASSWORD_MESSAGE =
  'Bu parola çok yaygın veya kişisel bilgilerinize fazla benziyor. Başka bir parola seçin.'

/**
 * Parola politikası, pasif üyeliğin kurum uçlarında reddi ve çıkış kaydı. Çıkıştan sonra oturum
 * silindiği için sahibi önceden okunur.
 */
export function authBeforeHook(ctx: HookContext) {
  return createAuthMiddleware(async (context) => {
    if (PASSWORD_PATHS.has(context.path)) {
      const password =
        stringField(context.body, 'newPassword') ?? stringField(context.body, 'password')
      if (!password) return
      // Sıfırlamada da e-posta ve kurum adı türevi reddedilir: hesap belirteçten çözülür.
      const owner = await passwordOwner(ctx.db, context)
      const email = owner?.email ?? stringField(context.body, 'email')
      const names = owner ? await institutionNames(ctx.db, owner.id) : []
      if (isWeakPassword(password, { email, institutionNames: names }))
        throw new APIError('BAD_REQUEST', {
          code: 'PASSWORD_TOO_COMMON',
          message: WEAK_PASSWORD_MESSAGE,
        })
      return
    }
    if (SESSION_REVOKE_PATHS.has(context.path)) {
      const session = await getSessionFromCtx(context).catch(() => null)
      // Better Auth `sensitiveSessionMiddleware`'in yanıtı; gövde doğrulamasından önce.
      if (!session)
        throw new APIError('UNAUTHORIZED', { code: 'UNAUTHORIZED', message: 'Unauthorized' })
      const freshAge = context.context.sessionConfig.freshAge * 1000
      if (freshAge > 0 && Date.now() - new Date(session.session.createdAt).getTime() >= freshAge)
        throw sessionNotFresh()
      if (context.path !== '/revoke-session') return
      // Belirteç istemciye verilmez; gövdedeki `token` yok sayılır, kimlikten çözülür.
      const sessionId = stringField(context.body, 'sessionId')
      if (!sessionId)
        throw new APIError('BAD_REQUEST', {
          code: 'VALIDATION_ERROR',
          message: 'sessionId is required',
        })
      return {
        context: { body: { token: await ownSessionToken(ctx.db, session.user.id, sessionId) } },
      }
    }
    if (MEMBERSHIP_PATHS.has(context.path)) {
      const session = await getSessionFromCtx(context).catch(() => null)
      if (!session) return
      const activeId: unknown = Reflect.get(session.session, 'activeOrganizationId')
      const institutionId = await requestedInstitutionId(
        ctx.db,
        context,
        typeof activeId === 'string' ? activeId : null,
      )
      if (institutionId && (await isDeactivatedMember(ctx.db, institutionId, session.user.id)))
        // Better Auth'un üye olmayan kişiye verdiği hatanın aynısı (çevirisi `plugins/better-auth.ts`).
        throw new APIError('FORBIDDEN', {
          code: 'USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION',
          message: 'User is not a member of the organization',
        })
      return
    }
    if (context.path === '/request-password-reset' && ctx.passwordReset) {
      const email = stringField(context.body, 'email')?.trim().toLowerCase()
      if (!email) return
      const [user] = await ctx.db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.email, email))
        .limit(1)
      if (!user) return
      const throttled = await ctx.passwordReset.throttle(user)
      if (!throttled) return
      // Kısa devre: işleyici (belirteç satırı, ileti) çalışmaz; denetimde nedeni kalır.
      await recordAudit(ctx, {
        action: 'auth.password_reset_requested',
        entityType: 'user',
        entityId: user.id,
        requestId: context.headers?.get(FORWARDED_REQUEST_ID_HEADER),
        ip: context.headers?.get(FORWARDED_IP_HEADER),
        changes: { reason: throttled },
      })
      return context.json(RESET_REQUEST_RESPONSE)
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

/**
 * Personel daveti (DOM-YTK-070) ilk başarılı girişte kabul edilmiş sayılır: hesap ve üyelik
 * davette açıldığı için kabul yalnız davetin "bekliyor" işaretini kaldırır. Yalnız kurumun açtığı
 * hesapta: davetin açtığı üyelik (`membershipId`) bu kişinindir ve hâlâ vardır. Başka kurumdaki
 * mevcut hesaba yazılmış davet (karar 73) girişle kabul edilmez, üyelik açılmaz; o davetin kabulü
 * kişinin oturumuyla ayrı bir akıştır (TODO(staff-invite-accept), `services/staff-accounts.ts`).
 * Yazma eklentinin bağdaştırıcısıyla.
 */
async function acceptStaffInvitations(
  context: HookEndpointContext,
  user: { id: string; email: string },
): Promise<void> {
  const adapter = context.context.adapter
  const pending = await adapter.findMany<{
    id: string
    organizationId: string
    membershipId?: string | null
  }>({
    model: 'invitation',
    where: [
      { field: 'email', value: user.email.toLowerCase() },
      { field: 'status', value: 'pending' },
    ],
  })
  if (pending.length === 0) return
  const organization = getOrgAdapter(context.context)
  for (const invitation of pending) {
    if (!invitation.membershipId) continue
    const member = await adapter.findOne<{ id: string }>({
      model: 'member',
      where: [
        { field: 'id', value: invitation.membershipId },
        { field: 'userId', value: user.id },
        { field: 'organizationId', value: invitation.organizationId },
      ],
    })
    if (member === null) continue
    await organization.updateInvitation({
      invitationId: invitation.id,
      status: 'accepted',
      fromStatus: 'pending',
    })
  }
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
          await acceptStaffInvitations(context, created.user)
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
        await ctx.passwordReset?.revokeTokens(session.user.id)
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
        // Hesap varsa kayıt gönderimde ya da kısa devrede yazılır; burada yalnız bilinmeyen
        // e-posta (hesap tarama denemesi). Yanıt her durumda aynıdır. E-posta ham yazılmaz.
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
