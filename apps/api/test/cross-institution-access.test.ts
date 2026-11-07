import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { academicTerms, academicYears } from '../src/db/schema/academic-years.ts'
import { files } from '../src/db/schema/files.ts'
import { institutionSettings } from '../src/db/schema/institution-settings.ts'
import { consents, noticeAcknowledgements, privacyNotices } from '../src/db/schema/privacy.ts'
import { records } from '../src/db/schema/records.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import {
  crossInject,
  nextIp,
  runCrossCase,
  shape,
  tableRows,
  type CrossCase,
  type CrossRequest,
} from './support/cross-institution.ts'
import { multipart, PDF, tempStorage, uploadParts } from './support/files-sample.ts'

/**
 * Erişim, takvim, dosya ve bildirim uçlarında çapraz kurum (IST-002; DOM-YTK-001, DOM-YTK-011):
 * KVKK metinleri (DOM-YTK-056, 060), eğitim yılı dönemleri ve kapanışı (DOM-YTK-064, 066), dosya
 * yükleme (DOM-KYN-004) ve bildirim sayımı (DOM-ILT-073). Kimliksiz uçlarda B kurumunun metni,
 * yılı, kotası ve bildirimi A'nın yanıtına girmez ve A'nın yazması B'yi değiştirmez; kayıt
 * kimliği alan dönem uçları tablo koşucusuyla (`support/cross-institution.ts`) sınanır.
 */

const TERMS = [
  { name: 'Güz', startDate: '2026-09-14', endDate: '2027-01-22' },
  { name: 'Bahar', startDate: '2027-02-08', endDate: '2027-06-25' },
]

let db: Database
let app: App
let store: Awaited<ReturnType<typeof tempStorage>>

const notification = (id: string) => ({
  collection: 'notifications' as const,
  id,
  data: {
    id,
    kind: 'feedback_released',
    audience: 'parent',
    studentId: 's-1',
    subject: { type: 'task_submission', id: `sub-${id}` },
    createdAt: FIXED_NOW.toISOString(),
  },
})

/** Kurum: Deniz (`s-1`), velisi ve kendisi; `notifications` kadar veli bildirimi; 2026 yılı (dönemli). */
async function tenant(notifications = 0, withYear = true) {
  // Ayarsız açılış yıl yazmaz; 2026 yılı uçtan kurulur (`academic-years.test.ts` ile aynı).
  const institution = await createInstitution(app, { academicYear: null })
  const prefix = randomUUID().slice(0, 8)
  await insertMissingRecords(
    db,
    institution.id,
    [
      {
        collection: 'students',
        id: 's-1',
        data: { id: 's-1', name: 'Deniz Yılmaz', classId: '9-A', isActive: true },
      },
      ...Array.from({ length: notifications }, (_, index) => notification(`n-${prefix}-${index}`)),
    ],
    FIXED_NOW,
  )
  const member = (role: 'ogrenci' | 'veli', kind: string) =>
    createMember(app, institution.id, role, [{ kind, recordId: 's-1' } as never])
  const cookies = {
    admin: await signInAs(app, institution.admin),
    parent: await signInAs(app, await member('veli', 'child')),
    student: await signInAs(app, await member('ogrenci', 'student')),
  }
  const t = { id: institution.id, cookies }
  if (withYear)
    await made(t.cookies.admin, '/api/v1/academic-years', { startYear: 2026, terms: TERMS })
  return t
}
type Tenant = Awaited<ReturnType<typeof tenant>>

const call = (cookie: string, request: CrossRequest) => crossInject(app, nextIp(), cookie, request)

async function made(cookie: string, url: string, body: Record<string, unknown>, ifMatch?: number) {
  const response = await call(cookie, {
    method: 'POST',
    url,
    body,
    ...(ifMatch === undefined ? {} : { ifMatch }),
  })
  assert.ok(response.statusCode < 300, response.body)
  return response.json<{ data: { id: string; terms?: { id: string; name: string }[] } }>().data
}
async function read<T>(cookie: string, url: string) {
  const response = await call(cookie, { method: 'GET', url })
  assert.equal(response.statusCode, 200, response.body)
  return response.json<{ data: T }>().data
}

