import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import {
  isFirstInstallmentPaid,
  referralCancelReason,
  type ReferralRewardDraft,
  type ReferralRewardStatus,
} from '@kampus/school-core/lib/finance-referrals.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { financeStudentIds } from '@kampus/school-core/lib/scope.ts'

import type { Database } from '../db/client.ts'
import { loadFinanceRecords } from '../db/finance-mirror-store.ts'
import {
  cancelReferralReward,
  findReferralRewardOfReferred,
  insertReferralReward,
  listReferralRewards,
  markReferralRewardEarned,
  markReferralRewardPending,
  markReferralRewardUsed,
  releaseReferralRewards,
  type StoredReferralReward,
} from '../db/finance-referrals.ts'
import { loadRecordsByIds } from '../db/records.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { notify } from './notify.ts'
import { readScope } from './read-scope.ts'
import { auditWork } from './task-work.ts'

/**
 * Referans indirimi hakkı servisi (docs/domain/finans.md DOM-FIN-024; ON-139). Kural core
 * `lib/finance-referrals.ts`'tedir. Hak yazımları çağıranın işlemindedir (kesin kayıt, yenileme,
 * tahsilat, tahsilat iptali, ayrılış); ayrı komut ucu yoktur. Denetime yalnız alan adları düşer,
 * bildirim yalnız hak kimliğini taşır.
 */

const ENTITY = 'referral_rewards'
const STAFF_ROLES: ReadonlySet<string> = new Set(['yonetici', 'onburo'])
/** Bekleyen hak ailenin görmemesi gereken bilgidir: başka ailenin kesin kaydını ve ödemesini açar. */
const FAMILY_STATUSES: readonly ReferralRewardStatus[] = ['available', 'used', 'cancelled']

const entityOf = (id: string) => ({ type: ENTITY, id })

/** Kesin kaydın referans yazımları: kullanılan hak işaretlenir, yeni hak açılır (DOM-FIN-024). */
export async function settleEnrollmentReferral(
  tx: Database,
  ctx: ServiceContext,
  result: {
    student: { id: string }
    contract: { id: string }
    referralUse: { rewardId: string; amountCents: number } | null
    referralDraft: ReferralRewardDraft | null
  },
): Promise<void> {
  if (result.referralUse !== null)
    await useReferralReward(tx, ctx, {
      ...result.referralUse,
      contractId: result.contract.id,
      studentId: result.student.id,
    })
  if (result.referralDraft === null) return
  const id = randomUUID()
  await insertReferralReward(tx, ctx.institutionId, { ...result.referralDraft, id, now: ctx.now })
  await auditWork(tx, ctx, 'referral.create', entityOf(id), Object.keys(result.referralDraft))
}

/** Hakkı kullanıldı işaretler; yalnız `available` satır değişir, yarışı kaybeden 409 alır. */
export async function useReferralReward(
  tx: Database,
  ctx: ServiceContext,
  input: { rewardId: string; amountCents: number; contractId: string; studentId: string },
): Promise<void> {
  const saved = await markReferralRewardUsed(tx, ctx.institutionId, {
    id: input.rewardId,
    contractId: input.contractId,
    studentId: input.studentId,
    amountCents: input.amountCents,
    userId: ctx.actor.userId,
    now: ctx.now,
  })
  if (!saved)
    throw new DomainError('referral_reward_used', 'Bu referans hakkı daha önce kullanılmış.', {
      kind: 'conflict',
      path: ['referralRewardId'],
    })
  await auditWork(tx, ctx, 'referral.use', entityOf(input.rewardId), [
    'status',
    'usedAt',
    'usedContractId',
    'usedStudentId',
    'usedAmountCents',
  ])
}

const installmentSchema = z.object({
  installment: z.number(),
  paidAt: z.string().nullable().optional(),
  academicYear: z.number().optional(),
})

