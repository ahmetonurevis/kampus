import { createHash, randomUUID } from 'node:crypto'

import {
  assertPayrollDaysUnlocked,
  monthEnd,
  monthOfDay,
  monthStart,
  payrollAdjustmentCancelSchema,
  payrollAdjustmentInputSchema,
  payrollApproveSchema,
  payrollInputSummary,
  payrollPeriodState,
  payrollReopenSchema,
  payrollYearMonths,
  planPayrollAdjustment,
  planPayrollAdjustmentCancel,
  planPayrollApproval,
  planPayrollReopen,
  type DayRange,
  type PayrollInputSummary,
} from '@kampus/school-core/lib/finance-payroll-periods.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import { findStaffMember } from '../db/finance-pay-rates.ts'
import { listPayrollParameterSets } from '../db/finance-payroll-parameters.ts'
import {
  cancelPayrollAdjustment,
  countAdjustmentsBySource,
  countPeriodAdjustments,
  findPayrollAdjustment,
  findPayrollPeriod,
  insertPayrollAdjustment,
  insertPayrollPeriod,
  listPayrollPeriods,
  listPeriodAdjustments,
  loadAdjustmentsTargeting,
  loadRatesBetween,
  lockedPayrollMonths,
  reapprovePayrollPeriod,
  reopenPayrollPeriod,
  userNames,
  type StoredPayrollAdjustment,
  type StoredPayrollPeriod,
} from '../db/finance-payroll-periods.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Bordro onayı ve dönem kilidi (DOM-FIN-108; ON-200). Kural core `lib/finance-payroll-periods.ts`'
 * tedir; servis kurum kilidi altında girdileri yükler, özeti damgalar ve tek transaction'da yazar.
 * Kilit denetimi geneldir: bordroya girdi yazan her servis `assertPayrollRangesUnlocked`'u kendi
 * etki aralığıyla çağırır: ücret tanımı, bordro parametresi ve avans/icra/BES (ON-343). Bordro
 * aktarımı (ON-202) kilitlenmez; aya aktarılan düzeltmeleri hedef ayın satırı olarak okur.
 * Denetim kaydına alan adları yazılır; tutar ve gerekçe yazılmaz. Rol ve modül denetimi
 * rotadadır (yalnız yönetici).
 */

const PERIOD = 'payroll_periods'
const ADJUSTMENT = 'payroll_adjustments'

/**
 * Genel kilit denetimi (K-357): kurum kilidi altında onaylı ayları okur, aralıklardan biri kilitli
 * aya değiyorsa 409 `payroll_period_locked` fırlatır (core `DomainError`; `run` ya da `after`
 * içinde çağrılır). Yükleme ile denetim ayrıdır: `lockedPayrollMonths` `load`'da, core denetimi
 * `run`'da.
 */
export async function assertPayrollRangesUnlocked(
  tx: Database,
  institutionId: string,
  ranges: readonly (DayRange | null)[],
  path?: string,
): Promise<void> {
  assertPayrollDaysUnlocked(await lockedPayrollMonths(tx, institutionId), ranges, path)
}
export { lockedPayrollMonths }

const digest = (source: string) => createHash('sha256').update(source).digest('hex')

/** Ayın güncel girdi özeti ve damgası (kurum kilidi altında ya da okumada). */
async function currentSummary(db: Database, institutionId: string, month: string) {
  const [rates, adjustments, sets] = await Promise.all([
    loadRatesBetween(db, institutionId, monthStart(month), monthEnd(month)),
    loadAdjustmentsTargeting(db, institutionId, month, month),
    listPayrollParameterSets(db, institutionId),
  ])
  const { summary, digestSource } = payrollInputSummary(month, rates, adjustments, sets)
  return { ...summary, inputsHash: digest(digestSource) }
}

