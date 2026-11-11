import type { FastifyInstance, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { WRITE_ACTION_ROLES } from '@kampus/school-core/lib/authorize.ts'
import {
  amendContractSchema,
  approveContractSchema,
  cancelAmendmentSchema,
  contractSignatorySchema,
} from '@kampus/school-core/lib/contract-approval.ts'
import { CONTRACT_SELF_SERVICE_ROLES } from '@kampus/school-core/lib/contract-self-service.ts'

import type { Role } from '../auth.ts'
import { errorResponseSchema } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  amendContractCommand,
  approveContractCommand,
  cancelContractAmendmentCommand,
  setContractSignatoryCommand,
} from '../services/finance-contracts.ts'
import { listOwnContracts } from '../services/contract-self-service.ts'
import { sendCommand } from './command-support.ts'
import { authenticatedErrors } from './common.schemas.ts'
import { captureInput, options, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema, commandResponseSchema } from './commands.schemas.ts'
import {
  ownContractsParamsSchema,
  ownContractsResponseSchema,
} from './finance-contracts.schemas.ts'

/**
 * Sözleşme onayı ve ek protokol uçları (IST-092; docs/domain/finans.md DOM-FIN-010, -012, -051).
 * Modül `finance`. Okuma `GET /api/v1/collections/contracts` ile yapılır; eski sürümler orada
 * kalır. Yetişkin kursiyer koleksiyonu okumaz, kendi sürümlerini salt okunur uçtan alır (IST-082). Her yazma konunun okunan sürümünü (`If-Match`) ister: onaylanan belge ödeyicinin gördüğü
 * sürümdür.
 */

const params = z.object({
  contractId: z.string().min(1).max(200).describe('Sözleşme sürümünün kimliği'),
})
const HEADERS = commandHeadersSchema('required', { ifMatch: 'required' })
const RESPONSES = { 200: commandResponseSchema, ...commandErrors }

