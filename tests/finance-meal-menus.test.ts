import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError, type DomainErrorKind } from '../packages/school-core/src/lib/errors.ts'
import {
  ALLERGEN_HINTS,
  ALLERGEN_LABELS,
  ALLERGENS,
  assertMealMenuArchivable,
  assertMealMenuPublishable,
  assertMealMenuUnpublishable,
  decigramText,
  familyMenuFor,
  isoWeekday,
  mealAllergenMatrix,
  mealDayTotals,
  mealItemSchema,
  mealMenuCreateSchema,
  mealMenuSettingsSchema,
  mealMenuUpdateSchema,
  mealWeekDays,
  mealWeekEnd,
  mealWeekStartOf,
  orderedMealKinds,
  parseDecigrams,
  planMealMenuCreate,
  planMealMenuSettings,
  planMealMenuUpdate,
  shiftMealItems,
  type MealItemValue,
} from '../packages/school-core/src/lib/finance-meal-menus.ts'

/**
 * Yemek menüsü, besin değeri ve alerjen matrisi kuralları (DOM-FIN-157; ON-090, ON-149; IST-099;
 * K-526…K-528). Bugün 2026-10-07 Çarşamba; hafta 2026-10-05 pazartesi.
 */

const TODAY = '2026-10-07'
const WEEK = '2026-10-05'
const SOURCE = '00000000-0000-4000-8000-000000000001'

function rejects(fn: () => unknown, code: string, kind: DomainErrorKind = 'rule') {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof DomainError)
    assert.equal(error.code, code)
    assert.equal(error.kind, kind)
    return true
  })
}

const nutrition = (energyKcal: number, extra: Record<string, number | null> = {}) => ({
  energyKcal,
  proteinDg: 100,
  fatDg: 50,
  carbohydrateDg: 300,
  fiberDg: 20,
  saltDg: 8,
  ...extra,
})

const item = (
  menuDate: string,
  position: number,
  name: string,
  extra: Partial<MealItemValue> = {},
): MealItemValue => ({
  menuDate,
  mealKind: 'lunch',
  position,
  name,
  allergens: [],
  nutrition: null,
  ...extra,
})

describe('DOM-FIN-157: takvim', () => {
  test('ISO hafta günü, pazartesi ve hafta günleri', () => {
    assert.equal(isoWeekday('2026-10-05'), 1)
    assert.equal(isoWeekday('2026-10-11'), 7)
    assert.equal(mealWeekStartOf('2026-10-11'), WEEK)
    assert.equal(mealWeekStartOf(WEEK), WEEK)
    assert.deepEqual(mealWeekDays(WEEK).slice(0, 2), ['2026-10-05', '2026-10-06'])
    assert.equal(mealWeekDays(WEEK).length, 7)
    assert.equal(mealWeekEnd(WEEK), '2026-10-11')
  })
})

describe('DOM-FIN-157: şemalar (K-528)', () => {
  test('TGK Ek-1 listesinin 14 alerjeni etiketli ve açıklamalı', () => {
    assert.equal(ALLERGENS.length, 14)
    for (const allergen of ALLERGENS) {
      assert.ok(ALLERGEN_LABELS[allergen].length > 0)
      assert.ok(ALLERGEN_HINTS[allergen].length > 0)
    }
  })

  test('hafta pazartesi olmalı; kampüs ve kopya isteğe bağlı', () => {
    assert.equal(mealMenuCreateSchema.safeParse({ weekStart: '2026-10-06' }).success, false)
    assert.equal(mealMenuCreateSchema.safeParse({ weekStart: '2026-02-30' }).success, false)
    assert.deepEqual(mealMenuCreateSchema.parse({ weekStart: WEEK, branchId: null }), {
      weekStart: WEEK,
      branchId: null,
    })
    assert.equal(
      mealMenuCreateSchema.safeParse({ weekStart: WEEK, institutionId: 'x' }).success,
      false,
    )
  })

  test('kalem: ad, alerjen listesi ve tamsayı besin değeri; float reddedilir', () => {
    const parsed = mealItemSchema.parse({
      name: ' Mercimek çorbası ',
      allergens: ['gluten', 'celery'],
      nutrition: nutrition(180),
    })
    assert.equal(parsed.name, 'Mercimek çorbası')
    const bad = (value: unknown) => mealItemSchema.safeParse(value).success
    assert.equal(bad({ name: 'Çorba', allergens: ['peanut'], nutrition: null }), false)
    assert.equal(bad({ name: 'Çorba', allergens: ['milk', 'milk'], nutrition: null }), false)
    assert.equal(bad({ name: 'Çorba', allergens: [], nutrition: nutrition(180.5) }), false)
    assert.equal(
      bad({ name: 'Çorba', allergens: [], nutrition: nutrition(180, { proteinDg: 12.5 }) }),
      false,
    )
    assert.equal(
      bad({ name: 'Çorba', allergens: [], nutrition: nutrition(180, { saltDg: 201 }) }),
      false,
    )
    assert.equal(
      bad({ name: 'Çorba', allergens: [], nutrition: nutrition(180, { fiberDg: null }) }),
      true,
    )
    assert.equal(bad({ name: 'Ç', allergens: [], nutrition: null }), false)
  })

  test('düzenleme: aynı hücre iki kez yok, gerekçe 10–500; ayar en az bir öğün', () => {
    const slot = { menuDate: WEEK, mealKind: 'lunch', items: [] }
    assert.equal(mealMenuUpdateSchema.safeParse({ slots: [slot, slot] }).success, false)
    assert.equal(mealMenuUpdateSchema.safeParse({ slots: [] }).success, false)
    assert.equal(
      mealMenuUpdateSchema.safeParse({ slots: [slot], correctionReason: 'kısa' }).success,
      false,
    )
    assert.equal(mealMenuSettingsSchema.safeParse({ mealKinds: [] }).success, false)
    assert.equal(mealMenuSettingsSchema.safeParse({ mealKinds: ['lunch', 'lunch'] }).success, false)
  })
})

