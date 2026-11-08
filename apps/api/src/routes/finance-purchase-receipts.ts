import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  cancelPurchaseReceiptSchema,
  createPurchaseReceiptSchema,
  PURCHASE_RECEIPT_CANCEL_ROLES,
  PURCHASE_RECEIPT_ROLES,
} from '@kampus/school-core/lib/finance-purchase-receipts.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  cancelPurchaseReceiptCommand,
  createPurchaseReceiptCommand,
  getPurchaseReceiptBoardFor,
} from '../services/finance-purchase-receipts.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  purchaseReceiptBoardResponse,
  purchaseReceiptOrderParams,
  purchaseReceiptParams,
} from './finance-purchase-receipts.schemas.ts'

/**
 * Mal kabul uçları (docs/domain/finans.md DOM-FIN-074; ON-226). Modül `finance`. Okuma ve kabul
 * yönetici ile ön büro; kabul iptali yalnız yönetici (K-153). Sıra: 401 → 403 modül → 403 rol →
 * `If-Match` → 400 → işlem.
 */

const STAFF = 'Roller: `yonetici`, `onburo` (K-153). Modül `finance`.'
const MANAGER = 'Rol: `yonetici` (K-153). Modül `finance`.'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

export function registerFinancePurchaseReceiptRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const tags = ['finance-procurement']
  const url = '/api/v1/finance/purchase-orders/:orderId/receipts'

  typed.get(
    url,
    {
      preValidation: [app.authenticate, finance, app.requireRole(PURCHASE_RECEIPT_ROLES)],
      schema: {
        operationId: 'getPurchaseReceiptBoard',
        tags,
        summary: 'Siparişin mal kabul durumu',
        description: `Kalem başına sipariş, kabul edilen, reddedilen ve kalan miktar; gerçekleşen tutar (kabul edilen × birim fiyat, KDV hariç; K-151); kabul geçmişi (iptal edilenler dahil) ve kullanıcının yapabileceği işlemler. Olmayan ya da başka kurumun siparişi 404. ${STAFF}`,
        params: purchaseReceiptOrderParams,
        response: { 200: purchaseReceiptBoardResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getPurchaseReceiptBoardFor(contextOf(request), request.params.orderId),
    }),
  )

  typed.post(
    url,
    {
      preValidation: [
        app.authenticate,
        finance,
        app.requireRole(PURCHASE_RECEIPT_ROLES),
        rejectIfMatch(),
        captureInput(),
      ],
      schema: {
        operationId: 'createPurchaseReceipt',
        tags,
        summary: 'Mal kabul kaydet',
        description: `Gönderilmiş ya da kısmen teslim alınmış siparişe kalem bazında kabul: kabul günü, teslim alan personel, muayene notu, kabul edilen ve reddedilen miktar (ret nedeniyle). Kalemde kabul edilen toplam sipariş miktarını aşamaz (422 \`purchase_receipt_quantity_exceeded\`; kurum kilidi altında denetlenir); reddedilen miktar karşılanmış sayılmaz (K-150). Sipariş durumu yeniden hesaplanır: hiç kabul yok gönderildi, kısmen kısmen teslim, tamamı tamamlandı. Taslak sipariş 422 \`purchase_receipt_order_not_sent\`, iptal edilmiş 422 \`purchase_receipt_order_cancelled\`, tamamlanmış 422 \`purchase_receipt_order_completed\`; gelecek gün 422 \`purchase_receipt_date_future\`, sipariş açılışından önce 422 \`purchase_receipt_date_before_order\`, kapalı bütçe dönemi 422 \`purchase_receipt_period_closed\`; siparişte olmayan kalem 422 \`purchase_receipt_item_not_found\`. \`Idempotency-Key\` zorunlu; aynı anahtar ilk yanıtı tekrarlar. ${STAFF}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: purchaseReceiptOrderParams,
        body: createPurchaseReceiptSchema,
        response: { 201: purchaseReceiptBoardResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createPurchaseReceiptCommand(
        contextOf(request),
        request.params.orderId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return purchaseReceiptBoardResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${url}/:receiptId/cancel`,
    {
      preValidation: [
        app.authenticate,
        finance,
        app.requireRole(PURCHASE_RECEIPT_CANCEL_ROLES),
        requireIfMatch(),
        captureInput(),
      ],
      schema: {
        operationId: 'cancelPurchaseReceipt',
        tags,
        summary: 'Mal kabulü iptal et',
        description: `Kabulü gerekçeyle iptal eder; kayıt silinmez, iptal izi tutulur. Sipariş durumu kalan kabullerden yeniden hesaplanır ve iptal edilen kabul gider gerçekleşeninden düşer. Zaten iptal edilmiş 422 \`purchase_receipt_already_cancelled\`, kapalı bütçe dönemindeki kabul 422 \`purchase_receipt_period_closed\`. \`If-Match\` kabulün sürümüdür; tutmazsa 409 \`version_conflict\`. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: purchaseReceiptParams,
        body: cancelPurchaseReceiptSchema,
        response: { 200: purchaseReceiptBoardResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      if (opts.expectedVersion === null) throw new Error('If-Match guard did not run')
      const result = await cancelPurchaseReceiptCommand(
        contextOf(request),
        request.params.orderId,
        request.params.receiptId,
        request.commandInput,
        opts.expectedVersion,
        opts.idempotency,
      )
      return purchaseReceiptBoardResponse.parse(sendBody(reply, result))
    },
  )
}
