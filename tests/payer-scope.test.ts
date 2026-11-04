import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import { requireConsentAuthority } from '../packages/school-core/src/lib/consents.ts'
import {
  CONTRACT_NOTIFICATION_TYPES,
  FINANCE_NOTIFICATION_TYPES,
} from '../packages/school-core/src/lib/finance-notifications.ts'
import {
  guardedActorLinks,
  guardianBondsFor,
  isPayerNotificationKind,
  PAYER_NOTIFICATION_KINDS,
  payerActorLinks,
  payerStudentIds,
  scopedActorLinks,
  type GuardianLink,
} from '../packages/school-core/src/lib/guardianship.ts'
import {
  canSeeNotification,
  notificationAudienceOf,
  NOTIFICATION_KIND_NAMES,
  payerNotificationStudentIds,
  type NotificationKind,
  type NotificationRecord,
} from '../packages/school-core/src/lib/notifications.ts'
import {
  financeStudentIds,
  ONUR_READ_RULES,
  scopeFor,
  type Actor,
  type ActorLink,
} from '../packages/school-core/src/lib/scope.ts'
import {
  COLLECTION_NAMES,
  type CollectionName,
} from '../packages/school-core/src/modules/collection-modules.ts'
import {
  FINANCE_PERSONAL,
  ownOrPayerStudent,
  payerStudent,
  type Context,
} from '../packages/school-core/src/modules/scope-builders.ts'
import { isDomainError } from './support/domain-error.ts'

/**
 * Ödeyici velinin finans kapsamı (OG-1002, K-04 kullanıcı kararı 2026-11-03; DOM-ILT-074): ödeyici
 * bağı (`payer`) aktöre ayrı bağlantı türüyle taşınır, yalnız finans kuralında ve finans
 * bildiriminde kapsam verir; akademik, iletişim ve rıza kapsamı velayet bağlantısında (`child`)
 * kalır.
 */

const now = '2026-10-06T10:00:00.000Z'
const seed = () => createSeed(new Date(now))
const rowsOf = (state: State, name: CollectionName): readonly Record<string, unknown>[] =>
  state[name]
const links = (kind: ActorLink['kind'], ...ids: string[]): ActorLink[] =>
  ids.map((recordId) => ({ kind, recordId }))
const veli = (...items: ActorLink[]): Actor => ({ role: 'veli', links: items })

/** Deniz (s1): annesi velayetli ve ödeyici değil; babası velayetsiz ama ödeyici. */
const bond = (over: Partial<GuardianLink>): GuardianLink => ({
  id: 'test-g',
  studentId: 's1',
  parentId: null,
  membershipId: 'm-baba',
  relationship: 'father',
  custody: 'none',
  contactRestricted: false,
  isPayer: true,
  canPickUp: false,
  ...over,
})
const fatherPayer = bond({ id: 'test-g1' })
const motherCustodial = bond({
  id: 'test-g2',
  membershipId: 'm-anne',
  relationship: 'mother',
  custody: 'full',
  isPayer: false,
})

/** Finans koleksiyonları Onur'undur (ON-291 bağlar); geri kalan her koleksiyon karşılaştırılır. */
const FINANCE = new Set<string>(Object.keys(ONUR_READ_RULES))
const NON_FINANCE = COLLECTION_NAMES.filter((name) => !FINANCE.has(name))

