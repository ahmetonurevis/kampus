import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  payrollRunLines,
  payrollRuns,
  payrollTaxCarryovers,
} from '../src/db/schema/finance-payroll-runs.ts'
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
 * Bordro hesabı uçları (DOM-FIN-115; ON-198; K-387…K-391). Her test kendi kurumunu kurar; ücret
 * tanımı ücret ucuyla (DOM-FIN-099), kesinti kesinti ucuyla (DOM-FIN-101), dönem onayı dönem
 * ucuyla (DOM-FIN-108) yazılır. FIXED_NOW 2026-10-06. Beklenen tutarlar core testindeki
 * (`tests/finance-payroll-calc.test.ts`) 2026 örnekleridir.
 */

const FINANCE = '/api/v1/finance'
const CALC = `${FINANCE}/payroll-calculations`
const RUNS = `${FINANCE}/payroll-runs`
const CARRYOVERS = `${FINANCE}/payroll-tax-carryovers`
const RATES = `${FINANCE}/pay-rates`
const PERIODS = `${FINANCE}/payroll-periods`
const GARNISHMENTS = `${FINANCE}/staff-garnishments`
const LESSON_HOURS = `${FINANCE}/payroll-lesson-hours`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-115: bordro hesabı uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.115.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST' | 'DELETE',
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
  const get = (url: string, cookie: string | null, headers: Record<string, string> = {}) =>
    call('GET', url, cookie, undefined, headers)
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
    clientIp = `10.115.${String((tenantCount += 1))}.1`
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
  async function rate(t: Tenant, body: Json) {
    ok(await call('POST', RATES, t.admin, body), 201)
  }
  const wage = (membershipId: string, amountCents: number, startDate = '2026-01-01') => ({
    component: 'wage',
    membershipId,
    rateType: 'monthly_gross',
    amountCents,
    startDate,
  })
  const preview = async (cookie: string, month: string) => ok(await get(`${CALC}/${month}`, cookie))
  const rowsOf = (data: Json) => data.rows as Json[]
  const rowOf = (data: Json, membershipId: string) => {
    const found = rowsOf(data).find((row) => row.membershipId === membershipId)
    assert.ok(found, `${membershipId} satırı yok`)
    return found
  }
  const save = (
    cookie: string | null,
    month: string,
    previousRunId: string | null,
    headers: Record<string, string> = key(),
  ) => call('POST', `${RUNS}/${month}/calculate`, cookie, { previousRunId }, headers)
  const addCarryover = (cookie: string | null, body: Json, headers: Record<string, string> = {}) =>
    call('POST', CARRYOVERS, cookie, body, headers)
  const runRows = (institutionId: string) =>
    db.select().from(payrollRuns).where(eq(payrollRuns.institutionId, institutionId))
  const lineRows = (institutionId: string) =>
    db.select().from(payrollRunLines).where(eq(payrollRunLines.institutionId, institutionId))
  const carryoverRows = (institutionId: string) =>
    db
      .select()
      .from(payrollTaxCarryovers)
      .where(eq(payrollTaxCarryovers.institutionId, institutionId))
  const auditOf = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  test('kimliksiz istek 401', async () => {
    assertError(await get(`${CALC}/2026-01`, null), 401)
    assertError(await get(`${RUNS}/2026-01`, null), 401)
    assertError(await save(null, '2026-01', null), 401)
    assertError(await get(`${CARRYOVERS}?year=2026`, null), 401)
    assertError(
      await addCarryover(null, { membershipId: 'm', year: 2026, incomeTaxBaseCents: 1 }),
      401,
    )
    assertError(
      await call('DELETE', `${CARRYOVERS}/${randomUUID()}`, null, undefined, ifMatch(1)),
      401,
    )
  })

  test('DOM-FIN-115: ön büro, öğretmen, veli ve öğrenci 403; kayıt yazılmaz (K-391)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    await rate(t, wage(selin, 3_303_000))
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(`${CALC}/2026-01`, cookie), 403)
      assertError(await get(`${RUNS}/2026-01`, cookie), 403)
      assertError(await save(cookie, '2026-01', null), 403)
      assertError(await get(`${CARRYOVERS}?year=2026`, cookie), 403)
      assertError(
        await addCarryover(cookie, { membershipId: selin, year: 2026, incomeTaxBaseCents: 100 }),
        403,
      )
    }
    assert.equal((await runRows(t.id)).length, 0)
    assert.equal((await carryoverRows(t.id)).length, 0)
    assert.equal((await auditOf(t.id, 'finance.payroll_calculation.read')).length, 0)
  })

  test('DOM-FIN-115: finance modülü kapalıyken uçlar 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(`${CALC}/2026-01`, closed.admin), 403, 'module_disabled')
    assertError(await save(closed.admin, '2026-01', null), 403, 'module_disabled')
    assertError(
      await addCarryover(closed.admin, { membershipId: 'm', year: 2026, incomeTaxBaseCents: 1 }),
      403,
      'module_disabled',
    )
  })

  test('DOM-FIN-115: 400 geçersiz ay, gövde ve sorgu; kayıt değişmez', async () => {
    const t = await institution()
    assertError(await get(`${CALC}/2026-13`, t.admin), 400)
    assertError(await get(`${RUNS}/26-01`, t.admin), 400)
    assertError(await call('POST', `${RUNS}/2026-01/calculate`, t.admin, {}, key()), 400)
    assertError(await save(t.admin, '2026-01', 'x'), 400)
    assertError(await save(t.admin, '2026-01', null, {}), 400)
    assertError(await get(`${CARRYOVERS}?year=1999`, t.admin), 400)
    assertError(await get(`${CARRYOVERS}?year=2026&q=x`, t.admin), 400)
    assertError(
      await addCarryover(t.admin, { membershipId: 'm', year: 2026, incomeTaxBaseCents: 0 }),
      400,
    )
    assert.equal((await runRows(t.id)).length, 0)
  })

  test('DOM-FIN-115: önizleme brütten nete hesaplar, okuma denetime düşer (K-387, K-388)', async () => {
    const t = await institution()
    const deniz = await person(t, 'onburo', 'Deniz Asgari')
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    await rate(t, wage(deniz, 3_303_000))
    await rate(t, wage(selin, 15_000_000))
    await rate(t, {
      component: 'lesson',
      membershipId: selin,
      rateType: 'extra',
      amountCents: 25_000,
      startDate: '2026-01-01',
    })
    ok(
      await call('POST', LESSON_HOURS, t.admin, {
        membershipId: selin,
        month: '2026-01',
        lessonType: 'extra',
        hours: 10,
      }),
      201,
    )
    const data = await preview(t.admin, '2026-01')
    assert.equal(data.locked, false)
    assert.equal(data.saved, null)
    assert.equal((data.parameters as Json).setId, 'platform-2026-01-01')
    const minimum = rowOf(data, deniz)
    assert.equal(minimum.grossCents, 3_303_000)
    assert.equal(minimum.sgkEmployeeCents, 462_420)
    assert.equal(minimum.incomeTaxExemptionCents, 421_133)
    assert.equal(minimum.incomeTaxPayableCents, 0)
    assert.equal(minimum.stampTaxPayableCents, 0)
    assert.equal(minimum.netCents, 2_807_550)
    assert.equal(minimum.employerCostCents, 3_889_283)
    const high = rowOf(data, selin)
    assert.equal(high.grossCents, 15_250_000)
    assert.deepEqual(
      (high.earnings as Json[]).map((item) => [item.kind, item.amountCents]),
      [
        ['wage', 15_000_000],
        ['lesson', 250_000],
      ],
    )
    assert.equal((data.totals as Json).completeCount, 2)
    const audit = await auditOf(t.id, 'finance.payroll_calculation.read')
    assert.equal(audit.length, 1)
    assert.equal(audit[0]?.entityId, 'payroll-calculation:2026-01')
    assert.ok(!JSON.stringify(audit[0]?.changes).includes('3303000'))
  })

  test('DOM-FIN-115: icra kesintisi net ücretin dörtte biri, ödenecek netten düşer', async () => {
    const t = await institution()
    const deniz = await person(t, 'onburo', 'Deniz Yılmaz')
    await rate(t, wage(deniz, 3_303_000))
    ok(
      await call('POST', GARNISHMENTS, t.admin, {
        membershipId: deniz,
        office: 'İstanbul 5. İcra Dairesi',
        fileNumber: '2026/1234',
        claimCents: 5_000_000,
        receivedDate: '2025-12-01',
      }),
      201,
    )
    const row = rowOf(await preview(t.admin, '2026-01'), deniz)
    assert.equal(row.deductionCents, 701_887)
    assert.equal(row.payableCents, 2_807_550 - 701_887)
  })

  test('DOM-FIN-115: kaydetme, kümülatif matrah, yeniden hesaplama ve yarış (K-388, K-391)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    await rate(t, wage(selin, 15_000_000))
    const idem = key()
    const first = ok(await save(t.admin, '2026-01', null, idem), 201)
    // Aynı anahtarla tekrar: ikinci hesap açılmaz.
    const replay = await save(t.admin, '2026-01', null, idem)
    assert.equal(replay.statusCode, 201, replay.body)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((await runRows(t.id)).length, 1)
    const run = ok(await get(`${RUNS}/2026-01`, t.admin))
    assert.equal(run.id, first.id)
    assert.equal(run.revision, 1)
    assert.equal(rowsOf(run).length, 1)
    assert.equal(rowOf(run, selin).incomeTaxBaseCents, 12_750_000)

    // Şubat: kayıtlı ocak matrahı kümülatife girer.
    const february = rowOf(await preview(t.admin, '2026-02'), selin)
    assert.equal(february.cumulativeIncomeTaxBaseBeforeCents, 12_750_000)
    assert.equal(february.incomeTaxCents, 2_237_500)
    assert.deepEqual(february.warnings, [])
    // Mart: şubat kaydedilmedi.
    const march = rowOf(await preview(t.admin, '2026-03'), selin)
    assert.ok((march.warnings as string[]).includes('previous_month_not_saved'))

    // Yarış: ekranda görülen kayıt güncel değil.
    assertError(await save(t.admin, '2026-01', null), 409, 'payroll_run_changed')
    assertError(await save(t.admin, '2026-01', randomUUID()), 409, 'payroll_run_changed')
    // Ücret değişir, ay yeniden hesaplanır: eski kayıt arşivlenir, revizyon 2.
    await rate(t, wage(selin, 16_000_000, '2026-01-15'))
    const second = ok(await save(t.admin, '2026-01', String(first.id)), 200)
    const runs = await runRows(t.id)
    assert.equal(runs.length, 2)
    assert.equal(runs.find((item) => item.id === first.id)?.archivedAt instanceof Date, true)
    const current = ok(await get(`${RUNS}/2026-01`, t.admin))
    assert.equal(current.id, second.id)
    assert.equal(current.revision, 2)
    assert.ok(Number(rowOf(current, selin).grossCents) > 15_000_000)
    // Kayıtlı satırlar değişmez; arşivli hesabın satırları kümülatife girmez.
    assert.equal((await lineRows(t.id)).length, 2)
    const febAfter = rowOf(await preview(t.admin, '2026-02'), selin)
    assert.equal(
      febAfter.cumulativeIncomeTaxBaseBeforeCents,
      rowOf(current, selin).incomeTaxBaseCents,
    )
    assert.equal((await auditOf(t.id, 'finance.payroll_run.save')).length, 2)
    assert.equal((await auditOf(t.id, 'finance.payroll_run.archive')).length, 1)
    assert.equal((await auditOf(t.id, 'finance.payroll_run.read')).length, 2)
  })

  test('DOM-FIN-115: onaylı (kilitli) ayda kaydetme 409, kayıtlı hesap değişmez (K-391)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    await rate(t, wage(selin, 3_303_000))
    const saved = ok(await save(t.admin, '2026-03', null), 201)
    const year = ok(await get(`${PERIODS}?year=2026`, t.admin)) as { months: Json[] }
    const march = year.months.find((item) => item.month === '2026-03')
    const hash = (march?.current as Json | null)?.inputsHash
    ok(await call('POST', `${PERIODS}/2026-03/approve`, t.admin, { inputsHash: hash }, key()), 201)
    const before = await runRows(t.id)
    assertError(await save(t.admin, '2026-03', String(saved.id)), 409, 'payroll_period_locked')
    assert.deepEqual(await runRows(t.id), before)
    const view = await preview(t.admin, '2026-03')
    assert.equal(view.locked, true)
    assert.equal((view.saved as Json).id, saved.id)
    assert.equal(ok(await get(`${RUNS}/2026-03`, t.admin)).locked, true)
  })

  test('DOM-FIN-115: hesaplanabilen satır yoksa 422, kayıtsız ay 404', async () => {
    const t = await institution()
    const hourly = await person(t, 'ogretmen', 'Saatli Öğretmen')
    assertError(await save(t.admin, '2026-01', null), 422, 'payroll_run_empty')
    await rate(t, { ...wage(hourly, 50_000), rateType: 'hourly' })
    const data = await preview(t.admin, '2026-01')
    assert.equal(rowOf(data, hourly).complete, false)
    assertError(await save(t.admin, '2026-01', null), 422, 'payroll_run_empty')
    assertError(await get(`${RUNS}/2026-01`, t.admin), 404)
    assert.equal((await runRows(t.id)).length, 0)
  })

  test('DOM-FIN-115: CSV denetime düşer ve taze oturum ister', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', '=Selin Kaya')
    await rate(t, wage(selin, 3_303_000))
    const file = await get(`${CALC}/2026-01`, t.admin, { accept: 'text/csv' })
    assert.equal(file.statusCode, 200, file.body)
    assert.match(String(file.headers['content-type']), /text\/csv/)
    assert.match(String(file.headers['content-disposition']), /bordro-hesabi-2026-01\.csv/)
    assert.ok(file.body.startsWith('\uFEFF'))
    const lines = file.body.replace('\uFEFF', '').split('\r\n')
    assert.match(lines[1]!, /^"'=Selin Kaya";"Evet";30;33030,00;/)
    ok(await save(t.admin, '2026-01', null), 201)
    const saved = await get(`${RUNS}/2026-01`, t.admin, { accept: 'text/csv' })
    assert.match(String(saved.headers['content-disposition']), /bordro-hesabi-2026-01-kayitli\.csv/)
    assert.equal((await auditOf(t.id, 'finance.payroll_calculation_export')).length, 1)
    assert.equal((await auditOf(t.id, 'finance.payroll_run_export')).length, 1)

    const later = await buildTestApp(db, { clock: () => new Date(Date.now() + 16 * 60 * 1000) })
    try {
      assertError(
        await call('GET', `${CALC}/2026-01`, t.admin, undefined, { accept: 'text/csv' }, later),
        403,
        'reauthentication_required',
      )
      assert.equal(
        (await call('GET', `${CALC}/2026-01`, t.admin, undefined, {}, later)).statusCode,
        200,
      )
    } finally {
      await later.close()
    }
  })

  test('DOM-FIN-115: matrah devri kümülatife girer; tek kayıt, kaldırma If-Match (K-388)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const parent = await person(t, 'veli', 'Ayşe Yılmaz')
    await rate(t, wage(selin, 5_000_000))
    const body = {
      membershipId: selin,
      year: 2026,
      incomeTaxBaseCents: 18_000_000,
      note: 'Önceki işyeri',
    }
    const created = ok(await addCarryover(t.admin, body, key()), 201)
    assert.equal(created.staffName, 'Selin Kaya')
    assertError(await addCarryover(t.admin, body), 409, 'payroll_carryover_exists')
    assertError(
      await addCarryover(t.admin, { ...body, membershipId: parent }),
      422,
      'payroll_carryover_not_staff',
    )
    const row = rowOf(await preview(t.admin, '2026-01'), selin)
    assert.equal(row.cumulativeIncomeTaxBaseBeforeCents, 18_000_000)
    assert.equal(row.incomeTaxCents, 800_000)
    const list = ok(await get(`${CARRYOVERS}?year=2026`, t.admin)) as unknown as Json[]
    assert.equal(list.length, 1)
    assert.equal((await auditOf(t.id, 'finance.payroll_tax_carryover.read')).length, 1)
    const url = `${CARRYOVERS}/${String(created.id)}`
    assertError(await call('DELETE', url, t.admin), 400, 'if_match_required')
    assertError(await call('DELETE', url, t.admin, undefined, ifMatch(9)), 409)
    ok(await call('DELETE', url, t.admin, undefined, ifMatch(created.version)))
    assertError(await call('DELETE', url, t.admin, undefined, ifMatch(created.version)), 404)
    assert.equal(
      rowOf(await preview(t.admin, '2026-01'), selin).cumulativeIncomeTaxBaseBeforeCents,
      0,
    )
    ok(await addCarryover(t.admin, body), 201)
  })

  test('DOM-FIN-115: başka kurumun personeli, hesabı ve devri 404 ve B değişmez; listede yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bStaff = await person(b, 'ogretmen', 'Kurum B Öğretmen')
    await rate(b, wage(bStaff, 3_303_000))
    ok(await save(b.admin, '2026-01', null), 201)
    const bCarryover = ok(
      await addCarryover(b.admin, {
        membershipId: bStaff,
        year: 2026,
        incomeTaxBaseCents: 100_000,
      }),
      201,
    )
    const bRuns = await runRows(b.id)
    const bCarryovers = await carryoverRows(b.id)

    const aPreview = await preview(a.admin, '2026-01')
    assert.equal(rowsOf(aPreview).length, 0)
    assert.equal(aPreview.saved, null)
    assertError(await get(`${RUNS}/2026-01`, a.admin), 404)
    assertError(await save(a.admin, '2026-01', null), 422, 'payroll_run_empty')
    assert.deepEqual(ok(await get(`${CARRYOVERS}?year=2026`, a.admin)), [])
    assertError(
      await addCarryover(a.admin, { membershipId: bStaff, year: 2026, incomeTaxBaseCents: 100 }),
      422,
      'payroll_carryover_staff_not_found',
    )
    assertError(
      await call(
        'DELETE',
        `${CARRYOVERS}/${String(bCarryover.id)}`,
        a.admin,
        undefined,
        ifMatch(1),
      ),
      404,
    )
    assertError(
      await addCarryover(a.admin, {
        membershipId: bStaff,
        year: 2026,
        incomeTaxBaseCents: 100,
        institutionId: b.id,
      }),
      400,
    )
    assert.deepEqual(await runRows(b.id), bRuns)
    assert.deepEqual(await carryoverRows(b.id), bCarryovers)
    assert.equal((await carryoverRows(a.id)).length, 0)
  })
})
