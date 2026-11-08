import { and, asc, count, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'

import type {
  ScholarshipFundChannel,
  ScholarshipFundDonorKind,
  ScholarshipFundStatus,
  StoredFundAllocation,
  StoredFundDonation,
} from '@kampus/school-core/lib/finance-scholarship-funds.ts'

import type { Database } from './client.ts'
import {
  scholarshipFundAllocations,
  scholarshipFundDonations,
  scholarshipFunds,
} from './schema/finance-scholarship-funds.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Burs fonu deposu (DOM-FIN-068; ON-259); her sorgu kurum kapsamlıdır. Bakiye saklanmaz, geçerli
 * bağış ve atama satırlarından toplanır. Yazmalar servisin kurum kilidi altındadır.
 */

export type StoredScholarshipFund = {
  id: string
  name: string
  description: string | null
  donorKind: ScholarshipFundDonorKind
  donorName: string | null
  closedAt: string | null
  createdAt: string
  version: number
}

export type FundTotalsRow = {
  donatedCents: number
  allocatedCents: number
  balanceCents: number
  donationCount: number
  allocationCount: number
}

const FUND_COLUMNS = {
  id: scholarshipFunds.id,
  name: scholarshipFunds.name,
  description: scholarshipFunds.description,
  donorKind: scholarshipFunds.donorKind,
  donorName: scholarshipFunds.donorName,
  closedAt: scholarshipFunds.closedAt,
  createdAt: scholarshipFunds.createdAt,
  version: scholarshipFunds.version,
}
type FundRow = Omit<StoredScholarshipFund, 'closedAt' | 'createdAt' | 'donorKind'> & {
  donorKind: string
  closedAt: Date | null
  createdAt: Date
}
const toFund = (row: FundRow): StoredScholarshipFund => ({
  ...row,
  donorKind: row.donorKind as ScholarshipFundDonorKind,
  closedAt: row.closedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
})

const activeFund = (institutionId: string) =>
  and(eq(scholarshipFunds.institutionId, institutionId), isNull(scholarshipFunds.archivedAt))
const liveDonation = (institutionId: string) =>
  and(
    eq(scholarshipFundDonations.institutionId, institutionId),
    isNull(scholarshipFundDonations.archivedAt),
  )
const liveAllocation = (institutionId: string) =>
  and(
    eq(scholarshipFundAllocations.institutionId, institutionId),
    isNull(scholarshipFundAllocations.archivedAt),
  )

/** Fon başına geçerli bağış ve atama toplamı; iptal edilen satır sayılmaz. */
function donationSums(db: Database, institutionId: string) {
  return db
    .select({
      fundId: scholarshipFundDonations.fundId,
      donated: sql<number>`coalesce(sum(${scholarshipFundDonations.amountCents}), 0)::bigint`
        .mapWith(Number)
        .as('donated'),
      donations: count().as('donations'),
    })
    .from(scholarshipFundDonations)
    .where(and(liveDonation(institutionId), isNull(scholarshipFundDonations.cancelledAt)))
    .groupBy(scholarshipFundDonations.fundId)
    .as('donation_sums')
}
function allocationSums(db: Database, institutionId: string) {
  return db
    .select({
      fundId: scholarshipFundAllocations.fundId,
      allocated: sql<number>`coalesce(sum(${scholarshipFundAllocations.amountCents}), 0)::bigint`
        .mapWith(Number)
        .as('allocated'),
      allocations: count().as('allocations'),
    })
    .from(scholarshipFundAllocations)
    .where(and(liveAllocation(institutionId), isNull(scholarshipFundAllocations.cancelledAt)))
    .groupBy(scholarshipFundAllocations.fundId)
    .as('allocation_sums')
}

export async function listScholarshipFunds(
  db: Database,
  institutionId: string,
  query: {
    page: number
    pageSize: number
    q?: string | undefined
    status?: ScholarshipFundStatus | undefined
  },
): Promise<{ items: (StoredScholarshipFund & FundTotalsRow)[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    activeFund(institutionId),
    search === undefined
      ? undefined
      : or(
          sql`strpos(${foldSql(scholarshipFunds.name)}, ${search}) > 0`,
          sql`strpos(${foldSql(sql`coalesce(${scholarshipFunds.donorName}, '')`)}, ${search}) > 0`,
        ),
    query.status === 'active' ? isNull(scholarshipFunds.closedAt) : undefined,
    query.status === 'closed' ? isNotNull(scholarshipFunds.closedAt) : undefined,
  )
  const [totalRow] = await db.select({ total: count() }).from(scholarshipFunds).where(where)
  const donations = donationSums(db, institutionId)
  const allocations = allocationSums(db, institutionId)
  const rows = await db
    .select({
      ...FUND_COLUMNS,
      donated: donations.donated,
      donations: donations.donations,
      allocated: allocations.allocated,
      allocations: allocations.allocations,
    })
    .from(scholarshipFunds)
    .leftJoin(donations, eq(donations.fundId, scholarshipFunds.id))
    .leftJoin(allocations, eq(allocations.fundId, scholarshipFunds.id))
    .where(where)
    // Açık fonlar önce, sonra ada göre.
    .orderBy(
      sql`${scholarshipFunds.closedAt} is not null`,
      asc(foldSql(scholarshipFunds.name)),
      asc(scholarshipFunds.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return {
    items: rows.map(
      ({ donated, donations: donationCount, allocated, allocations: allocationCount, ...row }) => {
        const donatedCents = Number(donated ?? 0)
        const allocatedCents = Number(allocated ?? 0)
        return {
          ...toFund(row),
          donatedCents,
          allocatedCents,
          balanceCents: donatedCents - allocatedCents,
          donationCount: Number(donationCount ?? 0),
          allocationCount: Number(allocationCount ?? 0),
        }
      },
    ),
    total: totalRow?.total ?? 0,
  }
}

export async function findScholarshipFund(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredScholarshipFund | null> {
  const [row] = await db
    .select(FUND_COLUMNS)
    .from(scholarshipFunds)
    .where(and(activeFund(institutionId), eq(scholarshipFunds.id, id)))
    .limit(1)
  return row === undefined ? null : toFund(row)
}

/** Açık fonların adları; aynı adla ikinci açık fon açılmaz. */
export async function openScholarshipFundNames(
  db: Database,
  institutionId: string,
): Promise<string[]> {
  const rows = await db
    .select({ name: scholarshipFunds.name })
    .from(scholarshipFunds)
    .where(and(activeFund(institutionId), isNull(scholarshipFunds.closedAt)))
  return rows.map((row) => row.name)
}

export async function insertScholarshipFund(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    name: string
    description: string | null
    donorKind: ScholarshipFundDonorKind
    donorName: string | null
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...fund } = input
  await tx
    .insert(scholarshipFunds)
    .values({ institutionId, ...fund, createdAt: now, updatedAt: now })
}

/** Fonu kapatır; sürüm tutmazsa ya da zaten kapalıysa `false` (409). */
export async function closeScholarshipFund(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(scholarshipFunds)
    .set({
      closedAt: input.now,
      closedByUserId: input.userId,
      version: sql`${scholarshipFunds.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        activeFund(institutionId),
        eq(scholarshipFunds.id, input.id),
        eq(scholarshipFunds.version, input.expectedVersion),
        isNull(scholarshipFunds.closedAt),
      ),
    )
    .returning({ id: scholarshipFunds.id })
  return rows.length === 1
}

/** Fonun bugünkü bakiyesi: geçerli bağışlar eksi geçerli atamalar (kuruş). */
export async function scholarshipFundBalance(
  db: Database,
  institutionId: string,
  fundId: string,
): Promise<number> {
  const [donated] = await db
    .select({
      total: sql<number>`coalesce(sum(${scholarshipFundDonations.amountCents}), 0)::bigint`.mapWith(
        Number,
      ),
    })
    .from(scholarshipFundDonations)
    .where(
      and(
        liveDonation(institutionId),
        eq(scholarshipFundDonations.fundId, fundId),
        isNull(scholarshipFundDonations.cancelledAt),
      ),
    )
  const [allocated] = await db
    .select({
      total:
        sql<number>`coalesce(sum(${scholarshipFundAllocations.amountCents}), 0)::bigint`.mapWith(
          Number,
        ),
    })
    .from(scholarshipFundAllocations)
    .where(
      and(
        liveAllocation(institutionId),
        eq(scholarshipFundAllocations.fundId, fundId),
        isNull(scholarshipFundAllocations.cancelledAt),
      ),
    )
  return (donated?.total ?? 0) - (allocated?.total ?? 0)
}

/**
 * Bursun bütün fonlardaki geçerli atama toplamı ve bu fondan geçerli ataması olup olmadığı (K-96).
 * Servis kurum kilidi altında sorar; kısmi tekil indeks yalnız kilitsiz yarışta tetiklenir.
 */
export async function scholarshipAwardCoverage(
  db: Database,
  institutionId: string,
  awardId: string,
  fundId: string,
): Promise<{ coveredCents: number; alreadyFromFund: boolean }> {
  const rows = await db
    .select({
      fundId: scholarshipFundAllocations.fundId,
      amountCents: scholarshipFundAllocations.amountCents,
    })
    .from(scholarshipFundAllocations)
    .where(
      and(
        liveAllocation(institutionId),
        eq(scholarshipFundAllocations.awardId, awardId),
        isNull(scholarshipFundAllocations.cancelledAt),
      ),
    )
  return {
    coveredCents: rows.reduce((total, row) => total + row.amountCents, 0),
    alreadyFromFund: rows.some((row) => row.fundId === fundId),
  }
}

const DONATION_COLUMNS = {
  id: scholarshipFundDonations.id,
  fundId: scholarshipFundDonations.fundId,
  amountCents: scholarshipFundDonations.amountCents,
  donatedOn: scholarshipFundDonations.donatedOn,
  channel: scholarshipFundDonations.channel,
  note: scholarshipFundDonations.note,
  createdAt: scholarshipFundDonations.createdAt,
  cancelledAt: scholarshipFundDonations.cancelledAt,
  cancelReason: scholarshipFundDonations.cancelReason,
  version: scholarshipFundDonations.version,
}
type DonationRow = {
  id: string
  fundId: string
  amountCents: number
  donatedOn: string
  channel: string
  note: string | null
  createdAt: Date
  cancelledAt: Date | null
  cancelReason: string | null
  version: number
}
export type FundDonationRecord = StoredFundDonation & { fundId: string }
const toDonation = (row: DonationRow): FundDonationRecord => ({
  ...row,
  channel: row.channel as ScholarshipFundChannel,
  createdAt: row.createdAt.toISOString(),
  cancelledAt: row.cancelledAt?.toISOString() ?? null,
})

const ALLOCATION_COLUMNS = {
  id: scholarshipFundAllocations.id,
  fundId: scholarshipFundAllocations.fundId,
  awardId: scholarshipFundAllocations.awardId,
  studentId: scholarshipFundAllocations.studentId,
  academicYear: scholarshipFundAllocations.academicYear,
  amountCents: scholarshipFundAllocations.amountCents,
  allocatedOn: scholarshipFundAllocations.allocatedOn,
  createdAt: scholarshipFundAllocations.createdAt,
  cancelledAt: scholarshipFundAllocations.cancelledAt,
  cancelReason: scholarshipFundAllocations.cancelReason,
  version: scholarshipFundAllocations.version,
}
type AllocationRow = Omit<StoredFundAllocation, 'createdAt' | 'cancelledAt'> & {
  fundId: string
  createdAt: Date
  cancelledAt: Date | null
}
export type FundAllocationRecord = StoredFundAllocation & { fundId: string }
const toAllocation = (row: AllocationRow): FundAllocationRecord => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  cancelledAt: row.cancelledAt?.toISOString() ?? null,
})

export async function loadFundDonations(
  db: Database,
  institutionId: string,
  fundId: string,
): Promise<FundDonationRecord[]> {
  const rows = await db
    .select(DONATION_COLUMNS)
    .from(scholarshipFundDonations)
    .where(and(liveDonation(institutionId), eq(scholarshipFundDonations.fundId, fundId)))
    .orderBy(asc(scholarshipFundDonations.donatedOn), asc(scholarshipFundDonations.createdAt))
  return rows.map(toDonation)
}

export async function loadFundAllocations(
  db: Database,
  institutionId: string,
  fundId: string,
): Promise<FundAllocationRecord[]> {
  const rows = await db
    .select(ALLOCATION_COLUMNS)
    .from(scholarshipFundAllocations)
    .where(and(liveAllocation(institutionId), eq(scholarshipFundAllocations.fundId, fundId)))
    .orderBy(asc(scholarshipFundAllocations.allocatedOn), asc(scholarshipFundAllocations.createdAt))
  return rows.map(toAllocation)
}

export async function findFundDonation(
  db: Database,
  institutionId: string,
  fundId: string,
  id: string,
): Promise<FundDonationRecord | null> {
  const [row] = await db
    .select(DONATION_COLUMNS)
    .from(scholarshipFundDonations)
    .where(
      and(
        liveDonation(institutionId),
        eq(scholarshipFundDonations.fundId, fundId),
        eq(scholarshipFundDonations.id, id),
      ),
    )
    .limit(1)
  return row === undefined ? null : toDonation(row)
}

export async function findFundAllocation(
  db: Database,
  institutionId: string,
  fundId: string,
  id: string,
): Promise<FundAllocationRecord | null> {
  const [row] = await db
    .select(ALLOCATION_COLUMNS)
    .from(scholarshipFundAllocations)
    .where(
      and(
        liveAllocation(institutionId),
        eq(scholarshipFundAllocations.fundId, fundId),
        eq(scholarshipFundAllocations.id, id),
      ),
    )
    .limit(1)
  return row === undefined ? null : toAllocation(row)
}

export async function insertFundDonation(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    fundId: string
    amountCents: number
    donatedOn: string
    channel: ScholarshipFundChannel
    note: string | null
    recordedByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...donation } = input
  await tx
    .insert(scholarshipFundDonations)
    .values({ institutionId, ...donation, createdAt: now, updatedAt: now })
}

export async function insertFundAllocation(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    fundId: string
    awardId: string
    studentId: string
    academicYear: number
    amountCents: number
    allocatedOn: string
    allocatedByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...allocation } = input
  await tx
    .insert(scholarshipFundAllocations)
    .values({ institutionId, ...allocation, createdAt: now, updatedAt: now })
}

type CancelInput = {
  id: string
  expectedVersion: number
  userId: string
  reason: string
  now: Date
}

/** Bağışı iptal eder; sürüm tutmazsa ya da zaten iptalse `false` (409). */
export async function cancelFundDonation(
  tx: Database,
  institutionId: string,
  input: CancelInput,
): Promise<boolean> {
  const rows = await tx
    .update(scholarshipFundDonations)
    .set({
      cancelledAt: input.now,
      cancelledByUserId: input.userId,
      cancelReason: input.reason,
      version: sql`${scholarshipFundDonations.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        liveDonation(institutionId),
        eq(scholarshipFundDonations.id, input.id),
        eq(scholarshipFundDonations.version, input.expectedVersion),
        isNull(scholarshipFundDonations.cancelledAt),
      ),
    )
    .returning({ id: scholarshipFundDonations.id })
  return rows.length === 1
}

/** Atamayı iptal eder; sürüm tutmazsa ya da zaten iptalse `false` (409). */
export async function cancelFundAllocation(
  tx: Database,
  institutionId: string,
  input: CancelInput,
): Promise<boolean> {
  const rows = await tx
    .update(scholarshipFundAllocations)
    .set({
      cancelledAt: input.now,
      cancelledByUserId: input.userId,
      cancelReason: input.reason,
      version: sql`${scholarshipFundAllocations.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        liveAllocation(institutionId),
        eq(scholarshipFundAllocations.id, input.id),
        eq(scholarshipFundAllocations.version, input.expectedVersion),
        isNull(scholarshipFundAllocations.cancelledAt),
      ),
    )
    .returning({ id: scholarshipFundAllocations.id })
  return rows.length === 1
}
