import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { purchaseApprovalSettingsSchema } from '@kampus/school-core/lib/finance-purchase-approvals.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  getPurchaseApprovalSettingsFor,
  setPurchaseApprovalSettingsCommand,
} from '../services/finance-purchase-approvals.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { purchaseApprovalSettingsResponse } from './finance-purchase-approvals.schemas.ts'

/**
 * Satın alma talebinin kademeli onay ayarı (docs/domain/finans.md DOM-FIN-071; ON-223, K-260).
 * Modül `finance`, rol yalnız yönetici. Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 → işlem.
 */

const URL = '/api/v1/finance/purchase-approval-settings'
const MANAGER = 'Rol: `yonetici`. Modül `finance`.'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

export function registerFinancePurchaseApprovalRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const tags = ['finance-procurement']

  typed.get(
    URL,
    {
      preValidation: [app.authenticate, finance, app.requireRole(['yonetici'])],
      schema: {
        operationId: 'getPurchaseApprovalSettings',
        tags,
        summary: 'Satın alma onay kademeleri',
        description: `Kurumun satın alma talebi onay kademeleri (alt sınır ve onaylayan), adlandırılabilecek etkin yöneticiler ve ayar sürümü. Kademe yoksa talepleri her yönetici tek adımda onaylar (K-129). ${MANAGER}`,
        response: { 200: purchaseApprovalSettingsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await getPurchaseApprovalSettingsFor(contextOf(request)) }),
  )

  typed.patch(
    URL,
    {
      preValidation: [
        app.authenticate,
        finance,
        app.requireRole(['yonetici']),
        requireIfMatch(),
        captureInput(),
      ],
      schema: {
        operationId: 'setPurchaseApprovalSettings',
        tags,
        summary: 'Satın alma onay kademelerini kaydet',
        description: `Kademe listesini bütün olarak yazar (ON-223, K-260): en çok 5 kademe, ilk kademe 0 alt sınırla başlar, alt sınırlar kesin artar; her kademe ya \`approverRole: "yonetici"\` (herhangi bir yönetici) ya da \`approverUserId\` (adlandırılmış kişi) taşır, aynı kişi iki kademede olamaz (400). Adlandırılmış kişi kurumun etkin yöneticisi değilse 422 \`purchase_approval_approver_invalid\` (başka kurumun kişisi de aynı yanıtı alır). Boş liste kademeli onayı kapatır. Ayar açık talepleri değiştirmez: kademeler gönderimde dondurulur (K-261). \`If-Match\` zorunlu (\`GET\` yanıtındaki sürüm; ayar hiç kaydedilmediyse 1); sürüm tutmazsa 409 \`version_conflict\`. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        body: purchaseApprovalSettingsSchema,
        response: { 200: purchaseApprovalSettingsResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      if (opts.expectedVersion === null) throw new Error('If-Match guard did not run')
      const result = await setPurchaseApprovalSettingsCommand(
        contextOf(request),
        request.commandInput,
        opts.expectedVersion,
        opts.idempotency,
      )
      return purchaseApprovalSettingsResponse.parse(sendBody(reply, result))
    },
  )
}
