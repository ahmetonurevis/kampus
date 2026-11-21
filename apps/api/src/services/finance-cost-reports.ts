import {
  campusConsolidation,
  type CampusConsolidation,
} from '@kampus/school-core/lib/finance-campus-consolidation.ts'
import {
  costPerStudent,
  periodStudents,
  type CostPerStudentReport,
  type CostReportQuery,
} from '@kampus/school-core/lib/finance-cost-per-student.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import {
  loadBudgetPeriods,
  loadCostCenters,
  type StoredBudgetPeriod,
} from '../db/finance-budget.ts'
import {
  loadCourseMemberships,
  loadPeriodExpenseLines,
  loadWithdrawalDays,
} from '../db/finance-cost-reports.ts'
import { allocatedTotals, paymentsTouchingPeriod } from '../db/payments.ts'
import { refundsPaidInPeriod } from '../db/withdrawals.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { FINANCE_TABLE_STORES, runReadOnly } from './operation-runner.ts'

/**
 * Öğrenci başı maliyet (ON-249) ve çok kampüslü konsolide rapor (ON-250); DOM-FIN-065. Hesap core
 * `lib/finance-cost-per-student.ts` ve `lib/finance-campus-consolidation.ts`'tedir; bütün satırlar
 * tek salt okur görüntüden okunur, hiçbir şey yazılmaz. Kurum oturumdan gelir; dönem kurumun bütçe
 * dönemidir (başka kurumun dönemi 404). Yanıt kişi verisi taşımaz, tutar loglanmaz. Rol ve modül
 * denetimi rotadadır (yalnız yönetici, modül `finance`).
 */

const DAY = 86_400_000
/** İstanbul gününün iki yanını da kapsar; kesin gün süzmesi core'dadır (muhasebe aktarımıyla aynı). */
const instant = (day: string, offsetDays: number) =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + offsetDays * DAY)

interface PeriodView {
  id: string
  name: string
  status: StoredBudgetPeriod['status']
  startDate: string
  endDate: string
}

async function periodOf(tx: Database, ctx: ServiceContext, periodId: string): Promise<PeriodView> {
  const period = (await loadBudgetPeriods(tx, ctx.institutionId)).find(
    (item) => item.id === periodId,
  )
  if (period === undefined) throw new NotFoundError()
  return {
    id: period.id,
    name: period.name,
    status: period.status,
    startDate: period.startDate,
    endDate: period.endDate,
  }
}

/** Mezuniyet geçişi uygulanmış öğrencinin çıkış günü (`DOM-KAY-022`). */
function graduationDays(renewals: readonly Record<string, unknown>[]): Map<string, string> {
  const days = new Map<string, string>()
  for (const renewal of renewals) {
    if (renewal.mode !== 'graduate' || renewal.status !== 'Mezun') continue
    const at = renewal.activatedAt
    if (typeof renewal.studentId !== 'string' || typeof at !== 'string') continue
    if (!Number.isFinite(Date.parse(at))) continue
    const day = dayKey(at)
    const known = days.get(renewal.studentId)
    if (known === undefined || day > known) days.set(renewal.studentId, day)
  }
  return days
}

/** Ayrılış ve mezuniyet günlerinden geç olanı. */
function exitDays(withdrawals: Map<string, string>, graduations: Map<string, string>) {
  const exits = new Map(withdrawals)
  for (const [studentId, day] of graduations) {
    const known = exits.get(studentId)
    if (known === undefined || day > known) exits.set(studentId, day)
  }
  return exits
}

const COST_COLLECTIONS = ['students', 'classes', 'renewals'] as const

/** Dönemin öğrencileri, merkezleri ve gider satırlarını aynı görüntüden yükler. */
async function loadCostInputs(tx: Database, ctx: ServiceContext, periodId: string) {
  const period = await periodOf(tx, ctx, periodId)
  const range = { startDate: period.startDate, endDate: period.endDate }
  const [centers, lines, withdrawals, memberships] = [
    await loadCostCenters(tx, ctx.institutionId),
    await loadPeriodExpenseLines(tx, ctx.institutionId, periodId),
    await loadWithdrawalDays(tx, ctx.institutionId),
    await loadCourseMemberships(tx, ctx.institutionId, range),
  ]
  return { period, range, centers, lines, withdrawals, memberships }
}

