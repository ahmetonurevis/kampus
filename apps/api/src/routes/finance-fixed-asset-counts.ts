import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  fixedAssetCountScanSchema,
  fixedAssetCountSchema,
} from '@kampus/school-core/lib/finance-fixed-asset-counts.ts'
import { FIXED_ASSET_ROLES } from '@kampus/school-core/lib/finance-fixed-assets.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  cancelFixedAssetCountCommand,
  completeFixedAssetCountCommand,
  getFixedAssetCountFor,
  listFixedAssetCountItemsFor,
  listFixedAssetCountsFor,
  listFixedAssetPlacesFor,
  relocateFixedAssetCountItemCommand,
  scanFixedAssetCountCommand,
  startFixedAssetCountCommand,
} from '../services/finance-fixed-asset-counts.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  countItemListQuery,
  countItemListResponse,
  countItemParams,
  countItemResponse,
  countListQuery,
  countListResponse,
  countParams,
  countResponse,
  emptyCommandBody,
  placeListQuery,
  placeListResponse,
  scanResponse,
} from './finance-fixed-asset-counts.schemas.ts'

/**
 * Demirbaş sayımı uçları (docs/domain/finans.md DOM-FIN-087; ON-237). Modül `finance`; okuma ve
 * yazma yalnız yönetici, muhasebe rolü açılınca o da (K-189). Sıra: 401 → 403 modül → 403 rol →
 * `If-Match` → 400 → işlem. Sayım silinmez: `POST …/complete` tamamlar, `POST …/cancel` iptal eder.
 * Okutma sayımın sürümünü artırmaz; aynı sayımı birden çok cihaz okutabilir (kurum kilidi sıraya
 * koyar).
 */

