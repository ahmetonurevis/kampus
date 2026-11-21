import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, inArray } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { healthAccessReasons } from '../src/db/schema/finance-health-access.ts'
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
 * Sağlık verisi okuma gerekçesi ve erişim günlüğü (DOM-FIN-156; ON-164; K-523…K-525;
 * DOM-YTK-052). Gerekçe kaza tutanağı ayrıntısında, revir ziyareti ayrıntısında, ilaç talebi
 * listesi ve ayrıntısında ve ilaç uygulama listesinde zorunludur. Her test kendi kurumunu kurar.
 * FIXED_NOW 2026-10-06T09:00Z (Europe/Istanbul 12:00).
 */

const FINANCE = '/api/v1/finance'
const INCIDENTS = `${FINANCE}/incidents`
const VISITS = `${FINANCE}/infirmary/visits`
const CONSENTS = `${FINANCE}/infirmary/medication-consents`
const SCHEDULE = `${FINANCE}/infirmary/medication-schedule`
const LOGS = `${FINANCE}/health-access-logs`
const SECRETS = ['Teneffüste', 'Sol diz', 'Karın ağrısı', 'Sıcak su', 'Parol', '5 ml']
const READ_ACTIONS = [
  'finance.incident.read',
  'finance.infirmary.visit_read',
  'finance.infirmary.consent_read',
  'finance.infirmary.schedule_read',
]

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>
type Reason = Record<string, string>

const FIRST_AID: Reason = { 'x-access-reason': 'first_aid' }
const other = (note: string): Reason => ({
  'x-access-reason': 'other',
  'x-access-reason-note': encodeURIComponent(note),
})

