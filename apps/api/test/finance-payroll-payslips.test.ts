import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { payrollRunLines, payrollRuns } from '../src/db/schema/finance-payroll-runs.ts'
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
 * Ücret hesap pusulası ucu (DOM-FIN-119; ON-201; K-406…K-408). Her test kendi kurumunu kurar;
 * ücret tanımı ücret ucuyla, hesap kaydı bordro hesabı ucuyla (DOM-FIN-115), dönem onayı dönem
 * ucuyla (DOM-FIN-108) yazılır. FIXED_NOW 2026-10-06; tutarlar `finance-payroll-runs.test.ts`
 * örnekleridir.
 */

const FINANCE = '/api/v1/finance'
const CALC = `${FINANCE}/payroll-calculations`
const RUNS = `${FINANCE}/payroll-runs`
const RATES = `${FINANCE}/pay-rates`
const PERIODS = `${FINANCE}/payroll-periods`
const GARNISHMENTS = `${FINANCE}/staff-garnishments`
const ACTION = 'finance.payroll_payslip.export'

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-119: ücret hesap pusulası ucu', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.119.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST',
    url: string,
    cookie: string | null,
    payload?: unknown,
    headers: Record<string, string> = {},
    target: App = app,
  ) {
    return target.inject({
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
  const key = () => ({ 'idempotency-key': randomUUID() })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.119.${String((tenantCount += 1))}.1`
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
  async function wage(t: Tenant, membershipId: string, amountCents: number) {
    ok(
      await call('POST', RATES, t.admin, {
        component: 'wage',
        membershipId,
        rateType: 'monthly_gross',
        amountCents,
        startDate: '2026-01-01',
      }),
      201,
    )
  }
  const saveRun = async (t: Tenant, month: string) =>
    ok(
      await call('POST', `${RUNS}/${month}/calculate`, t.admin, { previousRunId: null }, key()),
      201,
    )
  const slipsUrl = (month: string, membershipId?: string) =>
    `${RUNS}/${month}/payslips${membershipId === undefined ? '' : `?membershipId=${membershipId}`}`
  const slipsOf = (data: Json) => data.payslips as Json[]
  const auditOf = (institutionId: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, ACTION)))
  const runRows = (institutionId: string) =>
    db.select().from(payrollRuns).where(eq(payrollRuns.institutionId, institutionId))
  const lineRows = (institutionId: string) =>
    db.select().from(payrollRunLines).where(eq(payrollRunLines.institutionId, institutionId))

  test('kimliksiz istek 401', async () => {
    assertError(await get(slipsUrl('2026-01'), null), 401)
    assertError(await get(slipsUrl('2026-01', 'm-1'), null), 401)
  })

  test('DOM-FIN-119, K-408: ön büro, öğretmen, veli ve öğrenci 403; denetim yazılmaz', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    await wage(t, selin, 3_303_000)
    await saveRun(t, '2026-01')
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(slipsUrl('2026-01'), cookie), 403)
      assertError(await get(slipsUrl('2026-01', selin), cookie), 403)
    }
    assert.equal((await auditOf(t.id)).length, 0)
  })

  test('DOM-FIN-119: finance modülü kapalıyken 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(slipsUrl('2026-01'), closed.admin), 403, 'module_disabled')
  })

  test('DOM-FIN-119: 400 geçersiz ay ve sorgu; denetim yazılmaz', async () => {
    const t = await institution()
    assertError(await get(slipsUrl('2026-13'), t.admin), 400)
    assertError(await get(`${RUNS}/2026-01/payslips?membershipId=`, t.admin), 400)
    assertError(await get(`${RUNS}/2026-01/payslips?page=1`, t.admin), 400)
    assert.equal((await auditOf(t.id)).length, 0)
  })

  test('DOM-FIN-119, K-406: kayıtlı hesap yoksa 404; önizleme pusula üretmez', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    await wage(t, selin, 3_303_000)
    ok(await get(`${CALC}/2026-01`, t.admin))
    assertError(await get(slipsUrl('2026-01'), t.admin), 404)
    assertError(await get(slipsUrl('2026-01', selin), t.admin), 404)
    assert.equal((await auditOf(t.id)).length, 0)
  })

  test('DOM-FIN-119, K-406, K-407: toplu ve tek pusula kayıtlı hesaptan; işveren maliyeti ve kaynak kimliği yok; pusula başına denetim (K-408)', async () => {
    const t = await institution()
    const deniz = await person(t, 'onburo', 'Deniz Yılmaz')
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const outside = await person(t, 'ogretmen', 'Hesapta Olmayan')
    await wage(t, deniz, 3_303_000)
    await wage(t, selin, 15_000_000)
    const garnishment = ok(
      await call('POST', GARNISHMENTS, t.admin, {
        membershipId: deniz,
        office: 'İstanbul 5. İcra Dairesi',
        fileNumber: '2026/1234',
        claimCents: 5_000_000,
        receivedDate: '2025-12-01',
      }),
      201,
    )
    const run = await saveRun(t, '2026-01')
    // Kayıttan sonra ücret değişir: pusula kayıtlı hesabı yazar, önizlemeyi değil.
    await call('POST', RATES, t.admin, {
      component: 'wage',
      membershipId: selin,
      rateType: 'monthly_gross',
      amountCents: 20_000_000,
      startDate: '2026-01-15',
    })

    const all = ok(await get(slipsUrl('2026-01'), t.admin))
    assert.equal(all.runId, run.id)
    assert.equal(all.revision, 1)
    assert.equal(all.locked, false)
    assert.equal(typeof all.institutionName, 'string')
    assert.ok(String(all.institutionName).length > 0)
    assert.deepEqual(
      slipsOf(all).map((slip) => slip.name),
      ['Deniz Yılmaz', 'Selin Kaya'],
    )
    const denizSlip = slipsOf(all)[0]!
    assert.equal(denizSlip.grossCents, 3_303_000)
    assert.equal(denizSlip.sgkEmployeeCents, 462_420)
    assert.equal(denizSlip.incomeTaxExemptionCents, 421_133)
    assert.equal(denizSlip.netCents, 2_807_550)
    assert.equal(denizSlip.deductionCents, 701_887)
    assert.equal(denizSlip.payableCents, 2_807_550 - 701_887)
    assert.deepEqual(denizSlip.deductions, [{ kind: 'garnishment', amountCents: 701_887 }])
    const body = JSON.stringify(all)
    for (const hidden of [
      'employerCostCents',
      'sgkEmployerCents',
      'medicalReportDays',
      'warnings',
      String(garnishment.id),
      '2026/1234',
    ])
      assert.ok(!body.includes(hidden), hidden)
    assert.equal(slipsOf(all)[1]!.grossCents, 15_000_000)

    const single = ok(await get(slipsUrl('2026-01', selin), t.admin))
    assert.deepEqual(
      slipsOf(single).map((slip) => slip.membershipId),
      [selin],
    )
    assertError(await get(slipsUrl('2026-01', outside), t.admin), 404)

    // Pusula başına bir kayıt, satır kimliğiyle; tutar yazılmaz.
    const audit = await auditOf(t.id)
    assert.equal(audit.length, 3)
    const lineIds = new Set((await lineRows(t.id)).map((line) => line.id))
    assert.ok(audit.every((entry) => entry.entityId !== null && lineIds.has(entry.entityId)))
    assert.ok(audit.every((entry) => entry.entityType === 'payroll_run_lines'))
    assert.ok(!JSON.stringify(audit.map((entry) => entry.changes)).includes('3303000'))
  })

  test('DOM-FIN-119, K-406: onaylı ayın pusulası locked; pusula kayıt değiştirmez', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    await wage(t, selin, 3_303_000)
    await saveRun(t, '2026-03')
    const year = ok(await get(`${PERIODS}?year=2026`, t.admin)) as { months: Json[] }
    const march = year.months.find((item) => item.month === '2026-03')
    const hash = (march?.current as Json | null)?.inputsHash
    ok(await call('POST', `${PERIODS}/2026-03/approve`, t.admin, { inputsHash: hash }, key()), 201)
    const runs = await runRows(t.id)
    const lines = await lineRows(t.id)
    const data = ok(await get(slipsUrl('2026-03', selin), t.admin))
    assert.equal(data.locked, true)
    assert.deepEqual(await runRows(t.id), runs)
    assert.deepEqual(await lineRows(t.id), lines)
  })

  test('DOM-FIN-119, K-408: pusula taze oturum ister; eski oturumda 403 ve denetim yok', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    await wage(t, selin, 3_303_000)
    await saveRun(t, '2026-01')
    const later = await buildTestApp(db, { clock: () => new Date(Date.now() + 16 * 60 * 1000) })
    try {
      assertError(
        await call('GET', slipsUrl('2026-01'), t.admin, undefined, {}, later),
        403,
        'reauthentication_required',
      )
    } finally {
      await later.close()
    }
    assert.equal((await auditOf(t.id)).length, 0)
  })

  test('DOM-FIN-119, K-408: kullanıcı başına dakikada 10 pusula üretimi, sonra 429', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    await wage(t, selin, 3_303_000)
    await saveRun(t, '2026-01')
    for (let index = 0; index < 10; index += 1) ok(await get(slipsUrl('2026-01', selin), t.admin))
    assertError(await get(slipsUrl('2026-01', selin), t.admin), 429)
    assert.equal((await auditOf(t.id)).length, 10)
  })

  test('DOM-FIN-119: başka kurumun hesabı ve personeli 404, B değişmez; gövde/sorgudaki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bStaff = await person(b, 'ogretmen', 'Kurum B Öğretmen')
    await wage(b, bStaff, 3_303_000)
    await saveRun(b, '2026-01')
    const aStaff = await person(a, 'ogretmen', 'Kurum A Öğretmen')
    await wage(a, aStaff, 3_303_000)
    await saveRun(a, '2026-02')
    const bRuns = await runRows(b.id)
    const bLines = await lineRows(b.id)

    assertError(await get(slipsUrl('2026-01'), a.admin), 404)
    assertError(await get(slipsUrl('2026-01', bStaff), a.admin), 404)
    assertError(await get(slipsUrl('2026-02', bStaff), a.admin), 404)
    assertError(await get(`${RUNS}/2026-01/payslips?institutionId=${b.id}`, a.admin), 400)
    const own = ok(await get(slipsUrl('2026-02'), a.admin))
    assert.deepEqual(
      slipsOf(own).map((slip) => slip.membershipId),
      [aStaff],
    )
    assert.deepEqual(await runRows(b.id), bRuns)
    assert.deepEqual(await lineRows(b.id), bLines)
    assert.equal((await auditOf(b.id)).length, 0)
  })
})
