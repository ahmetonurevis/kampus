import { z } from 'zod'

import { DomainError } from './errors.ts'
import { BUDGET_AMOUNT_MAX_CENTS } from './finance-budget.ts'

/**
 * Satın alma talebinin kademeli onayı (docs/domain/finans.md DOM-FIN-071; ON-223, K-260…K-263).
 * Kurum, talebin KDV dahil tahmini toplamına göre kademe eşikleri tanımlar: her kademenin bir alt
 * sınırı ve onaylayanı (herhangi bir yönetici ya da adlandırılmış yönetici üyesi) vardır. Talep
 * gönderilince tutarın eriştiği kademeler talebe dondurulur; sonradan eşik değişirse açık talep
 * etkilenmez. Kademeler sırayla onaylanır; talep eden hiçbir kademeyi onaylayamaz, aynı kişi iki
 * kademeyi onaylayamaz, herhangi bir kademedeki ret talebi reddeder. Ayar boşsa bugünkü tek adımlı
 * yönetici onayı (K-129) sürer. İş akışı motoru (K27) gelince adım oraya taşınır. Fonksiyonlar
 * saftır; servis ayarı ve dondurulmuş kademeleri yükler, karar burada verilir.
 */

/** En çok kademe sayısı: "tek / iki / üç onay" örneğinin üstünde pay bırakır (K-260). */
export const PURCHASE_APPROVAL_TIERS_MAX = 5
/**
 * Kademe onaylayanı olabilen rol: yalnız yönetici. Ön büro talep açar ama onaylamaz (K-128, K-129);
 * muhasebe kaydı yapan rol onaylamaz (DOM-FIN-052, DOM-FIN-057). Adlandırılmış üye de yöneticidir.
 */
export const PURCHASE_APPROVER_ROLES = ['yonetici'] as const
export type PurchaseApproverRole = (typeof PURCHASE_APPROVER_ROLES)[number]
export const PURCHASE_APPROVER_ROLE_LABELS = {
  yonetici: 'Herhangi bir yönetici',
} as const satisfies Record<PurchaseApproverRole, string>

export const PURCHASE_APPROVAL_DECISIONS = ['approved', 'rejected'] as const
export type PurchaseApprovalDecision = (typeof PURCHASE_APPROVAL_DECISIONS)[number]
export const PURCHASE_APPROVAL_NOTE_MAX = 500

// --- Ayar şeması ---------------------------------------------------------------------------------

export const purchaseApprovalTierSchema = z
  .strictObject({
    /** Kademenin alt sınırı: talebin KDV dahil tahmini toplamı bu tutara eşit ya da büyükse gerekir. */
    minTotalCents: z
      .number('Alt sınırı girin.')
      .int('Tutar kuruş cinsinden tam sayı olmalıdır.')
      .min(0, 'Alt sınır eksi olamaz.')
      .max(BUDGET_AMOUNT_MAX_CENTS, 'Alt sınır çok büyük.'),
    approverRole: z
      .enum(PURCHASE_APPROVER_ROLES, 'Onaylayan rol geçersiz.')
      .nullable()
      .default(null),
    approverUserId: z
      .string('Onaylayan kişi geçersiz.')
      .trim()
      .min(1, 'Onaylayan kişiyi seçin.')
      .max(200, 'Onaylayan kişi geçersiz.')
      .nullable()
      .default(null),
  })
  .superRefine((tier, context) => {
    if ((tier.approverRole === null) === (tier.approverUserId === null))
      context.addIssue({
        code: 'custom',
        path: ['approverUserId'],
        message: 'Kademenin onaylayanını seçin: herhangi bir yönetici ya da adlandırılmış kişi.',
      })
  })
export type PurchaseApprovalTierInput = z.input<typeof purchaseApprovalTierSchema>
export type PurchaseApprovalTier = z.output<typeof purchaseApprovalTierSchema>

/**
 * Kademe eşikleri (K-260): boş liste kademeli onayı kapatır (tek adımlı yönetici onayı). İlk
 * kademe 0'dan başlar (her talep en az bir onay ister), alt sınırlar kesin artandır, aynı kişi iki
 * kademede adlandırılamaz (iki kademeyi onaylayamayacağı için zincir tıkanırdı).
 */
