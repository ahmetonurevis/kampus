import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { payrollParameterSets } from '../src/db/schema/finance-payroll-parameters.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type InstitutionOverrides,
} from './support/app.ts'

/**
 * Bordro parametresi uçları (DOM-FIN-100; ON-197). Her test kendi kurumunu kurar. FIXED_NOW
 * 2026-10-06. Platform değerleri core'dadır (K-308); kurum kopyası tabloda (K-309).
 */

const URL = '/api/v1/finance/payroll-parameters'
const BRACKETS_2026 = [
  { lowerBoundCents: 0, rateBasisPoints: 1500 },
  { lowerBoundCents: 19_000_000, rateBasisPoints: 2000 },
  { lowerBoundCents: 40_000_000, rateBasisPoints: 2700 },
  { lowerBoundCents: 150_000_000, rateBasisPoints: 3500 },
  { lowerBoundCents: 530_000_000, rateBasisPoints: 4000 },
]
const MID_YEAR = {
  effectiveFrom: '2026-07-01',
  minimumWageGrossCents: 3_600_000,
  incomeTaxBrackets: BRACKETS_2026,
  sgkEmployeeRateBasisPoints: 1400,
  sgkEmployerRateBasisPoints: 2075,
  sgkEmployerIncentiveBasisPoints: 500,
  unemploymentEmployeeRateBasisPoints: 100,
  unemploymentEmployerRateBasisPoints: 200,
  sgkFloorMultiplierBasisPoints: 10_000,
  sgkCeilingMultiplierBasisPoints: 90_000,
  stampTaxRatePer100k: 759,
  minimumWageIncomeTaxExempt: true,
  minimumWageStampTaxExempt: true,
  severanceCeilingCents: 7_000_000,
  source: 'Kurum mali müşaviri yazısı (örnek)',
}

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-100: bordro parametresi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.197.0.1'

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
  const get = (url: string, cookie: string | null) => call('GET', url, cookie)
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
    clientIp = `10.197.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))
  const create = async (t: Tenant, body: Json = MID_YEAR) =>
    ok(await call('POST', URL, t.admin, body), 201)
  const rowsOf = (institutionId: string) =>
    db
      .select()
      .from(payrollParameterSets)
      .where(eq(payrollParameterSets.institutionId, institutionId))
  const yearOf = async (cookie: string, year: number) =>
    ok(await get(`${URL}?year=${String(year)}`, cookie)) as {
      year: number
      availableYears: number[]
      periods: Json[]
    }
  const effectiveOn = async (cookie: string, date: string) =>
    ok(await get(`${URL}/effective?date=${date}`, cookie))

  test('kimliksiz istek 401', async () => {
    assertError(await get(`${URL}?year=2026`, null), 401)
    assertError(await get(`${URL}/effective?date=2026-01-01`, null), 401)
    assertError(await call('POST', URL, null, MID_YEAR), 401)
    assertError(await call('PATCH', `${URL}/${randomUUID()}`, null, { source: 'xyz' }), 401)
    assertError(await call('DELETE', `${URL}/${randomUUID()}`, null), 401)
  })

  test('DOM-FIN-100: öğretmen, veli, öğrenci 403; ön büro okur ama yazamaz (K-309)', async () => {
    const t = await institution()
    const saved = await create(t)
    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(`${URL}?year=2026`, cookie), 403)
      assertError(await get(`${URL}/effective?date=2026-07-01`, cookie), 403)
    }
    const front = await member(t.id, 'onburo')
    assert.equal((await yearOf(front, 2026)).periods.length, 2)
    assertError(await call('POST', URL, front, { ...MID_YEAR, effectiveFrom: '2026-09-01' }), 403)
    const setUrl = `${URL}/${String(saved.id)}`
    assertError(
      await call('PATCH', setUrl, front, { source: 'Ön büro' }, ifMatch(saved.version)),
      403,
    )
    assertError(await call('DELETE', setUrl, front, undefined, ifMatch(saved.version)), 403)
    const rows = await rowsOf(t.id)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.source, MID_YEAR.source)
    assert.equal(rows[0]?.archivedAt, null)
  })

  test('DOM-FIN-100: finance modülü kapalıyken 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(`${URL}?year=2026`, closed.admin), 403, 'module_disabled')
    assertError(await call('POST', URL, closed.admin, MID_YEAR), 403, 'module_disabled')
    assert.equal((await rowsOf(closed.id)).length, 0)
  })

  test('DOM-FIN-100: kurum kopyası yoksa platform varsayılanı okunur; net asgari ücret hesaplanır (K-308, K-310)', async () => {
    const t = await institution()
    const year = await yearOf(t.admin, 2026)
    assert.equal(year.year, 2026)
    assert.deepEqual(year.availableYears, [2025, 2026])
    assert.equal(year.periods.length, 1)
    const [period] = year.periods
    assert.equal(period?.id, 'platform-2026-01-01')
    assert.equal(period?.origin, 'platform')
    assert.equal(period?.version, null)
    assert.equal(period?.minimumWageGrossCents, 3_303_000)
    assert.equal(period?.periodEnd, '2026-12-31')
    assert.equal((period?.derived as Json).minimumWageNetCents, 2_807_550)
    assert.ok((period?.unverifiedFields as string[]).includes('severanceCeilingCents'))
    // 2025: kıdem tavanı temmuzda değişir (yıl içi iki dönem).
    const year2025 = await yearOf(t.admin, 2025)
    assert.deepEqual(
      year2025.periods.map((item) => [item.periodStart, item.severanceCeilingCents]),
      [
        ['2025-01-01', 4_665_543],
        ['2025-07-01', 5_391_968],
      ],
    )
    // 2027 için set yok: 2026 seti sürer, geçerli set `stale`.
    assert.equal((await yearOf(t.admin, 2027)).periods[0]?.carriedOver, true)
    assert.equal((await effectiveOn(t.admin, '2027-02-01')).stale, true)
    assertError(
      await get(`${URL}/effective?date=2024-12-31`, t.admin),
      422,
      'payroll_parameters_missing',
    )
    assertError(await get(`${URL}?year=2019`, t.admin), 400)
    assertError(await get(`${URL}?year=2026&page=1`, t.admin), 400)
    assertError(await get(`${URL}/effective?date=2026-13-01`, t.admin), 400)
  })

  test('DOM-FIN-100: yıl ortası kurum seti kaydedilir; geçerli set dönem sınırında değişir; denetime alan adı yazılır', async () => {
    const t = await institution()
    const saved = await create(t)
    assert.equal(saved.effectiveFrom, '2026-07-01')
    assert.equal(saved.version, 1)
    assert.deepEqual(saved.incomeTaxBrackets, BRACKETS_2026)
    const june = await effectiveOn(t.admin, '2026-06-30')
    assert.equal(june.origin, 'platform')
    assert.equal(june.stale, false)
    const july = await effectiveOn(t.admin, '2026-07-01')
    assert.equal(july.origin, 'institution')
    assert.equal(july.id, saved.id)
    assert.equal(july.minimumWageGrossCents, 3_600_000)
    assert.equal((july.derived as Json).minimumWageNetCents, 3_060_000)
    const year = await yearOf(t.admin, 2026)
    assert.deepEqual(
      year.periods.map((item) => [item.periodStart, item.periodEnd, item.origin]),
      [
        ['2026-01-01', '2026-06-30', 'platform'],
        ['2026-07-01', '2026-12-31', 'institution'],
      ],
    )
    const [row] = await rowsOf(t.id)
    assert.equal(row?.minimumWageGrossCents, 3_600_000)
    assert.equal(row?.currency, 'TRY')
    const audits = await db
      .select({ changes: auditLog.changes, entityType: auditLog.entityType })
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'payroll_parameters.create')),
      )
    assert.equal(audits.length, 1)
    assert.equal(audits[0]?.entityType, 'payroll_parameter_sets')
    assert.equal(JSON.stringify(audits).includes('3600000'), false)
    assert.ok(JSON.stringify(audits).includes('minimumWageGrossCents'))
  })

  test('DOM-FIN-100: dilim ve set doğrulaması 400; kayıt yazılmaz (K-311)', async () => {
    const t = await institution()
    const [first, second, ...rest] = BRACKETS_2026
    for (const body of [
      { ...MID_YEAR, effectiveFrom: '2026-07-15' },
      { ...MID_YEAR, effectiveFrom: '2019-01-01' },
      { ...MID_YEAR, incomeTaxBrackets: [] },
      { ...MID_YEAR, incomeTaxBrackets: [{ lowerBoundCents: 100, rateBasisPoints: 1500 }] },
      { ...MID_YEAR, incomeTaxBrackets: [second, first, ...rest] },
      { ...MID_YEAR, incomeTaxBrackets: [first, { ...second, rateBasisPoints: 1500 }] },
      { ...MID_YEAR, incomeTaxBrackets: [{ lowerBoundCents: 0, rateBasisPoints: 10_500 }] },
      { ...MID_YEAR, sgkEmployerIncentiveBasisPoints: 3000 },
      { ...MID_YEAR, sgkCeilingMultiplierBasisPoints: 5000 },
      { ...MID_YEAR, stampTaxRatePer100k: -1 },
      { ...MID_YEAR, minimumWageGrossCents: 0 },
      { ...MID_YEAR, minimumWageGrossCents: 33_030.5 },
      { ...MID_YEAR, source: '' },
      { ...MID_YEAR, institutionId: t.id },
      Object.fromEntries(
        Object.entries(MID_YEAR).filter(([key]) => key !== 'severanceCeilingCents'),
      ),
    ])
      assertError(await call('POST', URL, t.admin, body), 400, 'validation_failed')
    assert.equal((await rowsOf(t.id)).length, 0)
  })

  test('DOM-FIN-100: aynı yürürlük başlangıcı 409; arşivden sonra yeniden açılabilir', async () => {
    const t = await institution()
    const saved = await create(t)
    assertError(await call('POST', URL, t.admin, MID_YEAR), 409, 'payroll_parameters_exist')
    const other = await create(t, { ...MID_YEAR, effectiveFrom: '2026-09-01' })
    assertError(
      await call(
        'PATCH',
        `${URL}/${String(other.id)}`,
        t.admin,
        { effectiveFrom: '2026-07-01' },
        ifMatch(other.version),
      ),
      409,
      'payroll_parameters_exist',
    )
    ok(
      await call(
        'DELETE',
        `${URL}/${String(saved.id)}`,
        t.admin,
        undefined,
        ifMatch(saved.version),
      ),
    )
    await create(t)
    assert.equal((await rowsOf(t.id)).length, 3)
  })

  test('DOM-FIN-100: aynı başlangıçlı kurum kopyası platformu ezer; arşivlenince platform değeri geri gelir (K-309)', async () => {
    const t = await institution()
    const copy = await create(t, {
      ...MID_YEAR,
      effectiveFrom: '2026-01-01',
      minimumWageGrossCents: 3_303_000,
      severanceCeilingCents: 6_500_000,
    })
    const overridden = await effectiveOn(t.admin, '2026-03-01')
    assert.equal(overridden.origin, 'institution')
    assert.equal(overridden.overridesPlatform, true)
    assert.equal(overridden.severanceCeilingCents, 6_500_000)
    assert.deepEqual(overridden.unverifiedFields, [])
    const archived = ok(
      await call('DELETE', `${URL}/${String(copy.id)}`, t.admin, undefined, ifMatch(copy.version)),
    )
    assert.equal(archived.id, copy.id)
    const restored = await effectiveOn(t.admin, '2026-03-01')
    assert.equal(restored.origin, 'platform')
    assert.equal(restored.severanceCeilingCents, 6_494_877)
    const [row] = await rowsOf(t.id)
    assert.ok(row?.archivedAt)
    assert.equal(row?.version, 2)
    // Arşivli set düzeltilemez ve ikinci kez arşivlenemez.
    assertError(
      await call(
        'PATCH',
        `${URL}/${String(copy.id)}`,
        t.admin,
        { source: 'Yeni kaynak' },
        ifMatch(2),
      ),
      404,
    )
    assertError(
      await call('DELETE', `${URL}/${String(copy.id)}`, t.admin, undefined, ifMatch(2)),
      404,
    )
  })

  test('DOM-FIN-100: düzeltme If-Match ister, sürüm tutmazsa 409; birleşik set doğrulanır; denetime değişen alan', async () => {
    const t = await institution()
    const saved = await create(t)
    const setUrl = `${URL}/${String(saved.id)}`
    assertError(
      await call('PATCH', setUrl, t.admin, { source: 'Yeni kaynak' }),
      400,
      'if_match_required',
    )
    assertError(
      await call(
        'PATCH',
        setUrl,
        t.admin,
        { source: 'Yeni kaynak' },
        ifMatch(Number(saved.version) + 3),
      ),
      409,
      'version_conflict',
    )
    assertError(await call('PATCH', setUrl, t.admin, {}, ifMatch(saved.version)), 400)
    // Tek başına geçerli ama birleşik sette tavanın altına inen taban 400; kayıt değişmez.
    assertError(
      await call(
        'PATCH',
        setUrl,
        t.admin,
        { sgkFloorMultiplierBasisPoints: 100_000 },
        ifMatch(saved.version),
      ),
      400,
      'validation_failed',
    )
    assertError(await call('DELETE', setUrl, t.admin), 400, 'if_match_required')
    const unchanged = await rowsOf(t.id)
    assert.equal(unchanged[0]?.version, 1)
    assert.equal(unchanged[0]?.sgkFloorMultiplierBasisPoints, 10_000)

    const updated = ok(
      await call(
        'PATCH',
        setUrl,
        t.admin,
        {
          minimumWageGrossCents: 3_700_000,
          sgkEmployeeRateBasisPoints: 1400,
          incomeTaxBrackets: [
            ...BRACKETS_2026.slice(0, 4),
            { lowerBoundCents: 600_000_000, rateBasisPoints: 4000 },
          ],
        },
        ifMatch(saved.version),
      ),
    )
    assert.equal(updated.version, 2)
    assert.equal(updated.minimumWageGrossCents, 3_700_000)
    assert.equal((updated.incomeTaxBrackets as Json[])[4]?.lowerBoundCents, 600_000_000)
    const [audit] = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'payroll_parameters.update')),
      )
    assert.deepEqual(audit?.changes, { fields: ['minimumWageGrossCents', 'incomeTaxBrackets'] })
  })

  test('DOM-FIN-100: başka kurumun seti 404 ve B değişmez; tabloda ve geçerli sette görünmez; gövdedeki institutionId 400', async () => {
    const a = await institution()
    const b = await institution()
    const bSet = await create(b, {
      ...MID_YEAR,
      effectiveFrom: '2026-01-01',
      severanceCeilingCents: 9_999_999,
    })
    const bUrl = `${URL}/${String(bSet.id)}`
    assertError(
      await call('PATCH', bUrl, a.admin, { source: 'Sızma denemesi' }, ifMatch(bSet.version)),
      404,
    )
    assertError(await call('DELETE', bUrl, a.admin, undefined, ifMatch(bSet.version)), 404)
    const aYear = await yearOf(a.admin, 2026)
    assert.equal(aYear.periods.length, 1)
    assert.equal(aYear.periods[0]?.origin, 'platform')
    assert.equal((await effectiveOn(a.admin, '2026-05-01')).severanceCeilingCents, 6_494_877)
    assertError(await call('POST', URL, a.admin, { ...MID_YEAR, institutionId: b.id }), 400)
    // Aynı başlangıç başka kurumda serbesttir.
    await create(a, { ...MID_YEAR, effectiveFrom: '2026-01-01' })
    const [bRow] = await rowsOf(b.id)
    assert.equal(bRow?.source, MID_YEAR.source)
    assert.equal(bRow?.version, 1)
    assert.equal(bRow?.archivedAt, null)
    assert.equal((await effectiveOn(b.admin, '2026-05-01')).severanceCeilingCents, 9_999_999)
  })

  test('DOM-FIN-100: Idempotency-Key ile yinelenen kayıt aynı yanıtı döner, tek satır yazılır', async () => {
    const t = await institution()
    const key = { 'idempotency-key': randomUUID() }
    const first = await call('POST', URL, t.admin, MID_YEAR, key)
    const second = await call('POST', URL, t.admin, MID_YEAR, key)
    assert.equal(first.statusCode, 201, first.body)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal(second.json().data.id, first.json().data.id)
    assert.equal((await rowsOf(t.id)).length, 1)
  })
})
