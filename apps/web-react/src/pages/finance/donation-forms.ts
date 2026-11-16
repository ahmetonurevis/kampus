// Bağış formlarının saf mantığı (DOM-FIN-097; ON-258): alan kuralları core şemasındandır; tutar ₺
// olarak girilir ve gövdeye kuruş olarak çevrilir. Boş isteğe bağlı alan oluştururken gövdeye
// girmez, düzeltirken `null` olarak alanı temizler.
import { z } from 'zod'
import type {
  CreateDonationCampaignBody,
  CreateDonorBody,
  DonationBody,
  DonationCampaign,
  DonationSettingsBody,
  UpdateDonorBody,
} from '@kampus/react-shared/use-finance-donations.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  DONATION_AMOUNT_MAX,
  DONATION_CAMPAIGN_NAME_MAX,
  DONATION_CAMPAIGN_PURPOSE_MAX,
  DONATION_DESCRIPTION_MAX,
  DONATION_KINDS,
  DONATION_METHODS,
  DONATION_NOTE_MAX,
  DONATION_REFERENCE_MAX,
  DONATION_TAX_NOTICE_MAX,
  DONATION_TAX_NOTICE_MIN,
  donationCancelSchema,
  DONOR_ADDRESS_MAX,
  DONOR_KINDS,
  DONOR_NAME_MAX,
  DONOR_RELATIONS,
  donorIdentityIssue,
} from '@kampus/school-core/lib/finance-donations.ts'
import { amountInputValue, parseAmountInput } from '@kampus/school-core/lib/payments.ts'

const limited = (max: number) =>
  z.string().max(max, `En fazla ${String(max)} karakter girebilirsiniz.`)
const parse = (value: string) => parseAmountInput(value, { maxCents: DONATION_AMOUNT_MAX })
const amountField = z
  .string()
  .refine((value) => parse(value) !== null, 'Tutarı 1.234,56 biçiminde girin.')
const optionalAmount = z
  .string()
  .refine(
    (value) => value.trim() === '' || parse(value) !== null,
    'Tutarı 1.234,56 biçiminde girin.',
  )
const cents = (value: string) => parse(value) ?? 0
const optionalText = (value: string) => {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Sunucu alan hatasının form alanı; bilinmeyen alan kök hatasıdır. */
export const formField = <T extends string>(fields: readonly T[], name: string): T | undefined =>
  fields.find((field) => field === name)

// --- Kampanya ------------------------------------------------------------------------------------

export const campaignFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Kampanya adını yazın.')
      .max(DONATION_CAMPAIGN_NAME_MAX, `En fazla ${String(DONATION_CAMPAIGN_NAME_MAX)} karakter.`),
    purpose: z
      .string()
      .trim()
      .min(5, 'Kampanyanın amacını yazın.')
      .max(
        DONATION_CAMPAIGN_PURPOSE_MAX,
        `En fazla ${String(DONATION_CAMPAIGN_PURPOSE_MAX)} karakter.`,
      ),
    target: amountField,
    startsOn: daySchema,
    endsOn: daySchema,
    bankAccountId: z.string(),
  })
  .superRefine((value, context) => {
    if (value.endsOn < value.startsOn)
      context.addIssue({
        code: 'custom',
        path: ['endsOn'],
        message: 'Bitiş günü başlangıçtan önce olamaz.',
      })
  })
export type CampaignFormValues = z.input<typeof campaignFormSchema>

export const campaignDefaults = (today: string): CampaignFormValues => ({
  name: '',
  purpose: '',
  target: '',
  startsOn: today,
  endsOn: today,
  bankAccountId: '',
})

export const campaignValues = (campaign: DonationCampaign): CampaignFormValues => ({
  name: campaign.name,
  purpose: campaign.purpose,
  target: amountInputValue(campaign.targetCents),
  startsOn: campaign.startsOn,
  endsOn: campaign.endsOn,
  bankAccountId: campaign.bankAccountId ?? '',
})

/** Oluşturma ve düzeltme aynı alanları gönderir; hesap seçilmezse kampanya hesapsızdır. */
export const campaignBody = (values: CampaignFormValues): CreateDonationCampaignBody => ({
  name: values.name.trim(),
  purpose: values.purpose.trim(),
  targetCents: cents(values.target),
  startsOn: values.startsOn,
  endsOn: values.endsOn,
  bankAccountId: values.bankAccountId === '' ? null : values.bankAccountId,
})

// --- Bağışçı -------------------------------------------------------------------------------------

export const donorFormSchema = z
  .object({
    kind: z.enum(DONOR_KINDS),
    name: z
      .string()
      .trim()
      .min(2, 'Bağışçının adını ya da kurum adını yazın.')
      .max(DONOR_NAME_MAX, `En fazla ${String(DONOR_NAME_MAX)} karakter.`),
    identityNumber: z.string(),
    phone: z
      .string()
      .refine(
        (value) => value.trim() === '' || /^0\d{10}$/.test(value.trim()),
        'Telefonu 0XXXXXXXXXX biçiminde, 11 haneli girin.',
      ),
    email: z
      .string()
      .refine(
        (value) => value.trim() === '' || z.email().safeParse(value.trim()).success,
        'Geçerli bir e-posta adresi girin.',
      ),
    address: limited(DONOR_ADDRESS_MAX).refine(
      (value) => value.trim() === '' || value.trim().length >= 10,
      'Adresi en az 10 karakterle yazın.',
    ),
    studentId: z.string(),
    relation: z.enum(['', ...DONOR_RELATIONS]),
  })
  .superRefine((value, context) => {
    const identity = value.identityNumber.trim()
    const issue = identity === '' ? null : donorIdentityIssue(value.kind, identity)
    if (issue !== null)
      context.addIssue({ code: 'custom', path: ['identityNumber'], message: issue })
    if ((value.studentId === '') !== (value.relation === ''))
      context.addIssue({
        code: 'custom',
        path: [value.studentId === '' ? 'studentId' : 'relation'],
        message: 'Bağ için öğrenciyi ve bağın türünü birlikte seçin.',
      })
  })