export const purchaseApprovalSettingsSchema = z.strictObject({
  tiers: z
    .array(purchaseApprovalTierSchema, 'Kademeleri girin.')
    .max(
      PURCHASE_APPROVAL_TIERS_MAX,
      `En fazla ${String(PURCHASE_APPROVAL_TIERS_MAX)} kademe tanımlanabilir.`,
    )
    .superRefine((tiers, context) => {
      const first = tiers[0]
      if (first !== undefined && first.minTotalCents !== 0)
        context.addIssue({
          code: 'custom',
          path: [0, 'minTotalCents'],
          message: 'İlk kademe 0 ₺ alt sınırla başlar; her talep en az bir onay ister.',
        })
      for (let index = 1; index < tiers.length; index += 1) {
        const previous = tiers[index - 1]
        const current = tiers[index]
        if (previous && current && current.minTotalCents <= previous.minTotalCents)
          context.addIssue({
            code: 'custom',
            path: [index, 'minTotalCents'],
            message: 'Alt sınır önceki kademeninkinden büyük olmalıdır.',
          })
      }
      const seen = new Set<string>()
      for (const [index, tier] of tiers.entries()) {
        if (tier.approverUserId === null) continue
        if (seen.has(tier.approverUserId))
          context.addIssue({
            code: 'custom',
            path: [index, 'approverUserId'],
            message: 'Aynı kişi iki kademede onaylayan olamaz.',
          })
        seen.add(tier.approverUserId)
      }
    }),
})
export type PurchaseApprovalSettingsInput = z.input<typeof purchaseApprovalSettingsSchema>
export type PurchaseApprovalSettings = z.output<typeof purchaseApprovalSettingsSchema>

/** Adlandırılmış onaylayan adayının kurumdaki üyeliği; kurumda yoksa haritada yoktur. */
export interface PurchaseApproverMember {
  role: string
  active: boolean
}

const ruleError = (code: string, message: string, path?: (string | number)[]) =>
  new DomainError(code, message, {
    kind: 'rule',
    ...(path === undefined ? {} : { path: path.map(String) }),
  })

/**
 * Ayarın kaydı (K-260): şema ve adlandırılmış kişilerin kurumun etkin yöneticisi olması. Bilinmeyen,
 * başka kurumun, pasif ya da yönetici olmayan kişi aynı yanıtı alır (sızıntı yok).
 */
export function planPurchaseApprovalSettings(
  input: unknown,
  members: ReadonlyMap<string, PurchaseApproverMember>,
): PurchaseApprovalSettings {
  const data = purchaseApprovalSettingsSchema.parse(input)
  for (const [index, tier] of data.tiers.entries()) {
    if (tier.approverUserId === null) continue
    const member = members.get(tier.approverUserId)
    if (member === undefined || !member.active || member.role !== 'yonetici')
      throw ruleError(
        'purchase_approval_approver_invalid',
        `${String(index + 1)}. kademenin onaylayanı kurumun etkin bir yöneticisi olmalıdır.`,
        ['tiers', index, 'approverUserId'],
      )
  }
  return data
}

// --- Kademe hesabı -------------------------------------------------------------------------------

/** Talebe dondurulan kademe (K-261); sıra 1'den başlar. */
export interface PurchaseApprovalStepPlan {
  position: number
  minTotalCents: number
  approverRole: PurchaseApproverRole | null
  approverUserId: string | null
}

/**
 * Talebin tutarına göre gereken kademeler (K-260): alt sınırı toplamdan büyük olmayan bütün
 * kademeler sırayla. Ayar boşsa boş liste: talep tek adımlı yönetici onayıyla ilerler (K-129).
 */
export function requiredApprovalSteps(
  tiers: readonly PurchaseApprovalTier[],
  totalCents: number,
): PurchaseApprovalStepPlan[] {
  return [...tiers]
    .sort((a, b) => a.minTotalCents - b.minTotalCents)
    .filter((tier) => totalCents >= tier.minTotalCents)
    .map((tier, index) => ({
      position: index + 1,
      minTotalCents: tier.minTotalCents,
      approverRole: tier.approverRole,
      approverUserId: tier.approverUserId,
    }))
}

/** Dondurulmuş kademenin kararıyla birlikte durumu. */
export interface PurchaseApprovalStepState extends PurchaseApprovalStepPlan {
  decision: PurchaseApprovalDecision | null
  decidedByUserId: string | null
}

export interface PurchaseApprovalActor {
  userId: string
  role: string
}

/** Sıradaki (kararı verilmemiş en küçük sıralı) kademe; hepsi kararlıysa ya da kademe yoksa `null`. */
export function currentApprovalStep<T extends PurchaseApprovalStepState>(
  steps: readonly T[],
): T | null {
  if (steps.some((step) => step.decision === 'rejected')) return null
  return (
    [...steps].sort((a, b) => a.position - b.position).find((step) => step.decision === null) ??
    null
  )
}

/** Kademenin onaylayanı bu kişi mi: adlandırılmışsa kişi, değilse rol eşleşir. */
export function isStepApprover(
  step: Pick<PurchaseApprovalStepPlan, 'approverRole' | 'approverUserId'>,
  actor: PurchaseApprovalActor,
): boolean {
  return step.approverUserId === null
    ? step.approverRole === actor.role
    : step.approverUserId === actor.userId
}

