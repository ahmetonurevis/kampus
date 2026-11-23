// Personel ücret tanımı formları ve gösterimi (DOM-FIN-099; ON-194). Form tek düz nesnedir; tutar
// formda `1.234,56` metnidir, gövdede kuruş. Bileşene göre yalnız ilgili alanlar gövdeye gider; tür,
// gün sırası ve sınırlar core `payRateInputSchema`'dan gelir (aynı mesajlar).
import { z } from 'zod'
import type { CreatePayRateBody, PayRate } from '@kampus/react-shared/use-finance-pay-rates.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  BENEFIT_FORM_LABELS,
  BENEFIT_FORMS,
  BENEFIT_TYPES,
  LESSON_PAY_TYPES,
  PAY_RATE_AMOUNT_MAX_CENTS,
  PAY_RATE_COMPONENT_LABELS,
  PAY_RATE_COMPONENTS,
  PAY_RATE_NOTE_MAX,
  PAY_RATE_TYPE_LABELS,
  payRateInputSchema,
  payRateSlot,
  payRateUnitLabel,
  WAGE_TYPES,
  type PayRateComponent,
  type PayRateType,
} from '@kampus/school-core/lib/finance-pay-rates.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { parseAmountInput } from '@kampus/school-core/lib/payments.ts'

/** Maskeli tutar gösterimi (K-306). */
export const AMOUNT_MASK = '••••'

export const RATE_TYPES_BY_COMPONENT: Readonly<Record<PayRateComponent, readonly PayRateType[]>> = {
  wage: WAGE_TYPES,
  lesson: LESSON_PAY_TYPES,
  benefit: BENEFIT_TYPES,
}

const parseAmount = (text: string) =>
  parseAmountInput(text, { maxCents: PAY_RATE_AMOUNT_MAX_CENTS })

const fieldsSchema = z.object({
  component: z.enum(PAY_RATE_COMPONENTS, 'Tanım türünü seçin.'),
  rateType: z.string().min(1, 'Türü seçin.'),
  amount: z.string().refine((value) => parseAmount(value) !== null, {
    message: 'Tutarı 1.234,56 biçiminde, sıfırdan büyük girin (en fazla 10.000.000 ₺).',
  }),
  startDate: daySchema,
  endDate: z.string(),
  benefitForm: z.string(),
  taxable: z.enum(['true', 'false']),
  note: z
    .string()
    .max(PAY_RATE_NOTE_MAX, `En fazla ${String(PAY_RATE_NOTE_MAX)} karakter girebilirsiniz.`),
})
export type PayRateFormValues = z.input<typeof fieldsSchema>
type FormField = keyof PayRateFormValues

/** Gövde alanı → form alanı. */
const BODY_FIELDS: Readonly<Record<string, FormField>> = {
  component: 'component',
  rateType: 'rateType',
  amountCents: 'amount',
  startDate: 'startDate',
  endDate: 'endDate',
  benefitForm: 'benefitForm',
  taxable: 'taxable',
  note: 'note',
}
export const payRateFormField = (path: string): FormField | undefined => BODY_FIELDS[path]

export function payRateDefaults(today: string): PayRateFormValues {
  return {
    component: 'wage',
    rateType: 'monthly_gross',
    amount: '',
    startDate: today,
    endDate: '',
    benefitForm: 'cash',
    taxable: 'true',
    note: '',
  }
}

/** Bileşen değişince tür ilk seçeneğe döner. */
export const firstRateType = (component: PayRateComponent): PayRateType =>
  RATE_TYPES_BY_COMPONENT[component][0] ?? 'monthly_gross'

/** Form → gövde: bileşene göre yalnız ilgili alanlar; boş bitiş ve not `null`. */
export function payRateBody(membershipId: string, values: PayRateFormValues): CreatePayRateBody {
  const common = {
    membershipId,
    amountCents: parseAmount(values.amount) ?? 0,
    startDate: values.startDate,
    endDate: values.endDate === '' ? null : values.endDate,
    note: values.note.trim() === '' ? null : values.note.trim(),
  }
  if (values.component === 'benefit')
    return {
      component: 'benefit',
      rateType: values.rateType as (typeof BENEFIT_TYPES)[number],
      benefitForm: (BENEFIT_FORMS as readonly string[]).includes(values.benefitForm)
        ? (values.benefitForm as (typeof BENEFIT_FORMS)[number])
        : 'cash',
      taxable: values.taxable === 'true',
      ...common,
    }
  if (values.component === 'lesson')
    return {
      component: 'lesson',
      rateType: values.rateType as (typeof LESSON_PAY_TYPES)[number],
      ...common,
    }
  return { component: 'wage', rateType: values.rateType as (typeof WAGE_TYPES)[number], ...common }
}

/** Alanlar geçerliyse gövde core şemasıyla da denetlenir (tür, gün sırası). */
export function payRateFormSchema(membershipId: string) {
  return fieldsSchema.superRefine((values, context) => {
    if (!fieldsSchema.safeParse(values).success) return
    const parsed = payRateInputSchema.safeParse(payRateBody(membershipId, values))
    if (parsed.success) return
    for (const issue of parsed.error.issues) {
      const field = payRateFormField(String(issue.path[0] ?? ''))
      context.addIssue({ code: 'custom', path: field ? [field] : [], message: issue.message })
    }
  })
}

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/** Yürürlük aralığı metni: "1 Eyl 2026 – 31 Ağu 2027" ya da "1 Eyl 2026'dan itibaren". */
export const periodText = (rate: Pick<PayRate, 'startDate' | 'endDate'>) =>
  rate.endDate === null
    ? `${dayText(rate.startDate)} itibarıyla, süresiz`
    : `${dayText(rate.startDate)} – ${dayText(rate.endDate)}`

/** Tanımın başlığı: "Ana ücret · Aylık brüt". */
export const rateTitle = (rate: Pick<PayRate, 'component' | 'rateType'>) =>
  `${PAY_RATE_COMPONENT_LABELS[rate.component]} · ${PAY_RATE_TYPE_LABELS[rate.rateType]}`

/** Tutar ve birimi; maskeliyse yer tutucu. Yan hakta nakdi/ayni ve vergi işareti eklenir. */
export function amountText(
  rate: Pick<PayRate, 'component' | 'rateType' | 'benefitForm' | 'taxable'> & {
    amountCents: number | null
  },
): string {
  const unit = payRateUnitLabel(rate.component, rate.rateType)
  const amount = rate.amountCents === null ? AMOUNT_MASK : `${money(rate.amountCents)} (${unit})`
  if (rate.component !== 'benefit' || rate.benefitForm === null) return amount
  const tax = rate.taxable === true ? 'vergiye tabi' : 'vergiden istisna'
  return `${amount} · ${BENEFIT_FORM_LABELS[rate.benefitForm]}, ${tax}`
}

/** Yuvanın son tanımları (bitiş ve iptal yalnız bunlarda; K-304). */
export function latestRateIds(rates: readonly PayRate[]): Set<string> {
  const latest = new Map<string, PayRate>()
  for (const rate of rates) {
    const slot = payRateSlot(rate.component, rate.rateType)
    const current = latest.get(slot)
    if (current === undefined || rate.startDate > current.startDate) latest.set(slot, rate)
  }
  return new Set([...latest.values()].map((rate) => rate.id))
}
