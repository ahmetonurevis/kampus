import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  payrollCalcRow,
  payrollMonthParameters,
  type PayrollCalcRate,
} from '../packages/school-core/src/lib/finance-payroll-calc.ts'
import {
  PAYROLL_PAYSLIP_NOTE,
  PAYROLL_PAYSLIP_ROLES,
  payrollPayslip,
  payrollPayslipQuerySchema,
  payslipDeductionLabels,
  payslipStatutoryCents,
} from '../packages/school-core/src/lib/finance-payroll-payslips.ts'

/**
 * Ücret hesap pusulası (DOM-FIN-119; ON-201; K-406…K-408). Pusula kayıtlı bordro satırının
 * personele verilen alt kümesidir; satırlar gerçek hesaptan (`payrollCalcRow`, 2026 platform seti)
 * üretilir, beklenen tutarlar `tests/finance-payroll-calc.test.ts` örnekleridir.
 */

const member = { membershipId: 'm-1', name: 'Deniz Yılmaz', role: 'onburo', active: true }
const wage = (amountCents: number): PayrollCalcRate => ({
  id: 'w-1',
  membershipId: member.membershipId,
  component: 'wage',
  rateType: 'monthly_gross',
  amountCents,
  benefitForm: null,
  taxable: null,
  startDate: '2026-01-01',
  endDate: null,
})

function calcRow(cumulativeBefore = 0) {
  return payrollCalcRow('2026-01', payrollMonthParameters('2026-01', []), {
    member,
    rates: [wage(3_303_000)],
    missing: [{ days: 2, reasonCode: '15' }],
    dates: null,
    lessonHours: [],
    lessonHoursUnapproved: false,
    adjustments: [{ item: 'deduction', amountCents: -10_000 }],
    cumulativeIncomeTaxBaseBeforeCents: cumulativeBefore,
    unsavedPreviousMonths: [],
    medicalReportDays: 3,
    deductionSources: {
      advances: [
        {
          id: 'adv-1',
          amountCents: 300_000,
          installmentCount: 3,
          firstMonth: '2026-01',
          givenDate: '2025-12-20',
          status: 'active',
          closedFromMonth: null,
        },
      ],
      garnishments: [
        {
          id: 'icra-1',
          status: 'active',
          isAlimony: false,
          rateBasisPoints: 2500,
          remainingCents: 5_000_000,
          receivedDate: '2025-12-01',
          sequence: 1,
          closedDate: null,
        },
        {
          id: 'icra-2',
          status: 'active',
          isAlimony: false,
          rateBasisPoints: 2500,
          remainingCents: 5_000_000,
          receivedDate: '2025-12-05',
          sequence: 2,
          closedDate: null,
        },
      ],
      pensions: [],
    },
  })
}

describe('DOM-FIN-119: ücret hesap pusulası verisi', () => {
  test('DOM-FIN-119, K-407: pusula işveren payı, maliyet, sağlık raporu günü, uyarı ve kesinti kaynağı taşımaz', () => {
    const row = calcRow()
    const payslip = payrollPayslip(row)
    const keys = Object.keys(payslip)
    for (const hidden of [
      'sgkEmployerCents',
      'unemploymentEmployerCents',
      'employerCostCents',
      'inKindBenefitsCents',
      'medicalReportDays',
      'warnings',
      'active',
      'complete',
      'sgkFloorCents',
      'sgkCeilingCents',
      'netTargetCents',
    ])
      assert.ok(!keys.includes(hidden), hidden)
    assert.ok(!JSON.stringify(payslip).includes('icra-1'))
    assert.ok(!JSON.stringify(payslip).includes('adv-1'))
    assert.equal(payslip.name, 'Deniz Yılmaz')
    assert.equal(payslip.primDays, 28)
    assert.equal(payslip.missingDays, 2)
    assert.equal(payslip.grossCents, row.grossCents)
    assert.equal(payslip.netCents, row.netCents)
    assert.equal(payslip.payableCents, row.payableCents)
    assert.equal(payslip.netAdjustmentCents, -10_000)
  })

  test('DOM-FIN-119, K-407: kümülatif matrah bu ay dahil; yasal kesintiler brütten nete götürür', () => {
    const payslip = payrollPayslip(calcRow(12_750_000))
    assert.equal(payslip.cumulativeIncomeTaxBaseBeforeCents, 12_750_000)
    assert.equal(payslip.cumulativeIncomeTaxBaseCents, 12_750_000 + payslip.incomeTaxBaseCents)
    assert.equal(payslip.grossCents - payslipStatutoryCents(payslip), payslip.netCents)
    assert.equal(
      payslip.netCents + payslip.netAdjustmentCents - payslip.deductionCents,
      payslip.payableCents,
    )
  })

  test('DOM-FIN-119, K-407: yalnız kesilen kesinti yazılır; sıradaki ikinci icra pusulada yoktur', () => {
    const row = calcRow()
    assert.equal(row.deductions.length, 3)
    const payslip = payrollPayslip(row)
    assert.deepEqual(
      payslip.deductions.map((line) => line.kind),
      ['advance', 'garnishment'],
    )
    assert.equal(
      payslip.deductions.reduce((sum, line) => sum + line.amountCents, 0),
      payslip.deductionCents,
    )
    // Satır kopyalanır: pusula kaydı değiştirmez.
    payslip.earnings[0]!.amountCents = 1
    assert.notEqual(row.earnings[0]?.amountCents, 1)
  })

  test('DOM-FIN-119: aynı türden birden çok kesinti numaralanır', () => {
    assert.deepEqual(
      payslipDeductionLabels([
        { kind: 'garnishment', amountCents: 1 },
        { kind: 'advance', amountCents: 1 },
        { kind: 'garnishment', amountCents: 1 },
      ]),
      ['İcra kesintisi 1', 'Avans taksiti', 'İcra kesintisi 2'],
    )
    assert.deepEqual(payslipDeductionLabels([]), [])
  })

  test('DOM-FIN-119, K-408: yalnız yönetici; sorgu personel kimliği isteğe bağlı, bilinmeyen alan 400', () => {
    assert.deepEqual([...PAYROLL_PAYSLIP_ROLES], ['yonetici'])
    assert.deepEqual(payrollPayslipQuerySchema.parse({}), {})
    assert.deepEqual(payrollPayslipQuerySchema.parse({ membershipId: ' m-1 ' }), {
      membershipId: 'm-1',
    })
    assert.equal(payrollPayslipQuerySchema.safeParse({ membershipId: '' }).success, false)
    assert.equal(payrollPayslipQuerySchema.safeParse({ month: '2026-01' }).success, false)
    assert.match(PAYROLL_PAYSLIP_NOTE, /mali müşavir doğrulaması/)
  })
})
