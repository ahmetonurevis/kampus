import {
  cashFlowForecast,
  revenueForecast,
  type CashFlowForecast,
  type CashFlowForecastQuery,
  type RevenueForecast,
  type RevenueForecastQuery,
} from '@kampus/school-core/lib/finance-forecast.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import { findPublishedTariff } from '../db/fee-tariffs.ts'
import {
  loadEnrollmentYear,
  loadForecastProspects,
  loadPendingRefunds,
} from '../db/finance-forecasts.ts'
import { allocatedTotals } from '../db/payments.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { getInstitutionModules } from './modules.ts'
import { FINANCE_TABLE_STORES, runReadOnly } from './operation-runner.ts'

/**
 * Gelir ve nakit akışı tahmini (ON-246, ON-247; DOM-FIN-063). Hesap core `lib/finance-forecast.ts`'tedir;
 * bütün satırlar tek salt okur görüntüden okunur, hiçbir şey yazılmaz. Kurum oturumdan gelir. Aday
 * satırları yalnız `crm` modülü açıkken okunur; kapalıyken huni kalemi boştur. Yanıt kişi verisi
 * taşımaz, tutar loglanmaz.
 */

export function financeRevenueForecastFor(
  ctx: ServiceContext,
  query: RevenueForecastQuery,
): Promise<RevenueForecast> {
  const today = dayKey(ctx.now)
  return runReadOnly(ctx, {
    action: 'finance.revenue_forecast',
    collections: ['invoices', 'contracts', 'renewals'],
    stores: FINANCE_TABLE_STORES,
    load: async (tx) => {
      const institution = await getInstitutionModules(tx, ctx.institutionId)
      if (institution === null) throw new NotFoundError()
      const enrollmentYear =
        (await loadEnrollmentYear(tx, ctx.institutionId)) ?? Number(today.slice(0, 4))
      const year = query.year ?? enrollmentYear
      const tariff =
        (await findPublishedTariff(tx, ctx.institutionId, year)) ??
        (await findPublishedTariff(tx, ctx.institutionId, year - 1))
      const prospects =
        institution.modules.crm === true ? await loadForecastProspects(tx, ctx.institutionId) : null
      return {
        run: (state) =>
          revenueForecast({
            year,
            enrollmentYear,
            institutionType: institution.type,
            today,
            invoices: state.invoices,
            contracts: state.contracts,
            renewals: state.renewals,
            prospects,
            tariff:
              tariff === null ? null : { academicYear: tariff.academicYear, items: tariff.items },
          }),
      }
    },
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
    load: async (tx) => {
      const [allocated, pendingRefunds] = [
        await allocatedTotals(tx, ctx.institutionId),
        await loadPendingRefunds(tx, ctx.institutionId),
      ]
      return {
        run: (state) =>
          cashFlowForecast({
            today: dayKey(ctx.now),
            months: query.months,
            monthlyExpenseCents: query.monthlyExpenseCents ?? null,
            invoices: state.invoices,
            allocated,
            pendingRefunds,
          }),
      }
    },
  })
}
