import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { findRecord, insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { feeTariffs } from '../src/db/schema/fee-tariffs.ts'
import { files } from '../src/db/schema/files.ts'
import { prospectDocumentConsents, prospectDocuments } from '../src/db/schema/prospect-documents.ts'
import { purgeExpiredFiles, recordFileCheck } from '../src/services/files.ts'
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
 * Kayıt belgeleri (DOM-KAY-045; ON-344, K-384…K-386): kesin kayıtta kabul edilmiş aday belgelerinin
 * ve rızanın öğrenciye bağlanması, imha işinin bağlı belgeyi silmemesi, öğrenci tarafı okuma, yetki
 * ve kurum kapsamı, geri alma. Her test kendi kurumunu kurar; FIXED_NOW 2026-10-06, dosya tarayıcısı
 * kapalıdır, yüklenen dosya taramadan geçmiş gibi `ready` yapılır.
 */

const SEED = createSeed(FIXED_NOW)
const DAY_MS = 24 * 60 * 60 * 1000
const YEAR = 2026
const CLASSES = ['c1', 'c3']
const LIST = '/api/v1/prospects/enrollment-documents'
const studentDocs = (studentId: string) =>
  `/api/v1/prospects/students/${studentId}/enrollment-documents`
const docs = (prospectId: string) => `/api/v1/prospects/${prospectId}/documents`
const consentUrl = (prospectId: string) => `/api/v1/prospects/${prospectId}/document-consent`

const prospectRow = (id: string, name: string, phone: string) => ({
  ...SEED.prospects[0],
  id,
  name,
  phone,
  email: `${id}@kampus.example`,
  stage: 'Teklif verildi',
  notes: [],
})

const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASSES.includes(item.id)),
  students: SEED.students.filter((item) => CLASSES.includes(item.classId)),
  parents: SEED.parents,
  prospects: [
    prospectRow('pr-doc', 'Belgeli Aday', '05559991001'),
    prospectRow('pr-health', 'Raporlu Aday', '05559991002'),
  ],
}
const TUITION = {
  kind: 'tuition',
  level: null,
  amountCents: 3_000_000,
  unit: 'year',
  vatBasisPoints: 1000,
  vatEffectiveDate: '2026-01-01',
  announcedAmountCents: 3_000_000,
}
const ENROLLMENT = {
  classId: 'c1',
  installmentCount: 3,
  firstDueDate: '2026-11-15',
  guardian: { name: 'Test Yeni Veli', phone: '05559990009', relationship: 'mother' },
}
const IDENTITIES = {
  'pr-doc': { kind: 'tc', number: '10000000146', birthDate: '2013-03-01' },
  'pr-health': { kind: 'tc', number: '10000000078', birthDate: '2013-04-01' },
} as const

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>
type StudentDocuments = {
  studentId: string
  name: string
  prospectId: string | null
  documents: (Json & { id: string; documentTypeId: string; canOpen: boolean; file: Json })[]
  gaps: { missing: { id: string }[]; awaitingReview: number }
  consent: (Json & { grantor: string }) | null
}
type ListRow = {
  studentId: string
  prospectId: string
  name: string
  documentCount: number
  missing: { id: string }[]
  awaitingReview: number
}

