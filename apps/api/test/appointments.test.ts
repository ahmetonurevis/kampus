import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { findRecord, insertMissingRecords, loadRecords } from '../src/db/records.ts'
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
 * Randevu uçları (docs/domain/iletisim-ve-veli.md DOM-ILT-100…104). Her test kendi kurumunu
 * örnek veri kesitiyle kurar: 7-A (c1) ve 9-A (c5), bütün öğretmenlerin uygunluk saatleri ve
 * iki sınıfın ders programı. Deniz (s1) ve s25 7-A'dadır; Selin Kaya (t1) 7-A'ya ders verir.
 * FIXED_NOW 2026-10-06 09:00Z salıdır; `slot-t1-0` 7 Ekim 13:00Z'dir.
 */

const SEED = createSeed(FIXED_NOW)
const CLASS_IDS = ['c1', 'c5']
const STUDENT_IDS = new Set(
  SEED.students.filter((item) => CLASS_IDS.includes(item.classId)).map((item) => item.id),
)
type Sample = Partial<Record<CollectionName, readonly Record<string, unknown>[]>>
const SAMPLE: Sample = {
  subjects: SEED.subjects,
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASS_IDS.includes(item.id)),
  students: SEED.students.filter((item) => STUDENT_IDS.has(item.id)),
  assignments: SEED.assignments.filter((item) => CLASS_IDS.includes(item.classId)),
  schedule: SEED.schedule.filter((item) => CLASS_IDS.includes(item.classId)),
  availability: SEED.availability,
}
const C1_TEACHERS = new Set(
  SEED.assignments.filter((item) => item.classId === 'c1').map((item) => item.teacherId),
)
const STRANGER_SLOT = SEED.availability.find((slot) => !C1_TEACHERS.has(slot.teacherId))
const LESSON = SEED.schedule.find(
  (item) => item.classId === 'c1' && item.teacherId === 't1' && Date.parse(item.date) > +FIXED_NOW,
)
const EXTRA_SLOTS = [
  // Geçmiş saat ve 7-A'daki bir t1 dersiyle aynı saat.
  { id: 'slot-gecmis', teacherId: 't1', date: '2026-10-05T13:00:00.000Z', duration: 30 },
  { id: 'slot-ders', teacherId: 't1', date: LESSON?.date, duration: 30 },
]

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

const NOTE = 'Denklem problemlerinde zorlanıyor, görüşmek istiyorum.'
const BOOKING = { studentId: 's1', slotId: 'slot-t1-0', note: NOTE }
const REASON = 'Okul toplantısı nedeniyle görüşemiyorum.'

