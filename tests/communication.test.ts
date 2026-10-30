import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import {
  CONVERSATION_ACCESS_MINUTES,
  DEFAULT_WORKING_CALENDAR,
  awaitingReply,
  businessMinutesBetween,
  conversationSummary,
  digestMessages,
  messagesOf,
  conversationsFor,
  markAnnouncementRead,
  markMessagesRead,
  messagePage,
  openConversationAccess,
  publishAnnouncement,
  resolveRecipients,
  responseDueAt,
  reviseAnnouncement,
  sendMessage,
  startConversation,
  withdrawAnnouncement,
  type Participant,
} from '../packages/school-core/src/lib/communication.ts'
import {
  isConversationParty,
  isPublisher,
  parentAccountsDecision,
  publishDecision,
  readerKey,
  viewerOf,
} from '../packages/school-core/src/lib/communication-access.ts'
import {
  createSnapshotWriter,
  restoreSnapshot,
} from '../packages/school-core/src/lib/demo-persistence.ts'
import { scopeFor, visibleRecords, type Actor } from '../packages/school-core/src/lib/scope.ts'
import type { Role } from '../packages/school-core/src/modules/navigation.ts'
import { isDomainError } from './support/domain-error.ts'

const now = '2026-10-06T10:00:00.000Z'
const later = '2026-10-06T11:00:00.000Z'
const seed = () => createSeed(new Date(now))
let sequence = 0
const id = (prefix: string) => `${prefix}-communication-test-${++sequence}`

// Örnek kurum: 7-A (c1) ve 5-A (c2) kampüs b1; 8-B (c12) kampüs b2. Selin Kaya (t1) matematik
// ve rehberlik görevli; Ahmet Yıldırım (t2) c1–c4 Türkçe; Aylin Özer (t17) c12 sınıf rehberi.
const people: Record<Role, Participant> = {
  yonetici: { role: 'yonetici', links: [], userId: 'u-admin' },
  onburo: { role: 'onburo', links: [], userId: 'u-front' },
  ogretmen: { role: 'ogretmen', links: [{ kind: 'teacher', recordId: 't2' }], userId: 'u-t2' },
  ogrenci: { role: 'ogrenci', links: [{ kind: 'student', recordId: 's1' }], userId: 'u-s1' },
  veli: {
    role: 'veli',
    links: [
      { kind: 'child', recordId: 's1' },
      { kind: 'child', recordId: 's2' },
    ],
    userId: 'p1',
  },
}
const teacher = (recordId: string, userId = `u-${recordId}`): Participant => ({
  role: 'ogretmen',
  links: [{ kind: 'teacher', recordId }],
  userId,
})
const student = (recordId: string): Participant => ({
  role: 'ogrenci',
  links: [{ kind: 'student', recordId }],
  userId: `u-${recordId}`,
})
const parentOf = (recordId: string, userId = `u-parent-${recordId}`): Participant => ({
  role: 'veli',
  links: [{ kind: 'child', recordId }],
  userId,
})
const onlyClass = (state: State, classId: string) =>
  state.students.find((s) => s.classId === classId && s.isActive)!.id

const target = (overrides: Record<string, unknown> = {}) => ({
  classIds: ['c1'],
  roles: ['veli'],
  ...overrides,
})
const announcement = (overrides: Record<string, unknown> = {}) => ({
  title: 'Veli toplantısı',
  text: 'Perşembe 17.00’de sınıfta veli toplantısı yapılacaktır.',
  category: 'Bilgilendirme',
  target: target(),
  ...overrides,
})
const zodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'

function unchangedOnFailure(
  state: State,
  key: 'announcements' | 'conversations',
  action: () => unknown,
  check: (error: unknown) => boolean,
) {
  // Yazışma işlemi mesaj koleksiyonunu da değiştirebilir (ADR 0005); ikisi birlikte denetlenir.
  const watched = () =>
    JSON.stringify(
      key === 'conversations' ? [state.conversations, state.conversationMessages] : state[key],
    )
  const before = watched()
  assert.throws(action, check)
  assert.equal(watched(), before)
}
const visibleIds = (state: State, by: Participant) =>
  new Set(visibleRecords(state, by, 'announcements').map((a) => a.id))

// --- Duyuru ------------------------------------------------------------------------------

test('DOM-ILT-001: 7-A velilerine duyuru alıcı listesini yayında çözer; 8-B velisi görmez', () => {
  const state = seed()
  const created = publishAnnouncement(state, people.yonetici, announcement(), id, now)
  const c1Students = state.students.filter((s) => s.classId === 'c1' && s.isActive).map((s) => s.id)
  assert.equal(state.announcements[0], created)
  assert.deepEqual(created.recipients, {
    studentIds: [],
    parentStudentIds: c1Students,
    teacherIds: [],
  })
  assert.equal(created.classId, 'c1')
  assert.deepEqual(created.publishedBy, { role: 'yonetici', userId: 'u-admin' })
  assert.ok(visibleIds(state, people.veli).has(created.id))
  // Hedef rol yalnız veli: öğrencinin kendisi görmez.
  assert.ok(!visibleIds(state, people.ogrenci).has(created.id))
  assert.ok(!visibleIds(state, parentOf(onlyClass(state, 'c12'))).has(created.id))
  assert.ok(!visibleIds(state, teacher('t2')).has(created.id))
  assert.ok(visibleIds(state, people.onburo).has(created.id))
})

test('DOM-ILT-001: sonradan sınıfa katılan öğrencinin velisi eski duyuruyu görmez', () => {
  const state = seed()
  const created = publishAnnouncement(state, people.yonetici, announcement(), id, now)
  const newcomer = onlyClass(state, 'c12')
  state.students.find((s) => s.id === newcomer)!.classId = 'c1'
  assert.ok(!visibleIds(state, parentOf(newcomer)).has(created.id))
})

test('DOM-ILT-001: hedef kitle kampüs, düzey ve seviyenin birleşimidir; kurum geneli öğretmenlere gider', () => {
  const state = seed()
  const union = resolveRecipients(state, {
    branchIds: ['b2'],
    grades: [7],
    levels: [],
    classIds: [],
    roles: ['ogrenci', 'ogretmen'],
  })
  const expected = state.students
    .filter((s) => {
      const c = state.classes.find((x) => x.id === s.classId)!
      return s.isActive && (c.branchId === 'b2' || c.grade === 7)
    })
    .map((s) => s.id)
  assert.deepEqual(union.studentIds, expected)
  assert.ok(union.teacherIds.includes('t17'))
  assert.ok(union.teacherIds.includes('t2'))
  assert.deepEqual(union.parentStudentIds, [])
  const everyone = resolveRecipients(state, {
    branchIds: [],
    grades: [],
    levels: [],
    classIds: [],
    roles: ['ogretmen'],
  })
  assert.equal(
    everyone.teacherIds.length,
    state.teachers.filter((t) => t.isActive !== false && !t.deletedAt).length,
  )
  const byLevel = resolveRecipients(state, {
    branchIds: [],
    grades: [],
    levels: ['8. Sınıf'],
    classIds: [],
    roles: ['veli'],
  })
  assert.ok(byLevel.parentStudentIds.includes(onlyClass(state, 'c12')))
})

