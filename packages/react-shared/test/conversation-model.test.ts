import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  awaitingLabel,
  canListConversations,
  canOpenAccess,
  canStartConversation,
  contentLocked,
  conversationLabel,
  counterpartBody,
  deliveryLabel,
  messagePreview,
  messageStamp,
  newConversationBody,
  newConversationSchema,
  parentCounterpart,
  remainingLabel,
  senderLabel,
  unreadLabel,
  type PartyNames,
} from '../src/conversation-model.ts'

const names: PartyNames = {
  students: new Map([['s1', 'Deniz Yılmaz']]),
  teachers: new Map([['t1', 'Selin Kaya']]),
  parentsByStudent: new Map([
    ['s1', ['Ayşe Yılmaz']],
    ['s2', ['Ali Demir', 'Ayla Demir']],
  ]),
}
const studentRow = { studentId: 's1', teacherId: 't1', audience: 'student' }
const parentRow = { studentId: 's1', teacherId: 't1', audience: 'parent' }

test('etiket rolün karşı tarafını gösterir', () => {
  assert.deepEqual(conversationLabel(studentRow, 'ogretmen', names), {
    title: 'Deniz Yılmaz',
    subtitle: 'Öğrenci ile yazışma',
  })
  assert.deepEqual(conversationLabel(parentRow, 'ogretmen', names), {
    title: 'Ayşe Yılmaz (veli)',
    subtitle: 'Öğrenci: Deniz Yılmaz',
  })
  assert.deepEqual(conversationLabel(studentRow, 'ogrenci', names), {
    title: 'Selin Kaya',
    subtitle: 'Öğretmen',
  })
  assert.equal(conversationLabel(parentRow, 'veli', names).subtitle, 'Öğrenci: Deniz Yılmaz')
  assert.equal(conversationLabel(studentRow, 'yonetici', names).title, 'Selin Kaya ↔ Deniz Yılmaz')
  // Yöneticide iki yazışma türü listede ayırt edilir (veli yazışmasına erişim açılamaz).
  assert.equal(conversationLabel(studentRow, 'yonetici', names).subtitle, 'Öğrenci–öğretmen')
  assert.equal(conversationLabel(parentRow, 'yonetici', names).subtitle, 'Veli yazışması')
})

test('iki velisi olan öğrencide veli adı tahmin edilmez; bilinmeyen ad kimlik göstermez', () => {
  const twoParents = { studentId: 's2', teacherId: 't1', audience: 'parent' }
  assert.equal(conversationLabel(twoParents, 'ogretmen', names).title, 'Veli')
  const unknown = { studentId: 'x', teacherId: 'y', audience: 'student' }
  assert.equal(conversationLabel(unknown, 'ogretmen', names).title, 'Öğrenci')
  assert.equal(conversationLabel(unknown, 'ogrenci', names).title, 'Öğretmen')
})

test('önizleme tek satıra indirilir ve kısaltılır', () => {
  assert.equal(messagePreview(undefined), '')
  assert.equal(messagePreview('  merhaba\n\n dünya  '), 'merhaba dünya')
  const long = messagePreview('a'.repeat(100), 10)
  assert.equal(long.length, 10)
  assert.ok(long.endsWith('…'))
})

test('mesaj zamanı bugün yalnız saat, başka günde tarih ve saat gösterir', () => {
  const now = new Date('2026-10-30T12:00:00Z')
  const today = messageStamp('2026-10-30T09:15:00Z', now)
  const earlier = messageStamp('2026-10-20T09:15:00Z', now)
  assert.match(today, /^\d{2}:\d{2}$/)
  assert.notEqual(earlier, today)
  assert.ok(earlier.length > today.length)
})

test('okunmamış ve bekleme rozetleri', () => {
  assert.equal(unreadLabel(3), '3 okunmamış mesaj')
  assert.equal(awaitingLabel(null), null)
  const due = '2026-10-30T20:00:00Z'
  assert.deepEqual(awaitingLabel({ since: due, dueAt: due, overdue: false }), {
    text: 'Yanıt bekliyor',
    tone: 'amber',
  })
  assert.deepEqual(awaitingLabel({ since: due, dueAt: due, overdue: true }), {
    text: 'Yanıt süresi aştı',
    tone: 'red',
  })
})

test('kalan süre dakika:saniye yazılır ve sıfırın altına inmez', () => {
  assert.equal(remainingLabel(30 * 60_000), '30:00')
  assert.equal(remainingLabel(61_001), '01:02')
  assert.equal(remainingLabel(-5), '00:00')
})

test('rol kuralları: yönetici ve ön büro yazışma başlatmaz, ön büro listeyi göremez', () => {
  assert.deepEqual(
    (['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli'] as const).map(canStartConversation),
    [false, false, true, true, true],
  )
  assert.deepEqual(
    (['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli'] as const).map(canListConversations),
    [true, false, true, true, true],
  )
  assert.equal(contentLocked('yonetici', false), true)
  assert.equal(contentLocked('yonetici', true), false)
  assert.equal(contentLocked('ogretmen', false), false)
})

test('gerekçeli erişim yalnız öğrenci–öğretmen yazışmasında açılır', () => {
  assert.equal(canOpenAccess({ audience: 'student' }), true)
  assert.equal(canOpenAccess({ audience: 'parent' }), false)
})

test('gönderen ve teslim etiketleri', () => {
  assert.equal(senderLabel('teacher'), 'Öğretmen')
  assert.equal(senderLabel('parent'), 'Veli')
  assert.equal(senderLabel('bilinmeyen'), 'Katılımcı')
  assert.equal(deliveryLabel({ fromMe: false, readAt: null }), null)
  assert.equal(deliveryLabel({ fromMe: true, readAt: null }), 'Gönderildi')
  assert.equal(deliveryLabel({ fromMe: true, readAt: '2026-10-30T09:00:00Z' }), 'Okundu')
})

test('karşı taraf seçimi API gövdesine çevrilir', () => {
  assert.deepEqual(counterpartBody('student'), { audience: 'student' })
  assert.deepEqual(counterpartBody(parentCounterpart('u-veli')), {
    audience: 'parent',
    parentUserId: 'u-veli',
  })
})

test('yeni yazışma formu role göre doğrulanır ve gövdeye çevrilir', () => {
  const teacher = newConversationSchema('ogretmen')
  const blank = { studentId: '', teacherId: '', counterpart: '', text: '' }
  const bad = teacher.safeParse(blank)
  assert.equal(bad.success, false)
  const paths = bad.success ? [] : bad.error.issues.map((issue) => issue.path[0])
  assert.ok(paths.includes('studentId') && paths.includes('counterpart') && paths.includes('text'))

  const ok = teacher.parse({
    studentId: 's1',
    teacherId: '',
    counterpart: 'student',
    text: ' Merhaba ',
  })
  assert.deepEqual(newConversationBody('ogretmen', ok), {
    studentId: 's1',
    text: 'Merhaba',
    audience: 'student',
  })

  const parent = newConversationSchema('veli')
  const missingTeacher = parent.safeParse({ ...blank, studentId: 's1', text: 'Merhaba' })
  assert.equal(missingTeacher.success, false)
  const fromParent = parent.parse({
    studentId: 's1',
    teacherId: 't1',
    counterpart: '',
    text: 'Selam',
  })
  assert.deepEqual(newConversationBody('veli', fromParent), {
    studentId: 's1',
    text: 'Selam',
    teacherId: 't1',
  })
})
