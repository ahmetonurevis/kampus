import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { academicYears } from '../src/db/schema/academic-years.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { memberships } from '../src/db/schema/auth.ts'
import { files } from '../src/db/schema/files.ts'
import { staffDevelopmentGoals } from '../src/db/schema/finance-observation-debriefs.ts'
import {
  professionalDevelopmentEnrollments,
  professionalDevelopmentTargets,
} from '../src/db/schema/finance-professional-development.ts'
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
 * Mesleki gelişim saati, hedef, katılım belgesi, sertifika ve gelişim hedefi bağı uçları
 * (DOM-FIN-144; ON-215; K-487…K-489). Saat 2026-10-06; öğretim yılı 2026 (1 Eylül 2026 – 31 Ağustos
 * 2027). Her test kendi kurumunu kurar.
 */

const FINANCE = '/api/v1/finance'
const PROGRAMS = `${FINANCE}/professional-development`
const HOURS = `${FINANCE}/professional-development-hours`
const TARGETS = `${FINANCE}/professional-development-targets`
const LONG_AGO = new Date('2014-05-01T09:00:00.000Z')

type Json = Record<string, unknown>
type Program = Json & { id: string; version: number }
type Enrollment = Json & {
  id: string
  version: number
  status: string
  document: Json | null
  certificate: Json | null
  developmentGoal: Json | null
}
type Response = Awaited<ReturnType<App['inject']>>
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

