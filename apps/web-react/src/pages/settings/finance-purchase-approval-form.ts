// Satın alma onay kademeleri formu (DOM-FIN-071; ON-223, K-260). Alt sınır formda `1.234,56`
// metnidir, gövdede kuruş; onaylayan seçimi tek alandır: `role:yonetici` ya da `user:<kimlik>`.
// Sıra ve kişi kuralları core şemasındadır; form gövdeyi kurup aynı şemayla denetler.
import { z } from 'zod'
import type {
  PurchaseApprovalSettingsBody,
  PurchaseApprovalSettingsView,
} from '@kampus/react-shared/use-finance-procurement.ts'
import { BUDGET_AMOUNT_MAX_CENTS } from '@kampus/school-core/lib/finance-budget.ts'
import {
  PURCHASE_APPROVAL_TIERS_MAX,
  purchaseApprovalSettingsSchema,
} from '@kampus/school-core/lib/finance-purchase-approvals.ts'
import { amountInputValue, parseAmountInput } from '@kampus/school-core/lib/payments.ts'

export const ANY_MANAGER = 'role:yonetici'
const USER_PREFIX = 'user:'

export type ApprovalTierRow = { minTotal: string; approver: string }
export type ApprovalFormValues = { tiers: ApprovalTierRow[] }

export const approverValue = (tier: { approverUserId: string | null }) =>
  tier.approverUserId === null ? ANY_MANAGER : `${USER_PREFIX}${tier.approverUserId}`

/** Kayıtlı ayardan form değerleri; ilk kademenin alt sınırı 0'dır. */
export function approvalFormDefaults(
  settings: PurchaseApprovalSettingsView | undefined,
): ApprovalFormValues {
  return {
    tiers: (settings?.tiers ?? []).map((tier) => ({
      minTotal: amountInputValue(tier.minTotalCents),
      approver: approverValue(tier),
    })),
  }
}

/** Yeni satır: ilk kademe 0'dan, sonrakiler boş alt sınırla, herhangi bir yönetici. */
export function newTierRow(index: number): ApprovalTierRow {
  return { minTotal: index === 0 ? '0' : '', approver: ANY_MANAGER }
}

/** Form satırını gövde kademesine çevirir; tutar okunamazsa `null` (alan hatası). */
function tierBody(row: ApprovalTierRow) {
  const cents = parseAmountInput(row.minTotal, {
    allowZero: true,
    maxCents: BUDGET_AMOUNT_MAX_CENTS,
  })
  const approver = row.approver.startsWith(USER_PREFIX)
    ? { approverRole: null, approverUserId: row.approver.slice(USER_PREFIX.length) }
    : { approverRole: 'yonetici' as const, approverUserId: null }
  return { minTotalCents: cents, ...approver }
}

/**
 * Form şeması: tutarlar okunur, gövde core şemasıyla denetlenir; core'un sıra ve kişi hataları
 * ilgili satırın alanına (`tiers.<n>.minTotal` / `tiers.<n>.approver`) taşınır.
 */
export const approvalFormSchema = z
  .object({
    tiers: z
      .array(z.object({ minTotal: z.string(), approver: z.string().min(1, 'Onaylayanı seçin.') }))
      .max(
        PURCHASE_APPROVAL_TIERS_MAX,
        `En fazla ${String(PURCHASE_APPROVAL_TIERS_MAX)} kademe tanımlanabilir.`,
      ),
  })
  .superRefine((values, context) => {
    const tiers = values.tiers.map(tierBody)
    let unreadable = false
    for (const [index, tier] of tiers.entries())
      if (tier.minTotalCents === null) {
        unreadable = true
        context.addIssue({
          code: 'custom',
          path: ['tiers', index, 'minTotal'],
          message: 'Alt sınırı 1.234,56 biçiminde girin.',
        })
      }
    if (unreadable) return
    const parsed = purchaseApprovalSettingsSchema.safeParse({ tiers })
    if (parsed.success) return
    for (const issue of parsed.error.issues) {
      const [, index, field] = issue.path
      context.addIssue({
        code: 'custom',
        path: [
          'tiers',
          typeof index === 'number' ? index : 0,
          field === 'minTotalCents' ? 'minTotal' : 'approver',
        ],
        message: issue.message,
      })
    }
  })

/** Denetlenmiş form değerlerinden istek gövdesi. */
export function approvalSettingsBody(values: ApprovalFormValues): PurchaseApprovalSettingsBody {
  return {
    tiers: values.tiers.map((row) => {
      const tier = tierBody(row)
      return { ...tier, minTotalCents: tier.minTotalCents ?? 0 }
    }),
  }
}

/** Sunucu alan yolunu (`tiers.<n>.approverUserId`) form alanına çevirir. */
export function approvalFormField(
  name: string,
): `tiers.${number}.minTotal` | `tiers.${number}.approver` | null {
  const match = /^tiers\.(\d+)\.(minTotalCents|approverUserId|approverRole)$/.exec(name)
  if (!match) return null
  const index = Number(match[1])
  return match[2] === 'minTotalCents' ? `tiers.${index}.minTotal` : `tiers.${index}.approver`
}
