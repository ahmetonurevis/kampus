import assert from 'node:assert/strict'
import test from 'node:test'

import type { MealAllergyRoster } from '@kampus/react-shared/use-finance-meal-allergy-checks.ts'

import { healthReasonFormSchema } from '../src/pages/finance/finance-health-access.ts'
import { healthReasonDefaults } from '../src/pages/finance/finance-health-access.ts'
import {
  acknowledgementText,
  classTarget,
  conflictText,
  gradeTarget,
  MEAL_ALLERGY_SUGGESTED_REASON,
  menuScopeText,
  rosterQuery,
  rosterTitle,
  severityText,
  unmatchedText,
  withAcknowledgement,
} from '../src/pages/finance/finance-meal-allergy-forms.ts'

// Yemekhane alerji uyarısı sekmesinin saf mantığı (DOM-FIN-162; ON-151; K-541…K-543).

const roster: MealAllergyRoster = {
  serviceDate: '2026-10-06',
  mealKind: 'lunch',
  classId: '7-A',
  grade: null,
  className: '7-A',
  studentCount: 2,
  studentsWithoutMenu: 0,
  menus: [{ menuId: 'm-1', branchId: null, branchName: null }],
  students: [
    {
      studentId: 's-1',
      studentName: 'Deniz Yılmaz',
      classId: '7-A',
      className: '7-A',
      severity: 'severe',
      profileUnreadable: false,
      conflicts: [
        { itemName: 'Fındıklı kek', position: 2, allergens: ['eggs', 'nuts'], severity: 'severe' },
      ],
      unmatched: [{ allergyName: 'Kivi', severity: 'mild', partial: false }],
      acknowledgement: null,
    },
  ],
}

test('DOM-FIN-162: seçim değeri sınıf ya da düzey sorgusuna çevrilir (K-541)', () => {
  const base = { serviceDate: '2026-10-06', mealKind: 'lunch' as const }
  assert.deepEqual(rosterQuery({ ...base, target: classTarget('7-A') }), {
    ...base,
    classId: '7-A',
  })
  assert.deepEqual(rosterQuery({ ...base, target: gradeTarget(7) }), { ...base, grade: 7 })
  for (const target of ['', 'class:', 'grade:x', 'grade:0', 'baska'])
    assert.equal(rosterQuery({ ...base, target }), null, target)
})

test('DOM-FIN-162: önerilen gerekçe diyalogda ön seçilidir ve geçerlidir (K-542, DOM-FIN-156)', () => {
  const defaults = healthReasonDefaults(MEAL_ALLERGY_SUGGESTED_REASON)
  assert.deepEqual(defaults, { code: 'other', note: 'Yemek servisinde alerji kontrolü' })
  assert.deepEqual(healthReasonFormSchema.parse(defaults), MEAL_ALLERGY_SUGGESTED_REASON)
  assert.deepEqual(healthReasonDefaults(), { code: '', note: '' })
  assert.deepEqual(healthReasonDefaults({ code: 'emergency', note: null }), {
    code: 'emergency',
    note: '',
  })
})

test('DOM-FIN-162: satır metinleri yemek, alerjen, şiddet ve elle kontrolü gösterir (K-542)', () => {
  const [row] = roster.students
  assert.ok(row)
  assert.equal(conflictText(row.conflicts[0]!), 'Fındıklı kek: Yumurta, Sert kabuklu yemişler')
  assert.equal(
    unmatchedText(row.unmatched[0]!),
    'Kivi (hafif) — menüyle karşılaştırılamadı, elle kontrol',
  )
  assert.equal(
    unmatchedText({ allergyName: 'Süt ve çilek', severity: 'moderate', partial: true }),
    'Süt ve çilek (orta) — bir kısmı menüyle karşılaştırılamadı, elle kontrol',
  )
  assert.equal(severityText('severe'), 'Ağır (anafilaksi riski)')
  assert.equal(severityText(null), 'Şiddet bilinmiyor')
  assert.equal(menuScopeText(roster.menus[0]!), 'Bütün kampüsler')
  assert.equal(menuScopeText({ menuId: 'm-2', branchId: 'b-1', branchName: 'Kadıköy' }), 'Kadıköy')
  assert.match(rosterTitle(roster, 'Öğle yemeği'), /6 Ekim Salı · Öğle yemeği · 7-A$/)
  assert.match(
    rosterTitle({ ...roster, classId: null, className: null, grade: 7 }, 'Öğle yemeği'),
    /· 7\. sınıflar$/,
  )
})

test('DOM-FIN-162: onay işareti listeye işlenir; metin saat ve görevliyi gösterir (K-543)', () => {
  const ack = {
    id: 'a-1',
    acknowledgedAt: '2026-10-06T09:05:00.000Z',
    acknowledgedByMembershipId: 'mem-1',
    acknowledgedByName: 'Büşra Aydın',
  }
  const next = withAcknowledgement(roster, 's-1', ack)
  assert.deepEqual(next.students[0]?.acknowledgement, ack)
  assert.equal(roster.students[0]?.acknowledgement, null)
  assert.deepEqual(withAcknowledgement(roster, 'yok', ack).students, roster.students)
  assert.equal(acknowledgementText(ack), 'Uyarı görüldü, alternatif verildi · 12:05 · Büşra Aydın')
  assert.equal(
    acknowledgementText({ ...ack, acknowledgedByName: null }),
    'Uyarı görüldü, alternatif verildi · 12:05 · görevli',
  )
})