describe('DOM-FIN-156: sağlık verisi okuma gerekçesi ve erişim günlüğü', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.164.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    target: App,
    method: 'GET' | 'POST',
    url: string,
    cookie: string | null,
    headers: Record<string, string> = {},
    payload?: unknown,
  ) {
    return target.inject({
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
  const get = (url: string, cookie: string | null, reason: Reason = {}) =>
    call(app, 'GET', url, cookie, reason)
  const post = (url: string, cookie: string, body: unknown, headers: Reason = {}) =>
    call(app, 'POST', url, cookie, { 'idempotency-key': randomUUID(), ...headers }, body)
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  /** Kurum: Deniz (`s-1`) annesi `mother`, Ece (`s-2`); personel; tutanak, ziyaret ve onaylı ilaç. */
  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.164.${String((tenantCount += 1))}.1`
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
    const mother = await createMember(app, created.id, 'veli', [{ kind: 'child', recordId: 's-1' }])
    return {
      id: created.id,
      adminMembershipId: created.adminMembershipId,
      admin: await signInAs(app, created.admin),
      teacher: { ...teacher, cookie: await signInAs(app, teacher) },
      desk: { ...desk, cookie: await signInAs(app, desk) },
      mother: await signInAs(app, mother),
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  /** Okunacak kayıtlar: Deniz'in tutanağı ve ziyareti, onaylı ilaç talebi. */
  async function records(t: Tenant) {
    const incident = ok(
      await post(INCIDENTS, t.admin, {
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
        witnessMembershipIds: [],
        responsibleMembershipId: t.teacher.membershipId,
      }),
      201,
    )
    const visit = ok(
      await post(VISITS, t.desk.cookie, {
        studentId: 's-1',
        arrivedAt: '2026-10-06T08:30:00Z',
        complaint: 'Karın ağrısı',
        actions: ['rest'],
        note: 'Sıcak su verildi',
      }),
      201,
    )
    const requested = ok(
      await post(CONSENTS, t.mother, {
        studentId: 's-1',
        medicationName: 'Parol şurup',
        dose: '5 ml',
        times: ['12:30'],
        startDate: '2026-10-06',
        endDate: '2026-10-06',
      }),
      201,
    )
    const consent = ok(
      await call(
        app,
        'POST',
        `${CONSENTS}/${String(requested.id)}/approve`,
        t.desk.cookie,
        { 'if-match': `"${String(requested.version)}"` },
        {},
      ),
    )
    return {
      incident: `${INCIDENTS}/${String(incident.id)}`,
      visit: `${VISITS}/${String(visit.id)}`,
      consent: `${CONSENTS}/${String(consent.id)}`,
    }
  }
  const readUrls = (urls: Awaited<ReturnType<typeof records>>) => [
    urls.incident,
    urls.visit,
    urls.consent,
    CONSENTS,
    SCHEDULE,
  ]
  const reads = (institutionId: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), inArray(auditLog.action, READ_ACTIONS)))
  const reasonRows = (institutionId: string) =>
    db
      .select()
      .from(healthAccessReasons)
      .where(eq(healthAccessReasons.institutionId, institutionId))

  test('kimliksiz istek 401', async () => {
    assertError(await get(LOGS, null), 401)
    assertError(await get(`${INCIDENTS}/${randomUUID()}`, null, FIRST_AID), 401)
  })

  test('DOM-FIN-156: gerekçesiz ya da geçersiz gerekçeli sağlık okuması 400; denetim ve günlük yazılmaz (K-523)', async () => {
    const t = await institution()
    const urls = await records(t)
    for (const url of readUrls(urls))
      for (const cookie of [t.admin, t.desk.cookie]) {
        const missing = await get(url, cookie)
        assertError(missing, 400, 'health_access_reason_required')
        assert.equal(
          missing.json().message,
          'Sağlık bilgisini açmak için erişim gerekçesini seçin.',
        )
        assert.deepEqual(missing.json().issues[0].path, ['x-access-reason'])
        for (const SECRET of SECRETS) assert.equal(missing.body.includes(SECRET), false)
      }
    const invalid: [Reason, string][] = [
      [{ 'x-access-reason': 'curiosity' }, 'x-access-reason'],
      [{ 'x-access-reason': 'other' }, 'x-access-reason-note'],
      [other('abc'), 'x-access-reason-note'],
      [other('x'.repeat(201)), 'x-access-reason-note'],
      [{ ...FIRST_AID, 'x-access-reason-note': 'ek' }, 'x-access-reason-note'],
      [{ 'x-access-reason': 'other', 'x-access-reason-note': '%E0%A4%A' }, 'x-access-reason-note'],
    ]
    for (const [reason, path] of invalid) {
      const response = await get(urls.incident, t.admin, reason)
      assertError(response, 400, 'health_access_reason_invalid')
      assert.deepEqual(response.json().issues[0].path, [path])
    }
    assert.equal((await reads(t.id)).length, 0)
    assert.equal((await reasonRows(t.id)).length, 0)
  })

  test('DOM-FIN-156: gerekçeli okuma denetime ve günlüğe düşer; her okuma ayrı kaydedilir (K-523, K-525)', async () => {
    const t = await institution()
    const urls = await records(t)
    const note = 'İl sağlık müdürlüğü yazısı için'
    ok(await get(urls.incident, t.admin, { 'x-access-reason': 'guardian_meeting' }))
    ok(await get(urls.incident, t.admin, { 'x-access-reason': 'guardian_meeting' }))
    ok(await get(urls.visit, t.desk.cookie, other(`  ${note}  `)))
    ok(await get(urls.consent, t.desk.cookie, { 'x-access-reason': 'emergency' }))
    const list = ok(await get(CONSENTS, t.desk.cookie, { 'x-access-reason': 'first_aid' }))
    assert.equal((list as unknown as unknown[]).length, 1)
    const schedule = ok(await get(SCHEDULE, t.desk.cookie, { 'x-access-reason': 'first_aid' }))
    assert.equal((schedule as unknown as unknown[]).length, 1)

    const audits = await reads(t.id)
    const rows = await reasonRows(t.id)
    assert.equal(audits.length, 6)
    assert.equal(rows.length, 6)
    const byAudit = new Map(rows.map((row) => [row.auditLogId, row]))
    for (const audit of audits) {
      const row = byAudit.get(audit.id)
      assert.ok(row, `gerekçe satırı yok: ${audit.action}`)
      assert.equal(row.studentId, 's-1')
      assert.equal(row.createdAt.toISOString(), FIXED_NOW.toISOString())
      // Denetime alan adları gider, değer gitmez.
      for (const SECRET of SECRETS)
        assert.equal(JSON.stringify(audit.changes).includes(SECRET), false)
    }
    const incidentReads = audits.filter((row) => row.action === 'finance.incident.read')
    assert.equal(incidentReads.length, 2)
    for (const audit of incidentReads) {
      assert.equal(byAudit.get(audit.id)?.reasonCode, 'guardian_meeting')
      assert.equal(byAudit.get(audit.id)?.actorMembershipId, t.adminMembershipId)
      assert.equal(audit.reason, null)
    }
    const visitRead = audits.find((row) => row.action === 'finance.infirmary.visit_read')
    assert.equal(visitRead?.reason, note)
    assert.equal(byAudit.get(visitRead?.id ?? '')?.reasonCode, 'other')
    assert.equal(byAudit.get(visitRead?.id ?? '')?.actorMembershipId, t.desk.membershipId)
  })

  test('DOM-FIN-156: veli kendi çocuğunun ilaç talebini gerekçesiz okur; gerekçe satırı yazılmaz', async () => {
    const t = await institution()
    const urls = await records(t)
    ok(await get(CONSENTS, t.mother))
    ok(await get(urls.consent, t.mother))
    // Veliye gerekçe sorulmaz; gönderse de kaydedilmez.
    ok(await get(urls.consent, t.mother, { 'x-access-reason': 'emergency' }))
    assert.equal((await reads(t.id)).length, 3)
    assert.equal((await reasonRows(t.id)).length, 0)
  })

  test('DOM-FIN-156: erişim günlüğü yalnız yönetici; modül kapalı 403; süzgeçler; sağlık değeri dönmez (K-524)', async () => {
    const t = await institution()
    const urls = await records(t)
    ok(await get(urls.incident, t.admin, { 'x-access-reason': 'incident_report' }))
    ok(await get(urls.visit, t.desk.cookie, other('Müdür yardımcısı istedi')))
    for (const cookie of [t.desk.cookie, t.teacher.cookie, t.mother])
      assertError(await get(LOGS, cookie), 403)
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(LOGS, closed.admin), 403, 'module_disabled')

    const response = await get(LOGS, t.admin)
    assert.equal(response.statusCode, 200, response.body)
    for (const SECRET of SECRETS) assert.equal(response.body.includes(SECRET), false)
    const body = response.json() as { data: Json[]; meta: { total: number } }
    assert.equal(body.meta.total, 2)
    const [latest] = body.data
    assert.ok(latest)
    assert.equal(latest.studentId, 's-1')
    assert.equal(latest.studentName, 'Deniz Yılmaz')
    assert.equal(latest.accessedAt, FIXED_NOW.toISOString())
    const byAction = new Map(body.data.map((row) => [row.action, row]))
    assert.equal(byAction.get('finance.incident.read')?.reasonCode, 'incident_report')
    assert.equal(byAction.get('finance.incident.read')?.reasonNote, null)
    assert.equal(
      byAction.get('finance.infirmary.visit_read')?.reasonNote,
      'Müdür yardımcısı istedi',
    )
    assert.equal(byAction.get('finance.infirmary.visit_read')?.actorRole, 'onburo')
    assert.equal(typeof byAction.get('finance.infirmary.visit_read')?.actorName, 'string')

    const total = async (query: string) =>
      ((await get(`${LOGS}?${query}`, t.admin)).json() as { meta: { total: number } }).meta.total
    assert.equal(await total(`actorMembershipId=${t.desk.membershipId}`), 1)
    assert.equal(await total('reasonCode=incident_report'), 1)
    assert.equal(await total('reasonCode=emergency'), 0)
    assert.equal(await total('studentId=s-1'), 2)
    assert.equal(await total('studentId=s-2'), 0)
    assert.equal(await total('from=2026-10-06&to=2026-10-06'), 2)
    assert.equal(await total('from=2026-10-07'), 0)
    assert.equal(await total('to=2026-10-05'), 0)
    assertError(await get(`${LOGS}?unknown=1`, t.admin), 400)
    assertError(await get(`${LOGS}?reasonCode=curiosity`, t.admin), 400)
  })

  test('DOM-FIN-156: başka kurumun günlüğü görünmez; başka kurumun kaydı gerekçeyle de 404 ve günlüğe düşmez', async () => {
    const a = await institution()
    const b = await institution()
    const bUrls = await records(b)
    ok(await get(bUrls.incident, b.admin, FIRST_AID))
    for (const url of [bUrls.incident, bUrls.visit, bUrls.consent])
      assertError(await get(url, a.admin, FIRST_AID), 404)
    assert.equal((await reasonRows(a.id)).length, 0)
    assert.equal((await reasonRows(b.id)).length, 1)
    const aLogs = (await get(LOGS, a.admin)).json() as { data: Json[]; meta: { total: number } }
    assert.equal(aLogs.meta.total, 0)
    // Gövde ve sorgudaki kurum kimliği okunmaz.
    assertError(await get(`${LOGS}?institutionId=${b.id}`, a.admin), 400)
  })

  test('DOM-FIN-156: gerekçe başlığı ve açıklaması istek loguna yazılmaz', async () => {
    const logs: string[] = []
    const logged = await buildTestApp(db, { clock: () => FIXED_NOW, logs })
    try {
      const t = await institution()
      const urls = await records(t)
      const note = 'Gizli açıklama 164'
      const response = await call(logged, 'GET', urls.visit, t.desk.cookie, other(note))
      assert.equal(response.statusCode, 200, response.body)
      const text = logs.join('')
      assert.ok(text.includes('/api/v1/finance/infirmary/visits/'), 'istek logu yazılmadı')
      for (const value of [note, encodeURIComponent(note), 'x-access-reason'])
        assert.equal(text.includes(value), false, value)
    } finally {
      await logged.close()
    }
  })
})
