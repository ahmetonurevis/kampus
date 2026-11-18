import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { leaveCalendarSettings } from '../src/db/schema/finance-leave-calendar.ts'
import { ensureMember, ensureMembershipLinks } from '../src/services/identity.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  createUser,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type InstitutionOverrides,
} from './support/app.ts'

/**
 * İzin takvimi ve çakışma uyarıları (DOM-FIN-123; ON-183; K-420…K-422). Her test kendi kurumunu
 * kurar. Selin (t1) ve Murat (t2) matematik, Ayla (t3) fen öğretmeni; ön büro personelinin
 * öğretmen kaydı yok. FIXED_NOW 2026-10-06; izinler Kasım 2026.
 */

const FINANCE = '/api/v1/finance'
const CALENDAR = `${FINANCE}/leave-calendar`
const SETTINGS = `${FINANCE}/leave-calendar-settings`
const REQUESTS = `${FINANCE}/leave-requests`
const PROFILES = `${FINANCE}/leave-profiles`
const RECORDS = `${FINANCE}/leave-records`
const REPORTS = `${FINANCE}/medical-reports`
const NOVEMBER = `${CALENDAR}?startDate=2026-11-01&endDate=2026-11-30`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

const teacher = (id: string, name: string, subjectId: string) => ({
  collection: 'teachers' as const,
  id,
  data: {
    id,
    name,
    subjectId,
    branchId: 'b1',
    email: `${id}@ornek.test`,
    phone: '05550000000',
    isActive: true,
  },
})
const lesson = (id: string, date: string, teacherId: string) => ({
  collection: 'schedule' as const,
  id,
  data: {
    id,
    classId: 'c1',
    teacherId,
    subjectId: 'mat',
    date,
    duration: 40,
    title: 'Matematik',
    room: '101',
  },
})
const SAMPLE = [
  teacher('t1', 'Selin Kaya', 'mat'),
  teacher('t2', 'Murat Demir', 'mat'),
  teacher('t3', 'Ayla Şen', 'fen'),
  { collection: 'subjects' as const, id: 'mat', data: { id: 'mat', name: 'Matematik' } },
  { collection: 'subjects' as const, id: 'fen', data: { id: 'fen', name: 'Fen Bilimleri' } },
  { collection: 'classes' as const, id: 'c1', data: { id: 'c1', name: '9-A', grade: 9 } },
  // İstanbul 09.00.
  lesson('l1', '2026-11-02T06:00:00.000Z', 't1'),
  lesson('l4', '2026-11-04T06:00:00.000Z', 't1'),
]
const EXAM = { label: 'Ara sınavlar', startDate: '2026-11-06', endDate: '2026-11-12' }