const notice = (title: string) => ({
  kind: 'notice',
  audience: 'veli',
  title,
  body: 'Kişisel verileriniz şu amaçlarla işlenir.',
})
const consentText = (purpose: string) => ({
  kind: 'consent_text',
  purpose,
  title: 'Rıza metni',
  body: 'Açık rıza metni.',
})

const PRIVACY = [privacyNotices, noticeAcknowledgements, consents]
const CALENDAR = [academicYears, academicTerms]

/** Kurumun 2026 yılındaki ilk dönemin kimliği. */
async function termOf(t: Tenant) {
  const year = await read<{ terms: { id: string }[] }>(
    t.cookies.admin,
    '/api/v1/academic-years/2026',
  )
  const [term] = year.terms
  assert.ok(term)
  return term.id
}

/** Yalnız kurumda açılan 2030 yılı (A'da yok; B'nin yılı A'dan yol kimliğiyle aranır). */
async function year2030(t: Tenant) {
  await made(t.cookies.admin, '/api/v1/academic-years', { startYear: 2030, terms: [] })
  return { startYear: '2030' }
}

const TERM_CASES: readonly CrossCase<Tenant>[] = [
  {
    key: 'POST /api/v1/academic-years/:startYear/terms',
    kind: 'kayıt',
    actor: (a) => a.cookies.admin,
    make: year2030,
    missing: () => ({ startYear: '2031' }),
    request: ({ startYear }) => ({
      method: 'POST',
      url: `/api/v1/academic-years/${startYear}/terms`,
      body: { name: 'Güz', startDate: `${startYear}-09-14`, endDate: `${startYear}-12-20` },
      ifMatch: 1,
    }),
  },
  {
    // A'nın da 2026 yılı var: B'nin dönem kimliği A'nın aynı yılında olmayan dönemle aynı 404.
    key: 'PATCH /api/v1/academic-years/:startYear/terms/:termId',
    kind: 'kayıt',
    actor: (a) => a.cookies.admin,
    make: async (t) => ({ termId: await termOf(t) }),
    request: ({ termId }) => ({
      method: 'PATCH',
      url: `/api/v1/academic-years/2026/terms/${termId}`,
      body: { name: 'Birinci dönem' },
      ifMatch: 1,
    }),
  },
  {
    key: 'DELETE /api/v1/academic-years/:startYear/terms/:termId',
    kind: 'kayıt',
    actor: (a) => a.cookies.admin,
    make: async (t) => ({ termId: await termOf(t) }),
    request: ({ termId }) => ({
      method: 'DELETE',
      url: `/api/v1/academic-years/2026/terms/${termId}`,
      ifMatch: 1,
    }),
  },
  {
    key: 'POST /api/v1/academic-years/:startYear/close',
    kind: 'kayıt',
    actor: (a) => a.cookies.admin,
    make: year2030,
    missing: () => ({ startYear: '2031' }),
    request: ({ startYear }) => ({
      method: 'POST',
      url: `/api/v1/academic-years/${startYear}/close`,
      body: {},
      ifMatch: 1,
    }),
  },
]

