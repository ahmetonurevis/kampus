import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  staffLeaveRequestLessons,
  staffLeaveRequests,
} from '../src/db/schema/finance-leave-requests.ts'
import { staffLeaveRecords } from '../src/db/schema/finance-staff-leave.ts'
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
 * İzin talebi ve onayı uçları (DOM-FIN-116; ON-182; K-397…K-399). Her test kendi kurumunu kurar;
 * öğretmen personeli `t1` öğretmen kaydına bağlıdır, ders programı ve öğretmenler `records`'a
 * yazılır. FIXED_NOW 2026-10-06; izin 2–6 Kasım 2026 (pazartesi–cuma).
 */

const FINANCE = '/api/v1/finance'
const REQUESTS = `${FINANCE}/leave-requests`
const PROFILES = `${FINANCE}/leave-profiles`
const RECORDS = `${FINANCE}/leave-records`
const STAFF = `${FINANCE}/leave-staff`
const PERIODS = `${FINANCE}/payroll-periods`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

const lesson = (id: string, date: string, teacherId: string, extra: Json = {}) => ({
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
    ...extra,
  },
})
const teacher = (id: string, name: string, subjectId = 'mat') => ({
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
const SAMPLE = [
  teacher('t1', 'Selin Kaya'),
  teacher('t2', 'Murat Demir'),
  teacher('t3', 'Ayla Şen', 'fen'),
  {
    collection: 'classes' as const,
    id: 'c1',
    data: { id: 'c1', name: '9-A', grade: 9, section: 'A' },
  },
  // İstanbul 09.00 ve 10.00.
  lesson('l1', '2026-11-02T06:00:00.000Z', 't1'),
  lesson('l2', '2026-11-03T07:00:00.000Z', 't1'),
  lesson('l3', '2026-11-04T06:00:00.000Z', 't1', { cancelledAt: '2026-10-01T08:00:00.000Z' }),
  lesson('l5', '2026-11-02T06:10:00.000Z', 't2', { classId: 'c2' }),
  lesson('l6', '2026-11-09T06:00:00.000Z', 't1'),
]

describe('DOM-FIN-116: izin talebi ve onayı uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.182.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST',
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
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
  const key = () => ({ 'idempotency-key': randomUUID() })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.182.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(db, created.id, SAMPLE, FIXED_NOW)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  /** Adlı personel; öğretmen kaydı verilirse bağlanır. Kıdem başlangıcı açılır. */
  async function person(
    t: Tenant,
    role: Role,
    name: string,
    teacherId?: string,
    seniority = '2020-03-15',
  ) {
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
    if (seniority !== '')
      ok(
        await call('POST', PROFILES, t.admin, {
          membershipId: membership.id,
          seniorityStartDate: seniority,
        }),
        201,
      )
    return membership.id
  }
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))

  const body = (membershipId: string, extra: Json = {}) => ({
    membershipId,
    typeCode: 'annual',
    startDate: '2026-11-02',
    endDate: '2026-11-06',
    days: 5,
    ...extra,
  })
  const open = (cookie: string, payload: Json, headers: Record<string, string> = key()) =>
    call('POST', REQUESTS, cookie, payload, headers)
  const command = (
    cookie: string,
    req: Json,
    verb: 'approve' | 'reject' | 'cancel' | 'assign-substitutes',
    payload: Json = {},
    headers: Record<string, string> = key(),
  ) =>
    call('POST', `${REQUESTS}/${String(req.id)}/${verb}`, cookie, payload, {
      ...ifMatch(req.version),
      ...headers,
    })
  const approveReq = (cookie: string, req: Json, payload: Json = {}) =>
    command(cookie, req, 'approve', payload)
  const rejectReq = (cookie: string, req: Json, reason = 'Okulun yoğun dönemi') =>
    command(cookie, req, 'reject', { reason })
  const cancelReq = (cookie: string, req: Json, reason = 'Personel vazgeçti') =>
    command(cookie, req, 'cancel', { reason })
  const substitutes = (cookie: string, req: Json, list: Json[]) =>
    command(cookie, req, 'assign-substitutes', { substitutes: list })
  const listOf = async (cookie: string, query = '') => {
    const response = await get(`${REQUESTS}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }
  const rowsOf = async (institutionId: string) => ({
    requests: await db
      .select()
      .from(staffLeaveRequests)
      .where(eq(staffLeaveRequests.institutionId, institutionId)),
    lessons: await db
      .select()
      .from(staffLeaveRequestLessons)
      .where(eq(staffLeaveRequestLessons.institutionId, institutionId)),
    records: await db
      .select()
      .from(staffLeaveRecords)
      .where(eq(staffLeaveRecords.institutionId, institutionId)),
  })
  const auditOf = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  const lessonsOf = (data: Json) => data.lessons as Json[]
  async function lockMonth(cookie: string, month: string) {
    const year = ok(await get(`${PERIODS}?year=${month.slice(0, 4)}`, cookie)) as {
      months: { month: string; current: { inputsHash: string } | null }[]
    }
    const view = year.months.find((item) => item.month === month)
    assert.ok(view?.current)
    const response = await call(
      'POST',
      `${PERIODS}/${month}/approve`,
      cookie,
      {
        inputsHash: view.current.inputsHash,
      },
      key(),
    )
    assert.ok([200, 201].includes(response.statusCode), response.body)
  }

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    const fake = { id, version: 1 }
    assertError(await get(REQUESTS, null), 401)
    assertError(await get(`${REQUESTS}/${id}`, null), 401)
    assertError(
      await get(`${REQUESTS}/preview?membershipId=m&startDate=2026-11-02&endDate=2026-11-06`, null),
      401,
    )
    assertError(await call('POST', REQUESTS, null, {}, key()), 401)
    for (const verb of ['approve', 'reject', 'cancel', 'assign-substitutes'] as const)
      assertError(
        await call(
          'POST',
          `${REQUESTS}/${id}/${verb}`,
          null,
          {},
          { ...ifMatch(fake.version), ...key() },
        ),
        401,
      )
  })

  test('DOM-FIN-116: ön büro, öğretmen, veli ve öğrenci 403; modül kapalı 403; kayıt değişmez', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya', 't1')
    const req = ok(await open(t.admin, body(selin)), 201)
    const before = await rowsOf(t.id)
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(REQUESTS, cookie), 403)
      assertError(await get(`${REQUESTS}/${String(req.id)}`, cookie), 403)
      assertError(
        await get(
          `${REQUESTS}/preview?membershipId=${selin}&startDate=2026-11-02&endDate=2026-11-06`,
          cookie,
        ),
        403,
      )
      assertError(
        await open(
          cookie,
          body(selin, { startDate: '2026-12-01', endDate: '2026-12-01', days: 1 }),
        ),
        403,
      )
      assertError(await approveReq(cookie, req), 403)
      assertError(await rejectReq(cookie, req), 403)
      assertError(await cancelReq(cookie, req), 403)
      assertError(
        await substitutes(cookie, req, [{ lessonId: 'l1', substituteTeacherId: 't3' }]),
        403,
      )
    }
    assert.deepEqual(await rowsOf(t.id), before)
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(REQUESTS, closed.admin), 403, 'module_disabled')
    assertError(await open(closed.admin, body(selin)), 403, 'module_disabled')
  })

  test('DOM-FIN-116: önizleme etkilenen dersleri, yedek adaylarını, uyarıları ve bakiyeyi verir', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya', 't1')
    const preview = ok(
      await get(
        `${REQUESTS}/preview?membershipId=${selin}&startDate=2026-11-02&endDate=2026-11-06&typeCode=annual&days=5`,
        t.admin,
      ),
    )
    assert.equal(preview.ownTeacherId, 't1')
    assert.equal(preview.lessonCount, 2)
    assert.deepEqual(
      lessonsOf(preview).map((item) => [item.lessonId, item.className]),
      [
        ['l1', '9-A'],
        ['l2', '9-A'],
      ],
    )
    // Ada göre: t3 başka branştan, t2 l1 saatinde l5 dersinde. İzne çıkan t1 aday değil.
    assert.deepEqual(lessonsOf(preview)[0]?.candidateWarnings, [
      { teacherId: 't3', warnings: ['other_subject'] },
      { teacherId: 't2', warnings: ['busy'] },
    ])
    assert.deepEqual(
      (preview.teachers as Json[]).map((item) => item.id),
      ['t3', 't2'],
    )
    // 2020-03-15 kıdem: 5 × 14 + 20 = 90; 5 gün sonra 85.
    assert.equal(preview.balanceAfterDays, 85)
    assert.equal(preview.deductsFromAnnual, true)
    // Ön büro personelinde ders bağı yok.
    const desk = await person(t, 'onburo', 'Ön Büro')
    const deskPreview = ok(
      await get(
        `${REQUESTS}/preview?membershipId=${desk}&startDate=2026-11-02&endDate=2026-11-06`,
        t.admin,
      ),
    )
    assert.equal(deskPreview.ownTeacherId, null)
    assert.deepEqual(deskPreview.lessons, [])
    assert.equal(deskPreview.balanceAfterDays, null)
    assertError(
      await get(
        `${REQUESTS}/preview?membershipId=${selin}&startDate=2026-11-06&endDate=2026-11-02`,
        t.admin,
      ),
      400,
    )
    assertError(
      await get(
        `${REQUESTS}/preview?membershipId=yok&startDate=2026-11-02&endDate=2026-11-06`,
        t.admin,
      ),
      404,
    )
  })

  test('DOM-FIN-116: talep açılır, dersler kopyalanır, yedek seçilir; çift gönderim tek talep', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya', 't1')
    const headers = key()
    const payload = body(selin, {
      description: 'Aile ziyareti',
      substitutes: [{ lessonId: 'l1', substituteTeacherId: 't2' }],
    })
    const response = await open(t.admin, payload, headers)
    const req = ok(response, 201)
    assert.equal(response.headers.location, `${REQUESTS}/${String(req.id)}`)
    assert.equal(req.status, 'pending')
    assert.equal(req.name, 'Selin Kaya')
    assert.equal(req.typeLabel, 'Yıllık ücretli izin')
    assert.equal(req.balanceAfterDays, 85)
    assert.equal(req.lessonCount, 2)
    assert.equal(req.substitutedCount, 1)
    const [first, second] = lessonsOf(req)
    assert.equal(first?.substituteName, 'Murat Demir')
    assert.deepEqual(first?.substituteWarnings, ['busy'])
    assert.equal(second?.substituteTeacherId, null)
    const replay = await open(t.admin, payload, headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    const rows = await rowsOf(t.id)
    assert.equal(rows.requests.length, 1)
    assert.equal(rows.lessons.length, 2)
    assert.equal(rows.records.length, 0)
    const [audit] = await auditOf(t.id, 'finance.staff_leave_request.create')
    assert.ok(audit)
    assert.equal(JSON.stringify(audit.changes).includes('Aile ziyareti'), false)
    assert.deepEqual(
      (await listOf(t.admin, '?status=pending')).data.map((item) => item.id),
      [req.id],
    )
    assert.equal((await listOf(t.admin, '?status=approved')).meta.total, 0)
    assert.equal((await listOf(t.admin, '?q=selin')).meta.total, 1)
    assert.equal((await listOf(t.admin, '?from=2026-11-07')).meta.total, 0)
    assert.deepEqual(ok(await get(`${REQUESTS}/${String(req.id)}`, t.admin)).id, req.id)
  })

  test('DOM-FIN-116: geçersiz talep 400/422 ve kayıt değişmez; çakışan talep açılmaz', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya', 't1')
    assertError(await open(t.admin, body(selin), {}), 400)
    assertError(await open(t.admin, body(selin, { days: 2.5 })), 400)
    assertError(await open(t.admin, body(selin, { endDate: '2026-11-01' })), 400)
    assertError(
      await open(t.admin, body(selin, { typeCode: 'sick' })),
      422,
      'staff_leave_sick_not_manual',
    )
    assertError(await open(t.admin, body(selin, { days: 6 })), 422, 'staff_leave_days_exceed_range')
    assertError(
      await open(
        t.admin,
        body(selin, { substitutes: [{ lessonId: 'l6', substituteTeacherId: 't2' }] }),
      ),
      422,
      'staff_leave_lesson_not_affected',
    )
    assertError(
      await open(
        t.admin,
        body(selin, { substitutes: [{ lessonId: 'l1', substituteTeacherId: 't1' }] }),
      ),
      422,
      'staff_leave_substitute_self',
    )
    assertError(
      await open(
        t.admin,
        body(selin, { substitutes: [{ lessonId: 'l1', substituteTeacherId: 'yok' }] }),
      ),
      422,
      'staff_leave_substitute_not_found',
    )
    const unprofiled = await person(t, 'onburo', 'Profilsiz', undefined, '')
    assertError(await open(t.admin, body(unprofiled)), 422, 'staff_leave_profile_required')
    assert.equal((await rowsOf(t.id)).requests.length, 0)
    ok(await open(t.admin, body(selin)), 201)
    assertError(
      await open(t.admin, body(selin, { startDate: '2026-11-06', endDate: '2026-11-09', days: 2 })),
      422,
      'staff_leave_request_overlap',
    )
    ok(
      await call(
        'POST',
        RECORDS,
        t.admin,
        {
          membershipId: selin,
          typeCode: 'annual',
          startDate: '2026-12-07',
          endDate: '2026-12-07',
          days: 1,
        },
        key(),
      ),
      201,
    )
    assertError(
      await open(t.admin, body(selin, { startDate: '2026-12-07', endDate: '2026-12-08', days: 2 })),
      422,
      'staff_leave_overlap',
    )
    assert.equal((await rowsOf(t.id)).requests.length, 1)
  })

  test('DOM-FIN-116: onay kullanılmış izin kaydı üretir; kayıt elle iptal edilmez; çift onay olmaz', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya', 't1')
    const req = ok(await open(t.admin, body(selin)), 201)
    const headers = key()
    const approved = ok(await command(t.admin, req, 'approve', {}, headers))
    assert.equal(approved.status, 'approved')
    assert.equal(approved.advanceApproved, false)
    assert.equal(approved.balanceAfterDays, null)
    const replay = await command(t.admin, req, 'approve', {}, headers)
    assert.equal(replay.statusCode, 200)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    const rows = await rowsOf(t.id)
    assert.equal(rows.records.length, 1)
    assert.equal(rows.records[0]?.requestId, req.id)
    assert.equal(rows.records[0]?.days, 5)
    const detail = ok(await get(`${STAFF}/${selin}?date=2026-11-10`, t.admin))
    const records = detail.records as Json[]
    assert.equal(records[0]?.requestId, req.id)
    assert.equal((detail.entitlement as Json).balanceDays, 85)
    assertError(
      await call(
        'POST',
        `${RECORDS}/${String(records[0]?.id)}/cancel`,
        t.admin,
        { reason: 'Yanlış kayıt' },
        ifMatch(records[0]?.version),
      ),
      422,
      'staff_leave_record_from_request',
    )
    assertError(await approveReq(t.admin, approved), 422, 'staff_leave_request_not_pending')
    assertError(await rejectReq(t.admin, approved), 422, 'staff_leave_request_not_pending')
    assertError(await approveReq(t.admin, req), 409)
    assert.equal((await auditOf(t.id, 'finance.staff_leave_request.approve')).length, 1)
    assert.equal((await rowsOf(t.id)).records.length, 1)
  })

  test('DOM-FIN-116: yetersiz bakiyede onay 422, avans izin işaretiyle onaylanır', async () => {
    const t = await institution()
    // 2025-03-15 kıdem: 2026-03-15'te 14 gün; 3 gün kullanılmış.
    const new1 = await person(t, 'onburo', 'Yeni Personel', undefined, '2025-03-15')
    ok(
      await call(
        'POST',
        RECORDS,
        t.admin,
        {
          membershipId: new1,
          typeCode: 'annual',
          startDate: '2026-06-01',
          endDate: '2026-06-03',
          days: 3,
        },
        key(),
      ),
      201,
    )
    const req = ok(
      await open(t.admin, body(new1, { startDate: '2026-11-02', endDate: '2026-11-16', days: 12 })),
      201,
    )
    assert.equal(req.balanceAfterDays, -1)
    assertError(await approveReq(t.admin, req), 422, 'staff_leave_balance_insufficient')
    assert.equal((await rowsOf(t.id)).records.length, 1)
    const approved = ok(await approveReq(t.admin, req, { allowAdvance: true }))
    assert.equal(approved.advanceApproved, true)
    assert.equal((await rowsOf(t.id)).records.length, 2)
  })

  test('DOM-FIN-116: ret gerekçeli; reddedilen talep iptal edilmez ve çakışma sayılmaz', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya', 't1')
    const req = ok(await open(t.admin, body(selin)), 201)
    assertError(await rejectReq(t.admin, req, 'kısa'), 400)
    const rejected = ok(await rejectReq(t.admin, req))
    assert.equal(rejected.status, 'rejected')
    assert.equal(rejected.rejectReason, 'Okulun yoğun dönemi')
    assert.ok(rejected.decidedAt)
    assertError(await cancelReq(t.admin, rejected), 422, 'staff_leave_request_closed')
    assertError(
      await substitutes(t.admin, rejected, [{ lessonId: 'l1', substituteTeacherId: 't2' }]),
      422,
      'staff_leave_request_closed',
    )
    ok(await open(t.admin, body(selin)), 201)
    const [audit] = await auditOf(t.id, 'finance.staff_leave_request.reject')
    assert.equal(JSON.stringify(audit?.changes).includes('yoğun'), false)
  })

  test('DOM-FIN-116: bekleyen talep geri çekilir; onaylı talebin iptali kaydı da iptal eder', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya', 't1')
    const pending = ok(await open(t.admin, body(selin)), 201)
    const withdrawn = ok(await cancelReq(t.admin, pending))
    assert.equal(withdrawn.status, 'cancelled')
    assert.equal(withdrawn.decidedAt, null)
    const req = ok(await open(t.admin, body(selin)), 201)
    const approved = ok(await approveReq(t.admin, req))
    const cancelled = ok(await cancelReq(t.admin, approved, 'Okul etkinliği nedeniyle ertelendi'))
    assert.equal(cancelled.status, 'cancelled')
    const records = (await rowsOf(t.id)).records
    assert.equal(records.length, 1)
    assert.ok(records[0]?.archivedAt)
    assert.equal(records[0]?.cancelReason, 'Okul etkinliği nedeniyle ertelendi')
    const detail = ok(await get(`${STAFF}/${selin}?date=2026-11-10`, t.admin))
    assert.deepEqual(detail.records, [])
    assert.equal((await auditOf(t.id, 'finance.staff_leave_record.cancel')).length, 1)
    // Aynı aralık yeniden talep edilebilir.
    ok(await open(t.admin, body(selin)), 201)
  })

  test('DOM-FIN-116: onaylı bordro ayına düşen onay ve iptal 409 payroll_period_locked', async () => {
    const t = await institution()
    const desk = await person(t, 'onburo', 'Ön Büro')
    const september = body(desk, { startDate: '2026-09-14', endDate: '2026-09-15', days: 2 })
    const early = ok(await open(t.admin, september), 201)
    const approvedEarly = ok(await approveReq(t.admin, early))
    const late = ok(
      await open(t.admin, body(desk, { startDate: '2026-09-28', endDate: '2026-10-02', days: 5 })),
      201,
    )
    await lockMonth(t.admin, '2026-09')
    const before = await rowsOf(t.id)
    assertError(await approveReq(t.admin, late), 409, 'payroll_period_locked')
    assertError(await cancelReq(t.admin, approvedEarly), 409, 'payroll_period_locked')
    assert.deepEqual(await rowsOf(t.id), before)
    // Bekleyen talep kilitli ayda da geri çekilir ve reddedilir.
    ok(await rejectReq(t.admin, late))
  })

  test('DOM-FIN-116: yedek öğretmen değiştirilir ve kaldırılır; eski sürüm 409', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya', 't1')
    const req = ok(await open(t.admin, body(selin)), 201)
    const updated = ok(
      await substitutes(t.admin, req, [
        { lessonId: 'l1', substituteTeacherId: 't3' },
        { lessonId: 'l2', substituteTeacherId: 't2' },
      ]),
    )
    assert.equal(updated.substitutedCount, 2)
    assert.deepEqual(lessonsOf(updated)[0]?.substituteWarnings, ['other_subject'])
    assertError(
      await substitutes(t.admin, req, [{ lessonId: 'l1', substituteTeacherId: null }]),
      409,
    )
    assertError(
      await substitutes(t.admin, updated, [{ lessonId: 'l1', substituteTeacherId: 't3' }]),
      422,
      'staff_leave_substitutes_unchanged',
    )
    const approved = ok(await approveReq(t.admin, updated))
    const cleared = ok(
      await substitutes(t.admin, approved, [{ lessonId: 'l1', substituteTeacherId: null }]),
    )
    assert.equal(cleared.substitutedCount, 1)
    assert.equal(cleared.status, 'approved')
  })

  test('DOM-FIN-116: başka kurumun talebi 404 ve B değişmez; listede yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bStaff = await person(b, 'ogretmen', 'Beta Öğretmen', 't1')
    const bRequest = ok(await open(b.admin, body(bStaff)), 201)
    const bBefore = await rowsOf(b.id)

    assertError(await get(`${REQUESTS}/${String(bRequest.id)}`, a.admin), 404)
    assertError(
      await get(
        `${REQUESTS}/preview?membershipId=${bStaff}&startDate=2026-11-02&endDate=2026-11-06`,
        a.admin,
      ),
      404,
    )
    assertError(await approveReq(a.admin, bRequest), 404)
    assertError(await rejectReq(a.admin, bRequest), 404)
    assertError(await cancelReq(a.admin, bRequest), 404)
    assertError(
      await substitutes(a.admin, bRequest, [{ lessonId: 'l1', substituteTeacherId: 't2' }]),
      404,
    )
    assert.equal(
      (await listOf(a.admin)).data.some((item) => item.id === bRequest.id),
      false,
    )
    assertError(await open(a.admin, body(bStaff)), 422, 'staff_leave_staff_not_found')
    assertError(await open(a.admin, { ...body(bStaff), institutionId: b.id }), 400)
    assert.deepEqual(await rowsOf(b.id), bBefore)
    assert.equal((await rowsOf(a.id)).requests.length, 0)
  })
})
