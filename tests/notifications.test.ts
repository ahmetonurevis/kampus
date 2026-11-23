import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import type { Participant } from '../packages/school-core/src/lib/communication.ts'
import {
  canSeeNotification,
  hiddenNotificationKinds,
  isMinorLearner,
  learnerIsMinor,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATION_KINDS,
  NOTIFICATION_TOPICS,
  notificationAudienceOf,
  notificationReadId,
  notificationRecordSchema,
  notificationTitle,
  notifyStudentEvent,
  unreadNotificationCount,
} from '../packages/school-core/src/lib/notifications.ts'
import { visibleRecords } from '../packages/school-core/src/lib/scope.ts'
import { OPERATION_COMMANDS } from '../packages/school-core/src/modules/commands.ts'
import {
  collectionModule,
  MODULE_KEYS,
} from '../packages/school-core/src/modules/collection-modules.ts'
import { isDomainError } from './support/domain-error.ts'

const now = '2026-10-06T10:00:00.000Z'
const later = '2026-10-06T11:00:00.000Z'
let sequence = 0
const id = (prefix: string) => `${prefix}-ntf-test-${++sequence}`

const parent: Participant = {
  role: 'veli',
  links: [
    { kind: 'child', recordId: 's1' },
    { kind: 'child', recordId: 's2' },
  ],
  userId: 'u-ayse',
}
const otherParentOfDeniz: Participant = {
  role: 'veli',
  links: [{ kind: 'child', recordId: 's1' }],
  userId: 'u-baba',
}
const strangerParent: Participant = {
  role: 'veli',
  links: [{ kind: 'child', recordId: 's3' }],
  userId: 'u-yabanci',
}
const deniz: Participant = {
  role: 'ogrenci',
  links: [{ kind: 'student', recordId: 's1' }],
  userId: 'u-deniz',
}
const teacher: Participant = {
  role: 'ogretmen',
  links: [{ kind: 'teacher', recordId: 't1' }],
  userId: 'u-selin',
}
const admin: Participant = { role: 'yonetici', links: [], userId: 'u-admin' }

function withFeedback(minor = true): { state: State; ids: string[] } {
  const state = createSeed(new Date(now))
  const created = notifyStudentEvent(
    state,
    { kind: 'feedback_released', studentId: 's1', subjectId: 'sub-1', minor },
    id,
    now,
  )
  return { state, ids: created.map((n) => n.id) }
}

test('DOM-ILT-023: bildirim türleri kaydı yalnız hizmet bildirimi ve ayrıntısız başlık taşır', () => {
  for (const [kind, spec] of Object.entries(NOTIFICATION_KINDS)) {
    assert.equal(spec.category, 'service', kind)
    assert.ok((NOTIFICATION_TOPICS as readonly string[]).includes(spec.topic), kind)
    for (const title of Object.values(spec.titles)) {
      // Başlık yalnız öğrencinin adını alır; puan, tutar ya da başka yer tutucu yoktur.
      assert.deepEqual(title.match(/\{[^}]*\}/g) ?? [], title.includes('{') ? ['{öğrenci}'] : [])
      assert.doesNotMatch(title, /\d/)
    }
  }
})

test('DOM-BEC-045: geri bildirim bildirimi 18 yaş altında öğrenciye ve veliye, yetişkinde yalnız kursiyere gider', () => {
  const minor = withFeedback(true).state.notifications
  assert.deepEqual(
    minor.map((n) => [n.kind, n.audience, n.studentId, n.subject.type, n.subject.id]),
    [
      ['feedback_released', 'student', 's1', 'task_submission', 'sub-1'],
      ['feedback_released', 'parent', 's1', 'task_submission', 'sub-1'],
    ],
  )
  assert.equal(minor[0]?.createdAt, now)
  const adult = withFeedback(false).state.notifications
  assert.deepEqual(
    adult.map((n) => n.audience),
    ['student'],
  )
})

test('DOM-KAY-011: kesin kayıt bildirimi 18 yaş altında yalnız veliye, yetişkinde kursiyere gider', () => {
  const state = createSeed(new Date(now))
  notifyStudentEvent(
    state,
    { kind: 'enrollment_completed', studentId: 's1', subjectId: 's1', minor: true },
    id,
    now,
  )
  notifyStudentEvent(
    state,
    { kind: 'enrollment_completed', studentId: 's2', subjectId: 's2', minor: false },
    id,
    now,
  )
  assert.deepEqual(
    state.notifications.map((n) => [n.audience, n.studentId, n.subject.type]),
    [
      ['parent', 's1', 'students'],
      ['student', 's2', 'students'],
    ],
  )
})

test('DOM-ILT-023: bildirim kaydı serbest metin alanı kabul etmez', () => {
  const { state } = withFeedback()
  const record = state.notifications[0]
  assert.ok(record)
  assert.equal(notificationRecordSchema.safeParse({ ...record, text: 'Puan: 85' }).success, false)
  assert.equal(
    notificationRecordSchema.safeParse({ ...record, subject: { ...record.subject, note: 'x' } })
      .success,
    false,
  )
  assert.equal(notificationRecordSchema.safeParse({ ...record, kind: 'campaign' }).success, false)
})

