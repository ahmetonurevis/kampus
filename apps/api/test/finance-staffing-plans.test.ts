import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { staffingPlans, staffingPositions } from '../src/db/schema/finance-staffing-plans.ts'
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

/**
 * Kadro planı ve açık pozisyon (DOM-FIN-126; ON-188; K-433…K-435). Her test kendi kurumunu kurar.
 * Selin (t1, aylık ücret) ve Murat (t2, saatlik) matematik, Ayla (t3, ücret tanımı yok) fen
 * öğretmeni. FIXED_NOW 2026-10-06 salı; hafta 2026-10-05…11.
 */

const FINANCE = '/api/v1/finance'
const PLAN = `${FINANCE}/staffing-plans/2026`
const POSITIONS = `${FINANCE}/staffing-positions`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

const teacher = (id: string, name: string, subjectId: string) => ({
  collection: 'teachers' as const,
  id,
  data: {
    id,
    name,
    subjectId,
    branchId: 'b1',
    email: `${id}@ornek.test`,
    phone: '05550000000',
    isActive: true,
  },
})
const lesson = (id: string, date: string, subjectId: string, cancelledAt?: string) => ({
  collection: 'schedule' as const,
  id,
  data: {
    id,
    classId: 'c1',
    teacherId: subjectId === 'mat' ? 't1' : 't3',
    subjectId,
    date,
    duration: 40,
    title: subjectId,
    room: '101',
    ...(cancelledAt === undefined ? {} : { cancelledAt }),
  },
})
const SAMPLE = [
  teacher('t1', 'Selin Kaya', 'mat'),
  teacher('t2', 'Murat Demir', 'mat'),
  teacher('t3', 'Ayla Şen', 'fen'),
  { collection: 'subjects' as const, id: 'mat', data: { id: 'mat', name: 'Matematik' } },
  { collection: 'subjects' as const, id: 'fen', data: { id: 'fen', name: 'Fen Bilimleri' } },
  { collection: 'classes' as const, id: 'c1', data: { id: 'c1', name: '9-A', grade: 9 } },
  lesson('l1', '2026-10-05T06:00:00.000Z', 'mat'),
  lesson('l2', '2026-10-06T06:00:00.000Z', 'mat'),
  lesson('l3', '2026-10-09T06:00:00.000Z', 'mat'),
  lesson('l4', '2026-10-07T06:00:00.000Z', 'fen'),
  lesson('l5', '2026-10-08T06:00:00.000Z', 'fen', '2026-10-01T09:00:00.000Z'),
  // Sonraki hafta: önerine girmez.
  lesson('l6', '2026-10-12T06:00:00.000Z', 'mat'),
]

