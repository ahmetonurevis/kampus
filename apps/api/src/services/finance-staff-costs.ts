import { randomUUID } from 'node:crypto'

import {
  staffCostCsv,
  staffCostParameters,
  staffCostReport,
  type StaffCostReport,
} from '@kampus/school-core/lib/finance-staff-cost-report.ts'
import {
  allocationEndMonth,
  allocationInMonth,
  monthEnd,
  monthOf,
  monthsBetween,
  monthStart,
  planStaffCostAllocation,
  staffCostAllocationCancelSchema,
  staffCostAllocationInputSchema,
} from '@kampus/school-core/lib/finance-staff-costs.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { isStaffRole } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from '../db/client.ts'
import { loadCostCenters, type StoredCostCenter } from '../db/finance-budget.ts'
import { findStaffMember, listStaffMembers, type StaffQuery } from '../db/finance-pay-rates.ts'
import { listPayrollParameterSets } from '../db/finance-payroll-parameters.ts'
import {
  cancelStaffCostAllocation,
  findStaffCostAllocation,
  insertStaffCostAllocation,
  isStaffCostMonthTaken,
  loadStaffCostAllocations,
  loadStaffCostMembers,
  loadStaffCostRates,
  type StoredStaffCostAllocation,
} from '../db/finance-staff-costs.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import {
  mapOperationError,
  runCommand,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Personel maliyet ataması ve tahmini maliyet raporu (DOM-FIN-104; ON-204). Kural core
 * `lib/finance-staff-costs.ts` ve `lib/finance-staff-cost-report.ts`'tedir. Atama kurum kilidi
 * altında tek transaction'da yazılır; denetim kaydına alan adları yazılır, gerekçe yazılmaz. Rapor
 * ücret içerdiği için her okuması (`finance.staff_cost.read`) ve CSV'si
 * (`finance.staff_cost.export`) okumayla aynı transaction'da denetime düşer; denetim yazılamazsa
 * yanıt dönmez (K-334). Tutar loglanmaz. Rol ve modül denetimi rotadadır (yalnız yönetici).
 */

const ENTITY = 'staff_cost_allocations'
const READ_ACTION = 'finance.staff_cost.read'
const EXPORT_ACTION = 'finance.staff_cost.export'
const REPORT_FIELDS = [
  'grossCents',
  'employerSgkCents',
  'unemploymentCents',
  'benefitsCents',
  'totalCents',
]

type CenterLookup = ReadonlyMap<string, StoredCostCenter>

/** Atama görünümü: merkez kodu ve adıyla, bitiş ayı hesaplanmış. */
function allocationView(
  allocation: StoredStaffCostAllocation,
  siblings: readonly StoredStaffCostAllocation[],
  centers: CenterLookup,
) {
  return {
    id: allocation.id,
    membershipId: allocation.membershipId,
    startMonth: allocation.startMonth,
    endMonth: allocationEndMonth(allocation, siblings),
    shares: allocation.shares.map((share) => {
      const center = centers.get(share.costCenterId)
      return {
        costCenterId: share.costCenterId,
        code: center?.code ?? '',
        name: center?.name ?? '',
        isActive: center?.isActive ?? false,
        shareBasisPoints: share.shareBasisPoints,
      }
    }),
    wageHours: allocation.wageHours,
    extraLessonHours: allocation.extraLessonHours,
    dutyHours: allocation.dutyHours,
    createdAt: allocation.createdAt,
    version: allocation.version,
  }
}
export type StaffCostAllocationView = ReturnType<typeof allocationView>

async function centersOf(db: Database, institutionId: string): Promise<CenterLookup> {
  return new Map((await loadCostCenters(db, institutionId)).map((center) => [center.id, center]))
}

/** Personel üyeliği: yoksa ya da personel değilse (öğrenci, veli) 404. */
async function staffOf(db: Database, ctx: ServiceContext, membershipId: string) {
  const member = await findStaffMember(db, ctx.institutionId, membershipId)
  if (member === null || !isStaffRole(member.role)) throw new NotFoundError()
  return member
}

/**
 * Personel listesi ve `month` ayındaki atama (K-332). Ücret tutarı taşımaz; okuma denetime düşmez.
 */
export async function listStaffCostStaffFor(
  ctx: ServiceContext,
  query: StaffQuery & { month?: string | undefined },
) {
  const month = query.month ?? monthOf(dayKey(ctx.now))
  return ctx.db.transaction(async (tx) => {
    const { items, total } = await listStaffMembers(tx, ctx.institutionId, query)
    const allocations = await loadStaffCostAllocations(
      tx,
      ctx.institutionId,
      items.map((item) => item.membershipId),
    )
    const centers = await centersOf(tx, ctx.institutionId)
    const byMember = new Map<string, StoredStaffCostAllocation[]>()
    for (const allocation of allocations)
      byMember.set(allocation.membershipId, [
        ...(byMember.get(allocation.membershipId) ?? []),
        allocation,
      ])
    const rows = items.map((member) => {
      const own = byMember.get(member.membershipId) ?? []
      const current = allocationInMonth(own, month)
      return {
        ...member,
        allocation: current === null ? null : allocationView(current, own, centers),
        allocationCount: own.length,
      }
    })
    return { items: rows, total, month }
  })
}

