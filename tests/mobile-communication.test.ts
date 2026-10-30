import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  announcementBadges,
  announcementView,
  awaitingBadge,
  canUseMessages,
  conversationLabel,
  counterpartBody,
  deliveryLabel,
  messagePreview,
  messageStamp,
  newConversationBody,
  parentCounterpart,
  readMarkKey,
  senderLabel,
  unreadLabel,
  validateMessageText,
  validateNewConversation,
  WITHDRAWN_NOTICE,
  type PartyNames,
} from '../apps/mobile/src/api/communication.ts'

describe('duyuru görünümü', () => {
  test('geri çekilen duyuru yalnız "Geri çekildi" rozeti alır ve metni gizlenir', () => {
    const view = announcementView({
      id: 'a1',
      title: 'Servis değişikliği',
      text: 'Yarın servis 07:30 olacaktır.',
      date: '2026-10-12T08:00:00.000Z',
      withdrawnAt: '2026-10-13T08:00:00.000Z',
      revisedAt: '2026-10-12T09:00:00.000Z',
      myReadAt: null,
    })
    assert.deepEqual(view.badges, [{ text: 'Geri çekildi', tone: 'red' }])
    assert.equal(view.text, '')
    assert.equal(view.withdrawn, true)
    assert.equal(view.unread, false)
    assert.match(WITHDRAWN_NOTICE, /geri çekildi/)
  })

  test('okunmamış ve güncellenmiş duyuru iki rozet taşır', () => {
    assert.deepEqual(announcementBadges({ id: 'a', myReadAt: null, revisedAt: '2026-10-12' }), [
      { text: 'Okunmadı', tone: 'primary' },
      { text: 'Güncellendi', tone: 'amber' },
    ])
  })

  test('okunmuş güncellenmiş duyuru yalnız "Güncellendi" alır, okunmuş sade duyuru rozetsizdir', () => {
    assert.deepEqual(
      announcementBadges({
        id: 'a',
        myReadAt: '2026-10-12T10:00:00.000Z',
        revisedAt: '2026-10-12',
      }),
      [{ text: 'Güncellendi', tone: 'amber' }],
    )
    assert.deepEqual(announcementBadges({ id: 'a', myReadAt: '2026-10-12T10:00:00.000Z' }), [])
  })

  test('yayınlayanda myReadAt yoktur: okunmamış sayılmaz', () => {
    const view = announcementView({ id: 'a', title: 'T', text: 'Metin' })
    assert.equal(view.unread, false)
    assert.equal(view.text, 'Metin')
  })

  test('eksik alanlar güvenli varsayılana düşer', () => {
    assert.deepEqual(announcementView({ id: 'a' }), {
      id: 'a',
      title: 'Başlıksız duyuru',
      category: '',
      date: '',
      text: '',
      withdrawn: false,
      unread: false,
      badges: [],
    })
  })
})

const names: PartyNames = {
  students: new Map([
    ['s1', 'Deniz Yılmaz'],
    ['s2', 'Ece Yılmaz'],
  ]),
  teachers: new Map([['t1', 'Selin Kaya']]),
  parentsByStudent: new Map([
    ['s1', ['Ayşe Yılmaz']],
    ['s2', ['Ayşe Yılmaz', 'Can Yılmaz']],
  ]),
}

