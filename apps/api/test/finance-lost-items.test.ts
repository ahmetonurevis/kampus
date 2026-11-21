import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { files } from '../src/db/schema/files.ts'
import { lostItemReports, lostItems } from '../src/db/schema/finance-lost-items.ts'
import { studentGuardians } from '../src/db/schema/student-guardians.ts'
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
 * Kayıp eşya uçları (DOM-FIN-145; ON-171; K-490…K-492). Her test kendi kurumunu kurar.
 * FIXED_NOW 2026-10-06T09:00Z (Europe/Istanbul günü 2026-10-06).
 */

const FINANCE = '/api/v1/finance'
const ITEMS = `${FINANCE}/lost-items`
const REPORTS = `${FINANCE}/lost-item-reports`
const SUMMARY = `${FINANCE}/lost-item-summary`
const FINDERS = `${FINANCE}/lost-item-finders`
const RECIPIENTS = `${FINANCE}/lost-item-recipients`
const GALLERY = `${FINANCE}/lost-item-gallery`
const RETENTION = `${FINANCE}/lost-item-retention`
const DISPOSALS = `${FINANCE}/lost-item-disposals`
const SETTINGS = `${FINANCE}/lost-item-settings`
const TODAY = '2026-10-06'

const SEED = createSeed(FIXED_NOW)

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-145: kayıp eşya uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  let tenantCount = 0
  let clientIp = '10.171.0.1'

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
    cookie: string,
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

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.171.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    for (const id of ['s1', 's2']) {
      const student = SEED.students.find((row) => row.id === id)
      assert.ok(student)
      await insertMissingRecords(
        db,
        created.id,
        [{ collection: 'students', id, data: { ...student } }],
        FIXED_NOW,
      )
    }
    return {
      id: created.id,
      admin: await signInAs(app, created.admin),
      adminMembershipId: created.adminMembershipId,
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  const member = async (
    institutionId: string,
    role: Role,
    links: Parameters<typeof createMember>[3] = [],
  ) => signInAs(app, await createMember(app, institutionId, role, links))
  const parentOf = (t: Tenant, studentId = 's1') =>
    member(t.id, 'veli', [{ kind: 'child', recordId: studentId }])
  async function upload(t: Tenant, cookie: string) {
    const body = multipart(uploadParts('question_image', png(), 'mont.png', 'image/png'))
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
  const itemBody = (extra: Json = {}) => ({
    description: 'Lacivert mont, yakasında D. Y. yazıyor',
    category: 'clothing',
    foundLocation: 'Spor salonu',
    foundOn: TODAY,
    storageLocation: 'Ön büro dolabı',
    ...extra,
  })
  const itemUrl = (id: unknown) => `${ITEMS}/${String(id)}`
  const reportUrl = (id: unknown) => `${REPORTS}/${String(id)}`
  const itemRows = (institutionId: string) =>
    db.select().from(lostItems).where(eq(lostItems.institutionId, institutionId))
  const reportRows = (institutionId: string) =>
    db.select().from(lostItemReports).where(eq(lostItemReports.institutionId, institutionId))
  const fileRow = async (institutionId: string, fileId: string) => {
    const [row] = await db
      .select()
      .from(files)
      .where(and(eq(files.institutionId, institutionId), eq(files.id, fileId)))
    return row
  }
  /** Saklama dalları için bulunma gününü geçmişe çeker (uç 90 günden eskiyi yazmaz). */
  const backdate = (institutionId: string, id: unknown, foundOn: string) =>
    db
      .update(lostItems)
      .set({ foundOn })
      .where(and(eq(lostItems.institutionId, institutionId), eq(lostItems.id, String(id))))

  test('kimliksiz istek 401', async () => {
    for (const url of [ITEMS, REPORTS, SUMMARY, FINDERS, GALLERY, RETENTION, SETTINGS])
      assertError(await get(url, null), 401)
    assertError(await post(ITEMS, null, {}), 401)
    assertError(await post(REPORTS, null, {}), 401)
    assertError(await post(DISPOSALS, null, {}), 401)
  })

  test('DOM-FIN-145: rol ayrımı ve modül kapalı 403 (K-490…K-492)', async () => {
    const t = await institution()
    const teacher = await member(t.id, 'ogretmen')
    assertError(await get(ITEMS, teacher), 403)
    assertError(await get(REPORTS, teacher), 403)
    assertError(await get(GALLERY, teacher), 403)
    const desk = await member(t.id, 'onburo')
    const created = ok(await post(ITEMS, desk, itemBody()), 201)
    ok(await get(itemUrl(created.id), desk))
    ok(await get(SUMMARY, desk))
    ok(await get(FINDERS, desk))
    ok(await get(SETTINGS, desk))
    assertError(await get(RETENTION, desk), 403)
    assertError(await versioned('PATCH', SETTINGS, desk, { retentionDays: 10 }, 1), 403)
    assertError(
      await post(DISPOSALS, desk, { itemIds: [created.id], outcome: 'donated', reason: 'Bağış' }),
      403,
    )
    assertError(
      await post(REPORTS, desk, { studentId: 's1', description: 'Suluk', lostOn: TODAY }),
      403,
    )
    const parent = await parentOf(t)
    assertError(await get(ITEMS, parent), 403)
    assertError(await post(ITEMS, parent, itemBody()), 403)
    assertError(await get(SUMMARY, parent), 403)
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(ITEMS, closed.admin), 403, 'module_disabled')
  })

  test('DOM-FIN-145: kayıt, fotoğraf, düzeltme ve mükerrer kayıt (K-490)', async () => {
    const t = await institution()
    const finder = await createMember(app, t.id, 'ogretmen')
    const parent = await createMember(app, t.id, 'veli')
    const photo = await upload(t, t.admin)
    const key = randomUUID()
    const body = itemBody({ finderMembershipId: finder.membershipId, photoFileIds: [photo] })
    const created = ok(await post(ITEMS, t.admin, body, key), 201)
    assert.equal(created.status, 'pending')
    assert.equal(created.photoCount, 1)
    assert.equal(created.retentionDueOn, '2026-11-05')
    assert.equal((created.photos as Json[])[0]?.url, null)
    const replay = await post(ITEMS, t.admin, body, key)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((await itemRows(t.id)).length, 1)
    assert.equal((await fileRow(t.id, photo))?.attachedId, created.id)
    // Genel dosya ucu bağlı fotoğrafı açmaz; ayrıntı imzalı bağlantıyla döner.
    assertError(await get(`/api/v1/files/${photo}/url`, t.admin), 404)
    const detail = ok(await get(itemUrl(created.id), t.admin))
    assert.match(String((detail.photos as Json[])[0]?.url), /^http/)
    assert.equal(detail.finderName, 'Test Kullanıcı')

    assertError(
      await post(ITEMS, t.admin, itemBody({ foundOn: '2026-10-07' })),
      422,
      'lost_item_found_future',
    )
    assertError(
      await post(ITEMS, t.admin, itemBody({ finderMembershipId: parent.membershipId })),
      422,
      'lost_item_finder_not_staff',
    )
    assertError(await post(ITEMS, t.admin, itemBody({ ownerName: 'Deniz' })), 400)
    assertError(
      await post(ITEMS, t.admin, itemBody({ photoFileIds: [photo] })),
      409,
      'file_already_attached',
    )
    assert.equal((await itemRows(t.id)).length, 1)

    const second = await upload(t, t.admin)
    const added = ok(
      await versioned(
        'POST',
        `${itemUrl(created.id)}/photos`,
        t.admin,
        { fileId: second },
        created.version,
      ),
    )
    assert.equal(added.photoCount, 2)
    assertError(
      await versioned(
        'POST',
        `${itemUrl(created.id)}/photos`,
        t.admin,
        { fileId: second },
        created.version,
      ),
      409,
    )
    const removed = ok(
      await versioned(
        'DELETE',
        `${itemUrl(created.id)}/photos/${second}`,
        t.admin,
        undefined,
        added.version,
      ),
    )
    assert.equal(removed.photoCount, 1)
    assert.equal((await fileRow(t.id, second))?.attachedId, null)
    assertError(
      await versioned(
        'DELETE',
        `${itemUrl(created.id)}/photos/${randomUUID()}`,
        t.admin,
        undefined,
        removed.version,
      ),
      404,
    )

    const edited = ok(
      await versioned(
        'PATCH',
        itemUrl(created.id),
        t.admin,
        { storageLocation: 'Depo' },
        removed.version,
      ),
    )
    assert.equal(edited.storageLocation, 'Depo')
    assertError(
      await versioned(
        'PATCH',
        itemUrl(created.id),
        t.admin,
        { storageLocation: 'Depo' },
        edited.version,
      ),
      422,
      'lost_item_unchanged',
    )
    assertError(
      await versioned(
        'PATCH',
        itemUrl(created.id),
        t.admin,
        { storageLocation: 'Dolap' },
        created.version,
      ),
      409,
    )
    const audits = await db
      .select({ action: auditLog.action, changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.entityId, String(created.id))))
    assert.ok(audits.some((row) => row.action === 'finance.lost_item.create'))
    assert.ok(!JSON.stringify(audits).includes('Lacivert'))
    const list = (await get(`${ITEMS}?q=salon&category=clothing`, t.admin)).json()
    assert.equal(list.meta.total, 1)
    assert.equal((await get(`${ITEMS}?status=handed_over`, t.admin)).json().meta.total, 0)
  })

  test('DOM-FIN-145: veli bildirimi, eşleme ve teslim; teslimden sonra değişmez (K-490, K-491)', async () => {
    const t = await institution()
    const parent = await parentOf(t)
    const other = await parentOf(t, 's2')
    const student = await member(t.id, 'ogrenci', [{ kind: 'student', recordId: 's1' }])
    const photo = await upload(t, t.admin)
    const item = ok(await post(ITEMS, t.admin, itemBody({ photoFileIds: [photo] })), 201)

    const report = ok(
      await post(REPORTS, parent, { studentId: 's1', description: 'Lacivert mont', lostOn: TODAY }),
      201,
    )
    assert.equal(report.status, 'open')
    assert.equal(report.studentName, 'Deniz Yılmaz')
    assertError(
      await post(REPORTS, parent, { studentId: 's2', description: 'Kalem kutusu', lostOn: TODAY }),
      404,
    )
    assertError(
      await post(REPORTS, parent, { studentId: 's1', description: 'Mont', lostOn: '2026-10-07' }),
      422,
      'lost_report_future',
    )
    ok(await post(REPORTS, student, { studentId: 's1', description: 'Suluk', lostOn: TODAY }), 201)
    assertError(
      await post(REPORTS, student, { studentId: 's2', description: 'Suluk', lostOn: TODAY }),
      404,
    )
    assert.equal((await get(REPORTS, parent)).json().meta.total, 2)
    assert.equal((await get(REPORTS, other)).json().meta.total, 0)

    // Galeri: kategori, gün ve fotoğraf; tanım ve yer yok.
    const gallery = (await get(GALLERY, parent)).json()
    assert.equal(gallery.meta.enabled, true)
    assert.equal(gallery.data.length, 1)
    assert.deepEqual(Object.keys(gallery.data[0]).sort(), ['category', 'foundOn', 'id', 'photos'])
    assert.match(String(gallery.data[0].photos[0].url), /^http/)

    const matched = ok(
      await versioned(
        'POST',
        `${reportUrl(report.id)}/match`,
        t.admin,
        { itemId: item.id },
        report.version,
      ),
    )
    assert.equal(matched.status, 'matched')
    assert.equal((matched.matchedItem as Json).storageLocation, 'Ön büro dolabı')
    const familyView = (await get(REPORTS, parent))
      .json()
      .data.find((row: Json) => row.id === report.id)
    assert.equal(familyView.status, 'matched')
    assert.equal(familyView.matchedItem, null)
    const secondReport = ok(
      await post(REPORTS, parent, { studentId: 's1', description: 'Mont 2', lostOn: TODAY }),
      201,
    )
    assertError(
      await versioned(
        'POST',
        `${reportUrl(secondReport.id)}/match`,
        t.admin,
        { itemId: item.id },
        secondReport.version,
      ),
      409,
      'lost_item_already_matched',
    )
    assertError(
      await versioned(
        'POST',
        `${reportUrl(secondReport.id)}/match`,
        t.admin,
        { itemId: randomUUID() },
        secondReport.version,
      ),
      422,
      'lost_item_not_found',
    )
    assertError(
      await post(DISPOSALS, t.admin, { itemIds: [item.id], outcome: 'donated', reason: 'Bağış' }),
      422,
    )

    // İletişim kısıtlı ikinci veli (velayetsiz) teslim alamaz (DOM-ILT-072).
    const restricted = await createMember(app, t.id, 'veli', [{ kind: 'child', recordId: 's1' }])
    await db
      .update(studentGuardians)
      .set({ isContactRestricted: true, custody: 'none' })
      .where(
        and(
          eq(studentGuardians.institutionId, t.id),
          eq(studentGuardians.membershipId, restricted.membershipId),
        ),
      )
    const [restrictedLink] = await db
      .select({ id: studentGuardians.id })
      .from(studentGuardians)
      .where(
        and(
          eq(studentGuardians.institutionId, t.id),
          eq(studentGuardians.membershipId, restricted.membershipId),
        ),
      )
    const recipients = ok(await get(`${RECIPIENTS}?studentId=s1`, t.admin))
    const guardians = recipients.guardians as Json[]
    assert.equal(guardians.length, 2)
    const link = guardians.find((row) => row.guardianLinkId === restrictedLink?.id)
    assert.equal(link?.canReceive, false)
    assert.ok(guardians.some((row) => row.canReceive === true))
    assertError(await get(`${RECIPIENTS}?studentId=yok`, t.admin), 404)
    const current = ok(await get(itemUrl(item.id), t.admin))
    assertError(
      await versioned(
        'POST',
        `${itemUrl(item.id)}/handover`,
        t.admin,
        { recipientType: 'guardian', studentId: 's1', guardianLinkId: link?.guardianLinkId },
        current.version,
      ),
      422,
      'lost_item_guardian_restricted',
    )
    assertError(
      await versioned(
        'POST',
        `${itemUrl(item.id)}/handover`,
        t.admin,
        { recipientType: 'student', studentId: 'yok' },
        current.version,
      ),
      422,
      'lost_item_student_not_found',
    )
    assertError(
      await versioned(
        'POST',
        `${itemUrl(item.id)}/handover`,
        t.admin,
        { recipientType: 'other' },
        current.version,
      ),
      400,
    )
    const handed = ok(
      await versioned(
        'POST',
        `${itemUrl(item.id)}/handover`,
        t.admin,
        { recipientType: 'student', studentId: 's1' },
        current.version,
      ),
    )
    assert.equal(handed.status, 'handed_over')
    assert.equal(handed.recipientName, 'Deniz Yılmaz')
    assert.equal(handed.handedOverByName, 'Test Yönetici')
    const [stored] = (await reportRows(t.id)).filter((row) => row.id === report.id)
    assert.equal(stored?.status, 'returned')
    const purgeAt = (await fileRow(t.id, photo))?.retentionUntil
    assert.equal(purgeAt?.toISOString(), '2026-11-05T09:00:00.000Z')
    // Teslimden sonra eşya değişmez; galeride de görünmez.
    assertError(
      await versioned(
        'PATCH',
        itemUrl(item.id),
        t.admin,
        { storageLocation: 'Depo' },
        handed.version,
      ),
      422,
      'lost_item_closed',
    )
    assertError(
      await versioned(
        'POST',
        `${itemUrl(item.id)}/handover`,
        t.admin,
        { recipientType: 'student', studentId: 's1' },
        handed.version,
      ),
      422,
      'lost_item_closed',
    )
    assert.equal((await get(GALLERY, parent)).json().data.length, 0)

    // Kapatma: aile kendi bildirimini kapatır, başka velinin kapsamı 404.
    assertError(
      await versioned(
        'POST',
        `${reportUrl(secondReport.id)}/close`,
        other,
        undefined,
        secondReport.version,
      ),
      404,
    )
    const closedReport = ok(
      await versioned(
        'POST',
        `${reportUrl(secondReport.id)}/close`,
        parent,
        undefined,
        secondReport.version,
      ),
    )
    assert.equal(closedReport.status, 'closed')
    assertError(
      await versioned(
        'POST',
        `${reportUrl(secondReport.id)}/close`,
        parent,
        undefined,
        closedReport.version,
      ),
      422,
      'lost_report_not_open',
    )
    assertError(
      await versioned(
        'POST',
        `${reportUrl(report.id)}/unmatch`,
        t.admin,
        undefined,
        stored?.version ?? 0,
      ),
      422,
      'lost_report_not_matched',
    )
  })

  test('DOM-FIN-145: eşlemeyi kaldırma, başka kişiye teslim ve kapalı galeri (K-490, K-491)', async () => {
    const t = await institution()
    const parent = await parentOf(t)
    const item = ok(await post(ITEMS, t.admin, itemBody({ category: 'stationery' })), 201)
    const report = ok(
      await post(REPORTS, parent, {
        studentId: 's1',
        description: 'Kalem kutusu',
        lostOn: TODAY,
        category: 'stationery',
      }),
      201,
    )
    const matched = ok(
      await versioned(
        'POST',
        `${reportUrl(report.id)}/match`,
        t.admin,
        { itemId: item.id },
        report.version,
      ),
    )
    const reopened = ok(
      await versioned(
        'POST',
        `${reportUrl(report.id)}/unmatch`,
        t.admin,
        undefined,
        matched.version,
      ),
    )
    assert.equal(reopened.status, 'open')
    assert.equal(reopened.matchedItem, null)
    const current = ok(await get(itemUrl(item.id), t.admin))
    assert.equal(current.matchedReport, null)
    const handed = ok(
      await versioned(
        'POST',
        `${itemUrl(item.id)}/handover`,
        t.admin,
        { recipientType: 'other', recipientName: ' Ali Usta ' },
        current.version,
      ),
    )
    assert.equal(handed.recipientName, 'Ali Usta')
    assert.equal(handed.recipientStudentId, null)
    const [stored] = await reportRows(t.id)
    assert.equal(stored?.status, 'open')

    const settings = ok(await get(SETTINGS, t.admin))
    assert.deepEqual(settings, { retentionDays: 30, familyGalleryEnabled: true, version: 1 })
    const saved = ok(
      await versioned('PATCH', SETTINGS, t.admin, { familyGalleryEnabled: false }, 1),
    )
    assert.equal(saved.version, 2)
    ok(await post(ITEMS, t.admin, itemBody()), 201)
    const gallery = (await get(GALLERY, parent)).json()
    assert.equal(gallery.meta.enabled, false)
    assert.equal(gallery.data.length, 0)
    assertError(
      await versioned('PATCH', SETTINGS, t.admin, { familyGalleryEnabled: false }, 2),
      422,
      'lost_item_settings_unchanged',
    )
    assertError(await versioned('PATCH', SETTINGS, t.admin, { retentionDays: 3 }, 2), 400)
    assertError(await versioned('PATCH', SETTINGS, t.admin, { retentionDays: 60 }, 1), 409)
  })

  test('DOM-FIN-145: saklama süresi dolanlar, toplu bağış ve fotoğraf imhası (K-492)', async () => {
    const t = await institution()
    const photo = await upload(t, t.admin)
    const old = ok(await post(ITEMS, t.admin, itemBody({ photoFileIds: [photo] })), 201)
    const fresh = ok(await post(ITEMS, t.admin, itemBody({ description: 'Hesap makinesi' })), 201)
    await backdate(t.id, old.id, '2026-09-06')
    const due = (await get(RETENTION, t.admin)).json()
    assert.equal(due.meta.total, 1)
    assert.equal(due.meta.retentionDays, 30)
    assert.equal(due.data[0].id, old.id)
    assert.equal(ok(await get(SUMMARY, t.admin)).retentionDue, 1)

    const body = (itemIds: unknown[]) => ({
      itemIds,
      outcome: 'donated',
      reason: 'Kızılay bağış kutusu',
    })
    assertError(
      await post(DISPOSALS, t.admin, body([old.id, fresh.id])),
      422,
      'lost_item_retention_not_due',
    )
    assertError(await post(DISPOSALS, t.admin, { ...body([old.id]), reason: '' }), 400)
    assert.ok((await itemRows(t.id)).every((row) => row.status === 'pending'))
    const key = randomUUID()
    const done = ok(await post(DISPOSALS, t.admin, body([old.id]), key))
    assert.deepEqual(done, { disposedCount: 1, outcome: 'donated' })
    const replay = await post(DISPOSALS, t.admin, body([old.id]), key)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    const [row] = (await itemRows(t.id)).filter((item) => item.id === old.id)
    assert.equal(row?.status, 'donated')
    assert.equal(row?.disposalReason, 'Kızılay bağış kutusu')
    assert.equal(row?.disposedByMembershipId, t.adminMembershipId)
    assert.equal(
      (await fileRow(t.id, photo))?.retentionUntil?.toISOString(),
      FIXED_NOW.toISOString(),
    )
    const detail = ok(await get(itemUrl(old.id), t.admin))
    assert.equal((detail.photos as Json[])[0]?.url, null)
    assertError(await post(DISPOSALS, t.admin, body([old.id])), 422, 'lost_item_closed')
    const audits = await db
      .select({ action: auditLog.action, changes: auditLog.changes })
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'finance.lost_item.dispose')),
      )
    assert.equal(audits.length, 1)
    assert.ok(!JSON.stringify(audits).includes('Kızılay'))
  })

  test('DOM-FIN-145: başka kurumun eşyası ve bildirimi 404, B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bItem = ok(await post(ITEMS, b.admin, itemBody()), 201)
    const bParent = await parentOf(b)
    const bReport = ok(
      await post(REPORTS, bParent, { studentId: 's1', description: 'Mont', lostOn: TODAY }),
      201,
    )
    const bUrl = itemUrl(bItem.id)
    const bMember = await createMember(app, b.id, 'ogretmen')
    const aParent = await parentOf(a)
    assertError(await get(bUrl, a.admin), 404)
    assertError(
      await versioned('PATCH', bUrl, a.admin, { storageLocation: 'Depo' }, bItem.version),
      404,
    )
    assertError(
      await versioned('POST', `${bUrl}/photos`, a.admin, { fileId: randomUUID() }, bItem.version),
      404,
    )
    assertError(
      await versioned(
        'DELETE',
        `${bUrl}/photos/${randomUUID()}`,
        a.admin,
        undefined,
        bItem.version,
      ),
      404,
    )
    assertError(
      await versioned(
        'POST',
        `${bUrl}/handover`,
        a.admin,
        { recipientType: 'other', recipientName: 'Ali Usta' },
        bItem.version,
      ),
      404,
    )
    assertError(
      await versioned(
        'POST',
        `${reportUrl(bReport.id)}/match`,
        a.admin,
        { itemId: bItem.id },
        bReport.version,
      ),
      404,
    )
    assertError(
      await versioned(
        'POST',
        `${reportUrl(bReport.id)}/unmatch`,
        a.admin,
        undefined,
        bReport.version,
      ),
      404,
    )
    assertError(
      await versioned(
        'POST',
        `${reportUrl(bReport.id)}/close`,
        a.admin,
        undefined,
        bReport.version,
      ),
      404,
    )
    assertError(
      await versioned(
        'POST',
        `${reportUrl(bReport.id)}/close`,
        aParent,
        undefined,
        bReport.version,
      ),
      404,
    )
    assert.equal((await get(ITEMS, a.admin)).json().meta.total, 0)
    assert.equal((await get(REPORTS, a.admin)).json().meta.total, 0)
    assert.equal((await get(GALLERY, aParent)).json().meta.total, 0)
    assert.equal((await get(RETENTION, a.admin)).json().meta.total, 0)
    assert.equal(ok(await get(SUMMARY, a.admin)).pending, 0)
    const aFinders = (await get(`${FINDERS}?pageSize=100`, a.admin)).json()
    assert.ok(!aFinders.data.some((row: Json) => row.membershipId === bMember.membershipId))
    assertError(await post(ITEMS, a.admin, itemBody({ institutionId: b.id })), 400)
    const aRecipients = ok(await get(`${RECIPIENTS}?studentId=s1`, a.admin))
    assert.equal((aRecipients.guardians as Json[]).length, 1)
    const reportBody = { studentId: 's1', description: 'Mont', lostOn: TODAY, institutionId: b.id }
    assertError(await post(REPORTS, aParent, reportBody), 400)
    assertError(
      await post(ITEMS, a.admin, itemBody({ finderMembershipId: bMember.membershipId })),
      422,
      'lost_item_finder_not_found',
    )
    assertError(
      await post(DISPOSALS, a.admin, {
        itemIds: [bItem.id],
        outcome: 'destroyed',
        reason: 'Bozuk',
      }),
      422,
      'lost_item_not_found',
    )
    assert.equal(ok(await get(SETTINGS, a.admin)).version, 1)
    assertError(
      await versioned('PATCH', SETTINGS, a.admin, { retentionDays: 10, institutionId: b.id }, 1),
      400,
    )
    const [bRow] = await itemRows(b.id)
    assert.equal(bRow?.status, 'pending')
    assert.equal(bRow?.storageLocation, 'Ön büro dolabı')
    assert.equal(bRow?.version, bItem.version)
    const [bStored] = await reportRows(b.id)
    assert.equal(bStored?.status, 'open')
    assert.equal(bStored?.version, bReport.version)
  })
})
