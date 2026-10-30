import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { contextOf } from '../plugins/authenticate.ts'
import { listAuditEvents } from '../services/audit-events.ts'
import { auditEventListQuerySchema, auditEventListResponseSchema } from './audit-events.schemas.ts'
import { authenticatedErrors } from './common.schemas.ts'

/**
 * Ayarlar → İşlem Geçmişi (DOM-YTK-053). Yalnız yönetici ve yalnız kendi kurumu; kurum oturumdan
 * gelir. Okuma denetim kaydı üretmez (kayıt okumak yeni kayıt doğurup listeyi büyütmesin).
 */
export function registerAuditEventRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/v1/audit-events',
    {
      preValidation: app.requireRole(['yonetici']),
      schema: {
        operationId: 'listAuditEvents',
        tags: ['institution'],
        summary: 'İşlem geçmişi',
        description:
          'Etkin kurumun denetim kayıtlarını en yeniden eskiye sayfalı döndürür: zaman, işlem, varlık, yapan kişi, değişen alan adları ve gerekçe. Değer, mesaj metni, IP ve kullanıcı ajanı dönmez. Rehberlik kayıtlarında alan adı ve kimlik de dönmez (DOM-YTK-020). Tarih süzgeci Europe/Istanbul günüdür. Yalnız yönetici (diğer roller 403). Okuma denetim kaydı üretmez.',
        querystring: auditEventListQuerySchema,
        response: { 200: auditEventListResponseSchema, ...authenticatedErrors },
      },
    },
    async (request) => {
      const ctx = contextOf(request)
      const { page, pageSize, dateFrom, dateTo, actorUserId, entityType } = request.query
      const result = await listAuditEvents(ctx.db, ctx.institutionId, {
        page,
        pageSize,
        dateFrom,
        dateTo,
        actorUserId,
        entityType,
      })
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )
}
