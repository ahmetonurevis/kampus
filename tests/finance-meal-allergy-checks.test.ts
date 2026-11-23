import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError, type DomainErrorKind } from '../packages/school-core/src/lib/errors.ts'
import {
  ALLERGY_SEVERITY_RANK,
  assertMealAllergyServiceDate,
  hasMealAllergyWarning,
  matchAllergy,
  MEAL_ALLERGY_DAYS_AHEAD,
  MEAL_ALLERGY_ROLES,
  mealAllergyAcknowledgementSchema,
  mealAllergyWarnings,
  normalizeAllergyText,
  planMealAllergyAcknowledgement,
} from '../packages/school-core/src/lib/finance-meal-allergy-checks.ts'
import { healthAccessActionLabel } from '../packages/school-core/src/lib/finance-health-access.ts'

/**
 * Yemekhane alerji uyarısı kuralları (DOM-FIN-162; ON-151; K-541…K-543; H-117). Bugün 2026-10-06.
 */

const TODAY = '2026-10-06'
const MENU = '00000000-0000-4000-8000-000000000151'

function rejects(fn: () => unknown, code: string, kind: DomainErrorKind = 'rule') {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof DomainError)
    assert.equal(error.code, code)
    assert.equal(error.kind, kind)
    return true
  })
}

const soup = { name: 'Mercimek çorbası', position: 0, allergens: ['celery'] as const }
const pilaf = { name: 'Tereyağlı pilav', position: 1, allergens: ['milk'] as const }
const cake = { name: 'Fındıklı kek', position: 2, allergens: ['gluten', 'eggs', 'nuts'] as const }

describe('DOM-FIN-162: alerji adının 14 alerjene eşlenmesi (K-541)', () => {
  test('DOM-FIN-162: yazım aksansız ve küçük harfe çevrilir', () => {
    assert.equal(normalizeAllergyText('  Yer Fıstığı, SÜT!  '), 'yer fistigi, sut')
    assert.equal(normalizeAllergyText('İNEK SÜTÜ'), 'inek sutu')
  })

  test('DOM-FIN-162: Türkçe ekli adlar ve yaygın yazımlar eşlenir', () => {
    const cases: [string, string[]][] = [
      ['Süt', ['milk']],
      ['inek sütü proteini', ['milk']],
      ['Laktoz intoleransı', ['milk']],
      ['Sut urunleri', ['milk']],
      ['Yumurta', ['eggs']],
      ['Çölyak (gluten)', ['gluten']],
      ['Buğday', ['gluten']],
      ['Yer fıstığı', ['peanuts']],
      ['yerfıstığı', ['peanuts']],
      ['Antep fıstığı', ['nuts']],
      ['Fındığa alerji', ['nuts']],
      ['Ceviz, badem', ['nuts']],
      ['Balık', ['fish']],
      ['Kabuklu deniz ürünleri', ['crustaceans', 'molluscs']],
      ['Midye', ['molluscs']],
      ['Karides', ['crustaceans']],
      ['Soya', ['soybeans']],
      ['Kereviz', ['celery']],
      ['Hardal', ['mustard']],
      ['Susam / tahin', ['sesame']],
      ['Sülfit', ['sulphites']],
      ['Acı bakla', ['lupin']],
      ['Peanut', ['peanuts']],
      ['milk and egg', ['eggs', 'milk']],
    ]
    for (const [name, allergens] of cases)
      assert.deepEqual(matchAllergy(name), { allergens, status: 'matched' }, name)
  })

  test('DOM-FIN-162: belirsiz ad korumacı eşlenir', () => {
    assert.deepEqual(matchAllergy('Fıstık').allergens, ['peanuts', 'nuts'])
    assert.deepEqual(matchAllergy('Kuruyemiş').allergens, ['peanuts', 'nuts'])
    assert.deepEqual(matchAllergy('Deniz ürünleri').allergens, ['crustaceans', 'fish', 'molluscs'])
  })

  test('DOM-FIN-162: eşlenemeyen ad sessizce düşmez; kısmi eşleme ayrıca işaretlenir', () => {
    assert.deepEqual(matchAllergy('Kivi'), { allergens: [], status: 'unmatched' })
    assert.deepEqual(matchAllergy('Gıda alerjisi'), { allergens: [], status: 'unmatched' })
    assert.deepEqual(matchAllergy(''), { allergens: [], status: 'unmatched' })
    assert.deepEqual(matchAllergy('Süt ve kivi'), { allergens: ['milk'], status: 'partial' })
    assert.deepEqual(matchAllergy('Çilekli süt'), { allergens: ['milk'], status: 'partial' })
  })

  test('DOM-FIN-162: besin dışı alerji yemekhane listesine girmez', () => {
    for (const name of ['Penisilin', 'Arı sokması', 'Polen', 'Ev tozu', 'Kedi tüyü', 'Lateks'])
      assert.deepEqual(matchAllergy(name), { allergens: [], status: 'non_food' }, name)
    assert.deepEqual(matchAllergy('Penisilin ve süt'), { allergens: ['milk'], status: 'matched' })
    assert.deepEqual(matchAllergy('Penisilin ve kivi').status, 'unmatched')
  })
})

