import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { WRITE_ACTION_ROLES } from '@kampus/school-core/lib/authorize.ts'
import { FEE_UNITS } from '@kampus/school-core/lib/fee-tariffs.ts'
import { STUDENT_SERVICE_KINDS } from '@kampus/school-core/lib/finance-student-services.ts'
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

const payerSchema = z.enum(['guardian', 'student'])

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
        payer: payerSchema.describe(
          'Sözleşmenin ödeyicisi; ad yalnız önizlemenin `payers` alanında',
        ),
        packageSaleId: z.string().optional().describe('Paket satışı; öğrenim sözleşmesinde yok'),
        attendedUnits: z
          .number()
          .int()
          .describe('Öğrenimde girilen görülen birim, pakette kullanılan saat'),
        totalUnits: z.number().int().describe('Öğrenimde toplam birim, pakette satın alınan saat'),
        returnedHours: z.number().int().optional().describe('Pakette iade edilen kalan saat'),
        usedHoursMissing: z
          .boolean()
          .optional()
          .describe('Pakette kullanılan saat girilmedi; hesap sıfır saate dayanır (K-21)'),
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
  payerDecision: z
    .object({
      payer: payerSchema,
      reason: z
        .string()
        .optional()
        .describe(
          'Karar gerekçesi; yalnız `yonetici` rolünün liste ve ayrıntı okumasında döner, `onburo` ve komut yanıtında alan yoktur (K-13)',
        ),
    })
    .optional()
    .describe('Ödeyiciler farklı ve iade varken yöneticinin kararı: iadeyi alacak ödeyici (K-12)'),
  refundApprovedCents: z
    .number()
    .int()
    .optional()
    .describe('Paketli ayrılışta yöneticinin onayladığı iade tutarı (K-21); öteki kayıtta yok'),
  services: z
    .array(
      z.object({
        serviceId: z.string().describe('Ek hizmet aboneliği (ON-087)'),
        kind: z.enum(STUDENT_SERVICE_KINDS),
        academicYear: z.number().int(),
        startDate: z.string(),
        endDate: z
          .string()
          .nullable()
          .describe('Planlanan bitiş; aylık olmayan kalemde boş olabilir'),
        unit: z.enum(FEE_UNITS),
        amountCents: z
          .number()
          .int()
          .describe('Birim tutar; aylık kalemde bir ayın tutarı (kuruş)'),
        usedCents: z
          .number()
          .int()
          .describe(
            'Ayrılış gününe kadar kullanılan: vadesi o güne kadar gelen taksitlerin tutarı',
          ),
        paidCents: z.number().int().describe('Aboneliğin ödenmiş tutarı'),
        endedDate: z.string().describe('Aboneliğin ayrılışla kapandığı gün'),
      }),
    )
    .optional()
    .describe(
      'Açık ek hizmet abonelikleri (K-17, ON-298); iade ve borç hesabına girmez, personel kalemi tarifeye göre ayrıca işler. Abonelik yoksa ve eski kayıtta yok',
    ),
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
          'Hiçbir kayıt yazmaz. Taban sözleşmenin net ücretidir; kesinti %10, dönem başladıysa kullanım `taban × görülen / toplam` (okulda ders günü, dil okulunda ders saati; yönetici girer). Hak edilen tabanı aşamaz; ödenen azsa iade sıfır, kalan borçtur. Ek hizmetin kullanılmayan kısmı iade edilir (DOM-FIN-040; oranlar ve taban doğrulanmalı). Paket satışında kullanım kayıtlı saatten gelir; saat girilmemişse satır `usedHoursMissing` taşır ve hesap sıfır saate dayanır (K-21). İleri tarih 422 `withdrawal_date_in_future`; görülen toplamı aşarsa 422 `attended_exceeds_total`; dönem başlamadan görülen birim 422 `attended_before_term`; kesintisiz iade yalnız okulda ve dönem başlamadan (422 `exemption_not_applicable`). Sözleşme yoksa 422 `withdrawal_contract_missing`. Açık ek hizmet aboneliği (ON-087) `breakdown.services` alanında hizmet, dönem, birim tutar ve ayrılış gününe kadar kullanılan tutarla gösterilir; iade ve borç hesabına girmez, iadesi otomatik yazılmaz (K-17). Roller: `yonetici`, `onburo`.',
        params: studentParams,
        body: withdrawalQuoteSchema,
        response: {
          200: dataResponse(
            z.object({
              contractId: z.string(),
              breakdown: breakdownSchema,
              payersDiffer: z
                .boolean()
                .describe(
                  'Hesaba giren sözleşmelerin ödeyicileri farklı mı; iade varsa ayrılış yöneticinin kararını ister (K-12)',
                ),
              payers: z
                .array(
                  z.object({
                    contractId: z.string(),
                    payer: payerSchema,
                    payerName: z.string().describe('Ödeyicinin adı; iletişim bilgisi dönmez'),
                  }),
                )
                .describe('Sözleşme başına ödeyici'),
            }),
          ),
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
          'Tek işlemde öğrenciyi pasifleştirir, açık taksitleri iptal eder, borç kalırsa tek taksit açar, ileri tarihli etüt, servis ve kulüp kayıtlarını sonlandırır, planlanmış yenilemeyi iptal eder ve iade kaydını oluşturur (DOM-FIN-041, DOM-KAY-024). Paket satışı hesaba giriyorsa iade tutarı yönetici onayından geçer (K-21): önizlemede görülen tutar `approvedRefundCents` ile gelir, yoksa 422 `withdrawal_refund_approval_required`, tutar değiştiyse 409 `withdrawal_refund_changed`; kullanılan saat girilmemişse satır `usedHoursMissing` taşır. Açık ek hizmet abonelikleri aynı işlemde kapanır (ON-087) ve dökümde `breakdown.services` olarak saklanır; iade tutarına girmez, iadesi otomatik yazılmaz (K-17). Pasif öğrenci 409 `student_already_withdrawn`; tahsilatı olan yenileme 409 `withdrawal_renewal_paid`. Taze oturum ister: eskiyse 403 `reauthentication_required`. `Idempotency-Key` zorunludur. Başarı 201 ve `Location`. Rol: `yonetici`.',
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
          'Son günü en yakın iade önce gelir (DOM-FIN-040). `refundStatus` iade durumuna, `q` öğrenci adına (Türkçe harf duyarsız) göre süzer; sayfalıdır, bilinmeyen parametre 400. Ödeyici kararının gerekçesi yalnız `yonetici` rolüne döner (K-13). Roller: `yonetici`, `onburo`.',
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
          'Hesap dökümüyle birlikte döner; IBAN maskelidir. Ödeyici kararının gerekçesi yalnız `yonetici` rolüne döner (K-13). Başka kurumun kaydı 404. Roller: `yonetici`, `onburo`.',
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
