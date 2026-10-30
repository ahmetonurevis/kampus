import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { ROLES } from '../auth.ts'
import { errorResponseSchema } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  collectionModule,
  FILTER_FIELDS,
  getCollectionItem,
  listCollection,
  parseSort,
  type FilterField,
} from '../services/collection-reads.ts'
import { authenticatedErrors } from './common.schemas.ts'
import {
  collectionItemResponseSchema,
  collectionListQuerySchema,
  collectionListResponseSchema,
  collectionParamsSchema,
  collectionRecordParamsSchema,
  collectionRecordQuerySchema,
} from './collections.schemas.ts'

const errors = { ...authenticatedErrors, 404: errorResponseSchema } as const

/** Modül çözücüsü: yol doğrulandıktan sonra çalışır; bilinmeyen koleksiyon burada 404 olur. */
function moduleOfRequest(request: FastifyRequest): string | null {
  const { collection } = collectionParamsSchema.parse(request.params)
  return collectionModule(collection)
}

/**
 * Koleksiyon okuma uçları (geçiş köprüsü, api-tasarimi.md §1). Her rol kimlik doğrulamasından
 * geçer; rol, kayıt ve alan kapsamı serviste school-core `scopeFor` ile uygulanır (varsayılan ret).
 */
export function registerCollectionRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const preHandler = [app.requireRole(ROLES), app.requireModule(moduleOfRequest)]

  typed.get(
    '/api/v1/collections/:collection',
    {
      preHandler,
      schema: {
        operationId: 'listCollection',
        tags: ['collections'],
        summary: 'Koleksiyon kayıtları',
        description:
          'Etkin kurumun koleksiyon kayıtlarını rol kapsamıyla, sayfalı döndürür. Kapalı modül 403 `module_disabled`, rolün okuyamadığı koleksiyon 403 `forbidden`, bilinmeyen koleksiyon veya kurum türünde bulunmayan modülün koleksiyonu 404.',
        params: collectionParamsSchema,
        querystring: collectionListQuerySchema,
        response: { 200: collectionListResponseSchema, ...errors },
      },
    },
    async (request) => {
      const { page, pageSize, q, sort, archived, isActive, dateFrom, dateTo } = request.query
      const filters: Partial<Record<FilterField, readonly string[]>> = {}
      for (const field of FILTER_FIELDS) {
        const value = request.query[field]
        if (value !== undefined) filters[field] = typeof value === 'string' ? [value] : value
      }
      const result = await listCollection(contextOf(request), request.params.collection, {
        page,
        pageSize,
        q,
        sort: parseSort(sort),
        archived,
        filters,
        isActive: isActive === undefined ? undefined : isActive === 'true',
        dateFrom,
        dateTo,
      })
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )

  typed.get(
    '/api/v1/collections/:collection/:id',
    {
      preHandler,
      schema: {
        operationId: 'getCollectionRecord',
        tags: ['collections'],
        summary: 'Koleksiyon kaydı',
        description:
          'Tek kayıt. Yok, arşivde, başka kuruma ait veya aktörün kapsamı dışındaki kayıt 404 (varlığı sızdırılmaz); kapsam ve modül kuralları listeyle aynıdır.',
        params: collectionRecordParamsSchema,
        querystring: collectionRecordQuerySchema,
        response: { 200: collectionItemResponseSchema, ...errors },
      },
    },
    async (request) => ({
      data: await getCollectionItem(
        contextOf(request),
        request.params.collection,
        request.params.id,
        { archived: request.query.archived },
      ),
    }),
  )
}
