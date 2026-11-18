// Bordro parametresi formu (DOM-FIN-100; ON-197). Tutarlar formda `1.234,56`, oranlar yüzde
// (`20,75`), damga vergisi binde (`7,59`), çarpanlar kat (`7,5`) olarak yazılır; gövdede kuruş, on
// binde bir ve yüz binde birdir. Alan ve dilim kuralları core şemasından gelir (aynı mesajlar).
import { z } from 'zod'
import type { CreatePayrollParameterSetBody } from '@kampus/react-shared/use-finance-payroll-parameters.ts'
import {
  PAYROLL_AMOUNT_MAX_CENTS,
  PAYROLL_BRACKET_MAX_CENTS,
  payrollParameterSetSchema,
  type PayrollParameterValues,
} from '@kampus/school-core/lib/finance-payroll-parameters.ts'
import { parseAmountInput } from '@kampus/school-core/lib/payments.ts'

/** "20,75" → 2075 (`factor` 100, iki ondalık); "7,5" kat → 75.000 (`factor` 10.000, dört ondalık). */
export function parseScaledInput(text: string, factor: number, decimals: number): number | null {
  const value = text.trim()
  const pattern = new RegExp(`^\\d{1,7}(?:[.,]\\d{1,${String(decimals)}})?$`)
  if (!pattern.test(value)) return null
  return Math.round(Number(value.replace(',', '.')) * factor)
}

const decimalText = (value: number, digits: number) =>
  value.toLocaleString('tr-TR', { maximumFractionDigits: digits, useGrouping: false })
