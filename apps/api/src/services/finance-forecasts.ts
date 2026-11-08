import type { State } from '@kampus/school-core/data/seed.ts'
import {
  cashFlowForecast,
  revenueForecast,
  type CashFlowForecast,
  type CashFlowForecastQuery,
  type RevenueForecast,
  type RevenueForecastQuery,
} from '@kampus/school-core/lib/finance-forecast.ts'
import {
  financeScenarioComparison,
  type FinanceScenarioComparison,
  type FinanceScenarioRequest,
} from '@kampus/school-core/lib/finance-scenarios.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import { findPublishedTariff } from '../db/fee-tariffs.ts'
import {
  loadEnrollmentYear,
  loadForecastProspects,
  loadPendingRefunds,
} from '../db/finance-forecasts.ts'
import { allocatedTotals } from '../db/payments.ts'
import { NotFoundError } from '../errors.ts'
import type { Database } from '../db/client.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { getInstitutionModules } from './modules.ts'
import { FINANCE_TABLE_STORES, runReadOnly } from './operation-runner.ts'

/**
 * Gelir ve nakit akışı tahmini (ON-246, ON-247; DOM-FIN-063) ve senaryo analizi (ON-248; DOM-FIN-067).
 * Hesap core `lib/finance-forecast.ts` ve `lib/finance-scenarios.ts`'tedir;
 * bütün satırlar tek salt okur görüntüden okunur, hiçbir şey yazılmaz. Kurum oturumdan gelir. Aday
 * satırları yalnız `crm` modülü açıkken okunur; kapalıyken huni kalemi boştur. Yanıt kişi verisi
 * taşımaz, tutar loglanmaz.
 */

type ForecastState = Pick<State, 'invoices' | 'contracts' | 'renewals'>

/** Gelir tahmininin bütün girdilerini görüntüden okur; hesap `state` ile çalışır. */
async function revenueLoader(
  tx: Database,
  ctx: ServiceContext,
  requestedYear: number | undefined,
): Promise<(state: ForecastState) => RevenueForecast> {
  const today = dayKey(ctx.now)
  const institution = await getInstitutionModules(tx, ctx.institutionId)
  if (institution === null) throw new NotFoundError()
  const enrollmentYear =
    (await loadEnrollmentYear(tx, ctx.institutionId)) ?? Number(today.slice(0, 4))
  const year = requestedYear ?? enrollmentYear
  const tariff =
    (await findPublishedTariff(tx, ctx.institutionId, year)) ??
    (await findPublishedTariff(tx, ctx.institutionId, year - 1))
  const prospects =
    institution.modules.crm === true ? await loadForecastProspects(tx, ctx.institutionId) : null
  return (state) =>
    revenueForecast({
      year,
      enrollmentYear,
      institutionType: institution.type,
      today,
      invoices: state.invoices,
      contracts: state.contracts,
      renewals: state.renewals,
      prospects,
      tariff: tariff === null ? null : { academicYear: tariff.academicYear, items: tariff.items },
    })
}

/** Nakit akışı tahmininin taksit dışı girdilerini (dağıtılmış tahsilat, iade) okur. */
async function cashFlowLoader(
  tx: Database,
  ctx: ServiceContext,
  query: CashFlowForecastQuery,
): Promise<(state: Pick<State, 'invoices'>) => CashFlowForecast> {
  const allocated = await allocatedTotals(tx, ctx.institutionId)
  const pendingRefunds = await loadPendingRefunds(tx, ctx.institutionId)
  return (state) =>
    cashFlowForecast({
      today: dayKey(ctx.now),
      months: query.months,
      monthlyExpenseCents: query.monthlyExpenseCents ?? null,
      invoices: state.invoices,
      allocated,
      pendingRefunds,
    })
}

export function financeRevenueForecastFor(
  ctx: ServiceContext,
  query: RevenueForecastQuery,
): Promise<RevenueForecast> {
  return runReadOnly(ctx, {
    action: 'finance.revenue_forecast',
    collections: ['invoices', 'contracts', 'renewals'],
    stores: FINANCE_TABLE_STORES,
    load: async (tx) => ({ run: await revenueLoader(tx, ctx, query.year) }),
  })
}

export function financeCashFlowForecastFor(
  ctx: ServiceContext,
  query: CashFlowForecastQuery,
): Promise<CashFlowForecast> {
  return runReadOnly(ctx, {
    action: 'finance.cash_flow_forecast',
    collections: ['invoices'],
    stores: FINANCE_TABLE_STORES,
    load: async (tx) => ({ run: await cashFlowLoader(tx, ctx, query) }),
  })
}

/**
 * Senaryo karşılaştırması (DOM-FIN-067): gelir tahmini ve istenirse nakit akışı tahmini aynı salt
 * okur görüntüden hesaplanır; senaryo saklanmaz (K-90). Nakit akışında gider girilmez, temel net
 * tahsilat eksi iadedir.
 */
export function financeScenarioComparisonFor(
  ctx: ServiceContext,
  request: FinanceScenarioRequest,
): Promise<FinanceScenarioComparison> {
  return runReadOnly(ctx, {
    action: 'finance.scenario_forecast',
    collections: ['invoices', 'contracts', 'renewals'],
    stores: FINANCE_TABLE_STORES,
    load: async (tx) => {
      const revenue = await revenueLoader(tx, ctx, request.year)
      const months = request.cashFlowMonths
      const cashFlow = months === undefined ? null : await cashFlowLoader(tx, ctx, { months })
      return {
        run: (state) =>
          financeScenarioComparison({
            forecast: revenue(state),
            scenarios: request.scenarios,
            cashFlow: cashFlow === null ? null : cashFlow(state),
          }),
      }
    },
  })
}