describe('DOM-FIN-144: mesleki gelişim saati ve belgeleri uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  let tenantCount = 0
  let clientIp = '10.215.0.1'

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
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
  function call(
    method: Method,
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
  function ok<T = Json>(response: Response, status = 200): T {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as T
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const listOf = async (cookie: string, url: string) => {
    const response = await get(url, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number; academicYear: number } }
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.215.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
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
  async function upload(t: Tenant, name = 'sertifika.pdf') {
    const body = multipart(uploadParts('document', PDF, name))
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

  const PROGRAM = {
    name: 'Okuma becerisi öğretimi',
    kind: 'seminar',
    provider: 'Öğretmen Akademisi',
    durationHours: 6,
    startDate: '2026-09-20',
    endDate: '2026-09-21',
    location: 'Konferans salonu',
  }
  async function program(t: Tenant, extra: Json = {}) {
    const draft = ok<Program>(
      await call('POST', PROGRAMS, t.admin, { ...PROGRAM, ...extra }, key()),
      201,
    )
    return ok<Program>(
      await call(
        'POST',
        `${PROGRAMS}/${draft.id}/status`,
        t.admin,
        { status: 'published' },
        ifMatch(draft.version),
      ),
    )
  }
  const enrollmentUrl = (p: { id: string }, e: { id: string }) =>
    `${PROGRAMS}/${p.id}/enrollments/${e.id}`
  async function enroll(t: Tenant, p: Program, membershipId: string) {
    return ok<Enrollment>(
      await call('POST', `${PROGRAMS}/${p.id}/enrollments`, t.admin, { membershipId }, key()),
      201,
    )
  }
  const mark = (t: Tenant, p: Program, e: Enrollment, body: Json) =>
    call('PATCH', enrollmentUrl(p, e), t.admin, body, ifMatch(e.version))
  async function attended(t: Tenant, p: Program, membershipId: string, hours = 6) {
    const e = await enroll(t, p, membershipId)
    return ok<Enrollment>(await mark(t, p, e, { status: 'attended', attendedHours: hours }))
  }
  const attach = (t: { admin: string }, p: Program, e: Enrollment, fileId: string) =>
    call('POST', `${enrollmentUrl(p, e)}/document`, t.admin, { fileId }, ifMatch(e.version))
  const link = (cookie: string, p: Program, e: Enrollment, body: Json) =>
    call('POST', `${enrollmentUrl(p, e)}/certificate`, cookie, body, {
      ...key(),
      ...ifMatch(e.version),
    })
  const setTarget = (cookie: string, year: number, body: Json) =>
    call('PATCH', `${TARGETS}/${String(year)}`, cookie, body)
  async function staffDocument(t: Tenant, membershipId: string, documentType: string) {
    return ok<{ document: { id: string } }>(
      await call(
        'POST',
        `${FINANCE}/staff-documents`,
        t.admin,
        { membershipId, documentType, documentDate: '2026-09-01' },
        key(),
      ),
      201,
    ).document.id
  }
  async function goal(t: Tenant, membershipId: string, status: 'open' | 'achieved' = 'open') {
    const id = randomUUID()
    await db.insert(staffDevelopmentGoals).values({
      institutionId: t.id,
      id,
      teacherMembershipId: membershipId,
      source: 'direct',
      title: 'Okuma etkinliklerini çeşitlendir',
      successCriterion: 'Her ünitede iki farklı okuma etkinliği',
      followUpDate: '2026-12-01',
      status,
      closedAt: status === 'achieved' ? FIXED_NOW : null,
      createdByUserId: 'test',
    })
    return id
  }
  const enrollmentRows = (institutionId: string) =>
    db
      .select()
      .from(professionalDevelopmentEnrollments)
      .where(eq(professionalDevelopmentEnrollments.institutionId, institutionId))
  const actionsOf = async (institutionId: string) =>
    (
      await db
        .select({ action: auditLog.action, changes: auditLog.changes })
        .from(auditLog)
        .where(eq(auditLog.institutionId, institutionId))
    ).filter((row) => row.action.startsWith('finance.professional_development.'))

  test('kimliksiz istek 401; ön büro, öğretmen ve veli 403; modül kapalıyken 403', async () => {
    const t = await institution()
    assertError(await get(HOURS, null), 401)
    assertError(await get(`${TARGETS}/2026`, null), 401)
    for (const role of ['onburo', 'ogretmen', 'veli'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(HOURS, cookie), 403)
      assertError(await get(`${TARGETS}/2026`, cookie), 403)
      assertError(await setTarget(cookie, 2026, { targetHours: 10 }), 403)
    }
    const desk = await member(t.id, 'onburo')
    const teacher = await person(t, 'ogretmen', 'Selin Kaya')
    const p = await program(t)
    const e = await attended(t, p, teacher)
    assertError(await attach({ admin: desk }, p, e, randomUUID()), 403)
    assertError(await link(desk, p, e, { source: 'existing', staffDocumentId: randomUUID() }), 403)
    assertError(await get(`${enrollmentUrl(p, e)}/document/url`, desk), 403)
    // Ön büro katılımcı listesini okur ama belge, sertifika ve hedef ona dönmez (K-430, K-488).
    const roster = await listOf(desk, `${PROGRAMS}/${p.id}/enrollments`)
    assert.equal(roster.data[0]?.document, null)
    assert.equal(roster.data[0]?.developmentGoal, null)

    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(HOURS, closed.admin), 403, 'module_disabled')
    assertError(await setTarget(closed.admin, 2026, { targetHours: 10 }), 403, 'module_disabled')
  })

  test('DOM-FIN-144: K-487 hedef ayarı öğretim yılı başına; varsayılan tanımsız; kaldırılır', async () => {
    const t = await institution()
    const empty = ok<Json>(await get(`${TARGETS}/2026`, t.admin))
    assert.deepEqual(empty, {
      academicYear: 2026,
      startDate: '2026-09-01',
      endDate: '2027-08-31',
      targetHours: null,
      appliesToRoles: [],
      updatedAt: null,
      version: null,
    })
    // Doğrulama hatası kaydı değiştirmez.
    assertError(await setTarget(t.admin, 2026, { targetHours: 1.5 }), 400)
    assertError(await setTarget(t.admin, 2026, { targetHours: 10, appliesToRoles: [] }), 400)
    assertError(await get(`${TARGETS}/1999`, t.admin), 400)
    assert.equal(
      (
        await db
          .select()
          .from(professionalDevelopmentTargets)
          .where(eq(professionalDevelopmentTargets.institutionId, t.id))
      ).length,
      0,
    )

    const saved = ok<Json>(await setTarget(t.admin, 2026, { targetHours: 40 }))
    assert.equal(saved.targetHours, 40)
    assert.deepEqual(saved.appliesToRoles, ['ogretmen'])
    assert.equal(saved.version, 1)
    const again = ok<Json>(
      await setTarget(t.admin, 2026, { targetHours: 30, appliesToRoles: ['ogretmen', 'yonetici'] }),
    )
    assert.equal(again.targetHours, 30)
    assert.equal(again.version, 2)
    // Kayıtlı öğretim yılı aralığı varsayılanın yerine geçer (kurum açılışı 2026 yılını kurar).
    await db
      .update(academicYears)
      .set({ startDate: '2026-09-14', endDate: '2027-06-30' })
      .where(and(eq(academicYears.institutionId, t.id), eq(academicYears.startYear, 2026)))
    const registered = ok<Json>(await get(`${TARGETS}/2026`, t.admin))
    assert.equal(registered.startDate, '2026-09-14')
    assert.equal(registered.endDate, '2027-06-30')
    assert.equal(ok<Json>(await get(`${TARGETS}/2027`, t.admin)).targetHours, null)

    const removed = ok<Json>(await setTarget(t.admin, 2026, { targetHours: null }))
    assert.equal(removed.targetHours, null)
    const audits = (await actionsOf(t.id)).filter(
      (row) => row.action === 'finance.professional_development.target',
    )
    assert.equal(audits.length, 3)
    assert.deepEqual(audits[0]?.changes, { fields: ['targetHours', 'appliesToRoles'] })
  })

  test('DOM-FIN-144: K-487 personel bazında tamamlanan, hedef ve eksik saat; özlük kartında özet', async () => {
    const t = await institution()
    const deniz = await person(t, 'ogretmen', 'Deniz Öğretmen')
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const desk = await person(t, 'onburo', 'Ön Büro Ayşe')
    const left = await person(t, 'ogretmen', 'Ayrılan Öğretmen')
    const seminar = await program(t)
    const course = await program(t, { name: 'Ölçme ve değerlendirme', durationHours: 20 })
    const ongoing = await program(t, {
      name: 'Kendi hızında dijital okuryazarlık',
      kind: 'online',
      ongoing: true,
      startDate: null,
      endDate: null,
      location: null,
      onlineUrl: 'https://egitim.example.com/kurs',
    })
    const lastYear = await program(t, {
      name: 'Geçen yılın semineri',
      startDate: '2026-05-10',
      endDate: '2026-05-10',
    })
    await attended(t, seminar, deniz, 6)
    await attended(t, course, deniz, 20)
    await attended(t, ongoing, selin, 4.5)
    await attended(t, lastYear, selin, 6)
    await attended(t, seminar, desk, 3)
    await enroll(t, course, selin)
    await attended(t, seminar, left, 6)
    await db
      .update(memberships)
      .set({ deactivatedAt: LONG_AGO })
      .where(and(eq(memberships.institutionId, t.id), eq(memberships.id, left)))

    // Hedef yokken herkes hedefsiz; durum süzgeci boş.
    const free = await listOf(t.admin, HOURS)
    assert.equal(free.meta.academicYear, 2026)
    const byName = (rows: Json[]) => Object.fromEntries(rows.map((row) => [row.name, row]))
    const freeRows = byName(free.data)
    assert.equal(freeRows['Ayrılan Öğretmen'], undefined)
    assert.deepEqual(
      { ...freeRows['Deniz Öğretmen'], membershipId: undefined },
      {
        membershipId: undefined,
        name: 'Deniz Öğretmen',
        role: 'ogretmen',
        attendedCount: 2,
        completedHours: 26,
        targetHours: null,
        missingHours: null,
        met: null,
      },
    )
    assert.equal(freeRows['Selin Kaya']?.completedHours, 4.5)
    assert.equal(freeRows['Ön Büro Ayşe']?.completedHours, 3)
    assert.equal((await listOf(t.admin, `${HOURS}?status=missing`)).meta.total, 0)

    ok(await setTarget(t.admin, 2026, { targetHours: 24 }))
    const rows = byName((await listOf(t.admin, HOURS)).data)
    assert.equal(rows['Deniz Öğretmen']?.met, true)
    assert.equal(rows['Deniz Öğretmen']?.missingHours, 0)
    assert.equal(rows['Selin Kaya']?.missingHours, 19.5)
    assert.equal(rows['Selin Kaya']?.targetHours, 24)
    // Ön büro hedef rolünde değil: hedefsiz görünür, eksik listesine girmez.
    assert.equal(rows['Ön Büro Ayşe']?.targetHours, null)
    const missing = await listOf(t.admin, `${HOURS}?status=missing`)
    assert.deepEqual(
      missing.data.map((row) => row.name),
      ['Selin Kaya'],
    )
    assert.deepEqual(
      (await listOf(t.admin, `${HOURS}?status=met`)).data.map((row) => row.name),
      ['Deniz Öğretmen'],
    )
    assert.deepEqual(
      (await listOf(t.admin, `${HOURS}?q=selin`)).data.map((row) => row.name),
      ['Selin Kaya'],
    )
    // Geçen öğretim yılı ayrı sayılır.
    const previous = byName((await listOf(t.admin, `${HOURS}?academicYear=2025`)).data)
    assert.equal(previous['Selin Kaya']?.completedHours, 6)
    assert.equal(previous['Selin Kaya']?.targetHours, null)
    assertError(await get(`${HOURS}?status=eksik`, t.admin), 400)

    // Özlük kartı eğitim grubunda içinde bulunulan yılın özeti.
    ok(
      await call(
        'POST',
        `${FINANCE}/personnel-files`,
        t.admin,
        { membershipId: selin, education: [] },
        key(),
      ),
      201,
    )
    const card = ok<Json>(await get(`${FINANCE}/personnel-files/${selin}`, t.admin))
    assert.deepEqual(card.professionalDevelopment, {
      academicYear: 2026,
      attendedCount: 1,
      completedHours: 4.5,
      targetHours: 24,
      missingHours: 19.5,
      met: false,
    })
  })

  test('DOM-FIN-144: K-488 katılım belgesi yalnız katıldıda; değiştirilir, açılışı denetimde, kaldırılır', async () => {
    const t = await institution()
    const teacher = await person(t, 'ogretmen', 'Selin Kaya')
    const p = await program(t)
    const assigned = await enroll(t, p, teacher)
    const first = await upload(t, 'katilim.pdf')
    assertError(
      await attach(t, p, assigned, first),
      422,
      'professional_development_document_not_attended',
    )
    const e = ok<Enrollment>(await mark(t, p, assigned, { status: 'attended', attendedHours: 6 }))
    assertError(await attach(t, p, e, randomUUID()), 422, 'file_unavailable')
    assertError(
      await call('POST', `${enrollmentUrl(p, e)}/document`, t.admin, { fileId: first }),
      400,
      'if_match_required',
    )

    const withDoc = ok<Enrollment>(await attach(t, p, e, first))
    assert.equal(withDoc.document?.fileId, first)
    assert.equal(withDoc.document?.name, 'katilim.pdf')
    const second = await upload(t, 'katilim-2.pdf')
    // Eski sürümle 409; yeni belge eskisinin yerine geçer, eski dosyanın bağı kalkar.
    assertError(await attach(t, p, e, second), 409)
    const replaced = ok<Enrollment>(await attach(t, p, withDoc, second))
    assert.equal(replaced.document?.fileId, second)
    const [oldFile] = await db.select().from(files).where(eq(files.id, first))
    assert.equal(oldFile?.attachedId, null)
    const [newFile] = await db.select().from(files).where(eq(files.id, second))
    assert.equal(newFile?.attachedType, 'professional_development_enrollment')

    // Dosya yalnız denetim yazan uçtan açılır.
    assertError(await get(`/api/v1/files/${second}/url`, t.admin), 404)
    const opened = ok<Json>(await get(`${enrollmentUrl(p, e)}/document/url`, t.admin))
    assert.match(String(opened.url), /^http/)
    // Belgesi olan katılım geri alınamaz.
    assertError(
      await mark(t, p, replaced, { status: 'not_completed' }),
      409,
      'professional_development_attendance_has_documents',
    )

    const removed = ok<Enrollment>(
      await call(
        'DELETE',
        `${enrollmentUrl(p, e)}/document`,
        t.admin,
        undefined,
        ifMatch(replaced.version),
      ),
    )
    assert.equal(removed.document, null)
    assertError(
      await call(
        'DELETE',
        `${enrollmentUrl(p, e)}/document`,
        t.admin,
        undefined,
        ifMatch(removed.version),
      ),
      422,
      'professional_development_no_document',
    )
    assertError(
      await get(`${enrollmentUrl(p, e)}/document/url`, t.admin),
      422,
      'professional_development_no_document',
    )
    assert.deepEqual(
      (await actionsOf(t.id))
        .map((row) => row.action)
        .filter((action) => action.includes('document')),
      [
        'finance.professional_development.document_attach',
        'finance.professional_development.document_attach',
        'finance.professional_development.document_open',
        'finance.professional_development.document_remove',
      ],
    )
  })

  test('DOM-FIN-144: K-488 sertifika özlük belgesine bağlanır ya da yüklemeyle açılır; tek katılıma', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const deniz = await person(t, 'ogretmen', 'Deniz Öğretmen')
    const p = await program(t)
    const other = await program(t, { name: 'Ölçme ve değerlendirme' })
    const e = await attended(t, p, selin)
    const own = await staffDocument(t, selin, 'certificate')
    const diploma = await staffDocument(t, selin, 'diploma')
    const foreign = await staffDocument(t, deniz, 'certificate')

    assertError(
      await link(t.admin, p, e, { source: 'existing', staffDocumentId: foreign }),
      422,
      'professional_development_certificate_not_found',
    )
    assertError(
      await link(t.admin, p, e, { source: 'existing', staffDocumentId: diploma }),
      422,
      'professional_development_certificate_wrong_type',
    )
    assertError(await link(t.admin, p, e, { source: 'existing' }), 400)
    // Idempotency-Key zorunlu.
    assertError(
      await call(
        'POST',
        `${enrollmentUrl(p, e)}/certificate`,
        t.admin,
        { source: 'existing', staffDocumentId: own },
        ifMatch(e.version),
      ),
      400,
    )
    const linked = ok<Enrollment>(
      await link(t.admin, p, e, { source: 'existing', staffDocumentId: own }),
    )
    assert.deepEqual(linked.certificate, {
      staffDocumentId: own,
      documentDate: '2026-09-01',
      validUntil: null,
    })
    assertError(
      await link(t.admin, p, linked, { source: 'existing', staffDocumentId: own }),
      409,
      'professional_development_certificate_exists',
    )
    const second = await attended(t, other, selin)
    assertError(
      await link(t.admin, other, second, { source: 'existing', staffDocumentId: own }),
      409,
      'professional_development_certificate_linked',
    )
    assertError(
      await mark(t, p, linked, { status: 'assigned' }),
      409,
      'professional_development_attendance_has_documents',
    )

    // Yüklemeyle yeni sertifika özlük belgesi aynı işlemde açılır; özlük belgesi kuralları geçer.
    const fileId = await upload(t)
    assertError(
      await link(t.admin, other, second, {
        source: 'upload',
        fileId,
        documentDate: '2026-12-01',
      }),
      422,
      'staff_document_date_in_future',
    )
    const before = await db
      .select()
      .from(staffDocuments)
      .where(eq(staffDocuments.institutionId, t.id))
    assert.equal(before.length, 3)
    const created = ok<Enrollment>(
      await link(t.admin, other, second, { source: 'upload', fileId, documentDate: '2026-09-21' }),
    )
    const certificateId = String(created.certificate?.staffDocumentId)
    const [doc] = await db.select().from(staffDocuments).where(eq(staffDocuments.id, certificateId))
    assert.equal(doc?.documentType, 'certificate')
    assert.equal(doc?.membershipId, selin)
    assert.equal(doc?.fileId, fileId)
    const staffDocs = ok<{ documents: Json[] }>(
      await get(`${FINANCE}/staff-document-staff/${selin}`, t.admin),
    )
    assert.ok(staffDocs.documents.some((row) => row.id === certificateId))

    const unlinked = ok<Enrollment>(
      await call(
        'DELETE',
        `${enrollmentUrl(p, e)}/certificate`,
        t.admin,
        undefined,
        ifMatch(linked.version),
      ),
    )
    assert.equal(unlinked.certificate, null)
    // Bağ kalkınca özlük belgesi kalır.
    assert.equal(
      (await db.select().from(staffDocuments).where(eq(staffDocuments.id, own))).length,
      1,
    )
    assertError(
      await call(
        'DELETE',
        `${enrollmentUrl(p, e)}/certificate`,
        t.admin,
        undefined,
        ifMatch(unlinked.version),
      ),
      422,
      'professional_development_no_certificate',
    )
    const actions = (await actionsOf(t.id)).map((row) => row.action)
    assert.equal(
      actions.filter((a) => a === 'finance.professional_development.certificate_link').length,
      2,
    )
    assert.equal(
      actions.filter((a) => a === 'finance.professional_development.certificate_unlink').length,
      1,
    )
  })

  test('DOM-FIN-144: K-489 katılım aynı personelin açık gelişim hedefine katkı olarak işaretlenir', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const deniz = await person(t, 'ogretmen', 'Deniz Öğretmen')
    const p = await program(t)
    const e = await attended(t, p, selin)
    const open = await goal(t, selin)
    const foreign = await goal(t, deniz)
    const closed = await goal(t, selin, 'achieved')
    const body = { status: 'attended', attendedHours: 6 }
    assertError(
      await mark(t, p, e, { ...body, developmentGoalId: foreign }),
      422,
      'professional_development_goal_not_found',
    )
    assertError(
      await mark(t, p, e, { ...body, developmentGoalId: closed }),
      422,
      'professional_development_goal_closed',
    )
    assertError(await mark(t, p, e, { ...body, developmentGoalId: randomUUID() }), 422)
    const linked = ok<Enrollment>(await mark(t, p, e, { ...body, developmentGoalId: open }))
    assert.deepEqual(linked.developmentGoal, {
      id: open,
      title: 'Okuma etkinliklerini çeşitlendir',
    })
    // Alan verilmezse bağ değişmez; hedef kapansa da bağ kalır.
    await db
      .update(staffDevelopmentGoals)
      .set({ status: 'achieved', closedAt: FIXED_NOW })
      .where(eq(staffDevelopmentGoals.id, open))
    const kept = ok<Enrollment>(await mark(t, p, linked, { status: 'attended', attendedHours: 5 }))
    assert.equal(kept.developmentGoal?.id, open)
    const cleared = ok<Enrollment>(await mark(t, p, kept, { ...body, developmentGoalId: null }))
    assert.equal(cleared.developmentGoal, null)
    const attendance = (await actionsOf(t.id)).filter(
      (row) => row.action === 'finance.professional_development.attendance',
    )
    assert.deepEqual(attendance.at(-1)?.changes, {
      fields: ['status', 'attendedHours', 'developmentGoalId'],
    })
  })

  test('DOM-FIN-144: özlük imhası (DOM-FIN-122) katılımları, belgelerini ve sertifikaları kapsar', async () => {
    const t = await institution()
    const gone = await person(t, 'ogretmen', 'Eski Öğretmen')
    const stays = await person(t, 'ogretmen', 'Kalan Öğretmen')
    const p = await program(t)
    const e = await attended(t, p, gone)
    const documentFile = await upload(t, 'katilim.pdf')
    const withDoc = ok<Enrollment>(await attach(t, p, e, documentFile))
    ok(
      await link(t.admin, p, withDoc, {
        source: 'upload',
        fileId: await upload(t),
        documentDate: '2026-09-21',
      }),
    )
    await attended(t, p, stays)
    await db
      .update(memberships)
      .set({ deactivatedAt: LONG_AGO })
      .where(and(eq(memberships.institutionId, t.id), eq(memberships.id, gone)))

    const destruction = ok<Json>(
      await call(
        'POST',
        `${FINANCE}/staff-data-destructions`,
        t.admin,
        { membershipId: gone, category: 'personnel_file' },
        key(),
      ),
      201,
    )
    assert.equal(destruction.recordCount, 2)
    assert.equal(destruction.fileCount, 2)
    const remaining = await enrollmentRows(t.id)
    assert.deepEqual(
      remaining.map((row) => row.membershipId),
      [stays],
    )
    const [file] = await db.select().from(files).where(eq(files.id, documentFile))
    assert.ok(file?.retentionUntil !== null && file?.retentionUntil !== undefined)
  })

  test('DOM-FIN-144: başka kurumun katılımı, belgesi ve hedefi 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bTeacher = await person(b, 'ogretmen', 'Beta Öğretmen')
    const bProgram = await program(b)
    const bEnrollment = await attended(b, bProgram, bTeacher)
    ok(await setTarget(b.admin, 2026, { targetHours: 12 }))
    const bBefore = await enrollmentRows(b.id)
    const aFile = await upload(a)

    assertError(await attach(a, bProgram, bEnrollment, aFile), 404)
    assertError(
      await call(
        'DELETE',
        `${enrollmentUrl(bProgram, bEnrollment)}/document`,
        a.admin,
        undefined,
        ifMatch(bEnrollment.version),
      ),
      404,
    )
    assertError(await get(`${enrollmentUrl(bProgram, bEnrollment)}/document/url`, a.admin), 404)
    assertError(
      await link(a.admin, bProgram, bEnrollment, {
        source: 'upload',
        fileId: aFile,
        documentDate: '2026-09-21',
      }),
      404,
    )
    assertError(
      await call(
        'DELETE',
        `${enrollmentUrl(bProgram, bEnrollment)}/certificate`,
        a.admin,
        undefined,
        ifMatch(bEnrollment.version),
      ),
      404,
    )
    // A'nın kendi katılımına B'nin hedefi ya da belgesi bağlanamaz.
    const aTeacher = await person(a, 'ogretmen', 'Alfa Öğretmen')
    const aProgram = await program(a)
    const aEnrollment = await attended(a, aProgram, aTeacher)
    const bGoal = await goal(b, bTeacher)
    assertError(
      await mark(a, aProgram, aEnrollment, {
        status: 'attended',
        attendedHours: 6,
        developmentGoalId: bGoal,
      }),
      422,
      'professional_development_goal_not_found',
    )
    const bDoc = await staffDocument(b, bTeacher, 'certificate')
    assertError(
      await link(a.admin, aProgram, aEnrollment, { source: 'existing', staffDocumentId: bDoc }),
      422,
      'professional_development_certificate_not_found',
    )
    assert.deepEqual(await enrollmentRows(b.id), bBefore)

    // Liste ve hedef kurum kapsamlıdır; gövdedeki kurum kimliği reddedilir.
    const aHours = await listOf(a.admin, HOURS)
    assert.ok(aHours.data.every((row) => row.membershipId !== bTeacher))
    assert.equal(ok<Json>(await get(`${TARGETS}/2026`, a.admin)).targetHours, null)
    assertError(await setTarget(a.admin, 2026, { targetHours: 10, institutionId: b.id }), 400)
    assert.equal(ok<Json>(await get(`${TARGETS}/2026`, b.admin)).targetHours, 12)
  })
})