describe('DOM-FIN-157: menü açma ve kopyalama (K-526)', () => {
  const checks = {
    today: TODAY,
    branch: undefined,
    exists: false,
    enabledKinds: ['lunch'] as const,
  }

  test('geçmiş hafta, bir yıldan uzak hafta, olmayan kampüs ve mükerrer menü reddedilir', () => {
    rejects(() => planMealMenuCreate({ weekStart: '2026-09-28' }, checks), 'meal_menu_week_past')
    rejects(() => planMealMenuCreate({ weekStart: '2027-10-11' }, checks), 'meal_menu_week_too_far')
    rejects(
      () => planMealMenuCreate({ weekStart: WEEK, branchId: 'b-x' }, { ...checks, branch: null }),
      'meal_menu_branch_not_found',
    )
    rejects(
      () => planMealMenuCreate({ weekStart: WEEK }, { ...checks, exists: true }),
      'meal_menu_exists',
      'conflict',
    )
    assert.deepEqual(planMealMenuCreate({ weekStart: WEEK }, checks), { items: [] })
  })

  test('önceki haftadan kopya günleri kaydırır, kapalı öğünü atlar; kaynak yoksa 422', () => {
    rejects(
      () => planMealMenuCreate({ weekStart: '2026-10-12', copyFromMenuId: SOURCE }, checks),
      'meal_menu_source_not_found',
    )
    const source = {
      weekStart: WEEK,
      items: [
        item('2026-10-05', 0, 'Mercimek çorbası', { allergens: ['celery'] }),
        item('2026-10-09', 1, 'Pilav'),
        item('2026-10-05', 0, 'Simit', { mealKind: 'breakfast' }),
      ],
    }
    const { items } = planMealMenuCreate(
      { weekStart: '2026-10-12', copyFromMenuId: SOURCE },
      { ...checks, source },
    )
    assert.deepEqual(
      items.map((row) => [row.menuDate, row.name, row.position]),
      [
        ['2026-10-12', 'Mercimek çorbası', 0],
        ['2026-10-16', 'Pilav', 1],
      ],
    )
    assert.deepEqual(shiftMealItems(source.items, '2026-10-12', ['breakfast']).length, 1)
  })
})