test('DOM-ILT-002: öğretmen yalnız kendi sınıflarının öğrenci ve velilerine yayınlar', () => {
  const state = seed()
  const own = publishAnnouncement(
    state,
    people.ogretmen,
    announcement({ target: target({ roles: ['veli', 'ogrenci'] }) }),
    id,
    now,
  )
  assert.equal(own.publishedBy?.teacherId, 't2')
  assert.ok(visibleIds(state, people.ogrenci).has(own.id))
  for (const wrong of [
    target({ classIds: ['c12'] }),
    target({ classIds: [], branchIds: ['b1'] }),
    target({ classIds: [], grades: [7] }),
    target({ roles: ['ogretmen'] }),
  ])
    unchangedOnFailure(
      state,
      'announcements',
      () => publishAnnouncement(state, people.ogretmen, announcement({ target: wrong }), id, now),
      isDomainError('announcement_scope_denied', 'forbidden'),
    )
})

test('DOM-ILT-002: ön büro yalnız idari kategoride kurum veya kampüs kapsamında yayınlar', () => {
  const state = seed()
  const ok = publishAnnouncement(
    state,
    people.onburo,
    announcement({ category: 'İdari', target: { branchIds: ['b1'], roles: ['veli'] } }),
    id,
    now,
  )
  assert.equal(ok.classId, null)
  assert.equal(ok.publishedBy?.role, 'onburo')
  unchangedOnFailure(
    state,
    'announcements',
    () =>
      publishAnnouncement(
        state,
        people.onburo,
        announcement({ target: { roles: ['veli'] } }),
        id,
        now,
      ),
    isDomainError('announcement_category_forbidden', 'forbidden'),
  )
  unchangedOnFailure(
    state,
    'announcements',
    () => publishAnnouncement(state, people.onburo, announcement({ category: 'İdari' }), id, now),
    isDomainError('announcement_scope_denied', 'forbidden'),
  )
})

test('DOM-ILT-002: öğrenci ve veli duyuru yayınlayamaz', () => {
  const state = seed()
  for (const role of ['ogrenci', 'veli'] as const)
    unchangedOnFailure(
      state,
      'announcements',
      () => publishAnnouncement(state, people[role], announcement(), id, now),
      isDomainError('permission_denied', 'forbidden'),
    )
})

test('Duyuru doğrulama hatası, bilinmeyen hedef ve alıcısız kitle kaydı değiştirmez', () => {
  const state = seed()
  unchangedOnFailure(
    state,
    'announcements',
    () =>
      publishAnnouncement(
        state,
        people.yonetici,
        announcement({ title: 'x', target: target({ roles: [] }) }),
        id,
        now,
      ),
    zodError,
  )
  unchangedOnFailure(
    state,
    'announcements',
    () =>
      publishAnnouncement(
        state,
        people.yonetici,
        announcement({ target: target({ classIds: ['c-yok'] }) }),
        id,
        now,
      ),
    isDomainError('announcement_target_unknown'),
  )
  unchangedOnFailure(
    state,
    'announcements',
    () =>
      publishAnnouncement(
        state,
        people.yonetici,
        // Örnek kurumda 3. sınıf yok: hedef kitlede alıcı kalmaz.
        announcement({ target: { grades: [3], roles: ['veli'] } }),
        id,
        now,
      ),
    isDomainError('announcement_no_recipients'),
  )
})

test('İletişim modülü kapalıyken duyuru ve yazışma işlemleri reddedilir; dil okulunda çalışır', () => {
  const state = seed()
  state.modules.communication = false
  unchangedOnFailure(
    state,
    'announcements',
    () => publishAnnouncement(state, people.yonetici, announcement(), id, now),
    isDomainError('module_disabled', 'forbidden'),
  )
  unchangedOnFailure(
    state,
    'conversations',
    () => startConversation(state, people.ogrenci, { studentId: 's1', teacherId: 't2' }, id, now),
    isDomainError('module_disabled', 'forbidden'),
  )
  assert.throws(
    () => sendMessage(state, people.ogrenci, 'conv1', { text: 'Merhaba' }, id, now),
    isDomainError('module_disabled', 'forbidden'),
  )
  state.modules.communication = true
  const language = publishAnnouncement(state, people.yonetici, announcement(), id, now, {
    institutionType: 'language_school',
  })
  assert.ok(language.recipients)
})

test('DOM-ILT-004: düzeltme önceki içeriği geçmişte tutar; yalnız yayınlayan veya yönetici düzeltir', () => {
  const state = seed()
  const own = publishAnnouncement(state, people.ogretmen, announcement(), id, now)
  reviseAnnouncement(state, people.ogretmen, own.id, { text: 'Toplantı 18.00’e alındı.' }, later)
  assert.equal(own.text, 'Toplantı 18.00’e alındı.')
  assert.equal(own.revisedAt, later)
  assert.deepEqual(own.revisions, [
    {
      title: 'Veli toplantısı',
      text: 'Perşembe 17.00’de sınıfta veli toplantısı yapılacaktır.',
      category: 'Bilgilendirme',
      replacedAt: later,
      replacedBy: { role: 'ogretmen', userId: 'u-t2' },
    },
  ])
  unchangedOnFailure(
    state,
    'announcements',
    () => reviseAnnouncement(state, teacher('t3'), own.id, { title: 'Başka başlık' }, later),
    isDomainError('announcement_not_found', 'not_found'),
  )
  unchangedOnFailure(
    state,
    'announcements',
    () => reviseAnnouncement(state, people.onburo, own.id, { title: 'Başka başlık' }, later),
    isDomainError('announcement_publisher_only', 'forbidden'),
  )
  unchangedOnFailure(
    state,
    'announcements',
    () => reviseAnnouncement(state, people.yonetici, own.id, { text: own.text }, later),
    isDomainError('announcement_unchanged', 'conflict'),
  )
  unchangedOnFailure(
    state,
    'announcements',
    () => reviseAnnouncement(state, people.yonetici, own.id, {}, later),
    zodError,
  )
  reviseAnnouncement(state, people.yonetici, own.id, { category: 'Etkinlik' }, later)
  assert.equal(own.revisions?.length, 2)
  // Yayınlayanı bilinmeyen eski duyuruyu yalnız yönetici düzeltir.
  assert.throws(
    () => reviseAnnouncement(state, people.ogretmen, 'ann2', { title: 'Yeni başlık' }, later),
    isDomainError('announcement_publisher_only', 'forbidden'),
  )
  assert.throws(
    () => reviseAnnouncement(state, people.yonetici, 'ann-yok', { title: 'Yeni başlık' }, later),
    isDomainError('announcement_not_found', 'not_found'),
  )
  // Ön büro kendi yayınladığını düzeltir.
  const front = publishAnnouncement(
    state,
    people.onburo,
    announcement({ category: 'İdari', target: { roles: ['veli'] } }),
    id,
    now,
  )
  reviseAnnouncement(state, people.onburo, front.id, { title: 'Servis saatleri' }, later)
  assert.equal(front.title, 'Servis saatleri')
})