async function firstInstallmentPaid(
  tx: Database,
  ctx: ServiceContext,
  studentId: string,
  academicYear: number,
): Promise<boolean> {
  const rows = await loadFinanceRecords(tx, ctx.institutionId, 'invoices', {
    match: [{ kind: 'equals', field: 'studentId', values: [studentId] }],
  })
  return isFirstInstallmentPaid(
    rows.map((row) => installmentSchema.parse(row.data)),
    academicYear,
  )
}

/**
 * Tahsilattan sonra çağrılır: referansla gelen öğrencinin ilk taksiti ödendiyse hak doğar ve referans
 * sahibine bildirim gider. Öğrencinin bekleyen hakkı yoksa taksit okunmaz. Bildirim kitlesi referans
 * verenin öğrencisidir; aday ve tutar taşımaz (KVKK).
 */
export async function earnReferralRewardOnPayment(
  tx: Database,
  ctx: ServiceContext,
  studentId: string,
): Promise<void> {
  const reward = await findReferralRewardOfReferred(tx, ctx.institutionId, studentId)
  if (reward?.status !== 'pending') return
  if (!(await firstInstallmentPaid(tx, ctx, studentId, reward.academicYear))) return
  if (!(await markReferralRewardEarned(tx, ctx.institutionId, reward.id, ctx.now))) return
  await auditWork(tx, ctx, 'referral.earn', entityOf(reward.id), ['status', 'earnedAt'])
  await notify(tx, ctx, {
    type: 'referral_reward_earned',
    recipients: { studentIds: [reward.referrerStudentId] },
    data: { rewardId: reward.id },
    dedupeKey: reward.id,
  })
}

/**
 * Hakkı doğuran tahsilat iptal edildiyse kullanılmamış hak yeniden bekler. Kullanılmış hak geri
 * istenmez (DOM-FIN-024). Yeniden ödemede bildirim ikinci kez yazılmaz (`dedupeKey`).
 */
export async function revertReferralRewardOnReversal(
  tx: Database,
  ctx: ServiceContext,
  studentId: string,
): Promise<void> {
  const reward = await findReferralRewardOfReferred(tx, ctx.institutionId, studentId)
  if (reward?.status !== 'available') return
  if (await firstInstallmentPaid(tx, ctx, studentId, reward.academicYear)) return
  if (await markReferralRewardPending(tx, ctx.institutionId, reward.id, ctx.now))
    await auditWork(tx, ctx, 'referral.revert', entityOf(reward.id), ['status', 'earnedAt'])
}

/**
 * Ayrılışın hakka etkisi (DOM-FIN-024, DOM-FIN-040): ayrılan öğrenci referansla geldiyse kullanılmamış
 * hak koşula göre iptal olur; kullanılmış hak geri istenmez. Ayrılışla iptal edilen planlanmış
 * yenilemede kullanılan hak ise sahibine döner, çünkü o sözleşme yürürlüğe girmez.
 */
export async function applyWithdrawalToReferralRewards(
  tx: Database,
  ctx: ServiceContext,
  plan: {
    studentId: string
    breakdown: { started: boolean; refundCents: number }
    cancelledContractIds: readonly string[]
  },
): Promise<void> {
  const released = await releaseReferralRewards(
    tx,
    ctx.institutionId,
    plan.cancelledContractIds,
    ctx.now,
  )
  for (const id of released)
    await auditWork(tx, ctx, 'referral.release', entityOf(id), [
      'status',
      'usedAt',
      'usedContractId',
      'usedStudentId',
      'usedAmountCents',
    ])
  const reward = await findReferralRewardOfReferred(tx, ctx.institutionId, plan.studentId)
  if (reward === null) return
  const reason = referralCancelReason(reward.status, plan.breakdown)
  if (reason === null) return
  const saved = await cancelReferralReward(tx, ctx.institutionId, {
    id: reward.id,
    from: reward.status,
    reason,
    now: ctx.now,
  })
  if (saved)
    await auditWork(tx, ctx, 'referral.cancel', entityOf(reward.id), [
      'status',
      'cancelReason',
      'cancelledAt',
    ])
}

// --- Okuma --------------------------------------------------------------------------------------