describe('DOM-FIN-123: izin takvimi ve çakışma uyarısı uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.183.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    cookie: string | null,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url,
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie === null ? {} : { cookie }),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const get = (url: string, cookie: string | null) => call('GET', url, cookie)
  const key = () => ({ 'idempotency-key': randomUUID() })
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.183.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(db, created.id, SAMPLE, FIXED_NOW)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  async function person(t: Tenant, role: Role, name: string, teacherId?: string) {
    const user = await createUser(app, { name })
    const membership = await ensureMember(app.auth, db, {
      institutionId: t.id,
      userId: user.id,
      role,
    })
    if (teacherId !== undefined)
      await ensureMembershipLinks(db, t.id, membership.id, [
        { kind: 'teacher', recordId: teacherId },
      ])
    ok(
      await call(
        'POST',
        PROFILES,
        t.admin,
        { membershipId: membership.id, seniorityStartDate: '2020-03-15' },
        key(),
      ),
      201,
    )
    return membership.id
  }
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))
  const openRequest = (cookie: string, payload: Json) =>
    call('POST', REQUESTS, cookie, { typeCode: 'annual', ...payload }, key())
  const patchSettings = (
    cookie: string | null,
    payload: unknown,
    version: unknown,
    headers: Record<string, string> = key(),
  ) => call('PATCH', SETTINGS, cookie, payload, { ...ifMatch(version), ...headers })
  const settingsRows = (institutionId: string) =>
    db
      .select()
      .from(leaveCalendarSettings)
      .where(eq(leaveCalendarSettings.institutionId, institutionId))
  const auditOf = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  /** Selin bekleyen yıllık izin, Murat elle evlilik izni, Ayla rapor, ön büro onaylı ücretsiz izin. */
  async function scene(t: Tenant) {
    const selin = await person(t, 'ogretmen', 'Selin Kaya', 't1')
    const murat = await person(t, 'ogretmen', 'Murat Demir', 't2')
    const ayla = await person(t, 'ogretmen', 'Ayla Şen', 't3')
    const desk = await person(t, 'onburo', 'Deniz Ön Büro')
    const selinReq = ok(
      await openRequest(t.admin, {
        membershipId: selin,
        startDate: '2026-11-02',
        endDate: '2026-11-06',
        days: 5,
        substitutes: [{ lessonId: 'l4', substituteTeacherId: 't2' }],
      }),
      201,
    )
    ok(
      await call(
        'POST',
        RECORDS,
        t.admin,
        {
          membershipId: murat,
          typeCode: 'marriage',
          startDate: '2026-11-04',
          endDate: '2026-11-05',
          days: 2,
        },
        key(),
      ),
      201,
    )
    ok(
      await call(
        'POST',
        REPORTS,
        t.admin,
        {
          membershipId: ayla,
          reportType: 'sickness',
          startDate: '2026-11-03',
          endDate: '2026-11-04',
        },
        key(),
      ),
      201,
    )
    const deskReq = ok(
      await openRequest(t.admin, {
        membershipId: desk,
        typeCode: 'unpaid',
        startDate: '2026-11-09',
        endDate: '2026-11-09',
        days: 1,
      }),
      201,
    )
    ok(
      await call(
        'POST',
        `${REQUESTS}/${String(deskReq.id)}/approve`,
        t.admin,
        {},
        {
          ...ifMatch(deskReq.version),
          ...key(),
        },
      ),
    )
    return { selin, murat, ayla, desk, selinReq }
  }
  const entriesOf = (data: Json) =>
    (data.entries as Json[]).map((entry) => [
      entry.name,
      entry.source,
      entry.status,
      entry.category,
      entry.typeLabel,
    ])

  test('kimliksiz istek 401', async () => {
    assertError(await get(NOVEMBER, null), 401)
    assertError(await get(SETTINGS, null), 401)
    assertError(await patchSettings(null, { concurrentThreshold: 3 }, 1), 401)
  })

  test('DOM-FIN-123: öğretmen, veli ve öğrenci 403; ön büro ayara 403; modül kapalı 403', async () => {
    const t = await institution()
    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(NOVEMBER, cookie), 403)
      assertError(await get(SETTINGS, cookie), 403)
      assertError(await patchSettings(cookie, { concurrentThreshold: 3 }, 1), 403)
    }
    const desk = await member(t.id, 'onburo')
    ok(await get(NOVEMBER, desk))
    assertError(await get(SETTINGS, desk), 403)
    assertError(await patchSettings(desk, { concurrentThreshold: 3 }, 1), 403)
    assert.equal((await settingsRows(t.id)).length, 0)
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(NOVEMBER, closed.admin), 403, 'module_disabled')
    assertError(await get(SETTINGS, closed.admin), 403, 'module_disabled')
    assertError(
      await patchSettings(closed.admin, { concurrentThreshold: 3 }, 1),
      403,
      'module_disabled',
    )
  })

  test('DOM-FIN-123: takvim aralığı en çok 62 gün; bilinmeyen süzgeç 400', async () => {
    const t = await institution()
    assertError(await get(`${CALENDAR}?startDate=2026-11-01&endDate=2027-01-02`, t.admin), 400)
    assertError(await get(`${CALENDAR}?startDate=2026-11-05&endDate=2026-11-01`, t.admin), 400)
    assertError(await get(`${CALENDAR}?startDate=2026-11-01`, t.admin), 400)
    assertError(await get(`${NOVEMBER}&role=veli`, t.admin), 400)
    assertError(await get(`${NOVEMBER}&institutionId=x`, t.admin), 400)
    ok(await get(`${CALENDAR}?startDate=2026-11-01&endDate=2027-01-01`, t.admin))
  })

  test('DOM-FIN-123: yönetici takvimi tür adıyla, raporu yalnız "Raporlu" görür; süzgeçler ve eşik günleri', async () => {
    const t = await institution()
    await scene(t)
    const data = ok(await get(NOVEMBER, t.admin))
    assert.deepEqual(entriesOf(data), [
      ['Selin Kaya', 'request', 'pending', 'leave', 'Yıllık ücretli izin'],
      ['Ayla Şen', 'medical_report', 'approved', 'sick', null],
      ['Murat Demir', 'record', 'approved', 'leave', 'Evlilik izni'],
      // Onaylı talebin ürettiği kayıt talebiyle tek görünür.
      ['Deniz Ön Büro', 'request', 'approved', 'leave', 'Ücretsiz izin'],
    ])
    assert.equal(JSON.stringify(data).includes('sickness'), false, 'rapor türü yanıtta yok')
    assert.deepEqual(data.busyDays, [
      { day: '2026-11-04', subjectId: 'mat', count: 2 },
      { day: '2026-11-05', subjectId: 'mat', count: 2 },
    ])
    assert.deepEqual(data.subjects, [
      { id: 'fen', name: 'Fen Bilimleri' },
      { id: 'mat', name: 'Matematik' },
    ])
    assert.equal(data.concurrentThreshold, 2)
    assert.deepEqual(data.examWeeks, [])
    const filtered = async (query: string) =>
      (ok(await get(`${NOVEMBER}${query}`, t.admin)).entries as Json[]).map((item) => item.name)
    assert.deepEqual(await filtered('&subjectId=mat'), ['Selin Kaya', 'Murat Demir'])
    assert.deepEqual(await filtered('&role=onburo'), ['Deniz Ön Büro'])
    assert.deepEqual(await filtered('&status=pending'), ['Selin Kaya'])
    assert.deepEqual(ok(await get(`${NOVEMBER}&subjectId=fen`, t.admin)).busyDays, [])
    // Aralık dışı izin görünmez.
    assert.deepEqual(
      ok(await get(`${CALENDAR}?startDate=2026-11-10&endDate=2026-11-20`, t.admin)).entries,
      [],
    )
  })

  test('DOM-FIN-123: ön büro yalnız onaylı izinleri türsüz görür; uyarı günü ve eşik yok', async () => {
    const t = await institution()
    await scene(t)
    const desk = await member(t.id, 'onburo')
    const data = ok(await get(`${NOVEMBER}&status=pending`, desk))
    assert.deepEqual(entriesOf(data), [
      ['Ayla Şen', 'medical_report', 'approved', 'absent', null],
      ['Murat Demir', 'record', 'approved', 'absent', null],
      ['Deniz Ön Büro', 'request', 'approved', 'absent', null],
    ])
    assert.deepEqual(data.busyDays, [])
    assert.equal(data.concurrentThreshold, null)
    assert.equal(JSON.stringify(data).includes('Evlilik'), false)
  })

  test('DOM-FIN-123: ayar varsayılanla başlar, If-Match ile yazılır, değişiklik yoksa 422', async () => {
    const t = await institution()
    assert.deepEqual(ok(await get(SETTINGS, t.admin)), {
      concurrentThreshold: 2,
      examWeeks: [],
      version: 1,
    })
    assertError(await patchSettings(t.admin, { concurrentThreshold: 1 }, 1), 400)
    assertError(
      await patchSettings(t.admin, { examWeeks: [EXAM, { ...EXAM, label: 'Telafi' }] }, 1),
      400,
    )
    assertError(await patchSettings(t.admin, {}, 1), 400)
    assertError(
      await patchSettings(t.admin, { concurrentThreshold: 3, institutionId: 'x' }, 1),
      400,
    )
    assertError(
      await call('PATCH', SETTINGS, t.admin, { concurrentThreshold: 3 }, key()),
      400,
      'if_match_required',
    )
    assert.equal((await settingsRows(t.id)).length, 0)
    const headers = key()
    const saved = ok(await patchSettings(t.admin, { examWeeks: [EXAM] }, 1, headers))
    assert.deepEqual(saved, { concurrentThreshold: 2, examWeeks: [EXAM], version: 2 })
    const replay = await patchSettings(t.admin, { examWeeks: [EXAM] }, 1, headers)
    assert.equal(replay.statusCode, 200)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(
      await patchSettings(t.admin, { concurrentThreshold: 4 }, 1),
      409,
      'version_conflict',
    )
    assertError(
      await patchSettings(t.admin, { examWeeks: [EXAM] }, 2),
      422,
      'leave_calendar_settings_unchanged',
    )
    const next = ok(await patchSettings(t.admin, { concurrentThreshold: 4 }, 2))
    assert.deepEqual(next, { concurrentThreshold: 4, examWeeks: [EXAM], version: 3 })
    const rows = await settingsRows(t.id)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.version, 3)
    const audits = await auditOf(t.id, 'finance.leave_calendar.settings')
    assert.deepEqual(
      audits.map((row) => (row.changes as { fields: string[] }).fields.join()).sort(),
      ['concurrentThreshold', 'examWeeks'],
    )
  })

  test('DOM-FIN-123: önizleme ve talep ayrıntısı branş, sınav haftası ve yedek uyarısı taşır', async () => {
    const t = await institution()
    const { selin, murat, selinReq } = await scene(t)
    ok(await patchSettings(t.admin, { examWeeks: [EXAM] }, 1))
    const preview = ok(
      await get(
        `${REQUESTS}/preview?membershipId=${selin}&startDate=2026-11-02&endDate=2026-11-06`,
        t.admin,
      ),
    )
    const conflicts = preview.conflicts as Json[]
    assert.deepEqual(conflicts, [
      {
        code: 'branch_concurrent',
        subjectId: 'mat',
        subjectName: 'Matematik',
        startDate: '2026-11-04',
        endDate: '2026-11-05',
        peak: 2,
        threshold: 2,
        staff: [{ membershipId: murat, name: 'Murat Demir' }],
      },
      { code: 'exam_week', ...EXAM },
    ])

    const detail = ok(await get(`${REQUESTS}/${String(selinReq.id)}`, t.admin))
    assert.deepEqual(
      (detail.conflicts as Json[]).map((item) => item.code),
      ['branch_concurrent', 'exam_week', 'substitute_on_leave'],
    )
    assert.deepEqual((detail.conflicts as Json[])[2], {
      code: 'substitute_on_leave',
      lessonId: 'l4',
      startsAt: '2026-11-04T06:00:00.000Z',
      title: 'Matematik',
      teacherId: 't2',
      teacherName: 'Murat Demir',
    })
    // Eşik 3: branş uyarısı kalkar; uyarı onayı engellemez.
    ok(await patchSettings(t.admin, { concurrentThreshold: 3 }, 2))
    const raised = ok(await get(`${REQUESTS}/${String(selinReq.id)}`, t.admin))
    assert.deepEqual(
      (raised.conflicts as Json[]).map((item) => item.code),
      ['exam_week', 'substitute_on_leave'],
    )
    const approved = ok(
      await call(
        'POST',
        `${REQUESTS}/${String(selinReq.id)}/approve`,
        t.admin,
        {},
        {
          ...ifMatch(raised.version),
          ...key(),
        },
      ),
    )
    assert.equal(approved.status, 'approved')
    assert.equal((approved.conflicts as Json[]).length, 2)
    // Kapanmış talepte uyarı yok.
    const cancelled = ok(
      await call(
        'POST',
        `${REQUESTS}/${String(selinReq.id)}/cancel`,
        t.admin,
        { reason: 'Personel vazgeçti' },
        { ...ifMatch(approved.version), ...key() },
      ),
    )
    assert.deepEqual(cancelled.conflicts, [])
  })

  test('DOM-FIN-123: başka kurumun izinleri takvimde yok; ayar kurumlar arası ayrı; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    await scene(b)
    ok(await patchSettings(b.admin, { concurrentThreshold: 5, examWeeks: [EXAM] }, 1))
    const bSettings = await settingsRows(b.id)
    const calendar = ok(await get(NOVEMBER, a.admin))
    assert.deepEqual(calendar.entries, [])
    assert.deepEqual(calendar.examWeeks, [])
    assert.deepEqual(ok(await get(SETTINGS, a.admin)), {
      concurrentThreshold: 2,
      examWeeks: [],
      version: 1,
    })
    assertError(
      await patchSettings(a.admin, { concurrentThreshold: 3, institutionId: b.id }, 2),
      400,
    )
    ok(await patchSettings(a.admin, { concurrentThreshold: 3 }, 1))
    assert.deepEqual(await settingsRows(b.id), bSettings)
  })
})
