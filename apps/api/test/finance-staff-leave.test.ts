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
  staffLeaveProfiles,
  staffLeaveRecords,
  staffLeaveTypes,
} from '../src/db/schema/finance-staff-leave.ts'
import { ensureMember } from '../src/services/identity.ts'
import { seniorityStartFor } from '../src/services/finance-staff-leave.ts'
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
 * Personel izin uçları (DOM-FIN-109; ON-181; K-360…K-362). Her test kendi kurumunu kurar;
 * personel adlı kullanıcıyla açılır. FIXED_NOW 2026-10-06.
 */

const FINANCE = '/api/v1/finance'
const TYPES = `${FINANCE}/leave-types`
const STAFF = `${FINANCE}/leave-staff`
const PROFILES = `${FINANCE}/leave-profiles`
const RECORDS = `${FINANCE}/leave-records`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-109: personel izin uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.181.0.1'

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
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
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
    clientIp = `10.181.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  /** Adlı personel ya da veli üyeliği (giriş yapmaz). */
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

  const openProfile = (cookie: string, body: Json) => call('POST', PROFILES, cookie, body)
  const patchProfile = (cookie: string, membershipId: string, body: Json, version: unknown) =>
    call('PATCH', `${PROFILES}/${membershipId}`, cookie, body, ifMatch(version))
  const record = (membershipId: string, startDate: string, endDate: string, days: number) => ({
    membershipId,
    typeCode: 'annual',
    startDate,
    endDate,
    days,
  })
  const addRecord = (cookie: string, body: Json, headers: Record<string, string> = key()) =>
    call('POST', RECORDS, cookie, body, headers)
  const cancelRecord = (cookie: string, rec: Json, reason = 'Yanlış personele girildi') =>
    call('POST', `${RECORDS}/${String(rec.id)}/cancel`, cookie, { reason }, ifMatch(rec.version))
  const patchType = (cookie: string, code: string, body: Json, version: unknown) =>
    call('PATCH', `${TYPES}/${code}`, cookie, body, ifMatch(version))
  const typesOf = async (cookie: string) => {
    const response = await get(TYPES, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json().data as Json[]
  }
  const staffListOf = async (cookie: string, query = '') => {
    const response = await get(`${STAFF}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }
  const detailOf = async (cookie: string, membershipId: string, query = '') =>
    ok(await get(`${STAFF}/${membershipId}${query}`, cookie))
  const rowsOf = async (institutionId: string) => ({
    types: await db
      .select()
      .from(staffLeaveTypes)
      .where(eq(staffLeaveTypes.institutionId, institutionId)),
    profiles: await db
      .select()
      .from(staffLeaveProfiles)
      .where(eq(staffLeaveProfiles.institutionId, institutionId)),
    records: await db
      .select()
      .from(staffLeaveRecords)
      .where(eq(staffLeaveRecords.institutionId, institutionId)),
  })
  const auditOf = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    assertError(await get(TYPES, null), 401)
    assertError(await call('POST', TYPES, null, { kind: 'other' }), 401)
    assertError(await call('PATCH', `${TYPES}/annual`, null, { label: 'X' }, ifMatch(0)), 401)
    assertError(await get(STAFF, null), 401)
    assertError(await get(`${STAFF}/m-1`, null), 401)
    assertError(await call('POST', PROFILES, null, {}), 401)
    assertError(await call('PATCH', `${PROFILES}/m-1`, null, {}, ifMatch(1)), 401)
    assertError(await call('POST', RECORDS, null, {}, key()), 401)
    assertError(
      await call('POST', `${RECORDS}/${id}/cancel`, null, { reason: 'Yanlış' }, ifMatch(1)),
      401,
    )
  })

  test('DOM-FIN-109: ön büro, öğretmen, veli ve öğrenci 403; kayıt değişmez', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    ok(await openProfile(t.admin, { membershipId: selin, seniorityStartDate: '2020-03-15' }), 201)
    const rec = ok(await addRecord(t.admin, record(selin, '2026-07-06', '2026-07-10', 5)), 201)
    const before = await rowsOf(t.id)
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(TYPES, cookie), 403)
      assertError(await call('POST', TYPES, cookie, { kind: 'other' }), 403)
      assertError(await patchType(cookie, 'other', { label: 'İdari izin' }, 1), 403)
      assertError(await get(STAFF, cookie), 403)
      assertError(await get(`${STAFF}/${selin}`, cookie), 403)
      assertError(await openProfile(cookie, { membershipId: selin }), 403)
      assertError(await patchProfile(cookie, selin, { birthDate: null }, 1), 403)
      assertError(await addRecord(cookie, record(selin, '2026-08-03', '2026-08-04', 2)), 403)
      assertError(await cancelRecord(cookie, rec), 403)
    }
    assert.deepEqual(await rowsOf(t.id), before)
  })

  test('DOM-FIN-109: finance modülü kapalıyken izin uçları 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(TYPES, closed.admin), 403, 'module_disabled')
    assertError(await get(STAFF, closed.admin), 403, 'module_disabled')
    assertError(await get(`${STAFF}/m-1`, closed.admin), 403, 'module_disabled')
    assertError(
      await openProfile(closed.admin, { membershipId: 'm-1', seniorityStartDate: '2020-01-01' }),
      403,
      'module_disabled',
    )
    assertError(
      await addRecord(closed.admin, record('m-1', '2026-07-06', '2026-07-06', 1)),
      403,
      'module_disabled',
    )
  })

  test('DOM-FIN-109: profil, hak ediş dökümü, kayıt ve bakiye; denetimde değer yok (K-360, K-362)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const merve = await person(t, 'onburo', 'Merve Ak')
    await person(t, 'veli', 'Ayşe Yılmaz')
    const profile = ok(
      await openProfile(t.admin, {
        membershipId: selin,
        seniorityStartDate: '2020-03-15',
        birthDate: '1975-05-20',
      }),
      201,
    )
    assert.deepEqual(profile, {
      membershipId: selin,
      seniorityStartDate: '2020-03-15',
      birthDate: '1975-05-20',
      openingBalance: null,
      version: 1,
    })
    ok(await addRecord(t.admin, record(selin, '2026-07-06', '2026-07-17', 10)), 201)
    const excuse = ok(
      await addRecord(t.admin, {
        ...record(selin, '2026-09-01', '2026-09-03', 3),
        typeCode: 'marriage',
        note: ' Nikâh ',
      }),
      201,
    )
    assert.deepEqual(
      [excuse.kind, excuse.typeLabel, excuse.paid, excuse.deductsFromAnnual, excuse.note],
      ['excuse', 'Evlilik izni', true, false, 'Nikâh'],
    )
    ok(await addRecord(t.admin, record(selin, '2026-12-28', '2026-12-31', 4)), 201)

    const detail = await detailOf(t.admin, selin)
    assert.equal(detail.date, '2026-10-06')
    assert.equal(detail.employmentEndDate, null)
    const entitlement = detail.entitlement as Json
    // 2021…2025 beş yıl × 14 + 2026 altıncı yıl 20; 2025'ten itibaren 50 yaş: 20 gün.
    assert.deepEqual(
      (entitlement.accruals as Json[]).map((a) => [a.date, a.age, a.days]),
      [
        ['2021-03-15', 45, 14],
        ['2022-03-15', 46, 14],
        ['2023-03-15', 47, 14],
        ['2024-03-15', 48, 14],
        ['2025-03-15', 49, 14],
        ['2026-03-15', 50, 20],
      ],
    )
    assert.equal(entitlement.entitledDays, 90)
    assert.equal(entitlement.usedDays, 10)
    assert.equal(entitlement.plannedDays, 4)
    assert.equal(entitlement.balanceDays, 80)
    assert.equal(entitlement.carriedOverDays, 70)
    assert.equal(entitlement.balanceAfterPlannedDays, 76)
    assert.equal((entitlement.next as Json).date, '2027-03-15')
    assert.equal((detail.records as Json[]).length, 3)
    assert.equal((detail.records as Json[])[0]?.startDate, '2026-12-28')
    // Geçmiş gün için hesap: 2026-07-01'de kullanılan yok.
    const july = (await detailOf(t.admin, selin, '?date=2026-07-01')).entitlement as Json
    assert.equal(july.usedDays, 0)
    assert.equal(july.plannedDays, 14)

    const list = await staffListOf(t.admin)
    assert.equal(list.meta.total, 3)
    const row = list.data.find((item) => item.membershipId === selin)
    assert.equal(row?.seniorityStartDate, '2020-03-15')
    assert.deepEqual(row?.summary, {
      serviceYears: 6,
      lastAccrualDate: '2026-03-15',
      annualDays: 20,
      nextAccrualDate: '2027-03-15',
      nextAccrualDays: 20,
      entitledDays: 90,
      usedDays: 10,
      carriedOverDays: 70,
      balanceDays: 80,
      balanceAfterPlannedDays: 76,
    })
    assert.equal(row?.recordCount, 3)
    const other = list.data.find((item) => item.membershipId === merve)
    assert.equal(other?.summary, null)
    assert.equal(
      list.data.some((item) => item.name === 'Ayşe Yılmaz'),
      false,
    )
    assert.equal((await staffListOf(t.admin, '?q=selin')).meta.total, 1)
    assertError(await get(`${STAFF}?institutionId=x`, t.admin), 400)
    assert.equal(await seniorityStartFor({ db, institutionId: t.id }, selin), '2020-03-15')
    assert.equal(await seniorityStartFor({ db, institutionId: t.id }, merve), null)

    const creates = await auditOf(t.id, 'finance.staff_leave_profile.create')
    assert.equal(creates.length, 1)
    assert.deepEqual(creates[0]?.changes, {
      fields: ['seniorityStartDate', 'birthDate', 'openingBalance'],
    })
    assert.equal(JSON.stringify(creates).includes('1975-05-20'), false)
    const records = await auditOf(t.id, 'finance.staff_leave_record.create')
    assert.equal(records.length, 3)
    assert.equal(JSON.stringify(records).includes('Nikâh'), false)
  })

  test('DOM-FIN-109: profil düzeltmesi If-Match ister; kural reddi 422, kayıt değişmez', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const parent = await person(t, 'veli', 'Ayşe Yılmaz')
    const left = await person(t, 'onburo', 'Ahmet Ayrılan')
    await db.update(memberships).set({ deactivatedAt: FIXED_NOW }).where(eq(memberships.id, left))
    const base = { membershipId: selin, seniorityStartDate: '2020-03-15' }
    for (const bad of [
      { ...base, seniorityStartDate: '2026-02-30' },
      { ...base, openingBalance: { asOf: '2025-01-01', days: 1000 } },
      { ...base, institutionId: t.id },
      { membershipId: selin },
    ])
      assertError(await openProfile(t.admin, bad), 400)
    assertError(
      await openProfile(t.admin, { ...base, seniorityStartDate: '2026-10-07' }),
      422,
      'staff_leave_seniority_future',
    )
    assertError(
      await openProfile(t.admin, { ...base, birthDate: '2010-01-01' }),
      422,
      'staff_leave_birth_date_invalid',
    )
    assertError(
      await openProfile(t.admin, { ...base, membershipId: parent }),
      422,
      'staff_leave_not_staff',
    )
    assertError(
      await openProfile(t.admin, { ...base, membershipId: left }),
      422,
      'staff_leave_staff_inactive',
    )
    assertError(
      await openProfile(t.admin, { ...base, membershipId: 'yok' }),
      422,
      'staff_leave_staff_not_found',
    )
    assert.equal((await rowsOf(t.id)).profiles.length, 0)

    ok(await openProfile(t.admin, base), 201)
    assertError(await openProfile(t.admin, base), 422, 'staff_leave_profile_exists')
    ok(await addRecord(t.admin, record(selin, '2021-06-01', '2021-06-05', 5)), 201)
    assertError(
      await call('PATCH', `${PROFILES}/${selin}`, t.admin, { birthDate: null }),
      400,
      'if_match_required',
    )
    assertError(
      await patchProfile(t.admin, selin, { seniorityStartDate: '2021-07-01' }, 1),
      422,
      'staff_leave_before_seniority',
    )
    assertError(
      await patchProfile(t.admin, selin, { birthDate: null }, 1),
      422,
      'staff_leave_profile_unchanged',
    )
    assertError(await patchProfile(t.admin, selin, { birthDate: '1980-01-01' }, 5), 409)
    assertError(await patchProfile(t.admin, parent, { birthDate: '1980-01-01' }, 1), 404)
    const before = await rowsOf(t.id)
    const updated = ok(
      await patchProfile(
        t.admin,
        selin,
        { openingBalance: { asOf: '2025-12-31', days: 7 }, birthDate: '1980-01-01' },
        1,
      ),
    )
    assert.deepEqual(updated.openingBalance, { asOf: '2025-12-31', days: 7 })
    assert.equal(updated.version, 2)
    assert.notDeepEqual((await rowsOf(t.id)).profiles, before.profiles)
    const entitlement = (await detailOf(t.admin, selin)).entitlement as Json
    // Açılış devri 7 + 2026 hak edişi 20; 2021 kaydı devrin içinde.
    assert.equal(entitlement.balanceDays, 27)
    const updates = await auditOf(t.id, 'finance.staff_leave_profile.update')
    assert.deepEqual(updates[0]?.changes, { fields: ['birthDate', 'openingBalance'] })
  })

  test('DOM-FIN-109: izin kaydı reddi 422 ve 400; Idempotency-Key zorunlu ve tekrar tek satır (K-362)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const merve = await person(t, 'onburo', 'Merve Ak')
    ok(await openProfile(t.admin, { membershipId: selin, seniorityStartDate: '2020-03-15' }), 201)
    assertError(
      await addRecord(t.admin, record(selin, '2026-07-06', '2026-07-10', 5), {}),
      400,
      'idempotency_key_required',
    )
    for (const bad of [
      record(selin, '2026-07-10', '2026-07-06', 1),
      { ...record(selin, '2026-07-06', '2026-07-10', 0) },
      { ...record(selin, '2026-07-06', '2026-07-10', 5), institutionId: t.id },
      { ...record(selin, '2026-07-06', '2026-07-10', 5), typeCode: 'Yıllık' },
    ])
      assertError(await addRecord(t.admin, bad), 400)
    assertError(
      await addRecord(t.admin, record(selin, '2026-07-06', '2026-07-10', 6)),
      422,
      'staff_leave_days_exceed_range',
    )
    assertError(
      await addRecord(t.admin, {
        ...record(selin, '2026-07-06', '2026-07-10', 5),
        typeCode: 'sick',
      }),
      422,
      'staff_leave_sick_not_manual',
    )
    assertError(
      await addRecord(t.admin, {
        ...record(selin, '2026-07-06', '2026-07-10', 5),
        typeCode: 'custom_yok',
      }),
      422,
      'staff_leave_type_not_found',
    )
    assertError(
      await addRecord(t.admin, record(merve, '2026-07-06', '2026-07-10', 5)),
      422,
      'staff_leave_profile_required',
    )
    assertError(
      await addRecord(t.admin, record(selin, '2020-03-01', '2020-03-20', 5)),
      422,
      'staff_leave_before_seniority',
    )
    assert.equal((await rowsOf(t.id)).records.length, 0)

    const headers = key()
    const first = await addRecord(t.admin, record(selin, '2026-07-06', '2026-07-10', 5), headers)
    const second = await addRecord(t.admin, record(selin, '2026-07-06', '2026-07-10', 5), headers)
    assert.equal(first.statusCode, 201, first.body)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal(second.json().data.id, first.json().data.id)
    assert.equal((await rowsOf(t.id)).records.length, 1)
    assertError(
      await addRecord(t.admin, record(selin, '2026-07-10', '2026-07-14', 3)),
      422,
      'staff_leave_overlap',
    )
    // Yıllıktan düşmeyen mazeret profil istemez.
    ok(
      await addRecord(t.admin, {
        ...record(merve, '2026-07-06', '2026-07-08', 3),
        typeCode: 'bereavement',
      }),
      201,
    )
  })

  test('DOM-FIN-109: iptal gerekçe ve If-Match ister; iptal edilen kayıt bakiyeye sayılmaz', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    ok(await openProfile(t.admin, { membershipId: selin, seniorityStartDate: '2020-03-15' }), 201)
    const rec = ok(await addRecord(t.admin, record(selin, '2026-07-06', '2026-07-10', 5)), 201)
    assertError(await cancelRecord(t.admin, rec, 'kısa'), 400)
    assertError(
      await call('POST', `${RECORDS}/${String(rec.id)}/cancel`, t.admin, { reason: 'Yanlış' }),
      400,
      'if_match_required',
    )
    assertError(await cancelRecord(t.admin, { ...rec, version: 3 }), 409)
    ok(await cancelRecord(t.admin, rec))
    assertError(await cancelRecord(t.admin, rec), 404)
    const [row] = (await rowsOf(t.id)).records
    assert.equal(row?.cancelReason, 'Yanlış personele girildi')
    assert.ok(row?.archivedAt)
    const detail = await detailOf(t.admin, selin)
    assert.equal((detail.records as Json[]).length, 0)
    assert.equal((detail.entitlement as Json).usedDays, 0)
    // İptalden sonra aynı günlere yeniden yazılabilir.
    ok(await addRecord(t.admin, record(selin, '2026-07-06', '2026-07-10', 4)), 201)
    const audit = await auditOf(t.id, 'finance.staff_leave_record.cancel')
    assert.equal(audit.length, 1)
    assert.equal(JSON.stringify(audit).includes('Yanlış personele'), false)
  })

  test('DOM-FIN-109: tür ayarı ve ek tür; kilit ve yasal gün reddi; kayıt tür kopyasını korur (K-361)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const defaults = await typesOf(t.admin)
    assert.equal(defaults.length, 9)
    assert.deepEqual(
      defaults.find((type) => type.code === 'paternity'),
      {
        code: 'paternity',
        kind: 'excuse',
        label: 'Babalık izni (eşin doğumu)',
        paid: true,
        deductsFromAnnual: false,
        defaultDays: 5,
        statutoryMinDays: 5,
        isActive: true,
        isCustom: false,
        locked: ['paid', 'deductsFromAnnual'],
        version: 1,
      },
    )
    assertError(await patchType(t.admin, 'annual', { paid: false }, 1), 422, 'leave_type_locked')
    assertError(
      await patchType(t.admin, 'paternity', { defaultDays: 3 }, 1),
      422,
      'leave_type_days_below_statutory',
    )
    assertError(await patchType(t.admin, 'yok_tur', { label: 'Yok' }, 1), 404)
    assertError(await patchType(t.admin, 'other', { label: 'İdari izin' }, 5), 409)
    assertError(await patchType(t.admin, 'other', {}, 1), 400)
    assert.equal((await rowsOf(t.id)).types.length, 0)

    // Diğer izin yıllıktan düşecek biçimde ayarlanır; önceki kayıt eski kopyayı korur.
    const before = ok(
      await addRecord(t.admin, {
        ...record(selin, '2026-06-01', '2026-06-02', 2),
        typeCode: 'other',
      }),
      201,
    )
    assert.equal(before.deductsFromAnnual, false)
    const other = ok(
      await patchType(t.admin, 'other', { label: 'İdari izin', deductsFromAnnual: true }, 1),
    )
    assert.deepEqual([other.label, other.deductsFromAnnual, other.version], ['İdari izin', true, 2])
    assertError(
      await addRecord(t.admin, {
        ...record(selin, '2026-06-08', '2026-06-08', 1),
        typeCode: 'other',
      }),
      422,
      'staff_leave_profile_required',
    )
    const closed = ok(await patchType(t.admin, 'marriage', { isActive: false }, 1))
    assert.equal(closed.isActive, false)
    assertError(
      await addRecord(t.admin, {
        ...record(selin, '2026-06-08', '2026-06-08', 1),
        typeCode: 'marriage',
      }),
      422,
      'staff_leave_type_inactive',
    )

    const exam = ok(
      await call('POST', TYPES, t.admin, {
        kind: 'excuse',
        label: 'Sınav izni',
        paid: true,
        deductsFromAnnual: false,
        defaultDays: 1,
      }),
      201,
    )
    assert.match(String(exam.code), /^custom_[0-9a-f]{12}$/)
    assert.equal(exam.isCustom, true)
    assertError(
      await call('POST', TYPES, t.admin, {
        kind: 'other',
        label: 'sınav İZNİ',
        paid: true,
        deductsFromAnnual: false,
      }),
      422,
      'leave_type_label_exists',
    )
    assertError(
      await call('POST', TYPES, t.admin, {
        kind: 'unpaid',
        label: 'Askerlik',
        paid: true,
        deductsFromAnnual: false,
      }),
      422,
      'leave_type_locked',
    )
    ok(
      await addRecord(t.admin, {
        ...record(selin, '2026-06-10', '2026-06-10', 1),
        typeCode: exam.code,
      }),
      201,
    )
    const listed = await typesOf(t.admin)
    assert.equal(listed.length, 10)
    assert.equal(listed.at(-1)?.label, 'Sınav izni')
    assert.equal((await auditOf(t.id, 'finance.staff_leave_type.update')).length, 2)
    assert.equal((await auditOf(t.id, 'finance.staff_leave_type.create')).length, 1)
  })

  test('DOM-FIN-109: ayrılan personelin hizmeti pasifleştirilme gününde biter; yazma reddedilir', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    ok(await openProfile(t.admin, { membershipId: selin, seniorityStartDate: '2020-03-15' }), 201)
    await db
      .update(memberships)
      .set({ deactivatedAt: new Date('2025-03-14T09:00:00Z') })
      .where(eq(memberships.id, selin))
    const detail = await detailOf(t.admin, selin)
    assert.equal(detail.active, false)
    assert.equal(detail.employmentEndDate, '2025-03-14')
    const entitlement = detail.entitlement as Json
    assert.equal(entitlement.serviceYears, 4)
    assert.equal(entitlement.balanceDays, 56)
    assert.equal(entitlement.next, null)
    assertError(
      await addRecord(t.admin, record(selin, '2025-01-06', '2025-01-07', 2)),
      422,
      'staff_leave_staff_inactive',
    )
    assertError(
      await patchProfile(t.admin, selin, { birthDate: '1980-01-01' }, 1),
      422,
      'staff_leave_staff_inactive',
    )
    assert.equal(
      (await staffListOf(t.admin, '?status=passive')).data.some(
        (item) => item.membershipId === selin,
      ),
      true,
    )
  })

  test('DOM-FIN-109: başka kurumun personeli, profili, türü ve kaydı 404 ve B değişmez; listede yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bStaff = await person(b, 'ogretmen', 'Beta Öğretmen')
    ok(await openProfile(b.admin, { membershipId: bStaff, seniorityStartDate: '2020-03-15' }), 201)
    const bRecord = ok(await addRecord(b.admin, record(bStaff, '2026-07-06', '2026-07-10', 5)), 201)
    const bType = ok(
      await call('POST', TYPES, b.admin, {
        kind: 'other',
        label: 'Beta izni',
        paid: true,
        deductsFromAnnual: false,
      }),
      201,
    )
    const bBefore = await rowsOf(b.id)

    assertError(await get(`${STAFF}/${bStaff}`, a.admin), 404)
    assertError(await patchProfile(a.admin, bStaff, { birthDate: '1980-01-01' }, 1), 404)
    assertError(await cancelRecord(a.admin, bRecord, 'Başka kurum kaydı'), 404)
    assertError(await patchType(a.admin, String(bType.code), { label: 'Ele geçir' }, 1), 404)
    assert.equal(
      (await staffListOf(a.admin)).data.some((item) => item.membershipId === bStaff),
      false,
    )
    assert.equal(
      (await typesOf(a.admin)).some((type) => type.code === bType.code),
      false,
    )
    assertError(
      await openProfile(a.admin, { membershipId: bStaff, seniorityStartDate: '2020-03-15' }),
      422,
      'staff_leave_staff_not_found',
    )
    assertError(
      await addRecord(a.admin, record(bStaff, '2026-08-03', '2026-08-04', 2)),
      422,
      'staff_leave_staff_not_found',
    )
    assertError(
      await addRecord(a.admin, {
        ...record(bStaff, '2026-08-03', '2026-08-04', 2),
        institutionId: b.id,
      }),
      400,
    )
    assertError(
      await openProfile(a.admin, {
        membershipId: bStaff,
        seniorityStartDate: '2020-03-15',
        institutionId: b.id,
      }),
      400,
    )
    assertError(
      await call('POST', TYPES, a.admin, {
        kind: 'other',
        label: 'Alfa izni',
        paid: true,
        deductsFromAnnual: false,
        institutionId: b.id,
      }),
      400,
    )
    assert.deepEqual(await rowsOf(b.id), bBefore)
    const aRows = await rowsOf(a.id)
    assert.equal(aRows.profiles.length + aRows.records.length + aRows.types.length, 0)
  })
})
