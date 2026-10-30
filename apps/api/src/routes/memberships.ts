import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { contextOf } from '../plugins/authenticate.ts'
import { listInstitutionMemberships } from '../services/memberships.ts'
import { authenticatedErrors } from './common.schemas.ts'
import { membershipListQuerySchema, membershipListResponseSchema } from './memberships.schemas.ts'

export function registerMembershipRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/v1/memberships',
    {
      preHandler: app.requireRole(['yonetici', 'onburo']),
      schema: {
        operationId: 'listMemberships',
        tags: ['memberships'],
        summary: 'Kurum üyeleri',
        description:
          'Etkin kurumun üyelerini sayfalı döndürür. Kurum oturumdan gelir; sorguda kurum kimliği kabul edilmez.',
        querystring: membershipListQuerySchema,
        response: { 200: membershipListResponseSchema, ...authenticatedErrors },
      },
    },
    async (request) => {
      const ctx = contextOf(request)
      const { page, pageSize, role } = request.query
      const result = await listInstitutionMemberships(ctx.db, ctx.institutionId, {
        page,
        pageSize,
        role,
      })
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )
}
