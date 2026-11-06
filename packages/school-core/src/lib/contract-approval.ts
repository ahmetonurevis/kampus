import { z } from 'zod'

import type { State } from '../data/seed.ts'
import type { Role } from '../modules/navigation.ts'
import { contractStatus, SIGNATORY_ROLES, type ContractPlanLine } from './contract-status.ts'
import { daySchema, requiredText, type MakeId } from './domain.ts'
import {
  discountLines,
  installmentDueDate,
  requireSiblingDiscountEligible,
  type EnrollmentTariff,
} from './enrollment.ts'
import { DomainError } from './errors.ts'
import { FEE_DISCOUNT_KINDS, type FeeDiscountKind } from './fee-tariffs.ts'
import { dayKey } from './format.ts'
import { payerOf, type GuardianLink } from './guardianship.ts'
import {
  assertEarlyPaymentOnUpfront,
  resolvePaymentTerm,
  type ContractPaymentTerm,
} from './payment-terms.ts'
import { installmentAmounts } from './payments.ts'
import { invoicesOf, payerNameOf } from './withdrawals.ts'

/**
 * Sözleşme onayı ve ek protokol (IST-092; docs/domain/finans.md DOM-FIN-010, -012, -051). Sıra:
 * imza yetkilisi işlenir, ödeyici onaylar; onaylı sözleşmenin tutarı ve planı değişmez. Değişiklik
 * ek protokoldür: yeni sürüm kaydı açılır, önceki sürüm değişmeden kalır ve yeni plan ancak yeni
 * sürüm onaylanınca taksitlere geçer. Yetki `requireAuthorized`'dadır; ödeyici kuralı burada.
 */

export const contractSignatorySchema = z.strictObject({
  // kvkk: K
  name: requiredText.max(120),
  role: z.enum(SIGNATORY_ROLES, 'İmza yetkilisinin sıfatını seçin.'),
})
export type ContractSignatoryInput = z.input<typeof contractSignatorySchema>

export const approveContractSchema = z.strictObject({
  accepted: z.literal(true, 'Onay için sözleşmeyi kabul ettiğinizi işaretleyin.'),
})
export type ApproveContractInput = z.input<typeof approveContractSchema>

export const amendContractSchema = z.strictObject({
  reason: requiredText.max(500),
  installmentCount: z.number().int().min(1).max(12),
  firstDueDate: daySchema,
  /** Verilirse indirim kalemleri sözleşmenin kendi tarifesinden yeniden hesaplanır (DOM-FIN-020). */
  discounts: z.array(z.enum(FEE_DISCOUNT_KINDS, 'İndirim türü geçersiz.')).max(10).optional(),
})
export type AmendContractInput = z.input<typeof amendContractSchema>

export const cancelAmendmentSchema = z.strictObject({ reason: requiredText.max(500) })
export type CancelAmendmentInput = z.input<typeof cancelAmendmentSchema>

type Contract = State['contracts'][number]
type Invoice = State['invoices'][number]

function contractOf(state: State, contractId: string): Contract {
  const contract = state.contracts.find((item) => item.id === contractId)
  if (!contract)
    throw new DomainError('contract_not_found', 'Sözleşme bulunamadı.', { kind: 'not_found' })
  return contract
}

const conflict = (code: string, message: string) =>
  new DomainError(code, message, { kind: 'conflict' })

const CANCELLED_MESSAGE = 'İptal edilen ek protokol üzerinde işlem yapılamaz.'

function assertUnapproved(contract: Contract) {
  if (contract.approval !== undefined)
    throw conflict('contract_already_approved', 'Onaylanmış sözleşme değiştirilemez.')
  if (contract.cancelledAt !== undefined) throw conflict('contract_cancelled', CANCELLED_MESSAGE)
}

function assertStudentActive(state: State, contract: Contract) {
  const student = state.students.find((item) => item.id === contract.studentId)
  if (!student?.isActive)
    throw conflict('contract_student_inactive', 'Öğrencinin kaydı aktif değil.')
}