test('DOM-ILT-004: görmeye yetkisi olmayan duyuru yok sayılır (404); görüp yayıncı olmayan 403 alır', () => {
  const state = seed()
  // Yönetici öğretmenlere duyurur: t3 alıcıdır, t17 de; veli duyurusunu öğretmen görmez.
  const forTeachers = publishAnnouncement(
    state,
    people.yonetici,
    announcement({ target: { roles: ['ogretmen'] } }),
    id,
    now,
  )
  const forParents = publishAnnouncement(state, people.ogretmen, announcement(), id, now)
  const stranger = teacher('t3')
  for (const run of [
    (aid: string) => reviseAnnouncement(state, stranger, aid, { title: 'Başka başlık' }, later),
    (aid: string) =>
      withdrawAnnouncement(state, stranger, aid, { reason: 'Gerekçe yazıldı' }, later),
  ]) {
    // Var olup görmeyen, hiç olmayan kayıtla aynı hatayı alır.
    for (const missing of [forParents.id, 'ann-yok'])
      unchangedOnFailure(
        state,
        'announcements',
        () => run(missing),
        isDomainError('announcement_not_found', 'not_found'),
      )
    // Görüp yayıncı olmayan 403 alır.
    unchangedOnFailure(
      state,
      'announcements',
      () => run(forTeachers.id),
      isDomainError('announcement_publisher_only', 'forbidden'),
    )
  }
  // Rol kapalıysa varlık ayrımı yoktur: veli ucu yine yetki hatasıdır.
  assert.throws(
    () => reviseAnnouncement(state, people.veli, forParents.id, { title: 'Başka başlık' }, later),
    isDomainError('permission_denied', 'forbidden'),
  )
  assert.throws(
    () => withdrawAnnouncement(state, people.veli, 'ann-yok', { reason: 'Gerekçe yazıldı' }, later),
    isDomainError('permission_denied', 'forbidden'),
  )
})

test('DOM-ILT-004: ön büro yayıncısı kişiyle eşlenir; başka ön büro kullanıcısı değiştiremez, geçmişi ve gerekçeyi görmez', () => {
  const state = seed()
  const other: Participant = { role: 'onburo', links: [], userId: 'u-front-2' }
  // Kişi kimliği olmayan aktör (eski istemci) yayıncı sayılmaz.
  const noUser: Actor = { role: 'onburo', links: [] }
  const front = publishAnnouncement(
    state,
    people.onburo,
    announcement({ category: 'İdari', target: { roles: ['veli'] } }),
    id,
    now,
  )
  assert.equal(front.publishedBy?.userId, 'u-front')
  assert.equal(
    isPublisher({ role: 'onburo', userId: 'u-front', teacherId: undefined }, front.publishedBy),
    true,
  )
  unchangedOnFailure(
    state,
    'announcements',
    () => reviseAnnouncement(state, other, front.id, { title: 'Servis saatleri' }, later),
    isDomainError('announcement_publisher_only', 'forbidden'),
  )
  unchangedOnFailure(
    state,
    'announcements',
    () => withdrawAnnouncement(state, other, front.id, { reason: 'Yanlış duyuru' }, later),
    isDomainError('announcement_publisher_only', 'forbidden'),
  )
  reviseAnnouncement(state, people.onburo, front.id, { title: 'Servis saatleri' }, later)
  markAnnouncementRead(state, people.veli, front.id, later)
  const viewOf = (by: Actor) =>
    visibleRecords(state, by, 'announcements').find((a) => a.id === front.id) as Record<
      string,
      unknown
    >
  // Yayınlayan okundu sayısını ve geçmişi görür; diğer ön büro kullanıcısı görmez.
  assert.equal(viewOf(people.onburo).readCount, 2)
  assert.ok(Array.isArray(viewOf(people.onburo).revisions))
  for (const by of [other, noUser]) {
    const view = viewOf(by)
    assert.ok(view)
    assert.ok(!('readCount' in view) && !('revisions' in view))
  }
  withdrawAnnouncement(state, people.yonetici, front.id, { reason: 'Hatalı bilgi içeriyor' }, later)
  const hidden = viewOf(other)
  assert.equal(hidden.withdrawnAt, later)
  for (const key of ['text', 'withdrawReason', 'withdrawnBy', 'revisions'])
    assert.ok(!(key in hidden), key)
  assert.equal(viewOf(people.onburo).withdrawReason, 'Hatalı bilgi içeriyor')
})

test('DOM-ILT-004: geri çekilen duyuru alıcılara "Geri çekildi" olarak görünür; metni yalnız yayınlayan ve yöneticide', () => {
  const state = seed()
  const own = publishAnnouncement(state, people.ogretmen, announcement(), id, now)
  unchangedOnFailure(
    state,
    'announcements',
    () => withdrawAnnouncement(state, people.ogretmen, own.id, { reason: 'x' }, later),
    zodError,
  )
  withdrawAnnouncement(state, people.ogretmen, own.id, { reason: 'Tarih yanlış yazıldı' }, later)
  assert.equal(own.withdrawnAt, later)
  assert.ok(state.announcements.includes(own))
  const viewOf = (by: Participant) =>
    visibleRecords(state, by, 'announcements').find((a) => a.id === own.id) as
      Record<string, unknown> | undefined
  // Alıcı ve ön büro işareti, başlığı ve kategoriyi görür; metni ve gerekçeyi görmez.
  for (const by of [people.veli, people.onburo]) {
    const view = viewOf(by)
    assert.ok(view)
    assert.equal(view.withdrawnAt, later)
    assert.equal(view.title, own.title)
    assert.equal(view.category, own.category)
    for (const key of ['text', 'withdrawReason', 'withdrawnBy', 'revisions', 'reads', 'recipients'])
      assert.ok(!(key in view), key)
  }
  // Alıcı olmayan yine görmez.
  assert.ok(!viewOf(parentOf(onlyClass(state, 'c12'))))
  for (const by of [people.ogretmen, people.yonetici]) {
    const view = viewOf(by)
    assert.ok(view)
    assert.equal(view.text, own.text)
    assert.equal(view.withdrawReason, 'Tarih yanlış yazıldı')
  }
  unchangedOnFailure(
    state,
    'announcements',
    () => withdrawAnnouncement(state, people.yonetici, own.id, { reason: 'Yineleme' }, later),
    isDomainError('announcement_withdrawn', 'conflict'),
  )
  unchangedOnFailure(
    state,
    'announcements',
    () => reviseAnnouncement(state, people.yonetici, own.id, { title: 'Yeni başlık' }, later),
    isDomainError('announcement_withdrawn', 'conflict'),
  )
  assert.throws(
    () => markAnnouncementRead(state, people.veli, own.id, later),
    isDomainError('announcement_withdrawn', 'conflict'),
  )
})

