// Sözleşme onayı ve ek protokol ekranlarının saf mantığı (IST-092; docs/domain/finans.md
// DOM-FIN-010, -012, -051): hangi işlemin sunulacağı, belgedeki plan satırları ve ek protokol
// formunun gövdesi. Kurallar core'dadır (`lib/contract-status.ts`, `lib/contract-approval.ts`);
// burada yeniden yazılmaz, yalnız ekrana çevrilir. Yetki ve kesin karar sunucudadır; buradaki
// `actions` yalnız gösterilecek düğmeleri seçer.
import { z } from 'zod'

import type { State } from '@kampus/school-core/data/seed.ts'
import { WRITE_ACTION_ROLES } from '@kampus/school-core/lib/authorize.ts'
import { amendContractSchema } from '@kampus/school-core/lib/contract-approval.ts'
import {
  contractPlanLines,
  contractStatus,
  type ContractPlanLine,
} from '@kampus/school-core/lib/contract-status.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import { FEE_DISCOUNT_KINDS, type FeeDiscountKind } from '@kampus/school-core/lib/fee-tariffs.ts'
import type { Role } from '@kampus/school-core/modules/navigation.ts'

import type { AmendContractBody } from './use-contract-commands.ts'

export type ContractRecord = State['contracts'][number]
type InvoiceRecord = State['invoices'][number]

/** Sözleşme zincirindeki sıra; ilk sözleşme 1. */
export const contractRevision = (contract: Pick<ContractRecord, 'revision'>) =>
  contract.revision ?? 1

/** Ek protokol olarak açılmış sürüm mü (ilk sözleşme değil). */
export const isAmendment = (contract: Pick<ContractRecord, 'amendsContractId'>) =>
  contract.amendsContractId !== undefined

export interface ContractActions {
  /** İmza yetkilisini işle (yalnız yönetici, onaydan önce düzeltilebilir). */
  sign: boolean
  /** Onay: veli elektronik, görevli ıslak imza; imza yetkilisi işlenmiş olmalı. */
  approve: boolean
  /** Ek protokol hazırla: yalnız yürürlükteki onaylı sürümde ve açık ek protokol yokken. */
  amend: boolean
  /** Onaylanmamış ek protokolü iptal et. */
  cancelAmendment: boolean
}

const allowed = (action: keyof typeof WRITE_ACTION_ROLES, role: Role) =>
  (WRITE_ACTION_ROLES[action] as readonly Role[]).includes(role)

/**
 * Rolün bu sürümde görebileceği işlemler. `contracts` öğrencinin bütün sürümleridir (durum ve açık
 * ek protokol bunlardan türetilir). Öğrencinin aktifliği ve planlanmış yenileme sunucuda denetlenir.
 */
export function contractActions(
  contract: ContractRecord,
  contracts: readonly ContractRecord[],
  role: Role,
): ContractActions {
  const status = contractStatus(contract, contracts)
  const unapproved = status === 'awaiting_signatory' || status === 'awaiting_approval'
  const openAmendment = contracts.some(
    (item) => item.amendsContractId === contract.id && item.cancelledAt === undefined,
  )
  return {
    sign: unapproved && allowed('contract.sign', role),
    approve: status === 'awaiting_approval' && allowed('contract.approve', role),
    amend: status === 'approved' && !openAmendment && allowed('contract.amend', role),
    cancelAmendment: unapproved && isAmendment(contract) && allowed('contract.amend', role),
  }
}

/** Satırın kaynağı: onaylı kopya, ek protokolde korunan ya da önerilen, onaysızda güncel taksit. */
export type ContractPlanRowKind = 'approved' | 'kept' | 'proposed' | 'current'
export const CONTRACT_PLAN_ROW_LABELS: Readonly<Record<ContractPlanRowKind, string>> = {
  approved: 'Onaylı plan',
  kept: 'Korunur',
  proposed: 'Yeni plan',
  current: 'Güncel plan',
}

export interface ContractPlanRow {
  key: string
  installment: number
  dueDate: string
  amount: number
  feeKind: string
  kind: ContractPlanRowKind
}

const rowOf = (line: ContractPlanLine, kind: ContractPlanRowKind): ContractPlanRow => ({
  key: `${kind}-${line.invoiceId ?? 'yeni'}-${String(line.installment)}`,
  installment: line.installment,
  dueDate: line.dueDate,
  amount: line.amount,
  feeKind: line.feeKind ?? 'tuition',
  kind,
})

/**
 * Belgedeki Ek 1 ile aynı satırlar (DOM-FIN-051): onaylı sürümde onay anının kopyası, ek protokol
 * taslağında korunan ve önerilen satırlar, onaysız sözleşmede yalnız kendi taksitleri (DOM-FIN-012;
 * `invoiceIds` yoksa öğrencinin taksitleri, eski kayıt).
 */
