import { fromNodeHeaders } from 'better-auth/node'
import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify'

import { roleSchema, SESSION_FRESH_AGE_SECONDS, type Role } from '../auth.ts'
import type { Database } from '../db/client.ts'
import { AppError, AuthenticationError, ForbiddenError, MESSAGES } from '../errors.ts'
import { findMembership } from '../services/memberships.ts'
import { markEarlyGuard } from './early-guards.ts'

/** Doğrulanmış Better Auth oturumu (etkin kurum gerekmeyen uçlar, ör. `/me`). */
export interface SessionAuth {
  userId: string
  sessionId: string
  activeInstitutionId: string | null
  /** Oturumun açıldığı an; taze oturum denetimi içindir. */
  createdAt: Date
}

/** Etkin kurumda doğrulanmış üyelik. Kurum kimliği yalnız oturumdan gelir. */
export interface RequestAuth {
  userId: string
  institutionId: string
  role: Role
  membershipId: string
}

/** Servis katmanının bağlamı (`.claude/rules/api.md`): servis `request` almaz. */
export interface ServiceContext {
  db: Database
  institutionId: string
  actor: { userId: string; role: Role; membershipId: string }
  now: Date
  log: FastifyBaseLogger
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Oturum + etkin kurum üyeliği; yoksa 401/403. */
    authenticate: preHandlerAsyncHookHandler
    /** Yalnız oturum; etkin kurum gerekmez. */
    authenticateSession: preHandlerAsyncHookHandler
    /** Kimlik + rol denetimi; her kimlikli rota bunu bildirir (varsayılan ret). Yalnız `preValidation`. */
    requireRole: (roles: readonly Role[]) => preHandlerAsyncHookHandler
    /** Hassas işlem: oturum `freshAge`'den eskiyse 403 `reauthentication_required`. */
    requireFreshSession: preHandlerAsyncHookHandler
  }
  interface FastifyRequest {
    authSession: SessionAuth | null
    auth: RequestAuth | null
    ctx: ServiceContext | null
  }
}

export function sessionOf(request: FastifyRequest): SessionAuth {
  if (!request.authSession) throw new AuthenticationError()
  return request.authSession
}

export function authOf(request: FastifyRequest): RequestAuth {
  if (!request.auth) throw new AuthenticationError()
  return request.auth
}

export function contextOf(request: FastifyRequest): ServiceContext {
  if (!request.ctx) throw new AuthenticationError()
  return request.ctx
}

export function registerAuthenticate(app: FastifyInstance) {
  app.decorateRequest('authSession', null)
  app.decorateRequest('auth', null)
  app.decorateRequest('ctx', null)

  async function loadSession(request: FastifyRequest, reply: FastifyReply): Promise<SessionAuth> {
    if (request.authSession) return request.authSession
    const result = await app.auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
      returnHeaders: true,
    })
    // `updateAge` dolduysa Better Auth oturumu uzatır ve yeni çerezi döndürür.
    for (const cookie of result.headers.getSetCookie()) reply.header('set-cookie', cookie)
    const found = result.response
    if (!found) throw new AuthenticationError()
    request.authSession = {
      userId: found.user.id,
      sessionId: found.session.id,
      activeInstitutionId: found.session.activeOrganizationId ?? null,
      createdAt: found.session.createdAt,
    }
    return request.authSession
  }

  async function loadAuth(request: FastifyRequest, reply: FastifyReply): Promise<RequestAuth> {
    if (request.auth) return request.auth
    const session = await loadSession(request, reply)
    const institutionId = session.activeInstitutionId
    if (!institutionId) throw new ForbiddenError('no_active_institution')
    // Üyelik her istekte okunur: kaldırılan üyelik veya değişen rol hemen geçerli olur.
    const membership = await findMembership(app.db, institutionId, session.userId)
    if (!membership) throw new ForbiddenError('no_active_institution')
    const role = roleSchema.safeParse(membership.role)
    if (!role.success) throw new ForbiddenError()
    const auth: RequestAuth = {
      userId: session.userId,
      institutionId,
      role: role.data,
      membershipId: membership.id,
    }
    request.auth = auth
    request.log = request.log.child({ institutionId, userId: auth.userId })
    request.ctx = {
      db: app.db,
      institutionId,
      actor: { userId: auth.userId, role: auth.role, membershipId: auth.membershipId },
      now: app.clock(),
      log: request.log,
    }
    return auth
  }

  app.decorate('authenticateSession', async function (request, reply) {
    await loadSession(request, reply)
  } satisfies preHandlerAsyncHookHandler)

  app.decorate('requireFreshSession', async function (request, reply) {
    const session = await loadSession(request, reply)
    if (app.clock().getTime() - session.createdAt.getTime() > SESSION_FRESH_AGE_SECONDS * 1000)
      throw new AppError(403, 'reauthentication_required', MESSAGES.reauthentication_required)
  } satisfies preHandlerAsyncHookHandler)

  app.decorate('authenticate', async function (request, reply) {
    await loadAuth(request, reply)
  } satisfies preHandlerAsyncHookHandler)

  app.decorate('requireRole', (roles: readonly Role[]): preHandlerAsyncHookHandler => {
    const allowed = new Set<Role>(roles)
    return markEarlyGuard(async function (request, reply) {
      const auth = await loadAuth(request, reply)
      if (!allowed.has(auth.role)) {
        request.log.info({ event: 'auth.role_denied', role: auth.role })
        throw new ForbiddenError()
      }
    })
  })
}