test('DOM-ILT-004: geri çekilen eski duyurunun (alıcı listesi yok) metni de yalnız yetkiliye döner', () => {
  const state = seed()
  const legacy = state.announcements.find((a) => a.classId === null)!
  withdrawAnnouncement(state, people.yonetici, legacy.id, { reason: 'Etkinlik ertelendi' }, later)
  const view = visibleRecords(state, people.veli, 'announcements').find(
    (a) => a.id === legacy.id,
  ) as Record<string, unknown>
  assert.equal(view.withdrawnAt, later)
  assert.equal(view.title, legacy.title)
  assert.ok(!('text' in view) && !('withdrawReason' in view))
  const admin = visibleRecords(state, people.yonetici, 'announcements').find(
    (a) => a.id === legacy.id,
  ) as Record<string, unknown>
  assert.equal(admin.text, legacy.text)
})

test('DOM-ILT-003: okundu bilgisi ilk açılış anıdır; tekrar çağrı kaydı değiştirmez', () => {
  const state = seed()
  const created = publishAnnouncement(
    state,
    people.yonetici,
    announcement({ target: target({ classIds: ['c1', 'c2'], roles: ['veli', 'ogrenci'] }) }),
    id,
    now,
  )
  const first = markAnnouncementRead(state, people.veli, created.id, now)
  // Ayşe Yılmaz'ın iki çocuğu da alıcı: aile anahtarı çocuk başınadır.
  assert.deepEqual(first, { announcementId: created.id, readAt: now, changed: true })
  assert.deepEqual(created.reads, {
    [readerKey('parent', 's1')]: now,
    [readerKey('parent', 's2')]: now,
  })
  const before = JSON.stringify(created)
  const again = markAnnouncementRead(state, people.veli, created.id, later)
  assert.deepEqual(again, { announcementId: created.id, readAt: now, changed: false })
  assert.equal(JSON.stringify(created), before)
  markAnnouncementRead(state, people.ogrenci, created.id, later)
  assert.equal(created.reads?.[readerKey('student', 's1')], later)
  // Alıcı olmayan yönetici için işlem etkisizdir; alıcı olmayan öğretmen bulamaz.
  assert.deepEqual(markAnnouncementRead(state, people.yonetici, created.id, later), {
    announcementId: created.id,
    readAt: null,
    changed: false,
  })
  assert.throws(
    () => markAnnouncementRead(state, teacher('t17'), created.id, later),
    isDomainError('announcement_not_found', 'not_found'),
  )
  const staff = publishAnnouncement(
    state,
    people.yonetici,
    announcement({ target: { roles: ['ogretmen'] } }),
    id,
    now,
  )
  assert.equal(markAnnouncementRead(state, teacher('t17'), staff.id, later).changed, true)
  assert.equal(staff.reads?.[readerKey('teacher', 't17')], later)
})

test('DOM-ILT-003: okundu bilgisi yanıtta yalnız yayınlayan ve yöneticiye sayı olarak döner', () => {
  const state = seed()
  const created = publishAnnouncement(state, people.ogretmen, announcement(), id, now)
  markAnnouncementRead(state, people.veli, created.id, now)
  reviseAnnouncement(state, people.ogretmen, created.id, { title: 'Güncel toplantı' }, later)
  const asRecipient = visibleRecords(state, people.veli, 'announcements').find(
    (a) => a.id === created.id,
  )!
  assert.equal(Reflect.get(asRecipient, 'reads'), undefined)
  assert.equal(Reflect.get(asRecipient, 'recipients'), undefined)
  assert.equal(Reflect.get(asRecipient, 'revisions'), undefined)
  assert.equal(Reflect.get(asRecipient, 'readCount'), undefined)
  assert.deepEqual(Reflect.get(asRecipient, 'publishedBy'), { role: 'ogretmen' })
  assert.equal(Reflect.get(asRecipient, 'myReadAt'), now)
  assert.equal(asRecipient.revisedAt, later)
  const c1Count = state.students.filter((s) => s.classId === 'c1' && s.isActive).length
  for (const by of [people.ogretmen, people.yonetici]) {
    const view = visibleRecords(state, by, 'announcements').find((a) => a.id === created.id)!
    assert.equal(Reflect.get(view, 'readCount'), 1)
    assert.equal(Reflect.get(view, 'recipientCount'), c1Count)
    assert.equal(Reflect.get(view, 'reads'), undefined)
    assert.ok(Array.isArray(Reflect.get(view, 'revisions')))
  }
  // Eski örnek kayıt (alıcı listesi yok) değişmeden ve eski kuralla döner.
  const legacy = visibleRecords(state, people.veli, 'announcements').find((a) => a.id === 'ann1')
  assert.deepEqual(
    legacy,
    state.announcements.find((a) => a.id === 'ann1'),
  )
  assert.ok(!visibleIds(state, parentOf(onlyClass(state, 'c12'))).has('ann1'))
  assert.ok(visibleIds(state, parentOf(onlyClass(state, 'c12'))).has('ann2'))
  assert.equal(markAnnouncementRead(state, people.veli, 'ann1', now).changed, false)
})

test('Yayınlayan kararı satır biçimini doğrular; bozuk alanlar yetki vermez', () => {
  assert.equal(isPublisher({ role: 'ogretmen', teacherId: undefined }, { role: 'ogretmen' }), false)
  assert.equal(isPublisher({ role: 'yonetici', teacherId: undefined }, undefined), false)
  const state = seed()
  state.announcements.unshift({
    id: 'ann-bozuk',
    title: 'Bozuk',
    text: 'Bozuk kayıt',
    date: now,
    classId: null,
    category: 'Akademik',
    // API'den gelen bozuk JSON: alıcı listesi dizi değil, yayınlayan rolsüz.
    recipients: { studentIds: 's1' } as never,
    publishedBy: { teacherId: 't2' } as never,
    reads: 'x' as never,
  })
  assert.ok(!visibleIds(state, people.ogrenci).has('ann-bozuk'))
  assert.ok(!visibleIds(state, people.ogretmen).has('ann-bozuk'))
  const admin = visibleRecords(state, people.yonetici, 'announcements').find(
    (a) => a.id === 'ann-bozuk',
  )!
  assert.equal(Reflect.get(admin, 'readCount'), 0)
  assert.equal(
    publishDecision(
      scopeFor(state, people.ogrenci),
      { branchIds: [], grades: [], levels: [], classIds: ['c1'], roles: ['veli'] },
      'Akademik',
    )?.code,
    'announcement_scope_denied',
  )
})

// --- Birebir mesaj ------------------------------------------------------------------------

