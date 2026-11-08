import { randomUUID } from 'node:crypto'

import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  planScholarshipFundAllocation,
  planScholarshipFundAllocationCancel,
  planScholarshipFundClose,
  planScholarshipFundCreate,
  planScholarshipFundDonation,
  planScholarshipFundDonationCancel,
  SCHOLARSHIP_FUND_NAME_ROLES,
  scholarshipFundAllocationSchema,
  scholarshipFundCsv,
  scholarshipFundMovements,
  scholarshipFundTotals,
  type ScholarshipFundStatus,
} from '@kampus/school-core/lib/finance-scholarship-funds.ts'

import type { Database } from '../db/client.ts'
import {
  cancelFundAllocation,
  cancelFundDonation,
  closeScholarshipFund,
  findFundAllocation,
  findFundDonation,
  findScholarshipFund,
  insertFundAllocation,
  insertFundDonation,
  insertScholarshipFund,
  listScholarshipFunds,
  loadFundAllocations,
  loadFundDonations,
  openScholarshipFundNames,
  scholarshipAwardCoverage,
  scholarshipFundBalance,
  type StoredScholarshipFund,
} from '../db/finance-scholarship-funds.ts'
import { findScholarshipAward } from '../db/finance-scholarships.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Burs fonu servisi (DOM-FIN-068; ON-259). Kural core `lib/finance-scholarship-funds.ts`'tedir.
 * Her yazma kurum kilidi altında (`runCommand`) bakiyeyi yeniden toplar, core'a karar verdirir ve
 * aynı transaction'da yazar: eşzamanlı iki atama bakiyeyi aşamaz (PG16 testi). Denetime alan
 * adları düşer; tutar, not ve gerekçe loglanmaz.
 */

const FUND = 'scholarship_funds'
const DONATION = 'scholarship_fund_donations'
const ALLOCATION = 'scholarship_fund_allocations'

const fundStatus = (fund: StoredScholarshipFund): ScholarshipFundStatus =>
  fund.closedAt === null ? 'active' : 'closed'

export const listScholarshipFundsFor = (
  ctx: ServiceContext,
  query: {
    page: number
    pageSize: number
    q?: string | undefined
    status?: ScholarshipFundStatus | undefined
  },
) =>
  listScholarshipFunds(ctx.db, ctx.institutionId, query).then(({ items, total }) => ({
    items: items.map((fund) => ({ ...fund, status: fundStatus(fund) })),
    total,
  }))

async function fundOf(db: Database, ctx: ServiceContext, id: string) {
  const fund = await findScholarshipFund(db, ctx.institutionId, id)
  if (fund === null) throw new NotFoundError()
  return fund
}

/** Öğrenci adı yalnız yetkili rolde okunur (K-98); öteki rolde öğrenci kaydına hiç gidilmez. */
async function studentNames(db: Database, ctx: ServiceContext, ids: readonly string[]) {
  if (!(SCHOLARSHIP_FUND_NAME_ROLES as readonly string[]).includes(ctx.actor.role)) return null
  if (ids.length === 0) return new Map<string, string | null>()
  const rows = await loadRecordsByIds(db, ctx.institutionId, 'students', [...new Set(ids)], {
    includeArchived: true,
  })
  return new Map(
    rows.map((row) => [row.id, typeof row.data.name === 'string' ? row.data.name : null]),
  )
}

/** Fon, toplamlar ve hareket dökümü; ekran, PDF ve CSV aynı yanıttan beslenir. */
async function fundReport(db: Database, ctx: ServiceContext, id: string) {
  const fund = await fundOf(db, ctx, id)
  const [donations, allocations] = await Promise.all([
    loadFundDonations(db, ctx.institutionId, id),
    loadFundAllocations(db, ctx.institutionId, id),
  ])
  const totals = scholarshipFundTotals(donations, allocations)
  const names = await studentNames(
    db,
    ctx,
    allocations.map((row) => row.studentId),
  )
  return {
    fund: { ...fund, status: fundStatus(fund), ...totals },
    movements: scholarshipFundMovements(donations, allocations, names),
  }
}

export const scholarshipFundReportFor = (ctx: ServiceContext, id: string) =>
  fundReport(ctx.db, ctx, id)

/** CSV dökümü; öğrenci adı taşıyabildiği için denetime yazılır (rota taze oturum ister). */
export async function scholarshipFundCsvFor(ctx: ServiceContext, id: string) {
  const report = await fundReport(ctx.db, ctx, id)
  const csv = scholarshipFundCsv(report.fund, report.fund, report.movements)
  await ctx.db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: 'finance.scholarship_fund_export',
    entityType: FUND,
    entityId: id,
    changes: { fields: [] },
    createdAt: ctx.now,
  })
  return csv
}

async function fundBody(tx: Database, ctx: ServiceContext, id: string) {
  return { data: await fundReport(tx, ctx, id) }
}

