import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { BUDGET_ROLES } from '@kampus/school-core/lib/finance-budget.ts'
import { budgetActualsQuerySchema } from '@kampus/school-core/lib/finance-budget-actuals.ts'

import { errorResponseSchema } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import { financeBudgetActualsFor } from '../services/finance-budget-actuals.ts'
import { budgetActualsResponse } from './finance-budget-actuals.schemas.ts'
import { budgetPeriodParams } from './finance-budget.schemas.ts'
import { authenticatedErrors } from './common.schemas.ts'

/**
 * Bütçe–gerçekleşen raporu (ON-244; docs/domain/finans.md DOM-FIN-066). Modül `finance` (K-59), rol
 * core `BUDGET_ROLES` (yönetici; muhasebe rolü açılınca o da). Salt okurdur; kurum oturumdan gelir.
 */
export function registerFinanceBudgetActualsRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')

  typed.get(
    '/api/v1/finance/budget-periods/:periodId/actuals',
    {
      preValidation: [app.authenticate, finance, app.requireRole(BUDGET_ROLES)],
      schema: {
        operationId: 'getBudgetActuals',
        tags: ['finance-budget'],
        summary: 'Bütçe–gerçekleşen karşılaştırması',
        description:
          'Seçilen bütçe döneminin planı kalem × maliyet merkezi × ay bazında gerçekleşenle karşılaştırılır (ON-244; DOM-FIN-066). `basis` `accrual` (varsayılan, K-85): taksit vade gününde, ayrılışta hak edilmeyen tahakkuk ayrılış gününde düşülür; `cash`: tahsilat ödeme gününde, iptal iptal gününde, ödenen iade ödeme gününde; dosyadan aktarılan geçmiş ödeme sayılır ve `openingImportCents`te ayrıca verilir. Hareket ücret türüyle (`fee_kind`) gelir kalemine eşlenir; eşlenmeyen ya da taksite dağıtılmamış tutar `unmatched`tadır. Merkez öğrencinin kampüs ve program bağından bulunur (K-86), gerçekleşen kalem için satırı olan en yakın merkeze yazılır; bulunamazsa `costCenterId` `null` (dağıtılmamış). Hareket dönem ve bugünle sınırlıdır; gelmemiş ayın gerçekleşeni `null`. Gider gerçekleşeni kaynağı yoktur (satın alma modülü kurulmadı): `expenseData` `none`, gider satırı `status` `no_expense_data`. Ay Europe/Istanbul ayı; tutarlar kuruş, oranlar on binde bir. Yanıt kişi verisi taşımaz. Olmayan ya da başka kurumun dönemi 404; bilinmeyen parametre 400. Rol: `yonetici` (diğerleri 403); `finance` modülü kapalıysa 403 `module_disabled`.',
        params: budgetPeriodParams,
        querystring: budgetActualsQuerySchema,
        response: {
          200: budgetActualsResponse,
          ...authenticatedErrors,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => ({
      data: await financeBudgetActualsFor(
        contextOf(request),
        request.params.periodId,
        request.query,
      ),
    }),
  )
}