test('DOM-ILT-010: öğretmen kendi öğrencisinin velisiyle yazışma açar; yazışma tekildir', () => {
  const state = seed()
  const count = state.conversations.length
  const first = startConversation(
    state,
    people.ogretmen,
    { studentId: 's1', audience: 'parent', text: 'Merhaba, Deniz’in ödevleri hakkında.' },
    id,
    now,
    { parentUserIds: ['p1'] },
  )
  assert.equal(first.created, true)
  assert.equal(state.conversations.length, count + 1)
  assert.deepEqual(
    {
      studentId: first.conversation.studentId,
      teacherId: first.conversation.teacherId,
      audience: first.conversation.audience,
      parentUserId: first.conversation.parentUserId,
      startedBy: first.conversation.startedBy,
    },
    {
      studentId: 's1',
      teacherId: 't2',
      audience: 'parent',
      parentUserId: 'p1',
      startedBy: 'ogretmen',
    },
  )
  assert.equal(first.message?.sender, 'teacher')
  assert.equal(first.message?.senderUserId, 'u-t2')
  // Aynı kişiyle ikinci başlatma yeni yazışma açmaz; mesaj var olana eklenir.
  const again = startConversation(
    state,
    people.ogretmen,
    { studentId: 's1', audience: 'parent', text: 'Bir de kitap listesi.' },
    id,
    later,
    { parentUserIds: ['p1'] },
  )
  assert.equal(again.created, false)
  assert.equal(again.conversation, first.conversation)
  assert.equal(messagesOf(state, first.conversation.id).length, 2)
  assert.equal(state.conversations.length, count + 1)
  const silent = startConversation(
    state,
    people.veli,
    { studentId: 's1', teacherId: 't2' },
    id,
    later,
  )
  assert.equal(silent.conversation, first.conversation)
  assert.equal(silent.message, null)
})

test('DOM-ILT-010: öğretmen kapsam dışı öğrencinin velisiyle yazışma açamaz; rehber öğretmen açar', () => {
  const state = seed()
  const outside = onlyClass(state, 'c12')
  unchangedOnFailure(
    state,
    'conversations',
    () =>
      startConversation(
        state,
        people.ogretmen,
        { studentId: outside, audience: 'parent' },
        id,
        now,
        {
          parentUserIds: ['u-p'],
        },
      ),
    isDomainError('conversation_party_forbidden', 'forbidden'),
  )
  // Selin Kaya rehberlik görevlisidir (DOM-ILT-011).
  const counselor = startConversation(
    state,
    teacher('t1'),
    { studentId: outside, audience: 'student' },
    id,
    now,
  )
  assert.equal(counselor.created, true)
  unchangedOnFailure(
    state,
    'conversations',
    () => startConversation(state, people.ogretmen, { studentId: 's1' }, id, now),
    isDomainError('conversation_audience_required'),
  )
})

test('DOM-ILT-010: veli hesapları yalnız veli yazışması başlatabilen öğretmene, yazışma kuralıyla aynı kapsamda açılır', () => {
  const state = seed()
  const outside = onlyClass(state, 'c12')
  const decide = (by: Participant, studentId: string) =>
    parentAccountsDecision(scopeFor(state, by), state, studentId)
  // Kendi öğrencisi: açık. Kapsam dışı öğrenci ve var olmayan öğrenci: kapalı.
  assert.equal(decide(people.ogretmen, 's1'), null)
  assert.equal(decide(people.ogretmen, outside)?.code, 'conversation_party_forbidden')
  assert.equal(decide(people.ogretmen, 's-yok')?.code, 'conversation_party_forbidden')
  // Rehberlik görevli öğretmen, yazışma açabildiği her öğrencinin veli hesaplarını görür.
  assert.equal(decide(teacher('t1'), outside), null)
  assert.equal(
    startConversation(state, teacher('t1'), { studentId: outside, audience: 'parent' }, id, now, {
      parentUserIds: ['u-p'],
    }).created,
    true,
  )
  // Yazışma başlatamayan roller veli hesaplarını görmez: yönetici, ön büro, öğrenci, veli.
  for (const role of ['yonetici', 'onburo', 'ogrenci', 'veli'] as const)
    assert.equal(decide(people[role], 's1')?.code, 'conversation_party_forbidden', role)
  // Kayıtlı öğretmen kaydı bulunmayan (pasif) öğretmen de göremez.
  assert.equal(decide(teacher('t-yok'), 's1')?.code, 'conversation_party_forbidden')
})

test('DOM-ILT-010: veli hesabı seçimi öğrencinin veli hesaplarıyla sınırlıdır', () => {
  const state = seed()
  const start = (parentUserIds: string[], parentUserId?: string) =>
    startConversation(
      state,
      people.ogretmen,
      { studentId: 's1', audience: 'parent', ...(parentUserId ? { parentUserId } : {}) },
      id,
      now,
      { parentUserIds },
    )
  unchangedOnFailure(
    state,
    'conversations',
    () => start([]),
    isDomainError('parent_account_not_found'),
  )
  unchangedOnFailure(
    state,
    'conversations',
    () => start(['u-a', 'u-b']),
    isDomainError('parent_choice_required'),
  )
  unchangedOnFailure(
    state,
    'conversations',
    () => start(['u-a'], 'u-baska'),
    isDomainError('parent_account_not_found'),
  )
  assert.equal(start(['u-a', 'u-b'], 'u-b').conversation.parentUserId, 'u-b')
  // Öğretmenin öğrenci yazışmasında veli hesabı aranmaz.
  const direct = startConversation(
    state,
    people.ogretmen,
    { studentId: 's1', audience: 'student' },
    id,
    now,
  )
  assert.equal(direct.conversation.parentUserId, undefined)
})

test('DOM-ILT-010: iki velinin yazışması ayrıdır; biri diğerininkini görmez ve yazamaz', () => {
  const state = seed()
  const mother = parentOf('s1', 'u-anne')
  const father = parentOf('s1', 'u-baba')
  const a = startConversation(
    state,
    mother,
    { studentId: 's1', teacherId: 't2', text: 'Anne' },
    id,
    now,
  )
  const b = startConversation(
    state,
    father,
    { studentId: 's1', teacherId: 't2', text: 'Baba' },
    id,
    now,
  )
  assert.notEqual(a.conversation.id, b.conversation.id)
  const motherScope = scopeFor(state, mother)
  assert.ok(conversationsFor(state, motherScope, 'u-anne').includes(a.conversation))
  assert.ok(!conversationsFor(state, motherScope, 'u-anne').includes(b.conversation))
  unchangedOnFailure(
    state,
    'conversations',
    () => sendMessage(state, mother, b.conversation.id, { text: 'Okuyor muyum?' }, id, now),
    isDomainError('conversation_not_found', 'not_found'),
  )
  unchangedOnFailure(
    state,
    'conversations',
    () => markMessagesRead(state, mother, b.conversation.id, now),
    isDomainError('conversation_not_found', 'not_found'),
  )
  // Başka öğrencinin velisi yazışma açamaz ve görmez.
  const other = parentOf(onlyClass(state, 'c12'))
  assert.deepEqual(conversationsFor(state, scopeFor(state, other), other.userId), [])
  unchangedOnFailure(
    state,
    'conversations',
    () => startConversation(state, other, { studentId: 's1', teacherId: 't2' }, id, now),
    isDomainError('conversation_party_forbidden', 'forbidden'),
  )
  // Veli yalnız çocuğunun öğretmeniyle yazışır.
  unchangedOnFailure(
    state,
    'conversations',
    () => startConversation(state, mother, { studentId: 's1', teacherId: 't17' }, id, now),
    isDomainError('conversation_party_forbidden', 'forbidden'),
  )
})

