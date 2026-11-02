import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import type { CollectionName } from '../src/db/collections.ts'
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
import { rows } from './support/commands-harness.ts'

/**
 * Ders programı uçları (IST-094; docs/domain/yetki-ve-kapsam.md DOM-YTK-068, DOM-YTK-069). Her
 * test kendi kurumunu örnek veri kesitiyle kurar: 7-A (c1) ve 9-A (c5), ikisi de b1 kampüsünde;
 * Selin Kaya (t1) iki sınıfa matematik verir. Program örnek veriden değil, test derslerinden
 * oluşur. FIXED_NOW 2026-10-06 09:00Z salıdır.
 */

const SEED = createSeed(FIXED_NOW)
const CLASS_IDS = ['c1', 'c5']
const STUDENT_IDS = new Set(
  SEED.students.filter((item) => CLASS_IDS.includes(item.classId)).map((item) => item.id),
)
const T1 = SEED.teachers.find((item) => item.id === 't1')!
const lesson = (id: string, fields: Record<string, unknown> & { date: string }) => ({
  id,
  classId: 'c1',
  teacherId: 't1',
  subjectId: 'math',
  title: 'Matematik',
  duration: 40,
  room: '101',
  ...fields,
})
/** Gelecek ders (t1, 7-A). */
const L1 = lesson('lesson-test-1', { date: '2026-10-08T07:00:00.000Z' })
/** Gelecek ders (t1, 9-A). */
const L2 = lesson('lesson-test-2', {
  classId: 'c5',
  date: '2026-10-08T08:00:00.000Z',
  room: '105',
})
/** Geçmiş ders. */
const PAST = lesson('lesson-test-past', { date: '2026-10-05T07:00:00.000Z' })
/** Bugün, saat 09.00Z'den sonra; sınıfın bugünkü yoklaması alınmış (`ATTENDANCE`). */
const TODAY = lesson('lesson-test-today', {
  teacherId: 't2',
  subjectId: 'turkish',
  title: 'Türkçe',
  date: '2026-10-06T11:00:00.000Z',
})
/** Başka öğretmenin (t10) 9-A dersi. */
const OTHER = lesson('lesson-test-other', {
  classId: 'c5',
  teacherId: 't10',
  subjectId: 'geography',
  title: 'Coğrafya',
  date: '2026-10-09T07:00:00.000Z',
  room: '105',
})
const ATTENDANCE = {
  id: 'att-test-c1-today',
  studentId: 's1',
  classId: 'c1',
  date: '2026-10-06T08:00:00.000Z',
  status: 'present',
  reason: '',
}

type Sample = Partial<Record<CollectionName, readonly Record<string, unknown>[]>>
const SAMPLE: Sample = {
  subjects: SEED.subjects,
  branches: SEED.branches,
  teachers: [
    ...SEED.teachers,
    { ...T1, id: 'teacher-backup', name: 'Yedek Matematik' },
    { ...T1, id: 'teacher-far', name: 'Uzak Matematik', branchId: 'b2' },
    { ...T1, id: 'teacher-passive', name: 'Pasif Matematik', isActive: false },
  ],
  classes: SEED.classes.filter((item) => CLASS_IDS.includes(item.id)),
  students: SEED.students.filter((item) => STUDENT_IDS.has(item.id)),
  assignments: SEED.assignments.filter((item) => CLASS_IDS.includes(item.classId)),
  schedule: [L1, L2, PAST, TODAY, OTHER],
  attendance: [ATTENDANCE],
}

/** Programda dersi olmayan gelecek saatler. */
const FREE = '2026-11-03T07:00:00.000Z'
const NEW_LESSON = {
  classId: 'c1',
  teacherId: 't1',
  subjectId: 'math',
  date: FREE,
  duration: 40,
  room: '101',
}
const REASON = 'Okul gezisi nedeniyle ders yapılmayacak.'

