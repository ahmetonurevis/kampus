import { z } from 'zod'

import type { State } from '../data/seed.ts'
import { csvAmount } from './csv.ts'
import { daySchema, requiredText } from './domain.ts'
import { DomainError } from './errors.ts'
import { dayKey } from './format.ts'
import { isValidTurkishIban } from './withdrawals.ts'

/**
 * Tahsilat kuralları (docs/domain/finans.md DOM-FIN-030…033, ADR 0006). Tahsilat ve dağılımı API
 * tablolarındadır; bu dosya dağılımı hesaplar ve taksitin `paidAt` geçiş önbelleğini günceller.
 * Yetkiyi kendisi denetlemez; API önce `requireAuthorized` çalıştırır. Çevrimdışı demonun tek
 * seferlik ödeme yolu ayrıdır (`payments-demo.ts`, ON-037).
 */

// --- Taksit bölme ve tahsilat yöntemleri (kesin kayıt, tahsilat ve çevrimdışı demo ortak çekirdeği) ---

export function installmentAmounts(cents: number, count: number) {
  if (
    !Number.isSafeInteger(cents) ||
    cents <= 0 ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 12
  )
    throw new DomainError('invalid_installment', 'Taksit tutarı veya sayısı geçersiz.')
  const base = Math.floor(cents / count)
  return Array.from({ length: count }, (_, i) => base + (i < cents % count ? 1 : 0))
}
/** Tahsilat yöntemleri: saklanan değer Türkçe etikettir (örnek veri ve mevcut kayıtlar aynı metni taşır). */
export const PAYMENT_METHODS = ['Banka havalesi', 'Nakit', 'Kredi kartı', 'Senet'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]
/** Yöntem değeri → kullanıcıya gösterilen Türkçe etiket. */
export const PAYMENT_METHOD_LABELS = {
  'Banka havalesi': 'Banka havalesi',
  Nakit: 'Nakit',
  'Kredi kartı': 'Kredi kartı',
  Senet: 'Senet',
} as const satisfies Record<PaymentMethod, string>
/**
 * Dosyadan aktarılan geçmiş ödemenin taksit işareti (DOM-FIN-014): taksit ödenmiştir ama Kampüs'te
 * tahsilat kaydı yoktur, kasayı ve dönem tahsilatını değiştirmez. `PAYMENT_METHODS`'a girmez: hiçbir
 * tahsilat bu yöntemle alınamaz, `payments` tablosuna yazılamaz. Yalnız taksitin `method` alanında
 * bulunur; `paidAt` ile `method` birlikte dolu kuralı (ADR 0010) böylece sahte yöntem gerektirmez.
 */
export const OPENING_IMPORT_METHOD = 'Açılış aktarımı'
/** Taksitin `method` alanının alabileceği değerler. */
export const INVOICE_METHODS = [...PAYMENT_METHODS, OPENING_IMPORT_METHOD] as const
export type InvoiceMethod = (typeof INVOICE_METHODS)[number]
/** Taksit dosyadan aktarılmış geçmiş ödeme mi; ödendi görünür, tahsilat sayılmaz. */
export const isOpeningImport = (invoice: { method?: string | null }): boolean =>
  invoice.method === OPENING_IMPORT_METHOD
/** Tahsilat girdisi; API gövde şeması ve web/mobil form şemasıdır. */
export const paymentInputSchema = z.object({
  method: z.enum(PAYMENT_METHODS, 'Ödeme yöntemini seçin.'),
})
export type PaymentInput = z.input<typeof paymentInputSchema>
/**
 * @deprecated Yalnız çevrimdışı demo; yeni kod `planPayment` ve `recordPaymentSchema` kullanır.
 * Demo yolu `payments-demo.ts`'tedir; bu köprü Oğuzhan'ın alanındaki tüketiciler (mobil
 * `apps/mobile/src/model/operations.ts`, API işlem koşucusu testleri, `tests/commands.test.ts`) bu
 * yoldan içe aktardığı için durur.
 * TODO(demo-kalicilik): OG-074 (mobil yalnız API) ve köprü tüketicileri `payments-demo.ts`'e geçince silinir.
 */
export { payInvoice } from './payments-demo.ts'

const CASH: PaymentMethod = 'Nakit'
const PROMISSORY_NOTE: PaymentMethod = 'Senet'

/** Bursluya burs belgeleri dışında senet ve taahhüt düzenlenmez (DOM-FIN-025). */
export const hasScholarshipContract = (
  contracts: readonly { studentId: string; scholarship?: unknown }[],
  studentId: string,
): boolean =>
  contracts.some(
    (contract) => contract.studentId === studentId && contract.scholarship !== undefined,
  )

