// Burs fonu formlarının saf mantığı (DOM-FIN-068; ON-259): alan kuralları core şemasındandır;
// tutar ₺ olarak girilir ve gövdeye kuruş olarak çevrilir. Boş isteğe bağlı alan gövdeye girmez.
import { z } from 'zod'
import type {
  CreateScholarshipFundBody,
  ScholarshipFundAllocationBody,
  ScholarshipFundDonationBody,
} from '@kampus/react-shared/use-finance-scholarship-funds.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  SCHOLARSHIP_FUND_AMOUNT_MAX,
  SCHOLARSHIP_FUND_CHANNELS,
  SCHOLARSHIP_FUND_DESCRIPTION_MAX,
  SCHOLARSHIP_FUND_DONOR_KINDS,
  SCHOLARSHIP_FUND_DONOR_MAX,
  SCHOLARSHIP_FUND_NAME_MAX,
  SCHOLARSHIP_FUND_NOTE_MAX,
  scholarshipFundCancelSchema,
} from '@kampus/school-core/lib/finance-scholarship-funds.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import { parseAmountInput } from '@kampus/school-core/lib/payments.ts'

const limited = (max: number) =>
  z.string().max(max, `En fazla ${String(max)} karakter girebilirsiniz.`)
const amountField = z
  .string()
  .refine(
    (value) => parseAmountInput(value, { maxCents: SCHOLARSHIP_FUND_AMOUNT_MAX }) !== null,
    'Tutarı 1.234,56 biçiminde girin.',
  )
const amountCents = (value: string) =>
  parseAmountInput(value, { maxCents: SCHOLARSHIP_FUND_AMOUNT_MAX }) ?? 0

export const fundFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Fon adını yazın.')
      .max(SCHOLARSHIP_FUND_NAME_MAX, `En fazla ${String(SCHOLARSHIP_FUND_NAME_MAX)} karakter.`),
    description: limited(SCHOLARSHIP_FUND_DESCRIPTION_MAX),
    donorKind: z.enum(SCHOLARSHIP_FUND_DONOR_KINDS),
    donorName: limited(SCHOLARSHIP_FUND_DONOR_MAX),
  })
  .superRefine((value, context) => {
    if (value.donorKind !== 'anonymous' && value.donorName.trim().length < 2)
      context.addIssue({
        code: 'custom',
        path: ['donorName'],
        message: 'Bağışçının adını ya da kurum adını yazın.',
      })
  })
export type FundFormValues = z.input<typeof fundFormSchema>

export const fundDefaults = (): FundFormValues => ({
  name: '',
  description: '',
  donorKind: 'organization',
  donorName: '',
})

/** Anonim bağışta ad gönderilmez (K-95); boş açıklama gövdeye girmez. */
export function fundBody(values: FundFormValues): CreateScholarshipFundBody {
  const description = values.description.trim()
  const donorName = values.donorName.trim()
  return {
    name: values.name.trim(),
    donorKind: values.donorKind,
    ...(description === '' ? {} : { description }),
    ...(values.donorKind === 'anonymous' || donorName === '' ? {} : { donorName }),
  }
}

export const donationFormSchema = z.object({
  amount: amountField,
  donatedOn: daySchema,
  channel: z.enum(SCHOLARSHIP_FUND_CHANNELS),
  note: limited(SCHOLARSHIP_FUND_NOTE_MAX),
})
export type DonationFormValues = z.input<typeof donationFormSchema>

export const donationDefaults = (today: string): DonationFormValues => ({
  amount: '',
  donatedOn: today,
  channel: 'bank_transfer',
  note: '',
})

export function donationBody(values: DonationFormValues): ScholarshipFundDonationBody {
  const note = values.note.trim()
  return {
    amountCents: amountCents(values.amount),
    donatedOn: values.donatedOn,
    channel: values.channel,
    ...(note === '' ? {} : { note }),
  }
}

export const allocationFormSchema = z.object({
  awardId: z.string().min(1, 'Burs atamasını seçin.'),
  amount: amountField,
})
export type AllocationFormValues = z.input<typeof allocationFormSchema>

export const allocationBody = (values: AllocationFormValues): ScholarshipFundAllocationBody => ({
  awardId: values.awardId,
  amountCents: amountCents(values.amount),
})

export const cancelFormSchema = scholarshipFundCancelSchema
export type CancelFormValues = z.input<typeof cancelFormSchema>

/** Sunucu alan hatasının form alanı; bilinmeyen alan kök hatasıdır. */
export const formField = <T extends string>(fields: readonly T[], name: string): T | undefined =>
  fields.find((field) => field === name)

/** Burs atamasının seçim etiketi: öğrenci · yıl · tutar. */
export const awardOptionLabel = (
  award: { studentId: string; academicYear: number; amountCents: number },
  names: ReadonlyMap<string, string>,
) =>
  `${names.get(award.studentId) ?? 'Öğrenci'} · ${String(award.academicYear)}-${String(award.academicYear + 1)} · ${money(award.amountCents)}`
