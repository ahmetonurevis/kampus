import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { memberships } from '../src/db/schema/auth.ts'
import { costCenters } from '../src/db/schema/finance-budget.ts'
import {
  professionalDevelopmentEnrollments,
  professionalDevelopmentPrograms,
} from '../src/db/schema/finance-professional-development.ts'
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

/**
 * Mesleki gelişim kataloğu uçları (DOM-FIN-125; ON-214; K-430…K-432). Her test kendi kurumunu
 * kurar.
 */

const URL = '/api/v1/finance/professional-development'

type Json = Record<string, unknown>
type Program = Json & { id: string; version: number; status: string }
type Enrollment = Json & { id: string; version: number; status: string }
type Response = Awaited<ReturnType<App['inject']>>
type Method = 'GET' | 'POST' | 'PATCH'

describe('DOM-FIN-125: mesleki gelişim kataloğu uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.214.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
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

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.214.${String((tenantCount += 1))}.1`
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

  const BODY = {
    name: 'Okuma becerisi öğretimi',
    kind: 'seminar',
    provider: 'Öğretmen Akademisi',
    durationHours: 6,
    startDate: '2026-11-10',
    endDate: '2026-11-11',
    location: 'Konferans salonu',
    audienceRoles: ['ogretmen'],
    audienceBranches: ['İngilizce'],
    feeCents: 150_000,
    capacity: 2,
  }
  const create = (cookie: string, body: Json, headers: Record<string, string> = key()) =>
    call('POST', URL, cookie, body, headers)
  const draft = async (t: Tenant, extra: Json = {}) =>
    ok<Program>(await create(t.admin, { ...BODY, ...extra }), 201)
  const urlOf = (program: { id: string }) => `${URL}/${program.id}`
  const setStatus = (cookie: string, program: Program, status: string) =>
    call('POST', `${urlOf(program)}/status`, cookie, { status }, ifMatch(program.version))
  const published = async (t: Tenant, extra: Json = {}) =>
    ok<Program>(await setStatus(t.admin, await draft(t, extra), 'published'))
  const enroll = (
    cookie: string,
    program: { id: string },
    body: Json,
    headers: Record<string, string> = key(),
  ) => call('POST', `${urlOf(program)}/enrollments`, cookie, body, headers)
  const mark = (cookie: string, program: { id: string }, enrollment: Enrollment, body: Json) =>
    call(
      'PATCH',
      `${urlOf(program)}/enrollments/${enrollment.id}`,
      cookie,
      body,
      ifMatch(enrollment.version),
    )
  const programRows = (institutionId: string) =>
    db
      .select()
      .from(professionalDevelopmentPrograms)
      .where(eq(professionalDevelopmentPrograms.institutionId, institutionId))
  const enrollmentRows = (institutionId: string) =>
    db
      .select()
      .from(professionalDevelopmentEnrollments)
      .where(eq(professionalDevelopmentEnrollments.institutionId, institutionId))
  const auditOf = (institutionId: string, action: string) =>
    db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  const listOf = async (cookie: string, url = URL) => {
    const response = await get(url, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }

  test('kimliksiz istek 401', async () => {
    const item = `${URL}/${randomUUID()}`
    assertError(await get(URL, null), 401)
    assertError(await get(item, null), 401)
    assertError(await get(`${item}/enrollments`, null), 401)
    assertError(await create('', BODY), 401)
    assertError(await call('PATCH', item, null, BODY, ifMatch(1)), 401)
    assertError(
      await call('POST', `${item}/status`, null, { status: 'published' }, ifMatch(1)),
      401,
    )
    assertError(await enroll('', { id: randomUUID() }, { membershipId: 'x' }), 401)
    assertError(
      await call(
        'PATCH',
        `${item}/enrollments/${randomUUID()}`,
        null,
        { status: 'not_completed' },
        ifMatch(1),
      ),
      401,
    )
  })

  test('DOM-FIN-125: K-430 ön büro okur, taslağı görmez ve yazamaz; öğretmen, veli, öğrenci 403', async () => {
    const t = await institution()
    const hidden = await draft(t, { name: 'Taslak eğitim' })
    const open = await published(t)
    const teacher = await person(t, 'ogretmen', 'Selin Kaya')
    const front = await member(t.id, 'onburo')

    const list = await listOf(front)
    assert.deepEqual(
      list.data.map((row) => row.id),
      [open.id],
    )
    assertError(await get(urlOf(hidden), front), 404)
    assertError(await get(`${urlOf(hidden)}/enrollments`, front), 404)
    assert.equal(ok<Program>(await get(urlOf(open), front)).id, open.id)
    assert.equal((await listOf(front, `${urlOf(open)}/enrollments`)).meta.total, 0)
    assertError(await create(front, BODY), 403)
    assertError(await setStatus(front, open, 'archived'), 403)
    assertError(await enroll(front, open, { membershipId: teacher }), 403)

    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(URL, cookie), 403)
      assertError(await get(urlOf(open), cookie), 403)
      assertError(await get(`${urlOf(open)}/enrollments`, cookie), 403)
      assertError(await create(cookie, BODY), 403)
      assertError(await enroll(cookie, open, { membershipId: teacher }), 403)
    }
    assert.equal((await programRows(t.id)).length, 2)
    assert.equal((await enrollmentRows(t.id)).length, 0)
  })

  test('DOM-FIN-125: finance modülü kapalıyken uçlar 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(URL, closed.admin), 403, 'module_disabled')
    assertError(await create(closed.admin, BODY), 403, 'module_disabled')
  })

  test('DOM-FIN-125: K-431 taslak, düzeltme, yayın, arşiv; Idempotency-Key; denetimde alan adı', async () => {
    const t = await institution()
    assertError(await create(t.admin, BODY, {}), 400)
    assertError(await create(t.admin, { ...BODY, durationHours: 1.25 }), 400)
    assertError(await create(t.admin, { ...BODY, endDate: '2026-11-01' }), 400)
    assertError(await create(t.admin, { ...BODY, ongoing: true }), 400)
    assertError(await create(t.admin, { ...BODY, location: null }), 400)
    assertError(
      await create(t.admin, { ...BODY, kind: 'online', onlineUrl: 'http://ornek.test' }),
      400,
    )
    assertError(await create(t.admin, { ...BODY, feeCents: null, costCenterId: randomUUID() }), 400)
    assertError(
      await create(t.admin, { ...BODY, costCenterId: randomUUID() }),
      422,
      'professional_development_cost_center_not_found',
    )
    assert.equal((await programRows(t.id)).length, 0)

    const headers = key()
    const program = ok<Program>(await create(t.admin, BODY, headers), 201)
    const replay = await create(t.admin, BODY, headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((await programRows(t.id)).length, 1)
    assert.equal(program.status, 'draft')
    assert.equal(program.durationHours, 6)
    assert.deepEqual(program.audienceRoles, ['ogretmen'])
    assert.equal(program.feeCents, 150_000)
    const [row] = await programRows(t.id)
    assert.equal(row?.durationMinutes, 360)

    const ongoing = ok<Program>(
      await call(
        'PATCH',
        urlOf(program),
        t.admin,
        {
          ...BODY,
          kind: 'online',
          ongoing: true,
          startDate: null,
          endDate: null,
          location: null,
          onlineUrl: 'https://egitim.ornek.test/kurs',
          durationHours: 12.5,
        },
        ifMatch(program.version),
      ),
    )
    assert.equal(ongoing.ongoing, true)
    assert.equal(ongoing.durationHours, 12.5)
    assert.equal(ongoing.startDate, null)
    assertError(await call('PATCH', urlOf(program), t.admin, BODY, ifMatch(program.version)), 409)

    const live = ok<Program>(await setStatus(t.admin, ongoing, 'published'))
    assert.equal(live.status, 'published')
    assertError(
      await setStatus(t.admin, live, 'draft'),
      409,
      'professional_development_status_transition',
    )
    const archived = ok<Program>(await setStatus(t.admin, live, 'archived'))
    assertError(
      await call('PATCH', urlOf(archived), t.admin, BODY, ifMatch(archived.version)),
      409,
      'professional_development_archived',
    )
    assertError(
      await setStatus(t.admin, archived, 'published'),
      409,
      'professional_development_status_transition',
    )

    const [created] = await auditOf(t.id, 'finance.professional_development.create')
    const fields = (created?.changes as { fields: string[] }).fields
    assert.ok(fields.includes('name') && fields.includes('feeCents'))
    assert.equal(JSON.stringify(created?.changes).includes('Okuma'), false)
    assert.equal((await auditOf(t.id, 'finance.professional_development.status')).length, 2)

    const filtered = await listOf(t.admin, `${URL}?status=archived&q=okuma`)
    assert.equal(filtered.meta.total, 1)
  })

  test('DOM-FIN-125: maliyet merkezi kurumun etkin merkezi olmalı (ON-204)', async () => {
    const t = await institution()
    const active = randomUUID()
    const passive = randomUUID()
    await db.insert(costCenters).values([
      { institutionId: t.id, id: active, code: 'EGT', name: 'Eğitim', type: 'unit' },
      {
        institutionId: t.id,
        id: passive,
        code: 'ESK',
        name: 'Eski birim',
        type: 'unit',
        isActive: false,
      },
    ])
    assertError(
      await create(t.admin, { ...BODY, costCenterId: passive }),
      422,
      'professional_development_cost_center_inactive',
    )
    const program = ok<Program>(await create(t.admin, { ...BODY, costCenterId: active }), 201)
    assert.equal(program.costCenterId, active)
  })

  test('DOM-FIN-125: K-432 atama, kontenjan, mükerrer atama, katılım saati', async () => {
    const t = await institution()
    const teacher = await person(t, 'ogretmen', 'Selin Kaya')
    const front = await person(t, 'onburo', 'Ali Ön')
    const third = await person(t, 'yonetici', 'Zeynep Yönetici')
    const parent = await person(t, 'veli', 'Ayşe Yılmaz')
    const left = await person(t, 'ogretmen', 'Ayrılan Öğretmen')
    await db.update(memberships).set({ deactivatedAt: FIXED_NOW }).where(eq(memberships.id, left))

    const notYet = await draft(t)
    assertError(
      await enroll(t.admin, notYet, { membershipId: teacher }),
      422,
      'professional_development_not_published',
    )
    const program = await published(t)
    assertError(await enroll(t.admin, program, { membershipId: teacher }, {}), 400)
    assertError(
      await enroll(t.admin, program, { membershipId: 'yok' }),
      422,
      'professional_development_staff_not_found',
    )
    assertError(
      await enroll(t.admin, program, { membershipId: parent }),
      422,
      'professional_development_not_staff',
    )
    assertError(
      await enroll(t.admin, program, { membershipId: left }),
      422,
      'professional_development_staff_inactive',
    )

    const headers = key()
    const first = ok<Enrollment>(
      await enroll(t.admin, program, { membershipId: teacher, origin: 'request' }, headers),
      201,
    )
    const replay = await enroll(
      t.admin,
      program,
      { membershipId: teacher, origin: 'request' },
      headers,
    )
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(first.status, 'assigned')
    assert.equal(first.origin, 'request')
    assert.equal(first.staffName, 'Selin Kaya')
    assertError(
      await enroll(t.admin, program, { membershipId: teacher }),
      409,
      'professional_development_already_enrolled',
    )
    ok(await enroll(t.admin, program, { membershipId: front }), 201)
    assertError(
      await enroll(t.admin, program, { membershipId: third }),
      422,
      'professional_development_capacity_full',
    )
    assert.equal((await enrollmentRows(t.id)).length, 2)

    const current = ok<Program>(await get(urlOf(program), t.admin))
    assert.equal(current.enrolledCount, 2)
    assertError(
      await call(
        'PATCH',
        urlOf(current),
        t.admin,
        { ...BODY, capacity: 1 },
        ifMatch(current.version),
      ),
      422,
      'professional_development_capacity_below_enrolled',
    )

    assertError(await mark(t.admin, program, first, { status: 'attended' }), 400)
    assertError(
      await mark(t.admin, program, first, { status: 'not_completed', attendedHours: 2 }),
      400,
    )
    assertError(
      await mark(t.admin, program, first, { status: 'attended', attendedHours: 7 }),
      422,
      'professional_development_hours_exceed',
    )
    const attended = ok<Enrollment>(
      await mark(t.admin, program, first, { status: 'attended', attendedHours: 5.5 }),
    )
    assert.equal(attended.status, 'attended')
    assert.equal(attended.attendedHours, 5.5)
    assertError(await mark(t.admin, program, first, { status: 'not_completed' }), 409)
    const [row] = (await enrollmentRows(t.id)).filter((item) => item.id === first.id)
    assert.equal(row?.attendedMinutes, 330)

    const afterMark = ok<Program>(await get(urlOf(program), t.admin))
    assert.equal(afterMark.attendedCount, 1)
    assertError(
      await call(
        'PATCH',
        urlOf(afterMark),
        t.admin,
        { ...BODY, durationHours: 5 },
        ifMatch(afterMark.version),
      ),
      422,
      'professional_development_duration_below_attended',
    )

    const roster = await listOf(t.admin, `${urlOf(program)}/enrollments?status=attended`)
    assert.deepEqual(
      roster.data.map((item) => item.staffName),
      ['Selin Kaya'],
    )
    const archived = ok<Program>(await setStatus(t.admin, afterMark, 'archived'))
    assertError(
      await mark(t.admin, archived, attended, { status: 'not_completed' }),
      409,
      'professional_development_archived',
    )
    assert.deepEqual(
      (await auditOf(t.id, 'finance.professional_development.attendance')).map(
        (item) => item.changes,
      ),
      [{ fields: ['status', 'attendedHours'] }],
    )
  })

  test('DOM-FIN-125: başka kurumun eğitimi ve personeli 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bProgram = await published(b)
    const bTeacher = await person(b, 'ogretmen', 'B Öğretmeni')
    const bEnrollment = ok<Enrollment>(
      await enroll(b.admin, bProgram, { membershipId: bTeacher }),
      201,
    )
    const bUrl = urlOf(bProgram)
    const aTeacher = await person(a, 'ogretmen', 'A Öğretmeni')

    assert.equal((await listOf(a.admin)).meta.total, 0)
    assertError(await get(bUrl, a.admin), 404)
    assertError(await get(`${bUrl}/enrollments`, a.admin), 404)
    assertError(await call('PATCH', bUrl, a.admin, BODY, ifMatch(bProgram.version)), 404)
    assertError(await setStatus(a.admin, bProgram, 'archived'), 404)
    assertError(await enroll(a.admin, bProgram, { membershipId: aTeacher }), 404)
    assertError(await mark(a.admin, bProgram, bEnrollment, { status: 'not_completed' }), 404)

    const aProgram = await published(a)
    assertError(
      await enroll(a.admin, aProgram, { membershipId: bTeacher }),
      422,
      'professional_development_staff_not_found',
    )
    assertError(await mark(a.admin, aProgram, bEnrollment, { status: 'not_completed' }), 404)
    assertError(await create(a.admin, { ...BODY, institutionId: b.id }), 400)

    const [row] = await programRows(b.id)
    assert.equal(row?.status, 'published')
    assert.equal(row?.version, bProgram.version)
    const [enrollmentRow] = await enrollmentRows(b.id)
    assert.equal(enrollmentRow?.status, 'assigned')
    assert.equal((await programRows(a.id)).length, 1)
  })
})
