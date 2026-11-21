import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { lessonObservations } from '../src/db/schema/finance-lesson-observations.ts'
import {
  observationPlanNotices,
  observationPlans,
} from '../src/db/schema/finance-observation-plans.ts'
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
 * Ders gözlem planı uçları (DOM-FIN-139; ON-207; K-472…K-474). Her test kendi kurumunu kurar.
 * FIXED_NOW 2026-10-06 (İstanbul günü de 2026-10-06).
 */

const TODAY = '2026-10-06'
const PLANS = '/api/v1/finance/observation-plans'
const TEMPLATES = '/api/v1/finance/lesson-observation-templates'
const OBSERVATIONS = '/api/v1/finance/lesson-observations'
const PERIODS = '/api/v1/finance/performance-periods'
const levels = [0, 1, 2, 3, 4, 5].map((level) => ({ level, description: `Seviye ${level}` }))
const TEMPLATE = {
  name: 'Ders gözlem formu',
  criteria: [{ title: 'Sınıf yönetimi', weight: 1, levels }],
}

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-139: ders gözlem planı uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.207.0.1'

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
    clientIp = `10.207.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    const tenant = { id: created.id, admin: await signInAs(app, created.admin) }
    const form = ok(await call('POST', TEMPLATES, tenant.admin, TEMPLATE, key()), 201)
    return { ...tenant, templateId: String(form.id) }
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
  async function staff(t: Tenant) {
    return {
      selin: await person(t, 'ogretmen', 'Selin Kaya'),
      murat: await person(t, 'ogretmen', 'Murat Can'),
      mudur: await person(t, 'yonetici', 'Aylin Demir'),
    }
  }

  const create = (
    t: Tenant,
    body: Json,
    cookie: string | null = t.admin,
    headers: Record<string, string> = key(),
  ) =>
    call(
      'POST',
      PLANS,
      cookie,
      { templateId: t.templateId, plannedDate: '2026-10-08', startTime: '09:40', ...body },
      headers,
    )
  const command = (cookie: string | null, row: Json, verb: string, body: Json = {}) =>
    call('POST', `${PLANS}/${String(row.id)}/${verb}`, cookie, body, ifMatch(row.version))
  const patch = (cookie: string | null, row: Json, body: Json) =>
    call('PATCH', `${PLANS}/${String(row.id)}`, cookie, body, ifMatch(row.version))
  const planRows = (institutionId: string) =>
    db.select().from(observationPlans).where(eq(observationPlans.institutionId, institutionId))
  const noticeRows = (institutionId: string) =>
    db
      .select()
      .from(observationPlanNotices)
      .where(eq(observationPlanNotices.institutionId, institutionId))
  const listOf = async (cookie: string, query = '') =>
    (await call('GET', `${PLANS}${query}`, cookie)).json() as { data: Json[]; meta: Json }

  test('kimliksiz istek 401', async () => {
    const row = { id: randomUUID(), version: 1 }
    assertError(await call('GET', PLANS, null), 401)
    assertError(await call('GET', `${PLANS}/${row.id}`, null), 401)
    assertError(await call('POST', PLANS, null, {}, key()), 401)
    assertError(await patch(null, row, { note: 'x' }), 401)
    for (const verb of ['postpone', 'cancel', 'start'])
      assertError(await command(null, row, verb), 401)
  })

  test('DOM-FIN-139 K-472 K-474: plan açılır, düzeltilir, ertelenir, iptal edilir; her adımda öğretmene gönderilecek bildirim', async () => {
    const t = await institution()
    const { selin, mudur } = await staff(t)
    const headers = key()
    const body = {
      teacherMembershipId: selin.membershipId,
      observerMembershipId: mudur.membershipId,
      note: 'Soru teknikleri',
    }
    let plan = ok(await create(t, body, t.admin, headers), 201)
    const replay = await create(t, body, t.admin, headers)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((await planRows(t.id)).length, 1)
    assert.equal(plan.status, 'planned')
    assert.equal(plan.endTime, '10:20')
    assert.equal(plan.durationMinutes, 40)
    assert.equal(plan.teacherName, 'Selin Kaya')
    assert.equal(plan.observerName, 'Aylin Demir')
    assert.equal(plan.templateVersionNumber, 1)
    assert.equal(plan.pendingNoticeCount, 1)
    assert.equal(plan.overdue, false)

    plan = ok(await patch(t.admin, plan, { note: 'Ölçme' }))
    assert.equal(plan.pendingNoticeCount, 1, 'yalnız not değişince bildirim yok')
    plan = ok(await patch(t.admin, plan, { startTime: '11:00', durationMinutes: 80 }))
    assert.equal(plan.endTime, '12:20')
    assert.equal(plan.pendingNoticeCount, 2)

    assertError(
      await command(t.admin, plan, 'postpone', { plannedDate: '2026-10-09', startTime: '10:00' }),
      400,
    )
    assertError(
      await command(t.admin, plan, 'postpone', {
        plannedDate: '2026-10-08',
        startTime: '11:00',
        reason: 'Aynı saat',
      }),
      422,
      'observation_plan_same_slot',
    )
    plan = ok(
      await command(t.admin, plan, 'postpone', {
        plannedDate: '2026-10-09',
        startTime: '10:00',
        reason: 'Sınav haftası',
      }),
    )
    assert.equal(plan.status, 'postponed')
    assert.equal(plan.plannedDate, '2026-10-09')
    assert.equal(plan.postponeCount, 1)
    assert.equal(plan.postponeReason, 'Sınav haftası')

    assertError(await command(t.admin, plan, 'cancel', { reason: 'x' }), 400)
    plan = ok(await command(t.admin, plan, 'cancel', { reason: 'Öğretmen izinli' }))
    assert.equal(plan.status, 'cancelled')
    assertError(await patch(t.admin, plan, { note: 'Geç' }), 409, 'observation_plan_cancelled')

    const detail = ok(await call('GET', `${PLANS}/${String(plan.id)}`, t.admin))
    assert.deepEqual(
      // Sabit saatte bildirimlerin anı eşittir; sıra yerine içerik karşılaştırılır.
      (detail.notices as Json[]).map((n) => [n.kind, n.status, n.plannedDate, n.startTime]).sort(),
      [
        ['cancelled', 'pending', '2026-10-09', '10:00'],
        ['changed', 'pending', '2026-10-08', '11:00'],
        ['postponed', 'pending', '2026-10-09', '10:00'],
        ['scheduled', 'pending', '2026-10-08', '09:40'],
      ],
    )
    assert.deepEqual(
      [...new Set((await noticeRows(t.id)).map((row) => row.recipientMembershipId))],
      [selin.membershipId],
    )

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.entityType, 'observation_plans')))
    assert.deepEqual(audits.map((row) => row.action).sort(), [
      'finance.observation_plan.cancel',
      'finance.observation_plan.create',
      'finance.observation_plan.postpone',
      'finance.observation_plan.update',
      'finance.observation_plan.update',
    ])
    const text = JSON.stringify(audits.map((row) => row.changes))
    assert.equal(text.includes('Sınav'), false)
    assert.equal(text.includes('izinli'), false)
  })

  test('DOM-FIN-139 K-472: geçmiş gün, aynı kişi, gözlemci çakışması 422 ve kayıt eklenmez', async () => {
    const t = await institution()
    const { selin, murat, mudur } = await staff(t)
    const first = ok(
      await create(t, {
        teacherMembershipId: selin.membershipId,
        observerMembershipId: mudur.membershipId,
      }),
      201,
    )
    assertError(
      await create(t, {
        teacherMembershipId: murat.membershipId,
        observerMembershipId: mudur.membershipId,
        startTime: '10:00',
      }),
      422,
      'observation_plan_observer_busy',
    )
    assertError(
      await create(t, {
        teacherMembershipId: selin.membershipId,
        observerMembershipId: murat.membershipId,
        startTime: '10:00',
      }),
      422,
      'observation_plan_teacher_busy',
    )
    assertError(
      await create(t, {
        teacherMembershipId: murat.membershipId,
        observerMembershipId: mudur.membershipId,
        plannedDate: '2026-10-05',
      }),
      422,
      'observation_plan_date_past',
    )
    assertError(
      await create(t, {
        teacherMembershipId: selin.membershipId,
        observerMembershipId: selin.membershipId,
        startTime: '14:00',
      }),
      422,
      'observation_self',
    )
    assertError(
      await create(t, {
        teacherMembershipId: mudur.membershipId,
        observerMembershipId: selin.membershipId,
        startTime: '14:00',
      }),
      422,
      'observation_not_teacher',
    )
    assertError(
      await create(t, {
        teacherMembershipId: murat.membershipId,
        observerMembershipId: mudur.membershipId,
        startTime: '23:30',
      }),
      400,
    )
    // Bitişik saat çakışmaz; çakışan düzeltme 422 ve plan değişmez.
    const second = ok(
      await create(t, {
        teacherMembershipId: murat.membershipId,
        observerMembershipId: mudur.membershipId,
        startTime: '10:20',
      }),
      201,
    )
    assertError(
      await patch(t.admin, second, { startTime: '10:00' }),
      422,
      'observation_plan_observer_busy',
    )
    const rows = await planRows(t.id)
    assert.equal(rows.length, 2)
    assert.equal(rows.find((row) => row.id === second.id)?.startTime, '10:20')
    assert.equal(rows.find((row) => row.id === first.id)?.version, 1)
    assert.equal((await noticeRows(t.id)).length, 2)
  })

  test('DOM-FIN-139 K-472: öğretmen başına dönemde en çok 3 plan; iptal sayılmaz', async () => {
    const t = await institution()
    const { selin, mudur } = await staff(t)
    const period = ok(
      await call(
        'POST',
        PERIODS,
        t.admin,
        { name: '2026 güz', startDate: '2026-09-01', endDate: '2027-01-31' },
        key(),
      ),
      201,
    )
    const plan = (startTime: string) =>
      create(t, {
        teacherMembershipId: selin.membershipId,
        observerMembershipId: mudur.membershipId,
        performancePeriodId: period.id,
        startTime,
      })
    const first = ok(await plan('08:00'), 201)
    ok(await plan('09:00'), 201)
    ok(await plan('10:00'), 201)
    assertError(await plan('11:00'), 422, 'observation_plan_limit')
    assertError(
      await create(t, {
        teacherMembershipId: selin.membershipId,
        observerMembershipId: mudur.membershipId,
        performancePeriodId: period.id,
        plannedDate: '2027-02-02',
      }),
      422,
      'observation_plan_outside_period',
    )
    ok(await command(t.admin, first, 'cancel', { reason: 'Yanlış saat' }))
    ok(await plan('11:00'), 201)
    const list = await listOf(t.admin, `?performancePeriodId=${String(period.id)}&status=planned`)
    assert.equal(list.meta.total, 3)
    assert.equal((list.data[0] as Json).performancePeriodName, '2026 güz')
  })

  test('DOM-FIN-139 K-473: gözlem plandan başlar, tamamlanınca plan gerçekleşir; taslak arşivi bağı kaldırır', async () => {
    const t = await institution()
    const { selin, murat, mudur } = await staff(t)
    const future = ok(
      await create(t, {
        teacherMembershipId: selin.membershipId,
        observerMembershipId: mudur.membershipId,
      }),
      201,
    )
    assertError(await command(t.admin, future, 'start'), 422, 'observation_plan_not_due')
    let plan = ok(
      await create(t, {
        teacherMembershipId: selin.membershipId,
        observerMembershipId: mudur.membershipId,
        plannedDate: TODAY,
      }),
      201,
    )
    plan = ok(await command(t.admin, plan, 'start'))
    assert.equal(plan.observationStatus, 'draft')
    const observationId = String(plan.observationId)
    let observation = ok(await call('GET', `${OBSERVATIONS}/${observationId}`, t.admin))
    assert.equal(observation.observedDate, TODAY)
    assert.equal(observation.observerMembershipId, mudur.membershipId)
    assert.equal(observation.templateVersionId, plan.templateVersionId)
    assertError(await command(t.admin, plan, 'start'), 409, 'observation_plan_started')
    assertError(await patch(t.admin, plan, { note: 'x' }), 409, 'observation_plan_started')
    assertError(
      await command(t.admin, plan, 'cancel', { reason: 'Vazgeçildi' }),
      409,
      'observation_plan_started',
    )

    observation = ok(
      await call(
        'PATCH',
        `${OBSERVATIONS}/${observationId}`,
        t.admin,
        { ratings: [{ criterionId: 'k1', level: 4 }], generalNote: 'İyi ders' },
        ifMatch(observation.version),
      ),
    )
    ok(
      await call(
        'POST',
        `${OBSERVATIONS}/${observationId}/complete`,
        t.admin,
        {},
        ifMatch(observation.version),
      ),
    )
    plan = ok(await call('GET', `${PLANS}/${String(plan.id)}`, t.admin))
    assert.equal(plan.status, 'done')
    assert.equal(plan.observationStatus, 'completed')
    assert.equal(plan.doneAt, FIXED_NOW.toISOString())
    assertError(await patch(t.admin, plan, { note: 'x' }), 409, 'observation_plan_done')

    // Taslak arşivlenirse bağ kalkar, plan yeniden başlatılır.
    let other = ok(
      await create(t, {
        teacherMembershipId: murat.membershipId,
        observerMembershipId: mudur.membershipId,
        plannedDate: TODAY,
        startTime: '13:00',
      }),
      201,
    )
    other = ok(await command(t.admin, other, 'start'))
    const draft = ok(await call('GET', `${OBSERVATIONS}/${String(other.observationId)}`, t.admin))
    ok(
      await call(
        'POST',
        `${OBSERVATIONS}/${String(draft.id)}/archive`,
        t.admin,
        {},
        ifMatch(draft.version),
      ),
    )
    other = ok(await call('GET', `${PLANS}/${String(other.id)}`, t.admin))
    assert.equal(other.observationId, null)
    assert.equal(other.status, 'planned')
    other = ok(await command(t.admin, other, 'start'))
    assert.notEqual(other.observationId, draft.id)
    const observations = await db
      .select()
      .from(lessonObservations)
      .where(eq(lessonObservations.institutionId, t.id))
    assert.equal(observations.length, 3)

    // Günü geçmiş açık plan geciken sayılır (gün doğrudan geriye alınır).
    await db
      .update(observationPlans)
      .set({ plannedDate: '2026-10-01' })
      .where(eq(observationPlans.id, String(future.id)))
    const overdue = await listOf(t.admin, '?overdue=true')
    assert.deepEqual(
      overdue.data.map((row) => [row.id, row.overdue]),
      [[future.id, true]],
    )
  })

  test('DOM-FIN-139 K-474: ön büro 403; öğretmen yalnız kendi planını okur, yazamaz', async () => {
    const t = await institution()
    const { selin, murat, mudur } = await staff(t)
    const plan = ok(
      await create(t, {
        teacherMembershipId: selin.membershipId,
        observerMembershipId: mudur.membershipId,
      }),
      201,
    )
    const observed = ok(
      await create(t, {
        teacherMembershipId: murat.membershipId,
        observerMembershipId: selin.membershipId,
        plannedDate: '2026-10-09',
      }),
      201,
    )
    const frontDesk = await signInAs(app, await createMember(app, t.id, 'onburo'))
    assertError(await call('GET', PLANS, frontDesk), 403)
    assertError(await call('GET', `${PLANS}/${String(plan.id)}`, frontDesk), 403)
    const selinCookie = await signInAs(app, selin.user)
    const muratCookie = await signInAs(app, murat.user)
    const mine = await listOf(selinCookie)
    assert.deepEqual(mine.data.map((row) => row.id).sort(), [plan.id, observed.id].sort())
    const muratList = await listOf(muratCookie)
    assert.deepEqual(
      muratList.data.map((row) => row.id),
      [observed.id],
    )
    assertError(await call('GET', `${PLANS}/${String(plan.id)}`, muratCookie), 404)
    ok(await call('GET', `${PLANS}/${String(plan.id)}`, selinCookie))
    assertError(
      await create(
        t,
        { teacherMembershipId: murat.membershipId, observerMembershipId: selin.membershipId },
        selinCookie,
      ),
      403,
    )
    assertError(await patch(selinCookie, plan, { note: 'x' }), 403)
    assertError(await command(selinCookie, plan, 'cancel', { reason: 'Benim kararım' }), 403)
  })

  test('DOM-FIN-139: başka kurumun planı 404 ve değişmez; gövdedeki institutionId 400; liste ayrık', async () => {
    const a = await institution()
    const b = await institution()
    const staffA = await staff(a)
    const staffB = await staff(b)
    const rowB = ok(
      await create(b, {
        teacherMembershipId: staffB.selin.membershipId,
        observerMembershipId: staffB.mudur.membershipId,
        plannedDate: TODAY,
      }),
      201,
    )
    assertError(await call('GET', `${PLANS}/${String(rowB.id)}`, a.admin), 404)
    assertError(await patch(a.admin, rowB, { note: 'x' }), 404)
    assertError(
      await command(a.admin, rowB, 'postpone', {
        plannedDate: '2026-10-10',
        startTime: '10:00',
        reason: 'Başka kurum',
      }),
      404,
    )
    assertError(await command(a.admin, rowB, 'cancel', { reason: 'Başka kurum' }), 404)
    assertError(await command(a.admin, rowB, 'start'), 404)
    assertError(
      await create(a, {
        teacherMembershipId: staffA.selin.membershipId,
        observerMembershipId: staffA.mudur.membershipId,
        institutionId: b.id,
      }),
      400,
    )
    assertError(
      await create(a, {
        teacherMembershipId: staffA.selin.membershipId,
        observerMembershipId: staffA.mudur.membershipId,
        templateId: b.templateId,
      }),
      422,
      'observation_template_not_found',
    )
    assertError(
      await create(a, {
        teacherMembershipId: staffB.selin.membershipId,
        observerMembershipId: staffA.mudur.membershipId,
      }),
      422,
      'observation_teacher_not_found',
    )
    const list = await listOf(a.admin)
    assert.equal(list.meta.total, 0)
    const [row] = await planRows(b.id)
    assert.equal(row?.version, 1)
    assert.equal(row?.observationId, null)
    assert.equal((await planRows(a.id)).length, 0)
  })

  test('DOM-FIN-139: liste aralık ve kişi süzgeci; ters aralık ve bilinmeyen parametre 400', async () => {
    const t = await institution()
    const { selin, murat, mudur } = await staff(t)
    ok(
      await create(t, {
        teacherMembershipId: selin.membershipId,
        observerMembershipId: mudur.membershipId,
        plannedDate: '2026-10-12',
      }),
      201,
    )
    ok(
      await create(t, {
        teacherMembershipId: murat.membershipId,
        observerMembershipId: mudur.membershipId,
        plannedDate: '2026-10-20',
      }),
      201,
    )
    assert.equal((await listOf(t.admin, '?from=2026-10-12&to=2026-10-18')).meta.total, 1)
    assert.equal(
      (await listOf(t.admin, `?teacherMembershipId=${murat.membershipId}`)).meta.total,
      1,
    )
    assert.equal(
      (await listOf(t.admin, `?observerMembershipId=${mudur.membershipId}`)).meta.total,
      2,
    )
    assertError(await call('GET', `${PLANS}?from=2026-10-20&to=2026-10-01`, t.admin), 400)
    assertError(await call('GET', `${PLANS}?sort=x`, t.admin), 400)
  })

  test('DOM-FIN-139: finance modülü kapalıyken 403 module_disabled', async () => {
    clientIp = `10.207.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, { enabledModules: { finance: false } })
    const admin = await signInAs(app, created.admin)
    assertError(await call('GET', PLANS, admin), 403, 'module_disabled')
    assertError(await call('POST', PLANS, admin, {}, key()), 403, 'module_disabled')
  })
})
