import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  ScholarshipFundMovement,
  ScholarshipFundReport,
} from '@kampus/react-shared/use-finance-scholarship-funds.ts'
import { createScholarshipFundSchema } from '@kampus/school-core/lib/finance-scholarship-funds.ts'
import {
  movementDetail,
  scholarshipFundReportDocument,
  scholarshipFundReportFilename,
  signedAmount,
} from '../src/lib/pdf/templates/finance-scholarship-fund.ts'
import {
  allocationBody,
  allocationFormSchema,
  awardOptionLabel,
  donationBody,
  donationDefaults,
  donationFormSchema,
  formField,
  fundBody,
  fundDefaults,
  fundFormSchema,
} from '../src/pages/finance/scholarship-fund-forms.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

test('DOM-FIN-068: fon formu bağışçıyı en az veriyle gönderir; anonimde ad gitmez (K-95)', () => {
  const values = {
    ...fundDefaults(),
    name: ' Mezunlar Fonu ',
    donorName: 'Mezunlar Derneği',
  }
  assert.equal(fundFormSchema.safeParse(values).success, true)
  const body = fundBody(values)
  assert.deepEqual(body, {
    name: 'Mezunlar Fonu',
    donorKind: 'organization',
    donorName: 'Mezunlar Derneği',
  })
  assert.equal(createScholarshipFundSchema.safeParse(body).success, true)
  const anonymous = fundBody({ ...values, donorKind: 'anonymous', description: ' Not ' })
  assert.deepEqual(anonymous, { name: 'Mezunlar Fonu', donorKind: 'anonymous', description: 'Not' })
  assert.equal(createScholarshipFundSchema.safeParse(anonymous).success, true)
  assert.equal(fundFormSchema.safeParse({ ...values, donorName: ' ' }).success, false)
  assert.equal(
    fundFormSchema.safeParse({ ...values, donorKind: 'anonymous', donorName: '' }).success,
    true,
  )
})

test('DOM-FIN-068: bağış ve atama tutarı ₺ olarak girilir, kuruşa çevrilir; geçersiz tutar reddedilir', () => {
  const donation = { ...donationDefaults('2026-10-06'), amount: '1.500,50', note: ' Dekont 42 ' }
  assert.equal(donationFormSchema.safeParse(donation).success, true)
  assert.deepEqual(donationBody(donation), {
    amountCents: 150_050,
    donatedOn: '2026-10-06',
    channel: 'bank_transfer',
    note: 'Dekont 42',
  })
  assert.equal('note' in donationBody({ ...donation, note: '' }), false)
  for (const amount of ['', '0', '-5', '12,345', 'abc'])
    assert.equal(donationFormSchema.safeParse({ ...donation, amount }).success, false, amount)
  assert.equal(allocationFormSchema.safeParse({ awardId: '', amount: '10' }).success, false)
  assert.deepEqual(allocationBody({ awardId: 'a1', amount: '600' }), {
    awardId: 'a1',
    amountCents: 60_000,
  })
  assert.equal(formField(['amount', 'note'] as const, 'amount'), 'amount')
  assert.equal(formField(['amount', 'note'] as const, 'awardId'), undefined)
  assert.equal(
    awardOptionLabel(
      { studentId: 's1', academicYear: 2026, amountCents: 1_000_000 },
      new Map([['s1', 'Deniz Yılmaz']]),
    ),
    'Deniz Yılmaz · 2026-2027 · 10.000,00 ₺',
  )
})

const movement = (overrides: Partial<ScholarshipFundMovement>): ScholarshipFundMovement => ({
  id: 'm1',
  kind: 'donation',
  day: '2026-10-01',
  amountCents: 1_500_000,
  effectCents: 1_500_000,
  balanceAfterCents: 1_500_000,
  channel: 'bank_transfer',
  note: 'Dekont 42',
  awardId: null,
  studentId: null,
  studentName: null,
  academicYear: null,
  cancelledAt: null,
  cancelReason: null,
  version: 1,
  ...overrides,
})

const REPORT: ScholarshipFundReport = {
  fund: {
    id: '7f1e2d3c-0000-4000-8000-000000000001',
    name: 'Mezunlar Fonu',
    description: null,
    donorKind: 'organization',
    donorName: 'Mezunlar Derneği',
    status: 'active',
    closedAt: null,
    createdAt: '2026-09-01T09:00:00.000Z',
    donatedCents: 1_500_000,
    allocatedCents: 500_000,
    balanceCents: 1_000_000,
    donationCount: 1,
    allocationCount: 1,
    version: 1,
  },
  movements: [
    movement({}),
    movement({
      id: 'm2',
      kind: 'allocation',
      day: '2026-10-02',
      amountCents: 500_000,
      effectCents: -500_000,
      balanceAfterCents: 1_000_000,
      channel: null,
      note: null,
      awardId: 'a1',
      studentId: 's1',
      studentName: 'Deniz Yılmaz',
      academicYear: 2026,
    }),
  ],
}

test('DOM-FIN-068: hareket açıklaması ve işaretli tutar; öğrenci adı yoksa gizli yazılır (K-98)', () => {
  const [donation, allocation] = REPORT.movements
  assert.ok(donation && allocation)
  assert.equal(movementDetail(donation), 'Banka havalesi / EFT · Dekont 42')
  assert.equal(movementDetail(allocation), 'Deniz Yılmaz · 2026-2027')
  assert.equal(
    movementDetail({ ...allocation, studentName: null }),
    'Öğrenci adı gizli · 2026-2027',
  )
  assert.equal(signedAmount(donation), '+15.000,00 ₺')
  assert.equal(signedAmount(allocation), '−5.000,00 ₺')
})

test('DOM-FIN-068: fon raporu PDF toplamları, hareketleri ve makbuz olmadığı notunu taşır', () => {
  const all = allTexts(
    scholarshipFundReportDocument(measurer, REPORT, {
      institution: 'Akademi Özel Okulları',
      generatedAt: new Date('2026-10-06T15:00:00.000Z'),
    }),
  ).join('\n')
  for (const text of [
    'Burs fonu raporu',
    'Mezunlar Derneği (Kurum)',
    '10.000,00 ₺',
    'Deniz Yılmaz · 2026-2027',
    '−5.000,00 ₺',
    'bağış makbuzu veya vergi belgesi yerine geçmez',
  ])
    assert.ok(all.includes(text), text)
  assert.equal(scholarshipFundReportFilename('Mezunlar Fonu'), 'burs-fonu-mezunlar-fonu.pdf')
  const empty = allTexts(
    scholarshipFundReportDocument(
      measurer,
      { ...REPORT, movements: [] },
      {
        institution: 'Akademi Özel Okulları',
      },
    ),
  ).join('\n')
  assert.ok(empty.includes('Henüz bağış ya da atama yok.'))
})
