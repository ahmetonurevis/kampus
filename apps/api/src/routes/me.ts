import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { sessionOf } from '../plugins/authenticate.ts'
import { describeSession } from '../services/me.ts'
import { authenticatedErrors } from './common.schemas.ts'
import { meResponseSchema } from './me.schemas.ts'

export function registerMeRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/v1/me',
    {
      // Etkin kurumu olmayan kullanıcı da kendi üyeliklerini görüp kurum seçebilmeli.
      preHandler: app.authenticateSession,
      schema: {
        operationId: 'getMe',
        tags: ['session'],
        summary: 'Oturumdaki kullanıcı',
        description:
          'Oturum sahibinin kimliğini, etkin kurumunu, etkin üyeliğini ve bütün üyeliklerini döndürür.',
        response: { 200: meResponseSchema, ...authenticatedErrors },
      },
    },
    async (request) => ({ data: await describeSession(app.db, sessionOf(request)) }),
  )
}
