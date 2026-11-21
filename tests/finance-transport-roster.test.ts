import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  assertTransportRosterPurpose,
  canUseTransportRosterPurpose,
  transportRosterContacts,
  transportRosterCount,
  transportRosterGroups,
  transportRosterPurposeSchema,
  transportRosterRelationshipLabel,
  type RosterParentRecord,
  type RosterStudent,
} from '../packages/school-core/src/lib/finance-transport-roster.ts'

/** Servis listesi kuralları (DOM-FIN-148; ON-148; IST-028; K-499…K-501). */

type Link = Parameters<typeof transportRosterContacts>[0]['links'][number]

const link = (overrides: Partial<Link> = {}): Link => ({
  parentId: 'p1',
  membershipId: null,
  relationship: 'mother',
  custody: 'full',
  contactRestricted: false,
  ...overrides,
})

const parents = new Map<string, RosterParentRecord>([
  ['p1', { id: 'p1', name: 'Ayşe Yılmaz', phone: '05321234512', relationship: 'mother' }],
  ['p2', { id: 'p2', name: 'Mehmet Yılmaz', phone: '0533 765 43 21', relationship: 'baba' }],
  ['p3', { id: 'p3', name: 'Telefonsuz Veli', phone: null, relationship: null }],
])

const contacts = (
  input: Partial<Parameters<typeof transportRosterContacts>[0]> = {},
): ReturnType<typeof transportRosterContacts> =>
  transportRosterContacts({
    links: [],
    memberNames: new Map(),
    parents,
    studentParentId: null,
    purpose: 'office',
    ...input,
  })

describe('DOM-FIN-148: servis listesi amacı ve yetki (K-500)', () => {
  test('DOM-FIN-148: varsayılan amaç kurum içi liste; bilinmeyen amaç doğrulama hatası', () => {
    assert.equal(transportRosterPurposeSchema.parse(undefined), 'office')
    assert.equal(transportRosterPurposeSchema.parse('driver'), 'driver')
    assert.equal(transportRosterPurposeSchema.safeParse('parent').success, false)
  })

  test('DOM-FIN-148: tam telefonlu liste yalnız yönetici; ön büro kurum içi listeyi alır', () => {
    assert.equal(canUseTransportRosterPurpose('yonetici', 'driver'), true)
    assert.equal(canUseTransportRosterPurpose('yonetici', 'office'), true)
    assert.equal(canUseTransportRosterPurpose('onburo', 'office'), true)
    assert.equal(canUseTransportRosterPurpose('onburo', 'driver'), false)
    for (const role of ['ogretmen', 'veli', 'ogrenci'])
      assert.equal(canUseTransportRosterPurpose(role, 'office'), false)
    assert.doesNotThrow(() => assertTransportRosterPurpose('yonetici', 'driver'))
    assert.throws(
      () => assertTransportRosterPurpose('onburo', 'driver'),
      (error) =>
        error instanceof DomainError &&
        error.code === 'transport_roster_driver_forbidden' &&
        error.kind === 'forbidden',
    )
  })
})

