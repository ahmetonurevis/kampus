import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { memberships } from '../src/db/schema/auth.ts'
import { files } from '../src/db/schema/files.ts'
import { staffMedicalReports } from '../src/db/schema/finance-medical-reports.ts'
import { ensureMember } from '../src/services/identity.ts'
import { medicalReportDaysFor } from '../src/services/finance-medical-reports.ts'
import { recordFileCheck } from '../src/services/files.ts'
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
import { multipart, PDF, tempStorage, uploadParts } from './support/files-sample.ts'

/**
 * Personel sağlık raporu uçları (DOM-FIN-110; ON-185; K-363…K-365). Her test kendi kurumunu kurar;
 * personel adlı kullanıcıyla açılır. FIXED_NOW 2026-10-06 (Europe/Istanbul günü de 2026-10-06).
 */

const REPORTS = '/api/v1/finance/medical-reports'
const SUMMARY = '/api/v1/finance/medical-report-summary'

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-110: personel sağlık raporu uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  let tenantCount = 0
  let clientIp = '10.110.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    store = await tempStorage()
    app = await buildTestApp(db, { storage: store.storage, clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
    await store.remove()
  })

  const key = () => ({ 'idempotency-key': randomUUID() })
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
    clientIp = `10.110.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  /** Adlı personel ya da veli üyeliği (giriş yapmaz). */
  async function person(t: Tenant, role: Role, name: string) {
    const user = await createUser(app, { name })
    const membership = await ensureMember(app.auth, db, {
      institutionId: t.id,
      userId: user.id,
      role,
    })
    return membership.id
  }
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))
  const report = (membershipId: string, extra: Json = {}): Json => ({
    membershipId,
    reportType: 'sickness',
    startDate: '2026-10-05',
    endDate: '2026-10-07',
    ...extra,
  })
  const create = (cookie: string, body: Json, headers: Record<string, string> = key()) =>
    call('POST', REPORTS, cookie, body, headers)
  const created = async (cookie: string, body: Json) => ok(await create(cookie, body), 201)
  const patch = (cookie: string, item: Json, body: Json) =>
    call('PATCH', `${REPORTS}/${String(item.id)}`, cookie, body, ifMatch(item.version))
  const cancel = (cookie: string, item: Json, reason = 'Yanlış personel seçildi') =>
    call(
      'POST',
      `${REPORTS}/${String(item.id)}/cancel`,
      cookie,
      { reason },
      {
        ...ifMatch(item.version),
        ...key(),
      },
    )
  const rowsOf = (institutionId: string) =>
    db
      .select()
      .from(staffMedicalReports)
      .where(eq(staffMedicalReports.institutionId, institutionId))
  const listOf = async (cookie: string, query = '') => {
    const response = await get(`${REPORTS}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: Json & { total: number } }
  }
  const summaryOf = async (cookie: string, query = '') => {
    const response = await get(`${SUMMARY}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: Json & { total: number } }
  }
  const auditOf = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  async function upload(t: Tenant, cookie = t.admin) {
    const body = multipart(uploadParts('document', PDF, 'rapor.pdf'))
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      remoteAddress: clientIp,
      headers: { origin: TEST_ORIGIN, cookie, 'content-type': body.contentType, ...key() },
      payload: body.payload,
    })
    assert.equal(response.statusCode, 201, response.body)
    const id: string = response.json().data.id
    await recordFileCheck(db, store.storage, {
      institutionId: t.id,
      fileId: id,
      outcome: 'ready',
      now: FIXED_NOW,
      log: app.log,
    })
    return id
  }

  test('kimliksiz istek 401', async () => {
    const url = `${REPORTS}/${randomUUID()}`
    assertError(await get(REPORTS, null), 401)
    assertError(await get(SUMMARY, null), 401)
    assertError(await call('POST', REPORTS, null, report('m-1'), key()), 401)
    assertError(await call('PATCH', url, null, { employerNotified: true }, ifMatch(1)), 401)
    assertError(
      await call(
        'POST',
        `${url}/cancel`,
        null,
        { reason: 'Yanlış kayıt' },
        {
          ...ifMatch(1),
          ...key(),
        },
      ),
      401,
    )
  })

  test('DOM-FIN-110: ön büro, öğretmen, veli ve öğrenci 403; rapor değişmez (K-363)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const item = await created(t.admin, report(selin))
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(REPORTS, cookie), 403)
      assertError(await get(SUMMARY, cookie), 403)
      assertError(
        await create(cookie, report(selin, { startDate: '2026-10-10', endDate: '2026-10-10' })),
        403,
      )
      assertError(await patch(cookie, item, { employerNotified: true }), 403)
      assertError(await cancel(cookie, item), 403)
    }
    const rows = await rowsOf(t.id)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.version, 1)
    assert.equal(rows[0]?.archivedAt, null)
    assert.equal(rows[0]?.employerNotifiedAt, null)
    assert.equal((await auditOf(t.id, 'finance.medical_report.read')).length, 0)
  })

  test('DOM-FIN-110: finance modülü kapalıyken rapor uçları 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(REPORTS, closed.admin), 403, 'module_disabled')
    assertError(await get(SUMMARY, closed.admin), 403, 'module_disabled')
    assertError(await create(closed.admin, report('m-1')), 403, 'module_disabled')
  })

  test('DOM-FIN-110: rapor girilir; gün sayısı takvim günü, denetimde yalnız alan adları (K-363, K-364)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const item = await created(
      t.admin,
      report(selin, { reportType: 'work_accident', issuerType: 'public' }),
    )
    assert.equal(item.dayCount, 3)
    assert.equal(item.state, 'ongoing')
    assert.equal(item.staffName, 'Selin Kaya')
    assert.equal(item.issuerType, 'public')
    assert.equal(item.fileId, null)
    assert.equal(item.employerNotifiedAt, null)
    const [row] = await rowsOf(t.id)
    assert.equal(row?.reportType, 'work_accident')
    assert.equal(row?.startDate, '2026-10-05')
    assert.equal(row?.endDate, '2026-10-07')
    assert.equal(row?.dayCount, 3)
    const [audit] = await auditOf(t.id, 'finance.medical_report.create')
    assert.deepEqual(audit?.changes, {
      fields: ['membershipId', 'reportType', 'startDate', 'endDate', 'issuerType'],
    })
    assert.equal(JSON.stringify(audit).includes('work_accident'), false, 'tür denetime yazılmaz')
    assert.equal(JSON.stringify(audit).includes('2026-10-05'), false, 'tarih denetime yazılmaz')
  })

  test('DOM-FIN-110: geçersiz gövde 400, kural reddi 422; kayıt değişmez (K-363, K-364)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const parent = await person(t, 'veli', 'Ayşe Yılmaz')
    const left = await person(t, 'onburo', 'Ayrılan Personel')
    await db
      .update(memberships)
      .set({ deactivatedAt: new Date('2026-10-01T09:00:00.000Z') })
      .where(eq(memberships.id, left))
    await created(t.admin, report(selin))
    const before = await rowsOf(t.id)

    for (const body of [
      report(selin, { diagnosis: 'Grip' }),
      report(selin, { icdCode: 'J11' }),
      report(selin, { note: 'Serbest not' }),
      report(selin, { reportType: 'flu' }),
      report(selin, { startDate: '2026-10-08', endDate: '2026-10-07' }),
      report(selin, { startDate: '2026-01-01', endDate: '2027-01-02' }),
      report(selin, { issuerType: 'hospital' }),
    ])
      assertError(await create(t.admin, body), 400)
    assertError(
      await create(t.admin, report(selin, { startDate: '2026-10-20', endDate: '2026-10-21' }), {}),
      400,
      'idempotency_key_required',
    )
    assertError(
      await create(t.admin, report(selin, { startDate: '2026-10-07', endDate: '2026-10-09' })),
      422,
      'medical_report_overlap',
    )
    assertError(await create(t.admin, report(randomUUID())), 422, 'medical_report_staff_not_found')
    assertError(await create(t.admin, report(parent)), 422, 'medical_report_not_staff')
    assertError(
      await create(t.admin, report(left, { startDate: '2026-10-02', endDate: '2026-10-03' })),
      422,
      'medical_report_after_leave',
    )
    assertError(
      await create(t.admin, report(selin, { startDate: '2027-04-05', endDate: '2027-04-05' })),
      422,
      'medical_report_start_too_far',
    )
    assert.deepEqual(await rowsOf(t.id), before)
    // Pasif personele ayrıldığı güne kadar başlayan rapor girilir (son bordro dönemi).
    await created(t.admin, report(left, { startDate: '2026-09-29', endDate: '2026-10-02' }))
  })

  test('DOM-FIN-110: liste ve dönem özeti; okuma denetime düşer (K-365)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const ahmet = await person(t, 'onburo', 'Ahmet Ön')
    await created(t.admin, report(selin, { startDate: '2026-09-29', endDate: '2026-10-02' }))
    await created(
      t.admin,
      report(selin, {
        reportType: 'work_accident',
        startDate: '2026-10-30',
        endDate: '2026-11-02',
      }),
    )
    await created(t.admin, report(ahmet, { startDate: '2026-11-10', endDate: '2026-11-12' }))

    const all = await listOf(t.admin)
    assert.equal(all.meta.total, 3)
    assert.equal(all.meta.period, null)
    assert.deepEqual(
      all.data.map((item) => item.startDate),
      ['2026-11-10', '2026-10-30', '2026-09-29'],
    )
    const october = await listOf(t.admin, '?from=2026-10-01&to=2026-10-31')
    assert.equal(october.meta.total, 2)
    assert.deepEqual(october.meta.period, { from: '2026-10-01', to: '2026-10-31' })
    assert.deepEqual(
      october.data.map((item) => item.daysInPeriod),
      [2, 2],
    )
    assert.equal((await listOf(t.admin, `?membershipId=${ahmet}`)).meta.total, 1)
    assert.equal((await listOf(t.admin, '?reportType=work_accident')).meta.total, 1)

    // Varsayılan dönem bugünün ayı (Ekim 2026); bütün personel listelenir.
    const summary = await summaryOf(t.admin)
    assert.deepEqual(summary.meta.period, { from: '2026-10-01', to: '2026-10-31' })
    const selinRow = summary.data.find((row) => row.membershipId === selin)
    assert.equal(selinRow?.totalDays, 4)
    assert.deepEqual(selinRow?.byType, {
      sickness: 2,
      work_accident: 2,
      occupational_disease: 0,
      maternity: 0,
    })
    assert.equal(selinRow?.reportCount, 2)
    assert.equal(selinRow?.awaitingNoticeCount, 2)
    assert.equal(summary.data.find((row) => row.membershipId === ahmet)?.totalDays, 0)
    const withReports = await summaryOf(t.admin, '?from=2026-11-01&withReports=true')
    assert.deepEqual(withReports.meta.period, { from: '2026-11-01', to: '2026-11-30' })
    assert.deepEqual(
      withReports.data.map((row) => [row.membershipId, row.totalDays]),
      [
        [ahmet, 3],
        [selin, 2],
      ],
    )
    assertError(
      await get(`${SUMMARY}?from=2026-10-02&to=2026-10-01`, t.admin),
      422,
      'medical_report_period_invalid',
    )
    assertError(
      await get(`${REPORTS}?from=2026-01-01&to=2027-01-02`, t.admin),
      422,
      'medical_report_period_too_long',
    )
    assertError(await get(`${REPORTS}?state=all`, t.admin), 400)

    const reads = await auditOf(t.id, 'finance.medical_report.read')
    assert.equal(reads.length, 6)
    assert.deepEqual(reads[0]?.changes, { fields: ['reportType', 'startDate', 'endDate'] })
  })

  test('DOM-FIN-110: medicalReportDaysFor dönemdeki rapor günlerini verir (ON-181 girdisi)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const ahmet = await person(t, 'onburo', 'Ahmet Ön')
    const item = await created(
      t.admin,
      report(selin, { startDate: '2026-09-29', endDate: '2026-10-02' }),
    )
    await created(
      t.admin,
      report(selin, { reportType: 'maternity', startDate: '2026-10-20', endDate: '2026-10-21' }),
    )
    const cancelled = await created(
      t.admin,
      report(ahmet, { startDate: '2026-10-05', endDate: '2026-10-06' }),
    )
    ok(await cancel(t.admin, cancelled))
    const days = await medicalReportDaysFor(
      { db, institutionId: t.id },
      { membershipIds: [selin, ahmet], from: '2026-10-01', to: '2026-10-31' },
    )
    assert.deepEqual(days, [
      {
        membershipId: selin,
        totalDays: 4,
        byType: { sickness: 2, work_accident: 0, occupational_disease: 0, maternity: 2 },
        days: ['2026-10-01', '2026-10-02', '2026-10-20', '2026-10-21'],
      },
      {
        membershipId: ahmet,
        totalDays: 0,
        byType: { sickness: 0, work_accident: 0, occupational_disease: 0, maternity: 0 },
        days: [],
      },
    ])
    const everyone = await medicalReportDaysFor(
      { db, institutionId: t.id },
      { from: '2026-09-01', to: '2026-09-30' },
    )
    assert.deepEqual(
      everyone.map((row) => [row.membershipId, row.days]),
      [[selin, ['2026-09-29', '2026-09-30']]],
    )
    // Başka kurumdan okunamaz.
    const other = await institution()
    assert.deepEqual(
      await medicalReportDaysFor(
        { db, institutionId: other.id },
        { membershipIds: [selin], from: '2026-10-01', to: '2026-10-31' },
      ),
      [{ membershipId: selin, totalDays: 0, byType: days[1]?.byType, days: [] }],
    )
    assert.equal(item.dayCount, 4)
  })

  test('DOM-FIN-110: SGK işaretleri; onay bildirimi ister, geri alınır; If-Match denetlenir (K-365)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const item = await created(t.admin, report(selin))
    assertError(
      await patch(t.admin, item, { sgkApproved: true }),
      422,
      'medical_report_sgk_requires_notice',
    )
    assertError(
      await patch(t.admin, item, { employerNotified: false }),
      422,
      'medical_report_unchanged',
    )
    assertError(await patch(t.admin, item, {}), 400)
    assertError(await patch(t.admin, item, { startDate: '2026-10-01' }), 400)
    assertError(
      await call('PATCH', `${REPORTS}/${String(item.id)}`, t.admin, { employerNotified: true }),
      400,
      'if_match_required',
    )
    const both = ok(await patch(t.admin, item, { employerNotified: true, sgkApproved: true }))
    assert.equal(both.employerNotifiedAt, FIXED_NOW.toISOString())
    assert.equal(both.sgkApprovedAt, FIXED_NOW.toISOString())
    assert.equal(both.version, 2)
    assertError(await patch(t.admin, item, { sgkApproved: false }), 409)
    assertError(
      await patch(t.admin, both, { employerNotified: false }),
      422,
      'medical_report_sgk_requires_notice',
    )
    const undone = ok(await patch(t.admin, both, { sgkApproved: false }))
    assert.equal(undone.sgkApprovedAt, null)
    assert.equal(undone.employerNotifiedAt, FIXED_NOW.toISOString())
    const [row] = await rowsOf(t.id)
    assert.equal(row?.sgkApprovedByUserId, null)
    assert.notEqual(row?.employerNotifiedByUserId, null)
    const updates = await auditOf(t.id, 'finance.medical_report.update')
    assert.deepEqual(
      updates.map((audit) => audit.changes),
      [{ fields: ['employerNotified', 'sgkApproved'] }, { fields: ['sgkApproved'] }],
    )
  })

  test('DOM-FIN-110: gerekçeli iptal; ikinci iptal 422, iptal edilen gün hesabına ve çakışmaya girmez (K-364)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const item = await created(t.admin, report(selin))
    assertError(await cancel(t.admin, item, 'yok'), 400)
    assertError(
      await call(
        'POST',
        `${REPORTS}/${String(item.id)}/cancel`,
        t.admin,
        { reason: 'Yanlış kayıt' },
        ifMatch(item.version),
      ),
      400,
      'idempotency_key_required',
    )
    const done = ok(await cancel(t.admin, item))
    assert.equal(done.state, 'cancelled')
    assert.equal(done.cancelReason, 'Yanlış personel seçildi')
    assertError(await cancel(t.admin, done), 422, 'medical_report_cancelled')
    assertError(
      await patch(t.admin, done, { employerNotified: true }),
      422,
      'medical_report_cancelled',
    )
    assert.equal((await listOf(t.admin)).meta.total, 0)
    assert.equal((await listOf(t.admin, '?state=cancelled')).meta.total, 1)
    // Aynı aralık iptalden sonra yeniden girilir.
    await created(t.admin, report(selin))
    const [audit] = await auditOf(t.id, 'finance.medical_report.cancel')
    assert.deepEqual(audit?.changes, { fields: ['archivedAt', 'cancelReason'] })
    assert.equal(
      JSON.stringify(audit).includes('Yanlış personel'),
      false,
      'gerekçe denetime yazılmaz',
    )
  })

  test('DOM-FIN-110: rapor dosyası yalnız yöneticiye açılır, her açılış denetimde; iptalde bağ kalkar (K-363)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const fileId = await upload(t)
    const item = await created(t.admin, report(selin, { fileId }))
    assert.equal(item.fileId, fileId)
    const [file] = await db.select().from(files).where(eq(files.id, fileId))
    assert.equal(file?.attachedType, 'staff_medical_report')
    assert.equal(file?.attachedId, item.id)

    const otherAdmin = await member(t.id, 'yonetici')
    assert.equal((await get(`/api/v1/files/${fileId}/url`, otherAdmin)).statusCode, 200)
    assert.equal((await get(`/api/v1/files/${fileId}`, otherAdmin)).statusCode, 200)
    const opens = await auditOf(t.id, 'finance.medical_report.file_open')
    assert.equal(opens.length, 2)
    assert.equal(opens[0]?.entityId, item.id)
    assert.deepEqual(opens[0]?.changes, { fields: ['fileId'] })
    for (const role of ['onburo', 'ogretmen'] as const)
      assertError(await get(`/api/v1/files/${fileId}/url`, await member(t.id, role)), 404)
    assert.equal((await auditOf(t.id, 'finance.medical_report.file_open')).length, 2)

    // Dosya kaldırılıp yeniden eklenir; başkasının yüklediği dosya bağlanmaz.
    const removed = ok(await patch(t.admin, item, { fileId: null }))
    assert.equal(removed.fileId, null)
    const foreign = await upload(t, otherAdmin)
    assertError(await patch(t.admin, removed, { fileId: foreign }), 422, 'file_unavailable')
    const second = await upload(t)
    const attached = ok(await patch(t.admin, removed, { fileId: second }))
    assert.equal(attached.fileId, second)

    ok(await cancel(t.admin, attached))
    const [detached] = await db.select().from(files).where(eq(files.id, second))
    assert.equal(detached?.attachedId, null)
    assertError(await get(`/api/v1/files/${second}/url`, otherAdmin), 404)
    const [row] = await rowsOf(t.id)
    assert.equal(row?.fileId, null)
  })

  test('DOM-FIN-110: başka kurumun personeli ve raporu 404 ve B değişmez; listede yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bStaff = await person(b, 'ogretmen', 'Beta Öğretmen')
    const bFile = await upload(b)
    const bReport = await created(b.admin, report(bStaff, { fileId: bFile }))
    const bUrl = `${REPORTS}/${String(bReport.id)}`

    assertError(await call('PATCH', bUrl, a.admin, { employerNotified: true }, ifMatch(1)), 404)
    assertError(
      await call(
        'POST',
        `${bUrl}/cancel`,
        a.admin,
        { reason: 'Başka kurum' },
        { ...ifMatch(1), ...key() },
      ),
      404,
    )
    assertError(await get(`/api/v1/files/${bFile}/url`, a.admin), 404)
    assert.equal((await listOf(a.admin)).meta.total, 0)
    assert.equal((await listOf(a.admin, `?membershipId=${bStaff}`)).meta.total, 0)
    assert.equal(
      (await summaryOf(a.admin)).data.some((row) => row.membershipId === bStaff),
      false,
    )
    assertError(await create(a.admin, report(bStaff)), 422, 'medical_report_staff_not_found')
    assertError(await create(a.admin, { ...report(bStaff), institutionId: b.id }), 400)
    const aStaff = await person(a, 'ogretmen', 'Alfa Öğretmen')
    assertError(await create(a.admin, report(aStaff, { fileId: bFile })), 422, 'file_unavailable')
    assert.equal((await rowsOf(a.id)).length, 0)
    const [bRow] = await rowsOf(b.id)
    assert.equal(bRow?.archivedAt, null)
    assert.equal(bRow?.employerNotifiedAt, null)
    assert.equal(bRow?.fileId, bFile)
    assert.equal(bRow?.version, 1)
    assert.equal((await auditOf(b.id, 'finance.medical_report.file_open')).length, 0)
  })

  test('DOM-FIN-110: Idempotency-Key ile yinelenen rapor aynı yanıtı döner, tek satır yazılır', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const headers = key()
    const first = await create(t.admin, report(selin), headers)
    const second = await create(t.admin, report(selin), headers)
    assert.equal(first.statusCode, 201)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal(second.json().data.id, first.json().data.id)
    assert.equal((await rowsOf(t.id)).length, 1)
    // Anahtar yenilenirse aynı aralık çakışır; ikinci satır açılmaz.
    assertError(await create(t.admin, report(selin)), 422, 'medical_report_overlap')
    assert.equal((await rowsOf(t.id)).length, 1)
  })
})
