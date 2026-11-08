import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createScholarshipFundSchema,
  planScholarshipFundAllocation,
  planScholarshipFundAllocationCancel,
  planScholarshipFundClose,
  planScholarshipFundCreate,
  planScholarshipFundDonation,
  planScholarshipFundDonationCancel,
  scholarshipFundCsv,
  scholarshipFundMovements,
  scholarshipFundTotals,
  type StoredFundAllocation,
  type StoredFundDonation,
} from '../packages/school-core/src/lib/finance-scholarship-funds.ts'

import { isDomainError } from './support/domain-error.ts'

const ZodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'
const OPEN = { closedAt: null }
const CLOSED = { closedAt: '2026-10-01T09:00:00.000Z' }
const TODAY = '2026-10-06'
const AWARD = {
  id: '6f2b6d1e-4c1a-4b8e-9a51-1f2d3c4b5a60',
  studentId: 's1',
  academicYear: 2026,
  amountCents: 1_000_000,
}
const FREE = { balanceCents: 2_000_000, coveredCents: 0, alreadyFromFund: false }

test('DOM-FIN-068: fon kaydı bağışçıyı en az veriyle alır; anonimde ad saklanmaz (K-95)', () => {
  assert.deepEqual(
    planScholarshipFundCreate(
      { name: ' Mezunlar Fonu ', donorKind: 'organization', donorName: 'Mezunlar Derneği' },
      [],
    ),
    {
      name: 'Mezunlar Fonu',
      description: null,
      donorKind: 'organization',
      donorName: 'Mezunlar Derneği',
    },
  )
  const anonymous = planScholarshipFundCreate(
    { name: 'Anonim Fon', description: '', donorKind: 'anonymous' },
    [],
  )
  assert.equal(anonymous.donorName, null)
  assert.equal(anonymous.description, null)
  for (const bad of [
    { name: 'A', donorKind: 'person', donorName: 'Ali Veli' },
    { name: 'Fon', donorKind: 'person' },
    { name: 'Fon', donorKind: 'anonymous', donorName: 'Ali Veli' },
    { name: 'Fon', donorKind: 'company', donorName: 'X A.Ş.' },
    { name: 'Fon', donorKind: 'person', donorName: 'Ali', phone: '0555' },
  ])
    assert.throws(() => createScholarshipFundSchema.parse(bad), ZodError)
  assert.throws(
    () =>
      planScholarshipFundCreate({ name: 'MEZUNLAR fonu', donorKind: 'anonymous' }, [
        'Mezunlar Fonu',
      ]),
    isDomainError('scholarship_fund_exists', 'conflict'),
  )
})

test('DOM-FIN-068: bağış açık fona, kuruş tamsayıyla ve geçmiş ya da bugünkü güne girer', () => {
  const body = { amountCents: 500_000, donatedOn: TODAY, channel: 'bank_transfer' }
  assert.deepEqual(planScholarshipFundDonation(OPEN, body, TODAY), { ...body, note: null })
  assert.equal(
    planScholarshipFundDonation(OPEN, { ...body, note: 'Dekont 42' }, TODAY).note,
    'Dekont 42',
  )
  assert.throws(
    () => planScholarshipFundDonation(OPEN, { ...body, donatedOn: '2026-10-07' }, TODAY),
    isDomainError('scholarship_fund_date_future'),
  )
  assert.throws(
    () => planScholarshipFundDonation(CLOSED, body, TODAY),
    isDomainError('scholarship_fund_closed'),
  )
  for (const amountCents of [0, -1, 10.5, '500'])
    assert.throws(
      () => planScholarshipFundDonation(OPEN, { ...body, amountCents }, TODAY),
      ZodError,
    )
  assert.throws(
    () => planScholarshipFundDonation(OPEN, { ...body, channel: 'check' }, TODAY),
    ZodError,
  )
})

test('DOM-FIN-068: atama bakiyeyi ve bursun karşılanmamış kısmını aşamaz (K-96)', () => {
  const input = { awardId: AWARD.id, amountCents: 400_000 }
  assert.deepEqual(planScholarshipFundAllocation(OPEN, AWARD, FREE, input), {
    awardId: AWARD.id,
    studentId: 's1',
    academicYear: 2026,
    amountCents: 400_000,
  })
  // Bakiye tam yetiyor, burs da tam karşılanıyor: sınır dahil.
  assert.equal(
    planScholarshipFundAllocation(
      OPEN,
      AWARD,
      { balanceCents: 400_000, coveredCents: 600_000, alreadyFromFund: false },
      input,
    ).amountCents,
    400_000,
  )
  assert.throws(
    () => planScholarshipFundAllocation(OPEN, AWARD, { ...FREE, balanceCents: 399_999 }, input),
    isDomainError('scholarship_fund_insufficient'),
  )
  assert.throws(
    () => planScholarshipFundAllocation(OPEN, AWARD, { ...FREE, coveredCents: 600_001 }, input),
    isDomainError('scholarship_fund_exceeds_award'),
  )
  assert.throws(
    () => planScholarshipFundAllocation(OPEN, AWARD, { ...FREE, alreadyFromFund: true }, input),
    isDomainError('scholarship_fund_allocation_exists', 'conflict'),
  )
  assert.throws(
    () => planScholarshipFundAllocation(OPEN, null, FREE, input),
    isDomainError('scholarship_award_not_found', 'not_found'),
  )
  assert.throws(
    () => planScholarshipFundAllocation(CLOSED, AWARD, FREE, input),
    isDomainError('scholarship_fund_closed'),
  )
  assert.throws(
    () => planScholarshipFundAllocation(OPEN, AWARD, FREE, { ...input, awardId: 'x' }),
    ZodError,
  )
})

