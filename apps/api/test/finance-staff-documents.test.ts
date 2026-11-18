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
 * Personel özlük belgesi uçları (DOM-FIN-113; ON-173; K-372…K-374). Her test kendi kurumunu kurar;
 * personel adlı kullanıcıyla açılır. FIXED_NOW 2026-10-06 (Europe/Istanbul günü de 2026-10-06).
 */

const FINANCE = '/api/v1/finance'
const DOCS = `${FINANCE}/staff-documents`
const STAFF = `${FINANCE}/staff-document-staff`
const TYPES = `${FINANCE}/staff-document-types`
const ALERTS = `${FINANCE}/staff-document-alerts`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-113: özlük belgesi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  let tenantCount = 0
  let clientIp = '10.113.0.1'

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
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.113.${String((tenantCount += 1))}.1`
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
  async function upload(t: Tenant, cookie: string, name = 'adli-sicil.pdf') {
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
  const doc = (membershipId: string, documentType: string, documentDate: string, extra = {}) => ({
    membershipId,
    documentType,
    documentDate,
    ...extra,
  })
  const create = (cookie: string, body: Json, headers: Record<string, string> = {}) =>
    call('POST', DOCS, cookie, body, headers)
  const created = async (cookie: string, body: Json) => {
    const data = ok(await create(cookie, body), 201)
    return { document: data.document as Json, superseded: data.superseded as Json | null }
  }
  const rowsOf = (institutionId: string) =>
    db.select().from(staffDocuments).where(eq(staffDocuments.institutionId, institutionId))
  const listOf = async (cookie: string, url: string) => {
    const response = await get(url, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }
  const auditOf = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  test('kimliksiz istek 401', async () => {
    assertError(await get(TYPES, null), 401)
    assertError(await call('PATCH', TYPES, null, { other: null }), 401)
    assertError(await get(ALERTS, null), 401)
    assertError(await get(DOCS, null), 401)
    assertError(await get(STAFF, null), 401)
    assertError(await get(`${STAFF}/m-1`, null), 401)
    assertError(await call('POST', DOCS, null, doc('m-1', 'diploma', '2026-01-01')), 401)
    assertError(await get(`${DOCS}/${randomUUID()}/file-url`, null), 401)
  })

  test('DOM-FIN-113: öğretmen, veli ve öğrenci 403; ön büro tür ayarını değiştiremez (K-372, K-374)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(TYPES, cookie), 403)
      assertError(await get(ALERTS, cookie), 403)
      assertError(await get(DOCS, cookie), 403)
      assertError(await get(STAFF, cookie), 403)
      assertError(await get(`${STAFF}/${selin}`, cookie), 403)
      assertError(await create(cookie, doc(selin, 'diploma', '2026-01-01')), 403)
      assertError(await get(`${DOCS}/${randomUUID()}/file-url`, cookie), 403)
    }
    const desk = await member(t.id, 'onburo')
    assertError(
      await call('PATCH', TYPES, desk, {
        certificate: { required: true, validityMonths: null, sensitive: false },
      }),
      403,
    )
    assert.equal((await rowsOf(t.id)).length, 0)
    const types = ok(await get(TYPES, desk)) as unknown as Json[]
    assert.equal(types.find((row) => row.documentType === 'certificate')?.required, false)
  })

  test('DOM-FIN-113: finance modülü kapalıyken özlük uçları 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(TYPES, closed.admin), 403, 'module_disabled')
    assertError(await get(DOCS, closed.admin), 403, 'module_disabled')
    assertError(await get(STAFF, closed.admin), 403, 'module_disabled')
    assertError(
      await create(closed.admin, doc('m-1', 'diploma', '2026-01-01')),
      403,
      'module_disabled',
    )
  })

  test('DOM-FIN-113: tür ayarları varsayılanla döner, yönetici yazar; özel nitelik kalkmaz (K-372)', async () => {
    const t = await institution()
    const defaults = ok(await get(TYPES, t.admin)) as unknown as Json[]
    assert.deepEqual(
      defaults.map((row) => [row.documentType, row.required, row.validityMonths, row.sensitive]),
      [
        ['diploma', true, null, false],
        ['health_report', true, 60, true],
        ['criminal_record', true, 6, true],
        ['certificate', false, null, false],
        ['id_copy', true, null, false],
        ['other', false, null, false],
      ],
    )
    assertError(
      await call('PATCH', TYPES, t.admin, {
        criminal_record: { required: true, validityMonths: 6, sensitive: false },
      }),
      400,
    )
    assertError(await call('PATCH', TYPES, t.admin, {}), 400)
    const updated = ok(
      await call('PATCH', TYPES, t.admin, {
        criminal_record: { required: true, validityMonths: 12, sensitive: true },
        certificate: { required: true, validityMonths: 24, sensitive: true },
      }),
    ) as unknown as Json[]
    const certificate = updated.find((row) => row.documentType === 'certificate')
    assert.equal(certificate?.customized, true)
    assert.equal(certificate?.sensitive, true)
    assert.equal(updated.find((row) => row.documentType === 'criminal_record')?.validityMonths, 12)
    const audit = await auditOf(t.id, 'finance.staff_document_type.update')
    assert.deepEqual(audit[0]?.changes, { fields: ['criminal_record', 'certificate'] })
  })

  test('DOM-FIN-113: yeni belge türden bitiş alır, tekil türde eskisinin yerine geçer; geçmiş korunur (K-373)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const first = await created(t.admin, doc(selin, 'criminal_record', '2026-03-01'))
    assert.equal(first.document.validUntil, '2026-09-01')
    assert.equal(first.document.validUntilSource, 'type')
    assert.equal(first.document.status, 'expired')
    assert.equal(first.superseded, null)
    const second = await created(t.admin, doc(selin, 'criminal_record', '2026-09-20'))
    assert.equal(second.document.validUntil, '2027-03-20')
    assert.equal(second.document.status, 'valid')
    assert.equal(second.document.replacesId, first.document.id)
    assert.equal(second.superseded?.id, first.document.id)
    assert.equal(second.superseded?.status, 'superseded')
    assertError(
      await create(t.admin, doc(selin, 'criminal_record', '2026-09-01')),
      422,
      'staff_document_older_than_current',
    )
    // Çoklu türde yerine geçme yalnız seçilince; elle bitiş.
    const celta = await created(
      t.admin,
      doc(selin, 'certificate', '2025-06-01', { note: ' CELTA ', validUntil: '2026-10-20' }),
    )
    assert.equal(celta.document.note, 'CELTA')
    assert.equal(celta.document.validUntilSource, 'manual')
    assert.equal(celta.document.status, 'expiring')
    assert.equal(celta.document.daysLeft, 14)
    const other = await created(t.admin, doc(selin, 'certificate', '2026-02-01'))
    assert.equal(other.superseded, null)
    const renewed = await created(
      t.admin,
      doc(selin, 'certificate', '2026-10-01', { replacesDocumentId: celta.document.id }),
    )
    assert.equal(renewed.superseded?.id, celta.document.id)
    assertError(
      await create(
        t.admin,
        doc(selin, 'certificate', '2026-10-02', { replacesDocumentId: celta.document.id }),
      ),
      422,
      'staff_document_replace_not_found',
    )
    await created(
      t.admin,
      doc(selin, 'health_report', '2026-01-10', { healthReportKind: 'pre_employment' }),
    )
    const detail = ok(await get(`${STAFF}/${selin}`, t.admin))
    assert.deepEqual(detail.missingTypes, ['diploma', 'id_copy'])
    const documents = detail.documents as Json[]
    assert.equal(documents.length, 6)
    assert.equal(documents.filter((item) => item.status === 'superseded').length, 2)
    const rows = await rowsOf(t.id)
    assert.equal(rows.length, 6)
    assert.equal(
      rows.every((row) => row.archivedAt === null),
      true,
    )
    assert.equal((await auditOf(t.id, 'finance.staff_document.supersede')).length, 2)
    const createAudit = await auditOf(t.id, 'finance.staff_document.create')
    assert.equal(createAudit.length, 6)
    assert.equal(JSON.stringify(createAudit).includes('CELTA'), false)
  })

  test('DOM-FIN-113: kural ihlalinde belge yazılmaz (personel, tarih, sağlık raporu türü, not)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const parent = await person(t, 'veli', 'Ayşe Yılmaz')
    const gone = await person(t, 'onburo', 'Ayrılan Personel')
    await db
      .update(memberships)
      .set({ deactivatedAt: FIXED_NOW })
      .where(and(eq(memberships.institutionId, t.id), eq(memberships.id, gone)))
    assertError(
      await create(t.admin, doc('m-yok', 'diploma', '2026-01-01')),
      422,
      'staff_document_staff_not_found',
    )
    assertError(
      await create(t.admin, doc(parent, 'diploma', '2026-01-01')),
      422,
      'staff_document_not_staff',
    )
    assertError(
      await create(t.admin, doc(gone, 'diploma', '2026-01-01')),
      422,
      'staff_document_staff_inactive',
    )
    assertError(
      await create(t.admin, doc(selin, 'diploma', '2026-10-07')),
      422,
      'staff_document_date_in_future',
    )
    assertError(await create(t.admin, doc(selin, 'health_report', '2026-01-01')), 400)
    assertError(
      await create(t.admin, doc(selin, 'criminal_record', '2026-01-01', { note: 'Temiz' })),
      422,
      'staff_document_sensitive_note',
    )
    assertError(
      await create(t.admin, doc(selin, 'diploma', '2026-01-01', { institutionId: t.id })),
      400,
    )
    assert.equal((await rowsOf(t.id)).length, 0)
  })

  test('DOM-FIN-113: özel nitelikli dosyayı yalnız yönetici açar, her açılış denetimde; listede yalnız tür ve tarih (K-374)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const desk = await member(t.id, 'onburo')
    const fileId = await upload(t, t.admin)
    assertError(
      await create(desk, doc(selin, 'criminal_record', '2026-09-01')),
      403,
      'staff_document_sensitive_forbidden',
    )
    const criminal = await created(t.admin, doc(selin, 'criminal_record', '2026-09-01', { fileId }))
    assert.deepEqual(criminal.document.file, { name: 'adli-sicil.pdf', byteSize: PDF.length })
    // Ön büro sertifikayı kendi yüklediği dosyayla kaydeder ve açar.
    const deskFile = await upload(t, desk, 'sertifika.pdf')
    const certificate = await created(
      desk,
      doc(selin, 'certificate', '2026-05-01', { fileId: deskFile, note: 'TESOL' }),
    )
    assert.equal(certificate.document.restricted, false)

    // Liste: özel nitelikli belge herkese yalnız tür ve tarih.
    for (const cookie of [t.admin, desk]) {
      const list = await listOf(cookie, DOCS)
      const row = list.data.find((item) => item.id === criminal.document.id)
      assert.equal(row?.restricted, true)
      assert.equal(row?.file, null)
      assert.equal(row?.hasFile, null)
      assert.equal(row?.note, null)
      assert.equal(row?.validUntil, '2027-03-01')
      const open = list.data.find((item) => item.id === certificate.document.id)
      assert.equal(open?.note, 'TESOL')
      assert.deepEqual(open?.file, { name: 'sertifika.pdf', byteSize: PDF.length })
    }
    // Ayrıntı: yönetici dosyayı görür, ön büro görmez.
    const adminDetail = ok(await get(`${STAFF}/${selin}`, t.admin)).documents as Json[]
    assert.equal(adminDetail.find((item) => item.id === criminal.document.id)?.hasFile, true)
    const deskDetail = ok(await get(`${STAFF}/${selin}`, desk)).documents as Json[]
    assert.equal(deskDetail.find((item) => item.id === criminal.document.id)?.restricted, true)

    const fileUrl = (id: unknown) => `${DOCS}/${String(id)}/file-url`
    assertError(
      await get(fileUrl(criminal.document.id), desk),
      403,
      'staff_document_sensitive_forbidden',
    )
    // Dosya altyapısının kendi yolundan belge dosyası açılmaz.
    assertError(await get(`/api/v1/files/${fileId}/url`, t.admin), 404)
    assertError(await get(`/api/v1/files/${fileId}`, t.admin), 404)
    const link = ok(await get(fileUrl(criminal.document.id), t.admin))
    assert.equal(typeof link.url, 'string')
    ok(await get(fileUrl(criminal.document.id), t.admin))
    ok(await get(fileUrl(certificate.document.id), desk))
    const opens = await auditOf(t.id, 'finance.staff_document.file_open')
    assert.equal(opens.length, 3)
    assert.deepEqual(opens.map((row) => `${row.actorRole}:${row.entityId}`).sort(), [
      `onburo:${String(certificate.document.id)}`,
      `yonetici:${String(criminal.document.id)}`,
      `yonetici:${String(criminal.document.id)}`,
    ])
    assert.equal(JSON.stringify(opens).includes('adli-sicil'), false)
    const noFile = await created(t.admin, doc(selin, 'diploma', '2020-06-30'))
    assertError(await get(fileUrl(noFile.document.id), t.admin), 422, 'staff_document_no_file')
    // Bir dosya ikinci belgeye bağlanmaz.
    assertError(
      await create(t.admin, doc(selin, 'id_copy', '2026-01-01', { fileId })),
      409,
      'file_already_attached',
    )
    const [attached] = await db
      .select({ attachedType: files.attachedType, attachedId: files.attachedId })
      .from(files)
      .where(and(eq(files.institutionId, t.id), eq(files.id, fileId)))
    assert.deepEqual(attached, { attachedType: 'staff_document', attachedId: criminal.document.id })
    assert.equal((await rowsOf(t.id)).length, 3)
  })

  test('DOM-FIN-113: geçerlilik takibi ve uyarılar: süresi geçen, N gün içinde biten, eksik zorunlu belge', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const deniz = await person(t, 'onburo', 'Deniz Acar')
    const gone = await person(t, 'ogretmen', 'Ayrılan Öğretmen')
    // Selin'in bütün zorunlu belgeleri var; adli sicili 2026-10-20'de, sağlık raporu geçmiş.
    await created(t.admin, doc(selin, 'diploma', '2015-06-30'))
    await created(t.admin, doc(selin, 'id_copy', '2020-01-01'))
    await created(t.admin, doc(selin, 'criminal_record', '2026-04-20'))
    await created(
      t.admin,
      doc(selin, 'health_report', '2021-09-01', { healthReportKind: 'periodic' }),
    )
    await created(t.admin, doc(deniz, 'certificate', '2026-01-01', { validUntil: '2026-12-31' }))
    await created(t.admin, doc(gone, 'criminal_record', '2026-01-01'))
    await db
      .update(memberships)
      .set({ deactivatedAt: FIXED_NOW })
      .where(and(eq(memberships.institutionId, t.id), eq(memberships.id, gone)))

    const alerts = ok(await get(ALERTS, t.admin))
    // Yönetici de personeldir: Selin dışındakiler (yönetici, Deniz) eksik sayılır; pasif sayılmaz.
    assert.deepEqual(alerts, {
      withinDays: 30,
      expiredCount: 1,
      expiringCount: 1,
      staffMissingCount: 2,
    })
    assert.equal(ok(await get(`${ALERTS}?withinDays=90`, t.admin)).expiringCount, 2)

    const attention = await listOf(t.admin, `${DOCS}?due=attention`)
    assert.deepEqual(
      attention.data.map((row) => [row.documentType, row.status, row.daysLeft]),
      [
        ['health_report', 'expired', -35],
        ['criminal_record', 'expiring', 14],
      ],
    )
    assert.equal((await listOf(t.admin, `${DOCS}?due=expired`)).meta.total, 1)
    assert.equal((await listOf(t.admin, `${DOCS}?due=expiring&withinDays=90`)).meta.total, 2)
    assert.equal((await listOf(t.admin, `${DOCS}?documentType=diploma`)).meta.total, 1)
    assert.equal((await listOf(t.admin, `${DOCS}?q=deniz`)).meta.total, 1)
    // Pasif personelin belgesi takipte yok.
    assert.equal(
      (await listOf(t.admin, DOCS)).data.some((row) => row.membershipId === gone),
      false,
    )

    const staff = await listOf(t.admin, STAFF)
    const selinRow = staff.data.find((row) => row.membershipId === selin)
    assert.deepEqual(
      [
        selinRow?.documentCount,
        selinRow?.missingTypes,
        selinRow?.expiredCount,
        selinRow?.expiringCount,
      ],
      [4, [], 1, 1],
    )
    const goneRow = staff.data.find((row) => row.membershipId === gone)
    assert.deepEqual([goneRow?.active, goneRow?.missingTypes], [false, []])
    const missing = await listOf(t.admin, `${STAFF}?missing=true`)
    assert.equal(missing.meta.total, 2)
    assert.equal(
      missing.data.some((row) => row.membershipId === selin),
      false,
    )
    assert.deepEqual(missing.data.find((row) => row.membershipId === deniz)?.missingTypes, [
      'diploma',
      'health_report',
      'criminal_record',
      'id_copy',
    ])
    // Zorunluluk kaldırılınca eksik sayısı düşer.
    ok(
      await call('PATCH', TYPES, t.admin, {
        health_report: { required: false, validityMonths: 60, sensitive: true },
        criminal_record: { required: false, validityMonths: 6, sensitive: true },
        diploma: { required: false, validityMonths: null, sensitive: false },
        id_copy: { required: false, validityMonths: null, sensitive: false },
      }),
    )
    assert.equal(ok(await get(ALERTS, t.admin)).staffMissingCount, 0)
  })

  test('DOM-FIN-113: başka kurumun personeli ve belgesi 404 ve B değişmez; listede yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bStaff = await person(b, 'ogretmen', 'Beta Öğretmen')
    const bFile = await upload(b, b.admin)
    const bDoc = (await created(b.admin, doc(bStaff, 'diploma', '2020-06-30', { fileId: bFile })))
      .document

    ok(
      await call('PATCH', TYPES, b.admin, {
        certificate: { required: true, validityMonths: 12, sensitive: false },
      }),
    )
    const aTypes = ok(await get(TYPES, a.admin)) as unknown as Json[]
    assert.equal(aTypes.find((row) => row.documentType === 'certificate')?.required, false)
    assertError(
      await call('PATCH', TYPES, a.admin, {
        certificate: { required: false, validityMonths: null, sensitive: false },
        institutionId: b.id,
      }),
      400,
    )
    assertError(await get(`${STAFF}/${bStaff}`, a.admin), 404)
    assertError(await get(`${DOCS}/${String(bDoc.id)}/file-url`, a.admin), 404)
    assert.equal(
      (await listOf(a.admin, STAFF)).data.some((row) => row.membershipId === bStaff),
      false,
    )
    assert.equal(
      (await listOf(a.admin, DOCS)).data.some((row) => row.id === bDoc.id),
      false,
    )
    assert.equal(ok(await get(ALERTS, a.admin)).staffMissingCount, 1)
    assertError(
      await create(a.admin, doc(bStaff, 'diploma', '2020-06-30')),
      422,
      'staff_document_staff_not_found',
    )
    assertError(
      await create(a.admin, { ...doc(bStaff, 'diploma', '2020-06-30'), institutionId: b.id }),
      400,
    )
    const aStaff = await person(a, 'ogretmen', 'Alfa Öğretmen')
    assertError(
      await create(a.admin, doc(aStaff, 'diploma', '2020-06-30', { fileId: bFile })),
      422,
      'file_unavailable',
    )
    assertError(
      await create(
        a.admin,
        doc(aStaff, 'certificate', '2020-06-30', { replacesDocumentId: bDoc.id }),
      ),
      422,
      'staff_document_replace_not_found',
    )
    assert.equal((await rowsOf(a.id)).length, 0)
    const [bRow] = await rowsOf(b.id)
    assert.equal(bRow?.supersededAt, null)
    assert.equal(bRow?.version, 1)
    assert.equal((await auditOf(b.id, 'finance.staff_document.file_open')).length, 0)
  })

  test('DOM-FIN-113: Idempotency-Key ile yinelenen kayıt aynı yanıtı döner, tek satır yazılır', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const headers = { 'idempotency-key': randomUUID() }
    const body = doc(selin, 'criminal_record', '2026-09-01')
    const first = await create(t.admin, body, headers)
    const second = await create(t.admin, body, headers)
    assert.equal(first.statusCode, 201)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal(second.json().data.document.id, first.json().data.document.id)
    assert.equal((await rowsOf(t.id)).length, 1)
  })
})