describe('DOM-FIN-148: acil iletişim (K-501)', () => {
  test('DOM-FIN-148: kurum içi listede telefon maskeli, sürücü listesinde tam', () => {
    const links = [link()]
    assert.deepEqual(contacts({ links }), [
      { name: 'Ayşe Yılmaz', relationship: 'mother', phone: '0532 *** ** 12' },
    ])
    assert.deepEqual(contacts({ links, purpose: 'driver' }), [
      { name: 'Ayşe Yılmaz', relationship: 'mother', phone: '05321234512' },
    ])
  })

  test('DOM-FIN-148: velayeti olmayan ve iletişim kısıtlı veli listeye girmez; kayıttaki veliye düşülmez', () => {
    const links = [
      link({ parentId: 'p1', contactRestricted: true, custody: 'none' }),
      link({ parentId: 'p2', relationship: 'father', custody: 'none' }),
    ]
    assert.deepEqual(contacts({ links, studentParentId: 'p1' }), [])
    const mixed = [link({ parentId: 'p1', contactRestricted: true, custody: 'none' })]
    mixed.push(link({ parentId: 'p2', relationship: 'father', custody: 'joint' }))
    assert.deepEqual(contacts({ links: mixed, purpose: 'driver' }), [
      { name: 'Mehmet Yılmaz', relationship: 'father', phone: '0533 765 43 21' },
    ])
  })

  test('DOM-FIN-148: hesap adı kayıttan önce gelir; hesaplı ama kayıtsız veli telefonsuz; en çok iki kişi', () => {
    const links = [
      link({ parentId: 'p1', membershipId: 'm1' }),
      link({ parentId: null, membershipId: 'm2', relationship: 'father', custody: 'joint' }),
      link({ parentId: 'p2', relationship: 'other', custody: 'joint' }),
    ]
    assert.deepEqual(contacts({ links, memberNames: new Map([['m1', 'Ayşe Y. (hesap)']]) }), [
      { name: 'Ayşe Y. (hesap)', relationship: 'mother', phone: '0532 *** ** 12' },
      { name: null, relationship: 'father', phone: null },
    ])
  })

  test('DOM-FIN-148: bağı olmayan öğrencide öğrenci kaydındaki veli; bilinmeyen yakınlık boş', () => {
    assert.deepEqual(contacts({ studentParentId: 'p2' }), [
      { name: 'Mehmet Yılmaz', relationship: null, phone: '0533 *** ** 21' },
    ])
    assert.deepEqual(contacts({ studentParentId: 'p1', purpose: 'driver' }), [
      { name: 'Ayşe Yılmaz', relationship: 'mother', phone: '05321234512' },
    ])
    assert.deepEqual(contacts({ studentParentId: 'p3' }), [
      { name: 'Telefonsuz Veli', relationship: null, phone: null },
    ])
    assert.deepEqual(contacts({ studentParentId: 'yok' }), [])
    assert.deepEqual(contacts(), [])
  })

  test('DOM-FIN-148: yakınlık metni', () => {
    assert.equal(transportRosterRelationshipLabel('mother'), 'Anne')
    assert.equal(transportRosterRelationshipLabel('legal_guardian'), 'Vasi')
    assert.equal(transportRosterRelationshipLabel(null), null)
  })
})

describe('DOM-FIN-148: durak grupları (K-499)', () => {
  const stops = [
    { id: 'st2', position: 2, name: 'Bahariye', time: '07:25' },
    { id: 'st1', position: 1, name: 'Moda', time: '07:10' },
    { id: 'st3', position: 3, name: 'Kadıköy', time: '07:40' },
  ]
  const students = new Map<string, RosterStudent>([
    ['s1', { name: 'Deniz Yılmaz', classId: 'c1', isActive: true }],
    ['s2', { name: 'Ece Yılmaz', classId: 'c2', isActive: true }],
    ['s3', { name: 'Can Demir', classId: 'c-yok', isActive: true }],
    ['s-left', { name: 'Ayrılan Öğrenci', classId: 'c1', isActive: false }],
    ['s4', { name: 'Çağla Ak', classId: null, isActive: true }],
  ])
  const groups = transportRosterGroups({
    stops,
    assignments: [
      { studentId: 's2', stopId: 'st1' },
      { studentId: 's1', stopId: 'st1' },
      { studentId: 's-left', stopId: 'st1' },
      { studentId: 's-archived', stopId: 'st2' },
      { studentId: 's3', stopId: 'st2' },
      { studentId: 's4', stopId: 'st2' },
      { studentId: 's1', stopId: 'baska-guzergah' },
    ],
    students,
    classNames: new Map([
      ['c1', '7-A'],
      ['c2', '5-B'],
    ]),
    contactsOf: (studentId) =>
      studentId === 's1' ? [{ name: 'Ayşe Yılmaz', relationship: 'mother', phone: 'x' }] : [],
  })

  test('DOM-FIN-148: duraklar sırasıyla, öğrenciler ada göre; ayrılan ve arşivli öğrenci yok', () => {
    assert.deepEqual(
      groups.map((group) => [group.position, group.name, group.students.map((s) => s.studentName)]),
      [
        [1, 'Moda', ['Deniz Yılmaz', 'Ece Yılmaz']],
        [2, 'Bahariye', ['Can Demir', 'Çağla Ak']],
        [3, 'Kadıköy', []],
      ],
    )
    assert.equal(transportRosterCount(groups), 4)
  })

  test('DOM-FIN-148: sınıf adı ve acil iletişim satıra yazılır; sağlık alanı yoktur', () => {
    const [moda, bahariye] = groups
    assert.deepEqual(moda?.students[0], {
      studentName: 'Deniz Yılmaz',
      className: '7-A',
      contacts: [{ name: 'Ayşe Yılmaz', relationship: 'mother', phone: 'x' }],
    })
    assert.equal(bahariye?.students[0]?.className, null)
    assert.equal(bahariye?.students[1]?.className, null)
    assert.deepEqual(Object.keys(moda ?? {}).sort(), ['id', 'name', 'position', 'students', 'time'])
  })
})
