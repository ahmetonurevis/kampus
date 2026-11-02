import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import {
  financeExportQuerySchema,
  financeOverviewQuerySchema,
  financePeriodSchema,
} from '@kampus/school-core/lib/finance-export.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  financeExportFor,
  financeOverviewFor,
  financeSummaryFor,
  financeTotalsFor,
  studentBalanceFor,
} from '../services/finance-exports.ts'
import { commandErrors } from './commands.schemas.ts'
import { dataResponse } from './common.schemas.ts'

/**
 * Muhasebe dışa aktarımı (IST-111; guvenlik-kvkk.md). Modül `finance`. Dönem özeti yönetici ve ön
 * büro; kişisel veri taşıyan dosya yalnız yönetici, taze oturum ve kullanıcı başına 10/dk.
 */

const totals = z.object({ count: z.number().int(), totalCents: z.number().int() })
const summarySchema = dataResponse(
  z.object({
    payments: totals.describe('Tahsilat: iptaller eksi satır olarak düşer'),
    refunds: totals.describe('Ödenmiş iadeler'),
    invoices: totals
      .extend({ paidCents: z.number().int() })
      .describe('Vadesi dönemde olan taksitler'),
  }),
)

const overviewSchema = dataResponse(
  z.object({
    from: z.string(),
    to: z.string(),
    today: z.string(),
    collectedCents: z.number().int().describe('Dönemde alınan net tahsilat'),
    openCents: z.number().int().describe('Bugün kurum geneli açık tutar'),
    overdueCents: z.number().int().describe('Bugün kurum geneli gecikmiş tutar'),
    months: z.array(
      z.object({
        month: z.string().describe('YYYY-MM, Europe/Istanbul'),
        collectedCents: z.number().int(),
        dueCents: z.number().int(),
        openCents: z.number().int(),
        overdueCents: z.number().int(),
      }),
    ),
    overdueStudents: z.array(
      z.object({
        studentId: z.string(),
        overdueCents: z.number().int(),
        oldestDueDate: z.string(),
      }),
    ),
  }),
)

/** Sayaç doğrulanmış kullanıcıyadır; istemcinin değiştirebildiği başlığa bağlanmaz. */
function exportRateKey(request: FastifyRequest): string {
  return request.auth?.userId ?? request.ip
}