describe('DOM-KAY-045: kayıt belgeleri', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>

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
      remoteAddress: nextIp(),
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie === null ? {} : { cookie }),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        'idempotency-key': randomUUID(),
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
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      created.id,
      Object.entries(SAMPLE).flatMap(([collection, items]) =>
        (items ?? []).map((data) => {
          const name = collection as CollectionName
          const id = recordKey(name, data)
          if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
          return { collection: name, id, data }
        }),
      ),
      FIXED_NOW,
    )
    const tariffId = randomUUID()
    await db.insert(feeTariffs).values({
      institutionId: created.id,
      id: tariffId,
      academicYear: YEAR,
      versionNumber: 1,
      status: 'published',
      items: [TUITION] as never,
      discounts: [] as never,
      announcedDate: '2026-05-01',
      publishedByUserId: 'test',
      publishedAt: FIXED_NOW,
    })
    const front = await createMember(app, created.id, 'onburo')
    return {
      id: created.id,
      tariffId,
      admin: await signInAs(app, created.admin),
      front: await signInAs(app, front),
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  async function versionOf(institutionId: string, prospectId: string) {
    const row = await findRecord(db, institutionId, 'prospects', prospectId)
    assert.ok(row)
    return row.version
  }

  async function upload(t: Tenant, cookie: string) {
    const body = multipart(uploadParts('document', PDF, 'Belge.pdf'))
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      remoteAddress: nextIp(),
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
  /** Belge ekler; yanıttaki yeni belgenin kimliğini ve dosyasını döner. */
  async function add(t: Tenant, prospectId: string, documentTypeId: string, cookie = t.front) {
    const fileId = await upload(t, cookie)
    ok(await call('POST', docs(prospectId), cookie, { documentTypeId, fileId }), 201)
    const [row] = await db
      .select()
      .from(prospectDocuments)
      .where(and(eq(prospectDocuments.institutionId, t.id), eq(prospectDocuments.fileId, fileId)))
    assert.ok(row)
    return { id: row.id, fileId }
  }
  async function review(
    t: Tenant,
    prospectId: string,
    documentId: string,
    body: Json,
    cookie = t.admin,
  ) {
    const row = await documentRow(t.id, documentId)
    return call(
      'POST',
      `${docs(prospectId)}/${documentId}/review`,
      cookie,
      body,
      ifMatch(row.version),
    )
  }
  const accept = async (t: Tenant, prospectId: string, documentId: string) =>
    ok(await review(t, prospectId, documentId, { decision: 'accept' }))
  async function documentRow(institutionId: string, id: string) {
    const [row] = await db
      .select()
      .from(prospectDocuments)
      .where(and(eq(prospectDocuments.institutionId, institutionId), eq(prospectDocuments.id, id)))
    assert.ok(row)
    return row
  }
  async function fileRow(institutionId: string, id: string) {
    const [row] = await db
      .select()
      .from(files)
      .where(and(eq(files.institutionId, institutionId), eq(files.id, id)))
    assert.ok(row)
    return row
  }
  async function enroll(t: Tenant, prospectId: keyof typeof IDENTITIES) {
    const response = await call(
      'POST',
      `/api/v1/prospects/${prospectId}/enroll`,
      t.admin,
      { ...ENROLLMENT, identity: IDENTITIES[prospectId], tariffId: t.tariffId },
      ifMatch(await versionOf(t.id, prospectId)),
    )
    assert.equal(response.statusCode, 201, response.body)
    return String(response.json().data.entity.id)
  }
  const studentView = async (cookie: string, studentId: string) =>
    ok(await get(studentDocs(studentId), cookie)) as unknown as StudentDocuments
  async function listRows(cookie: string, query = '') {
    const response = await get(`${LIST}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: ListRow[]; meta: { total: number } }
  }
  const purge = (t: Tenant, now: Date) =>
    purgeExpiredFiles({ db, storage: store.storage, institutionId: t.id, now, log: app.log })
  const audits = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  test('DOM-KAY-045, K-384: kesin kayıtta kabul edilmiş belgeler öğrenciye bağlanır; reddedilen, yerine geçen ve bekleyen bağlanmaz', async () => {
    const t = await institution()
    const identity = await add(t, 'pr-doc', 'identity')
    await accept(t, 'pr-doc', identity.id)
    const card = await add(t, 'pr-doc', 'report_card')
    ok(await review(t, 'pr-doc', card.id, { decision: 'reject', reason: 'Okunmuyor.' }))
    const oldPhoto = await add(t, 'pr-doc', 'photo')
    await accept(t, 'pr-doc', oldPhoto.id)
    const photo = await add(t, 'pr-doc', 'photo')
    await accept(t, 'pr-doc', photo.id)
    const other = await add(t, 'pr-doc', 'other')

    const studentId = await enroll(t, 'pr-doc')

    for (const id of [identity.id, photo.id]) {
      const row = await documentRow(t.id, id)
      assert.equal(row.studentId, studentId)
      assert.equal(row.linkedAt?.getTime(), FIXED_NOW.getTime())
    }
    for (const id of [card.id, oldPhoto.id, other.id])
      assert.equal((await documentRow(t.id, id)).studentId, null)
    // Dosya kopyalanmaz: bağ aday belgesinde kalır.
    const identityFile = await fileRow(t.id, identity.fileId)
    assert.equal(identityFile.attachedType, 'prospect_document')
    assert.equal(identityFile.attachedId, identity.id)
    assert.equal(identityFile.retentionUntil, null)
    // Reddedilen belgenin dosyası kesin kayıttan 30 gün sonra imhaya işaretlenir.
    assert.equal(
      (await fileRow(t.id, card.fileId)).retentionUntil?.getTime(),
      FIXED_NOW.getTime() + 30 * DAY_MS,
    )
    assert.equal((await audits(t.id, 'enrollment_document.link')).length, 2)

    const view = await studentView(t.front, studentId)
    assert.equal(view.prospectId, 'pr-doc')
    assert.equal(view.name, 'Belgeli Aday')
    assert.deepEqual(view.documents.map((item) => item.id).sort(), [identity.id, photo.id].sort())
    assert.ok(view.documents.every((item) => item.canOpen))
    assert.deepEqual(
      view.gaps.missing.map((item) => item.id),
      ['report_card'],
    )
    assert.equal(view.gaps.awaitingReview, 1)
    assert.equal(view.consent, null)
    const prospectView = ok(await get(docs('pr-doc'), t.front)) as {
      documents: { id: string; linkedToStudent: boolean }[]
    }
    assert.equal(prospectView.documents.find((item) => item.id === photo.id)?.linkedToStudent, true)

    // Kayıttan sonra kabul edilen belge bağlanır; yeni yüklenip reddedilen 30 gün sonraya işaretlenir.
    await accept(t, 'pr-doc', other.id)
    assert.equal((await documentRow(t.id, other.id)).studentId, studentId)
    const card2 = await add(t, 'pr-doc', 'report_card')
    await accept(t, 'pr-doc', card2.id)
    const after = await studentView(t.admin, studentId)
    assert.equal(after.documents.length, 4)
    assert.deepEqual(after.gaps, { missing: [], awaitingReview: 0 })

    const list = await listRows(t.front)
    assert.deepEqual(
      list.data.map((row) => [row.studentId, row.documentCount, row.missing.length]),
      [[studentId, 4, 0]],
    )
  })

  test('DOM-KAY-045, K-386: imha işi öğrenciye bağlı belgeyi silmez; vazgeçip yeniden açılan adayın işareti de bağlı belgeyi silmez', async () => {
    const t = await institution()
    const identity = await add(t, 'pr-doc', 'identity')
    await accept(t, 'pr-doc', identity.id)
    const oldPhoto = await add(t, 'pr-doc', 'photo')
    const photo = await add(t, 'pr-doc', 'photo')
    await accept(t, 'pr-doc', photo.id)
    const card = await add(t, 'pr-doc', 'report_card')
    ok(await review(t, 'pr-doc', card.id, { decision: 'reject', reason: 'Eksik sayfa.' }))

    // Vazgeçme bütün dosyaları 30 gün sonraya işaretler (K-323); aday yeniden açılır.
    ok(
      await call(
        'PATCH',
        '/api/v1/prospects/pr-doc',
        t.front,
        { stage: 'Vazgeçti', lostReason: 'price' },
        ifMatch(await versionOf(t.id, 'pr-doc')),
      ),
    )
    ok(
      await call(
        'PATCH',
        '/api/v1/prospects/pr-doc',
        t.front,
        { stage: 'İletişime geçildi' },
        ifMatch(await versionOf(t.id, 'pr-doc')),
      ),
    )
    const studentId = await enroll(t, 'pr-doc')
    const view = await studentView(t.admin, studentId)
    assert.ok(view.documents.every((item) => item.file.available))
    const prospectView = ok(await get(docs('pr-doc'), t.admin)) as {
      documents: { id: string; file: { purgeAt: string | null } }[]
    }
    assert.equal(prospectView.documents.find((item) => item.id === photo.id)?.file.purgeAt, null)

    const result = await purge(t, new Date(FIXED_NOW.getTime() + 31 * DAY_MS))
    assert.equal(result.held, 2)
    assert.equal((await fileRow(t.id, identity.fileId)).status, 'ready')
    assert.equal((await fileRow(t.id, photo.fileId)).status, 'ready')
    assert.equal((await fileRow(t.id, oldPhoto.fileId)).status, 'deleted')
    assert.equal((await fileRow(t.id, card.fileId)).status, 'deleted')
    const later = await studentView(t.admin, studentId)
    assert.equal(later.documents.length, 2)
    assert.ok(later.documents.every((item) => item.file.available && item.canOpen))
    ok(await get(`${docs('pr-doc')}/${identity.id}/url`, t.front))
  })

  test('DOM-KAY-045, K-385, H-80: sağlık raporu rızasıyla öğrenciye geçer, ön büro açamaz; rıza geri çekilince belge düşer ve imha edilir', async () => {
    const t = await institution()
    ok(await call('POST', consentUrl('pr-health'), t.front, { method: 'wet_signature' }), 201)
    const report = await add(t, 'pr-health', 'health_report')
    await accept(t, 'pr-health', report.id)
    const studentId = await enroll(t, 'pr-health')

    assert.equal((await documentRow(t.id, report.id)).studentId, studentId)
    const [consent] = await db
      .select()
      .from(prospectDocumentConsents)
      .where(eq(prospectDocumentConsents.institutionId, t.id))
    assert.equal(consent?.studentId, studentId)
    assert.equal(consent?.linkedAt?.getTime(), FIXED_NOW.getTime())
    assert.equal((await audits(t.id, 'prospect_document_consent.link')).length, 1)

    const front = await studentView(t.front, studentId)
    assert.equal(front.consent?.grantor, 'guardian')
    assert.equal(front.documents[0]?.canOpen, false)
    assert.equal(front.documents[0]?.file.name, null)
    assertError(
      await get(`${docs('pr-health')}/${report.id}/url`, t.front),
      403,
      'special_document_forbidden',
    )
    const admin = await studentView(t.admin, studentId)
    assert.equal(admin.documents[0]?.canOpen, true)
    assert.equal(admin.documents[0]?.file.name, 'Belge.pdf')

    ok(
      await call(
        'POST',
        `${consentUrl('pr-health')}/withdraw`,
        t.front,
        undefined,
        ifMatch(consent?.version),
      ),
    )
    const withdrawn = await studentView(t.admin, studentId)
    assert.equal(withdrawn.documents.length, 0)
    assert.equal(withdrawn.consent, null)
    await purge(t, FIXED_NOW)
    assert.equal((await fileRow(t.id, report.fileId)).status, 'deleted')
  })

  test('DOM-KAY-045, K-385: etkin rıza yoksa özel nitelikli belge öğrenciye geçmez, arşivlenir ve hemen imhaya işaretlenir', async () => {
    const t = await institution()
    ok(await call('POST', consentUrl('pr-health'), t.front, { method: 'wet_signature' }), 201)
    const report = await add(t, 'pr-health', 'health_report')
    await accept(t, 'pr-health', report.id)
    const identity = await add(t, 'pr-health', 'identity')
    await accept(t, 'pr-health', identity.id)
    // Tutarsız veri: rıza belge arşivlenmeden geçersiz kalmış (ör. elle düzeltme).
    await db
      .update(prospectDocumentConsents)
      .set({ withdrawnAt: FIXED_NOW, withdrawnByUserId: 'test' })
      .where(eq(prospectDocumentConsents.institutionId, t.id))

    const studentId = await enroll(t, 'pr-health')
    const row = await documentRow(t.id, report.id)
    assert.equal(row.studentId, null)
    assert.equal(row.archivedAt?.getTime(), FIXED_NOW.getTime())
    assert.equal(
      (await fileRow(t.id, report.fileId)).retentionUntil?.getTime(),
      FIXED_NOW.getTime(),
    )
    assert.equal((await documentRow(t.id, identity.id)).studentId, studentId)
    const view = await studentView(t.admin, studentId)
    assert.deepEqual(
      view.documents.map((item) => item.id),
      [identity.id],
    )
    assert.equal(view.consent, null)
    const [consent] = await db
      .select()
      .from(prospectDocumentConsents)
      .where(eq(prospectDocumentConsents.institutionId, t.id))
    assert.equal(consent?.studentId, null)
  })

  test('DOM-KAY-045: yetki, modül ve kurum kapsamı; başka kurumun öğrencisi 404, listede yok', async () => {
    const t = await institution()
    const identity = await add(t, 'pr-doc', 'identity')
    await accept(t, 'pr-doc', identity.id)
    const studentId = await enroll(t, 'pr-doc')

    assertError(await get(LIST, null), 401)
    assertError(await get(studentDocs(studentId), null), 401)
    for (const role of ['ogretmen', 'veli'] as const) {
      const cookie = await signInAs(app, await createMember(app, t.id, role))
      assertError(await get(LIST, cookie), 403)
      assertError(await get(studentDocs(studentId), cookie), 403)
    }
    const closed = await institution({ enabledModules: { crm: false } })
    assertError(await get(LIST, closed.admin), 403, 'module_disabled')
    assertError(await get(studentDocs(studentId), closed.admin), 403, 'module_disabled')

    const other = await institution()
    assertError(await get(studentDocs(studentId), other.admin), 404)
    assert.equal((await listRows(other.admin)).meta.total, 0)
    assertError(await get(studentDocs('yok'), t.admin), 404)
    assertError(await get(`${LIST}?pageSize=500`, t.admin), 400)
    assertError(await get(`${LIST}?institutionId=${other.id}`, t.admin), 400)

    // Aday kaydından gelmeyen öğrenci: liste boş, bağlantı yok.
    const imported = SEED.students.find((item) => CLASSES.includes(item.classId))
    assert.ok(imported)
    const plain = await studentView(t.front, imported.id)
    assert.equal(plain.prospectId, null)
    assert.deepEqual(plain.documents, [])
  })

  test('DOM-KAY-045: liste ada göre arar, eksiği olanları süzer ve sayfalar', async () => {
    const t = await institution()
    const identity = await add(t, 'pr-doc', 'identity')
    await accept(t, 'pr-doc', identity.id)
    const complete = await enroll(t, 'pr-doc')
    const missing = await enroll(t, 'pr-health')

    const all = await listRows(t.admin)
    assert.deepEqual(
      all.data.map((row) => row.studentId),
      [complete, missing],
    )
    const gaps = await listRows(t.admin, '?missingOnly=true')
    assert.equal(gaps.meta.total, 2)
    assert.deepEqual(
      gaps.data.find((row) => row.studentId === complete)?.missing.map((item) => item.id),
      ['report_card', 'photo'],
    )
    const search = await listRows(t.admin, `?q=${encodeURIComponent('raporlu')}`)
    assert.deepEqual(
      search.data.map((row) => row.studentId),
      [missing],
    )
    const paged = await listRows(t.admin, '?page=2&pageSize=1')
    assert.deepEqual(
      paged.data.map((row) => row.studentId),
      [missing],
    )
    assert.equal(paged.meta.total, 2)
  })

  test('DOM-KAY-045, K-386: kesin kayıt geri alınamaz; ayrılışta belgeler öğrenci dosyasında kalır, liste aktif öğrenciyi gösterir', async () => {
    const t = await institution()
    const identity = await add(t, 'pr-doc', 'identity')
    await accept(t, 'pr-doc', identity.id)
    const studentId = await enroll(t, 'pr-doc')

    assertError(
      await call(
        'POST',
        '/api/v1/prospects/pr-doc/stage-revert',
        t.admin,
        { stage: 'İletişime geçildi', reason: 'Yanlış kayıt.' },
        ifMatch(await versionOf(t.id, 'pr-doc')),
      ),
      409,
      'prospect_enrolled',
    )
    assert.equal((await documentRow(t.id, identity.id)).studentId, studentId)

    const left = await call('POST', `/api/v1/students/${studentId}/withdraw`, t.admin, {
      withdrawalDate: '2026-10-01',
      termStartDate: '2026-11-01',
      attendedUnits: 0,
      totalUnits: 180,
      reason: 'relocation',
      targetSchool: 'Test Okulu',
    })
    assert.ok(left.statusCode < 300, left.body)
    assert.equal((await documentRow(t.id, identity.id)).studentId, studentId)
    assert.equal((await studentView(t.admin, studentId)).documents.length, 1)
    assert.equal((await listRows(t.admin)).meta.total, 0)
    const result = await purge(t, new Date(FIXED_NOW.getTime() + 400 * DAY_MS))
    assert.equal(result.purged, 0)
    assert.equal((await fileRow(t.id, identity.fileId)).status, 'ready')
  })
})
