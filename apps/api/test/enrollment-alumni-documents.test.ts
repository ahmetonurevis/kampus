import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import { ROLES } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import type { RecordData } from '../src/db/collections.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { alumniDocumentRequests } from '../src/db/schema/enrollment-alumni-documents.ts'
import { files } from '../src/db/schema/files.ts'
import { studentGuardians } from '../src/db/schema/student-guardians.ts'
import { studentIdentities } from '../src/db/schema/student-identities.ts'
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
 * Mezun belge talebi uçları (DOM-KAY-044; ON-260, K-328…K-331). Her test kendi kurumunu kurar:
 * mezun Deniz (12-A, 2026-06-26 mezuniyet, reşit), ayrılan Ece (reşit değil, velisi Ayşe velayetli,
 * Kemal'in iletişimi kısıtlı) ve aktif Can. FIXED_NOW 2026-10-06.
 */

const BASE = '/api/v1/prospects/alumni-document-requests'
const STUDENTS = '/api/v1/prospects/alumni-document-students'
const FEES = '/api/v1/prospects/alumni-document-fees'
const GRADUATE = 'alu-s1'
const LEAVER = 'alu-s2'
const ACTIVE = 'alu-s3'

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

const graduateRequest = (overrides: Json = {}): Json => ({
  studentId: GRADUATE,
  documentType: 'transcript',
  copies: 2,
  channel: 'petition',
  requesterKind: 'self',
  deliveryMethod: 'in_person',
  ...overrides,
})

describe('DOM-KAY-044: mezun belge talebi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenants = 0
  let clientIp = '10.144.0.1'

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
    clientIp = `10.144.${String((tenants += 1))}.1`
    const created = await createInstitution(app, { name: 'Akademi Özel Okulları', ...overrides })
    const student = (
      id: string,
      data: RecordData,
    ): { collection: 'students'; id: string; data: RecordData } => ({
      collection: 'students',
      id,
      data: { id, ...data },
    })
    await insertMissingRecords(
      db,
      created.id,
      [
        { collection: 'classes', id: 'alu-c11', data: { id: 'alu-c11', name: '11-A' } },
        { collection: 'classes', id: 'alu-c12', data: { id: 'alu-c12', name: '12-A' } },
        { collection: 'classes', id: 'alu-c9', data: { id: 'alu-c9', name: '9-B' } },
        student(GRADUATE, {
          name: 'Deniz Yılmaz',
          classId: 'alu-c12',
          number: '2022001',
          joinedAt: '2022-09-12T07:00:00.000Z',
          isActive: false,
        }),
        student(LEAVER, {
          name: 'Ece Yılmaz',
          classId: 'alu-c9',
          number: '2025007',
          isActive: false,
        }),
        student(ACTIVE, { name: 'Can Demir', classId: 'alu-c11', isActive: true }),
        { collection: 'parents', id: 'alu-p1', data: { id: 'alu-p1', name: 'Ayşe Yılmaz' } },
        { collection: 'parents', id: 'alu-p2', data: { id: 'alu-p2', name: 'Kemal Yılmaz' } },
        {
          collection: 'renewals',
          id: 'alu-r1',
          data: {
            id: 'alu-r1',
            studentId: GRADUATE,
            mode: 'graduate',
            status: 'Mezun',
            year: 2026,
            fromClassId: 'alu-c12',
            targetClassId: 'alu-c12',
            createdAt: '2026-06-01T07:00:00.000Z',
            activatedAt: '2026-06-26T08:00:00.000Z',
          },
        },
        ...[
          ['g1', 'alu-c11', 1, 'mat', 'Matematik', 80, '2025-11-03'],
          ['g2', 'alu-c11', 1, 'mat', 'Matematik', 91, '2025-12-03'],
          ['g3', 'alu-c11', 2, 'fiz', 'Fizik', 70, '2026-03-03'],
          ['g4', 'alu-c12', 1, 'mat', 'Matematik', 100, '2025-10-01'],
        ].map(([id, classId, term, subjectId, subject, score, date]) => ({
          collection: 'grades' as const,
          id: `alu-${String(id)}`,
          data: {
            id: `alu-${String(id)}`,
            studentId: GRADUATE,
            classId,
            term,
            subjectId,
            subject,
            score,
            date: `${String(date)}T09:00:00.000Z`,
            assessmentType: 'sinav',
          },
        })),
      ],
      FIXED_NOW,
    )
    await db.insert(studentIdentities).values([
      {
        institutionId: created.id,
        studentId: GRADUATE,
        identityKind: 'tc',
        identityNumber: '10000000146',
        birthDate: '2008-02-01',
        academicYear: 2022,
      },
      {
        institutionId: created.id,
        studentId: LEAVER,
        identityKind: 'tc',
        identityNumber: '10000000078',
        birthDate: '2011-05-05',
        academicYear: 2025,
      },
    ])
    await db.insert(studentGuardians).values([
      {
        institutionId: created.id,
        id: randomUUID(),
        studentId: LEAVER,
        parentId: 'alu-p1',
        relationship: 'mother',
        custody: 'full',
      },
      {
        institutionId: created.id,
        id: randomUUID(),
        studentId: LEAVER,
        parentId: 'alu-p2',
        relationship: 'father',
        custody: 'none',
        isContactRestricted: true,
      },
      {
        institutionId: created.id,
        id: randomUUID(),
        studentId: GRADUATE,
        parentId: 'alu-p1',
        relationship: 'mother',
        custody: 'full',
      },
    ])
    const front = await createMember(app, created.id, 'onburo')
    return {
      id: created.id,
      adminId: created.admin.id,
      frontId: front.id,
      admin: await signInAs(app, created.admin),
      front: await signInAs(app, front),
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  /** Yükleyenin bağsız, taranmış PDF'i (`document`). */
  async function pdfFile(institutionId: string, userId: string): Promise<string> {
    const id = randomUUID()
    await db.insert(files).values({
      institutionId,
      id,
      purpose: 'document',
      status: 'ready',
      storageKey: `${institutionId}/document/2026/10/${id}`,
      contentType: 'application/pdf',
      byteSize: 1024,
      sha256: 'c'.repeat(64),
      uploadedByUserId: userId,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    return id
  }
  const create = (t: Tenant, body: Json, cookie = t.front) =>
    call('POST', BASE, cookie, body, key())
  const act = (t: Tenant, id: string, verb: string, version: unknown, body: Json = {}) =>
    call('POST', `${BASE}/${id}/${verb}`, t.front, body, ifMatch(version))
  const rows = (institutionId: string) =>
    db
      .select()
      .from(alumniDocumentRequests)
      .where(eq(alumniDocumentRequests.institutionId, institutionId))
  const audits = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  test('DOM-KAY-044 K-331: oturumsuz 401; yönetici ve ön büro dışı 403; ücret ayarını yalnız yönetici değiştirir; crm kapalı 403', async () => {
    assertError(await get(BASE, null), 401)
    const t = await institution()
    for (const role of ROLES.filter((value) => value !== 'yonetici' && value !== 'onburo')) {
      const cookie = await signInAs(app, await createMember(app, t.id, role))
      assertError(await get(BASE, cookie), 403, 'forbidden')
      assertError(await create(t, graduateRequest(), cookie), 403, 'forbidden')
      assertError(await get(STUDENTS, cookie), 403, 'forbidden')
    }
    assertError(await call('PATCH', FEES, t.front, { transcript: 100 }), 403, 'forbidden')
    assert.equal((await rows(t.id)).length, 0)
    const closed = await institution({ enabledModules: { crm: false } })
    assertError(await get(BASE, closed.admin), 403, 'module_disabled')
    assertError(await create(closed, graduateRequest(), closed.admin), 403, 'module_disabled')
  })

  test('DOM-KAY-044: öğrenci seçimi yalnız mezun ve ayrılanı, durum, yaş ve velilerle verir; kimlik dönmez', async () => {
    const t = await institution()
    const list = await get(STUDENTS, t.front)
    assert.equal(list.statusCode, 200, list.body)
    const body = list.json() as { data: Json[]; meta: Json }
    assert.equal(body.meta.total, 2)
    assert.deepEqual(
      body.data.map((item) => [
        item.name,
        item.status,
        item.leftDate,
        item.lastClassName,
        item.adult,
      ]),
      [
        ['Deniz Yılmaz', 'graduated', '2026-06-26', '12-A', true],
        ['Ece Yılmaz', 'withdrawn', null, '9-B', false],
      ],
    )
    assert.deepEqual(body.data[1]?.guardians, [
      { parentId: 'alu-p1', name: 'Ayşe Yılmaz', custody: 'full', contactRestricted: false },
      { parentId: 'alu-p2', name: 'Kemal Yılmaz', custody: 'none', contactRestricted: true },
    ])
    assert.doesNotMatch(list.body, /10000000146|2008-02-01/)
    const searched = await get(`${STUDENTS}?q=ece`, t.front)
    assert.deepEqual(
      (searched.json() as { data: Json[] }).data.map((item) => item.id),
      [LEAVER],
    )
  })

  test('DOM-KAY-044 K-329 K-330: talep → hazırlanıyor → hazır (numara, not dökümü) → ücretli teslim; denetim alan adlarıyla', async () => {
    const t = await institution()
    ok(await call('PATCH', FEES, t.admin, { transcript: 25_000 }))
    const created = ok(await create(t, graduateRequest()), 201)
    assert.equal(created.status, 'received')
    assert.equal(created.feeCents, 50_000)
    assert.equal(created.requesterName, 'Deniz Yılmaz')
    assert.equal(created.documentNumber, null)
    assert.deepEqual(created.actions, ['start', 'reject'])
    // Ücret sonradan değişse de talebin ücreti değişmez.
    ok(await call('PATCH', FEES, t.admin, { transcript: 99_000 }))
    const id = String(created.id)

    assertError(await act(t, id, 'ready', created.version), 422, 'alumni_document_invalid_status')
    const started = ok(await act(t, id, 'start', created.version))
    assert.equal(started.status, 'preparing')
    assertError(await act(t, id, 'start', created.version), 409, 'version_conflict')
    const ready = ok(
      await act(t, id, 'ready', started.version, {
        manualNote: '9. sınıf notları önceki okuldadır.',
      }),
    )
    assert.equal(ready.documentNumber, 'MB-2026-0001')
    assert.equal(ready.feeCents, 50_000)

    const doc = await get(`${BASE}/${id}/document`, t.front)
    const document = ok(doc)
    assert.equal(document.documentNumber, 'MB-2026-0001')
    assert.equal(document.manualNote, '9. sınıf notları önceki okuldadır.')
    const content = document.content as Json
    assert.equal(content.kind, 'transcript')
    assert.equal(content.outcome, 'graduated')
    assert.equal(content.enrolledDate, '2022-09-12')
    assert.equal(content.leftDate, '2026-06-26')
    assert.deepEqual(content.terms, [
      { className: '12-A', term: 1, subjects: [{ name: 'Matematik', average: 100, count: 1 }] },
      { className: '11-A', term: 1, subjects: [{ name: 'Matematik', average: 86, count: 2 }] },
      { className: '11-A', term: 2, subjects: [{ name: 'Fizik', average: 70, count: 1 }] },
    ])
    assert.doesNotMatch(doc.body, /10000000146|2008-02-01/)

    assertError(
      await act(t, id, 'deliver', ready.version, { identityCheckNote: 'Nüfus cüzdanı görüldü' }),
      422,
      'alumni_document_payment_required',
    )
    const delivered = ok(
      await act(t, id, 'deliver', ready.version, {
        identityCheckNote: 'Nüfus cüzdanı görüldü',
        paymentMethod: 'cash',
      }),
    )
    assert.equal(delivered.status, 'delivered')
    assert.equal(delivered.paymentMethod, 'cash')
    assert.equal(delivered.paidAt, FIXED_NOW.toISOString())
    assert.ok(delivered.deliveredByName)
    assert.deepEqual(delivered.actions, [])
    // Teslimden sonra belge yeniden basılabilir; ret yok.
    ok(await get(`${BASE}/${id}/document`, t.front))
    assertError(
      await act(t, id, 'reject', delivered.version, { reason: 'Yanlış kayıt' }),
      422,
      'alumni_document_invalid_status',
    )

    const createAudit = await audits(t.id, 'alumni_document_request.create')
    assert.equal(createAudit.length, 1)
    assert.doesNotMatch(JSON.stringify(createAudit[0]?.changes), /Deniz/)
    assert.equal((await audits(t.id, 'alumni_document.issue')).length, 2)
    assert.equal((await audits(t.id, 'alumni_document_request.deliver')).length, 1)
    assert.equal((await audits(t.id, 'alumni_document_fees.update')).length, 2)

    // İkinci belge aynı yılın sıradaki numarasını alır.
    const second = ok(
      await create(t, graduateRequest({ documentType: 'education_certificate', copies: 1 })),
      201,
    )
    const secondStarted = ok(await act(t, String(second.id), 'start', second.version))
    const secondReady = ok(await act(t, String(second.id), 'ready', secondStarted.version))
    assert.equal(secondReady.documentNumber, 'MB-2026-0002')
    const certificate = ok(await get(`${BASE}/${String(second.id)}/document`, t.admin))
    assert.equal((certificate.content as Json).kind, 'education_certificate')
    assert.equal((certificate.content as Json).lastClassName, '12-A')
    // Ücretsiz belge ödeme yöntemi olmadan teslim edilir, ödendi işareti düşmez.
    const freeDelivered = ok(
      await act(t, String(second.id), 'deliver', secondReady.version, {
        identityCheckNote: 'E-posta adresi telefonla doğrulandı',
        paymentMethod: 'card',
      }),
    )
    assert.equal(freeDelivered.paymentMethod, null)
    assert.equal(freeDelivered.paidAt, null)

    const listed = await get(`${BASE}?q=MB-2026-0002`, t.front)
    assert.deepEqual(
      (listed.json() as { data: Json[] }).data.map((item) => item.id),
      [second.id],
    )
    const byName = await get(`${BASE}?q=deniz&status=delivered`, t.front)
    assert.equal((byName.json() as { meta: Json }).meta.total, 2)
  })

  test('DOM-KAY-044: Idempotency-Key zorunlu; aynı anahtar ikinci talep açmaz', async () => {
    const t = await institution()
    assertError(await call('POST', BASE, t.front, graduateRequest()), 400)
    const headers = key()
    const first = await call('POST', BASE, t.front, graduateRequest(), headers)
    const again = await call('POST', BASE, t.front, graduateRequest(), headers)
    assert.equal(first.statusCode, 201, first.body)
    assert.equal(again.statusCode, 201)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assert.equal((await rows(t.id)).length, 1)
  })

  test('DOM-KAY-044 K-328 H-53: aktif öğrenci, reşit olmayanın kendi talebi, yetkisiz veli ve rızasız veli reddedilir; kayıt yazılmaz', async () => {
    const t = await institution()
    assertError(
      await create(t, graduateRequest({ studentId: ACTIVE })),
      422,
      'alumni_document_student_active',
    )
    assertError(
      await create(t, graduateRequest({ studentId: LEAVER })),
      422,
      'alumni_document_requester_minor',
    )
    assertError(
      await create(t, graduateRequest({ studentId: LEAVER, documentType: 'diploma_copy' })),
      422,
      'alumni_document_not_graduated',
    )
    assertError(
      await create(
        t,
        graduateRequest({
          studentId: LEAVER,
          requesterKind: 'guardian',
          guardianParentId: 'alu-p2',
        }),
      ),
      422,
      'alumni_document_guardian_not_authorized',
    )
    assertError(
      await create(
        t,
        graduateRequest({
          studentId: LEAVER,
          requesterKind: 'guardian',
          guardianParentId: 'alu-p9',
        }),
      ),
      422,
      'alumni_document_guardian_unknown',
    )
    // Mezun reşittir: velisi ancak yazılı rızayla talep eder.
    assertError(
      await create(t, graduateRequest({ requesterKind: 'guardian', guardianParentId: 'alu-p1' })),
      422,
      'alumni_document_consent_required',
    )
    const invalid = await create(t, graduateRequest({ deliveryMethod: 'email', copies: 0 }))
    assertError(invalid, 400)
    const paths = (invalid.json() as { issues: { path: string[] }[] }).issues.map((issue) =>
      issue.path.join('.'),
    )
    assert.ok(paths.includes('copies') && paths.includes('deliveryEmail'), JSON.stringify(paths))
    assert.equal((await rows(t.id)).length, 0)

    // Reşit olmayanın velayetli velisi rızasız talep eder.
    const guardian = ok(
      await create(
        t,
        graduateRequest({
          studentId: LEAVER,
          requesterKind: 'guardian',
          guardianParentId: 'alu-p1',
          deliveryMethod: 'cargo',
          deliveryAddress: 'Moda Cad. No 5 Kadıköy İstanbul',
        }),
      ),
      201,
    )
    assert.equal(guardian.requesterName, 'Ayşe Yılmaz')
    assert.equal(guardian.deliveryAddress, 'Moda Cad. No 5 Kadıköy İstanbul')
  })

  test('DOM-KAY-044 K-328 H-54: vekâletname ve rıza dosyası talebe bağlanır; başkasının dosyası kabul edilmez', async () => {
    const t = await institution()
    const foreign = await pdfFile(t.id, t.adminId)
    assertError(
      await create(
        t,
        graduateRequest({
          requesterKind: 'proxy',
          proxyName: 'Av. Ali Kaya',
          authorizationFileId: foreign,
        }),
      ),
      422,
      'file_unavailable',
    )
    assert.equal((await rows(t.id)).length, 0)
    const own = await pdfFile(t.id, t.frontId)
    const proxy = ok(
      await create(
        t,
        graduateRequest({
          requesterKind: 'proxy',
          proxyName: 'Av. Ali Kaya',
          authorizationFileId: own,
        }),
      ),
      201,
    )
    assert.equal(proxy.requesterName, 'Av. Ali Kaya')
    assert.equal(proxy.authorizationFileId, own)
    const [file] = await db
      .select()
      .from(files)
      .where(and(eq(files.institutionId, t.id), eq(files.id, own)))
    assert.equal(file?.attachedType, 'alumni_document_request')
    assert.equal(file?.attachedId, proxy.id)
    assert.equal(file?.dataSubjectId, GRADUATE)
    // Rızalı veli talebi.
    const consent = await pdfFile(t.id, t.frontId)
    ok(
      await create(
        t,
        graduateRequest({
          requesterKind: 'guardian',
          guardianParentId: 'alu-p1',
          authorizationFileId: consent,
        }),
      ),
      201,
    )
    // Bağlı dosyayı yönetici açar, öğretmen açamaz.
    const link = await get(`/api/v1/files/${own}/url`, t.admin)
    assert.equal(link.statusCode, 200, link.body)
    const teacher = await signInAs(app, await createMember(app, t.id, 'ogretmen'))
    assert.equal((await get(`/api/v1/files/${own}/url`, teacher)).statusCode, 404)
  })

  test('DOM-KAY-044 K-330: diploma örneği dosyayla hazır olur, PDF üretmez; boş not dökümü elle not ister; ret gerekçeli', async () => {
    const t = await institution()
    const diploma = ok(await create(t, graduateRequest({ documentType: 'diploma_copy' })), 201)
    const started = ok(await act(t, String(diploma.id), 'start', diploma.version))
    assertError(
      await act(t, String(diploma.id), 'ready', started.version),
      422,
      'alumni_document_file_required',
    )
    const scan = await pdfFile(t.id, t.frontId)
    const ready = ok(await act(t, String(diploma.id), 'ready', started.version, { fileId: scan }))
    assert.equal(ready.diplomaFileId, scan)
    assert.equal(ready.documentNumber, 'MB-2026-0001')
    assertError(
      await get(`${BASE}/${String(diploma.id)}/document`, t.front),
      422,
      'alumni_document_no_pdf',
    )

    const leaver = ok(
      await create(
        t,
        graduateRequest({
          studentId: LEAVER,
          requesterKind: 'guardian',
          guardianParentId: 'alu-p1',
        }),
      ),
      201,
    )
    const leaverStarted = ok(await act(t, String(leaver.id), 'start', leaver.version))
    assertError(
      await act(t, String(leaver.id), 'ready', leaverStarted.version),
      422,
      'alumni_document_transcript_empty',
    )
    assertError(
      await get(`${BASE}/${String(leaver.id)}/document`, t.front),
      422,
      'alumni_document_not_ready',
    )
    assertError(
      await act(t, String(leaver.id), 'reject', leaverStarted.version, { reason: 'x' }),
      400,
    )
    const rejected = ok(
      await act(t, String(leaver.id), 'reject', leaverStarted.version, {
        reason: 'Velinin kimliği doğrulanamadı',
      }),
    )
    assert.equal(rejected.status, 'rejected')
    assert.equal(rejected.rejectionReason, 'Velinin kimliği doğrulanamadı')
    assertError(
      await act(t, String(leaver.id), 'start', rejected.version),
      422,
      'alumni_document_invalid_status',
    )
  })

  test('DOM-KAY-044 K-331: dil okulunda diploma örneği yok, not dökümü kurları yazar', async () => {
    const t = await institution({ type: 'language_school', name: 'Kampüs Dil Akademisi' })
    assertError(
      await create(t, graduateRequest({ documentType: 'diploma_copy' })),
      422,
      'alumni_document_type_unavailable',
    )
    const created = ok(await create(t, graduateRequest()), 201)
    const started = ok(await act(t, String(created.id), 'start', created.version))
    // Kur kaydı yok: hazırlayan açıklamayı yazar.
    const ready = ok(
      await act(t, String(created.id), 'ready', started.version, {
        manualNote: 'Kur kayıtları Kampüs öncesi dönemdedir.',
      }),
    )
    const document = ok(await get(`${BASE}/${String(created.id)}/document`, t.front))
    const content = document.content as Json
    assert.equal(content.institutionType, 'language_school')
    assert.deepEqual(content.terms, [])
    assert.deepEqual(content.courses, [])
    assert.equal(ready.status, 'ready')
  })

  test('DOM-KAY-044 IST-002: başka kurumun talebi ve öğrencisi 404, listede yok, B değişmez', async () => {
    const a = await institution()
    const b = await institution()
    const bRequest = ok(await create(b, graduateRequest()), 201)
    const bUrl = `${BASE}/${String(bRequest.id)}`
    clientIp = '10.144.250.1'
    assertError(await get(bUrl, a.admin), 404, 'not_found')
    assertError(await get(`${bUrl}/document`, a.admin), 404, 'not_found')
    const bodies: Record<string, Json> = {
      start: {},
      ready: {},
      deliver: { identityCheckNote: 'Kimlik görüldü' },
      reject: { reason: 'Başka kurum talebi' },
    }
    for (const [verb, body] of Object.entries(bodies))
      assertError(
        await call('POST', `${bUrl}/${verb}`, a.admin, body, ifMatch(bRequest.version)),
        404,
        'not_found',
      )
    const [bRow] = await rows(b.id)
    assert.equal(bRow?.status, 'received')
    assert.equal(bRow?.version, 1)
    const aList = await get(BASE, a.admin)
    assert.equal((aList.json() as { meta: Json }).meta.total, 0)
    // Gövdedeki B öğrencisi ve `institutionId` etkisiz: A'da aynı kimlikli öğrenci yoksa 404.
    const bOnly = 'alu-b-only'
    await insertMissingRecords(
      db,
      b.id,
      [
        {
          collection: 'students',
          id: bOnly,
          data: { id: bOnly, name: 'B Öğrenci', classId: 'alu-c12', isActive: false },
        },
      ],
      FIXED_NOW,
    )
    assertError(await create(a, graduateRequest({ studentId: bOnly })), 404, 'not_found')
    assertError(await create(a, { ...graduateRequest(), institutionId: b.id }), 400)
    assert.equal((await rows(a.id)).length, 0)
    const bStudents = await get(`${STUDENTS}?q=B Öğrenci`, a.admin)
    assert.equal((bStudents.json() as { meta: Json }).meta.total, 0)
    // Ücret ayarı kurum kapsamlıdır.
    ok(await call('PATCH', FEES, a.admin, { education_certificate: 1_000 }))
    assert.equal(ok(await get(FEES, b.admin)).education_certificate, 0)
  })
})
