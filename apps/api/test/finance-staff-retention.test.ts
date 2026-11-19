import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { memberships } from '../src/db/schema/auth.ts'
import { files } from '../src/db/schema/files.ts'
import { staffMedicalReports } from '../src/db/schema/finance-medical-reports.ts'
import { staffPayRates } from '../src/db/schema/finance-pay-rates.ts'
import { staffCertificates } from '../src/db/schema/finance-staff-certificates.ts'
import { staffDocuments } from '../src/db/schema/finance-staff-documents.ts'
import { staffLeaveProfiles } from '../src/db/schema/finance-staff-leave.ts'
import {
  staffDataDestructions,
  staffRetentionSettings,
} from '../src/db/schema/finance-staff-retention.ts'
import { recordFileCheck } from '../src/services/files.ts'
import { ensureMember } from '../src/services/identity.ts'
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
 * Özlük verisi saklama ve imha uçları (DOM-FIN-122; ON-176; IST-021; K-415…K-417). Her test kendi
 * kurumunu kurar. FIXED_NOW 2026-10-06; 2014'te ayrılan personelin bütün kategorileri, 2025'te
 * ayrılanınki hiçbiri dolmuştur. Kayıtlar doğrudan tablolara yazılır (uçlar pasif personele yazmaz).
 */