describe('yazışma etiketleri', () => {
  test('öğretmen öğrenciyi ya da tek velinin adını görür; iki veli varsa genel etiket', () => {
    assert.deepEqual(
      conversationLabel(
        { studentId: 's1', teacherId: 't1', audience: 'student' },
        'ogretmen',
        names,
      ),
      { title: 'Deniz Yılmaz', subtitle: 'Öğrenci ile yazışma' },
    )
    assert.deepEqual(
      conversationLabel(
        { studentId: 's1', teacherId: 't1', audience: 'parent' },
        'ogretmen',
        names,
      ),
      { title: 'Ayşe Yılmaz (veli)', subtitle: 'Öğrenci: Deniz Yılmaz' },
    )
    assert.equal(
      conversationLabel({ studentId: 's2', teacherId: 't1', audience: 'parent' }, 'ogretmen', names)
        .title,
      'Veli',
    )
  })

  test('öğrenci ve veli öğretmeni görür; veli çocuğun adını da', () => {
    const conversation = { studentId: 's2', teacherId: 't1', audience: 'parent' } as const
    assert.deepEqual(conversationLabel(conversation, 'veli', names), {
      title: 'Selin Kaya',
      subtitle: 'Öğrenci: Ece Yılmaz',
    })
    assert.deepEqual(conversationLabel(conversation, 'ogrenci', names), {
      title: 'Selin Kaya',
      subtitle: 'Öğretmen',
    })
  })

  test('ad bulunamazsa kimlik değil genel etiket gösterilir', () => {
    const empty: PartyNames = {
      students: new Map(),
      teachers: new Map(),
      parentsByStudent: new Map(),
    }
    const label = conversationLabel(
      { studentId: 's9', teacherId: 't9', audience: 'student' },
      'ogrenci',
      empty,
    )
    assert.equal(label.title, 'Öğretmen')
    assert.doesNotMatch(JSON.stringify(label), /t9|s9/)
  })

  test('yalnız öğretmen, öğrenci ve veli mesaj ekranı görür', () => {
    assert.equal(canUseMessages('ogretmen'), true)
    assert.equal(canUseMessages('ogrenci'), true)
    assert.equal(canUseMessages('veli'), true)
    assert.equal(canUseMessages('yonetici'), false)
    assert.equal(canUseMessages('onburo'), false)
  })
})

describe('liste rozetleri ve metinler', () => {
  test('yanıt bekliyor rozeti yalnız öğretmende; süre aşımı kırmızı', () => {
    assert.deepEqual(
      awaitingBadge(
        { since: '2026-10-12T08:00:00.000Z', dueAt: '2026-10-13T08:00:00.000Z', overdue: false },
        'ogretmen',
      ),
      {
        text: 'Yanıt bekliyor',
        tone: 'amber',
      },
    )
    assert.deepEqual(
      awaitingBadge(
        { since: '2026-10-12T08:00:00.000Z', dueAt: '2026-10-13T08:00:00.000Z', overdue: true },
        'ogretmen',
      ),
      {
        text: 'Yanıt süresi aştı',
        tone: 'red',
      },
    )
    assert.equal(
      awaitingBadge(
        { since: '2026-10-12T08:00:00.000Z', dueAt: '2026-10-13T08:00:00.000Z', overdue: true },
        'veli',
      ),
      null,
    )
    assert.equal(awaitingBadge(null, 'ogretmen'), null)
  })

  test('önizleme tek satıra iner ve kısaltılır', () => {
    assert.equal(messagePreview('Merhaba\n\n  hocam   nasılsınız'), 'Merhaba hocam nasılsınız')
    assert.equal(messagePreview('x'.repeat(100)).length, 80)
    assert.ok(messagePreview('x'.repeat(100)).endsWith('…'))
    assert.equal(messagePreview(undefined), '')
  })

  test('mesaj zamanı bugün yalnız saat, başka günde tarih ve saat gösterir', () => {
    const now = new Date('2026-10-12T12:00:00.000Z')
    assert.match(messageStamp('2026-10-12T08:30:00.000Z', now), /^\d{2}:\d{2}$/)
    assert.match(messageStamp('2026-10-10T08:30:00.000Z', now), /Eki.*\d{2}:\d{2}$/)
  })

  test('okunmamış etiketi, gönderen ve teslim durumu', () => {
    assert.equal(unreadLabel(3), '3 okunmamış mesaj')
    assert.equal(senderLabel('teacher'), 'Öğretmen')
    assert.equal(senderLabel('parent'), 'Veli')
    assert.equal(senderLabel('?'), 'Katılımcı')
    assert.equal(deliveryLabel({ fromMe: false, readAt: null }), null)
    assert.equal(deliveryLabel({ fromMe: true, readAt: null }), 'Gönderildi')
    assert.equal(deliveryLabel({ fromMe: true, readAt: '2026-10-12T08:00:00.000Z' }), 'Okundu')
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
