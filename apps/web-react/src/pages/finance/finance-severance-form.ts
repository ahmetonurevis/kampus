// Kıdem ve ihbar hesaplayıcı formu (DOM-FIN-094; ON-205). Tutarlar formda `1.234,56` metnidir,
// gövdede kuruş; gün ve sıra kuralları core şemasından gelir (aynı mesajlar). Form değeri hiçbir
// yerde saklanmaz (K-273).
import { z } from 'zod'
import type { SeveranceEstimateBody } from '@kampus/react-shared/use-finance-severance.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  SEVERANCE_EXIT_REASONS,
  SEVERANCE_TAX_BASE_MAX_CENTS,
  SEVERANCE_WAGE_MAX_CENTS,
  severanceRequestSchema,
  type SeveranceExitReason,
} from '@kampus/school-core/lib/finance-severance.ts'
import { parseAmountInput } from '@kampus/school-core/lib/payments.ts'

const parseWage = (text: string) => parseAmountInput(text, { maxCents: SEVERANCE_WAGE_MAX_CENTS })
const parseOptional = (text: string, maxCents: number) =>
  text.trim() === '' ? null : parseAmountInput(text, { allowZero: true, maxCents })

const optionalAmount = (maxCents: number, message: string) =>
  z.string().refine((value) => value.trim() === '' || parseOptional(value, maxCents) !== null, {
    message,
  })

const isExitReason = (value: string): value is SeveranceExitReason =>
  (SEVERANCE_EXIT_REASONS as readonly string[]).includes(value)

const fieldsSchema = z.object({
  startDate: daySchema,
  endDate: daySchema,
  grossWage: z.string().refine((value) => parseWage(value) !== null, {
    message: 'Brüt ücreti 1.234,56 biçiminde, sıfırdan büyük girin (en fazla 10.000.000 ₺).',
  }),
  regularBenefits: optionalAmount(
    SEVERANCE_WAGE_MAX_CENTS,
    'Yan ödemeyi 1.234,56 biçiminde girin ya da boş bırakın (en fazla 10.000.000 ₺).',
  ),
  exitReason: z.string().refine(isExitReason, { message: 'Çıkış nedenini seçin.' }),
  noticeGiven: z.boolean(),
  cumulativeTaxBase: optionalAmount(
    SEVERANCE_TAX_BASE_MAX_CENTS,
    'Matrahı 1.234,56 biçiminde girin ya da boş bırakın (en fazla 100.000.000 ₺).',
  ),
})
export type SeveranceFormValues = z.input<typeof fieldsSchema>
type FormField = keyof SeveranceFormValues

/** Gövde alanı → form alanı. */
const BODY_FIELDS: Readonly<Record<string, FormField>> = {
  startDate: 'startDate',
  endDate: 'endDate',
  grossWageCents: 'grossWage',
  regularBenefitsCents: 'regularBenefits',
  exitReason: 'exitReason',
  noticeGiven: 'noticeGiven',
  cumulativeTaxBaseCents: 'cumulativeTaxBase',
}

export function severanceBody(values: SeveranceFormValues): SeveranceEstimateBody {
  return {
    startDate: values.startDate,
    endDate: values.endDate,
    grossWageCents: parseWage(values.grossWage) ?? 0,
    regularBenefitsCents: parseOptional(values.regularBenefits, SEVERANCE_WAGE_MAX_CENTS) ?? 0,
    exitReason: isExitReason(values.exitReason) ? values.exitReason : 'employer_termination',
    noticeGiven: values.noticeGiven,
    cumulativeTaxBaseCents: parseOptional(values.cumulativeTaxBase, SEVERANCE_TAX_BASE_MAX_CENTS),
  }
}

/** Alanlar geçerliyse gövde core şemasıyla da denetlenir (gün sırası, tavan tablosu sınırı). */
export const severanceFormSchema = fieldsSchema.superRefine((values, context) => {
  // Alan hatası varken (Zod 4 yine de çalıştırabilir) aynı alana ikinci mesaj eklenmez.
  if (!fieldsSchema.safeParse(values).success) return
  const parsed = severanceRequestSchema.safeParse(severanceBody(values))
  if (parsed.success) return
  for (const issue of parsed.error.issues) {
    const field = severanceFormField(issue.path.join('.'))
    context.addIssue({ code: 'custom', path: field ? [field] : [], message: issue.message })
  }
})

export function severanceDefaults(today: string): SeveranceFormValues {
  return {
    startDate: '',
    endDate: today,
    grossWage: '',
    regularBenefits: '',
    exitReason: '',
    noticeGiven: false,
    cumulativeTaxBase: '',
  }
}

/** Sunucu alan yolu form alanına çevrilir; bilinmeyen yol formun kök hatasıdır. */
export function severanceFormField(name: string): FormField | undefined {
  return BODY_FIELDS[name]
}
