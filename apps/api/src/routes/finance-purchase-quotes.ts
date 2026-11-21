import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  PURCHASE_QUOTE_ROLES,
  PURCHASE_QUOTE_SELECT_ROLES,
  purchaseQuoteSchema,
  selectPurchaseQuoteSchema,
  updatePurchaseQuoteSchema,
} from '@kampus/school-core/lib/finance-purchase-quotes.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  createQuoteCommand,
  getQuoteBoardFor,
  removeQuoteCommand,
  selectQuoteCommand,
  updateQuoteCommand,
} from '../services/finance-purchase-quotes.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  quoteBoardResponse,
  quoteParams,
  quoteRequestParams,
} from './finance-purchase-orders.schemas.ts'

/**
 * Satın alma teklifi uçları (docs/domain/finans.md DOM-FIN-072; ON-224). Modül `finance`. Teklifi
 * yönetici ve ön büro girer (ön büro yalnız kendi teklifini düzeltir ve siler, 403
 * `purchase_quote_not_owner`); seçim yalnız yönetici (K-136). Her komut karşılaştırma tablosunun
 * tamamını döndürür. Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 → işlem.
 */

const STAFF =
  'Roller: `yonetici`, `onburo`; ön büro yalnız kendi girdiği teklifi değiştirir (K-136). Modül `finance`.'
const MANAGER = 'Rol: `yonetici` (K-136). Modül `finance`.'
const IF_MATCH = '`If-Match` (teklif sürümü) zorunlu; sürüm tutmazsa 409 `version_conflict`.'
const LOCKED =
  'Talep onaylı değilse 422 `purchase_quote_request_not_approved`, talebin etkin siparişi varsa 422 `purchase_quote_locked`.'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinancePurchaseQuoteRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    finance,
    app.requireRole(roles),
  ]
  const tags = ['finance-procurement']
  const base = '/api/v1/finance/purchase-requests/:requestId/quotes'

  typed.get(
    base,
    {
      preValidation: guarded(PURCHASE_QUOTE_ROLES),
      schema: {
        operationId: 'getPurchaseQuoteBoard',
        tags,
        summary: 'Teklif karşılaştırma tablosu',
        description: `Talebin kalemleri, silinmemiş teklifleri (en çok 10; sayfalanmaz) ve kalem × tedarikçi tutarları. Tutar ve KDV kalemden hesaplanır (K-138); satırda ve toplamda en düşük KDV dahil tutar yalnız geçerliliği geçmemiş teklifler arasında işaretlenir (K-137). Talebin siparişleri ve kullanıcının yapabileceği işlemler. Olmayan ya da başka kurumun talebi 404. ${STAFF}`,
        params: quoteRequestParams,
        response: { 200: quoteBoardResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getQuoteBoardFor(contextOf(request), request.params.requestId),
    }),
  )

  typed.post(
    base,
    {
      preValidation: [...guarded(PURCHASE_QUOTE_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createPurchaseQuote',
        tags,
        summary: 'Teklif gir',
        description: `Onaylı talebe tedarikçi teklifi: etkin tedarikçi, teslim süresi (0–365 gün), bugünden önce olmayan geçerlilik günü, isteğe bağlı not ve talebin bütün kalemleri için KDV hariç birim fiyat ve KDV oranı (%0, %1, %10, %20; K-135). Eksik kalem 422 \`purchase_quote_item_missing\`, talepte olmayan kalem 422 \`purchase_quote_item_unknown\`, aynı tedarikçinin ikinci teklifi 409 \`purchase_quote_supplier_exists\`, onuncu tekliften sonra 422 \`purchase_quote_limit\`. ${LOCKED} ${STAFF}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        params: quoteRequestParams,
        body: purchaseQuoteSchema,
        response: { 201: quoteBoardResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createQuoteCommand(
        contextOf(request),
        request.params.requestId,
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return quoteBoardResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    `${base}/:quoteId`,
    {
      preValidation: [...guarded(PURCHASE_QUOTE_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updatePurchaseQuote',
        tags,
        summary: 'Teklifi düzelt',
        description: `Kısmi düzeltme; fiyatlar bütün olarak yazılır, tedarikçi değişmez. Seçili teklif düzeltilirse seçim düşer (K-137). ${LOCKED} ${IF_MATCH} ${STAFF}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: quoteParams,
        body: updatePurchaseQuoteSchema,
        response: { 200: quoteBoardResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateQuoteCommand(
        contextOf(request),
        request.params.requestId,
        request.params.quoteId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return quoteBoardResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    `${base}/:quoteId`,
    {
      preValidation: [...guarded(PURCHASE_QUOTE_ROLES), requireIfMatch()],
      schema: {
        operationId: 'removePurchaseQuote',
        tags,
        summary: 'Teklifi sil',
        description: `Teklifi arşivler; seçili teklif silinirse seçim de düşer. ${LOCKED} ${IF_MATCH} ${STAFF}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: quoteParams,
        response: { 200: quoteBoardResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await removeQuoteCommand(
        contextOf(request),
        request.params.requestId,
        request.params.quoteId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return quoteBoardResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${base}/:quoteId/select`,
    {
      preValidation: [...guarded(PURCHASE_QUOTE_SELECT_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'selectPurchaseQuote',
        tags,
        summary: 'Teklifi seç',
        description: `Geçerli teklifi seçer; talepteki önceki seçim düşer. En düşük KDV dahil toplamlı geçerli teklif seçilmezse en az 10 karakter gerekçe zorunlu: 422 \`purchase_quote_reason_required\` (K-137). Süresi geçmiş teklif 422 \`purchase_quote_expired\`, seçili teklif 422 \`purchase_quote_already_selected\`. ${LOCKED} ${IF_MATCH} ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: quoteParams,
        body: selectPurchaseQuoteSchema,
        response: { 200: quoteBoardResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await selectQuoteCommand(
        contextOf(request),
        request.params.requestId,
        request.params.quoteId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return quoteBoardResponse.parse(sendBody(reply, result))
    },
  )
}
