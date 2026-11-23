import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  incidentReportAddenda,
  incidentReportNotifications,
  incidentReports,
  incidentReportWitnesses,
} from '../src/db/schema/finance-incidents.ts'
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
 * Kaza ve yaralanma tutanağı uçları (DOM-FIN-146; ON-162; K-493…K-495). Her test kendi kurumunu
 * kurar. FIXED_NOW 2026-10-06T09:00Z (Europe/Istanbul 12:00).
 */

const FINANCE = '/api/v1/finance'
const INCIDENTS = `${FINANCE}/incidents`
const STAFF = `${FINANCE}/incident-staff`
const SUMMARIES = `${FINANCE}/incident-summaries`
const SECRETS = ['Teneffüste', 'Buz uygulandı', 'Sol diz', 'knee', 'severe', 'Hastaneye']

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-146: kaza ve yaralanma tutanağı uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.162.0.1'

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
  // Sağlık okumaları gerekçe ister (DOM-FIN-156); gerekçe dalları `finance-health-access.test.ts`.
  const get = (url: string, cookie: string | null) =>
    call('GET', url, cookie, undefined, { 'x-access-reason': 'first_aid' })
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

  /** Kurum: Deniz (`s-1`) annesi `mother`; Ece (`s-2`) velisi `other`; personel ve sorumlu. */
  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.162.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      created.id,
      [
        ['s-1', 'Deniz Yılmaz'],
        ['s-2', 'Ece Yılmaz'],
      ].map(([id, name]) => ({
        collection: 'students' as const,
        id: id!,
        data: { id, name, classId: '9-A', isActive: true },
      })),
      FIXED_NOW,
    )
    const teacher = await createMember(app, created.id, 'ogretmen')
    const desk = await createMember(app, created.id, 'onburo')
    const desk2 = await createMember(app, created.id, 'onburo')
    const mother = await createMember(app, created.id, 'veli', [{ kind: 'child', recordId: 's-1' }])
    const other = await createMember(app, created.id, 'veli', [{ kind: 'child', recordId: 's-2' }])
    return {
      id: created.id,
      adminMembershipId: created.adminMembershipId,
      admin: await signInAs(app, created.admin),
      teacher: { ...teacher, cookie: await signInAs(app, teacher) },
      desk: { ...desk, cookie: await signInAs(app, desk) },
      desk2: { ...desk2, cookie: await signInAs(app, desk2) },
      mother: await signInAs(app, mother),
      other: await signInAs(app, other),
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  const reportBody = (t: Tenant, extra: Json = {}) => ({
    injured: { kind: 'student', studentId: 's-1' },
    occurredAt: '2026-10-06T08:30:00Z',
    location: 'Bahçe',
    kind: 'fall',
    description: 'Teneffüste koşarken düştü.',
    bodyParts: ['knee'],
    severity: 'moderate',
    injuryNote: 'Sol diz sıyrık',
    firstAid: { byMembershipId: t.teacher.membershipId, action: 'Buz uygulandı.' },
    referral: 'infirmary',
    witnessMembershipIds: [t.desk2.membershipId],
    responsibleMembershipId: t.teacher.membershipId,
    ...extra,
  })
  const url = (id: unknown) => `${INCIDENTS}/${String(id)}`
  const rowsOf = (institutionId: string) =>
    db.select().from(incidentReports).where(eq(incidentReports.institutionId, institutionId))
  const audits = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  const notify = (t: Tenant, id: unknown, cookie = t.admin, extra: Json = {}) =>
    post(`${url(id)}/notifications`, cookie, { channel: 'phone', ...extra })
  const finalize = (id: unknown, cookie: string, version: unknown) =>
    versioned('POST', `${url(id)}/finalize`, cookie, {}, version)

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    assertError(await get(INCIDENTS, null), 401)
    assertError(await post(INCIDENTS, null, {}), 401)
    assertError(await get(url(id), null), 401)
    assertError(await call('PATCH', url(id), null, {}), 401)
    assertError(await post(`${url(id)}/finalize`, null, {}), 401)
    assertError(await post(`${url(id)}/notifications`, null, {}), 401)
    assertError(await post(`${url(id)}/addenda`, null, {}), 401)
    assertError(await get(STAFF, null), 401)
    assertError(await get(SUMMARIES, null), 401)
  })

  test('DOM-FIN-146: veli ve öğrenci personel uçlarında 403; personel veli özetinde 403; ek not yalnız yönetici; modül kapalı 403 (K-494)', async () => {
    const t = await institution()
    const student = await signInAs(app, await createMember(app, t.id, 'ogrenci'))
    for (const cookie of [t.mother, student]) {
      assertError(await get(INCIDENTS, cookie), 403)
      assertError(await post(INCIDENTS, cookie, reportBody(t)), 403)
      assertError(await get(STAFF, cookie), 403)
    }
    assertError(await get(SUMMARIES, t.admin), 403)
    assertError(await get(SUMMARIES, t.teacher.cookie), 403)
    assertError(await get(SUMMARIES, student), 403)
    const created = ok(await post(INCIDENTS, t.teacher.cookie, reportBody(t)), 201)
    assertError(
      await post(`${url(created.id)}/addenda`, t.teacher.cookie, { note: 'Ek bilgi.' }),
      403,
    )
    assertError(await post(`${url(created.id)}/addenda`, t.desk.cookie, { note: 'Ek bilgi.' }), 403)
    ok(await get(STAFF, t.desk.cookie))
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(INCIDENTS, closed.admin), 403, 'module_disabled')
    assertError(await get(SUMMARIES, closed.mother), 403, 'module_disabled')
  })

  test('DOM-FIN-146: tutanak açma, şifreli saklama, denetim ve mükerrer istek (K-493)', async () => {
    const t = await institution()
    assertError(await post(INCIDENTS, t.admin, reportBody(t, { allergies: 'Fıstık' })), 400)
    assertError(await post(INCIDENTS, t.admin, reportBody(t, { severity: 'deadly' })), 400)
    assertError(
      await post(INCIDENTS, t.admin, reportBody(t, { occurredAt: '2026-10-06T10:00:00Z' })),
      422,
      'incident_occurred_in_future',
    )
    assertError(
      await post(INCIDENTS, t.admin, reportBody(t, { occurredAt: '2026-08-01T10:00:00Z' })),
      422,
      'incident_occurred_too_old',
    )
    assertError(
      await post(
        INCIDENTS,
        t.admin,
        reportBody(t, { injured: { kind: 'student', studentId: 's-9' } }),
      ),
      422,
      'incident_student_not_found',
    )
    assertError(
      await post(INCIDENTS, t.admin, reportBody(t, { responsibleMembershipId: 'nope' })),
      422,
      'incident_responsible_not_found',
    )
    assertError(
      await post(INCIDENTS, t.admin, reportBody(t, { witnessMembershipIds: ['nope'] })),
      422,
      'incident_witness_not_found',
    )
    assertError(await call('POST', INCIDENTS, t.admin, reportBody(t)), 400)
    assert.equal((await rowsOf(t.id)).length, 0)

    const key = randomUUID()
    const first = await post(INCIDENTS, t.desk.cookie, reportBody(t), key)
    const created = ok(first, 201)
    assert.equal(first.headers.location, url(created.id))
    assert.equal(created.status, 'draft')
    assert.equal(created.injuredName, 'Deniz Yılmaz')
    assert.equal(created.description, 'Teneffüste koşarken düştü.')
    assert.deepEqual(created.health, {
      bodyParts: ['knee'],
      severity: 'moderate',
      injuryNote: 'Sol diz sıyrık',
      firstAid: {
        byMembershipId: t.teacher.membershipId,
        byName: (created.health as Json & { firstAid: Json }).firstAid.byName,
        action: 'Buz uygulandı.',
      },
      referral: 'infirmary',
    })
    assert.equal((created.witnesses as unknown[]).length, 1)
    assert.equal('addenda' in created, false)
    assert.deepEqual(created.access, { health: true, edit: true, notify: true, manage: false })
    const replay = await post(INCIDENTS, t.desk.cookie, reportBody(t), key)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(replay.json().data.id, created.id)

    const rows = await rowsOf(t.id)
    assert.equal(rows.length, 1)
    const raw = JSON.stringify(rows)
    for (const secret of SECRETS) assert.equal(raw.includes(secret), false, secret)
    const [creation] = await audits(t.id, 'finance.incident.create')
    assert.ok(creation)
    const changes = JSON.stringify(creation.changes)
    for (const secret of SECRETS) assert.equal(changes.includes(secret), false, secret)
    assert.ok((creation.changes as { fields: string[] }).fields.includes('severity'))

    const staffInjured = ok(
      await post(
        INCIDENTS,
        t.admin,
        reportBody(t, {
          injured: { kind: 'staff', membershipId: t.desk.membershipId },
          firstAid: null,
          injuryNote: null,
        }),
      ),
      201,
    )
    assert.equal(staffInjured.injuredKind, 'staff')
    assert.equal(staffInjured.studentId, null)
    assertError(
      await post(
        INCIDENTS,
        t.admin,
        reportBody(t, {
          injured: { kind: 'staff', membershipId: t.desk2.membershipId },
        }),
      ),
      422,
      'incident_witness_is_injured',
    )
  })

  test('DOM-FIN-146: erişim matrisi; açan kendi tutanağını, sağlığı yalnız taslakta görür; okuma denetimde (K-494)', async () => {
    const t = await institution()
    const mine = ok(await post(INCIDENTS, t.desk.cookie, reportBody(t)), 201)
    const teachers = ok(await post(INCIDENTS, t.teacher.cookie, reportBody(t)), 201)
    assertError(await get(url(mine.id), t.desk2.cookie), 404)
    assertError(await get(url(mine.id), t.teacher.cookie), 404)
    assertError(
      await versioned('PATCH', url(mine.id), t.desk2.cookie, { location: 'Koridor' }, mine.version),
      404,
    )
    assertError(await notify(t, mine.id, t.desk2.cookie), 404)
    const deskList = (await get(INCIDENTS, t.desk.cookie)).json()
    assert.equal(deskList.meta.total, 1)
    assert.equal(deskList.data[0].id, mine.id)
    assert.equal(deskList.data[0].mine, true)
    assert.equal('health' in deskList.data[0], false)
    assert.equal('description' in deskList.data[0], false)
    assert.equal((await get(INCIDENTS, t.admin)).json().meta.total, 2)
    assert.equal((await get(`${INCIDENTS}?status=finalized`, t.admin)).json().meta.total, 0)
    assert.equal(
      (await get(`${INCIDENTS}?from=2026-10-06&to=2026-10-06`, t.admin)).json().meta.total,
      2,
    )
    assert.equal((await get(`${INCIDENTS}?from=2026-10-07`, t.admin)).json().meta.total, 0)
    assertError(await get(`${INCIDENTS}?from=2026-10-07&to=2026-10-06`, t.admin), 400)
    assertError(await get(`${INCIDENTS}?severity=severe`, t.admin), 400)

    const draftView = ok(await get(url(mine.id), t.desk.cookie))
    assert.ok(draftView.health)
    const finalized = ok(await finalize(mine.id, t.desk.cookie, mine.version))
    assert.equal(finalized.status, 'finalized')
    assert.equal('health' in finalized, false)
    const deskView = ok(await get(url(mine.id), t.desk.cookie))
    assert.equal('health' in deskView, false)
    assert.equal(deskView.description, 'Teneffüste koşarken düştü.')
    assert.deepEqual(deskView.access, { health: false, edit: false, notify: true, manage: false })
    const adminView = ok(await get(url(mine.id), t.admin))
    assert.ok(adminView.health)
    assert.deepEqual(adminView.addenda, [])

    const reads = await audits(t.id, 'finance.incident.read')
    assert.equal(reads.length, 3)
    const fieldsOf = (row: (typeof reads)[number]) => (row.changes as { fields: string[] }).fields
    // Aynı anda yazılan satırların okuma sırası tanımsızdır; alanlar sayıyla denetlenir.
    assert.equal(reads.filter((row) => fieldsOf(row).includes('severity')).length, 2)
    assert.equal(reads.filter((row) => fieldsOf(row).includes('addenda')).length, 1)
    assert.ok(teachers.id)
  })

  test('DOM-FIN-146: taslak düzeltme, sürüm kilidi ve kesinleşince değişmezlik (K-493)', async () => {
    const t = await institution()
    const created = ok(await post(INCIDENTS, t.teacher.cookie, reportBody(t)), 201)
    assertError(
      await call('PATCH', url(created.id), t.teacher.cookie, { location: 'Koridor' }),
      400,
      'if_match_required',
    )
    assertError(
      await versioned('PATCH', url(created.id), t.teacher.cookie, { location: 'Koridor' }, 99),
      409,
    )
    assertError(
      await versioned('PATCH', url(created.id), t.teacher.cookie, { location: 'Bahçe' }, 1),
      422,
      'incident_report_unchanged',
    )
    assertError(
      await versioned(
        'PATCH',
        url(created.id),
        t.teacher.cookie,
        { injured: { kind: 'staff' } },
        1,
      ),
      400,
    )
    const updated = ok(
      await versioned(
        'PATCH',
        url(created.id),
        t.teacher.cookie,
        { location: 'Spor salonu', witnessMembershipIds: [], severity: 'minor' },
        1,
      ),
    )
    assert.equal(updated.location, 'Spor salonu')
    assert.deepEqual(updated.witnesses, [])
    assert.equal((updated.health as Json).severity, 'minor')
    assert.equal(updated.version, 2)
    const [change] = await audits(t.id, 'finance.incident.update')
    assert.deepEqual((change?.changes as { fields: string[] }).fields, [
      'location',
      'severity',
      'witnessMembershipIds',
    ])

    const done = ok(await finalize(created.id, t.admin, 2))
    assert.equal(done.version, 3)
    assertError(
      await versioned('PATCH', url(created.id), t.admin, { location: 'Koridor' }, 3),
      409,
      'incident_report_finalized',
    )
    assertError(await finalize(created.id, t.admin, 3), 409, 'incident_report_finalized')
    // Son güvence: kesinleşmiş satır ve tanıkları veritabanında da değişmez.
    await assert.rejects(
      db
        .update(incidentReports)
        .set({ location: 'Gizli düzeltme' })
        .where(
          and(eq(incidentReports.institutionId, t.id), eq(incidentReports.id, String(created.id))),
        ),
    )
    await assert.rejects(
      db.insert(incidentReportWitnesses).values({
        institutionId: t.id,
        reportId: String(created.id),
        membershipId: t.desk.membershipId,
        position: 0,
      }),
    )
    const [row] = await rowsOf(t.id)
    assert.equal(row?.location, 'Spor salonu')
  })

  test('DOM-FIN-146: ağır olay bildirimsiz kesinleşmez; bildirim yalnız kayıt ve değişmez (K-493)', async () => {
    const t = await institution()
    const severe = ok(
      await post(
        INCIDENTS,
        t.desk.cookie,
        reportBody(t, { severity: 'severe', referral: 'hospital' }),
      ),
      201,
    )
    assertError(await finalize(severe.id, t.desk.cookie, 1), 422, 'incident_notification_required')
    assert.equal((await rowsOf(t.id))[0]?.status, 'draft')
    assertError(
      await notify(t, severe.id, t.desk.cookie, { notifiedAt: '2026-10-06T08:00:00Z' }),
      422,
      'incident_notification_before_incident',
    )
    assertError(
      await notify(t, severe.id, t.desk.cookie, { notifiedAt: '2026-10-06T10:00:00Z' }),
      422,
      'incident_notification_in_future',
    )
    assertError(
      await notify(t, severe.id, t.desk.cookie, { notifiedByMembershipId: 'nope' }),
      422,
      'incident_notified_by_not_found',
    )
    assertError(await notify(t, severe.id, t.desk.cookie, { channel: 'sms' }), 400)
    const key = randomUUID()
    const early = { channel: 'phone', notifiedAt: '2026-10-06T08:40:00Z' }
    const recorded = ok(
      await post(`${url(severe.id)}/notifications`, t.desk.cookie, early, key),
      201,
    )
    const replay = await post(`${url(severe.id)}/notifications`, t.desk.cookie, early, key)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    const [first] = recorded.notifications as Json[]
    assert.equal(first?.notifiedByMembershipId, t.desk.membershipId)
    assert.equal(first?.notifiedAt, '2026-10-06T08:40:00.000Z')
    assertError(
      await versioned(
        'PATCH',
        url(severe.id),
        t.desk.cookie,
        { occurredAt: '2026-10-06T08:50:00Z' },
        1,
      ),
      422,
      'incident_occurred_after_notification',
    )
    const done = ok(await finalize(severe.id, t.desk.cookie, 1))
    assert.equal(done.notificationCount, 1)
    ok(await notify(t, severe.id, t.desk.cookie, { channel: 'in_person' }), 201)
    const notes = await db
      .select()
      .from(incidentReportNotifications)
      .where(eq(incidentReportNotifications.institutionId, t.id))
    assert.equal(notes.length, 2)
    await assert.rejects(
      db
        .update(incidentReportNotifications)
        .set({ channel: 'message' })
        .where(eq(incidentReportNotifications.institutionId, t.id)),
    )

    const staffReport = ok(
      await post(
        INCIDENTS,
        t.admin,
        reportBody(t, {
          injured: { kind: 'staff', membershipId: t.teacher.membershipId },
          severity: 'severe',
          firstAid: null,
          responsibleMembershipId: t.desk.membershipId,
        }),
      ),
      201,
    )
    assertError(await notify(t, staffReport.id), 422, 'incident_notification_not_student')
    ok(await finalize(staffReport.id, t.admin, 1))
  })

  test('DOM-FIN-146: ek not yalnız kesinleşmiş tutanağa, şifreli ve değişmez; eski hâl korunur (K-493)', async () => {
    const t = await institution()
    const created = ok(await post(INCIDENTS, t.teacher.cookie, reportBody(t)), 201)
    assertError(
      await post(`${url(created.id)}/addenda`, t.admin, { note: 'Sevk hastaneye çevrildi.' }),
      422,
      'incident_addendum_draft',
    )
    assertError(await post(`${url(created.id)}/addenda`, t.admin, { note: 'kısa' }), 400)
    ok(await finalize(created.id, t.teacher.cookie, 1))
    const withNote = ok(
      await post(`${url(created.id)}/addenda`, t.admin, { note: 'Hastaneye sevk edildi.' }),
      201,
    )
    const addenda = withNote.addenda as Json[]
    assert.equal(addenda.length, 1)
    assert.equal(addenda[0]?.note, 'Hastaneye sevk edildi.')
    assert.equal((withNote.health as Json).referral, 'infirmary')
    const stored = await db
      .select()
      .from(incidentReportAddenda)
      .where(eq(incidentReportAddenda.institutionId, t.id))
    assert.equal(stored.length, 1)
    assert.equal(JSON.stringify(stored).includes('Hastaneye'), false)
    await assert.rejects(
      db.execute(sql`delete from incident_report_addenda where institution_id = ${t.id}`),
    )
    const teacherView = ok(await get(url(created.id), t.teacher.cookie))
    assert.equal('addenda' in teacherView, false)
    const [audit] = await audits(t.id, 'finance.incident.addendum')
    assert.equal(JSON.stringify(audit?.changes).includes('Hastaneye'), false)
  })

  test('DOM-FIN-146: veli yalnız kendi çocuğunun kesinleşmiş tutanak özetini görür; okuma denetimde (K-495)', async () => {
    const t = await institution()
    const draft = ok(await post(INCIDENTS, t.admin, reportBody(t)), 201)
    assert.equal((await get(SUMMARIES, t.mother)).json().meta.total, 0)
    const final = ok(await post(INCIDENTS, t.admin, reportBody(t, { severity: 'minor' })), 201)
    ok(await finalize(final.id, t.admin, 1))
    const ece = ok(
      await post(
        INCIDENTS,
        t.admin,
        reportBody(t, { injured: { kind: 'student', studentId: 's-2' } }),
      ),
      201,
    )
    ok(await finalize(ece.id, t.admin, 1))
    const list = (await get(SUMMARIES, t.mother)).json()
    assert.equal(list.meta.total, 1)
    const [summary] = list.data as Json[]
    assert.equal(summary?.id, final.id)
    assert.equal(summary?.studentName, 'Deniz Yılmaz')
    assert.equal(summary?.severity, 'minor')
    assert.equal(summary?.firstAidAction, 'Buz uygulandı.')
    for (const key of ['description', 'witnesses', 'injuryNote', 'addenda', 'responsibleName'])
      assert.equal(key in (summary ?? {}), false, key)
    assert.equal((await get(`${SUMMARIES}?studentId=s-2`, t.mother)).json().meta.total, 0)
    assert.equal((await get(SUMMARIES, t.other)).json().meta.total, 1)
    assert.equal((await get(SUMMARIES, t.other)).json().data[0].id, ece.id)
    const reads = await audits(t.id, 'finance.incident.guardian_read')
    assert.equal(reads.length, 3)
    assert.ok(draft.id)
  })

  test('DOM-FIN-146: başka kurumun tutanağı 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bReport = ok(await post(INCIDENTS, b.admin, reportBody(b)), 201)
    const bUrl = url(bReport.id)
    assertError(await get(bUrl, a.admin), 404)
    assertError(
      await versioned('PATCH', bUrl, a.admin, { location: 'Koridor' }, bReport.version),
      404,
    )
    assertError(await finalize(bReport.id, a.admin, bReport.version), 404)
    assertError(await notify(a, bReport.id), 404)
    assertError(await post(`${bUrl}/addenda`, a.admin, { note: 'Başka kurum notu.' }), 404)
    assert.equal((await get(INCIDENTS, a.admin)).json().meta.total, 0)
    assert.equal((await get(SUMMARIES, a.mother)).json().meta.total, 0)
    const aStaff = (await get(`${STAFF}?pageSize=100`, a.admin)).json()
    assert.ok(!aStaff.data.some((row: Json) => row.membershipId === b.teacher.membershipId))
    assertError(await post(INCIDENTS, a.admin, reportBody(a, { institutionId: b.id })), 400)
    assertError(
      await post(
        INCIDENTS,
        a.admin,
        reportBody(a, { responsibleMembershipId: b.teacher.membershipId }),
      ),
      422,
      'incident_responsible_not_found',
    )
    const [bRow] = await rowsOf(b.id)
    assert.equal(bRow?.status, 'draft')
    assert.equal(bRow?.location, 'Bahçe')
    assert.equal(bRow?.version, 1)
    assert.equal((await rowsOf(a.id)).length, 0)
  })
})
