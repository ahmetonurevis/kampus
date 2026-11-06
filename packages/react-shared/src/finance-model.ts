// Finans & Tahsilat listesinin web ile mobilde ortak kuralları (ADR 0006, DOM-FIN-030…032): taksit
// satırı, durum süzgeci ve tahsilat gövdesi. Saf işlevlerdir: API satırı ya da form değeri girer,
// ekran satırı ya da istek gövdesi çıkar. Ödeme kuralları core'dadır (`lib/payments.ts`).
import type { State } from '@kampus/school-core/data/seed.ts'
import {
  dayKey,
  INVOICE_STATUS_KEYS,
  INVOICE_STATUS_LABELS,
  invoiceStatusKey,
  type InvoiceStatus,
  type InvoiceStatusKey,
} from '@kampus/school-core/lib/format.ts'
import {
  parseAmountInput,
  usesBankAccount,
  type PaymentFormValues,
} from '@kampus/school-core/lib/payments.ts'

import type { CollectionRow } from './collections.ts'
import type { RecordPaymentBody } from './use-payment-commands.ts'

/** Durum seçenekleri; web adresinde core durum anahtarıyla taşınır (`?durum=gecikmis`). */
export const INVOICE_STATUS_OPTIONS = INVOICE_STATUS_KEYS.map((key) => ({
  key,
  label: INVOICE_STATUS_LABELS[key],
}))

export function isInvoiceStatusKey(value: unknown): value is InvoiceStatusKey {
  return typeof value === 'string' && (INVOICE_STATUS_KEYS as readonly string[]).includes(value)
}

export const PARTIAL_STATUS = 'Kısmi ödendi'

export type InvoiceRow = {
  id: string
  version: number
  studentId: string
  /** Kapsam dışı öğrencide "—". */
  studentName: string
  /** Okul numarası; kapsam dışında veya saklanmamışsa "—". */
  studentNumber: string
  className: string
  installment: number
  dueDate: string
  /** Kuruş. */
  amount: number
  paidAt: string | null
  method: string | null
  /** Vadesi gelmemiş, kısmen ödenmiş taksit `Kısmi ödendi`; gecikmiş olan gecikmiş kalır. */
  status: InvoiceStatus | typeof PARTIAL_STATUS
  /** Açık taksite dağıtılmış tutar; kuruş. */
  paidCents: number
  /** Son hatırlatmanın anı (DOM-FIN-035); hatırlatılmadıysa `null`. */
  reminderAt: string | null
}

/** `today` Europe/Istanbul günüdür; durum vadesi geçmiş ödenmemiş taksitte "Gecikmiş". */
export function invoiceRow(
  item: CollectionRow<State['invoices'][number]>,
  today: string,
): InvoiceRow {
  const invoice = item.record
  const key = invoiceStatusKey(invoice, today)
  const paidCents = invoice.paidCents ?? 0
  return {
    id: invoice.id,
    version: item.version,
    studentId: invoice.studentId,
    studentName: item.joined?.studentName ?? '—',
    studentNumber: item.joined?.studentNumber ?? '—',
    className: item.joined?.className ?? '—',
    installment: invoice.installment,
    dueDate: invoice.dueDate,
    amount: invoice.amount,
    paidAt: invoice.paidAt ?? null,
    method: invoice.method ?? null,
    status: key === 'yaklasan' && paidCents > 0 ? PARTIAL_STATUS : INVOICE_STATUS_LABELS[key],
    paidCents,
    reminderAt: invoice.reminderAt ?? null,
  }
}

/** Elle hatırlatma yalnız gecikmiş taksittedir (DOM-FIN-035, ON-113; kural API'dedir). */
export const canRemindInvoice = (row: Pick<InvoiceRow, 'status'>) =>
  row.status === INVOICE_STATUS_LABELS.gecikmis

/** Taksite bugün hatırlatma gitti mi: günde bir hatırlatma; `today` Europe/Istanbul günü. */
export const remindedOn = (row: Pick<InvoiceRow, 'reminderAt'>, today: string) =>
  row.reminderAt !== null && dayKey(row.reminderAt) === today

/**
 * Tahsilat formundan `POST /payments` gövdesi (DOM-FIN-030…032). Nakitte referans yoktur; banka
 * hesabı yalnız hesap kullanan yöntemde ve seçiliyse gider. Bugün için gün gönderilmez: tahsilat
 * kayıt anını taşır. Tutar geçersizse `null`; form şeması bunu göndermeden önce yakalar.
 */
export function recordPaymentBody(
  invoice: Pick<InvoiceRow, 'id' | 'studentId'>,
  values: PaymentFormValues,
  today: string,
): RecordPaymentBody | null {
  const amountCents = parseAmountInput(values.amount)
  if (amountCents === null) return null
  const { method, reference, paidDate, bankAccountId } = values
  return {
    studentId: invoice.studentId,
    invoiceId: invoice.id,
    amountCents,
    method,
    ...(method === 'Nakit' ? {} : { reference }),
    ...(!usesBankAccount(method) || bankAccountId === '' ? {} : { bankAccountId }),
    ...(paidDate === today ? {} : { paidDate }),
  }
}
