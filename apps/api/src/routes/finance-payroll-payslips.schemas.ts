import { z } from 'zod'

import { MONTHLY_DEDUCTION_KINDS } from '@kampus/school-core/lib/finance-staff-deductions.ts'

import { dataResponse } from './common.schemas.ts'
import { earningSchema } from './finance-payroll-runs.schemas.ts'

/**
 * Ücret hesap pusulası şemaları (DOM-FIN-119; ON-201). Yalnız yöneticiye döner (K-408). Pusula
 * kayıtlı bordro satırının personele verilen alt kümesidir (K-407): işveren payları ve maliyeti,
 * sağlık raporu günü, uyarılar ve kesinti kaynağının kimliği şemada yoktur.
 */

const cents = (description: string) => z.number().int().describe(`${description}, kuruş`)

const payslipSchema = z.object({
  membershipId: z.string(),
  // kvkk: K
  name: z.string(),
  role: z.string().describe('Rol: `yonetici`, `ogretmen` ya da `onburo`'),
  entryDate: z.string().nullable().describe('Ay içinde işe giriş günü'),
  exitDate: z.string().nullable().describe('Ay içinde işten çıkış günü'),
  primDays: z.number().int().describe('Çalışma / prim günü'),
  missingDays: z.number().int().describe('Eksik gün (neden yazılmaz)'),
  earnings: z.array(earningSchema).describe('Brüt kalemler'),
  // kvkk: K (ücret)
  grossCents: cents('Brüt'),
  sgkBaseCents: cents('SGK prime esas kazanç'),
  sgkEmployeeCents: cents('SGK işçi payı'),
  unemploymentEmployeeCents: cents('İşsizlik sigortası işçi payı'),
  incomeTaxBaseCents: cents('Ayın gelir vergisi matrahı'),
  cumulativeIncomeTaxBaseBeforeCents: cents('Önceki kümülatif GV matrahı'),
  cumulativeIncomeTaxBaseCents: cents('Bu ay dahil kümülatif GV matrahı'),
  incomeTaxCents: cents('Hesaplanan gelir vergisi'),
  incomeTaxExemptionCents: cents('Asgari ücret gelir vergisi istisnası'),
  incomeTaxPayableCents: cents('Ödenecek gelir vergisi'),
  stampTaxBaseCents: cents('Damga vergisi matrahı'),
  stampTaxCents: cents('Hesaplanan damga vergisi'),
  stampTaxExemptionCents: cents('Asgari ücret damga vergisi istisnası'),
  stampTaxPayableCents: cents('Ödenecek damga vergisi'),
  netCents: cents('Net ücret (kesintilerden önce)'),
  netAdjustmentCents: cents('Net düzeltme (işaretli)'),
  // kvkk: K (avans, icra, BES; kaynak kimliği yok)
  deductions: z
    .array(
      z.object({
        kind: z.enum(MONTHLY_DEDUCTION_KINDS).describe('`advance`, `garnishment`, `pension`'),
        amountCents: cents('Bu ay kesilen tutar'),
      }),
    )
    .describe('Bu ay kesilen kesintiler (DOM-FIN-101 sırası)'),
  deductionCents: cents('Kesinti toplamı'),
  payableCents: cents('Ödenecek net'),
})

export const payrollPayslipsResponse = dataResponse(
  z.object({
    month: z.string(),
    runId: z.uuid().describe('Pusulanın üretildiği kayıtlı hesap'),
    revision: z.number().int().describe('Kayıtlı hesabın revizyonu'),
    calculatedAt: z.string().describe('Hesabın kaydedildiği an'),
    locked: z.boolean().describe('Dönem onaylı (kilitli) mı; değilse pusula değişebilir'),
    institutionName: z.string(),
    payslips: z.array(payslipSchema).describe('Ada göre; tek personel istendiyse bir eleman'),
  }),
)