type CostInputs = Awaited<ReturnType<typeof loadCostInputs>>
type CostState = {
  students: readonly Record<string, unknown>[]
  classes: readonly Record<string, unknown>[]
  renewals: readonly Record<string, unknown>[]
}

const text = (value: unknown) => (typeof value === 'string' ? value : null)

function costReport(inputs: CostInputs, state: CostState, key: CostReportQuery['key']) {
  const students = periodStudents({
    period: inputs.range,
    students: state.students.flatMap((item) =>
      typeof item.id === 'string'
        ? [
            {
              id: item.id,
              classId: text(item.classId),
              isActive: item.isActive !== false,
              joinedAt: text(item.joinedAt),
            },
          ]
        : [],
    ),
    classes: state.classes.flatMap((item) =>
      typeof item.id === 'string'
        ? [
            {
              id: item.id,
              branchId: text(item.branchId),
              grade: typeof item.grade === 'number' ? item.grade : null,
            },
          ]
        : [],
    ),
    exits: exitDays(inputs.withdrawals, graduationDays(state.renewals)),
    memberships: inputs.memberships,
  })
  const report = costPerStudent({ key, centers: inputs.centers, lines: inputs.lines, students })
  return { students, report }
}

export interface CostPerStudentResponse extends CostPerStudentReport {
  period: PeriodView
}

/** Seçilen bütçe döneminin öğrenci başı maliyeti (DOM-FIN-065, ON-249). */
export function costPerStudentFor(
  ctx: ServiceContext,
  query: CostReportQuery,
): Promise<CostPerStudentResponse> {
  return runReadOnly(ctx, {
    action: 'finance.cost_per_student',
    collections: [...COST_COLLECTIONS],
    load: async (tx) => {
      const inputs = await loadCostInputs(tx, ctx, query.periodId)
      return {
        run: (state): CostPerStudentResponse => {
          const { report } = costReport(inputs, state, query.key)
          return { period: inputs.period, ...report }
        },
      }
    },
  })
}

export interface CampusConsolidationResponse extends CampusConsolidation {
  period: PeriodView
  key: CostReportQuery['key']
}

/**
 * Kampüsler bazında gelir, öğrenci ve bütçe gideri (DOM-FIN-065, ON-250). Gelir dönemi bütçe
 * döneminin günleridir; hareketler muhasebe aktarımıyla aynı kaynaklardan okunur.
 */
export function campusConsolidationFor(
  ctx: ServiceContext,
  query: CostReportQuery,
): Promise<CampusConsolidationResponse> {
  return runReadOnly(ctx, {
    action: 'finance.campus_consolidation',
    collections: [...COST_COLLECTIONS, 'branches', 'invoices'],
    stores: FINANCE_TABLE_STORES,
    load: async (tx) => {
      const inputs = await loadCostInputs(tx, ctx, query.periodId)
      const period = { from: inputs.range.startDate, to: inputs.range.endDate }
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
        run: (state): CampusConsolidationResponse => {
          const { students, report } = costReport(inputs, state, query.key)
          const classCampus = new Map(
            state.classes.map((item) => [item.id, text(item.branchId) || null]),
          )
          const studentCampus = new Map(
            state.students.map((item) => [
              item.id,
              (item.classId ? classCampus.get(item.classId) : null) ?? null,
            ]),
          )
          const consolidation = campusConsolidation({
            period,
            campuses: state.branches.map((item) => ({
              id: item.id,
              name: text(item.name) ?? item.id,
              isActive: item.isActive !== false,
            })),
            studentCampus,
            students,
            payments,
            refunds,
            invoices: state.invoices,
            allocated,
            costs: report,
          })
          return { period: inputs.period, key: query.key, ...consolidation }
        },
      }
    },
  })
}
