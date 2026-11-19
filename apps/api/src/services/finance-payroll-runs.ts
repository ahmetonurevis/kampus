import { randomUUID } from 'node:crypto'

import {
  payrollCalcTotals,
  payrollCalculation,
  payrollCalculationCsv,
  payrollCalculationFilename,
  payrollMonthParameters,
  payrollRunSaveSchema,
  payrollTaxCarryoverInputSchema,
  planPayrollRunSave,
  planPayrollTaxCarryover,
  type PayrollCalculation,
  type PayrollCalcRow,
  type PayrollCalcTotals,
} from '@kampus/school-core/lib/finance-payroll-calc.ts'
import { assertPayrollDaysUnlocked } from '@kampus/school-core/lib/finance-payroll-periods.ts'
import { sgkMonthRange } from '@kampus/school-core/lib/finance-sgk-preparation.ts'
import type { MonthlyDeductionSources } from '@kampus/school-core/lib/finance-staff-deductions.ts'

import type { Database } from '../db/client.ts'
import { approvedLessonHoursFor } from '../db/finance-lesson-hour-approvals.ts'
import { findStaffMember, loadStaffPayRates } from '../db/finance-pay-rates.ts'
import { listPayrollParameterSets } from '../db/finance-payroll-parameters.ts'
import {
  archivePayrollRun,
  archiveTaxCarryover,
  findActivePayrollRun,
  findTaxCarryover,
  insertPayrollRun,
  insertTaxCarryover,
  lastPayrollRevision,
  listTaxCarryovers,
  loadPayrollAdjustmentsInto,
  loadPayrollCalcMembers,
  loadPayrollEmploymentDates,
  loadPayrollMissingDays,
  loadPayrollRunLines,
  loadSavedIncomeTaxBases,
  loadYearCarryovers,
  taxCarryoverExists,
  type StoredPayrollRun,
} from '../db/finance-payroll-runs.ts'
import { listAdvances, listGarnishments, listPensions } from '../db/finance-staff-deductions.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { medicalReportDaysFor } from './finance-medical-reports.ts'
import { lockedPayrollMonths } from './finance-payroll-periods.ts'
import {
  mapOperationError,
  runCommand,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Bordro ön hesabı (DOM-FIN-115; ON-198). Kural core `lib/finance-payroll-calc.ts`'tedir; servis
 * ayın girdilerini (ücret tanımları, parametre setleri, elle SGK satırları, ek ders saatleri —
 * yalnız müdür onaylı çizelgeden, `approvedLessonHoursFor`, K-423 —, aya aktarılan düzeltmeler, kesinti kayıtları, sağlık raporu günleri, yılın kayıtlı hesapları ve
 * devirleri) tek transaction'da okur. Ücret ve icra kişisel veridir (K-306, K-315): önizleme, kayıtlı
 * hesap ve CSV her okumada aynı transaction'da denetime düşer; denetime alan adları yazılır, tutar
 * yazılmaz. Kaydetme kurum kilidi altındadır; onaylı (kilitli) ay 409 `payroll_period_locked`
 * (K-391). Rol ve modül denetimi rotadadır (yalnız yönetici).
 */

const RUN_ENTITY = 'payroll_runs'
const CARRYOVER_ENTITY = 'payroll_tax_carryovers'
/** Okumada denetime yazılan alan adları (değer yazılmaz). */
const READ_FIELDS = [
  'grossCents',
  'netCents',
  'incomeTaxCents',
  'deductions',
  'payableCents',
  'employerCostCents',
]

export type PayrollCalcPurpose = 'view' | 'csv'

/** Ayın hesabı (kaydedilmez): bütün girdiler aynı transaction'da okunur. */
async function calculate(tx: Database, ctx: ServiceContext, month: string) {
  const range = sgkMonthRange(month)
  let parameters: ReturnType<typeof payrollMonthParameters>
  try {
    parameters = payrollMonthParameters(
      month,
      await listPayrollParameterSets(tx, ctx.institutionId),
    )
  } catch (error) {
    throw mapOperationError(error)
  }
  const members = await loadPayrollCalcMembers(tx, ctx.institutionId, range)
  // Ek ders yalnız müdür onaylı çizelgeden (K-423); onay bekleyen saat yalnız uyarıdır.
  const lessons = await approvedLessonHoursFor(tx, ctx.institutionId, month)
  const lessonInput = (entry: (typeof lessons.entries)[number]) => ({
    membershipId: entry.membershipId,
    lessonType: entry.lessonType,
    hours: entry.hours,
  })
  const ids = members.map((member) => member.membershipId)
  const deductionSources = new Map<string, MonthlyDeductionSources>()
  for (const id of ids) {
    const [advances, garnishments, pensions] = await Promise.all([
      listAdvances(tx, ctx.institutionId, id),
      listGarnishments(tx, ctx.institutionId, id),
      listPensions(tx, ctx.institutionId, id),
    ])
    deductionSources.set(id, { advances, garnishments, pensions })
  }
  const medical =
    ids.length === 0
      ? []
      : await medicalReportDaysFor(
          { db: tx, institutionId: ctx.institutionId },
          { membershipIds: ids, from: range.firstDay, to: range.lastDay },
        )
  return payrollCalculation({
    month,
    parameters,
    members,
    rates: await loadStaffPayRates(tx, ctx.institutionId, ids),
    missing: await loadPayrollMissingDays(tx, ctx.institutionId, range.firstDay),
    dates: await loadPayrollEmploymentDates(tx, ctx.institutionId, range.firstDay),
    lessonHours: lessons.entries.map(lessonInput),
    lessonSheet: { status: lessons.status, pending: lessons.pending.map(lessonInput) },
    adjustments: await loadPayrollAdjustmentsInto(tx, ctx.institutionId, month),
    savedBases: await loadSavedIncomeTaxBases(tx, ctx.institutionId, month),
    carryovers: await loadYearCarryovers(tx, ctx.institutionId, Number(month.slice(0, 4))),
    medicalReportDays: new Map(medical.map((item) => [item.membershipId, item.totalDays])),
    deductionSources,
  })
}

async function auditRead(
  tx: Database,
  ctx: ServiceContext,
  action: string,
  entityId: string,
  rows: readonly PayrollCalcRow[],
) {
  const values = (actionName: string, fields: string[]) => ({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: actionName,
    entityType: RUN_ENTITY,
    entityId,
    changes: { fields },
    createdAt: ctx.now,
  })
  await tx.insert(auditLog).values(values(action, READ_FIELDS))
  // Sağlık raporu günü özel nitelikli verinin özetidir (DOM-FIN-110): ayrıca denetlenir.
  if (rows.some((row) => row.medicalReportDays > 0))
    await tx.insert(auditLog).values(values('finance.medical_report.read', ['medicalReportDays']))
}

export interface SavedRunSummary {
  id: string
  revision: number
  version: number
  calculatedAt: string
  calculatedByName: string | null
  staffCount: number
  skippedCount: number
  payableTotalCents: number
}

const summaryOf = (run: StoredPayrollRun): SavedRunSummary => ({
  id: run.id,
  revision: run.revision,
  version: run.version,
  calculatedAt: run.calculatedAt,
  calculatedByName: run.calculatedByName,
  staffCount: run.staffCount,
  skippedCount: run.skippedCount,
  payableTotalCents: run.payableTotalCents,
})

export interface PayrollCalculationView extends PayrollCalculation {
  locked: boolean
  saved: SavedRunSummary | null
}

/**
 * Önizleme (DOM-FIN-115): ayın canlı hesabı, ayın kilit durumu ve etkin kayıtlı hesabın özeti.
 * Ekran `finance.payroll_calculation.read`, CSV `finance.payroll_calculation_export` denetimi yazar.
 */
export function payrollCalculationFor(
  ctx: ServiceContext,
  month: string,
  purpose: PayrollCalcPurpose,
): Promise<PayrollCalculationView> {
  return ctx.db.transaction(async (tx) => {
    const result = await calculate(tx, ctx, month)
    const saved = await findActivePayrollRun(tx, ctx.institutionId, month)
    const locked = (await lockedPayrollMonths(tx, ctx.institutionId)).includes(month)
    await auditRead(
      tx,
      ctx,
      purpose === 'view'
        ? 'finance.payroll_calculation.read'
        : 'finance.payroll_calculation_export',
      `payroll-calculation:${month}${purpose === 'view' ? '' : ':csv'}`,
      result.rows,
    )
    return { ...result, locked, saved: saved === null ? null : summaryOf(saved) }
  })
}

export async function payrollCalculationCsvFor(ctx: ServiceContext, month: string) {
  const result = await payrollCalculationFor(ctx, month, 'csv')
  return { csv: payrollCalculationCsv(result), filename: payrollCalculationFilename(month, false) }
}

export interface PayrollRunView extends SavedRunSummary {
  month: string
  locked: boolean
  parameterSetId: string
  parameterEffectiveFrom: string
  rows: PayrollCalcRow[]
  totals: PayrollCalcTotals
}

/** Ayın kayıtlı (etkin) hesabı; yoksa 404. Her okuma denetime düşer. */
export function payrollRunFor(
  ctx: ServiceContext,
  month: string,
  purpose: PayrollCalcPurpose,
): Promise<PayrollRunView> {
  return ctx.db.transaction(async (tx) => {
    const run = await findActivePayrollRun(tx, ctx.institutionId, month)
    if (run === null) throw new NotFoundError()
    const rows = await loadPayrollRunLines(tx, ctx.institutionId, run.id)
    await auditRead(
      tx,
      ctx,
      purpose === 'view' ? 'finance.payroll_run.read' : 'finance.payroll_run_export',
      run.id,
      rows,
    )
    return {
      ...summaryOf(run),
      month,
      locked: (await lockedPayrollMonths(tx, ctx.institutionId)).includes(month),
      parameterSetId: run.parameterSetId,
      parameterEffectiveFrom: run.parameterEffectiveFrom,
      rows,
      totals: payrollCalcTotals(rows),
    }
  })
}

export async function payrollRunCsvFor(ctx: ServiceContext, month: string) {
  const run = await payrollRunFor(ctx, month, 'csv')
  return { csv: payrollCalculationCsv(run), filename: payrollCalculationFilename(month, true) }
}

/**
 * Hesabı kaydet ya da yeniden hesapla (K-391): kurum kilidi altında ay yeniden hesaplanır; onaylı ay
 * 409 `payroll_period_locked`, ekranda görülen kayıt güncel değilse 409 `payroll_run_changed`,
 * hesaplanabilen satır yoksa 422 `payroll_run_empty`. Eski hesap arşivlenir, yeni revizyon yazılır;
 * eksik satırlar kayda girmez. İlk kayıt 201, yeniden hesaplama 200.
 */
export function savePayrollRunCommand(
  ctx: ServiceContext,
  month: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: RUN_ENTITY, id }
  let replaced = false
  return runCommand(
    ctx,
    {
      action: 'finance.payroll_run.save',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = payrollRunSaveSchema.parse(input)
        const locked = await lockedPayrollMonths(tx, ctx.institutionId)
        const current = await findActivePayrollRun(tx, ctx.institutionId, month)
        const result = await calculate(tx, ctx, month)
        const revision = await lastPayrollRevision(tx, ctx.institutionId, month)
        return {
          run: () => {
            const range = sgkMonthRange(month)
            assertPayrollDaysUnlocked(
              locked,
              [{ from: range.firstDay, to: range.lastDay }],
              'month',
            )
            const complete = result.rows.filter((row) => row.complete)
            planPayrollRunSave(parsed, current, complete.length)
            return { current, result, complete, revision }
          },
        }
      },
      after: async (tx, { current, result, complete, revision }) => {
        if (current !== null) {
          replaced = true
          const archived = await archivePayrollRun(tx, ctx.institutionId, {
            id: current.id,
            expectedVersion: current.version,
            userId: ctx.actor.userId,
            now: ctx.now,
          })
          if (!archived) throw new ConflictError()
          await auditWork(
            tx,
            ctx,
            'finance.payroll_run.archive',
            {
              type: RUN_ENTITY,
              id: current.id,
            },
            ['archivedAt'],
          )
        }
        await insertPayrollRun(tx, ctx.institutionId, {
          id,
          month,
          revision: revision + 1,
          parameterSetId: result.parameters.setId,
          parameterEffectiveFrom: result.parameters.effectiveFrom,
          skippedCount: result.rows.length - complete.length,
          lines: complete.map((line) => ({ id: randomUUID(), line })),
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.payroll_run.save', entity, [
          'month',
          'revision',
          'lines',
          ...(current === null ? [] : ['replacesRunId']),
        ])
      },
    },
    () => ({ statusCode: replaced ? 200 : 201, body: { data: { id, month } } }),
    idempotency,
  )
}

