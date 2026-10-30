import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { errorResponseSchema, UnavailableError } from '../errors.ts'
import { pingDatabase } from '../services/health.ts'
import { healthResponseSchema } from './health.schemas.ts'

/** Açık uç: kimlik gerektirmez, kişisel veri döndürmez. */
export function registerHealthRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/v1/health',
    {
      config: { rateLimit: false },
      schema: {
        operationId: 'getHealth',
        tags: ['system'],
        summary: 'Sağlık kontrolü',
        description: 'Sunucunun ve veritabanı bağlantısının durumunu döndürür. Kimlik gerektirmez.',
        response: { 200: healthResponseSchema, 503: errorResponseSchema },
      },
    },
    async () => {
      if (!(await pingDatabase(app.db))) throw new UnavailableError()
      return { data: { status: 'ok' as const, database: 'ok' as const } }
    },
  )
}
