import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { files } from '../src/db/schema/files.ts'
import {
  tripEvaluations,
  tripReportIncidents,
  tripReportPhotos,
  tripReportPhotoTags,
  tripReports,
} from '../src/db/schema/finance-trip-reports.ts'
import { recordFileCheck } from '../src/services/files.ts'
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
import { multipart, png, tempStorage, uploadParts } from './support/files-sample.ts'

/**
 * Gezi sonrası rapor, rızalı fotoğraf ve katılımcı değerlendirmesi uçları (DOM-FIN-158; ON-158;
 * K-529…K-531; IST-017). Her test kendi kurumunu kurar. Plan FIXED_NOW'da (2026-10-06) 2026-10-20
 * için açılıp onaylanır; gezi günü yoklaması 2026-10-20 10:00'da yapılır (Deniz ve Ece var, Ali yok),
 * rapor testleri saati dönüşten sonraya (2026-10-21) alır.
 */

const PLANS = '/api/v1/finance/trip-plans'
const LIST = '/api/v1/finance/trip-reports'
const MY = '/api/v1/finance/trip-reports/my'
const EVALUATIONS = '/api/v1/finance/trip-evaluations'
const TRIP_DAY = '2026-10-20'
const ON_TRIP = new Date(`${TRIP_DAY}T07:00:00.000Z`)
const AFTER_TRIP = new Date('2026-10-21T08:00:00.000Z')
const SUMMARY = 'Gezi planlandığı gibi gerçekleşti; Anıtkabir ve müze turu tamamlandı.'
const OUTCOME = 'Öğrenciler Cumhuriyet tarihi kazanımlarını yerinde gözlemledi; öneri: rehber.'

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>
type Photo = {
  id: string
  fileId: string
  visibility: string
  version: number
  url: string | null
  students: { studentId: string; consent: boolean }[]
}

