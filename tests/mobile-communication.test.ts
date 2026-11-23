import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  counterpartBody,
  newConversationBody,
  parentCounterpart,
} from '../packages/react-shared/src/conversation-model.ts'
import {
  canUseMessages,
  readMarkKey,
  validateMessageText,
  validateNewConversation,
} from '../apps/mobile/src/api/communication.ts'

describe('mobil mesaj kuralları', () => {
  test('yalnız öğretmen, öğrenci ve veli mesaj ekranı görür', () => {
    assert.equal(canUseMessages('ogretmen'), true)
    assert.equal(canUseMessages('ogrenci'), true)
    assert.equal(canUseMessages('veli'), true)
    assert.equal(canUseMessages('yonetici'), false)
    assert.equal(canUseMessages('onburo'), false)
  })

  test('okundu işareti yalnız akış yüklenince ve okunmamış varken, sayı başına bir anahtar', () => {
    assert.equal(readMarkKey('c1', 2, false), null)
    assert.equal(readMarkKey('c1', 0, true), null)
    assert.equal(readMarkKey('c1', 2, true), 'c1:2')
    assert.notEqual(readMarkKey('c1', 3, true), readMarkKey('c1', 2, true))
  })
})

describe('yeni yazışma', () => {
  test('öğretmen muhatap seçmeden başlatamaz; öğrenci ve veli öğretmen seçmeli', () => {
    const base = { studentId: 's1', teacherId: '', counterpart: '', text: 'Merhaba' }
    assert.deepEqual(validateNewConversation('ogretmen', base), {
      ok: false,
      errors: { counterpart: 'Yazışılacak kişiyi seçin.' },
    })
    assert.deepEqual(validateNewConversation('veli', base), {
      ok: false,
      errors: { teacherId: 'Öğretmen seçin.' },
    })
    assert.deepEqual(validateNewConversation('ogrenci', { ...base, studentId: '' }), {
      ok: false,
      errors: { studentId: 'Öğrenci seçin.', teacherId: 'Öğretmen seçin.' },
    })
  })

  test('boş ilk mesaj reddedilir', () => {
    const result = validateNewConversation('veli', {
      studentId: 's1',
      teacherId: 't1',
      counterpart: '',
      text: '   ',
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.ok(result.errors.text)
  })

  test('öğretmen gövdesi muhatabı, öğrenci/veli gövdesi öğretmeni taşır', () => {
    assert.deepEqual(counterpartBody('student'), { audience: 'student' })
    assert.deepEqual(counterpartBody(parentCounterpart('u9')), {
      audience: 'parent',
      parentUserId: 'u9',
    })
    const teacher = validateNewConversation('ogretmen', {
      studentId: 's1',
      teacherId: '',
      counterpart: parentCounterpart('u9'),
      text: ' Merhaba ',
    })
    assert.ok(teacher.ok)
    if (teacher.ok)
      assert.deepEqual(newConversationBody('ogretmen', teacher.values), {
        studentId: 's1',
        text: 'Merhaba',
        audience: 'parent',
        parentUserId: 'u9',
      })
    const parent = validateNewConversation('veli', {
      studentId: 's1',
      teacherId: 't1',
      counterpart: '',
      text: 'Merhaba',
    })
    assert.ok(parent.ok)
    if (parent.ok)
      assert.deepEqual(newConversationBody('veli', parent.values), {
        studentId: 's1',
        text: 'Merhaba',
        teacherId: 't1',
      })
  })

  test('mesaj metni doğrulaması boşu ve fazla uzunu reddeder', () => {
    assert.deepEqual(validateMessageText(' Merhaba '), { ok: true, text: 'Merhaba' })
    const empty = validateMessageText('  ')
    assert.equal(empty.ok, false)
    const long = validateMessageText('x'.repeat(5000))
    assert.equal(long.ok, false)
    if (!long.ok) assert.match(long.message, /en fazla/)
  })
})
