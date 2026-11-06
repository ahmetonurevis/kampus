import { z } from 'zod'

import { DomainError } from './errors.ts'
import { dayKey } from './format.ts'
import { openAmount } from './payments.ts'

/**
 * Vade ve gecikme hatırlatması kuralı (IST-109; docs/domain/finans.md DOM-FIN-034, DOM-FIN-035).
 * Saf karar: hangi taksit için hangi bildirim. Gün Europe/Istanbul takvimine göredir. Tam ödenmiş
 * taksit (`openAmount` sıfır) hatırlatılmaz, kısmi ödenmiş taksit açık sayılır.
 *
 * Tarama bir taksite bir vade günü için en çok iki hatırlatma gönderir: vade öncesi
 * (`installment_due`) ve gecikme (`installment_overdue`). Anahtar taksit ve vade gününden türer; iki
 * pencere kesişmediği için aynı taksite aynı gün ikinci bildirim gitmez. Personelin elle hatırlatması
 * (ON-113) yalnız gecikmiş taksittedir ve günde birdir; tarama aynı gün elle hatırlatılan taksiti
 * atlar, elle hatırlatma aynı gün taramanın gönderdiği taksite ikinci bildirim yazmaz.
 */

/** Vade öncesi hatırlatma penceresi (gün); vade günü dahil. */
export const INSTALLMENT_DUE_SOON_DAYS = 3

export type InstallmentReminderType = 'installment_due' | 'installment_overdue'

export type InstallmentReminder = {
  type: InstallmentReminderType
  invoiceId: string
  studentId: string
  /** Taksit ve vade günü; aynı olay aynı alıcıya ikinci kez yazılmaz (`notify` `dedupeKey`). */
  dedupeKey: string
}

const invoiceFacts = z.object({
  id: z.string().min(1),
  studentId: z.string().min(1),
  amount: z.number().int(),
  paidAt: z.string().nullable().optional(),
  dueDate: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  reminderAt: z.string().nullable().optional(),
})

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000

/** Taramanın anahtarı: taksit ve vade günü; aynı olay aynı alıcıya ikinci kez yazılmaz. */
export const scanReminderKey = (invoice: { id: string; dueDate: string }) =>
  `${invoice.id}:${dayKey(invoice.dueDate)}`

/**
 * Bugün gidecek hatırlatmalar. Taksit kaydı dışarıdan (JSON kayıt) gelir: biçimi bozuk taksit
 * bütün taramayı durdurmaz, atlanır ve `invalid` sayısına girer.
 */
export function installmentReminders(
  invoices: readonly unknown[],
  allocated: ReadonlyMap<string, number>,
  now: string | Date,
): { reminders: InstallmentReminder[]; invalid: number } {
  const today = dayNumber(dayKey(now))
  const reminders: InstallmentReminder[] = []
  let invalid = 0
  for (const candidate of invoices) {
    const parsed = invoiceFacts.safeParse(candidate)
    if (!parsed.success) {
      invalid += 1
      continue
    }
    const invoice = parsed.data
    if (openAmount({ ...invoice, paidAt: invoice.paidAt ?? null }, allocated) === 0) continue
    const dueDay = dayKey(invoice.dueDate)
    const daysLeft = dayNumber(dueDay) - today
    if (daysLeft > INSTALLMENT_DUE_SOON_DAYS) continue
    // Personel bugün elle hatırlattı: günde bir hatırlatma; tarama sonraki gün gönderir.
    if (invoice.reminderAt && dayKey(invoice.reminderAt) === dayKey(now)) continue
    reminders.push({
      type: daysLeft < 0 ? 'installment_overdue' : 'installment_due',
      invoiceId: invoice.id,
      studentId: invoice.studentId,
      dedupeKey: scanReminderKey(invoice),
    })
  }
  return { reminders, invalid }
}

export type ManualInstallmentReminder = {
  /** Yazılacak bildirim; bugün zaten hatırlatıldıysa `null`. */
  reminder: InstallmentReminder | null
  /** Taksitin `reminderAt` değeri: bugünkü gönderimin anı. */
  reminderAt: string
}

/**
 * Personelin gecikmiş taksitte elle hatırlatması (DOM-FIN-035, ON-113; Vue `Finance.vue` `remind`).
 * Tam ödenmiş (`invoice_already_paid`) ve vadesi geçmemiş (`invoice_not_overdue`) taksit 422'dir;
 * kısmi ödenmiş gecikmiş taksit hatırlatılır. Günde bir hatırlatma: bugün elle hatırlatıldıysa ya da
 * tarama bugün gönderdiyse (`scanSentAt`) bildirim yazılmaz, `reminderAt` bugünkü gönderimi gösterir.
 * Anahtar günü taşır: ertesi gün yeniden hatırlatılabilir, tekrar istek aynı gün yeni bildirim yazmaz.
 */
export function manualInstallmentReminder(
  invoice: {
    id: string
    studentId: string
    amount: number
    paidAt?: string | null | undefined
    dueDate: string
    reminderAt?: string | null | undefined
  },
  allocated: ReadonlyMap<string, number>,
  now: string,
  scanSentAt: string | null = null,
): ManualInstallmentReminder {
  if (openAmount({ ...invoice, paidAt: invoice.paidAt ?? null }, allocated) === 0)
    throw new DomainError('invoice_already_paid', 'Bu taksit ödenmiş; hatırlatma gönderilmez.')
  const today = dayKey(now)
  if (dayKey(invoice.dueDate) >= today)
    throw new DomainError(
      'invoice_not_overdue',
      'Vadesi gelmemiş taksit için hatırlatma gönderilmez.',
    )
  if (invoice.reminderAt && dayKey(invoice.reminderAt) === today)
    return { reminder: null, reminderAt: invoice.reminderAt }
  if (scanSentAt !== null && dayKey(scanSentAt) === today)
    return { reminder: null, reminderAt: scanSentAt }
  return {
    reminder: {
      type: 'installment_overdue',
      invoiceId: invoice.id,
      studentId: invoice.studentId,
      dedupeKey: `${invoice.id}:manual:${today}`,
    },
    reminderAt: now,
  }
}
