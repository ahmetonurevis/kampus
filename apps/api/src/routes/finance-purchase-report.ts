import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  PURCHASE_REPORT_ROLES,
  purchaseReportQuerySchema,
} from '@kampus/school-core/lib/finance-purchase-report.ts'

import { errorResponseSchema } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import { purchaseReportCsvFor, purchaseReportFor } from '../services/finance-purchase-report.ts'
import { authenticatedErrors } from './common.schemas.ts'
import { purchaseReportResponse } from './finance-purchase-report.schemas.ts'

/**
 * Satın alma raporu ucu (docs/domain/finans.md DOM-FIN-075; ON-227, ON-336). Modül `finance`; bütçeyi gören
 * rol (`PURCHASE_REPORT_ROLES`, bugün yalnız yönetici; ön büro görmez, K-155). Salt okurdur; CSV
 * şahıs tedarikçinin adını taşıdığı için taze oturum ister ve denetime düşer.
 */

const wantsCsv = (request: FastifyRequest) => (request.headers.accept ?? '').includes('text/csv')
const CSV_PER_MINUTE = 10
const READS_PER_MINUTE = 300

export function registerFinancePurchaseReportRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const freshForCsv: preValidationAsyncHookHandler = async function (request, reply) {
    if (wantsCsv(request)) await app.requireFreshSession.call(app, request, reply)
  }

  typed.get(
    '/api/v1/finance/purchase-report',
    {
      config: {
        rateLimit: {
          max: (request: FastifyRequest) => (wantsCsv(request) ? CSV_PER_MINUTE : READS_PER_MINUTE),
          timeWindow: '1 minute',
          hook: 'preHandler' as const,
          keyGenerator: (request: FastifyRequest) =>
            wantsCsv(request)
              ? `purchase-report-csv:${request.auth?.userId ?? request.ip}`
              : request.ip,
        },
      },
      preValidation: [
        app.authenticate,
        app.requireModule('finance'),
        app.requireRole(PURCHASE_REPORT_ROLES),
        freshForCsv,
      ],
      schema: {
        operationId: 'getFinancePurchaseReport',
        tags: ['finance-procurement'],
        summary: 'Satın alma raporu',
        description: `Bütçe dönemi (\`periodId\`) ya da tarih aralığı (\`from\`, \`to\`; Europe/Istanbul günleri, ikisi dahil, en çok 366 gün) için siparişlerin (DOM-FIN-073) tedarikçi kategorisi, tedarikçi, maliyet merkezi ve gider kalemi bazında sayısı, net, KDV ve brüt tutarı ile brüt payı (DOM-FIN-075). Bütçe döneminde talebin dönemi, aralıkta siparişin açılış günü belirler; iptal edilen sipariş toplamlara girmez, \`cancelled\` altında sayılır, taslak sipariş girer (K-156). Çok kategorili tedarikçinin siparişi her kategorisinde sayılır (K-157). Her satırda ve toplamda ayrıca teslim alınan (iptal edilmemiş kabullerde kabul edilen miktar × sipariş birim fiyatı, **KDV hariç**), faturalanan (siparişe bağlı iptal edilmemiş faturalar, **KDV dahil**), ödenen (bu faturalara iptal edilmemiş ödemeler, **KDV dahil**) ve açık tutar (faturalanan eksi ödenen, **KDV dahil**) döner; kabul, fatura ve ödeme günü süzülmez, kapsamdaki siparişlerinkidir (K-195, K-196). Siparişe bağlı olmayan faturalar \`unlinkedInvoices\` satırındadır: fatura tarihi aralıkta (bütçe döneminde dönemin günlerinde); toplamlara girmez (K-197). İptal edilen siparişin faturası ve ödemesi \`cancelled\` altındadır (K-198). Talepten siparişe süre talebin gönderim gününden siparişin açılış gününe takvim günüdür; ortalama bir ondalık; en çok harcama yapılan beş tedarikçi \`topSuppliers\` (K-158). Dönem ve aralık birlikte, eksik ya da ters aralık 400. Olmayan ya da başka kurumun dönemi 404. Vergi numarası dönmez; şahıs tedarikçinin adı kişisel veridir. \`Accept: text/csv\` ile tek tablo CSV iner (sütun başlıkları KDV hariç/dahil esasını yazar, siparişsiz fatura toplamın altında ayrı satırdır; K-199): \`;\` ayırıcı, UTF-8 BOM, ondalık virgül, formül kaçışı; taze oturum ister (eskiyse 403 \`reauthentication_required\`), kullanıcı başına 10/dk, denetim \`finance.purchase_report_export\`. Rol: \`yonetici\` (ön büro dahil diğerleri 403, K-155); \`finance\` modülü kapalıysa 403 \`module_disabled\`. Salt okurdur.`,
        querystring: purchaseReportQuerySchema,
        // CSV gövdesi `reply.serializer` ile gider; şemada yalnız JSON durur, istemci tipi tek kalsın.
        response: { 200: purchaseReportResponse, ...authenticatedErrors, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      if (wantsCsv(request)) {
        const { csv, filename } = await purchaseReportCsvFor(ctx, request.query)
        return (reply as FastifyReply)
          .type('text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .serializer((payload: unknown) => String(payload))
          .send(`\uFEFF${csv}`)
      }
      return { data: await purchaseReportFor(ctx, request.query) }
    },
  )
}
