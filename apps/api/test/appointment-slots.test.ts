import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import type { MembershipLinkInput } from '../src/services/identity.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type InstitutionOverrides,
} from './support/app.ts'

/**
 * Alınabilir randevu saatleri (`GET /api/v1/appointments/slots`, docs/domain/iletisim-ve-veli.md
 * DOM-ILT-105). Her test kendi kurumunu örnek veri kesitiyle kurar: 7-A (c1) ve 9-A (c5), bütün
 * öğretmenlerin uygunluk saatleri. Deniz (s1) ve Nehir (s25) 7-A'dadır; 7-A'ya on öğretmen girer,
 * Emre Demir (t5) girmez. FIXED_NOW 2026-10-06 09:00Z; `slot-t1-0` 7 Ekim 13:00Z'dir.
 */

const SEED = createSeed(FIXED_NOW)
const CLASS_IDS = ['c1', 'c5']
const STUDENT_IDS = new Set(
  SEED.students.filter((item) => CLASS_IDS.includes(item.classId)).map((item) => item.id),
)
type Sample = Partial<Record<CollectionName, readonly Record<string, unknown>[]>>
const SECRET_NOTE = 'Gizli öğretmen notu: yalnız öğretmen görür.'
const SAMPLE: Sample = {
  subjects: SEED.subjects,
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASS_IDS.includes(item.id)),
  students: SEED.students.filter((item) => STUDENT_IDS.has(item.id)),
  assignments: SEED.assignments.filter((item) => CLASS_IDS.includes(item.classId)),
  schedule: SEED.schedule.filter((item) => CLASS_IDS.includes(item.classId)),
  availability: [
    ...SEED.availability,
    // Eski veya elle yazılmış kayıtta iç not bulunabilir; yanıta hiç girmemeli.
    {
      id: 'slot-notlu',
      teacherId: 't2',
      date: '2026-10-12T13:00:00.000Z',
      duration: 30,
      note: SECRET_NOTE,
      internalNote: SECRET_NOTE,
    },
    // 20 gün sonra: varsayılan 14 günde yok, 28 günlük aralıkta var.
    { id: 'slot-uzak', teacherId: 't1', date: '2026-10-26T13:00:00.000Z', duration: 30 },
  ],
}
const C1_TEACHERS = new Set(
  SEED.assignments.filter((item) => item.classId === 'c1').map((item) => item.teacherId),
)
const SLOT_KEYS = [
  'available',
  'campusName',
  'duration',
  'slotId',
  'startsAt',
  'subjectNames',
  'teacherId',
  'teacherName',
]
const NOTE = 'Okuma alışkanlığını konuşmak istiyorum, mümkünse yüz yüze.'

type Slot = { slotId: string; teacherId: string; startsAt: string; available: boolean }

function rows(sample: Sample) {
  return Object.entries(sample).flatMap(([collection, items]) =>
    (items ?? []).map((data) => {
      const name = collection as CollectionName
      const id = recordKey(name, data)
      if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
      return { collection: name, id, data }
    }),
  )
}

