import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { contextOf } from '../plugins/authenticate.ts'
import { listInstitutionMembers } from '../services/institution-members.ts'
import { authenticatedErrors } from './common.schemas.ts'
import {
  institutionMemberListQuerySchema,
  institutionMemberListResponseSchema,
} from './institution-members.schemas.ts'

/**
 * Ayarlar → Kullanıcı & Yetkiler (DOM-YTK-020). Yalnız yönetici; kurum oturumdan gelir, sorguda
 * kurum kimliği kabul edilmez. Yalnız okuma: davet, rol değiştirme ve pasifleştirme ayrı görevdir.
 */
export function registerInstitutionMemberRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/v1/institution-members',
    {
      preValidation: app.requireRole(['yonetici']),
      schema: {
        operationId: 'listInstitutionMembers',
        tags: ['institution'],
        summary: 'Kurum kullanıcıları',
        description:
          'Etkin kurumun üyelerini görünen ad, rol, durum, bağlı kişi ve oluşturulma tarihiyle sayfalı döndürür. E-posta yalnız yöneticiye döner; telefon, parola, oturum ve IP dönmez. Yalnız yönetici (diğer roller 403). Okuma denetim kaydı üretmez.',
        querystring: institutionMemberListQuerySchema,
        response: { 200: institutionMemberListResponseSchema, ...authenticatedErrors },
      },
    },
    async (request) => {
      const ctx = contextOf(request)
      const { page, pageSize, q, role, status, sort } = request.query
      const result = await listInstitutionMembers(ctx.db, ctx.institutionId, {
        page,
        pageSize,
        q,
        role,
        status,
        sort,
      })
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )
}
