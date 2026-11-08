import {
  boardReportPeriod,
  financeBoardReport,
  type BoardReport,
  type BoardReportQuery,
  type BoardReportTerm,
} from '@kampus/school-core/lib/finance-board-report.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import { loadAcademicYears } from '../db/academic-years.ts'
import { loadFunnelProspects } from '../db/enrollment-funnel.ts'
import { loadPackageReportSales } from '../db/finance-packages.ts'
import {
  allocatedTotals,
  paymentsForReconciliation,
  paymentsTouchingPeriod,
} from '../db/payments.ts'
import { withdrawalsForBoardReport } from '../db/withdrawals.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { dayRange } from './list-filters.ts'
import { getInstitutionModules } from './modules.ts'
import { FINANCE_TABLE_STORES, mapOperationError, runReadOnly } from './operation-runner.ts'

/**
 * Yönetim kurulu raporu (`GET /finance/board-report`; DOM-FIN-064, ON-251). Hesap core
 * `financeBoardReport`'tadır; servis yalnız tek salt okunur görüntüde yükler. Kurum yalnız oturumdan
 * gelir; yanıt kişi adı ve kimliği taşımaz, satır ve tutar loglanmaz. Aday hunisi `crm`, yenileme
 * oranı `renewal` modülü kapalıysa hesaplanmaz; paket toplamı yalnız dil okulundadır.
 */

const DAY = 86_400_000
/** İstanbul gününün iki yanını da kapsar; kesin gün süzmesi core `dayKey` ile yapılır. */
const instant = (day: string, offsetDays: number) =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + offsetDays * DAY)

export function financeBoardReportFor(
  ctx: ServiceContext,
  query: BoardReportQuery,
): Promise<BoardReport & { terms: BoardReportTerm[] }> {
  const today = dayKey(ctx.now)
  return runReadOnly(ctx, {
    action: 'finance.board_report',
    collections: ['students', 'invoices', 'contracts', 'renewals'],
    stores: FINANCE_TABLE_STORES,
    load: async (tx) => {
      const institution = await getInstitutionModules(tx, ctx.institutionId)
      if (institution === null) throw new NotFoundError()
      const years = await loadAcademicYears(tx, ctx.institutionId)
      const stored = years.find((item) => item.startYear === query.year)
      const terms = (stored?.terms ?? [])
        .map(({ id, name, startDate, endDate }) => ({ id, name, startDate, endDate }))
        .sort((left, right) => left.startDate.localeCompare(right.startDate))
      let period
      try {
        period = boardReportPeriod({
          year: query.year,
          yearRange: stored ? { startDate: stored.startDate, endDate: stored.endDate } : null,
          terms,
          query,
          today,
        })
      } catch (error) {
        throw mapOperationError(error)
      }
      const { modules, type } = institution
      const [payments, methodPayments, allocated, withdrawals, prospects, packageSales] = [
        await paymentsForReconciliation(tx, ctx.institutionId, instant(period.to, 2)),
        await paymentsTouchingPeriod(
          tx,
          ctx.institutionId,
          instant(period.from, -1),
          instant(period.to, 2),
        ),
        await allocatedTotals(tx, ctx.institutionId),
        await withdrawalsForBoardReport(tx, ctx.institutionId),
        modules.crm === true
          ? await loadFunnelProspects(
              tx,
              ctx.institutionId,
              dayRange('createdAt', period.from, period.to),
            )
          : null,
        type === 'language_school' ? await loadPackageReportSales(tx, ctx.institutionId) : null,
      ]
      const renewalModule = modules.renewal === true
      return {
        run: (state) => ({
          ...financeBoardReport({
            period,
            today,
            institutionType: type,
            invoices: state.invoices,
            contracts: state.contracts,
            cancelledContractIds: new Set(
              state.renewals
                .filter((item) => item.status === 'İptal')
                .flatMap((item) => (item.contractId ? [item.contractId] : [])),
            ),
            payments,
            methodPayments,
            allocated,
            withdrawals,
            students: state.students,
            renewals: renewalModule ? state.renewals : null,
            prospects,
            packageSales,
          }),
          terms,
        }),
      }
    },
  })
}