describe('DOM-FIN-158: gezi sonrası rapor, rızalı fotoğraf ve değerlendirme uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  let now = FIXED_NOW
  let tenantCount = 0
  let clientIp = '10.158.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    store = await tempStorage()
    app = await buildTestApp(db, { storage: store.storage, clock: () => now })
  })
  after(async () => {
    await app.close()
    await close()
    await store.remove()
  })

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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
    method: 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string | null,
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
  /** Tetikleyici hatası sorgu hatasının nedenindedir. */
  const immutable = (message: string) => (error: unknown) => {
    assert.match(String((error as { cause?: unknown }).cause ?? error), new RegExp(message))
    return true
  }
  const reportUrl = (planId: unknown) => `${PLANS}/${String(planId)}/report`
  const photosUrl = (planId: unknown) => `${reportUrl(planId)}/photos`
  const photoUrl = (planId: unknown, photoId: unknown) => `${photosUrl(planId)}/${String(photoId)}`
  const reportOf = (view: Json) => view.report as Json & { version: number; photos: Photo[] }
  const audits = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  async function snapshot(institutionId: string) {
    return JSON.stringify([
      await db.select().from(tripReports).where(eq(tripReports.institutionId, institutionId)),
      await db
        .select()
        .from(tripReportPhotos)
        .where(eq(tripReportPhotos.institutionId, institutionId)),
      await db
        .select()
        .from(tripReportPhotoTags)
        .where(eq(tripReportPhotoTags.institutionId, institutionId)),
      await db
        .select()
        .from(tripReportIncidents)
        .where(eq(tripReportIncidents.institutionId, institutionId)),
      await db
        .select()
        .from(tripEvaluations)
        .where(eq(tripEvaluations.institutionId, institutionId)),
    ])
  }

  /**
   * Kurum: Deniz (`s-1`; velisi `mother`), Ece (`s-2`), Ali (`s-3`; öğrenci hesabı `ali`), etkin
   * olmayan `s-4`. `lead` planın sorumlusu, `assistant` görevlisi; `stranger` görevli değildir.
   * Fotoğraf paylaşım rıza metni yayımlıdır.
   */
  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.158.${String((tenantCount += 1))}.1`
    now = FIXED_NOW
    const created = await createInstitution(app, overrides)
    const record = (collection: 'classes' | 'students', data: Json) => ({
      collection,
      id: String(data.id),
      data,
    })
    await insertMissingRecords(
      db,
      created.id,
      [
        record('classes', { id: '9-A', name: '9-A', grade: 9, level: 'lise', branchId: 'b-1' }),
        record('students', { id: 's-1', name: 'Deniz Yılmaz', classId: '9-A', isActive: true }),
        record('students', { id: 's-2', name: 'Ece Yılmaz', classId: '9-A', isActive: true }),
        record('students', { id: 's-3', name: 'Ali Kurt', classId: '9-A', isActive: true }),
        record('students', { id: 's-4', name: 'Eski Öğrenci', classId: '9-A', isActive: false }),
      ],
      FIXED_NOW,
    )
    const lead = await createMember(app, created.id, 'ogretmen')
    const assistant = await createMember(app, created.id, 'ogretmen')
    const stranger = await createMember(app, created.id, 'ogretmen')
    const desk = await createMember(app, created.id, 'onburo')
    const mother = await createMember(app, created.id, 'veli', [{ kind: 'child', recordId: 's-1' }])
    const ali = await createMember(app, created.id, 'ogrenci', [
      { kind: 'student', recordId: 's-3' },
    ])
    const admin = await signInAs(app, created.admin)
    const notice = await post('/api/v1/privacy-notices', admin, {
      kind: 'consent_text',
      purpose: 'photo_video_sharing',
      title: 'Fotoğraf rızası',
      body: 'Gezi fotoğraflarının kurum içi platformda paylaşılması.',
    })
    assert.equal(notice.statusCode, 201, notice.body)
    return {
      id: created.id,
      admin,
      sharingTextId: String(notice.json().data.id),
      lead: { ...lead, cookie: await signInAs(app, lead) },
      assistant: { ...assistant, cookie: await signInAs(app, assistant) },
      stranger: await signInAs(app, stranger),
      desk: await signInAs(app, desk),
      mother: await signInAs(app, mother),
      ali: await signInAs(app, ali),
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  /** Onaylı plan: 2026-10-20 08:00–20:00 İstanbul; görevliler `lead` (sorumlu) ve `assistant`. */
  async function approvedPlan(t: Tenant) {
    const plan = ok(
      await post(PLANS, t.admin, {
        name: 'Anıtkabir gezisi',
        purpose: 'Cumhuriyet tarihi kazanımlarını yerinde gözlemlemek.',
        departureAt: `${TRIP_DAY}T05:00:00.000Z`,
        returnAt: `${TRIP_DAY}T17:00:00.000Z`,
        expectedStudentCount: 3,
        stops: [{ place: 'Anıtkabir' }],
        staff: [
          { membershipId: t.lead.membershipId, role: 'lead' },
          { membershipId: t.assistant.membershipId, role: 'assistant' },
        ],
        transport: {
          type: 'bus',
          company: 'Mavi Turizm',
          plate: '06 ABC 123',
          driverName: 'Ali Sürücü',
          driverPhone: '05321112233',
        },
        risks: [{ risk: 'Kalabalıkta kaybolma', measure: 'Grup sorumlusu ve yoklama' }],
        emergencyContacts: [{ name: 'Okul müdürü', phone: '05321234500', relation: 'Müdür' }],
      }),
      201,
    )
    const submitted = ok(
      await versioned('POST', `${PLANS}/${String(plan.id)}/submit`, t.admin, {}, plan.version),
    )
    ok(
      await versioned(
        'POST',
        `${PLANS}/${String(plan.id)}/approve`,
        t.admin,
        {},
        submitted.version,
      ),
    )
    return String(plan.id)
  }

  /**
   * Gezi günü: tek grup (s-1, s-2, s-3), gezi günü tek tur; Deniz ve Ece var, Ali yok, eksikle
   * devam. Saat dönüşten sonraya alınır.
   */
  async function finishedTrip(t: Tenant) {
    const planId = await approvedPlan(t)
    const day = `${PLANS}/${planId}/day`
    const created = ok(
      await post(`${day}/groups`, t.desk, {
        name: '1. otobüs',
        leaderMembershipId: t.lead.membershipId,
      }),
      201,
    )
    const groupId = String((created.groups as Json[])[0]?.id)
    ok(await post(`${day}/assignments`, t.desk, { groupId, studentIds: ['s-1', 's-2', 's-3'] }))
    now = ON_TRIP
    const started = ok(
      await post(`${day}/groups/${groupId}/checks`, t.lead.cookie, { checkpoint: 'Varış' }),
      201,
    )
    const check = ((started.groups as Json[])[0]?.checks as Json[])[0] as Json
    ok(
      await post(`${day}/checks/${String(check.id)}/marks`, t.lead.cookie, {
        marks: [
          { studentId: 's-1', status: 'present' },
          { studentId: 's-2', status: 'present' },
          { studentId: 's-3', status: 'absent' },
        ],
      }),
    )
    const marked = ok(await get(day, t.lead.cookie))
    const version = (((marked.groups as Json[])[0]?.checks as Json[])[0] as Json).version
    ok(
      await versioned(
        'POST',
        `${day}/checks/${String(check.id)}/proceed`,
        t.lead.cookie,
        { reason: 'Ali veliyle ayrıldı, müdür bilgilendirildi.' },
        version,
      ),
    )
    now = AFTER_TRIP
    return planId
  }

  async function upload(t: Tenant, cookie: string) {
    const body = multipart(uploadParts('question_image', png(), 'gezi.png', 'image/png'))
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': body.contentType,
        'idempotency-key': randomUUID(),
      },
      payload: body.payload,
    })
    assert.equal(response.statusCode, 201, response.body)
    const id: string = response.json().data.id
    await recordFileCheck(db, store.storage, {
      institutionId: t.id,
      fileId: id,
      outcome: 'ready',
      now,
      log: app.log,
    })
    return id
  }

  /** Velinin çocuğu için fotoğraf paylaşım rızası; rıza kimliği döner. */
  async function grantSharing(t: Tenant, cookie: string, studentId: string) {
    const response = await post('/api/v1/consents', cookie, {
      purpose: 'photo_video_sharing',
      studentId,
      textId: t.sharingTextId,
      channel: 'web',
    })
    assert.equal(response.statusCode, 201, response.body)
    return String(response.json().data.id)
  }

  async function submittedReport(t: Tenant, planId: string) {
    const created = reportOf(
      ok(
        await post(reportUrl(planId), t.lead.cookie, { summary: SUMMARY, outcomeNote: OUTCOME }),
        201,
      ),
    )
    return reportOf(
      ok(
        await versioned('POST', `${reportUrl(planId)}/submit`, t.lead.cookie, {}, created.version),
      ),
    )
  }

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    assertError(await get(LIST, null), 401)
    assertError(await get(MY, null), 401)
    assertError(await post(EVALUATIONS, null, {}), 401)
    assertError(await get(reportUrl(id), null), 401)
    assertError(await post(reportUrl(id), null, {}), 401)
    assertError(await versioned('PATCH', reportUrl(id), null, { summary: 'x' }, 1), 401)
    for (const verb of ['submit', 'approve', 'return'])
      assertError(await versioned('POST', `${reportUrl(id)}/${verb}`, null, {}, 1), 401)
    assertError(await post(photosUrl(id), null, {}), 401)
    assertError(await versioned('PATCH', photoUrl(id, id), null, { caption: 'x' }, 1), 401)
    assertError(await versioned('DELETE', photoUrl(id, id), null, undefined, 1), 401)
  })

  test('DOM-FIN-158: rol ve modül süzgeci 403 (K-529)', async () => {
    const t = await institution()
    const id = randomUUID()
    assertError(await get(reportUrl(id), t.mother), 403)
    assertError(await get(LIST, t.ali), 403)
    assertError(await get(MY, t.admin), 403)
    assertError(await post(EVALUATIONS, t.lead.cookie, {}), 403)
    assertError(await post(reportUrl(id), t.desk, {}), 403)
    assertError(await post(photosUrl(id), t.desk, {}), 403)
    assertError(await versioned('POST', `${reportUrl(id)}/approve`, t.lead.cookie, {}, 1), 403)
    assertError(
      await versioned('POST', `${reportUrl(id)}/return`, t.lead.cookie, { reason: 'Eksik' }, 1),
      403,
    )
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(reportUrl(id), closed.admin), 403, 'module_disabled')
    assertError(await get(LIST, closed.admin), 403, 'module_disabled')
    assertError(await get(MY, closed.mother), 403, 'module_disabled')
  })

  test('DOM-FIN-158: rapor gezi bitince açılır; tek rapor, mükerrer istek, görevli olmayan 404 (K-529)', async () => {
    const t = await institution()
    const planId = await approvedPlan(t)
    // Gezi bitmeden: görünüm açılır, rapor yazılamaz.
    const early = ok(await get(reportUrl(planId), t.lead.cookie))
    assert.equal(early.report, null)
    assert.equal(early.tripFinished, false)
    assert.equal(early.canCreate, false)
    const before = await snapshot(t.id)
    assertError(
      await post(reportUrl(planId), t.lead.cookie, {}),
      422,
      'trip_report_trip_not_finished',
    )
    now = AFTER_TRIP
    assertError(await get(reportUrl(planId), t.stranger), 404)
    assertError(await post(reportUrl(planId), t.stranger, {}), 404)
    assertError(await post(reportUrl(planId), t.lead.cookie, { institutionId: t.id }), 400)
    assertError(await call('POST', reportUrl(planId), t.lead.cookie, {}), 400)
    assertError(await post(reportUrl(randomUUID()), t.lead.cookie, {}), 404)
    assert.equal(await snapshot(t.id), before)

    const key = randomUUID()
    const body = { summary: SUMMARY }
    const first = ok(await post(reportUrl(planId), t.lead.cookie, body, key), 201)
    const report = reportOf(first)
    assert.equal(report.status, 'draft')
    assert.equal(report.summary, SUMMARY)
    assert.equal(report.outcomeNote, null)
    assert.equal(report.canEdit, true)
    assert.equal(report.canDecide, false)
    assert.deepEqual(first.attendance, {
      source: 'none',
      rosterCount: 0,
      attendedCount: 0,
      absentCount: 0,
      frozen: false,
    })
    const replay = await post(reportUrl(planId), t.lead.cookie, body, key)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(await post(reportUrl(planId), t.admin, {}), 409, 'trip_report_exists')
    assert.equal(
      (await db.select().from(tripReports).where(eq(tripReports.institutionId, t.id))).length,
      1,
    )
    assert.deepEqual((await audits(t.id, 'finance.trip_report.create'))[0]?.changes, {
      fields: ['planId', 'summary'],
    })
    // Görevli öğretmen ve ön büro okur; ön büro yazamaz.
    const assistant = reportOf(ok(await get(reportUrl(planId), t.assistant.cookie)))
    assert.equal(assistant.canEdit, true)
    const desk = ok(await get(reportUrl(planId), t.desk))
    assert.equal(reportOf(desk).canEdit, false)
    assert.equal(desk.options, null)
    // İptal edilmiş ya da onaylanmamış plan.
    const draftPlan = ok(
      await post(PLANS, t.admin, {
        name: 'Taslak gezi',
        purpose: 'Onaylanmamış planın raporu açılmaz denemesi.',
        departureAt: '2026-11-20T05:00:00.000Z',
        returnAt: '2026-11-20T17:00:00.000Z',
        expectedStudentCount: 3,
        stops: [{ place: 'Müze' }],
        staff: [{ membershipId: t.lead.membershipId, role: 'lead' }],
        transport: { type: 'walking' },
        risks: [],
        emergencyContacts: [],
      }),
      201,
    )
    assertError(
      await post(reportUrl(draftPlan.id), t.admin, {}),
      422,
      'trip_report_plan_not_eligible',
    )
  })

  test('DOM-FIN-158: taslak, gönderim, iade, yeniden gönderim, onay ve kilit; katılım yoklamadan (K-529)', async () => {
    const t = await institution()
    const planId = await finishedTrip(t)
    const created = reportOf(ok(await post(reportUrl(planId), t.lead.cookie, {}), 201))
    const live = ok(await get(reportUrl(planId), t.lead.cookie))
    assert.deepEqual(live.attendance, {
      source: 'trip_day',
      rosterCount: 3,
      attendedCount: 2,
      absentCount: 1,
      frozen: false,
    })
    const studentOptions = (live.options as Json).students as Json[]
    assert.deepEqual(
      studentOptions.map((row) => [row.studentId, row.attended, row.consent]),
      [
        ['s-3', false, false],
        ['s-1', true, false],
        ['s-2', true, false],
      ],
    )
    assertError(
      await versioned('POST', `${reportUrl(planId)}/submit`, t.lead.cookie, {}, created.version),
      422,
      'trip_report_incomplete',
    )
    assertError(
      await versioned(
        'PATCH',
        reportUrl(planId),
        t.lead.cookie,
        { summary: null },
        created.version,
      ),
      422,
      'trip_report_unchanged',
    )
    const edited = reportOf(
      ok(
        await versioned(
          'PATCH',
          reportUrl(planId),
          t.lead.cookie,
          { summary: SUMMARY, outcomeNote: OUTCOME, incidentNote: 'Olay yaşanmadı.' },
          created.version,
        ),
      ),
    )
    assertError(
      await versioned(
        'PATCH',
        reportUrl(planId),
        t.lead.cookie,
        { summary: 'Eski sürüm' },
        created.version,
      ),
      409,
    )
    const submitted = ok(
      await versioned('POST', `${reportUrl(planId)}/submit`, t.lead.cookie, {}, edited.version),
    )
    assert.equal(reportOf(submitted).status, 'submitted')
    assert.equal((submitted.attendance as Json).frozen, true)
    assert.equal(submitted.options, null)
    assertError(
      await versioned(
        'PATCH',
        reportUrl(planId),
        t.lead.cookie,
        { summary: `${SUMMARY} Ek.` },
        reportOf(submitted).version,
      ),
      422,
      'trip_report_locked',
    )
    assertError(
      await versioned(
        'POST',
        `${reportUrl(planId)}/return`,
        t.admin,
        { reason: 'kısa' },
        reportOf(submitted).version,
      ),
      400,
    )
    const returned = reportOf(
      ok(
        await versioned(
          'POST',
          `${reportUrl(planId)}/return`,
          t.admin,
          { reason: 'Kazanım bölümünü örneklerle açın.' },
          reportOf(submitted).version,
        ),
      ),
    )
    assert.equal(returned.status, 'returned')
    assert.equal(returned.returnReason, 'Kazanım bölümünü örneklerle açın.')
    assertError(
      await versioned('POST', `${reportUrl(planId)}/approve`, t.admin, {}, returned.version),
      422,
      'trip_report_not_submitted',
    )
    const fixed = reportOf(
      ok(
        await versioned(
          'PATCH',
          reportUrl(planId),
          t.assistant.cookie,
          { outcomeNote: `${OUTCOME} Öğrenciler sunum hazırladı.` },
          returned.version,
        ),
      ),
    )
    const again = reportOf(
      ok(
        await versioned(
          'POST',
          `${reportUrl(planId)}/submit`,
          t.assistant.cookie,
          {},
          fixed.version,
        ),
      ),
    )
    assert.equal(again.returnReason, null)
    const approved = ok(
      await versioned('POST', `${reportUrl(planId)}/approve`, t.admin, {}, again.version),
    )
    assert.equal(reportOf(approved).status, 'approved')
    assert.equal(reportOf(approved).canEdit, false)
    assert.equal(reportOf(approved).decidedByName, 'Test Yönetici')
    assertError(
      await versioned(
        'PATCH',
        reportUrl(planId),
        t.admin,
        { summary: `${SUMMARY} Ek.` },
        reportOf(approved).version,
      ),
      422,
      'trip_report_locked',
    )
    assert.equal((await audits(t.id, 'finance.trip_report.submit')).length, 2)
    assert.deepEqual((await audits(t.id, 'finance.trip_report.return'))[0]?.changes, {
      fields: ['status', 'decidedAt', 'returnReason'],
    })
    // Veritabanı son güvencesi: onaylanan rapor değişmez.
    await assert.rejects(
      db.execute(sql`update trip_reports set summary = 'değişti' where institution_id = ${t.id}`),
      immutable('approved trip report is immutable'),
    )
  })

  test('DOM-FIN-158: kaza tutanağı bağı yalnız gezi süresindeki tutanak; ayrıntı dönmez (K-529)', async () => {
    const t = await institution()
    const planId = await finishedTrip(t)
    now = ON_TRIP
    const incident = await post('/api/v1/finance/incidents', t.admin, {
      injured: { kind: 'student', studentId: 's-2' },
      occurredAt: '2026-10-20T06:30:00.000Z',
      location: 'Müze merdiveni',
      kind: 'fall',
      description: 'Ece merdivende ayağı kayarak düştü, dizini çarptı.',
      bodyParts: ['knee'],
      severity: 'minor',
      firstAid: { byMembershipId: t.lead.membershipId, action: 'Soğuk uygulama yapıldı.' },
      referral: 'none',
      witnessMembershipIds: [],
      responsibleMembershipId: t.lead.membershipId,
    })
    now = AFTER_TRIP
    assert.equal(incident.statusCode, 201, incident.body)
    const incidentId = String(incident.json().data.id)
    const view = ok(await get(reportUrl(planId), t.lead.cookie))
    assert.deepEqual(
      ((view.options as Json).incidents as Json[]).map((row) => row.id),
      [incidentId],
    )
    assertError(
      await post(reportUrl(planId), t.lead.cookie, { incidentIds: [randomUUID()] }),
      422,
      'trip_report_incident_not_found',
    )
    const created = reportOf(
      ok(await post(reportUrl(planId), t.lead.cookie, { incidentIds: [incidentId] }), 201),
    )
    const incidents = created.incidents as Json[]
    assert.deepEqual(Object.keys(incidents[0] ?? {}).sort(), [
      'id',
      'kind',
      'location',
      'occurredAt',
      'status',
    ])
    const cleared = reportOf(
      ok(
        await versioned(
          'PATCH',
          reportUrl(planId),
          t.lead.cookie,
          { incidentIds: [] },
          created.version,
        ),
      ),
    )
    assert.deepEqual(cleared.incidents, [])
  })

  test('DOM-FIN-158: fotoğraf etiketi, rıza rozeti ve okuma anında yayım; rıza geri çekilince düşer (K-530, IST-017)', async () => {
    const t = await institution()
    const planId = await finishedTrip(t)
    const consentId = await grantSharing(t, t.mother, 's-1')
    reportOf(
      ok(
        await post(reportUrl(planId), t.lead.cookie, { summary: SUMMARY, outcomeNote: OUTCOME }),
        201,
      ),
    )
    const denizFile = await upload(t, t.lead.cookie)
    const eceFile = await upload(t, t.lead.cookie)
    const viewFile = await upload(t, t.lead.cookie)
    const before = await snapshot(t.id)
    assertError(await post(photosUrl(planId), t.lead.cookie, { fileId: denizFile }), 400)
    assertError(
      await post(photosUrl(planId), t.lead.cookie, { fileId: denizFile, studentIds: ['s-4'] }),
      422,
      'trip_report_photo_student_not_participant',
    )
    assertError(
      await post(photosUrl(planId), t.assistant.cookie, { fileId: denizFile, studentIds: ['s-1'] }),
      422,
      'file_unavailable',
    )
    assert.equal(await snapshot(t.id), before)

    const key = randomUUID()
    const first = await post(
      photosUrl(planId),
      t.lead.cookie,
      { fileId: denizFile, studentIds: ['s-1'], caption: 'Anıtkabir' },
      key,
    )
    ok(first, 201)
    const replay = await post(
      photosUrl(planId),
      t.lead.cookie,
      { fileId: denizFile, studentIds: ['s-1'], caption: 'Anıtkabir' },
      key,
    )
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    ok(
      await post(photosUrl(planId), t.lead.cookie, { fileId: eceFile, studentIds: ['s-1', 's-2'] }),
      201,
    )
    const withAll = ok(
      await post(photosUrl(planId), t.lead.cookie, { fileId: viewFile, noStudentsVisible: true }),
      201,
    )
    const photos = reportOf(withAll).photos
    assert.deepEqual(
      photos.map((photo) => [photo.fileId, photo.visibility]),
      [
        [denizFile, 'awaiting_approval'],
        [eceFile, 'consent_missing'],
        [viewFile, 'awaiting_approval'],
      ],
    )
    assert.deepEqual(
      photos[1]?.students.map((student) => [student.studentId, student.consent]),
      [
        ['s-1', true],
        ['s-2', false],
      ],
    )
    assert.equal(
      (await db.select().from(files).where(eq(files.id, denizFile)))[0]?.attachedId,
      reportOf(withAll).id,
    )
    // Genel dosya ucu açılmaz; bağlantı yalnız rapor görünümünden.
    assertError(await get(`/api/v1/files/${denizFile}/url`, t.lead.cookie), 404)
    const read = reportOf(ok(await get(reportUrl(planId), t.desk)))
    assert.match(String(read.photos[0]?.url), /^http/)

    // Düzeltme: Ece'nin fotoğrafı yalnız iç arşivde kalsın; sonra kaldır.
    const internal = reportOf(
      ok(
        await versioned(
          'PATCH',
          photoUrl(planId, photos[1]?.id),
          t.lead.cookie,
          { shareWithFamilies: false },
          photos[1]?.version,
        ),
      ),
    )
    assert.equal(internal.photos[1]?.visibility, 'internal')
    assertError(
      await versioned(
        'PATCH',
        photoUrl(planId, photos[1]?.id),
        t.lead.cookie,
        { shareWithFamilies: false },
        internal.photos[1]?.version,
      ),
      422,
      'trip_report_photo_unchanged',
    )
    assertError(
      await versioned(
        'PATCH',
        photoUrl(planId, photos[1]?.id),
        t.lead.cookie,
        { noStudentsVisible: true },
        internal.photos[1]?.version,
      ),
      422,
      'trip_report_photo_tags_required',
    )
    const removed = reportOf(
      ok(
        await versioned(
          'DELETE',
          photoUrl(planId, photos[1]?.id),
          t.lead.cookie,
          undefined,
          internal.photos[1]?.version,
        ),
      ),
    )
    assert.equal(removed.photos.length, 2)
    assert.equal((await db.select().from(files).where(eq(files.id, eceFile)))[0]?.attachedId, null)

    // Onay: rızası tam fotoğraflar ailelere yayımlanır.
    const submitted = reportOf(
      ok(
        await versioned('POST', `${reportUrl(planId)}/submit`, t.lead.cookie, {}, removed.version),
      ),
    )
    assertError(
      await post(photosUrl(planId), t.lead.cookie, { fileId: eceFile, studentIds: ['s-2'] }),
      422,
      'trip_report_locked',
    )
    const approved = reportOf(
      ok(await versioned('POST', `${reportUrl(planId)}/approve`, t.admin, {}, submitted.version)),
    )
    assert.deepEqual(
      approved.photos.map((photo) => photo.visibility),
      ['published', 'published'],
    )
    const family = ok(await get(MY, t.mother)) as unknown as Json[]
    assert.equal(family.length, 1)
    const familyPhotos = family[0]?.photos as Json[]
    assert.equal(familyPhotos.length, 2)
    assert.deepEqual(Object.keys(familyPhotos[0] ?? {}).sort(), [
      'caption',
      'contentType',
      'expiresAt',
      'id',
      'url',
    ])
    assert.match(String(familyPhotos[0]?.url), /^http/)
    assert.equal((family[0]?.evaluation as Json).open, true)

    // Rıza geri çekilince Deniz'in fotoğrafı bir sonraki okumada yayından düşer.
    const withdrawn = await call('POST', `/api/v1/consents/${consentId}/withdraw`, t.mother, {})
    assert.equal(withdrawn.statusCode, 200, withdrawn.body)
    const after = ok(await get(MY, t.mother)) as unknown as Json[]
    assert.deepEqual(
      (after[0]?.photos as Json[]).map((photo) => photo.id),
      [approved.photos[1]?.id],
    )
    const staff = reportOf(ok(await get(reportUrl(planId), t.admin)))
    assert.equal(staff.photos[0]?.visibility, 'consent_missing')
    // Onaylı raporun fotoğrafı veritabanında da donar.
    await assert.rejects(
      db.execute(sql`update trip_report_photos set caption = 'x' where institution_id = ${t.id}`),
      immutable('approved trip report content is immutable'),
    )
  })

  test('DOM-FIN-158: değerlendirme yalnız katılana, gezi başına bir kez; özet 5 yanıttan azken gizli, yorum adsız (K-531)', async () => {
    const t = await institution()
    const planId = await approvedPlan(t)
    const body = { planId, studentId: 's-1', score: 5, comment: 'Çok güzel bir geziydi.' }
    assertError(await post(EVALUATIONS, t.mother, body), 422, 'trip_evaluation_not_open')
    const tripPlanId = await finishedTrip(t)
    const evalBody = { ...body, planId: tripPlanId }
    now = ON_TRIP
    assertError(await post(EVALUATIONS, t.mother, evalBody), 422, 'trip_evaluation_not_open')
    now = AFTER_TRIP
    assertError(
      await post(EVALUATIONS, t.mother, { ...evalBody, studentId: 's-2' }),
      404,
      'not_found',
    )
    assertError(
      await post(EVALUATIONS, t.ali, { ...evalBody, studentId: 's-3' }),
      422,
      'trip_evaluation_not_attended',
    )
    assertError(await post(EVALUATIONS, t.mother, { ...evalBody, score: 6 }), 400)
    assertError(await post(EVALUATIONS, t.mother, { ...evalBody, institutionId: t.id }), 400)
    const key = randomUUID()
    const created = ok(await post(EVALUATIONS, t.mother, evalBody, key), 201)
    assert.equal(created.score, 5)
    const replay = await post(EVALUATIONS, t.mother, evalBody, key)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(
      await post(EVALUATIONS, t.mother, { ...evalBody, score: 3 }),
      409,
      'trip_evaluation_exists',
    )
    assert.deepEqual((await audits(t.id, 'finance.trip_evaluation.create'))[0]?.changes, {
      fields: ['planId', 'studentId', 'score', 'comment'],
    })
    const mine = (ok(await get(MY, t.mother)) as unknown as Json[])[0]?.evaluation as Json
    assert.equal(mine.open, false)
    assert.equal((mine.mine as Json).score, 5)

    const few = ok(await get(reportUrl(tripPlanId), t.admin)).evaluations as Json
    assert.deepEqual(few, {
      responses: 1,
      hidden: true,
      average: null,
      distribution: null,
      comments: null,
    })
    // Dört veli daha: özet beş yanıtta açılır, yorumlar ad ve rol taşımaz.
    for (const [index, score] of [4, 4, 3, 2].entries()) {
      const parent = await signInAs(
        app,
        await createMember(app, t.id, 'veli', [
          { kind: 'child', recordId: index % 2 === 0 ? 's-1' : 's-2' },
        ]),
      )
      ok(
        await post(EVALUATIONS, parent, {
          planId: tripPlanId,
          studentId: index % 2 === 0 ? 's-1' : 's-2',
          score,
          ...(index === 0 ? { comment: 'Rehber anlatımı iyiydi.' } : {}),
        }),
        201,
      )
    }
    const summary = ok(await get(reportUrl(tripPlanId), t.lead.cookie)).evaluations as Json
    assert.deepEqual(summary, {
      responses: 5,
      hidden: false,
      average: 3.6,
      distribution: [0, 1, 1, 2, 1],
      comments: ['Çok güzel bir geziydi.', 'Rehber anlatımı iyiydi.'],
    })
    now = new Date('2026-11-25T08:00:00.000Z')
    const late = await signInAs(
      app,
      await createMember(app, t.id, 'veli', [{ kind: 'child', recordId: 's-2' }]),
    )
    assertError(
      await post(EVALUATIONS, late, { ...evalBody, studentId: 's-2' }),
      422,
      'trip_evaluation_closed',
    )
  })

  test('DOM-FIN-158: liste biten gezileri gösterir; öğretmen yalnız görevlisi olduğu planı (K-529)', async () => {
    const t = await institution()
    const planId = await finishedTrip(t)
    const missing = await get(`${LIST}?status=missing`, t.admin)
    assert.equal(missing.statusCode, 200, missing.body)
    assert.deepEqual(
      (missing.json().data as Json[]).map((row) => [row.planId, row.status]),
      [[planId, 'missing']],
    )
    const report = await submittedReport(t, planId)
    const rows = (await get(LIST, t.lead.cookie)).json()
    assert.equal(rows.meta.total, 1)
    assert.equal(rows.data[0].status, 'submitted')
    assert.equal(rows.data[0].reportId, report.id)
    assert.equal(rows.data[0].authorName, 'Test Kullanıcı')
    assert.equal((await get(LIST, t.stranger)).json().meta.total, 0)
    assert.equal((await get(`${LIST}?status=approved`, t.desk)).json().meta.total, 0)
    assertError(await get(`${LIST}?status=bilinmeyen`, t.admin), 400)
  })

  test('DOM-FIN-158: başka kurumun raporu 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bPlan = await finishedTrip(b)
    const bReport = await submittedReport(b, bPlan)
    const bFile = await upload(b, b.lead.cookie)
    now = AFTER_TRIP
    const before = await snapshot(b.id)
    const bUrl = reportUrl(bPlan)
    assertError(await get(bUrl, a.admin), 404)
    assertError(await post(bUrl, a.admin, {}), 404)
    assertError(await versioned('PATCH', bUrl, a.admin, { summary: SUMMARY }, bReport.version), 404)
    for (const verb of ['submit', 'approve'])
      assertError(await versioned('POST', `${bUrl}/${verb}`, a.admin, {}, bReport.version), 404)
    assertError(
      await versioned(
        'POST',
        `${bUrl}/return`,
        a.admin,
        { reason: 'Başka kurum denemesi' },
        bReport.version,
      ),
      404,
    )
    assertError(
      await post(photosUrl(bPlan), a.admin, { fileId: bFile, noStudentsVisible: true }),
      404,
    )
    assertError(
      await versioned('PATCH', photoUrl(bPlan, randomUUID()), a.admin, { caption: 'x' }, 1),
      404,
    )
    assertError(
      await versioned('DELETE', photoUrl(bPlan, randomUUID()), a.admin, undefined, 1),
      404,
    )
    assertError(
      await post(EVALUATIONS, a.mother, { planId: bPlan, studentId: 's-1', score: 5 }),
      404,
      'not_found',
    )
    const list = (await get(LIST, a.admin)).json()
    assert.equal(list.meta.total, 0)
    assert.deepEqual(ok(await get(MY, a.mother)), [] as unknown as Json)
    assertError(
      await post(EVALUATIONS, b.mother, {
        planId: bPlan,
        studentId: 's-1',
        score: 5,
        institutionId: a.id,
      }),
      400,
    )
    assert.equal(await snapshot(b.id), before)
  })
})
