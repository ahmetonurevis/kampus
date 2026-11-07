import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  closeFinanceDaySchema,
  FINANCE_DAY_CLOSE_ROLES,
  FINANCE_DAY_REOPEN_ROLES,
  reopenFinanceDaySchema,
} from '@kampus/school-core/lib/finance-day-closings.ts'
import { PAYMENT_METHODS } from '@kampus/school-core/lib/payments.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  closeFinanceDayCommand,
  financeDayReportFor,
  reopenFinanceDayCommand,
} from '../services/finance-day-closings.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { dataResponse } from './common.schemas.ts'

/**
 * Kasa ve gün sonu uçları (IST-113; docs/domain/finans.md DOM-FIN-036, DOM-FIN-052). Modül `finance`.
 * Rapor ve kapatma yönetici ve ön büro, yeniden açma yalnız yönetici; veli, öğrenci ve öğretmen
 * erişemez. Roller core `lib/finance-day-closings.ts`'tedir.
 */

const paramsSchema = z.object({
  closingDate: daySchema.describe('Gün sonu günü (Europe/Istanbul, `YYYY-MM-DD`)'),
})

const summarySchema = z.object({
  methods: z
    .array(
      z.object({
        method: z.enum(PAYMENT_METHODS),
        collectedCount: z.number().int().describe('Tahsilat adedi'),
        collectedCents: z.number().int().describe('Tahsilat toplamı (kuruş)'),
        reversedCount: z.number().int().describe('O gün yapılan iptal adedi'),
        reversedCents: z.number().int().describe('O gün yapılan iptal toplamı (kuruş)'),
        netCents: z.number().int().describe('Tahsilat eksi iptal (kuruş)'),
      }),
    )
    .describe('Her yöntem hareket olmasa da yer alır'),
  collectedCount: z.number().int(),
  collectedCents: z.number().int(),
  reversedCount: z.number().int(),
  reversedCents: z.number().int(),
  netCents: z.number().int(),
})

const closingSchema = z.object({
  id: z.string(),
  closingDate: z.string(),
  summary: summarySchema.describe('Kapanış anının özeti'),
  cash: z
    .object({
      openingCents: z.number().int().describe('Açılış kasası (kuruş)'),
      countedCents: z.number().int().describe('Sayılan nakit (kuruş)'),
      expectedCents: z.number().int().describe('Açılış artı günün net nakdi (kuruş)'),
      differenceCents: z.number().int().describe('Sayılan eksi beklenen (kuruş)'),
    })
    .nullable()
    .describe('Kasa sayımı; nakit kapalı ve hareketsiz günde boş olabilir'),
  note: z.string().nullable().describe('Kapatanın açıklaması'),
  closedAt: z.string().describe('Kapanış anı (ISO 8601 UTC)'),
  closedByName: z.string().nullable().describe('Kapatan kişi'),
  reopenedAt: z.string().nullable().describe('Yeniden açılma anı; geçerli kapanışta boş'),
  reopenedByName: z.string().nullable().describe('Yeniden açan yönetici'),
  reopenReason: z.string().nullable().describe('Yeniden açma gerekçesi'),
  version: z.number().int().describe('`If-Match` için kapanış sürümü'),
})

const lineSchema = z.object({
  paymentId: z.string(),
  receiptYear: z.number().int(),
  receiptNumber: z.number().int(),
  studentName: z.string().nullable(),
  amountCents: z.number().int(),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().nullable(),
  bankAccountLabel: z.string().nullable(),
  paidAt: z.string(),
  reversedAt: z.string().nullable(),
  reversalReason: z.string().nullable(),
})

const reportSchema = dataResponse(
  z.object({
    closingDate: z.string(),
    status: z.enum(['open', 'closed']),
    summary: summarySchema.describe(
      'Kapalı günde kapanış anının özeti, açık günde tahsilatlardan hesaplanan özet',
    ),
    reportStamp: z.string().describe('Kapatırken geri gönderilir; rapor değiştiyse 409'),
    cashNetCents: z.number().int().describe('Günün net nakit hareketi (kuruş)'),
    cashCountRequired: z.boolean().describe('Kapanışta nakit sayımı zorunlu mu'),
    suggestedOpeningCents: z
      .number()
      .int()
      .nullable()
      .describe('Önceki kapanışta sayılan nakit; hiç kapanış yoksa boş'),
    collected: z.array(lineSchema).describe('O gün ödeme tarihli tahsilatlar'),
    reversed: z
      .array(lineSchema)
      .describe('O gün yapılan iptaller; tahsilatın günü başka olabilir'),
    closing: closingSchema.nullable().describe('Geçerli kapanış; gün açıksa boş'),
    history: z.array(closingSchema).describe('Yeniden açılmış eski kapanışlar, en yeni önce'),
  }),
)

