import {
  packageHourReport,
  packageReportCsv,
  studentPackageBalance,
  type PackageBalance,
  type PackageReport,
  type PackageReportLine,
} from '@kampus/school-core/lib/finance-package-report.ts'
import { assertFinancePeriod, type FinancePeriod } from '@kampus/school-core/lib/finance-export.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { financeStudentIds } from '@kampus/school-core/lib/scope.ts'

import { loadPackageReportSales } from '../db/finance-packages.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { mapOperationError } from './operation-runner.ts'
import { assertReadable, readScope } from './read-scope.ts'

/**
 * Paket saat bakiyesi ve kullanılan saat raporu (IST-114; docs/domain/finans.md DOM-FIN-058,
 * dil-okulu.md DOM-DIL-051). Hesap core `lib/finance-package-report.ts`'tedir; servis yalnız yükler,
 * kapsamı uygular ve sayfayı keser.
 */

/** Yönetici ve ön büro kurum geneli okur; ücret payı yalnız onlara döner (DOM-FIN-052). */
const isStaff = (ctx: ServiceContext) =>
  ctx.actor.role === 'yonetici' || ctx.actor.role === 'onburo'

export type PackageBalanceView = Omit<PackageBalance, 'amounts' | 'sales'> & {
  amounts?: PackageBalance['amounts']
  sales: (Omit<PackageBalance['sales'][number], 'amounts'> & {
    amounts?: PackageBalance['sales'][number]['amounts']
  })[]
}

/**
 * Öğrencinin paket bakiyesi. Kapsam `/finance/students/:id/balance` ile aynıdır: veli bağlı çocuğunu
 * ve ödeyicisi olduğu öğrenciyi, öğrenci kendisini okur (K-04). Yönetici ve ön büro ayrılmış
 * kursiyeri de okur; kurumda olmayan öğrenci, kapsam dışı ya da başka kurumun öğrencisi aynı 404.
 * Veli ve öğrenci yalnız saati görür, tutar alanı yanıtta hiç yoktur.
 */
export async function studentPackageBalanceFor(
  ctx: ServiceContext,
  studentId: string,
): Promise<PackageBalanceView> {
  const scope = await readScope(ctx)
  assertReadable(ctx, scope, 'invoices')
  const staff = isStaff(ctx)
  if (staff) {
    const [student] = await loadRecordsByIds(ctx.db, ctx.institutionId, 'students', [studentId])
    if (student === undefined) throw new NotFoundError()
  } else if (!financeStudentIds(scope).has(studentId)) throw new NotFoundError()
  const sales = await loadPackageReportSales(ctx.db, ctx.institutionId, { studentId })
  const balance = studentPackageBalance(studentId, sales, dayKey(ctx.now))
  return staff ? balance : withoutAmounts(balance)
}

/** Aile yanıtı: tutar alanı silinir, yalnız şemadan düşmesine güvenilmez. */
function withoutAmounts(balance: PackageBalance): PackageBalanceView {
  const view: PackageBalanceView = {
    ...balance,
    sales: balance.sales.map((sale) => {
      const row: PackageBalanceView['sales'][number] = { ...sale }
      delete row.amounts
      return row
    }),
  }
  delete view.amounts
  return view
}

async function studentNames(ctx: ServiceContext, ids: readonly string[]) {
  const rows = await loadRecordsByIds(ctx.db, ctx.institutionId, 'students', [...new Set(ids)])
  return new Map(
    rows.map((row) => [row.id, typeof row.data.name === 'string' ? row.data.name : null]),
  )
}

async function withNames(ctx: ServiceContext, lines: readonly PackageReportLine[]) {
  const names = await studentNames(
    ctx,
    lines.map((line) => line.studentId),
  )
  return lines.map((line) => ({ ...line, studentName: names.get(line.studentId) ?? null }))
}

async function reportOf(ctx: ServiceContext, period: FinancePeriod): Promise<PackageReport> {
  // Dönem yüklemeden önce denetlenir; core hatası 422'ye çevrilir.
  try {
    assertFinancePeriod(period)
  } catch (error) {
    throw mapOperationError(error)
  }
  const sales = await loadPackageReportSales(ctx.db, ctx.institutionId)
  return packageHourReport(sales, period, dayKey(ctx.now))
}

/** Dönem raporu: toplam ve ay dökümü bütün satırlardan, satırlar sayfalı. */
export async function packageReportFor(
  ctx: ServiceContext,
  query: FinancePeriod & { page: number; pageSize: number },
) {
  const report = await reportOf(ctx, query)
  const start = (query.page - 1) * query.pageSize
  return {
    data: {
      from: report.from,
      to: report.to,
      totals: report.totals,
      months: report.months,
      lines: await withNames(ctx, report.lines.slice(start, start + query.pageSize)),
    },
    meta: { page: query.page, pageSize: query.pageSize, total: report.lines.length },
  }
}

/**
 * Raporun bütün satırları CSV olarak; sayfa yok sayılır. Öğrenci adı taşıdığı için denetime yazılır
 * (`finance.package_report_export`, kimlik dönem); dosya üretilemezse kayıt düşmez.
 */
export async function packageReportCsvFor(
  ctx: ServiceContext,
  period: FinancePeriod,
): Promise<string> {
  const report = await reportOf(ctx, period)
  const csv = packageReportCsv(await withNames(ctx, report.lines))
  await ctx.db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: 'finance.package_report_export',
    entityType: 'finance_export',
    entityId: `package-report:${period.from}:${period.to}`,
    changes: { fields: [] },
    createdAt: ctx.now,
  })
  return csv
}