test('DOM-FIN-068: iptal gerekçe ister, ikinci kez yapılmaz; bağış iptali bakiyeyi eksiye düşürmez (K-97)', () => {
  const reason = { reason: 'Yanlış tutar girildi' }
  assert.deepEqual(planScholarshipFundAllocationCancel(OPEN, { cancelledAt: null }, reason), reason)
  assert.throws(
    () => planScholarshipFundAllocationCancel(OPEN, { cancelledAt: null }, { reason: 'kısa' }),
    ZodError,
  )
  assert.throws(
    () => planScholarshipFundAllocationCancel(OPEN, { cancelledAt: CLOSED.closedAt }, reason),
    isDomainError('scholarship_fund_allocation_cancelled', 'conflict'),
  )
  // Kapalı fonda iptal bakiye açardı; kapanış kesindir (K-97).
  assert.throws(
    () => planScholarshipFundAllocationCancel(CLOSED, { cancelledAt: null }, reason),
    isDomainError('scholarship_fund_closed'),
  )
  const donation = { cancelledAt: null, amountCents: 300_000 }
  assert.deepEqual(planScholarshipFundDonationCancel(donation, 300_000, reason), reason)
  assert.throws(
    () => planScholarshipFundDonationCancel(donation, 299_999, reason),
    isDomainError('scholarship_fund_donation_in_use'),
  )
  assert.throws(
    () =>
      planScholarshipFundDonationCancel({ ...donation, cancelledAt: CLOSED.closedAt }, 0, reason),
    isDomainError('scholarship_fund_donation_cancelled', 'conflict'),
  )
})

test('DOM-FIN-068: fon yalnız sıfır bakiyede bir kez kapanır', () => {
  assert.doesNotThrow(() => planScholarshipFundClose(OPEN, 0))
  assert.throws(
    () => planScholarshipFundClose(OPEN, 1),
    isDomainError('scholarship_fund_balance_not_zero'),
  )
  assert.throws(
    () => planScholarshipFundClose(CLOSED, 0),
    isDomainError('scholarship_fund_already_closed', 'conflict'),
  )
})

const donation = (
  id: string,
  donatedOn: string,
  amountCents: number,
  cancelledAt: string | null = null,
): StoredFundDonation => ({
  id,
  donatedOn,
  amountCents,
  cancelledAt,
  channel: 'bank_transfer',
  note: id === 'd1' ? '=HYPERLINK("x")' : null,
  createdAt: `${donatedOn}T08:00:00.000Z`,
  cancelReason: cancelledAt === null ? null : 'Mükerrer giriş',
  version: 1,
})
const allocation = (
  id: string,
  allocatedOn: string,
  amountCents: number,
  cancelledAt: string | null = null,
): StoredFundAllocation => ({
  id,
  awardId: AWARD.id,
  studentId: 's1',
  academicYear: 2026,
  allocatedOn,
  amountCents,
  cancelledAt,
  createdAt: `${allocatedOn}T09:00:00.000Z`,
  cancelReason: null,
  version: 1,
})

test('DOM-FIN-068: bakiye geçerli bağış eksi geçerli atamadır; döküm gün sırasıyla yürüyen bakiye verir', () => {
  const donations = [
    donation('d2', '2026-09-10', 200_000),
    donation('d1', '2026-09-01', 500_000),
    donation('d3', '2026-09-12', 50_000, '2026-09-13T09:00:00.000Z'),
  ]
  const allocations = [
    allocation('a1', '2026-09-05', 300_000),
    allocation('a2', '2026-09-06', 100_000, '2026-09-07T09:00:00.000Z'),
  ]
  const totals = scholarshipFundTotals(donations, allocations)
  assert.deepEqual(totals, {
    donatedCents: 700_000,
    allocatedCents: 300_000,
    balanceCents: 400_000,
    donationCount: 2,
    allocationCount: 1,
  })
  const movements = scholarshipFundMovements(donations, allocations, new Map([['s1', 'Deniz']]))
  assert.deepEqual(
    movements.map((row) => [row.id, row.effectCents, row.balanceAfterCents, row.studentName]),
    [
      ['d1', 500_000, 500_000, null],
      ['a1', -300_000, 200_000, 'Deniz'],
      ['a2', 0, 200_000, 'Deniz'],
      ['d2', 200_000, 400_000, null],
      ['d3', 0, 400_000, null],
    ],
  )
  // Yetkisiz rolde öğrenciyi tanıtan alan yok: ad, öğrenci ve burs kimliği, gerekçe (K-98).
  const masked = scholarshipFundMovements(
    [],
    [{ ...allocation('a3', '2026-09-08', 100_000, '2026-09-09T09:00:00.000Z'), cancelReason: 'x' }],
    null,
  )
  assert.deepEqual(
    masked.map((row) => [
      row.studentName,
      row.studentId,
      row.awardId,
      row.cancelReason,
      row.academicYear,
    ]),
    [[null, null, null, null, 2026]],
  )

  const csv = scholarshipFundCsv({ name: 'Mezunlar Fonu' }, totals, movements).split('\r\n')
  assert.equal(csv.length, 1 + movements.length + 3)
  assert.equal(csv[1]?.includes(`"'Banka havalesi / EFT · =HYPERLINK(""x"")"`), false)
  assert.match(csv[1] ?? '', /"Banka havalesi \/ EFT · =HYPERLINK\(""x""\)";"";5000,00;5000,00$/)
  assert.match(csv[2] ?? '', /"Burs ataması";"Geçerli";"Deniz";2026;-3000,00;2000,00$/)
  assert.match(csv[3] ?? '', /"İptal edildi"/)
  assert.match(csv.at(-1) ?? '', /"Bakiye";"";"";"";4000,00;""$/)
  assert.match(csv.at(-2) ?? '', /-3000,00/)
})