describe('ödeyici bağı (OG-1002, K-04)', () => {
  test('DOM-ILT-074 ödeyici bağlantısı yalnız ödeyici, kısıtsız ve çocuk bağlantılı öğrenciye kurulur', () => {
    const stored = links('child', 's1')
    assert.deepEqual(payerStudentIds([fatherPayer], 'm-baba'), ['s1'])
    assert.deepEqual(payerActorLinks(stored, [fatherPayer], 'm-baba'), links('payer', 's1'))
    // Velayeti olmadığı için çocuk bağlantısı kapsam vermez; ödeyici bağlantısı ayrı kalır.
    assert.deepEqual(guardedActorLinks(stored, [fatherPayer], 'm-baba'), [])
    assert.deepEqual(scopedActorLinks(stored, [fatherPayer], 'm-baba'), links('payer', 's1'))
    // Ödeyici olmayan, başka hesabın ya da bağı kaldırılan (yüklenmeyen) bağ kapsam vermez.
    assert.deepEqual(payerActorLinks(stored, [{ ...fatherPayer, isPayer: false }], 'm-baba'), [])
    assert.deepEqual(payerActorLinks(stored, [fatherPayer], 'm-baska'), [])
    assert.deepEqual(payerActorLinks(stored, [], 'm-baba'), [])
    // Çocuk bağlantısı olmayan öğrenciye ödeyici bağı kapalı başarısızdır.
    assert.deepEqual(payerActorLinks(links('child', 's2'), [fatherPayer], 'm-baba'), [])
    assert.deepEqual(payerActorLinks(links('student', 's1'), [fatherPayer], 'm-baba'), [])
  })

  test('DOM-ILT-074 iletişim kısıtlı veli ödeyici bağlantısı almaz (eski ya da tutarsız kayıtta da)', () => {
    const restricted = { ...fatherPayer, contactRestricted: true }
    assert.deepEqual(payerStudentIds([restricted], 'm-baba'), [])
    assert.deepEqual(scopedActorLinks(links('child', 's1'), [restricted], 'm-baba'), [])
  })

  test('DOM-ILT-070 DOM-ILT-074 velayetli ödeyici veli çocuk ve ödeyici bağlantısını birlikte alır', () => {
    const both = { ...motherCustodial, isPayer: true }
    assert.deepEqual(scopedActorLinks(links('child', 's1', 's2'), [both], 'm-anne'), [
      ...links('child', 's1'),
      ...links('payer', 's1'),
    ])
  })

  test('DOM-ILT-074 ödeyici bağlantısı finans kümesine girer; öğrenci ve sınıf kapsamı açmaz', () => {
    const state = seed()
    const scope = scopeFor(state, veli(...links('payer', 's1', 'olmayan-ogrenci')))
    assert.deepEqual([...scope.studentIds], [])
    assert.deepEqual([...scope.classIds], [])
    assert.deepEqual([...scope.payerStudentIds], ['s1'])
    assert.deepEqual([...financeStudentIds(scope)], ['s1'])
    // Veli dışı rolde ödeyici bağlantısı yok sayılır (personel ve öğrenci kapsamına sızmaz).
    for (const role of ['yonetici', 'onburo', 'ogretmen', 'ogrenci'] as const) {
      const other = scopeFor(state, { role, links: links('payer', 's1') })
      assert.deepEqual([...other.payerStudentIds], [], role)
    }
    // Öğretmenin kapsamı ödeyici bağlantısıyla genişlemez.
    const teacherOf = (extra: ActorLink[]) =>
      [
        ...scopeFor(state, { role: 'ogretmen', links: [...links('teacher', 't1'), ...extra] })
          .studentIds,
      ].sort()
    assert.deepEqual(teacherOf(links('payer', 's1', 's2', 's3')), teacherOf([]))
  })

  test('DOM-ILT-070 DOM-ILT-074 velayetsiz ödeyici veli akademik, iletişim ve rıza koleksiyonlarında hiçbir satır görmez', () => {
    const state = seed()
    const payer = scopeFor(state, veli(...links('payer', 's1', 's2')))
    const unlinked = scopeFor(state, veli())
    for (const name of NON_FINANCE) {
      if (name === 'notifications') continue
      assert.deepEqual(
        payer.read(name, rowsOf(state, name)),
        unlinked.read(name, rowsOf(state, name)),
        name,
      )
    }
    // Öğrenciye bağlı akademik ve iletişim koleksiyonlarında ödeyici bağı tek satır açmaz.
    for (const name of [
      'grades',
      'attendance',
      'absences',
      'homework',
      'submissions',
      'quizAttempts',
      'mockResults',
      'studentGoals',
      'conversations',
      'conversationMessages',
      'appointments',
      'eventConsents',
      'permissionForms',
      'permissionDecisions',
      'guidanceCases',
      'students',
    ] as const)
      assert.deepEqual(payer.read(name, rowsOf(state, name)), [], name)
  })

  test('DOM-ILT-070 velayetli ödeyici velinin finans dışı okuması çift bağlantıyla değişmez', () => {
    const state = seed()
    const custodial = scopeFor(state, veli(...links('child', 's1', 's2')))
    const both = scopeFor(state, veli(...links('child', 's1', 's2'), ...links('payer', 's1')))
    assert.deepEqual([...both.studentIds], [...custodial.studentIds])
    assert.deepEqual([...both.classIds], [...custodial.classIds])
    for (const name of NON_FINANCE)
      assert.deepEqual(
        both.read(name, rowsOf(state, name)),
        custodial.read(name, rowsOf(state, name)),
        name,
      )
    assert.deepEqual([...financeStudentIds(both)].sort(), ['s1', 's2'])
  })

  test('DOM-ILT-070 DOM-YTK-057 velayetsiz ödeyici veli rıza veremez: öğrenci bulunamadı', () => {
    const actor = {
      ...veli(...scopedActorLinks(links('child', 's1'), [fatherPayer], 'm-baba')),
      userId: 'u-baba',
    }
    assert.throws(
      () =>
        requireConsentAuthority({
          actor,
          purpose: 'speaking_recording',
          student: { id: 's1', birthDate: '2013-04-12' },
          guardianBonds: guardianBondsFor([fatherPayer], 'm-baba'),
          now,
        }),
      isDomainError('consent_student_not_found', 'not_found'),
    )
  })

  test('DOM-ILT-074 finans kuralı yapı taşı ödeyiciyi okur; velayet kuralı okumaz', () => {
    const context = (studentIds: string[], payerIds: string[]) =>
      ({
        role: 'veli',
        studentIds: new Set(studentIds),
        payerStudentIds: new Set(payerIds),
      }) as unknown as Context
    const row = { studentId: 's1' }
    assert.equal(payerStudent(context([], ['s1']), row), true)
    assert.equal(ownOrPayerStudent(context([], ['s1']), row), true)
    assert.equal(ownOrPayerStudent(context(['s1'], []), row), true)
    assert.equal(ownOrPayerStudent(context([], ['s2']), row), false)
    assert.equal(FINANCE_PERSONAL.veli(context([], ['s1']), row), true)
    assert.equal(FINANCE_PERSONAL.ogrenci(context([], ['s1']), row), false)
  })
})

