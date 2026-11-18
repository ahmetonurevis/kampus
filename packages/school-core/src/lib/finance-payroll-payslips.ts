import { z } from 'zod'

import {
  PAYROLL_CALC_ROLES,
  type PayrollCalcRow,
  type PayrollEarning,
} from './finance-payroll-calc.ts'
import {
  MONTHLY_DEDUCTION_KIND_LABELS,
  type MonthlyDeductionKind,
} from './finance-staff-deductions.ts'

/**
 * Ücret hesap pusulası (docs/domain/finans.md DOM-FIN-119; ON-201). Pusula yalnız ayın **kayıtlı**
 * bordro hesabından (DOM-FIN-115, `payroll_run_lines`) üretilir; canlı önizleme hesabından üretilmez
 * (K-406). Onaylı ayda kayıtlı hesap dondurulmuştur (DOM-FIN-108), onaysız ayda pusula hesabın
 * revizyonunu ve "dönem onaylanmadı" ibaresini taşır.
 *
 * İçerik (K-407): kurum, personel, görev, dönem, giriş/çıkış günü, çalışma/prim günü, eksik gün,
 * brüt kalemler, SGK ve işsizlik işçi payları, GV matrahı, kümülatif matrah, hesaplanan GV, asgari
 * ücret GV ve DV istisnaları, DV, net ücret, net düzeltme, kesintiler (avans, icra, BES) ve ödenecek
 * net. İşveren payları ve işveren maliyeti, sağlık raporu günü, uyarılar ve kesinti kaynağının
 * kimliği (icra dosyası) pusulaya girmez: pusula personele verilen belgedir, en az veri ilkesi.
 *
 * Fonksiyonlar saftır; API kayıtlı satırı bu biçime indirger, web şablonu yalnız bunu çizer.
 */

/** Ücret verisi yalnız yöneticide (K-408); personel self-servisi bu kuralın dışında (ON-189). */
export const PAYROLL_PAYSLIP_ROLES = PAYROLL_CALC_ROLES

/** Her pusulada duran doğrulama notu (ADR 0011 karar 8). */
export const PAYROLL_PAYSLIP_NOTE =
  "Bu pusula Kampüs'te kaydedilen bordro hesabından üretildi; tutarlar mali müşavir doğrulaması bekler. Resmî beyanname ve bildirge Kampüs dışında verilir."

/** Onaysız ayın pusulasındaki ibare (K-406). */
export const PAYROLL_PAYSLIP_UNAPPROVED_NOTE =
  'Dönem onaylanmadı: hesap yeniden yapılırsa pusula değişebilir.'

/**
 * Pusula sorgusu: personel verilirse tek pusula, verilmezse ayın kayıtlı hesabındaki bütün
 * personel (toplu PDF, her biri ayrı sayfa).
 */
export const payrollPayslipQuerySchema = z.strictObject({
  // kvkk: K (personel üyeliği)
  membershipId: z
    .string('Personel geçersiz.')
    .trim()
    .min(1, 'Personel geçersiz.')
    .max(100, 'Personel geçersiz.')
    .optional()
    .describe('Tek pusula için personelin kurum üyeliği; boşsa ayın bütün pusulaları'),
})
export type PayrollPayslipQuery = z.output<typeof payrollPayslipQuerySchema>

/** Pusuladaki kesinti satırı: yalnız bu ay kesilen tutar (kaynak kimliği yok). */
export interface PayrollPayslipDeduction {
  kind: MonthlyDeductionKind
  amountCents: number
}

