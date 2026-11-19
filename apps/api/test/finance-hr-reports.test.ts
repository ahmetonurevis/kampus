import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, inArray } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { memberships } from '../src/db/schema/auth.ts'
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
 * İK raporu ucu (DOM-FIN-117; ON-192; K-400…K-402). Her test kendi kurumunu kurar; kıdem
 * başlangıcı ve kullanılmış izin izin uçlarıyla (DOM-FIN-109), rapor günü sağlık raporu ucuyla
 * (DOM-FIN-110), merkez ataması maliyet ucuyla (DOM-FIN-104) yazılır. Üyelik günü testte
 * 2024-01-01'e çekilir, pasifleştirme doğrudan yazılır. FIXED_NOW 2026-10-06.
 */

const FINANCE = '/api/v1/finance'
const REPORT = `${FINANCE}/hr-reports`
const PERIOD = `${REPORT}?from=2026-01&to=2026-09`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-117: İK raporu ucu', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.192.0.1'

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
  const get = (url: string, cookie: string | null, headers: Record<string, string> = {}) =>
    call('GET', url, cookie, undefined, headers)
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
    clientIp = `10.192.${String((tenantCount += 1))}.1`
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
  /** Kurumdaki bütün üyeliklerin açılış günü 2024-01-01 olur (gerçek saat test saatinden sonradır). */
  const backdate = (t: Tenant) =>
    db
      .update(memberships)
      .set({ createdAt: new Date('2024-01-01T09:00:00.000Z') })
      .where(eq(memberships.institutionId, t.id))
  const deactivate = (ids: string[], day: string) =>
    db
      .update(memberships)
      .set({ deactivatedAt: new Date(`${day}T09:00:00.000Z`) })
      .where(inArray(memberships.id, ids))
  const profile = async (t: Tenant, membershipId: string, seniorityStartDate: string) =>
    ok(
      await call('POST', `${FINANCE}/leave-profiles`, t.admin, {
        membershipId,
        seniorityStartDate,
      }),
      201,
    )
  const annual = async (t: Tenant, membershipId: string) =>
    ok(
      await call(
        'POST',
        `${FINANCE}/leave-records`,
        t.admin,
        {
          membershipId,
          typeCode: 'annual',
          startDate: '2026-07-06',
          endDate: '2026-07-10',
          days: 5,
        },
        key(),
      ),
      201,
    )
  const sick = async (t: Tenant, membershipId: string) =>
    ok(
      await call(
        'POST',
        `${FINANCE}/medical-reports`,
        t.admin,
        { membershipId, reportType: 'sickness', startDate: '2026-09-01', endDate: '2026-09-03' },
        key(),
      ),
      201,
    )
  const auditOf = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  /**
   * 8 öğretmen (6'sı 2020'den, biri Mart 2026'da girer, biri Mayıs'ta çıkar) ve 4 ön büro + kurucu
   * yönetici. 5 öğretmen LISE'ye atanır, yıllık izin kullanır; birinin raporu var.
   */
  async function staffed(t: Tenant) {
    const teachers: string[] = []
    for (let index = 1; index <= 8; index += 1)
      teachers.push(await person(t, 'ogretmen', `Öğretmen ${String(index)}`))
    for (let index = 1; index <= 4; index += 1)
      await person(t, 'onburo', `Ön büro ${String(index)}`)
    await backdate(t)
    const [t1, t2, t3, t4, t5, t6, , t8] = teachers as [string, ...string[]]
    const veterans = [t1, t3, t4, t5, t6] as string[]
    for (const id of [...veterans, t2 as string]) await profile(t, id, '2020-03-15')
    await profile(t, t8 as string, '2026-03-01')
    for (const id of veterans) await annual(t, id)
    await sick(t, t3 as string)
    const center = ok(
      await call('POST', `${FINANCE}/cost-centers`, t.admin, {
        code: 'LISE',
        name: 'Lise',
        type: 'unit',
      }),
      201,
    )
    for (const id of veterans)
      ok(
        await call('POST', `${FINANCE}/staff-cost-allocations`, t.admin, {
          membershipId: id,
          startMonth: '2026-01',
          shares: [{ costCenterId: center.id, shareBasisPoints: 10_000 }],
        }),
        201,
      )
    await deactivate([t2 as string], '2026-05-10')
    return { teachers }
  }

  test('kimliksiz istek 401', async () => {
    assertError(await get(REPORT, null), 401)
    assertError(await get(`${PERIOD}&purpose=pdf`, null), 401)
    assertError(await get(REPORT, null, { accept: 'text/csv' }), 401)
  })

  test('DOM-FIN-117: ön büro, öğretmen, veli ve öğrenci 403; modül kapalı 403; denetim yazılmaz', async () => {
    const t = await institution()
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(PERIOD, cookie), 403)
      assertError(await get(PERIOD, cookie, { accept: 'text/csv' }), 403)
    }
    assert.equal((await auditOf(t.id, 'finance.hr_report.read')).length, 0)
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(PERIOD, closed.admin), 403, 'module_disabled')
    assert.equal((await auditOf(closed.id, 'finance.hr_report.read')).length, 0)
  })

  test('DOM-FIN-117: geçersiz dönem 400, başlamamış dönem 422; denetim yazılmaz', async () => {
    const t = await institution()
    assertError(await get(`${REPORT}?from=2026-05&to=2026-04`, t.admin), 400)
    assertError(await get(`${REPORT}?from=2025-01&to=2026-01`, t.admin), 400)
    assertError(await get(`${REPORT}?from=2026-13`, t.admin), 400)
    assertError(await get(`${REPORT}?purpose=print`, t.admin), 400)
    assertError(await get(`${REPORT}?institutionId=x`, t.admin), 400)
    assertError(await get(`${REPORT}?from=2026-11`, t.admin), 422, 'hr_report_period_not_started')
    assert.equal((await auditOf(t.id, 'finance.hr_report.read')).length, 0)
  })

  test('DOM-FIN-117 K-400…K-402: devir, kıdem ve izin; başka kurumun personeli ve kaydı raporda yok', async () => {
    const a = await institution()
    const b = await institution()
    await staffed(a)
    const other = await staffed(b)
    // B'de ek çıkışlar A'nın sayılarını değiştirmemeli.
    await deactivate(other.teachers.slice(2, 6), '2026-06-15')

    const report = ok(await get(PERIOD, a.admin))
    assert.equal(report.endDay, '2026-09-30')
    const turnover = report.turnover as Json
    assert.deepEqual(turnover.totals, {
      opening: 12,
      hires: 1,
      exits: 1,
      closing: 12,
      averageHeadcount: 12,
      turnoverBasisPoints: 833,
      suppressed: false,
    })
    assert.deepEqual(
      (turnover.byRole as Json[]).map((row) => [row.group, row.opening, row.exits, row.closing]),
      [
        ['teacher', 7, 1, 7],
        ['administrative', 5, 0, 5],
      ],
    )
    assert.deepEqual(
      (turnover.byCenter as Json[]).map((row) => [row.name, row.closing, row.suppressed]),
      [
        ['Lise', 5, false],
        ['Atanmamış', 7, false],
      ],
    )
    const seniority = report.seniority as Json
    assert.equal(seniority.total, 12)
    assert.deepEqual(
      (seniority.bands as Json[]).map((band) => [band.key, band.count]),
      [
        ['under_1', null],
        ['from_1_to_3', 0],
        ['from_3_to_5', 0],
        ['from_5_to_10', null],
        ['over_10', 0],
        ['unknown', 6],
      ],
    )
    const leave = report.leave as Json
    const [annualRow] = leave.types as Json[]
    assert.deepEqual(annualRow, {
      code: 'annual',
      label: 'Yıllık ücretli izin',
      kind: 'annual',
      usedDays: 25,
      staffCount: 5,
      perStaffDays: 2.1,
      suppressed: false,
    })
    assert.ok(!(leave.types as Json[]).some((type) => type.kind === 'sick'))
    // Her birine 2021–2025'te 14'er, 2026'da 20 gün: 5 × (90 − 5); Mart 2026'da giren bakiyesiz.
    assert.deepEqual(leave.balance, {
      staffCount: 6,
      balanceDays: 425,
      perStaffDays: 70.8,
      suppressed: false,
      missingProfileCount: 6,
    })
    assert.deepEqual(leave.medical, { totalDays: null, suppressed: true })
    assert.deepEqual(report.warnings, { missingSeniorityCount: 6 })
    assert.ok(!JSON.stringify(report).includes('Öğretmen 1'))

    const reads = await auditOf(a.id, 'finance.hr_report.read')
    assert.deepEqual(
      reads.map((row) => [row.entityType, row.entityId, row.changes]),
      [
        [
          'hr_report',
          'hr-report:2026-01:2026-09',
          { fields: ['turnover', 'seniority', 'leave', 'medicalDays'] },
        ],
      ],
    )

    // B'de üç kişi raporlu: rapor günü yine gizli; B'nin çıkışları A'ya yansımaz.
    for (const id of other.teachers.slice(6, 8)) await sick(b, id)
    const bReport = ok(await get(PERIOD, b.admin))
    assert.deepEqual((bReport.turnover as Json).totals, {
      opening: 12,
      hires: 1,
      exits: 5,
      closing: 8,
      averageHeadcount: 10,
      turnoverBasisPoints: 5000,
      suppressed: false,
    })
    assert.deepEqual((bReport.leave as Json).medical, { totalDays: null, suppressed: true })
    assert.deepEqual(((ok(await get(PERIOD, a.admin)).turnover as Json).totals as Json).exits, 1)
  })

  test('DOM-FIN-117 K-401: varsayılan dönem bu ay; 5 kişiden az kurumda toplam da gizli', async () => {
    const t = await institution()
    await backdate(t)
    const report = ok(await get(REPORT, t.admin))
    assert.equal(report.from, '2026-10')
    assert.equal(report.endDay, '2026-10-06')
    assert.equal(((report.turnover as Json).totals as Json).suppressed, true)
    assert.equal(((report.turnover as Json).totals as Json).closing, null)
    assert.equal((report.seniority as Json).total, null)
  })

  test('DOM-FIN-117: CSV ve PDF verisi denetime düşer, taze oturum ister, kişi adı yok', async () => {
    const t = await institution()
    await staffed(t)
    const file = await get(PERIOD, t.admin, { accept: 'text/csv' })
    assert.equal(file.statusCode, 200, file.body)
    assert.match(String(file.headers['content-type']), /text\/csv/)
    assert.match(String(file.headers['content-disposition']), /ik-raporu-2026-01-2026-09\.csv/)
    assert.ok(file.body.startsWith('\uFEFF'))
    const lines = file.body.replace('\uFEFF', '').split('\r\n')
    assert.equal(lines[0], '"Dönem";"Ocak 2026 – Eylül 2026"')
    assert.ok(lines.includes('"Kurum";"Toplam";12;1;1;12;"12";"%8,33"'))
    assert.ok(lines.includes('"Rapor günleri (toplam)";"<5"'))
    assert.ok(!file.body.includes('Öğretmen 1'))

    const pdf = ok(await get(`${PERIOD}&purpose=pdf`, t.admin))
    assert.equal(pdf.from, '2026-01')
    assert.deepEqual(
      (await auditOf(t.id, 'finance.hr_report.export')).map((row) => row.entityId).sort(),
      ['hr-report:2026-01:2026-09:csv', 'hr-report:2026-01:2026-09:pdf'],
    )
    assert.equal((await auditOf(t.id, 'finance.hr_report.read')).length, 0)

    const later = await buildTestApp(db, { clock: () => new Date(Date.now() + 16 * 60 * 1000) })
    try {
      assertError(
        await call('GET', PERIOD, t.admin, undefined, { accept: 'text/csv' }, later),
        403,
        'reauthentication_required',
      )
      assertError(
        await call('GET', `${PERIOD}&purpose=pdf`, t.admin, undefined, {}, later),
        403,
        'reauthentication_required',
      )
      // Ekran okuması taze oturum istemez.
      assert.equal((await call('GET', PERIOD, t.admin, undefined, {}, later)).statusCode, 200)
    } finally {
      await later.close()
    }
    assert.equal((await auditOf(t.id, 'finance.hr_report.export')).length, 2)
  })
})
