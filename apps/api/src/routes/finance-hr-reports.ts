import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { FINANCE_HR_REPORT_ROLES } from '@kampus/school-core/lib/finance-hr-reports.ts'

import { contextOf } from '../plugins/authenticate.ts'
import { hrReportCsvFor, hrReportFor } from '../services/finance-hr-reports.ts'
import { commandErrors } from './commands.schemas.ts'
import { hrReportQuery, hrReportResponse } from './finance-hr-reports.schemas.ts'

/**
 * İK raporu ucu (docs/domain/finans.md DOM-FIN-117; ON-192). Modül `finance`; yalnız yönetici.
 * Rapor kişi adı taşımaz; her okuma denetime düşer. CSV ve PDF verisi taze oturum ister,
 * kullanıcı başına 10/dk. Sıra: 401 → 403 modül → 403 rol → taze oturum → 400 → işlem.
 */

const MANAGER = 'Rol: yalnız `yonetici` (K-401). Modül `finance`; kapalıysa 403 `module_disabled`.'
const REPORT_URL = '/api/v1/finance/hr-reports'
const EXPORTS_PER_MINUTE = 10
const READS_PER_MINUTE = 300

const wantsCsv = (request: FastifyRequest) => (request.headers.accept ?? '').includes('text/csv')
/** CSV ya da PDF verisi (sorgu ayrıştırılmadan önce ham sorgudan). */
const isExport = (request: FastifyRequest) =>
  wantsCsv(request) || (request.query as { purpose?: unknown } | undefined)?.purpose === 'pdf'

export function registerFinanceHrReportRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FINANCE_HR_REPORT_ROLES),
  ]
  const freshForExport: preValidationAsyncHookHandler = async function (request, reply) {
    if (isExport(request)) await app.requireFreshSession.call(app, request, reply)
  }

  typed.get(
    REPORT_URL,
    {
      config: {
        rateLimit: {
          max: (request: FastifyRequest) =>
            isExport(request) ? EXPORTS_PER_MINUTE : READS_PER_MINUTE,
          timeWindow: '1 minute',
          hook: 'preHandler' as const,
          keyGenerator: (request: FastifyRequest) =>
            isExport(request)
              ? `hr-report-export:${request.auth?.userId ?? request.ip}`
              : request.ip,
        },
      },
      preValidation: [...guarded, freshForExport],
      schema: {
        operationId: 'getFinanceHrReport',
        tags: ['finance-hr-reports'],
        summary: 'İK raporları: devir oranı, kıdem dağılımı, izin kullanımı',
        description: `\`from\`–\`to\` ayları (en çok 12; varsayılan bu ay, Europe/Istanbul) için kişi adı taşımayan İK özeti (DOM-FIN-117). Personel yönetici, öğretmen ve ön büro üyelikleridir (pasif dahil). Giriş günü izin profilindeki kıdem başlangıcı (ON-181), yoksa üyeliğin açıldığı gün; çıkış günü pasifleştirme günü (K-400). \`turnover\` dönem başı, giriş, çıkış, dönem sonu ve devir oranıdır: çıkış ÷ ((dönem başı + dönem sonu) ÷ 2), on binde bir; kırılım rol (\`teacher\`, \`administrative\`) ve personelin dönemdeki son ayının maliyet merkezi ataması (DOM-FIN-104; paylı kişi her merkezinde, ataması olmayan "Atanmamış"). \`seniority\` dönem sonundaki personelin tam hizmet yılı bantları (0–1, 1–3, 3–5, 5–10, 10+; kıdem başlangıcı yoksa \`unknown\`). \`leave\` dönemde başlayan kullanılmış izinlerin türe göre iş günü, kullanan personel ve ortalama personel başına gün; dönem sonundaki personelin kalan yıllık izin bakiyesi toplamı (DOM-FIN-109); rapor günleri yalnız kurum toplamı (DOM-FIN-110, K-402). Süren dönem bugünde biter (\`endDay\`). 1–4 kişilik kırılımın sayıları \`null\`, \`suppressed: true\`; tek gizli hücre toplamdan geri hesaplanmasın diye en küçük görünür hücre de gizlenir (K-77, K-401). Her okuma denetime düşer: ekran \`finance.hr_report.read\`, \`purpose=pdf\` ve \`Accept: text/csv\` \`finance.hr_report.export\` (yalnız bölüm adları). CSV: \`;\`, UTF-8 BOM, ondalık virgül, formül kaçışı. PDF verisi ve CSV taze oturum ister (eskiyse 403 \`reauthentication_required\`), kullanıcı başına 10/dk. Başlangıç ayı bu aydan sonraysa 422 \`hr_report_period_not_started\`; \`to\` \`from\`'dan önce ya da dönem 12 aydan uzunsa 400. Hiçbir şey yazmaz (denetim dışında). ${MANAGER}`,
        querystring: hrReportQuery,
        // CSV gövdesi `reply.serializer` ile gider; şemada yalnız JSON durur.
        response: { 200: hrReportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      const query = { from: request.query.from, to: request.query.to }
      if (wantsCsv(request)) {
        const { csv, filename } = await hrReportCsvFor(ctx, query)
        return (reply as FastifyReply)
          .type('text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .serializer((payload: unknown) => String(payload))
          .send(`\uFEFF${csv}`)
      }
      return { data: await hrReportFor(ctx, query, request.query.purpose) }
    },
  )
}