export interface ReferralRewardView {
  id: string
  academicYear: number
  status: ReferralRewardStatus
  referrerStudentId: string
  referrerStudentName: string | null
  /** Kesin kayıtta sabitlenen hak değeri, kuruş; uygulanan tutar `usedAmountCents`. */
  amountCents: number
  earnedAt: string | null
  usedAt: string | null
  usedAmountCents: number | null
  cancelledAt: string | null
  /** Aday, referansla gelen öğrenci ve iptal gerekçesi personel içindir; aileye `null` gider. */
  prospectId: string | null
  referredStudentId: string | null
  referredStudentName: string | null
  referrerParentId: string | null
  cancelReason: StoredReferralReward['cancelReason']
}

const nameOf = (row: { data: Record<string, unknown> }) =>
  typeof row.data.name === 'string' ? row.data.name : null

async function studentParentId(ctx: ServiceContext, studentId: string): Promise<string | null> {
  const [row] = await loadRecordsByIds(ctx.db, ctx.institutionId, 'students', [studentId])
  return typeof row?.data.parentId === 'string' && row.data.parentId !== ''
    ? row.data.parentId
    : null
}

/**
 * Personel kurumun hakkını, veli ve öğrenci yalnız finans kapsamındaki referans veren öğrencinin
 * hakkını görür (DOM-FIN-052). Ailenin yanıtında aday, referansla gelen öğrenci ve iptal gerekçesi
 * yoktur; bekleyen hak da listelenmez: başka ailenin verisi veliye gösterilmez (KVKK md. 4).
 * `familyOfStudentId` yenileme formunun süzgecidir: o öğrencinin velisinin hakları.
 */
export async function listReferralRewardsFor(
  ctx: ServiceContext,
  query: {
    status?: ReferralRewardStatus | undefined
    parentId?: string | undefined
    familyOfStudentId?: string | undefined
    page: number
    pageSize: number
  },
): Promise<{ items: ReferralRewardView[]; total: number }> {
  const staff = STAFF_ROLES.has(ctx.actor.role)
  const scoped = staff ? null : [...financeStudentIds(await readScope(ctx))]
  if (scoped !== null && scoped.length === 0) return { items: [], total: 0 }
  let parentId = query.parentId
  if (query.familyOfStudentId !== undefined) {
    const family = await studentParentId(ctx, query.familyOfStudentId)
    if (family === null || (parentId !== undefined && parentId !== family))
      return { items: [], total: 0 }
    parentId = family
  }
  const { items, total } = await listReferralRewards(ctx.db, ctx.institutionId, {
    status: query.status,
    ...(staff ? {} : { statuses: FAMILY_STATUSES }),
    parentId,
    referrerStudentIds: scoped,
    page: query.page,
    pageSize: query.pageSize,
  })
  const names = await loadRecordsByIds(ctx.db, ctx.institutionId, 'students', [
    ...new Set(
      items.flatMap((item) =>
        staff ? [item.referrerStudentId, item.referredStudentId] : [item.referrerStudentId],
      ),
    ),
  ])
  const nameById = new Map(names.map((row) => [row.id, nameOf(row)]))
  return {
    items: items.map((item) => ({
      id: item.id,
      academicYear: item.academicYear,
      status: item.status,
      referrerStudentId: item.referrerStudentId,
      referrerStudentName: nameById.get(item.referrerStudentId) ?? null,
      amountCents: item.amountCents,
      earnedAt: item.earnedAt?.toISOString() ?? null,
      usedAt: item.usedAt?.toISOString() ?? null,
      usedAmountCents: item.usedAmountCents,
      cancelledAt: item.cancelledAt?.toISOString() ?? null,
      prospectId: staff ? item.prospectId : null,
      referredStudentId: staff ? item.referredStudentId : null,
      referredStudentName: staff ? (nameById.get(item.referredStudentId) ?? null) : null,
      referrerParentId: staff ? item.referrerParentId : null,
      cancelReason: staff ? item.cancelReason : null,
    })),
    total,
  }
}
