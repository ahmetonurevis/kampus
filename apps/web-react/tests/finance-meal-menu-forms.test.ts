import assert from 'node:assert/strict'
import test from 'node:test'

import type { MealMenuDay, MealMenuItem } from '@kampus/react-shared/use-finance-meal-menus.ts'

import {
  allergensText,
  branchText,
  correctionReasonError,
  createBody,
  dayHeading,
  emptyItem,
  gridMealKinds,
  isPastPublished,
  itemFormSchema,
  nutritionText,
  slotBody,
  slotDefaults,
  slotFormField,
  slotItems,
  totalsText,
  weekText,
} from '../src/pages/finance/finance-meal-menu-forms.ts'

// Yemek menüsü sekmesinin saf mantığı (DOM-FIN-157; ON-090, ON-149; K-526…K-528).

const soup: MealMenuItem = {
  id: 'test-i1',
  position: 0,
  name: 'Mercimek çorbası',
  allergens: ['celery'],
  nutrition: {
    energyKcal: 180,
    proteinDg: 85,
    fatDg: 42,
    carbohydrateDg: 260,
    fiberDg: null,
    saltDg: 9,
  },
}
const totals: MealMenuDay['totals'] = {
  itemCount: 2,
  missingNutrition: 1,
  energyKcal: 180,
  proteinDg: 85,
  fatDg: 42,
  carbohydrateDg: 260,
  fiberDg: 0,
  missingFiber: 1,
  saltDg: 9,
  missingSalt: 0,
}
const day: MealMenuDay = {
  menuDate: '2026-10-05',
  meals: [{ mealKind: 'lunch', items: [soup] }],
  totals,
}

test('DOM-FIN-157: gün, hafta, kampüs ve alerjen metinleri', () => {
  assert.equal(dayHeading('2026-10-05'), 'Pazartesi 5 Eki')
  assert.equal(weekText({ weekStart: '2026-10-05', weekEnd: '2026-10-11' }), '5 Eki – 11 Eki 2026')
  assert.equal(branchText({ branchId: null, branchName: null }), 'Bütün kampüsler')
  assert.equal(branchText({ branchId: 'b1', branchName: 'Kadıköy Kampüsü' }), 'Kadıköy Kampüsü')
  assert.equal(allergensText([]), 'İşaretli alerjen yok')
  assert.equal(allergensText(['gluten', 'milk']), 'Gluten, Süt')
  assert.equal(nutritionText(soup), '180 kcal · P 8,5 g · Y 4,2 g · K 26 g')
  assert.equal(nutritionText({ nutrition: null }), 'Besin değeri yok')
})

test('DOM-FIN-157: günlük toplam metni eksik besin değerini söyler (K-528)', () => {
  assert.equal(
    totalsText(totals),
    '180 kcal · protein 8,5 g · yağ 4,2 g · karbonhidrat 26 g · tuz 0,9 g · 1 yemekte besin değeri yok',
  )
  assert.equal(
    totalsText({ ...totals, itemCount: 3, missingNutrition: 1, fiberDg: 20 }),
    '180 kcal · protein 8,5 g · yağ 4,2 g · karbonhidrat 26 g · lif 2 g (eksik) · tuz 0,9 g · 1 yemekte besin değeri yok',
  )
  assert.equal(totalsText({ ...totals, itemCount: 0 }), '')
  assert.equal(totalsText({ ...totals, itemCount: 1 }), 'Besin değeri girilmemiş')
})

test('DOM-FIN-157: ızgara açık öğünleri ve kalemi kalmış kapalı öğünü gösterir (K-526)', () => {
  assert.deepEqual(gridMealKinds(['breakfast'], [day]), ['breakfast', 'lunch'])
  assert.deepEqual(gridMealKinds(['snack', 'lunch'], []), ['lunch', 'snack'])
  assert.deepEqual(slotItems(day, 'lunch'), [soup])
  assert.deepEqual(slotItems(day, 'snack'), [])
})

