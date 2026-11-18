import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { institutions, memberships, users } from '../src/db/schema/auth.ts'
import { staffCertificates } from '../src/db/schema/finance-staff-certificates.ts'
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
 * Personel çalışma ve hizmet belgesi uçları (DOM-FIN-106; ON-175; K-340…K-343). Her test kendi
 * kurumunu kurar; personel adlı kullanıcıyla açılır. FIXED_NOW 2026-10-06 (İstanbul yılı 2026).
 */

const URL = '/api/v1/finance/staff-certificates'
const STAFF = '/api/v1/finance/staff-certificate-staff'
const RATES = '/api/v1/finance/pay-rates'
const TCKN = '10000000146'

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-106: personel belgesi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.175.0.1'

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
    clientIp = `10.175.${String((tenantCount += 1))}.1`
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
  const deactivate = (membershipId: string, at = new Date('2026-06-30T15:00:00.000Z')) =>
    db.update(memberships).set({ deactivatedAt: at }).where(eq(memberships.id, membershipId))
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))
  const employment = (membershipId: string, extra: Json = {}): Json => ({
    kind: 'employment',
    membershipId,
    position: 'İngilizce öğretmeni',
    hireDate: '2021-09-01',
    ...extra,
  })
  const service = (membershipId: string, extra: Json = {}): Json => ({
    kind: 'service',
    membershipId,
    position: 'Ön büro görevlisi',
    hireDate: '2023-02-15',
    exitDate: '2026-06-30',
    ...extra,
  })
  const create = (cookie: string | null, body: Json, headers: Record<string, string> = key()) =>
    call('POST', URL, cookie, body, headers)
  const created = async (cookie: string, body: Json) => ok(await create(cookie, body), 201)
  const documentOf = (cookie: string, id: unknown) => get(`${URL}/${String(id)}/document`, cookie)
  const cancel = (cookie: string, certificate: Json, reason = 'Görev yanlış yazıldı') =>
    call(
      'POST',
      `${URL}/${String(certificate.id)}/cancel`,
      cookie,
      { reason },
      ifMatch(certificate.version),
    )
  const listOf = async (cookie: string, query = '') => {
    const response = await get(`${URL}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }
  const rowsOf = (institutionId: string) =>
    db.select().from(staffCertificates).where(eq(staffCertificates.institutionId, institutionId))
  const auditOf = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    assertError(await get(URL, null), 401)
    assertError(await get(STAFF, null), 401)
    assertError(await create(null, employment('m-1')), 401)
    assertError(await get(`${URL}/${id}/document`, null), 401)
    assertError(
      await call('POST', `${URL}/${id}/cancel`, null, { reason: 'Yanlış' }, ifMatch(1)),
      401,
    )
  })

  test('DOM-FIN-106: ön büro, öğretmen, veli ve öğrenci 403; belge değişmez, okuma denetlenmez (K-342)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const certificate = await created(t.admin, employment(selin, { identityNumber: TCKN }))
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(URL, cookie), 403)
      assertError(await get(STAFF, cookie), 403)
      assertError(await create(cookie, employment(selin)), 403)
      assertError(await documentOf(cookie, certificate.id), 403)
      assertError(await cancel(cookie, certificate), 403)
    }
    const rows = await rowsOf(t.id)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.cancelledAt, null)
    assert.equal(rows[0]?.version, 1)
    assert.equal((await auditOf(t.id, 'finance.staff_certificate.read')).length, 0)
  })

  test('DOM-FIN-106: finance modülü kapalıyken belge uçları 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(URL, closed.admin), 403, 'module_disabled')
    assertError(await get(STAFF, closed.admin), 403, 'module_disabled')
    assertError(await create(closed.admin, employment('m-1')), 403, 'module_disabled')
    assertError(await documentOf(closed.admin, randomUUID()), 403, 'module_disabled')
  })

  test('DOM-FIN-106: çalışma belgesi yıl bazlı numara alır, içerik dondurulur; liste TCKN ve ücret taşımaz (K-340, K-341, K-343)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const ali = await person(t, 'onburo', 'Ali Demir')
    ok(
      await call(
        'POST',
        RATES,
        t.admin,
        {
          component: 'wage',
          membershipId: selin,
          rateType: 'monthly_gross',
          amountCents: 4_500_000,
          startDate: '2026-01-01',
        },
        key(),
      ),
      201,
    )
    const first = await created(
      t.admin,
      employment(selin, {
        identityNumber: TCKN,
        includeWage: true,
        addressee: 'X Bankası Kadıköy Şubesi Müdürlüğüne',
      }),
    )
    assert.equal(first.certificateYear, 2026)
    assert.equal(first.certificateNumber, 1)
    assert.equal(first.includesWage, true)
    assert.equal(first.hasIdentityNumber, true)
    assert.equal('identityNumber' in first, false)
    assert.equal('wageAmountCents' in first, false)
    const second = await created(t.admin, employment(ali, { position: 'Ön büro sorumlusu' }))
    assert.equal(second.certificateNumber, 2)
    assert.equal(second.addressee, 'İlgili makama')
    assert.equal(second.includesWage, false)

    const list = await listOf(t.admin)
    assert.equal(list.meta.total, 2)
    assert.deepEqual(
      list.data.map((row) => row.certificateNumber),
      [2, 1],
    )
    assert.equal(JSON.stringify(list).includes(TCKN), false)
    assert.equal(JSON.stringify(list).includes('4500000'), false)
    assert.equal((await listOf(t.admin, '?q=selin')).meta.total, 1)
    assert.equal((await listOf(t.admin, `?membershipId=${ali}`)).meta.total, 1)
    assert.equal((await listOf(t.admin, '?kind=service')).meta.total, 0)
    assert.equal((await listOf(t.admin, '?year=2025')).meta.total, 0)

    // Kaynak veri sonradan değişse de belge aynı kalır.
    await db
      .update(users)
      .set({ name: 'Selin Kaya Yıldız' })
      .where(sql`${users.name} = 'Selin Kaya'`)
    await db.update(institutions).set({ name: 'Yeni Kurum Adı' }).where(eq(institutions.id, t.id))
    const document = ok(await documentOf(t.admin, first.id))
    assert.equal(document.staffName, 'Selin Kaya')
    assert.notEqual(document.institutionName, 'Yeni Kurum Adı')
    assert.equal(document.identityNumber, TCKN)
    assert.equal(document.wageRateType, 'monthly_gross')
    assert.equal(document.wageAmountCents, 4_500_000)
    assert.equal(document.addressee, 'X Bankası Kadıköy Şubesi Müdürlüğüne')
    assert.equal(typeof document.issuedByName, 'string')

    const reads = await auditOf(t.id, 'finance.staff_certificate.read')
    assert.equal(reads.length, 1)
    assert.deepEqual(reads[0]?.changes, {
      fields: ['staffName', 'identityNumber', 'wageAmountCents'],
    })
    const creates = await auditOf(t.id, 'finance.staff_certificate.create')
    assert.equal(creates.length, 2)
    assert.equal(JSON.stringify(creates).includes(TCKN), false)
    assert.equal(JSON.stringify(creates).includes('4500000'), false)

    // İçerik veritabanında da dondurulmuştur (tetikleyici 55000).
    await assert.rejects(
      db
        .update(staffCertificates)
        .set({ position: 'Müdür' })
        .where(eq(staffCertificates.id, String(first.id))),
    )
    await assert.rejects(
      db.delete(staffCertificates).where(eq(staffCertificates.id, String(first.id))),
    )
  })

  test('DOM-FIN-106: hizmet belgesi ayrılan personele; öneriler son belgeden ve pasifleştirme gününden (K-340)', async () => {
    const t = await institution()
    const ahmet = await person(t, 'onburo', 'Ahmet Ayrılan')
    await created(
      t.admin,
      employment(ahmet, { position: 'Ön büro görevlisi', hireDate: '2023-02-15' }),
    )
    await deactivate(ahmet)
    const staff = ok(await get(`${STAFF}?q=ahmet`, t.admin)) as unknown as Json[]
    assert.deepEqual(staff[0], {
      membershipId: ahmet,
      name: 'Ahmet Ayrılan',
      role: 'onburo',
      active: false,
      leftDate: '2026-06-30',
      lastPosition: 'Ön büro görevlisi',
      lastHireDate: '2023-02-15',
    })
    const certificate = await created(t.admin, service(ahmet))
    assert.equal(certificate.kind, 'service')
    assert.equal(certificate.exitDate, '2026-06-30')
    assert.equal(certificate.includesWage, false)
    const document = ok(await documentOf(t.admin, certificate.id))
    assert.equal(document.wageAmountCents, null)
    assert.deepEqual((await auditOf(t.id, 'finance.staff_certificate.read'))[0]?.changes, {
      fields: ['staffName'],
    })
  })

  test('DOM-FIN-106: geçersiz gövde 400, kural reddi 422; kayıt yazılmaz', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const parent = await person(t, 'veli', 'Ayşe Yılmaz')
    const left = await person(t, 'onburo', 'Ahmet Ayrılan')
    await deactivate(left)

    for (const bad of [
      employment(selin, { position: 'x' }),
      employment(selin, { identityNumber: '12345678901' }),
      employment(selin, { hireDate: '2026-02-30' }),
      employment(selin, { exitDate: '2026-01-01' }),
      service(left, { includeWage: true }),
      service(left, { exitDate: '2023-02-14' }),
      { ...employment(selin), kind: 'reference' },
    ])
      assertError(await create(t.admin, bad), 400)
    assertError(
      await create(t.admin, employment(selin, { includeWage: true })),
      422,
      'staff_certificate_wage_missing',
    )
    assertError(
      await create(t.admin, employment(selin, { hireDate: '2026-10-07' })),
      422,
      'staff_certificate_hire_date_future',
    )
    assertError(
      await create(t.admin, service(left, { exitDate: '2026-10-07' })),
      422,
      'staff_certificate_exit_date_future',
    )
    assertError(await create(t.admin, employment(left)), 422, 'staff_certificate_staff_inactive')
    assertError(await create(t.admin, service(selin)), 422, 'staff_certificate_staff_active')
    assertError(await create(t.admin, employment('yok')), 422, 'staff_certificate_staff_not_found')
    assertError(await create(t.admin, employment(parent)), 422, 'staff_certificate_not_staff')
    assertError(await call('POST', URL, t.admin, employment(selin)), 400)
    assertError(await get(`${URL}?status=open`, t.admin), 400)
    assertError(await get(`${URL}/yok/document`, t.admin), 400)
    assert.equal((await rowsOf(t.id)).length, 0)
    assert.equal((await auditOf(t.id, 'finance.staff_certificate.create')).length, 0)
  })

  test('DOM-FIN-106: iptal gerekçeyle; numara yeniden kullanılmaz, ikinci iptal 409 (K-341)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const first = await created(t.admin, employment(selin))
    assertError(await cancel(t.admin, first, 'kısa'), 400)
    assertError(
      await call('POST', `${URL}/${String(first.id)}/cancel`, t.admin, { reason: 'Görev yanlış' }),
      400,
      'if_match_required',
    )
    assertError(await cancel(t.admin, { ...first, version: 2 }), 409)
    const cancelled = ok(await cancel(t.admin, first))
    assert.ok(cancelled.cancelledAt)
    assert.equal(cancelled.cancelReason, 'Görev yanlış yazıldı')
    assert.equal(cancelled.version, 2)
    assertError(await cancel(t.admin, cancelled), 409, 'staff_certificate_cancelled')
    const document = ok(await documentOf(t.admin, first.id))
    assert.equal(document.cancelReason, 'Görev yanlış yazıldı')

    const next = await created(t.admin, employment(selin))
    assert.equal(next.certificateNumber, 2)
    assert.equal((await listOf(t.admin, '?status=cancelled')).meta.total, 1)
    assert.equal((await listOf(t.admin, '?status=valid')).meta.total, 1)
    const cancelAudit = await auditOf(t.id, 'finance.staff_certificate.cancel')
    assert.equal(cancelAudit.length, 1)
    assert.equal(JSON.stringify(cancelAudit).includes('Görev yanlış'), false)
    // İptal geri alınamaz (tetikleyici).
    await assert.rejects(
      db
        .update(staffCertificates)
        .set({ cancelledAt: null, cancelledByUserId: null, cancelReason: null })
        .where(eq(staffCertificates.id, String(first.id))),
    )
  })

  test('DOM-FIN-106: başka kurumun personeli ve belgesi 404 ve B değişmez; listede yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bStaff = await person(b, 'ogretmen', 'Beta Öğretmen')
    const bCertificate = await created(b.admin, employment(bStaff, { identityNumber: TCKN }))
    const bUrl = `${URL}/${String(bCertificate.id)}`

    assertError(await get(`${bUrl}/document`, a.admin), 404)
    assertError(
      await call('POST', `${bUrl}/cancel`, a.admin, { reason: 'Başka kurum' }, ifMatch(1)),
      404,
    )
    assert.equal((await listOf(a.admin)).meta.total, 0)
    assert.equal((await listOf(a.admin, `?membershipId=${bStaff}`)).meta.total, 0)
    const aStaff = ok(await get(STAFF, a.admin)) as unknown as Json[]
    assert.equal(
      aStaff.some((row) => row.membershipId === bStaff),
      false,
    )
    assertError(await create(a.admin, employment(bStaff)), 422, 'staff_certificate_staff_not_found')
    assertError(await create(a.admin, { ...employment(bStaff), institutionId: b.id }), 400)
    assert.equal((await rowsOf(a.id)).length, 0)
    const [bRow] = await rowsOf(b.id)
    assert.equal(bRow?.cancelledAt, null)
    assert.equal(bRow?.version, 1)
    assert.equal((await auditOf(b.id, 'finance.staff_certificate.read')).length, 0)
    // A kurumunun numarası B'den bağımsız 1'den başlar.
    const aSelin = await person(a, 'ogretmen', 'Selin Kaya')
    assert.equal((await created(a.admin, employment(aSelin))).certificateNumber, 1)
  })

  test('DOM-FIN-106: Idempotency-Key ile yinelenen belge aynı yanıtı döner, tek numara kesilir', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const headers = key()
    const first = await create(t.admin, employment(selin), headers)
    const second = await create(t.admin, employment(selin), headers)
    assert.equal(first.statusCode, 201)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal(second.json().data.id, first.json().data.id)
    assert.equal((await rowsOf(t.id)).length, 1)
  })
})
