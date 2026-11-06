import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { WRITE_ACTION_ROLES } from '@kampus/school-core/lib/authorize.ts'
import {
  payRefundSchema,
  WITHDRAWAL_REASONS,
  withdrawalQuoteSchema,
  withdrawStudentSchema,
} from '@kampus/school-core/lib/withdrawals.ts'
import { INSTITUTION_TYPES } from '@kampus/school-core/modules/collection-modules.ts'

import { contextOf } from '../plugins/authenticate.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import {
  getWithdrawalFor,
  listWithdrawalsFor,
  payRefundCommand,
  quoteWithdrawalFor,
  withdrawStudentCommand,
} from '../services/withdrawals.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/**
 * Ayrılış ve iade uçları (ADR 0006 karar 10; docs/domain/finans.md DOM-FIN-040, -041; kayit-ve-crm.md
 * DOM-KAY-024; IST-110). Modül `finance`. Önizleme ve okuma yönetici ve ön büro; ayrılış onayı ve
 * iade ödemesi yalnız yönetici ve taze oturum ister (guvenlik-kvkk.md).
 */

const STAFF = ['yonetici', 'onburo'] as const

const breakdownSchema = z.object({
  institutionType: z.enum(INSTITUTION_TYPES),
  withdrawalDate: z.string(),
  termStartDate: z.string(),
  started: z.boolean().describe('Ayrılış dönem başladıktan sonra mı'),
  attendedUnits: z.number().int(),
  totalUnits: z.number().int(),
  publicSchoolExemption: z.boolean(),
  scholarshipExempt: z
    .boolean()
    .optional()
    .describe('Burslu ayrılışı: öğrenim için ödenenden fazlası istenmez (DOM-FIN-025)'),
  deductionBasisPoints: z.number().int().describe('Kesinti oranı, on binde birlik'),
  baseCents: z.number().int().describe('Hesap tabanı: sözleşmenin net ücreti (kuruş)'),
  deductionCents: z.number().int(),
  usageCents: z.number().int(),
  entitledCents: z.number().int().describe('Kurumun hak ettiği tutar; tabanı aşamaz'),
  paidCents: z.number().int(),
  creditCents: z.number().int().describe('Taksitlere dağıtılmamış tahsilat'),
  extras: z.array(
    z.object({
      invoiceId: z.string(),
      kind: z.string(),
      amountCents: z.number().int(),
      paidCents: z.number().int(),
      usedCents: z.number().int(),
    }),
  ),
  refundCents: z.number().int(),
  debtCents: z.number().int(),
  contracts: z
    .array(
      z.object({
        contractId: z.string(),
        title: z.string(),
        packageSaleId: z.string().optional().describe('Paket satışı; öğrenim sözleşmesinde yok'),
        attendedUnits: z
          .number()
          .int()
          .describe('Öğrenimde girilen görülen birim, pakette kullanılan saat'),
        totalUnits: z.number().int().describe('Öğrenimde toplam birim, pakette satın alınan saat'),
        returnedHours: z.number().int().optional().describe('Pakette iade edilen kalan saat'),
        scholarshipExempt: z.boolean(),
        baseCents: z.number().int(),
        deductionCents: z.number().int(),
        usageCents: z.number().int(),
        entitledCents: z.number().int(),
        paidCents: z.number().int(),
        extraBalanceCents: z.number().int(),
        balanceCents: z
          .number()
          .int()
          .describe('Artıysa bu sözleşmeden iade, eksiyse borç; dağıtılmamış tahsilat hariç'),
      }),
    )
    .optional()
    .describe('Hesaba giren sözleşmeler, eskiden yeniye (K-06); eski kayıtta yok'),
})

const withdrawalSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  studentName: z.string().nullable(),
  contractId: z.string(),
  withdrawalDate: z.string(),
  reason: z.enum(WITHDRAWAL_REASONS),
  targetSchool: z.string().nullable(),
  breakdown: breakdownSchema,
  refundCents: z.number().int(),
  debtCents: z.number().int(),
  refundDueDate: z.string().describe('İadenin son günü: ayrılıştan bir ay sonra'),
  refundPaidDate: z.string().nullable(),
  maskedIban: z.string().nullable().describe('Yalnız son dört hane'),
  refundAccountHolder: z.string().nullable(),
  refundStatus: z.enum(['none', 'pending', 'paid']),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})
const withdrawalResponseSchema = dataResponse(withdrawalSchema)
const studentParams = z.object({
  studentId: z.string().min(1).max(200).describe('Öğrenci kimliği'),
})
const withdrawalParams = z.object({ withdrawalId: z.uuid('Ayrılış kimliği geçersiz.') })
const listQuerySchema = z.strictObject({
  ...pageQuerySchema.shape,
  refundStatus: z.enum(['none', 'pending', 'paid']).optional().describe('İade durumu'),
  q: z.string().trim().min(2).max(100).optional().describe('Öğrenci adında arama'),
})

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

