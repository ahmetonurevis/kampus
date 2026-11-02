import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { AUTH_BASE_PATH, isOpenAuthPath, type Auth } from '../auth.ts'
import { MESSAGES } from '../errors.ts'
import { narrowSessionList } from '../lib/session-device.ts'
import {
  FORWARDED_IP_HEADER,
  FORWARDED_REQUEST_ID_HEADER,
  WEAK_PASSWORD_MESSAGE,
} from '../services/auth-hooks.ts'

/**
 * Better Auth hata kodlarının Türkçe mesajları. Yanıt biçimi Better Auth'undur (`{ code, message }`,
 * istemcisi bunu okur); yalnız `message` Türkçeleştirilir. Listede olmayan kod durumun genel
 * mesajını alır, İngilizce metin kullanıcıya dönmez.
 */
const AUTH_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'E-posta veya parola hatalı.',
  INVALID_EMAIL: 'Geçerli bir e-posta adresi girin.',
  INVALID_PASSWORD: 'Parola hatalı.',
  PASSWORD_TOO_SHORT: 'Parola en az 12 karakter olmalı.',
  PASSWORD_TOO_LONG: 'Parola en fazla 128 karakter olabilir.',
  PASSWORD_TOO_COMMON: WEAK_PASSWORD_MESSAGE,
  EMAIL_NOT_VERIFIED: 'E-posta adresiniz doğrulanmamış.',
  SESSION_EXPIRED: 'Oturumunuzun süresi doldu. Yeniden giriş yapın.',
  SESSION_NOT_FRESH: 'Bu işlem için yeniden giriş yapın.',
  INVALID_TOKEN: 'Bağlantının süresi dolmuş veya geçersiz.',
  TOKEN_EXPIRED: 'Bağlantının süresi dolmuş.',
  INVALID_ORIGIN: MESSAGES.csrf_rejected,
  MISSING_OR_NULL_ORIGIN: MESSAGES.csrf_rejected,
  CROSS_SITE_NAVIGATION_LOGIN_BLOCKED: MESSAGES.csrf_rejected,
  VALIDATION_ERROR: MESSAGES.validation_failed,
  MISSING_FIELD: MESSAGES.validation_failed,
  BODY_MUST_BE_AN_OBJECT: MESSAGES.bad_request,
  FIELD_NOT_ALLOWED: 'Bu alan değiştirilemez.',
  ORGANIZATION_NOT_FOUND: 'Kurum bulunamadı.',
  USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION: 'Bu kurumda üyeliğiniz bulunmuyor.',
  YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION: 'Bu kurumda üyeliğiniz bulunmuyor.',
  YOU_ARE_NOT_ALLOWED_TO_ACCESS_THIS_ORGANIZATION: 'Bu kuruma erişim yetkiniz yok.',
  NO_ACTIVE_ORGANIZATION: MESSAGES.no_active_institution,
  MEMBER_NOT_FOUND: 'Üyelik bulunamadı.',
}

const STATUS_MESSAGES: Record<number, string> = {
  401: MESSAGES.unauthenticated,
  403: MESSAGES.forbidden,
  404: MESSAGES.not_found,
  429: MESSAGES.rate_limited,
}

const SKIPPED_REQUEST_HEADERS = new Set([
  FORWARDED_IP_HEADER,
  FORWARDED_REQUEST_ID_HEADER,
  'content-length',
  'transfer-encoding',
  'connection',
])
const SKIPPED_RESPONSE_HEADERS = new Set(['content-length', 'set-cookie', 'transfer-encoding'])

function toFetchRequest(request: FastifyRequest, base: string): Request {
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined || SKIPPED_REQUEST_HEADERS.has(key)) continue
    for (const item of Array.isArray(value) ? value : [value]) headers.append(key, item)
  }
  // IP'yi Fastify belirler (TRUST_PROXY); istemcinin gönderdiği aynı adlı başlık silinmiştir.
  headers.set(FORWARDED_IP_HEADER, request.ip)
  headers.set(FORWARDED_REQUEST_ID_HEADER, request.id)
  // Gövde ham metin olarak iletilir (aşağıdaki ayrıştırıcı); yeniden serileştirilmez.
  const body = typeof request.body === 'string' && request.body.length > 0 ? request.body : null
  return new Request(new URL(request.url, base), {
    method: request.method,
    headers,
    ...(body !== null && request.method !== 'GET' ? { body } : {}),
  })
}