const lineOf = (invoice: Invoice): ContractPlanLine => ({
  invoiceId: invoice.id,
  installment: invoice.installment,
  amount: invoice.amount,
  dueDate: invoice.dueDate,
  ...(invoice.feeKind === undefined ? {} : { feeKind: invoice.feeKind }),
})

const byInstallment = (left: ContractPlanLine, right: ContractPlanLine) =>
  left.installment - right.installment

/** Kurucu ya da kurucu temsilcisini işler; onaya kadar düzeltilebilir (ÖÖKY m.31/4). */
export function setContractSignatory(
  state: State,
  contractId: string,
  input: unknown,
  context: { userId: string; now: string },
): Contract {
  const data = contractSignatorySchema.parse(input)
  const contract = contractOf(state, contractId)
  assertUnapproved(contract)
  contract.signatory = {
    name: data.name,
    role: data.role,
    recordedAt: context.now,
    recordedByUserId: context.userId,
  }
  return contract
}

export interface ApproveContractContext {
  role: Role
  userId: string
  membershipId: string
  /** Öğrencinin etkin veli bağları; yalnız veli onayında okunur (DOM-ILT-074). */
  guardians: readonly GuardianLink[]
  /** Taksit → iptal edilmemiş tahsilattan dağıtılan tutar. */
  allocated: ReadonlyMap<string, number>
  now: string
  makeId: MakeId
}

/**
 * Veli yalnız sözleşmenin ödeyicisiyse onaylar: ikinci veli ve velayetli olup ödeyici olmayan veli
 * bu borcun tarafı değildir (DOM-FIN-052). Yetişkin kursiyerin onayını görevli işler.
 */
function assertGuardianIsPayer(contract: Contract, context: ApproveContractContext) {
  const payer = payerOf(context.guardians, contract.studentId)
  if (contract.payer === 'student' || payer?.membershipId !== context.membershipId)
    throw new DomainError('contract_payer_only', 'Sözleşmeyi yalnız ödeyici veli onaylayabilir.', {
      kind: 'forbidden',
    })
}

/**
 * Ek protokolü taksitlere geçirir: açık taksitler kalkar, önerilen plan yazılır. Taslaktan sonra
 * tahsilat gördüyse önerilen plan bayattır; sessizce yeniden hesaplanmaz, ödeyicinin gördüğü tutar
 * korunur.
 */
function applyProposedPlan(state: State, contract: Contract, context: ApproveContractContext) {
  const proposal = contract.proposedPlan
  if (proposal === undefined) return
  const base = state.contracts.find((item) => item.id === contract.amendsContractId)
  const stale =
    base === undefined ||
    contractStatus(base, state.contracts) !== 'approved' ||
    proposal.replacedInvoiceIds.some((id) => {
      const invoice = state.invoices.find((item) => item.id === id)
      return !invoice || invoice.paidAt !== null || (context.allocated.get(id) ?? 0) > 0
    }) ||
    proposal.kept.some((line) => !state.invoices.some((item) => item.id === line.invoiceId))
  if (stale)
    throw conflict(
      'contract_amendment_stale',
      'Taksitler ek protokol hazırlandıktan sonra değişti; ek protokolü iptal edip yeniden hazırlayın.',
    )
  const replaced = new Set(proposal.replacedInvoiceIds)
  state.invoices = state.invoices.filter((invoice) => !replaced.has(invoice.id))
  const added = proposal.added.map((line) => {
    const invoice = {
      id: context.makeId('inv'),
      studentId: contract.studentId,
      installment: line.installment,
      amount: line.amount,
      dueDate: line.dueDate,
      paidAt: null,
      method: null,
      reminderAt: null,
      feeKind: 'tuition',
      contractId: contract.id,
      ...(contract.academicYear === undefined ? {} : { academicYear: contract.academicYear }),
    }
    state.invoices.push(invoice)
    return invoice
  })
  contract.invoiceIds = [
    ...proposal.kept.flatMap((line) => (line.invoiceId === null ? [] : [line.invoiceId])),
    ...added.map((invoice) => invoice.id),
  ]
  delete contract.proposedPlan
}

