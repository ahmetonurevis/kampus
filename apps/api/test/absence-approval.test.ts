import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { findRecord, insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { files } from '../src/db/schema/files.ts'
import { recordFileCheck } from '../src/services/files.ts'
import type { MembershipLinkInput } from '../src/services/identity.ts'
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
import { multipart, PDF, png, tempStorage, uploadParts } from './support/files-sample.ts'

/**
 * İzin/mazeret bildiriminde özür belgesi ve idare onayı (OG-044; IST-072, DOM-ILT-053). Her test
 * kendi kurumunu örnek veri kesitiyle kurar: 7-A (c1, ortaokul). Deniz (s1) ve s25 7-A'dadır;
 * 7-A'nın sınıf rehber öğretmeni t1, Türkçe öğretmeni t2. FIXED_NOW 2026-10-06 salıdır.
 */

const SEED = createSeed(FIXED_NOW)
const CLASS_IDS = ['c1']
const STUDENT_IDS = new Set(
  SEED.students.filter((item) => CLASS_IDS.includes(item.classId)).map((item) => item.id),
)
const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  subjects: SEED.subjects,
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASS_IDS.includes(item.id)),
  students: SEED.students.filter((item) => STUDENT_IDS.has(item.id)),
  assignments: SEED.assignments.filter((item) => CLASS_IDS.includes(item.classId)),
}

function rows(sample: Partial<Record<CollectionName, readonly Record<string, unknown>[]>>) {
  return Object.entries(sample).flatMap(([collection, items]) =>
    (items ?? []).map((data) => {
      const name = collection as CollectionName
      const id = recordKey(name, data)
      if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
      return { collection: name, id, data }
    }),
  )
}

const ABSENCE = {
  studentId: 's1',
  startDate: '2026-10-08',
  endDate: '2026-10-09',
  reasonCategory: 'health',
}
const REASON = 'Belge tarihi devamsızlık günlerini kapsamıyor.'

type Json = Record<string, unknown>