describe('ödeyici velinin finans bildirimi (OG-1002, K-04)', () => {
  const notification = (
    kind: NotificationKind,
    over: Partial<NotificationRecord> = {},
  ): NotificationRecord => ({
    id: `test-ntf-${kind}`,
    kind,
    audience: 'parent',
    studentId: 's1',
    subject: { type: 'invoices', id: 'test-inv' },
    createdAt: now,
    ...over,
  })
  const payer = veli(...links('payer', 's1'))
  const custodial = veli(...links('child', 's1'))

  test('DOM-ILT-074 DOM-FIN-010 ödeyici bildirim türleri finans ve sözleşme onay türleridir; akademik ve iletişim türleri karışmaz (DOM-ILT-052)', () => {
    assert.deepEqual([...PAYER_NOTIFICATION_KINDS].sort(), [
      'contract_approval_requested',
      'contract_approved',
      'installment_due',
      'installment_overdue',
      'payment_received',
      'refund_paid',
    ])
    assert.deepEqual(PAYER_NOTIFICATION_KINDS, [
      ...Object.keys(FINANCE_NOTIFICATION_TYPES),
      ...Object.keys(CONTRACT_NOTIFICATION_TYPES),
    ])
    for (const kind of NOTIFICATION_KIND_NAMES)
      if (!PAYER_NOTIFICATION_KINDS.includes(kind as never))
        assert.equal(isPayerNotificationKind(kind), false, kind)
    for (const kind of ['absence_recorded', 'absence_corrected', 'absence_decided'])
      assert.equal(isPayerNotificationKind(kind), false, kind)
    assert.equal(isPayerNotificationKind(undefined), false)
  })

  test('DOM-ILT-074 velayetsiz ödeyici veli yalnız finans ve sözleşme onay türlerinin veli bildirimini görür', () => {
    for (const kind of NOTIFICATION_KIND_NAMES) {
      const finance = isPayerNotificationKind(kind)
      assert.equal(canSeeNotification(payer, notification(kind)), finance, kind)
      // Öğrenci kitlesi ve ödemediği öğrenci açılmaz.
      assert.equal(canSeeNotification(payer, notification(kind, { audience: 'student' })), false)
      assert.equal(canSeeNotification(payer, notification(kind, { studentId: 's2' })), false)
      // Velayetli velinin görünürlüğü değişmez.
      assert.equal(canSeeNotification(custodial, notification(kind)), true, kind)
    }
    // Kitle çözümü velayet bağlantısındadır; ödeyici ayrı listededir.
    assert.deepEqual(notificationAudienceOf(payer), { student: [], parent: [] })
    assert.deepEqual(payerNotificationStudentIds(payer), ['s1'])
    assert.deepEqual(payerNotificationStudentIds({ role: 'yonetici', links: payer.links }), [])
    assert.equal(
      canSeeNotification({ role: 'ogrenci', links: payer.links }, notification('payment_received')),
      false,
    )
  })

  test('DOM-ILT-074 genel kapsam kuralı bildirim kararıyla aynıdır', () => {
    const state = seed()
    state.notifications = NOTIFICATION_KIND_NAMES.map((kind) => notification(kind))
    const visible = (actor: Actor) =>
      scopeFor(state, actor)
        .read('notifications', state.notifications)
        .map((row) => row.kind)
        .sort()
    assert.deepEqual(visible(payer), [...PAYER_NOTIFICATION_KINDS].sort())
    assert.deepEqual(visible(custodial), [...NOTIFICATION_KIND_NAMES].sort())
    assert.deepEqual(visible(veli()), [])
  })
})