describe('ders programı uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-lesson-${String(++serial).padStart(5, '0')}` })

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}, extra: Sample = {}) {
    const created = await createInstitution(app, overrides)
    const sample: Sample = { ...SAMPLE }
    for (const [name, items] of Object.entries(extra) as [CollectionName, Sample[CollectionName]][])
      sample[name] = [...(sample[name] ?? []), ...(items ?? [])]
    await insertMissingRecords(db, created.id, rows(sample), FIXED_NOW)
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }
  async function member(institutionId: string, role: Role, links: MembershipLinkInput[] = []) {
    const user = await createMember(app, institutionId, role, links)
    return { ...user, cookie: await signInAs(app, user) }
  }
  const teacher = async (institutionId: string, teacherId = 't1') =>
    (await member(institutionId, 'ogretmen', [{ kind: 'teacher', recordId: teacherId }])).cookie
  const student = async (institutionId: string, studentId = 's1') =>
    (await member(institutionId, 'ogrenci', [{ kind: 'student', recordId: studentId }])).cookie
  const parent = async (institutionId: string, studentId = 's1') =>
    (await member(institutionId, 'veli', [{ kind: 'child', recordId: studentId }])).cookie

  function send(
    method: 'POST' | 'PATCH',
    url: string,
    cookie: string | null,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
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
  const read = (cookie: string | null, url: string) =>
    app.inject({
      method: 'GET',
      url,
      headers: { origin: TEST_ORIGIN, ...(cookie === null ? {} : { cookie }) },
    })
  const ifMatch = (version: number) => ({ 'if-match': `"${String(version)}"` })
  const create = (
    cookie: string | null,
    body: unknown = NEW_LESSON,
    headers: Record<string, string> = key(),
  ) => send('POST', '/api/v1/lessons', cookie, body, headers)
  const patch = (
    cookie: string | null,
    id: string,
    body: unknown,
    headers: Record<string, string> = ifMatch(1),
  ) => send('PATCH', `/api/v1/lessons/${id}`, cookie, body, headers)
  const substitute = (
    cookie: string | null,
    id: string,
    body: unknown,
    headers: Record<string, string> = ifMatch(1),
  ) => send('POST', `/api/v1/lessons/${id}/substitute`, cookie, body, headers)
  const cancel = (
    cookie: string | null,
    id: string,
    body: unknown,
    headers: Record<string, string> = ifMatch(1),
  ) => send('POST', `/api/v1/lessons/${id}/cancel`, cookie, body, headers)

  function assertError(
    response: Awaited<ReturnType<typeof send>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const schedule = (institutionId: string) => loadRecords(db, institutionId, ['schedule'])
  /** Başarısız isteklerden sonra program (veri ve sürüm) aynı kalır. */
  async function unchanged(institutionId: string, action: () => Promise<void>) {
    const before = await schedule(institutionId)
    await action()
    const after = await schedule(institutionId)
    assert.deepEqual(
      after.map((row) => [row.id, row.version, row.data]),
      before.map((row) => [row.id, row.version, row.data]),
    )
  }
  const ids = (response: Awaited<ReturnType<typeof read>>) =>
    (response.json().data as { id: string }[]).map((item) => item.id)
  const audits = (institutionId: string, entityId: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.entityId, entityId)))

  // --- Kimlik, rol, modül ----------------------------------------------------------------------

  test('IST-094: oturumsuz her uç 401', async () => {
    assertError(await read(null, '/api/v1/lessons'), 401)
    assertError(await read(null, `/api/v1/lessons/${L1.id}`), 401)
    assertError(await create(null), 401)
    assertError(await patch(null, L1.id, { room: '102' }), 401)
    assertError(await substitute(null, L1.id, { teacherId: 'teacher-backup', reason: REASON }), 401)
    assertError(await cancel(null, L1.id, { reason: REASON }), 401)
  })

  test('DOM-YTK-068: öğretmen, öğrenci, veli ve ön büro ders yazamaz (403); hiçbir ders değişmez', async () => {
    const a = await institution()
    const cookies = [
      await teacher(a.id),
      await student(a.id),
      await parent(a.id),
      (await member(a.id, 'onburo')).cookie,
    ]
    await unchanged(a.id, async () => {
      for (const cookie of cookies) {
        assertError(await create(cookie), 403, 'forbidden')
        assertError(await patch(cookie, L1.id, { room: '102' }), 403, 'forbidden')
        assertError(
          await substitute(cookie, L1.id, { teacherId: 'teacher-backup', reason: REASON }),
          403,
          'forbidden',
        )
        assertError(await cancel(cookie, L1.id, { reason: REASON }), 403, 'forbidden')
      }
    })
  })

  test('IST-009: planning modülü kapalıyken her uç 403 module_disabled', async () => {
    const a = await institution({ enabledModules: { planning: false } })
    assertError(await read(a.adminCookie, '/api/v1/lessons'), 403, 'module_disabled')
    assertError(await read(a.adminCookie, `/api/v1/lessons/${L1.id}`), 403, 'module_disabled')
    await unchanged(a.id, async () => {
      assertError(await create(a.adminCookie), 403, 'module_disabled')
      assertError(await patch(a.adminCookie, L1.id, { room: '102' }), 403, 'module_disabled')
      assertError(await cancel(a.adminCookie, L1.id, { reason: REASON }), 403, 'module_disabled')
      assertError(
        await substitute(a.adminCookie, L1.id, { teacherId: 'teacher-backup', reason: REASON }),
        403,
        'module_disabled',
      )
    })
  })

  // --- Okuma -----------------------------------------------------------------------------------

  test('DOM-YTK-068: yönetici kurumun programını tarih sırasıyla okur; başka kurumun dersi listede yok ve 404', async () => {
    const a = await institution()
    const b = await institution({}, { schedule: [lesson('lesson-only-b', { date: FREE })] })
    const list = await read(a.adminCookie, '/api/v1/lessons?pageSize=100')
    assert.equal(list.statusCode, 200, list.body)
    assert.deepEqual(ids(list), [PAST.id, TODAY.id, L1.id, L2.id, OTHER.id])
    assert.equal(list.json().meta.total, 5)
    const first = list.json().data[2]
    assert.equal(first.status, 'planned')
    assert.equal(first.version, 1)
    assert.equal(first.cancelReason, null)
    assert.deepEqual(first.substitutions, [])
    const foreign = await read(a.adminCookie, '/api/v1/lessons/lesson-only-b')
    assertError(foreign, 404, 'not_found')
    // Başka kurumun dersi ile olmayan kimlik ayırt edilemez (kurum varlığı sızmaz).
    const missing = await read(a.adminCookie, '/api/v1/lessons/lesson-yok')
    assert.equal(missing.statusCode, foreign.statusCode)
    const sameBody = (response: typeof missing) => ({
      ...(response.json() as Record<string, unknown>),
      requestId: '',
    })
    assert.deepEqual(sameBody(missing), sameBody(foreign))
    assert.equal((await read(b.adminCookie, '/api/v1/lessons/lesson-only-b')).statusCode, 200)
  })

  test('DOM-YTK-068: süzgeçler gün aralığı, sınıf, öğretmen ve derslik; bilinmeyen parametre ve ters aralık 400', async () => {
    const a = await institution()
    const get = async (query: string) => {
      const response = await read(a.adminCookie, `/api/v1/lessons?${query}`)
      assert.equal(response.statusCode, 200, response.body)
      return ids(response)
    }
    assert.deepEqual(await get('dateFrom=2026-10-06&dateTo=2026-10-08'), [TODAY.id, L1.id, L2.id])
    assert.deepEqual(await get('classId=c5'), [L2.id, OTHER.id])
    assert.deepEqual(await get('teacherId=t10'), [OTHER.id])
    assert.deepEqual(await get('room=%20105%20'), [L2.id, OTHER.id])
    assert.deepEqual(await get('page=2&pageSize=2'), [L1.id, L2.id])
    assertError(await read(a.adminCookie, '/api/v1/lessons?institutionId=x'), 400)
    assertError(
      await read(a.adminCookie, '/api/v1/lessons?dateFrom=2026-10-09&dateTo=2026-10-08'),
      400,
    )
    assertError(await read(a.adminCookie, '/api/v1/lessons?cancelled=yes'), 400)
  })

  test('DOM-YTK-068: öğretmen yalnız kendi derslerini görür; başka öğretmenin dersi 404', async () => {
    const a = await institution()
    const cookie = await teacher(a.id)
    const list = await read(cookie, '/api/v1/lessons')
    assert.deepEqual(ids(list), [PAST.id, L1.id, L2.id])
    assertError(await read(cookie, `/api/v1/lessons/${OTHER.id}`), 404, 'not_found')
    assert.equal((await read(cookie, `/api/v1/lessons/${L1.id}`)).statusCode, 200)
  })

  test('DOM-YTK-068: öğrenci ve veli yalnız kendi sınıfının programını okur; başka sınıfın dersi 404', async () => {
    const a = await institution()
    for (const cookie of [await student(a.id), await parent(a.id)]) {
      const list = await read(cookie, '/api/v1/lessons')
      assert.equal(list.statusCode, 200, list.body)
      assert.deepEqual(ids(list), [PAST.id, TODAY.id, L1.id])
      assertError(await read(cookie, `/api/v1/lessons/${L2.id}`), 404, 'not_found')
    }
  })

  // --- Oluşturma -------------------------------------------------------------------------------

  test('DOM-YTK-069: yönetici ders planlar; 201, Location, kalıcılık, denetimde kişi; aynı anahtar aynı yanıt', async () => {
    const a = await institution()
    const headers = key()
    const response = await create(a.adminCookie, NEW_LESSON, headers)
    assert.equal(response.statusCode, 201, response.body)
    const data = response.json().data
    assert.equal(response.headers.location, `/api/v1/lessons/${data.id}`)
    assert.equal(data.status, 'planned')
    assert.equal(data.title, 'Matematik')
    assert.equal(data.version, 1)
    const stored = await findRecord(db, a.id, 'schedule', data.id)
    assert.equal(stored?.data.date, FREE)
    assert.equal(stored?.data.teacherId, 't1')
    const [audit] = await audits(a.id, data.id)
    assert.equal(audit?.actorUserId, a.admin.id)
    assert.equal(audit?.action, 'workflow.lesson')

    const replay = await create(a.adminCookie, NEW_LESSON, headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json(), response.json())
    assert.equal((await schedule(a.id)).length, SAMPLE.schedule!.length + 1)
  })

  test('DOM-YTK-069: oluşturmada anahtar zorunlu, If-Match ve bilinmeyen alan (institutionId) 400; ders yazılmaz', async () => {
    const a = await institution()
    await unchanged(a.id, async () => {
      assertError(await create(a.adminCookie, NEW_LESSON, {}), 400, 'idempotency_key_required')
      assertError(
        await create(a.adminCookie, NEW_LESSON, { ...key(), ...ifMatch(1) }),
        400,
        'if_match_not_supported',
      )
      assertError(
        await create(a.adminCookie, { ...NEW_LESSON, institutionId: 'baska' }),
        400,
        'validation_failed',
      )
      assertError(await create(a.adminCookie, { ...NEW_LESSON, duration: 5 }), 400)
    })
  })

  test('DOM-YTK-069: öğretmen, sınıf ve derslik çakışması 409; ders yazılmaz', async () => {
    const a = await institution()
    await unchanged(a.id, async () => {
      // t1 aynı saatte 7-A'da (L1); 9-A'ya ders veremez.
      assertError(
        await create(a.adminCookie, { ...NEW_LESSON, classId: 'c5', date: L1.date, room: 'Z-1' }),
        409,
        'teacher_lesson_conflict',
      )
      assertError(
        await create(a.adminCookie, {
          ...NEW_LESSON,
          teacherId: 'teacher-backup',
          date: L1.date,
          room: 'Z-1',
        }),
        409,
        'class_lesson_conflict',
      )
      assertError(
        await create(a.adminCookie, {
          ...NEW_LESSON,
          classId: 'c5',
          teacherId: 'teacher-backup',
          date: L1.date,
          room: ' 101 ',
        }),
        409,
        'room_conflict',
      )
    })
  })

  test('DOM-YTK-069: öğretmenin randevusu, etkinliği ve etüdü dersle çakışır (409)', async () => {
    const a = await institution(
      {},
      {
        appointments: [
          {
            id: 'apt-lesson-test',
            teacherId: 't1',
            studentId: 's1',
            parentId: 'p1',
            type: 'Veli görüşmesi',
            date: FREE,
            duration: 30,
            status: 'Onaylandı',
          },
        ],
        schoolEvents: [
          {
            id: 'event-lesson-test',
            title: 'Bilim şenliği',
            classId: '',
            branchId: 'b2',
            date: '2026-11-04T06:30:00.000Z',
            endDate: '2026-11-04T08:00:00.000Z',
            location: 'Bahçe',
            description: 'Şenlik',
            requiresConsent: false,
            consentDeadline: '2026-11-03T00:00:00.000Z',
            teacherId: 't1',
            status: 'Planlandı',
          },
        ],
        tutorSessions: [
          {
            id: 'tutor-lesson-test',
            teacherId: 't1',
            branchId: 'b2',
            studentIds: [],
            date: '2026-11-05T07:00:00.000Z',
            duration: 40,
            room: 'Etüt-1',
            status: 'Planlandı',
          },
        ],
      },
    )
    await unchanged(a.id, async () => {
      assertError(await create(a.adminCookie), 409, 'teacher_appointment_conflict')
      assertError(
        await create(a.adminCookie, { ...NEW_LESSON, date: '2026-11-04T07:00:00.000Z' }),
        409,
        'teacher_event_conflict',
      )
      assertError(
        await create(a.adminCookie, { ...NEW_LESSON, date: '2026-11-05T07:00:00.000Z' }),
        409,
        'tutor_schedule_conflict',
      )
    })
  })

  test('DOM-YTK-069: geçmiş saate ders planlanamaz (422)', async () => {
    const a = await institution()
    await unchanged(a.id, async () => {
      assertError(
        await create(a.adminCookie, { ...NEW_LESSON, date: '2026-10-06T08:00:00.000Z' }),
        422,
        'lesson_in_past',
      )
    })
  })

  // --- Düzenleme -------------------------------------------------------------------------------

  test('DOM-YTK-069: kısmi düzenleme diğer alanları korur, sürümü artırır; If-Match yok 400, tutmaz 409', async () => {
    const a = await institution()
    await unchanged(a.id, async () => {
      assertError(await patch(a.adminCookie, L1.id, { room: '102' }, {}), 400, 'if_match_required')
      assertError(
        await patch(a.adminCookie, L1.id, { room: '102' }, ifMatch(7)),
        409,
        'version_conflict',
      )
      assertError(await patch(a.adminCookie, L1.id, {}), 400)
      assertError(await patch(a.adminCookie, L1.id, { color: 'kırmızı' }), 400)
    })
    const response = await patch(a.adminCookie, L1.id, { room: '102', duration: 45 })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().data.version, 2)
    const stored = await findRecord(db, a.id, 'schedule', L1.id)
    assert.equal(stored?.version, 2)
    assert.equal(stored?.data.room, '102')
    assert.equal(stored?.data.duration, 45)
    assert.equal(stored?.data.date, L1.date)
    assert.equal(stored?.data.teacherId, 't1')
  })

  test('DOM-YTK-069: geçmiş ders düzenlenemez (422); başka kurumun dersi 404 ve o ders değişmez', async () => {
    const a = await institution()
    const b = await institution({}, { schedule: [lesson('lesson-only-b', { date: FREE })] })
    await unchanged(a.id, async () => {
      assertError(await patch(a.adminCookie, PAST.id, { room: '102' }), 422, 'lesson_in_past')
    })
    await unchanged(b.id, async () => {
      assertError(await patch(a.adminCookie, 'lesson-only-b', { room: '102' }), 404, 'not_found')
      assertError(await cancel(a.adminCookie, 'lesson-only-b', { reason: REASON }), 404)
    })
  })

  // --- Yedek öğretmen --------------------------------------------------------------------------

  test('DOM-YTK-069: yedek başka kampüste veya pasifse 422; geçmiş derse atanmaz', async () => {
    const a = await institution()
    await unchanged(a.id, async () => {
      assertError(
        await substitute(a.adminCookie, L1.id, { teacherId: 'teacher-far', reason: REASON }),
        422,
        'lesson_teacher_mismatch',
      )
      assertError(
        await substitute(a.adminCookie, L1.id, { teacherId: 'teacher-passive', reason: REASON }),
        422,
        'record_inactive',
      )
      assertError(
        await substitute(a.adminCookie, PAST.id, { teacherId: 'teacher-backup', reason: REASON }),
        422,
        'lesson_in_past',
      )
      assertError(await substitute(a.adminCookie, L1.id, { teacherId: 'teacher-backup' }), 400)
    })
  })

  test('DOM-YTK-069, DOM-YTK-023: yedek tek derse atanır, kalıcı atama değişmez; gerekçe denetimde, yedek dersi görür', async () => {
    const a = await institution()
    const assignments = await loadRecords(db, a.id, ['assignments'])
    const response = await substitute(a.adminCookie, L1.id, {
      teacherId: 'teacher-backup',
      reason: REASON,
    })
    assert.equal(response.statusCode, 200, response.body)
    const data = response.json().data
    assert.equal(data.status, 'substituted')
    assert.equal(data.teacherId, 'teacher-backup')
    assert.equal(data.originalTeacherId, 't1')
    assert.equal(data.substitutions[0].reason, REASON)
    assert.deepEqual(await loadRecords(db, a.id, ['assignments']), assignments)
    const [audit] = await audits(a.id, L1.id)
    assert.equal(audit?.actorUserId, a.admin.id)
    assert.equal(audit?.reason, REASON)
    assert.equal(audit?.action, 'workflow.substitute')
    // Asıl ve yedek öğretmen dersi görür; öğrenci gerekçeyi görmez.
    assert.equal(
      (await read(await teacher(a.id, 'teacher-backup'), `/api/v1/lessons/${L1.id}`)).statusCode,
      200,
    )
    assert.equal((await read(await teacher(a.id), `/api/v1/lessons/${L1.id}`)).statusCode, 200)
    const shown = (await read(await student(a.id), `/api/v1/lessons/${L1.id}`)).json().data
    assert.equal(shown.status, 'substituted')
    assert.equal('substitutions' in shown, false)
    assert.equal('cancelReason' in shown, false)
  })

  // --- İptal -----------------------------------------------------------------------------------

  test('DOM-YTK-069: iptal gerekçesiz 400, geçmiş ders ve yoklaması alınmış gün 422; ders değişmez', async () => {
    const a = await institution()
    await unchanged(a.id, async () => {
      assertError(await cancel(a.adminCookie, L1.id, {}), 400, 'validation_failed')
      assertError(await cancel(a.adminCookie, L1.id, { reason: ' ' }), 400)
      assertError(await cancel(a.adminCookie, PAST.id, { reason: REASON }), 422, 'lesson_in_past')
      assertError(
        await cancel(a.adminCookie, TODAY.id, { reason: REASON }),
        422,
        'lesson_attendance_taken',
      )
    })
  })

  test('DOM-YTK-069: iptal edilen ders günlük programdan çıkar, cancelled=true ile listelenir; gerekçe denetimde', async () => {
    const a = await institution()
    const response = await cancel(a.adminCookie, L1.id, { reason: REASON })
    assert.equal(response.statusCode, 200, response.body)
    const data = response.json().data
    assert.equal(data.status, 'cancelled')
    assert.equal(data.cancelledAt, FIXED_NOW.toISOString())
    assert.equal(data.cancelReason, REASON)
    assert.equal(data.version, 2)
    assert.equal((await findRecord(db, a.id, 'schedule', L1.id))?.data.cancelReason, REASON)

    assert.equal(ids(await read(a.adminCookie, '/api/v1/lessons')).includes(L1.id), false)
    assert.deepEqual(ids(await read(a.adminCookie, '/api/v1/lessons?cancelled=true')), [L1.id])
    assert.ok(ids(await read(a.adminCookie, '/api/v1/lessons?cancelled=all')).includes(L1.id))
    const studentCookie = await student(a.id)
    assert.equal(ids(await read(studentCookie, '/api/v1/lessons')).includes(L1.id), false)
    const shown = (await read(studentCookie, `/api/v1/lessons/${L1.id}`)).json().data
    assert.equal(shown.status, 'cancelled')
    assert.equal('cancelReason' in shown, false)

    const [audit] = await audits(a.id, L1.id)
    assert.equal(audit?.actorUserId, a.admin.id)
    assert.equal(audit?.reason, REASON)
    assert.equal(audit?.action, 'workflow.lesson-cancel')

    await unchanged(a.id, async () => {
      assertError(
        await cancel(a.adminCookie, L1.id, { reason: REASON }, ifMatch(2)),
        409,
        'lesson_already_cancelled',
      )
      assertError(
        await substitute(
          a.adminCookie,
          L1.id,
          { teacherId: 'teacher-backup', reason: REASON },
          ifMatch(2),
        ),
        422,
        'lesson_cancelled',
      )
      assertError(
        await patch(a.adminCookie, L1.id, { room: '102' }, ifMatch(2)),
        422,
        'lesson_cancelled',
      )
    })
    // İptal edilen dersin saati boşalır.
    const again = await create(a.adminCookie, { ...NEW_LESSON, date: L1.date })
    assert.equal(again.statusCode, 201, again.body)
  })

  test('DOM-YTK-069: aynı Idempotency-Key ile iptal tekrarı ilk yanıtı döndürür, ikinci kez yazmaz', async () => {
    const a = await institution()
    const headers = { ...ifMatch(1), ...key() }
    const first = await cancel(a.adminCookie, L1.id, { reason: REASON }, headers)
    assert.equal(first.statusCode, 200, first.body)
    const second = await cancel(a.adminCookie, L1.id, { reason: REASON }, headers)
    assert.equal(second.statusCode, 200)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.deepEqual(second.json(), first.json())
    assert.equal((await findRecord(db, a.id, 'schedule', L1.id))?.version, 2)
    assert.equal((await audits(a.id, L1.id)).length, 1)
  })

  test('DOM-YTK-069: köprü (/workflows/lesson-cancel) aynı kuralı çalıştırır: gerekçesiz 400, yoklamalı gün 422', async () => {
    const a = await institution()
    await unchanged(a.id, async () => {
      assertError(
        await send('POST', `/api/v1/workflows/lesson-cancel/${L1.id}`, a.adminCookie, {}),
        400,
      )
      assertError(
        await send('POST', `/api/v1/workflows/lesson-cancel/${TODAY.id}`, a.adminCookie, {
          reason: REASON,
        }),
        422,
        'lesson_attendance_taken',
      )
    })
  })
})