describe('IST-002: erişim, takvim, dosya ve bildirim uçlarında başka kurum (DOM-YTK-001, DOM-YTK-011)', () => {
  let close: () => Promise<void>

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    store = await tempStorage()
    app = await buildTestApp(db, { storage: store.storage })
  })
  after(async () => {
    await app.close()
    await close()
    await store.remove()
  })

  // --- KVKK metinleri -------------------------------------------------------------------------
  test('IST-002: POST /api/v1/privacy-notices: gövdedeki institutionId etkisiz; sürüm başka kurumun metninden sayılmaz, B değişmez', async () => {
    const a = await tenant()
    const b = await tenant()
    await made(b.cookies.admin, '/api/v1/privacy-notices', notice('B ilk metin'))
    const latest = await made(b.cookies.admin, '/api/v1/privacy-notices', notice('B ikinci metin'))
    const before = await tableRows(db, b.id, PRIVACY)

    const forged = await call(a.cookies.admin, {
      method: 'POST',
      url: '/api/v1/privacy-notices',
      body: { ...notice('A metni'), institutionId: b.id },
    })
    assert.equal(forged.statusCode, 400, forged.body)
    assert.match(forged.body, /institutionId/)
    const published = await made(a.cookies.admin, '/api/v1/privacy-notices', notice('A metni'))
    const [row] = await db.select().from(privacyNotices).where(eq(privacyNotices.id, published.id))
    assert.equal(row?.institutionId, a.id)
    assert.equal(row?.version, 1, 'sürüm B kurumunun metinlerinden sayıldı')
    assert.deepEqual(await tableRows(db, b.id, PRIVACY), before)
    const current = await read<{ notice: { id: string } | null }>(
      b.cookies.parent,
      '/api/v1/privacy-notices/current',
    )
    assert.equal(current.notice?.id, latest.id)
  })

  test('IST-002: GET /api/v1/privacy-notices/current: başka kurumun metni görünmez', async () => {
    const a = await tenant()
    const b = await tenant()
    await made(b.cookies.admin, '/api/v1/privacy-notices', notice('B metni'))
    const empty = await read<{ notice: unknown; needsAcknowledgement: boolean }>(
      a.cookies.parent,
      '/api/v1/privacy-notices/current',
    )
    assert.equal(empty.notice, null)
    const own = await made(a.cookies.admin, '/api/v1/privacy-notices', notice('A metni'))
    const current = await read<{ notice: { id: string } | null }>(
      a.cookies.parent,
      '/api/v1/privacy-notices/current',
    )
    assert.equal(current.notice?.id, own.id)
  })

  test('IST-002: GET /api/v1/consent-texts/:purpose: başka kurumun rıza metni olmayan metinle aynı 404', async () => {
    const a = await tenant()
    const b = await tenant()
    await made(b.cookies.admin, '/api/v1/privacy-notices', consentText('photo_video_sharing'))
    const foreign = await call(a.cookies.parent, {
      method: 'GET',
      url: '/api/v1/consent-texts/photo_video_sharing',
    })
    const missing = await call(a.cookies.parent, {
      method: 'GET',
      url: '/api/v1/consent-texts/speaking_recording',
    })
    assert.equal(foreign.statusCode, 404, foreign.body)
    assert.deepEqual(shape(foreign), shape(missing))
    const own = await made(
      a.cookies.admin,
      '/api/v1/privacy-notices',
      consentText('photo_video_sharing'),
    )
    const current = await read<{ text: { id: string } }>(
      a.cookies.parent,
      '/api/v1/consent-texts/photo_video_sharing',
    )
    assert.equal(current.text.id, own.id)
  })

  test('IST-002: GET /api/v1/consent-texts: başka kurumun rıza metni listede yok', async () => {
    const a = await tenant()
    const b = await tenant()
    await made(b.cookies.admin, '/api/v1/privacy-notices', consentText('photo_video_sharing'))
    const foreign = await read<{ text: { id: string } }[]>(
      a.cookies.parent,
      '/api/v1/consent-texts',
    )
    assert.deepEqual(foreign, [])
    const own = await made(
      a.cookies.admin,
      '/api/v1/privacy-notices',
      consentText('photo_video_sharing'),
    )
    const current = await read<{ text: { id: string } }[]>(
      a.cookies.parent,
      '/api/v1/consent-texts?purpose=photo_video_sharing',
    )
    assert.deepEqual(
      current.map((item) => item.text.id),
      [own.id],
    )
  })

  // --- Eğitim yılı ----------------------------------------------------------------------------
  test('IST-002: GET /api/v1/academic-years/current: başka kurumun etkin yılı ve dönemi görünmez', async () => {
    const a = await tenant(0, false)
    const b = await tenant()
    await made(b.cookies.admin, '/api/v1/academic-years/2026/activate', {}, 1)
    const current = await read<{ year: unknown; term: unknown }>(
      a.cookies.student,
      '/api/v1/academic-years/current',
    )
    assert.deepEqual([current.year, current.term], [null, null])
    const own = await read<{ year: { startYear: number } | null }>(
      b.cookies.student,
      '/api/v1/academic-years/current',
    )
    assert.equal(own.year?.startYear, 2026)
  })

  for (const spec of TERM_CASES) {
    const title = 'başka kurumun kaydı olmayan kayıtla aynı 404; iki kurum değişmez'
    test(`IST-002: ${spec.key}: ${title}`, () =>
      runCrossCase(
        {
          app,
          tenant: () => tenant(),
          snapshot: (institutionId) => tableRows(db, institutionId, CALENDAR),
        },
        spec,
      ))
  }

  // --- Dosya ----------------------------------------------------------------------------------
  test('IST-002: POST /api/v1/files: çok parçalı gövdedeki institutionId etkisiz; başka kurumun dosyası kotaya sayılmaz', async () => {
    const a = await tenant()
    const b = await tenant()
    // A'nın kotası tek dosyalık; B'nin dosyaları A'nın kullanımına girmez.
    await db
      .insert(institutionSettings)
      .values({ institutionId: a.id, academicYear: 2026, storageQuotaBytes: PDF.length })
      .onConflictDoUpdate({
        target: institutionSettings.institutionId,
        set: { storageQuotaBytes: PDF.length },
      })
    const upload = (cookie: string, parts: ReturnType<typeof uploadParts>) => {
      const body = multipart(parts)
      return app.inject({
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
    }
    for (let index = 0; index < 2; index += 1)
      assert.equal(
        (await upload(b.cookies.student, uploadParts('submission', PDF))).statusCode,
        201,
      )
    const before = await tableRows(db, b.id, [files])

    const response = await upload(a.cookies.student, [
      { name: 'institutionId', value: b.id },
      ...uploadParts('submission', PDF),
    ])
    assert.equal(response.statusCode, 201, response.body)
    const id = response.json<{ data: { id: string } }>().data.id
    const [row] = await db.select().from(files).where(eq(files.id, id))
    assert.equal(row?.institutionId, a.id)
    assert.deepEqual(await tableRows(db, b.id, [files]), before)
    // Kota yalnız A'nın dosyasıyla doldu.
    const over = await upload(a.cookies.student, uploadParts('submission', PDF))
    assert.equal(over.statusCode, 422, over.body)
    assert.equal(over.json<{ code: string }>().code, 'storage_quota_exceeded')
  })

  // --- Bildirim -------------------------------------------------------------------------------
  const notificationRows = (institutionId: string) =>
    db
      .select({ id: records.id, collection: records.collection, version: records.version })
      .from(records)
      .where(eq(records.institutionId, institutionId))
      .then((rows) =>
        rows
          .filter((row) => row.collection.startsWith('notification'))
          .map((row) => `${row.collection}/${row.id}@${String(row.version)}`)
          .sort(),
      )

  test('IST-002: GET /api/v1/notifications/unread-count: başka kurumun bildirimi sayılmaz', async () => {
    const a = await tenant(1)
    const b = await tenant(3)
    const count = (cookie: string) =>
      read<{ unread: number }>(cookie, '/api/v1/notifications/unread-count')
    assert.equal((await count(a.cookies.parent)).unread, 1)
    assert.equal((await count(b.cookies.parent)).unread, 3)
  })

  test('IST-002: POST /api/v1/notifications/read-all: başka kurumun bildirimi işaretlenmez, B değişmez', async () => {
    const a = await tenant(1)
    const b = await tenant(3)
    const before = await notificationRows(b.id)
    const all = await call(a.cookies.parent, {
      method: 'POST',
      url: '/api/v1/notifications/read-all',
      body: {},
    })
    assert.equal(all.statusCode, 200, all.body)
    assert.equal(all.json<{ data: { changes: { inserted: number } } }>().data.changes.inserted, 1)
    assert.equal(
      (await read<{ unread: number }>(a.cookies.parent, '/api/v1/notifications/unread-count'))
        .unread,
      0,
    )
    assert.deepEqual(await notificationRows(b.id), before)
    assert.equal(
      (await read<{ unread: number }>(b.cookies.parent, '/api/v1/notifications/unread-count'))
        .unread,
      3,
    )
  })
})