/** Banka kanalından geçmeyen yöntem hesaba bağlanmaz (DOM-FIN-032). */
export const usesBankAccount = (method: PaymentMethod): boolean =>
  method !== CASH && method !== PROMISSORY_NOTE
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
  bankAccountId: requiredText.optional(),
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

/** Kurumun bildirilmiş banka hesabı (DOM-FIN-032); kişi verisi değil, kurum hesabıdır. */
export const bankAccountSchema = z.strictObject({
  bankName: z
    .string()
    .trim()
    .min(2, 'Banka adını girin.')
    .max(100, 'Banka adı en fazla 100 karakter olabilir.'),
  iban: z
    .string()
    .transform((value) => value.replace(/\s/g, '').toUpperCase())
    .refine(isValidTurkishIban, 'Geçerli bir IBAN girin.'),
  accountHolder: z
    .string()
    .trim()
    .min(2, 'Hesap sahibini girin.')
    .max(200, 'Hesap sahibi en fazla 200 karakter olabilir.'),
})
export type BankAccountInput = z.input<typeof bankAccountSchema>

/** Listede ve dekontta hesabın kısa adı: IBAN'ın son dört hanesi ayırt etmeye yeter. */
export function bankAccountLabel(account: { bankName: string; iban: string }): string {
  return `${account.bankName} · ${account.iban.slice(-4)}`
}

export const paymentMebbisSchema = z.strictObject({ recorded: z.boolean() })

/** İptal edilen tahsilat MEBBİS takibinden çıkar; işareti değişmez (DOM-FIN-032, -033). */
export function assertMebbisChangeAllowed(payment: { reversedAt: string | null }): void {
  if (payment.reversedAt !== null)
    throw new DomainError('payment_already_reversed', 'Bu tahsilat iptal edilmiş.', {
      kind: 'conflict',
    })
}

const MAX_AMOUNT_CENTS = 100_000_000

/**
 * Kullanıcı tutarını kuruşa çevirir: `1.234,56`, `1234,56`, `1234.5`. En fazla iki ondalık kabul
 * edilir, hesap metin üzerindendir (DOM-FIN-001). Geçersiz, sıfır veya üst sınır üstü `null`.
 */
export function parseAmountInput(text: string): number | null {
  const value = text.trim()
  const grouped = /^[1-9]\d{0,2}(?:\.\d{3})+(?:,\d{1,2})?$/.test(value)
  if (!grouped && !/^\d+(?:[.,]\d{1,2})?$/.test(value)) return null
  const [whole = '', fraction = ''] = (grouped ? value.replaceAll('.', '') : value).split(/[.,]/)
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents > 0 && cents <= MAX_AMOUNT_CENTS ? cents : null
}

/** Kuruşu form alanına yazılacak metne çevirir (`1234,56`). */
export const amountInputValue = csvAmount

/** Tahsilat formu (web): tutar metindir, gönderimde kuruşa çevrilir. */
export const paymentFormSchema = z
  .object({
    amount: z.string().refine((value) => parseAmountInput(value) !== null, {
      message: 'Tutarı 1.234,56 biçiminde girin (en fazla 1.000.000 ₺).',
    }),
    method: z.enum(PAYMENT_METHODS, 'Ödeme yöntemini seçin.'),
    reference: z.string().trim().max(100),
    paidDate: daySchema,
    bankAccountId: z.string(),
  })
  .superRefine((value, context) => {
    if (value.method !== CASH && value.reference.length < 3)
      context.addIssue({
        code: 'custom',
        path: ['reference'],
        message: 'İşlem referansını girin (en az 3 karakter).',
      })
  })
export type PaymentFormValues = z.output<typeof paymentFormSchema>

export type PaymentAllocation = { invoiceId: string; amountCents: number }

export interface PaymentContext {
  /** Taksit kimliği → iptal edilmemiş tahsilatlardan dağıtılmış tutar. */
  allocated: ReadonlyMap<string, number>
  cashEnabled: boolean
  /** Referans başka bir iptal edilmemiş tahsilatta kullanılmış mı. */
  referenceInUse: boolean
  /** Kurumun arşivlenmemiş bildirilmiş hesapları. */
  bankAccountIds: readonly string[]
  now: string
}

export interface PaymentPlan {
  studentId: string
  amountCents: number
  method: PaymentMethod
  reference: string | null
  bankAccountId: string | null
  paidAt: string
  allocations: PaymentAllocation[]
}

type Invoice = State['invoices'][number]

