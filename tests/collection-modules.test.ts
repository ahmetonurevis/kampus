// @ts-nocheck — TODO(ts): test tipleri dosya dosya tamamlanacak
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed } from '../packages/school-core/src/data/seed.ts'
import { navigation } from '../packages/school-core/src/modules/full-navigation.ts'
import { schoolModules } from '../packages/school-core/src/modules/school-workflows.ts'
import {
  ALWAYS_ON,
  COLLECTION_MODULES,
  COLLECTION_NAMES,
  MODULE_KEYS,
  collectionModule,
  collectionStatus,
  isCollectionName,
  isModuleKey,
  moduleAvailableFor,
  modulesFor,
} from '../packages/school-core/src/modules/collection-modules.ts'

const now = new Date('2026-10-06T10:00:00.000Z')

test('Modül anahtarları menü ve iş akışı kaydıyla aynıdır', () => {
  const fromNavigation = Object.values(navigation).flatMap((pages) =>
    pages.flatMap((page) => (page.module ? [page.module] : [])),
  )
  const known = new Set([...fromNavigation, ...schoolModules.map((m) => m.key)])
  assert.deepEqual([...MODULE_KEYS].sort(), [...known].sort())
  assert.ok(isModuleKey('guidance'))
  assert.ok(!isModuleKey('toString'))
  assert.ok(!isModuleKey('olmayan'))
})

test('Her State koleksiyonu bir modüle bağlıdır ya da açıkça her zaman açıktır', () => {
  const state = createSeed(now)
  const arrays = Object.entries(state)
    .filter(([, value]) => Array.isArray(value))
    .map(([key]) => key)
  assert.deepEqual([...COLLECTION_NAMES].sort(), arrays.sort())
  for (const name of COLLECTION_NAMES) {
    const module = COLLECTION_MODULES[name]
    assert.ok(module === ALWAYS_ON || isModuleKey(module), `${name} → ${module}`)
  }
  // Program yönetimi (`planning`) akademik modülün `schedule` koleksiyonunu düzenler; kendi
  // koleksiyonu yoktur. Diğer her modülün en az bir koleksiyonu vardır.
  const used = new Set(Object.values(COLLECTION_MODULES))
  for (const key of MODULE_KEYS) assert.equal(used.has(key), key !== 'planning', key)
  assert.equal(collectionModule('guidanceCases'), 'guidance')
  assert.equal(collectionModule('students'), ALWAYS_ON)
  assert.equal(collectionModule('olmayan'), undefined)
  assert.equal(collectionModule('__proto__'), undefined)
  assert.ok(isCollectionName('tutorSessions'))
  assert.ok(!isCollectionName('constructor'))
  assert.ok(!isCollectionName('modules'))
})

test('Kurum türü modülleri daraltır (DOM-YTK-012)', () => {
  for (const key of ['exams', 'guidance', 'optical', 'tutoring', 'goals', 'renewal']) {
    assert.ok(moduleAvailableFor(key, 'school'), key)
    assert.ok(!moduleAvailableFor(key, 'language_school'), key)
  }
  for (const key of ['crm', 'finance', 'academic', 'learning', 'communication', 'calendar'])
    assert.ok(moduleAvailableFor(key, 'language_school'), key)
  assert.ok(!moduleAvailableFor('olmayan', 'school'))
  assert.deepEqual(modulesFor('school'), MODULE_KEYS)
  assert.ok(!modulesFor('language_school').includes('exams'))
  assert.ok(modulesFor('language_school').includes('learning'))
})

test('Koleksiyon durumu kurum türü ve modül haritasından çözülür', () => {
  const modules = { guidance: true, exams: false, learning: true }
  assert.equal(collectionStatus('guidanceCases', modules, 'school'), 'enabled')
  assert.equal(collectionStatus('mockExams', modules, 'school'), 'disabled')
  // Haritada olmayan modül kapalı sayılır.
  assert.equal(collectionStatus('clubs', modules, 'school'), 'disabled')
  assert.equal(collectionStatus('guidanceCases', modules, 'language_school'), 'unavailable')
  assert.equal(collectionStatus('students', {}, 'language_school'), 'enabled')
  assert.equal(collectionStatus('olmayan', modules, 'school'), 'unknown')
})
