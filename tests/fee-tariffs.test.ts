import assert from 'node:assert/strict'
import test from 'node:test'

import {
  planTariffCreate,
  planTariffPublish,
  planTariffUpdate,
  type FeeItem,
} from '../packages/school-core/src/lib/fee-tariffs.ts'
import { isDomainError } from './support/domain-error.ts'

const TODAY = '2026-10-06'
const tuition: FeeItem = {
  kind: 'tuition',
  level: '7',
  amountCents: 30_000_000,
  unit: 'year',
  vatBasisPoints: 1000,
  vatEffectiveDate: '2026-01-01',
  announcedAmountCents: 30_000_000,
}
const meal: FeeItem = {
  ...tuition,
  kind: 'meal',
  level: null,
  amountCents: 4_000_000,
  announcedAmountCents: null,
}
const publishInput = { announcedDate: '2026-05-01', mebbisRecordedDate: '2026-05-02' }
const school = { institutionType: 'school', today: TODAY } as const
const language = { institutionType: 'language_school', today: TODAY } as const

test('DOM-FIN-002: yeni taslak sürüm numarası artar, yılda tek açık taslak olur', () => {
  const plan = planTariffCreate({ academicYear: 2026, items: [tuition] }, [
    { versionNumber: 1, status: 'superseded' },
    { versionNumber: 2, status: 'published' },
  ])
  assert.equal(plan.versionNumber, 3)
  assert.throws(
    () =>
      planTariffCreate({ academicYear: 2026, items: [tuition] }, [
        { versionNumber: 1, status: 'draft' },
      ]),
    isDomainError('open_tariff_draft', 'conflict'),
  )
})

test('DOM-FIN-004: tarifede olmayan kalem adı ve aynı tür + düzey reddedilir', () => {
  assert.throws(() =>
    planTariffCreate({ academicYear: 2026, items: [{ ...tuition, kind: 'registration_fee' }] }, []),
  )
  assert.throws(
    () => planTariffCreate({ academicYear: 2026, items: [tuition, tuition] }, []),
    isDomainError('tariff_item_duplicate'),
  )
  assert.equal(
    planTariffCreate({ academicYear: 2026, items: [tuition, { ...tuition, level: '8' }] }, [])
      .versionNumber,
    1,
  )
})

test('DOM-FIN-002: yayımlanmış tarife düzenlenemez ve yeniden yayımlanamaz', () => {
  const row = { status: 'published', items: [tuition] } as const
  assert.throws(
    () => planTariffUpdate(row, { items: [tuition] }),
    isDomainError('tariff_not_draft', 'conflict'),
  )
  assert.throws(
    () => planTariffPublish(row, publishInput, school),
    isDomainError('tariff_not_draft', 'conflict'),
  )
  assert.deepEqual(planTariffUpdate({ status: 'draft' }, { items: [meal] }).items, [meal])
})

test('DOM-FIN-002: öğrenim ücreti olmadan ve onaylı tutarsız okul tarifesi yayımlanmaz', () => {
  const draft = (items: FeeItem[]) => ({ status: 'draft', items }) as const
  assert.throws(
    () => planTariffPublish(draft([meal]), publishInput, school),
    isDomainError('tariff_tuition_required'),
  )
  assert.throws(
    () =>
      planTariffPublish(draft([{ ...tuition, announcedAmountCents: null }]), publishInput, school),
    isDomainError('tariff_announced_required'),
  )
  assert.throws(
    () =>
      planTariffPublish(
        draft([{ ...tuition, amountCents: tuition.announcedAmountCents! + 1 }]),
        publishInput,
        school,
      ),
    isDomainError('tariff_amount_exceeds_announced'),
  )
  assert.deepEqual(planTariffPublish(draft([tuition, meal]), publishInput, school), publishInput)
})

test('DOM-FIN-006: öğrenim ücreti birimi kurum türüne uyar', () => {
  const draft = (unit: FeeItem['unit']) =>
    ({ status: 'draft', items: [{ ...tuition, unit, announcedAmountCents: null }] }) as const
  assert.throws(
    () => planTariffPublish(draft('lesson_hour'), publishInput, school),
    isDomainError('tariff_unit_mismatch'),
  )
  assert.throws(
    () => planTariffPublish(draft('year'), publishInput, language),
    isDomainError('tariff_unit_mismatch'),
  )
  assert.deepEqual(planTariffPublish(draft('lesson_hour'), publishInput, language), publishInput)
})

test('DOM-FIN-002: ilan ve MEBBİS tarihi ileri gün olamaz', () => {
  const draft = { status: 'draft', items: [tuition] } as const
  assert.throws(
    () => planTariffPublish(draft, { ...publishInput, announcedDate: '2026-10-07' }, school),
    isDomainError('tariff_announced_in_future'),
  )
  assert.throws(
    () => planTariffPublish(draft, { ...publishInput, mebbisRecordedDate: '2026-10-07' }, school),
    isDomainError('tariff_mebbis_in_future'),
  )
  assert.equal(
    planTariffPublish(draft, { ...publishInput, mebbisRecordedDate: null }, school)
      .mebbisRecordedDate,
    null,
  )
})