describe('DOM-FIN-157: düzenleme, geçmiş gün ve gerekçeli düzeltme (K-527)', () => {
  const draft = {
    weekStart: WEEK,
    status: 'draft' as const,
    items: [item('2026-10-05', 0, 'Mercimek çorbası')],
  }
  const published = { ...draft, status: 'published' as const }
  const lunch = (menuDate: string, names: string[]) => ({
    menuDate,
    mealKind: 'lunch' as const,
    items: names.map((name) => ({ name, allergens: [], nutrition: null })),
  })
  const checks = { today: TODAY, enabledKinds: ['lunch'] as const, role: 'onburo' as const }

  test('taslağın geçmiş günü de değişir; hafta dışı gün ve kapalı öğün 422', () => {
    const plan = planMealMenuUpdate(
      draft,
      { slots: [lunch('2026-10-05', ['Ezogelin çorbası'])] },
      checks,
    )
    assert.equal(plan.slots.length, 1)
    assert.deepEqual(plan.corrections, [])
    rejects(
      () => planMealMenuUpdate(draft, { slots: [lunch('2026-10-12', ['Pilav'])] }, checks),
      'meal_menu_date_outside_week',
    )
    rejects(
      () =>
        planMealMenuUpdate(
          draft,
          { slots: [{ ...lunch('2026-10-08', ['Simit']), mealKind: 'breakfast' }] },
          checks,
        ),
      'meal_kind_disabled',
    )
  })

  test('değişmeyen hücre atlanır; hiç değişiklik yoksa 422', () => {
    rejects(
      () =>
        planMealMenuUpdate(draft, { slots: [lunch('2026-10-05', ['Mercimek çorbası'])] }, checks),
      'meal_menu_unchanged',
    )
    const plan = planMealMenuUpdate(
      draft,
      {
        slots: [lunch('2026-10-05', ['Mercimek çorbası']), lunch('2026-10-08', ['Pilav', 'Ayran'])],
      },
      checks,
    )
    assert.deepEqual(
      plan.slots.map((slot) => [slot.menuDate, slot.items.map((row) => row.position)]),
      [['2026-10-08', [0, 1]]],
    )
  })

  test('yayımlanmış menüde bugün ve sonrası değişir; geçmiş gün gerekçe ve yönetici ister', () => {
    const today = planMealMenuUpdate(published, { slots: [lunch(TODAY, ['Pilav'])] }, checks)
    assert.deepEqual(today.corrections, [])
    rejects(
      () => planMealMenuUpdate(published, { slots: [lunch('2026-10-05', ['Pilav'])] }, checks),
      'meal_menu_day_past',
    )
    rejects(
      () =>
        planMealMenuUpdate(
          published,
          {
            slots: [lunch('2026-10-05', ['Pilav'])],
            correctionReason: 'Mutfak menüyü değiştirdi.',
          },
          checks,
        ),
      'meal_menu_correction_forbidden',
      'forbidden',
    )
    const corrected = planMealMenuUpdate(
      published,
      { slots: [lunch('2026-10-05', ['Pilav'])], correctionReason: 'Mutfak menüyü değiştirdi.' },
      { ...checks, role: 'yonetici' },
    )
    assert.deepEqual(corrected.corrections, [{ menuDate: '2026-10-05', mealKind: 'lunch' }])
    rejects(
      () =>
        planMealMenuUpdate(
          published,
          { slots: [lunch(TODAY, ['Pilav'])], correctionReason: 'Gereksiz bir gerekçe.' },
          { ...checks, role: 'yonetici' },
        ),
      'meal_menu_correction_not_needed',
    )
  })

  test('alerjenler yönetmelik sırasına konur; sıra farkı değişiklik sayılmaz', () => {
    const withAllergens = {
      ...draft,
      items: [item('2026-10-05', 0, 'Börek', { allergens: ['gluten', 'milk'] })],
    }
    const slot = {
      menuDate: '2026-10-05',
      mealKind: 'lunch' as const,
      items: [{ name: 'Börek', allergens: ['milk' as const, 'gluten' as const], nutrition: null }],
    }
    rejects(
      () => planMealMenuUpdate(withAllergens, { slots: [slot] }, checks),
      'meal_menu_unchanged',
    )
    const plan = planMealMenuUpdate(draft, { slots: [{ ...slot, menuDate: '2026-10-06' }] }, checks)
    assert.deepEqual(plan.slots[0]?.items[0]?.allergens, ['gluten', 'milk'])
  })
})

