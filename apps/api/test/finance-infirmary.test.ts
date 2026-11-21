import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  infirmaryMedicationAdministrations,
  infirmaryMedicationConsents,
  infirmaryVisits,
} from '../src/db/schema/finance-infirmary.ts'
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
 * Revir ve ilaç onayı uçları (DOM-FIN-151; ON-101; IST-102; K-508…K-510). Her test kendi kurumunu
 * kurar. FIXED_NOW 2026-10-06T09:00Z (Europe/Istanbul 12:00).
 */

const BASE = '/api/v1/finance/infirmary'
const VISITS = `${BASE}/visits`
const CONSENTS = `${BASE}/medication-consents`
const STATES = `${BASE}/visit-states`
const MY_VISITS = `${BASE}/my-visits`
const SCHEDULE = `${BASE}/medication-schedule`
const STAFF = `${BASE}/staff`
const SECRETS = ['Karın ağrısı', 'Sıcak su', 'Parol', '5 ml', 'Tok karnına', 'Doktor raporu']

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-151: revir ve ilaç onayı uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.101.0.1'

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
   * Kurum: Deniz (`s-1`, 9-A) annesi `mother`; Ece (`s-2`, 9-B) velisi `other`. `teacher` 9-A'nın
   * sınıf öğretmeni, 9-B'ye yalnız derse girer; `outsider` hiçbir sınıfın öğretmeni değil.
   */
  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.101.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      created.id,
      [
        {
          collection: 'teachers' as const,
          id: 't-1',
          data: { id: 't-1', name: 'Selin Kaya', subjectId: 'mat', branchId: 'b-1' },
        },
        {
          collection: 'teachers' as const,
          id: 't-2',
          data: { id: 't-2', name: 'Can Demir', subjectId: 'fen', branchId: 'b-1' },
        },
        {
          collection: 'classes' as const,
          id: '9-A',
          data: { id: '9-A', grade: 9, level: 'lise', branchId: 'b-1', teacherId: 't-1' },
        },
        {
          collection: 'classes' as const,
          id: '9-B',
          data: { id: '9-B', grade: 9, level: 'lise', branchId: 'b-1', teacherId: 't-2' },
        },
        {
          collection: 'assignments' as const,
          id: 'as-1',
          data: { id: 'as-1', classId: '9-B', teacherId: 't-1', subjectId: 'mat' },
        },
        {
          collection: 'students' as const,
          id: 's-1',
          data: { id: 's-1', name: 'Deniz Yılmaz', classId: '9-A', isActive: true },
        },
        {
          collection: 'students' as const,
          id: 's-2',
          data: { id: 's-2', name: 'Ece Yılmaz', classId: '9-B', isActive: true },
        },
      ],
      FIXED_NOW,
    )
    const teacher = await createMember(app, created.id, 'ogretmen', [
      { kind: 'teacher', recordId: 't-1' },
    ])
    const outsider = await createMember(app, created.id, 'ogretmen')
    const desk = await createMember(app, created.id, 'onburo')
    const mother = await createMember(app, created.id, 'veli', [{ kind: 'child', recordId: 's-1' }])
    const other = await createMember(app, created.id, 'veli', [{ kind: 'child', recordId: 's-2' }])
    return {
      id: created.id,
      adminMembershipId: created.adminMembershipId,
      admin: await signInAs(app, created.admin),
      teacher: { ...teacher, cookie: await signInAs(app, teacher) },
      outsider: await signInAs(app, outsider),
      desk: { ...desk, cookie: await signInAs(app, desk) },
      mother: await signInAs(app, mother),
      other: await signInAs(app, other),
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  const visitBody = (extra: Json = {}) => ({
    studentId: 's-1',
    arrivedAt: '2026-10-06T08:30:00Z',
    complaint: 'Karın ağrısı',
    actions: ['rest'],
    note: 'Sıcak su verildi',
    ...extra,
  })
  const consentBody = (extra: Json = {}) => ({
    studentId: 's-1',
    medicationName: 'Parol şurup',
    dose: '5 ml',
    times: ['12:30', '09:00'],
    startDate: '2026-10-06',
    endDate: '2026-10-08',
    note: 'Tok karnına',
    ...extra,
  })
  const visitUrl = (id: unknown) => `${VISITS}/${String(id)}`
  const consentUrl = (id: unknown) => `${CONSENTS}/${String(id)}`
  const audits = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  const visitRows = (institutionId: string) =>
    db.select().from(infirmaryVisits).where(eq(infirmaryVisits.institutionId, institutionId))
  const consentRows = (institutionId: string) =>
    db
      .select()
      .from(infirmaryMedicationConsents)
      .where(eq(infirmaryMedicationConsents.institutionId, institutionId))
  const administrationRows = (institutionId: string) =>
    db
      .select()
      .from(infirmaryMedicationAdministrations)
      .where(eq(infirmaryMedicationAdministrations.institutionId, institutionId))
  const discharge = (id: unknown, cookie: string, version: unknown, extra: Json = {}) =>
    versioned(
      'POST',
      `${visitUrl(id)}/discharge`,
      cookie,
      { outcome: 'returned_to_class', ...extra },
      version,
    )
  const approve = (id: unknown, cookie: string, version: unknown) =>
    versioned('POST', `${consentUrl(id)}/approve`, cookie, {}, version)
  const administer = (t: Tenant, id: unknown, extra: Json = {}, cookie = t.desk.cookie) =>
    post(`${consentUrl(id)}/administrations`, cookie, {
      scheduledTime: '12:30',
      dose: '5 ml',
      administeredAt: '2026-10-06T08:55:00Z',
      ...extra,
    })
  async function approvedConsent(t: Tenant, extra: Json = {}) {
    const created = ok(await post(CONSENTS, t.mother, consentBody(extra)), 201)
    return ok(await approve(created.id, t.desk.cookie, created.version))
  }

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    for (const url of [
      VISITS,
      visitUrl(id),
      STATES,
      MY_VISITS,
      CONSENTS,
      consentUrl(id),
      SCHEDULE,
      STAFF,
    ])
      assertError(await get(url, null), 401)
    assertError(await post(VISITS, null, {}), 401)
    assertError(await call('PATCH', visitUrl(id), null, {}), 401)
    assertError(await post(`${visitUrl(id)}/discharge`, null, {}), 401)
    assertError(await post(CONSENTS, null, {}), 401)
    for (const verb of ['approve', 'reject', 'withdraw', 'administrations'])
      assertError(await post(`${consentUrl(id)}/${verb}`, null, {}), 401)
  })

  test('DOM-FIN-151: rol matrisi; öğretmen ve veli revir işinde 403; okul veli uçlarında 403; modül kapalı 403 (K-510)', async () => {
    const t = await institution()
    const student = await signInAs(app, await createMember(app, t.id, 'ogrenci'))
    for (const cookie of [t.teacher.cookie, t.mother, student]) {
      assertError(await get(VISITS, cookie), 403)
      assertError(await post(VISITS, cookie, visitBody()), 403)
      assertError(await get(SCHEDULE, cookie), 403)
      assertError(await get(STAFF, cookie), 403)
    }
    for (const cookie of [t.admin, t.desk.cookie, t.teacher.cookie, student]) {
      assertError(await get(MY_VISITS, cookie), 403)
      assertError(await post(CONSENTS, cookie, consentBody()), 403)
    }
    assertError(await get(CONSENTS, t.teacher.cookie), 403)
    assertError(await get(STATES, t.mother), 403)
    assertError(await get(STATES, student), 403)
    const created = ok(await post(CONSENTS, t.mother, consentBody()), 201)
    assertError(await approve(created.id, t.mother, created.version), 403)
    assertError(await approve(created.id, t.teacher.cookie, created.version), 403)
    assertError(await administer(t, created.id, {}, t.teacher.cookie), 403)
    assertError(
      await versioned('POST', `${consentUrl(created.id)}/withdraw`, t.desk.cookie, {}, 1),
      403,
    )
    ok(await get(STAFF, t.desk.cookie))
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(VISITS, closed.admin), 403, 'module_disabled')
    assertError(await get(MY_VISITS, closed.mother), 403, 'module_disabled')
    assertError(await get(STATES, closed.teacher.cookie), 403, 'module_disabled')
  })

  test('DOM-FIN-151: ziyaret açma, şifreli saklama, denetim, tek açık ziyaret ve mükerrer istek (K-508)', async () => {
    const t = await institution()
    assertError(await post(VISITS, t.desk.cookie, visitBody({ allergies: 'Fıstık' })), 400)
    assertError(await post(VISITS, t.desk.cookie, visitBody({ actions: ['magic'] })), 400)
    assertError(await call('POST', VISITS, t.desk.cookie, visitBody()), 400)
    assertError(
      await post(VISITS, t.desk.cookie, visitBody({ studentId: 's-9' })),
      422,
      'infirmary_student_not_found',
    )
    assertError(
      await post(VISITS, t.desk.cookie, visitBody({ arrivedAt: '2026-10-06T10:00:00Z' })),
      422,
      'infirmary_arrived_in_future',
    )
    assertError(
      await post(VISITS, t.desk.cookie, visitBody({ referredByMembershipId: 'nope' })),
      422,
      'infirmary_referred_by_not_found',
    )
    assertError(
      await post(VISITS, t.desk.cookie, visitBody({ incidentReportId: randomUUID() })),
      422,
      'infirmary_incident_not_found',
    )
    assert.equal((await visitRows(t.id)).length, 0)

    const key = randomUUID()
    const body = visitBody({ referredByMembershipId: t.teacher.membershipId })
    const first = await post(VISITS, t.desk.cookie, body, key)
    const created = ok(first, 201)
    assert.equal(first.headers.location, visitUrl(created.id))
    assert.equal(created.status, 'open')
    assert.equal(created.studentName, 'Deniz Yılmaz')
    assert.equal(created.complaint, 'Karın ağrısı')
    assert.deepEqual(created.actions, ['rest'])
    assert.equal(typeof created.referredByName, 'string')
    const replay = await post(VISITS, t.desk.cookie, body, key)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(replay.json().data.id, created.id)
    assertError(await post(VISITS, t.admin, visitBody()), 409, 'infirmary_visit_already_open')

    const rows = await visitRows(t.id)
    assert.equal(rows.length, 1)
    const raw = JSON.stringify(rows)
    for (const secret of SECRETS) assert.equal(raw.includes(secret), false, secret)
    const [creation] = await audits(t.id, 'finance.infirmary.visit_create')
    assert.ok(creation)
    for (const secret of SECRETS)
      assert.equal(JSON.stringify(creation.changes).includes(secret), false, secret)
    assert.ok((creation.changes as { fields: string[] }).fields.includes('complaint'))

    const list = (await get(VISITS, t.desk.cookie)).json()
    assert.equal(list.meta.total, 1)
    assert.equal('complaint' in list.data[0], false)
    assert.equal((await get(`${VISITS}?status=closed`, t.admin)).json().meta.total, 0)
    assert.equal(
      (await get(`${VISITS}?from=2026-10-06&to=2026-10-06`, t.admin)).json().meta.total,
      1,
    )
    assert.equal((await get(`${VISITS}?from=2026-10-07`, t.admin)).json().meta.total, 0)
    assertError(await get(`${VISITS}?complaint=x`, t.admin), 400)
    ok(await get(visitUrl(created.id), t.admin))
    assert.equal((await audits(t.id, 'finance.infirmary.visit_read')).length, 1)
  })

  test('DOM-FIN-151: kaza tutanağı bağı aynı öğrencinin tutanağı olmalı (K-508)', async () => {
    const t = await institution()
    const report = (studentId: string) =>
      post('/api/v1/finance/incidents', t.admin, {
        injured: { kind: 'student', studentId },
        occurredAt: '2026-10-06T08:00:00Z',
        location: 'Bahçe',
        kind: 'fall',
        description: 'Teneffüste koşarken düştü.',
        bodyParts: ['knee'],
        severity: 'minor',
        referral: 'infirmary',
        responsibleMembershipId: t.teacher.membershipId,
      })
    const own = ok(await report('s-1'), 201)
    const other = ok(await report('s-2'), 201)
    assertError(
      await post(VISITS, t.desk.cookie, visitBody({ incidentReportId: other.id })),
      422,
      'infirmary_incident_other_student',
    )
    const linked = ok(
      await post(VISITS, t.desk.cookie, visitBody({ incidentReportId: own.id })),
      201,
    )
    assert.equal(linked.incidentReportId, own.id)
  })

  test('DOM-FIN-151: açık ziyaret düzeltme, kapatma, sürüm kilidi ve kapanınca değişmezlik (K-508)', async () => {
    const t = await institution()
    const created = ok(await post(VISITS, t.desk.cookie, visitBody({ actions: [] })), 201)
    const url = visitUrl(created.id)
    assertError(await call('PATCH', url, t.desk.cookie, { note: 'x' }), 400, 'if_match_required')
    assertError(await versioned('PATCH', url, t.desk.cookie, { note: 'Yeni not' }, 99), 409)
    assertError(
      await versioned('PATCH', url, t.desk.cookie, { complaint: 'Karın ağrısı' }, 1),
      422,
      'infirmary_visit_unchanged',
    )
    assertError(await versioned('PATCH', url, t.desk.cookie, { studentId: 's-2' }, 1), 400)
    const updated = ok(
      await versioned('PATCH', url, t.desk.cookie, { actions: ['rest', 'guardian_called'] }, 1),
    )
    assert.deepEqual(updated.actions, ['rest', 'guardian_called'])
    assert.equal(updated.version, 2)
    const [change] = await audits(t.id, 'finance.infirmary.visit_update')
    assert.deepEqual((change?.changes as { fields: string[] }).fields, ['actions'])

    assertError(
      await discharge(created.id, t.desk.cookie, 2, { returnedAt: '2026-10-06T08:00:00Z' }),
      422,
      'infirmary_returned_before_arrival',
    )
    assertError(
      await discharge(created.id, t.desk.cookie, 2, { actions: [] }),
      422,
      'infirmary_actions_required',
    )
    assert.equal((await visitRows(t.id))[0]?.status, 'open')
    const closed = ok(await discharge(created.id, t.desk.cookie, 2, { outcome: 'went_home' }))
    assert.equal(closed.status, 'closed')
    assert.equal(closed.outcome, 'went_home')
    assert.equal(closed.returnedAt, FIXED_NOW.toISOString())
    assert.equal(closed.version, 3)
    assertError(await discharge(created.id, t.desk.cookie, 3), 409, 'infirmary_visit_closed')
    assertError(
      await versioned('PATCH', url, t.desk.cookie, { note: 'Geç not' }, 3),
      409,
      'infirmary_visit_closed',
    )
    // Son güvence: kapanmış ziyaret veritabanında da değişmez ve silinmez.
    await assert.rejects(
      db
        .update(infirmaryVisits)
        .set({ outcome: 'referred' })
        .where(eq(infirmaryVisits.institutionId, t.id)),
    )
    await assert.rejects(
      db.execute(sql`delete from infirmary_visits where institution_id = ${t.id}`),
    )
    // Kapanınca aynı öğrenciye yeni ziyaret açılır.
    ok(await post(VISITS, t.desk.cookie, visitBody()), 201)
  })

  test('DOM-FIN-151: öğretmen yalnız sınıfının revirde / döndü durumunu görür, sağlık ayrıntısı yok (K-510)', async () => {
    const t = await institution()
    const deniz = ok(await post(VISITS, t.desk.cookie, visitBody()), 201)
    const ece = ok(await post(VISITS, t.desk.cookie, visitBody({ studentId: 's-2' })), 201)
    ok(await discharge(ece.id, t.desk.cookie, ece.version, { outcome: 'referred' }))
    const teacherView = (await get(STATES, t.teacher.cookie)).json()
    assert.equal(teacherView.data.length, 1)
    const [state] = teacherView.data as Json[]
    assert.equal(state?.studentId, 's-1')
    assert.equal(state?.state, 'in_infirmary')
    for (const key of ['complaint', 'actions', 'outcome', 'note'])
      assert.equal(key in (state ?? {}), false, key)
    assert.equal((await get(STATES, t.outsider)).json().data.length, 0)
    const deskView = (await get(STATES, t.desk.cookie)).json().data as Json[]
    assert.deepEqual(
      deskView.map((row) => `${String(row.studentId)} ${String(row.state)}`).sort(),
      ['s-1 in_infirmary', 's-2 returned'],
    )
    assert.equal((await get(`${STATES}?date=2026-10-05`, t.desk.cookie)).json().data.length, 0)
    assertError(await get(`${STATES}?date=2026-13-01`, t.desk.cookie), 400)
    assertError(await get(visitUrl(deniz.id), t.teacher.cookie), 403)
    assert.equal((await audits(t.id, 'finance.infirmary.visit_read')).length, 0)
  })

  test('DOM-FIN-151: veli yalnız kendi çocuğunun ziyaret özetini görür; not yok; okuma denetimde (K-510)', async () => {
    const t = await institution()
    const deniz = ok(await post(VISITS, t.desk.cookie, visitBody()), 201)
    ok(await post(VISITS, t.desk.cookie, visitBody({ studentId: 's-2' })), 201)
    const list = (await get(MY_VISITS, t.mother)).json()
    assert.equal(list.meta.total, 1)
    const [summary] = list.data as Json[]
    assert.equal(summary?.id, deniz.id)
    assert.equal(summary?.complaint, 'Karın ağrısı')
    assert.deepEqual(summary?.actions, ['rest'])
    for (const key of ['note', 'referredByName', 'referredByMembershipId', 'incidentReportId'])
      assert.equal(key in (summary ?? {}), false, key)
    assert.equal((await get(`${MY_VISITS}?studentId=s-2`, t.mother)).json().meta.total, 0)
    assert.equal((await get(MY_VISITS, t.other)).json().meta.total, 1)
    assert.equal((await audits(t.id, 'finance.infirmary.guardian_read')).length, 2)
  })

  test('DOM-FIN-151: veli ilaç talebi açar; okul onaylar ya da gerekçeyle reddeder; veli geri çeker (K-509)', async () => {
    const t = await institution()
    assertError(await post(CONSENTS, t.mother, consentBody({ studentId: 's-2' })), 404, 'not_found')
    assertError(
      await post(CONSENTS, t.mother, consentBody({ startDate: '2026-10-05' })),
      422,
      'infirmary_consent_start_past',
    )
    assertError(
      await post(CONSENTS, t.mother, consentBody({ endDate: '2027-02-01' })),
      422,
      'infirmary_consent_too_long',
    )
    assertError(await post(CONSENTS, t.mother, consentBody({ times: ['25:00'] })), 400)
    assert.equal((await consentRows(t.id)).length, 0)

    const key = randomUUID()
    const created = ok(await post(CONSENTS, t.mother, consentBody(), key), 201)
    assert.equal(created.status, 'pending')
    assert.deepEqual(created.times, ['09:00', '12:30'])
    assert.equal(created.medicationName, 'Parol şurup')
    assert.deepEqual(created.administrations, [])
    const replay = await post(CONSENTS, t.mother, consentBody(), key)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    const raw = JSON.stringify(await consentRows(t.id))
    for (const secret of SECRETS) assert.equal(raw.includes(secret), false, secret)

    assertError(
      await versioned(
        'POST',
        `${consentUrl(created.id)}/reject`,
        t.desk.cookie,
        { reason: 'kısa' },
        1,
      ),
      400,
    )
    const rejected = ok(
      await versioned(
        'POST',
        `${consentUrl(created.id)}/reject`,
        t.desk.cookie,
        { reason: 'Doktor raporu gerekli.' },
        1,
      ),
    )
    assert.equal(rejected.status, 'rejected')
    assert.equal(rejected.rejectionReason, 'Doktor raporu gerekli.')
    const motherView = ok(await get(consentUrl(created.id), t.mother))
    assert.equal(motherView.rejectionReason, 'Doktor raporu gerekli.')
    assertError(await approve(created.id, t.desk.cookie, 2), 409, 'infirmary_consent_not_pending')
    assertError(
      await versioned('POST', `${consentUrl(created.id)}/withdraw`, t.mother, {}, 2),
      409,
      'infirmary_consent_closed',
    )
    const [rejection] = await audits(t.id, 'finance.infirmary.consent_reject')
    assert.equal(JSON.stringify(rejection?.changes).includes('Doktor'), false)
    // Son güvence: reddedilen talep veritabanında da değişmez.
    await assert.rejects(
      db
        .update(infirmaryMedicationConsents)
        .set({ status: 'approved' })
        .where(eq(infirmaryMedicationConsents.institutionId, t.id)),
    )

    const second = ok(await post(CONSENTS, t.mother, consentBody()), 201)
    assertError(await approve(second.id, t.desk.cookie, 9), 409)
    const approved = ok(await approve(second.id, t.desk.cookie, 1))
    assert.equal(approved.status, 'approved')
    assert.equal(typeof approved.decidedByName, 'string')
    assertError(await get(consentUrl(second.id), t.other), 404)
    assertError(await versioned('POST', `${consentUrl(second.id)}/withdraw`, t.other, {}, 2), 404)
    const withdrawn = ok(
      await versioned('POST', `${consentUrl(second.id)}/withdraw`, t.mother, {}, 2),
    )
    assert.equal(withdrawn.status, 'withdrawn')
    assertError(await administer(t, second.id), 422, 'infirmary_consent_not_approved')

    const listed = (await get(CONSENTS, t.mother)).json()
    assert.equal(listed.meta.total, 2)
    assert.equal((await get(CONSENTS, t.other)).json().meta.total, 0)
    assert.equal((await get(`${CONSENTS}?status=withdrawn`, t.admin)).json().meta.total, 1)
    assert.equal((await audits(t.id, 'finance.infirmary.consent_read')).length, 4)
  })

  test('DOM-FIN-151: onaysız ilaç verilmez; onay dışı saat ve doz 422; aynı doz saati yinelenmez (K-509)', async () => {
    const t = await institution()
    const pending = ok(await post(CONSENTS, t.mother, consentBody()), 201)
    assertError(await administer(t, pending.id), 422, 'infirmary_consent_not_approved')
    const consent = await approvedConsent(t)
    assertError(
      await administer(t, consent.id, { scheduledTime: '15:00' }),
      422,
      'infirmary_dose_time_not_approved',
    )
    assertError(
      await administer(t, consent.id, { dose: '10 ml' }),
      422,
      'infirmary_dose_not_approved',
    )
    assertError(
      await administer(t, consent.id, { administeredAt: '2026-10-06T09:30:00Z' }),
      422,
      'infirmary_administration_in_future',
    )
    assertError(
      await administer(t, consent.id, { administeredByMembershipId: 'nope' }),
      422,
      'infirmary_administered_by_not_found',
    )
    assertError(await administer(t, consent.id, { dose: '' }), 400)
    assert.equal((await administrationRows(t.id)).length, 0)

    const key = randomUUID()
    const body = { scheduledTime: '12:30', dose: '5 ML', administeredAt: '2026-10-06T08:55:00Z' }
    const given = ok(
      await post(`${consentUrl(consent.id)}/administrations`, t.desk.cookie, body, key),
      201,
    )
    const replay = await post(`${consentUrl(consent.id)}/administrations`, t.desk.cookie, body, key)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    const [record] = given.administrations as Json[]
    assert.equal(record?.doseDay, '2026-10-06')
    assert.equal(record?.scheduledTime, '12:30')
    assert.equal(record?.administeredByMembershipId, t.desk.membershipId)
    assertError(await administer(t, consent.id, {}, t.admin), 409, 'infirmary_dose_already_given')
    ok(
      await administer(t, consent.id, {
        scheduledTime: '09:00',
        administeredAt: '2026-10-06T06:05:00Z',
      }),
      201,
    )
    const rows = await administrationRows(t.id)
    assert.equal(rows.length, 2)
    for (const secret of SECRETS) assert.equal(JSON.stringify(rows).includes(secret), false, secret)
    await assert.rejects(
      db
        .update(infirmaryMedicationAdministrations)
        .set({ scheduledTime: '10:00' })
        .where(eq(infirmaryMedicationAdministrations.institutionId, t.id)),
    )
    // Onaylı talep yalnız geri çekilir; durumu başka yöne değiştirilemez.
    await assert.rejects(
      db
        .update(infirmaryMedicationConsents)
        .set({ status: 'pending' })
        .where(eq(infirmaryMedicationConsents.institutionId, t.id)),
    )

    const schedule = (await get(SCHEDULE, t.desk.cookie)).json().data as Json[]
    assert.deepEqual(
      schedule.map(
        (slot) => `${String(slot.scheduledTime)} ${slot.administration === null ? '-' : 'ok'}`,
      ),
      ['09:00 ok', '12:30 ok'],
    )
    assert.equal(schedule[0]?.medicationName, 'Parol şurup')
    const tomorrow = (await get(`${SCHEDULE}?date=2026-10-07`, t.desk.cookie)).json().data as Json[]
    assert.equal(tomorrow.length, 2)
    assert.ok(tomorrow.every((slot) => slot.administration === null))
    assert.equal((await get(`${SCHEDULE}?date=2026-10-09`, t.desk.cookie)).json().data.length, 0)
    assert.ok((await audits(t.id, 'finance.infirmary.schedule_read')).length >= 2)

    const motherView = ok(await get(consentUrl(consent.id), t.mother))
    assert.equal((motherView.administrations as unknown[]).length, 2)
  })

  test('DOM-FIN-151: başka kurumun ziyareti ve talebi 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bVisit = ok(await post(VISITS, b.desk.cookie, visitBody()), 201)
    const bConsent = ok(await post(CONSENTS, b.mother, consentBody()), 201)
    const bVisitUrl = visitUrl(bVisit.id)
    const bConsentUrl = consentUrl(bConsent.id)
    assertError(await get(bVisitUrl, a.admin), 404)
    assertError(await versioned('PATCH', bVisitUrl, a.admin, { note: 'Başka kurum' }, 1), 404)
    assertError(await discharge(bVisit.id, a.admin, 1, { actions: ['rest'] }), 404)
    assertError(await get(bConsentUrl, a.admin), 404)
    assertError(await get(bConsentUrl, a.mother), 404)
    assertError(await approve(bConsent.id, a.admin, 1), 404)
    assertError(
      await versioned('POST', `${bConsentUrl}/reject`, a.admin, { reason: 'Başka kurum.' }, 1),
      404,
    )
    assertError(await versioned('POST', `${bConsentUrl}/withdraw`, a.mother, {}, 1), 404)
    assertError(await administer(a, bConsent.id, {}, a.admin), 404)
    assert.equal((await get(VISITS, a.admin)).json().meta.total, 0)
    assert.equal((await get(CONSENTS, a.admin)).json().meta.total, 0)
    assert.equal((await get(MY_VISITS, a.mother)).json().meta.total, 0)
    assert.equal((await get(STATES, a.admin)).json().data.length, 0)
    assert.equal((await get(SCHEDULE, a.admin)).json().data.length, 0)
    const aStaff = (await get(`${STAFF}?pageSize=100`, a.admin)).json()
    assert.ok(!aStaff.data.some((row: Json) => row.membershipId === b.desk.membershipId))
    assertError(await post(VISITS, a.admin, visitBody({ institutionId: b.id })), 400)
    assertError(await post(CONSENTS, a.mother, consentBody({ institutionId: b.id })), 400)
    assertError(
      await post(VISITS, a.admin, visitBody({ referredByMembershipId: b.desk.membershipId })),
      422,
      'infirmary_referred_by_not_found',
    )
    const [bVisitRow] = await visitRows(b.id)
    assert.equal(bVisitRow?.status, 'open')
    assert.equal(bVisitRow?.version, 1)
    const [bConsentRow] = await consentRows(b.id)
    assert.equal(bConsentRow?.status, 'pending')
    assert.equal(bConsentRow?.version, 1)
    assert.equal((await visitRows(a.id)).length, 0)
    assert.equal((await consentRows(a.id)).length, 0)
  })
})