test('DOM-ILT-073: veli yalnız bağlı çocuğunun veli bildirimini, öğrenci yalnız kendi bildirimini görür', () => {
  const { state } = withFeedback()
  const [forStudent, forParent] = state.notifications
  assert.ok(forStudent && forParent)
  assert.ok(canSeeNotification(deniz, forStudent))
  assert.ok(!canSeeNotification(deniz, forParent))
  assert.ok(canSeeNotification(parent, forParent))
  assert.ok(!canSeeNotification(parent, forStudent))
  assert.ok(canSeeNotification(otherParentOfDeniz, forParent))
  assert.ok(!canSeeNotification(strangerParent, forParent))
  for (const staff of [teacher, admin]) {
    assert.ok(!canSeeNotification(staff, forStudent))
    assert.ok(!canSeeNotification(staff, forParent))
  }
  assert.deepEqual(notificationAudienceOf(parent), { student: [], parent: ['s1', 's2'] })
  assert.deepEqual(notificationAudienceOf(deniz), { student: ['s1'], parent: [] })
  assert.deepEqual(notificationAudienceOf(teacher), { student: [], parent: [] })
  // Genel kapsam kuralı aynı kararı verir; okundu işareti yalnız sahibinindir.
  assert.deepEqual(
    visibleRecords(state, parent, 'notifications').map((n) => n.id),
    [forParent.id],
  )
  assert.deepEqual(visibleRecords(state, strangerParent, 'notifications'), [])
  assert.deepEqual(visibleRecords(state, admin, 'notifications'), [])
  markNotificationRead(state, parent, forParent.id, now)
  assert.equal(visibleRecords(state, parent, 'notificationReads').length, 1)
  assert.equal(visibleRecords(state, otherParentOfDeniz, 'notificationReads').length, 0)
})

test('DOM-ILT-073: okundu kullanıcıya özeldir; ikinci okuma ilk anı korur, diğer veliye yansımaz', () => {
  const { state, ids } = withFeedback()
  const parentNotification = ids[1]
  assert.ok(parentNotification)
  assert.equal(unreadNotificationCount(state, parent), 1)
  assert.equal(unreadNotificationCount(state, otherParentOfDeniz), 1)
  const first = markNotificationRead(state, parent, parentNotification, now)
  assert.deepEqual(first, {
    id: notificationReadId(parentNotification, 'u-ayse'),
    notificationId: parentNotification,
    userId: 'u-ayse',
    readAt: now,
  })
  const again = markNotificationRead(state, parent, parentNotification, later)
  assert.equal(again.readAt, now)
  assert.equal(state.notificationReads.length, 1)
  assert.equal(unreadNotificationCount(state, parent), 0)
  assert.equal(unreadNotificationCount(state, otherParentOfDeniz), 1)
})

test('DOM-ILT-073: görülemeyen veya olmayan bildirim 404 notification_not_found; kayıt değişmez', () => {
  const { state, ids } = withFeedback()
  const [studentNotification, parentNotification] = ids
  assert.ok(studentNotification && parentNotification)
  const cases: [Participant, string][] = [
    [strangerParent, parentNotification],
    [parent, studentNotification],
    [deniz, parentNotification],
    [admin, studentNotification],
    [deniz, 'ntf-yok'],
  ]
  for (const [actor, target] of cases)
    assert.throws(
      () => markNotificationRead(state, actor, target, now),
      isDomainError('notification_not_found', 'not_found'),
    )
  assert.equal(state.notificationReads.length, 0)
})

test('DOM-ILT-020: toplu okundu yalnız aktörün gördüğü okunmamış bildirimleri işaretler', () => {
  const { state } = withFeedback()
  notifyStudentEvent(
    state,
    { kind: 'feedback_released', studentId: 's2', subjectId: 'sub-2', minor: true },
    id,
    now,
  )
  notifyStudentEvent(
    state,
    { kind: 'feedback_released', studentId: 's3', subjectId: 'sub-3', minor: true },
    id,
    now,
  )
  const firstParent = state.notifications.find(
    (n) => n.audience === 'parent' && n.studentId === 's1',
  )
  assert.ok(firstParent)
  markNotificationRead(state, parent, firstParent.id, now)
  assert.equal(markAllNotificationsRead(state, parent, later), 1)
  assert.equal(unreadNotificationCount(state, parent), 0)
  // s3'ün velisi ve öğrenciler etkilenmez; ilk okuma anı korunur.
  assert.equal(unreadNotificationCount(state, strangerParent), 1)
  assert.equal(unreadNotificationCount(state, deniz), 1)
  assert.equal(
    state.notificationReads.find((r) => r.notificationId === firstParent.id)?.readAt,
    now,
  )
  // Mükerrer çağrı hiçbir kayıt eklemez.
  assert.equal(markAllNotificationsRead(state, parent, later), 0)
  assert.equal(markAllNotificationsRead(state, admin, later), 0)
  assert.equal(state.notificationReads.length, 2)
})