/** Pusula verisi: kayıtlı bordro satırının personele gösterilen alt kümesi (K-407). */
export interface PayrollPayslip {
  membershipId: string
  name: string
  role: string
  entryDate: string | null
  exitDate: string | null
  primDays: number
  missingDays: number
  earnings: PayrollEarning[]
  grossCents: number
  sgkBaseCents: number
  sgkEmployeeCents: number
  unemploymentEmployeeCents: number
  incomeTaxBaseCents: number
  cumulativeIncomeTaxBaseBeforeCents: number
  /** Bu ay dahil kümülatif GV matrahı. */
  cumulativeIncomeTaxBaseCents: number
  incomeTaxCents: number
  incomeTaxExemptionCents: number
  incomeTaxPayableCents: number
  stampTaxBaseCents: number
  stampTaxCents: number
  stampTaxExemptionCents: number
  stampTaxPayableCents: number
  netCents: number
  netAdjustmentCents: number
  deductions: PayrollPayslipDeduction[]
  deductionCents: number
  payableCents: number
}

/**
 * Kayıtlı satırdan pusula (K-407). İşveren payları, maliyet, sağlık raporu günü, uyarılar ve
 * kesinti kaynağı düşer; tutarı olmayan (beklemede, ara verilmiş) kesinti satırı yazılmaz.
 */
export function payrollPayslip(row: PayrollCalcRow): PayrollPayslip {
  return {
    membershipId: row.membershipId,
    name: row.name,
    role: row.role,
    entryDate: row.entryDate,
    exitDate: row.exitDate,
    primDays: row.primDays,
    missingDays: row.missingDays,
    earnings: row.earnings.map((earning) => ({ ...earning })),
    grossCents: row.grossCents,
    sgkBaseCents: row.sgkBaseCents,
    sgkEmployeeCents: row.sgkEmployeeCents,
    unemploymentEmployeeCents: row.unemploymentEmployeeCents,
    incomeTaxBaseCents: row.incomeTaxBaseCents,
    cumulativeIncomeTaxBaseBeforeCents: row.cumulativeIncomeTaxBaseBeforeCents,
    cumulativeIncomeTaxBaseCents: row.cumulativeIncomeTaxBaseBeforeCents + row.incomeTaxBaseCents,
    incomeTaxCents: row.incomeTaxCents,
    incomeTaxExemptionCents: row.incomeTaxExemptionCents,
    incomeTaxPayableCents: row.incomeTaxPayableCents,
    stampTaxBaseCents: row.stampTaxBaseCents,
    stampTaxCents: row.stampTaxCents,
    stampTaxExemptionCents: row.stampTaxExemptionCents,
    stampTaxPayableCents: row.stampTaxPayableCents,
    netCents: row.netCents,
    netAdjustmentCents: row.netAdjustmentCents,
    deductions: row.deductions.flatMap((line) =>
      line.amountCents !== null && line.amountCents > 0
        ? [{ kind: line.kind, amountCents: line.amountCents }]
        : [],
    ),
    deductionCents: row.deductionCents,
    payableCents: row.payableCents,
  }
}

/** Yasal kesintiler toplamı: SGK ve işsizlik işçi payları, ödenecek gelir ve damga vergisi. */
export const payslipStatutoryCents = (
  payslip: Pick<
    PayrollPayslip,
    | 'sgkEmployeeCents'
    | 'unemploymentEmployeeCents'
    | 'incomeTaxPayableCents'
    | 'stampTaxPayableCents'
  >,
) =>
  payslip.sgkEmployeeCents +
  payslip.unemploymentEmployeeCents +
  payslip.incomeTaxPayableCents +
  payslip.stampTaxPayableCents

/** "Avans taksiti"; aynı türden birden çok kesinti sırasıyla numaralanır ("İcra kesintisi 2"). */
export function payslipDeductionLabels(deductions: readonly PayrollPayslipDeduction[]): string[] {
  const totals = new Map<MonthlyDeductionKind, number>()
  for (const line of deductions) totals.set(line.kind, (totals.get(line.kind) ?? 0) + 1)
  const seen = new Map<MonthlyDeductionKind, number>()
  return deductions.map((line) => {
    const index = (seen.get(line.kind) ?? 0) + 1
    seen.set(line.kind, index)
    const label = MONTHLY_DEDUCTION_KIND_LABELS[line.kind]
    return (totals.get(line.kind) ?? 0) > 1 ? `${label} ${String(index)}` : label
  })
}