export function contractPlanRows(
  contract: ContractRecord,
  invoices: readonly InvoiceRecord[],
): ContractPlanRow[] {
  if (contract.approval !== undefined)
    return contract.approval.plan.map((line) => rowOf(line, 'approved'))
  if (contract.proposedPlan !== undefined)
    return [
      ...contract.proposedPlan.kept.map((line) => rowOf(line, 'kept')),
      ...contract.proposedPlan.added.map((line) => rowOf(line, 'proposed')),
    ]
  const lines = contractPlanLines(contract)
  if (lines !== null) return lines.map((line) => rowOf(line, 'current'))
  const ids = contract.invoiceIds === undefined ? null : new Set(contract.invoiceIds)
  return invoices
    .filter((invoice) =>
      ids === null ? invoice.studentId === contract.studentId : ids.has(invoice.id),
    )
    .sort((left, right) => left.installment - right.installment)
    .map((invoice) =>
      rowOf(
        {
          invoiceId: invoice.id,
          installment: invoice.installment,
          amount: invoice.amount,
          dueDate: invoice.dueDate,
          ...(invoice.feeKind === undefined ? {} : { feeKind: invoice.feeKind }),
        },
        'current',
      ),
    )
}

/**
 * Onay formu: kutu işaretlenmeden gönderilmez. Sunucu gövdesi `{ accepted: true }`tur (core
 * `approveContractSchema`); form kutunun boş hâlini de taşıdığı için alan `boolean`dır.
 */
export const APPROVAL_REQUIRED_MESSAGE = 'Onay için sözleşmeyi kabul ettiğinizi işaretleyin.'
export const approvalFormSchema = z.object({
  accepted: z.boolean().refine((value) => value, APPROVAL_REQUIRED_MESSAGE),
})
export type ApprovalFormValues = z.input<typeof approvalFormSchema>

/** Ek protokol formu: taksit sayısı metin girer, gövdeye sayı ve gün olarak çevrilir. */
const amendShape = amendContractSchema.shape
export const amendmentFormSchema = z.object({
  reason: amendShape.reason,
  installmentCount: z
    .string()
    .regex(/^(?:[1-9]|1[0-2])$/, 'Taksit sayısını 1 ile 12 arasında girin.'),
  firstDueDate: daySchema,
  /** İşaretliyse indirim kalemleri sözleşmenin tarifesinden yeniden hesaplanır (DOM-FIN-020). */
  changeDiscounts: z.boolean(),
  discounts: z.array(z.enum(FEE_DISCOUNT_KINDS)),
})
export type AmendmentFormValues = z.input<typeof amendmentFormSchema>

/** Tarifesiz (eski) sözleşmede indirim değiştirilemez; seçenek gösterilmez. */
export const canRepriceContract = (contract: ContractRecord) =>
  contract.grossCents !== undefined && contract.tariffId !== undefined

const isDiscountKind = (kind: string): kind is FeeDiscountKind =>
  (FEE_DISCOUNT_KINDS as readonly string[]).includes(kind)

/**
 * Varsayılanlar mevcut açık planı tekrar etmez, yalnız başlangıçtır: taksit sayısı açık öğrenim
 * taksitlerinin sayısı, ilk vade bugünden sonraki ilk açık vade (yoksa bugün), indirimler
 * sözleşmedeki kalemler.
 */
export function amendmentDefaults(
  contract: ContractRecord,
  invoices: readonly InvoiceRecord[],
  today: string,
): AmendmentFormValues {
  const ids = new Set(contract.invoiceIds ?? [])
  const open = invoices
    .filter(
      (invoice) =>
        (contract.invoiceIds === undefined
          ? invoice.studentId === contract.studentId
          : ids.has(invoice.id)) &&
        invoice.paidAt === null &&
        (invoice.feeKind ?? 'tuition') === 'tuition',
    )
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate))
  const nextDue = open.map((invoice) => invoice.dueDate.slice(0, 10)).find((day) => day >= today)
  return {
    reason: '',
    installmentCount: String(Math.min(Math.max(open.length, 1), 12)),
    firstDueDate: nextDue ?? today,
    changeDiscounts: false,
    discounts: (contract.discounts ?? []).map((line) => line.kind).filter(isDiscountKind),
  }
}

export function amendmentBody(values: z.output<typeof amendmentFormSchema>): AmendContractBody {
  return {
    reason: values.reason,
    installmentCount: Number(values.installmentCount),
    firstDueDate: values.firstDueDate,
    ...(values.changeDiscounts ? { discounts: values.discounts } : {}),
  }
}
