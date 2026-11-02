import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  refundStatementDocument,
  type RefundWithdrawal,
} from '../src/lib/pdf/templates/refund-statement.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

const WITHDRAWAL: RefundWithdrawal = {
  id: 'w1',
  studentName: 'Deniz Yılmaz',
  withdrawalDate: '2026-10-01',
  reason: 'transfer',
  targetSchool: null,
  refundCents: 0,
  debtCents: 0,
  refundDueDate: '2026-11-01',
  refundPaidDate: null,
  maskedIban: null,
  refundAccountHolder: null,
  breakdown: {
    baseCents: 100_000,
    deductionBasisPoints: 1_000,
    deductionCents: 10_000,
    attendedUnits: 1,
    totalUnits: 10,
    usageCents: 10_000,
    entitledCents: 0,
    paidCents: 0,
    creditCents: 0,
    extras: [],
  },
}
const OPTIONS = { institution: 'Akademi', generatedAt: new Date('2026-10-02T09:00:00.000Z') }

test('DOM-FIN-025: burslu istisnası iade dökümünde yazılır, bursuz ayrılışta yazılmaz', () => {
  const exempt = {
    ...WITHDRAWAL,
    breakdown: { ...WITHDRAWAL.breakdown, scholarshipExempt: true },
  }
  assert.ok(
    allTexts(refundStatementDocument(measurer, exempt, OPTIONS)).includes('Burslu istisnası'),
  )
  assert.equal(
    allTexts(refundStatementDocument(measurer, WITHDRAWAL, OPTIONS)).includes('Burslu istisnası'),
    false,
  )
})
