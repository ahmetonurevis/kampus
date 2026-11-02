import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  assertFinancePeriod,
  defaultOverviewPeriod,
  financeOverview,
  financeSummary,
  financeTotals,
  invoiceLines,
  invoicesCsv,
  paymentLines,
  paymentsCsv,
  refundLines,
  refundsCsv,
  studentDirectory,
  type FinanceExportKind,
  type FinanceOverview,
  type FinanceOverviewQuery,
  type FinancePeriod,
  type FinanceSummary,
  type FinanceTotals,
} from '@kampus/school-core/lib/finance-export.ts'

import { allocatedTotals, paymentsTouchingPeriod } from '../db/payments.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { refundsPaidInPeriod } from '../db/withdrawals.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runReadOnly } from './operation-runner.ts'

/**
 * Muhasebe dışa aktarımı (IST-111). Toplam ve dosya aynı görüntüden, aynı satırlardan üretilir.
 * Satır ve tutar loglanmaz; denetime dönem ve tür düşer (DOM-YTK-053, toplu dışa aktarım).
 */

const DAY = 86_400_000
/** İstanbul gününün iki yanını da kapsar; kesin gün süzmesi core `dayKey` ile yapılır. */
const instant = (day: string, offsetDays: number) =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + offsetDays * DAY)

function linesOf(ctx: ServiceContext, period: FinancePeriod) {
  return runReadOnly(ctx, {
    action: 'finance.export',
    collections: ['students', 'invoices'],
    load: async (tx) => {
      const [payments, refunds, allocated] = [
        await paymentsTouchingPeriod(
          tx,
          ctx.institutionId,
          instant(period.from, -1),
          instant(period.to, 2),
        ),
        await refundsPaidInPeriod(tx, ctx.institutionId, period),
        await allocatedTotals(tx, ctx.institutionId),
      ]
      return {
        run: (state) => {
          // İşlem içinde denetlenir: DomainError yalnız burada 422'ye çevrilir.
          assertFinancePeriod(period)
          const students = studentDirectory(state.students)
          return {
            payments: paymentLines(payments, students, period),
            refunds: refundLines(refunds, students, period),
            invoices: invoiceLines(state.invoices, allocated, students, period),
          }
        },
      }
    },
  })
}

/** Finans ekranı kartları: kurum geneli, kısmi ödemeler dahil (DOM-FIN-030). */
export function financeTotalsFor(ctx: ServiceContext): Promise<FinanceTotals> {
  return runReadOnly(ctx, {
    action: 'finance.totals',
    collections: ['invoices'],
    load: async (tx) => {
      const allocated = await allocatedTotals(tx, ctx.institutionId)
      return { run: (state) => financeTotals(state.invoices, allocated, dayKey(ctx.now)) }
    },
  })
}

/**
 * Finans özeti (`GET /finance/overview`; IST-116, IST-121): dönemin tahsilatı ve ay kırılımı, bugünkü
 * açık ve gecikmiş tutar, gecikmiş borcu olan öğrenciler. Dönem verilmezse son altı takvim ayı.
 */
export function financeOverviewFor(
  ctx: ServiceContext,
  query: FinanceOverviewQuery,
): Promise<FinanceOverview> {
  const today = dayKey(ctx.now)
  const period =
    query.from !== undefined && query.to !== undefined
      ? { from: query.from, to: query.to }
      : defaultOverviewPeriod(today)
  return runReadOnly(ctx, {
    action: 'finance.overview',
    collections: ['invoices'],
    load: async (tx) => {
      const [payments, allocated] = [
        await paymentsTouchingPeriod(
          tx,
          ctx.institutionId,
          instant(period.from, -1),
          instant(period.to, 2),
        ),
        await allocatedTotals(tx, ctx.institutionId),
      ]
      return {
        run: (state) => {
          // İşlem içinde denetlenir: DomainError yalnız burada 422'ye çevrilir.
          assertFinancePeriod(period)
          return financeOverview({
            invoices: state.invoices,
            allocated,
            payments,
            period,
            today,
          })
        },
      }
    },
  })
}

export async function financeSummaryFor(
  ctx: ServiceContext,
  period: FinancePeriod,
): Promise<FinanceSummary> {
  const lines = await linesOf(ctx, period)
  return financeSummary(lines.payments, lines.refunds, lines.invoices)
}

export async function financeExportFor(
  ctx: ServiceContext,
  query: FinancePeriod & { kind: FinanceExportKind },
): Promise<string> {
  const lines = await linesOf(ctx, query)
  const csv =
    query.kind === 'payments'
      ? paymentsCsv(lines.payments)
      : query.kind === 'refunds'
        ? refundsCsv(lines.refunds)
        : invoicesCsv(lines.invoices)
  await ctx.db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: 'finance.export',
    entityType: 'finance_export',
    entityId: `${query.kind}:${query.from}:${query.to}`,
    changes: { fields: [] },
    createdAt: ctx.now,
  })
  return csv
}
