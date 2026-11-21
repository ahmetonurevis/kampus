import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import {
  scopedActorLinks,
  type GuardianLink,
} from '../packages/school-core/src/lib/guardianship.ts'
import {
  ONUR_READ_RULES,
  requireReadable,
  scopeFor,
  type Actor,
  type ActorLink,
} from '../packages/school-core/src/lib/scope.ts'
import { isDomainError } from './support/domain-error.ts'

/**
 * Ödeyici velinin finans okuması (ON-291; K-04 kullanıcı kararı 2026-11-03; DOM-FIN-052,
 * DOM-ILT-074). Velayeti olmayan ödeyici veli ödediği öğrencinin fatura ve sözleşmesini okur;
 * kayıt koleksiyonları (yenileme, kayıt geçmişi, aday) ve akademik okumalar velayet kapsamında
 * kalır. Ödeyici bağlantısının kurulması OG-1002'dedir (`tests/payer-scope.test.ts`).
 */

const now = '2026-10-06T10:00:00.000Z'
const seed = () => createSeed(new Date(now))
const links = (kind: ActorLink['kind'], ...ids: string[]): ActorLink[] =>
  ids.map((recordId) => ({ kind, recordId }))
const veli = (...items: ActorLink[]): Actor => ({ role: 'veli', links: items })
const studentsOf = (rows: readonly { studentId: string }[]) =>
  [...new Set(rows.map((row) => row.studentId))].sort()

/** Kayıt koleksiyonlarında seed satırı yoktur; her öğrenci için bir test satırı eklenir. */
function withEnrollmentRows(state: State): State {
  return {
    ...state,
    renewals: [
      { id: 'test-ren-1', studentId: 's1' },
      { id: 'test-ren-2', studentId: 's2' },
    ],
    enrollmentHistory: [
      { id: 'test-eh-1', studentId: 's1' },
      { id: 'test-eh-2', studentId: 's2' },
    ],
  } as unknown as State
}

const payerBond: GuardianLink = {
  id: 'test-g1',
  studentId: 's1',
  parentId: null,
  membershipId: 'm-baba',
  relationship: 'father',
  custody: 'none',
  contactRestricted: false,
  isPayer: true,
  canPickUp: false,
}

describe('ödeyici velinin finans okuması (ON-291, K-04)', () => {
  test('DOM-FIN-052 DOM-ILT-074 velayetsiz ödeyici veli ödediği öğrencinin faturalarını ve sözleşmesini okur', () => {
    const state = seed()
    const payer = scopeFor(state, veli(...links('payer', 's1')))
    assert.doesNotThrow(() => requireReadable(payer, 'invoices'))
    assert.doesNotThrow(() => requireReadable(payer, 'contracts'))
    const invoices = payer.read('invoices', state.invoices)
    assert.equal(invoices.length, state.invoices.filter((row) => row.studentId === 's1').length)
    assert.ok(invoices.length > 0)
    assert.deepEqual(studentsOf(invoices), ['s1'])
    const contracts = payer.read('contracts', state.contracts)
    assert.ok(contracts.length > 0)
    assert.deepEqual(studentsOf(contracts), ['s1'])
  })

  test('DOM-FIN-052 ödeyici veli ödeyicisi olmadığı öğrencinin finansını okumaz', () => {
    const state = seed()
    const payer = scopeFor(state, veli(...links('payer', 's1')))
    const other = state.invoices.find((row) => row.studentId === 's2')
    const otherContract = state.contracts.find((row) => row.studentId === 's2')
    assert.ok(other)
    assert.ok(otherContract)
    assert.equal(payer.canRead('invoices', other), false)
    assert.equal(payer.canRead('contracts', otherContract), false)
  })

  test('DOM-ILT-070 velayetli ödeyici veli finans satırını bir kez okur', () => {
    const state = seed()
    const custodial = scopeFor(state, veli(...links('child', 's1')))
    const both = scopeFor(state, veli(...links('child', 's1'), ...links('payer', 's1')))
    for (const name of ['invoices', 'contracts'] as const) {
      const rows: readonly object[] = state[name]
      assert.deepEqual(both.read(name, rows), custodial.read(name, rows), name)
    }
  })

  test('DOM-ILT-074 iletişim kısıtlı veli ödeyici bağıyla finans okumaz', () => {
    const state = seed()
    const restricted = { ...payerBond, contactRestricted: true }
    const actor = veli(...scopedActorLinks(links('child', 's1'), [restricted], 'm-baba'))
    const scope = scopeFor(state, actor)
    assert.deepEqual(scope.read('invoices', state.invoices), [])
    assert.deepEqual(scope.read('contracts', state.contracts), [])
  })

  test('DOM-YTK-025 ödeyici bağı kayıt koleksiyonlarını açmaz (yenileme, kayıt geçmişi, aday)', () => {
    const state = withEnrollmentRows(seed())
    const payer = scopeFor(state, veli(...links('payer', 's1')))
    const custodial = scopeFor(state, veli(...links('child', 's1')))
    for (const name of ['renewals', 'enrollmentHistory'] as const) {
      const rows: readonly object[] = state[name]
      assert.deepEqual(payer.read(name, rows), [], name)
      assert.equal(custodial.read(name, rows).length, 1, name)
    }
    assert.equal(payer.access('prospects').allowed, false)
  })

  test('DOM-YTK-024 öğrenci ve öğretmende ödeyici bağlantısı finans kapsamı vermez', () => {
    const state = seed()
    const learner = scopeFor(state, {
      role: 'ogrenci',
      links: [...links('student', 's2'), ...links('payer', 's1')],
    })
    assert.deepEqual(studentsOf(learner.read('invoices', state.invoices)), ['s2'])
    assert.equal(learner.access('contracts').allowed, false)
    const teacher = scopeFor(state, {
      role: 'ogretmen',
      links: [...links('teacher', 't1'), ...links('payer', 's1')],
    })
    assert.equal(teacher.access('invoices').allowed, false)
  })

  test('DOM-YTK-040 finans modülü kapalıyken ödeyici veli fatura ve sözleşme okuyamaz', () => {
    const state = seed()
    const payer = scopeFor(
      { ...state, modules: { ...state.modules, finance: false } },
      veli(...links('payer', 's1')),
    )
    for (const name of ['invoices', 'contracts'] as const) {
      assert.deepEqual(payer.access(name), { allowed: false, reason: 'module_disabled' })
      assert.throws(
        () => requireReadable(payer, name),
        isDomainError('module_disabled', 'forbidden'),
      )
    }
  })

  test('ON-291 finans kuralı yalnız fatura ve sözleşmede ödeyiciyi tanır', () => {
    const state = withEnrollmentRows(seed())
    const payer = scopeFor(state, veli(...links('payer', 's1')))
    const readable = Object.keys(ONUR_READ_RULES).filter((name) => {
      const rows = (state as unknown as Record<string, readonly object[]>)[name] ?? []
      return payer.access(name).allowed && payer.read(name, rows).length > 0
    })
    assert.deepEqual(readable.sort(), ['contracts', 'invoices'])
  })
})
