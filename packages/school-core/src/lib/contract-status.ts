/**
 * Sözleşme sürümünün durumu ve belgedeki ödeme planı (docs/domain/finans.md DOM-FIN-010, -012,
 * -051; IST-092). İşlem yoktur; işlemler `lib/contract-approval.ts`'te. Durum saklanmaz, kayıttan
 * türetilir. Ek protokol yeni kayıttır: önceki sürüm hiç değişmez, sürüm zinciri
 * `amendsContractId` ile okunur.
 */

/** İmza yetkilisi: kayıt sözleşmesini kurucu ya da kurucu temsilcisi imzalar (ÖÖKY m.31/4). */
export const SIGNATORY_ROLES = ['founder', 'founder_representative'] as const
export type SignatoryRole = (typeof SIGNATORY_ROLES)[number]
export const SIGNATORY_ROLE_LABELS: Readonly<Record<SignatoryRole, string>> = {
  founder: 'Kurucu',
  founder_representative: 'Kurucu temsilcisi',
}

/** Ödeyici onayının biçimi: görevlinin işlediği ıslak imza ya da velinin kendi elektronik onayı. */
export const CONTRACT_APPROVAL_METHODS = ['wet_signature', 'electronic'] as const
export type ContractApprovalMethod = (typeof CONTRACT_APPROVAL_METHODS)[number]
export const CONTRACT_APPROVAL_METHOD_LABELS: Readonly<Record<ContractApprovalMethod, string>> = {
  wet_signature: 'Islak imza',
  electronic: 'Elektronik onay',
}

/** Planın bir satırı; önerilen ek protokol satırının henüz taksiti yoktur (`invoiceId: null`). */
export interface ContractPlanLine {
  invoiceId: string | null
  installment: number
  amount: number
  dueDate: string
  feeKind?: string
}

export interface ContractSignatory {
  // kvkk: K
  name: string
  role: SignatoryRole
  recordedAt: string
  recordedByUserId: string
}

/** Onay anının kopyası: plan bundan sonra değişse de belge onaylanan planı gösterir (DOM-FIN-051). */
export interface ContractApproval {
  method: ContractApprovalMethod
  approvedAt: string
  approvedByUserId: string
  // kvkk: K
  payerName: string
  plan: ContractPlanLine[]
}

/** Ek protokolün önerdiği plan: onaylanana kadar hiçbir taksit değişmez. */
export interface ContractProposedPlan {
  /** Korunan taksitler: tahsilat görmüş öğrenim taksitleri ve ek hizmetler. */
  kept: ContractPlanLine[]
  /** Yerine yeni plan gelecek açık taksitler; onay anında hâlâ açık olmalıdır. */
  replacedInvoiceIds: string[]
  added: ContractPlanLine[]
}

/** Onay ve ek protokol alanları; eski kayıtlar ve örnek veri taşımaz. */
export type ContractLifecycle = {
  signatory?: ContractSignatory
  approval?: ContractApproval
  /** Sözleşme zincirindeki sıra; ilk sözleşmede yoktur (1 sayılır). */
  revision?: number
  amendsContractId?: string
  amendmentReason?: string
  proposedPlan?: ContractProposedPlan
  cancelledAt?: string
  cancelledByUserId?: string
  cancelReason?: string
}

export type ContractStatus =
  'awaiting_signatory' | 'awaiting_approval' | 'approved' | 'superseded' | 'cancelled'

export const CONTRACT_STATUS_LABELS: Readonly<Record<ContractStatus, string>> = {
  awaiting_signatory: 'Kurum imzası bekleniyor',
  awaiting_approval: 'Ödeyici onayı bekleniyor',
  approved: 'Onaylandı',
  superseded: 'Ek protokolle değişti',
  cancelled: 'İptal edildi',
}

type ContractRow = ContractLifecycle & { id: string }

/** Onaylanmış bir ek protokol bu sürümün yerini aldıysa sürüm salt okunur geçmiştir. */
const isSuperseded = (contract: ContractRow, contracts: readonly ContractRow[]) =>
  contracts.some((item) => item.amendsContractId === contract.id && item.approval !== undefined)

export function contractStatus(
  contract: ContractRow,
  contracts: readonly ContractRow[],
): ContractStatus {
  if (contract.cancelledAt !== undefined) return 'cancelled'
  if (contract.approval === undefined)
    return contract.signatory === undefined ? 'awaiting_signatory' : 'awaiting_approval'
  return isSuperseded(contract, contracts) ? 'superseded' : 'approved'
}

/**
 * Sözleşme borcun ve iadenin kaynağı mı (DOM-FIN-012). Kesin kayıt sözleşmesi taksitleriyle birlikte
 * açıldığından onaysız da yürürlüktedir; ek protokol ise onaylanmadan hiçbir sonuç doğurmaz.
 */
export function isContractInForce(
  contract: ContractRow,
  contracts: readonly ContractRow[],
): boolean {
  const status = contractStatus(contract, contracts)
  if (status === 'cancelled' || status === 'superseded') return false
  return contract.amendsContractId === undefined || status === 'approved'
}

/**
 * Belgenin Ek 1 satırları (DOM-FIN-051): onaylı sürümde onay anının kopyası, önerilen ek protokolde
 * önerilen plan; onaysız sözleşmede güncel taksitler (`null`, şablon belge verisini kullanır).
 */
export function contractPlanLines(contract: ContractLifecycle): ContractPlanLine[] | null {
  if (contract.approval !== undefined) return contract.approval.plan
  if (contract.proposedPlan !== undefined)
    return [...contract.proposedPlan.kept, ...contract.proposedPlan.added]
  return null
}
