import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { BUDGET_ROLES } from '@kampus/school-core/lib/finance-budget.ts'
import { costReportQuerySchema } from '@kampus/school-core/lib/finance-cost-per-student.ts'

import { errorResponseSchema } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import { campusConsolidationFor, costPerStudentFor } from '../services/finance-cost-reports.ts'
import { authenticatedErrors } from './common.schemas.ts'
import {
  campusConsolidationResponseSchema,
  costPerStudentResponseSchema,
} from './finance-cost-reports.schemas.ts'

/**
 * Öğrenci başı maliyet (ON-249) ve çok kampüslü konsolide rapor (ON-250); docs/domain/finans.md
 * DOM-FIN-065. Modül `finance`; bütçeyle aynı rol (`BUDGET_ROLES`, bugün yalnız yönetici; K-60).
 * Salt okurdur, kayıt değiştirmez; kurum ve dönem oturumun kurumundandır.
 */
export function registerFinanceCostReportRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guard = [app.authenticate, app.requireModule('finance'), app.requireRole(BUDGET_ROLES)]
  const rule =
    'Rol: `yonetici` (diğerleri 403); `finance` modülü kapalıysa 403 `module_disabled`. Olmayan ya da başka kurumun dönemi 404. Bilinmeyen parametre 400. Yanıt kişi verisi taşımaz.'

  typed.get(
    '/api/v1/finance/cost-per-student',
    {
      preValidation: guard,
      schema: {
        operationId: 'getFinanceCostPerStudent',
        tags: ['finance-cost-reports'],
        summary: 'Öğrenci başı maliyet',
        description: `Seçilen bütçe döneminin gider satırları maliyet merkezlerine dağıtılır (ON-249; DOM-FIN-065). Birim merkezlerinin (ortak) gideri yukarıdan aşağıya, kapsamındaki öğrencili kampüs ve program merkezlerine \`key\` anahtarıyla paylaştırılır: \`students\` (varsayılan) öğrenci sayısıyla orantılı, \`equal\` eşit; kalan kuruş en büyük kesre. Öğrenci dönemde kayıtlıysa sayılır (kayıt günü dönem bitişinden sonra değil; pasifse ayrılış ya da mezuniyet günü dönem başından önce değil); kampüs ve sınıf düzeyi güncel sınıftan, kur bağı dönemle kesişen grup üyeliğinden okunur. Öğrencisi \`minGroupSize\`'dan (5) az merkezde öğrenci başı değer boştur ve \`suppressed\` işaretlidir. Gelir satırı girmez. Tutarlar kuruş. ${rule}`,
        querystring: costReportQuerySchema,
        response: {
          200: costPerStudentResponseSchema,
          ...authenticatedErrors,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => ({ data: await costPerStudentFor(contextOf(request), request.query) }),
  )

  typed.get(
    '/api/v1/finance/campus-consolidation',
    {
      preValidation: guard,
      schema: {
        operationId: 'getFinanceCampusConsolidation',
        tags: ['finance-cost-reports'],
        summary: 'Çok kampüslü konsolide rapor',
        description: `Kampüsler bazında seçilen bütçe döneminin tahakkuk, tahsilat, tahsilat iptali, iade, net tahsilat, öğrenci sayısı ve bütçe gideri; kampüsler toplamı ve paylar (ON-250; DOM-FIN-065). Gelir dönemi bütçe döneminin günleridir; tahakkuk vade gününde, tahsilat ödeme gününde, iptal iptal gününde, iade ödeme gününde sayılır, toplam aynı dönemin \`/finance/summary\` toplamına eşittir. Öğrencinin kampüsü güncel sınıfının kampüsüdür; kampüssüz öğrencinin hareketi ve kampüs merkezine bağlanmamış gider \`campusId: null\` satırına yazılır. Bütçe gideri öğrenci başı maliyet raporundaki kampüs merkezinin toplamıdır (\`key\` ile aynı paylaştırma). Küçük grupta öğrenci başı değerler boştur. Kurum grubu konsolidasyonu kapsam dışıdır. ${rule}`,
        querystring: costReportQuerySchema,
        response: {
          200: campusConsolidationResponseSchema,
          ...authenticatedErrors,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => ({ data: await campusConsolidationFor(contextOf(request), request.query) }),
  )
}
