import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { AppError, MESSAGES } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import { changeModule, getModuleSettings } from '../services/institution-modules.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { commandErrors } from './commands.schemas.ts'
import { authenticatedErrors } from './common.schemas.ts'
import {
  moduleChangeResponseSchema,
  moduleHeadersSchema,
  moduleParamsSchema,
  moduleSettingsResponseSchema,
  moduleToggleBodySchema,
} from './modules.schemas.ts'

/**
 * Kurum modül ayarı (DOM-YTK-040, DOM-YTK-042). Kurum oturumdan gelir; yalnız yönetici. Modül
 * kapalıyken ilgili koleksiyon ve komut uçları 403 `module_disabled` döner (`requireModule`).
 */
export function registerModuleRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  typed.get(
    '/api/v1/modules',
    {
      preValidation: app.requireRole(['yonetici']),
      schema: {
        operationId: 'getModuleSettings',
        tags: ['modules'],
        summary: 'Kurum modül ayarları',
        description:
          'Etkin kurumun türünde bulunan modülleri ve açık/kapalı durumlarını ayar sürümüyle döndürür. Yalnız yönetici.',
        response: {
          200: moduleSettingsResponseSchema,
          ...authenticatedErrors,
          404: commandErrors[404],
        },
      },
    },
    async (request) => ({
      data: await getModuleSettings(app.db, contextOf(request).institutionId),
    }),
  )

  typed.patch(
    '/api/v1/modules/:moduleKey',
    {
      preValidation: app.requireRole(['yonetici']),
      schema: {
        operationId: 'setModuleEnabled',
        tags: ['modules'],
        summary: 'Modülü aç veya kapat',
        description:
          'Etkin kurumun modülünü açar veya kapatır. Kapatma veri silmez ve arşivlemez; kayıtlar (gelecek etüt rezervasyonları dahil) modül yeniden açılınca aynen döner. `If-Match` ve `Idempotency-Key` zorunludur. Kurum türünde olmayan modül 422 `module_unavailable_for_type`; durum değişmiyorsa 409 `module_unchanged`. Yalnız yönetici.',
        params: moduleParamsSchema,
        body: moduleToggleBodySchema,
        headers: moduleHeadersSchema,
        response: { 200: moduleChangeResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const idempotency = idempotencyOf(request, true)
      const expectedVersion = ifMatchVersion(request)
      if (expectedVersion === null)
        throw new AppError(400, 'if_match_required', MESSAGES.if_match_required)
      const result = await changeModule(contextOf(request), {
        moduleKey: request.params.moduleKey,
        body: request.body,
        expectedVersion,
        idempotency,
      })
      if (result.replayed) reply.header('idempotent-replayed', 'true')
      reply.status(200)
      return moduleChangeResponseSchema.parse(result.body)
    },
  )
}