type TurnRefusal = 'no_step' | 'requester' | 'same_approver' | 'reserved' | 'not_approver'

/** Kişinin sıradaki kademede karar verememe nedeni; verebiliyorsa `null`. */
function turnRefusal(
  steps: readonly PurchaseApprovalStepState[],
  requestedByUserId: string,
  actor: PurchaseApprovalActor,
): TurnRefusal | null {
  const step = currentApprovalStep(steps)
  if (step === null) return 'no_step'
  if (actor.userId === requestedByUserId) return 'requester'
  if (steps.some((other) => other.decidedByUserId === actor.userId)) return 'same_approver'
  // Sonraki bir kademede adlandırılan kişi önceki rol kademesini onaylarsa kendi kademesini
  // onaylayamaz ve zincir tıkanır; rol kademesi ona açılmaz.
  if (
    step.approverUserId === null &&
    steps.some(
      (other) =>
        other.position > step.position &&
        other.decision === null &&
        other.approverUserId === actor.userId,
    )
  )
    return 'reserved'
  return isStepApprover(step, actor) ? null : 'not_approver'
}

/**
 * Sıradaki kademede onay ya da ret hakkı (K-262). Talep eden kendi talebinde karar veremez; bir
 * kademeyi onaylayan sonrakini onaylayamaz; kademe adlandırılmışsa yalnız o kişi, değilse o roldeki
 * herkes karar verir, ancak sonraki bir kademede adlandırılmış kişi önceki rol kademesine karar
 * veremez (kendi kademesi için ayrılır). Ret de aynı hakkı ister: sırası gelmemiş onaylayan talebi erken reddedemez.
 */
export function assertApprovalTurn(
  steps: readonly PurchaseApprovalStepState[],
  requestedByUserId: string,
  actor: PurchaseApprovalActor,
): PurchaseApprovalStepState {
  const step = currentApprovalStep(steps)
  const refusal = turnRefusal(steps, requestedByUserId, actor)
  if (step === null || refusal === 'no_step')
    throw ruleError('purchase_approval_no_pending_step', 'Talepte onay bekleyen kademe yok.')
  if (refusal === null) return step
  switch (refusal) {
    case 'requester':
      throw new DomainError(
        'purchase_approval_requester',
        'Kendi açtığınız talebe onay ya da ret veremezsiniz; kademeli onayda karar başka yöneticidedir.',
        { kind: 'forbidden' },
      )
    case 'same_approver':
      throw new DomainError(
        'purchase_approval_same_approver',
        'Bu talebin bir kademesini zaten onayladınız; sonraki kademeye başka biri karar verir.',
        { kind: 'forbidden' },
      )
    case 'reserved':
      throw new DomainError(
        'purchase_approval_reserved',
        `Bu talepte sonraki bir kademenin onaylayanı sizsiniz; ${String(step.position)}. kademeye başka bir yönetici karar verir.`,
        { kind: 'forbidden' },
      )
    case 'not_approver':
      throw new DomainError(
        'purchase_approval_not_your_turn',
        `Talebin ${String(step.position)}. kademesine karar vermek size atanmadı.`,
        { kind: 'forbidden' },
      )
    default:
      return refusal satisfies never
  }
}

/** Kişi sıradaki kademede karar verebilir mi (ekran düğmesi ve "Onayımı bekleyenler"). */
export function canDecideApprovalStep(
  steps: readonly PurchaseApprovalStepState[],
  requestedByUserId: string,
  actor: PurchaseApprovalActor,
): boolean {
  return turnRefusal(steps, requestedByUserId, actor) === null
}

export interface PurchaseApprovalOutcome {
  /** Kararın yazılacağı kademe. */
  position: number
  decision: PurchaseApprovalDecision
  /** Talep bu kararla kapanıyor mu: son kademenin onayı ya da herhangi bir kademenin reddi. */
  completes: boolean
}

/**
 * Kademe kararı (K-262): onay sıradaki kademeyi kapatır; son kademeyse talep onaylanır. Ret talebi
 * reddeder, sonraki kademeler karar almaz. Kademe yoksa (`steps` boş) `null`: tek adımlı onay (K-129).
 */
export function planApprovalDecision(
  steps: readonly PurchaseApprovalStepState[],
  requestedByUserId: string,
  actor: PurchaseApprovalActor,
  decision: PurchaseApprovalDecision,
): PurchaseApprovalOutcome | null {
  if (steps.length === 0) return null
  const step = assertApprovalTurn(steps, requestedByUserId, actor)
  const remaining = steps.filter(
    (other) => other.decision === null && other.position !== step.position,
  )
  return {
    position: step.position,
    decision,
    completes: decision === 'rejected' || remaining.length === 0,
  }
}