export function registerFinanceContractRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const guards = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    finance,
    app.requireRole(roles),
    requireIfMatch(),
    captureInput(),
  ]

  typed.post(
    '/api/v1/finance/contracts/:contractId/signatory',
    {
      preValidation: guards(WRITE_ACTION_ROLES['contract.sign']),
      schema: {
        operationId: 'setContractSignatory',
        tags: ['finance-contracts'],
        summary: 'Sözleşmenin imza yetkilisini işle',
        description:
          'Kurumu bağlayan kurucu ya da kurucu temsilcisini işler (IST-092, DOM-FIN-010); onaya kadar düzeltilebilir. Onaylanmış sözleşmede 409 `contract_already_approved`. `Idempotency-Key` ve `If-Match` zorunlu. Roller: `yonetici`.',
        headers: HEADERS,
        params,
        body: contractSignatorySchema,
        response: RESPONSES,
      },
    },
    async (request, reply) => {
      const result = await setContractSignatoryCommand(
        contextOf(request),
        request.params.contractId,
        request.commandInput,
        options(request, 'required'),
      )
      return sendCommand(reply, result)
    },
  )

  typed.post(
    '/api/v1/finance/contracts/:contractId/approve',
    {
      preValidation: [
        app.authenticate,
        finance,
        app.requireRole(WRITE_ACTION_ROLES['contract.approve']),
        // Onay borç doğurur; ortak cihazda açık kalmış oturumla verilmez (guvenlik-kvkk.md).
        app.requireFreshSession,
        requireIfMatch(),
        captureInput(),
      ],
      schema: {
        operationId: 'approveContract',
        tags: ['finance-contracts'],
        summary: 'Sözleşmeyi onayla',
        description:
          'Ödeyici onayını zamanıyla saklar ve planı kopyalar; bundan sonra tutar ve plan değişmez (IST-092, DOM-FIN-010, DOM-FIN-051). Veli kendi hesabıyla elektronik onay verir (yalnız ödeyici; değilse 403 `contract_payer_only`), yönetici ve ön büro kâğıttaki ıslak imzayı işler. Ek protokolde yeni plan taksitlere bu anda geçer; taslaktan sonra tahsilat gördüyse 409 `contract_amendment_stale`. İmza yetkilisi yoksa 422 `contract_signatory_required`, ikinci onay 409 `contract_already_approved`. `Idempotency-Key` ve `If-Match` zorunlu, taze oturum ister. Roller: `yonetici`, `onburo`, `veli`.',
        headers: HEADERS,
        params,
        body: approveContractSchema,
        response: RESPONSES,
      },
    },
    async (request, reply) => {
      const result = await approveContractCommand(
        contextOf(request),
        request.params.contractId,
        request.commandInput,
        options(request, 'required'),
      )
      return sendCommand(reply, result)
    },
  )

  typed.post(
    '/api/v1/finance/contracts/:contractId/amendments',
    {
      preValidation: guards(WRITE_ACTION_ROLES['contract.amend']),
      schema: {
        operationId: 'amendContract',
        tags: ['finance-contracts'],
        summary: 'Ek protokol hazırla',
        description:
          'Onaylı sözleşmenin yeni sürümünü taslak açar (IST-092, DOM-FIN-010): tahsilat görmüş öğrenim taksitleri ve ek hizmetler korunur, kalan net yeni plana dağıtılır. Önceki sürüm ve taksitler onaya kadar değişmez; yeni sürüm imza ve onayı yeniden ister. `discounts` verilirse indirim sözleşmenin tarifesinden yeniden hesaplanır (DOM-FIN-020, -021). Onaysız sözleşmede 422 `contract_not_approved`, açık ek protokol varken 409 `contract_amendment_open`, yerini ek protokole bırakan sürümde 409 `contract_superseded`, değişiklik yoksa 422 `contract_amendment_no_change`. `Idempotency-Key` ve `If-Match` (önceki sürüm) zorunlu. Roller: `yonetici`, `onburo`. Toplam taksit sayısı (korunan öğrenim taksitleri + yeni plan) tarifedeki ödeme koşulunda olmalıdır: değilse 422 `payment_term_not_in_tariff`; koşul değişirse indirimler yeniden hesaplanır (DOM-FIN-013).',
        headers: HEADERS,
        params,
        body: amendContractSchema,
        response: { 201: commandResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await amendContractCommand(
        contextOf(request),
        request.params.contractId,
        request.commandInput,
        options(request, 'required'),
      )
      return sendCommand(reply, result)
    },
  )

  typed.post(
    '/api/v1/finance/contracts/:contractId/cancel-amendment',
    {
      preValidation: guards(WRITE_ACTION_ROLES['contract.amend']),
      schema: {
        operationId: 'cancelContractAmendment',
        tags: ['finance-contracts'],
        summary: 'Onaylanmamış ek protokolü iptal et',
        description:
          'Onaylanmamış ek protokolü gerekçeyle kapatır (IST-092); kayıt silinmez, önceki sürüm yürürlükte kalır. Onaylanmış sürümde 409 `contract_already_approved`, ek protokol olmayan sözleşmede 422 `contract_not_amendment`. `Idempotency-Key` ve `If-Match` zorunlu. Roller: `yonetici`, `onburo`.',
        headers: HEADERS,
        params,
        body: cancelAmendmentSchema,
        response: RESPONSES,
      },
    },
    async (request, reply) => {
      const result = await cancelContractAmendmentCommand(
        contextOf(request),
        request.params.contractId,
        request.commandInput,
        options(request, 'required'),
      )
      return sendCommand(reply, result)
    },
  )

  typed.get(
    '/api/v1/finance/students/:studentId/contracts',
    {
      preValidation: [app.authenticate, finance, app.requireRole(CONTRACT_SELF_SERVICE_ROLES)],
      schema: {
        operationId: 'listOwnContracts',
        tags: ['finance-contracts'],
        summary: 'Yetişkin kursiyerin kendi sözleşmeleri',
        description:
          'Velisi olmayan kursiyer sözleşme sürümlerini kendi hesabından salt okur görür (IST-082, DOM-FIN-059): kayıt, türetilmiş durum ve ödeme planı özeti (plan satırı sayısı, toplam, ödenen satır, yürürlükteki sürümde sıradaki vade). Onay ve ek protokol bu uçta yoktur. Öğrenci yalnız kendisini okur; başka öğrenci, olmayan ya da başka kurumun öğrencisi 404. Yalnız okul dışındaki kurum türlerinde (bugün `language_school`); okulda 404. 18 yaşını doldurmamış kursiyer 403 `adult_learner_only` (yaş doğum tarihinden, Europe/Istanbul gününe göre; DOM-KAY-012). Rol: `ogrenci` (diğerleri 403); `finance` modülü kapalıysa 403 `module_disabled`.',
        params: ownContractsParamsSchema,
        response: {
          200: ownContractsResponseSchema,
          ...authenticatedErrors,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => ({
      data: await listOwnContracts(contextOf(request), request.params.studentId),
    }),
  )
}
