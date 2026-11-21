import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { memberships } from '../src/db/schema/auth.ts'
import { staffSeparations } from '../src/db/schema/finance-staff-separations.ts'
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
 * İşten ayrılış uçları (DOM-FIN-118; ON-180; K-403…K-405). Her test kendi kurumunu kurar. Adım
 * kaynakları kendi uçlarından yazılır (zimmet, avans, icra, izin, hizmet belgesi); hesap kapatma
 * Oğuzhan'ın alanıdır, testte üyelik pasifleştirmesi doğrudan yazılır. FIXED_NOW 2026-10-06.
 */

const FINANCE = '/api/v1/finance'
const URL = `${FINANCE}/staff-separations`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-118: işten ayrılış uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.180.0.1'

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
    clientIp = `10.180.${String((tenantCount += 1))}.1`
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
  const deactivate = (membershipId: string) =>
    db
      .update(memberships)
      .set({ deactivatedAt: new Date('2026-10-01T09:00:00.000Z') })
      .where(eq(memberships.id, membershipId))

  const separation = (membershipId: string, extra: Json = {}): Json => ({
    membershipId,
    separationDate: '2026-09-30',
    reason: 'resignation',
    ...extra,
  })
  const create = (cookie: string | null, body: Json, headers: Record<string, string> = key()) =>
    call('POST', URL, cookie, body, headers)
  const created = async (cookie: string, body: Json) => ok(await create(cookie, body), 201)
  const itemUrl = (item: Json) => `${URL}/${String(item.id)}`
  const mark = (cookie: string, item: Json, step: string, done = true) =>
    call('POST', `${itemUrl(item)}/mark-step`, cookie, { step, done }, ifMatch(item.version))
  const complete = (cookie: string, item: Json, headers: Record<string, string> = key()) =>
    call('POST', `${itemUrl(item)}/complete`, cookie, {}, { ...headers, ...ifMatch(item.version) })
  const cancel = (cookie: string, item: Json, reason = 'Yanlış personel seçildi') =>
    call('POST', `${itemUrl(item)}/cancel`, cookie, { reason }, ifMatch(item.version))
  const patch = (cookie: string, item: Json, body: Json) =>
    call('PATCH', itemUrl(item), cookie, body, ifMatch(item.version))
  const listOf = async (cookie: string, query = '') => {
    const response = await get(`${URL}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }
  const rowsOf = (institutionId: string) =>
    db.select().from(staffSeparations).where(eq(staffSeparations.institutionId, institutionId))
  const auditOf = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  const stepOf = (item: Json, step: string) =>
    (item.steps as Json[]).find((entry) => entry.step === step) as Json

  /** Personele zimmetli demirbaş (DOM-FIN-086). */
  async function assignAsset(t: Tenant, membershipId: string) {
    const asset = ok(
      await call('POST', `${FINANCE}/fixed-assets`, t.admin, {
        name: 'Dizüstü bilgisayar',
        category: 'it',
        location: 'Öğretmenler odası',
        acquisitionValueCents: 3_500_000,
        acquisitionDate: '2026-09-01',
      }),
      201,
    )
    return ok(
      await call('POST', `${FINANCE}/fixed-assets/${String(asset.id)}/assignments`, t.admin, {
        assigneeType: 'staff',
        membershipId,
        assignedDate: '2026-09-10',
      }),
      201,
    )
  }

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    assertError(await get(URL, null), 401)
    assertError(await create(null, separation('m-1')), 401)
    assertError(await get(`${URL}/${id}`, null), 401)
    assertError(await get(`${URL}/${id}/document`, null), 401)
    assertError(await call('PATCH', `${URL}/${id}`, null, { note: 'x' }, ifMatch(1)), 401)
    assertError(
      await call('POST', `${URL}/${id}/mark-step`, null, { step: 'leave', done: true }, ifMatch(1)),
      401,
    )
    assertError(
      await call('POST', `${URL}/${id}/complete`, null, {}, { ...key(), ...ifMatch(1) }),
      401,
    )
    assertError(
      await call('POST', `${URL}/${id}/cancel`, null, { reason: 'Yanlış' }, ifMatch(1)),
      401,
    )
  })

  test('DOM-FIN-118 K-403: ön büro, öğretmen, veli ve öğrenci 403; dosya değişmez', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const item = await created(t.admin, separation(selin))
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(URL, cookie), 403)
      assertError(await create(cookie, separation(selin)), 403)
      assertError(await get(itemUrl(item), cookie), 403)
      assertError(await get(`${itemUrl(item)}/document`, cookie), 403)
      assertError(await patch(cookie, item, { note: 'Not' }), 403)
      assertError(await mark(cookie, item, 'leave'), 403)
      assertError(await complete(cookie, item), 403)
      assertError(await cancel(cookie, item), 403)
    }
    const [row] = await rowsOf(t.id)
    assert.equal(row?.version, 1)
    assert.equal(row?.status, 'open')
    assert.equal(row?.leaveCheckedAt, null)
  })

  test('DOM-FIN-118: finance modülü kapalıyken uçlar 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(URL, closed.admin), 403, 'module_disabled')
    assertError(await create(closed.admin, separation('m-1')), 403, 'module_disabled')
    assertError(await get(`${URL}/${randomUUID()}`, closed.admin), 403, 'module_disabled')
  })

  test('DOM-FIN-118 K-403…K-405: dosya açılır, adımlar kaynaklardan okunur, ilişik kesilir', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const assignment = await assignAsset(t, selin)
    ok(
      await call(
        'POST',
        `${FINANCE}/staff-advances`,
        t.admin,
        {
          membershipId: selin,
          amountCents: 900_000,
          givenDate: '2026-09-01',
          paymentMethod: 'bank_transfer',
          installmentCount: 3,
          firstMonth: '2026-09',
        },
        key(),
      ),
      201,
    )
    ok(
      await call(
        'POST',
        `${FINANCE}/staff-garnishments`,
        t.admin,
        {
          membershipId: selin,
          office: 'İstanbul 12. İcra Dairesi',
          fileNumber: '2026/1234',
          claimCents: 5_000_000,
          receivedDate: '2026-09-15',
        },
        key(),
      ),
      201,
    )
    ok(
      await call('POST', `${FINANCE}/leave-profiles`, t.admin, {
        membershipId: selin,
        seniorityStartDate: '2024-03-15',
      }),
      201,
    )
    ok(
      await call(
        'POST',
        `${FINANCE}/leave-records`,
        t.admin,
        {
          membershipId: selin,
          typeCode: 'annual',
          startDate: '2026-07-06',
          endDate: '2026-07-10',
          days: 5,
        },
        key(),
      ),
      201,
    )

    const response = await create(
      t.admin,
      separation(selin, { hireDate: '2024-03-15', noticeGivenDate: '2026-08-01' }),
    )
    let item = ok(response, 201)
    assert.equal(response.headers.location, itemUrl(item))
    assert.equal(item.sgkExitCode, '03')
    assert.equal(item.status, 'open')
    assert.equal(item.staffName, 'Selin Kaya')
    assert.deepEqual(item.notice, {
      applies: true,
      weeks: 6,
      noticeEndDate: '2026-09-12',
      shortDays: 0,
    })
    assert.deepEqual(item.missingSteps, [
      'asset_return',
      'deductions',
      'leave',
      'account_closure',
      'service_certificate',
    ])
    assert.deepEqual(
      (item.assets as Json[]).map((asset) => [asset.assignmentId, asset.returnDate]),
      [[assignment.id, null]],
    )
    // Eylül (ayrılış ayı, dahil), ekim ve kasım taksitleri kalır: 3 × 300.000.
    assert.deepEqual(item.deductions, {
      openAdvanceCount: 1,
      openAdvanceCents: 900_000,
      activeGarnishmentCount: 1,
      currency: 'TRY',
    })
    // 2024-03-15 kıdem: 2025 ve 2026 yıl dönümlerinde 14'er gün; 5 gün kullanıldı.
    assert.deepEqual(item.leave, { hasProfile: true, unusedDays: 23, frozen: false })
    assert.equal(item.payrollMonth, '2026-09')
    assert.equal(item.payrollMonthLocked, false)
    assert.equal(item.serviceCertificate, null)
    assert.equal((await auditOf(t.id, 'finance.staff_separation.create')).length, 1)
    assert.equal((await auditOf(t.id, 'finance.staff_separation.garnishment_read')).length, 1)

    // Eksik adımla tamamlama reddedilir, dosya değişmez.
    assertError(await complete(t.admin, item), 422, 'staff_separation_steps_incomplete')
    assert.equal((await rowsOf(t.id))[0]?.version, 1)

    // Zimmet demirbaş zimmeti ucundan iade alınır; adım kendiliğinden biter.
    ok(
      await call(
        'POST',
        `${FINANCE}/fixed-asset-assignments/${String(assignment.id)}/return`,
        t.admin,
        { returnDate: '2026-09-30', condition: 'intact' },
        ifMatch(assignment.version),
      ),
    )
    item = ok(await get(itemUrl(item), t.admin))
    assert.equal(stepOf(item, 'asset_return').done, true)

    // Elle adımlar; aynı işaret yeniden yazılmaz.
    item = ok(await mark(t.admin, item, 'deductions'))
    item = ok(await mark(t.admin, item, 'leave'))
    assert.equal(item.version, 3)
    assert.equal(stepOf(item, 'leave').done, true)
    assert.equal(stepOf(item, 'leave').checkedByName !== null, true)
    const same = ok(await mark(t.admin, item, 'leave'))
    assert.equal(same.version, 3)
    assert.equal((await auditOf(t.id, 'finance.staff_separation.mark_step')).length, 2)
    assertError(
      await call(
        'POST',
        `${itemUrl(item)}/mark-step`,
        t.admin,
        { step: 'account_closure', done: true },
        ifMatch(3),
      ),
      400,
    )

    // Hesap kapatma platform pasifleştirmesinden, hizmet belgesi personel belgesinden okunur.
    await deactivate(selin)
    ok(
      await call(
        'POST',
        `${FINANCE}/staff-certificates`,
        t.admin,
        {
          kind: 'service',
          membershipId: selin,
          position: 'İngilizce öğretmeni',
          hireDate: '2024-03-15',
          exitDate: '2026-09-30',
        },
        key(),
      ),
      201,
    )
    item = ok(await get(itemUrl(item), t.admin))
    assert.deepEqual(item.missingSteps, [])
    assert.equal(item.accountClosedDate, '2026-10-01')
    assert.equal((item.serviceCertificate as Json).label, 'PB-2026-1')

    const headers = key()
    const first = await complete(t.admin, item, headers)
    const completed = ok(first)
    const replay = await complete(t.admin, item, headers)
    assert.equal(replay.statusCode, 200)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(completed.status, 'completed')
    assert.deepEqual(completed.leave, { hasProfile: true, unusedDays: 23, frozen: true })
    assert.equal(completed.completedByName !== null, true)
    const [row] = await rowsOf(t.id)
    assert.equal(row?.unusedLeaveDays, 23)
    assert.equal((await auditOf(t.id, 'finance.staff_separation.complete')).length, 1)

    // Tamamlanan dosya değişmez.
    assertError(
      await patch(t.admin, completed, { note: 'Geç not' }),
      409,
      'staff_separation_closed',
    )
    assertError(await cancel(t.admin, completed), 409, 'staff_separation_closed')
    assertError(await mark(t.admin, completed, 'severance'), 409, 'staff_separation_closed')

    const document = ok(await get(`${itemUrl(item)}/document`, t.admin))
    assert.equal(document.status, 'completed')
    assert.equal(document.unusedLeaveDays, 23)
    assert.equal(document.serviceCertificateLabel, 'PB-2026-1')
    assert.equal(typeof document.institutionName, 'string')
    assert.equal((document.assets as Json[])[0]?.returnCondition, 'intact')
    assert.equal('deductions' in document, false)

    // Tamamlanınca aynı personele yeni dosya açılabilir (yeniden işe alım).
    const list = await listOf(t.admin, '?status=completed')
    assert.equal(list.meta.total, 1)
  })

  test('DOM-FIN-118: geçersiz gövde 400, kural ihlali 422, açık dosya 409; kayıt yazılmaz', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const veli = await person(t, 'veli', 'Ayşe Yılmaz')
    assertError(await create(t.admin, separation(selin, { reason: 'fired' })), 400)
    assertError(await create(t.admin, separation(selin, { hireDate: '2026-10-01' })), 400)
    assertError(await create(t.admin, separation(selin), {}), 400, 'idempotency_key_required')
    assertError(await create(t.admin, separation(veli)), 422, 'staff_separation_not_staff')
    assertError(await create(t.admin, separation('m-yok')), 422, 'staff_separation_staff_not_found')
    assertError(
      await create(t.admin, separation(selin, { separationDate: '2027-10-07' })),
      422,
      'staff_separation_date_too_far',
    )
    assert.equal((await rowsOf(t.id)).length, 0)
    const item = await created(t.admin, separation(selin, { separationDate: '2026-10-31' }))
    assertError(await create(t.admin, separation(selin)), 409, 'staff_separation_open_exists')
    assert.equal((await rowsOf(t.id)).length, 1)
    // Ayrılış günü gelmeden ilişik kesilmez.
    assertError(await complete(t.admin, item), 422, 'staff_separation_not_due')
    assertError(await complete(t.admin, item, {}), 400, 'idempotency_key_required')
  })

  test('DOM-FIN-118 K-403: düzeltme kodu önerir, sürüm denetlenir; iptal gerekçe ister', async () => {
    const t = await institution()
    const selin = await person(t, 'onburo', 'Ece Demir')
    let item = await created(t.admin, separation(selin))
    item = ok(await patch(t.admin, item, { reason: 'retirement', note: 'Emeklilik dilekçesi' }))
    assert.equal(item.sgkExitCode, '08')
    assert.equal(item.note, 'Emeklilik dilekçesi')
    assert.equal(item.version, 2)
    assertError(
      await call('PATCH', itemUrl(item), t.admin, { note: 'Eski sürüm' }, ifMatch(1)),
      409,
    )
    assertError(
      await patch(t.admin, item, { reason: 'retirement' }),
      422,
      'staff_separation_unchanged',
    )
    assertError(
      await call('PATCH', itemUrl(item), t.admin, { note: 'x' }),
      400,
      'if_match_required',
    )
    assertError(await cancel(t.admin, item, 'kısa'), 400)
    const cancelled = ok(await cancel(t.admin, item))
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.cancelReason, 'Yanlış personel seçildi')
    assertError(await complete(t.admin, cancelled), 409, 'staff_separation_closed')
    const [audit] = await auditOf(t.id, 'finance.staff_separation.cancel')
    assert.equal(JSON.stringify(audit?.changes).includes('Yanlış personel'), false)
    // İptalden sonra aynı personele yeni dosya açılır.
    await created(t.admin, separation(selin))
    assert.equal((await listOf(t.admin)).meta.total, 2)
    assert.equal((await listOf(t.admin, '?q=Ece')).meta.total, 2)
    assert.equal((await listOf(t.admin, '?status=open')).meta.total, 1)
    assertError(await get(`${URL}?unknown=1`, t.admin), 400)
  })

  test('DOM-FIN-118: başka kurumun personeli ve dosyası 404 ve B değişmez; listede yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bStaff = await person(b, 'ogretmen', 'Beta Öğretmen')
    const bItem = await created(b.admin, separation(bStaff))
    const bUrl = itemUrl(bItem)

    assertError(await get(bUrl, a.admin), 404)
    assertError(await get(`${bUrl}/document`, a.admin), 404)
    assertError(await call('PATCH', bUrl, a.admin, { note: 'Başka kurum' }, ifMatch(1)), 404)
    assertError(
      await call('POST', `${bUrl}/mark-step`, a.admin, { step: 'leave', done: true }, ifMatch(1)),
      404,
    )
    assertError(
      await call('POST', `${bUrl}/complete`, a.admin, {}, { ...key(), ...ifMatch(1) }),
      404,
    )
    assertError(
      await call('POST', `${bUrl}/cancel`, a.admin, { reason: 'Başka kurum' }, ifMatch(1)),
      404,
    )
    assert.equal((await listOf(a.admin)).meta.total, 0)
    assert.equal((await listOf(a.admin, `?membershipId=${bStaff}`)).meta.total, 0)
    assertError(await create(a.admin, separation(bStaff)), 422, 'staff_separation_staff_not_found')
    assertError(await create(a.admin, { ...separation(bStaff), institutionId: b.id }), 400)
    assert.equal((await rowsOf(a.id)).length, 0)
    const [bRow] = await rowsOf(b.id)
    assert.equal(bRow?.status, 'open')
    assert.equal(bRow?.version, 1)
    assert.equal(bRow?.note, null)
  })

  test('DOM-FIN-118: Idempotency-Key ile yinelenen açılış aynı yanıtı döner, tek dosya açılır', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const headers = key()
    const first = await create(t.admin, separation(selin), headers)
    const second = await create(t.admin, separation(selin), headers)
    assert.equal(first.statusCode, 201)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal(second.json().data.id, first.json().data.id)
    assert.equal((await rowsOf(t.id)).length, 1)
  })
})
