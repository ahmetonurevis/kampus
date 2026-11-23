import {
  purchaseReport,
  purchaseReportCsv,
  purchaseReportScope,
  type PurchaseReport,
  type PurchaseReportQuery,
} from '@kampus/school-core/lib/finance-purchase-report.ts'

import type { Database } from '../db/client.ts'
import {
  loadBudgetItems,
  loadBudgetPeriods,
  loadCostCenters,
  type StoredBudgetPeriod,
} from '../db/finance-budget.ts'
import {
  loadPurchaseReportInvoices,
  loadPurchaseReportOrders,
  loadPurchaseReportPayments,
  loadPurchaseReportReceiptLines,
  loadPurchaseReportSuppliers,
} from '../db/finance-purchase-report.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runReadOnly } from './operation-runner.ts'

/**
 * Satın alma raporu (ON-227; DOM-FIN-075). Hesap core `lib/finance-purchase-report.ts`'tedir;
 * siparişler, kabuller, faturalar, ödemeler, tedarikçiler, merkezler ve kalemler tek salt okur
 * görüntüden okunur (sütunlar birbiriyle tutarlıdır), hiçbir şey
 * yazılmaz (CSV dışında: dosya şahıs tedarikçinin adını taşıdığı için denetime düşer). Kurum
 * oturumdan gelir; dönem kurumun bütçe dönemidir (başka kurumun dönemi 404). Tutar ve tedarikçi
 * adı loglanmaz. Rol ve modül denetimi rotadadır (yalnız yönetici, modül `finance`; K-155).
 */

const DAY = 86_400_000
/** İstanbul gününün iki yanını da kapsar; kesin gün süzmesi core'dadır. */
const instant = (day: string, offsetDays: number) =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + offsetDays * DAY)

export interface PurchaseReportResponse extends PurchaseReport {
  scope: 'period' | 'range'
  /** Bütçe döneminde dönemin, aralıkta seçilen günler. */
  from: string
  to: string
  period: Pick<StoredBudgetPeriod, 'id' | 'name' | 'status' | 'startDate' | 'endDate'> | null
}

async function buildReport(
  tx: Database,
  ctx: ServiceContext,
  query: PurchaseReportQuery,
): Promise<PurchaseReportResponse> {
  const scope = purchaseReportScope(query)
  let period: PurchaseReportResponse['period'] = null
  if (scope.kind === 'period') {
    const found = (await loadBudgetPeriods(tx, ctx.institutionId)).find(
      (item) => item.id === scope.periodId,
    )
    if (found === undefined) throw new NotFoundError()
    period = {
      id: found.id,
      name: found.name,
      status: found.status,
      startDate: found.startDate,
      endDate: found.endDate,
    }
  }
  const orders = await loadPurchaseReportOrders(
    tx,
    ctx.institutionId,
    scope.kind === 'period'
      ? { periodId: scope.periodId }
      : { createdFrom: instant(scope.from, -1), createdBefore: instant(scope.to, 2) },
  )
  const orderIds = orders.map((order) => order.id)
  // Kapsamın günleri: aralıkta seçilen günler, dönemde dönemin günleri; siparişsiz fatura bu
  // günlerdeki fatura tarihiyle süzülür (K-197).
  const invoiceDays =
    scope.kind === 'range'
      ? { from: scope.from, to: scope.to }
      : { from: period?.startDate ?? '', to: period?.endDate ?? '' }
  const [suppliers, costCenters, budgetItems, receiptLines, invoices] = [
    await loadPurchaseReportSuppliers(
      tx,
      ctx.institutionId,
      orders.map((order) => order.supplierId),
    ),
    await loadCostCenters(tx, ctx.institutionId),
    await loadBudgetItems(tx, ctx.institutionId),
    await loadPurchaseReportReceiptLines(tx, ctx.institutionId, orderIds),
    await loadPurchaseReportInvoices(tx, ctx.institutionId, orderIds, invoiceDays),
  ]
  const payments = await loadPurchaseReportPayments(
    tx,
    ctx.institutionId,
    invoices.map((invoice) => invoice.id),
  )
  const report = purchaseReport({
    scope,
    orders,
    suppliers,
    costCenters,
    budgetItems,
    receiptLines,
    invoices,
    payments,
    invoiceDays,
  })
  return {
    scope: scope.kind,
    from: invoiceDays.from,
    to: invoiceDays.to,
    period,
    ...report,
  }
}

/** Raporun ekran yanıtı (DOM-FIN-075). */
export function purchaseReportFor(
  ctx: ServiceContext,
  query: PurchaseReportQuery,
): Promise<PurchaseReportResponse> {
  return runReadOnly(ctx, {
    action: 'finance.purchase_report',
    collections: [],
    load: async (tx) => {
      const report = await buildReport(tx, ctx, query)
      return { run: () => report }
    },
  })
}

/**
 * Raporun CSV dosyası. Şahıs tedarikçinin adı kişisel veri olduğu için denetime yazılır
 * (`finance.purchase_report_export`, kimlik kapsam); dosya üretilemezse kayıt düşmez (K-155).
 */
export async function purchaseReportCsvFor(
  ctx: ServiceContext,
  query: PurchaseReportQuery,
): Promise<{ csv: string; filename: string }> {
  const report = await purchaseReportFor(ctx, query)
  const csv = purchaseReportCsv(report)
  const label =
    report.period === null ? `${report.from}:${report.to}` : `period:${report.period.id}`
  await ctx.db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: 'finance.purchase_report_export',
    entityType: 'finance_export',
    entityId: `purchase-report:${label}`,
    changes: { fields: [] },
    createdAt: ctx.now,
  })
  return { csv, filename: `satin-alma-raporu-${report.from}-${report.to}.csv` }
}
