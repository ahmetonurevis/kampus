import assert from 'node:assert/strict'
import test from 'node:test'

import {
  emptyTariffForm,
  feeTariffFormSchema,
  planTariffCreate,
  planTariffPublish,
  planTariffUpdate,
  tariffFormToBody,
  tariffToForm,
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

const draftRow = { status: 'draft', items: [tuition], discounts: [] } as const

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
  const row = { status: 'published', items: [tuition], discounts: [] } as const
  assert.throws(
    () => planTariffUpdate(row, { items: [tuition] }),
    isDomainError('tariff_not_draft', 'conflict'),
  )
  assert.throws(
    () => planTariffPublish(row, publishInput, school),
    isDomainError('tariff_not_draft', 'conflict'),
  )
  assert.deepEqual(planTariffUpdate(draftRow, { items: [meal] }).items, [meal])
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

test('IST-104: PATCH verilmeyen alanı korur', () => {
  const discount = { kind: 'sibling', percentBasisPoints: 1_000, amountCents: null } as const
  const row = { status: 'draft', items: [tuition], discounts: [discount] } as const
  assert.deepEqual(planTariffUpdate(row, { items: [meal] }).discounts, [discount])
  assert.deepEqual(planTariffUpdate(row, { discounts: [] }).items, [tuition])
  assert.deepEqual(planTariffUpdate(row, { discounts: [] }).discounts, [])
})

test('IST-104: tarife formu kuruşa çevrilir, kayıtlı tarife forma kayıpsız döner', () => {
  const stored = {
    academicYear: 2026,
    items: [tuition, { ...meal, vatBasisPoints: 0 }],
    discounts: [
      { kind: 'sibling', percentBasisPoints: 1_250, amountCents: null },
      { kind: 'corporate', percentBasisPoints: null, amountCents: 100_050 },
    ] as const,
  }
  const form = tariffToForm(stored)
  assert.equal(form.items[0]?.amount, '300000,00')
  assert.equal(form.items[1]?.vatPercent, '0')
  assert.equal(form.discounts[0]?.value, '12,50')
  assert.equal(feeTariffFormSchema.safeParse(form).success, true)
  assert.deepEqual(tariffFormToBody(form), stored)
})

test('IST-104: tarife formu geçersiz tutar, oran ve yılı reddeder', () => {
  const base = emptyTariffForm(2026, TODAY)
  assert.equal(feeTariffFormSchema.safeParse(base).success, false, 'boş tutar')
  const valid = {
    ...base,
    items: base.items.map((item) => ({ ...item, amount: '1.000,00' })),
  }
  assert.equal(feeTariffFormSchema.safeParse(valid).success, true)
  const discount = { kind: 'sibling', mode: 'percent', value: '101' } as const
  assert.equal(feeTariffFormSchema.safeParse({ ...valid, discounts: [discount] }).success, false)
  assert.equal(
    feeTariffFormSchema.safeParse({ ...valid, discounts: [{ ...discount, value: '10' }] }).success,
    true,
  )
  assert.equal(feeTariffFormSchema.safeParse({ ...valid, academicYear: '26' }).success, false)
})
