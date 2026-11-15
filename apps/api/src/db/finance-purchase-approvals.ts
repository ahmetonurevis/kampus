import { randomUUID } from 'node:crypto'

import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'

import type {
  PurchaseApprovalDecision,
  PurchaseApprovalStepPlan,
  PurchaseApprovalStepState,
  PurchaseApprovalTier,
  PurchaseApproverMember,
} from '@kampus/school-core/lib/finance-purchase-approvals.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import {
  purchaseApprovalSettings,
  purchaseApprovalTiers,
  purchaseRequestApprovalSteps,
} from './schema/finance-purchase-approvals.ts'
import { purchaseRequests } from './schema/finance-purchase-requests.ts'

/**
 * Kademeli onay deposu (DOM-FIN-071; ON-223, K-260…K-263). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-purchase-approvals.ts`'tedir; depo ayarı ve talebe
 * dondurulmuş kademeleri okur ve yazar.
 */

export interface StoredPurchaseApprovalSettings {
  tiers: PurchaseApprovalTier[]
  /** `If-Match` sürümü; ayar hiç kaydedilmediyse 1. */
  version: number
}

/** Etkin kademeler sırayla ve ayar sürümü; satır yoksa kademe yok, sürüm 1. */
export async function loadPurchaseApprovalSettings(
  db: Database,
  institutionId: string,
): Promise<StoredPurchaseApprovalSettings> {
  const [settings] = await db
    .select({ version: purchaseApprovalSettings.version })
    .from(purchaseApprovalSettings)
    .where(eq(purchaseApprovalSettings.institutionId, institutionId))
    .limit(1)
  const tiers = await db
    .select({
      minTotalCents: purchaseApprovalTiers.minTotalCents,
      approverRole: purchaseApprovalTiers.approverRole,
      approverUserId: purchaseApprovalTiers.approverUserId,
    })
    .from(purchaseApprovalTiers)
    .where(
      and(
        eq(purchaseApprovalTiers.institutionId, institutionId),
        isNull(purchaseApprovalTiers.archivedAt),
      ),
    )
    .orderBy(asc(purchaseApprovalTiers.position))
  return { tiers, version: settings?.version ?? 1 }
}

/**
 * Kademe listesini bütün olarak yazar: sürüm koşulu tutmazsa `null` (409). İlk kayıt ayar satırını
 * sürüm 2 ile açar; eski kademeler arşivlenir, yenileri sırayla eklenir.
 */
export async function savePurchaseApprovalSettings(
  tx: Database,
  institutionId: string,
  input: { tiers: readonly PurchaseApprovalTier[]; expectedVersion: number; now: Date },
): Promise<number | null> {
  const [updated] = await tx
    .update(purchaseApprovalSettings)
    .set({ version: sql`${purchaseApprovalSettings.version} + 1`, updatedAt: input.now })
    .where(
      and(
        eq(purchaseApprovalSettings.institutionId, institutionId),
        eq(purchaseApprovalSettings.version, input.expectedVersion),
      ),
    )
    .returning({ version: purchaseApprovalSettings.version })
  let version = updated?.version ?? null
  if (version === null && input.expectedVersion === 1) {
    const [created] = await tx
      .insert(purchaseApprovalSettings)
      .values({ institutionId, version: 2, createdAt: input.now, updatedAt: input.now })
      .onConflictDoNothing()
      .returning({ version: purchaseApprovalSettings.version })
    version = created?.version ?? null
  }
  if (version === null) return null
  await tx
    .update(purchaseApprovalTiers)
    .set({
      archivedAt: input.now,
      updatedAt: input.now,
      version: sql`${purchaseApprovalTiers.version} + 1`,
    })
    .where(
      and(
        eq(purchaseApprovalTiers.institutionId, institutionId),
        isNull(purchaseApprovalTiers.archivedAt),
      ),
    )
  if (input.tiers.length > 0)
    await tx.insert(purchaseApprovalTiers).values(
      input.tiers.map((tier, index) => ({
        ...tier,
        institutionId,
        id: randomUUID(),
        position: index + 1,
        createdAt: input.now,
        updatedAt: input.now,
      })),
    )
  return version
}

/** Adlandırılmış onaylayan adaylarının kurumdaki üyeliği; kurumda olmayan kimlik haritada yoktur. */
export async function loadApproverMembers(
  db: Database,
  institutionId: string,
  userIds: readonly string[],
): Promise<Map<string, PurchaseApproverMember>> {
  if (userIds.length === 0) return new Map()
  const rows = await db
    .select({
      userId: memberships.userId,
      role: memberships.role,
      deactivatedAt: memberships.deactivatedAt,
    })
    .from(memberships)
    .where(
      and(
        eq(memberships.institutionId, institutionId),
        inArray(memberships.userId, [...new Set(userIds)]),
      ),
    )
  return new Map(
    rows.map((row) => [row.userId, { role: row.role, active: row.deactivatedAt === null }]),
  )
}

/** Ayar formunun seçenekleri: kurumun etkin yöneticileri, ada göre. */
export async function listApproverCandidates(
  db: Database,
  institutionId: string,
): Promise<{ userId: string; name: string }[]> {
  return db
    .select({ userId: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.institutionId, institutionId),
        eq(memberships.role, 'yonetici'),
        isNull(memberships.deactivatedAt),
      ),
    )
    .orderBy(asc(users.name), asc(users.id))
}

export interface StoredApprovalStep extends PurchaseApprovalStepState {
  decidedAt: string | null
  note: string | null
}