// --- Matrah devri ---------------------------------------------------------------------------------

/** Yılın devirleri; her okuma denetime düşer (ücret verisi). */
export function listTaxCarryoversFor(ctx: ServiceContext, year: number) {
  return ctx.db.transaction(async (tx) => {
    const items = await listTaxCarryovers(tx, ctx.institutionId, year)
    await tx.insert(auditLog).values({
      institutionId: ctx.institutionId,
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action: 'finance.payroll_tax_carryover.read',
      entityType: CARRYOVER_ENTITY,
      entityId: `year:${String(year)}`,
      changes: { fields: ['incomeTaxBaseCents'] },
      createdAt: ctx.now,
    })
    return items
  })
}

/** Devir (K-388): personel × yıl başına tek etkin kayıt (409). 201. */
export function createTaxCarryoverCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: CARRYOVER_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.payroll_tax_carryover.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = payrollTaxCarryoverInputSchema.parse(input)
        const staff = await findStaffMember(tx, ctx.institutionId, parsed.membershipId)
        const exists = await taxCarryoverExists(
          tx,
          ctx.institutionId,
          parsed.membershipId,
          parsed.year,
        )
        return {
          run: () => {
            planPayrollTaxCarryover({ staff, exists })
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        await insertTaxCarryover(tx, ctx.institutionId, {
          id,
          ...parsed,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(
          tx,
          ctx,
          'finance.payroll_tax_carryover.create',
          entity,
          Object.keys(parsed).filter((key) => parsed[key as keyof typeof parsed] !== null),
        )
        const saved = await findTaxCarryover(tx, ctx.institutionId, id)
        if (saved === null) throw new NotFoundError()
        body = { data: saved }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Devri kaldır (arşiv); olmayan ya da kaldırılmış 404, sürüm tutmazsa 409. */
export function archiveTaxCarryoverCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: CARRYOVER_ENTITY, id }
  return runCommand(
    ctx,
    {
      action: 'finance.payroll_tax_carryover.archive',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await findTaxCarryover(tx, ctx.institutionId, id)
        if (current === null) throw new NotFoundError()
        if (current.version !== expectedVersion) throw new ConflictError()
        return { run: () => null }
      },
      after: async (tx) => {
        const saved = await archiveTaxCarryover(tx, ctx.institutionId, {
          id,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.payroll_tax_carryover.archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id, archivedAt: ctx.now.toISOString() } } }),
    idempotency,
  )
}
