import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  PAYROLL_PERIOD_ROLES,
  payrollAdjustmentCancelSchema,
  payrollAdjustmentInputSchema,
  payrollApproveSchema,
  payrollReopenSchema,
} from '@kampus/school-core/lib/finance-payroll-periods.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  approvePayrollPeriodCommand,
  cancelPayrollAdjustmentCommand,
  createPayrollAdjustmentCommand,
  listPayrollAdjustmentsFor,
  payrollPeriodYearFor,
  reopenPayrollPeriodCommand,
} from '../services/finance-payroll-periods.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  adjustmentCancelResponse,
  adjustmentListQuery,
  adjustmentListResponse,
  adjustmentParams,
  adjustmentResponse,
  monthParams,
  periodResponse,
  periodYearResponse,
  yearQuery,
} from './finance-payroll-periods.schemas.ts'

/**
 * Bordro onayı ve dönem kilidi uçları (docs/domain/finans.md DOM-FIN-108; ON-200). Modül `finance`;
 * okuma ve yazma yalnız yönetici (K-359). Bütün yazmalar `Idempotency-Key` ister. Sıra: 401 → 403
 * modül → 403 rol → `If-Match` → 400 → işlem.
 */

const MANAGER = 'Rol: yalnız `yonetici` (K-359). Modül `finance`.'
const URL = '/api/v1/finance/payroll-periods'
const ADJUSTMENTS_URL = '/api/v1/finance/payroll-adjustments'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinancePayrollPeriodRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(PAYROLL_PERIOD_ROLES),
  ]
  const tags = ['finance-payroll-periods']

  typed.get(
    URL,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listPayrollPeriods',
        tags,
        summary: 'Bordro dönemleri (yılın ayları)',
        description: `Yılın 12 ayı: durum (\`open\` açık, \`approved\` onaylı ve kilitli, \`reopened\` yeniden açılmış), son onaylayan ve zaman, onay anının girdi özeti (personel ve tanım sayısı, aylık brüt toplamı, aya aktarılan düzeltmeler, geçerli parametre seti, SHA-256 damgası), son yeniden açma ve aydan çıkan düzeltme sayısı. Onaylanmamış, başlamış ayda güncel özet \`current\` döner; onay isteği onun damgasını taşır. \`lockedMonths\` kurumun bütün kilitli aylarıdır (ücret tanımı formundaki uyarı için). Özet kurum toplamıdır, kişi tutarı yoktur; okuma denetime düşmez. ${MANAGER}`,
        querystring: yearQuery,
        response: { 200: periodYearResponse, ...commandErrors },
      },
    },
    async (request) => {
      const ctx = contextOf(request)
      return {
        data: await payrollPeriodYearFor(
          ctx,
          request.query.year ?? Number(dayKey(ctx.now).slice(0, 4)),
        ),
      }
    },
  )

  typed.post(
    `${URL}/:month/approve`,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'approvePayrollPeriod',
        tags,
        summary: 'Bordro ayını onayla (kilitle)',
        description: `Ayın bordro girdilerini onaylar ve ayı kilitler (DOM-FIN-108, K-356, K-357): onaydan sonra yürürlüğü bu aya düşen ücret tanımı yazmaları (yeni tanım, bitiş, iptal), bu ayda geçerli seti değiştiren bordro parametresi yazmaları ve bu ayın kesintisini değiştiren avans, icra ve BES yazmaları (K-394) 409 \`payroll_period_locked\` olur. Girdi özeti ve damgası kurum kilidi altında yeniden hesaplanır; \`inputsHash\` listedeki \`current.inputsHash\` ile aynı değilse 409 \`payroll_inputs_changed\`. Başlamamış ay 422 \`payroll_period_in_future\`, onaylı ay 409 \`payroll_period_already_approved\`. İlk onay 201, yeniden açılmış ayın onayı 200. \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: monthParams,
        body: payrollApproveSchema,
        response: { 200: periodResponse, 201: periodResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await approvePayrollPeriodCommand(
        contextOf(request),
        request.params.month,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return periodResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${URL}/:month/reopen`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'reopenPayrollPeriod',
        tags,
        summary: 'Onaylı bordro ayını yeniden aç',
        description: `Onaylı ay gerekçeyle (5–500 karakter) yeniden açılır; kilit kalkar, ay yeniden onaylanabilir (K-356). Onaylı olmayan ay 409 \`payroll_period_not_approved\`; aydan çıkan iptal edilmemiş düzeltme kaydı varsa 422 \`payroll_period_has_adjustments\`. Gerekçe dönem kaydında kalır, denetim kaydına yazılmaz. \`If-Match\` dönem sürümüdür; \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: monthParams,
        body: payrollReopenSchema,
        response: { 200: periodResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'required')
      const result = await reopenPayrollPeriodCommand(
        contextOf(request),
        request.params.month,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return periodResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${URL}/:month/adjustments`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listPayrollAdjustments',
        tags,
        summary: 'Ayın düzeltme kayıtları',
        description: `Ayın (kaynak) iptal edilmemiş düzeltme kayıtları, yeniden eskiye. Kişi başı fark tutarı içerdiği için her okuma denetim kaydına \`finance.payroll_adjustment.read\` olarak düşer (alan adı; K-359); kaydı olmayan ayda boş liste döner. ${MANAGER}`,
        params: monthParams,
        querystring: adjustmentListQuery,
        response: { 200: adjustmentListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total } = await listPayrollAdjustmentsFor(
        contextOf(request),
        request.params.month,
        { page, pageSize },
      )
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    `${URL}/:month/adjustments`,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createPayrollAdjustment',
        tags,
        summary: 'Kilitli aya düzeltme kaydı yaz',
        description: `Onaylı (kilitli) ayın farkı: personel, kalem (ana ücret, ek ders, yan hak, kesinti, diğer), işaretli fark tutarı (artı ek ödeme, eksi geri alınacak; sıfır değil, en çok 10.000.000 ₺) ve gerekçe (K-358). Asıl dönem değişmez; fark ayın ardından gelen ilk kilitsiz aya (\`targetMonth\`) aktarılacak girdi olarak saklanır. Açık ay 422 \`payroll_period_not_locked\`; olmayan üyelik 422 \`payroll_adjustment_staff_not_found\`, öğrenci ya da veli 422 \`payroll_adjustment_not_staff\`. Denetim kaydına alan adları yazılır. \`Idempotency-Key\` zorunlu. 201. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: monthParams,
        body: payrollAdjustmentInputSchema,
        response: { 201: adjustmentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createPayrollAdjustmentCommand(
        contextOf(request),
        request.params.month,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = adjustmentResponse.parse(sendBody(reply, result))
      reply.header('location', `${ADJUSTMENTS_URL}/${body.data.id}`)
      return body
    },
  )

  typed.post(
    `${ADJUSTMENTS_URL}/:adjustmentId/cancel`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'cancelPayrollAdjustment',
        tags,
        summary: 'Düzeltme kaydını iptal et',
        description: `Düzeltme gerekçeyle (5–500 karakter) iptal edilir; düzeltilmez. Aktarılacağı ay onaylandıysa düzeltme o ayın girdisidir, 409 \`payroll_period_locked\` (K-358). Gerekçe denetim kaydına yazılmaz. \`If-Match\` zorunlu; \`Idempotency-Key\` zorunlu. Başka kurumun ya da iptal edilmiş kayıt 404. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: adjustmentParams,
        body: payrollAdjustmentCancelSchema,
        response: { 200: adjustmentCancelResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'required')
      const result = await cancelPayrollAdjustmentCommand(
        contextOf(request),
        request.params.adjustmentId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return adjustmentCancelResponse.parse(sendBody(reply, result))
    },
  )
}
