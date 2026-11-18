import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { courseNameKey } from '@kampus/school-core/lib/courses.ts'
import { groupNameKey } from '@kampus/school-core/lib/language-groups.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { memberships } from '../src/db/schema/auth.ts'
import { courses } from '../src/db/schema/courses.ts'
import { files } from '../src/db/schema/files.ts'
import { teacherWorkPermits } from '../src/db/schema/finance-work-permits.ts'
import { languageGroups } from '../src/db/schema/language-groups.ts'
import { recordFileCheck } from '../src/services/files.ts'
import { ensureMember, ensureMembershipLinks } from '../src/services/identity.ts'
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
 * Öğretmen çalışma onayı uçları (DOM-FIN-114; ON-174; K-375…K-377). Her test kendi kurumunu
 * kurar; öğretmenler adlı kullanıcıyla açılır. FIXED_NOW 2026-10-06 (İstanbul günü de aynı).
 */

const URL = '/api/v1/finance/work-permits'
const TEACHERS = '/api/v1/finance/work-permit-teachers'

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>
type Method = 'GET' | 'POST' | 'PATCH'

describe('DOM-FIN-114: öğretmen çalışma onayı uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  let tenantCount = 0
  let clientIp = '10.114.0.1'

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
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.114.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  /** Adlı üyelik (giriş yapmaz). */
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
  const BODY = { permitType: 'initial', branch: 'İngilizce' }
  const create = (cookie: string, body: Json, headers: Record<string, string> = key()) =>
    call('POST', URL, cookie, body, headers)
  const opened = async (t: Tenant, membershipId: string, extra: Json = {}) =>
    ok(await create(t.admin, { ...BODY, membershipId, ...extra }), 201)
  const urlOf = (permit: Json) => `${URL}/${String(permit.id)}`
  const act = (cookie: string, permit: Json, verb: string, body: Json) =>
    call('POST', `${urlOf(permit)}/${verb}`, cookie, body, ifMatch(permit.version))
  const approve = (cookie: string, permit: Json, body: Json = {}) =>
    act(cookie, permit, 'approve', {
      approvalDate: '2026-10-01',
      approvalNumber: 'E-1234',
      ...body,
    })
  /** Başvurulmuş ve onaylanmış kayıt. */
  async function approvedPermit(
    t: Tenant,
    membershipId: string,
    body: Json = {},
    extra: Json = {},
  ) {
    const permit = await opened(t, membershipId, { applicationDate: '2026-09-15', ...extra })
    return ok(await approve(t.admin, permit, body))
  }
  const rowsOf = (institutionId: string) =>
    db.select().from(teacherWorkPermits).where(eq(teacherWorkPermits.institutionId, institutionId))
  const teachersOf = async (cookie: string, query = '') => {
    const response = await get(`${TEACHERS}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as {
      data: Json[]
      meta: { total: number }
      counts: { attention: number; warning: number }
    }
  }
  const listOf = async (cookie: string, query = '') => {
    const response = await get(`${URL}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }
  async function upload(t: Tenant, cookie = t.admin) {
    const body = multipart(uploadParts('document', PDF, 'Çalışma onayı.pdf'))
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      remoteAddress: clientIp,
      headers: { origin: TEST_ORIGIN, cookie, 'content-type': body.contentType, ...key() },
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
    const item = `${URL}/${randomUUID()}`
    assertError(await get(TEACHERS, null), 401)
    assertError(await get(URL, null), 401)
    assertError(await get(item, null), 401)
    assertError(await create('', { ...BODY, membershipId: 'm-1' }), 401)
    assertError(await call('PATCH', item, null, { note: 'x' }, ifMatch(1)), 401)
    for (const verb of ['apply', 'approve', 'reject', 'cancel'])
      assertError(await call('POST', `${item}/${verb}`, null, {}, ifMatch(1)), 401)
  })

  test('DOM-FIN-114: K-377 ön büro, öğretmen, veli ve öğrenci 403; kayıt değişmez', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const permit = await opened(t, selin, { applicationDate: '2026-09-15' })
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(TEACHERS, cookie), 403)
      assertError(await get(URL, cookie), 403)
      assertError(await get(urlOf(permit), cookie), 403)
      assertError(await create(cookie, { ...BODY, membershipId: selin }), 403)
      assertError(await call('PATCH', urlOf(permit), cookie, { note: 'x' }, ifMatch(1)), 403)
      assertError(await approve(cookie, permit), 403)
      assertError(await act(cookie, permit, 'cancel', { reason: 'Yanlış kayıt' }), 403)
    }
    const [row] = await rowsOf(t.id)
    assert.equal(row?.status, 'applied')
    assert.equal(row?.version, 1)
  })

  test('DOM-FIN-114: finance modülü kapalıyken uçlar 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(TEACHERS, closed.admin), 403, 'module_disabled')
    assertError(await get(URL, closed.admin), 403, 'module_disabled')
    assertError(
      await create(closed.admin, { ...BODY, membershipId: 'm-1' }),
      403,
      'module_disabled',
    )
  })

  test('DOM-FIN-114: K-375 açılış, başvuru, onay; varsayılan bitiş eğitim yılı sonu; denetim alan adı', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const preparing = await opened(t, selin, { note: 'Diploma onaylı sureti bekleniyor' })
    assert.equal(preparing.status, 'preparing')
    assert.equal(preparing.state, 'preparing')
    assert.deepEqual(preparing.teacher, { membershipId: selin, name: 'Selin Kaya' })
    assert.equal(preparing.applicationDate, null)

    const applied = ok(await act(t.admin, preparing, 'apply', { applicationDate: '2026-09-15' }))
    assert.equal(applied.status, 'applied')
    assert.equal(applied.applicationDate, '2026-09-15')
    const approved = ok(await approve(t.admin, applied))
    assert.equal(approved.status, 'approved')
    assert.equal(approved.approvalNumber, 'E-1234')
    assert.equal(approved.validUntil, '2027-08-31')
    assert.equal(approved.version, 3)

    const audit = await db
      .select({ action: auditLog.action, changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.entityId, String(preparing.id))))
    const actions = audit.map((row) => row.action).sort()
    assert.deepEqual(actions, ['work_permit.apply', 'work_permit.approve', 'work_permit.create'])
    const text = JSON.stringify(audit)
    assert.equal(text.includes('E-1234'), false)
    assert.equal(text.includes('Diploma'), false)
    assert.ok(text.includes('approvalNumber'))
  })

  test('DOM-FIN-114: K-376 onay bitişi verilebilir, süresiz olabilir; kurumun yıl kaydı varsayılanı belirler', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const fixed = await approvedPermit(t, selin, { validUntil: '2027-06-30' })
    assert.equal(fixed.validUntil, '2027-06-30')
    const ayse = await person(t, 'ogretmen', 'Ayşe Demir')
    const unlimited = await approvedPermit(t, ayse, { validUntil: null })
    assert.equal(unlimited.validUntil, null)
    assert.equal(unlimited.state, 'approved')
    const late = await person(t, 'ogretmen', 'Murat Can')
    const before = await opened(t, late, { applicationDate: '2026-09-15' })
    assertError(
      await approve(t.admin, before, { validUntil: '2026-09-30' }),
      422,
      'work_permit_valid_until_before_approval',
    )
    assertError(
      await approve(t.admin, before, { approvalDate: '2026-09-14' }),
      422,
      'work_permit_decision_before_application',
    )
    assertError(
      await approve(t.admin, before, { approvalDate: '2026-10-07' }),
      422,
      'work_permit_date_in_future',
    )
    const [row] = await db
      .select({ status: teacherWorkPermits.status, version: teacherWorkPermits.version })
      .from(teacherWorkPermits)
      .where(
        and(
          eq(teacherWorkPermits.institutionId, t.id),
          eq(teacherWorkPermits.id, String(before.id)),
        ),
      )
    assert.deepEqual(row, { status: 'applied', version: 1 })
  })

  test('DOM-FIN-114: K-375 açılış kuralları: öğretmen, etkin, tek açık kayıt, önceki onay; 400 ve anahtarsız istek', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const desk = await person(t, 'onburo', 'Ön Büro')
    const passive = await person(t, 'ogretmen', 'Eski Öğretmen')
    await db
      .update(memberships)
      .set({ deactivatedAt: FIXED_NOW })
      .where(eq(memberships.id, passive))
    const fail = async (body: Json, status: number, code?: string) =>
      assertError(await create(t.admin, { ...BODY, ...body }), status, code)
    await fail({ membershipId: 'm-yok' }, 422, 'work_permit_teacher_not_found')
    await fail({ membershipId: desk }, 422, 'work_permit_not_teacher')
    await fail({ membershipId: passive }, 422, 'work_permit_teacher_inactive')
    await fail({ membershipId: selin, permitType: 'renewal' }, 422, 'work_permit_no_prior_approval')
    await fail(
      { membershipId: selin, applicationDate: '2026-10-07' },
      422,
      'work_permit_date_in_future',
    )
    await fail({ membershipId: selin, branch: 'x' }, 400)
    await fail({ membershipId: selin, institutionId: t.id }, 400)
    assertError(
      await create(t.admin, { ...BODY, membershipId: selin }, {}),
      400,
      'idempotency_key_required',
    )
    assert.equal((await rowsOf(t.id)).length, 0)

    await opened(t, selin)
    await fail({ membershipId: selin }, 422, 'work_permit_open_exists')
    assert.equal((await rowsOf(t.id)).length, 1)
  })

  test('DOM-FIN-114: aynı Idempotency-Key ikinci kayıt açmaz', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const headers = key()
    const first = await create(t.admin, { ...BODY, membershipId: selin }, headers)
    const second = await create(t.admin, { ...BODY, membershipId: selin }, headers)
    assert.equal(first.statusCode, 201, first.body)
    assert.equal(second.statusCode, 201, second.body)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal(second.json().data.id, first.json().data.id)
    assert.equal((await rowsOf(t.id)).length, 1)
  })

  test('DOM-FIN-114: K-375 düzeltme, ret ve iptal; sonuçlanmış kayıtta yalnız not ve belge; 409', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const permit = await opened(t, selin, { applicationDate: '2026-09-15' })
    const edited = ok(
      await call('PATCH', urlOf(permit), t.admin, { branch: 'Almanca' }, ifMatch(permit.version)),
    )
    assert.equal(edited.branch, 'Almanca')
    assertError(
      await call('PATCH', urlOf(permit), t.admin, { branch: 'Fransızca' }, ifMatch(permit.version)),
      409,
    )
    assertError(
      await call('PATCH', urlOf(edited), t.admin, { branch: 'Almanca' }, ifMatch(edited.version)),
      422,
      'work_permit_unchanged',
    )
    assertError(
      await act(t.admin, edited, 'apply', { applicationDate: '2026-09-20' }),
      422,
      'work_permit_not_preparing',
    )
    const rejected = ok(
      await act(t.admin, edited, 'reject', {
        decisionDate: '2026-09-30',
        reason: 'Denklik belgesi eksik',
      }),
    )
    assert.equal(rejected.status, 'rejected')
    assert.equal(rejected.rejectionReason, 'Denklik belgesi eksik')
    assertError(
      await call(
        'PATCH',
        urlOf(rejected),
        t.admin,
        { branch: 'Fransızca' },
        ifMatch(rejected.version),
      ),
      422,
      'work_permit_decided',
    )
    const noted = ok(
      await call(
        'PATCH',
        urlOf(rejected),
        t.admin,
        { note: 'Yeniden başvurulacak' },
        ifMatch(rejected.version),
      ),
    )
    assert.equal(noted.note, 'Yeniden başvurulacak')
    assertError(await approve(t.admin, noted), 422, 'work_permit_not_applied')

    // Reddedilen kayıttan sonra yeni ilk başvuru açılır; yanlış kayıt iptal edilir.
    const retry = await opened(t, selin)
    const cancelled = ok(await act(t.admin, retry, 'cancel', { reason: 'Yanlış branş seçildi' }))
    assert.equal(cancelled.id, retry.id)
    assertError(await get(urlOf(retry), t.admin), 404)
    assert.equal((await listOf(t.admin)).meta.total, 1)
    const [row] = (await rowsOf(t.id)).filter((item) => item.id === retry.id)
    assert.equal(row?.cancelReason, 'Yanlış branş seçildi')
    await opened(t, selin)
  })

  test('DOM-FIN-114: onay belgesi bağlanır, yalnız yönetici açar, iptalde bağ kalkar', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const fileId = await upload(t)
    const permit = await approvedPermit(t, selin, { documentFileId: fileId })
    assert.deepEqual(permit.documentFile, {
      id: fileId,
      name: 'Çalışma onayı.pdf',
      byteSize: PDF.length,
    })
    assert.equal((await get(`/api/v1/files/${fileId}/url`, t.admin)).statusCode, 200)
    const desk = await member(t.id, 'onburo')
    assertError(await get(`/api/v1/files/${fileId}/url`, desk), 404)

    const ayse = await person(t, 'ogretmen', 'Ayşe Demir')
    const other = await opened(t, ayse, { applicationDate: '2026-09-15' })
    assertError(
      await call(
        'PATCH',
        urlOf(other),
        t.admin,
        { documentFileId: fileId },
        ifMatch(other.version),
      ),
      409,
      'file_already_attached',
    )
    const replacement = await upload(t)
    const replaced = ok(
      await call(
        'PATCH',
        urlOf(permit),
        t.admin,
        { documentFileId: replacement },
        ifMatch(permit.version),
      ),
    )
    assert.equal(replaced.documentFileId, replacement)
    const attachedOf = async (id: string) =>
      (
        await db
          .select({ attachedId: files.attachedId })
          .from(files)
          .where(and(eq(files.institutionId, t.id), eq(files.id, id)))
      )[0]?.attachedId
    assert.equal(await attachedOf(fileId), null)
    await act(t.admin, replaced, 'cancel', { reason: 'Yanlış öğretmen' })
    assert.equal(await attachedOf(replacement), null)
  })

  test('DOM-FIN-114: K-376 takip listesi: onay yok, geçerli, dolmak üzere, süresi doldu; süzgeç ve sayılar', async () => {
    const t = await institution()
    const missing = await person(t, 'ogretmen', 'Ali Onaysız')
    const valid = await person(t, 'ogretmen', 'Burcu Geçerli')
    const expiring = await person(t, 'ogretmen', 'Cem Yakın')
    const expired = await person(t, 'ogretmen', 'Deniz Geçmiş')
    await person(t, 'onburo', 'Ön Büro Listede Yok')
    const passive = await person(t, 'ogretmen', 'Pasif Öğretmen')
    await db
      .update(memberships)
      .set({ deactivatedAt: FIXED_NOW })
      .where(eq(memberships.id, passive))
    await approvedPermit(t, valid)
    await approvedPermit(t, expiring, { validUntil: '2026-11-05' })
    await approvedPermit(
      t,
      expired,
      { approvalDate: '2025-09-20', validUntil: '2026-08-31' },
      { applicationDate: '2025-09-10' },
    )
    const renewal = await opened(t, expired, {
      permitType: 'renewal',
      applicationDate: '2026-09-25',
    })
    await opened(t, missing)

    const all = await teachersOf(t.admin)
    assert.deepEqual(
      all.data.map((row) => [row.name, row.status, row.daysLeft]),
      [
        ['Ali Onaysız', 'missing', null],
        ['Burcu Geçerli', 'valid', 329],
        ['Cem Yakın', 'expiring', 30],
        ['Deniz Geçmiş', 'expired', -36],
      ],
    )
    assert.deepEqual(all.counts, { attention: 3, warning: 0 })
    const deniz = all.data[3]
    assert.equal((deniz?.openApplication as Json).id, renewal.id)
    assert.equal((deniz?.openApplication as Json).status, 'applied')
    assert.equal((all.data[0]?.openApplication as Json).status, 'preparing')
    assert.equal((await teachersOf(t.admin, '?status=attention')).meta.total, 3)
    assert.deepEqual(
      (await teachersOf(t.admin, '?status=expiring')).data.map((row) => row.name),
      ['Cem Yakın'],
    )
    assert.deepEqual(
      (await teachersOf(t.admin, '?q=burcu')).data.map((row) => row.name),
      ['Burcu Geçerli'],
    )
    const paged = await teachersOf(t.admin, '?page=2&pageSize=3')
    assert.equal(paged.meta.total, 4)
    assert.deepEqual(
      paged.data.map((row) => row.name),
      ['Deniz Geçmiş'],
    )

    // Kayıt listesi: süresi dolan onay `expired`, onaylı süzgeç yalnız süresi geçmemişler.
    assert.equal((await listOf(t.admin, '?state=expired')).meta.total, 1)
    assert.equal((await listOf(t.admin, '?state=approved')).meta.total, 2)
    assert.equal((await listOf(t.admin, `?membershipId=${expired}`)).meta.total, 2)
    assert.equal((await listOf(t.admin, '?q=ingiliz')).meta.total, 5)
  })

  test('DOM-FIN-114: K-376 ders programında ya da dil grubunda görevli onaysız öğretmen uyarısı', async () => {
    const t = await institution()
    const lesson = await person(t, 'ogretmen', 'Ali Dersli')
    const group = await person(t, 'ogretmen', 'Bora Gruplu')
    const far = await person(t, 'ogretmen', 'Can Uzak')
    const approved = await person(t, 'ogretmen', 'Derya Onaylı')
    await ensureMembershipLinks(db, t.id, lesson, [{ kind: 'teacher', recordId: 'wp-t1' }])
    await ensureMembershipLinks(db, t.id, far, [{ kind: 'teacher', recordId: 'wp-t2' }])
    await ensureMembershipLinks(db, t.id, approved, [{ kind: 'teacher', recordId: 'wp-t3' }])
    const lessonOf = (id: string, teacherId: string, date: string, extra: Json = {}) => ({
      collection: 'schedule' as const,
      id,
      data: { id, classId: 'c1', teacherId, date, duration: 40, ...extra },
    })
    await insertMissingRecords(
      db,
      t.id,
      [
        lessonOf('wp-l1', 'wp-t1', '2026-10-08T06:00:00.000Z'),
        // İstanbul günü 6 Ekim 00.30: pencereye girer.
        lessonOf('wp-l2', 'wp-t1', '2026-10-05T21:30:00.000Z'),
        // Pencere dışı (30 gün sonrası) ve iptal edilen ders sayılmaz.
        lessonOf('wp-l3', 'wp-t2', '2026-11-06T06:00:00.000Z'),
        lessonOf('wp-l4', 'wp-t2', '2026-10-08T06:00:00.000Z', {
          cancelledAt: '2026-10-01T09:00:00.000Z',
        }),
        lessonOf('wp-l5', 'wp-t3', '2026-10-08T06:00:00.000Z'),
      ],
      FIXED_NOW,
    )
    const courseId = randomUUID()
    await db.insert(courses).values({
      institutionId: t.id,
      id: courseId,
      name: 'Genel İngilizce B1',
      nameKey: courseNameKey('Genel İngilizce B1'),
      language: 'en',
      level: 'B1',
      totalHours: 120,
      weeklyHours: 6,
      sessionMinutes: 45,
      minLearners: 4,
      maxLearners: 12,
      certified: false,
      status: 'draft',
      eOzelApproval: 'not_submitted',
    })
    const insertGroup = (name: string, teacherMembershipId: string, overrides: Json = {}) =>
      db.insert(languageGroups).values({
        institutionId: t.id,
        id: randomUUID(),
        courseId,
        name,
        nameKey: groupNameKey(name),
        ageBand: 'adult',
        teacherMembershipId,
        delivery: 'online',
        schedule: [{ weekday: 1, startTime: '18:00' }],
        startDate: '2026-09-01',
        endDate: '2026-12-31',
        capacity: 10,
        state: 'open',
        openedAt: FIXED_NOW,
        ...overrides,
      })
    await insertGroup('B1 Akşam', group)
    // Biten ve iptal edilen grup sayılmaz.
    await insertGroup('B1 Eski', far, { endDate: '2026-10-05' })
    await insertGroup('B1 İptal', far, {
      state: 'cancelled',
      openedAt: null,
      cancelledAt: FIXED_NOW,
      cancelReason: 'Yetersiz katılım',
    })
    await approvedPermit(t, approved)

    const list = await teachersOf(t.admin)
    assert.deepEqual(
      list.data.map((row) => [row.name, row.teaching, row.warning]),
      [
        ['Ali Dersli', true, true],
        ['Bora Gruplu', true, true],
        ['Can Uzak', false, false],
        ['Derya Onaylı', true, false],
      ],
    )
    assert.deepEqual(list.counts, { attention: 3, warning: 2 })
    assert.deepEqual(
      (await teachersOf(t.admin, '?warning=true')).data.map((row) => row.name),
      ['Ali Dersli', 'Bora Gruplu'],
    )
  })

  test('DOM-FIN-114: başka kurumun öğretmeni ve kaydı 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bTeacher = await person(b, 'ogretmen', 'B Öğretmeni')
    const bPermit = await opened(b, bTeacher, { applicationDate: '2026-09-15' })
    const bFile = await upload(b)
    const bUrl = urlOf(bPermit)

    assertError(await get(bUrl, a.admin), 404)
    assertError(await call('PATCH', bUrl, a.admin, { note: 'Başka kurum' }, ifMatch(1)), 404)
    assertError(await act(a.admin, bPermit, 'apply', { applicationDate: '2026-09-15' }), 404)
    assertError(await approve(a.admin, bPermit), 404)
    assertError(
      await act(a.admin, bPermit, 'reject', { decisionDate: '2026-09-30', reason: 'Başka kurum' }),
      404,
    )
    assertError(await act(a.admin, bPermit, 'cancel', { reason: 'Başka kurum' }), 404)
    assertError(
      await create(a.admin, { ...BODY, membershipId: bTeacher }),
      422,
      'work_permit_teacher_not_found',
    )
    assertError(
      await create(a.admin, { ...BODY, membershipId: bTeacher, institutionId: b.id }),
      400,
    )
    assertError(await get(`/api/v1/files/${bFile}/url`, a.admin), 404)

    const aTeacher = await person(a, 'ogretmen', 'A Öğretmeni')
    const aPermit = await opened(a, aTeacher, { applicationDate: '2026-09-15' })
    assertError(await approve(a.admin, aPermit, { documentFileId: bFile }), 422, 'file_unavailable')

    assert.deepEqual(
      (await teachersOf(a.admin)).data.map((row) => row.name),
      ['A Öğretmeni'],
    )
    assert.deepEqual(
      (await listOf(a.admin)).data.map((row) => row.id),
      [aPermit.id],
    )
    assert.equal((await listOf(a.admin, `?membershipId=${bTeacher}`)).meta.total, 0)
    const [row] = await rowsOf(b.id)
    assert.equal(row?.status, 'applied')
    assert.equal(row?.version, 1)
    assert.equal(row?.note, null)
  })
})
