import { randomUUID } from 'node:crypto'

import { connectPostgres } from '../../../apps/api/src/db/client.ts'
import { studentWithdrawals } from '../../../apps/api/src/db/schema/withdrawals.ts'
import type { WithdrawalBreakdown } from '../../../packages/school-core/src/lib/withdrawals.ts'

import { e2e } from './env.ts'

/** İstanbul günü (`YYYY-MM-DD`); iade ve asıl fatura günleri sunucunun gününe göre seçilir. */
export const istanbulDay = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(date)

/**
 * İade belgesi ekranı için bugün ödenmiş ayrılış iadesi (DOM-FIN-041, DOM-FIN-096). Ayrılış akışı
 * kendi testindedir; burada yalnız ödenmiş iade kaydı ve listede gösterilecek tutarlı döküm gerekir.
 */
export async function seedPaidRefund(input: {
  institutionId: string
  studentId: string
  refundCents: number
}): Promise<string> {
  const { db, close } = connectPostgres(e2e.databaseUrl)
  const id = randomUUID()
  const today = istanbulDay()
  try {
    await db.insert(studentWithdrawals).values({
      institutionId: input.institutionId,
      id,
      studentId: input.studentId,
      contractId: `e2e-iade-belgesi-${id}`,
      withdrawalDate: today,
      reason: 'relocation',
      breakdown: {
        institutionType: 'school',
        withdrawalDate: today,
        termStartDate: today,
        started: false,
        attendedUnits: 0,
        totalUnits: 180,
        publicSchoolExemption: false,
        deductionBasisPoints: 1000,
        baseCents: input.refundCents * 2,
        deductionCents: input.refundCents / 5,
        usageCents: 0,
        entitledCents: input.refundCents / 5,
        paidCents: input.refundCents + input.refundCents / 5,
        creditCents: 0,
        extras: [],
        refundCents: input.refundCents,
        debtCents: 0,
      } satisfies WithdrawalBreakdown,
      refundCents: input.refundCents,
      debtCents: 0,
      refundDueDate: today,
      approvedByUserId: 'e2e-yonetici',
      refundPaidDate: today,
    })
  } finally {
    await close()
  }
  return id
}