/** Taksitin açık tutarı. Tahsilat kaydı olmadan ödenmiş eski taksit tam ödenmiş sayılır. */
export function openAmount(
  invoice: Pick<Invoice, 'id' | 'amount' | 'paidAt'>,
  allocated: ReadonlyMap<string, number>,
): number {
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
/**
 * Hesap tanımlıysa nakit dışı tahsilat bu hesaplardan birine bağlanır (DOM-FIN-032). Hiç hesap
 * tanımlamamış kurum tahsilat alabilir; ayarlar ekranı eksik hesabı uyarır.
 */
function resolveBankAccount(
  data: { bankAccountId?: string | undefined },
  context: PaymentContext,
): string | null {
  const id = data.bankAccountId ?? null
  if (id === null && context.bankAccountIds.length > 0)
    throw new DomainError('bank_account_required', 'Tahsilatın yapıldığı banka hesabını seçin.', {
      path: ['bankAccountId'],
    })
  if (id !== null && !context.bankAccountIds.includes(id))
    throw new DomainError('bank_account_invalid', 'Seçilen banka hesabı kullanılamıyor.', {
      path: ['bankAccountId'],
    })
  return id
}

export function planPayment(state: State, input: unknown, context: PaymentContext): PaymentPlan {
  const data = recordPaymentSchema.parse(input)
  const reference = data.reference ?? null
  if (data.method === CASH && !context.cashEnabled)
    throw new DomainError('cash_payment_disabled', 'Bu kurumda nakit tahsilat kapalıdır.', {
      path: ['method'],
    })
  if (reference === null && data.method !== CASH)
    throw new DomainError('payment_reference_required', 'İşlem referansını girin.', {
      path: ['reference'],
    })
  const bankAccountId = usesBankAccount(data.method) ? resolveBankAccount(data, context) : null
  if (data.method === PROMISSORY_NOTE && hasScholarshipContract(state.contracts, data.studentId))
    throw new DomainError('scholarship_promissory_note', 'Burslu öğrenciden senet alınamaz.', {
      path: ['method'],
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
    bankAccountId,
    paidAt,
    allocations,
  }
}

/** Öğrencinin ayrılış kaydından tahsilat iptalinin ihtiyaç duyduğu kısım (DOM-FIN-041). */
export interface ReversalWithdrawal {
  /** Ayrılışta kalan borç için açılan taksit; borç yoksa ya da eski kayıtta `null`. */
  debtInvoiceId: string | null
}

/**
 * Tahsilat ayrılış hesabının dışında mı (DOM-FIN-041): yalnız ayrılışta açılan borç taksitlerine
 * dağıtılmış tahsilat ayrılıştan sonra alınmıştır, çünkü o taksitler ayrılıştan önce yoktu. Ayrılış
 * öncesi tahsilat dökümdeki ödenen tutara girer; iptali iadeyi ya da borcu geçersiz kılar.
 */
function isAfterWithdrawal(
  allocations: readonly PaymentAllocation[],
  withdrawals: readonly ReversalWithdrawal[],
): boolean {
  const debtIds = new Set(withdrawals.flatMap((item) => item.debtInvoiceId ?? []))
  return (
    allocations.length > 0 && allocations.every((allocation) => debtIds.has(allocation.invoiceId))
  )
}

/**
 * Tahsilat iptali: dağıtıldığı taksitleri yeniden açar (DOM-FIN-033). Dağılım taksit tutarını
 * aşmadığı için iptalden sonra taksit tam ödenmiş kalamaz. Ayrılmış öğrencide yalnız ayrılıştan
 * sonra kalan borca alınan tahsilat iptal edilir; borç taksiti yeniden açılır (DOM-FIN-041).
 */
export function reversePayment(
  state: State,
  payment: {
    reversedAt: string | null
    allocations: readonly PaymentAllocation[]
    /** Öğrencinin ayrılış kayıtları; iade ya da borç hesabı ayrılış öncesi tahsilata dayanır. */
    withdrawals?: readonly ReversalWithdrawal[]
  },
  input: unknown,
): { reason: string } {
  const { reason } = reversePaymentSchema.parse(input)
  if (payment.reversedAt !== null)
    throw new DomainError('payment_already_reversed', 'Bu tahsilat zaten iptal edilmiş.', {
      kind: 'conflict',
    })
  const withdrawals = payment.withdrawals ?? []
  if (withdrawals.length > 0 && !isAfterWithdrawal(payment.allocations, withdrawals))
    throw new DomainError(
      'payment_student_withdrawn',
      'Ayrılış hesabına giren tahsilat iptal edilemez; yalnız ayrılıştan sonra kalan borca alınan tahsilat iptal edilebilir.',
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