/**
 * Ödeyici onayını zamanıyla saklar (DOM-FIN-010). Veli kendi hesabıyla elektronik onay verir; görevli
 * kâğıt üzerindeki ıslak imzayı işler. Plan onay anında kopyalanır (DOM-FIN-051).
 */
export function approveContract(
  state: State,
  contractId: string,
  input: unknown,
  context: ApproveContractContext,
): Contract {
  approveContractSchema.parse(input)
  const contract = contractOf(state, contractId)
  assertUnapproved(contract)
  assertStudentActive(state, contract)
  if (context.role === 'veli') assertGuardianIsPayer(contract, context)
  if (contract.signatory === undefined)
    throw new DomainError(
      'contract_signatory_required',
      'Önce kurucu ya da kurucu temsilcisini imza yetkilisi olarak işleyin.',
    )
  const payerName = payerNameOf(state, contract.id)
  if (payerName === '')
    throw new DomainError('contract_payer_missing', 'Sözleşmenin ödeyicisi bulunamadı.')
  applyProposedPlan(state, contract, context)
  contract.approval = {
    method: context.role === 'veli' ? 'electronic' : 'wet_signature',
    approvedAt: context.now,
    approvedByUserId: context.userId,
    payerName,
    plan: invoicesOf(state, contract).map(lineOf).sort(byInstallment),
  }
  return contract
}

export interface AmendContractContext {
  /** Sözleşmenin tarifesi; tarifesiz eski sözleşmede `null`. */
  tariff: EnrollmentTariff | null
  canApproveCapException: boolean
  allocated: ReadonlyMap<string, number>
  userId: string
  now: string
  makeId: MakeId
}

/** Yalnız yürürlükteki onaylı sürüm değiştirilir; onaysız sözleşmenin zaten imzası yoktur. */
function assertAmendable(state: State, source: Contract) {
  const status = contractStatus(source, state.contracts)
  if (status === 'cancelled') throw conflict('contract_cancelled', CANCELLED_MESSAGE)
  if (status === 'superseded')
    throw conflict(
      'contract_superseded',
      'Bu sürümün yerini bir ek protokol aldı; güncel sürüm üzerinde işlem yapın.',
    )
  if (status !== 'approved')
    throw new DomainError('contract_not_approved', 'Onaylanmamış sözleşmeye ek protokol yapılmaz.')
  if (state.contracts.some((item) => item.amendsContractId === source.id && !item.cancelledAt))
    throw conflict('contract_amendment_open', 'Bu sözleşmenin açık bir ek protokolü var.')
  assertStudentActive(state, source)
  // Planlanmış yenileme sözleşmesine kimlikle bağlıdır; yeni sürüm bu bağı koparırdı.
  if (state.renewals.some((item) => item.contractId === source.id && item.status === 'Planlandı'))
    throw new DomainError(
      'contract_renewal_planned',
      'Planlanmış yenilemenin sözleşmesine ek protokol yapılmaz; yenilemeyi yeniden planlayın.',
    )
}

/** Zincirin ilk sözleşmesi; ek protokol başlığı onun adını taşır. */
function rootOf(state: State, contract: Contract): Contract {
  const base = state.contracts.find((item) => item.id === contract.amendsContractId)
  return base ? rootOf(state, base) : contract
}