/** Personelin bütün (iptal edilmemiş) atamaları, başlangıca göre; personel değilse 404. */
export async function getStaffCostAllocationsFor(ctx: ServiceContext, membershipId: string) {
  return ctx.db.transaction(async (tx) => {
    const member = await staffOf(tx, ctx, membershipId)
    const own = await loadStaffCostAllocations(tx, ctx.institutionId, [membershipId])
    const centers = await centersOf(tx, ctx.institutionId)
    const month = monthOf(dayKey(ctx.now))
    return {
      ...member,
      month,
      currentId: allocationInMonth(own, month)?.id ?? null,
      allocations: own.map((allocation) => allocationView(allocation, own, centers)),
    }
  })
}

async function allocationBody(tx: Database, ctx: ServiceContext, id: string) {
  const allocation = await findStaffCostAllocation(tx, ctx.institutionId, id)
  if (allocation === null) throw new NotFoundError()
  const own = await loadStaffCostAllocations(tx, ctx.institutionId, [allocation.membershipId])
  return allocationView(allocation, own, await centersOf(tx, ctx.institutionId))
}

/** Yeni atama (K-332). 201. */
export function createStaffCostAllocationCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_cost_allocation.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = staffCostAllocationInputSchema.parse(input)
        const staff = await findStaffMember(tx, ctx.institutionId, parsed.membershipId)
        const centers = await loadCostCenters(tx, ctx.institutionId)
        const monthTaken = await isStaffCostMonthTaken(
          tx,
          ctx.institutionId,
          parsed.membershipId,
          parsed.startMonth,
        )
        return {
          run: () => {
            planStaffCostAllocation(parsed, {
              staff,
              centers: new Map(centers.map((center) => [center.id, center])),
              monthTaken,
            })
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        await insertStaffCostAllocation(tx, ctx.institutionId, {
          id,
          membershipId: parsed.membershipId,
          startMonth: parsed.startMonth,
          shares: parsed.shares,
          wageHours: parsed.wageHours,
          extraLessonHours: parsed.extraLessonHours,
          dutyHours: parsed.dutyHours,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(
          tx,
          ctx,
          'finance.staff_cost_allocation.create',
          entity,
          Object.keys(parsed).filter((key) => parsed[key as keyof typeof parsed] !== null),
        )
        body = { data: await allocationBody(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Atamayı gerekçeyle iptal et (K-332); sonraki ve önceki atamalar yerinde kalır. */
export function cancelStaffCostAllocationCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staff_cost_allocation.cancel',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = staffCostAllocationCancelSchema.parse(input)
        const allocation = await findStaffCostAllocation(tx, ctx.institutionId, id)
        if (allocation === null) throw new NotFoundError()
        if (allocation.version !== expectedVersion) throw new ConflictError()
        return { run: () => parsed }
      },
      after: async (tx, parsed) => {
        const saved = await cancelStaffCostAllocation(tx, ctx.institutionId, {
          id,
          expectedVersion,
          reason: parsed.reason,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        // kvkk: gerekçe yazılmaz, yalnız alan adı.
        await auditWork(tx, ctx, 'finance.staff_cost_allocation.cancel', entity, ['reason'])
        body = { data: { id } }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

export interface StaffCostQuery {
  from?: string | undefined
  to?: string | undefined
  people: boolean
}

async function buildReport(
  tx: Database,
  ctx: ServiceContext,
  query: StaffCostQuery,
): Promise<StaffCostReport> {
  const current = monthOf(dayKey(ctx.now))
  const from = query.from ?? query.to ?? current
  const to = query.to ?? from
  const months = monthsBetween(from, to)
  const sets = await listPayrollParameterSets(tx, ctx.institutionId)
  let parameters: ReturnType<typeof staffCostParameters>
  try {
    parameters = staffCostParameters(months, sets)
  } catch (error) {
    throw mapOperationError(error)
  }
  const [staff, rates, allocations, centers] = [
    await loadStaffCostMembers(tx, ctx.institutionId),
    await loadStaffCostRates(tx, ctx.institutionId, {
      from: monthStart(from),
      to: monthEnd(to),
    }),
    await loadStaffCostAllocations(tx, ctx.institutionId, null),
    await loadCostCenters(tx, ctx.institutionId),
  ]
  return staffCostReport({
    from,
    to,
    people: query.people,
    staff,
    rates,
    allocations,
    centers,
    parameters,
  })
}

async function auditReport(
  tx: Database,
  ctx: ServiceContext,
  action: string,
  report: StaffCostReport,
) {
  await tx.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action,
    entityType: 'staff_cost_report',
    entityId: `${report.from}:${report.to}`,
    // kvkk: tutar değil, dönen alanların adı; kişi satırları istendiyse `membershipId` de.
    changes: { fields: report.people ? [...REPORT_FIELDS, 'membershipId'] : REPORT_FIELDS },
    createdAt: ctx.now,
  })
}

/** Tahmini personel maliyeti raporu (DOM-FIN-104); her okuma denetime düşer (K-334). */
export function staffCostReportFor(
  ctx: ServiceContext,
  query: StaffCostQuery,
): Promise<StaffCostReport> {
  return ctx.db.transaction(async (tx) => {
    const report = await buildReport(tx, ctx, query)
    await auditReport(tx, ctx, READ_ACTION, report)
    return report
  })
}

/** Raporun CSV'si (K-334): taze oturum rotada; dosya her indirmede denetime düşer. */
export function staffCostCsvFor(
  ctx: ServiceContext,
  query: StaffCostQuery,
): Promise<{ csv: string; filename: string }> {
  return ctx.db.transaction(async (tx) => {
    const report = await buildReport(tx, ctx, query)
    await auditReport(tx, ctx, EXPORT_ACTION, report)
    return {
      csv: staffCostCsv(report),
      filename: `personel-maliyeti-${report.from}${report.to === report.from ? '' : `-${report.to}`}.csv`,
    }
  })
}
