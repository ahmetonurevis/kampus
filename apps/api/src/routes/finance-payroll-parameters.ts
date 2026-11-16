import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  PAYROLL_PARAMETER_READ_ROLES,
  PAYROLL_PARAMETER_WRITE_ROLES,
  payrollParameterSetSchema,
  updatePayrollParameterSetSchema,
} from '@kampus/school-core/lib/finance-payroll-parameters.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  archivePayrollParameterSetCommand,
  createPayrollParameterSetCommand,
  effectivePayrollParametersFor,
  payrollParameterYearFor,
  updatePayrollParameterSetCommand,
} from '../services/finance-payroll-parameters.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  payrollArchiveResponse,
  payrollEffectiveQuery,
  payrollEffectiveResponse,
  payrollSetParams,
  payrollSetResponse,
  payrollYearQuery,
  payrollYearResponse,
} from './finance-payroll-parameters.schemas.ts'

/**
 * Bordro parametresi uçları (docs/domain/finans.md DOM-FIN-100; ON-197). Modül `finance`. Okuma
 * yönetici ve ön büro, kurum kopyasını yazma yalnız yönetici (K-309). Sıra: 401 → 403 modül →
 * 403 rol → `If-Match` → 400 → işlem. Platform varsayılanı kodda durur, uçla değişmez (K-308).
 */

const READERS = 'Roller: `yonetici`, `onburo` (K-309). Modül `finance`.'
const MANAGER = 'Rol: `yonetici` (K-309). Modül `finance`.'
const URL = '/api/v1/finance/payroll-parameters'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinancePayrollParameterRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    finance,
    app.requireRole(roles),
  ]
  const tags = ['finance-payroll']

  typed.get(
    URL,
    {
      preValidation: guarded(PAYROLL_PARAMETER_READ_ROLES),
      schema: {
        operationId: 'getPayrollParameterYear',
        tags,
        summary: 'Bordro parametrelerinin yıllık tablosu',
        description: `Yılın dönemleri (DOM-FIN-100): yıl içinde başlayan setler ve 1 Ocak'ta önceki yıldan süren set (\`carriedOver\`). Her dönem platform varsayılanı (\`origin: platform\`, değerler doğrulanmalı, M-40) ya da kurumun kopyasıdır (\`institution\`); aynı başlangıçta kurum kopyası platformun yerini alır (K-309). Net asgari ücret ve SGK taban/tavan tutarı \`derived\` içinde hesaplanır, saklanmaz (K-310). Tablo kısa ve yıl başına sınırlı olduğundan sayfalanmaz. ${READERS}`,
        querystring: payrollYearQuery,
        response: { 200: payrollYearResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await payrollParameterYearFor(contextOf(request), request.query.year),
    }),
  )

  typed.get(
    `${URL}/effective`,
    {
      preValidation: guarded(PAYROLL_PARAMETER_READ_ROLES),
      schema: {
        operationId: 'getEffectivePayrollParameters',
        tags,
        summary: 'Günde geçerli bordro parametreleri',
        description: `Yürürlük başlangıcı güne eşit ya da önce olan en geç set (DOM-FIN-100). Günün yılı için set yoksa son bilinen set döner ve \`stale: true\` olur. Tablonun ilk setinden önceki gün 422 \`payroll_parameters_missing\`. ${READERS}`,
        querystring: payrollEffectiveQuery,
        response: { 200: payrollEffectiveResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await effectivePayrollParametersFor(contextOf(request), request.query.date),
    }),
  )

  typed.post(
    URL,
    {
      preValidation: [...guarded(PAYROLL_PARAMETER_WRITE_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createPayrollParameterSet',
        tags,
        summary: 'Kurum bordro parametre setini ekle',
        description: `Kurumun kendi setini yazar (platform setinin kopyası ya da yeni dönem, ör. yıl ortası asgari ücret artışı). Bütün alanlar zorunludur (K-310). Yürürlük başlangıcı ayın ilk günü, 2020–2099 (K-311); dilimler 0'dan başlar, alt sınırlar ve oranlar kesin artan, oran 0–10.000 (400). İşveren indirimi işveren payını, taban çarpanı tavanı aşamaz (400). Aynı başlangıçta kurumun etkin seti varsa 409 \`payroll_parameters_exist\`. \`Idempotency-Key\` alabilir. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: payrollParameterSetSchema,
        response: { 201: payrollSetResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createPayrollParameterSetCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return payrollSetResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    `${URL}/:setId`,
    {
      preValidation: [...guarded(PAYROLL_PARAMETER_WRITE_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updatePayrollParameterSet',
        tags,
        summary: 'Kurum bordro parametre setini düzelt',
        description: `Kısmi düzeltme; dilimler bütün olarak yazılır, birleşik set yeniden doğrulanır (400). Başka setin başlangıcı 409 \`payroll_parameters_exist\`; olmayan, arşivli ya da başka kurumun seti 404; \`If-Match\` zorunlu, sürüm tutmazsa 409 \`version_conflict\`. Platform seti düzeltilmez: aynı başlangıçla kurum kopyası eklenir. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: payrollSetParams,
        body: updatePayrollParameterSetSchema,
        response: { 200: payrollSetResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updatePayrollParameterSetCommand(
        contextOf(request),
        request.params.setId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return payrollSetResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    `${URL}/:setId`,
    {
      preValidation: [...guarded(PAYROLL_PARAMETER_WRITE_ROLES), requireIfMatch()],
      schema: {
        operationId: 'archivePayrollParameterSet',
        tags,
        summary: 'Kurum bordro parametre setini arşivle',
        description: `Arşivli set çözüme girmez; aynı başlangıçlı platform seti varsa yeniden geçerli olur (K-309). Olmayan ya da başka kurumun seti 404; \`If-Match\` zorunlu, sürüm tutmazsa 409. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: payrollSetParams,
        response: { 200: payrollArchiveResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await archivePayrollParameterSetCommand(
        contextOf(request),
        request.params.setId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return payrollArchiveResponse.parse(sendBody(reply, result))
    },
  )
}