export type DonorFormValues = z.input<typeof donorFormSchema>

export const donorDefaults = (): DonorFormValues => ({
  kind: 'person',
  name: '',
  identityNumber: '',
  phone: '',
  email: '',
  address: '',
  studentId: '',
  relation: '',
})

const donorLink = (values: DonorFormValues) =>
  values.studentId === '' || values.relation === ''
    ? null
    : { studentId: values.studentId, relation: values.relation }

export function donorBody(values: DonorFormValues): CreateDonorBody {
  const link = donorLink(values)
  const identityNumber = optionalText(values.identityNumber)
  const phone = optionalText(values.phone)
  const email = optionalText(values.email)
  const address = optionalText(values.address)
  return {
    kind: values.kind,
    name: values.name.trim(),
    ...(identityNumber === undefined ? {} : { identityNumber }),
    ...(phone === undefined ? {} : { phone }),
    ...(email === undefined ? {} : { email }),
    ...(address === undefined ? {} : { address }),
    ...(link === null ? {} : { link }),
  }
}

/**
 * Düzeltme gövdesi: kimlik numarası maskeli geldiği için boş bırakılırsa değişmez; öteki boş
 * alanlar `null` olarak temizlenir.
 */
export function donorUpdateBody(values: DonorFormValues): UpdateDonorBody {
  const identityNumber = optionalText(values.identityNumber)
  return {
    name: values.name.trim(),
    ...(identityNumber === undefined ? {} : { identityNumber }),
    phone: optionalText(values.phone) ?? null,
    email: optionalText(values.email) ?? null,
    address: optionalText(values.address) ?? null,
    link: donorLink(values),
  }
}

// --- Bağış ---------------------------------------------------------------------------------------

export const donationFormSchema = z
  .object({
    donorId: z.string(),
    kind: z.enum(DONATION_KINDS),
    donatedOn: daySchema,
    amount: z.string(),
    method: z.enum(DONATION_METHODS),
    bankAccountId: z.string(),
    reference: limited(DONATION_REFERENCE_MAX),
    description: limited(DONATION_DESCRIPTION_MAX),
    declaredValue: optionalAmount,
    note: limited(DONATION_NOTE_MAX),
  })
  .superRefine((value, context) => {
    if (value.kind === 'cash' && parse(value.amount) === null)
      context.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'Tutarı 1.234,56 biçiminde girin.',
      })
    if (value.kind === 'in_kind' && value.description.trim().length < 5)
      context.addIssue({
        code: 'custom',
        path: ['description'],
        message: 'Ayni bağışı açıklayın (ne, kaç adet).',
      })
  })
export type DonationFormValues = z.input<typeof donationFormSchema>

export const donationDefaults = (today: string): DonationFormValues => ({
  donorId: '',
  kind: 'cash',
  donatedOn: today,
  amount: '',
  method: 'cash',
  bankAccountId: '',
  reference: '',
  description: '',
  declaredValue: '',
  note: '',
})

/** Boş bağışçı anonim bağıştır; türe ait olmayan alanlar gövdeye girmez (K-297, K-298). */
export function donationBody(values: DonationFormValues): DonationBody {
  const reference = optionalText(values.reference)
  const note = optionalText(values.note)
  const common = {
    donorId: values.donorId === '' ? null : values.donorId,
    donatedOn: values.donatedOn,
    ...(reference === undefined ? {} : { reference }),
    ...(note === undefined ? {} : { note }),
  }
  if (values.kind === 'in_kind') {
    const declared = values.declaredValue.trim() === '' ? undefined : cents(values.declaredValue)
    return {
      ...common,
      kind: 'in_kind',
      description: values.description.trim(),
      ...(declared === undefined ? {} : { declaredValueCents: declared }),
    }
  }
  return {
    ...common,
    kind: 'cash',
    amountCents: cents(values.amount),
    method: values.method,
    ...(values.method === 'bank_transfer' && values.bankAccountId !== ''
      ? { bankAccountId: values.bankAccountId }
      : {}),
  }
}

export const cancelFormSchema = donationCancelSchema
export type CancelFormValues = z.input<typeof cancelFormSchema>

// --- Ayar ----------------------------------------------------------------------------------------

export const settingsFormSchema = z
  .object({
    taxNoticeEnabled: z.boolean(),
    taxNoticeText: limited(DONATION_TAX_NOTICE_MAX),
  })
  .superRefine((value, context) => {
    if (value.taxNoticeEnabled && value.taxNoticeText.trim().length < DONATION_TAX_NOTICE_MIN)
      context.addIssue({
        code: 'custom',
        path: ['taxNoticeText'],
        message: `İbare açıkken en az ${String(DONATION_TAX_NOTICE_MIN)} karakterlik metni yazın.`,
      })
  })
export type SettingsFormValues = z.input<typeof settingsFormSchema>

export const settingsBody = (values: SettingsFormValues): DonationSettingsBody => ({
  taxNoticeEnabled: values.taxNoticeEnabled,
  taxNoticeText: optionalText(values.taxNoticeText) ?? null,
})
