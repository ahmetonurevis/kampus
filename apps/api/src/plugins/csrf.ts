import type { FastifyInstance } from 'fastify'

import { AUTH_BASE_PATH } from '../auth.ts'
import { ForbiddenError } from '../errors.ts'

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Oturum çerezde olduğu için durum değiştiren uygulama isteklerinde kaynak denetlenir.
 * `Origin` göndermeyen yerel istemci (mobil) etkilenmez. Kimlik uçlarını Better Auth denetler.
 */
export function registerCsrfGuard(app: FastifyInstance, allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins)
  app.addHook('onRequest', async (request) => {
    if (!UNSAFE_METHODS.has(request.method) || request.url.startsWith(`${AUTH_BASE_PATH}/`)) return
    const site = request.headers['sec-fetch-site']
    const origin = request.headers.origin
    if (site === 'cross-site' || (origin !== undefined && !allowed.has(origin))) {
      request.log.warn({ event: 'request.csrf_rejected' })
      throw new ForbiddenError('csrf_rejected')
    }
  })
}