const summaryOf = (period: StoredPayrollPeriod): PayrollInputSummary & { inputsHash: string } => ({
  staffCount: period.staffCount,
  rateCount: period.rateCount,
  monthlyGrossTotalCents: period.monthlyGrossTotalCents,
  adjustmentCount: period.adjustmentCount,
  adjustmentTotalCents: period.adjustmentTotalCents,
  parameterSetId: period.parameterSetId,
  parameterEffectiveFrom: period.parameterEffectiveFrom,
  inputsHash: period.inputsHash,
})

function periodView(
  month: string,
  stored: StoredPayrollPeriod | null,
  names: Map<string, string>,
  extra: {
    current: (PayrollInputSummary & { inputsHash: string }) | null
    adjustmentCount: number
  },
) {
  return {
    month,
    state: payrollPeriodState(stored),
    version: stored?.version ?? null,
    approvedAt: stored?.approvedAt ?? null,
    approvedByName: stored === null ? null : (names.get(stored.approvedByUserId) ?? null),
    approvalCount: stored?.approvalCount ?? 0,
    approved: stored === null ? null : summaryOf(stored),
    current: extra.current,
    reopenedAt: stored?.reopenedAt ?? null,
    reopenedByName:
      stored?.reopenedByUserId == null ? null : (names.get(stored.reopenedByUserId) ?? null),
    reopenReason: stored?.reopenReason ?? null,
    adjustmentCount: extra.adjustmentCount,
  }
}

/**
 * Yılın 12 ayı (K-356): durum, onay özeti ve onaylanmamış başlamış ayların güncel özeti (onayda
 * gönderilecek damga). Kilitli aylar bütün yıllar için ayrıca döner (ücret tanımı formu uyarısı).
 */
export async function payrollPeriodYearFor(ctx: ServiceContext, year: number) {
  const thisMonth = monthOfDay(dayKey(ctx.now))
  const months = payrollYearMonths(year)
  const first = months[0] ?? `${String(year)}-01`
  const last = months.at(-1) ?? `${String(year)}-12`
  const [stored, locked, adjustmentCounts, rates, adjustments, sets] = await Promise.all([
    listPayrollPeriods(ctx.db, ctx.institutionId, year),
    lockedPayrollMonths(ctx.db, ctx.institutionId),
    countAdjustmentsBySource(ctx.db, ctx.institutionId, year),
    loadRatesBetween(ctx.db, ctx.institutionId, monthStart(first), monthEnd(last)),
    loadAdjustmentsTargeting(ctx.db, ctx.institutionId, first, last),
    listPayrollParameterSets(ctx.db, ctx.institutionId),
  ])
  const byMonth = new Map(stored.map((period) => [period.month, period]))
  const names = await userNames(
    ctx.db,
    stored.flatMap((period) => [
      period.approvedByUserId,
      ...(period.reopenedByUserId === null ? [] : [period.reopenedByUserId]),
    ]),
  )
  return {
    year,
    currentMonth: thisMonth,
    lockedMonths: locked,
    months: months.map((month) => {
      const period = byMonth.get(month) ?? null
      let current: (PayrollInputSummary & { inputsHash: string }) | null = null
      if (period?.status !== 'approved' && month <= thisMonth) {
        const { summary, digestSource } = payrollInputSummary(
          month,
          rates,
          adjustments.filter((item) => item.targetMonth === month),
          sets,
        )
        current = { ...summary, inputsHash: digest(digestSource) }
      }
      return periodView(month, period, names, {
        current,
        adjustmentCount: adjustmentCounts.get(month) ?? 0,
      })
    }),
  }
}

async function periodBody(tx: Database, ctx: ServiceContext, month: string) {
  const period = await findPayrollPeriod(tx, ctx.institutionId, month)
  if (period === null) throw new NotFoundError()
  const names = await userNames(tx, [
    period.approvedByUserId,
    ...(period.reopenedByUserId === null ? [] : [period.reopenedByUserId]),
  ])
  const adjustmentCount = await countPeriodAdjustments(tx, ctx.institutionId, period.id)
  return { data: periodView(month, period, names, { current: null, adjustmentCount }) }
}