describe('randevu uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-apt-${String(++serial).padStart(5, '0')}` })

  before(async () => {
    assert.ok(STRANGER_SLOT, 'örnek veride 7-A’ya ders vermeyen öğretmenin saati yok')
    assert.ok(LESSON, 'örnek veride t1’in 7-A’da gelecek dersi yok')
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}, sample = SAMPLE) {
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      created.id,
      rows({
        ...sample,
        availability: [...(sample.availability ?? []), ...EXTRA_SLOTS],
      }),
      FIXED_NOW,
    )
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }
  async function member(institutionId: string, role: Role, links: MembershipLinkInput[] = []) {
    const user = await createMember(app, institutionId, role, links)
    return { ...user, cookie: await signInAs(app, user) }
  }
  const parent = async (institutionId: string, studentId = 's1') =>
    (await member(institutionId, 'veli', [{ kind: 'child', recordId: studentId }])).cookie
  const student = async (institutionId: string, studentId = 's1') =>
    (await member(institutionId, 'ogrenci', [{ kind: 'student', recordId: studentId }])).cookie
  const teacher = async (institutionId: string, teacherId = 't1') =>
    (await member(institutionId, 'ogretmen', [{ kind: 'teacher', recordId: teacherId }])).cookie

  function send(
    method: 'POST' | 'PATCH',
    url: string,
    cookie: string | null,
    body: unknown,
    headers: Record<string, string> = {},
    target: App = app,
  ) {
    return target.inject({
      method,
      url,
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        ...(cookie === null ? {} : { cookie }),
        ...headers,
      },
      payload: JSON.stringify(body),
    })
  }
  const read = (cookie: string, url: string) =>
    app.inject({ method: 'GET', url, headers: { origin: TEST_ORIGIN, cookie } })
  const book = (
    cookie: string | null,
    body: unknown = BOOKING,
    headers: Record<string, string> = key(),
  ) => send('POST', '/api/v1/appointments', cookie, body, headers)
  const patch = (
    cookie: string | null,
    id: string,
    body: unknown,
    version: number | null,
    headers: Record<string, string> = {},
  ) =>
    send('PATCH', `/api/v1/appointments/${id}`, cookie, body, {
      ...(version === null ? {} : { 'if-match': `"${String(version)}"` }),
      ...headers,
    })

  function assertError(
    response: Awaited<ReturnType<typeof send>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const stored = (institutionId: string) => loadRecords(db, institutionId, ['appointments'])
  async function booked(cookie: string, body: unknown = BOOKING) {
    const response = await book(cookie, body)
    assert.equal(response.statusCode, 201, response.body)
    const data = response.json().data
    return { id: data.entity.id as string, version: data.records[0].version as number }
  }
  /** Başarısız isteklerden sonra randevunun verisi ve sürümü aynı kalır. */
  async function unchanged(institutionId: string, id: string, action: () => Promise<void>) {
    const before = await findRecord(db, institutionId, 'appointments', id)
    await action()
    const after = await findRecord(db, institutionId, 'appointments', id)
    assert.deepEqual(after?.data, before?.data)
    assert.equal(after?.version, before?.version)
  }

  // --- Talep -----------------------------------------------------------------------------------

  test('DOM-ILT-100: oturumsuz istek 401', async () => {
    assertError(await book(null), 401)
    assertError(await patch(null, 'apt1', { status: 'Onaylandı' }, 1), 401)
  })

  test('DOM-ILT-100, DOM-ILT-101: veli çocuğu için saat seçer; 201, Location, saat ve süre slottan, denetim kaydında not yok', async () => {
    const a = await institution()
    const b = await institution()
    const parentMember = await member(a.id, 'veli', [{ kind: 'child', recordId: 's1' }])
    const response = await book(parentMember.cookie)
    assert.equal(response.statusCode, 201, response.body)
    const id: string = response.json().data.entity.id
    assert.equal(response.headers.location, `/api/v1/collections/appointments/${id}`)
    const record = await findRecord(db, a.id, 'appointments', id)
    assert.equal(record?.data.status, 'Bekliyor')
    assert.equal(record?.data.teacherId, 't1')
    assert.equal(record?.data.slotId, 'slot-t1-0')
    assert.equal(record?.data.date, SEED.availability.find((s) => s.id === 'slot-t1-0')?.date)
    assert.equal(record?.data.duration, 30)
    assert.equal(record?.data.type, 'Veli görüşmesi')
    assert.deepEqual(record?.data.requestedBy, { role: 'veli', userId: parentMember.id })
    assert.equal(record?.data.createdAt, FIXED_NOW.toISOString())
    assert.equal((await stored(b.id)).length, 0)
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'appointment.book')))
    assert.equal(audit.length, 1)
    assert.equal(JSON.stringify(audit).includes(NOTE), false)
    const own = await read(parentMember.cookie, `/api/v1/collections/appointments/${id}`)
    assert.equal(own.statusCode, 200, own.body)
    const forTeacher = await read(await teacher(a.id), '/api/v1/collections/appointments')
    assert.deepEqual(
      forTeacher.json().data.map((item: { id: string }) => item.id),
      [id],
    )
  })

  test('DOM-ILT-100: aynı Idempotency-Key ilk yanıtı tekrarlar; anahtarsız istek 400, If-Match 400', async () => {
    const a = await institution()
    const cookie = await parent(a.id)
    const headers = key()
    const first = await book(cookie, BOOKING, headers)
    const again = await book(cookie, BOOKING, headers)
    assert.equal(again.statusCode, 201)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assert.deepEqual(again.json(), first.json())
    assert.equal((await stored(a.id)).length, 1)
    assertError(await book(cookie, BOOKING, {}), 400, 'idempotency_key_required')
    assertError(
      await book(cookie, BOOKING, { ...key(), 'if-match': '"1"' }),
      400,
      'if_match_not_supported',
    )
    assert.equal((await stored(a.id)).length, 1)
  })

  test('DOM-YTK-025: başka velinin çocuğu, başka öğrenci ve başka kurumun öğrencisi 403; geçersiz gövde 400; kayıt açılmaz', async () => {
    const a = await institution()
    const cookie = await parent(a.id)
    assertError(await book(cookie, { ...BOOKING, studentId: 's25' }), 403, 'student_scope_denied')
    assertError(
      await book(cookie, { ...BOOKING, studentId: 's-baska-kurum' }),
      403,
      'student_scope_denied',
    )
    assertError(
      await book(await student(a.id), { ...BOOKING, studentId: 's25' }),
      403,
      'student_scope_denied',
    )
    for (const body of [
      { ...BOOKING, note: '' },
      { ...BOOKING, slotId: undefined },
      { ...BOOKING, type: 'Kahve' },
      { ...BOOKING, institutionId: 'baska' },
      { ...BOOKING, teacherId: 't2' },
    ]) {
      const invalid = await book(cookie, body)
      assertError(invalid, 400, 'validation_failed')
      assert.equal(invalid.body.includes(NOTE), false)
    }
    assert.equal((await stored(a.id)).length, 0)
  })

  test('DOM-ILT-100: öğretmen, ön büro ve yönetici talep açamaz; ön büro ve yönetici durum değiştiremez', async () => {
    const a = await institution()
    const { id, version } = await booked(await parent(a.id))
    for (const cookie of [
      await teacher(a.id),
      (await member(a.id, 'onburo')).cookie,
      a.adminCookie,
    ])
      assertError(await book(cookie), 403, 'forbidden')
    await unchanged(a.id, id, async () => {
      for (const cookie of [(await member(a.id, 'onburo')).cookie, a.adminCookie])
        assertError(await patch(cookie, id, { status: 'Onaylandı' }, version), 403, 'forbidden')
    })
    assert.equal((await stored(a.id)).length, 1)
  })

  test('DOM-ILT-100: pasif öğrenci için talep 422; öğrenci kendine yalnız kendi türleriyle açar', async () => {
    const sample: Sample = {
      ...SAMPLE,
      students: (SAMPLE.students ?? []).map((item) =>
        item.id === 's25' ? { ...item, isActive: false } : item,
      ),
    }
    const a = await institution({}, sample)
    const inactive = await book(await parent(a.id, 's25'), { ...BOOKING, studentId: 's25' })
    assertError(inactive, 422, 'student_inactive')
    assert.deepEqual(inactive.json().issues[0].path, ['studentId'])
    const pupil = await student(a.id)
    const wrongType = await book(pupil, { ...BOOKING, type: 'Veli görüşmesi' })
    assertError(wrongType, 422, 'appointment_type_invalid')
    assert.deepEqual(wrongType.json().issues[0].path, ['type'])
    assert.equal((await stored(a.id)).length, 0)
    const { id } = await booked(pupil)
    const record = await findRecord(db, a.id, 'appointments', id)
    assert.equal(record?.data.type, 'Bireysel etüt')
    assert.equal((record?.data.requestedBy as { role: string }).role, 'ogrenci')
  })

  test('DOM-ILT-101: olmayan saat, sınıfa ders vermeyen öğretmenin saati ve geçmiş saat 422; kayıt açılmaz', async () => {
    const a = await institution()
    const cookie = await parent(a.id)
    for (const slotId of ['slot-yok', STRANGER_SLOT?.id ?? '']) {
      const response = await book(cookie, { ...BOOKING, slotId })
      assertError(response, 422, 'appointment_slot_unavailable')
      assert.deepEqual(response.json().issues[0].path, ['slotId'])
    }
    assertError(
      await book(cookie, { ...BOOKING, slotId: 'slot-gecmis' }),
      422,
      'appointment_in_past',
    )
    assert.equal((await stored(a.id)).length, 0)
  })

  test('DOM-ILT-101: dolu saat ve derse denk gelen saat 409; kapanan randevu saati bırakır (DOM-ILT-104)', async () => {
    const a = await institution()
    const first = await member(a.id, 'veli', [{ kind: 'child', recordId: 's1' }])
    const second = await parent(a.id, 's25')
    const { id, version } = await booked(first.cookie)
    const busy = await book(second, { ...BOOKING, studentId: 's25' })
    assertError(busy, 409, 'appointment_conflict')
    assert.deepEqual(busy.json().issues[0].path, ['slotId'])
    assertError(
      await book(first.cookie, { ...BOOKING, slotId: 'slot-ders' }),
      409,
      'appointment_conflict',
    )
    assert.equal((await stored(a.id)).length, 1)
    const withdrawn = await patch(first.cookie, id, { status: 'Geri çekildi' }, version)
    assert.equal(withdrawn.statusCode, 200, withdrawn.body)
    assert.equal((await book(second, { ...BOOKING, studentId: 's25' })).statusCode, 201)
    assert.equal((await stored(a.id)).length, 2)
  })

  test('DOM-ILT-073, DOM-ILT-103: göremediği görüşmeyle çakışan talep genel ileti alır; açan veli ayrıntıyı görür', async () => {
    const a = await institution()
    const first = await parent(a.id)
    const second = await parent(a.id)
    // Veli A, t1 ile 13:00'te görüşme açar; aynı saat t2'nin `slot-t2-0` saatidir.
    await booked(first)
    const before = (await stored(a.id)).length
    for (const cookie of [second, await student(a.id)]) {
      const hidden = await book(cookie, { ...BOOKING, slotId: 'slot-t2-0' })
      assertError(hidden, 409, 'appointment_conflict')
      assert.equal(hidden.json().message, 'Bu saat uygun değil.')
      assert.deepEqual(hidden.json().issues[0].path, ['slotId'])
      assert.equal(hidden.body.includes('randevusu'), false)
    }
    const visible = await book(first, { ...BOOKING, slotId: 'slot-t2-0' })
    assertError(visible, 409, 'appointment_conflict')
    assert.equal(visible.json().message, 'Öğrencinin bu saatte randevusu var.')
    assert.equal((await stored(a.id)).length, before)
  })

  test('DOM-ILT-101: talepte yalnız seçilen uygunluk saati yüklenir; not ve gerekçe loglanmaz', async () => {
    const a = await institution()
    const parentCookie = await parent(a.id)
    const teacherCookie = await teacher(a.id)
    const logs: string[] = []
    const logged = await buildTestApp(db, { logs, clock: () => FIXED_NOW })
    try {
      const created = await send(
        'POST',
        '/api/v1/appointments',
        parentCookie,
        BOOKING,
        key(),
        logged,
      )
      assert.equal(created.statusCode, 201, created.body)
      const { entity, records } = created.json().data
      const rejected = await send(
        'PATCH',
        `/api/v1/appointments/${entity.id}`,
        teacherCookie,
        { status: 'Reddedildi', reason: REASON },
        { 'if-match': `"${String(records[0].version)}"` },
        logged,
      )
      assert.equal(rejected.statusCode, 200, rejected.body)
      const lines = logs.flatMap((line) => line.split('\n')).filter(Boolean)
      const applied = lines
        .filter((line) => line.includes('"operation.applied"'))
        .map((line) => JSON.parse(line) as { action: string; loaded: Record<string, number> })
      const bookEntry = applied.find((entry) => entry.action === 'appointment.book')
      assert.equal(bookEntry?.loaded.availability, 1)
      assert.ok(applied.some((entry) => entry.action === 'appointment.update'))
      assert.equal(lines.join('\n').includes(NOTE), false)
      assert.equal(lines.join('\n').includes(REASON), false)
    } finally {
      await logged.close()
    }
  })

  // --- Durum değişikliği -------------------------------------------------------------------------

  test('DOM-ILT-102: öğretmen If-Match ile onaylar; geçmiş eklenir; talep eden gerekçeyle iptal eder; son durum 409', async () => {
    const a = await institution()
    const parentMember = await member(a.id, 'veli', [{ kind: 'child', recordId: 's1' }])
    const { id, version } = await booked(parentMember.cookie)
    const teacherCookie = await teacher(a.id)
    assertError(
      await patch(teacherCookie, id, { status: 'Onaylandı' }, null),
      400,
      'if_match_required',
    )
    assertError(
      await patch(teacherCookie, id, { status: 'Onaylandı' }, version + 1),
      409,
      'version_conflict',
    )
    const approved = await patch(teacherCookie, id, { status: 'Onaylandı' }, version)
    assert.equal(approved.statusCode, 200, approved.body)
    const next: number = approved.json().data.records[0].version
    assert.equal(next, version + 1)
    // Onaylı randevu geri çekilmez ve yeniden değerlendirilmez; gerekçesiz iptal 400.
    assertError(
      await patch(parentMember.cookie, id, { status: 'Geri çekildi' }, next),
      422,
      'appointment_transition_invalid',
    )
    const noReason = await patch(parentMember.cookie, id, { status: 'İptal' }, next)
    assertError(noReason, 400, 'validation_failed')
    assert.deepEqual(noReason.json().issues[0].path, ['reason'])
    const cancelled = await patch(
      parentMember.cookie,
      id,
      { status: 'İptal', reason: REASON },
      next,
    )
    assert.equal(cancelled.statusCode, 200, cancelled.body)
    const last: number = cancelled.json().data.records[0].version
    await unchanged(a.id, id, async () => {
      assertError(
        await patch(teacherCookie, id, { status: 'Onaylandı' }, last),
        409,
        'appointment_closed',
      )
    })
    const record = await findRecord(db, a.id, 'appointments', id)
    assert.equal(record?.data.status, 'İptal')
    const history = record?.data.history as {
      status: string
      by: { userId: string }
      reason?: string
    }[]
    assert.deepEqual(
      history.map((event) => event.status),
      ['Bekliyor', 'Onaylandı', 'İptal'],
    )
    assert.equal(history[2]?.by.userId, parentMember.id)
    assert.equal(history[2]?.reason, REASON)
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'appointment.update')))
    assert.equal(audit.length, 2)
    assert.equal(JSON.stringify(audit).includes(REASON), false)
  })

  test('DOM-ILT-102: onay ve red öğretmenin, geri çekme talep edenindir; red gerekçesiz 400', async () => {
    const a = await institution()
    const parentCookie = await parent(a.id)
    const pupil = await student(a.id)
    const teacherCookie = await teacher(a.id)
    // Öğrencinin açtığı talep veliye görünür; veli onu geri çekemez, onaylayamaz.
    const own = await booked(pupil)
    await unchanged(a.id, own.id, async () => {
      assertError(
        await patch(parentCookie, own.id, { status: 'Geri çekildi' }, own.version),
        403,
        'appointment_requester_only',
      )
      assertError(
        await patch(parentCookie, own.id, { status: 'Onaylandı' }, own.version),
        403,
        'appointment_teacher_only',
      )
      assertError(
        await patch(teacherCookie, own.id, { status: 'Geri çekildi' }, own.version),
        403,
        'appointment_requester_only',
      )
      const noReason = await patch(teacherCookie, own.id, { status: 'Reddedildi' }, own.version)
      assertError(noReason, 400, 'validation_failed')
      assert.deepEqual(noReason.json().issues[0].path, ['reason'])
      assertError(
        await patch(teacherCookie, own.id, { status: 'İptal', reason: REASON }, own.version),
        422,
        'appointment_transition_invalid',
      )
    })
    const rejected = await patch(
      teacherCookie,
      own.id,
      { status: 'Reddedildi', reason: REASON },
      own.version,
    )
    assert.equal(rejected.statusCode, 200, rejected.body)
    const record = await findRecord(db, a.id, 'appointments', own.id)
    assert.equal(record?.data.status, 'Reddedildi')
  })

  test('DOM-ILT-103: kapsam dışı randevu sürüm ne olursa olsun 404; olmayan ve başka kurumun randevusu 404', async () => {
    const a = await institution()
    const b = await institution()
    const { id, version } = await booked(await parent(a.id))
    // Aynı çocuğun ikinci velisi, öğrenci ve randevunun öğretmeni olmayan öğretmen görmez.
    const outsiders = [await parent(a.id), await student(a.id), await teacher(a.id, 't2')]
    await unchanged(a.id, id, async () => {
      for (const cookie of outsiders) {
        for (const tried of [version, version + 7])
          assertError(
            await patch(cookie, id, { status: 'İptal', reason: REASON }, tried),
            404,
            'not_found',
          )
        assertError(await read(cookie, `/api/v1/collections/appointments/${id}`), 404)
      }
      const foreign = await teacher(b.id)
      assertError(await patch(foreign, id, { status: 'Onaylandı' }, version), 404, 'not_found')
      assertError(await patch(foreign, id, { status: 'Onaylandı' }, version + 3), 404, 'not_found')
      assertError(
        await patch(await teacher(a.id), 'apt-yok', { status: 'Onaylandı' }, 1),
        404,
        'not_found',
      )
    })
  })

  test('DOM-ILT-102, DOM-ILT-103: yanlış sürümde kapsam dışı 404, görünür ama yetkisiz 403, yetkili 409', async () => {
    const a = await institution()
    const parentCookie = await parent(a.id)
    const otherParent = await parent(a.id)
    const teacherCookie = await teacher(a.id)
    // Öğrencinin açtığı talep veliye görünür; velinin açtığı görüşme öteki veliye görünmez.
    const own = await booked(await student(a.id))
    const meeting = await booked(parentCookie, { ...BOOKING, slotId: 'slot-t2-1' })
    const stale = (version: number) => version + 5
    await unchanged(a.id, meeting.id, async () => {
      assertError(
        await patch(otherParent, meeting.id, { status: 'Geri çekildi' }, stale(meeting.version)),
        404,
        'not_found',
      )
    })
    await unchanged(a.id, own.id, async () => {
      assertError(
        await patch(parentCookie, own.id, { status: 'Onaylandı' }, stale(own.version)),
        403,
        'appointment_teacher_only',
      )
      assertError(
        await patch(teacherCookie, own.id, { status: 'Onaylandı' }, stale(own.version)),
        409,
        'version_conflict',
      )
    })
    // Doğru sürümle aynı istek geçer; sürüm hatası kaydı değiştirmemiştir.
    const approved = await patch(teacherCookie, own.id, { status: 'Onaylandı' }, own.version)
    assert.equal(approved.statusCode, 200, approved.body)
  })

  test('DOM-ILT-101: bekleyen randevusu olan uygunluk saati 409 availability_has_appointments; geri çekilince kaldırılır', async () => {
    const a = await institution()
    const parentCookie = await parent(a.id)
    const teacherCookie = await teacher(a.id)
    const pending = await booked(parentCookie)
    const remove = (cookie: string) =>
      send('POST', '/api/v1/assessment/slot-remove/slot-t1-0', cookie, {})
    const slotBefore = await findRecord(db, a.id, 'availability', 'slot-t1-0')
    for (const cookie of [teacherCookie, a.adminCookie]) {
      const blocked = await remove(cookie)
      assertError(blocked, 409, 'availability_has_appointments')
      assert.deepEqual(blocked.json().issues[0].path, ['slotId'])
    }
    const slotAfter = await findRecord(db, a.id, 'availability', 'slot-t1-0')
    assert.deepEqual(slotAfter, slotBefore)
    const withdrawn = await patch(
      parentCookie,
      pending.id,
      { status: 'Geri çekildi' },
      pending.version,
    )
    assert.equal(withdrawn.statusCode, 200, withdrawn.body)
    const removed = await remove(teacherCookie)
    assert.equal(removed.statusCode, 200, removed.body)
    assert.equal(await findRecord(db, a.id, 'availability', 'slot-t1-0'), null)
    // Randevu kaydı silinmez; yalnız saat kalkar.
    assert.ok(await findRecord(db, a.id, 'appointments', pending.id))
  })

  test('DOM-YTK-040: iletişim modülü kapalıyken randevu uçları 403 module_disabled', async () => {
    const a = await institution({ enabledModules: { communication: false } })
    assertError(await book(await parent(a.id)), 403, 'module_disabled')
    assertError(
      await patch(await teacher(a.id), 'apt-yok', { status: 'Onaylandı' }, 1),
      403,
      'module_disabled',
    )
    assert.equal((await stored(a.id)).length, 0)
  })
})
