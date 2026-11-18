import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { sgkEmploymentDates, sgkMissingDays } from '../src/db/schema/finance-sgk-preparation.ts'
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
 * SGK bildirge hazırlık listesi uçları (DOM-FIN-107; ON-203; K-352…K-355). Her test kendi
 * kurumunu kurar; ücret tanımı ücret ucuyla (DOM-FIN-099) yazılır. FIXED_NOW 2026-10-06.
 */

const FINANCE = '/api/v1/finance'
const LIST = `${FINANCE}/sgk-preparation`
const MISSING = `${FINANCE}/sgk-missing-days`
const DATES = `${FINANCE}/sgk-employment-dates`
const RATES = `${FINANCE}/pay-rates`
const OCTOBER = `${LIST}?month=2026-10`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-107: SGK bildirge hazırlık listesi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.107.0.1'

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
    clientIp = `10.107.${String((tenantCount += 1))}.1`
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
  const wage = (membershipId: string, startDate: string, amountCents = 4_500_000) => ({
    component: 'wage',
    membershipId,
    rateType: 'monthly_gross',
    amountCents,
    startDate,
  })
  const addMissing = (cookie: string | null, body: Json, headers: Record<string, string> = {}) =>
    call('POST', MISSING, cookie, body, headers)
  const addDates = (cookie: string | null, body: Json) => call('POST', DATES, cookie, body)
  const listOf = async (cookie: string, url = OCTOBER) => ok(await get(url, cookie))
  const rowsOf = (list: Json) => list.rows as Json[]
  const missingRows = (institutionId: string) =>
    db.select().from(sgkMissingDays).where(eq(sgkMissingDays.institutionId, institutionId))
  const datesRows = (institutionId: string) =>
    db.select().from(sgkEmploymentDates).where(eq(sgkEmploymentDates.institutionId, institutionId))
  const auditOf = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  test('kimliksiz istek 401', async () => {
    const url = `${MISSING}/${randomUUID()}`
    assertError(await get(OCTOBER, null), 401)
    assertError(await addMissing(null, { membershipId: 'm', month: '2026-10', days: 1 }), 401)
    assertError(await call('DELETE', url, null, undefined, ifMatch(1)), 401)
    assertError(
      await addDates(null, { membershipId: 'm', month: '2026-10', entryDate: '2026-10-02' }),
      401,
    )
    assertError(await call('DELETE', `${DATES}/${randomUUID()}`, null, undefined, ifMatch(1)), 401)
  })

  test('DOM-FIN-107: ön büro, öğretmen, veli ve öğrenci 403; satır yazılmaz, denetim yok (K-355)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const entry = ok(
      await addMissing(t.admin, { membershipId: selin, month: '2026-10', days: 2 }),
      201,
    )
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(OCTOBER, cookie), 403)
      assertError(await addMissing(cookie, { membershipId: selin, month: '2026-10', days: 1 }), 403)
      assertError(
        await call('DELETE', `${MISSING}/${String(entry.id)}`, cookie, undefined, ifMatch(1)),
        403,
      )
      assertError(
        await addDates(cookie, { membershipId: selin, month: '2026-10', entryDate: '2026-10-02' }),
        403,
      )
    }
    const rows = await missingRows(t.id)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.archivedAt, null)
    assert.equal((await datesRows(t.id)).length, 0)
    assert.equal((await auditOf(t.id, 'finance.sgk_preparation.read')).length, 0)
  })

  test('DOM-FIN-107: finance modülü kapalıyken uçlar 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(OCTOBER, closed.admin), 403, 'module_disabled')
    assertError(
      await addMissing(closed.admin, { membershipId: 'm', month: '2026-10', days: 1 }),
      403,
      'module_disabled',
    )
    assertError(
      await addDates(closed.admin, { membershipId: 'm', month: '2026-10', exitDate: '2026-10-02' }),
      403,
      'module_disabled',
    )
  })

  test('DOM-FIN-107: ay listesi ücret tanımından giriş, eksik gün, elle çıkış ve matrah tahmini (K-352…K-354)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const ali = await person(t, 'onburo', 'Ali Demir')
    const zeynep = await person(t, 'ogretmen', 'Zeynep Ak')
    await person(t, 'ogretmen', 'Tanımsız Öğretmen')
    await rate(t, wage(selin, '2026-01-01'))
    await rate(t, {
      component: 'benefit',
      membershipId: selin,
      rateType: 'meal',
      amountCents: 300_000,
      benefitForm: 'cash',
      taxable: true,
      startDate: '2026-01-01',
    })
    await rate(t, wage(ali, '2026-10-16', 2_000_000))
    await rate(t, wage(zeynep, '2026-11-01'))

    const first = ok(
      await addMissing(t.admin, {
        membershipId: selin,
        month: '2026-10',
        days: 2,
        reasonCode: '21',
        note: 'Ücretsiz izin',
      }),
      201,
    )
    assert.equal(first.month, '2026-10')
    assert.equal(first.reasonCode, '21')
    assert.equal(first.version, 1)
    ok(
      await addMissing(t.admin, {
        membershipId: selin,
        month: '2026-10',
        days: 1,
        reasonCode: '01',
      }),
      201,
    )
    const exit = ok(
      await addDates(t.admin, { membershipId: selin, month: '2026-10', exitDate: '2026-10-20' }),
      201,
    )
    assert.equal(exit.exitDate, '2026-10-20')
    assert.equal(exit.entryDate, null)

    const list = await listOf(t.admin)
    assert.equal(list.month, '2026-10')
    assert.equal(list.lastDay, '2026-10-31')
    assert.deepEqual(list.parameters, {
      effectiveFrom: '2026-01-01',
      origin: 'platform',
      stale: false,
      unverified: true,
      minimumWageGrossCents: 3_303_000,
      floorCents: 3_303_000,
      ceilingCents: 29_727_000,
    })
    const rows = rowsOf(list)
    assert.deepEqual(
      rows.map((row) => row.name),
      ['Ali Demir', 'Selin Kaya'],
    )
    const [aliRow, selinRow] = rows
    assert.equal(aliRow?.entryDate, '2026-10-16')
    assert.equal(aliRow?.entrySource, 'pay_rate')
    assert.equal(aliRow?.primDays, 16)
    // 20.000 ₺ × 16/30 = 10.666,67 ₺ < taban 33.030 × 16/30 = 17.616 ₺.
    assert.equal(aliRow?.sgkBaseCents, 1_761_600)
    assert.deepEqual(aliRow?.warnings, ['below_floor', 'entry_in_month'])

    assert.equal(selinRow?.exitDate, '2026-10-20')
    assert.equal(selinRow?.exitSource, 'manual')
    assert.equal(selinRow?.baseDays, 20)
    assert.equal(selinRow?.missingDays, 3)
    assert.equal(selinRow?.primDays, 17)
    assert.equal(selinRow?.reasonCode, '12')
    assert.equal(selinRow?.cashBenefitsCents, 300_000)
    // (45.000 + 3.000) × 17/30 = 27.200 ₺.
    assert.equal(selinRow?.sgkBaseCents, 2_720_000)
    assert.deepEqual(selinRow?.warnings, ['exit_in_month'])
    assert.equal((selinRow?.missingDayEntries as Json[]).length, 2)
    assert.equal((selinRow?.employmentDates as Json).id, exit.id)
    assert.deepEqual(list.totals, {
      staffCount: 2,
      primDays: 33,
      missingDays: 3,
      sgkBaseCents: 4_481_600,
      unestimatedCount: 0,
      warningRowCount: 2,
    })
    const reads = await auditOf(t.id, 'finance.sgk_preparation.read')
    assert.equal(reads.length, 1)
    assert.equal(reads[0]?.entityId, 'sgk-preparation:2026-10')
    assert.deepEqual(reads[0]?.changes, {
      fields: ['name', 'wage', 'sgkBaseCents', 'primDays', 'missingDays', 'reasonCode'],
    })
    const creates = await auditOf(t.id, 'finance.sgk_missing_day.create')
    assert.deepEqual(creates[0]?.changes, {
      fields: ['membershipId', 'month', 'days', 'reasonCode', 'note'],
    })
  })

  test('DOM-FIN-107: CSV ve PDF verisi denetime düşer, taze oturum ister (K-355)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', '=Selin Kaya')
    await rate(t, wage(selin, '2026-01-01'))
    const file = await get(OCTOBER, t.admin, { accept: 'text/csv' })
    assert.equal(file.statusCode, 200, file.body)
    assert.match(String(file.headers['content-type']), /text\/csv/)
    assert.match(String(file.headers['content-disposition']), /sgk-hazirlik-listesi-2026-10\.csv/)
    assert.ok(file.body.startsWith('\uFEFF'))
    const lines = file.body.replace('\uFEFF', '').split('\r\n')
    assert.match(lines[0]!, /^"Ad soyad";"T.C. kimlik no";/)
    assert.match(lines[1]!, /^"'=Selin Kaya";"";"Öğretmen";"";"";"";"";30;0;/)
    assert.match(lines[2]!, /^"Toplam";"";"1 personel";/)

    const pdf = ok(await get(`${OCTOBER}&purpose=pdf`, t.admin))
    assert.equal(rowsOf(pdf).length, 1)
    assert.deepEqual(
      (await auditOf(t.id, 'finance.sgk_preparation_export')).map((row) => row.entityId).sort(),
      ['sgk-preparation:2026-10:csv', 'sgk-preparation:2026-10:pdf'],
    )
    assert.equal((await auditOf(t.id, 'finance.sgk_preparation.read')).length, 0)

    const later = await buildTestApp(db, { clock: () => new Date(Date.now() + 16 * 60 * 1000) })
    try {
      assertError(
        await call('GET', OCTOBER, t.admin, undefined, { accept: 'text/csv' }, later),
        403,
        'reauthentication_required',
      )
      assertError(
        await call('GET', `${OCTOBER}&purpose=pdf`, t.admin, undefined, {}, later),
        403,
        'reauthentication_required',
      )
      // Ekran okuması taze oturum istemez.
      assert.equal((await call('GET', OCTOBER, t.admin, undefined, {}, later)).statusCode, 200)
    } finally {
      await later.close()
    }
    assert.equal((await auditOf(t.id, 'finance.sgk_preparation_export')).length, 2)
  })

  test('DOM-FIN-107: geçersiz istek 400, kural reddi 422, aylık tek giriş/çıkış 409; kayıt değişmez', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const parent = await person(t, 'veli', 'Ayşe Yılmaz')
    assertError(await get(`${LIST}?month=2026-13`, t.admin), 400)
    assertError(await get(`${LIST}?month=2026-10&extra=1`, t.admin), 400)
    assertError(await get(`${LIST}?month=2024-06`, t.admin), 422, 'payroll_parameters_missing')
    const base = { membershipId: selin, month: '2026-10' }
    assertError(await addMissing(t.admin, { ...base, days: 0 }), 400)
    assertError(await addMissing(t.admin, { ...base, days: 2, reasonCode: '12' }), 400)
    assertError(await addDates(t.admin, base), 400)
    assertError(await addDates(t.admin, { ...base, entryDate: '2026-11-02' }), 400)
    assertError(
      await addMissing(t.admin, { ...base, membershipId: parent, days: 1 }),
      422,
      'sgk_not_staff',
    )
    assertError(
      await addMissing(t.admin, { ...base, membershipId: 'yok', days: 1 }),
      422,
      'sgk_staff_not_found',
    )
    ok(await addMissing(t.admin, { ...base, days: 25 }), 201)
    assertError(
      await addMissing(t.admin, { ...base, days: 6 }),
      422,
      'sgk_missing_days_exceed_month',
    )
    ok(await addMissing(t.admin, { ...base, days: 5 }), 201)
    ok(await addDates(t.admin, { ...base, entryDate: '2026-10-05' }), 201)
    assertError(
      await addDates(t.admin, { ...base, exitDate: '2026-10-25' }),
      409,
      'sgk_employment_dates_exist',
    )
    assert.equal((await missingRows(t.id)).length, 2)
    const dated = await datesRows(t.id)
    assert.equal(dated.length, 1)
    assert.equal(dated[0]?.exitDate, null)
  })

  test('DOM-FIN-107: kaldırma If-Match ister, sürüm denetlenir; kaldırılan satır listeye girmez', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    await rate(t, wage(selin, '2026-01-01'))
    const entry = ok(
      await addMissing(t.admin, { membershipId: selin, month: '2026-10', days: 4 }),
      201,
    )
    const dates = ok(
      await addDates(t.admin, { membershipId: selin, month: '2026-10', entryDate: '2026-10-10' }),
      201,
    )
    const entryUrl = `${MISSING}/${String(entry.id)}`
    const datesUrl = `${DATES}/${String(dates.id)}`
    assertError(await call('DELETE', entryUrl, t.admin), 400, 'if_match_required')
    assertError(await call('DELETE', entryUrl, t.admin, undefined, ifMatch(2)), 409)
    assertError(await call('DELETE', `${MISSING}/yok`, t.admin, undefined, ifMatch(1)), 400)
    let row = rowsOf(await listOf(t.admin))[0]
    assert.equal(row?.primDays, 18)
    assert.deepEqual(row?.warnings, ['missing_reason', 'entry_in_month'])

    const removed = ok(await call('DELETE', entryUrl, t.admin, undefined, ifMatch(1)))
    assert.equal(removed.id, entry.id)
    ok(await call('DELETE', datesUrl, t.admin, undefined, ifMatch(1)))
    assertError(await call('DELETE', entryUrl, t.admin, undefined, ifMatch(2)), 404)
    row = rowsOf(await listOf(t.admin))[0]
    assert.equal(row?.primDays, 30)
    assert.deepEqual(row?.warnings, [])
    const [stored] = await missingRows(t.id)
    assert.notEqual(stored?.archivedAt, null)
    assert.equal(stored?.version, 2)
    assert.equal((await auditOf(t.id, 'finance.sgk_missing_day.archive')).length, 1)
    assert.equal((await auditOf(t.id, 'finance.sgk_employment_dates.archive')).length, 1)
    // Kaldırılan giriş/çıkış aynı ay için yeni satıra yer açar.
    ok(
      await addDates(t.admin, { membershipId: selin, month: '2026-10', entryDate: '2026-10-12' }),
      201,
    )
  })

  test('DOM-FIN-107: başka kurumun personeli ve satırı 404 ve B değişmez; listede yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bStaff = await person(b, 'ogretmen', 'Beta Öğretmen')
    await rate(b, wage(bStaff, '2026-01-01'))
    const bEntry = ok(
      await addMissing(b.admin, { membershipId: bStaff, month: '2026-10', days: 2 }),
      201,
    )
    const bDates = ok(
      await addDates(b.admin, { membershipId: bStaff, month: '2026-10', exitDate: '2026-10-15' }),
      201,
    )
    assertError(
      await call('DELETE', `${MISSING}/${String(bEntry.id)}`, a.admin, undefined, ifMatch(1)),
      404,
    )
    assertError(
      await call('DELETE', `${DATES}/${String(bDates.id)}`, a.admin, undefined, ifMatch(1)),
      404,
    )
    assert.equal(rowsOf(await listOf(a.admin)).length, 0)
    assertError(
      await addMissing(a.admin, { membershipId: bStaff, month: '2026-10', days: 1 }),
      422,
      'sgk_staff_not_found',
    )
    assertError(
      await addDates(a.admin, { membershipId: bStaff, month: '2026-10', exitDate: '2026-10-20' }),
      422,
      'sgk_staff_not_found',
    )
    assertError(
      await addMissing(a.admin, {
        membershipId: bStaff,
        month: '2026-10',
        days: 1,
        institutionId: b.id,
      }),
      400,
    )
    assert.equal((await missingRows(a.id)).length, 0)
    assert.equal((await datesRows(a.id)).length, 0)
    const [bRow] = await missingRows(b.id)
    assert.equal(bRow?.archivedAt, null)
    assert.equal(bRow?.version, 1)
    const [bDate] = await datesRows(b.id)
    assert.equal(bDate?.archivedAt, null)
    assert.equal((await auditOf(b.id, 'finance.sgk_preparation.read')).length, 0)
  })

  test('DOM-FIN-107: Idempotency-Key ile yinelenen eksik gün aynı yanıtı döner, tek satır yazılır', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const headers = { 'idempotency-key': randomUUID() }
    const body = { membershipId: selin, month: '2026-10', days: 3, reasonCode: '15' }
    const first = await addMissing(t.admin, body, headers)
    const second = await addMissing(t.admin, body, headers)
    assert.equal(first.statusCode, 201)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal(second.json().data.id, first.json().data.id)
    assert.equal((await missingRows(t.id)).length, 1)
  })
})