/**
 * Onay (K-356): güncel özet kurum kilidi altında yeniden hesaplanır; istemcinin gördüğü damga
 * tutmazsa 409 `payroll_inputs_changed`. İlk onay kayıt açar (201), yeniden açılmış ay güncellenir
 * (200).
 */
export function approvePayrollPeriodCommand(
  ctx: ServiceContext,
  month: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let id: string = randomUUID()
  let statusCode = 201
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.payroll_period.approve',
      collections: [],
      entity: () => ({ type: PERIOD, id }),
      load: async (tx) => {
        const parsed = payrollApproveSchema.parse(input)
        const stored = await findPayrollPeriod(tx, ctx.institutionId, month)
        const current = await currentSummary(tx, ctx.institutionId, month)
        return {
          run: () => {
            planPayrollApproval(month, dayKey(ctx.now), stored, {
              expected: parsed.inputsHash,
              current: current.inputsHash,
            })
            return { stored, current }
          },
        }
      },
      after: async (tx, { stored, current }) => {
        const write = { ...current, userId: ctx.actor.userId, now: ctx.now }
        if (stored === null)
          await insertPayrollPeriod(tx, ctx.institutionId, { ...write, id, month })
        else {
          id = stored.id
          statusCode = 200
          const saved = await reapprovePayrollPeriod(tx, ctx.institutionId, {
            ...write,
            id,
            expectedVersion: stored.version,
          })
          if (!saved) throw new ConflictError()
        }
        await auditWork(tx, ctx, 'finance.payroll_period.approve', { type: PERIOD, id }, [
          'status',
          'approvedAt',
          'inputsHash',
        ])
        body = await periodBody(tx, ctx, month)
      },
    },
    () => ({ statusCode, body }),
    idempotency,
  )
}

/** Yeniden açma (K-356): gerekçeli, `If-Match` dönem sürümüdür; aydan çıkan düzeltme varsa 422. */
export function reopenPayrollPeriodCommand(
  ctx: ServiceContext,
  month: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let id = month
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.payroll_period.reopen',
      collections: [],
      entity: () => ({ type: PERIOD, id }),
      load: async (tx) => {
        const parsed = payrollReopenSchema.parse(input)
        const stored = await findPayrollPeriod(tx, ctx.institutionId, month)
        if (stored !== null && stored.version !== expectedVersion) throw new ConflictError()
        const adjustments =
          stored === null ? 0 : await countPeriodAdjustments(tx, ctx.institutionId, stored.id)
        return {
          run: () => ({ parsed, stored: planPayrollReopen(stored, adjustments) }),
        }
      },
      after: async (tx, { parsed, stored }) => {
        id = stored.id
        const saved = await reopenPayrollPeriod(tx, ctx.institutionId, {
          id,
          expectedVersion,
          reason: parsed.reason,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.payroll_period.reopen', { type: PERIOD, id }, [
          'status',
          'reopenedAt',
          'reopenReason',
        ])
        body = await periodBody(tx, ctx, month)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Düzeltme kaydı -------------------------------------------------------------------------------

function adjustmentView(item: StoredPayrollAdjustment, names: Map<string, string>) {
  return {
    id: item.id,
    sourceMonth: item.sourceMonth,
    targetMonth: item.targetMonth,
    membershipId: item.membershipId,
    staffName: item.staffName,
    item: item.item,
    amountCents: item.amountCents,
    // Veritabanı denetimi yalnız TRY'ye izin verir (`payroll_adjustments_currency_check`).
    currency: 'TRY' as const,
    reason: item.reason,
    createdByName: names.get(item.createdByUserId) ?? null,
    createdAt: item.createdAt,
    version: item.version,
  }
}

async function auditAdjustmentRead(tx: Database, ctx: ServiceContext, entityId: string) {
  await tx.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: 'finance.payroll_adjustment.read',
    entityType: PERIOD,
    entityId,
    // kvkk: tutar değil, dönen alanın adı (K-307, K-359).
    changes: { fields: ['amountCents'] },
    createdAt: ctx.now,
  })
}

