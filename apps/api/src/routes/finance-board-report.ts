import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { boardReportQuerySchema } from '@kampus/school-core/lib/finance-board-report.ts'

import { contextOf } from '../plugins/authenticate.ts'
import { financeBoardReportFor } from '../services/finance-board-report.ts'
import { commandErrors } from './commands.schemas.ts'
import { boardReportResponseSchema } from './finance-board-report.schemas.ts'

/** Yönetim kurulu raporu (DOM-FIN-064, ON-251). Modül `finance`; yalnız yönetici okur (K-80). */
const MANAGER = ['yonetici'] as const

export function registerFinanceBoardReportRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  typed.get(
    '/api/v1/finance/board-report',
    {
      preValidation: [app.authenticate, app.requireModule('finance'), app.requireRole(MANAGER)],
      schema: {
        operationId: 'getFinanceBoardReport',
        tags: ['finance-board-report'],
        summary: 'Yönetim kurulu raporu: dönemlik finans ve kayıt özeti',
        description:
          'Seçilen dönemin yönetim kurulu özeti (DOM-FIN-064); kişi adı ve kimliği taşımaz, PDF web’de üretilir. Dönem `year` eğitim yılıdır (kayıt yoksa 1 Eylül – 31 Ağustos); `termId` yılın dönemini, `from`/`to` elle aralığı seçer (en çok bir yıl; yalnız bir uç ya da dönem ile aralık birlikte 400). Süren dönemde bitiş bugündür. `finance.totals` yıl sonu mutabakatının (DOM-FIN-056) dönem toplamıdır; `methods` tahsilatı ödeme yöntemine göre brüt, iptal ve net verir; `aging` bugünün gecikmiş alacağını (vadesi dönem sonuna kadar gelmiş taksitler) 1–30, 31–60, 61–90 ve 90+ gün dilimlerine ayırır; `packages` dil okulunda paket saat raporu toplamıdır. `enrollment` dönem başı ve sonu kayıtlı sayısı, yeni kayıt, ayrılış, mezuniyet, ayrılış nedeni ve okulda yenileme oranıdır; `funnel` dönemde açılan adayların hunisidir (`crm` kapalıysa `null`). Kırılım hücresinde 1–4 kişi varsa sayı ve tutar `null`, `suppressed: true` gelir; tek gizli hücrede en küçük görünür hücre de gizlenir. Ters dönem 422 `export_period_invalid`, bir yılı aşan 422 `export_period_too_long`, yılda olmayan dönem 422 `board_report_term_not_found`, başlamamış dönem 422 `board_report_period_not_started`. Hiçbir şey yazmaz. Rol: `yonetici`.',
        querystring: boardReportQuerySchema,
        response: { 200: boardReportResponseSchema, ...commandErrors },
      },
    },
    async (request) => ({ data: await financeBoardReportFor(contextOf(request), request.query) }),
  )
}
