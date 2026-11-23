import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  selfEvaluationResponses,
  selfEvaluationTemplates,
} from '../src/db/schema/finance-self-evaluations.ts'
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
 * Öz değerlendirme uçları (DOM-FIN-131; ON-210; K-448…K-450). Performans dönemi (DOM-FIN-124)
 * uçlarıyla kurulur; her test kendi kurumunu kurar. FIXED_NOW 2026-10-06.
 */

const PERIODS = '/api/v1/finance/performance-periods'
const TEMPLATES = '/api/v1/finance/self-evaluation-templates'
const RESPONSES = '/api/v1/finance/self-evaluations'
const GOALS = [{ title: 'Okuma becerisi', criterion: 'Sınıf ortalaması B1', weight: 100 }]
const QUESTIONS = [
  { kind: 'scale', text: 'Ders planlarımı zamanında hazırladım', required: true },
  { kind: 'open', text: 'Bu dönemin en güçlü yanınız neydi?', required: true },
  { kind: 'open', text: 'Eklemek istedikleriniz', required: false },
]
const FULL = [{ score: 4 }, { text: 'Veli iletişimi güçlü' }, {}]
const SECRET = 'Gizli-oz-degerlendirme-metni'

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-131: öz değerlendirme uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.210.0.1'

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
    clientIp = `10.210.${String((tenantCount += 1))}.1`
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

  const period = async (t: Tenant) =>
    ok(
      await call(
        'POST',
        PERIODS,
        t.admin,
        { name: '2026 güz dönemi', startDate: '2026-09-01', endDate: '2027-01-31' },
        key(),
      ),
      201,
    )
  const advance = async (t: Tenant, p: Json, statuses: string[]) => {
    let current = p
    for (const status of statuses)
      current = ok(
        await call(
          'POST',
          `${PERIODS}/${String(current.id)}/status`,
          t.admin,
          { status },
          ifMatch(current.version),
        ),
      )
    return current
  }
  const enroll = async (t: Tenant, p: Json, membershipId: string) =>
    ok(
      await call(
        'POST',
        `${PERIODS}/${String(p.id)}/reviews`,
        t.admin,
        { membershipId, goals: GOALS },
        key(),
      ),
      201,
    )
  const overview = (cookie: string | null, p: Json) =>
    call('GET', `${PERIODS}/${String(p.id)}/self-evaluation`, cookie)
  const createTemplate = (
    cookie: string | null,
    p: Json,
    questions: unknown = QUESTIONS,
    headers: Record<string, string> = key(),
  ) =>
    call(
      'POST',
      `${PERIODS}/${String(p.id)}/self-evaluation-template`,
      cookie,
      { questions },
      headers,
    )
  const editTemplate = (cookie: string | null, template: Json, questions: unknown = QUESTIONS) =>
    call(
      'PATCH',
      `${TEMPLATES}/${String(template.id)}`,
      cookie,
      { questions },
      ifMatch(template.version),
    )
  const tracking = (cookie: string | null, p: Json, query = '') =>
    call('GET', `${PERIODS}/${String(p.id)}/self-evaluations${query}`, cookie)
  const respond = (
    cookie: string | null,
    p: Json,
    membershipId: string,
    body: Json = {},
    headers: Record<string, string> = key(),
  ) =>
    call(
      'POST',
      `${PERIODS}/${String(p.id)}/self-evaluations`,
      cookie,
      { membershipId, channel: 'paper', ...body },
      headers,
    )
  const read = (cookie: string | null, response: Json) =>
    call('GET', `${RESPONSES}/${String(response.id)}`, cookie)
  const patch = (cookie: string | null, response: Json, body: Json) =>
    call('PATCH', `${RESPONSES}/${String(response.id)}`, cookie, body, ifMatch(response.version))
  const submit = (cookie: string | null, response: Json) =>
    call(
      'POST',
      `${RESPONSES}/${String(response.id)}/submit`,
      cookie,
      {},
      ifMatch(response.version),
    )
  const reopen = (cookie: string | null, response: Json, reason: unknown) =>
    call(
      'POST',
      `${RESPONSES}/${String(response.id)}/reopen`,
      cookie,
      { reason },
      ifMatch(response.version),
    )
  const rowsOf = (institutionId: string) =>
    db
      .select()
      .from(selfEvaluationResponses)
      .where(eq(selfEvaluationResponses.institutionId, institutionId))
  const auditOf = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  /** Yürürlükte dönem, şablon ve dönemde kayıtlı öğretmen. */
  async function setup(t: Tenant) {
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    let p = await period(t)
    await enroll(t, p, selin)
    const template = ok(await createTemplate(t.admin, p), 201)
    p = await advance(t, p, ['active'])
    return { selin, p, template }
  }

  test('kimliksiz istek 401', async () => {
    const p = { id: randomUUID(), version: 1 }
    assertError(await overview(null, p), 401)
    assertError(await createTemplate(null, p), 401)
    assertError(await editTemplate(null, p), 401)
    assertError(await tracking(null, p), 401)
    assertError(await respond(null, p, 'm-1'), 401)
    assertError(await read(null, p), 401)
    assertError(await patch(null, p, { channel: 'email' }), 401)
    assertError(await submit(null, p), 401)
    assertError(await reopen(null, p, 'Gerekçe metni'), 401)
  })

  test('DOM-FIN-131 K-450: yönetici dışındaki roller 403; yanıt değişmez, okuma denetlenmez', async () => {
    const t = await institution()
    const { selin, p, template } = await setup(t)
    const response = ok(await respond(t.admin, p, selin, { answers: FULL }), 201)
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await overview(cookie, p), 403)
      assertError(await createTemplate(cookie, p), 403)
      assertError(await editTemplate(cookie, template), 403)
      assertError(await tracking(cookie, p), 403)
      assertError(await respond(cookie, p, selin), 403)
      assertError(await read(cookie, response), 403)
      assertError(await patch(cookie, response, { channel: 'email' }), 403)
      assertError(await submit(cookie, response), 403)
      assertError(await reopen(cookie, response, 'Gerekçe metni'), 403)
    }
    const [row] = await rowsOf(t.id)
    assert.equal(row?.version, 1)
    assert.equal(row?.status, 'draft')
    assert.equal((await auditOf(t.id, 'finance.self_evaluation.read')).length, 0)
  })

  test('DOM-FIN-131: finance modülü kapalıyken uçlar 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    const p = { id: randomUUID(), version: 1 }
    assertError(await overview(closed.admin, p), 403, 'module_disabled')
    assertError(await createTemplate(closed.admin, p), 403, 'module_disabled')
    assertError(await tracking(closed.admin, p), 403, 'module_disabled')
    assertError(await respond(closed.admin, p, 'm-1'), 403, 'module_disabled')
    assertError(await read(closed.admin, p), 403, 'module_disabled')
  })

  test('DOM-FIN-131 K-448: şablon idempotent açılır, dönemde tektir; yanıt açılınca kilitlenir', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    let p = await period(t)
    await enroll(t, p, selin)
    const empty = ok(await overview(t.admin, p))
    assert.equal(empty.template, null)
    assert.deepEqual(empty.summary, { enrolled: 1, submitted: 0, draft: 0, missing: 1, rate: 0 })

    assertError(await createTemplate(t.admin, p, []), 400)
    assertError(await createTemplate(t.admin, p, QUESTIONS, {}), 400)
    const headers = key()
    const first = await createTemplate(t.admin, p, QUESTIONS, headers)
    const replay = await createTemplate(t.admin, p, QUESTIONS, headers)
    assert.equal(first.statusCode, 201, first.body)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    let template = first.json().data as Json
    assert.equal(template.locked, false)
    assertError(await createTemplate(t.admin, p), 409, 'self_evaluation_template_exists')
    template = ok(await editTemplate(t.admin, template, QUESTIONS.slice(0, 2)))
    assert.equal((template.questions as Json[]).length, 2)
    assertError(await editTemplate(t.admin, { ...template, version: 1 }), 409)

    // Planlamada yanıt yazılmaz (K-449).
    assertError(await respond(t.admin, p, selin), 422, 'self_evaluation_not_open')
    p = await advance(t, p, ['active'])
    ok(await respond(t.admin, p, selin), 201)
    const locked = ok(await overview(t.admin, p)).template as Json
    assert.equal(locked.locked, true)
    assertError(await editTemplate(t.admin, locked), 409, 'self_evaluation_template_in_use')
    const templates = await db
      .select()
      .from(selfEvaluationTemplates)
      .where(eq(selfEvaluationTemplates.institutionId, t.id))
    assert.equal(templates.length, 1)
    assert.equal(templates[0]?.questions.length, 2)
    assert.equal((await auditOf(t.id, 'finance.self_evaluation_template.create')).length, 1)
    assert.equal((await auditOf(t.id, 'finance.self_evaluation_template.update')).length, 1)
  })

  test('DOM-FIN-131 K-449: personel adına yanıt; şablon, dönem kaydı ve tekillik denetlenir', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const ali = await person(t, 'onburo', 'Ali Demir')
    let p = await period(t)
    await enroll(t, p, selin)
    p = await advance(t, p, ['active'])
    assertError(await respond(t.admin, p, selin), 422, 'self_evaluation_template_missing')
    ok(await createTemplate(t.admin, p), 201)
    assertError(await respond(t.admin, p, ali), 422, 'self_evaluation_not_enrolled')
    assertError(await respond(t.admin, p, selin, { channel: 'self_service' }), 400)
    assertError(
      await respond(t.admin, p, selin, { answers: [{ score: 4 }] }),
      422,
      'self_evaluation_answers_mismatch',
    )
    assertError(
      await respond(t.admin, p, selin, { answers: [{ text: 'metin' }, {}, {}] }),
      422,
      'self_evaluation_answer_kind',
    )
    assert.equal((await rowsOf(t.id)).length, 0)

    const headers = key()
    const created = ok(await respond(t.admin, p, selin, { channel: 'email' }, headers), 201)
    assert.equal(created.status, 'draft')
    assert.equal(created.channel, 'email')
    assert.equal(created.answeredCount, 0)
    assert.equal(created.staffName, 'Selin Kaya')
    assert.equal((created.questions as Json[]).length, 3)
    const replay = await respond(t.admin, p, selin, { channel: 'email' }, headers)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(await respond(t.admin, p, selin), 409, 'self_evaluation_exists')
    assert.equal((await rowsOf(t.id)).length, 1)
  })

  test('DOM-FIN-131 K-449 K-450: taslak → gönderildi; gönderilen düzenlenmez, gerekçeyle geri açılır; görüş yalnız gönderilende', async () => {
    const t = await institution()
    const { selin, p } = await setup(t)
    let response = ok(await respond(t.admin, p, selin), 201)
    assertError(await submit(t.admin, response), 422, 'self_evaluation_incomplete')
    assertError(
      await patch(t.admin, response, { managerComment: 'Erken görüş' }),
      422,
      'self_evaluation_not_submitted',
    )
    response = ok(
      await patch(t.admin, response, {
        answers: [{ score: 4 }, { text: SECRET }, {}],
        channel: 'email',
      }),
    )
    assert.equal(response.answeredCount, 2)
    assertError(await submit(t.admin, { ...response, version: 1 }), 409)

    response = ok(await submit(t.admin, response))
    assert.equal(response.status, 'submitted')
    assert.equal(typeof response.submittedAt, 'string')
    assertError(await submit(t.admin, response), 409, 'self_evaluation_already_submitted')
    assertError(await patch(t.admin, response, { answers: FULL }), 409, 'self_evaluation_submitted')
    response = ok(await patch(t.admin, response, { managerComment: `Görüş ${SECRET}` }))
    assert.equal(typeof response.managerCommentByName, 'string')

    assertError(await reopen(t.admin, response, 'kısa'), 400)
    const before = (await rowsOf(t.id))[0]
    assert.equal(before?.status, 'submitted')
    response = ok(await reopen(t.admin, response, `Yanlış form girildi ${SECRET}`))
    assert.equal(response.status, 'draft')
    assert.equal(response.reopenCount, 1)
    assert.equal(response.submittedAt, null)
    assert.match(String(response.reopenReason), /Yanlış form/)
    assert.equal(response.managerComment, `Görüş ${SECRET}`)
    assertError(
      await reopen(t.admin, response, 'Gerekçe metni'),
      409,
      'self_evaluation_not_submitted',
    )
    response = ok(await patch(t.admin, response, { answers: FULL }))
    assert.equal(ok(await submit(t.admin, response)).status, 'submitted')

    const summary = ok(await overview(t.admin, p)).summary as Json
    assert.deepEqual(summary, { enrolled: 1, submitted: 1, draft: 0, missing: 0, rate: 100 })
    const reopens = await auditOf(t.id, 'finance.self_evaluation.reopen')
    assert.equal(reopens.length, 1)
    for (const action of [
      'finance.self_evaluation.update',
      'finance.self_evaluation.reopen',
      'finance.self_evaluation.submit',
    ])
      for (const entry of await auditOf(t.id, action))
        assert.equal(JSON.stringify(entry.changes).includes(SECRET), false)
  })

  test('DOM-FIN-131 K-450: takip listesi gönderen ve göndermeyeni verir; ayrıntı okuması denetlenir', async () => {
    const t = await institution()
    const { selin, p } = await setup(t)
    const ali = await person(t, 'onburo', 'Ali Demir')
    const zeynep = await person(t, 'ogretmen', 'Zeynep Ak')
    const current = p
    // Dönem yürürlükteyken personel eklenebilir (K-428).
    await enroll(t, current, ali)
    await enroll(t, current, zeynep)
    const sent = ok(await respond(t.admin, current, selin, { answers: FULL }), 201)
    ok(await submit(t.admin, sent))
    ok(await respond(t.admin, current, ali), 201)

    const list = (await tracking(t.admin, current)).json() as {
      data: Json[]
      meta: { total: number }
    }
    assert.equal(list.meta.total, 3)
    assert.deepEqual(
      list.data.map((row) => [row.staffName, row.status]),
      [
        ['Ali Demir', 'draft'],
        ['Selin Kaya', 'submitted'],
        ['Zeynep Ak', 'missing'],
      ],
    )
    assert.equal(JSON.stringify(list.data).includes('Veli iletişimi'), false)
    const missing = (await tracking(t.admin, current, '?status=missing')).json() as {
      data: Json[]
    }
    assert.deepEqual(
      missing.data.map((row) => row.staffName),
      ['Zeynep Ak'],
    )
    const summary = ok(await overview(t.admin, current)).summary as Json
    assert.deepEqual(summary, { enrolled: 3, submitted: 1, draft: 1, missing: 1, rate: 33.3 })
    assert.equal((await auditOf(t.id, 'finance.self_evaluation.read')).length, 0)

    const detail = ok(await read(t.admin, sent))
    assert.deepEqual(detail.answers, [
      { score: 4, text: null },
      { score: null, text: 'Veli iletişimi güçlü' },
      { score: null, text: null },
    ])
    const reads = await auditOf(t.id, 'finance.self_evaluation.read')
    assert.equal(reads.length, 1)
    assert.equal(reads[0]?.entityId, sent.id)
    assert.equal(JSON.stringify(reads[0]?.changes).includes('Veli'), false)
  })

  test('DOM-FIN-131 K-448 K-449: kapanan dönemde şablon ve yanıt değişmez', async () => {
    const t = await institution()
    const { selin, p, template } = await setup(t)
    let response = ok(await respond(t.admin, p, selin, { answers: FULL }), 201)
    response = ok(await submit(t.admin, response))
    let current = await advance(t, p, ['interim', 'evaluation'])
    const [review] = (
      (await call('GET', `${PERIODS}/${String(current.id)}/reviews`, t.admin)).json() as {
        data: Json[]
      }
    ).data
    ok(
      await call(
        'PATCH',
        `/api/v1/finance/performance-reviews/${String(review?.id)}`,
        t.admin,
        { scores: [4] },
        ifMatch(review?.version),
      ),
    )
    current = await advance(t, current, ['closed'])
    assertError(await reopen(t.admin, response, 'Gerekçe metni'), 409, 'performance_period_closed')
    assertError(
      await patch(t.admin, response, { managerComment: 'Geç görüş' }),
      409,
      'performance_period_closed',
    )
    const locked = ok(await overview(t.admin, current)).template as Json
    assertError(
      await editTemplate(t.admin, { ...template, version: locked.version }),
      409,
      'performance_period_closed',
    )
    const [row] = await rowsOf(t.id)
    assert.equal(row?.status, 'submitted')
    assert.equal(row?.managerComment, null)
  })

  test('DOM-FIN-131: başka kurumun dönemi, şablonu ve yanıtı 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const { selin, p: pb, template } = await setup(b)
    const response = ok(await respond(b.admin, pb, selin, { answers: FULL }), 201)
    assertError(await overview(a.admin, pb), 404)
    assertError(await createTemplate(a.admin, pb), 404)
    assertError(await editTemplate(a.admin, template), 404)
    assertError(await tracking(a.admin, pb), 404)
    assertError(await respond(a.admin, pb, selin), 404)
    assertError(await read(a.admin, response), 404)
    assertError(await patch(a.admin, response, { channel: 'email' }), 404)
    assertError(await submit(a.admin, response), 404)
    assertError(await reopen(a.admin, response, 'Gerekçe metni'), 404)

    const { p: pa } = await setup(a)
    assertError(
      await call(
        'POST',
        `${PERIODS}/${String(pa.id)}/self-evaluations`,
        a.admin,
        { membershipId: selin, channel: 'paper', institutionId: b.id },
        key(),
      ),
      400,
    )
    assertError(await respond(a.admin, pa, selin), 422, 'self_evaluation_not_enrolled')
    const list = (await tracking(a.admin, pa)).json() as { data: Json[] }
    assert.equal(
      list.data.some((row) => row.membershipId === selin),
      false,
    )
    const [row] = await rowsOf(b.id)
    assert.equal(row?.version, 1)
    assert.equal(row?.channel, 'paper')
    assert.equal((await auditOf(b.id, 'finance.self_evaluation.read')).length, 0)
  })
})