const closingResponseSchema = dataResponse(closingSchema)

/** Bu uçların gövdesi `CommandResult` değildir; durum ve tekrar başlığı burada yazılır. */
function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

export function registerFinanceDayClosingRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')

  typed.get(
    '/api/v1/finance/day-closings/:closingDate',
    {
      preValidation: [app.authenticate, finance, app.requireRole([...FINANCE_DAY_CLOSE_ROLES])],
      schema: {
        operationId: 'getFinanceDayReport',
        tags: ['finance-day-closings'],
        summary: 'Gün sonu raporu',
        description:
          'Günün tahsilatları yöntem bazında, iptaller, net tutar ve kasa bilgisi (IST-113, DOM-FIN-036). Gün Europe/Istanbul günüdür. Tahsilat ödeme gününe, iptal iptal gününe yazılır; geçmiş günün tahsilatı bugün iptal edilirse bugünün raporunda görünür, kapatılmış gün değişmez. Kapalı günde özet kapanış anındaki kayıttır. İleri gün 422 `finance_day_in_future`. Başka kurumun tahsilat ve kapanışı görünmez. Roller: `yonetici`, `onburo`.',
        params: paramsSchema,
        response: { 200: reportSchema, ...commandErrors },
      },
    },
    async (request) => ({
      data: await financeDayReportFor(contextOf(request), request.params.closingDate),
    }),
  )

  typed.post(
    '/api/v1/finance/day-closings/:closingDate/close',
    {
      preValidation: [
        app.authenticate,
        finance,
        app.requireRole([...FINANCE_DAY_CLOSE_ROLES]),
        rejectIfMatch(),
        captureInput(),
      ],
      schema: {
        operationId: 'closeFinanceDay',
        tags: ['finance-day-closings'],
        summary: 'Günü kapat',
        description:
          'Günün raporunu kim ve ne zaman bilgisiyle mühürler (IST-113, DOM-FIN-036). Kapanıştan sonra o güne tahsilat girilemez (422 `finance_day_closed`). `reportStamp` raporun döndürdüğü damgadır; rapor değiştiyse 409 `finance_day_report_changed`. Nakit açıksa ya da o gün nakit hareketi olduysa `countedCashCents` zorunludur (422 `cash_count_required`). Kasa farkı varsa ya da açılış kasası önceki kapanıştan farklıysa `note` zorunludur (422 `cash_difference_note_required`, `opening_cash_note_required`). Kapalı gün 409 `finance_day_already_closed`, ileri gün 422 `finance_day_in_future`. Gövde katıdır. `Idempotency-Key` zorunludur. Başarı 201. Roller: `yonetici`, `onburo`.',
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: paramsSchema,
        body: closeFinanceDaySchema,
        response: { 201: closingResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await closeFinanceDayCommand(
        contextOf(request),
        request.params.closingDate,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return closingResponseSchema.parse(sendBody(reply, result))
    },
  )

  typed.post(
    '/api/v1/finance/day-closings/:closingDate/reopen',
    {
      preValidation: [
        app.authenticate,
        finance,
        app.requireRole([...FINANCE_DAY_REOPEN_ROLES]),
        requireIfMatch(),
        captureInput(),
      ],
      schema: {
        operationId: 'reopenFinanceDay',
        tags: ['finance-day-closings'],
        summary: 'Kapatılmış günü yeniden aç',
        description:
          'Gün yeniden açılır, eski kapanış gerekçesiyle kayıtta kalır ve silinmez; yeni kapanış yeni kayıttır (IST-113, DOM-FIN-036). Kapanışı hiç olmayan gün ve başka kurumun günü 404; daha önce yeniden açılmış gün 409 `finance_day_not_closed`. `If-Match` kapanış sürümüdür: eksikse 400 `if_match_required`, tutmazsa 409 `version_conflict`. `Idempotency-Key` zorunludur. Rol: `yonetici`.',
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: paramsSchema,
        body: reopenFinanceDaySchema,
        response: { 200: closingResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { idempotency, expectedVersion } = options(request, 'required')
      if (expectedVersion === null) throw new Error('If-Match guard did not run')
      const result = await reopenFinanceDayCommand(
        contextOf(request),
        request.params.closingDate,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return closingResponseSchema.parse(sendBody(reply, result))
    },
  )
}
