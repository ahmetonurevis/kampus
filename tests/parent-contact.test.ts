import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import {
  maskEmail,
  maskParentContact,
  maskPhone,
  parentContactDecision,
  revealParentContact,
  revealParentContactSchema,
} from '../packages/school-core/src/lib/parent-contact.ts'
import { redactRecord, scopeFor, type Actor } from '../packages/school-core/src/lib/scope.ts'
import { isDomainError } from './support/domain-error.ts'

const now = '2026-10-06T10:00:00.000Z'
const PHONE = '05321234512'
const EMAIL = 'ayse.yilmaz@gmail.com'

/** Örnek veri; p1 (Ayşe Yılmaz, s1 ve s2 velisi) iletişim bilgisi taşır. */
function seed(): State {
  const state = createSeed(new Date(now))
  state.parents = state.parents.map((p) =>
    p.id === 'p1' ? { ...p, phone: PHONE, email: EMAIL } : p,
  )
  return state
}
const teacher = (recordId = 't1'): Actor => ({
  role: 'ogretmen',
  links: [{ kind: 'teacher', recordId }],
})
const admin: Actor = { role: 'yonetici', links: [] }
const frontOffice: Actor = { role: 'onburo', links: [] }
const student: Actor = { role: 'ogrenci', links: [{ kind: 'student', recordId: 's1' }] }
const parent: Actor = { role: 'veli', links: [{ kind: 'child', recordId: 's1' }] }
const p1 = (state: State) => state.parents.find((p) => p.id === 'p1')

/** s1'in sınıfında dersi olan ve olmayan iki öğretmen (örnek veriden türetilir). */
function teachers(state: State) {
  const s1 = state.students.find((s) => s.id === 's1')
  const teaching = state.assignments.find((a) => a.classId === s1?.classId)?.teacherId
  const other = state.teachers.find(
    (t) =>
      !state.assignments.some((a) => a.teacherId === t.id && a.classId === s1?.classId) &&
      !state.classes.some((c) => c.teacherId === t.id && c.id === s1?.classId),
  )?.id
  assert.ok(teaching && other)
  return { teaching, other }
}

test('DOM-YTK-055: telefon ilk dört ve son iki hane, e-posta ilk harf ve alan adıyla maskelenir', () => {
  assert.equal(maskPhone('05321234512'), '0532 *** ** 12')
  assert.equal(maskPhone('0532 123 45 12'), '0532 *** ** 12')
  assert.equal(maskPhone('+90 532 123 45 12'), '0532 *** ** 12')
  assert.equal(maskPhone('5321234512'), '0532 *** ** 12')
  assert.equal(maskPhone('1234567'), '*** ** 67')
  assert.equal(maskPhone('12'), '***')
  assert.equal(maskEmail('ayse@gmail.com'), 'a***@gmail.com')
  assert.equal(maskEmail('@gmail.com'), '***@gmail.com')
  assert.equal(maskEmail('gecersiz'), '***')
  assert.deepEqual(maskParentContact({ id: 'p', phone: PHONE, email: '', name: 'Ad' }), {
    id: 'p',
    phone: '0532 *** ** 12',
    email: '',
    name: 'Ad',
  })
  assert.deepEqual(maskParentContact({ id: 'p' }), { id: 'p' })
})

test('DOM-YTK-055: ders veren öğretmen veli iletişimini maskeli görür, maskeli alan aranmaz', () => {
  const state = seed()
  const { teaching, other } = teachers(state)
  const scope = scopeFor(state, teacher(teaching))
  const row = scope.read('parents', state.parents).find((p) => p.id === 'p1')
  assert.equal(row?.phone, '0532 *** ** 12')
  assert.equal(row?.email, 'a***@gmail.com')
  assert.equal(row?.name, 'Ayşe Yılmaz')
  for (const field of ['phone', 'email'])
    assert.ok(scope.searchExcludedFields('parents').includes(field))
  // Ham kayıt değişmez; maskeleme kopya üzerindedir.
  assert.equal(p1(state)?.phone, PHONE)
  // Ders vermeyen öğretmen veliyi hiç görmez.
  assert.equal(redactRecord(state, teacher(other), 'parents', p1(state) ?? {}), undefined)
})