test('DOM-FIN-157: menü açma gövdesi pazartesiye çevrilir, boş seçimler gönderilmez', () => {
  assert.deepEqual(createBody({ weekDay: '2026-10-08', branchId: '', copyFromMenuId: '' }), {
    weekStart: '2026-10-05',
    branchId: null,
  })
  assert.deepEqual(
    createBody({ weekDay: '2026-10-12', branchId: 'b1', copyFromMenuId: 'test-m1' }),
    { weekStart: '2026-10-12', branchId: 'b1', copyFromMenuId: 'test-m1' },
  )
})

test('DOM-FIN-157: hücre formu gramı ondalıkla alır, gövdeye gramın onda biri gider (K-528)', () => {
  const defaults = slotDefaults([soup])
  assert.equal(defaults.items[0]?.proteinG, '8,5')
  assert.equal(defaults.items[0]?.fiberG, '')
  const body = slotBody('2026-10-05', 'lunch', defaults, false)
  assert.deepEqual(body, {
    slots: [
      {
        menuDate: '2026-10-05',
        mealKind: 'lunch',
        items: [
          {
            name: 'Mercimek çorbası',
            allergens: ['celery'],
            nutrition: {
              energyKcal: 180,
              proteinDg: 85,
              fatDg: 42,
              carbohydrateDg: 260,
              fiberDg: null,
              saltDg: 9,
            },
          },
        ],
      },
    ],
  })
  const plain = slotBody(
    '2026-10-05',
    'lunch',
    {
      items: [{ ...emptyItem(), name: ' Yoğurt ', allergens: ['milk', 'gluten'] }],
      correctionReason: ' Mutfak değiştirdi menüyü. ',
    },
    true,
  )
  assert.deepEqual(plain.slots[0]?.items[0], {
    name: 'Yoğurt',
    allergens: ['gluten', 'milk'],
    nutrition: null,
  })
  assert.equal(plain.correctionReason, 'Mutfak değiştirdi menüyü.')
})

test('DOM-FIN-157: besin değeri dört alanla birlikte girilir; geçersiz gram reddedilir', () => {
  const valid = { ...emptyItem(), name: 'Pilav' }
  assert.equal(itemFormSchema.safeParse(valid).success, true)
  assert.equal(itemFormSchema.safeParse({ ...valid, energyKcal: '250' }).success, false)
  assert.equal(
    itemFormSchema.safeParse({
      ...valid,
      energyKcal: '250',
      proteinG: '4,5',
      fatG: '6',
      carbohydrateG: '45,2',
    }).success,
    true,
  )
  assert.equal(itemFormSchema.safeParse({ ...valid, saltG: '1,2' }).success, false)
  assert.equal(itemFormSchema.safeParse({ ...valid, proteinG: '4,55' }).success, false)
  assert.equal(itemFormSchema.safeParse({ ...valid, saltG: '25' }).success, false)
  assert.equal(itemFormSchema.safeParse({ ...valid, energyKcal: '12.5' }).success, false)
})

test('DOM-FIN-157: geçmiş gün düzeltmesi, gerekçe ve sunucu hata yolu (K-527)', () => {
  assert.equal(isPastPublished({ status: 'published' }, '2026-10-05', '2026-10-06'), true)
  assert.equal(isPastPublished({ status: 'published' }, '2026-10-06', '2026-10-06'), false)
  assert.equal(isPastPublished({ status: 'draft' }, '2026-10-05', '2026-10-06'), false)
  assert.ok(correctionReasonError('kısa'))
  assert.equal(correctionReasonError('Mutfak menüyü değiştirdi.'), undefined)
  assert.equal(slotFormField('slots.0.items.2.name'), 'items.2.name')
  assert.equal(slotFormField('correctionReason'), 'correctionReason')
  assert.equal(slotFormField('slots.0.menuDate'), null)
})
