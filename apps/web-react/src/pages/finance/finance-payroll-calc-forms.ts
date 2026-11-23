import { z } from 'zod'
import type {
  CreatePayrollTaxCarryoverBody,
  PayrollCalcRow,
} from '@kampus/react-shared/use-finance-payroll-runs.ts'
import {
  PAYROLL_CALC_WARNING_LABELS,
  PAYROLL_CARRYOVER_MAX_CENTS,
  PAYROLL_CARRYOVER_NOTE_MAX,
  payrollCalcMonthSchema,
  payrollEarningLabel,
} from '@kampus/school-core/lib/finance-payroll-calc.ts'
import {
  MONTHLY_DEDUCTION_KIND_LABELS,
  MONTHLY_DEDUCTION_STATUS_LABELS,
} from '@kampus/school-core/lib/finance-staff-deductions.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import { parseAmountInput } from '@kampus/school-core/lib/payments.ts'

// Bordro hesabı formu ve gösterimi (DOM-FIN-115; ON-198). Form değerleri metindir; gövde core
// şemasının biçimine burada çevrilir, kural sunucuda yeniden denetlenir.

/** Varsayılan ay: bordro içinde bulunulan ay için hazırlanır. */
export const defaultPayrollMonth = (today: string) => today.slice(0, 7)

/** Seçilen ay geçerliyse kendisi, değilse `null` (istek atılmaz). */
export const validPayrollMonth = (value: string) =>
  payrollCalcMonthSchema.safeParse(value).success ? value : null

const parseBase = (text: string) =>
  parseAmountInput(text, { maxCents: PAYROLL_CARRYOVER_MAX_CENTS })

export const payrollCarryoverFormSchema = z.object({
  amount: z.string().refine((value) => parseBase(value) !== null, {
    message: 'Matrahı 1.234,56 biçiminde, sıfırdan büyük girin.',
  }),
  note: z
    .string()
    .trim()
    .max(
      PAYROLL_CARRYOVER_NOTE_MAX,
      `En fazla ${String(PAYROLL_CARRYOVER_NOTE_MAX)} karakter girebilirsiniz.`,
    ),
})
export type PayrollCarryoverFormValues = z.infer<typeof payrollCarryoverFormSchema>
export const PAYROLL_CARRYOVER_DEFAULTS: PayrollCarryoverFormValues = { amount: '', note: '' }

export function payrollCarryoverBody(
  membershipId: string,
  year: number,
  values: PayrollCarryoverFormValues,
): CreatePayrollTaxCarryoverBody {
  return {
    membershipId,
    year,
    incomeTaxBaseCents: parseBase(values.amount) ?? 0,
    note: values.note.trim() === '' ? null : values.note.trim(),
  }
}

/** Sunucu alan hatasını forma eşler (gövdedeki `incomeTaxBaseCents` → `amount`). */
export function payrollCarryoverField(name: string): keyof PayrollCarryoverFormValues | null {
  if (name === 'incomeTaxBaseCents') return 'amount'
  return name === 'note' ? 'note' : null
}

type Warning = PayrollCalcRow['warnings'][number]
const INFO_WARNINGS: readonly Warning[] = ['entry_in_month', 'exit_in_month', 'net_wage']

export const payrollWarningText = (code: Warning) => PAYROLL_CALC_WARNING_LABELS[code]
/** Bilgi uyarısı mor, tutarı etkileyen ya da eksik girdi uyarısı turuncu. */
export const payrollWarningTone = (code: Warning) =>
  INFO_WARNINGS.includes(code) ? ('purple' as const) : ('amber' as const)

/** Ayrıntı panelinin bölümleri: [etiket, tutar] satırları. */
export function payrollDetailSections(
  row: PayrollCalcRow,
): { title: string; rows: [string, string][] }[] {
  const minus = (cents: number) => (cents === 0 ? money(0) : `−${money(cents)}`)
  return [
    {
      title: 'Brüt kalemleri',
      rows: [
        ...row.earnings.map((earning): [string, string] => [
          payrollEarningLabel(earning),
          money(earning.amountCents),
        ]),
        ['Brüt', money(row.grossCents)],
      ],
    },
    {
      title: 'SGK',
      rows: [
        ['Prim günü', String(row.primDays)],
        [
          'Taban – tavan (gün oranlı)',
          `${money(row.sgkFloorCents)} – ${money(row.sgkCeilingCents)}`,
        ],
        ['SGK matrahı', money(row.sgkBaseCents)],
        ['SGK işçi payı', minus(row.sgkEmployeeCents)],
        ['İşsizlik işçi payı', minus(row.unemploymentEmployeeCents)],
      ],
    },
    {
      title: 'Vergi',
      rows: [
        ['Önceki kümülatif GV matrahı', money(row.cumulativeIncomeTaxBaseBeforeCents)],
        ['GV matrahı', money(row.incomeTaxBaseCents)],
        ['Hesaplanan gelir vergisi', money(row.incomeTaxCents)],
        ['Asgari ücret GV istisnası', minus(row.incomeTaxExemptionCents)],
        ['Ödenecek gelir vergisi', minus(row.incomeTaxPayableCents)],
        ['Hesaplanan damga vergisi', money(row.stampTaxCents)],
        ['Asgari ücret DV istisnası', minus(row.stampTaxExemptionCents)],
        ['Ödenecek damga vergisi', minus(row.stampTaxPayableCents)],
      ],
    },
    {
      title: 'Net ve kesintiler',
      rows: [
        ['Net ücret', money(row.netCents)],
        ...(row.netAdjustmentCents === 0
          ? []
          : [['Net düzeltme', money(row.netAdjustmentCents)] as [string, string]]),
        ...row.deductions.map((line): [string, string] => [
          `${MONTHLY_DEDUCTION_KIND_LABELS[line.kind]} (${MONTHLY_DEDUCTION_STATUS_LABELS[line.status]})`,
          line.amountCents === null ? '—' : minus(line.amountCents),
        ]),
        ['Ödenecek net', money(row.payableCents)],
      ],
    },
    {
      title: 'İşveren',
      rows: [
        ['SGK işveren payı', money(row.sgkEmployerCents)],
        ['İşsizlik işveren payı', money(row.unemploymentEmployerCents)],
        ...(row.inKindBenefitsCents === 0
          ? []
          : [['Ayni yan haklar', money(row.inKindBenefitsCents)] as [string, string]]),
        ['İşveren maliyeti', money(row.employerCostCents)],
      ],
    },
  ]
}
