import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  healthScreeningNotifications,
  healthScreeningResults,
  healthScreeningSessions,
} from '../src/db/schema/finance-health-screenings.ts'
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
 * Okul sağlığı taraması uçları (DOM-FIN-153; ON-163; K-514…K-516). Her test kendi kurumunu kurar.
 * FIXED_NOW 2026-10-06T09:00Z (Europe/Istanbul 12:00).
 */

const SCREENINGS = '/api/v1/finance/health-screenings'
const STAFF = '/api/v1/finance/health-screening-staff'
const CLASSES = '/api/v1/finance/health-screening-classes'
const MY_RESULTS = '/api/v1/finance/health-screening-results'
const SECRET_NOTE = 'Sağ gözde kayma şüphesi'

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-153: okul sağlığı taraması uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.163.0.1'

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
  const post = (url: string, cookie: string | null, body: unknown, key = randomUUID()) =>
    call('POST', url, cookie, body, { 'idempotency-key': key })
  const versioned = (
    method: 'POST' | 'PATCH',
    url: string,
    cookie: string,
    body: unknown,
    version: unknown,
  ) => call(method, url, cookie, body, { 'if-match': `"${String(version)}"` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  /**
   * Kurum: 9-A'da s-1 (Deniz; velisi `mother`) … s-6, pasif s-9; 9-B'de s-7 (Ece; velisi `other`);
   * 10-A'da s-8.
   */
  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.163.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    const student = (id: string, name: string, classId: string, isActive = true) => ({
      collection: 'students' as const,
      id,
      data: { id, name, classId, isActive },
    })
    const klass = (id: string) => ({
      collection: 'classes' as const,
      id,
      data: { id, name: id, grade: Number(id.split('-')[0]), branchId: 'b-1', teacherId: 't-1' },
    })
    await insertMissingRecords(
      db,
      created.id,
      [
        klass('9-A'),
        klass('9-B'),
        klass('10-A'),
        student('s-1', 'Deniz Yılmaz', '9-A'),
        student('s-2', 'Arda Kaya', '9-A'),
        student('s-3', 'Bora Demir', '9-A'),
        student('s-4', 'Cem Aydın', '9-A'),
        student('s-5', 'Duru Şahin', '9-A'),
        student('s-6', 'Eda Çelik', '9-A'),
        student('s-7', 'Ece Yılmaz', '9-B'),
        student('s-8', 'Fırat Koç', '10-A'),
        student('s-9', 'Gül Ak', '9-A', false),
      ],
      FIXED_NOW,
    )
    const teacher = await createMember(app, created.id, 'ogretmen')
    const desk = await createMember(app, created.id, 'onburo')
    const mother = await createMember(app, created.id, 'veli', [{ kind: 'child', recordId: 's-1' }])
    const other = await createMember(app, created.id, 'veli', [{ kind: 'child', recordId: 's-7' }])
    return {
      id: created.id,
      adminMembershipId: created.adminMembershipId,
      admin: await signInAs(app, created.admin),
      teacher: { ...teacher, cookie: await signInAs(app, teacher) },
      desk: { ...desk, cookie: await signInAs(app, desk) },
      mother: await signInAs(app, mother),
      other: await signInAs(app, other),
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  const screeningBody = (extra: Json = {}) => ({
    kind: 'growth',
    screenedOn: '2026-10-06',
    classIds: ['9-A', '9-B'],
    performer: { kind: 'external', name: 'ASM hemşiresi Ayşe K.' },
    thresholds: { bmiBelow: 14, bmiAbove: 25 },
    ...extra,
  })
  const url = (id: unknown) => `${SCREENINGS}/${String(id)}`
  const growth = (heightCm: number, weightKg: number) => ({
    outcome: 'screened',
    measurement: { heightCm, weightKg },
  })
  const audits = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  const sessionRows = (institutionId: string) =>
    db
      .select()
      .from(healthScreeningSessions)
      .where(eq(healthScreeningSessions.institutionId, institutionId))
  const resultRows = (institutionId: string) =>
    db
      .select()
      .from(healthScreeningResults)
      .where(eq(healthScreeningResults.institutionId, institutionId))
  const notificationRows = (institutionId: string) =>
    db
      .select()
      .from(healthScreeningNotifications)
      .where(eq(healthScreeningNotifications.institutionId, institutionId))
  async function openScreening(t: Tenant, extra: Json = {}, cookie = t.desk.cookie) {
    return ok(await post(SCREENINGS, cookie, screeningBody(extra)), 201)
  }
  const record = (t: Tenant, id: unknown, results: Json[], cookie = t.desk.cookie) =>
    post(`${url(id)}/results`, cookie, { results })
  const publish = (id: unknown, cookie: string, version: unknown) =>
    versioned('POST', `${url(id)}/publish`, cookie, {}, version)

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    for (const path of [SCREENINGS, url(id), `${url(id)}/report`, STAFF, CLASSES, MY_RESULTS])
      assertError(await get(path, null), 401)
    assertError(await post(SCREENINGS, null, {}), 401)
    assertError(await call('PATCH', url(id), null, {}), 401)
    assertError(await post(`${url(id)}/results`, null, {}), 401)
    assertError(await post(`${url(id)}/publish`, null, {}), 401)
  })

  test('DOM-FIN-153: rol matrisi; öğretmen, veli ve öğrenci okul uçlarında 403; veli ucu yalnız veliye; modül kapalı 403 (K-516)', async () => {
    const t = await institution()
    const student = await signInAs(app, await createMember(app, t.id, 'ogrenci'))
    const created = await openScreening(t)
    for (const cookie of [t.teacher.cookie, t.mother, student]) {
      assertError(await get(SCREENINGS, cookie), 403)
      assertError(await post(SCREENINGS, cookie, screeningBody()), 403)
      assertError(await get(url(created.id), cookie), 403)
      assertError(await get(`${url(created.id)}/report`, cookie), 403)
      assertError(
        await record(t, created.id, [{ studentId: 's-1', outcome: 'absent' }], cookie),
        403,
      )
      assertError(await publish(created.id, cookie, created.version), 403)
      assertError(await get(STAFF, cookie), 403)
      assertError(await get(CLASSES, cookie), 403)
    }
    for (const cookie of [t.admin, t.desk.cookie, t.teacher.cookie, student])
      assertError(await get(MY_RESULTS, cookie), 403)
    ok(await get(SCREENINGS, t.admin))
    ok(await get(MY_RESULTS, t.mother))
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(SCREENINGS, closed.admin), 403, 'module_disabled')
    assertError(await get(MY_RESULTS, closed.mother), 403, 'module_disabled')
  })

  test('DOM-FIN-153: oturum açma, doğrulama, mükerrer istek, düzeltme ve sürüm (K-514)', async () => {
    const t = await institution()
    assertError(await post(SCREENINGS, t.desk.cookie, screeningBody({ allergies: 'x' })), 400)
    assertError(await post(SCREENINGS, t.desk.cookie, screeningBody({ kind: 'hearing' })), 400)
    assertError(await call('POST', SCREENINGS, t.desk.cookie, screeningBody()), 400)
    assertError(
      await post(SCREENINGS, t.desk.cookie, screeningBody({ classIds: ['9-A', '12-Z'] })),
      422,
      'health_screening_class_not_found',
    )
    assertError(
      await post(SCREENINGS, t.desk.cookie, screeningBody({ screenedOn: '2027-03-01' })),
      422,
      'health_screening_date_too_far',
    )
    assertError(
      await post(
        SCREENINGS,
        t.desk.cookie,
        screeningBody({ performer: { kind: 'staff', membershipId: 'nope' } }),
      ),
      422,
      'health_screening_performer_not_found',
    )
    assert.equal((await sessionRows(t.id)).length, 0)

    const key = randomUUID()
    const body = screeningBody({
      performer: { kind: 'staff', membershipId: t.teacher.membershipId },
    })
    const first = await post(SCREENINGS, t.desk.cookie, body, key)
    const created = ok(first, 201)
    assert.equal(first.headers.location, url(created.id))
    assert.equal(created.status, 'open')
    assert.deepEqual(created.classes, [
      { id: '9-A', name: '9-A' },
      { id: '9-B', name: '9-B' },
    ])
    assert.equal((created.performer as Json).kind, 'staff')
    assert.equal(typeof (created.performer as Json).name, 'string')
    assert.deepEqual(created.thresholds, { bmiBelow: 14, bmiAbove: 25 })
    const replay = await post(SCREENINGS, t.desk.cookie, body, key)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(replay.json().data.id, created.id)
    assert.equal((await sessionRows(t.id)).length, 1)
    const [creation] = await audits(t.id, 'finance.health_screening.create')
    assert.deepEqual((creation?.changes as { fields: string[] }).fields, [
      'kind',
      'screenedOn',
      'classIds',
      'performer',
      'thresholds',
    ])

    const patch = (value: Json, version: unknown) =>
      versioned('PATCH', url(created.id), t.desk.cookie, value, version)
    assertError(
      await call('PATCH', url(created.id), t.desk.cookie, { screenedOn: '2026-10-05' }),
      400,
      'if_match_required',
    )
    assertError(await patch({ screenedOn: '2026-10-05' }, 9), 409, 'version_conflict')
    assertError(
      await patch({ thresholds: { acuityBelow: 0.8 } }, created.version),
      422,
      'health_screening_thresholds_kind',
    )
    const updated = ok(
      await patch(
        { screenedOn: '2026-10-05', performer: { kind: 'external', name: 'ASM' } },
        created.version,
      ),
    )
    assert.equal(updated.screenedOn, '2026-10-05')
    assert.equal(updated.version, 2)
    const [change] = await audits(t.id, 'finance.health_screening.update')
    assert.deepEqual((change?.changes as { fields: string[] }).fields, ['screenedOn', 'performer'])
    const list = (await get(SCREENINGS, t.admin)).json()
    assert.equal(list.meta.total, 1)
    assert.equal(list.data[0].resultCount, 0)
  })

  test('DOM-FIN-153: sonuç girişi şifreli, eşik işareti, öğrenci başına tek sonuç ve düzeltme (K-514)', async () => {
    const t = await institution()
    const created = await openScreening(t)
    const future = await openScreening(t, { screenedOn: '2026-10-07' })
    assertError(
      await record(t, future.id, [{ studentId: 's-1', outcome: 'absent' }]),
      422,
      'health_screening_not_started',
    )
    assertError(
      await record(t, created.id, [{ studentId: 's-8', outcome: 'absent' }]),
      422,
      'health_screening_student_not_in_classes',
    )
    assertError(
      await record(t, created.id, [{ studentId: 's-9', outcome: 'absent' }]),
      422,
      'health_screening_student_not_found',
    )
    assertError(
      await record(t, created.id, [
        { studentId: 's-1', ...growth(150, 30) },
        {
          studentId: 's-2',
          outcome: 'screened',
          measurement: { rightAcuity: 1, leftAcuity: 1, wearsGlasses: false },
        },
      ]),
      422,
      'health_screening_measurement_kind',
    )
    assertError(await record(t, created.id, [{ studentId: 's-1', ...growth(150.25, 30) }]), 400)
    assert.equal((await resultRows(t.id)).length, 0, 'başarısız istek hiçbir sonucu yazmaz')

    const entered = ok(
      await record(t, created.id, [
        { studentId: 's-1', ...growth(150, 30), note: SECRET_NOTE },
        { studentId: 's-2', ...growth(150, 45) },
        { studentId: 's-7', outcome: 'absent' },
      ]),
    )
    assert.deepEqual([entered.created, entered.updated, entered.unchanged], [3, 0, 0])
    assert.equal((entered.session as Json).resultCount, 3)
    assert.equal(JSON.stringify(entered).includes(SECRET_NOTE), false, 'yazma yanıtı ölçüm taşımaz')
    assertError(
      await record(t, created.id, [{ studentId: 's-1', outcome: 'absent' }]),
      409,
      'health_screening_result_exists',
    )

    const rows = await resultRows(t.id)
    assert.equal(rows.length, 3)
    const raw = JSON.stringify(rows)
    assert.equal(raw.includes(SECRET_NOTE), false)
    assert.equal(raw.includes('1500'), false)
    assert.equal(rows.find((row) => row.studentId === 's-1')?.referralRecommended, true)
    assert.equal(rows.find((row) => row.studentId === 's-2')?.referralRecommended, false)
    for (const action of ['finance.health_screening.result_create']) {
      const entries = await audits(t.id, action)
      assert.equal(entries.length, 3)
      assert.equal(JSON.stringify(entries).includes(SECRET_NOTE), false)
    }

    const detail = ok(await get(url(created.id), t.admin))
    const students = detail.students as Json[]
    assert.deepEqual(
      students.map((row) => row.studentId),
      ['s-2', 's-3', 's-4', 's-1', 's-5', 's-6', 's-7'],
    )
    const deniz = students.find((row) => row.studentId === 's-1')?.result as Json
    assert.deepEqual(deniz.measurement, { kind: 'growth', heightCm: 150, weightKg: 30, bmi: 13.3 })
    assert.equal(deniz.thresholdExceeded, true)
    assert.equal(deniz.referralRecommended, true)
    assert.equal(deniz.note, SECRET_NOTE)
    assert.equal(deniz.notificationStatus, null)
    assert.equal(students.find((row) => row.studentId === 's-3')?.result, null)
    const [read] = await audits(t.id, 'finance.health_screening.read')
    assert.deepEqual((read?.changes as { fields: string[] }).fields, [
      'students',
      'outcome',
      'measurement',
      'referralRecommended',
      'note',
    ])
    assert.equal(JSON.stringify(read).includes(SECRET_NOTE), false)

    // Düzeltme sürümle; aynısı yazılmaz; eski sürüm 409.
    const corrected = ok(
      await record(t, created.id, [
        { studentId: 's-1', expectedVersion: deniz.version, ...growth(150, 40), note: null },
        { studentId: 's-7', expectedVersion: 1, outcome: 'absent' },
      ]),
    )
    assert.deepEqual([corrected.created, corrected.updated, corrected.unchanged], [0, 1, 1])
    assertError(
      await record(t, created.id, [{ studentId: 's-1', expectedVersion: 1, outcome: 'absent' }]),
      409,
      'version_conflict',
    )
    const [fixed] = (await resultRows(t.id)).filter((row) => row.studentId === 's-1')
    assert.equal(fixed?.version, 2)
    assert.equal(fixed?.referralRecommended, false)
    assert.equal((await audits(t.id, 'finance.health_screening.result_update')).length, 1)
    assertError(
      await versioned(
        'PATCH',
        url(created.id),
        t.desk.cookie,
        { thresholds: { bmiBelow: 13, bmiAbove: 25 } },
        created.version,
      ),
      422,
      'health_screening_thresholds_locked',
    )
    assertError(
      await versioned(
        'PATCH',
        url(created.id),
        t.desk.cookie,
        { classIds: ['9-A'] },
        created.version,
      ),
      422,
      'health_screening_class_has_results',
    )
  })

  test('DOM-FIN-153: yayımlama, gönderilecek bildirim kaydı, değişmezlik ve veli görünümü (K-515)', async () => {
    const t = await institution()
    const created = await openScreening(t)
    assertError(
      await publish(created.id, t.desk.cookie, created.version),
      422,
      'health_screening_no_results',
    )
    ok(
      await record(t, created.id, [
        { studentId: 's-1', ...growth(150, 30), note: SECRET_NOTE },
        { studentId: 's-7', ...growth(140, 40) },
      ]),
    )
    assert.equal(
      (await get(MY_RESULTS, t.mother)).json().meta.total,
      0,
      'açık tarama veliye kapalı',
    )
    assertError(await publish(created.id, t.desk.cookie, 7), 409, 'version_conflict')
    const published = ok(await publish(created.id, t.desk.cookie, created.version))
    assert.equal(published.status, 'published')
    assert.equal(published.notificationCount, 1)
    const notifications = await notificationRows(t.id)
    assert.deepEqual(
      notifications.map((row) => [row.studentId, row.status]),
      [['s-1', 'pending']],
    )
    assertError(
      await publish(created.id, t.desk.cookie, published.version),
      409,
      'health_screening_published',
    )
    assertError(
      await record(t, created.id, [{ studentId: 's-2', outcome: 'absent' }]),
      409,
      'health_screening_published',
    )
    assertError(
      await versioned(
        'PATCH',
        url(created.id),
        t.desk.cookie,
        { screenedOn: '2026-10-05' },
        published.version,
      ),
      409,
      'health_screening_published',
    )
    await assert.rejects(
      db.execute(
        sql`update health_screening_results set outcome = 'absent', referral_recommended = false where institution_id = ${t.id}`,
      ),
    )
    await assert.rejects(
      db.execute(
        sql`update health_screening_sessions set screened_on = '2026-10-01' where institution_id = ${t.id}`,
      ),
    )
    await assert.rejects(
      db.execute(sql`delete from health_screening_notifications where institution_id = ${t.id}`),
    )

    const mine = (await get(MY_RESULTS, t.mother)).json()
    assert.equal(mine.meta.total, 1)
    assert.deepEqual(mine.data[0].measurement, {
      kind: 'growth',
      heightCm: 150,
      weightKg: 30,
      bmi: 13.3,
    })
    assert.equal(mine.data[0].studentId, 's-1')
    assert.equal(mine.data[0].referralRecommended, true)
    assert.equal(mine.data[0].note, SECRET_NOTE)
    assert.equal(mine.data[0].notificationStatus, 'pending')
    assert.equal(mine.data[0].performerName, 'ASM hemşiresi Ayşe K.')
    assert.equal('thresholds' in mine.data[0], false)
    const others = (await get(MY_RESULTS, t.other)).json()
    assert.deepEqual(
      others.data.map((row: Json) => [
        row.studentId,
        row.referralRecommended,
        row.notificationStatus,
      ]),
      [['s-7', false, null]],
    )
    assert.equal((await get(`${MY_RESULTS}?studentId=s-7`, t.mother)).json().meta.total, 0)
    const guardianReads = await audits(t.id, 'finance.health_screening.guardian_read')
    assert.equal(guardianReads.length, 2)
    assert.equal(JSON.stringify(guardianReads).includes(SECRET_NOTE), false)
  })

  test('DOM-FIN-153: sınıf raporu katılımı sayar, küçük grupta öneriyi gizler (K-516)', async () => {
    const t = await institution()
    const created = await openScreening(t)
    ok(
      await record(t, created.id, [
        { studentId: 's-1', ...growth(150, 30) },
        { studentId: 's-2', ...growth(150, 45) },
        { studentId: 's-3', ...growth(150, 45) },
        { studentId: 's-4', ...growth(150, 45) },
        { studentId: 's-5', ...growth(150, 45) },
        { studentId: 's-6', outcome: 'refused' },
        { studentId: 's-7', ...growth(140, 60) },
      ]),
    )
    const report = ok(await get(`${url(created.id)}/report`, t.desk.cookie))
    const [a, b] = report.classes as Json[]
    assert.deepEqual(a, {
      classId: '9-A',
      className: '9-A',
      roster: 6,
      screened: 5,
      absent: 0,
      refused: 1,
      missing: 0,
      referral: null,
      referralSuppressed: true,
    })
    assert.equal(b?.screened, 1)
    assert.equal(b?.referral, null)
    assert.equal((report.total as Json).screened, 6)
    assert.equal((report.total as Json).referral, null)

    // Deniz'in ölçümü düzeltilince 9-A'da öneri kalmaz; 0 gösterilir.
    const detail = ok(await get(url(created.id), t.desk.cookie))
    const deniz = (detail.students as Json[]).find((row) => row.studentId === 's-1')?.result as Json
    ok(
      await record(t, created.id, [
        { studentId: 's-1', expectedVersion: deniz.version, ...growth(150, 45) },
      ]),
    )
    const after = ok(await get(`${url(created.id)}/report`, t.desk.cookie))
    assert.equal((after.classes as Json[])[0]?.referral, 0)
    const classes = (await get(CLASSES, t.desk.cookie)).json()
    assert.deepEqual(
      classes.data.map((row: Json) => [row.id, row.studentCount]),
      [
        ['9-A', 6],
        ['9-B', 1],
        ['10-A', 1],
      ],
    )
  })

  test('DOM-FIN-153: başka kurumun taraması 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bScreening = await openScreening(b)
    ok(await record(b, bScreening.id, [{ studentId: 's-1', ...growth(150, 45) }]))
    const bUrl = url(bScreening.id)
    assertError(await get(bUrl, a.admin), 404)
    assertError(await get(`${bUrl}/report`, a.admin), 404)
    assertError(
      await versioned('PATCH', bUrl, a.admin, { screenedOn: '2026-10-05' }, bScreening.version),
      404,
    )
    assertError(
      await record(a, bScreening.id, [{ studentId: 's-2', outcome: 'absent' }], a.admin),
      404,
    )
    assertError(await publish(bScreening.id, a.admin, bScreening.version), 404)
    assert.equal((await get(SCREENINGS, a.admin)).json().meta.total, 0)
    assert.equal((await get(MY_RESULTS, a.mother)).json().meta.total, 0)
    const aStaff = (await get(`${STAFF}?pageSize=100`, a.admin)).json()
    assert.ok(!aStaff.data.some((row: Json) => row.membershipId === b.desk.membershipId))
    assert.equal((await get(CLASSES, a.admin)).json().meta.total, 3)
    assertError(await post(SCREENINGS, a.admin, screeningBody({ institutionId: b.id })), 400)
    assertError(
      await post(
        SCREENINGS,
        a.admin,
        screeningBody({ performer: { kind: 'staff', membershipId: b.desk.membershipId } }),
      ),
      422,
      'health_screening_performer_not_found',
    )
    const [bSession] = await sessionRows(b.id)
    assert.equal(bSession?.status, 'open')
    assert.equal(bSession?.version, 1)
    assert.equal((await resultRows(b.id)).length, 1)
    assert.equal((await sessionRows(a.id)).length, 0)
  })
})
