// Burs programı formunun saf mantığı (DOM-FIN-025): metin alanları çekirdek şemayla doğrulanır,
// oran yüzde, tutar ₺ olarak girilir ve gövdeye on binde birlik ve kuruş olarak çevrilir.
import { z } from 'zod'
import { money } from '@kampus/school-core/lib/format.ts'
import {
  createScholarshipProgramSchema,
  type CreateScholarshipProgramInput,
} from '@kampus/school-core/lib/finance-scholarships.ts'
import { parseAmountInput } from '@kampus/school-core/lib/payments.ts'

const shape = createScholarshipProgramSchema.shape

/** "25" ya da "12,5" → on binde birlik; geçersiz ya da aralık dışıysa `null`. */
export function parsePercentInput(text: string): number | null {
  const value = text.trim()
  if (!/^\d{1,3}(?:[.,]\d{1,2})?$/.test(value)) return null
  const points = Math.round(Number(value.replace(',', '.')) * 100)
  return points >= 1 && points <= 10_000 ? points : null
}

export const programFormSchema = z
  .object({
    name: shape.name,
    conditions: shape.conditions,
    terminationConditions: shape.terminationConditions,
    durationNote: shape.durationNote,
    valueKind: z.enum(['percent', 'amount']),
    percent: z.string(),
    amount: z.string(),
    capacity: z.string().regex(/^[1-9]\d{0,4}$/, 'Burslu sayısını girin.'),
  })
  .superRefine((value, context) => {
    if (value.valueKind === 'percent' && parsePercentInput(value.percent) === null)
      context.addIssue({
        code: 'custom',
        path: ['percent'],
        message: 'Oranı 0,01 ile 100 arasında girin.',
      })
    if (value.valueKind === 'amount' && parseAmountInput(value.amount) === null)
      context.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'Tutarı 1.234,56 biçiminde girin.',
      })
  })
export type ProgramFormValues = z.input<typeof programFormSchema>

export const programDefaults = (): ProgramFormValues => ({
  name: '',
  conditions: '',
  terminationConditions: '',
  durationNote: 'Bir eğitim yılı',
  valueKind: 'percent',
  percent: '',
  amount: '',
  capacity: '',
})

export function programBody(
  values: z.output<typeof programFormSchema>,
  academicYear: number,
): CreateScholarshipProgramInput {
  const shared = {
    academicYear,
    name: values.name,
    conditions: values.conditions,
    terminationConditions: values.terminationConditions,
    durationNote: values.durationNote,
    capacity: Number(values.capacity),
  }
  return values.valueKind === 'percent'
    ? { ...shared, percentBasisPoints: parsePercentInput(values.percent) ?? 0 }
    : { ...shared, amountCents: parseAmountInput(values.amount) ?? 0 }
}

/** Programın miktarı: `%25` ya da `1.000,00 ₺`. */
export const programValueLabel = (program: {
  percentBasisPoints: number | null
  amountCents: number | null
}) =>
  program.amountCents === null
    ? `%${String((program.percentBasisPoints ?? 0) / 100).replace('.', ',')}`
    : money(program.amountCents)

/** Kesin kayıtta seçilebilen programlar: bildirilmiş ve kontenjanı dolmamış (DOM-FIN-025). */
export const awardablePrograms = <
  T extends { notifiedDate: string | null; awardedCount: number; capacity: number },
>(
  programs: readonly T[],
): T[] =>
  programs.filter(
    (program) => program.notifiedDate !== null && program.awardedCount < program.capacity,
  )