export function registerWithdrawalRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const read = [app.authenticate, finance, app.requireRole(STAFF)]
  const write = (ifMatch: 'reject' | 'required'): preValidationAsyncHookHandler[] => [
    app.authenticate,
    finance,
    app.requireRole(WRITE_ACTION_ROLES['student.withdraw']),
    app.requireFreshSession,
    ifMatch === 'reject' ? rejectIfMatch() : requireIfMatch(),
    captureInput(),
  ]

  typed.post(
    '/api/v1/students/:studentId/withdrawal-quote',
    {
      preValidation: [...read, captureInput()],
      schema: {
        operationId: 'quoteWithdrawal',
        tags: ['withdrawals'],
        summary: 'Ayrılış ve iade hesabını önizle',
        description:
          'Hiçbir kayıt yazmaz. Taban sözleşmenin net ücretidir; kesinti %10, dönem başladıysa kullanım `taban × görülen / toplam` (okulda ders günü, dil okulunda ders saati; yönetici girer). Hak edilen tabanı aşamaz; ödenen azsa iade sıfır, kalan borçtur. Ek hizmetin kullanılmayan kısmı iade edilir (DOM-FIN-040; oranlar ve taban doğrulanmalı). İleri tarih 422 `withdrawal_date_in_future`; görülen toplamı aşarsa 422 `attended_exceeds_total`; dönem başlamadan görülen birim 422 `attended_before_term`; kesintisiz iade yalnız okulda ve dönem başlamadan (422 `exemption_not_applicable`). Sözleşme yoksa 422 `withdrawal_contract_missing`. Roller: `yonetici`, `onburo`.',
        params: studentParams,
        body: withdrawalQuoteSchema,
        response: {
          200: dataResponse(z.object({ contractId: z.string(), breakdown: breakdownSchema })),
          ...commandErrors,
        },
      },
    },
    async (request) => ({
      data: await quoteWithdrawalFor(
        contextOf(request),
        request.params.studentId,
        request.commandInput,
      ),
    }),
  )

  typed.post(
    '/api/v1/students/:studentId/withdraw',
    {
      preValidation: write('reject'),
      schema: {
        operationId: 'withdrawStudent',
        tags: ['withdrawals'],
        summary: 'Öğrencinin ayrılışını onayla',
        description:
          'Tek işlemde öğrenciyi pasifleştirir, açık taksitleri iptal eder, borç kalırsa tek taksit açar, ileri tarihli etüt, servis ve kulüp kayıtlarını sonlandırır, planlanmış yenilemeyi iptal eder ve iade kaydını oluşturur (DOM-FIN-041, DOM-KAY-024). Pasif öğrenci 409 `student_already_withdrawn`; tahsilatı olan yenileme 409 `withdrawal_renewal_paid`. Taze oturum ister: eskiyse 403 `reauthentication_required`. `Idempotency-Key` zorunludur. Başarı 201 ve `Location`. Rol: `yonetici`.',
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: studentParams,
        body: withdrawStudentSchema,
        response: { 201: withdrawalResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await withdrawStudentCommand(
        contextOf(request),
        request.params.studentId,
        request.commandInput,
        options(request, 'required'),
      )
      const body = withdrawalResponseSchema.parse(sendBody(reply, result))
      reply.header('location', `/api/v1/withdrawals/${body.data.id}`)
      return body
    },
  )

  typed.get(
    '/api/v1/withdrawals',
    {
      preValidation: read,
      schema: {
        operationId: 'listWithdrawals',
        tags: ['withdrawals'],
        summary: 'Ayrılış ve iadeleri listele',
        description:
          'Son günü en yakın iade önce gelir (DOM-FIN-040). `refundStatus` iade durumuna, `q` öğrenci adına (Türkçe harf duyarsız) göre süzer; sayfalıdır, bilinmeyen parametre 400. Roller: `yonetici`, `onburo`.',
        querystring: listQuerySchema,
        response: {
          200: z.object({ data: z.array(withdrawalSchema), meta: pageMetaSchema }),
          ...commandErrors,
        },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total } = await listWithdrawalsFor(contextOf(request), request.query)
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    '/api/v1/withdrawals/:withdrawalId',
    {
      preValidation: read,
      schema: {
        operationId: 'getWithdrawal',
        tags: ['withdrawals'],
        summary: 'Ayrılış ve iade ayrıntısı',
        description:
          'Hesap dökümüyle birlikte döner; IBAN maskelidir. Başka kurumun kaydı 404. Roller: `yonetici`, `onburo`.',
        params: withdrawalParams,
        response: { 200: withdrawalResponseSchema, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getWithdrawalFor(contextOf(request), request.params.withdrawalId),
    }),
  )

  typed.post(
    '/api/v1/withdrawals/:withdrawalId/pay-refund',
    {
      preValidation: write('required'),
      schema: {
        operationId: 'payRefund',
        tags: ['withdrawals'],
        summary: 'İadeyi ödenmiş işaretle',
        description:
          'Ödeme tarihi, IBAN ve hesap sahibini yazar; ödenen iade değiştirilemez (DOM-FIN-041). Geçersiz IBAN 400; hesap sahibi sözleşmedeki ödeyici değilse 422 `refund_holder_mismatch`; iade yoksa 409 `refund_not_due`; ödenmişse 409 `refund_already_paid`. Taze oturum ister: eskiyse 403 `reauthentication_required`. `If-Match` ve `Idempotency-Key` zorunludur; anahtar kaydı yanıtı 24 saat saklar ama maskeli IBAN ve hesap sahibini saklamaz, tekrar yanıtı bunları iade kaydından ekler. Rol: `yonetici`.',
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: withdrawalParams,
        body: payRefundSchema,
        response: { 200: withdrawalResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { idempotency, expectedVersion } = options(request, 'required')
      if (expectedVersion === null) throw new Error('If-Match guard did not run')
      const result = await payRefundCommand(
        contextOf(request),
        request.params.withdrawalId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return withdrawalResponseSchema.parse(sendBody(reply, result))
    },
  )
}
