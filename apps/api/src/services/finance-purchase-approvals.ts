import { planPurchaseApprovalSettings } from '@kampus/school-core/lib/finance-purchase-approvals.ts'

import type { Database } from '../db/client.ts'
import {
  listApproverCandidates,
  loadApproverMembers,
  loadPurchaseApprovalSettings,
  savePurchaseApprovalSettings,
} from '../db/finance-purchase-approvals.ts'
import { purchaseActorNames } from '../db/finance-purchase-requests.ts'
import { ConflictError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Satın alma talebinin kademeli onay ayarı (DOM-FIN-071; ON-223, K-260). Kural core
 * `lib/finance-purchase-approvals.ts`'tedir; servis kurum kilidi altında ayarı ve adlandırılmış
 * onaylayanların üyeliğini yükler, core'a karar verdirir, kademe listesini bütün olarak yazar ve
 * denetim kaydı bırakır. Ayar açık talepleri değiştirmez: kademeler gönderimde dondurulur (K-261).
 */

const ENTITY_TYPE = 'purchase_approval_settings'

async function settingsView(db: Database, ctx: ServiceContext) {
  const [settings, candidates] = await Promise.all([
    loadPurchaseApprovalSettings(db, ctx.institutionId),
    listApproverCandidates(db, ctx.institutionId),
  ])
  // Ayrılmış ya da yöneticiliği düşmüş adlandırılmış kişi de adıyla görünür; formda uyarı alır.
  const names = await purchaseActorNames(
    db,
    ctx.institutionId,
    settings.tiers.flatMap((tier) => (tier.approverUserId === null ? [] : [tier.approverUserId])),
  )
  const eligible = new Set(candidates.map((candidate) => candidate.userId))
  return {
    tiers: settings.tiers.map((tier, index) => ({
      position: index + 1,
      ...tier,
      approverName: tier.approverUserId === null ? null : (names.get(tier.approverUserId) ?? null),
      approverEligible: tier.approverUserId === null || eligible.has(tier.approverUserId),
    })),
    approvers: candidates,
    version: settings.version,
  }
}

export const getPurchaseApprovalSettingsFor = (ctx: ServiceContext) => settingsView(ctx.db, ctx)

/** Kademe listesini bütün olarak yazar; boş liste kademeli onayı kapatır (K-129). */
export function setPurchaseApprovalSettingsCommand(
  ctx: ServiceContext,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY_TYPE, id: ctx.institutionId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'purchase_approval.settings',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await loadPurchaseApprovalSettings(tx, ctx.institutionId)
        if (current.version !== expectedVersion) throw new ConflictError()
        const raw = (input ?? {}) as { tiers?: unknown }
        const userIds = Array.isArray(raw.tiers)
          ? raw.tiers.flatMap((tier: unknown) => {
              const value = (tier ?? {}) as Record<string, unknown>
              return typeof value.approverUserId === 'string' ? [value.approverUserId.trim()] : []
            })
          : []
        const members = await loadApproverMembers(tx, ctx.institutionId, userIds)
        return { run: () => planPurchaseApprovalSettings(input, members) }
      },
      after: async (tx, settings) => {
        const saved = await savePurchaseApprovalSettings(tx, ctx.institutionId, {
          tiers: settings.tiers,
          expectedVersion,
          now: ctx.now,
        })
        if (saved === null) throw new ConflictError()
        await auditWork(tx, ctx, 'purchase_approval.settings', entity, ['tiers'])
        body = { data: await settingsView(tx, ctx) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
