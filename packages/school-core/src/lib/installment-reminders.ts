import { z } from 'zod'

import { dayKey } from './format.ts'
import { openAmount } from './payments.ts'

/**
 * Vade ve gecikme hatırlatması kuralı (IST-109; docs/domain/finans.md DOM-FIN-034, DOM-FIN-035).
 * Saf karar: hangi taksit için hangi bildirim. Gün Europe/Istanbul takvimine göredir. Tam ödenmiş
 * taksit (`openAmount` sıfır) hatırlatılmaz, kısmi ödenmiş taksit açık sayılır.
 *
 * Bir taksite bir vade günü için en çok iki hatırlatma gider: vade öncesi (`installment_due`) ve
 * gecikme (`installment_overdue`). Anahtar taksit ve vade gününden türer; iki pencere kesişmediği
 * için aynı taksite aynı gün ikinci bildirim gitmez.
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
})

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000

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
    reminders.push({
      type: daysLeft < 0 ? 'installment_overdue' : 'installment_due',
      invoiceId: invoice.id,
      studentId: invoice.studentId,
      dedupeKey: `${invoice.id}:${dueDay}`,
    })
  }
  return { reminders, invalid }
}
