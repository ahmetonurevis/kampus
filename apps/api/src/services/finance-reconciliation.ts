import { defaultAcademicYearDates } from '@kampus/school-core/lib/academic-years.ts'
import { studentDirectory } from '@kampus/school-core/lib/finance-export.ts'
import { profiledReconciliationCsv } from '@kampus/school-core/lib/finance-export-profile.ts'
import {
  financeReconciliation,
  reconciliationPeriod,
  type FinanceReconciliation,
  type FinanceReconciliationStatus,
} from '@kampus/school-core/lib/finance-reconciliation.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import { loadAcademicYears } from '../db/academic-years.ts'
import { loadFinanceExportProfile } from '../db/finance-export-profiles.ts'
import { paymentsForReconciliation } from '../db/payments.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { withdrawalsForReconciliation } from '../db/withdrawals.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { FINANCE_TABLE_STORES, runReadOnly } from './operation-runner.ts'

/**
 * Yıl sonu mutabakatı (ON-085, IST-111; DOM-FIN-056). Hesap core'dadır. Bütün satırlar tek görüntüden
 * okunur. Yalnız raporlamadır: yıl kapatılmaz, kayıt değişmez. Satır ve tutar loglanmaz; dosya
 * aktarımı denetime yıl ve dönemle düşer (DOM-YTK-053).
 */

const DAY = 86_400_000

function reconciliationOf(ctx: ServiceContext, year: number): Promise<FinanceReconciliation> {
  const today = dayKey(ctx.now)
  return runReadOnly(ctx, {
    action: 'finance.reconciliation',
    collections: ['students', 'invoices', 'contracts', 'renewals'],
    stores: FINANCE_TABLE_STORES,
    load: async (tx) => {
      const stored = await loadAcademicYears(tx, ctx.institutionId)
      const range = stored.find((item) => item.startYear === year) ?? null
      const { endDate } = range ?? defaultAcademicYearDates(year)
      // İstanbul gününün ötesini de kapsar; kesin gün süzmesi core `dayKey` ile yapılır.
      const until = new Date(
        Date.parse(`${endDate < today ? endDate : today}T00:00:00.000Z`) + 2 * DAY,
      )
      const [payments, withdrawals] = [
        await paymentsForReconciliation(tx, ctx.institutionId, until),
        await withdrawalsForReconciliation(tx, ctx.institutionId),
      ]
      return {
        run: (state) =>
          financeReconciliation({
            year,
            // İşlem içinde denetlenir: DomainError yalnız burada 422'ye çevrilir.
            period: reconciliationPeriod(year, range, today),
            invoices: state.invoices,
            contracts: state.contracts,
            cancelledContractIds: new Set(
              state.renewals
                .filter((item) => item.status === 'İptal')
                .flatMap((item) => (item.contractId ? [item.contractId] : [])),
            ),
            payments,
            withdrawals,
            students: studentDirectory(state.students),
          }),
      }
    },
  })
}

export async function financeReconciliationFor(
  ctx: ServiceContext,
  query: {
    year: number
    status: FinanceReconciliationStatus
    page: number
    pageSize: number
  },
) {
  const { rows, ...summary } = await reconciliationOf(ctx, query.year)
  const listed =
    query.status === 'mismatch' ? rows.filter((row) => row.differenceCents !== 0) : rows
  const start = (query.page - 1) * query.pageSize
  return {
    data: { ...summary, rows: listed.slice(start, start + query.pageSize) },
    meta: { page: query.page, pageSize: query.pageSize, total: listed.length },
  }
}

export async function financeReconciliationExportFor(
  ctx: ServiceContext,
  year: number,
): Promise<{ csv: string; from: string; to: string }> {
  const { rows, from, to } = await reconciliationOf(ctx, year)
  const { profile } = await loadFinanceExportProfile(ctx.db, ctx.institutionId)
  const csv = profiledReconciliationCsv(rows, profile)
  await ctx.db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: 'finance.export',
    entityType: 'finance_export',
    entityId: `reconciliation:${String(year)}:${from}:${to}`,
    changes: { fields: [] },
    createdAt: ctx.now,
  })
  return { csv, from, to }
}