test('DOM-ILT-023: başlık türün şablonundan yalnız ilk adla üretilir', () => {
  assert.equal(
    notificationTitle({ kind: 'feedback_released', audience: 'parent' }, 'Deniz Yılmaz'),
    'Deniz için öğretmen geri bildirimi geldi.',
  )
  assert.equal(
    notificationTitle({ kind: 'feedback_released', audience: 'student' }, 'Deniz Yılmaz'),
    'Görevine öğretmen geri bildirimi geldi.',
  )
  assert.equal(
    notificationTitle({ kind: 'enrollment_completed', audience: 'parent' }, null),
    'Öğrenci için kesin kayıt tamamlandı.',
  )
  assert.equal(
    notificationTitle({ kind: 'enrollment_completed', audience: 'student' }, '  '),
    'Kesin kaydın tamamlandı.',
  )
})

test('DOM-ILT-052: okulda her öğrenci velili; dil okulunda doğum tarihi, yoksa aday seçimi belirler', () => {
  const state = createSeed(new Date(now))
  const options = { institutionType: 'language_school' as const, now }
  assert.equal(learnerIsMinor(state, 's1', { institutionType: 'school', now }), true)
  // Doğum tarihi State'te değil, API'nin kimlik tablosundadır; karar `isMinorLearner`'dadır.
  assert.equal(isMinorLearner({ birthDate: '2000-01-01' }, options), false)
  assert.equal(isMinorLearner({ birthDate: '2015-01-01' }, options), true)
  const prospect = state.prospects[0]
  assert.ok(prospect)
  prospect.studentId = 's1'
  prospect.minor = false
  assert.equal(learnerIsMinor(state, 's1', options), false)
  // Bilgi yoksa kesin kayıttaki varsayılan: 18 yaş altı.
  assert.equal(learnerIsMinor(state, 's-bilinmeyen', options), true)
  assert.equal(learnerIsMinor({}, 's1', options), true)
  assert.equal(isMinorLearner({ prospectMinor: true, birthDate: '2000-01-01' }, options), false)
  assert.equal(isMinorLearner({}, { institutionType: 'school', now }), true)
})

test('bildirim koleksiyonları ve komutları iletişim modülündedir', () => {
  assert.equal(collectionModule('notifications'), 'communication')
  assert.equal(collectionModule('notificationReads'), 'communication')
  for (const action of ['notification.read', 'notification.read_all'] as const) {
    assert.equal(OPERATION_COMMANDS[action].module, 'communication')
    assert.ok(OPERATION_COMMANDS[action].collections.includes('notifications'))
    assert.ok(OPERATION_COMMANDS[action].collections.includes('notificationReads'))
  }
  // TODO(onur-istek): kesin kayıt bildirimi. Kesin kayıt (`enrollProspectWithTariff`, API
  // `enrollProspectCommand`) `enrollment_completed` üretene kadar `prospect.enroll` bildirim
  // koleksiyonunu yazmaz; çağrı eklenince şu beklenti geri açılır:
  // assert.ok(OPERATION_COMMANDS['prospect.enroll'].collections.includes('notifications'))
  // Örnek veri ve çevrimdışı demo bildirim üretmez.
  const state = createSeed(new Date(now))
  assert.deepEqual(state.notifications, [])
  assert.deepEqual(state.notificationReads, [])
})

test('DOM-YTK-040: iletişim modülü kapalıyken okundu işaretleri 403 module_disabled; kayıt değişmez', () => {
  const { state, ids } = withFeedback()
  state.modules = { ...state.modules, communication: false }
  assert.throws(
    () => markNotificationRead(state, parent, ids[1] ?? '', now),
    isDomainError('module_disabled', 'forbidden'),
  )
  assert.throws(
    () => markAllNotificationsRead(state, parent, now),
    isDomainError('module_disabled', 'forbidden'),
  )
  assert.equal(state.notificationReads.length, 0)
  // Dil okulunda da çalışır.
  state.modules = { ...state.modules, communication: true }
  markAllNotificationsRead(state, parent, now, { institutionType: 'language_school' })
  assert.equal(state.notificationReads.length, 1)
})

test('DOM-YTK-040: kapalı modülün ve kapalı bildirim merkezinin türleri gizlenir', () => {
  const all = Object.keys(NOTIFICATION_KINDS)
  const open = Object.fromEntries(MODULE_KEYS.map((key) => [key, true]))
  assert.deepEqual(hiddenNotificationKinds(open), [])
  assert.deepEqual(hiddenNotificationKinds({}).sort(), [...all].sort())
  assert.deepEqual(
    hiddenNotificationKinds({ ...open, communication: false }).sort(),
    [...all].sort(),
  )
  const learningClosed = hiddenNotificationKinds({ ...open, learning: false })
  assert.ok(learningClosed.length > 0)
  for (const kind of all)
    assert.equal(
      learningClosed.includes(kind as never),
      NOTIFICATION_KINDS[kind as keyof typeof NOTIFICATION_KINDS].module === 'learning',
      kind,
    )
})
