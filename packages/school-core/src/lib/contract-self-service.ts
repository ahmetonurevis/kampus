import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { contractPlanLines, isContractInForce, type ContractPlanLine } from './contract-status.ts'
import { guardianRequired, isCourse } from './enrollment.ts'
import { dayKey } from './format.ts'
import type { LearnerAgeFacts } from './notifications.ts'

/**
 * Yetişkin kursiyerin kendi sözleşmelerini salt okur görmesi (IST-082; docs/domain/finans.md
 * DOM-FIN-059). Sözleşme tarafı 18 yaşını doldurmuş kursiyerin kendisidir (DOM-KAY-012,
 * DOM-YTK-030); okulda öğrenci her yaşta velilidir ve sözleşmeyi veli görür. Onay bu görünümde
 * yoktur (`contract.approve` velinindir). Kural ve özet burada, kapsam API'dedir.
 */

/** Kendi sözleşmelerini okuyan rol: kursiyer `ogrenci` hesabını kullanır (DOM-YTK-030). */
export const CONTRACT_SELF_SERVICE_ROLES = ['ogrenci'] as const

/**
 * Kursiyer sözleşmelerini kendi hesabından görür mü. Yalnız kursta (`isCourse`: dil okulu ve kurs)
 * ve bugün 18 yaşını doldurmuşsa: veli zorunluluğu kesin kayıttaki kuraldır (`guardianRequired`,
 * gün Europe/Istanbul). Doğum tarihi yoksa kesin kayda alınan adayın yaş grubu seçimi belirler;
 * ikisi de yoksa kursiyer reşit olmayan sayılır (`isMinorLearner` ile aynı varsayılan).
 */
export function learnerReadsOwnContracts(
  facts: LearnerAgeFacts,
  options: { institutionType: InstitutionType; now: string | number | Date },
): boolean {
  if (!isCourse(options.institutionType)) return false
  if (facts.birthDate !== undefined)
    return !guardianRequired(options.institutionType, facts.birthDate, options.now)
  return facts.prospectMinor === false
}

type Contract = State['contracts'][number]
type Invoice = Pick<
  State['invoices'][number],
  'id' | 'studentId' | 'installment' | 'amount' | 'dueDate' | 'paidAt' | 'contractId'
>

/** Sözleşme kartındaki ödeme planı özeti; tutarlar kuruş, günler `YYYY-MM-DD` (Europe/Istanbul). */
export interface ContractPlanSummary {
  /** Plan satırı sayısı (öğrenim taksitleri ve ek hizmetler). */
  installmentCount: number
  totalCents: number
  /** Tamamı ödenmiş satır sayısı; önerilen ek protokol satırı ödenmiş sayılmaz. */
  paidCount: number
  /** Yürürlükteki sürümde vadesi en yakın ödenmemiş taksit; yoksa `null`. */
  nextDue: { date: string; amountCents: number } | null
}

/**
 * Sözleşmenin taksitleri: bağlı taksit listesi, yoksa taksitteki sözleşme kimliği, ikisi de yoksa
 * (eski kayıt) öğrencinin bütün taksitleri. Sözleşme belgesi aynı seçimi yapar (`document-data.ts`).
 */
function contractInvoices(contract: Contract, invoices: readonly Invoice[]): Invoice[] {
  return invoices
    .filter(
      (invoice) =>
        invoice.studentId === contract.studentId &&
        (contract.invoiceIds
          ? contract.invoiceIds.includes(invoice.id)
          : invoice.contractId
            ? invoice.contractId === contract.id
            : true),
    )
    .sort((a, b) => a.installment - b.installment)
}

/**
 * Sözleşme sürümünün ödeme planı özeti (DOM-FIN-051, DOM-FIN-059). Satırlar belgenin Ek 1'iyle
 * aynıdır (`contractPlanLines`): onaylı sürümde onay anının kopyası, ek protokol taslağında
 * önerilen plan, onaysız sözleşmede güncel taksitler. Ödenme ve sıradaki vade güncel taksitlerden
 * okunur; yürürlükte olmayan sürümün sıradaki vadesi yoktur.
 */
export function contractPlanSummary(
  contract: Contract,
  contracts: readonly Contract[],
  invoices: readonly Invoice[],
): ContractPlanSummary {
  const own = contractInvoices(contract, invoices)
  const lines: ContractPlanLine[] =
    contractPlanLines(contract) ??
    own.map((invoice) => ({
      invoiceId: invoice.id,
      installment: invoice.installment,
      amount: invoice.amount,
      dueDate: invoice.dueDate,
    }))
  const live = new Map(invoices.map((invoice) => [invoice.id, invoice]))
  const paid = (line: ContractPlanLine) =>
    line.invoiceId !== null && Boolean(live.get(line.invoiceId)?.paidAt)
  // Yerini ek protokole bırakan, iptal edilen ve onaylanmamış ek protokol borç doğurmaz (DOM-FIN-012).
  const next = isContractInForce(contract, contracts)
    ? lines
        .filter((line) => line.invoiceId !== null && live.has(line.invoiceId) && !paid(line))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
    : undefined
  return {
    installmentCount: lines.length,
    totalCents: lines.reduce((total, line) => total + line.amount, 0),
    paidCount: lines.filter(paid).length,
    nextDue: next ? { date: dayKey(next.dueDate), amountCents: next.amount } : null,
  }
}