describe('alınabilir randevu saatleri ucu', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}, sample = SAMPLE) {
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(db, created.id, rows(sample), FIXED_NOW)
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }
  async function member(institutionId: string, role: Role, links: MembershipLinkInput[] = []) {
    const user = await createMember(app, institutionId, role, links)
    return { ...user, cookie: await signInAs(app, user) }
  }
  const parent = async (institutionId: string, ...children: string[]) =>
    (
      await member(
        institutionId,
        'veli',
        (children.length ? children : ['s1']).map((recordId) => ({ kind: 'child', recordId })),
      )
    ).cookie
  const student = async (institutionId: string, studentId = 's1') =>
    (await member(institutionId, 'ogrenci', [{ kind: 'student', recordId: studentId }])).cookie

  const slots = (cookie: string | null, query: string) =>
    app.inject({
      method: 'GET',
      url: `/api/v1/appointments/slots${query}`,
      headers: { origin: TEST_ORIGIN, ...(cookie === null ? {} : { cookie }) },
    })
  async function list(cookie: string, query = '?studentId=s1'): Promise<Slot[]> {
    const response = await slots(cookie, query)
    assert.equal(response.statusCode, 200, response.body)
    return response.json().data
  }
  const availableOf = (items: readonly Slot[], slotId: string) => {
    const slot = items.find((item) => item.slotId === slotId)
    assert.ok(slot, `${slotId} listede yok`)
    return slot.available
  }
  function assertError(
    response: Awaited<ReturnType<typeof slots>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const book = (cookie: string, body: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/appointments',
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': 'application/json',
        'idempotency-key': `test-slots-${String(++serial).padStart(5, '0')}`,
      },
      payload: JSON.stringify({ note: NOTE, ...body }),
    })

  test('DOM-ILT-105: oturumsuz istek 401', async () => {
    assertError(await slots(null, '?studentId=s1'), 401)
  })

  test('DOM-ILT-105: öğrenci kendi sınıfının öğretmenlerinin gelecek saatlerini alır; alanlar beyaz listedir, iç not yoktur, hiçbir şey yazılmaz', async () => {
    const a = await institution()
    const before = await loadRecords(db, a.id, ['availability', 'appointments'])
    const items = await list(await student(a.id))
    assert.ok(items.length > 0)
    assert.ok(items.every((item) => C1_TEACHERS.has(item.teacherId)))
    assert.ok(!items.some((item) => item.teacherId === 't5'))
    assert.ok(items.every((item) => Date.parse(item.startsAt) > +FIXED_NOW))
    assert.ok(!items.some((item) => item.slotId === 'slot-uzak'))
    for (const item of items) assert.deepEqual(Object.keys(item).sort(), SLOT_KEYS, item.slotId)
    const first = items.find((item) => item.slotId === 'slot-t1-0')
    assert.deepEqual(first, {
      slotId: 'slot-t1-0',
      teacherId: 't1',
      teacherName: 'Selin Kaya',
      startsAt: '2026-10-07T13:00:00.000Z',
      duration: 30,
      campusName: 'Kadıköy Kampüsü',
      subjectNames: ['Matematik'],
      available: true,
    })
    const response = await slots(await student(a.id), '?studentId=s1')
    assert.equal(response.body.includes(SECRET_NOTE), false)
    assert.equal(response.body.includes('internalNote'), false)
    assert.ok(availableOf(items, 'slot-notlu'))
    assert.deepEqual(await loadRecords(db, a.id, ['availability', 'appointments']), before)
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'appointment.slots')))
    assert.equal(audit.length, 0)
  })

  test('DOM-ILT-105, DOM-ILT-073: başka ailenin randevusunun tuttuğu saat dolu; tutan kişi, not ve neden dönmez', async () => {
    const a = await institution()
    const other = await member(a.id, 'veli', [{ kind: 'child', recordId: 's25' }])
    const booked = await book(other.cookie, { studentId: 's25', slotId: 'slot-t1-0' })
    assert.equal(booked.statusCode, 201, booked.body)
    const appointmentId: string = booked.json().data.entity.id
    const response = await slots(await parent(a.id), '?studentId=s1')
    assert.equal(response.statusCode, 200, response.body)
    const items: Slot[] = response.json().data
    assert.equal(availableOf(items, 'slot-t1-0'), false)
    // Aynı saatte başka öğretmen Deniz için boştur: dolu olan öğretmenin saatidir.
    assert.equal(availableOf(items, 'slot-t2-0'), true)
    for (const leak of [appointmentId, other.id, 's25', NOTE, 'uygun değil', 'randevusu var'])
      assert.equal(response.body.includes(leak), false, leak)
    // Talep eden ailede aynı saat de doludur; kendi talebinin saatindeki diğer saatler de.
    const own = await list(other.cookie, '?studentId=s25')
    assert.equal(availableOf(own, 'slot-t1-0'), false)
    assert.equal(availableOf(own, 'slot-t2-0'), false)
  })

  test('DOM-ILT-105: veli her çocuğu için ayrı liste alır', async () => {
    const a = await institution()
    const cookie = await parent(a.id, 's1', 's25')
    const booked = await book(cookie, { studentId: 's1', slotId: 'slot-t2-1' })
    assert.equal(booked.statusCode, 201, booked.body)
    const deniz = await list(cookie, '?studentId=s1')
    const nehir = await list(cookie, '?studentId=s25')
    assert.equal(availableOf(deniz, 'slot-t1-1'), false)
    assert.equal(availableOf(nehir, 'slot-t1-1'), true)
    assert.equal(availableOf(nehir, 'slot-t2-1'), false)
  })

  test('DOM-ILT-105, DOM-YTK-001: öğretmen, yönetici ve ön büro 403', async () => {
    const a = await institution()
    const teacher = await member(a.id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
    const front = await member(a.id, 'onburo')
    for (const cookie of [teacher.cookie, front.cookie, a.adminCookie])
      assertError(await slots(cookie, '?studentId=s1'), 403, 'forbidden')
  })

  test('DOM-ILT-105: başka velinin çocuğu, başka öğrenci ve olmayan öğrenci 404; kurum sınırı korunur', async () => {
    const a = await institution()
    const b = await institution()
    const cookie = await parent(a.id)
    assertError(await slots(cookie, '?studentId=s25'), 404, 'not_found')
    assertError(await slots(cookie, '?studentId=s-yok'), 404, 'not_found')
    assertError(await slots(await student(a.id), '?studentId=s25'), 404, 'not_found')
    // B kurumundaki talep A'nın listesini etkilemez; A'daki okuma B'yi değiştirmez.
    const bParent = await parent(b.id)
    const booked = await book(bParent, { studentId: 's1', slotId: 'slot-t1-1' })
    assert.equal(booked.statusCode, 201, booked.body)
    const bBefore = await loadRecords(db, b.id, ['appointments', 'availability'])
    assert.equal(availableOf(await list(cookie), 'slot-t1-1'), true)
    assert.equal(availableOf(await list(bParent), 'slot-t1-1'), false)
    assert.deepEqual(await loadRecords(db, b.id, ['appointments', 'availability']), bBefore)
  })

  test('DOM-ILT-105: aralık sınırı; 28 günü aşan, ters, başlangıçsız aralık ve bilinmeyen parametre 400', async () => {
    const a = await institution()
    const cookie = await student(a.id)
    const wide = await list(
      cookie,
      '?studentId=s1&from=2026-10-06T09:00:00.000Z&to=2026-11-03T09:00:00.000Z',
    )
    assert.ok(wide.some((item) => item.slotId === 'slot-uzak'))
    const narrow = await list(
      cookie,
      '?studentId=s1&from=2026-10-08T00:00:00.000Z&to=2026-10-09T00:00:00.000Z',
    )
    assert.ok(narrow.length > 0)
    assert.ok(narrow.every((item) => item.startsAt.startsWith('2026-10-08')))
    for (const query of [
      '?studentId=s1&from=2026-10-06T09:00:00.000Z&to=2026-11-03T09:00:01.000Z',
      '?studentId=s1&from=2026-10-09T00:00:00.000Z&to=2026-10-08T00:00:00.000Z',
      '?studentId=s1&to=2026-10-09T00:00:00.000Z',
      '?studentId=s1&from=yarin',
      '?studentId=s1&institutionId=baska',
      '?studentId=',
      '',
    ])
      assertError(await slots(cookie, query), 400, 'validation_failed')
  })

  test('DOM-ILT-105, DOM-YTK-025: pasif öğrenci 422 student_inactive', async () => {
    const a = await institution(
      {},
      {
        ...SAMPLE,
        students: (SAMPLE.students ?? []).map((item) =>
          item.id === 's1' ? { ...item, isActive: false } : item,
        ),
      },
    )
    assertError(await slots(await parent(a.id), '?studentId=s1'), 422, 'student_inactive')
  })

  test('DOM-YTK-040: iletişim modülü kapalıyken uç 403 module_disabled', async () => {
    const a = await institution({ enabledModules: { communication: false } })
    assertError(await slots(await parent(a.id), '?studentId=s1'), 403, 'module_disabled')
  })
})