test('DOM-YTK-055: yönetici ve ön büro tam değeri görür; öğrenci ve veli iletişim alanını hiç görmez', () => {
  const state = seed()
  for (const actor of [admin, frontOffice]) {
    const row = redactRecord(state, actor, 'parents', p1(state) ?? { id: 'p1' })
    assert.equal(row?.phone, PHONE, actor.role)
    assert.equal(row?.email, EMAIL, actor.role)
    assert.ok(!scopeFor(state, actor).searchExcludedFields('parents').includes('phone'))
  }
  for (const actor of [student, parent]) {
    const row = redactRecord(state, actor, 'parents', p1(state) ?? { id: 'p1' })
    assert.ok(row, actor.role)
    assert.equal('phone' in row, false, actor.role)
    assert.equal('email' in row, false, actor.role)
    assert.equal(row.name, 'Ayşe Yılmaz')
  }
})

test('DOM-YTK-055: Göster yalnız ders veren öğretmene ve öğrenciye bağlı veliye tam değeri döndürür', () => {
  const state = seed()
  const { teaching, other } = teachers(state)
  const scope = scopeFor(state, teacher(teaching))
  assert.deepEqual(revealParentContact(scope, p1(state), { studentId: 's1', field: 'phone' }), {
    parentId: 'p1',
    studentId: 's1',
    field: 'phone',
    value: PHONE,
  })
  assert.equal(
    revealParentContact(scope, p1(state), { studentId: 's1', field: 'email' }).value,
    EMAIL,
  )

  // Ders vermeyen öğretmen, olmayan veli, öğrenciye bağlı olmayan veli: aynı 404.
  const outside = scopeFor(state, teacher(other))
  assert.throws(
    () => revealParentContact(outside, p1(state), { studentId: 's1', field: 'phone' }),
    isDomainError('parent_not_found', 'not_found'),
  )
  assert.throws(
    () => revealParentContact(scope, undefined, { studentId: 's1', field: 'phone' }),
    isDomainError('parent_not_found', 'not_found'),
  )
  const foreign = state.parents.find((p) => !p.studentIds.includes('s1'))
  assert.throws(
    () => revealParentContact(scope, foreign, { studentId: 's1', field: 'phone' }),
    isDomainError('parent_not_found', 'not_found'),
  )
  // Pasif öğretmen kaydı kapsam vermez.
  state.teachers = state.teachers.map((t) => (t.id === teaching ? { ...t, isActive: false } : t))
  assert.throws(
    () =>
      revealParentContact(scopeFor(state, teacher(teaching)), p1(state), {
        studentId: 's1',
        field: 'phone',
      }),
    isDomainError('parent_not_found', 'not_found'),
  )
})

test('DOM-YTK-055: öğretmen dışı rol 403; boş alan 422; geçersiz girdi Zod hatası', () => {
  const state = seed()
  for (const actor of [admin, frontOffice, student, parent])
    assert.deepEqual(
      parentContactDecision(scopeFor(state, actor), p1(state), { studentId: 's1', field: 'phone' })
        ?.kind,
      'forbidden',
      actor.role,
    )
  const scope = scopeFor(state, teacher(teachers(state).teaching))
  const bare = { id: 'p1', name: 'Ayşe Yılmaz', studentIds: ['s1'] }
  assert.throws(
    () => revealParentContact(scope, bare, { studentId: 's1', field: 'email' }),
    isDomainError('parent_contact_missing'),
  )
  assert.equal(
    revealParentContactSchema.safeParse({ studentId: 's1', field: 'name' }).success,
    false,
  )
  assert.equal(
    revealParentContactSchema.safeParse({ studentId: 's1', field: 'phone', extra: 1 }).success,
    false,
  )
  assert.equal(
    revealParentContactSchema.safeParse({ studentId: ' ', field: 'phone' }).success,
    false,
  )
  assert.throws(() => revealParentContact(scope, p1(state), { field: 'phone' }))
})
