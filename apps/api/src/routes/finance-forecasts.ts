import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  cashFlowForecastQuerySchema,
  FINANCE_FORECAST_ROLES,
  revenueForecastQuerySchema,
} from '@kampus/school-core/lib/finance-forecast.ts'
import {
  FINANCE_SCENARIO_MAX,
  financeScenarioRequestSchema,
} from '@kampus/school-core/lib/finance-scenarios.ts'

import { errorResponseSchema } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  financeCashFlowForecastFor,
  financeRevenueForecastFor,
  financeScenarioComparisonFor,
} from '../services/finance-forecasts.ts'
import { authenticatedErrors } from './common.schemas.ts'
import {
  cashFlowForecastResponseSchema,
  financeScenarioResponseSchema,
  revenueForecastResponseSchema,
} from './finance-forecasts.schemas.ts'

/**
 * Gelir ve nakit akışı tahmini (ON-246, ON-247; docs/domain/finans.md DOM-FIN-063) ve senaryo
 * analizi (ON-248; DOM-FIN-067). Modül `finance`,
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
  // Senaryo gövdesi iç içe ve en çok dört elemanlıdır; sorgu dizesine sığmadığı için POST'tur ama
  // hiçbir şey yazmaz (K-90; `assessment/plan/preview` gibi).
  typed.post(
    '/api/v1/finance/forecasts/scenarios',
    {
      preValidation: [app.authenticate, finance, app.requireRole(FINANCE_FORECAST_ROLES)],
      schema: {
        operationId: 'compareFinanceScenarios',
        tags: ['finance-forecasts'],
        summary: 'Gelir senaryolarını karşılaştır',
        description: `Gelir tahmininin (\`GET /finance/forecasts/revenue\`) üzerine en çok ${String(FINANCE_SCENARIO_MAX)} senaryo uygular ve temel ile karşılaştırır (ON-248; K24; DOM-FIN-067). **Hiçbir şey yazmaz**, senaryo saklanmaz (salt okur görüntü; \`Idempotency-Key\` gerekmez). Her senaryoda yeni kayıt ve yenileme öğrenci değişimi (\`unit\` \`percent\`: on binde bir, −10.000…20.000; \`count\`: ±10.000), fiyat değişimi (\`priceChangeBasisPoints\`, −5.000…20.000), indirim ve burs oranı değişimi (\`discountChangeBasisPoints\`, ±10.000; sonuç %0–%100) ve \`applyToExistingContracts\` (varsayılan \`false\`: fiyat ve indirim değişimi mevcut sözleşmeleri değiştirmez, yalnız huni ve eklenen öğrenciye uygulanır). Verilmeyen alan sıfır değişimdir. Yeni kayıt segmenti kesin yeni kayıt + huni beklentisi, yenileme segmenti yapılmış yenilemelerdir; azalma önce huniden düşer. \`year\` verilmezse kurumun kayıt yılı. \`cashFlowMonths\` (1–24) verilirse temel nakit akışı (gidersiz) ile her senaryonun aylık neti döner: gelir farkı eğitim yılının bu aydan sonraki aylarına eşit yayılır ve vadesinde tahsil oranıyla beklenir. Tutarlar kuruş, oranlar on binde bir. Yanıt kişi verisi taşımaz. Bilinmeyen alan 400. Rol: \`yonetici\` (diğerleri 403); \`finance\` modülü kapalıysa 403 \`module_disabled\`.`,
        body: financeScenarioRequestSchema,
        response: {
          200: financeScenarioResponseSchema,
          ...authenticatedErrors,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => ({
      data: await financeScenarioComparisonFor(contextOf(request), request.body),
    }),
  )
}