/** Talebin etkin (arşivlenmemiş) kademeleri, sırayla. */
export async function loadApprovalSteps(
  db: Database,
  institutionId: string,
  requestId: string,
): Promise<StoredApprovalStep[]> {
  const rows = await db
    .select({
      position: purchaseRequestApprovalSteps.position,
      minTotalCents: purchaseRequestApprovalSteps.minTotalCents,
      approverRole: purchaseRequestApprovalSteps.approverRole,
      approverUserId: purchaseRequestApprovalSteps.approverUserId,
      decision: purchaseRequestApprovalSteps.decision,
      decidedByUserId: purchaseRequestApprovalSteps.decidedByUserId,
      decidedAt: purchaseRequestApprovalSteps.decidedAt,
      note: purchaseRequestApprovalSteps.note,
    })
    .from(purchaseRequestApprovalSteps)
    .where(
      and(
        eq(purchaseRequestApprovalSteps.institutionId, institutionId),
        eq(purchaseRequestApprovalSteps.requestId, requestId),
        isNull(purchaseRequestApprovalSteps.archivedAt),
      ),
    )
    .orderBy(asc(purchaseRequestApprovalSteps.position))
  return rows.map((row) => ({
    ...row,
    decidedAt: row.decidedAt === null ? null : row.decidedAt.toISOString(),
  }))
}

/** Gönderimde gereken kademeleri talebe dondurur (K-261). */
export async function insertApprovalSteps(
  tx: Database,
  institutionId: string,
  requestId: string,
  steps: readonly PurchaseApprovalStepPlan[],
  now: Date,
): Promise<void> {
  if (steps.length === 0) return
  await tx.insert(purchaseRequestApprovalSteps).values(
    steps.map((step) => ({
      ...step,
      institutionId,
      id: randomUUID(),
      requestId,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

/** Taslağa geri çekilen talebin kademelerini (kararlarıyla) arşivler (K-261). */
export async function archiveApprovalSteps(
  tx: Database,
  institutionId: string,
  requestId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(purchaseRequestApprovalSteps)
    .set({
      archivedAt: now,
      updatedAt: now,
      version: sql`${purchaseRequestApprovalSteps.version} + 1`,
    })
    .where(
      and(
        eq(purchaseRequestApprovalSteps.institutionId, institutionId),
        eq(purchaseRequestApprovalSteps.requestId, requestId),
        isNull(purchaseRequestApprovalSteps.archivedAt),
      ),
    )
}

/** Kademe kararını yazar; kademe kararsız değilse `false` (eşzamanlı karar, 409). */
export async function decideApprovalStep(
  tx: Database,
  institutionId: string,
  input: {
    requestId: string
    position: number
    decision: PurchaseApprovalDecision
    userId: string
    note: string | null
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(purchaseRequestApprovalSteps)
    .set({
      decision: input.decision,
      decidedByUserId: input.userId,
      decidedAt: input.now,
      note: input.note,
      updatedAt: input.now,
      version: sql`${purchaseRequestApprovalSteps.version} + 1`,
    })
    .where(
      and(
        eq(purchaseRequestApprovalSteps.institutionId, institutionId),
        eq(purchaseRequestApprovalSteps.requestId, input.requestId),
        eq(purchaseRequestApprovalSteps.position, input.position),
        isNull(purchaseRequestApprovalSteps.archivedAt),
        isNull(purchaseRequestApprovalSteps.decision),
      ),
    )
    .returning({ position: purchaseRequestApprovalSteps.position })
  return rows.length === 1
}

/**
 * "Onayımı bekleyenler" süzgeci (K-263): gönderilmiş taleplerden sıranın bu kişide olduğu talepler.
 * Kademeli talepte sıradaki (kararsız en küçük sıralı) kademe kişiye (adlandırılmış) ya da rolüne
 * aittir, kişi talebi açmamıştır, aynı talepte başka kademeye karar vermemiştir ve sonraki bir
 * kademede adlandırılmamıştır. Kademesiz
 * (tek adımlı) talepte her yönetici bekleyendir; kendi talebi dahil (K-129).
 */
export function awaitingApprovalFilter(actor: { userId: string; role: string }): SQL {
  const step = purchaseRequestApprovalSteps
  const activeStepOf = sql`${step.institutionId} = ${purchaseRequests.institutionId}
    and ${step.requestId} = ${purchaseRequests.id} and ${step.archivedAt} is null`
  const currentPosition = sql`(
      select min(inner_step.position) from ${step} as inner_step
      where inner_step.institution_id = ${purchaseRequests.institutionId}
        and inner_step.request_id = ${purchaseRequests.id}
        and inner_step.archived_at is null and inner_step.decision is null)`
  const tiered = sql`exists (
      select 1 from ${step}
      where ${activeStepOf} and ${step.decision} is null
        and ${step.position} = ${currentPosition}
        and (${step.approverUserId} = ${actor.userId}
          or (${step.approverUserId} is null and ${step.approverRole} = ${actor.role})))
    and not exists (
      select 1 from ${step}
      where ${activeStepOf} and ${step.decision} is null
        and ${step.approverUserId} = ${actor.userId} and ${step.position} > ${currentPosition})
    and not exists (
      select 1 from ${step}
      where ${activeStepOf} and (${step.decidedByUserId} = ${actor.userId} or ${step.decision} = 'rejected'))
    and ${purchaseRequests.requestedByUserId} <> ${actor.userId}`
  const single = sql`not exists (select 1 from ${step} where ${activeStepOf})`
  const legacy = actor.role === 'yonetici' ? sql`(${single})` : sql`false`
  return sql`(${purchaseRequests.status} = 'submitted' and ((${tiered}) or ${legacy}))`
}