describe('DOM-FIN-126: kadro planı ve açık pozisyon uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.188.0.1'

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
    clientIp = `10.188.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(db, created.id, SAMPLE, FIXED_NOW)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  async function person(t: Tenant, role: Role, name: string, teacherId: string) {
    const user = await createUser(app, { name })
    const membership = await ensureMember(app.auth, db, {
      institutionId: t.id,
      userId: user.id,
      role,
    })
    await ensureMembershipLinks(db, t.id, membership.id, [{ kind: 'teacher', recordId: teacherId }])
    return membership.id
  }
  const wage = (t: Tenant, membershipId: string, rateType: string) =>
    call(
      'POST',
      `${FINANCE}/pay-rates`,
      t.admin,
      {
        component: 'wage',
        rateType,
        membershipId,
        amountCents: 3_000_000,
        startDate: '2026-09-01',
      },
      key(),
    )
  async function scene(t: Tenant) {
    const selin = await person(t, 'ogretmen', 'Selin Kaya', 't1')
    const murat = await person(t, 'ogretmen', 'Murat Demir', 't2')
    await person(t, 'ogretmen', 'Ayla Şen', 't3')
    ok(await wage(t, selin, 'monthly_gross'), 201)
    ok(await wage(t, murat, 'hourly'), 201)
  }
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))
  const savePlan = (cookie: string | null, payload: unknown, version: unknown, url = PLAN) =>
    call('PATCH', url, cookie, payload, { ...ifMatch(version), ...key() })
  const openPosition = (cookie: string | null, payload: Json) =>
    call('POST', POSITIONS, cookie, { academicYear: 2026, subjectId: 'mat', ...payload }, key())
  const patchPosition = (cookie: string | null, id: string, payload: unknown, version: unknown) =>
    call('PATCH', `${POSITIONS}/${id}`, cookie, payload, { ...ifMatch(version), ...key() })
  const rowOf = (plan: Json, subjectId: string) =>
    (plan.rows as Json[]).find((row) => row.subjectId === subjectId)
  const planRows = (institutionId: string) =>
    db.select().from(staffingPlans).where(eq(staffingPlans.institutionId, institutionId))
  const positionRows = (institutionId: string) =>
    db.select().from(staffingPositions).where(eq(staffingPositions.institutionId, institutionId))
  const auditOf = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  test('DOM-FIN-126 K-433 K-434: varsayılan plan programdan öneri, saatlik öğretmen kapasiteye girmez', async () => {
    const t = await institution()
    await scene(t)
    const plan = ok(await call('GET', PLAN, t.admin))
    assert.equal(plan.normHours, 20)
    assert.equal(plan.version, 1)
    assert.deepEqual(plan.week, { startDate: '2026-10-05', endDate: '2026-10-11' })
    assert.equal(plan.teachersWithoutPayRate, 1)
    assert.deepEqual(rowOf(plan, 'mat'), {
      subjectId: 'mat',
      subjectName: 'Matematik',
      requiredSource: 'schedule',
      requiredHours: 3,
      scheduleHours: 3,
      fullTimeTeachers: 1,
      hourlyTeachers: 1,
      capacityHours: 20,
      gapHours: 0,
      surplusHours: 17,
      openPositionHours: 0,
      suggestedHours: 0,
      suggestedFte: 0,
    })
    // İptal edilen ders sayılmaz; ücret tanımı olmayan Ayla tam zamanlı.
    assert.equal(rowOf(plan, 'fen')?.scheduleHours, 1)
    assert.equal(rowOf(plan, 'fen')?.capacityHours, 20)
    const next = ok(await call('GET', `${PLAN}?weekOf=2026-10-14`, t.admin))
    assert.equal(rowOf(next, 'mat')?.scheduleHours, 1)
    assertError(await call('GET', `${PLAN}?weekOf=2026-13-01`, t.admin), 400)
    assertError(await call('GET', `${FINANCE}/staffing-plans/1999`, t.admin), 400)
  })

  test('DOM-FIN-126 K-433 K-435: plan kaydı, açık pozisyon düşümü ve tam zamanlı eşdeğeri', async () => {
    const t = await institution()
    await scene(t)
    const lines = [{ subjectId: 'mat', requiredHours: 50 }]
    const saved = ok(await savePlan(t.admin, { normHours: 18, lines }, 1))
    assert.equal(saved.version, 2)
    assert.equal((await planRows(t.id)).length, 1)
    assert.deepEqual((await auditOf(t.id, 'finance.staffing_plan.save'))[0]?.changes, {
      fields: ['normHours', 'lines'],
    })
    assertError(
      await savePlan(t.admin, { normHours: 18, lines }, 2),
      422,
      'staffing_plan_unchanged',
    )
    assertError(await savePlan(t.admin, { normHours: 19, lines }, 1), 409)
    const position = ok(await openPosition(t.admin, { hours: 10, note: 'Lise matematik' }), 201)
    assert.equal(position.status, 'open')
    const plan = ok(await call('GET', PLAN, t.admin))
    const mat = rowOf(plan, 'mat')
    assert.equal(mat?.requiredSource, 'plan')
    assert.equal(mat?.capacityHours, 18)
    assert.equal(mat?.gapHours, 32)
    assert.equal(mat?.openPositionHours, 10)
    assert.equal(mat?.suggestedHours, 22)
    assert.equal(mat?.suggestedFte, 1.2)
    assert.equal((plan.positions as Json[])[0]?.subjectName, 'Matematik')
    // Başka eğitim yılı ayrı plandır.
    assert.equal(ok(await call('GET', `${FINANCE}/staffing-plans/2027`, t.admin)).version, 1)
  })

  test('DOM-FIN-126: plan doğrulaması 400 ve kayıt değişmez', async () => {
    const t = await institution()
    const twice = [
      { subjectId: 'mat', requiredHours: 1 },
      { subjectId: 'mat', requiredHours: 2 },
    ]
    assertError(await savePlan(t.admin, { normHours: 20, lines: twice }, 1), 400)
    assertError(await savePlan(t.admin, { normHours: 0, lines: [] }, 1), 400)
    assertError(
      await call('PATCH', PLAN, t.admin, { normHours: 20, lines: [] }, key()),
      400,
      'if_match_required',
    )
    assert.equal((await planRows(t.id)).length, 0)
  })

  test('DOM-FIN-126 K-435: pozisyon durum geçişleri, teklif bağı ve mükerrer istek', async () => {
    const t = await institution()
    const headers = key()
    const first = await call(
      'POST',
      POSITIONS,
      t.admin,
      { academicYear: 2026, subjectId: 'fen', hours: 20 },
      headers,
    )
    const position = ok(first, 201)
    const replay = await call(
      'POST',
      POSITIONS,
      t.admin,
      { academicYear: 2026, subjectId: 'fen', hours: 20 },
      headers,
    )
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((await positionRows(t.id)).length, 1)
    assertError(
      await call('POST', POSITIONS, t.admin, { academicYear: 2026, subjectId: 'fen', hours: 2 }),
      400,
    )
    assertError(
      await openPosition(t.admin, { hours: 5, jobOfferId: randomUUID() }),
      422,
      'staffing_position_offer_not_found',
    )
    const offer = ok(
      await call(
        'POST',
        `${FINANCE}/job-offers`,
        t.admin,
        {
          candidateName: 'Aday Öğretmen',
          position: 'Fen öğretmeni',
          staffRole: 'ogretmen',
          startDate: '2026-11-01',
          wageType: 'monthly_gross',
          offeredAmountCents: 4_000_000,
        },
        key(),
      ),
      201,
    )
    const posted = ok(
      await patchPosition(
        t.admin,
        position.id as string,
        { status: 'posted', jobOfferId: offer.id },
        1,
      ),
    )
    assert.equal(posted.status, 'posted')
    assert.equal(posted.jobOfferPosition, 'Fen öğretmeni')
    assertError(await patchPosition(t.admin, position.id as string, { hours: 4 }, 1), 409)
    const filled = ok(await patchPosition(t.admin, position.id as string, { status: 'filled' }, 2))
    assert.equal(filled.version, 3)
    assertError(
      await patchPosition(t.admin, position.id as string, { status: 'open' }, 3),
      422,
      'staffing_position_closed',
    )
    const plan = ok(await call('GET', PLAN, t.admin))
    assert.equal(rowOf(plan, 'fen')?.openPositionHours, 0)
    assert.equal((await auditOf(t.id, 'finance.staffing_position.update')).length, 2)
    assert.equal((await auditOf(t.id, 'finance.staffing_position.create')).length, 1)
  })

  test('DOM-FIN-126: 401, rol 403, modül kapalı 403', async () => {
    const t = await institution()
    assertError(await call('GET', PLAN, null), 401)
    assertError(await savePlan(null, { normHours: 20, lines: [] }, 1), 401)
    assertError(await openPosition(null, { hours: 5 }), 401)
    for (const role of ['ogretmen', 'onburo', 'veli'] as const) {
      const cookie = await member(t.id, role)
      assertError(await call('GET', PLAN, cookie), 403)
      assertError(await savePlan(cookie, { normHours: 20, lines: [] }, 1), 403)
      assertError(await openPosition(cookie, { hours: 5 }), 403)
    }
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await call('GET', PLAN, closed.admin), 403)
    assertError(await openPosition(closed.admin, { hours: 5 }), 403)
    assert.equal((await positionRows(t.id)).length, 0)
  })

  test('DOM-FIN-126: başka kurumun pozisyonu ve teklifi 404/422, B değişmez; gövdedeki kurum etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const position = ok(await openPosition(b.admin, { hours: 6 }), 201)
    const offer = ok(
      await call(
        'POST',
        `${FINANCE}/job-offers`,
        b.admin,
        {
          candidateName: 'Başka Aday',
          position: 'Matematik öğretmeni',
          staffRole: 'ogretmen',
          startDate: '2026-11-01',
          wageType: 'monthly_gross',
          offeredAmountCents: 4_000_000,
        },
        key(),
      ),
      201,
    )
    assertError(
      await patchPosition(a.admin, position.id as string, { status: 'cancelled' }, 1),
      404,
    )
    assertError(
      await openPosition(a.admin, { hours: 5, jobOfferId: offer.id }),
      422,
      'staffing_position_offer_not_found',
    )
    assertError(await openPosition(a.admin, { hours: 5, institutionId: b.id }), 400)
    assertError(await savePlan(a.admin, { normHours: 21, lines: [], institutionId: b.id }, 1), 400)
    ok(await savePlan(b.admin, { normHours: 22, lines: [] }, 1))
    const aPlan = ok(await call('GET', PLAN, a.admin))
    assert.equal(aPlan.normHours, 20)
    assert.deepEqual(aPlan.positions, [])
    const [bRow] = await positionRows(b.id)
    assert.equal(bRow?.status, 'open')
    assert.equal(bRow?.version, 1)
    assert.equal((await positionRows(a.id)).length, 0)
  })
})