const MANAGER = 'Rol: `yonetici` (muhasebe rolü açılınca o da; K-189). Modül `finance`.'
const URL = '/api/v1/finance/fixed-asset-counts'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceFixedAssetCountRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FIXED_ASSET_ROLES),
  ]
  const tags = ['finance-fixed-assets']

  typed.get(
    URL,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listFixedAssetCounts',
        tags,
        summary: 'Demirbaş sayımlarını listele',
        description: `Süren sayımlar önce, sonra yeni başlayan önce; her satırda beklenen, bulunan, yanlış konumda, okunmayan ve listede olmayan sayıları. \`status\` ile süzülür (DOM-FIN-087). ${MANAGER}`,
        querystring: countListQuery,
        response: { 200: countListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, status } = request.query
      const { items, total } = await listFixedAssetCountsFor(contextOf(request), {
        page,
        pageSize,
        status,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    URL,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'startFixedAssetCount',
        tags,
        summary: 'Demirbaş sayımı başlat',
        description: `Kapsam bütün kurum (\`institution\`), bir kampüs (\`campus\`, \`campusId\`) ya da bir oda (\`location\`, isteğe bağlı \`campusId\` ve \`location\`). Başlarken kapsamdaki hurdaya ayrılmamış demirbaşlar beklenen liste olarak dondurulur; oda konumla harf ve boşluk farkı gözetmeden eşleşir (K-232). Aynı kapsamda süren sayım 409 \`fixed_asset_count_open_exists\` (K-234); olmayan kampüs 422 \`fixed_asset_campus_not_found\`; kapsamda demirbaş yoksa 422 \`fixed_asset_count_empty\`, 5000'den fazlaysa 422 \`fixed_asset_count_too_large\`. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: fixedAssetCountSchema,
        response: { 201: countResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await startFixedAssetCountCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = countResponse.parse(sendBody(reply, result))
      reply.header('location', `${URL}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    `${URL}/:countId`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getFixedAssetCount',
        tags,
        summary: 'Sayım ayrıntısı',
        description: `Kapsam, durum ve özet. Olmayan ya da başka kurumun sayımı 404. ${MANAGER}`,
        params: countParams,
        response: { 200: countResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getFixedAssetCountFor(contextOf(request), request.params.countId),
    }),
  )

  typed.get(
    `${URL}/:countId/items`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listFixedAssetCountItems',
        tags,
        summary: 'Sayım satırları (sonuç raporu)',
        description: `Etiket sırasıyla beklenen ve okutulan demirbaşlar: kayıtlı yer, sayılan yer, sonuç (\`pending\` tamamlanmış sayımda bulunamadı), okutma zamanı ve konum düzeltmesi. \`result\`, \`inScope\` ve \`q\` (etiket, ad) ile süzülür. Rapor CSV'si ve PDF'i istemcide bu satırlardan üretilir; kişi verisi yoktur. ${MANAGER}`,
        params: countParams,
        querystring: countItemListQuery,
        response: { 200: countItemListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, result, inScope, q } = request.query
      const { items, total } = await listFixedAssetCountItemsFor(
        contextOf(request),
        request.params.countId,
        {
          page,
          pageSize,
          result,
          inScope: inScope === undefined ? undefined : inScope === 'true',
          q,
        },
      )
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    `${URL}/:countId/scans`,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'scanFixedAssetCount',
        tags,
        summary: 'Etiket okut',
        description: `Karekod okuyucunun ya da elle yazılan etiket kodu (büyük harfe çevrilir; Türkçe Q düzeninde gelen \`*\` ve \`ç\` geri çevrilir). Kurum ve kampüs sayımında sayılan oda (\`location\`, kurum sayımında isteğe bağlı \`campusId\`) zorunlu, eksikse 422 \`fixed_asset_count_location_required\`; oda sayımında yer sayımın odasıdır. Sayılan yer kayıtlı yerle aynıysa \`found\`, değilse \`misplaced\`; beklenen listede olmayan kurum demirbaşı \`inScope: false\` satırıyla eklenir. Daha önce okunan demirbaş \`already_counted\` döner, değişmez (K-233). Kurumda olmayan kod (başka kurumun etiketi dahil) 422 \`fixed_asset_count_code_unknown\`, hurdaya ayrılmış demirbaş 422 \`fixed_asset_count_asset_scrapped\`, kapanmış sayım 422 \`fixed_asset_count_closed\`, olmayan kampüs 422 \`fixed_asset_campus_not_found\`. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        params: countParams,
        body: fixedAssetCountScanSchema,
        response: { 200: scanResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await scanFixedAssetCountCommand(
        contextOf(request),
        request.params.countId,
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return scanResponse.parse(sendBody(reply, result))
    },
  )

  for (const [verb, operationId, summary, description, command] of [
    [
      'complete',
      'completeFixedAssetCount',
      'Sayımı tamamla',
      'Okunmayan beklenen demirbaşlar bulunamadı raporlanır; demirbaş kayıtları değişmez, bulunamayan hurdaya ayrılmaz (K-235).',
      completeFixedAssetCountCommand,
    ],
    [
      'cancel',
      'cancelFixedAssetCount',
      'Sayımı iptal et',
      'Okutmalar saklanır, sayım raporda iptal görünür; aynı kapsamda yeni sayım açılabilir (K-234).',
      cancelFixedAssetCountCommand,
    ],
  ] as const)
    typed.post(
      `${URL}/:countId/${verb}`,
      {
        preValidation: [...guarded, requireIfMatch(), captureInput()],
        schema: {
          operationId,
          tags,
          summary,
          description: `${description} Yalnız süren sayım kapanır, değilse 422 \`fixed_asset_count_closed\`; sürüm tutmazsa 409 \`version_conflict\`. \`If-Match\` zorunlu. ${MANAGER}`,
          headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
          params: countParams,
          body: emptyCommandBody,
          response: { 200: countResponse, ...commandErrors },
        },
      },
      async (request, reply) => {
        const opts = options(request, 'optional')
        const result = await command(
          contextOf(request),
          request.params.countId,
          expected(opts.expectedVersion),
          opts.idempotency,
        )
        return countResponse.parse(sendBody(reply, result))
      },
    )

  typed.post(
    `${URL}/:countId/items/:itemId/relocate`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'relocateFixedAssetCountItem',
        tags,
        summary: 'Demirbaşın konumunu sayılan yere düzelt',
        description: `Tamamlanmış sayımda yanlış konumda bulunan demirbaşın kampüsü ve konumu okutulduğu yere yazılır; durum ve zimmet değişmez (K-235). Tamamlanmamış sayım 422 \`fixed_asset_count_not_completed\`, yanlış konumda olmayan satır 422 \`fixed_asset_count_item_not_misplaced\`, düzeltilmiş satır 422 \`fixed_asset_count_item_relocated\`, hurdaya ayrılmış demirbaş 422 \`fixed_asset_scrapped\`, artık olmayan kampüs 422 \`fixed_asset_campus_not_found\`. \`If-Match\` satırın sürümüdür. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: countItemParams,
        body: emptyCommandBody,
        response: { 200: countItemResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await relocateFixedAssetCountItemCommand(
        contextOf(request),
        request.params.countId,
        request.params.itemId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return countItemResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    '/api/v1/finance/fixed-asset-places',
    {
      preValidation: guarded,
      schema: {
        operationId: 'listFixedAssetPlaces',
        tags,
        summary: 'Demirbaşların bulunduğu yerler',
        description: `Hurdaya ayrılmamış demirbaşların kampüs ve konumları, her yerde kayıtlı demirbaş sayısıyla; sayım kapsamı ve sayılan oda seçimi için öneri. \`q\` konumda arar, \`campusId\` süzer. ${MANAGER}`,
        querystring: placeListQuery,
        response: { 200: placeListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, campusId } = request.query
      const { items, total } = await listFixedAssetPlacesFor(contextOf(request), {
        page,
        pageSize,
        q,
        campusId,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )
}
