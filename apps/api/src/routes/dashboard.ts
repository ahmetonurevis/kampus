import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { ROLES } from '../auth.ts'
import { errorResponseSchema } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import { getDashboard } from '../services/dashboard.ts'
import { authenticatedErrors } from './common.schemas.ts'
import { dashboardQuerySchema, dashboardResponseSchema } from './dashboard.schemas.ts'

/**
 * Genel Bakış özeti: beş rolün her biri kendi özetini alır. Rol, kurum ve kayıt kapsamı serviste
 * core `scopeFor` ile uygulanır; modül denetimi bölüm başınadır (kapalı modülün bölümü `null`),
 * bu yüzden rota tek modüle bağlanmaz.
 */
export function registerDashboardRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/v1/dashboard',
    {
      preValidation: [app.requireRole(ROLES)],
      schema: {
        operationId: 'getDashboard',
        tags: ['dashboard'],
        summary: 'Genel Bakış özeti',
        description:
          'Etkin rolün Genel Bakış kartları, kısa listeleri ve mini grafik verisi tek yanıtta; yanıt `role` alanıyla ayrılır. Değerler koleksiyon okuma uçlarının (`/collections/:c`, `/collections/:c/counts`) aynı kapsam ve süzgeçleriyle hesaplanır. Okuduğu koleksiyon aktöre kapalı olan bölüm (kapalı modül, kurum türünde olmayan modül, rolün okuyamadığı koleksiyon) `null` döner. Etkin kurum yoksa 403 `no_active_institution`; velide kapsam dışı `studentId` 404.',
        querystring: dashboardQuerySchema,
        response: {
          200: dashboardResponseSchema,
          ...authenticatedErrors,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => ({ data: await getDashboard(contextOf(request), request.query) }),
  )
}
