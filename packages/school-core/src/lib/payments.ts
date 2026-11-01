import { z } from 'zod'

import type { State } from '../data/seed.ts'
import { PAYMENT_METHODS, daySchema, requiredText, type PaymentMethod } from './domain.ts'
import { DomainError } from './errors.ts'
import { dayKey } from './format.ts'

/**
 * Tahsilat kuralları (docs/domain/finans.md DOM-FIN-030…033, ADR 0006). Tahsilat ve dağılımı API
 * tablolarındadır; bu dosya dağılımı hesaplar ve taksitin `paidAt` geçiş önbelleğini günceller.
 * Yetkiyi kendisi denetlemez (`payInvoice` gibi); API önce `requireAuthorized` çalıştırır.
 */

const CASH: PaymentMethod = 'Nakit'
/** Saklanan öğle öncesi saat, gün değerinin Europe/Istanbul'da aynı güne düşmesi içindir. */
const DAY_TIME = 'T09:00:00.000Z'

export const recordPaymentSchema = z.strictObject({
  studentId: requiredText,
  amountCents: z
    .number()
    .int('Tutar kuruş cinsinden tam sayı olmalıdır.')
    .positive('Tutar sıfırdan büyük olmalıdır.')
    .max(100_000_000, 'Tutar en fazla 1.000.000 ₺ olabilir.'),
  method: z.enum(PAYMENT_METHODS, 'Ödeme yöntemini seçin.'),
  // kvkk: Ç
  reference: z
    .string()
    .trim()
    .min(3, 'İşlem referansı en az 3 karakter olmalıdır.')
    .max(100)
    .optional(),
  paidDate: daySchema.optional(),
  invoiceId: requiredText.optional(),
})
export type RecordPaymentInput = z.input<typeof recordPaymentSchema>

export const reversePaymentSchema = z.strictObject({
  // kvkk: Ç
  reason: z
    .string()
    .trim()
    .min(5, 'İptal gerekçesi en az 5 karakter olmalıdır.')
    .max(500, 'İptal gerekçesi en fazla 500 karakter olabilir.'),
})
export type ReversePaymentInput = z.input<typeof reversePaymentSchema>

export const paymentSettingsSchema = z.strictObject({ cashPaymentsEnabled: z.boolean() })
export type PaymentSettingsInput = z.input<typeof paymentSettingsSchema>

export type PaymentAllocation = { invoiceId: string; amountCents: number }

export interface PaymentContext {
  /** Taksit kimliği → iptal edilmemiş tahsilatlardan dağıtılmış tutar. */
  allocated: ReadonlyMap<string, number>
  cashEnabled: boolean
  /** Referans başka bir iptal edilmemiş tahsilatta kullanılmış mı. */
  referenceInUse: boolean
  /** Eski `POST /invoices/:id/pay` referans almaz (ADR 0006). */
  referenceOptional?: boolean
  now: string
}

export interface PaymentPlan {
  studentId: string
  amountCents: number
  method: PaymentMethod
  reference: string | null
  paidAt: string
  allocations: PaymentAllocation[]
}

type Invoice = State['invoices'][number]

/** Taksitin açık tutarı. Tahsilat kaydı olmadan ödenmiş eski taksit tam ödenmiş sayılır. */
export function openAmount(invoice: Invoice, allocated: ReadonlyMap<string, number>): number {
  if (invoice.paidAt) return 0
  return Math.max(invoice.amount - (allocated.get(invoice.id) ?? 0), 0)
}

function paidAtOf(paidDate: string | undefined, now: string): string {
  if (paidDate === undefined) return now
  if (paidDate > dayKey(now))
    throw new DomainError('payment_date_in_future', 'Ödeme tarihi ileri bir gün olamaz.', {
      path: ['paidDate'],
    })
  return `${paidDate}${DAY_TIME}`
}

/** Önce seçilen taksit, sonra en eski vade (DOM-FIN-030). */
function allocationOrder(invoices: readonly Invoice[], invoiceId: string | undefined): Invoice[] {
  const byDue = [...invoices].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.installment - b.installment,
  )
  if (invoiceId === undefined) return byDue
  return [
    ...byDue.filter((invoice) => invoice.id === invoiceId),
    ...byDue.filter((invoice) => invoice.id !== invoiceId),
  ]
}

