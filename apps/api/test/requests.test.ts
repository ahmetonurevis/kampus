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

/**
 * Talep ve izin/mazeret uçları (docs/domain/iletisim-ve-veli.md DOM-ILT-053, DOM-ILT-080). Her
 * test kendi kurumunu örnek veri kesitiyle kurar: 7-A (c1, ortaokul) ve 9-A (c5, lise). Deniz
 * (s1) ve s25 7-A'da, s5 9-A'dadır. FIXED_NOW 2026-10-06 salıdır.
 */

const SEED = createSeed(FIXED_NOW)
const CLASS_IDS = ['c1', 'c5']
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

const REQUEST = {
  studentId: 's1',
  category: 'Şikayet',
  title: 'Servis gecikmesi',
  text: 'Sabah servisi bu hafta iki kez 20 dakika gecikti.',
}
const ABSENCE = {
  studentId: 's1',
  startDate: '2026-10-08',
  endDate: '2026-10-09',
  reasonCategory: 'health',
}
const HEALTH_DETAIL = 'Diş tedavisi, antibiyotik kullanıyor.'

describe('talep ve izin/mazeret uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-req-${String(++serial).padStart(5, '0')}` })

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
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
  const frontOffice = async (institutionId: string) =>
    (await member(institutionId, 'onburo')).cookie
  const teacher = async (institutionId: string, teacherId: string) =>
    (await member(institutionId, 'ogretmen', [{ kind: 'teacher', recordId: teacherId }])).cookie

  function send(
    method: 'POST' | 'PATCH',
    url: string,
    cookie: string | null,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
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
  const open = (
    cookie: string | null,
    body: unknown = REQUEST,
    headers: Record<string, string> = key(),
  ) => send('POST', '/api/v1/requests', cookie, body, headers)
  const notify = (
    cookie: string | null,
    body: unknown = ABSENCE,
    headers: Record<string, string> = key(),
  ) => send('POST', '/api/v1/absences', cookie, body, headers)
  const patch = (
    cookie: string | null,
    id: string,
    body: unknown,
    version: number | null,
    headers: Record<string, string> = {},
  ) =>
    send('PATCH', `/api/v1/requests/${id}`, cookie, body, {
      ...(version === null ? {} : { 'if-match': `"${String(version)}"` }),
      ...headers,
    })

  function assertError(
    response: Awaited<ReturnType<typeof send>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  async function stored(institutionId: string, collection: 'requests' | 'absences') {
    return loadRecords(db, institutionId, [collection])
  }
  async function opened(institutionId: string, cookie: string) {
    const response = await open(cookie)
    assert.equal(response.statusCode, 201, response.body)
    const data = response.json().data
    return { id: data.entity.id as string, version: data.records[0].version as number }
  }

  // --- Talep ---------------------------------------------------------------------------------

  test('DOM-ILT-080: oturumsuz istek 401', async () => {
    assertError(await open(null), 401)
    assertError(await notify(null), 401)
    assertError(await patch(null, 'req1', { status: 'Çözüldü' }, 1), 401)
  })

  test('DOM-ILT-080: veli kendi çocuğu için talep açar; 201, Location, denetim kaydı, gövdedeki kurum etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const cookie = await parent(a.id)
    const response = await open(cookie, { ...REQUEST, institutionId: b.id })
    assert.equal(response.statusCode, 201, response.body)
    const id: string = response.json().data.entity.id
    assert.equal(response.headers.location, `/api/v1/collections/requests/${id}`)
    const record = await findRecord(db, a.id, 'requests', id)
    assert.equal(record?.data.status, 'Yeni')
    assert.equal(record?.data.assignedTo, 'Ön büro')
    assert.equal(record?.data.date, FIXED_NOW.toISOString())
    assert.equal('institutionId' in (record?.data ?? {}), false)
    assert.equal((await stored(b.id, 'requests')).length, 0)
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'request.open')))
    assert.equal(audit.length, 1)
    // Talep metni denetim kaydına girmez (yalnız alan adları).
    assert.equal(JSON.stringify(audit).includes(REQUEST.text), false)
    // Veli kendi talebini okur.
    const own = await read(cookie, `/api/v1/collections/requests/${id}`)
    assert.equal(own.statusCode, 200, own.body)
  })

  test('DOM-ILT-080: aynı Idempotency-Key ilk yanıtı tekrarlar; anahtarsız istek 400, If-Match 400', async () => {
    const a = await institution()
    const cookie = await parent(a.id)
    const headers = key()
    const first = await open(cookie, REQUEST, headers)
    const again = await open(cookie, REQUEST, headers)
    assert.equal(again.statusCode, 201)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assert.deepEqual(again.json(), first.json())
    assert.equal((await stored(a.id, 'requests')).length, 1)
    assertError(await open(cookie, REQUEST, {}), 400, 'idempotency_key_required')
    assertError(
      await open(cookie, REQUEST, { ...key(), 'if-match': '"1"' }),
      400,
      'if_match_not_supported',
    )
    assert.equal((await stored(a.id, 'requests')).length, 1)
  })

  test('DOM-YTK-025: başka velinin çocuğu ve başka kurumun öğrencisi 403; geçersiz gövde 400; kayıt değişmez', async () => {
    const a = await institution()
    const cookie = await parent(a.id)
    assertError(await open(cookie, { ...REQUEST, studentId: 's25' }), 403, 'student_scope_denied')
    assertError(
      await open(cookie, { ...REQUEST, studentId: 's-baska-kurum' }),
      403,
      'student_scope_denied',
    )
    const invalid = await open(cookie, { ...REQUEST, category: 'Övgü', title: '' })
    assertError(invalid, 400, 'validation_failed')
    assert.ok(Array.isArray(invalid.json().issues))
    assert.equal((await stored(a.id, 'requests')).length, 0)
  })

  test('DOM-YTK-001: talebi öğretmen, öğrenci, ön büro açamaz; veli ve öğretmen güncelleyemez', async () => {
    const a = await institution()
    const { id, version } = await opened(a.id, await parent(a.id))
    for (const cookie of [
      await teacher(a.id, 't1'),
      (await member(a.id, 'ogrenci', [{ kind: 'student', recordId: 's1' }])).cookie,
      await frontOffice(a.id),
    ])
      assertError(await open(cookie), 403, 'forbidden')
    for (const cookie of [await parent(a.id), await teacher(a.id, 't1')])
      assertError(await patch(cookie, id, { status: 'Çözüldü' }, version), 403, 'forbidden')
    const record = await findRecord(db, a.id, 'requests', id)
    assert.equal(record?.data.status, 'Yeni')
    assert.equal((await stored(a.id, 'requests')).length, 1)
  })

  test('DOM-YTK-040: iletişim modülü kapalıyken talep uçları 403 module_disabled', async () => {
    const a = await institution({ enabledModules: { communication: false } })
    assertError(await open(await parent(a.id)), 403, 'module_disabled')
    assertError(
      await patch(await frontOffice(a.id), 'req-yok', { status: 'Çözüldü' }, 1),
      403,
      'module_disabled',
    )
    assert.equal((await stored(a.id, 'requests')).length, 0)
  })

  test('DOM-ILT-080: ön büro If-Match ile durum, birim ve yanıtı yazar; veli yanıtı görür', async () => {
    const a = await institution()
    const parentCookie = await parent(a.id)
    const { id, version } = await opened(a.id, parentCookie)
    const front = await frontOffice(a.id)
    const body = {
      status: 'İnceleniyor',
      assignedTo: 'Finans birimi',
      reply: 'Servis firmasına iletildi.',
    }
    assertError(await patch(front, id, body, null), 400, 'if_match_required')
    assertError(await patch(front, id, body, version + 1), 409, 'version_conflict')
    const updated = await patch(front, id, body, version)
    assert.equal(updated.statusCode, 200, updated.body)
    const next: number = updated.json().data.records[0].version
    assert.equal(next, version + 1)
    const seen = await read(parentCookie, `/api/v1/collections/requests/${id}`)
    const record = seen.json().data.record
    assert.equal(record.status, 'İnceleniyor')
    assert.equal(record.assignedTo, 'Finans birimi')
    assert.equal(record.replies.length, 1)
    assert.equal(record.replies[0].text, 'Servis firmasına iletildi.')
    assert.equal(record.replies[0].by.role, 'onburo')
    // Yönetici de yanıtlar; değişiklik yoksa 409, Yeni'ye dönüş 422 (alan yolu `issues`'da).
    assertError(
      await patch(a.adminCookie, id, { status: 'İnceleniyor' }, next),
      409,
      'request_unchanged',
    )
    const back = await patch(a.adminCookie, id, { status: 'Yeni' }, next)
    assertError(back, 422, 'request_status_invalid')
    assert.deepEqual(back.json().issues[0].path, ['status'])
    const resolved = await patch(
      a.adminCookie,
      id,
      { status: 'Çözüldü', reply: 'Güzergâh düzeltildi.' },
      next,
    )
    assert.equal(resolved.statusCode, 200, resolved.body)
    assertError(await patch(front, id, { reply: 'Ek not' }, next + 1), 409, 'request_resolved')
    const final = await findRecord(db, a.id, 'requests', id)
    assert.equal((final?.data.replies as unknown[]).length, 2)
  })

  test('DOM-YTK-011: başka kurumun talebi 404; o talep değişmez; boş gövde 400', async () => {
    const a = await institution()
    const b = await institution()
    const { id, version } = await opened(b.id, await parent(b.id))
    const front = await frontOffice(a.id)
    assertError(await patch(front, id, { status: 'Çözüldü' }, version), 404, 'not_found')
    assertError(await patch(front, 'req-yok', { status: 'Çözüldü' }, 1), 404, 'not_found')
    const bFront = await frontOffice(b.id)
    assertError(await patch(bFront, id, {}, version), 400, 'validation_failed')
    const record = await findRecord(db, b.id, 'requests', id)
    assert.equal(record?.data.status, 'Yeni')
    assert.equal(record?.version, version)
  })

  // --- İzin ve mazeret -------------------------------------------------------------------------

  test('DOM-ILT-053: veli izin bildirir; 201, talep açılmaz, ön büro okuyamaz, sınıf rehber öğretmeni okur', async () => {
    const a = await institution()
    const cookie = await parent(a.id)
    const headers = key()
    const response = await notify(cookie, ABSENCE, headers)
    assert.equal(response.statusCode, 201, response.body)
    const id: string = response.json().data.entity.id
    assert.equal(response.headers.location, `/api/v1/collections/absences/${id}`)
    const again = await notify(cookie, ABSENCE, headers)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    const notices = await stored(a.id, 'absences')
    assert.equal(notices.length, 1)
    assert.equal(notices[0]?.data.status, 'İletildi')
    assert.equal(notices[0]?.data.reasonCategory, 'health')
    assert.equal(notices[0]?.data.category, 'Sağlık nedeniyle')
    assert.equal('reason' in (notices[0]?.data ?? {}), false)
    assert.equal((await stored(a.id, 'requests')).length, 0)
    assertError(await read(await frontOffice(a.id), '/api/v1/collections/absences'), 403)
    // 7-A'nın sınıf rehber öğretmeni Selin Kaya (t1) görür; Türkçe öğretmeni (t2) görmez.
    const homeroom = await read(await teacher(a.id, 't1'), '/api/v1/collections/absences')
    assert.deepEqual(
      homeroom.json().data.map((item: { id: string }) => item.id),
      [id],
    )
    const branch = await read(await teacher(a.id, 't2'), '/api/v1/collections/absences')
    assert.deepEqual(branch.json().data, [])
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'absence.notify')))
    assert.equal(audit.length, 1)
  })

  test('DOM-ILT-053: gerekçe kategorisi zorunlu; serbest açıklama 400 ve kayıt açılmaz', async () => {
    const a = await institution()
    const cookie = await parent(a.id)
    const withoutCategory = { studentId: 's1', startDate: '2026-10-08', endDate: '2026-10-09' }
    for (const body of [
      withoutCategory,
      { ...ABSENCE, reasonCategory: 'Sağlık' },
      { ...ABSENCE, reason: HEALTH_DETAIL },
      { ...ABSENCE, category: 'Sağlık' },
    ]) {
      const response = await notify(cookie, body)
      assertError(response, 400, 'validation_failed')
      assert.equal(response.body.includes(HEALTH_DETAIL), false)
    }
    assert.equal((await stored(a.id, 'absences')).length, 0)
  })

  test('DOM-ILT-053: geçmiş tarih ortaokulda 3, lisede 5 iş günü; geç bildirim 422, örtüşme 409, belge 422', async () => {
    const a = await institution()
    const cookie = await parent(a.id)
    const past = (startDate: string, endDate = startDate, studentId = 's1') => ({
      ...ABSENCE,
      studentId,
      startDate,
      endDate,
    })
    assert.equal((await notify(cookie, past('2026-10-01'))).statusCode, 201)
    const late = await notify(cookie, past('2026-09-30'))
    assertError(late, 422, 'absence_notice_late')
    assert.deepEqual(late.json().issues[0].path, ['endDate'])
    const high = await parent(a.id, 's5')
    assert.equal((await notify(high, past('2026-09-29', '2026-09-29', 's5'))).statusCode, 201)
    assertError(
      await notify(high, past('2026-09-28', '2026-09-28', 's5')),
      422,
      'absence_notice_late',
    )
    assertError(await notify(cookie, past('2026-09-29', '2026-10-01')), 409, 'absence_overlap')
    const files = await notify(cookie, { ...past('2026-10-20'), files: ['rapor.pdf'] })
    assertError(files, 422, 'absence_files_unsupported')
    assert.deepEqual(files.json().issues[0].path, ['files'])
    assertError(await notify(cookie, past('2026-10-21', '2026-10-20')), 400, 'validation_failed')
    assertError(await notify(cookie, { ...ABSENCE, studentId: 's25' }), 403, 'student_scope_denied')
    assertError(await notify(await frontOffice(a.id)), 403, 'forbidden')
    assert.equal((await stored(a.id, 'absences')).length, 2)
  })

  test('DOM-YTK-040: akademik modül kapalıyken bildirim 403; talep açılır', async () => {
    const a = await institution({ enabledModules: { academic: false, communication: true } })
    const cookie = await parent(a.id)
    assertError(await notify(cookie), 403, 'module_disabled')
    assert.equal((await stored(a.id, 'absences')).length, 0)
    assert.equal((await open(cookie)).statusCode, 201)
  })
})
