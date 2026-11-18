import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, like } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  staffAdvances,
  staffGarnishments,
  staffPensionEnrollments,
} from '../src/db/schema/finance-staff-deductions.ts'
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
 * Avans ve kesinti uçları (DOM-FIN-101; ON-199; K-312…K-315). Her test kendi kurumunu kurar;
 * personel adlı kullanıcıyla açılır. FIXED_NOW 2026-10-06 (İstanbul günü).
 */

const FINANCE = '/api/v1/finance'
const STAFF = `${FINANCE}/staff-deductions`
const ADVANCES = `${FINANCE}/staff-advances`
const GARNISHMENTS = `${FINANCE}/staff-garnishments`
const PENSIONS = `${FINANCE}/staff-pension-enrollments`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-101: avans ve kesinti uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.199.0.1'

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
  const get = (url: string, cookie: string | null) => call('GET', url, cookie)
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
    clientIp = `10.199.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  /** Adlı personel üyeliği (giriş yapmaz). */
  async function staff(t: Tenant, role: Role, name: string) {
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

  const advance = (membershipId: string, overrides: Json = {}) => ({
    membershipId,
    amountCents: 1_000_000,
    givenDate: '2026-10-01',
    paymentMethod: 'bank_transfer',
    installmentCount: 3,
    firstMonth: '2026-10',
    ...overrides,
  })
  const garnishment = (membershipId: string, overrides: Json = {}) => ({
    membershipId,
    office: 'İstanbul 12. İcra Dairesi',
    fileNumber: '2026/1234',
    claimCents: 5_000_000,
    receivedDate: '2026-09-15',
    ...overrides,
  })
  const pension = (membershipId: string, overrides: Json = {}) => ({
    membershipId,
    startDate: '2026-09-01',
    ...overrides,
  })
  const giveAdvance = (
    cookie: string | null,
    body: Json,
    headers: Record<string, string> = key(),
  ) => call('POST', ADVANCES, cookie, body, headers)
  const addGarnishment = (cookie: string, body: Json) => call('POST', GARNISHMENTS, cookie, body)
  const enroll = (cookie: string, body: Json) => call('POST', PENSIONS, cookie, body)
  const detail = (cookie: string, membershipId: string) => get(`${STAFF}/${membershipId}`, cookie)
  const preview = (cookie: string, membershipId: string, body: Json) =>
    call('POST', `${STAFF}/${membershipId}/month-preview`, cookie, body)
  const staffOf = async (cookie: string, query = '') => {
    const response = await get(`${STAFF}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }
  const rowsOf = async (institutionId: string) => ({
    advances: await db
      .select()
      .from(staffAdvances)
      .where(eq(staffAdvances.institutionId, institutionId)),
    garnishments: await db
      .select()
      .from(staffGarnishments)
      .where(eq(staffGarnishments.institutionId, institutionId)),
    pensions: await db
      .select()
      .from(staffPensionEnrollments)
      .where(eq(staffPensionEnrollments.institutionId, institutionId)),
  })
  const auditsOf = (institutionId: string, prefix: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), like(auditLog.action, `${prefix}%`)))

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    assertError(await get(STAFF, null), 401)
    assertError(await get(`${STAFF}/m-1`, null), 401)
    assertError(await call('POST', `${STAFF}/m-1/month-preview`, null, { month: '2026-10' }), 401)
    assertError(await giveAdvance(null, advance('m-1')), 401)
    assertError(await call('POST', `${ADVANCES}/${id}/close`, null, {}, ifMatch(1)), 401)
    assertError(await call('POST', `${ADVANCES}/${id}/cancel`, null, {}, ifMatch(1)), 401)
    assertError(await call('POST', GARNISHMENTS, null, garnishment('m-1')), 401)
    assertError(await call('PATCH', `${GARNISHMENTS}/${id}`, null, {}, ifMatch(1)), 401)
    assertError(await call('POST', `${GARNISHMENTS}/${id}/close`, null, {}, ifMatch(1)), 401)
    assertError(await call('POST', PENSIONS, null, pension('m-1')), 401)
    assertError(await call('POST', `${PENSIONS}/${id}/pause`, null, {}, ifMatch(1)), 401)
    assertError(await call('POST', `${PENSIONS}/${id}/opt-out`, null, {}, ifMatch(1)), 401)
  })

  test('DOM-FIN-101: yönetici dışı roller 403; icra bilgisi görünmez, kayıt değişmez (K-315)', async () => {
    const t = await institution()
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const given = ok(await giveAdvance(t.admin, advance(selin)), 201)
    const icra = ok(await addGarnishment(t.admin, garnishment(selin)), 201)
    const bes = ok(await enroll(t.admin, pension(selin)), 201)
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(STAFF, cookie), 403)
      assertError(await detail(cookie, selin), 403)
      assertError(await preview(cookie, selin, { month: '2026-10' }), 403)
      assertError(await giveAdvance(cookie, advance(selin)), 403)
      assertError(
        await call(
          'POST',
          `${ADVANCES}/${String(given.id)}/cancel`,
          cookie,
          {
            reason: 'Yanlış giriş',
          },
          ifMatch(given.version),
        ),
        403,
      )
      assertError(await addGarnishment(cookie, garnishment(selin, { fileNumber: '2026/9' })), 403)
      assertError(
        await call(
          'PATCH',
          `${GARNISHMENTS}/${String(icra.id)}`,
          cookie,
          { remainingCents: 1 },
          ifMatch(icra.version),
        ),
        403,
      )
      assertError(
        await call(
          'POST',
          `${PENSIONS}/${String(bes.id)}/opt-out`,
          cookie,
          { optOutDate: '2026-10-01' },
          ifMatch(bes.version),
        ),
        403,
      )
    }
    const rows = await rowsOf(t.id)
    assert.equal(rows.advances[0]?.status, 'active')
    assert.equal(rows.garnishments.length, 1)
    assert.equal(rows.garnishments[0]?.remainingCents, 5_000_000)
    assert.equal(rows.pensions[0]?.optOutDate, null)
  })

  test('DOM-FIN-101: finance modülü kapalıyken uçlar 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    const selin = await staff(closed, 'ogretmen', 'Selin Kaya')
    assertError(await get(STAFF, closed.admin), 403, 'module_disabled')
    assertError(await detail(closed.admin, selin), 403, 'module_disabled')
    assertError(await giveAdvance(closed.admin, advance(selin)), 403, 'module_disabled')
    assertError(await addGarnishment(closed.admin, garnishment(selin)), 403, 'module_disabled')
    assertError(await enroll(closed.admin, pension(selin)), 403, 'module_disabled')
    assert.equal((await rowsOf(closed.id)).advances.length, 0)
  })

  test('DOM-FIN-101: avans taksit planıyla kalıcıdır; Idempotency-Key zorunlu ve yinelemede tek satır (K-312)', async () => {
    const t = await institution()
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    assertError(await giveAdvance(t.admin, advance(selin), {}), 400, 'idempotency_key_required')
    const headers = key()
    const first = await giveAdvance(t.admin, advance(selin), headers)
    const second = await giveAdvance(t.admin, advance(selin), headers)
    const created = ok(first, 201)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.deepEqual(second.json(), first.json())
    assert.deepEqual(created.installments, [
      { month: '2026-10', amountCents: 333_333, state: 'current' },
      { month: '2026-11', amountCents: 333_333, state: 'upcoming' },
      { month: '2026-12', amountCents: 333_334, state: 'upcoming' },
    ])
    assert.equal(created.outstandingCents, 1_000_000)
    assert.equal(created.status, 'active')
    const rows = await rowsOf(t.id)
    assert.equal(rows.advances.length, 1)
    assert.equal(rows.advances[0]?.createdByUserId !== '', true)
    const [audit] = await auditsOf(t.id, 'staff_advance.create')
    assert.deepEqual((audit?.changes as { fields: string[] }).fields.sort(), [
      'amountCents',
      'firstMonth',
      'givenDate',
      'installmentCount',
      'membershipId',
      'paymentMethod',
    ])
  })

  test('DOM-FIN-101: avans kural ihlali 422, gövde hatası 400; kayıt değişmez (K-312)', async () => {
    const t = await institution()
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const parent = await staff(t, 'veli', 'Ayşe Yılmaz')
    const cases: [Json, number, string?][] = [
      [advance(selin, { givenDate: '2026-10-07' }), 422, 'staff_deduction_date_in_future'],
      [advance(selin, { firstMonth: '2026-09' }), 422, 'staff_advance_first_month_before_given'],
      [advance(selin, { firstMonth: '2027-11' }), 422, 'staff_advance_first_month_too_late'],
      [advance('m-yok'), 422, 'staff_deduction_staff_not_found'],
      [advance(parent), 422, 'staff_deduction_not_staff'],
      [advance(selin, { installmentCount: 25 }), 400],
      [advance(selin, { amountCents: 0 }), 400],
      [advance(selin, { institutionId: t.id }), 400],
    ]
    for (const [body, status, code] of cases)
      assertError(await giveAdvance(t.admin, body), status, code)
    assert.equal((await rowsOf(t.id)).advances.length, 0)
  })

  test('DOM-FIN-101: erken kapama kalanı keser, iptal gerekçeyle; ikinci kez 422, sürüm 409 (K-312)', async () => {
    const t = await institution()
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const first = ok(await giveAdvance(t.admin, advance(selin)), 201)
    const url = `${ADVANCES}/${String(first.id)}`
    assertError(
      await call('POST', `${url}/close`, t.admin, {
        closedDate: '2026-10-06',
        fromMonth: '2026-11',
        method: 'cash',
      }),
      400,
      'if_match_required',
    )
    assertError(
      await call(
        'POST',
        `${url}/close`,
        t.admin,
        { closedDate: '2026-10-06', fromMonth: '2027-01', method: 'cash' },
        ifMatch(first.version),
      ),
      422,
      'staff_advance_close_month_outside_plan',
    )
    const closed = ok(
      await call(
        'POST',
        `${url}/close`,
        t.admin,
        { closedDate: '2026-10-06', fromMonth: '2026-11', method: 'cash' },
        ifMatch(first.version),
      ),
    )
    assert.equal(closed.status, 'closed')
    assert.equal(closed.closedRemainderCents, 666_667)
    assert.equal(closed.outstandingCents, 333_333)
    assert.deepEqual(
      (closed.installments as Json[]).map((item) => item.state),
      ['current', 'closed', 'closed'],
    )
    assertError(
      await call(
        'POST',
        `${url}/cancel`,
        t.admin,
        { reason: 'Yanlış giriş' },
        ifMatch(first.version),
      ),
      409,
      'version_conflict',
    )
    assertError(
      await call(
        'POST',
        `${url}/cancel`,
        t.admin,
        { reason: 'Yanlış giriş' },
        ifMatch(closed.version),
      ),
      422,
      'staff_advance_not_active',
    )

    const second = ok(await giveAdvance(t.admin, advance(selin, { amountCents: 50_000 })), 201)
    assertError(
      await call(
        'POST',
        `${ADVANCES}/${String(second.id)}/cancel`,
        t.admin,
        { reason: 'kısa' },
        ifMatch(second.version),
      ),
      400,
    )
    const cancelled = ok(
      await call(
        'POST',
        `${ADVANCES}/${String(second.id)}/cancel`,
        t.admin,
        { reason: 'Tutar yanlış girildi' },
        ifMatch(second.version),
      ),
    )
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.outstandingCents, 0)
    const [audit] = await auditsOf(t.id, 'staff_advance.cancel')
    assert.deepEqual((audit?.changes as { fields: string[] }).fields, ['status', 'cancelReason'])
    assert.equal(JSON.stringify(audit).includes('Tutar yanlış'), false)
  })

  test('DOM-FIN-101: icra kaydı sırayla; aynı dosya 409; kalan alacak ve kapanış; okuma denetlenir (K-313, K-315)', async () => {
    const t = await institution()
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const first = ok(await addGarnishment(t.admin, garnishment(selin)), 201)
    assert.equal(first.rateBasisPoints, 2500)
    assert.equal(first.remainingCents, 5_000_000)
    assert.equal(first.sequence, 1)
    assert.equal(first.queuePosition, 1)
    assertError(
      await addGarnishment(t.admin, garnishment(selin)),
      409,
      'staff_garnishment_duplicate',
    )
    const alimony = ok(
      await addGarnishment(
        t.admin,
        garnishment(selin, {
          fileNumber: '2026/77',
          isAlimony: true,
          rateBasisPoints: 1000,
          receivedDate: '2026-10-01',
        }),
      ),
      201,
    )
    assert.equal(alimony.sequence, 2)
    assert.equal(alimony.queuePosition, 1)
    assertError(
      await addGarnishment(
        t.admin,
        garnishment(selin, { fileNumber: '2026/8', receivedDate: '2026-10-07' }),
      ),
      422,
      'staff_deduction_date_in_future',
    )

    const url = `${GARNISHMENTS}/${String(first.id)}`
    assertError(
      await call('PATCH', url, t.admin, { remainingCents: 5_000_001 }, ifMatch(first.version)),
      422,
      'staff_garnishment_remaining_exceeds_claim',
    )
    const updated = ok(
      await call('PATCH', url, t.admin, { remainingCents: 120_000 }, ifMatch(first.version)),
    )
    assert.equal(updated.remainingCents, 120_000)
    assert.equal(updated.queuePosition, 2)
    assertError(
      await call(
        'POST',
        `${url}/close`,
        t.admin,
        { closedDate: '2026-09-01', reason: 'paid_off' },
        ifMatch(updated.version),
      ),
      422,
      'staff_garnishment_close_before_received',
    )
    const closedIcra = ok(
      await call(
        'POST',
        `${url}/close`,
        t.admin,
        { closedDate: '2026-10-06', reason: 'paid_off' },
        ifMatch(updated.version),
      ),
    )
    assert.equal(closedIcra.status, 'closed')
    assert.equal(closedIcra.queuePosition, null)
    assertError(
      await call('PATCH', url, t.admin, { remainingCents: 0 }, ifMatch(closedIcra.version)),
      422,
      'staff_garnishment_closed',
    )

    const before = (await auditsOf(t.id, 'staff_deduction.read')).length
    const read = ok(await detail(t.admin, selin))
    assert.equal((read.garnishments as Json[]).length, 2)
    const reads = await auditsOf(t.id, 'staff_deduction.read')
    assert.equal(reads.length, before + 1)
    assert.equal(reads[0]?.entityId, selin)
    assert.equal(JSON.stringify(reads).includes('İcra Dairesi'), false)
    const creates = await auditsOf(t.id, 'staff_garnishment.create')
    assert.equal(JSON.stringify(creates).includes('2026/1234'), false)
  })

  test('DOM-FIN-101: BES katılımı tek açık, ara verme ve cayma (K-314)', async () => {
    const t = await institution()
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const enrolled = ok(await enroll(t.admin, pension(selin)), 201)
    assert.equal(enrolled.rateBasisPoints, 300)
    assert.equal(enrolled.state, 'active')
    assertError(await enroll(t.admin, pension(selin)), 409, 'staff_pension_already_enrolled')
    assertError(await enroll(t.admin, pension(selin, { rateBasisPoints: 200 })), 400)
    const url = `${PENSIONS}/${String(enrolled.id)}`
    const paused = ok(
      await call(
        'POST',
        `${url}/pause`,
        t.admin,
        { fromMonth: '2026-10', toMonth: '2026-12' },
        ifMatch(enrolled.version),
      ),
    )
    assert.equal(paused.state, 'paused')
    assert.deepEqual(paused.pauses, [{ fromMonth: '2026-10', toMonth: '2026-12' }])
    assertError(
      await call(
        'POST',
        `${url}/pause`,
        t.admin,
        { fromMonth: '2026-12', toMonth: '2027-01' },
        ifMatch(paused.version),
      ),
      422,
      'staff_pension_pause_overlap',
    )
    const out = ok(
      await call(
        'POST',
        `${url}/opt-out`,
        t.admin,
        { optOutDate: '2026-10-06' },
        ifMatch(paused.version),
      ),
    )
    assert.equal(out.state, 'opted_out')
    assert.equal(out.optOutKind, 'cooling_off')
    assertError(
      await call(
        'POST',
        `${url}/opt-out`,
        t.admin,
        { optOutDate: '2026-10-06' },
        ifMatch(out.version),
      ),
      422,
      'staff_pension_opted_out',
    )
    const again = ok(await enroll(t.admin, pension(selin, { startDate: '2026-10-06' })), 201)
    assert.equal(again.state, 'active')
    assert.equal((await rowsOf(t.id)).pensions.length, 2)
  })

  test('DOM-FIN-101: ay için kesinti listesi sıralı ve tavanlı; net yoksa yalnız sabit tutar; hiçbir şey yazmaz (K-315)', async () => {
    const t = await institution()
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const given = ok(await giveAdvance(t.admin, advance(selin)), 201)
    const icra = ok(await addGarnishment(t.admin, garnishment(selin)), 201)
    const waiting = ok(
      await addGarnishment(
        t.admin,
        garnishment(selin, { fileNumber: '2026/55', receivedDate: '2026-09-20' }),
      ),
      201,
    )
    const bes = ok(await enroll(t.admin, pension(selin)), 201)
    const result = ok(
      await preview(t.admin, selin, {
        month: '2026-10',
        netCents: 4_000_000,
        pensionBaseCents: 5_000_000,
      }),
    )
    assert.deepEqual(
      (result.lines as Json[]).map((line) => [
        line.kind,
        line.sourceId,
        line.amountCents,
        line.status,
      ]),
      [
        ['advance', given.id, 333_333, 'applied'],
        ['garnishment', icra.id, 1_000_000, 'applied'],
        ['garnishment', waiting.id, 0, 'waiting'],
        ['pension', bes.id, 150_000, 'applied'],
      ],
    )
    assert.equal(result.remainingNetCents, 4_000_000 - 1_483_333)
    const capped = ok(await preview(t.admin, selin, { month: '2026-10', netCents: 400_000 }))
    assert.deepEqual(
      (capped.lines as Json[]).map((line) => [line.amountCents, line.status]),
      [
        [333_333, 'applied'],
        [66_667, 'capped'],
        [0, 'waiting'],
        [null, 'needs_base'],
      ],
    )
    const noNet = ok(await preview(t.admin, selin, { month: '2026-11' }))
    assert.equal(noNet.totalCents, 333_333)
    assert.equal(noNet.remainingNetCents, null)
    assertError(await preview(t.admin, selin, { month: '2026-13' }), 400)
    assertError(await preview(t.admin, selin, { month: '2026-10', netCents: -1 }), 400)
    const rows = await rowsOf(t.id)
    assert.equal(
      rows.garnishments.every((row) => row.remainingCents === 5_000_000),
      true,
    )
    assert.equal((await auditsOf(t.id, 'staff_deduction.preview')).length, 3)
  })

  test('DOM-FIN-101: personel listesi açık kayıt sayılarıyla; pasif ve holding süzgeci', async () => {
    const t = await institution()
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    await staff(t, 'onburo', 'Merve Ak')
    await staff(t, 'veli', 'Ayşe Yılmaz')
    ok(await giveAdvance(t.admin, advance(selin)), 201)
    ok(await addGarnishment(t.admin, garnishment(selin)), 201)
    const all = await staffOf(t.admin, '?q=selin')
    assert.deepEqual(
      all.data.map((row) => [
        row.name,
        row.activeAdvanceCount,
        row.activeGarnishmentCount,
        row.openPensionCount,
      ]),
      [['Selin Kaya', 1, 1, 0]],
    )
    const holding = await staffOf(t.admin, '?holding=true')
    assert.deepEqual(
      holding.data.map((row) => row.membershipId),
      [selin],
    )
    const everyone = await staffOf(t.admin)
    assert.equal(
      everyone.data.some((row) => row.name === 'Ayşe Yılmaz'),
      false,
    )
    assert.equal(
      everyone.data.some((row) => row.name === 'Merve Ak'),
      true,
    )
    assert.equal((await auditsOf(t.id, 'staff_deduction.list_read')).length >= 1, true)
    assertError(await get(`${STAFF}?unknown=1`, t.admin), 400)
  })

  test('DOM-FIN-101: başka kurumun personeli ve kayıtları 404 ve B değişmez; listede yok; gövdedeki B üyeliği etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bStaff = await staff(b, 'ogretmen', 'Beta Öğretmen')
    const bAdvance = ok(await giveAdvance(b.admin, advance(bStaff)), 201)
    const bIcra = ok(await addGarnishment(b.admin, garnishment(bStaff)), 201)
    const bBes = ok(await enroll(b.admin, pension(bStaff)), 201)
    const bRowsBefore = await rowsOf(b.id)

    assertError(await detail(a.admin, bStaff), 404)
    assertError(await preview(a.admin, bStaff, { month: '2026-10' }), 404)
    assertError(
      await call(
        'POST',
        `${ADVANCES}/${String(bAdvance.id)}/close`,
        a.admin,
        { closedDate: '2026-10-06', fromMonth: '2026-11', method: 'cash' },
        ifMatch(bAdvance.version),
      ),
      404,
    )
    assertError(
      await call(
        'POST',
        `${ADVANCES}/${String(bAdvance.id)}/cancel`,
        a.admin,
        { reason: 'Başka kurum' },
        ifMatch(bAdvance.version),
      ),
      404,
    )
    assertError(
      await call(
        'PATCH',
        `${GARNISHMENTS}/${String(bIcra.id)}`,
        a.admin,
        { remainingCents: 0 },
        ifMatch(bIcra.version),
      ),
      404,
    )
    assertError(
      await call(
        'POST',
        `${GARNISHMENTS}/${String(bIcra.id)}/close`,
        a.admin,
        { closedDate: '2026-10-06', reason: 'lifted' },
        ifMatch(bIcra.version),
      ),
      404,
    )
    assertError(
      await call(
        'POST',
        `${PENSIONS}/${String(bBes.id)}/pause`,
        a.admin,
        { fromMonth: '2026-11', toMonth: '2026-11' },
        ifMatch(bBes.version),
      ),
      404,
    )
    assertError(
      await call(
        'POST',
        `${PENSIONS}/${String(bBes.id)}/opt-out`,
        a.admin,
        { optOutDate: '2026-10-06' },
        ifMatch(bBes.version),
      ),
      404,
    )
    assertError(await giveAdvance(a.admin, advance(bStaff)), 422, 'staff_deduction_staff_not_found')
    assertError(
      await addGarnishment(a.admin, garnishment(bStaff)),
      422,
      'staff_deduction_staff_not_found',
    )
    assertError(await enroll(a.admin, pension(bStaff)), 422, 'staff_deduction_staff_not_found')
    assertError(await enroll(a.admin, { ...pension(bStaff), institutionId: b.id }), 400)
    assert.equal(
      (await staffOf(a.admin)).data.some((row) => row.membershipId === bStaff),
      false,
    )
    const aRows = await rowsOf(a.id)
    assert.equal(aRows.advances.length + aRows.garnishments.length + aRows.pensions.length, 0)
    assert.deepEqual(await rowsOf(b.id), bRowsBefore)
  })

  // --- Dönem kilidi (DOM-FIN-108; ON-343, K-394) ---------------------------------------------

  const PERIODS = `${FINANCE}/payroll-periods`
  async function periodOf(t: Tenant, month: string) {
    const year = ok(await get(`${PERIODS}?year=${month.slice(0, 4)}`, t.admin)) as {
      months: { month: string; version: number | null; current: { inputsHash: string } | null }[]
    }
    const view = year.months.find((item) => item.month === month)
    assert.ok(view)
    return view
  }
  async function approveMonth(t: Tenant, month: string) {
    const view = await periodOf(t, month)
    assert.ok(view.current)
    const response = await call(
      'POST',
      `${PERIODS}/${month}/approve`,
      t.admin,
      { inputsHash: view.current.inputsHash },
      key(),
    )
    assert.ok([200, 201].includes(response.statusCode), response.body)
  }

  test('DOM-FIN-101: kilitli bordro ayına düşen avans, icra ve BES yazması 409 payroll_period_locked, kayıt değişmez (DOM-FIN-108, K-394)', async () => {
    const t = await institution()
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const ahmet = await staff(t, 'onburo', 'Ahmet Demir')
    // Kilitten önce: Eylül'de başlayan avans, Ağustos tebliğli icra, Eylül başlangıçlı BES.
    const given = ok(
      await giveAdvance(
        t.admin,
        advance(selin, { givenDate: '2026-09-01', firstMonth: '2026-09' }),
      ),
      201,
    )
    const icra = ok(
      await addGarnishment(t.admin, garnishment(selin, { receivedDate: '2026-08-10' })),
      201,
    )
    const bes = ok(await enroll(t.admin, pension(selin)), 201)
    await approveMonth(t, '2026-09')
    const before = await rowsOf(t.id)

    const locked = (response: Response, path: string) => {
      assertError(response, 409, 'payroll_period_locked')
      assert.deepEqual(response.json().issues?.[0]?.path, [path])
    }
    // Avans: plan Eylül'e değerse yeni kayıt, iptal ve Eylül'den kapama 409.
    locked(
      await giveAdvance(
        t.admin,
        advance(ahmet, { givenDate: '2026-09-01', firstMonth: '2026-09' }),
      ),
      'firstMonth',
    )
    locked(
      await call(
        'POST',
        `${ADVANCES}/${String(given.id)}/cancel`,
        t.admin,
        { reason: 'Yanlış tutar girildi' },
        ifMatch(given.version),
      ),
      'reason',
    )
    // İcra: Eylül tebliği ve Eylül kapanışı 409; BES: Eylül başlangıcı, ara ve ayrılma 409.
    locked(
      await addGarnishment(
        t.admin,
        garnishment(ahmet, { fileNumber: '2026/77', receivedDate: '2026-09-15' }),
      ),
      'receivedDate',
    )
    locked(
      await call(
        'POST',
        `${GARNISHMENTS}/${String(icra.id)}/close`,
        t.admin,
        { closedDate: '2026-09-30', reason: 'paid_off' },
        ifMatch(icra.version),
      ),
      'closedDate',
    )
    locked(await enroll(t.admin, pension(ahmet, { startDate: '2026-09-10' })), 'startDate')
    locked(
      await call(
        'POST',
        `${PENSIONS}/${String(bes.id)}/pause`,
        t.admin,
        { fromMonth: '2026-09', toMonth: '2026-10' },
        ifMatch(bes.version),
      ),
      'fromMonth',
    )
    locked(
      await call(
        'POST',
        `${PENSIONS}/${String(bes.id)}/opt-out`,
        t.admin,
        { optOutDate: '2026-09-20' },
        ifMatch(bes.version),
      ),
      'optOutDate',
    )
    assert.deepEqual(await rowsOf(t.id), before)
    assert.equal((await auditsOf(t.id, 'staff_advance.cancel')).length, 0)

    // Kilitli aya değmeyen değişiklik geçer; kalan alacak tarihsiz bakiyedir, denetlenmez.
    ok(
      await giveAdvance(
        t.admin,
        advance(ahmet, { givenDate: '2026-09-01', firstMonth: '2026-10' }),
      ),
      201,
    )
    const closed = ok(
      await call(
        'POST',
        `${ADVANCES}/${String(given.id)}/close`,
        t.admin,
        { closedDate: '2026-10-05', fromMonth: '2026-10', method: 'cash' },
        ifMatch(given.version),
      ),
    )
    assert.equal(closed.status, 'closed')
    ok(
      await call(
        'PATCH',
        `${GARNISHMENTS}/${String(icra.id)}`,
        t.admin,
        { remainingCents: 4_000_000 },
        ifMatch(icra.version),
      ),
    )
    ok(
      await call(
        'POST',
        `${PENSIONS}/${String(bes.id)}/pause`,
        t.admin,
        { fromMonth: '2026-10', toMonth: '2026-11' },
        ifMatch(bes.version),
      ),
    )
    ok(await enroll(t.admin, pension(ahmet, { startDate: '2026-10-01' })), 201)

    // Dönem yeniden açılınca Eylül'e düşen değişiklik yazılır.
    const view = await periodOf(t, '2026-09')
    ok(
      await call(
        'POST',
        `${PERIODS}/2026-09/reopen`,
        t.admin,
        { reason: 'İcra kapanışı eksik girildi' },
        { ...ifMatch(view.version), ...key() },
      ),
    )
    ok(
      await call(
        'POST',
        `${GARNISHMENTS}/${String(icra.id)}/close`,
        t.admin,
        { closedDate: '2026-09-30', reason: 'paid_off' },
        ifMatch(Number(icra.version) + 1),
      ),
    )
  })

  test('DOM-FIN-101: başka kurumun kilidi bu kurumun kesinti yazmasını etkilemez (K-394)', async () => {
    const a = await institution()
    const b = await institution()
    const selin = await staff(a, 'ogretmen', 'Selin Kaya')
    await approveMonth(b, '2026-09')
    ok(
      await giveAdvance(
        a.admin,
        advance(selin, { givenDate: '2026-09-01', firstMonth: '2026-09' }),
      ),
      201,
    )
  })
})
