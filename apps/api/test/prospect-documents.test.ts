import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import type { RecordData } from '../src/db/collections.ts'
import { findRecord, insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { files } from '../src/db/schema/files.ts'
import {
  prospectDocumentConsents,
  prospectDocuments,
  prospectDocumentTypes,
} from '../src/db/schema/prospect-documents.ts'
import { recordFileCheck } from '../src/services/files.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  nextIp,
  signInAs,
  TEST_ORIGIN,
  type InstitutionOverrides,
} from './support/app.ts'
import { multipart, PDF, tempStorage, uploadParts } from './support/files-sample.ts'

/**
 * Aday belgeleri (DOM-KAY-043; ON-263, K-320…K-323): belge türü listesi, adaya belge ekleme ve
 * yerine geçme, inceleme, eksik belge listesi, özel nitelikli belge rızası, denetimli açılış ve
 * imha işaretleri. Her test kendi kurumunu kurar. FIXED_NOW 2026-10-06; test uygulamasında dosya
 * tarayıcısı kapalıdır, yüklenen dosya taramadan geçmiş gibi `ready` yapılır.
 */

const TYPES = '/api/v1/prospects/document-types'
const GAPS = '/api/v1/prospects/document-gaps'
const docs = (prospectId: string) => `/api/v1/prospects/${prospectId}/documents`
const consent = (prospectId: string) => `/api/v1/prospects/${prospectId}/document-consent`
const SEED = createSeed(FIXED_NOW)
const DAY_MS = 24 * 60 * 60 * 1000

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>
type Documents = {
  prospectId: string
  accepting: boolean
  types: Json[]
  documents: (Json & { id: string; version: number; status: string; file: Json })[]
  gaps: { missing: { id: string; label: string; stage: string }[]; awaitingReview: number }
  consent: { grantor: string; active: (Json & { version: number }) | null; history: Json[] }
}

