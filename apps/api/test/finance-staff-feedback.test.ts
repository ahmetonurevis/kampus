import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  staffFeedbackAssignments,
  staffFeedbackTemplates,
} from '../src/db/schema/finance-staff-feedback.ts'
import { ensureMember } from '../src/services/identity.ts'
import { loadStaffFeedbackResults } from '../src/services/finance-staff-feedback.ts'
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
 * Çok kaynaklı geri bildirim uçları (DOM-FIN-134; ON-212; K-457…K-459). Performans dönemi
 * (DOM-FIN-124) uçlarıyla kurulur; her test kendi kurumunu kurar. FIXED_NOW 2026-10-06.
 */

const PERIODS = '/api/v1/finance/performance-periods'
const TEMPLATES = '/api/v1/finance/staff-feedback-templates'
const ASSIGNMENTS = '/api/v1/finance/staff-feedback-assignments'
const SETTINGS = '/api/v1/finance/staff-feedback-settings'
const GOALS = [{ title: 'Okuma becerisi', criterion: 'Sınıf ortalaması B1', weight: 100 }]
const QUESTIONS = [
  { kind: 'scale', text: 'Ekip çalışmasına katkısı', required: true },
  { kind: 'open', text: 'Güçlü yanları neler?', required: true },
  { kind: 'open', text: 'Eklemek istedikleriniz', required: false },
]
const SECRET = 'Gizli-meslektas-cevabi'
const answers = (score: number, text: string, extra?: string) => [
  { score },
  { text },
  extra === undefined ? {} : { text: extra },
]

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-134: çok kaynaklı geri bildirim uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.212.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
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
    clientIp = `10.212.${String((tenantCount += 1))}.1`
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
    call('GET', `${PERIODS}/${String(p.id)}/staff-feedback`, cookie)
  const createTemplate = (
    cookie: string | null,
    p: Json,
    questions: unknown = QUESTIONS,
    headers: Record<string, string> = key(),
  ) =>
    call(
      'POST',
      `${PERIODS}/${String(p.id)}/staff-feedback-template`,
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
  const subjects = (cookie: string | null, p: Json, query = '') =>
    call('GET', `${PERIODS}/${String(p.id)}/staff-feedback-subjects${query}`, cookie)
  const assignments = (cookie: string | null, p: Json, query = '') =>
    call('GET', `${PERIODS}/${String(p.id)}/staff-feedback-assignments${query}`, cookie)
  const assign = (
    cookie: string | null,
    p: Json,
    subjectMembershipId: string,
    reviewerMembershipId: string,
    relation = 'peer',
    headers: Record<string, string> = key(),
  ) =>
    call(
      'POST',
      `${PERIODS}/${String(p.id)}/staff-feedback-assignments`,
      cookie,
      { subjectMembershipId, reviewerMembershipId, relation },
      headers,
    )
  const remove = (cookie: string | null, a: Json) =>
    call('DELETE', `${ASSIGNMENTS}/${String(a.id)}`, cookie, undefined, ifMatch(a.version))
  const respond = (cookie: string | null, a: Json, body: unknown, channel = 'paper') =>
    call(
      'POST',
      `${ASSIGNMENTS}/${String(a.id)}/response`,
      cookie,
      { channel, answers: body },
      ifMatch(a.version),
    )
  const withdraw = (cookie: string | null, a: Json, reason: unknown) =>
    call('POST', `${ASSIGNMENTS}/${String(a.id)}/withdraw`, cookie, { reason }, ifMatch(a.version))
  const result = (cookie: string | null, p: Json, membershipId: string) =>
    call('GET', `${PERIODS}/${String(p.id)}/staff-feedback-results/${membershipId}`, cookie)
  const settings = (cookie: string | null) => call('GET', SETTINGS, cookie)
  const setThreshold = (cookie: string | null, value: unknown, version: unknown) =>
    call('PATCH', SETTINGS, cookie, { peerAnonymityThreshold: value }, ifMatch(version))
  const rowsOf = (institutionId: string) =>
    db
      .select()
      .from(staffFeedbackAssignments)
      .where(eq(staffFeedbackAssignments.institutionId, institutionId))
  const auditOf = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  /**
   * Yürürlükte dönem, şablon; değerlendirilen öğretmen Selin, yönetici değerlendiren Murat ve
   * meslektaşlar Ali, Zeynep, Can, Ece.
   */
  async function setup(t: Tenant) {
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const murat = await person(t, 'yonetici', 'Murat Yılmaz')
    const peers = [
      await person(t, 'ogretmen', 'Ali Demir'),
      await person(t, 'ogretmen', 'Zeynep Ak'),
      await person(t, 'onburo', 'Can Er'),
      await person(t, 'ogretmen', 'Ece Tan'),
    ]
    let p = await period(t)
    await enroll(t, p, selin)
    const template = ok(await createTemplate(t.admin, p), 201)
    p = await advance(t, p, ['active'])
    return { selin, murat, peers, p, template }
  }

  test('kimliksiz istek 401', async () => {
    const p = { id: randomUUID(), version: 1 }
    assertError(await settings(null), 401)
    assertError(await setThreshold(null, 4, 1), 401)
    assertError(await overview(null, p), 401)
    assertError(await createTemplate(null, p), 401)
    assertError(await editTemplate(null, p), 401)
    assertError(await subjects(null, p), 401)
    assertError(await assignments(null, p), 401)
    assertError(await assign(null, p, 'm-1', 'm-2'), 401)
    assertError(await remove(null, p), 401)
    assertError(await respond(null, p, []), 401)
    assertError(await withdraw(null, p, 'Gerekçe metni'), 401)
    assertError(await result(null, p, 'm-1'), 401)
  })

  test('DOM-FIN-134 K-459: yönetici dışındaki roller 403; atama değişmez, sonuç okuması denetlenmez', async () => {
    const t = await institution()
    const { selin, peers, p, template } = await setup(t)
    const a = ok(await assign(t.admin, p, selin, peers[0] ?? ''), 201)
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await settings(cookie), 403)
      assertError(await setThreshold(cookie, 4, 1), 403)
      assertError(await overview(cookie, p), 403)
      assertError(await createTemplate(cookie, p), 403)
      assertError(await editTemplate(cookie, template), 403)
      assertError(await subjects(cookie, p), 403)
      assertError(await assignments(cookie, p), 403)
      assertError(await assign(cookie, p, selin, peers[1] ?? ''), 403)
      assertError(await remove(cookie, a), 403)
      assertError(await respond(cookie, a, answers(4, 'x')), 403)
      assertError(await withdraw(cookie, a, 'Gerekçe metni'), 403)
      assertError(await result(cookie, p, selin), 403)
    }
    const rows = await rowsOf(t.id)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.version, 1)
    assert.equal(rows[0]?.status, 'pending')
    assert.equal((await auditOf(t.id, 'finance.staff_feedback_result.read')).length, 0)
  })

  test('DOM-FIN-134: finance modülü kapalıyken uçlar 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    const p = { id: randomUUID(), version: 1 }
    assertError(await settings(closed.admin), 403, 'module_disabled')
    assertError(await overview(closed.admin, p), 403, 'module_disabled')
    assertError(await createTemplate(closed.admin, p), 403, 'module_disabled')
    assertError(await subjects(closed.admin, p), 403, 'module_disabled')
    assertError(await assign(closed.admin, p, 'm-1', 'm-2'), 403, 'module_disabled')
    assertError(await respond(closed.admin, p, []), 403, 'module_disabled')
    assertError(await result(closed.admin, p, 'm-1'), 403, 'module_disabled')
  })

  test('DOM-FIN-134 K-457: şablon idempotent açılır, dönemde tektir; yanıt girilince kilitlenir', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const ali = await person(t, 'ogretmen', 'Ali Demir')
    let p = await period(t)
    await enroll(t, p, selin)
    const empty = ok(await overview(t.admin, p))
    assert.equal(empty.template, null)
    assert.equal(empty.threshold, 3)
    assert.equal((empty.summary as Json).assigned, 0)

    assertError(await createTemplate(t.admin, p, []), 400)
    assertError(await createTemplate(t.admin, p, QUESTIONS, {}), 400)
    const headers = key()
    const first = await createTemplate(t.admin, p, QUESTIONS, headers)
    const replay = await createTemplate(t.admin, p, QUESTIONS, headers)
    assert.equal(first.statusCode, 201, first.body)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    let template = first.json().data as Json
    assertError(await createTemplate(t.admin, p), 409, 'staff_feedback_template_exists')
    template = ok(await editTemplate(t.admin, template, QUESTIONS.slice(0, 2)))
    assert.equal((template.questions as Json[]).length, 2)
    assertError(await editTemplate(t.admin, { ...template, version: 1 }), 409)

    // Atama planlamada yapılır; yanıt yürürlükte girilir (K-458).
    const a = ok(await assign(t.admin, p, selin, ali), 201)
    assertError(
      await respond(t.admin, a, [{ score: 4 }, { text: 'x' }]),
      422,
      'staff_feedback_not_open',
    )
    p = await advance(t, p, ['active'])
    ok(await respond(t.admin, a, [{ score: 4 }, { text: 'Paylaşımcı' }]))
    const locked = ok(await overview(t.admin, p)).template as Json
    assert.equal(locked.locked, true)
    assertError(await editTemplate(t.admin, locked), 409, 'staff_feedback_template_in_use')
    const templates = await db
      .select()
      .from(staffFeedbackTemplates)
      .where(eq(staffFeedbackTemplates.institutionId, t.id))
    assert.equal(templates.length, 1)
    assert.equal(templates[0]?.questions.length, 2)
    assert.equal((await auditOf(t.id, 'finance.staff_feedback_template.create')).length, 1)
    assert.equal((await auditOf(t.id, 'finance.staff_feedback_template.update')).length, 1)
  })

  test('DOM-FIN-134 K-458: değerlendiren ataması; kendini değerlendirme yok, tekil ve idempotent', async () => {
    const t = await institution()
    const { selin, murat, peers, p } = await setup(t)
    const [ali = ''] = peers
    const veli = await person(t, 'veli', 'Ayşe Yılmaz')
    const outsider = await person(t, 'ogretmen', 'Kayıtsız Öğretmen')
    assertError(await assign(t.admin, p, selin, selin), 422, 'staff_feedback_self')
    assertError(await assign(t.admin, p, outsider, ali), 422, 'staff_feedback_not_enrolled')
    assertError(
      await assign(t.admin, p, selin, 'yok-uyelik'),
      422,
      'staff_feedback_reviewer_not_found',
    )
    assertError(await assign(t.admin, p, selin, veli), 422, 'staff_feedback_reviewer_not_staff')
    assertError(await assign(t.admin, p, selin, ali, 'self'), 400)
    assert.equal((await rowsOf(t.id)).length, 0)

    const headers = key()
    const created = ok(await assign(t.admin, p, selin, ali, 'peer', headers), 201)
    assert.equal(created.status, 'pending')
    assert.equal(created.subjectName, 'Selin Kaya')
    assert.equal(created.reviewerName, 'Ali Demir')
    assert.equal(created.relation, 'peer')
    const replay = await assign(t.admin, p, selin, ali, 'peer', headers)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(
      await assign(t.admin, p, selin, ali, 'manager'),
      409,
      'staff_feedback_assignment_exists',
    )
    ok(await assign(t.admin, p, selin, murat, 'manager'), 201)
    assert.equal((await rowsOf(t.id)).length, 2)

    // Yanıtsız atama kaldırılır (arşiv) ve yeniden atanabilir.
    ok(await remove(t.admin, created))
    assertError(await remove(t.admin, created), 404)
    const rows = await rowsOf(t.id)
    assert.equal(rows.filter((row) => row.archivedAt !== null).length, 1)
    const again = ok(await assign(t.admin, p, selin, ali, 'peer'), 201)
    const list = (await assignments(t.admin, p)).json() as { data: Json[]; meta: { total: number } }
    assert.equal(list.meta.total, 2)
    assert.deepEqual(
      list.data.map((row) => [row.reviewerName, row.relation]),
      [
        ['Murat Yılmaz', 'manager'],
        ['Ali Demir', 'peer'],
      ],
    )
    const peersOnly = (await assignments(t.admin, p, '?relation=peer')).json() as { data: Json[] }
    assert.deepEqual(
      peersOnly.data.map((row) => row.id),
      [again.id],
    )
    const found = (await assignments(t.admin, p, '?q=murat')).json() as { data: Json[] }
    assert.equal(found.data.length, 1)
    assert.equal((await auditOf(t.id, 'finance.staff_feedback_assignment.remove')).length, 1)

    // Değerlendirmede atama kapanır.
    const evaluation = await advance(t, p, ['interim', 'evaluation'])
    assertError(
      await assign(t.admin, evaluation, selin, peers[1] ?? ''),
      409,
      'staff_feedback_assign_closed',
    )
    assertError(await remove(t.admin, again), 409, 'staff_feedback_assign_closed')
  })

  test('DOM-FIN-134 K-458: yanıt değerlendiren adına girilir, cevap dönmez; gerekçeyle geri alınır', async () => {
    const t = await institution()
    const { selin, peers, p } = await setup(t)
    let a = ok(await assign(t.admin, p, selin, peers[0] ?? ''), 201)
    assertError(await respond(t.admin, a, [{ score: 4 }]), 422, 'staff_feedback_answers_mismatch')
    assertError(
      await respond(t.admin, a, [{ text: 'metin' }, { text: 'x' }, {}]),
      422,
      'staff_feedback_answer_kind',
    )
    assertError(await respond(t.admin, a, [{ score: 4 }, {}, {}]), 422, 'staff_feedback_incomplete')
    assertError(await respond(t.admin, a, answers(4, 'x'), 'self_service'), 400)
    assertError(await respond(t.admin, { ...a, version: 9 }, answers(4, 'x')), 409)
    assert.equal((await rowsOf(t.id))[0]?.status, 'pending')

    a = ok(await respond(t.admin, a, answers(4, SECRET), 'email'))
    assert.equal(a.status, 'submitted')
    assert.equal(a.channel, 'email')
    assert.equal(JSON.stringify(a).includes(SECRET), false)
    assert.equal('answers' in a, false)
    assertError(await respond(t.admin, a, answers(5, 'x')), 409, 'staff_feedback_already_responded')
    assertError(await remove(t.admin, a), 409, 'staff_feedback_responded')
    const list = (await assignments(t.admin, p)).json() as { data: Json[] }
    assert.equal(JSON.stringify(list).includes(SECRET), false)

    const summary = ok(await overview(t.admin, p)).summary as Json
    assert.deepEqual(summary.byRelation, {
      manager: { assigned: 0, responded: 0, rate: null },
      peer: { assigned: 1, responded: 1, rate: 100 },
    })

    assertError(await withdraw(t.admin, a, 'kısa'), 400)
    a = ok(await withdraw(t.admin, a, `Yanlış kişinin formu ${SECRET}`))
    assert.equal(a.status, 'pending')
    assert.equal(a.withdrawCount, 1)
    assert.equal(a.channel, null)
    const [row] = await rowsOf(t.id)
    assert.equal(row?.answers, null)
    assert.match(String(row?.withdrawReason), /Yanlış kişinin/)
    assertError(await withdraw(t.admin, a, 'Gerekçe metni'), 409, 'staff_feedback_not_responded')
    a = ok(await respond(t.admin, a, answers(3, 'Düzeltilmiş')))
    assert.equal(a.status, 'submitted')

    for (const action of ['finance.staff_feedback.respond', 'finance.staff_feedback.withdraw'])
      for (const entry of await auditOf(t.id, action))
        assert.equal(JSON.stringify(entry.changes).includes(SECRET), false)
    assert.equal((await auditOf(t.id, 'finance.staff_feedback.respond')).length, 2)
  })

  test('DOM-FIN-134 K-458: şablon yokken yanıt girilmez; değerlendirilen yönetici kendi hakkındaki yanıtı giremez', async () => {
    const t = await institution()
    const director = await createMember(app, t.id, 'yonetici')
    const directorCookie = await signInAs(app, director)
    const ali = await person(t, 'ogretmen', 'Ali Demir')
    let p = await period(t)
    await enroll(t, p, director.membershipId)
    p = await advance(t, p, ['active'])
    const a = ok(await assign(t.admin, p, director.membershipId, ali), 201)
    assertError(await respond(t.admin, a, answers(4, 'x')), 422, 'staff_feedback_template_missing')
    ok(await createTemplate(t.admin, p), 201)
    assertError(
      await respond(directorCookie, a, answers(4, 'x')),
      422,
      'staff_feedback_subject_entry',
    )
    ok(await respond(t.admin, a, answers(4, 'x')))
  })

  test('DOM-FIN-134 K-459: meslektaş sonucu yalnız değerlendirmede ve eşik üstünde toplu; yönetici yanıtı adıyla', async () => {
    const t = await institution()
    const { selin, murat, peers, p } = await setup(t)
    const manager = ok(await assign(t.admin, p, selin, murat, 'manager'), 201)
    ok(await respond(t.admin, manager, answers(5, 'Planlı çalışır')))
    const peerTexts = ['Zeki', 'Çalışkan', 'Ağırbaşlı', 'Sabırlı']
    const peerScores = [4, 3, 4, 5]
    const peerAssignments: Json[] = []
    for (const membershipId of peers)
      peerAssignments.push(ok(await assign(t.admin, p, selin, membershipId), 201))
    for (const [index, a] of peerAssignments.slice(0, 2).entries())
      ok(
        await respond(
          t.admin,
          a,
          answers(peerScores[index] ?? 1, peerTexts[index] ?? '', index === 0 ? SECRET : undefined),
        ),
      )

    // Yürürlükte: meslektaş sonucu açılmaz, yönetici yanıtı adıyla görünür.
    let read = ok(await result(t.admin, p, selin))
    let peer = read.peer as Json
    assert.equal(peer.visible, false)
    assert.equal(peer.hiddenReason, 'period_open')
    assert.equal(peer.responded, 2)
    assert.equal(peer.assigned, 4)
    const managerPart = read.manager as { responses: Json[] }
    assert.equal(managerPart.responses[0]?.reviewerName, 'Murat Yılmaz')
    assert.deepEqual(managerPart.responses[0]?.answers, [
      { score: 5, text: null },
      { score: null, text: 'Planlı çalışır' },
      { score: null, text: null },
    ])
    assert.equal(JSON.stringify(read).includes('Zeki'), false)

    const subjectList = (await subjects(t.admin, p)).json() as { data: Json[] }
    assert.deepEqual(subjectList.data[0], {
      membershipId: selin,
      staffName: 'Selin Kaya',
      staffRole: 'ogretmen',
      assigned: 5,
      responded: 3,
      manager: { assigned: 1, responded: 1, rate: 100 },
      peer: { assigned: 4, responded: 2, rate: 50 },
    })

    // Değerlendirmede 2 meslektaş yanıtı eşiğin (3) altındadır.
    let current = await advance(t, p, ['interim'])
    ok(
      await respond(
        t.admin,
        peerAssignments[2] ?? {},
        answers(peerScores[2] ?? 1, peerTexts[2] ?? ''),
      ),
    )
    current = await advance(t, current, ['evaluation'])
    assertError(
      await respond(t.admin, peerAssignments[3] ?? {}, answers(5, 'Geç')),
      422,
      'staff_feedback_not_open',
    )
    read = ok(await result(t.admin, current, selin))
    peer = read.peer as Json
    assert.equal(peer.visible, true)
    assert.equal(peer.hiddenReason, null)
    assert.deepEqual(peer.questions, [
      {
        kind: 'scale',
        text: 'Ekip çalışmasına katkısı',
        answered: 3,
        hidden: false,
        average: 3.67,
        texts: [],
      },
      {
        kind: 'open',
        text: 'Güçlü yanları neler?',
        answered: 3,
        hidden: false,
        average: null,
        texts: ['Ağırbaşlı', 'Çalışkan', 'Zeki'],
      },
      {
        kind: 'open',
        text: 'Eklemek istedikleriniz',
        answered: 1,
        hidden: true,
        average: null,
        texts: [],
      },
    ])
    // Meslektaşın adı ve tek cevaplı sorunun cevabı dönmez.
    for (const secret of [SECRET, 'Ali Demir', 'Zeynep Ak', 'Can Er'])
      assert.equal(JSON.stringify(read).includes(secret), false)

    // Eşik yükselince meslektaş sonucu gizlenir.
    const currentSettings = ok(await settings(t.admin))
    assert.deepEqual(currentSettings, { peerAnonymityThreshold: 3, version: 1 })
    assertError(await setThreshold(t.admin, 2, 1), 400)
    assertError(await setThreshold(t.admin, 3, 1), 422, 'staff_feedback_settings_unchanged')
    const saved = ok(await setThreshold(t.admin, 4, 1))
    assert.deepEqual(saved, { peerAnonymityThreshold: 4, version: 2 })
    assertError(await setThreshold(t.admin, 5, 1), 409)
    read = ok(await result(t.admin, current, selin))
    assert.equal((read.peer as Json).hiddenReason, 'below_threshold')
    assert.deepEqual((read.peer as Json).questions, [])
    assert.equal(read.threshold, 4)

    const reads = await auditOf(t.id, 'finance.staff_feedback_result.read')
    assert.equal(reads.length, 3)
    assert.equal(reads[0]?.entityId, selin)
    for (const entry of reads) assert.equal(JSON.stringify(entry.changes).includes('Zeki'), false)
    assert.equal((await auditOf(t.id, 'finance.staff_feedback.settings')).length, 1)

    // Rapor (ON-220) aynı toplu sonucu servisten denetimsiz okur.
    const results = await loadStaffFeedbackResults(db, t.id, String(current.id))
    assert.equal(results.get(selin)?.peer.hiddenReason, 'below_threshold')
    assert.equal(results.size, 1)
  })

  test('DOM-FIN-134 K-457 K-458: kapanan dönemde şablon, atama ve yanıt değişmez', async () => {
    const t = await institution()
    const { selin, peers, p, template } = await setup(t)
    let a = ok(await assign(t.admin, p, selin, peers[0] ?? ''), 201)
    const pending = ok(await assign(t.admin, p, selin, peers[1] ?? ''), 201)
    a = ok(await respond(t.admin, a, answers(4, 'x')))
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
    assertError(await withdraw(t.admin, a, 'Gerekçe metni'), 409, 'performance_period_closed')
    assertError(await respond(t.admin, pending, answers(4, 'x')), 409, 'performance_period_closed')
    assertError(await remove(t.admin, pending), 409, 'performance_period_closed')
    assertError(
      await assign(t.admin, current, selin, peers[2] ?? ''),
      409,
      'performance_period_closed',
    )
    const locked = ok(await overview(t.admin, current)).template as Json
    assertError(
      await editTemplate(t.admin, { ...template, version: locked.version }),
      409,
      'performance_period_closed',
    )
    const rows = await rowsOf(t.id)
    assert.equal(rows.length, 2)
    assert.equal(rows.filter((row) => row.status === 'submitted').length, 1)
  })

  test('DOM-FIN-134: başka kurumun dönemi, şablonu, ataması ve sonucu 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const { selin, peers, p: pb, template } = await setup(b)
    const assignment = ok(await assign(b.admin, pb, selin, peers[0] ?? ''), 201)
    const answered = ok(await assign(b.admin, pb, selin, peers[1] ?? ''), 201)
    const done = ok(await respond(b.admin, answered, answers(4, 'B kurumu')))
    assertError(await overview(a.admin, pb), 404)
    assertError(await createTemplate(a.admin, pb), 404)
    assertError(await editTemplate(a.admin, template), 404)
    assertError(await subjects(a.admin, pb), 404)
    assertError(await assignments(a.admin, pb), 404)
    assertError(await assign(a.admin, pb, selin, peers[2] ?? ''), 404)
    assertError(await remove(a.admin, assignment), 404)
    assertError(await respond(a.admin, assignment, answers(4, 'x')), 404)
    assertError(await withdraw(a.admin, done, 'Gerekçe metni'), 404)
    assertError(await result(a.admin, pb, selin), 404)
    // Eşik ayarı kurumlar arası ayrıdır; gövdedeki kurum kimliği etkisizdir.
    ok(await setThreshold(b.admin, 5, 1))
    assert.equal(ok(await settings(a.admin)).peerAnonymityThreshold, 3)
    assertError(
      await call(
        'PATCH',
        SETTINGS,
        a.admin,
        { peerAnonymityThreshold: 4, institutionId: b.id },
        ifMatch(1),
      ),
      400,
    )
    assert.equal(ok(await settings(b.admin)).peerAnonymityThreshold, 5)

    const { p: pa, selin: selinA } = await setup(a)
    assertError(
      await call(
        'POST',
        `${PERIODS}/${String(pa.id)}/staff-feedback-assignments`,
        a.admin,
        {
          subjectMembershipId: selinA,
          reviewerMembershipId: peers[0],
          relation: 'peer',
          institutionId: b.id,
        },
        key(),
      ),
      400,
    )
    assertError(
      await assign(a.admin, pa, selinA, peers[0] ?? ''),
      422,
      'staff_feedback_reviewer_not_found',
    )
    assertError(await assign(a.admin, pa, selin, selinA), 422, 'staff_feedback_not_enrolled')
    assertError(await result(a.admin, pa, selin), 404)
    const list = (await assignments(a.admin, pa)).json() as { data: Json[] }
    assert.equal(list.data.length, 0)
    const subjectList = (await subjects(a.admin, pa)).json() as { data: Json[] }
    assert.equal(
      subjectList.data.some((row) => row.membershipId === selin),
      false,
    )
    assert.equal((await loadStaffFeedbackResults(db, a.id, String(pb.id))).size, 0)
    const rows = await rowsOf(b.id)
    assert.equal(rows.length, 2)
    assert.deepEqual(rows.map((row) => row.version).sort(), [1, 2])
    assert.equal((await auditOf(b.id, 'finance.staff_feedback_result.read')).length, 0)
  })
})
