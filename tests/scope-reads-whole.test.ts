import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed } from '../packages/school-core/src/data/seed.ts'
import { scopeFor, type Actor } from '../packages/school-core/src/lib/scope.ts'
import { COLLECTION_NAMES } from '../packages/school-core/src/modules/collection-modules.ts'

const state = createSeed(new Date('2026-10-06T10:00:00.000Z'))
const actor = (role: Actor['role'], links: Actor['links'] = []): Actor => ({ role, links })

test('Yönetici ve ön büro okuyabildikleri koleksiyonu bütünüyle okur; yalnız duyuru koşulludur', () => {
  for (const role of ['yonetici', 'onburo'] as const) {
    const scope = scopeFor(state, actor(role))
    let whole = 0
    for (const name of COLLECTION_NAMES) {
      const allowed = scope.access(name).allowed
      // Duyuru görünürlüğü yayın ve alıcıya bağlıdır (DOM-ILT-004), koşulsuz değildir.
      assert.equal(scope.readsWhole(name), allowed && name !== 'announcements', `${role} ${name}`)
      if (scope.readsWhole(name)) whole++
    }
    assert.ok(whole >= 10, role)
  }
})

test('Kişisel kapsamlı roller ve erişimi kapalı koleksiyon bütün koleksiyonu okumaz', () => {
  const student = scopeFor(state, actor('ogrenci', [{ kind: 'student', recordId: 's1' }]))
  const parent = scopeFor(state, actor('veli', [{ kind: 'child', recordId: 's1' }]))
  for (const scope of [student, parent]) {
    assert.equal(scope.readsWhole('invoices'), false)
    assert.equal(scope.readsWhole('grades'), false)
    assert.equal(scope.readsWhole('bilinmeyen'), false)
  }
  // Satır kuralı koşulsuz olan ortak koleksiyonu herkes bütünüyle okur.
  assert.equal(student.readsWhole('subjects'), true)
  // Ön büro akademik koleksiyonda erişimsizdir; kapalı modül bütün okuma sayılmaz.
  assert.equal(scopeFor(state, actor('onburo')).readsWhole('grades'), false)
  const closed = { ...state, modules: { ...state.modules, exams: false } }
  assert.equal(scopeFor(closed, actor('yonetici')).readsWhole('mockExams'), false)
  assert.equal(scopeFor(state, actor('yonetici')).readsWhole('mockExams'), true)
})