const FINANCE = '/api/v1/finance'
const POLICY = `${FINANCE}/staff-retention-policies`
const CANDIDATES = `${FINANCE}/staff-retention-candidates`
const DESTRUCTIONS = `${FINANCE}/staff-data-destructions`
const LONG_AGO = new Date('2014-05-01T09:00:00.000Z')
const RECENT = new Date('2025-06-30T09:00:00.000Z')

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-122: özlük saklama ve imha uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  let tenantCount = 0
  let clientIp = '10.176.0.1'

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

  function call(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    cookie: string | null,
    payload?: unknown,
    headers: Record<string, string> = {},
    target: App = app,
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
  const get = (url: string, cookie: string | null) => call('GET', url, cookie)
  const destroy = (
    cookie: string | null,
    body: unknown,
    key: string = randomUUID(),
    target = app,
  ) => call('POST', DESTRUCTIONS, cookie, body, { 'idempotency-key': key }, target)
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const listOf = async (cookie: string, url: string) => {
    const response = await get(url, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.176.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return {
      id: created.id,
      adminUserId: created.admin.id,
      admin: await signInAs(app, created.admin),
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  /** Adlı üyelik; `left` verilirse o an pasifleştirilmiş (ayrılmış). */
  async function person(t: Tenant, role: Role, name: string, left: Date | null = LONG_AGO) {
    const user = await createUser(app, { name })
    const membership = await ensureMember(app.auth, db, {
      institutionId: t.id,
      userId: user.id,
      role,
    })
    if (left !== null)
      await db
        .update(memberships)
        .set({ deactivatedAt: left })
        .where(and(eq(memberships.institutionId, t.id), eq(memberships.id, membership.id)))
    return membership.id
  }
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))
  async function upload(t: Tenant) {
    const body = multipart(uploadParts('document', PDF, 'ozluk.pdf'))
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        cookie: t.admin,
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
      now: FIXED_NOW,
      log: app.log,
    })
    return id
  }

  /** Personelin her kategoride kaydı: belgeler (dosyalı), rapor, belge üretimi, izin, ücret zinciri. */
  async function seedRecords(t: Tenant, membershipId: string) {
    const docFile = await upload(t)
    const reportFile = await upload(t)
    const doc = (documentType: string, extra: Json = {}) => ({
      institutionId: t.id,
      id: randomUUID(),
      membershipId,
      documentType: documentType as 'diploma',
      documentDate: '2013-01-10',
      validUntilSource: 'type' as const,
      createdByUserId: t.adminUserId,
      ...extra,
    })
    const oldCriminal = doc('criminal_record', { supersededAt: LONG_AGO })
    await db
      .insert(staffDocuments)
      .values([
        oldCriminal,
        doc('criminal_record', { replacesId: oldCriminal.id, fileId: docFile }),
        doc('health_report', { healthReportKind: 'pre_employment' }),
        doc('diploma', { note: 'Lisans' }),
        doc('id_copy'),
      ])
    await db.insert(staffMedicalReports).values({
      institutionId: t.id,
      id: randomUUID(),
      membershipId,
      reportType: 'sickness',
      startDate: '2013-03-01',
      endDate: '2013-03-03',
      dayCount: 3,
      fileId: reportFile,
      createdByUserId: t.adminUserId,
    })
    await db.insert(staffCertificates).values({
      institutionId: t.id,
      id: randomUUID(),
      membershipId,
      kind: 'service',
      certificateYear: 2014,
      certificateNumber: Math.floor(Math.random() * 1_000_000) + 1,
      institutionName: 'Test Kurumu',
      staffName: 'Ayrılan Personel',
      position: 'Öğretmen',
      hireDate: '2012-09-01',
      exitDate: '2014-05-01',
      addressee: 'İlgili makama',
      issuedByUserId: t.adminUserId,
      issuedByName: 'Test Yönetici',
    })
    await db.insert(staffLeaveProfiles).values({
      institutionId: t.id,
      membershipId,
      seniorityStartDate: '2012-09-01',
      updatedByUserId: t.adminUserId,
    })
    const first = randomUUID()
    const second = randomUUID()
    const rate = (id: string, startDate: string, endDate: string, extra: Json = {}) => ({
      institutionId: t.id,
      id,
      membershipId,
      component: 'wage' as const,
      rateType: 'monthly_gross' as const,
      slot: 'wage',
      amountCents: 3_000_000,
      startDate,
      endDate,
      createdByUserId: t.adminUserId,
      ...extra,
    })
    await db.insert(staffPayRates).values(rate(second, '2013-09-01', '2014-05-01'))
    await db.insert(staffPayRates).values(
      rate(first, '2012-09-01', '2013-08-31', {
        closedByRateId: second,
        closedFromEndDate: null,
      }),
    )
    return { docFile, reportFile }
  }
  const docsOf = (institutionId: string, membershipId: string) =>
    db
      .select()
      .from(staffDocuments)
      .where(
        and(
          eq(staffDocuments.institutionId, institutionId),
          eq(staffDocuments.membershipId, membershipId),
        ),
      )
  const typesOf = async (institutionId: string, membershipId: string) =>
    (await docsOf(institutionId, membershipId)).map((row) => row.documentType).sort()
  const fileRow = async (fileId: string) =>
    (await db.select().from(files).where(eq(files.id, fileId)))[0]
  const auditOf = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  const destructionsOf = (institutionId: string) =>
    db
      .select()
      .from(staffDataDestructions)
      .where(eq(staffDataDestructions.institutionId, institutionId))

  test('kimliksiz istek 401', async () => {
    assertError(await get(POLICY, null), 401)
    assertError(
      await call('PATCH', POLICY, null, { personnel_file: { retentionMonths: 200 } }),
      401,
    )
    assertError(await get(CANDIDATES, null), 401)
    assertError(await get(DESTRUCTIONS, null), 401)
    assertError(await destroy(null, { membershipId: 'm-1', category: 'personnel_file' }), 401)
  })

  test('DOM-FIN-122: ön büro, öğretmen, veli ve öğrenci 403; modül kapalıyken 403 (K-417)', async () => {
    const t = await institution()
    const gone = await person(t, 'ogretmen', 'Ayrılan Öğretmen')
    await seedRecords(t, gone)
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(POLICY, cookie), 403)
      assertError(
        await call('PATCH', POLICY, cookie, { personnel_file: { retentionMonths: 200 } }),
        403,
      )
      assertError(await get(CANDIDATES, cookie), 403)
      assertError(await get(DESTRUCTIONS, cookie), 403)
      assertError(await destroy(cookie, { membershipId: gone, category: 'personnel_file' }), 403)
    }
    assert.equal((await typesOf(t.id, gone)).length, 5)
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(POLICY, closed.admin), 403, 'module_disabled')
    assertError(await get(CANDIDATES, closed.admin), 403, 'module_disabled')
    assertError(await get(DESTRUCTIONS, closed.admin), 403, 'module_disabled')
    assertError(
      await destroy(closed.admin, { membershipId: gone, category: 'personnel_file' }),
      403,
      'module_disabled',
    )
  })

  test('DOM-FIN-122: politika varsayılanı yasal en az süre; altına inilemez, uzatılır ve sıfırlanır (K-415)', async () => {
    const t = await institution()
    const initial = ok(await get(POLICY, t.admin)) as unknown as Json[]
    assert.deepEqual(
      initial.map((row) => [row.category, row.retentionMonths, row.startEvent, row.method]),
      [
        ['sick_leave_reports', 120, 'year_after_separation', 'delete'],
        ['health_reports', 180, 'separation_day', 'delete'],
        ['criminal_records', 120, 'separation_day', 'delete'],
        ['personnel_file', 120, 'separation_day', 'delete'],
        ['leave_records', 120, 'separation_day', 'delete'],
        ['payroll_records', 120, 'year_after_separation', 'anonymize'],
      ],
    )
    assert.equal(
      initial.every((row) => row.customized === false),
      true,
    )
    const below = await call('PATCH', POLICY, t.admin, {
      personnel_file: { retentionMonths: 200 },
      health_reports: { retentionMonths: 179 },
    })
    assertError(below, 400)
    assert.deepEqual(below.json().issues[0].path, ['health_reports', 'retentionMonths'])
    assertError(await call('PATCH', POLICY, t.admin, {}), 400)
    assertError(
      await call('PATCH', POLICY, t.admin, { payroll_records: { retentionMonths: 361 } }),
      400,
    )
    const rows = () =>
      db.select().from(staffRetentionSettings).where(eq(staffRetentionSettings.institutionId, t.id))
    assert.equal((await rows()).length, 0)
    const updated = ok(
      await call('PATCH', POLICY, t.admin, { personnel_file: { retentionMonths: 240 } }),
    ) as unknown as Json[]
    const file = updated.find((row) => row.category === 'personnel_file')
    assert.equal(file?.retentionMonths, 240)
    assert.equal(file?.customized, true)
    const reset = ok(
      await call('PATCH', POLICY, t.admin, { personnel_file: { retentionMonths: null } }),
    ) as unknown as Json[]
    assert.equal(reset.find((row) => row.category === 'personnel_file')?.retentionMonths, 120)
    assert.equal((await rows())[0]?.version, 2)
    const audits = await auditOf(t.id, 'finance.staff_retention.update')
    assert.equal(audits.length, 2)
    assert.deepEqual(audits[0]?.changes, { fields: ['personnel_file'] })
  })

  test('DOM-FIN-122: imha adayı ayrılmış personel × kategori; etkin ve yeniden etkin personel yok (K-415)', async () => {
    const t = await institution()
    const gone = await person(t, 'ogretmen', 'Eski Öğretmen')
    const recent = await person(t, 'onburo', 'Yeni Ayrılan', RECENT)
    const active = await person(t, 'yonetici', 'Etkin Yönetici', null)
    const parent = await person(t, 'veli', 'Ayrılan Veli')
    for (const id of [gone, recent, active, parent]) await seedRecords(t, id)
    const all = await listOf(t.admin, CANDIDATES)
    const ids = new Set(all.data.map((row) => row.membershipId))
    assert.deepEqual([...ids].sort(), [gone, recent].sort())
    assert.equal(all.meta.total, 12)
    const goneRows = all.data.filter((row) => row.membershipId === gone)
    assert.deepEqual(Object.fromEntries(goneRows.map((row) => [row.category, row.recordCount])), {
      sick_leave_reports: 1,
      health_reports: 1,
      criminal_records: 2,
      personnel_file: 3,
      leave_records: 1,
      payroll_records: 2,
    })
    const criminal = goneRows.find((row) => row.category === 'criminal_records')
    assert.equal(criminal?.separationDate, '2014-05-01')
    assert.equal(criminal?.dueDate, '2024-05-01')
    assert.equal(criminal?.status, 'due')
    assert.equal(goneRows.find((row) => row.category === 'payroll_records')?.dueDate, '2025-01-01')
    assert.equal(goneRows.find((row) => row.category === 'health_reports')?.dueDate, '2029-05-01')
    const due = await listOf(t.admin, `${CANDIDATES}?status=due`)
    assert.equal(due.meta.total, 5)
    assert.equal(
      due.data.every((row) => row.membershipId === gone && row.status === 'due'),
      true,
    )
    const waiting = await listOf(t.admin, `${CANDIDATES}?status=waiting&category=health_reports`)
    assert.equal(waiting.meta.total, 2)
    const named = await listOf(t.admin, `${CANDIDATES}?q=yeni`)
    assert.equal(
      named.data.every((row) => row.membershipId === recent),
      true,
    )
    const paged = await listOf(t.admin, `${CANDIDATES}?page=2&pageSize=5`)
    assert.equal(paged.data.length, 5)
    assertError(await get(`${CANDIDATES}?status=gone`, t.admin), 400)
    // Yeniden etkinleştirilen personel aday olmaz.
    await db
      .update(memberships)
      .set({ deactivatedAt: null })
      .where(and(eq(memberships.institutionId, t.id), eq(memberships.id, recent)))
    assert.equal((await listOf(t.admin, CANDIDATES)).meta.total, 6)
  })

  test('DOM-FIN-122: imha yalnız ilgili kategori ve personelin kayıtlarını siler; dosya imhaya işaretlenir; imha kaydı kişisel veri içermez (K-416, K-417)', async () => {
    const t = await institution()
    const gone = await person(t, 'ogretmen', 'Eski Öğretmen')
    const other = await person(t, 'ogretmen', 'Diğer Öğretmen')
    const { docFile, reportFile } = await seedRecords(t, gone)
    await seedRecords(t, other)
    const created = ok(
      await destroy(t.admin, { membershipId: gone, category: 'criminal_records' }),
      201,
    )
    assert.equal(created.category, 'criminal_records')
    assert.equal(created.method, 'delete')
    assert.equal(created.recordCount, 2)
    assert.equal(created.fileCount, 1)
    assert.equal(created.retentionMonths, 120)
    assert.equal(created.destroyedByName, 'Test Yönetici')
    assert.deepEqual(await typesOf(t.id, gone), ['diploma', 'health_report', 'id_copy'])
    assert.equal((await typesOf(t.id, other)).length, 5)
    assert.equal((await fileRow(docFile))?.retentionUntil?.toISOString(), FIXED_NOW.toISOString())
    assert.equal((await fileRow(reportFile))?.retentionUntil, null)
    const [saved] = await destructionsOf(t.id)
    assert.ok(saved)
    const serialized = JSON.stringify(saved)
    assert.equal(serialized.includes(gone), false)
    assert.equal(serialized.includes('Eski Öğretmen'), false)
    assert.equal(serialized.includes('2014-05-01'), false)
    const [audit] = await auditOf(t.id, 'finance.staff_data.destroy')
    assert.equal(audit?.entityType, 'staff_data_destructions')
    assert.equal(audit?.entityId, saved.id)
    assert.equal(JSON.stringify(audit).includes(gone), false)
    // Kategori adaylardan düşer; imha kaydı listede.
    const candidates = await listOf(t.admin, `${CANDIDATES}?category=criminal_records`)
    assert.deepEqual(
      candidates.data.map((row) => row.membershipId),
      [other],
    )
    const log = await listOf(t.admin, DESTRUCTIONS)
    assert.equal(log.meta.total, 1)
    assert.equal(log.data[0]?.id, saved.id)
    assert.equal((await listOf(t.admin, `${DESTRUCTIONS}?category=payroll_records`)).meta.total, 0)
    // Aynı kategori ikinci kez: kayıt yok.
    assertError(
      await destroy(t.admin, { membershipId: gone, category: 'criminal_records' }),
      422,
      'staff_retention_nothing_to_destroy',
    )
    // İmha kaydı değişmez ve silinmez.
    await assert.rejects(
      db.execute(sql`update staff_data_destructions set record_count = 9 where id = ${saved.id}`),
    )
    await assert.rejects(
      db.execute(sql`delete from staff_data_destructions where id = ${saved.id}`),
    )
  })

  test('DOM-FIN-122: özlük dosyası, istirahat raporu, izin ve mali kayıtların imhası (değişmez belge ve ücret zinciri dahil)', async () => {
    const t = await institution()
    const gone = await person(t, 'ogretmen', 'Eski Öğretmen')
    const { reportFile } = await seedRecords(t, gone)
    const file = ok(await destroy(t.admin, { membershipId: gone, category: 'personnel_file' }), 201)
    assert.equal(file.recordCount, 3)
    assert.deepEqual(await typesOf(t.id, gone), [
      'criminal_record',
      'criminal_record',
      'health_report',
    ])
    assert.equal(
      (await db.select().from(staffCertificates).where(eq(staffCertificates.institutionId, t.id)))
        .length,
      0,
    )
    const report = ok(
      await destroy(t.admin, { membershipId: gone, category: 'sick_leave_reports' }),
      201,
    )
    assert.equal(report.fileCount, 1)
    assert.ok((await fileRow(reportFile))?.retentionUntil)
    ok(await destroy(t.admin, { membershipId: gone, category: 'leave_records' }), 201)
    const payroll = ok(
      await destroy(t.admin, { membershipId: gone, category: 'payroll_records' }),
      201,
    )
    assert.equal(payroll.method, 'anonymize')
    assert.equal(payroll.recordCount, 2)
    assert.equal(
      (await db.select().from(staffPayRates).where(eq(staffPayRates.institutionId, t.id))).length,
      0,
    )
    assert.equal(
      (
        await db
          .select()
          .from(staffMedicalReports)
          .where(eq(staffMedicalReports.institutionId, t.id))
      ).length,
      0,
    )
    assert.equal((await destructionsOf(t.id)).length, 4)
    // Sağlık raporu belgesi 15 yıl: henüz dolmadı, dokunulmadı.
    assertError(
      await destroy(t.admin, { membershipId: gone, category: 'health_reports' }),
      422,
      'staff_retention_not_due',
    )
    assert.deepEqual(await typesOf(t.id, gone), [
      'criminal_record',
      'criminal_record',
      'health_report',
    ])
  })

  test('DOM-FIN-122: süresi dolmamış, etkin, personel olmayan ve olmayan üyelikte imha yok; kayıt değişmez', async () => {
    const t = await institution()
    const recent = await person(t, 'onburo', 'Yeni Ayrılan', RECENT)
    const active = await person(t, 'ogretmen', 'Etkin Öğretmen', null)
    const parent = await person(t, 'veli', 'Ayrılan Veli')
    for (const id of [recent, active, parent]) await seedRecords(t, id)
    assertError(
      await destroy(t.admin, { membershipId: recent, category: 'personnel_file' }),
      422,
      'staff_retention_not_due',
    )
    assertError(
      await destroy(t.admin, { membershipId: active, category: 'personnel_file' }),
      422,
      'staff_retention_member_active',
    )
    assertError(
      await destroy(t.admin, { membershipId: parent, category: 'personnel_file' }),
      404,
      'not_found',
    )
    assertError(
      await destroy(t.admin, { membershipId: 'm-yok', category: 'personnel_file' }),
      404,
      'not_found',
    )
    assertError(await destroy(t.admin, { membershipId: recent, category: 'other' }), 400)
    // Kurum süreyi uzattıysa dolmuş görünen kayıt da beklenir.
    const gone = await person(t, 'ogretmen', 'Eski Öğretmen')
    await seedRecords(t, gone)
    ok(await call('PATCH', POLICY, t.admin, { personnel_file: { retentionMonths: 360 } }))
    assertError(
      await destroy(t.admin, { membershipId: gone, category: 'personnel_file' }),
      422,
      'staff_retention_not_due',
    )
    for (const id of [recent, active, parent, gone])
      assert.equal((await typesOf(t.id, id)).length, 5)
    assert.equal((await destructionsOf(t.id)).length, 0)
  })

  test('DOM-FIN-122: imha taze oturum ve Idempotency-Key ister; aynı anahtar ilk yanıtı tekrarlar', async () => {
    const t = await institution()
    const gone = await person(t, 'ogretmen', 'Eski Öğretmen')
    await seedRecords(t, gone)
    const body = { membershipId: gone, category: 'leave_records' }
    const later = await buildTestApp(db, {
      storage: store.storage,
      clock: () => new Date(Date.now() + 16 * 60 * 1000),
    })
    try {
      assertError(
        await destroy(t.admin, body, randomUUID(), later),
        403,
        'reauthentication_required',
      )
    } finally {
      await later.close()
    }
    assertError(await call('POST', DESTRUCTIONS, t.admin, body), 400, 'idempotency_key_required')
    assert.equal((await destructionsOf(t.id)).length, 0)
    const key = randomUUID()
    const first = await destroy(t.admin, body, key)
    assert.equal(first.statusCode, 201, first.body)
    const replay = await destroy(t.admin, body, key)
    assert.equal(replay.statusCode, 201, replay.body)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(replay.json().data.id, first.json().data.id)
    assert.equal((await destructionsOf(t.id)).length, 1)
  })

  test('DOM-FIN-122: başka kurum 404 ve B değişmez; listede B yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bGone = await person(b, 'ogretmen', 'Beta Ayrılan')
    await seedRecords(b, bGone)
    ok(await destroy(b.admin, { membershipId: bGone, category: 'leave_records' }), 201)
    assertError(
      await destroy(a.admin, { membershipId: bGone, category: 'personnel_file' }),
      404,
      'not_found',
    )
    assertError(
      await destroy(a.admin, {
        membershipId: bGone,
        category: 'personnel_file',
        institutionId: b.id,
      }),
      400,
    )
    assert.equal((await typesOf(b.id, bGone)).length, 5)
    assert.equal((await listOf(a.admin, CANDIDATES)).meta.total, 0)
    assert.equal((await listOf(a.admin, DESTRUCTIONS)).meta.total, 0)
    ok(await call('PATCH', POLICY, b.admin, { personnel_file: { retentionMonths: 200 } }))
    const aPolicy = ok(await get(POLICY, a.admin)) as unknown as Json[]
    assert.equal(aPolicy.find((row) => row.category === 'personnel_file')?.retentionMonths, 120)
    assertError(
      await call('PATCH', POLICY, a.admin, {
        personnel_file: { retentionMonths: 130 },
        institutionId: b.id,
      }),
      400,
    )
    const bPolicy = ok(await get(POLICY, b.admin)) as unknown as Json[]
    assert.equal(bPolicy.find((row) => row.category === 'personnel_file')?.retentionMonths, 200)
  })
})
