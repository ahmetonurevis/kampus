import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createScholarshipProgramSchema,
  planAwardMebbis,
  planProgramCreate,
  planProgramNotify,
  requireAwardableProgram,
  scholarshipAmount,
  type ScholarshipProgram,
} from '../packages/school-core/src/lib/finance-scholarships.ts'
import { isDomainError } from './support/domain-error.ts'

const INPUT = {
  academicYear: 2026,
  name: 'Başarı Bursu',
  conditions: 'Sınav puanı 90 ve üstü.',
  terminationConditions: 'Disiplin cezası alan öğrencinin bursu kesilir.',
  durationNote: 'Bir eğitim yılı',
  percentBasisPoints: 2500,
  capacity: 2,
}
const PROGRAM: ScholarshipProgram = {
  id: 'p1',
  academicYear: 2026,
  percentBasisPoints: 2500,
  amountCents: null,
  capacity: 2,
  notifiedDate: '2026-09-01',
}
const CONTEXT = { academicYear: 2026, awardedCount: 0, canApprove: true }

test('DOM-FIN-025: program oran ya da tutarla açılır, ikisi birden ya da hiçbiri olmaz', () => {
  assert.equal(createScholarshipProgramSchema.safeParse(INPUT).success, true)
  const none: Record<string, unknown> = { ...INPUT }
  delete none.percentBasisPoints
  assert.equal(createScholarshipProgramSchema.safeParse(none).success, false)
  assert.equal(
    createScholarshipProgramSchema.safeParse({ ...none, amountCents: 1000 }).success,
    true,
  )
  assert.equal(
    createScholarshipProgramSchema.safeParse({ ...INPUT, amountCents: 1000 }).success,
    false,
  )
  for (const bad of [
    { percentBasisPoints: 0 },
    { percentBasisPoints: 10_001 },
    { capacity: 0 },
    { name: 'x' },
    { conditions: '' },
    { extra: 1 },
  ])
    assert.equal(createScholarshipProgramSchema.safeParse({ ...INPUT, ...bad }).success, false)
})

test('DOM-FIN-025: aynı yılda aynı adla ikinci program açılmaz; büyük küçük harf fark etmez', () => {
  assert.equal(planProgramCreate(INPUT, ['Spor Bursu']).name, 'Başarı Bursu')
  assert.throws(
    () => planProgramCreate(INPUT, ['BAŞARI BURSU']),
    isDomainError('scholarship_program_exists', 'conflict'),
  )
})

test('DOM-FIN-025: bildirim ve MEBBİS günü bir kez işlenir, gelecek gün olamaz', () => {
  const today = '2026-10-06'
  assert.equal(
    planProgramNotify({ notifiedDate: null }, { notifiedDate: today }, today).notifiedDate,
    today,
  )
  assert.throws(
    () => planProgramNotify({ notifiedDate: null }, { notifiedDate: '2026-10-07' }, today),
    isDomainError('scholarship_date_future'),
  )
  assert.throws(
    () => planProgramNotify({ notifiedDate: today }, { notifiedDate: today }, today),
    isDomainError('scholarship_already_notified', 'conflict'),
  )
  assert.equal(
    planAwardMebbis({ mebbisRecordedDate: null }, { recordedDate: today }, today).recordedDate,
    today,
  )
  assert.throws(
    () => planAwardMebbis({ mebbisRecordedDate: null }, { recordedDate: '2026-10-07' }, today),
    isDomainError('scholarship_date_future'),
  )
  assert.throws(
    () => planAwardMebbis({ mebbisRecordedDate: today }, { recordedDate: today }, today),
    isDomainError('scholarship_mebbis_recorded', 'conflict'),
  )
})

test('DOM-FIN-025: burs oranı ilan ücretinden hesaplanır, aşağı yuvarlanır, kalan neti aşamaz', () => {
  const percent = { percentBasisPoints: 2500, amountCents: null }
  assert.equal(scholarshipAmount(percent, 10_000_000, 10_000_000), 2_500_000)
  // İndirim sonrası net düşse de oran ilan ücretindendir (zincirleme yok).
  assert.equal(scholarshipAmount(percent, 10_000_000, 9_000_000), 2_500_000)
  assert.equal(
    scholarshipAmount({ percentBasisPoints: 3333, amountCents: null }, 1_000, 1_000),
    333,
  )
  // %100 burs ve sabit tutar neti aşamaz.
  assert.equal(
    scholarshipAmount({ percentBasisPoints: 10_000, amountCents: null }, 10_000_000, 9_000_000),
    9_000_000,
  )
  assert.equal(
    scholarshipAmount({ percentBasisPoints: null, amountCents: 5_000 }, 3_000, 3_000),
    3_000,
  )
})

test('DOM-FIN-025, DOM-FIN-052: atama yönetici onayı, doğru yıl, bildirim ve boş kontenjan ister', () => {
  assert.equal(requireAwardableProgram(PROGRAM, CONTEXT), PROGRAM)
  assert.equal(requireAwardableProgram(PROGRAM, { ...CONTEXT, awardedCount: 1 }), PROGRAM)
  assert.throws(
    () => requireAwardableProgram(PROGRAM, { ...CONTEXT, canApprove: false }),
    isDomainError('scholarship_approval_required'),
  )
  assert.throws(
    () => requireAwardableProgram(null, CONTEXT),
    isDomainError('scholarship_program_not_found', 'not_found'),
  )
  assert.throws(
    () => requireAwardableProgram(PROGRAM, { ...CONTEXT, academicYear: 2027 }),
    isDomainError('scholarship_program_not_found', 'not_found'),
  )
  assert.throws(
    () => requireAwardableProgram({ ...PROGRAM, notifiedDate: null }, CONTEXT),
    isDomainError('scholarship_program_not_notified'),
  )
  assert.throws(
    () => requireAwardableProgram(PROGRAM, { ...CONTEXT, awardedCount: 2 }),
    isDomainError('scholarship_capacity_full', 'conflict'),
  )
})