describe('DOM-FIN-162: öğün uyarısı (K-542)', () => {
  test('DOM-FIN-162: kalem başına kesişen alerjen ve en ağır şiddet', () => {
    const warnings = mealAllergyWarnings(
      [
        { name: 'Süt', severity: 'mild' },
        { name: 'Laktoz', severity: 'moderate' },
        { name: 'Fındık', severity: 'severe' },
        { name: 'Yumurta', severity: 'mild' },
      ],
      [cake, pilaf, soup],
    )
    assert.deepEqual(warnings.conflicts, [
      { itemName: 'Tereyağlı pilav', position: 1, allergens: ['milk'], severity: 'moderate' },
      { itemName: 'Fındıklı kek', position: 2, allergens: ['eggs', 'nuts'], severity: 'severe' },
    ])
    assert.deepEqual(warnings.unmatched, [])
    assert.equal(warnings.severity, 'severe')
    assert.equal(hasMealAllergyWarning(warnings), true)
  })

  test('DOM-FIN-162: eşlenemeyen alerji yemek varsa elle kontrole düşer', () => {
    const warnings = mealAllergyWarnings(
      [
        { name: 'Kivi', severity: 'moderate' },
        { name: 'Süt ve çilek', severity: 'mild' },
        { name: 'Penisilin', severity: 'severe' },
      ],
      [soup, pilaf],
    )
    assert.deepEqual(warnings.unmatched, [
      { allergyName: 'Kivi', severity: 'moderate', partial: false },
      { allergyName: 'Süt ve çilek', severity: 'mild', partial: true },
    ])
    assert.deepEqual(
      warnings.conflicts.map((item) => item.itemName),
      ['Tereyağlı pilav'],
    )
    assert.equal(warnings.severity, 'moderate')
  })

  test('DOM-FIN-162: yemek yoksa ya da çakışma yoksa uyarı yok', () => {
    const none = mealAllergyWarnings([{ name: 'Kivi', severity: 'severe' }], [])
    assert.deepEqual(none, { conflicts: [], unmatched: [], severity: null })
    assert.equal(hasMealAllergyWarning(none), false)
    const clean = mealAllergyWarnings(
      [
        { name: 'Balık', severity: 'severe' },
        { name: 'Polen', severity: 'mild' },
      ],
      [soup, pilaf],
    )
    assert.equal(hasMealAllergyWarning(clean), false)
    assert.equal(clean.severity, null)
    assert.equal(hasMealAllergyWarning(mealAllergyWarnings([], [soup])), false)
  })

  test('DOM-FIN-162: şiddet sırası hafiften ağıra', () => {
    assert.ok(ALLERGY_SEVERITY_RANK.mild < ALLERGY_SEVERITY_RANK.moderate)
    assert.ok(ALLERGY_SEVERITY_RANK.moderate < ALLERGY_SEVERITY_RANK.severe)
  })
})

describe('DOM-FIN-162: gün, rol ve onay işareti (K-541, K-543)', () => {
  test('DOM-FIN-162: liste bugün ve en çok 7 gün sonrası için açılır', () => {
    assert.equal(MEAL_ALLERGY_DAYS_AHEAD, 7)
    assertMealAllergyServiceDate(TODAY, TODAY)
    assertMealAllergyServiceDate('2026-10-13', TODAY)
    rejects(() => assertMealAllergyServiceDate('2026-10-05', TODAY), 'meal_allergy_date_past')
    rejects(() => assertMealAllergyServiceDate('2026-10-14', TODAY), 'meal_allergy_date_too_far')
  })

  test('DOM-FIN-162: listeyi yönetici ve ön büro okur; erişim günlüğünde türü görünür', () => {
    assert.deepEqual([...MEAL_ALLERGY_ROLES], ['yonetici', 'onburo'])
    assert.equal(
      healthAccessActionLabel('finance.meal_allergy.roster_read'),
      'Yemekhane alerji uyarısı',
    )
  })

  test('DOM-FIN-162: onay şeması öğrenci, gün ve öğün ister; fazla alan 400', () => {
    const input = { studentId: ' s-1 ', serviceDate: TODAY, mealKind: 'lunch' }
    assert.deepEqual(mealAllergyAcknowledgementSchema.parse(input), { ...input, studentId: 's-1' })
    for (const bad of [
      { ...input, studentId: '' },
      { ...input, serviceDate: '06.10.2026' },
      { ...input, mealKind: 'dinner' },
      { ...input, note: 'alternatif verildi' },
    ])
      assert.equal(mealAllergyAcknowledgementSchema.safeParse(bad).success, false)
  })

  test('DOM-FIN-162: onay yalnız bugün, uyarılı ve kayıtlı öğrenci için, bir kez (K-543)', () => {
    const input = mealAllergyAcknowledgementSchema.parse({
      studentId: 's-1',
      serviceDate: TODAY,
      mealKind: 'lunch',
    })
    const checks = {
      today: TODAY,
      student: { active: true },
      exists: false,
      menuId: MENU,
      hasWarning: true,
    }
    assert.deepEqual(planMealAllergyAcknowledgement(input, checks), {
      studentId: 's-1',
      serviceDate: TODAY,
      mealKind: 'lunch',
      menuId: MENU,
    })
    rejects(
      () => planMealAllergyAcknowledgement(input, { ...checks, student: null }),
      'meal_allergy_student_not_found',
    )
    rejects(
      () => planMealAllergyAcknowledgement(input, { ...checks, student: { active: false } }),
      'meal_allergy_student_inactive',
    )
    rejects(
      () => planMealAllergyAcknowledgement({ ...input, serviceDate: '2026-10-07' }, checks),
      'meal_allergy_ack_not_today',
    )
    rejects(
      () => planMealAllergyAcknowledgement(input, { ...checks, exists: true }),
      'meal_allergy_ack_exists',
      'conflict',
    )
    rejects(
      () => planMealAllergyAcknowledgement(input, { ...checks, menuId: null }),
      'meal_allergy_ack_no_warning',
    )
    rejects(
      () => planMealAllergyAcknowledgement(input, { ...checks, hasWarning: false }),
      'meal_allergy_ack_no_warning',
    )
  })
})