describe('DOM-FIN-157: yayım, yayımdan kaldırma, arşiv ve ayar (K-526, K-527)', () => {
  test('yalnız yemeği olan taslak yayımlanır', () => {
    rejects(() => assertMealMenuPublishable('draft', 0), 'meal_menu_empty')
    rejects(() => assertMealMenuPublishable('published', 3), 'meal_menu_not_draft')
    assertMealMenuPublishable('draft', 1)
  })

  test('yayımdan kaldırma yalnız hafta başlamadan; arşiv yalnız taslakta', () => {
    rejects(
      () => assertMealMenuUnpublishable({ status: 'draft', weekStart: '2026-10-12' }, TODAY),
      'meal_menu_not_published',
    )
    rejects(
      () => assertMealMenuUnpublishable({ status: 'published', weekStart: WEEK }, TODAY),
      'meal_menu_week_started',
    )
    assertMealMenuUnpublishable({ status: 'published', weekStart: '2026-10-12' }, TODAY)
    rejects(() => assertMealMenuArchivable('published'), 'meal_menu_published')
    assertMealMenuArchivable('draft')
  })

  test('öğün ayarı gösterim sırasına konur; değişiklik yoksa 422', () => {
    assert.deepEqual(orderedMealKinds(['snack', 'breakfast']), ['breakfast', 'snack'])
    assert.deepEqual(planMealMenuSettings(['lunch'], { mealKinds: ['snack', 'lunch'] }), [
      'lunch',
      'snack',
    ])
    rejects(
      () => planMealMenuSettings(['lunch', 'snack'], { mealKinds: ['snack', 'lunch'] }),
      'meal_menu_settings_unchanged',
    )
  })

  test('aile görünümü: kampüsün yayımlanmış menüsü, yoksa bütün kampüslerin menüsü', () => {
    const menus = [
      { id: 'all', branchId: null, status: 'published' as const },
      { id: 'kadikoy', branchId: 'b1', status: 'published' as const },
      { id: 'moda', branchId: 'b2', status: 'draft' as const },
    ]
    assert.equal(familyMenuFor(menus, 'b1')?.id, 'kadikoy')
    assert.equal(familyMenuFor(menus, 'b2')?.id, 'all')
    assert.equal(familyMenuFor(menus, null)?.id, 'all')
    assert.equal(familyMenuFor(menus.slice(2), 'b2'), undefined)
  })
})

describe('DOM-FIN-157: günlük toplam ve alerjen matrisi (K-528)', () => {
  test('günlük toplam girilmiş besin değerlerinden; eksikler ayrıca sayılır', () => {
    const totals = mealDayTotals(WEEK, [
      item('2026-10-05', 0, 'Çorba', { nutrition: nutrition(180) }),
      item('2026-10-05', 1, 'Pilav', {
        nutrition: nutrition(250, { fiberDg: null, saltDg: null }),
      }),
      item('2026-10-05', 0, 'Simit', { mealKind: 'breakfast' }),
      item('2026-10-06', 0, 'Makarna', { nutrition: nutrition(400) }),
    ])
    assert.equal(totals.length, 7)
    assert.deepEqual(totals[0], {
      menuDate: '2026-10-05',
      itemCount: 3,
      missingNutrition: 1,
      energyKcal: 430,
      proteinDg: 200,
      fatDg: 100,
      carbohydrateDg: 600,
      fiberDg: 20,
      missingFiber: 1,
      saltDg: 8,
      missingSalt: 1,
    })
    assert.equal(totals[1]?.energyKcal, 400)
    assert.equal(totals[6]?.itemCount, 0)
  })

  test('matris gün, öğün ve sıra düzeninde; gün alerjenleri yönetmelik sırasında', () => {
    const { rows, dayAllergens } = mealAllergenMatrix([
      item('2026-10-05', 1, 'Yoğurt', { allergens: ['milk'] }),
      item('2026-10-05', 0, 'Simit', { mealKind: 'breakfast', allergens: ['sesame', 'gluten'] }),
      item('2026-10-05', 0, 'Çorba', { allergens: ['celery'] }),
      item('2026-10-06', 0, 'Pilav'),
    ])
    assert.deepEqual(
      rows.map((row) => row.name),
      ['Simit', 'Çorba', 'Yoğurt', 'Pilav'],
    )
    assert.equal(rows[0]?.marks.length, 14)
    assert.equal(rows[0]?.marks[ALLERGENS.indexOf('sesame')], true)
    assert.equal(rows[3]?.marks.some(Boolean), false)
    assert.deepEqual(dayAllergens.get('2026-10-05'), ['gluten', 'milk', 'celery', 'sesame'])
    assert.deepEqual(dayAllergens.get('2026-10-06'), [])
  })

  test('gram metni ve gram girişi (gramın onda biri)', () => {
    assert.equal(decigramText(125), '12,5 g')
    assert.equal(decigramText(120), '12 g')
    assert.equal(parseDecigrams('12,5'), 125)
    assert.equal(parseDecigrams('12.5'), 125)
    assert.equal(parseDecigrams(' 7 '), 70)
    assert.equal(parseDecigrams(''), null)
    assert.equal(parseDecigrams('12,55'), undefined)
    assert.equal(parseDecigrams('-1'), undefined)
  })
})