test('DOM-ILT-010: veli kimliği olmayan eski yazışma hiçbir veliye görünmez ve yeni yazışmayla eşleşmez', () => {
  const state = seed()
  // Örnek veri velisi p1'dir; kimliksiz eski kayıt aynı öğrencinin ikinci velisine sızmamalı.
  const legacy = state.conversations.find((c) => c.id === 'conv2')!
  assert.equal(legacy.parentUserId, 'p1')
  const orphan: typeof legacy = { ...legacy, id: 'conv-eski' }
  delete orphan.parentUserId
  state.conversations.push(orphan)
  const second = parentOf('s1', 'u-ikinci')
  const mine = (by: Participant) =>
    conversationsFor(state, scopeFor(state, by), by.userId).map((c) => c.id)
  assert.deepEqual(mine(second), [])
  assert.deepEqual(mine(people.veli), ['conv2', 'conv3'])
  assert.equal(isConversationParty(scopeFor(state, second), 'u-ikinci', orphan), false)
  unchangedOnFailure(
    state,
    'conversations',
    () => sendMessage(state, second, 'conv-eski', { text: 'Ben de yazayım' }, id, now),
    isDomainError('conversation_not_found', 'not_found'),
  )
  // Başlatma eski kayda eklemez; kendi yazışmasını ayrı açar.
  const before = messagesOf(state, 'conv-eski').length
  const opened = startConversation(
    state,
    second,
    { studentId: 's1', teacherId: 't1', text: 'Merhaba' },
    id,
    now,
  )
  assert.equal(opened.created, true)
  assert.notEqual(opened.conversation.id, 'conv-eski')
  assert.equal(opened.conversation.parentUserId, 'u-ikinci')
  assert.equal(messagesOf(state, 'conv-eski').length, before)
  // Öğretmen tarafı değişmez: eski kayıt öğretmene görünmeye devam eder.
  assert.ok(conversationsFor(state, scopeFor(state, teacher('t1')), 'u-t1').includes(orphan))
})

test('DOM-ILT-011: öğrenci yalnız kendi öğretmeni ve rehber öğretmenle yazışır; öğrenci–öğrenci yok', () => {
  const state = seed()
  const own = startConversation(
    state,
    people.ogrenci,
    { studentId: 's1', teacherId: 't2', text: 'Hocam ödevi yükledim.' },
    id,
    now,
  )
  assert.equal(own.conversation.audience, 'student')
  assert.equal(own.message?.sender, 'student')
  const outsider = student(onlyClass(state, 'c12'))
  assert.equal(
    startConversation(
      state,
      outsider,
      { studentId: outsider.links[0]!.recordId, teacherId: 't1' },
      id,
      now,
    ).created,
    true,
  )
  for (const input of [
    { studentId: 's1', teacherId: 't17' },
    { studentId: 's1', teacherId: 's2' },
    { studentId: 's2', teacherId: 't2' },
  ])
    unchangedOnFailure(
      state,
      'conversations',
      () => startConversation(state, people.ogrenci, input, id, now),
      isDomainError('conversation_party_forbidden', 'forbidden'),
    )
  // Veli, öğrencinin öğretmen yazışmasını görmez (DOM-ILT-011).
  assert.ok(!conversationsFor(state, scopeFor(state, people.veli), 'p1').includes(own.conversation))
  for (const role of ['yonetici', 'onburo'] as const)
    unchangedOnFailure(
      state,
      'conversations',
      () => startConversation(state, people[role], { studentId: 's1', teacherId: 't2' }, id, now),
      isDomainError('permission_denied', 'forbidden'),
    )
})

test('DOM-ILT-012: mesaj yalnız taraf tarafından eklenir; doğrulama hatası kaydı değiştirmez', () => {
  const state = seed()
  const conversation = state.conversations.find((c) => c.id === 'conv1')!
  const count = messagesOf(state, 'conv1').length
  const message = sendMessage(
    state,
    teacher('t1'),
    'conv1',
    { text: '  Yarın görüşelim.  ' },
    id,
    now,
  )
  assert.equal(message.text, 'Yarın görüşelim.')
  assert.equal(message.sender, 'teacher')
  assert.equal(messagesOf(state, 'conv1').length, count + 1)
  // Mesaj ayrı kayıttır; yazışmanın taraf anahtarlarını taşır, yazışmanın son mesaj anı güncellenir.
  assert.deepEqual(state.conversationMessages.at(-1), {
    id: message.id,
    conversationId: 'conv1',
    studentId: conversation.studentId,
    teacherId: conversation.teacherId,
    audience: conversation.audience,
    text: 'Yarın görüşelim.',
    sender: 'teacher',
    senderUserId: 'u-t1',
    date: now,
  })
  assert.equal(conversation.lastMessageAt, now)
  assert.equal('messages' in conversation, false)
  unchangedOnFailure(
    state,
    'conversations',
    () => sendMessage(state, teacher('t1'), 'conv1', { text: '   ' }, id, now),
    zodError,
  )
  unchangedOnFailure(
    state,
    'conversations',
    () => sendMessage(state, teacher('t1'), 'conv1', { text: 'x'.repeat(2001) }, id, now),
    zodError,
  )
  unchangedOnFailure(
    state,
    'conversations',
    () => sendMessage(state, people.ogretmen, 'conv1', { text: 'Ben de' }, id, now),
    isDomainError('conversation_not_found', 'not_found'),
  )
  unchangedOnFailure(
    state,
    'conversations',
    () => sendMessage(state, people.yonetici, 'conv1', { text: 'İdare' }, id, now),
    isDomainError('permission_denied', 'forbidden'),
  )
  unchangedOnFailure(
    state,
    'conversations',
    () => sendMessage(state, teacher('t1'), 'conv-yok', { text: 'Kimse' }, id, now),
    isDomainError('conversation_not_found', 'not_found'),
  )
  // Ders ilişkisi biten öğretmen yazışmayı görür ama yeni mesaj gönderemez.
  const started = startConversation(
    state,
    people.ogretmen,
    { studentId: 's1', audience: 'student' },
    id,
    now,
  )
  state.assignments = state.assignments.filter((a) => !(a.teacherId === 't2' && a.classId === 'c1'))
  unchangedOnFailure(
    state,
    'conversations',
    () => sendMessage(state, people.ogretmen, started.conversation.id, { text: 'Son' }, id, now),
    isDomainError('conversation_relationship_ended', 'forbidden'),
  )
  assert.ok(
    conversationsFor(state, scopeFor(state, people.ogretmen), 'u-t2').includes(
      started.conversation,
    ),
  )
})

