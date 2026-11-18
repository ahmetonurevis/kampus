import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { memberships } from '../src/db/schema/auth.ts'
import {
  staffCostAllocations,
  staffCostAllocationShares,
} from '../src/db/schema/finance-staff-costs.ts'
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
 * Personel maliyet ataması ve tahmini personel maliyeti raporu uçları (DOM-FIN-104; ON-204;
 * K-332…K-335). Her test kendi kurumunu kurar. FIXED_NOW 2026-10-06; 2026 platform parametreleri:
 * SGK işveren %15,75 (indirimli), işsizlik işveren %2, SGK tavanı 297.270 ₺.
 */

const FINANCE = '/api/v1/finance'
const ALLOCATIONS = `${FINANCE}/staff-cost-allocations`
const STAFF = `${FINANCE}/staff-cost-staff`
const REPORT = `${FINANCE}/staff-costs`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-104: personel maliyeti uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.104.0.1'

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
  const get = (url: string, cookie: string | null, headers: Record<string, string> = {}) =>
    call('GET', url, cookie, undefined, headers)
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
    clientIp = `10.104.${String((tenantCount += 1))}.1`
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
  async function center(t: Tenant, code: string, name = code) {
    return String(
      ok(await call('POST', `${FINANCE}/cost-centers`, t.admin, { code, name, type: 'unit' }), 201)
        .id,
    )
  }
  async function wage(t: Tenant, membershipId: string, amountCents = 4_000_000, fields: Json = {}) {
    ok(
      await call('POST', `${FINANCE}/pay-rates`, t.admin, {
        component: 'wage',
        membershipId,
        rateType: 'monthly_gross',
        amountCents,
        startDate: '2026-01-01',
        ...fields,
      }),
      201,
    )
  }
  const allocation = (
    membershipId: string,
    shares: [string, number][],
    startMonth = '2026-01',
    fields: Json = {},
  ): Json => ({
    membershipId,
    startMonth,
    shares: shares.map(([costCenterId, shareBasisPoints]) => ({ costCenterId, shareBasisPoints })),
    ...fields,
  })
  const create = (cookie: string, body: Json, headers: Record<string, string> = {}) =>
    call('POST', ALLOCATIONS, cookie, body, headers)
  const cancel = (cookie: string, target: Json, reason = 'Yanlış merkez seçildi') =>
    call(
      'POST',
      `${ALLOCATIONS}/${String(target.id)}/cancel`,
      cookie,
      { reason },
      ifMatch(target.version),
    )
  const rowsOf = (institutionId: string) =>
    db
      .select()
      .from(staffCostAllocations)
      .where(eq(staffCostAllocations.institutionId, institutionId))
  const sharesOf = (institutionId: string) =>
    db
      .select()
      .from(staffCostAllocationShares)
      .where(eq(staffCostAllocationShares.institutionId, institutionId))
  const auditOf = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  const staffListOf = async (cookie: string, query = '') => {
    const response = await get(`${STAFF}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }
  const reportOf = async (cookie: string, query = '') => ok(await get(`${REPORT}${query}`, cookie))

  test('kimliksiz istek 401', async () => {
    const url = `${ALLOCATIONS}/${randomUUID()}/cancel`
    assertError(await get(REPORT, null), 401)
    assertError(await get(STAFF, null), 401)
    assertError(await get(`${STAFF}/m-1`, null), 401)
    assertError(await call('POST', ALLOCATIONS, null, allocation('m-1', [])), 401)
    assertError(await call('POST', url, null, { reason: 'Yanlış' }, ifMatch(1)), 401)
  })

  test('DOM-FIN-104: ön büro, öğretmen, veli ve öğrenci 403; modül kapalı 403; kayıt değişmez (K-334)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const lise = await center(t, 'LISE')
    const created = ok(await create(t.admin, allocation(selin, [[lise, 10_000]])), 201)
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(REPORT, cookie), 403)
      assertError(await get(STAFF, cookie), 403)
      assertError(await get(`${STAFF}/${selin}`, cookie), 403)
      assertError(await create(cookie, allocation(selin, [[lise, 10_000]], '2026-09')), 403)
      assertError(await cancel(cookie, created), 403)
    }
    const rows = await rowsOf(t.id)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.archivedAt, null)
    assert.equal((await auditOf(t.id, 'finance.staff_cost.read')).length, 0)

    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(REPORT, closed.admin), 403, 'module_disabled')
    assertError(await get(STAFF, closed.admin), 403, 'module_disabled')
    assertError(
      await create(closed.admin, allocation('m-1', [[lise, 10_000]])),
      403,
      'module_disabled',
    )
  })

  test('DOM-FIN-104: atama yüzde payla yazılır; liste ve geçmiş ayı ve bitişi gösterir (K-332)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const merve = await person(t, 'onburo', 'Merve Ak')
    await person(t, 'veli', 'Ayşe Yılmaz')
    const lise = await center(t, 'LISE', 'Lise')
    const orta = await center(t, 'ORTA', 'Ortaokul')
    const first = ok(
      await create(
        t.admin,
        allocation(
          selin,
          [
            [orta, 4000],
            [lise, 6000],
          ],
          '2026-01',
          { extraLessonHours: 12 },
        ),
      ),
      201,
    )
    assert.deepEqual(
      (first.shares as Json[]).map((share) => [share.code, share.shareBasisPoints]),
      [
        ['LISE', 6000],
        ['ORTA', 4000],
      ],
    )
    assert.equal(first.startMonth, '2026-01')
    assert.equal(first.endMonth, null)
    assert.equal(first.extraLessonHours, 12)
    assert.equal(first.wageHours, null)
    const second = ok(await create(t.admin, allocation(selin, [[orta, 10_000]], '2026-11')), 201)
    assert.equal(second.endMonth, null)

    const list = await staffListOf(t.admin)
    assert.deepEqual(
      list.data.map((row) => row.name),
      ['Merve Ak', 'Selin Kaya', 'Test Yönetici'],
    )
    const selinRow = list.data.find((row) => row.membershipId === selin)
    assert.equal((selinRow?.allocation as Json).id, first.id)
    assert.equal((selinRow?.allocation as Json).endMonth, '2026-10')
    assert.equal(selinRow?.allocationCount, 2)
    assert.equal(list.data.find((row) => row.membershipId === merve)?.allocation, null)
    const later = await staffListOf(t.admin, '?month=2026-11&q=selin')
    assert.equal(later.meta.total, 1)
    assert.equal((later.data[0]?.allocation as Json).id, second.id)

    const detail = ok(await get(`${STAFF}/${selin}`, t.admin))
    assert.equal(detail.currentId, first.id)
    assert.deepEqual(
      (detail.allocations as Json[]).map((row) => [row.startMonth, row.endMonth]),
      [
        ['2026-01', '2026-10'],
        ['2026-11', null],
      ],
    )
    const audits = await auditOf(t.id, 'finance.staff_cost_allocation.create')
    assert.equal(audits.length, 2)
    assert.deepEqual(audits[0]?.changes, {
      fields: ['membershipId', 'startMonth', 'shares', 'extraLessonHours'],
    })
    assertError(await get(`${STAFF}?month=2026-13`, t.admin), 400)
    assertError(await get(`${STAFF}?institutionId=x`, t.admin), 400)
  })

  test('DOM-FIN-104: geçersiz gövde 400, kural reddi 422, aynı ay 409; kayıt değişmez (K-332)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const parent = await person(t, 'veli', 'Ayşe Yılmaz')
    const left = await person(t, 'onburo', 'Ahmet Ayrılan')
    await db.update(memberships).set({ deactivatedAt: FIXED_NOW }).where(eq(memberships.id, left))
    const lise = await center(t, 'LISE')
    const orta = await center(t, 'ORTA')
    ok(await create(t.admin, allocation(selin, [[lise, 10_000]], '2026-09')), 201)
    const pasif = await center(t, 'PASIF')
    const centerList = ok(await get(`${FINANCE}/cost-centers`, t.admin)) as unknown
    const version = (centerList as Json[]).find((row) => row.id === pasif)?.version
    ok(
      await call(
        'PATCH',
        `${FINANCE}/cost-centers/${pasif}`,
        t.admin,
        { isActive: false },
        ifMatch(version),
      ),
    )
    const rowsBefore = await rowsOf(t.id)
    const sharesBefore = await sharesOf(t.id)

    for (const bad of [
      allocation(selin, [[lise, 6000]], '2026-10'),
      allocation(
        selin,
        [
          [lise, 5000],
          [lise, 5000],
        ],
        '2026-10',
      ),
      allocation(selin, [], '2026-10'),
      allocation(selin, [[lise, 10_000]], '2026-10-01'),
      allocation(selin, [[lise, 10_000]], '2026-10', { dutyHours: 301 }),
      allocation(selin, [[lise, 10_000]], '2026-10', { institutionId: t.id }),
      allocation(selin, [['yok', 10_000]], '2026-10'),
    ])
      assertError(await create(t.admin, bad), 400)
    assertError(
      await create(t.admin, allocation('yok', [[lise, 10_000]], '2026-10')),
      422,
      'staff_cost_staff_not_found',
    )
    assertError(
      await create(t.admin, allocation(parent, [[lise, 10_000]], '2026-10')),
      422,
      'staff_cost_not_staff',
    )
    assertError(
      await create(t.admin, allocation(selin, [[randomUUID(), 10_000]], '2026-10')),
      422,
      'staff_cost_center_not_found',
    )
    assertError(
      await create(
        t.admin,
        allocation(
          selin,
          [
            [orta, 5000],
            [pasif, 5000],
          ],
          '2026-10',
        ),
      ),
      422,
      'staff_cost_center_inactive',
    )
    assertError(
      await create(t.admin, allocation(selin, [[orta, 10_000]], '2026-09')),
      409,
      'staff_cost_allocation_exists',
    )
    assert.deepEqual(await rowsOf(t.id), rowsBefore)
    assert.deepEqual(await sharesOf(t.id), sharesBefore)
    // Pasifleştirilen personele geçmiş aylar için atama yazılır.
    ok(await create(t.admin, allocation(left, [[orta, 10_000]], '2026-01')), 201)
    assertError(await get(`${STAFF}/${parent}`, t.admin), 404)
    assertError(await get(`${STAFF}/yok`, t.admin), 404)
  })

  test('DOM-FIN-104: iptal If-Match ister; iptalden sonra önceki atama kapsar ve aynı ay yeniden yazılır (K-332)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const lise = await center(t, 'LISE')
    const orta = await center(t, 'ORTA')
    const first = ok(await create(t.admin, allocation(selin, [[lise, 10_000]])), 201)
    const second = ok(await create(t.admin, allocation(selin, [[orta, 10_000]], '2026-09')), 201)
    assertError(
      await call('POST', `${ALLOCATIONS}/${String(second.id)}/cancel`, t.admin, {
        reason: 'Yanlış merkez',
      }),
      400,
      'if_match_required',
    )
    assertError(await cancel(t.admin, second, 'kısa'), 400)
    assertError(await cancel(t.admin, { ...second, version: 2 }), 409)
    assert.deepEqual(ok(await cancel(t.admin, second)), { id: second.id })
    assertError(await cancel(t.admin, { ...second, version: 2 }), 404)
    const detail = ok(await get(`${STAFF}/${selin}`, t.admin))
    assert.deepEqual(
      (detail.allocations as Json[]).map((row) => [row.id, row.endMonth]),
      [[first.id, null]],
    )
    const archived = (await rowsOf(t.id)).find((row) => row.id === second.id)
    assert.equal(archived?.cancelReason, 'Yanlış merkez seçildi')
    ok(await create(t.admin, allocation(selin, [[orta, 10_000]], '2026-09')), 201)
    const audit = await auditOf(t.id, 'finance.staff_cost_allocation.cancel')
    assert.equal(audit.length, 1)
    assert.equal(JSON.stringify(audit).includes('Yanlış merkez'), false)
  })

  test('DOM-FIN-104: Idempotency-Key ile yinelenen atama aynı yanıtı döner, tek satır yazılır', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const lise = await center(t, 'LISE')
    const headers = { 'idempotency-key': randomUUID() }
    const first = await create(t.admin, allocation(selin, [[lise, 10_000]]), headers)
    const second = await create(t.admin, allocation(selin, [[lise, 10_000]]), headers)
    assert.equal(first.statusCode, 201)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal(second.json().data.id, first.json().data.id)
    assert.equal((await rowsOf(t.id)).length, 1)
  })

  test('DOM-FIN-104: rapor merkez kırılımı, işveren payları, küçük grup ve kişi satırları; her okuma denetimde (K-333, K-334)', async () => {
    const t = await institution()
    const lise = await center(t, 'LISE', 'Lise')
    const orta = await center(t, 'ORTA', 'Ortaokul')
    const teachers: string[] = []
    for (const name of ['Ali Bey', 'Burcu Han', 'Cem Er', 'Deniz Ay', 'Ece Su'])
      teachers.push(await person(t, 'ogretmen', name))
    for (const id of teachers) {
      await wage(t, id)
      ok(await create(t.admin, allocation(id, [[lise, 10_000]])), 201)
    }
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    await wage(t, selin, 5_000_000)
    ok(
      await call('POST', `${FINANCE}/pay-rates`, t.admin, {
        component: 'benefit',
        membershipId: selin,
        rateType: 'meal',
        benefitForm: 'in_kind',
        taxable: false,
        amountCents: 300_000,
        startDate: '2026-01-01',
      }),
      201,
    )
    ok(
      await create(
        t.admin,
        allocation(selin, [
          [lise, 6000],
          [orta, 4000],
        ]),
      ),
      201,
    )
    const netPerson = await person(t, 'onburo', 'Net Ücretli')
    await wage(t, netPerson, 3_000_000, { rateType: 'monthly_net' })

    const masked = await reportOf(t.admin, '?from=2026-10&to=2026-10')
    const centers = masked.centers as Json[]
    // Ortaokul (1 kişi) ve Atanmamış (1 kişi) gizli; birleşimleri 2 kişi olduğundan Lise de gizlenir.
    assert.deepEqual(
      centers.map((row) => [row.name, row.staffCount, row.totalCents, row.suppressed]),
      [
        ['Lise', 6, null, true],
        ['Ortaokul', 1, null, true],
        ['Atanmamış', 1, null, true],
      ],
    )
    // Brüt: 5 × 40.000 + 50.000 = 250.000 ₺; SGK %15,75, işsizlik %2; yemek 3.000 ₺.
    assert.deepEqual(masked.totals, {
      grossCents: 25_000_000,
      employerSgkCents: 3_937_500,
      unemploymentCents: 500_000,
      benefitsCents: 300_000,
      totalCents: 29_737_500,
      staffCount: 7,
    })
    assert.equal(masked.persons, null)
    assert.deepEqual(masked.warnings, {
      netWageStaffCount: 1,
      missingHoursStaffCount: 0,
      assignedWithoutRateCount: 0,
      unassignedStaffCount: 1,
      staleMonths: [],
      unverifiedParameters: true,
    })

    const people = await reportOf(t.admin, '?from=2026-09&to=2026-10&people=true')
    const peopleCenters = people.centers as Json[]
    assert.deepEqual(
      peopleCenters.map((row) => [row.name, row.grossCents, row.suppressed]),
      [
        ['Lise', 2 * (20_000_000 + 3_000_000), false],
        ['Ortaokul', 2 * 2_000_000, false],
        ['Atanmamış', 0, false],
      ],
    )
    const selinRows = (people.persons as Json[]).filter((row) => row.membershipId === selin)
    assert.deepEqual(
      selinRows.map((row) => [
        row.centerName,
        row.shareBasisPoints,
        row.monthCount,
        row.benefitsCents,
      ]),
      [
        ['LISE · Lise', 6000, 2, 360_000],
        ['ORTA · Ortaokul', 4000, 2, 240_000],
      ],
    )
    const net = (people.persons as Json[]).find((row) => row.membershipId === netPerson)
    assert.deepEqual(net?.flags, ['net_wage'])
    assert.equal((people.months as Json[]).length, 2)

    const reads = await auditOf(t.id, 'finance.staff_cost.read')
    assert.equal(reads.length, 2)
    assert.equal(reads[0]?.entityId, '2026-10:2026-10')
    assert.equal(JSON.stringify(reads).includes('25000000'), false)
    assert.ok(reads.some((row) => JSON.stringify(row.changes).includes('membershipId')))
  })

  test('DOM-FIN-104: rapor dönemi denetlenir; parametresiz ay 422; CSV taze oturumla iner ve denetime düşer (K-334)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    await wage(t, selin)
    const today = await reportOf(t.admin)
    assert.equal(today.from, '2026-10')
    assert.equal(today.to, '2026-10')
    assertError(await get(`${REPORT}?from=2026-10&to=2026-09`, t.admin), 400)
    assertError(await get(`${REPORT}?from=2025-01&to=2026-01`, t.admin), 400)
    assertError(await get(`${REPORT}?from=2026-1`, t.admin), 400)
    assertError(await get(`${REPORT}?people=evet`, t.admin), 400)
    assertError(await get(`${REPORT}?institutionId=x`, t.admin), 400)
    assertError(await get(`${REPORT}?from=2024-12`, t.admin), 422, 'payroll_parameters_missing')

    const csv = await get(`${REPORT}?from=2026-10&people=true`, t.admin, { accept: 'text/csv' })
    assert.equal(csv.statusCode, 200, csv.body)
    assert.match(String(csv.headers['content-type']), /text\/csv/)
    assert.match(String(csv.headers['content-disposition']), /personel-maliyeti-2026-10\.csv/)
    assert.ok(csv.body.startsWith('\uFEFF'))
    assert.ok(csv.body.includes('"Selin Kaya";"Öğretmen";"%100";1;40000,00'))
    assert.equal((await auditOf(t.id, 'finance.staff_cost.export')).length, 1)
  })

  test('DOM-FIN-104: başka kurumun personeli, ataması ve merkezi 404 ve B değişmez; raporda ve listede B yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bStaff = await person(b, 'ogretmen', 'Beta Öğretmen')
    const bCenter = await center(b, 'BETA')
    await wage(b, bStaff)
    const bAllocation = ok(await create(b.admin, allocation(bStaff, [[bCenter, 10_000]])), 201)
    const aStaff = await person(a, 'ogretmen', 'Alfa Öğretmen')

    assertError(await get(`${STAFF}/${bStaff}`, a.admin), 404)
    assertError(await cancel(a.admin, bAllocation, 'Başka kurum'), 404)
    assert.equal(
      (await staffListOf(a.admin)).data.some((row) => row.membershipId === bStaff),
      false,
    )
    assertError(
      await create(a.admin, allocation(bStaff, [[bCenter, 10_000]])),
      422,
      'staff_cost_staff_not_found',
    )
    assertError(
      await create(a.admin, allocation(aStaff, [[bCenter, 10_000]])),
      422,
      'staff_cost_center_not_found',
    )
    assertError(
      await create(a.admin, { ...allocation(aStaff, [[bCenter, 10_000]]), institutionId: b.id }),
      400,
    )
    const report = await reportOf(a.admin, '?people=true')
    assert.deepEqual(report.persons, [])
    assert.equal((report.totals as Json).staffCount, 0)
    assert.equal((await rowsOf(a.id)).length, 0)
    const [bRow] = await rowsOf(b.id)
    assert.equal(bRow?.archivedAt, null)
    assert.equal(bRow?.version, 1)
    assert.equal((await auditOf(b.id, 'finance.staff_cost.read')).length, 0)
  })
})