/**
 * Ayın düzeltme kayıtları (kaynak ay). Kişi başı fark tutarı içerdiği için her okuma denetime düşer
 * (K-359); kaydı olmayan (açık) ayda boş liste döner ve denetim yazılmaz.
 */
export async function listPayrollAdjustmentsFor(
  ctx: ServiceContext,
  month: string,
  page: { page: number; pageSize: number },
) {
  return ctx.db.transaction(async (tx) => {
    const period = await findPayrollPeriod(tx, ctx.institutionId, month)
    if (period === null) return { items: [], total: 0 }
    const { items, total } = await listPeriodAdjustments(tx, ctx.institutionId, period.id, page)
    const names = await userNames(
      tx,
      items.map((item) => item.createdByUserId),
    )
    await auditAdjustmentRead(tx, ctx, period.id)
    return { items: items.map((item) => adjustmentView(item, names)), total }
  })
}

async function adjustmentBody(tx: Database, ctx: ServiceContext, id: string) {
  const item = await findPayrollAdjustment(tx, ctx.institutionId, id)
  if (item === null) throw new NotFoundError()
  return { data: adjustmentView(item, await userNames(tx, [item.createdByUserId])) }
}

/** Düzeltme kaydı (K-358): yalnız onaylı ayda; hedef ay sonraki ilk kilitsiz aydır. 201. */
export function createPayrollAdjustmentCommand(
  ctx: ServiceContext,
  month: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ADJUSTMENT, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.payroll_adjustment.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = payrollAdjustmentInputSchema.parse(input)
        const stored = await findPayrollPeriod(tx, ctx.institutionId, month)
        const staff = await findStaffMember(tx, ctx.institutionId, parsed.membershipId)
        const locked = await lockedPayrollMonths(tx, ctx.institutionId)
        return {
          run: () => ({ parsed, plan: planPayrollAdjustment(month, stored, staff, locked) }),
        }
      },
      after: async (tx, { parsed, plan }) => {
        await insertPayrollAdjustment(tx, ctx.institutionId, {
          id,
          periodId: plan.period.id,
          sourceMonth: month,
          targetMonth: plan.targetMonth,
          membershipId: parsed.membershipId,
          item: parsed.item,
          amountCents: parsed.amountCents,
          reason: parsed.reason,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.payroll_adjustment.create', entity, [
          'membershipId',
          'item',
          'amountCents',
          'reason',
          'targetMonth',
        ])
        body = await adjustmentBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Düzeltmeyi gerekçeyle iptal et (K-358); hedef ay onaylandıysa 409 `payroll_period_locked`. */
export function cancelPayrollAdjustmentCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ADJUSTMENT, id }
  return runCommand(
    ctx,
    {
      action: 'finance.payroll_adjustment.cancel',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = payrollAdjustmentCancelSchema.parse(input)
        const item = await findPayrollAdjustment(tx, ctx.institutionId, id)
        if (item === null) throw new NotFoundError()
        if (item.version !== expectedVersion) throw new ConflictError()
        const locked = await lockedPayrollMonths(tx, ctx.institutionId)
        return {
          run: () => {
            planPayrollAdjustmentCancel(item, locked)
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        const saved = await cancelPayrollAdjustment(tx, ctx.institutionId, {
          id,
          expectedVersion,
          reason: parsed.reason,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.payroll_adjustment.cancel', entity, [
          'archivedAt',
          'cancelReason',
        ])
      },
    },
    () => ({ statusCode: 200, body: { data: { id, archivedAt: ctx.now.toISOString() } } }),
    idempotency,
  )
}