export function registerFinanceExportRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')

  typed.get(
    '/api/v1/finance/totals',
    {
      preValidation: [app.authenticate, finance, app.requireRole(['yonetici', 'onburo'])],
      schema: {
        operationId: 'getFinanceTotals',
        tags: ['finance-exports'],
        summary: 'Kurum geneli finans toplamları',
        description:
          'Finans ekranı kartları: toplam, tahsil edilen (kısmi ödemeler dahil), kalan ve gecikmiş tutar (DOM-FIN-030). Gecikmiş tutar yalnız kalan kısımdır. Roller: `yonetici`, `onburo`.',
        response: {
          200: dataResponse(
            z.object({
              totalCents: z.number().int(),
              paidCents: z.number().int(),
              remainingCents: z.number().int(),
              overdueCents: z.number().int(),
            }),
          ),
          ...commandErrors,
        },
      },
    },
    async (request) => ({ data: await financeTotalsFor(contextOf(request)) }),
  )

  typed.get(
    '/api/v1/finance/overview',
    {
      preValidation: [app.authenticate, finance, app.requireRole(['yonetici', 'onburo'])],
      schema: {
        operationId: 'getFinanceOverview',
        tags: ['finance-exports'],
        summary: 'Finans özeti: tahsilat, açık ve gecikmiş tutar',
        description:
          'Yönetici panosu ve erken uyarı için özet (IST-116, IST-121). `collectedCents` ve `months` dönemin tahsilatını ve ay kırılımını verir: iptal, iptal edildiği ayda düşer; vade kırılımı taksitin vade ayına göredir. `openCents` ve `overdueCents` dönemden bağımsız, bugünün kurum geneli tutarıdır ve `/finance/totals` ile aynıdır; kısmi ödemede yalnız kalan kısım sayılır. `overdueStudents` gecikmiş borcu olan öğrencileri tutar büyükten küçüğe verir. Dönem verilmezse son altı takvim ayıdır; yalnız bir uç verilirse 400. Gün Europe/Istanbul günüdür. Başlangıç bitişten sonra 422 `export_period_invalid`, dönem bir yılı aşarsa 422 `export_period_too_long`. Muhasebe dosyasının toplamı için `/finance/summary` kullanılır. Roller: `yonetici`, `onburo`.',
        querystring: financeOverviewQuerySchema,
        response: { 200: overviewSchema, ...commandErrors },
      },
    },
    async (request) => ({ data: await financeOverviewFor(contextOf(request), request.query) }),
  )

  typed.get(
    '/api/v1/finance/students/:studentId/balance',
    {
      preValidation: [
        app.authenticate,
        finance,
        app.requireRole(['yonetici', 'onburo', 'veli', 'ogrenci']),
      ],
      schema: {
        operationId: 'getStudentBalance',
        tags: ['finance-exports'],
        summary: 'Öğrencinin bakiyesi',
        description:
          'Öğrencinin toplam, ödenen, açık ve gecikmiş tutarı, gecikmiş taksit sayısı ve en yakın açık taksiti (DOM-FIN-052). Kısmi ödemede yalnız kalan kısım sayılır; `/finance/totals` ile aynı kural. Veli yalnız velayetli ve kısıtsız bağlı çocuğunu, öğrenci yalnız kendisini okur; kapsam dışı, olmayan ya da başka kurumun öğrencisi 404. Roller: `yonetici`, `onburo`, `veli`, `ogrenci`.',
        params: z.object({ studentId: z.string().min(1).max(200).describe('Öğrenci kimliği') }),
        response: {
          200: dataResponse(
            z.object({
              studentId: z.string(),
              totalCents: z.number().int(),
              paidCents: z.number().int(),
              openCents: z.number().int(),
              overdueCents: z.number().int(),
              overdueCount: z.number().int(),
              nextDue: z.object({ date: z.string(), amountCents: z.number().int() }).nullable(),
            }),
          ),
          ...commandErrors,
        },
      },
    },
    async (request) => ({
      data: await studentBalanceFor(contextOf(request), request.params.studentId),
    }),
  )

  typed.get(
    '/api/v1/finance/summary',
    {
      preValidation: [app.authenticate, finance, app.requireRole(['yonetici', 'onburo'])],
      schema: {
        operationId: 'getFinanceSummary',
        tags: ['finance-exports'],
        summary: 'Dönem finans toplamları',
        description:
          'Tahsilat, ödenmiş iade ve taksit toplamları; dışa aktarım dosyasıyla aynı satırlardan hesaplanır (IST-111). Gün Europe/Istanbul günüdür. Başlangıç bitişten sonra 422 `export_period_invalid`, dönem bir yılı aşarsa 422 `export_period_too_long`. Roller: `yonetici`, `onburo`.',
        querystring: financePeriodSchema,
        response: { 200: summarySchema, ...commandErrors },
      },
    },
    async (request) => ({ data: await financeSummaryFor(contextOf(request), request.query) }),
  )

  typed.get(
    '/api/v1/finance/exports',
    {
      config: {
        // `preHandler`: kimlik `preValidation`'da doğrulanır, anahtar kullanıcı kimliği olur.
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: exportRateKey,
        },
      },
      preValidation: [
        app.authenticate,
        finance,
        app.requireRole(['yonetici']),
        app.requireFreshSession,
      ],
      schema: {
        operationId: 'exportFinance',
        tags: ['finance-exports'],
        summary: 'Muhasebe aktarım dosyası',
        description:
          '`kind` ile tahsilat, iade veya taksit satırlarını CSV olarak döner: `;` ayırıcı, UTF-8 BOM, ondalık virgül, formül kaçışı. Önceki dönem tahsilatının iptali iptal gününde eksi satırdır. Yalnız ödenmiş iade yer alır, IBAN maskelidir. Dosya toplamı `GET /finance/summary` toplamına eşittir. Her aktarım denetim kaydına yazılır. Taze oturum ister: eskiyse 403 `reauthentication_required`. Dönem kuralları özet ucuyla aynıdır. Rol: `yonetici`.',
        querystring: financeExportQuerySchema,
        response: { 200: z.string().describe('CSV dosyası'), ...commandErrors },
      },
    },
    async (request, reply) => {
      const { kind, from, to } = request.query
      const csv = await financeExportFor(contextOf(request), { kind, from, to })
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${kind}-${from}-${to}.csv"`)
        .serializer((payload: unknown) => String(payload))
        .send(`\uFEFF${csv}`)
    },
  )
}