const amountText = (cents: number) =>
  (cents / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const parsePercent = (text: string) => parseScaledInput(text, 100, 2)
const parsePerMille = (text: string) => parseScaledInput(text, 100, 2)
const parseMultiplier = (text: string) => parseScaledInput(text, 10_000, 4)
const parseMoney = (text: string, maxCents: number, allowZero = false) =>
  parseAmountInput(text, { maxCents, allowZero })

const percentField = (label: string) =>
  z.string().refine((value) => parsePercent(value) !== null, {
    message: `${label} yüzde olarak girin (ör. 20,75).`,
  })
const multiplierField = (label: string) =>
  z.string().refine((value) => parseMultiplier(value) !== null, {
    message: `${label} kat olarak girin (ör. 7,5).`,
  })
const moneyField = (label: string) =>
  z.string().refine((value) => parseMoney(value, PAYROLL_AMOUNT_MAX_CENTS) !== null, {
    message: `${label} 1.234,56 biçiminde, sıfırdan büyük girin.`,
  })

const fieldsSchema = z.object({
  effectiveMonth: z.string().regex(/^\d{4}-\d{2}$/, 'Yürürlük ayını seçin.'),
  minimumWageGross: moneyField('Brüt asgari ücreti'),
  brackets: z.array(
    z.object({
      lowerBound: z
        .string()
        .refine((value) => parseMoney(value, PAYROLL_BRACKET_MAX_CENTS, true) !== null, {
          message: 'Alt sınırı 1.234,56 biçiminde girin.',
        }),
      rate: percentField('Oranı'),
    }),
  ),
  sgkEmployee: percentField('SGK işçi payını'),
  sgkEmployer: percentField('SGK işveren payını'),
  sgkIncentive: percentField('İşveren prim indirimini'),
  unemploymentEmployee: percentField('İşsizlik işçi payını'),
  unemploymentEmployer: percentField('İşsizlik işveren payını'),
  floorMultiplier: multiplierField('Taban çarpanını'),
  ceilingMultiplier: multiplierField('Tavan çarpanını'),
  stampTax: z.string().refine((value) => parsePerMille(value) !== null, {
    message: 'Damga vergisi oranını binde olarak girin (ör. 7,59).',
  }),
  incomeTaxExempt: z.enum(['yes', 'no']),
  stampTaxExempt: z.enum(['yes', 'no']),
  severanceCeiling: moneyField('Kıdem tazminatı tavanını'),
  source: z.string(),
})
export type PayrollFormValues = z.input<typeof fieldsSchema>

/** Setten form değerleri; `effectiveMonth` verilirse yürürlük ayı odur (yeni dönem, kopya). */
export function payrollFormDefaults(
  values: PayrollParameterValues,
  effectiveMonth = values.effectiveFrom.slice(0, 7),
): PayrollFormValues {
  return {
    effectiveMonth,
    minimumWageGross: amountText(values.minimumWageGrossCents),
    brackets: values.incomeTaxBrackets.map((bracket) => ({
      lowerBound: amountText(bracket.lowerBoundCents),
      rate: decimalText(bracket.rateBasisPoints / 100, 2),
    })),
    sgkEmployee: decimalText(values.sgkEmployeeRateBasisPoints / 100, 2),
    sgkEmployer: decimalText(values.sgkEmployerRateBasisPoints / 100, 2),
    sgkIncentive: decimalText(values.sgkEmployerIncentiveBasisPoints / 100, 2),
    unemploymentEmployee: decimalText(values.unemploymentEmployeeRateBasisPoints / 100, 2),
    unemploymentEmployer: decimalText(values.unemploymentEmployerRateBasisPoints / 100, 2),
    floorMultiplier: decimalText(values.sgkFloorMultiplierBasisPoints / 10_000, 4),
    ceilingMultiplier: decimalText(values.sgkCeilingMultiplierBasisPoints / 10_000, 4),
    stampTax: decimalText(values.stampTaxRatePer100k / 100, 2),
    incomeTaxExempt: values.minimumWageIncomeTaxExempt ? 'yes' : 'no',
    stampTaxExempt: values.minimumWageStampTaxExempt ? 'yes' : 'no',
    severanceCeiling: amountText(values.severanceCeilingCents),
    source: values.source,
  }
}

export function payrollBody(values: PayrollFormValues): CreatePayrollParameterSetBody {
  return {
    effectiveFrom: `${values.effectiveMonth}-01`,
    minimumWageGrossCents: parseMoney(values.minimumWageGross, PAYROLL_AMOUNT_MAX_CENTS) ?? 0,
    incomeTaxBrackets: values.brackets.map((bracket) => ({
      lowerBoundCents: parseMoney(bracket.lowerBound, PAYROLL_BRACKET_MAX_CENTS, true) ?? 0,
      rateBasisPoints: parsePercent(bracket.rate) ?? 0,
    })),
    sgkEmployeeRateBasisPoints: parsePercent(values.sgkEmployee) ?? 0,
    sgkEmployerRateBasisPoints: parsePercent(values.sgkEmployer) ?? 0,
    sgkEmployerIncentiveBasisPoints: parsePercent(values.sgkIncentive) ?? 0,
    unemploymentEmployeeRateBasisPoints: parsePercent(values.unemploymentEmployee) ?? 0,
    unemploymentEmployerRateBasisPoints: parsePercent(values.unemploymentEmployer) ?? 0,
    sgkFloorMultiplierBasisPoints: parseMultiplier(values.floorMultiplier) ?? 0,
    sgkCeilingMultiplierBasisPoints: parseMultiplier(values.ceilingMultiplier) ?? 0,
    stampTaxRatePer100k: parsePerMille(values.stampTax) ?? 0,
    minimumWageIncomeTaxExempt: values.incomeTaxExempt === 'yes',
    minimumWageStampTaxExempt: values.stampTaxExempt === 'yes',
    severanceCeilingCents: parseMoney(values.severanceCeiling, PAYROLL_AMOUNT_MAX_CENTS) ?? 0,
    source: values.source.trim(),
  }
}

/** Gövde alanı → form alanı. */
const BODY_FIELDS: Readonly<Record<string, string>> = {
  effectiveFrom: 'effectiveMonth',
  minimumWageGrossCents: 'minimumWageGross',
  incomeTaxBrackets: 'brackets',
  sgkEmployeeRateBasisPoints: 'sgkEmployee',
  sgkEmployerRateBasisPoints: 'sgkEmployer',
  sgkEmployerIncentiveBasisPoints: 'sgkIncentive',
  unemploymentEmployeeRateBasisPoints: 'unemploymentEmployee',
  unemploymentEmployerRateBasisPoints: 'unemploymentEmployer',
  sgkFloorMultiplierBasisPoints: 'floorMultiplier',
  sgkCeilingMultiplierBasisPoints: 'ceilingMultiplier',
  stampTaxRatePer100k: 'stampTax',
  minimumWageIncomeTaxExempt: 'incomeTaxExempt',
  minimumWageStampTaxExempt: 'stampTaxExempt',
  severanceCeilingCents: 'severanceCeiling',
  source: 'source',
}
const BRACKET_FIELDS: Readonly<Record<string, string>> = {
  lowerBoundCents: 'lowerBound',
  rateBasisPoints: 'rate',
}

/**
 * Sunucu ya da core yolu → form yolu (`incomeTaxBrackets.2.rateBasisPoints` → `brackets.2.rate`;
 * dizinin kendisi → `brackets.root`). Bilinmeyen yol `null` (kök hata).
 */
export function payrollFormPath(path: string): string | null {
  const [head = '', index, leaf] = path.split('.')
  const field = BODY_FIELDS[head]
  if (field === undefined) return null
  if (head !== 'incomeTaxBrackets') return index === undefined ? field : null
  if (index === undefined) return 'brackets.root'
  if (!/^\d+$/.test(index)) return null
  const bracketField = leaf === undefined ? undefined : BRACKET_FIELDS[leaf]
  return bracketField === undefined ? 'brackets.root' : `brackets.${index}.${bracketField}`
}

/** Alanlar biçimce geçerliyse gövde core şemasıyla da denetlenir (dilim sırası, alanlar arası). */
export const payrollFormSchema = fieldsSchema.superRefine((values, context) => {
  if (!fieldsSchema.safeParse(values).success) return
  const parsed = payrollParameterSetSchema.safeParse(payrollBody(values))
  if (parsed.success) return
  for (const issue of parsed.error.issues) {
    const target = payrollFormPath(issue.path.join('.'))
    context.addIssue({
      code: 'custom',
      path:
        target === null
          ? []
          : target.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part)),
      message: issue.message,
    })
  }
})

/** Yeni dönemin önerilen ayı: seçili yılda son dönemden sonraki ay, yoksa yılın ocağı. */
export function nextPeriodMonth(year: number, lastStart: string | undefined): string {
  const first = `${String(year)}-01`
  if (lastStart === undefined || !lastStart.startsWith(`${String(year)}-`)) return first
  const month = Number(lastStart.slice(5, 7))
  return month >= 12
    ? lastStart.slice(0, 7)
    : `${String(year)}-${String(month + 1).padStart(2, '0')}`
}