describe('DOM-KAY-043: aday belgeleri', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  let serial = 0

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
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string | null,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url,
      remoteAddress: nextIp(),
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
  const key = () => ({ 'idempotency-key': `test-doc-${String(++serial).padStart(5, '0')}` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  const prospectData = (id: string, overrides: RecordData = {}) => ({
    collection: 'prospects' as const,
    id,
    data: {
      id,
      name: `Aday ${id}`,
      phone: '05559990001',
      email: '',
      branchId: 'b1',
      interest: '7. Sınıf · Ortaokul',
      source: 'Telefon',
      guardianName: 'Veli Aday',
      stage: 'Yeni aday',
      studentId: null,
      trialAt: null,
      notes: [],
      createdAt: '2026-10-01T08:00:00.000Z',
      ...overrides,
    },
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      created.id,
      [
        ...SEED.branches.map((data) => ({ collection: 'branches' as const, id: data.id, data })),
        prospectData('pd1'),
        prospectData('pd2', { name: 'Berk Aday', stage: 'Teklif verildi' }),
        prospectData('pd3', { name: 'Cem Aday', stage: 'Vazgeçti', lostReason: 'price' }),
        prospectData('pd4', { name: 'Defne Aday', stage: 'Kayıt oldu' }),
      ],
      FIXED_NOW,
    )
    const front = await createMember(app, created.id, 'onburo')
    return {
      id: created.id,
      adminId: created.admin.id,
      admin: await signInAs(app, created.admin),
      frontId: front.id,
      front: await signInAs(app, front),
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))

  /** `document` amacıyla yükler; `ready` ise taramadan geçmiş gibi işaretler. */
  async function upload(t: Tenant, cookie: string, options: { ready?: boolean } = {}) {
    const body = multipart(uploadParts('document', PDF, 'Deniz kimlik.pdf'))
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      remoteAddress: nextIp(),
      headers: { origin: TEST_ORIGIN, cookie, 'content-type': body.contentType, ...key() },
      payload: body.payload,
    })
    assert.equal(response.statusCode, 201, response.body)
    const id: string = response.json().data.id
    if (options.ready !== false)
      await recordFileCheck(db, store.storage, {
        institutionId: t.id,
        fileId: id,
        outcome: 'ready',
        now: FIXED_NOW,
        log: app.log,
      })
    return id
  }
  const documentsOf = async (cookie: string, prospectId: string) =>
    ok(await get(docs(prospectId), cookie)) as unknown as Documents
  async function add(t: Tenant, prospectId: string, documentTypeId: string, cookie = t.front) {
    const fileId = await upload(t, cookie)
    const response = await call('POST', docs(prospectId), cookie, { documentTypeId, fileId })
    return { fileId, response }
  }
  const documentRows = (institutionId: string) =>
    db.select().from(prospectDocuments).where(eq(prospectDocuments.institutionId, institutionId))
  const fileRow = async (institutionId: string, fileId: string) => {
    const [row] = await db
      .select()
      .from(files)
      .where(and(eq(files.institutionId, institutionId), eq(files.id, fileId)))
    return row
  }
  const audits = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  const snapshot = async (institutionId: string) =>
    JSON.stringify([
      await documentRows(institutionId),
      await db
        .select()
        .from(prospectDocumentConsents)
        .where(eq(prospectDocumentConsents.institutionId, institutionId)),
      await db
        .select()
        .from(prospectDocumentTypes)
        .where(eq(prospectDocumentTypes.institutionId, institutionId)),
    ])
  async function setStage(t: Tenant, typeId: string, stage: string) {
    const types = ok(await get(TYPES, t.admin)) as unknown as Json[]
    const type = types.find((item) => item.id === typeId)
    ok(await call('PATCH', `${TYPES}/${typeId}`, t.admin, { stage }, ifMatch(type?.version)))
  }

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    assertError(await get(TYPES, null), 401)
    assertError(await call('POST', TYPES, null, {}), 401)
    assertError(await call('PATCH', `${TYPES}/identity`, null, {}), 401)
    assertError(await call('DELETE', `${TYPES}/identity`, null), 401)
    assertError(await get(GAPS, null), 401)
    assertError(await get(docs('pd1'), null), 401)
    assertError(await call('POST', docs('pd1'), null, {}), 401)
    assertError(await call('POST', `${docs('pd1')}/${id}/review`, null, {}), 401)
    assertError(await get(`${docs('pd1')}/${id}/url`, null), 401)
    assertError(await call('POST', consent('pd1'), null, {}), 401)
    assertError(await call('POST', `${consent('pd1')}/withdraw`, null), 401)
  })

  test('DOM-KAY-043: öğretmen, veli, öğrenci 403; ön büro tür listesini yazamaz; crm kapalıyken 403', async () => {
    const t = await institution()
    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(TYPES, cookie), 403)
      assertError(await get(docs('pd1'), cookie), 403)
      assertError(await get(GAPS, cookie), 403)
      assertError(
        await call('POST', docs('pd1'), cookie, {
          documentTypeId: 'identity',
          fileId: randomUUID(),
        }),
        403,
      )
    }
    const body = { kind: 'other', label: 'Burs belgesi', required: false, stage: 'application' }
    assertError(await call('POST', TYPES, t.front, body), 403)
    assertError(await call('DELETE', `${TYPES}/identity`, t.front, undefined, ifMatch(1)), 403)
    assert.equal((ok(await get(TYPES, t.front)) as unknown as Json[]).length, 5)

    const closed = await institution({ enabledModules: { crm: false } })
    assertError(await get(TYPES, closed.admin), 403, 'module_disabled')
    assertError(await get(docs('pd1'), closed.admin), 403, 'module_disabled')
    assertError(await get(GAPS, closed.front), 403, 'module_disabled')
    assert.equal(await snapshot(closed.id), JSON.stringify([[], [], []]))
  })

  test('K-320: varsayılan tür listesi ilk okumada yazılır; okul ve dil okulu farklı, sağlık raporu özel nitelikli', async () => {
    const school = await institution()
    const types = ok(await get(TYPES, school.front)) as unknown as Json[]
    assert.deepEqual(
      types.map((type) => [type.id, type.required, type.stage, type.specialCategory]),
      [
        ['identity', true, 'enrollment', false],
        ['report_card', true, 'enrollment', false],
        ['photo', true, 'enrollment', false],
        ['health_report', false, 'enrollment', true],
        ['other', false, 'application', false],
      ],
    )
    // İkinci okuma yeniden yazmaz.
    ok(await get(TYPES, school.admin))
    const rows = await db
      .select()
      .from(prospectDocumentTypes)
      .where(eq(prospectDocumentTypes.institutionId, school.id))
    assert.equal(rows.length, 5)

    const language = await institution({ type: 'language_school' })
    const languageTypes = ok(await get(TYPES, language.admin)) as unknown as Json[]
    assert.deepEqual(
      languageTypes.filter((type) => type.required).map((type) => type.id),
      ['identity'],
    )
  })

  test('K-320: yönetici tür ekler, düzeltir, arşivler; ad tekil, sağlık raporu işareti kalkmaz', async () => {
    const t = await institution()
    const body = { kind: 'other', label: 'Burs belgesi', required: true, stage: 'application' }
    const created = ok(await call('POST', TYPES, t.admin, body, key()), 201)
    assert.equal(created.specialCategory, false)
    assert.equal(created.label, 'Burs belgesi')
    assertError(
      await call('POST', TYPES, t.admin, { ...body, label: '  burs   BELGESİ ' }),
      409,
      'document_type_exists',
    )
    assertError(
      await call('POST', TYPES, t.admin, {
        kind: 'health_report',
        label: 'Aşı kartı',
        required: false,
        stage: 'enrollment',
        specialCategory: false,
      }),
      422,
      'document_type_special_required',
    )
    const before = await snapshot(t.id)
    assertError(await call('POST', TYPES, t.admin, { ...body, label: 'X' }), 400)
    assertError(await call('POST', TYPES, t.admin, { ...body, label: 'Y', extra: 1 }), 400)
    assertError(
      await call('PATCH', `${TYPES}/identity`, t.admin, { kind: 'photo' }, ifMatch(1)),
      400,
    )
    assertError(await call('PATCH', `${TYPES}/identity`, t.admin, {}, ifMatch(1)), 400)
    assertError(
      await call(
        'PATCH',
        `${TYPES}/health_report`,
        t.admin,
        { specialCategory: false },
        ifMatch(1),
      ),
      422,
      'document_type_special_required',
    )
    assertError(await call('PATCH', `${TYPES}/identity`, t.admin, { required: false }), 400)
    assertError(
      await call('PATCH', `${TYPES}/identity`, t.admin, { required: false }, ifMatch(9)),
      409,
      'version_conflict',
    )
    assert.equal(await snapshot(t.id), before)

    const updated = ok(
      await call(
        'PATCH',
        `${TYPES}/identity`,
        t.admin,
        { label: 'Nüfus cüzdanı', stage: 'application' },
        ifMatch(1),
      ),
    )
    assert.equal(updated.label, 'Nüfus cüzdanı')
    assert.equal(updated.stage, 'application')
    assert.equal(updated.version, 2)
    ok(await call('DELETE', `${TYPES}/${String(created.id)}`, t.admin, undefined, ifMatch(1)))
    const listed = ok(await get(TYPES, t.admin)) as unknown as Json[]
    assert.equal(
      listed.some((type) => type.id === created.id),
      false,
    )
    assertError(
      await call('DELETE', `${TYPES}/${String(created.id)}`, t.admin, undefined, ifMatch(2)),
      404,
    )
    const actions = (await db.select().from(auditLog).where(eq(auditLog.institutionId, t.id)))
      .map((row) => row.action)
      .filter((action) => action.startsWith('prospect_document_type.'))
    assert.deepEqual(actions.sort(), [
      'prospect_document_type.archive',
      'prospect_document_type.create',
      'prospect_document_type.update',
    ])
  })

  test('DOM-KAY-043: ön büro belge ekler; aynı türe yeni yükleme öncekini yerine geçti yapar ve eski dosyayı 30 gün sonra imhaya işaretler', async () => {
    const t = await institution()
    const first = await add(t, 'pd1', 'identity')
    const added = ok(first.response, 201) as unknown as Documents
    assert.equal(added.documents.length, 1)
    assert.equal(added.documents[0]?.status, 'uploaded')
    assert.equal(added.documents[0]?.file.name, 'Deniz kimlik.pdf')
    assert.equal(added.gaps.awaitingReview, 1)
    const attached = await fileRow(t.id, first.fileId)
    assert.equal(attached?.attachedType, 'prospect_document')
    assert.equal(attached?.attachedId, added.documents[0]?.id)
    // Aday belgesi genel dosya uçlarından açılmaz.
    assertError(await get(`/api/v1/files/${first.fileId}`, t.front), 404)
    assertError(await get(`/api/v1/files/${first.fileId}/url`, t.front), 404)

    const second = await add(t, 'pd1', 'identity')
    const replaced = ok(second.response, 201) as unknown as Documents
    assert.deepEqual(
      replaced.documents.map((document) => document.status),
      ['uploaded', 'superseded'],
    )
    const old = await fileRow(t.id, first.fileId)
    assert.equal(old?.retentionUntil?.getTime(), FIXED_NOW.getTime() + 30 * DAY_MS)
    assert.equal((await fileRow(t.id, second.fileId))?.retentionUntil, null)
    assert.equal((await audits(t.id, 'prospect_document.add')).length, 2)
  })

  test('DOM-KAY-043: hazır olmayan, bağlı ya da bilinmeyen dosya ve tür reddedilir; kayıt değişmez', async () => {
    const t = await institution()
    const before = await snapshot(t.id)
    const pending = await upload(t, t.front, { ready: false })
    assertError(
      await call('POST', docs('pd1'), t.front, { documentTypeId: 'identity', fileId: pending }),
      422,
      'file_not_ready',
    )
    const ready = await upload(t, t.front)
    assertError(
      await call('POST', docs('pd1'), t.admin, { documentTypeId: 'identity', fileId: ready }),
      422,
      'file_unavailable',
    )
    assertError(
      await call('POST', docs('pd1'), t.front, { documentTypeId: 'yok', fileId: ready }),
      422,
      'document_type_unknown',
    )
    assertError(
      await call('POST', docs('pd1'), t.front, { documentTypeId: 'identity', fileId: 'x' }),
      400,
    )
    assertError(
      await call('POST', docs('pd3'), t.front, { documentTypeId: 'identity', fileId: ready }),
      409,
      'prospect_closed',
    )
    assertError(
      await call('POST', docs('yok'), t.front, { documentTypeId: 'identity', fileId: ready }),
      404,
    )
    // `ensureTypes` varsayılanları yazdı; belge ve rıza yok.
    const after = JSON.parse(await snapshot(t.id)) as unknown[][]
    assert.deepEqual(after[0], [])
    assert.deepEqual(after[1], [])
    assert.equal(JSON.parse(before)[0].length, 0)
    assert.equal((await fileRow(t.id, ready))?.attachedId, null)
    ok((await add(t, 'pd1', 'identity')).response, 201)
    assertError(
      await call('POST', docs('pd2'), t.front, {
        documentTypeId: 'identity',
        fileId: (await documentRows(t.id))[0]?.fileId,
      }),
      409,
      'file_already_attached',
    )
  })

  test('K-321: eksik belge aşamaya göre; reddedilen belge eksik, incelenmeyen değil; liste ve süzgeç', async () => {
    const t = await institution()
    // Varsayılanda ön başvuruda zorunlu tür yok: yeni aday eksiksiz, teklif aşamasındaki aday eksik.
    let pd1 = await documentsOf(t.front, 'pd1')
    assert.deepEqual(pd1.gaps.missing, [])
    const pd2 = await documentsOf(t.front, 'pd2')
    assert.deepEqual(
      pd2.gaps.missing.map((item) => item.id),
      ['identity', 'report_card', 'photo'],
    )
    const pd4 = await documentsOf(t.front, 'pd4')
    assert.equal(pd4.gaps.missing.length, 3)
    const pd3 = await documentsOf(t.front, 'pd3')
    assert.equal(pd3.accepting, false)
    assert.deepEqual(pd3.gaps.missing, [])

    let list = await get(GAPS, t.front)
    assert.deepEqual(
      (list.json().data as Json[]).map((row) => row.prospectId),
      ['pd2'],
    )
    await setStage(t, 'identity', 'application')
    pd1 = await documentsOf(t.front, 'pd1')
    assert.deepEqual(
      pd1.gaps.missing.map((item) => item.id),
      ['identity'],
    )
    list = await get(GAPS, t.front)
    assert.equal(list.json().meta.total, 2)
    assert.deepEqual(
      (list.json().data as Json[]).map((row) => row.prospectId),
      ['pd1', 'pd2'],
    )
    const added = ok((await add(t, 'pd1', 'identity')).response, 201) as unknown as Documents
    assert.deepEqual(added.gaps, { missing: [], awaitingReview: 1 })
    const document = added.documents[0]!
    const rejected = ok(
      await call(
        'POST',
        `${docs('pd1')}/${document.id}/review`,
        t.front,
        { decision: 'reject', reason: 'Fotokopi okunmuyor.' },
        ifMatch(document.version),
      ),
    ) as unknown as Documents
    assert.equal(rejected.documents[0]?.status, 'rejected')
    assert.equal(rejected.documents[0]?.rejectionReason, 'Fotokopi okunmuyor.')
    assert.deepEqual(
      rejected.gaps.missing.map((item) => item.id),
      ['identity'],
    )
    const [audit] = await audits(t.id, 'prospect_document.reject')
    assert.deepEqual(audit?.changes, { fields: ['status', 'rejectionReason'] })
    assert.equal(JSON.stringify(audit).includes('okunmuyor'), false)

    const filtered = await get(`${GAPS}?prospectId=pd1&prospectId=pd3`, t.front)
    assert.deepEqual(
      (filtered.json().data as Json[]).map((row) => [row.prospectId, row.missing]),
      [['pd1', [{ id: 'identity', label: 'Nüfus kayıt örneği / kimlik', stage: 'application' }]]],
    )
    assert.equal(JSON.stringify(filtered.json()).includes('0555'), false)
    assertError(await get(`${GAPS}?durum=eksik`, t.front), 400)
  })

  test('DOM-KAY-043: inceleme kabul; karar verilmiş belgeye ikinci karar 409; ön büro bağlantıyı açar ve denetime yazılır', async () => {
    const t = await institution()
    const added = ok((await add(t, 'pd2', 'report_card')).response, 201) as unknown as Documents
    const document = added.documents[0]!
    const url = `${docs('pd2')}/${document.id}`
    assertError(await call('POST', `${url}/review`, t.front, { decision: 'accept' }), 400)
    assertError(
      await call(
        'POST',
        `${url}/review`,
        t.front,
        { decision: 'reject' },
        ifMatch(document.version),
      ),
      400,
    )
    const accepted = ok(
      await call(
        'POST',
        `${url}/review`,
        t.front,
        { decision: 'accept' },
        ifMatch(document.version),
      ),
    ) as unknown as Documents
    assert.equal(accepted.documents[0]?.status, 'accepted')
    assertError(
      await call(
        'POST',
        `${url}/review`,
        t.front,
        { decision: 'accept' },
        ifMatch(document.version),
      ),
      409,
      'version_conflict',
    )
    assertError(
      await call(
        'POST',
        `${url}/review`,
        t.front,
        { decision: 'accept' },
        ifMatch(accepted.documents[0]?.version),
      ),
      409,
      'prospect_document_reviewed',
    )
    const link = ok(await get(`${url}/url`, t.front))
    assert.match(String(link.url), /^http:\/\/localhost:3000\//)
    const reads = await audits(t.id, 'prospect_document.read')
    assert.equal(reads.length, 1)
    assert.equal(reads[0]?.actorUserId, t.frontId)
    assert.equal(reads[0]?.entityId, document.id)
    assertError(await get(`${docs('pd1')}/${document.id}/url`, t.front), 404)
  })

  test('K-322: özel nitelikli belge rızasız yüklenmez; rıza kaydı, yalnız yönetici açar ve inceler, geri çekme belgeleri arşivleyip hemen imhaya işaretler', async () => {
    const t = await institution()
    const fileId = await upload(t, t.front)
    assertError(
      await call('POST', docs('pd2'), t.front, { documentTypeId: 'health_report', fileId }),
      422,
      'document_consent_required',
    )
    assertError(await call('POST', consent('pd2'), t.front, { method: 'verbal' }), 400)
    assertError(await call('POST', consent('pd3'), t.front, { method: 'wet_signature' }), 409)
    const granted = ok(
      await call('POST', consent('pd2'), t.front, { method: 'wet_signature' }),
      201,
    ) as unknown as Documents
    assert.equal(granted.consent.grantor, 'guardian')
    assert.equal(granted.consent.active?.method, 'wet_signature')
    assertError(
      await call('POST', consent('pd2'), t.front, { method: 'wet_signature' }),
      409,
      'document_consent_exists',
    )
    const added = ok(
      await call('POST', docs('pd2'), t.front, { documentTypeId: 'health_report', fileId }),
      201,
    ) as unknown as Documents
    const health = added.documents[0]!
    assert.equal(health.specialCategory, true)
    assert.equal(health.canOpen, false)
    assert.equal(health.file.name, null)
    const adminView = await documentsOf(t.admin, 'pd2')
    assert.equal(adminView.documents[0]?.canOpen, true)
    assert.equal(adminView.documents[0]?.file.name, 'Deniz kimlik.pdf')

    const url = `${docs('pd2')}/${health.id}`
    assertError(await get(`${url}/url`, t.front), 403, 'special_document_forbidden')
    assertError(
      await call('POST', `${url}/review`, t.front, { decision: 'accept' }, ifMatch(health.version)),
      403,
      'special_document_forbidden',
    )
    assert.equal((await audits(t.id, 'prospect_document.read')).length, 0)
    ok(await get(`${url}/url`, t.admin))
    const [read] = await audits(t.id, 'prospect_document.read')
    assert.equal(read?.actorUserId, t.adminId)
    assert.equal(read?.actorRole, 'yonetici')
    const reviewed = ok(
      await call(
        'POST',
        `${url}/review`,
        t.admin,
        { decision: 'reject', reason: 'Rapor tarihi geçmiş.' },
        ifMatch(health.version),
      ),
    ) as unknown as Documents
    assert.equal(reviewed.documents[0]?.rejectionReason, 'Rapor tarihi geçmiş.')
    assert.equal((await documentsOf(t.front, 'pd2')).documents[0]?.rejectionReason, null)

    const active = granted.consent.active!
    assertError(await call('POST', `${consent('pd2')}/withdraw`, t.front), 400)
    assertError(
      await call(
        'POST',
        `${consent('pd2')}/withdraw`,
        t.front,
        undefined,
        ifMatch(active.version + 1),
      ),
      409,
      'version_conflict',
    )
    const withdrawn = ok(
      await call('POST', `${consent('pd2')}/withdraw`, t.front, undefined, ifMatch(active.version)),
    ) as unknown as Documents
    assert.equal(withdrawn.consent.active, null)
    assert.equal(withdrawn.consent.history.length, 1)
    assert.equal(withdrawn.documents.length, 0)
    assert.equal((await fileRow(t.id, fileId))?.retentionUntil?.getTime(), FIXED_NOW.getTime())
    const [row] = await documentRows(t.id)
    assert.notEqual(row?.archivedAt, null)
    assertError(await get(`${url}/url`, t.admin), 404)
    assertError(
      await call('POST', `${consent('pd2')}/withdraw`, t.front, undefined, ifMatch(active.version)),
      409,
      'document_consent_missing',
    )
    const second = await upload(t, t.front)
    assertError(
      await call('POST', docs('pd2'), t.front, { documentTypeId: 'health_report', fileId: second }),
      422,
      'document_consent_required',
    )
    assert.deepEqual(
      (await audits(t.id, 'prospect_document_consent.withdraw')).map((item) => item.changes),
      [{ fields: ['withdrawnAt'] }],
    )
  })

  test('K-322: yetişkin kursiyer adayında rızayı aday verir', async () => {
    const t = await institution({ type: 'language_school' })
    await insertMissingRecords(
      db,
      t.id,
      [prospectData('adult', { minor: false, guardianName: undefined })],
      FIXED_NOW,
    )
    const granted = ok(
      await call('POST', consent('adult'), t.admin, { method: 'wet_signature' }),
      201,
    ) as unknown as Documents
    assert.equal(granted.consent.grantor, 'self')
    assert.equal((await documentsOf(t.admin, 'pd1')).consent.grantor, 'guardian')
  })

  test('K-323: vazgeçen adayın belgeleri 30 gün sonra imhaya işaretlenir; imha edilen belge eksik sayılır', async () => {
    const t = await institution()
    await setStage(t, 'identity', 'application')
    const first = await add(t, 'pd1', 'identity')
    ok(first.response, 201)
    const record = await findRecord(db, t.id, 'prospects', 'pd1')
    ok(
      await call(
        'PATCH',
        '/api/v1/prospects/pd1',
        t.front,
        { stage: 'Vazgeçti', lostReason: 'price' },
        ifMatch(record?.version),
      ),
    )
    assert.equal(
      (await fileRow(t.id, first.fileId))?.retentionUntil?.getTime(),
      FIXED_NOW.getTime() + 30 * DAY_MS,
    )
    const closed = await documentsOf(t.front, 'pd1')
    assert.equal(
      closed.documents[0]?.file.purgeAt,
      new Date(FIXED_NOW.getTime() + 30 * DAY_MS).toISOString(),
    )

    // Dosya imha edilince (imha işi `deleted` yazar) belge açılmaz ve tür eksik sayılır.
    const second = await add(t, 'pd2', 'identity')
    ok(second.response, 201)
    await db
      .update(files)
      .set({ status: 'deleted', deletedAt: FIXED_NOW })
      .where(and(eq(files.institutionId, t.id), eq(files.id, second.fileId)))
    const purged = await documentsOf(t.front, 'pd2')
    assert.equal(purged.documents[0]?.file.available, false)
    assert.equal(purged.documents[0]?.canOpen, false)
    assert.ok(purged.gaps.missing.some((item) => item.id === 'identity'))
    assertError(
      await get(`${docs('pd2')}/${purged.documents[0]!.id}/url`, t.front),
      422,
      'prospect_document_file_missing',
    )
  })

  test('DOM-KAY-043: Idempotency-Key ile yinelenen belge ekleme aynı yanıtı döner, tek belge yazılır', async () => {
    const t = await institution()
    const fileId = await upload(t, t.front)
    const headers = { 'idempotency-key': randomUUID() }
    const body = { documentTypeId: 'other', fileId }
    const first = await call('POST', docs('pd1'), t.front, body, headers)
    const second = await call('POST', docs('pd1'), t.front, body, headers)
    assert.equal(first.statusCode, 201, first.body)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal((await documentRows(t.id)).length, 1)
  })

  test('DOM-KAY-043: başka kurumun adayı, belgesi, türü ve rızası 404, B değişmez; listede yok; gövdedeki institutionId 400', async () => {
    const a = await institution()
    const b = await institution()
    const bType = ok(
      await call('POST', TYPES, b.admin, {
        kind: 'other',
        label: 'B belgesi',
        required: true,
        stage: 'application',
      }),
      201,
    )
    // Yalnız B'de bulunan aday; A'da aynı kimlik yoktur.
    await insertMissingRecords(db, b.id, [prospectData('pb1')], FIXED_NOW)
    const bAdded = ok((await add(b, 'pb1', 'identity')).response, 201) as unknown as Documents
    const bDocument = bAdded.documents[0]!
    const bConsent = ok(
      await call('POST', consent('pb1'), b.front, { method: 'wet_signature' }),
      201,
    ) as unknown as Documents
    const bFileId = (await documentRows(b.id))[0]?.fileId
    const before = await snapshot(b.id)
    const bUrl = `${docs('pb1')}/${bDocument.id}`

    const aFile = await upload(a, a.front)
    // Aynı aday kimliği A'da da var: A'nın adayı B'nin belgesini görmez.
    assert.equal((await documentsOf(a.admin, 'pd1')).documents.length, 0)
    assertError(await get(docs('pb1'), a.admin), 404)
    assertError(
      await call('POST', docs('pb1'), a.front, { documentTypeId: 'identity', fileId: aFile }),
      404,
    )
    assertError(await call('POST', consent('pb1'), a.front, { method: 'wet_signature' }), 404)
    assertError(await get(`${bUrl}/url`, a.admin), 404)
    assertError(
      await call(
        'POST',
        `${bUrl}/review`,
        a.admin,
        { decision: 'accept' },
        ifMatch(bDocument.version),
      ),
      404,
    )
    assertError(
      await call('POST', docs('pd1'), a.front, { documentTypeId: String(bType.id), fileId: aFile }),
      422,
      'document_type_unknown',
    )
    assertError(
      await call('POST', docs('pd1'), a.front, { documentTypeId: 'identity', fileId: bFileId }),
      422,
      'file_unavailable',
    )
    assertError(
      await call('PATCH', `${TYPES}/${String(bType.id)}`, a.admin, { label: 'Sızma' }, ifMatch(1)),
      404,
    )
    assertError(
      await call('DELETE', `${TYPES}/${String(bType.id)}`, a.admin, undefined, ifMatch(1)),
      404,
    )
    assertError(
      await call(
        'POST',
        `${consent('pb1')}/withdraw`,
        a.front,
        undefined,
        ifMatch(bConsent.consent.active?.version),
      ),
      404,
    )
    const aTypes = ok(await get(TYPES, a.admin)) as unknown as Json[]
    assert.equal(
      aTypes.some((type) => type.id === bType.id),
      false,
    )
    const gaps = await get(GAPS, a.admin)
    assert.equal(JSON.stringify(gaps.json()).includes('B belgesi'), false)
    assertError(
      await call('POST', TYPES, a.admin, {
        kind: 'other',
        label: 'Sızma',
        required: false,
        stage: 'application',
        institutionId: b.id,
      }),
      400,
    )
    assertError(
      await call('POST', consent('pd1'), a.admin, { method: 'wet_signature', institutionId: b.id }),
      400,
    )
    assert.equal(await snapshot(b.id), before)
  })
})