test('DOM-ILT-024: karşı tarafın mesajları ilk görmede okundu işaretlenir; tekrar etkisizdir', () => {
  const state = seed()
  const messages = () => messagesOf(state, 'conv2')
  const others = state.conversationMessages.filter((m) => m.conversationId !== 'conv2')
  const othersBefore = JSON.stringify(others)
  const first = markMessagesRead(state, people.veli, 'conv2', now)
  assert.equal(first.count, messages().filter((m) => m.sender === 'teacher').length)
  assert.ok(
    messages()
      .filter((m) => m.sender === 'teacher')
      .every((m) => m.readAt === now),
  )
  assert.ok(
    messages()
      .filter((m) => m.sender === 'parent')
      .every((m) => !m.readAt),
  )
  // Başka yazışmanın mesajlarına dokunulmaz.
  assert.equal(JSON.stringify(others), othersBefore)
  const before = JSON.stringify(state.conversationMessages)
  assert.equal(markMessagesRead(state, people.veli, 'conv2', later).count, 0)
  assert.equal(JSON.stringify(state.conversationMessages), before)
  assert.throws(
    () => markMessagesRead(state, people.yonetici, 'conv2', now),
    isDomainError('permission_denied', 'forbidden'),
  )
  assert.throws(
    () => markMessagesRead(state, teacher('t1'), 'conv-yok', now),
    isDomainError('conversation_not_found', 'not_found'),
  )
})

test('DOM-YTK-052: yöneticinin erişimi gerekçe ister, süre sınırlıdır ve State değiştirmez', () => {
  const state = seed()
  const before = JSON.stringify(state.conversations)
  const access = openConversationAccess(
    state,
    people.yonetici,
    'conv1',
    { reason: 'Veli şikâyeti üzerine inceleme (dilekçe 42)' },
    now,
  )
  assert.equal(
    access.expiresAt,
    new Date(Date.parse(now) + CONVERSATION_ACCESS_MINUTES * 60_000).toISOString(),
  )
  assert.equal(JSON.stringify(state.conversations), before)
  for (const input of [{}, { reason: 'kısa' }])
    assert.throws(
      () => openConversationAccess(state, people.yonetici, 'conv1', input, now),
      isDomainError('access_reason_required'),
    )
  assert.throws(
    () =>
      openConversationAccess(
        state,
        teacher('t1'),
        'conv1',
        { reason: 'Gerekçe yeterli uzun' },
        now,
      ),
    isDomainError('permission_denied', 'forbidden'),
  )
  assert.throws(
    () =>
      openConversationAccess(
        state,
        people.yonetici,
        'conv-yok',
        { reason: 'Gerekçe yeterli uzun' },
        now,
      ),
    isDomainError('conversation_not_found', 'not_found'),
  )
  // DOM-ILT-011: gerekçeli erişim yalnız öğrenci–öğretmen yazışmasındadır; veli yazışması kapalı.
  for (const parentConversation of ['conv2', 'conv3'])
    assert.throws(
      () =>
        openConversationAccess(
          state,
          people.yonetici,
          parentConversation,
          { reason: 'Gerekçe yeterli uzun' },
          now,
        ),
      isDomainError('conversation_access_student_only', 'forbidden'),
    )
  // Gerekçe eksikse önce gerekçe hatası: veli yazışmasında da 422.
  assert.throws(
    () => openConversationAccess(state, people.yonetici, 'conv2', { reason: 'kısa' }, now),
    isDomainError('access_reason_required'),
  )
  assert.equal(JSON.stringify(state.conversations), before)
  // Yönetici taraf değildir: listesi boş.
  assert.deepEqual(conversationsFor(state, scopeFor(state, people.yonetici), 'u-admin'), [])
  assert.equal(
    isConversationParty(scopeFor(state, people.onburo), 'u-front', state.conversations[0]!),
    false,
  )
})

test('Mesaj sayfası en yeniden geriye imleçle ilerler; geçersiz imleç reddedilir', () => {
  const conversation = messagesOf(seed(), 'conv1')
  const ids = conversation.map((m) => m.id)
  const first = messagePage(conversation, 'student', { limit: 3 })!
  assert.deepEqual(
    first.items.map((m) => m.id),
    ids.slice(-3),
  )
  assert.equal(first.nextCursor, ids.at(-3))
  assert.equal(first.items[0]?.fromMe, ids.length % 2 === 0 ? false : true)
  const second = messagePage(conversation, 'student', { limit: 3, cursor: first.nextCursor! })!
  assert.deepEqual(
    second.items.map((m) => m.id),
    ids.slice(-6, -3),
  )
  const last = messagePage(conversation, 'student', { limit: 10, cursor: second.nextCursor! })!
  assert.deepEqual(
    last.items.map((m) => m.id),
    ids.slice(0, -6),
  )
  assert.equal(last.nextCursor, null)
  assert.equal(messagePage(conversation, 'student', { limit: 3, cursor: 'yok' }), null)
  assert.equal(messagePage(conversation, null, { limit: 1 })?.items[0]?.fromMe, false)
})

test('Yazışma özeti son mesajı, okunmamış sayısını ve yanıt beklemeyi taraf görünümüyle verir', () => {
  const state = seed()
  const conversation = state.conversations.find((c) => c.id === 'conv2')!
  const digest = (side: 'teacher' | 'parent' | null) =>
    digestMessages(messagesOf(state, 'conv2'), side)
  const forParent = conversationSummary(conversation, digest('parent'), 'parent', now)
  assert.equal(forParent.unreadCount, 4)
  assert.equal(forParent.lastMessage?.fromMe, false)
  assert.equal(forParent.awaitingReply, null)
  sendMessage(
    state,
    people.veli,
    'conv2',
    { text: 'Teşekkürler hocam.' },
    id,
    '2026-10-09T13:00:00.000Z',
  )
  const forTeacher = conversationSummary(
    conversation,
    digest('teacher'),
    'teacher',
    '2026-10-12T14:00:00.000Z',
  )
  // Cuma 16.00'da (İstanbul) gelen mesajın hedefi pazartesi 16.00'dır.
  assert.deepEqual(forTeacher.awaitingReply, {
    since: '2026-10-09T13:00:00.000Z',
    dueAt: '2026-10-12T13:00:00.000Z',
    overdue: true,
  })
  const admin = conversationSummary(conversation, digest(null), null, now)
  assert.equal(admin.lastMessage, null)
  assert.equal(admin.unreadCount, 0)
  assert.equal(admin.messageCount, messagesOf(state, 'conv2').length)
  assert.equal(awaitingReply({ firstUnanswered: null }, 'teacher', now), null)
  assert.deepEqual(digestMessages([], 'teacher'), {
    messageCount: 0,
    lastMessage: null,
    unreadCount: 0,
    firstUnanswered: null,
  })
  // Öğretmenin son mesajından sonraki ilk mesaj; son mesaj öğretmenindeyse yanıt beklenmez.
  const sample = messagesOf(state, 'conv2')
  const lastTeacher = sample.findLastIndex((m) => m.sender === 'teacher')
  assert.equal(digest('teacher').firstUnanswered, sample[lastTeacher + 1])
  assert.equal(digestMessages(sample.slice(0, lastTeacher + 1), 'teacher').firstUnanswered, null)
  assert.equal(digestMessages(sample.slice(0, 1), 'teacher').firstUnanswered, sample[0])
})