/** Yeni net: sözleşmenin ilan ücretinden, tarifedeki kalemlerle (serbest indirim yok, DOM-FIN-020). */
function repricedTerms(
  state: State,
  source: Contract,
  discounts: readonly FeeDiscountKind[],
  paymentTerm: ContractPaymentTerm | null,
  context: AmendContractContext,
) {
  if (source.grossCents === undefined || context.tariff === null)
    throw new DomainError(
      'contract_amendment_no_tariff',
      'Tarifesiz sözleşmede indirim değiştirilemez.',
      { path: ['discounts'] },
    )
  const student = state.students.find((item) => item.id === source.studentId)
  // Kardeş indirimi kesin kayıttakiyle aynı koşula ve sıraya bağlıdır (DOM-FIN-022).
  if (discounts.includes('sibling'))
    requireSiblingDiscountEligible(state, {
      studentId: source.studentId,
      siblingIds: state.students
        .filter((item) => Boolean(student?.parentId) && item.parentId === student?.parentId)
        .map((item) => item.id),
      tuitionCents: source.grossCents,
    })
  assertEarlyPaymentOnUpfront(paymentTerm, discounts)
  // Sözleşmedeki referans kalemi hakkın uygulanmış tutarıyla kalır, tarifeden yeniden hesaplanmaz
  // (K-14); başka kalem tavanı aşırırsa reddedilir, kısaltılmaz.
  const referralLine = source.discounts?.find((line) => line.kind === 'referral')
  const lines = discountLines(context.tariff.discounts, source.grossCents, discounts, {
    canApproveCapException: context.canApproveCapException,
    paymentTerm,
    referral: { amountCents: referralLine?.amountCents ?? 0, trimToCap: false },
  })
  // Referans kalemi yalnız kullanılan bir hakla gelir (DOM-FIN-024); ek protokolde hak işaretlenmez,
  // bu yüzden yeni eklenemez.
  if (discounts.includes('referral') && referralLine === undefined)
    throw new DomainError(
      'referral_reward_required',
      'Referans indirimi ek protokolle eklenmez; kesin kayıtta ya da yenilemede referans hakkıyla kullanılır.',
      { path: ['discounts'] },
    )
  const total = lines.reduce((sum, line) => sum + line.amountCents, 0)
  const netCents = source.grossCents - total - (source.scholarship?.amountCents ?? 0)
  if (netCents < 0)
    throw new DomainError(
      'contract_amendment_below_scholarship',
      'İndirimler bursla birlikte ilan ücretini aşamaz.',
      { path: ['discounts'] },
    )
  return { discounts: lines, netCents, approvedByUserId: context.userId }
}

/** Fiyatı belirleyen alanlar aynı mı; yalnız taksit sayısı değiştiyse indirim yeniden hesaplanmaz. */
function sameTerm(a: ContractPaymentTerm, b: ContractPaymentTerm | null): boolean {
  return (
    b !== null &&
    a.kind === b.kind &&
    a.discountPercentBasisPoints === b.discountPercentBasisPoints &&
    a.discountAmountCents === b.discountAmountCents
  )
}

/** Sözleşmedeki kalemlerden tarifede seçilen türler; koşulun fiyat farkı koşuldan yeniden çıkar. */
function announcedDiscountKinds(lines: Contract['discounts']): FeeDiscountKind[] {
  const known: readonly string[] = FEE_DISCOUNT_KINDS
  return (lines ?? [])
    .map((line) => line.kind)
    .filter((kind): kind is FeeDiscountKind => known.includes(kind))
}

/**
 * Ek protokolü taslak olarak açar: tahsilat görmüş öğrenim taksitleri ve ek hizmetler korunur, kalan
 * net yeni plana dağıtılır (DOM-FIN-011). İmza ve onay yeni sürümde yeniden alınır.
 */