describe('izin/mazeret belgesi ve idare onayı', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-abs-${String(++serial).padStart(5, '0')}` })

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

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(db, created.id, rows(SAMPLE), FIXED_NOW)
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }
  async function member(institutionId: string, role: Role, links: MembershipLinkInput[] = []) {
    const user = await createMember(app, institutionId, role, links)
    return { ...user, cookie: await signInAs(app, user) }
  }
  const parent = async (institutionId: string, studentId = 's1') =>
    (await member(institutionId, 'veli', [{ kind: 'child', recordId: studentId }])).cookie
  const teacher = async (institutionId: string, teacherId: string) =>
    (await member(institutionId, 'ogretmen', [{ kind: 'teacher', recordId: teacherId }])).cookie
  const student = async (institutionId: string, studentId = 's1') =>
    (await member(institutionId, 'ogrenci', [{ kind: 'student', recordId: studentId }])).cookie

  function send(
    url: string,
    cookie: string | null,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method: 'POST',
      url,
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        ...(cookie === null ? {} : { cookie }),
        ...headers,
      },
      payload: JSON.stringify(body),
    })
  }
  const read = (cookie: string, url: string) =>
    app.inject({ method: 'GET', url, headers: { origin: TEST_ORIGIN, cookie } })
  const ifMatch = (version: number) => ({ 'if-match': `"${String(version)}"` })
  const notify = (cookie: string, body: unknown = ABSENCE) =>
    send('/api/v1/absences', cookie, body, key())
  const approve = (cookie: string | null, id: string, version: number | null, body: unknown = {}) =>
    send(`/api/v1/absences/${id}/approve`, cookie, body, version === null ? {} : ifMatch(version))
  const reject = (
    cookie: string | null,
    id: string,
    version: number | null,
    body: unknown = { reason: REASON },
  ) => send(`/api/v1/absences/${id}/reject`, cookie, body, version === null ? {} : ifMatch(version))
  const attach = (cookie: string | null, id: string, version: number | null, fileIds: string[]) =>
    send(
      `/api/v1/absences/${id}/documents`,
      cookie,
      { fileIds },
      version === null ? {} : ifMatch(version),
    )

  function assertError(
    response: Awaited<ReturnType<typeof send>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const snapshot = async (institutionId: string) =>
    JSON.stringify(
      (await loadRecords(db, institutionId, ['absences'])).map((row) => [
        row.id,
        row.version,
        row.data,
      ]),
    )
  const fileRows = (institutionId: string) =>
    db
      .select()
      .from(files)
      .where(eq(files.institutionId, institutionId))
      .then((list) =>
        JSON.stringify(
          list
            .map((row) => ({ id: row.id, attachedId: row.attachedId, version: row.version }))
            .sort((x, y) => x.id.localeCompare(y.id)),
        ),
      )

  /** Belge yükler; `ready` ise taramadan geçmiş gibi işaretler (test uygulamasında tarayıcı `off`). */
  async function upload(
    institutionId: string,
    cookie: string,
    options: { purpose?: string; ready?: boolean; image?: boolean } = {},
  ) {
    const purpose = options.purpose ?? 'absence_document'
    const parts = options.image
      ? uploadParts(purpose, png(), 'Deniz Yılmaz rapor.png', 'image/png')
      : uploadParts(purpose, PDF, 'Deniz Yılmaz sağlık raporu.pdf')
    const body = multipart(parts)
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: { origin: TEST_ORIGIN, cookie, 'content-type': body.contentType, ...key() },
      payload: body.payload,
    })
    assert.equal(response.statusCode, 201, response.body)
    const id: string = response.json().data.id
    if (options.ready !== false)
      await recordFileCheck(db, store.storage, {
        institutionId,
        fileId: id,
        outcome: 'ready',
        now: FIXED_NOW,
        log: app.log,
      })
    return id
  }
  async function notified(cookie: string, body: unknown = ABSENCE) {
    const response = await notify(cookie, body)
    assert.equal(response.statusCode, 201, response.body)
    const data = response.json().data
    return { id: data.entity.id as string, version: data.records[0].version as number }
  }
  const notifications = async (institutionId: string) =>
    (await loadRecords(db, institutionId, ['notifications'])).map((row) => row.data as Json)

  test('DOM-ILT-053, IST-072: oturumsuz belge ekleme, onay ve red 401', async () => {
    assertError(await approve(null, 'absence-x', 1), 401)
    assertError(await reject(null, 'absence-x', 1), 401)
    assertError(await attach(null, 'absence-x', 1, ['f1']), 401)
  })

  test('DOM-ILT-053, IST-072: veli belgeli bildirim yapar; belge aynı işlemde bağlanır, kayda yalnız kimlik girer', async () => {
    const a = await institution()
    const cookie = await parent(a.id)
    const pdf = await upload(a.id, cookie)
    const image = await upload(a.id, cookie, { image: true })
    const { id } = await notified(cookie, { ...ABSENCE, fileIds: [pdf, image] })
    const record = await findRecord(db, a.id, 'absences', id)
    assert.deepEqual(record?.data.fileIds, [pdf, image])
    assert.equal(record?.data.approvalStatus, 'pending')
    assert.equal(JSON.stringify(record?.data).includes('rapor'), false)
    const linked = await db.select().from(files).where(eq(files.institutionId, a.id))
    for (const row of linked) {
      assert.equal(row.attachedType, 'absence')
      assert.equal(row.attachedId, id)
      assert.equal(row.dataSubjectId, 's1')
    }
  })

  test('DOM-ILT-053: belgeyi veli, öğrenci, yönetici ve sınıf rehber öğretmeni açar; her bağlantı denetimde', async () => {
    const a = await institution()
    const cookie = await parent(a.id)
    const pdf = await upload(a.id, cookie)
    await notified(cookie, { ...ABSENCE, fileIds: [pdf] })
    const url = `/api/v1/files/${pdf}/url`
    for (const reader of [cookie, a.adminCookie, await teacher(a.id, 't1'), await student(a.id)])
      assertError(await read(reader, url), 200)
    // Branş öğretmeni, ön büro, başka velinin hesabı ve başka kurum okuyamaz.
    const b = await institution()
    for (const outsider of [
      await teacher(a.id, 't2'),
      (await member(a.id, 'onburo')).cookie,
      await parent(a.id, 's25'),
      b.adminCookie,
    ])
      assertError(await read(outsider, url), 404)
    const access = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'file.access')))
    assert.equal(access.length, 4)
  })

  test('DOM-ILT-053: belge hataları 422/409; bildirim açılmaz, dosya bağlanmaz', async () => {
    const a = await institution()
    const cookie = await parent(a.id)
    const own = await Promise.all([1, 2, 3, 4].map(() => upload(a.id, cookie)))
    const others = await upload(a.id, await parent(a.id, 's25'))
    const pending = await upload(a.id, cookie, { ready: false })
    const before = await snapshot(a.id)
    const filesBefore = await fileRows(a.id)
    const cases: [string[], number, string][] = [
      [own, 422, 'absence_document_limit'],
      [[others], 422, 'absence_document_unavailable'],
      [[pending], 422, 'file_not_ready'],
    ]
    for (const [fileIds, status, code] of cases)
      assertError(await notify(cookie, { ...ABSENCE, fileIds }), status, code)
    assert.equal(await snapshot(a.id), before)
    assert.equal(await fileRows(a.id), filesBefore)
    // Başka bildirime bağlı belge ikinci bildirime bağlanmaz.
    await notified(cookie, { ...ABSENCE, fileIds: [own[0]!] })
    const afterFirst = await snapshot(a.id)
    assertError(
      await notify(cookie, {
        ...ABSENCE,
        startDate: '2026-10-20',
        endDate: '2026-10-20',
        fileIds: [own[0]!],
      }),
      409,
      'file_already_attached',
    )
    assert.equal(await snapshot(a.id), afterFirst)
  })

  test('DOM-ILT-053: özür belgesini yalnız veli yükler; öğrenci ve öğretmen 403', async () => {
    const a = await institution()
    for (const cookie of [await student(a.id), await teacher(a.id, 't1'), a.adminCookie]) {
      const body = multipart(uploadParts('absence_document', PDF, 'rapor.pdf'))
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/files',
        headers: { origin: TEST_ORIGIN, cookie, 'content-type': body.contentType, ...key() },
        payload: body.payload,
      })
      assert.equal(response.statusCode, 403, response.body)
    }
  })

  test('DOM-ILT-053: veli belgeyi sonradan ekler; If-Match zorunlu, başka kurum 404, karar sonrası 409', async () => {
    const a = await institution()
    const cookie = await parent(a.id)
    const { id, version } = await notified(cookie)
    const first = await upload(a.id, cookie)
    assertError(await attach(cookie, id, null, [first]), 400, 'if_match_required')
    assertError(await attach(cookie, id, version + 5, [first]), 409, 'version_conflict')
    const response = await attach(cookie, id, version, [first])
    assert.equal(response.statusCode, 200, response.body)
    const next = response.json().data.records[0].version as number
    const record = await findRecord(db, a.id, 'absences', id)
    assert.deepEqual(record?.data.fileIds, [first])
    // Başka velinin hesabı ve başka kurum bildirimi bulamaz; yönetici belge eklemez.
    const second = await upload(a.id, cookie)
    assertError(await attach(await parent(a.id, 's25'), id, next, [second]), 404)
    const b = await institution()
    assertError(await attach(await parent(b.id), id, next, [second]), 404)
    assertError(await attach(a.adminCookie, id, next, [second]), 403, 'forbidden')
    assertError(await attach(cookie, id, next, []), 400, 'validation_failed')
    assert.equal((await approve(a.adminCookie, id, next)).statusCode, 200)
    const decided = (await findRecord(db, a.id, 'absences', id))?.version ?? 0
    assertError(await attach(cookie, id, decided, [second]), 409, 'absence_already_decided')
  })

  test('DOM-ILT-053: belge süresi dolan bildirime belge eklenemez; 422 absence_document_late, kayıt ve dosya değişmez', async () => {
    const a = await institution()
    const cookie = await parent(a.id)
    // Bitiş 2026-09-25 cuma: ortaokulda 3 iş günü 30 Eylül'de bitti, bugün 6 Ekim.
    await insertMissingRecords(
      db,
      a.id,
      [
        {
          collection: 'absences',
          id: 'absence-late',
          data: {
            id: 'absence-late',
            studentId: 's1',
            startDate: '2026-09-24',
            endDate: '2026-09-25',
            reasonCategory: 'health',
            category: 'Sağlık',
            status: 'Onay bekliyor',
            approvalStatus: 'pending',
            fileIds: [],
            date: '2026-09-26T09:00:00.000Z',
            createdAt: '2026-09-26T09:00:00.000Z',
          },
        },
      ],
      FIXED_NOW,
    )
    const version = (await findRecord(db, a.id, 'absences', 'absence-late'))?.version ?? 0
    const fileId = await upload(a.id, cookie)
    const before = await snapshot(a.id)
    const filesBefore = await fileRows(a.id)
    const response = await attach(cookie, 'absence-late', version, [fileId])
    assertError(response, 422, 'absence_document_late')
    assert.equal(await snapshot(a.id), before)
    assert.equal(await fileRows(a.id), filesBefore)
  })

  test('DOM-ILT-053: aynı belge bildirime ikinci kez eklenemez; 409 absence_document_duplicate, kayıt değişmez', async () => {
    const a = await institution()
    const cookie = await parent(a.id)
    const { id, version } = await notified(cookie)
    const first = await upload(a.id, cookie)
    const added = await attach(cookie, id, version, [first])
    assert.equal(added.statusCode, 200, added.body)
    const next = added.json().data.records[0].version as number
    const before = await snapshot(a.id)
    const filesBefore = await fileRows(a.id)
    assertError(await attach(cookie, id, next, [first]), 409, 'absence_document_duplicate')
    assert.equal(await snapshot(a.id), before)
    assert.equal(await fileRows(a.id), filesBefore)
    assert.deepEqual((await findRecord(db, a.id, 'absences', id))?.data.fileIds, [first])
  })

  test('DOM-ILT-053: yönetici onaylar; kalıcı, denetim kaydında, veliye sonuçsuz bildirim gider', async () => {
    const a = await institution()
    const cookie = await parent(a.id)
    const { id, version } = await notified(cookie)
    const response = await approve(a.adminCookie, id, version, { institutionId: 'x' })
    assertError(response, 400, 'validation_failed')
    const ok = await approve(a.adminCookie, id, version)
    assert.equal(ok.statusCode, 200, ok.body)
    const record = await findRecord(db, a.id, 'absences', id)
    assert.equal(record?.data.approvalStatus, 'approved')
    assert.equal(record?.data.status, 'Onaylandı')
    assert.equal(record?.data.decidedAt, FIXED_NOW.toISOString())
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'absence.approve')))
    assert.equal(audit.length, 1)
    assert.equal(audit[0]?.entityId, id)
    const sent = (await notifications(a.id)).filter((n) => n.kind === 'absence_decided')
    assert.equal(sent.length, 1)
    assert.equal(JSON.stringify(sent).includes('approved'), false)
    // Veli durumu okur; kararı veren kişi veliye dönmez, yöneticiye döner.
    const own = await read(cookie, `/api/v1/collections/absences/${id}`)
    assert.equal(own.statusCode, 200, own.body)
    assert.equal(own.json().data.record.approvalStatus, 'approved')
    assert.equal('decidedBy' in own.json().data.record, false)
    const staff = await read(a.adminCookie, `/api/v1/collections/absences/${id}`)
    assert.equal(staff.json().data.record.decidedBy.role, 'yonetici')
  })

  test('DOM-ILT-053: mükerrer onay ve onay sonrası red 409; kayıt değişmez', async () => {
    const a = await institution()
    const { id, version } = await notified(await parent(a.id))
    assert.equal((await approve(a.adminCookie, id, version)).statusCode, 200)
    const current = (await findRecord(db, a.id, 'absences', id))?.version ?? 0
    const before = await snapshot(a.id)
    assertError(await approve(a.adminCookie, id, current), 409, 'absence_already_decided')
    assertError(await reject(a.adminCookie, id, current), 409, 'absence_already_decided')
    assertError(await approve(a.adminCookie, id, version), 409, 'version_conflict')
    assert.equal(await snapshot(a.id), before)
  })

  test('DOM-ILT-053: yönetici gerekçeyle reddeder; gerekçe yalnız audit_log.reason, kayıt ve bildirimde yok', async () => {
    const a = await institution()
    const { id, version } = await notified(await parent(a.id))
    const before = await snapshot(a.id)
    for (const body of [{}, { reason: 'x' }, { reason: 'y'.repeat(501) }])
      assertError(await reject(a.adminCookie, id, version, body), 400, 'validation_failed')
    assertError(await reject(a.adminCookie, id, null), 400, 'if_match_required')
    assert.equal(await snapshot(a.id), before)
    const ok = await reject(a.adminCookie, id, version)
    assert.equal(ok.statusCode, 200, ok.body)
    const record = await findRecord(db, a.id, 'absences', id)
    assert.equal(record?.data.approvalStatus, 'rejected')
    assert.equal(JSON.stringify(record?.data).includes(REASON), false)
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'absence.reject')))
    assert.equal(audit.length, 1)
    assert.equal(audit[0]?.reason, REASON)
    const sent = await notifications(a.id)
    assert.equal(
      sent.some((n) => n.kind === 'absence_decided'),
      true,
    )
    assert.equal(JSON.stringify(sent).includes(REASON), false)
  })

  test('DOM-ILT-053: kararı rehber öğretmen, veli ve öğrenci veremez (403); başka kurum 404 ve değişmez', async () => {
    const a = await institution()
    const { id, version } = await notified(await parent(a.id))
    const before = await snapshot(a.id)
    for (const cookie of [
      await teacher(a.id, 't1'),
      await parent(a.id),
      await student(a.id),
      (await member(a.id, 'onburo')).cookie,
    ]) {
      assertError(await approve(cookie, id, version), 403, 'forbidden')
      assertError(await reject(cookie, id, version), 403, 'forbidden')
    }
    const b = await institution()
    assertError(await approve(b.adminCookie, id, version), 404)
    assertError(await reject(b.adminCookie, id, version), 404)
    assertError(await approve(a.adminCookie, 'absence-yok', 1), 404)
    assert.equal(await snapshot(a.id), before)
  })

  test('DOM-YTK-040: akademik modül kapalıyken onay, red ve belge ekleme 403', async () => {
    const a = await institution({ enabledModules: { academic: false, communication: true } })
    const cookie = await parent(a.id)
    assertError(await approve(a.adminCookie, 'absence-x', 1), 403, 'module_disabled')
    assertError(await reject(a.adminCookie, 'absence-x', 1), 403, 'module_disabled')
    assertError(await attach(cookie, 'absence-x', 1, ['f1']), 403, 'module_disabled')
  })
})
