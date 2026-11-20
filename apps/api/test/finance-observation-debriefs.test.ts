import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  observationDebriefs,
  staffDevelopmentGoalNotes,
  staffDevelopmentGoals,
} from '../src/db/schema/finance-observation-debriefs.ts'
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
 * Gözlem sonrası görüşme ve gelişim hedefi uçları (DOM-FIN-133; ON-209; K-454…K-456). Her test
 * kendi kurumunu kurar. FIXED_NOW 2026-10-06 (İstanbul günü).
 */

const TEMPLATES = '/api/v1/finance/lesson-observation-templates'
const OBSERVATIONS = '/api/v1/finance/lesson-observations'
const DEBRIEFS = '/api/v1/finance/observation-debriefs'
const GOALS = '/api/v1/finance/development-goals'
const levels = [0, 1, 2, 3, 4, 5].map((level) => ({ level, description: `Seviye ${level}` }))
const TEMPLATE = {
  name: 'Ders gözlem formu',
  criteria: [{ title: 'Sınıf yönetimi', weight: 1, levels }],
}

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-133: gözlem sonrası görüşme ve gelişim hedefi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.209.0.1'

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
    clientIp = `10.209.${String((tenantCount += 1))}.1`
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

  /** Kurum: form, öğretmen, gözlemci öğretmen ve tamamlanmış gözlem. */
  async function setup(t: Tenant, complete = true) {
    const form = ok(await call('POST', TEMPLATES, t.admin, TEMPLATE, key()), 201)
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const mentor = await person(t, 'ogretmen', 'Murat Can')
    let observation = ok(
      await call(
        'POST',
        OBSERVATIONS,
        t.admin,
        {
          templateId: form.id,
          teacherMembershipId: selin.membershipId,
          observerMembershipId: mentor.membershipId,
          observedDate: '2026-10-01',
        },
        key(),
      ),
      201,
    )
    if (complete) {
      const url = `${OBSERVATIONS}/${String(observation.id)}`
      observation = ok(
        await call(
          'PATCH',
          url,
          t.admin,
          { ratings: [{ criterionId: 'k1', level: 3 }], generalNote: 'Hedef seviyede' },
          ifMatch(observation.version),
        ),
      )
      observation = ok(
        await call('POST', `${url}/complete`, t.admin, {}, ifMatch(observation.version)),
      )
    }
    return { observation, selin, mentor }
  }
  const debriefUrl = (observation: Json) => `${OBSERVATIONS}/${String(observation.id)}/debrief`
  const openDebrief = (
    cookie: string | null,
    observation: Json,
    body: Json,
    headers: Record<string, string> = key(),
  ) =>
    call('POST', debriefUrl(observation), cookie, { debriefDate: '2026-10-03', ...body }, headers)
  const patchDebrief = (cookie: string | null, row: Json, body: Json) =>
    call('PATCH', `${DEBRIEFS}/${String(row.id)}`, cookie, body, ifMatch(row.version))
  const finalize = (cookie: string | null, row: Json) =>
    call('POST', `${DEBRIEFS}/${String(row.id)}/finalize`, cookie, {}, ifMatch(row.version))
  const goalBody = (body: Json) => ({
    title: 'Ders sonunda kazanım yoklaması yapmak',
    successCriterion: 'Üç gözlemde çıkış kartı kullanılmış olmalı',
    followUpDate: '2026-11-01',
    ...body,
  })
  const openGoal = (cookie: string | null, body: Json, headers: Record<string, string> = key()) =>
    call('POST', GOALS, cookie, goalBody(body), headers)
  const followUp = (cookie: string | null, row: Json, body: Json) =>
    call('POST', `${GOALS}/${String(row.id)}/follow-ups`, cookie, body, ifMatch(row.version))
  const patchGoal = (cookie: string | null, row: Json, body: Json) =>
    call('PATCH', `${GOALS}/${String(row.id)}`, cookie, body, ifMatch(row.version))
  const debriefRows = (institutionId: string) =>
    db
      .select()
      .from(observationDebriefs)
      .where(eq(observationDebriefs.institutionId, institutionId))
  const goalRows = (institutionId: string) =>
    db
      .select()
      .from(staffDevelopmentGoals)
      .where(eq(staffDevelopmentGoals.institutionId, institutionId))
  const audits = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  test('kimliksiz istek 401', async () => {
    const row = { id: randomUUID(), version: 1 }
    assertError(await call('GET', debriefUrl(row), null), 401)
    assertError(await openDebrief(null, row, { participantMembershipIds: ['x'] }), 401)
    assertError(await patchDebrief(null, row, { strengths: 'x' }), 401)
    assertError(await finalize(null, row), 401)
    assertError(await call('GET', GOALS, null), 401)
    assertError(await call('GET', `${GOALS}/${row.id}`, null), 401)
    assertError(await openGoal(null, { teacherMembershipId: 'x' }), 401)
    assertError(await patchGoal(null, row, { title: 'Yeni hedef' }), 401)
    assertError(await followUp(null, row, { note: 'Not' }), 401)
  })

  test('DOM-FIN-133 K-454: görüşme tamamlanmış gözleme bir kez açılır, kesinleşince değişmez', async () => {
    const t = await institution()
    const { observation, selin, mentor } = await setup(t)
    const draft = await setup(t, false)
    const people = { participantMembershipIds: [selin.membershipId, mentor.membershipId] }
    assertError(
      await openDebrief(t.admin, draft.observation, {
        participantMembershipIds: [draft.selin.membershipId],
      }),
      422,
      'debrief_observation_not_completed',
    )
    assertError(
      await openDebrief(t.admin, observation, { participantMembershipIds: [mentor.membershipId] }),
      422,
      'debrief_teacher_missing',
    )
    assertError(
      await openDebrief(t.admin, observation, { ...people, debriefDate: '2026-09-30' }),
      422,
      'debrief_date_before_observation',
    )
    assertError(
      await openDebrief(t.admin, observation, { ...people, debriefDate: '2026-10-07' }),
      422,
      'debrief_date_future',
    )
    assert.equal((await debriefRows(t.id)).length, 0)
    assert.equal(ok(await call('GET', debriefUrl(observation), t.admin)), null)

    const headers = key()
    let row = ok(await openDebrief(t.admin, observation, people, headers), 201)
    const replay = await openDebrief(t.admin, observation, people, headers)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(await openDebrief(t.admin, observation, people), 409, 'debrief_exists')
    assert.equal(row.status, 'draft')
    assert.equal((row.participants as unknown[]).length, 2)
    assertError(await finalize(t.admin, row), 422, 'debrief_strengths_required')

    row = ok(
      await patchDebrief(t.admin, row, {
        strengths: 'Sınıf yönetimi güçlü',
        developmentAreas: 'Ölçme ve geri bildirim',
        teacherComment: 'Katılıyorum',
        participantMembershipIds: [selin.membershipId],
      }),
    )
    assert.deepEqual(
      (row.participants as Json[]).map((p) => p.membershipId),
      [selin.membershipId],
    )
    assertError(await patchDebrief(t.admin, { ...row, version: 9 }, { strengths: 'x' }), 409)
    row = ok(await finalize(t.admin, row))
    assert.equal(row.status, 'finalized')
    assertError(await patchDebrief(t.admin, row, { strengths: 'Geç' }), 409, 'debrief_finalized')
    assertError(await finalize(t.admin, row), 409, 'debrief_finalized')
    await assert.rejects(
      db
        .update(observationDebriefs)
        .set({ strengths: 'Elle' })
        .where(eq(observationDebriefs.id, String(row.id))),
    )
    const [stored] = await debriefRows(t.id)
    assert.equal(stored?.strengths, 'Sınıf yönetimi güçlü')
    const writes = await audits(t.id, 'finance.observation_debrief.update')
    assert.equal(JSON.stringify(writes).includes('Sınıf yönetimi güçlü'), false)
  })

  test('DOM-FIN-133 K-455: gelişim hedefi, takip notu geçmişi ve gecikmiş hedef listesi', async () => {
    const t = await institution()
    const { observation, selin, mentor } = await setup(t)
    const debrief = ok(
      await openDebrief(t.admin, observation, {
        participantMembershipIds: [selin.membershipId, mentor.membershipId],
      }),
      201,
    )
    assertError(
      await openGoal(t.admin, { teacherMembershipId: selin.membershipId, debriefId: debrief.id }),
      400,
    )
    assertError(
      await openGoal(t.admin, {
        teacherMembershipId: mentor.membershipId,
        followUpDate: '2026-10-05',
      }),
      422,
      'development_goal_follow_up_past',
    )
    assertError(
      await openGoal(t.admin, { debriefId: randomUUID() }),
      422,
      'development_goal_debrief_not_found',
    )
    assertError(
      await openGoal(t.admin, {
        teacherMembershipId: selin.membershipId,
        performancePeriodId: randomUUID(),
      }),
      422,
      'development_goal_period_not_found',
    )
    assert.equal((await goalRows(t.id)).length, 0)

    const headers = key()
    let goal = ok(await openGoal(t.admin, { debriefId: debrief.id }, headers), 201)
    assert.equal(
      (await openGoal(t.admin, { debriefId: debrief.id }, headers)).headers['idempotent-replayed'],
      'true',
    )
    assert.equal(goal.source, 'observation_debrief')
    assert.equal(goal.teacherMembershipId, selin.membershipId)
    assert.equal(goal.observerMembershipId, mentor.membershipId)
    assert.equal(goal.status, 'open')
    const direct = ok(
      await openGoal(t.admin, {
        teacherMembershipId: selin.membershipId,
        followUpDate: '2026-10-06',
      }),
      201,
    )
    assert.equal(direct.source, 'direct')

    goal = ok(await followUp(t.admin, goal, { note: 'Çıkış kartı denendi', status: 'in_progress' }))
    assert.equal(goal.status, 'in_progress')
    assertError(
      await followUp(t.admin, goal, { note: 'Geri', status: 'open' }),
      422,
      'development_goal_status_invalid',
    )
    goal = ok(await patchGoal(t.admin, goal, { followUpDate: '2026-10-20' }))
    goal = ok(await followUp(t.admin, goal, { note: 'Üç derste kullandı', status: 'achieved' }))
    assert.equal(goal.status, 'achieved')
    assert.equal(goal.active, false)
    assert.deepEqual(
      (goal.notes as Json[]).map((note) => [note.statusFrom, note.statusTo]),
      [
        ['open', 'in_progress'],
        ['in_progress', 'achieved'],
      ],
    )
    assertError(await followUp(t.admin, goal, { note: 'Yeni' }), 409, 'development_goal_closed')
    assertError(
      await patchGoal(t.admin, goal, { title: 'Yeni hedef' }),
      409,
      'development_goal_closed',
    )
    await assert.rejects(
      db
        .update(staffDevelopmentGoalNotes)
        .set({ note: 'Elle' })
        .where(eq(staffDevelopmentGoalNotes.institutionId, t.id)),
    )

    // Gecikmiş: takip tarihi bugünden (2026-10-06) önce kalan süren hedef. Tarih geçmişe yazılamadığı
    // için satır doğrudan geri alınır (zaman ilerlemiş gibi).
    await db
      .update(staffDevelopmentGoals)
      .set({ followUpDate: '2026-10-01' })
      .where(eq(staffDevelopmentGoals.id, String(direct.id)))
    const overdue = (await call('GET', `${GOALS}?overdue=true`, t.admin)).json() as {
      data: Json[]
      meta: { total: number }
    }
    assert.equal(overdue.meta.total, 1)
    assert.equal(overdue.data[0]?.id, direct.id)
    assert.equal(overdue.data[0]?.overdueDays, 5)
    const byDebrief = (
      await call('GET', `${GOALS}?debriefId=${String(debrief.id)}`, t.admin)
    ).json() as {
      meta: { total: number }
    }
    assert.equal(byDebrief.meta.total, 1)
    const notes = await audits(t.id, 'finance.development_goal.follow_up')
    assert.equal(JSON.stringify(notes).includes('Üç derste'), false)
  })

  test('DOM-FIN-133 K-456: ön büro 403; öğretmen yalnız ilgili kaydı görür, yazamaz; okuma denetimde', async () => {
    const t = await institution()
    const { observation, selin, mentor } = await setup(t)
    const other = await person(t, 'ogretmen', 'Deniz Ak')
    let debrief = ok(
      await openDebrief(t.admin, observation, {
        participantMembershipIds: [selin.membershipId, mentor.membershipId],
      }),
      201,
    )
    const goal = ok(await openGoal(t.admin, { debriefId: debrief.id }), 201)
    const otherGoal = ok(await openGoal(t.admin, { teacherMembershipId: other.membershipId }), 201)
    const frontDesk = await signInAs(app, await createMember(app, t.id, 'onburo'))
    assertError(await call('GET', GOALS, frontDesk), 403)
    assertError(await call('GET', debriefUrl(observation), frontDesk), 403)
    const selinCookie = await signInAs(app, selin.user)
    const mentorCookie = await signInAs(app, mentor.user)
    const otherCookie = await signInAs(app, other.user)
    // Taslak görüşmeyi gözlemci görür, gözlenen öğretmen göremez.
    assert.equal(ok(await call('GET', debriefUrl(observation), mentorCookie)).id, debrief.id)
    assert.equal(ok(await call('GET', debriefUrl(observation), selinCookie)), null)
    assertError(await call('GET', debriefUrl(observation), otherCookie), 404)
    debrief = ok(
      await patchDebrief(t.admin, debrief, { strengths: 'Güçlü', developmentAreas: 'Gelişim' }),
    )
    debrief = ok(await finalize(t.admin, debrief))
    assert.equal(ok(await call('GET', debriefUrl(observation), selinCookie)).status, 'finalized')
    assertError(await patchDebrief(mentorCookie, debrief, { strengths: 'x' }), 403)
    assertError(await openGoal(selinCookie, { teacherMembershipId: selin.membershipId }), 403)
    assertError(await followUp(selinCookie, goal, { note: 'Kendi notum' }), 403)

    const listOf = async (cookie: string) =>
      ((await call('GET', GOALS, cookie)).json() as { data: Json[] }).data.map((row) => row.id)
    assert.deepEqual(await listOf(selinCookie), [goal.id])
    assert.deepEqual(await listOf(mentorCookie), [goal.id])
    assert.deepEqual(await listOf(otherCookie), [otherGoal.id])
    assertError(await call('GET', `${GOALS}/${String(goal.id)}`, otherCookie), 404)
    assert.equal(ok(await call('GET', `${GOALS}/${String(goal.id)}`, selinCookie)).id, goal.id)
    const reads = await audits(t.id, 'finance.development_goal.read')
    assert.ok(reads.length >= 4)
    assert.equal(JSON.stringify(reads).includes('kazanım'), false)
    assert.ok((await audits(t.id, 'finance.observation_debrief.read')).length >= 3)
  })

  test('DOM-FIN-133: başka kurumun görüşmesi ve hedefi 404 ve değişmez; gövdedeki institutionId 400', async () => {
    const a = await institution()
    const b = await institution()
    const setB = await setup(b)
    const debriefB = ok(
      await openDebrief(b.admin, setB.observation, {
        participantMembershipIds: [setB.selin.membershipId],
      }),
      201,
    )
    const goalB = ok(await openGoal(b.admin, { debriefId: debriefB.id }), 201)
    assertError(await call('GET', debriefUrl(setB.observation), a.admin), 404)
    assertError(
      await openDebrief(a.admin, setB.observation, {
        participantMembershipIds: [setB.selin.membershipId],
      }),
      404,
    )
    assertError(await patchDebrief(a.admin, debriefB, { strengths: 'x' }), 404)
    assertError(await finalize(a.admin, debriefB), 404)
    assertError(await call('GET', `${GOALS}/${String(goalB.id)}`, a.admin), 404)
    assertError(await patchGoal(a.admin, goalB, { title: 'Yeni hedef' }), 404)
    assertError(await followUp(a.admin, goalB, { note: 'Not' }), 404)
    assertError(
      await openGoal(a.admin, { debriefId: debriefB.id }),
      422,
      'development_goal_debrief_not_found',
    )
    assertError(
      await openGoal(a.admin, { teacherMembershipId: setB.selin.membershipId }),
      422,
      'development_goal_teacher_not_found',
    )
    const setA = await setup(a)
    assertError(
      await openGoal(a.admin, {
        teacherMembershipId: setA.selin.membershipId,
        institutionId: b.id,
      }),
      400,
    )
    assertError(
      await openDebrief(a.admin, setA.observation, {
        participantMembershipIds: [setA.selin.membershipId],
        institutionId: b.id,
      }),
      400,
    )
    const list = (await call('GET', GOALS, a.admin)).json() as { meta: { total: number } }
    assert.equal(list.meta.total, 0)
    const [storedDebrief] = await debriefRows(b.id)
    assert.equal(storedDebrief?.version, 1)
    const [storedGoal] = await goalRows(b.id)
    assert.equal(storedGoal?.version, 1)
  })

  test('DOM-FIN-133: finance modülü kapalıyken 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await call('GET', GOALS, closed.admin), 403, 'module_disabled')
    assertError(await openGoal(closed.admin, { teacherMembershipId: 'x' }), 403, 'module_disabled')
  })
})
