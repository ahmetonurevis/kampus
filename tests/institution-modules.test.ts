import assert from 'node:assert/strict'
import test from 'node:test'
import { createSeed } from '../packages/school-core/src/data/seed.ts'
import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import { setModuleEnabled } from '../packages/school-core/src/lib/institution-modules.ts'
import { roles } from '../packages/school-core/src/modules/navigation.ts'
import { MODULE_KEYS, modulesFor } from '../packages/school-core/src/modules/collection-modules.ts'
import { MODULE_INFOS, moduleInfo } from '../packages/school-core/src/modules/module-catalog.ts'

const ROLES = Object.keys(roles) as (keyof typeof roles)[]
const now = new Date('2026-10-06T10:00:00.000Z')
const admin = { role: 'yonetici' } as const

function source(type: 'school' | 'language_school' = 'school') {
  return { institutionType: type, modules: { ...createSeed(now).modules } }
}

function reject(fn: () => unknown, code: string, kind: DomainError['kind']) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof DomainError, String(error))
    assert.equal(error.code, code)
    assert.equal(error.kind, kind)
    return true
  })
}

test('Yönetici modülü kapatır ve yeniden açar; yalnız o modülün değeri değişir', () => {
  const before = source()
  const snapshot = structuredClone(before)
  const closed = setModuleEnabled(before, admin, 'meals', { enabled: false })
  assert.equal(closed.enabled, false)
  assert.equal(closed.moduleKey, 'meals')
  assert.equal(closed.modules.meals, false)
  assert.deepEqual(
    Object.entries(closed.modules).filter(([key]) => key !== 'meals'),
    Object.entries(before.modules).filter(([key]) => key !== 'meals'),
  )
  // Girdi değişmez: işlem saftır, veri silinmez.
  assert.deepEqual(before, snapshot)

  const reopened = setModuleEnabled(
    { institutionType: 'school', modules: closed.modules },
    admin,
    'meals',
    { enabled: true },
  )
  assert.equal(reopened.modules.meals, true)
})

test('Saklanmayan modül açık sayılır; kapatılabilir, açma ise module_unchanged olur', () => {
  const stored = { institutionType: 'school', modules: {} } as const
  assert.equal(setModuleEnabled(stored, admin, 'clubs', { enabled: false }).modules.clubs, false)
  reject(
    () => setModuleEnabled(stored, admin, 'clubs', { enabled: true }),
    'module_unchanged',
    'conflict',
  )
})

test('Yönetici olmayan her rol reddedilir ve harita değişmez', () => {
  for (const role of ROLES.filter((item) => item !== 'yonetici')) {
    const before = source()
    const snapshot = structuredClone(before)
    reject(
      () => setModuleEnabled(before, { role }, 'meals', { enabled: false }),
      'permission_denied',
      'forbidden',
    )
    assert.deepEqual(before, snapshot, role)
  }
})

test('Kurum türünde olmayan modül açılamaz ve kapatılamaz', () => {
  const language = source('language_school')
  assert.ok(!modulesFor('language_school').includes('goals'))
  for (const enabled of [true, false])
    reject(
      () => setModuleEnabled(language, admin, 'goals', { enabled }),
      'module_unavailable_for_type',
      'rule',
    )
  // Aynı modül okul türünde kullanılabilir.
  assert.equal(setModuleEnabled(source(), admin, 'goals', { enabled: false }).modules.goals, false)
})

test('Bilinmeyen modül ve yerleşik nesne adları bulunamaz', () => {
  for (const key of ['olmayan', 'toString', '__proto__'])
    reject(
      () => setModuleEnabled(source(), admin, key, { enabled: false }),
      'module_not_found',
      'not_found',
    )
})

test('Durum değişmiyorsa module_unchanged (409) döner', () => {
  reject(
    () => setModuleEnabled(source(), admin, 'meals', { enabled: true }),
    'module_unchanged',
    'conflict',
  )
  const closed = { institutionType: 'school', modules: { meals: false } } as const
  reject(
    () => setModuleEnabled(closed, admin, 'meals', { enabled: false }),
    'module_unchanged',
    'conflict',
  )
})

test('Geçersiz gövde ZodError olur', () => {
  for (const input of [{}, { enabled: 'evet' }, null, undefined, { enabled: 1 }])
    assert.throws(() => setModuleEnabled(source(), admin, 'meals', input), { name: 'ZodError' })
})

test('Modül kapatmak koleksiyon kayıtlarına dokunmaz (gelecek etüt korunur)', () => {
  const state = createSeed(now)
  const sessions = structuredClone(state.tutorSessions)
  const result = setModuleEnabled(
    { institutionType: 'school', modules: state.modules },
    admin,
    'tutoring',
    { enabled: false },
  )
  assert.equal(result.modules.tutoring, false)
  assert.deepEqual(state.tutorSessions, sessions)
  assert.equal(state.modules.tutoring, true)
})

test('Modül kataloğu her modül için ad ve açıklama verir', () => {
  assert.deepEqual(
    MODULE_INFOS.map((info) => info.key),
    [...MODULE_KEYS],
  )
  for (const info of MODULE_INFOS) {
    assert.ok(info.title.length > 0 && info.description.length > 0, info.key)
    assert.equal(moduleInfo(info.key), info)
  }
  assert.equal(moduleInfo('toString'), undefined)
})
