import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FIXED_ASSET_ROLES,
  fixedAssetSchema,
  scrapFixedAssetSchema,
  updateFixedAssetSchema,
} from '@kampus/school-core/lib/finance-fixed-assets.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  createFixedAssetCommand,
  getFixedAssetFor,
  listFixedAssetReceiptItemsFor,
  listFixedAssetsFor,
  scrapFixedAssetCommand,
  updateFixedAssetCommand,
} from '../services/finance-fixed-assets.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  fixedAssetListQuery,
  fixedAssetListResponse,
  fixedAssetParams,
  fixedAssetReceiptItemsQuery,
  fixedAssetReceiptItemsResponse,
  fixedAssetResponse,
} from './finance-fixed-assets.schemas.ts'

/**
 * Demirbaş uçları (docs/domain/finans.md DOM-FIN-085; ON-235). Modül `finance`; okuma ve yazma
 * yalnız yönetici, muhasebe rolü açılınca o da (K-189). Sıra: 401 → 403 modül → 403 rol →
 * `If-Match` → 400 → işlem. Demirbaş silinmez: `PATCH` düzeltir, `POST …/scrap` hurdaya ayırır.
 */

const MANAGER = 'Rol: `yonetici` (muhasebe rolü açılınca o da; K-189). Modül `finance`.'
const URL = '/api/v1/finance/fixed-assets'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceFixedAssetRoutes(app: FastifyInstance) {
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
        operationId: 'listFixedAssets',
        tags,
        summary: 'Demirbaşları listele',
        description: `Hurdaya ayrılmamışlar önce, etiket numarasına göre; \`q\` etiket, ad ve konumda arar, \`status\`, \`category\`, \`campusId\` ve \`supplierId\` ile süzülür (DOM-FIN-085). ${MANAGER}`,
        querystring: fixedAssetListQuery,
        response: { 200: fixedAssetListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listFixedAssetsFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${URL}/receipt-items`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listFixedAssetReceiptItems',
        tags,
        summary: 'Demirbaş bağlanabilecek mal kabul kalemleri',
        description: `İptal edilmemiş kabullerde kabul edilen miktarı, bağlı demirbaş sayısından büyük olan kalemler; yeni kabul önce. Her demirbaş bir adettir (K-187). ${MANAGER}`,
        querystring: fixedAssetReceiptItemsQuery,
        response: { 200: fixedAssetReceiptItemsResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q } = request.query
      const { items, total } = await listFixedAssetReceiptItemsFor(contextOf(request), {
        page,
        pageSize,
        q,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    URL,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createFixedAsset',
        tags,
        summary: 'Demirbaş kaydet',
        description: `Etiket (boşsa kayıt yılının sıradaki \`DB-<yıl>-<sıra>\` etiketi; elle girilen büyük harfe çevrilir, K-185), ad, kategori (K-186), isteğe bağlı kampüs, konum, KDV hariç alım değeri (kuruş), alım günü, isteğe bağlı tedarikçi ve mal kabul kalemi, durum (\`in_use\`, \`in_storage\`, \`broken\`). Etiket kurumda tekil: 409 \`fixed_asset_tag_exists\`. Gelecek gün 422 \`fixed_asset_date_in_future\`; olmayan kampüs 422 \`fixed_asset_campus_not_found\`, tedarikçi 422 \`fixed_asset_supplier_not_found\`, kabul kalemi 422 \`fixed_asset_receipt_item_not_found\`; iptal edilmiş kabul 422 \`fixed_asset_receipt_cancelled\`; kalemin bütün adedine demirbaş bağlıysa 422 \`fixed_asset_receipt_quantity_exceeded\` (K-187); siparişten başka tedarikçi 422 \`fixed_asset_supplier_mismatch\`; kabul gününden önceki alım günü 422 \`fixed_asset_date_before_receipt\`. Kabule bağlı kayıtta tedarikçi boşsa siparişin tedarikçisi yazılır. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: fixedAssetSchema,
        response: { 201: fixedAssetResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createFixedAssetCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = fixedAssetResponse.parse(sendBody(reply, result))
      reply.header('location', `${URL}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    `${URL}/:assetId`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getFixedAsset',
        tags,
        summary: 'Demirbaş ayrıntısı',
        description: `Kampüs adı, tedarikçi, mal kabul bağı (sipariş numarası, kalem, kabul günü, iptal edildi mi) ve hurdaya ayırma izi. Olmayan ya da başka kurumun demirbaşı 404. ${MANAGER}`,
        params: fixedAssetParams,
        response: { 200: fixedAssetResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getFixedAssetFor(contextOf(request), request.params.assetId),
    }),
  )

  typed.patch(
    `${URL}/:assetId`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateFixedAsset',
        tags,
        summary: 'Demirbaşı düzelt ya da durumunu değiştir',
        description: `Kısmi düzeltme; durum kullanımda, depoda ve arızalı arasında değişir, hurdaya ayırma ayrı uçtur. Hurdaya ayrılmış demirbaş 422 \`fixed_asset_scrapped\`. Yalnız değişen bağ yeniden denetlenir; kurallar ve kodlar kayıttakiyle aynıdır. Sürüm tutmazsa 409 \`version_conflict\`. \`If-Match\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: fixedAssetParams,
        body: updateFixedAssetSchema,
        response: { 200: fixedAssetResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateFixedAssetCommand(
        contextOf(request),
        request.params.assetId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return fixedAssetResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${URL}/:assetId/scrap`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'scrapFixedAsset',
        tags,
        summary: 'Demirbaşı hurdaya ayır',
        description: `Gerekçe (5–500 karakter) ve gün ister; kayıt silinmez, geri alınmaz (K-188). Zaten hurdaya ayrılmış 422 \`fixed_asset_scrapped\`, gelecek gün 422 \`fixed_asset_date_in_future\`, alım gününden önceki gün 422 \`fixed_asset_scrap_before_acquisition\`. \`If-Match\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: fixedAssetParams,
        body: scrapFixedAssetSchema,
        response: { 200: fixedAssetResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await scrapFixedAssetCommand(
        contextOf(request),
        request.params.assetId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return fixedAssetResponse.parse(sendBody(reply, result))
    },
  )
}
