import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { ROLES } from '../auth.ts'
import { errorResponseSchema, NotFoundError } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  collectionModule,
  countCollection,
  FILTER_FIELDS,
  getCollectionItem,
  listCollection,
  parseSort,
  type CollectionReadQuery,
  type FilterField,
} from '../services/collection-reads.ts'
import { authenticatedErrors } from './common.schemas.ts'
import {
  collectionCountsQuerySchema,
  collectionCountsResponseSchema,
  collectionItemResponseSchema,
  collectionListQuerySchema,
  collectionListResponseSchema,
  collectionParamsSchema,
  collectionRecordParamsSchema,
  collectionRecordQuerySchema,
} from './collections.schemas.ts'

const errors = { ...authenticatedErrors, 404: errorResponseSchema } as const

/**
 * Modül çözücüsü: `preValidation`'da ham yol parametresini okur. Geçersiz ya da bilinmeyen
 * koleksiyon modüle bağlı sayılmaz (`null`): 400/404'ü doğrulama ve servis verir, böylece sıra
 * 401 → modül 403 → 400 → 404 kalır.
 */
function moduleOfRequest(request: FastifyRequest): string | null {
  const params = collectionParamsSchema.safeParse(request.params)
  if (!params.success) return null
  try {
    return collectionModule(params.data.collection)
  } catch (error) {
    if (error instanceof NotFoundError) return null
    throw error
  }
}

type ReadQueryInput = Partial<Record<FilterField, string | string[]>> & {
  q?: string | undefined
  archived?: CollectionReadQuery['archived']
  isActive?: 'true' | 'false' | undefined
  cancelled?: 'true' | 'false' | undefined
  graded?: 'true' | 'false' | undefined
  dateField?: string | undefined
  dateFrom?: string | undefined
  dateTo?: string | undefined
}

/** Liste ve sayım sorgusunun ortak süzgeçleri (şemadan geçmiş sorgu). */
function readQueryOf(query: ReadQueryInput): CollectionReadQuery {
  const filters: Partial<Record<FilterField, readonly string[]>> = {}
  for (const field of FILTER_FIELDS) {
    const value = query[field]
    if (value !== undefined) filters[field] = typeof value === 'string' ? [value] : value
  }
  return {
    q: query.q,
    archived: query.archived,
    filters,
    isActive: query.isActive === undefined ? undefined : query.isActive === 'true',
    states: {
      ...(query.cancelled === undefined ? {} : { cancelled: query.cancelled === 'true' }),
      ...(query.graded === undefined ? {} : { graded: query.graded === 'true' }),
    },
    dateField: query.dateField,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
  }
}

/**
 * Koleksiyon okuma uçları (geçiş köprüsü, api-tasarimi.md §1). Her rol kimlik doğrulamasından
 * geçer; rol, kayıt ve alan kapsamı serviste school-core `scopeFor` ile uygulanır (varsayılan ret).
 */
export function registerCollectionRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  // Sıra sorgu doğrulamasından önce: oturumsuz 401, kapalı modül 403 (`issues` yok), sonra 400.
  const preValidation = [app.requireModule(moduleOfRequest), app.requireRole(ROLES)]

  typed.get(
    '/api/v1/collections/:collection',
    {
      preValidation,
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
      const { page, pageSize, sort } = request.query
      const result = await listCollection(contextOf(request), request.params.collection, {
        ...readQueryOf(request.query),
        page,
        pageSize,
        sort: parseSort(sort),
      })
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )

  // Statik `counts` parçası `/:collection/:id`'den önce eşlenir (kimliği `counts` olan kayıt yok).
  typed.get(
    '/api/v1/collections/:collection/counts',
    {
      preValidation,
      schema: {
        operationId: 'countCollection',
        tags: ['collections'],
        summary: 'Koleksiyon sayımı',
        description:
          'Liste ucuyla aynı kapsam, süzgeç ve aramayla `groupBy` alanına göre grup başına kayıt sayısı; `sum` verilirse grup başına toplam (ör. durum başına taksit sayısı ve tutarı, sınıf başına öğrenci). Kapsam dışı kayıt sayılmaz; rolün göremediği alanla gruplama/toplama 400. Durumlar liste ucuyla aynıdır.',
        params: collectionParamsSchema,
        querystring: collectionCountsQuerySchema,
        response: { 200: collectionCountsResponseSchema, ...errors },
      },
    },
    async (request) => {
      const { groupBy, sum } = request.query
      const result = await countCollection(contextOf(request), request.params.collection, {
        ...readQueryOf(request.query),
        groupBy,
        sum,
      })
      return {
        data: result.groups,
        meta: { total: result.total, ...(result.sum === undefined ? {} : { sum: result.sum }) },
      }
    },
  )

  typed.get(
    '/api/v1/collections/:collection/:id',
    {
      preValidation,
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