test('DOM-ILT-013: yanıt süresi çalışma saatiyle ölçülür; hafta sonu, gece ve tatil sayılmaz', () => {
  // Cuma 22.00 → cumartesi 22.00 (İstanbul): hiç çalışma dakikası yok.
  assert.equal(businessMinutesBetween('2026-10-09T19:00:00.000Z', '2026-10-10T19:00:00.000Z'), 0)
  // Cuma 16.00 → pazartesi 09.00: cuma 60 + pazartesi 60 dakika.
  assert.equal(businessMinutesBetween('2026-10-09T13:00:00.000Z', '2026-10-12T06:00:00.000Z'), 120)
  assert.equal(businessMinutesBetween('2026-10-12T06:00:00.000Z', '2026-10-09T13:00:00.000Z'), 0)
  // Cuma 22.00'de gelen soru pazartesi 17.00'de dolar.
  assert.equal(responseDueAt('2026-10-09T19:00:00.000Z'), '2026-10-12T14:00:00.000Z')
  const holiday = { ...DEFAULT_WORKING_CALENDAR, holidays: ['2026-10-12'] }
  assert.equal(responseDueAt('2026-10-09T13:00:00.000Z', holiday), '2026-10-13T13:00:00.000Z')
  assert.equal(
    businessMinutesBetween('2026-10-12T05:00:00.000Z', '2026-10-12T15:00:00.000Z', holiday),
    0,
  )
  assert.equal(
    responseDueAt('2026-10-06T07:00:00.000Z', DEFAULT_WORKING_CALENDAR, 30),
    '2026-10-06T07:30:00.000Z',
  )
  assert.equal(
    responseDueAt('2026-10-06T07:00:00.000Z', DEFAULT_WORKING_CALENDAR, 0),
    '2026-10-06T07:00:00.000Z',
  )
  for (const calendar of [
    { ...DEFAULT_WORKING_CALENDAR, weekdays: [] },
    { ...DEFAULT_WORKING_CALENDAR, endMinute: 8 * 60 },
    { ...DEFAULT_WORKING_CALENDAR, startMinute: -1 },
    { ...DEFAULT_WORKING_CALENDAR, endMinute: 25 * 60 },
  ]) {
    assert.throws(() => responseDueAt(now, calendar), isDomainError('working_calendar_invalid'))
    assert.throws(
      () => businessMinutesBetween(now, later, calendar),
      isDomainError('working_calendar_invalid'),
    )
  }
  // Takvimde hiç iş günü kalmazsa (her gün tatil) sonsuz döngü yok.
  const everyHoliday = { ...DEFAULT_WORKING_CALENDAR, weekdays: [8] }
  assert.throws(() => responseDueAt(now, everyHoliday), isDomainError('working_calendar_invalid'))
})

test('Her rolün yazışma görünürlüğü: öğretmen kendi, öğrenci öğrenci, veli veli yazışmasını görür', () => {
  const state = seed()
  const ids = (by: Participant) =>
    conversationsFor(state, scopeFor(state, by), by.userId)
      .map((c) => c.id)
      .sort()
  assert.deepEqual(ids(teacher('t1')), ['conv1', 'conv2', 'conv3'])
  assert.deepEqual(ids(teacher('t3')), ['conv4'])
  assert.deepEqual(ids(people.ogrenci), ['conv1', 'conv4'])
  assert.deepEqual(ids(people.veli), ['conv2', 'conv3'])
  assert.deepEqual(ids(people.yonetici), [])
  assert.deepEqual(ids(people.onburo), [])
  assert.equal(viewerOf(scopeFor(state, people.ogretmen)).teacherId, 't2')
})

test('Eski demo kaydındaki yazışma mesajları yüklenirken ayrı koleksiyona taşınır; sıra ve kimlik korunur', () => {
  const base = createSeed(new Date(now))
  const legacyOf = (conversationId: string) =>
    messagesOf(base, conversationId).map(({ id: key, text, sender, date }) => ({
      id: key,
      text,
      sender,
      date,
    }))
  const conv1 = base.conversations.find((c) => c.id === 'conv1')!
  const conv1Parties = {
    id: conv1.id,
    studentId: conv1.studentId,
    teacherId: conv1.teacherId,
    audience: conv1.audience,
  }
  const extra = {
    id: 'conv1-test-yeni',
    text: 'Eski kayıtta eklenen mesaj',
    sender: 'student',
    senderUserId: 's1',
    date: '2026-10-07T08:00:00.000Z',
    readAt: '2026-10-07T09:00:00.000Z',
  }
  // 2.7.0 öncesi biçim: değişen yazışma bütün mesajlarını `messages` dizisinde taşır.
  const snapshot = JSON.stringify({
    format: 'school-delta-v1',
    version: base.version,
    createdAt: base.createdAt,
    changes: {
      conversations: {
        kind: 'records',
        upsert: [
          { ...conv1Parties, messages: [...legacyOf('conv1'), extra] },
          {
            id: 'conv-test-eski',
            studentId: 's1',
            teacherId: 't2',
            audience: 'student',
            messages: [{ id: 'conv-test-eski-m0', text: 'Merhaba', sender: 'student', date: now }],
          },
        ],
        remove: [],
      },
    },
  })
  const state = restoreSnapshot(snapshot)
  assert.ok(state.conversations.every((c) => !('messages' in c)))
  const moved = messagesOf(state, 'conv1')
  assert.deepEqual(
    moved.map((m) => m.id),
    [...legacyOf('conv1').map((m) => m.id), extra.id],
  )
  assert.deepEqual(moved.at(-1), {
    ...extra,
    conversationId: 'conv1',
    studentId: 's1',
    teacherId: 't1',
    audience: 'student',
  })
  assert.equal(state.conversations.find((c) => c.id === 'conv1')!.lastMessageAt, extra.date)
  assert.deepEqual(
    messagesOf(state, 'conv-test-eski').map((m) => m.id),
    ['conv-test-eski-m0'],
  )
  // Değişmeyen yazışmaların mesajları örnek veriden aynen gelir; mükerrer kimlik yok.
  for (const other of ['conv2', 'conv3', 'conv4'])
    assert.deepEqual(messagesOf(state, other), messagesOf(base, other))
  const ids = state.conversationMessages.map((m) => m.id)
  assert.equal(new Set(ids).size, ids.length)
  // Yeni şekille yazılan kayıt aynı State'e döner (dönüşüm kalıcıdır).
  const rewritten = restoreSnapshot(
    createSnapshotWriter(createSeed(new Date(base.createdAt)))(state),
  )
  assert.deepEqual(rewritten.conversations, state.conversations)
  assert.deepEqual(rewritten.conversationMessages, state.conversationMessages)
})
