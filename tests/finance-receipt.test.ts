import assert from 'node:assert/strict'
import test from 'node:test'

import {
  paymentFacts,
  paymentListItem,
  type PaymentRecord,
} from '../apps/mobile/src/api/finance-staff.ts'
import { financeDayClosingDocument } from '../apps/web-react/src/lib/pdf/templates/finance-day-closing.ts'
import {
  paymentReceiptDocument,
  receiptNumberLabel as pdfReceiptNumberLabel,
} from '../apps/web-react/src/lib/pdf/templates/payment-receipt.ts'
import { allTexts, measurer } from '../apps/web-react/tests/support/pdf-measurer.ts'
import type { FinanceDayReport } from '../packages/react-shared/src/use-finance-day-closings.ts'
import {
  familyPaymentFacts,
  familyPaymentItem,
  receiptNumber as familyReceiptNumber,
  type FamilyPayment,
} from '../packages/react-shared/src/finance-parent-model.ts'
import { eOzelFeeItems } from '../packages/school-core/src/lib/finance-e-ozel.ts'
import { paymentLines, studentDirectory } from '../packages/school-core/src/lib/finance-export.ts'
import { financeDaySummary } from '../packages/school-core/src/lib/finance-day-closings.ts'
import { receiptNumberLabel } from '../packages/school-core/src/lib/finance-receipt.ts'
import {
  statementLineLabel,
  studentStatement,
} from '../packages/school-core/src/lib/finance-statement.ts'

// Dekont numarasının bütün gösterim yerleri aynı biçimi yazar: "<yıl>-<sıra>", sıfır dolgusu ve
// binlik ayracı yok (DOM-FIN-050). Bu test birleştirmeden önceki çıktıları sabitler.
const CASES = [
  { receiptYear: 2026, receiptNumber: 1, expected: '2026-1' },
  { receiptYear: 2026, receiptNumber: 7, expected: '2026-7' },
  { receiptYear: 2025, receiptNumber: 1234, expected: '2025-1234' },
  { receiptYear: 2027, receiptNumber: 100_000, expected: '2027-100000' },
] as const

const PAID_AT = '2026-10-05T09:00:00.000Z'
const DAY = '2026-10-05'

const staffPayment = (receiptYear: number, receiptNumber: number): PaymentRecord => ({
  id: 'pay-1',
  studentId: 's1',
  studentName: 'Deniz Yılmaz',
  amountCents: 100_000,
  creditCents: 0,
  method: 'Banka havalesi',
  reference: 'DEK-1',
  paidAt: PAID_AT,
  receiptYear,
  receiptNumber,
  reversedAt: null,
  reversalReason: null,
  bankAccountLabel: null,
  mebbisRecordedAt: null,
  version: 1,
  allocations: [],
})

const familyPayment = (receiptYear: number, receiptNumber: number): FamilyPayment => ({
  ...staffPayment(receiptYear, receiptNumber),
  reversalReason: null,
  mebbisRecordedAt: null,
})

const dayLine = (receiptYear: number, receiptNumber: number, reversed: boolean) => ({
  paymentId: 'p1',
  receiptYear,
  receiptNumber,
  studentName: 'Deniz Yılmaz',
  amountCents: 30_000,
  method: 'Nakit' as const,
  reference: null,
  bankAccountLabel: null,
  paidAt: PAID_AT,
  reversedAt: reversed ? PAID_AT : null,
  reversalReason: reversed ? 'Hatalı giriş' : null,
})

const dayReport = (receiptYear: number, receiptNumber: number): FinanceDayReport => ({
  closingDate: DAY,
  status: 'open',
  summary: financeDaySummary([dayLine(receiptYear, receiptNumber, false)], DAY),
  reportStamp: '1:0:30000',
  cashNetCents: 30_000,
  cashCountRequired: true,
  suggestedOpeningCents: null,
  collected: [dayLine(receiptYear, receiptNumber, false)],
  reversed: [dayLine(receiptYear, receiptNumber + 1, true)],
  closing: null,
  history: [],
})

const OPTIONS = { institution: 'Akademi Özel Okulları', generatedAt: new Date(PAID_AT) }

test('ON-314 DOM-FIN-050: dekont numarası tek fonksiyonda yıl-sıra biçimindedir', () => {
  for (const { receiptYear, receiptNumber, expected } of CASES)
    assert.equal(receiptNumberLabel({ receiptYear, receiptNumber }), expected)
})

test('ON-314 DOM-FIN-050: web, mobil, veli modeli ve PDF aynı dekont numarasını yazar', () => {
  for (const { receiptYear, receiptNumber, expected } of CASES) {
    const staff = staffPayment(receiptYear, receiptNumber)
    const family = familyPayment(receiptYear, receiptNumber)

    assert.equal(pdfReceiptNumberLabel(staff), expected)
    assert.equal(familyReceiptNumber(family), expected)
    assert.equal(familyPaymentItem(family).title, `Dekont ${expected}`)
    assert.deepEqual(familyPaymentFacts(family)[0], ['Dekont no', expected])
    assert.ok(paymentListItem(staff).subtitle.endsWith(`· Dekont ${expected}`))
    assert.ok(
      paymentFacts(staff).some(([label, value]) => label === 'Dekont no' && value === expected),
    )

    const receiptPdf = allTexts(paymentReceiptDocument(measurer, staff, OPTIONS))
    assert.ok(receiptPdf.includes(expected), `dekont PDF ${expected}`)

    const dayPdf = allTexts(
      financeDayClosingDocument(measurer, dayReport(receiptYear, receiptNumber), OPTIONS),
    )
    assert.ok(dayPdf.includes(expected), `gün sonu tahsilat ${expected}`)
    assert.ok(
      dayPdf.includes(`${String(receiptYear)}-${String(receiptNumber + 1)}`),
      'gün sonu iptal',
    )
  }
})

test('ON-314 DOM-FIN-050: aktarım, e-Özel ve ekstre satırı aynı dekont numarasını yazar', () => {
  for (const { receiptYear, receiptNumber, expected } of CASES) {
    const exported = paymentLines(
      [
        {
          studentId: 's1',
          amountCents: 10_000,
          method: 'Nakit',
          reference: null,
          paidAt: PAID_AT,
          receiptYear,
          receiptNumber,
          reversedAt: null,
        },
      ],
      studentDirectory([{ id: 's1', name: 'Deniz Yılmaz', number: 712 }]),
      { from: '2026-10-01', to: '2026-10-31' },
    )
    assert.equal(exported[0]?.receipt, expected)

    const [fee] = eOzelFeeItems([
      {
        id: 'p1',
        studentId: 's1',
        studentName: 'Deniz Yılmaz',
        amountCents: 10_000,
        method: 'Nakit',
        reference: null,
        paidAt: new Date(PAID_AT),
        receiptYear,
        receiptNumber,
        reversedAt: null,
        mebbisRecordedAt: null,
        mebbisRecordedByUserId: null,
        mebbisFingerprint: null,
        version: 1,
      },
    ])
    assert.equal(fee?.fee?.receipt, expected)
    assert.equal(fee?.sourceParts[2], expected)

    const { lines } = studentStatement(
      's1',
      [],
      [
        {
          id: 'p1',
          amountCents: 10_000,
          method: 'Nakit',
          reference: null,
          paidAt: PAID_AT,
          receiptYear,
          receiptNumber,
          reversedAt: null,
          allocations: [],
        },
      ],
      '2026-11-20',
    )
    assert.deepEqual(lines.map(statementLineLabel), [`Tahsilat · Nakit · Dekont ${expected}`])
  }
})