function parseObject(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value } : {}
  } catch {
    // Better Auth hata gövdesi JSON değilse yalnız Türkçe mesaj döner.
    return {}
  }
}

export function translateAuthError(status: number, text: string): Record<string, unknown> {
  const body = parseObject(text)
  const code = typeof body.code === 'string' ? body.code : undefined
  const message =
    (code ? AUTH_MESSAGES[code] : undefined) ??
    STATUS_MESSAGES[status] ??
    (status >= 500 ? MESSAGES.internal_error : MESSAGES.bad_request)
  return { ...body, ...(code ? {} : { code: status === 429 ? 'RATE_LIMITED' : 'ERROR' }), message }
}

const LIST_SESSIONS_PATH = `${AUTH_BASE_PATH}/list-sessions`

/**
 * `/list-sessions` yanıtı daraltılır (KVKK, `lib/session-device.ts`): ham IP ve kullanıcı ajanı
 * yerine cihaz özeti, isteği yapan oturum `current` ile işaretli. Better Auth istemcisinin
 * `listSessions` tipi bu yüzden kullanılmaz; web/mobil `SessionListItem` biçimini okur.
 */
async function narrowSessions(auth: Auth, request: Request, response: Response) {
  const body: unknown = await response.json()
  const current = await auth.api.getSession({ headers: request.headers }).catch(() => null)
  const narrowed = narrowSessionList(body, current?.session.token ?? null)
  const headers = new Headers(response.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(narrowed), { status: response.status, headers })
}

async function relayResponse(reply: FastifyReply, response: Response) {
  reply.status(response.status)
  response.headers.forEach((value, key) => {
    if (!SKIPPED_RESPONSE_HEADERS.has(key)) reply.header(key, value)
  })
  for (const cookie of response.headers.getSetCookie()) reply.header('set-cookie', cookie)
  const retryAfter = response.headers.get('x-retry-after')
  if (response.status === 429 && retryAfter) reply.header('retry-after', retryAfter)
  const text = response.body ? await response.text() : ''
  if (response.status < 400) return text
  reply.header('content-type', 'application/json; charset=utf-8')
  return translateAuthError(response.status, text)
}

/**
 * Better Auth uçlarını (`/api/v1/auth/*`) Fastify'ye bağlar. Yalnız `OPEN_AUTH_PATHS` iletilir;
 * hız sınırını Better Auth uygular.
 */
export async function registerBetterAuth(app: FastifyInstance, auth: Auth, base: string) {
  await app.register(async (scope) => {
    // Kimlik uçlarında JSON gövde ham metin kalır; boş gövdeli POST (ör. çıkış) da kabul edilir.
    // Better Auth gövdeyi kendisi ayrıştırır ve doğrular.
    scope.removeContentTypeParser('application/json')
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) =>
      done(null, body),
    )
    registerAuthRoute(scope, auth, base)
  })
}

function registerAuthRoute(app: FastifyInstance, auth: Auth, base: string) {
  app.route({
    method: ['GET', 'POST'],
    url: `${AUTH_BASE_PATH}/*`,
    schema: { hide: true },
    config: { rateLimit: false },
    async handler(request, reply) {
      const fetchRequest = toFetchRequest(request, base)
      // İzin listesi, Better Auth'un yönlendireceği normalleştirilmiş yol üzerinde denetlenir.
      const pathname = new URL(fetchRequest.url).pathname
      if (!isOpenAuthPath(pathname)) return reply.callNotFound()
      const response = await auth.handler(fetchRequest)
      if (pathname === LIST_SESSIONS_PATH && response.status === 200)
        return relayResponse(reply, await narrowSessions(auth, fetchRequest, response))
      return relayResponse(reply, response)
    },
  })
}
