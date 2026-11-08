import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  cashFlowForecastQuerySchema,
  FINANCE_FORECAST_ROLES,
  revenueForecastQuerySchema,
} from '@kampus/school-core/lib/finance-forecast.ts'

import { errorResponseSchema } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  financeCashFlowForecastFor,
  financeRevenueForecastFor,
} from '../services/finance-forecasts.ts'
import { authenticatedErrors } from './common.schemas.ts'
import {
  cashFlowForecastResponseSchema,
  revenueForecastResponseSchema,
} from './finance-forecasts.schemas.ts'

/**
 * Gelir ve nakit akışı tahmini (ON-246, ON-247; docs/domain/finans.md DOM-FIN-063). Modül `finance`,
 * rol core `FINANCE_FORECAST_ROLES` (yönetici; muhasebe rolü açılınca o da). Salt okurdur, kayıt
 * değiştirmez; kurum oturumdan gelir.
 */
export function registerFinanceForecastRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')

  typed.get(
    '/api/v1/finance/forecasts/revenue',
    {
      preValidation: [app.authenticate, finance, app.requireRole(FINANCE_FORECAST_ROLES)],
      schema: {
        operationId: 'getFinanceRevenueForecast',
        tags: ['finance-forecasts'],
        summary: 'Gelir tahmini',
        description:
          'Seçilen eğitim yılının gelir tahmini (ON-246; IST-104, IST-117; DOM-FIN-063). `year` verilmezse kurumun kayıt yılı. Kesin gelir yılın iptal edilmemiş taksitlerinin toplamıdır (yeni kayıt ve yenileme ayrı). `contracts` yılın yürürlükteki sözleşmelerindeki liste fiyatı, indirim ve bursu bilgi olarak verir. Huni beklentisi son 24 ayda açılmış açık adayların ulaştıkları adıma göre, son 24 ayda kapanmış adaylardan hesaplanan dönüşüm oranı ile tarife fiyatı (yoksa önceki yılın tarifesi, o da yoksa sözleşme ortalaması) çarpımıdır; indirim ve burs aynı sözleşmelerin oranıyla düşülür. Huni geçmiş yılda ve `crm` modülü kapalıyken `null`dır. Varsayımlar `assumptions` alanındadır. Tutarlar kuruş, oranlar on binde bir. Yanıt kişi verisi taşımaz. Bilinmeyen parametre 400. Rol: `yonetici` (diğerleri 403); `finance` modülü kapalıysa 403 `module_disabled`.',
        querystring: revenueForecastQuerySchema,
        response: {
          200: revenueForecastResponseSchema,
          ...authenticatedErrors,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => ({
      data: await financeRevenueForecastFor(contextOf(request), request.query),
    }),
  )

  typed.get(
    '/api/v1/finance/forecasts/cash-flow',
    {
      preValidation: [app.authenticate, finance, app.requireRole(FINANCE_FORECAST_ROLES)],
      schema: {
        operationId: 'getFinanceCashFlowForecast',
        tags: ['finance-forecasts'],
        summary: 'Nakit akışı tahmini',
        description:
          'Bu aydan başlayarak `months` ay (1–24, varsayılan 12) için aylık nakit akışı tahmini (ON-247; IST-105; DOM-FIN-063). Ay Europe/Istanbul ayıdır. Planlanan tahsilat vadesi bugün ya da sonra olan taksitlerin kalan tutarıdır; beklenen tahsilat son 12 ayın vadesinde (30 gün içinde) tahsil oranıyla düzeltilir, fark tahsil riskidir. Bugün gecikmiş açık tutar geç tahsil oranıyla ilk aya yazılır. Ödenmemiş ayrılış iadesi vadesinin ayına (geçmişse ilk aya) çıkış olarak yazılır. Gider planı yoktur: `monthlyExpenseCents` verilirse her aya aynı gider yazılır, verilmezse `expenseCents` `null` ve `assumptions.expenseSource` `none`dır. Örneklem boşsa oran varsayılandır (`default`). Tutarlar kuruş, oranlar on binde bir. Rol: `yonetici` (diğerleri 403); `finance` modülü kapalıysa 403 `module_disabled`.',
        querystring: cashFlowForecastQuerySchema,
        response: {
          200: cashFlowForecastResponseSchema,
          ...authenticatedErrors,
        },
      },
    },
    async (request) => ({
      data: await financeCashFlowForecastFor(contextOf(request), request.query),
    }),
  )
}