/** Fon açar (K-95); aynı adla ikinci açık fon 409. 201. */
export function createScholarshipFundCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: FUND, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'scholarship_fund.create',
      collections: [],
      entity,
      load: async (tx) => {
        const names = await openScholarshipFundNames(tx, ctx.institutionId)
        return { run: () => planScholarshipFundCreate(input, names) }
      },
      after: async (tx, plan) => {
        await insertScholarshipFund(tx, ctx.institutionId, {
          id,
          ...plan,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'scholarship_fund.create', entity, Object.keys(plan))
        body = await fundBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Bağış girişi; para hareketidir, `Idempotency-Key` rotada zorunludur. 201. */
export function donateToScholarshipFundCommand(
  ctx: ServiceContext,
  fundId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: DONATION, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'scholarship_fund.donate',
      collections: [],
      entity,
      load: async (tx) => {
        const fund = await fundOf(tx, ctx, fundId)
        return { run: () => planScholarshipFundDonation(fund, input, dayKey(ctx.now)) }
      },
      after: async (tx, plan) => {
        await insertFundDonation(tx, ctx.institutionId, {
          id,
          fundId,
          ...plan,
          recordedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'scholarship_fund.donate', entity, Object.keys(plan))
        body = await fundBody(tx, ctx, fundId)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/**
 * Fondan burs ataması (K-96): bakiye ve bursun karşılanmış kısmı kurum kilidi altında toplanır;
 * eşzamanlı ikinci atama ilkinin yazdığı satırı görür ve bakiye aşılmaz. 201.
 */
export function allocateFromScholarshipFundCommand(
  ctx: ServiceContext,
  fundId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ALLOCATION, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'scholarship_fund.allocate',
      collections: [],
      entity,
      load: async (tx) => {
        const fund = await fundOf(tx, ctx, fundId)
        // Geçersiz gövde yüklemeden önce 400 olur; plan aynı şemayla yeniden doğrular.
        const { awardId } = scholarshipFundAllocationSchema.parse(input)
        const award = await findScholarshipAward(tx, ctx.institutionId, awardId)
        const balanceCents = await scholarshipFundBalance(tx, ctx.institutionId, fundId)
        const coverage = await scholarshipAwardCoverage(tx, ctx.institutionId, awardId, fundId)
        return {
          run: () =>
            planScholarshipFundAllocation(fund, award, { balanceCents, ...coverage }, input),
        }
      },
      after: async (tx, plan) => {
        await insertFundAllocation(tx, ctx.institutionId, {
          id,
          fundId,
          ...plan,
          allocatedOn: dayKey(ctx.now),
          allocatedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'scholarship_fund.allocate', entity, Object.keys(plan))
        body = await fundBody(tx, ctx, fundId)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Bağış iptali; bakiyeyi eksiye düşürecekse 422 (K-97). Gerekçe yalnız tabloda, logda değil. */
export function cancelScholarshipFundDonationCommand(
  ctx: ServiceContext,
  fundId: string,
  donationId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: DONATION, id: donationId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'scholarship_fund.donation_cancel',
      collections: [],
      entity,
      load: async (tx) => {
        await fundOf(tx, ctx, fundId)
        const donation = await findFundDonation(tx, ctx.institutionId, fundId, donationId)
        if (donation === null) throw new NotFoundError()
        if (donation.version !== expectedVersion) throw new ConflictError()
        const balanceCents = await scholarshipFundBalance(tx, ctx.institutionId, fundId)
        return { run: () => planScholarshipFundDonationCancel(donation, balanceCents, input) }
      },
      after: async (tx, plan) => {
        const saved = await cancelFundDonation(tx, ctx.institutionId, {
          id: donationId,
          expectedVersion,
          userId: ctx.actor.userId,
          reason: plan.reason,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'scholarship_fund.donation_cancel', entity, [
          'cancelledAt',
          'cancelReason',
        ])
        body = await fundBody(tx, ctx, fundId)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Atama iptali bakiyeyi geri verir; kapalı fonda 422 `scholarship_fund_closed` (K-97). */
export function cancelScholarshipFundAllocationCommand(
  ctx: ServiceContext,
  fundId: string,
  allocationId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ALLOCATION, id: allocationId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'scholarship_fund.allocation_cancel',
      collections: [],
      entity,
      load: async (tx) => {
        const fund = await fundOf(tx, ctx, fundId)
        const allocation = await findFundAllocation(tx, ctx.institutionId, fundId, allocationId)
        if (allocation === null) throw new NotFoundError()
        if (allocation.version !== expectedVersion) throw new ConflictError()
        return { run: () => planScholarshipFundAllocationCancel(fund, allocation, input) }
      },
      after: async (tx, plan) => {
        const saved = await cancelFundAllocation(tx, ctx.institutionId, {
          id: allocationId,
          expectedVersion,
          userId: ctx.actor.userId,
          reason: plan.reason,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'scholarship_fund.allocation_cancel', entity, [
          'cancelledAt',
          'cancelReason',
        ])
        body = await fundBody(tx, ctx, fundId)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Fon yalnız sıfır bakiyede kapanır; kapalı fona bağış ve atama yapılmaz (K-97). */
export function closeScholarshipFundCommand(
  ctx: ServiceContext,
  fundId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: FUND, id: fundId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'scholarship_fund.close',
      collections: [],
      entity,
      load: async (tx) => {
        const fund = await fundOf(tx, ctx, fundId)
        if (fund.version !== expectedVersion) throw new ConflictError()
        const balanceCents = await scholarshipFundBalance(tx, ctx.institutionId, fundId)
        return { run: () => planScholarshipFundClose(fund, balanceCents) }
      },
      after: async (tx) => {
        const saved = await closeScholarshipFund(tx, ctx.institutionId, {
          id: fundId,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'scholarship_fund.close', entity, ['closedAt'])
        body = await fundBody(tx, ctx, fundId)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
