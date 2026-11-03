import assert from 'node:assert/strict'
import test from 'node:test'
import { dutyKindFor } from '../packages/school-core/src/lib/coordinator-duties.ts'
import { guardianRequired } from '../packages/school-core/src/lib/enrollment.ts'
import {
  INSTITUTION_TYPE_LABELS,
  TERMINOLOGY,
  adultEnrollsWithoutGuardian,
  categoryLabel,
  defaultModuleMap,
  defaultModulesFor,
  terminologyFor,
} from '../packages/school-core/src/lib/institution-types.ts'
import {
  INSTITUTION_TYPES,
  MODULE_KEYS,
  moduleAvailableFor,
  modulesFor,
} from '../packages/school-core/src/modules/collection-modules.ts'
import { navigation } from '../packages/school-core/src/modules/full-navigation.ts'

test('IST-001: üç kurum türü var; her birinin adı ve terminolojisi tanımlı', () => {
  assert.deepEqual(INSTITUTION_TYPES, ['school', 'language_school', 'course_center'])
  for (const type of INSTITUTION_TYPES) {
    assert.ok(INSTITUTION_TYPE_LABELS[type].length > 0)
    assert.equal(terminologyFor(type), TERMINOLOGY[type])
  }
  assert.equal(INSTITUTION_TYPE_LABELS.course_center, 'Kurs')
})

test('IST-001: kurs kursiyer, sınıf ve program + konu terimlerini kullanır', () => {
  const terms = terminologyFor('course_center')
  assert.equal(terms.learner, 'Kursiyer')
  assert.equal(terms.group, 'Sınıf')
  assert.equal(terms.teacher, 'Öğretmen')
  assert.equal(terms.level, 'Program')
  assert.equal(terms.unit, 'Konu')
  assert.equal(terms.levelModel, 'program_topic')
  // Okul ve dil okulu terimleri değişmez.
  assert.equal(terminologyFor('school').learner, 'Öğrenci')
  assert.equal(terminologyFor('language_school').group, 'Grup')
})

test('DOM-YTK-012: kursta deneme, optik, etüt ve hedef açılır; rehberlik ve yenileme bulunmaz', () => {
  for (const key of ['exams', 'optical', 'tutoring', 'goals'])
    assert.equal(moduleAvailableFor(key, 'course_center'), true, key)
  for (const key of ['guidance', 'renewal'])
    assert.equal(moduleAvailableFor(key, 'course_center'), false, key)
  // Dil okulunda sınav hazırlık modülleri hâlâ kapalıdır.
  for (const key of ['exams', 'optical', 'tutoring', 'goals'])
    assert.equal(moduleAvailableFor(key, 'language_school'), false, key)
  assert.deepEqual(
    modulesFor('course_center'),
    MODULE_KEYS.filter((key) => key !== 'guidance' && key !== 'renewal'),
  )
})

test('DOM-YTK-042: kurs servis, yemek ve kulüp kapalı başlar; okul ve dil okulu hepsi açık', () => {
  assert.deepEqual(defaultModuleMap('course_center'), {
    transport: false,
    meals: false,
    clubs: false,
  })
  assert.deepEqual(defaultModuleMap('school'), {})
  assert.deepEqual(defaultModuleMap('language_school'), {})
  for (const type of INSTITUTION_TYPES) {
    const defaults = defaultModulesFor(type)
    // Varsayılan açık modül türde açılabilir olmalı.
    for (const key of defaults) assert.equal(moduleAvailableFor(key, type), true, `${type} ${key}`)
    // Saklanan haritada `false` olmayan ve türde bulunan her modül açıktır.
    const map = defaultModuleMap(type)
    assert.deepEqual(
      defaults,
      modulesFor(type).filter((key) => map[key] !== false),
    )
  }
  assert.deepEqual(defaultModulesFor('school'), modulesFor('school'))
})

test('IST-001: kursta okul iş akışları SINAV HAZIRLIK, okul yaşamı KURS YAŞAMI adını alır', () => {
  assert.equal(categoryLabel('OKUL İŞ AKIŞLARI', 'course_center'), 'SINAV HAZIRLIK')
  assert.equal(categoryLabel('OKUL YAŞAMI', 'course_center'), 'KURS YAŞAMI')
  assert.equal(categoryLabel('İLETİŞİM', 'course_center'), 'İLETİŞİM')
  assert.equal(categoryLabel('OKUL İŞ AKIŞLARI', 'school'), 'OKUL İŞ AKIŞLARI')
  assert.equal(categoryLabel('OKUL İŞ AKIŞLARI', 'language_school'), 'OKUL İŞ AKIŞLARI')
  assert.equal(categoryLabel('toString', 'course_center'), 'toString')
  // Yeniden adlandırılan kategoriler menüde gerçekten vardır.
  const groups = new Set(Object.values(navigation).flatMap((pages) => pages.map((p) => p.group)))
  assert.ok(groups.has('OKUL İŞ AKIŞLARI'))
  assert.ok(groups.has('OKUL YAŞAMI'))
})

test('DOM-KAY-012, DOM-YTK-030: kursta 18 yaş üstü velisiz kaydolur, 18 altında veli gerekir', () => {
  const now = '2026-11-03T09:00:00.000Z'
  assert.equal(adultEnrollsWithoutGuardian('school'), false)
  assert.equal(adultEnrollsWithoutGuardian('language_school'), true)
  assert.equal(adultEnrollsWithoutGuardian('course_center'), true)
  // Tablo, kayıt akışının kuralıyla aynı sonucu verir.
  for (const type of INSTITUTION_TYPES) {
    assert.equal(guardianRequired(type, '2000-01-01', now), !adultEnrollsWithoutGuardian(type))
    assert.equal(guardianRequired(type, '2012-01-01', now), true)
  }
})

test('DOM-YTK-027: kursta ek görev ders kapsamlı zümre başkanlığıdır', () => {
  assert.equal(dutyKindFor('school'), 'subject_head')
  assert.equal(dutyKindFor('course_center'), 'subject_head')
  assert.equal(dutyKindFor('language_school'), 'academic_coordinator')
})
