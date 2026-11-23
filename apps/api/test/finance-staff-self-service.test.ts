import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { files } from '../src/db/schema/files.ts'
import { staffChangeRequests } from '../src/db/schema/finance-staff-change-requests.ts'
import { staffPersonnelFiles } from '../src/db/schema/finance-personnel-files.ts'
import { staffDocuments } from '../src/db/schema/finance-staff-documents.ts'
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
 * Personel self-servisi uçları (DOM-FIN-166; ON-189; K-553…K-555). Her test kendi kurumunu kurar.
 * FIXED_NOW 2026-10-06.
 */

const FINANCE = '/api/v1/finance'
const PROFILE = `${FINANCE}/my-staff-profile`
const OWN = `${FINANCE}/my-change-requests`
const QUEUE = `${FINANCE}/staff-change-requests`
const MY_DOCS = `${FINANCE}/my-staff-documents`
const MY_LEAVE = `${FINANCE}/my-leave`
const MY_LEAVE_REQUESTS = `${FINANCE}/my-leave-requests`
const MY_PAYSLIPS = `${FINANCE}/my-payslips`
const IBAN = 'TR330006100519786457841326'
const IBAN_2 = 'TR320010009999901234567890'

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-166: personel self-servisi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  let tenantCount = 0
  let clientIp = '10.189.0.1'

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
    clientIp = `10.189.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  /** Giriş yapmış adlı personel. */
  async function staff(t: Tenant, role: Role, name: string) {
    const user = await createUser(app, { name })
    const membership = await ensureMember(app.auth, db, {
      institutionId: t.id,
      userId: user.id,
      role,
    })
    return { membershipId: membership.id, cookie: await signInAs(app, user) }
  }
  type Staff = Awaited<ReturnType<typeof staff>>
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))

  const request = (who: Staff, body: Json, headers: Record<string, string> = {}) =>
    call('POST', OWN, who.cookie, body, headers)
  const decide = (
    cookie: string,
    req: Json,
    verb: 'approve' | 'reject',
    payload: Json | undefined = undefined,
  ) => call('POST', `${QUEUE}/${String(req.id)}/${verb}`, cookie, payload, ifMatch(req.version))
  const cancel = (who: Staff, req: Json) =>
    call('POST', `${OWN}/${String(req.id)}/cancel`, who.cookie, undefined, ifMatch(req.version))
  const requestRows = (institutionId: string) =>
    db
      .select()
      .from(staffChangeRequests)
      .where(eq(staffChangeRequests.institutionId, institutionId))
      .orderBy(staffChangeRequests.id)
  const fileRows = (institutionId: string) =>
    db
      .select()
      .from(staffPersonnelFiles)
      .where(eq(staffPersonnelFiles.institutionId, institutionId))
  const auditOf = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  async function upload(t: Tenant, cookie: string, name = 'saglik-raporu.pdf') {
    const body = multipart(uploadParts('document', PDF, name))
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
      now: FIXED_NOW,
      log: app.log,
    })
    return id
  }

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    for (const url of [
      PROFILE,
      OWN,
      MY_DOCS,
      MY_LEAVE,
      MY_PAYSLIPS,
      `${MY_PAYSLIPS}/2026-01`,
      QUEUE,
      `${QUEUE}/${id}/file-url`,
    ])
      assertError(await get(url, null), 401)
    assertError(await call('POST', OWN, null, { kind: 'contact', phone: '05321234567' }), 401)
    assertError(await call('POST', `${QUEUE}/${id}/approve`, null, undefined, ifMatch(1)), 401)
  })

  test('DOM-FIN-166: öğrenci ve veli self-servise 403; onay kuyruğu öğretmen ve ön büroya 403', async () => {
    const t = await institution()
    for (const role of ['ogrenci', 'veli'] as const) {
      const cookie = await member(t.id, role)
      for (const url of [PROFILE, OWN, MY_DOCS, MY_LEAVE, MY_PAYSLIPS])
        assertError(await get(url, cookie), 403)
      assertError(await call('POST', OWN, cookie, { kind: 'contact', phone: '05321234567' }), 403)
    }
    for (const role of ['ogretmen', 'onburo'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(QUEUE, cookie), 403)
      assertError(
        await call('POST', `${QUEUE}/${randomUUID()}/approve`, cookie, undefined, ifMatch(1)),
        403,
      )
    }
    assert.equal((await requestRows(t.id)).length, 0)
  })

  test('DOM-FIN-166: finance modülü kapalıyken 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    const selin = await staff(closed, 'ogretmen', 'Selin Kaya')
    assertError(await get(PROFILE, selin.cookie), 403, 'module_disabled')
    assertError(await get(QUEUE, closed.admin), 403, 'module_disabled')
  })

  test('DOM-FIN-166, K-553: özlük özetim salt okunur ve maskeli; kart yoksa boş', async () => {
    const t = await institution()
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const empty = ok(await get(PROFILE, selin.cookie))
    assert.equal(empty.membershipId, selin.membershipId)
    assert.equal(empty.name, 'Selin Kaya')
    assert.equal(empty.file, null)
    ok(
      await call(
        'POST',
        `${FINANCE}/personnel-files`,
        t.admin,
        {
          membershipId: selin.membershipId,
          identity: { nationalId: '10000000146', birthDate: '1990-05-12' },
          bank: { iban: IBAN, accountHolder: 'Selin Kaya' },
        },
        key(),
      ),
      201,
    )
    const data = ok(await get(PROFILE, selin.cookie))
    const card = data.file as Json
    assert.deepEqual(card.identity, { nationalIdMasked: '*******0146', birthDate: '1990-05-12' })
    assert.deepEqual(card.bank, {
      ibanMasked: 'TR********************1326',
      accountHolder: 'Selin Kaya',
    })
    assert.ok(!JSON.stringify(data).includes(IBAN))
    assert.ok(!JSON.stringify(data).includes('10000000146'))
    assert.deepEqual(data.pendingKinds, [])
  })

  test('DOM-FIN-166, K-553: iletişim talebi onay bekler, onayda karta yazılır; denetimde değer yok', async () => {
    const t = await institution()
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const created = ok(
      await request(selin, {
        kind: 'contact',
        address: 'Moda Caddesi No 12 Kadıköy',
        phone: '0532 123 45 67',
      }),
      201,
    )
    assert.equal(created.status, 'pending')
    assert.deepEqual(created.proposal, {
      kind: 'contact',
      address: 'Moda Caddesi No 12 Kadıköy',
      phone: '05321234567',
    })
    assert.deepEqual(ok(await get(PROFILE, selin.cookie)).pendingKinds, ['contact'])
    // Aynı türde ikinci bekleyen talep 409; kayıt değişmez.
    const before = await requestRows(t.id)
    assertError(
      await request(selin, { kind: 'contact', phone: '05329999999' }),
      409,
      'staff_change_request_pending_exists',
    )
    assert.deepEqual(await requestRows(t.id), before)

    const queue = ok(await get(`${QUEUE}?status=pending`, t.admin)) as unknown as Json[]
    assert.deepEqual(
      queue.map((item) => item.id),
      [created.id],
    )
    const approved = ok(await decide(t.admin, created, 'approve'))
    assert.equal(approved.status, 'approved')
    assert.equal(typeof approved.decidedAt, 'string')
    const [row] = await fileRows(t.id)
    assert.equal(row?.address, 'Moda Caddesi No 12 Kadıköy')
    assert.equal(row?.phone, '05321234567')
    // İkinci onay: talep artık beklemiyor.
    assertError(await decide(t.admin, approved, 'approve'), 422, 'staff_change_request_not_pending')
    assertError(await decide(t.admin, created, 'approve'), 409)

    const audit = [
      ...(await auditOf(t.id, 'finance.staff_change_request.create')),
      ...(await auditOf(t.id, 'finance.staff_change_request.approve')),
      ...(await auditOf(t.id, 'finance.personnel_file.create')),
    ]
    assert.equal(audit.length, 3)
    const text = JSON.stringify(audit.map((entry) => entry.changes))
    assert.ok(!text.includes('Moda'))
    assert.ok(!text.includes('05321234567'))
  })

  test('DOM-FIN-166, K-554: IBAN talebi taze oturum ve kendi adına hesap ister; şifreli saklanır, onayda karta geçer', async () => {
    const t = await institution()
    const selin = await staff(t, 'onburo', 'Selin Kaya')
    ok(
      await call(
        'POST',
        `${FINANCE}/personnel-files`,
        t.admin,
        { membershipId: selin.membershipId, bank: { iban: IBAN, accountHolder: 'Selin Kaya' } },
        key(),
      ),
      201,
    )
    const later = await buildTestApp(db, {
      storage: store.storage,
      clock: () => new Date(Date.now() + 16 * 60 * 1000),
    })
    try {
      assertError(
        await call(
          'POST',
          OWN,
          selin.cookie,
          { kind: 'bank', iban: IBAN_2, accountHolder: 'Selin Kaya' },
          {},
          later,
        ),
        403,
        'reauthentication_required',
      )
    } finally {
      await later.close()
    }
    assertError(
      await request(selin, { kind: 'bank', iban: IBAN_2, accountHolder: 'Ahmet Kaya' }),
      422,
      'staff_change_bank_holder_mismatch',
    )
    assertError(
      await request(selin, {
        kind: 'bank',
        iban: 'TR320010009999901234567891',
        accountHolder: 'Selin Kaya',
      }),
      400,
    )
    assertError(
      await request(selin, { kind: 'bank', iban: IBAN, accountHolder: 'Selin Kaya' }),
      422,
      'staff_change_request_unchanged',
    )
    assert.equal((await requestRows(t.id)).length, 0)

    const created = ok(
      await request(selin, { kind: 'bank', iban: IBAN_2, accountHolder: 'SELİN KAYA' }),
      201,
    )
    assert.deepEqual(created.proposal, {
      kind: 'bank',
      ibanMasked: 'TR********************7890',
      accountHolder: 'SELİN KAYA',
    })
    const [stored] = await requestRows(t.id)
    assert.ok(stored?.ibanCiphertext !== null)
    assert.ok(!JSON.stringify(stored).includes(IBAN_2))
    const listed = ok(await get(QUEUE, t.admin)) as unknown as Json[]
    assert.ok(!JSON.stringify(listed).includes(IBAN_2))

    ok(await decide(t.admin, created, 'approve'))
    const card = ok(await get(`${FINANCE}/personnel-files/${selin.membershipId}`, t.admin))
    assert.deepEqual(card.bank, {
      ibanMasked: 'TR********************7890',
      accountHolder: 'SELİN KAYA',
    })
    const update = await auditOf(t.id, 'finance.personnel_file.update')
    assert.deepEqual(
      update.map((entry) => entry.changes),
      [{ fields: ['bank.iban', 'bank.accountHolder'] }],
    )
  })

  test('DOM-FIN-166, K-553: gerekçeli ret ve geri çekme; başka personelin talebi 404', async () => {
    const t = await institution()
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const other = await staff(t, 'ogretmen', 'Burak Demir')
    const created = ok(
      await request(selin, {
        kind: 'emergency_contacts',
        emergencyContacts: [{ name: 'Ahmet Kaya', relation: 'Eşi', phone: '05329876543' }],
      }),
      201,
    )
    // Başkasının talebi ve listesi.
    assertError(await cancel(other, created), 404)
    assert.deepEqual(ok(await get(OWN, other.cookie)), [] as unknown as Json)
    assertError(await decide(t.admin, created, 'reject', { reason: 'kısa' }), 400)
    assertError(
      await call('POST', `${QUEUE}/${String(created.id)}/reject`, t.admin, {
        reason: 'Telefon eksik görünüyor',
      }),
      400,
      'if_match_required',
    )
    const rejected = ok(
      await decide(t.admin, created, 'reject', { reason: 'Telefon eksik görünüyor' }),
    )
    assert.equal(rejected.status, 'rejected')
    assert.equal(rejected.rejectionReason, 'Telefon eksik görünüyor')
    const mine = ok(await get(OWN, selin.cookie)) as unknown as Json[]
    assert.equal(mine[0]?.rejectionReason, 'Telefon eksik görünüyor')
    const audit = await auditOf(t.id, 'finance.staff_change_request.reject')
    assert.ok(!JSON.stringify(audit).includes('Telefon eksik'))
    assert.equal((await fileRows(t.id)).length, 0)

    const again = ok(await request(selin, { kind: 'contact', phone: '05321234567' }), 201)
    const cancelled = ok(await cancel(selin, again))
    assert.equal(cancelled.status, 'cancelled')
    assertError(await cancel(selin, cancelled), 422, 'staff_change_request_not_pending')
    assert.equal((await fileRows(t.id)).length, 0)
  })

  test('DOM-FIN-166, DOM-FIN-113: belge talebi dosyayla girer, yönetici dosyayı denetimle açar; onayda özlük belgesi olur', async () => {
    const t = await institution()
    const desk = await staff(t, 'onburo', 'Deniz Yılmaz')
    const fileId = await upload(t, desk.cookie)
    const created = ok(
      await request(desk, {
        kind: 'document',
        documentType: 'health_report',
        healthReportKind: 'periodic',
        documentDate: '2026-09-01',
        fileId,
      }),
      201,
    )
    assert.equal((created.proposal as Json).hasFile, true)
    // Dosya doğrudan dosya ucundan açılmaz; yalnız denetimli uçtan.
    assertError(await get(`/api/v1/files/${fileId}/url`, t.admin), 404)
    const link = ok(await get(`${QUEUE}/${String(created.id)}/file-url`, t.admin))
    assert.equal(typeof link.url, 'string')
    assert.equal((await auditOf(t.id, 'finance.staff_change_request.file_open')).length, 1)
    // Talep beklerken belge yoktur.
    assert.deepEqual((ok(await get(MY_DOCS, desk.cookie)) as Json).documents, [])

    const approved = ok(await decide(t.admin, created, 'approve'))
    assert.equal(typeof approved.staffDocumentId, 'string')
    const docs = await db
      .select()
      .from(staffDocuments)
      .where(eq(staffDocuments.institutionId, t.id))
    assert.equal(docs.length, 1)
    assert.equal(docs[0]?.fileId, fileId)
    assert.equal(docs[0]?.membershipId, desk.membershipId)
    const [file] = await db.select().from(files).where(eq(files.id, fileId))
    assert.equal(file?.attachedType, 'staff_document')
    assert.equal(file?.attachedId, approved.staffDocumentId)
    const mine = ok(await get(MY_DOCS, desk.cookie))
    const list = mine.documents as Json[]
    assert.equal(list.length, 1)
    assert.equal(list[0]?.documentType, 'health_report')
    assert.equal((list[0]?.file as Json | null)?.name, 'saglik-raporu.pdf')
  })

  test('DOM-FIN-166: öğretmen belgeyi dosyasız bildirir; reddedilen talebin dosya bağı kalkar; başkasının dosyası 422', async () => {
    const t = await institution()
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const desk = await staff(t, 'onburo', 'Deniz Yılmaz')
    const deskFile = await upload(t, desk.cookie, 'sertifika.pdf')
    assertError(
      await request(selin, {
        kind: 'document',
        documentType: 'certificate',
        documentDate: '2026-09-01',
        fileId: deskFile,
      }),
      422,
      'file_unavailable',
    )
    assertError(
      await request(selin, {
        kind: 'document',
        documentType: 'diploma',
        documentDate: '2026-10-07',
      }),
      422,
      'staff_document_date_in_future',
    )
    const plain = ok(
      await request(selin, {
        kind: 'document',
        documentType: 'diploma',
        documentDate: '2026-09-01',
      }),
      201,
    )
    assertError(
      await get(`${QUEUE}/${String(plain.id)}/file-url`, t.admin),
      422,
      'staff_change_request_no_file',
    )
    const withFile = ok(
      await request(desk, {
        kind: 'document',
        documentType: 'certificate',
        documentDate: '2026-09-01',
        fileId: deskFile,
        note: 'İlk yardım kursu',
      }),
      201,
    )
    ok(await decide(t.admin, withFile, 'reject', { reason: 'Belge okunmuyor, yeniden yükleyin' }))
    const [file] = await db.select().from(files).where(eq(files.id, deskFile))
    assert.equal(file?.attachedId, null)
    assertError(await get(`${QUEUE}/${String(withFile.id)}/file-url`, t.admin), 404)
  })

  test('DOM-FIN-166, K-555: izin bakiyem ve kendi izin talebim; yönetici kuyruğunda görünür', async () => {
    const t = await institution()
    const selin = await staff(t, 'onburo', 'Selin Kaya')
    const empty = ok(await get(MY_LEAVE, selin.cookie))
    assert.equal(empty.entitlement, null)
    assert.ok((empty.types as Json[]).some((type) => type.code === 'annual'))
    ok(
      await call('POST', `${FINANCE}/leave-profiles`, t.admin, {
        membershipId: selin.membershipId,
        seniorityStartDate: '2020-01-15',
      }),
      201,
    )
    const leave = ok(await get(MY_LEAVE, selin.cookie))
    const entitlement = leave.entitlement as Json
    assert.equal(typeof entitlement.balanceDays, 'number')

    const body = { typeCode: 'annual', startDate: '2026-11-02', endDate: '2026-11-04', days: 3 }
    assertError(
      await call('POST', MY_LEAVE_REQUESTS, selin.cookie, body),
      400,
      'idempotency_key_required',
    )
    assertError(
      await call(
        'POST',
        MY_LEAVE_REQUESTS,
        selin.cookie,
        { ...body, membershipId: randomUUID() },
        key(),
      ),
      400,
    )
    const headers = key()
    const created = ok(await call('POST', MY_LEAVE_REQUESTS, selin.cookie, body, headers), 201)
    assert.equal(created.membershipId, selin.membershipId)
    assert.equal(created.status, 'pending')
    assert.equal('teachers' in created, false)
    const replay = await call('POST', MY_LEAVE_REQUESTS, selin.cookie, body, headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    const managerList = ok(
      await get(`${FINANCE}/leave-requests?membershipId=${selin.membershipId}`, t.admin),
    ) as unknown as Json[]
    assert.equal(managerList.length, 1)
    const mine = ok(await get(MY_LEAVE, selin.cookie))
    assert.deepEqual(
      (mine.requests as Json[]).map((item) => item.id),
      [created.id],
    )
  })

  /** Personele ücret tanımı, ayların kayıtlı hesabı ve verilirse onaylı dönem. */
  async function payroll(t: Tenant, people: Staff[], months: string[], approve?: string) {
    for (const who of people)
      ok(
        await call('POST', `${FINANCE}/pay-rates`, t.admin, {
          component: 'wage',
          membershipId: who.membershipId,
          rateType: 'monthly_gross',
          amountCents: 3_303_000,
          startDate: '2026-01-01',
        }),
        201,
      )
    for (const month of months)
      ok(
        await call(
          'POST',
          `${FINANCE}/payroll-runs/${month}/calculate`,
          t.admin,
          { previousRunId: null },
          key(),
        ),
        201,
      )
    if (approve === undefined) return
    const year = ok(await get(`${FINANCE}/payroll-periods?year=2026`, t.admin)) as {
      months: Json[]
    }
    const target = year.months.find((item) => item.month === approve)
    const hash = (target?.current as Json | null)?.inputsHash
    ok(
      await call(
        'POST',
        `${FINANCE}/payroll-periods/${approve}/approve`,
        t.admin,
        { inputsHash: hash },
        key(),
      ),
      201,
    )
  }

  test('DOM-FIN-166, K-555: pusulalarım yalnız onaylı dönemden; taze oturum ve denetim', async () => {
    const t = await institution()
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const other = await staff(t, 'ogretmen', 'Burak Demir')
    await payroll(t, [selin, other], ['2026-02', '2026-03'])
    assert.deepEqual(ok(await get(MY_PAYSLIPS, selin.cookie)), [] as unknown as Json)
    assertError(await get(`${MY_PAYSLIPS}/2026-02`, selin.cookie), 404)
    await payroll(t, [], [], '2026-03')
    const months = ok(await get(MY_PAYSLIPS, selin.cookie)) as unknown as Json[]
    assert.deepEqual(
      months.map((item) => item.month),
      ['2026-03'],
    )
    assertError(await get(`${MY_PAYSLIPS}/2026-02`, selin.cookie), 404)
    const slip = ok(await get(`${MY_PAYSLIPS}/2026-03`, selin.cookie))
    assert.equal(slip.locked, true)
    assert.deepEqual(
      (slip.payslips as Json[]).map((item) => item.membershipId),
      [selin.membershipId],
    )
    const audit = await auditOf(t.id, 'finance.payroll_payslip.export')
    assert.equal(audit.length, 1)
    assert.equal(audit[0]?.actorRole, 'ogretmen')

    const later = await buildTestApp(db, {
      storage: store.storage,
      clock: () => new Date(Date.now() + 16 * 60 * 1000),
    })
    try {
      assertError(
        await call('GET', `${MY_PAYSLIPS}/2026-03`, selin.cookie, undefined, {}, later),
        403,
        'reauthentication_required',
      )
    } finally {
      await later.close()
    }
    assert.equal((await auditOf(t.id, 'finance.payroll_payslip.export')).length, 1)
  })

  test('DOM-FIN-166: başka kurumun talebi ve pusula ayı 404, B değişmez; kuyrukta ve self okumalarda B yok; gövdedeki institutionId 400', async () => {
    const a = await institution()
    const b = await institution()
    const bStaff = await staff(b, 'ogretmen', 'Kurum B')
    const bRequest = ok(await request(bStaff, { kind: 'contact', phone: '05321234567' }), 201)
    const bRows = await requestRows(b.id)

    assertError(await decide(a.admin, bRequest, 'approve'), 404)
    assertError(await decide(a.admin, bRequest, 'reject', { reason: 'Başka kurum talebi' }), 404)
    assertError(await get(`${QUEUE}/${String(bRequest.id)}/file-url`, a.admin), 404)
    assert.deepEqual(ok(await get(QUEUE, a.admin)), [] as unknown as Json)
    assert.deepEqual(await requestRows(b.id), bRows)

    const aStaff = await staff(a, 'ogretmen', 'Kurum A')
    assertError(await cancel(aStaff, bRequest), 404)
    assertError(
      await request(aStaff, { kind: 'contact', phone: '05321234567', institutionId: b.id }),
      400,
    )
    assert.deepEqual(await requestRows(b.id), bRows)
    assert.equal((await requestRows(a.id)).length, 0)

    // Self-servis okumaları yalnız A'daki kendi kaydını verir; B'nin onaylı pusula ayı A'da 404.
    await payroll(b, [bStaff], ['2026-03'], '2026-03')
    const aProfile = ok(await get(PROFILE, aStaff.cookie))
    assert.equal(aProfile.membershipId, aStaff.membershipId)
    assert.deepEqual(ok(await get(OWN, aStaff.cookie)), [] as unknown as Json)
    assert.deepEqual((ok(await get(MY_DOCS, aStaff.cookie)) as Json).documents, [])
    assert.deepEqual((ok(await get(MY_LEAVE, aStaff.cookie)) as Json).requests, [])
    assert.deepEqual(ok(await get(MY_PAYSLIPS, aStaff.cookie)), [] as unknown as Json)
    assertError(await get(`${MY_PAYSLIPS}/2026-03`, aStaff.cookie), 404)
    assertError(
      await call(
        'POST',
        MY_LEAVE_REQUESTS,
        aStaff.cookie,
        {
          typeCode: 'annual',
          startDate: '2026-11-02',
          endDate: '2026-11-02',
          days: 1,
          institutionId: b.id,
        },
        key(),
      ),
      400,
    )
    assert.equal((await auditOf(b.id, 'finance.payroll_payslip.export')).length, 0)
  })

  test('DOM-FIN-166: geri çekme ve onay If-Match ister; Idempotency-Key aynı yanıtı tekrarlar', async () => {
    const t = await institution()
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const headers = key()
    const first = await request(selin, { kind: 'contact', phone: '05321234567' }, headers)
    assert.equal(first.statusCode, 201)
    const replay = await request(selin, { kind: 'contact', phone: '05321234567' }, headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((await requestRows(t.id)).length, 1)
    const created = first.json().data as Json
    assertError(
      await call('POST', `${OWN}/${String(created.id)}/cancel`, selin.cookie),
      400,
      'if_match_required',
    )
    assertError(
      await call('POST', `${QUEUE}/${String(created.id)}/approve`, t.admin),
      400,
      'if_match_required',
    )
  })
})