export function amendContract(
  state: State,
  contractId: string,
  input: unknown,
  context: AmendContractContext,
): Contract {
  const data = amendContractSchema.parse(input)
  const source = contractOf(state, contractId)
  assertAmendable(state, source)
  if (data.firstDueDate < dayKey(context.now))
    throw new DomainError('contract_amendment_date_past', 'İlk vade geçmiş bir gün olamaz.', {
      path: ['firstDueDate'],
    })

  const invoices = invoicesOf(state, source)
  const isTuition = (invoice: Invoice) => (invoice.feeKind ?? 'tuition') === 'tuition'
  const collected = (invoice: Invoice) =>
    invoice.paidAt !== null || (context.allocated.get(invoice.id) ?? 0) > 0
  const tuition = invoices.filter(isTuition)
  const open = tuition.filter((invoice) => !collected(invoice))
  const kept = invoices.filter((invoice) => !isTuition(invoice) || collected(invoice))

  // Ek protokol de ilandaki koşulun dışına çıkamaz (DOM-FIN-013): koşul, korunan öğrenim taksitleri
  // ile yeni planın toplam sayısından çıkar. Koşul değişirse indirimler yeniden hesaplanır, çünkü
  // fiyat farkı ve peşin indirimi koşula bağlıdır.
  const paymentTerm = resolvePaymentTerm(
    context.tariff?.paymentTerms,
    kept.filter(isTuition).length + data.installmentCount,
  )
  const termChanged = source.paymentTerm !== undefined && !sameTerm(source.paymentTerm, paymentTerm)
  const discountKinds =
    data.discounts ?? (termChanged ? announcedDiscountKinds(source.discounts) : undefined)
  const terms =
    discountKinds === undefined
      ? null
      : repricedTerms(state, source, discountKinds, paymentTerm, context)
  const netCents = terms?.netCents ?? tuition.reduce((sum, invoice) => sum + invoice.amount, 0)
  const collectedCents = tuition.filter(collected).reduce((sum, invoice) => sum + invoice.amount, 0)
  const remaining = netCents - collectedCents
  if (remaining < 0)
    throw new DomainError(
      'contract_amendment_below_collected',
      'Yeni net tutar tahsil edilmiş taksitlerin altına inemez.',
      { path: ['discounts'] },
    )

  const start = new Date(`${data.firstDueDate}T09:00:00.000Z`)
  const lastInstallment = kept.reduce((highest, item) => Math.max(highest, item.installment), 0)
  const added = (remaining === 0 ? [] : installmentAmounts(remaining, data.installmentCount)).map(
    (amount, index): ContractPlanLine => ({
      invoiceId: null,
      installment: lastInstallment + index + 1,
      amount,
      dueDate: installmentDueDate(start, index).toISOString(),
      feeKind: 'tuition',
    }),
  )
  const sameAsOpen =
    added.length === open.length &&
    added.every(
      (line, index) => line.amount === open[index]?.amount && line.dueDate === open[index]?.dueDate,
    )
  if (sameAsOpen)
    throw new DomainError('contract_amendment_no_change', 'Ek protokol planı değiştirmiyor.')

  const revision = (source.revision ?? 1) + 1
  const keptLines = kept.map(lineOf).sort(byInstallment)
  const amendment: Contract = {
    ...source,
    id: context.makeId('contract'),
    date: context.now,
    title: `${rootOf(state, source).title} · Ek protokol ${String(revision - 1)}`,
    amount: [...keptLines, ...added].reduce((sum, line) => sum + line.amount, 0),
    invoiceIds: [],
    ...(terms ?? {}),
    ...(paymentTerm === null ? {} : { paymentTerm }),
    revision,
    amendsContractId: source.id,
    amendmentReason: data.reason,
    proposedPlan: {
      kept: keptLines,
      replacedInvoiceIds: open.map((invoice) => invoice.id),
      added,
    },
  }
  delete amendment.approval
  delete amendment.signatory
  state.contracts.push(amendment)
  return amendment
}

/** Onaylanmamış ek protokolü gerekçeyle kapatır; önceki sürüm ve taksitler zaten değişmemiştir. */
export function cancelContractAmendment(
  state: State,
  contractId: string,
  input: unknown,
  context: { userId: string; now: string },
): Contract {
  const data = cancelAmendmentSchema.parse(input)
  const contract = contractOf(state, contractId)
  assertUnapproved(contract)
  if (contract.amendsContractId === undefined)
    throw new DomainError(
      'contract_not_amendment',
      'Yalnız onaylanmamış ek protokol iptal edilir; kayıt sözleşmesi ayrılış işlemiyle kapanır.',
    )
  contract.cancelledAt = context.now
  contract.cancelledByUserId = context.userId
  contract.cancelReason = data.reason
  return contract
}
