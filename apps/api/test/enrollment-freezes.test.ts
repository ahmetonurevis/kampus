import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, getTableColumns } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { findRecord, insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { enrollmentFreezes } from '../src/db/schema/enrollment-freezes.ts'
import { languageGroupMembers } from '../src/db/schema/language-groups.ts'
import { studentIdentities } from '../src/db/schema/student-identities.ts'
import { startDueFreezes } from '../src/services/enrollment-freezes.ts'
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
 * Kayıt dondurma uçları (IST-084; DOM-DIL-052, DOM-KAY-024, -026). Saat 6 Ekim 2026. Her test kendi
 * kurumunu kurar: yetişkin kursiyer `s-adult`, 18 yaş altı `s-minor` ve kendi grubu.
 */

type Json = ReturnType<typeof JSON.parse>
type Method = 'GET' | 'POST' | 'DELETE'

const BASE = '/api/v1/finance/enrollment-freezes'
const TODAY = '2026-10-06'
const COURSE = {
  name: 'Genel İngilizce B1.1',
  level: 'B1',
  totalHours: 12,
  weeklyHours: 4,
  minLearners: 2,
  maxLearners: 12,
}
const SCHEDULE = [
  { weekday: 1, startTime: '18:00' },
  { weekday: 1, startTime: '18:45' },
  { weekday: 3, startTime: '18:00' },
  { weekday: 3, startTime: '18:45' },
]
const REQUEST = {
  studentId: 's-adult',
  reason: 'relocation',
  startDate: '2026-10-20',
  returnDate: '2026-12-20',
}

describe('kayıt dondurma uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let groupSerial = 0
  const logs: string[] = []

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW, logs })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function send(
    method: Method,
    url: string,
    cookie: string | null,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url,
      headers: {
        origin: TEST_ORIGIN,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie === null ? {} : { cookie }),
        ...headers,
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    })
  }
  const version = (value: number) => ({ 'if-match': `"${String(value)}"` })

  async function identity(institutionId: string, studentId: string, birthDate: string) {
    await db.insert(studentIdentities).values({
      institutionId,
      studentId,
      academicYear: 2026,
      identityKind: 'foreign',
      identityNumber: `YK-${institutionId}-${studentId}`,
      birthDate,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
  }

  async function school(overrides: Partial<InstitutionOverrides> = {}) {
    const created = await createInstitution(app, { type: 'language_school', ...overrides })
    const students = ['s-adult', 's-minor'].map((id) => ({
      collection: 'students' as const,
      id,
      data: { id, name: `Kursiyer ${id}`, classId: 'c-dil', isActive: true },
    }))
    await insertMissingRecords(db, created.id, students, FIXED_NOW)
    await identity(created.id, 's-adult', '1995-01-01')
    await identity(created.id, 's-minor', '2012-01-01')
    return { ...created, cookie: await signInAs(app, created.admin) }
  }
  type School = Awaited<ReturnType<typeof school>>

  const member = async (t: School, role: 'onburo' | 'ogretmen') =>
    signInAs(app, await createMember(app, t.id, role, []))
  const learner = async (t: School, studentId: string) =>
    signInAs(
      app,
      await createMember(app, t.id, 'ogrenci', [{ kind: 'student', recordId: studentId }]),
    )
  const guardian = async (t: School, studentId: string) =>
    signInAs(app, await createMember(app, t.id, 'veli', [{ kind: 'child', recordId: studentId }]))

  /** Kurda grup açar; başlangıç 12 Ekim Pazartesi (ileri) ya da verilen gün. */
  async function group(
    t: School,
    students: readonly string[],
    overrides: Partial<{ startDate: string; capacity: number; ageBand: string }> = {},
  ) {
    groupSerial += 1
    const course = (
      await send(
        'POST',
        '/api/v1/courses',
        t.cookie,
        { ...COURSE, name: `${COURSE.name} ${String(groupSerial)}` },
        { 'idempotency-key': randomUUID() },
      )
    ).json<Json>().data
    await send(
      'POST',
      `/api/v1/courses/${String(course.id)}/activate`,
      t.cookie,
      {},
      {
        ...version(1),
        'idempotency-key': randomUUID(),
      },
    )
    const teacher = await createMember(app, t.id, 'ogretmen')
    const created = await send(
      'POST',
      '/api/v1/groups',
      t.cookie,
      {
        courseId: course.id,
        name: `Grup ${String(groupSerial)}`,
        ageBand: overrides.ageBand ?? 'adult',
        teacherMembershipId: teacher.membershipId,
        delivery: 'in_person',
        room: `Derslik ${String(groupSerial)}`,
        schedule: SCHEDULE,
        startDate: overrides.startDate ?? '2026-10-12',
        capacity: overrides.capacity ?? 10,
      },
      { 'idempotency-key': randomUUID() },
    )
    assert.equal(created.statusCode, 201, created.body)
    const id: string = created.json<Json>().data.id
    for (const studentId of students)
      await db.insert(languageGroupMembers).values({
        institutionId: t.id,
        id: randomUUID(),
        groupId: id,
        studentId,
        status: 'active',
        joinedAt: FIXED_NOW,
      })
    return id
  }

  const request = (cookie: string | null, body: unknown = REQUEST, headers = {}) =>
    send('POST', BASE, cookie, body, headers)
  async function requested(t: School, body: unknown = REQUEST) {
    const response = await request(t.cookie, body)
    assert.equal(response.statusCode, 201, response.body)
    return response.json<Json>().data
  }
  async function approved(t: School, body: unknown = REQUEST) {
    const row = await requested(t, body)
    const response = await send(
      'POST',
      `${BASE}/${String(row.id)}/approve`,
      t.cookie,
      undefined,
      version(row.version),
    )
    assert.equal(response.statusCode, 200, response.body)
    return response.json<Json>().data
  }
  const today = { ...REQUEST, startDate: TODAY, returnDate: '2026-12-20' }

  const rowOf = async (t: School, id: string) => {
    const [row] = await db
      .select()
      .from(enrollmentFreezes)
      .where(and(eq(enrollmentFreezes.institutionId, t.id), eq(enrollmentFreezes.id, id)))
    return row
  }
  const rowsOf = (t: School) =>
    db.select().from(enrollmentFreezes).where(eq(enrollmentFreezes.institutionId, t.id))
  const studentOf = (t: School, id: string) => findRecord(db, t.id, 'students', id)
  const membersOf = (t: School, groupId: string) =>
    db
      .select()
      .from(languageGroupMembers)
      .where(
        and(
          eq(languageGroupMembers.institutionId, t.id),
          eq(languageGroupMembers.groupId, groupId),
        ),
      )

  test('DOM-DIL-052: oturumsuz istek 401', async () => {
    const id = randomUUID()
    for (const [method, url] of [
      ['GET', BASE],
      ['POST', BASE],
      ['GET', `${BASE}/${id}`],
      ['POST', `${BASE}/${id}/approve`],
      ['POST', `${BASE}/${id}/reject`],
      ['POST', `${BASE}/${id}/return`],
    ] as const)
      assert.equal((await send(method, url, null)).statusCode, 401, url)
  })

  test('DOM-DIL-052: okulda uç yoktur, rol reddinden önce 404', async () => {
    const other = await createInstitution(app, { type: 'school' })
    const admin = await signInAs(app, other.admin)
    assert.equal((await send('GET', BASE, admin)).statusCode, 404)
    assert.equal((await request(admin)).statusCode, 404)
    const teacher = await signInAs(app, await createMember(app, other.id, 'ogretmen', []))
    assert.equal((await send('GET', BASE, teacher)).statusCode, 404)
  })

  test('DOM-YTK-040, DOM-DIL-052: crm modülü kapalıyken 403 module_disabled', async () => {
    const t = await school({ enabledModules: { crm: false } })
    const response = await send('GET', BASE, t.cookie)
    assert.equal(response.statusCode, 403)
    assert.equal(response.json<Json>().code, 'module_disabled')
    assert.equal((await request(t.cookie)).statusCode, 403)
    assert.deepEqual(await rowsOf(t), [])
  })

  test('DOM-DIL-052: rol reddi 403 ve kayıt değişmez', async () => {
    const t = await school()
    const teacher = await member(t, 'ogretmen')
    assert.equal((await request(teacher)).statusCode, 403)
    assert.equal((await send('GET', BASE, teacher)).statusCode, 403)
    const row = await requested(t)
    const clerk = await member(t, 'onburo')
    const adult = await learner(t, 's-adult')
    for (const cookie of [clerk, adult, teacher]) {
      const url = `${BASE}/${String(row.id)}`
      assert.equal(
        (await send('POST', `${url}/approve`, cookie, undefined, version(1))).statusCode,
        403,
      )
      assert.equal(
        (await send('POST', `${url}/reject`, cookie, undefined, version(1))).statusCode,
        403,
      )
    }
    assert.equal(
      (await send('POST', `${BASE}/${String(row.id)}/return`, adult, undefined, version(1)))
        .statusCode,
      403,
    )
    const stored = await rowOf(t, row.id)
    assert.equal(stored?.status, 'requested')
    assert.equal(stored?.version, 1)
  })

  test('DOM-YTK-011: başka kurumun kaydı okuma ve yazmada 404, B değişmez', async () => {
    const a = await school()
    const b = await school()
    const row = await requested(b)
    const url = `${BASE}/${String(row.id)}`
    assert.equal((await send('GET', url, a.cookie)).statusCode, 404)
    assert.equal(
      (await send('POST', `${url}/approve`, a.cookie, undefined, version(1))).statusCode,
      404,
    )
    assert.equal(
      (await send('POST', `${url}/reject`, a.cookie, undefined, version(1))).statusCode,
      404,
    )
    assert.equal(
      (await send('POST', `${url}/return`, a.cookie, undefined, version(1))).statusCode,
      404,
    )
    const stored = await rowOf(b, row.id)
    assert.equal(stored?.status, 'requested')
    assert.equal(stored?.version, 1)
    // Listede B kaydı yok; B'nin öğrencisine talep A'da 404 (öğrenci A'da yoksa).
    const list = (await send('GET', BASE, a.cookie)).json<Json>()
    assert.deepEqual(list.data, [])
    assert.equal(list.meta.total, 0)
    const onlyB = await requestForOtherStudent(a)
    assert.equal(onlyB.statusCode, 404)
    assert.equal((await rowsOf(a)).length, 0)
  })
  const requestForOtherStudent = (t: School) =>
    request(t.cookie, { ...REQUEST, studentId: 's-yalniz-b' })

  test('DOM-YTK-011: gövdedeki institutionId reddedilir (katı şema), kayıt açılmaz', async () => {
    const a = await school()
    const b = await school()
    const response = await request(a.cookie, { ...REQUEST, institutionId: b.id })
    assert.equal(response.statusCode, 400)
    assert.deepEqual(await rowsOf(a), [])
    assert.deepEqual(await rowsOf(b), [])
  })

  test('DOM-DIL-052: geçersiz gövde 400 ve kayıt değişmez', async () => {
    const t = await school()
    for (const body of [
      {},
      { ...REQUEST, reason: 'tatil' },
      { ...REQUEST, startDate: '20-10-2026' },
      { ...REQUEST, documentReceived: 'evet' },
    ])
      assert.equal((await request(t.cookie, body)).statusCode, 400, JSON.stringify(body))
    assert.deepEqual(await rowsOf(t), [])

    const row = await requested(t)
    const url = `${BASE}/${String(row.id)}`
    assert.equal((await send('POST', `${url}/approve`, t.cookie)).statusCode, 400)
    assert.equal(
      (await send('POST', `${BASE}/kimlik/approve`, t.cookie, undefined, version(1))).statusCode,
      400,
    )
    assert.equal((await send('GET', `${BASE}?bilinmeyen=1`, t.cookie)).statusCode, 400)
    const stored = await rowOf(t, row.id)
    assert.equal(stored?.status, 'requested')
    assert.equal(stored?.version, 1)
    assert.equal((await studentOf(t, 's-adult'))?.data.frozenAt, undefined)
  })

  test('DOM-KAY-024, K-20: serbest metin ve sağlık kategorisi alınmaz, hiçbir alana yazılmaz', async () => {
    const t = await school()
    const detail = 'Kalp ameliyatı raporu'
    for (const body of [
      { ...REQUEST, reason: 'health' },
      { ...REQUEST, reasonNote: detail },
      { ...REQUEST, documentReceived: true, documentNote: detail },
      { ...REQUEST, decisionNote: detail },
    ])
      assert.equal((await request(t.cookie, body)).statusCode, 400, JSON.stringify(body))
    assert.deepEqual(await rowsOf(t), [])

    const created = await request(t.cookie, { ...REQUEST, reason: 'documented' })
    assert.equal(created.statusCode, 201, created.body)
    const row = created.json<Json>().data
    assert.equal(row.reason, 'documented')
    for (const field of ['reasonNote', 'documentNote', 'decisionNote'])
      assert.equal(field in row, false, field)

    // Karar gövde almaz: eski istemcinin gönderdiği not da saklanmaz.
    const decided = await send(
      'POST',
      `${BASE}/${String(row.id)}/approve`,
      t.cookie,
      { note: detail },
      version(1),
    )
    assert.equal(decided.statusCode, 200, decided.body)
    assert.equal(decided.body.includes(detail), false)
    const stored = await rowOf(t, row.id)
    assert.equal(JSON.stringify(stored).includes(detail), false)
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.entityId, row.id)))
    assert.equal(JSON.stringify(audits).includes(detail), false)
    assert.equal(logs.join('\n').includes(detail), false, 'ayrıntı loglanmaz')

    // Metin yazılabilecek kolon kalmadı: bütün `text` kolonlar kimlik ya da sabit değerdir.
    const textColumns = Object.entries(getTableColumns(enrollmentFreezes))
      .filter(([, column]) => column.getSQLType() === 'text')
      .map(([name]) => name)
      .sort()
    assert.deepEqual(textColumns, [
      'decidedByUserId',
      'institutionId',
      'reason',
      'requestedByUserId',
      'status',
      'studentId',
    ])
  })

  test('DOM-DIL-052: talep, onay ve ileri tarihli etki; denetim yalnız alan adı taşır', async () => {
    const t = await school()
    const created = await request(t.cookie)
    assert.equal(created.statusCode, 201, created.body)
    const row = created.json<Json>().data
    assert.equal(created.headers.location, `${BASE}/${String(row.id)}`)
    assert.equal(row.status, 'requested')
    assert.equal(row.phase, 'requested')
    assert.equal(row.studentName, 'Kursiyer s-adult')
    assert.equal(row.midCourse, false)

    const fetched = await send('GET', `${BASE}/${String(row.id)}`, t.cookie)
    assert.equal(fetched.json<Json>().data.reason, REQUEST.reason)

    const decided = await send(
      'POST',
      `${BASE}/${String(row.id)}/approve`,
      t.cookie,
      undefined,
      version(1),
    )
    assert.equal(decided.statusCode, 200, decided.body)
    const body = decided.json<Json>().data
    assert.equal(body.status, 'approved')
    assert.equal(body.phase, 'scheduled')
    assert.equal(body.startedAt, null)
    // Başlangıç gelmedi: öğrenci hâlâ aktif sayılır.
    assert.equal((await studentOf(t, 's-adult'))?.data.frozenAt, undefined)

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.entityId, row.id)))
    assert.deepEqual(audits.map((item) => item.action).sort(), [
      'enrollment.freeze.approve',
      'enrollment.freeze.request',
    ])
  })

  test('DOM-DIL-052, DOM-KAY-026: başlangıç günündeki onay etkiyi doğurur, grupta yer tutmaz', async () => {
    const t = await school()
    const groupId = await group(t, ['s-adult'])
    const before = (await send('GET', `/api/v1/groups/${groupId}`, t.cookie)).json<Json>().data
    assert.equal(before.activeLearners, 1)

    const row = await approved(t, today)
    assert.equal(row.phase, 'frozen')
    assert.equal(row.startedAt, FIXED_NOW.toISOString())
    assert.deepEqual(row.groups, [{ id: groupId, name: before.name, memberStatus: 'frozen' }])

    const student = await studentOf(t, 's-adult')
    assert.equal(student?.data.frozenAt, FIXED_NOW.toISOString())
    assert.equal(student?.data.isActive, true, 'dondurma ayrılış değildir')

    const afterFreeze = (await send('GET', `/api/v1/groups/${groupId}`, t.cookie)).json<Json>().data
    assert.equal(afterFreeze.activeLearners, 0)
    assert.equal(afterFreeze.frozenLearners, 1)
  })

  test('DOM-DIL-052, DOM-KAY-026: dondurulan kursiyerin yoklaması beklenmez', async () => {
    const t = await school()
    await insertMissingRecords(
      db,
      t.id,
      [{ collection: 'classes', id: 'c-dil', data: { id: 'c-dil', name: 'Dil', grade: 'B1' } }],
      FIXED_NOW,
    )
    const attendance = (marks: Record<string, string>) =>
      send('POST', '/api/v1/classes/c-dil/attendance', t.cookie, {
        date: TODAY,
        marks,
        reason: 'Yönetici düzeltmesi',
      })
    const missing = await attendance({ 's-minor': 'present' })
    assert.equal(missing.statusCode, 422, missing.body)
    assert.equal(missing.json<Json>().code, 'attendance_incomplete')

    await approved(t, today)
    const recorded = await attendance({ 's-minor': 'present' })
    assert.equal(recorded.statusCode, 200, recorded.body)
  })

  test('DOM-DIL-052: reddedilen talebin etkisi yoktur, karara bağlanmış talep 409', async () => {
    const t = await school()
    const groupId = await group(t, ['s-adult'])
    const row = await requested(t, today)
    const url = `${BASE}/${String(row.id)}`
    const rejected = await send('POST', `${url}/reject`, t.cookie, undefined, version(1))
    assert.equal(rejected.statusCode, 200, rejected.body)
    assert.equal(rejected.json<Json>().data.status, 'rejected')
    assert.equal((await studentOf(t, 's-adult'))?.data.frozenAt, undefined)
    assert.equal((await membersOf(t, groupId))[0]?.status, 'active')

    const again = await send('POST', `${url}/approve`, t.cookie, undefined, version(2))
    assert.equal(again.statusCode, 409)
    assert.equal(again.json<Json>().code, 'enrollment_freeze_decided')
    // Sürüm tutmaz.
    const stale = await send('POST', `${url}/reject`, t.cookie, undefined, version(1))
    assert.equal(stale.statusCode, 409)
    // Reddedilenden sonra yeni talep açılabilir.
    assert.equal((await request(t.cookie, today)).statusCode, 201)
  })

  test('DOM-DIL-052: mükerrer talep 409; aynı anahtar ilk yanıtı tekrarlar', async () => {
    const t = await school()
    const headers = { 'idempotency-key': 'test-freeze-00001' }
    const first = await request(t.cookie, REQUEST, headers)
    assert.equal(first.statusCode, 201, first.body)
    const replay = await request(t.cookie, REQUEST, headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(replay.json<Json>().data.id, first.json<Json>().data.id)
    assert.equal((await rowsOf(t)).length, 1)

    const duplicate = await request(t.cookie)
    assert.equal(duplicate.statusCode, 409)
    assert.equal(duplicate.json<Json>().code, 'enrollment_freeze_open')
    assert.equal((await rowsOf(t)).length, 1)
  })

  test('DOM-DIL-052: kur ortası belge bilgisi ister; dosya içeriği alınmaz', async () => {
    const t = await school()
    await group(t, ['s-adult'])
    const midCourse = { ...REQUEST, startDate: '2026-10-14', returnDate: '2026-12-20' }
    const refused = await request(t.cookie, midCourse)
    assert.equal(refused.statusCode, 422)
    assert.equal(refused.json<Json>().code, 'freeze_document_required')
    assert.equal(refused.json<Json>().issues[0].path[0], 'documentReceived')
    assert.deepEqual(await rowsOf(t), [])
    const accepted = await request(t.cookie, {
      ...midCourse,
      documentReceived: true,
    })
    assert.equal(accepted.statusCode, 201, accepted.body)
    assert.equal(accepted.json<Json>().data.midCourse, true)
    // Bilinmeyen alan (dosya içeriği) şemada yoktur.
    const withFile = await request(t.cookie, { ...midCourse, documentFile: 'base64' })
    assert.equal(withFile.statusCode, 400)
  })

  test('DOM-DIL-052: kural reddi 422; 6 ay toplamı aşılamaz', async () => {
    const t = await school()
    for (const [body, code] of [
      [{ ...REQUEST, startDate: '2026-10-05' }, 'freeze_start_past'],
      [{ ...REQUEST, returnDate: REQUEST.startDate }, 'freeze_return_before_start'],
      [{ ...REQUEST, returnDate: '2027-05-20' }, 'freeze_limit_exceeded'],
    ] as const) {
      const response = await request(t.cookie, body)
      assert.equal(response.statusCode, 422, code)
      assert.equal(response.json<Json>().code, code)
    }
    assert.deepEqual(await rowsOf(t), [])
  })

  test('DOM-DIL-052: 18 yaş altında talebi veli, üstünde kursiyer açar; kapsam dışı 404', async () => {
    const t = await school()
    const minorSelf = await request(await learner(t, 's-minor'), {
      ...REQUEST,
      studentId: 's-minor',
    })
    assert.equal(minorSelf.statusCode, 403)
    assert.equal(minorSelf.json<Json>().code, 'freeze_guardian_required')
    const adultGuardian = await request(await guardian(t, 's-adult'))
    assert.equal(adultGuardian.statusCode, 403)
    assert.equal(adultGuardian.json<Json>().code, 'freeze_learner_required')
    assert.deepEqual(await rowsOf(t), [])

    const stranger = await request(await learner(t, 's-minor'))
    assert.equal(stranger.statusCode, 404, 'başka kursiyerin kaydı sızmaz')

    const adult = await learner(t, 's-adult')
    assert.equal((await request(adult)).statusCode, 201)
    const parent = await guardian(t, 's-minor')
    assert.equal((await request(parent, { ...REQUEST, studentId: 's-minor' })).statusCode, 201)

    // Kapsam: kursiyer ve veli yalnız kendi kaydını görür.
    const own = (await send('GET', BASE, adult)).json<Json>()
    assert.equal(own.meta.total, 1)
    assert.equal(own.data[0].studentId, 's-adult')
    const parentRows = (await send('GET', BASE, parent)).json<Json>()
    assert.equal(parentRows.meta.total, 1)
    assert.equal(parentRows.data[0].studentId, 's-minor')
    assert.equal(
      (await send('GET', `${BASE}/${String(parentRows.data[0].id)}`, adult)).statusCode,
      404,
    )
    const all = (await send('GET', BASE, t.cookie)).json<Json>()
    assert.equal(all.meta.total, 2)
    assert.equal((await send('GET', `${BASE}?q=s-minor`, t.cookie)).json<Json>().meta.total, 1)
    assert.equal(
      (await send('GET', `${BASE}?status=approved`, t.cookie)).json<Json>().meta.total,
      0,
    )
  })

  test('DOM-DIL-052: ön büro talep ve dönüş işler, karar veremez', async () => {
    const t = await school()
    const clerk = await member(t, 'onburo')
    const created = await request(clerk, today)
    assert.equal(created.statusCode, 201, created.body)
    const row = created.json<Json>().data
    const decided = await send(
      'POST',
      `${BASE}/${String(row.id)}/approve`,
      t.cookie,
      undefined,
      version(1),
    )
    assert.equal(decided.statusCode, 200)
    const returned = await send(
      'POST',
      `${BASE}/${String(row.id)}/return`,
      clerk,
      undefined,
      version(2),
    )
    assert.equal(returned.statusCode, 200, returned.body)
    assert.equal(returned.json<Json>().data.status, 'ended')
  })

  test('DOM-DIL-052: dönüşte kayıt aktifleşir; başlamamış boş gruba geri döner', async () => {
    const t = await school()
    const groupId = await group(t, ['s-adult'])
    const row = await approved(t, today)
    const returned = await send(
      'POST',
      `${BASE}/${String(row.id)}/return`,
      t.cookie,
      undefined,
      version(row.version),
    )
    assert.equal(returned.statusCode, 200, returned.body)
    const body = returned.json<Json>().data
    assert.equal(body.status, 'ended')
    assert.equal(body.endedDate, TODAY)
    assert.equal(body.needsPlacement, false)
    assert.equal(body.placementRenewalRequired, false)
    assert.equal((await studentOf(t, 's-adult'))?.data.frozenAt, null)
    const members = await membersOf(t, groupId)
    assert.equal(members[0]?.status, 'active')
    assert.equal(members[0]?.archivedAt, null)

    const again = await send(
      'POST',
      `${BASE}/${String(row.id)}/return`,
      t.cookie,
      undefined,
      version(body.version),
    )
    assert.equal(again.statusCode, 409)
    assert.equal(again.json<Json>().code, 'enrollment_freeze_not_active')
  })

  test('DOM-DIL-052: dolu gruba dönüş garanti edilmez, üyelik kapanır ve yerleştirme istenir', async () => {
    const t = await school()
    const groupId = await group(t, ['s-adult'], { capacity: 1 })
    const row = await approved(t, today)
    // Dondurulan yer tutmadığı için grup başkasına açılır.
    await db.insert(languageGroupMembers).values({
      institutionId: t.id,
      id: randomUUID(),
      groupId,
      studentId: 's-minor',
      status: 'active',
      joinedAt: FIXED_NOW,
    })
    const returned = await send(
      'POST',
      `${BASE}/${String(row.id)}/return`,
      t.cookie,
      undefined,
      version(row.version),
    )
    assert.equal(returned.statusCode, 200, returned.body)
    assert.equal(returned.json<Json>().data.needsPlacement, true)
    const own = (await membersOf(t, groupId)).find((item) => item.studentId === 's-adult')
    assert.ok(own?.archivedAt, 'üyelik arşivlenir, silinmez')
    assert.equal((await studentOf(t, 's-adult'))?.data.frozenAt, null)
  })

  test('DOM-DIL-052: başlamamış onaylı dondurma kapanır, üyelik ve bayrak değişmez', async () => {
    const t = await school()
    const groupId = await group(t, ['s-adult'], { startDate: '2026-11-02' })
    const row = await approved(t)
    const returned = await send(
      'POST',
      `${BASE}/${String(row.id)}/return`,
      t.cookie,
      undefined,
      version(row.version),
    )
    assert.equal(returned.statusCode, 200, returned.body)
    assert.equal(returned.json<Json>().data.startedAt, null)
    assert.equal((await membersOf(t, groupId))[0]?.status, 'active')
    assert.equal((await studentOf(t, 's-adult'))?.data.frozenAt, undefined)
  })

  test('DOM-DIL-045, DOM-DIL-052: iki programdaki kursiyerin iki üyeliği de donar ve görünür', async () => {
    const t = await school()
    const first = await group(t, ['s-adult'])
    const second = await group(t, ['s-adult'], { startDate: '2026-11-02' })
    const row = await approved(t, today)
    assert.equal(row.groups.length, 2)
    assert.equal((await membersOf(t, first))[0]?.status, 'frozen')
    assert.equal((await membersOf(t, second))[0]?.status, 'frozen')
  })

  test('DOM-DIL-052: aralıktaki açık taksit sayılır, plan değişmez', async () => {
    const t = await school()
    const invoice = (id: string, dueDate: string) => ({
      collection: 'invoices' as const,
      id,
      data: {
        id,
        studentId: 's-adult',
        installment: 1,
        amount: 100_000,
        dueDate,
        paidAt: null,
        method: null,
        reminderAt: null,
        feeKind: 'tuition',
      },
    })
    await insertMissingRecords(
      db,
      t.id,
      [
        invoice('test-i1', '2026-11-01T09:00:00.000Z'),
        invoice('test-i2', '2027-02-01T09:00:00.000Z'),
      ],
      FIXED_NOW,
    )
    const row = await approved(t, today)
    assert.equal(row.openInstallmentsDuring, 1)
    assert.equal(
      (await findRecord(db, t.id, 'invoices', 'test-i1'))?.data.dueDate,
      '2026-11-01T09:00:00.000Z',
    )
  })

  test('DOM-DIL-052: günlük iş başlangıcı gelen dondurmayı işler; ikinci koşu değiştirmez', async () => {
    const t = await school()
    const groupId = await group(t, ['s-adult'], { startDate: '2026-11-02' })
    const row = await approved(t)
    const log = app.log
    const start = new Date('2026-10-20T00:05:00.000Z')
    const early = await startDueFreezes({
      db,
      institutionId: t.id,
      now: new Date('2026-10-19T12:00:00.000Z'),
      log,
    })
    assert.deepEqual(early, { due: 0, started: 0, skipped: null })
    assert.equal((await studentOf(t, 's-adult'))?.data.frozenAt, undefined)

    const first = await startDueFreezes({ db, institutionId: t.id, now: start, log })
    assert.deepEqual(first, { due: 1, started: 1, skipped: null })
    assert.equal((await studentOf(t, 's-adult'))?.data.frozenAt, start.toISOString())
    assert.equal((await membersOf(t, groupId))[0]?.status, 'frozen')
    assert.equal((await rowOf(t, row.id))?.startedAt?.toISOString(), start.toISOString())

    const second = await startDueFreezes({ db, institutionId: t.id, now: start, log })
    assert.deepEqual(second, { due: 0, started: 0, skipped: null })

    const other = await createInstitution(app, { type: 'school' })
    assert.equal(
      (await startDueFreezes({ db, institutionId: other.id, now: start, log })).skipped,
      'unavailable',
    )
    const closed = await school({ enabledModules: { crm: false } })
    assert.equal(
      (await startDueFreezes({ db, institutionId: closed.id, now: start, log })).skipped,
      'module_disabled',
    )
    assert.equal(
      (await startDueFreezes({ db, institutionId: 'yok', now: start, log })).skipped,
      'institution_missing',
    )
  })

  test('H-24: dondurma MEBBİS alanı yazmaz; yanıtta MEBBİS bilgisi yoktur', async () => {
    const t = await school()
    const row = await approved(t, today)
    assert.ok(!Object.keys(row).some((key) => /mebbis/i.test(key)))
  })
})
