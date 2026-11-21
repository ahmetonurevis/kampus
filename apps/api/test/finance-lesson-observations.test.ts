import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { lessonObservations } from '../src/db/schema/finance-lesson-observations.ts'
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
 * Ders gözlem formu uçları (DOM-FIN-130; ON-206; K-445…K-447). Her test kendi kurumunu kurar.
 * FIXED_NOW 2026-10-06.
 */

const TEMPLATES = '/api/v1/finance/lesson-observation-templates'
const OBSERVATIONS = '/api/v1/finance/lesson-observations'
const levels = [0, 1, 2, 3, 4, 5].map((level) => ({ level, description: `Seviye ${level}` }))
const TEMPLATE = {
  name: 'Ders gözlem formu',
  criteria: [
    { title: 'Sınıf yönetimi', weight: 2, levels },
    { title: 'Öğrenci katılımı', weight: 1, levels },
  ],
}

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-130: ders gözlem formu uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.206.0.1'

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
    clientIp = `10.206.${String((tenantCount += 1))}.1`
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
    return { membershipId: membership.id, user }
  }

  const template = async (t: Tenant) =>
    ok(await call('POST', TEMPLATES, t.admin, TEMPLATE, key()), 201)
  const observe = (cookie: string | null, body: Json, headers: Record<string, string> = key()) =>
    call('POST', OBSERVATIONS, cookie, { observedDate: '2026-10-01', ...body }, headers)
  const patch = (cookie: string | null, row: Json, body: Json) =>
    call('PATCH', `${OBSERVATIONS}/${String(row.id)}`, cookie, body, ifMatch(row.version))
  const complete = (cookie: string | null, row: Json) =>
    call('POST', `${OBSERVATIONS}/${String(row.id)}/complete`, cookie, {}, ifMatch(row.version))
  const archive = (cookie: string | null, row: Json) =>
    call('POST', `${OBSERVATIONS}/${String(row.id)}/archive`, cookie, {}, ifMatch(row.version))
  const rowsOf = (institutionId: string) =>
    db.select().from(lessonObservations).where(eq(lessonObservations.institutionId, institutionId))

  test('kimliksiz istek 401', async () => {
    const row = { id: randomUUID(), version: 1 }
    assertError(await call('GET', TEMPLATES, null), 401)
    assertError(await call('POST', TEMPLATES, null, TEMPLATE, key()), 401)
    assertError(await call('GET', OBSERVATIONS, null), 401)
    assertError(await observe(null, {}), 401)
    assertError(await patch(null, row, { generalNote: 'x' }), 401)
    assertError(await complete(null, row), 401)
  })

  test('DOM-FIN-130 K-445 K-446: form, gözlem, seviyeler; puan sunucuda rubrik kuralıyla; tamamlanınca kilit', async () => {
    const t = await institution()
    const form = await template(t)
    assert.equal(form.versionNumber, 1)
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const headers = key()
    let row = ok(
      await observe(
        t.admin,
        { templateId: form.id, teacherMembershipId: selin.membershipId },
        headers,
      ),
      201,
    )
    const replay = await observe(
      t.admin,
      { templateId: form.id, teacherMembershipId: selin.membershipId },
      headers,
    )
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(row.status, 'draft')
    assert.equal(row.score, null)
    assert.equal(row.teacherName, 'Selin Kaya')

    assertError(
      await call(
        'PATCH',
        `${TEMPLATES}/${String(form.id)}`,
        t.admin,
        { name: 'Yeni' },
        ifMatch(form.version),
      ),
      409,
      'observation_template_used',
    )
    assertError(await complete(t.admin, row), 422, 'observation_unrated')
    assertError(
      await patch(t.admin, row, { ratings: [{ criterionId: 'k1', level: 4 }], score: 100 }),
      400,
    )
    row = ok(
      await patch(t.admin, row, {
        ratings: [
          { criterionId: 'k1', level: 4 },
          { criterionId: 'k2', level: 3 },
        ],
        generalNote: 'Güçlü bir ders',
      }),
    )
    // (4×2 + 3×1) / (5×3) = 11/15 → %73
    assert.deepEqual(row.score, { total: 11, max: 15, percent: 73 })
    row = ok(await complete(t.admin, row))
    assert.equal(row.status, 'completed')
    assertError(await patch(t.admin, row, { generalNote: 'Geç' }), 409, 'observation_completed')
    const [stored] = await rowsOf(t.id)
    assert.equal(stored?.generalNote, 'Güçlü bir ders')
    assert.equal((await rowsOf(t.id)).length, 1)

    const next = ok(
      await call(
        'POST',
        `${TEMPLATES}/${String(form.id)}/versions`,
        t.admin,
        TEMPLATE,
        ifMatch(form.version),
      ),
      201,
    )
    assert.equal(next.versionNumber, 2)
    assert.equal(next.used, false)
    const read = await call('GET', `${OBSERVATIONS}/${String(row.id)}`, t.admin)
    assert.equal((read.json().data as Json).templateVersionNumber, 1)
    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.id),
          eq(auditLog.action, 'finance.lesson_observation.read'),
        ),
      )
    assert.equal(audits.length, 1)
    assert.equal(JSON.stringify(audits[0]?.changes).includes('Güçlü'), false)
  })

  test('DOM-FIN-130 K-447: ön büro 403; öğretmen yalnız kendi gözlemcisi ve tamamlanmış gözlemini görür', async () => {
    const t = await institution()
    const form = await template(t)
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const other = await person(t, 'ogretmen', 'Murat Can')
    const row = ok(
      await observe(t.admin, { templateId: form.id, teacherMembershipId: selin.membershipId }),
      201,
    )
    const frontDesk = await signInAs(app, await createMember(app, t.id, 'onburo'))
    assertError(await call('GET', OBSERVATIONS, frontDesk), 403)
    assertError(await call('GET', TEMPLATES, frontDesk), 403)
    const selinCookie = await signInAs(app, selin.user)
    const otherCookie = await signInAs(app, other.user)
    assertError(
      await observe(selinCookie, { templateId: form.id, teacherMembershipId: other.membershipId }),
      403,
    )
    assertError(await call('GET', `${OBSERVATIONS}/${String(row.id)}`, selinCookie), 404)
    assertError(await call('GET', `${OBSERVATIONS}/${String(row.id)}`, otherCookie), 404)
    const list = (await call('GET', OBSERVATIONS, selinCookie)).json() as {
      meta: { total: number }
    }
    assert.equal(list.meta.total, 0)
  })

  test('DOM-FIN-130: başka kurumun formu ve gözlemi 404 ve değişmez; gövdedeki institutionId 400', async () => {
    const a = await institution()
    const b = await institution()
    const formB = await template(b)
    const selinB = await person(b, 'ogretmen', 'Selin Kaya')
    const rowB = ok(
      await observe(b.admin, { templateId: formB.id, teacherMembershipId: selinB.membershipId }),
      201,
    )
    assertError(await patch(a.admin, rowB, { generalNote: 'x' }), 404)
    assertError(await complete(a.admin, rowB), 404)
    assertError(await archive(a.admin, rowB), 404)
    assertError(await call('GET', `${OBSERVATIONS}/${String(rowB.id)}`, a.admin), 404)
    assertError(
      await observe(a.admin, { templateId: formB.id, teacherMembershipId: selinB.membershipId }),
      422,
      'observation_template_not_found',
    )
    assertError(
      await call('POST', TEMPLATES, a.admin, { ...TEMPLATE, institutionId: b.id }, key()),
      400,
    )
    const formUrl = `${TEMPLATES}/${String(formB.id)}`
    assertError(
      await call('PATCH', formUrl, a.admin, { name: 'Yeni ad' }, ifMatch(formB.version)),
      404,
    )
    assertError(
      await call('POST', `${formUrl}/versions`, a.admin, TEMPLATE, ifMatch(formB.version)),
      404,
    )
    assertError(await call('POST', `${formUrl}/archive`, a.admin, {}, ifMatch(formB.version)), 404)
    const formA = await template(a)
    const selinA = await person(a, 'ogretmen', 'Deniz Kaya')
    assertError(
      await observe(a.admin, {
        templateId: formA.id,
        teacherMembershipId: selinA.membershipId,
        institutionId: b.id,
      }),
      400,
    )
    const forms = (await call('GET', TEMPLATES, a.admin)).json() as { data: Json[] }
    assert.deepEqual(
      forms.data.map((item) => item.id),
      [formA.id],
    )
    const list = (await call('GET', OBSERVATIONS, a.admin)).json() as { meta: { total: number } }
    assert.equal(list.meta.total, 0)
    const [row] = await rowsOf(b.id)
    assert.equal(row?.version, 1)
  })

  test('DOM-FIN-130 K-446: taslak arşivlenir ve listeden kalkar; tamamlanan gözlem arşivlenmez', async () => {
    const t = await institution()
    const form = await template(t)
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const draft = ok(
      await observe(t.admin, { templateId: form.id, teacherMembershipId: selin.membershipId }),
      201,
    )
    assertError(await archive(t.admin, { ...draft, version: 9 }), 409)
    const archived = ok(await archive(t.admin, draft))
    assert.equal(archived.id, draft.id)
    assertError(await call('GET', `${OBSERVATIONS}/${String(draft.id)}`, t.admin), 404)
    assertError(await patch(t.admin, { ...draft, version: 2 }, { generalNote: 'x' }), 404)
    const list = (await call('GET', OBSERVATIONS, t.admin)).json() as { meta: { total: number } }
    assert.equal(list.meta.total, 0)

    let done = ok(
      await observe(t.admin, { templateId: form.id, teacherMembershipId: selin.membershipId }),
      201,
    )
    done = ok(
      await patch(t.admin, done, {
        ratings: [
          { criterionId: 'k1', level: 3 },
          { criterionId: 'k2', level: 5 },
        ],
        generalNote: 'Hedef seviyede',
      }),
    )
    done = ok(await complete(t.admin, done))
    assertError(await archive(t.admin, done), 409, 'observation_completed')
    const frontDesk = await signInAs(app, await createMember(app, t.id, 'onburo'))
    assertError(await archive(frontDesk, done), 403)
    const rows = await rowsOf(t.id)
    assert.equal(rows.filter((row) => row.archivedAt !== null).length, 1)
    assert.equal(rows.find((row) => row.id === done.id)?.archivedAt, null)
  })

  test('DOM-FIN-130: finance modülü kapalıyken 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await call('GET', OBSERVATIONS, closed.admin), 403, 'module_disabled')
    assertError(
      await call('POST', TEMPLATES, closed.admin, TEMPLATE, key()),
      403,
      'module_disabled',
    )
  })
})