/**
 * Tahsilatı açık taksitlere dağıtır; tam kapanan taksitin `paidAt` ve `method` alanını yazar.
 * Açık taksitleri aşan kısım dağıtılmaz, iade alacağı olur (DOM-FIN-030). Reddedilen istekte
 * State değişmez. Sıra: nakit ayarı, referans, öğrenci, seçilen taksit, açık taksit.
 */
export function planPayment(state: State, input: unknown, context: PaymentContext): PaymentPlan {
  const data = recordPaymentSchema.parse(input)
  const reference = data.reference ?? null
  if (data.method === CASH && !context.cashEnabled)
    throw new DomainError('cash_payment_disabled', 'Bu kurumda nakit tahsilat kapalıdır.', {
      path: ['method'],
    })
  if (reference === null && data.method !== CASH && context.referenceOptional !== true)
    throw new DomainError('payment_reference_required', 'İşlem referansını girin.', {
      path: ['reference'],
    })
  if (reference !== null && context.referenceInUse)
    throw new DomainError('payment_reference_used', 'Bu işlem referansı daha önce kaydedilmiş.', {
      kind: 'conflict',
      path: ['reference'],
    })
  const paidAt = paidAtOf(data.paidDate, context.now)
  if (!state.students.some((student) => student.id === data.studentId))
    throw new DomainError('student_not_found', 'Öğrenci bulunamadı.', { kind: 'not_found' })
  const invoices = state.invoices.filter((invoice) => invoice.studentId === data.studentId)
  if (data.invoiceId !== undefined) {
    const target = invoices.find((invoice) => invoice.id === data.invoiceId)
    if (!target)
      throw new DomainError('invoice_not_found', 'Ödeme kaydı bulunamadı.', { kind: 'not_found' })
    if (openAmount(target, context.allocated) === 0)
      throw new DomainError('invoice_already_paid', 'Bu taksit zaten ödenmiş.', {
        kind: 'conflict',
      })
  }
  const allocations: PaymentAllocation[] = []
  let remaining = data.amountCents
  for (const invoice of allocationOrder(invoices, data.invoiceId)) {
    if (remaining === 0) break
    const open = openAmount(invoice, context.allocated)
    if (open === 0) continue
    const amountCents = Math.min(open, remaining)
    allocations.push({ invoiceId: invoice.id, amountCents })
    remaining -= amountCents
    if (amountCents === open) {
      invoice.paidAt = paidAt
      invoice.method = data.method
    }
  }
  if (allocations.length === 0)
    throw new DomainError('no_open_installments', 'Bu öğrencinin açık taksiti bulunmuyor.', {
      kind: 'conflict',
    })
  return {
    studentId: data.studentId,
    amountCents: data.amountCents,
    method: data.method,
    reference,
    paidAt,
    allocations,
  }
}

/**
 * Tahsilat iptali: dağıtıldığı taksitleri yeniden açar (DOM-FIN-033). Dağılım taksit tutarını
 * aşmadığı için iptalden sonra taksit tam ödenmiş kalamaz.
 */
export function reversePayment(
  state: State,
  payment: {
    reversedAt: string | null
    allocations: readonly PaymentAllocation[]
    /** Ayrılış kaydı var: iade hesabı bu tahsilata dayanır (DOM-FIN-041). */
    studentWithdrawn?: boolean
  },
  input: unknown,
): { reason: string } {
  const { reason } = reversePaymentSchema.parse(input)
  if (payment.reversedAt !== null)
    throw new DomainError('payment_already_reversed', 'Bu tahsilat zaten iptal edilmiş.', {
      kind: 'conflict',
    })
  if (payment.studentWithdrawn === true)
    throw new DomainError(
      'payment_student_withdrawn',
      'Ayrılış kaydı olan öğrencinin tahsilatı iptal edilemez.',
      { kind: 'conflict' },
    )
  const ids = new Set(payment.allocations.map((allocation) => allocation.invoiceId))
  for (const invoice of state.invoices)
    if (ids.has(invoice.id)) {
      invoice.paidAt = null
      invoice.method = null
    }
  return { reason }
}
