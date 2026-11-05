import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed } from '../packages/school-core/src/data/seed.ts'
import { updateParentDetails } from '../packages/school-core/src/lib/registration-records.ts'
import type { Actor } from '../packages/school-core/src/lib/scope.ts'
import { isDomainError } from './support/domain-error.ts'

// ON-117, DOM-KAY-012: kayıt sonrası veli bilgisi düzeltme.
const NOW = '2026-10-06T09:00:00.000Z'
const actors: Record<Actor['role'], Actor> = {
  yonetici: { role: 'yonetici', links: [] },
  onburo: { role: 'onburo', links: [] },
  ogretmen: { role: 'ogretmen', links: [{ kind: 'teacher', recordId: 't1' }] },
  ogrenci: { role: 'ogrenci', links: [{ kind: 'student', recordId: 's1' }] },
  veli: { role: 'veli', links: [{ kind: 'child', recordId: 's1' }] },
}
const fresh = () => {
  const state = createSeed(new Date(NOW))
  const parent = state.parents.find((item) => item.id === 'p1')!
  parent.phone = '05550000001'
  parent.email = 'ayse@example.com'
  return { state, parent }
}

test('ON-117: ön büro ve yönetici veli adını, telefonunu ve e-postasını düzeltir; değişen alanlar döner', () => {
  for (const role of ['yonetici', 'onburo'] as const) {
    const { state, parent } = fresh()
    const changed = updateParentDetails(state, actors[role], 'p1', {
      name: 'Ayşe Yılmaz Kaya',
      phone: '05550000002',
      email: 'AYSE.KAYA@example.com',
    })
    assert.deepEqual(changed, ['name', 'phone', 'email'])
    assert.equal(parent.name, 'Ayşe Yılmaz Kaya')
    assert.equal(parent.phone, '05550000002')
    assert.equal(parent.email, 'ayse.kaya@example.com')
    assert.deepEqual(parent.studentIds, ['s1', 's2'])
  }
})

test('ON-117: gönderilmeyen alan aynı kalır; boş e-posta siler, aynı değer değişiklik sayılmaz', () => {
  const { state, parent } = fresh()
  assert.deepEqual(
    updateParentDetails(state, actors.onburo, 'p1', { email: '', name: parent.name }),
    ['email'],
  )
  assert.equal('email' in parent, false)
  assert.equal(parent.phone, '05550000001')
})

test('ON-117: değişiklik yoksa 409, kayıt yoksa 404, geçersiz alan ve boş gövde reddedilir; State değişmez', () => {
  const { state } = fresh()
  const before = JSON.stringify(state)
  assert.throws(
    () => updateParentDetails(state, actors.onburo, 'p1', { phone: '05550000001' }),
    isDomainError('parent_unchanged', 'conflict'),
  )
  assert.throws(
    () => updateParentDetails(state, actors.onburo, 'yok', { name: 'Ad Soyad' }),
    isDomainError('parent_not_found', 'not_found'),
  )
  assert.throws(() => updateParentDetails(state, actors.onburo, 'p1', {}))
  assert.throws(() => updateParentDetails(state, actors.onburo, 'p1', { phone: '' }))
  assert.throws(() => updateParentDetails(state, actors.onburo, 'p1', { phone: '5551234567' }))
  assert.throws(() => updateParentDetails(state, actors.onburo, 'p1', { email: 'gecersiz' }))
  assert.throws(() =>
    updateParentDetails(state, actors.onburo, 'p1', { relationship: 'mother' } as never),
  )
  assert.equal(JSON.stringify(state), before)
})

test('ON-117: öğretmen, öğrenci ve veli veli kaydını düzeltemez', () => {
  for (const role of ['ogretmen', 'ogrenci', 'veli'] as const) {
    const { state } = fresh()
    const before = JSON.stringify(state)
    assert.throws(
      () => updateParentDetails(state, actors[role], 'p1', { name: 'Başka Ad' }),
      isDomainError('permission_denied', 'forbidden'),
    )
    assert.equal(JSON.stringify(state), before)
  }
})
