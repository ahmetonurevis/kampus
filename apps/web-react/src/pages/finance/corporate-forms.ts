import { z } from 'zod'
import type {
  CorporateCustomer,
  CreateCorporateCustomerBody,
} from '@kampus/react-shared/use-finance-corporate.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  cancelCorporateInvoiceSchema,
  CORPORATE_LINE_STATUS_LABELS,
  corporateCustomerSchema,
  type CorporateLineStatus,
} from '@kampus/school-core/lib/finance-corporate.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

// Kurumsal müşteri formları (DOM-FIN-060). Alan kuralları core şemasındandır; boş bırakılabilen
// iletişim alanı formda boş metin, gövdede `null` olur.

const shape = corporateCustomerSchema.shape

/** Boşsa geçerli, doluysa core alan şemasıyla denetlenen isteğe bağlı metin alanı. */
const optionalText = (schema: z.ZodType) =>
  z.string().superRefine((value, context) => {
    const text = value.trim()
    if (text === '') return
    const parsed = schema.safeParse(text)
    if (!parsed.success)
      context.addIssue({
        code: 'custom',
        message: parsed.error.issues[0]?.message ?? 'Geçerli bir değer girin.',
      })
  })

export const customerFormSchema = z.object({
  name: shape.name,
  taxNumber: shape.taxNumber,
  taxOffice: shape.taxOffice,
  billingAddress: shape.billingAddress,
  contactName: optionalText(shape.contactName),
  contactEmail: optionalText(shape.contactEmail),
  contactPhone: optionalText(shape.contactPhone),
})
export type CustomerFormValues = z.input<typeof customerFormSchema>

const CUSTOMER_FIELDS = Object.keys(customerFormSchema.shape) as (keyof CustomerFormValues)[]
export const customerFormField = (name: string) => CUSTOMER_FIELDS.find((field) => field === name)

export function customerDefaults(customer?: CorporateCustomer): CustomerFormValues {
  return {
    name: customer?.name ?? '',
    taxNumber: customer?.taxNumber ?? '',
    taxOffice: customer?.taxOffice ?? '',
    billingAddress: customer?.billingAddress ?? '',
    contactName: customer?.contactName ?? '',
    contactEmail: customer?.contactEmail ?? '',
    contactPhone: customer?.contactPhone ?? '',
  }
}

const blankToNull = (value: string) => (value.trim() === '' ? null : value.trim())

export function customerBody(values: CustomerFormValues): CreateCorporateCustomerBody {
  return {
    name: values.name.trim(),
    taxNumber: values.taxNumber.trim(),
    taxOffice: values.taxOffice.trim(),
    billingAddress: values.billingAddress.trim(),
    contactName: blankToNull(values.contactName),
    contactEmail: blankToNull(values.contactEmail),
    contactPhone: blankToNull(values.contactPhone),
  }
}

export const linkFormSchema = z.object({
  studentId: z.string().min(1, 'Kursiyer seçin.'),
  startsOn: daySchema,
  noticeConfirmed: z
    .boolean()
    .refine((value) => value, 'Kursiyere işveren raporu aydınlatmasının yapıldığını onaylayın.'),
})
export type LinkFormValues = z.input<typeof linkFormSchema>
export const linkFormField = (name: string) =>
  (['studentId', 'startsOn', 'noticeConfirmed'] as const).find((field) => field === name)

export const endFormSchema = z.object({ endsOn: daySchema })
export type EndFormValues = z.input<typeof endFormSchema>

export const periodFormSchema = z.object({ from: daySchema, to: daySchema })

export const cancelFormSchema = cancelCorporateInvoiceSchema
export type CancelFormValues = z.input<typeof cancelFormSchema>

export const LINE_STATUS_VIEW: Readonly<
  Record<CorporateLineStatus, { label: string; tone: BadgeTone }>
> = {
  open: { label: CORPORATE_LINE_STATUS_LABELS.open, tone: 'amber' },
  partial: { label: CORPORATE_LINE_STATUS_LABELS.partial, tone: 'purple' },
  paid: { label: CORPORATE_LINE_STATUS_LABELS.paid, tone: 'green' },
  cancelled: { label: CORPORATE_LINE_STATUS_LABELS.cancelled, tone: 'gray' },
}

/** Ayın ilk günü ve son günü (`YYYY-MM-DD`); toplu fatura dönemi varsayılanı. */
export function monthPeriod(today: string): { from: string; to: string } {
  const [year, month] = today.split('-').map(Number)
  const last = new Date(Date.UTC(year ?? 2000, month ?? 1, 0)).getUTCDate()
  const prefix = today.slice(0, 7)
  return { from: `${prefix}-01`, to: `${prefix}-${String(last).padStart(2, '0')}` }
}
