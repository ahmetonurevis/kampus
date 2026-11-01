import { createHash } from 'node:crypto'

import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import {
  financeExportQuerySchema,
  financePeriodSchema,
} from '@kampus/school-core/lib/finance-export.ts'

import { contextOf } from '../plugins/authenticate.ts'
import { financeExportFor, financeSummaryFor } from '../services/finance-exports.ts'
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

/** Çerez özeti kullanıcıyı ayırır; ham çerez bellekte anahtar olarak tutulmaz. */
function exportRateKey(request: FastifyRequest): string {
  const cookie = request.headers.cookie
  return cookie ? createHash('sha256').update(cookie).digest('hex') : request.ip
}

export function registerFinanceExportRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')

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
        rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: exportRateKey },
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
