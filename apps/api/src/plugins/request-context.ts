import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

import type { FastifyInstance } from 'fastify'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** İstemci UUID biçiminde `X-Request-Id` gönderirse korunur; aksi halde yenisi üretilir. */
export function genRequestId(request: IncomingMessage): string {
  const header = request.headers['x-request-id']
  return typeof header === 'string' && UUID.test(header) ? header : randomUUID()
}

export function registerRequestContext(app: FastifyInstance) {
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id)
    // Uygulama yanıtları kişisel veri taşıyabilir; ara katman önbelleklerine yazılmaz.
    if (request.url.startsWith('/api/v1/')) reply.header('cache-control', 'no-store')
  })
}
