import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import type {
  ReferralCancelReason,
  ReferralRewardDraft,
  ReferralRewardStatus,
} from '@kampus/school-core/lib/finance-referrals.ts'

import type { Database } from './client.ts'
import { referralRewards } from './schema/finance-referrals.ts'

/** Referans hakkı deposu (DOM-FIN-024); her sorgu kurum kapsamlıdır. */

const COLUMNS = {
  id: referralRewards.id,
  prospectId: referralRewards.prospectId,
  referrerStudentId: referralRewards.referrerStudentId,
  referrerParentId: referralRewards.referrerParentId,
  referredStudentId: referralRewards.referredStudentId,
  academicYear: referralRewards.academicYear,
  amountCents: referralRewards.amountCents,
  status: referralRewards.status,
  earnedAt: referralRewards.earnedAt,
  usedAt: referralRewards.usedAt,
  usedContractId: referralRewards.usedContractId,
  usedAmountCents: referralRewards.usedAmountCents,
  cancelledAt: referralRewards.cancelledAt,
  cancelReason: referralRewards.cancelReason,
}

export type StoredReferralReward = {
  id: string
  prospectId: string
  referrerStudentId: string
  referrerParentId: string
  referredStudentId: string
  academicYear: number
  amountCents: number
  status: ReferralRewardStatus
  earnedAt: Date | null
  usedAt: Date | null
  usedContractId: string | null
  usedAmountCents: number | null
  cancelledAt: Date | null
  cancelReason: ReferralCancelReason | null
}

const active = (institutionId: string) =>
  and(eq(referralRewards.institutionId, institutionId), isNull(referralRewards.archivedAt))

export async function insertReferralReward(
  tx: Database,
  institutionId: string,
  input: ReferralRewardDraft & { id: string; now: Date },
): Promise<void> {
  const { now, ...reward } = input
  await tx
    .insert(referralRewards)
    .values({ institutionId, ...reward, status: 'pending', createdAt: now, updatedAt: now })
}

export async function findReferralReward(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredReferralReward | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(referralRewards)
    .where(and(active(institutionId), eq(referralRewards.id, id)))
    .limit(1)
  return row ?? null
}

/** Öğrencinin referansla geldiği hak; bir aday tek referansa bağlıdır, öğrenci en çok bir satırdır. */
export async function findReferralRewardOfReferred(
  db: Database,
  institutionId: string,
  referredStudentId: string,
): Promise<StoredReferralReward | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(referralRewards)
    .where(and(active(institutionId), eq(referralRewards.referredStudentId, referredStudentId)))
    .limit(1)
  return row ?? null
}

/** Durum geçişi: yalnız beklenen durumdaki satır değişir; değişmediyse `false`. */
async function transition(
  tx: Database,
  institutionId: string,
  id: string,
  from: ReferralRewardStatus,
  changes: Partial<typeof referralRewards.$inferInsert> & { updatedAt: Date },
): Promise<boolean> {
  const rows = await tx
    .update(referralRewards)
    .set({ ...changes, version: sql`${referralRewards.version} + 1` })
    .where(and(active(institutionId), eq(referralRewards.id, id), eq(referralRewards.status, from)))
    .returning({ id: referralRewards.id })
  return rows.length > 0
}

export const markReferralRewardEarned = (
  tx: Database,
  institutionId: string,
  id: string,
  now: Date,
) =>
  transition(tx, institutionId, id, 'pending', {
    status: 'available',
    earnedAt: now,
    updatedAt: now,
  })

/** Hakkı doğuran tahsilat iptal edildi: kullanılmamış hak yeniden bekler. */
export const markReferralRewardPending = (
  tx: Database,
  institutionId: string,
  id: string,
  now: Date,
) =>
  transition(tx, institutionId, id, 'available', {
    status: 'pending',
    earnedAt: null,
    updatedAt: now,
  })

export const cancelReferralReward = (
  tx: Database,
  institutionId: string,
  input: { id: string; from: ReferralRewardStatus; reason: ReferralCancelReason; now: Date },
) =>
  transition(tx, institutionId, input.id, input.from, {
    status: 'cancelled',
    cancelReason: input.reason,
    cancelledAt: input.now,
    updatedAt: input.now,
  })

/** Tek kullanım: yalnız `available` satır işaretlenir; işlemin yarışı burada düşer (DOM-FIN-024). */
export const markReferralRewardUsed = (
  tx: Database,
  institutionId: string,
  input: {
    id: string
    contractId: string
    studentId: string
    amountCents: number
    userId: string
    now: Date
  },
) =>
  transition(tx, institutionId, input.id, 'available', {
    status: 'used',
    usedAt: input.now,
    usedContractId: input.contractId,
    usedStudentId: input.studentId,
    usedAmountCents: input.amountCents,
    usedByUserId: input.userId,
    updatedAt: input.now,
  })

/**
 * Yürürlüğe girmeden iptal edilen sözleşmelerde kullanılmış hakları geri açar; açılan kimlikleri
 * döner. Sözleşmesiz çağrı sorgu atmaz.
 */
export async function releaseReferralRewards(
  tx: Database,
  institutionId: string,
  contractIds: readonly string[],
  now: Date,
): Promise<string[]> {
  if (contractIds.length === 0) return []
  const rows = await tx
    .update(referralRewards)
    .set({
      status: 'available',
      usedAt: null,
      usedContractId: null,
      usedStudentId: null,
      usedAmountCents: null,
      usedByUserId: null,
      version: sql`${referralRewards.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        active(institutionId),
        eq(referralRewards.status, 'used'),
        inArray(referralRewards.usedContractId, [...contractIds]),
      ),
    )
    .returning({ id: referralRewards.id })
  return rows.map((row) => row.id)
}

export async function listReferralRewards(
  db: Database,
  institutionId: string,
  query: {
    status?: ReferralRewardStatus | undefined
    /** Yalnız bu durumlar; aile görünümünde bekleyen hak listelenmez. */
    statuses?: readonly ReferralRewardStatus[] | undefined
    parentId?: string | undefined
    /** `null`: kapsam yok (personel). Boş dizi boş sonuç verir. */
    referrerStudentIds: readonly string[] | null
    page: number
    pageSize: number
  },
): Promise<{ items: StoredReferralReward[]; total: number }> {
  const where = and(
    active(institutionId),
    query.status === undefined ? undefined : eq(referralRewards.status, query.status),
    query.statuses === undefined ? undefined : inArray(referralRewards.status, [...query.statuses]),
    query.parentId === undefined ? undefined : eq(referralRewards.referrerParentId, query.parentId),
    query.referrerStudentIds === null
      ? undefined
      : inArray(referralRewards.referrerStudentId, [...query.referrerStudentIds]),
  )
  const [totalRow] = await db.select({ total: count() }).from(referralRewards).where(where)
  const rows = await db
    .select(COLUMNS)
    .from(referralRewards)
    .where(where)
    .orderBy(desc(referralRewards.createdAt), desc(referralRewards.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows, total: totalRow?.total ?? 0 }
}
