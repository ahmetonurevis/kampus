import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  payrollExportProfiles,
  payrollExports,
  payrollLessonHours,
} from '../src/db/schema/finance-payroll-exports.ts'
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
 * Bordro programına aktarım uçları (DOM-FIN-105; ON-202; K-336…K-339). Her test kendi kurumunu
 * kurar; ücret tanımı ücret ucuyla (DOM-FIN-099) yazılır. FIXED_NOW 2026-10-06: Ekim cari ay,
 * Kasım gelecek ay.
 */

const FINANCE = '/api/v1/finance'
const EXPORTS = `${FINANCE}/payroll-exports`
const PREVIEW = `${EXPORTS}/preview`
const HOURS = `${FINANCE}/payroll-lesson-hours`
const PROFILE = `${FINANCE}/payroll-export-profile`
const RATES = `${FINANCE}/pay-rates`
const BOM = '\uFEFF'

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-105: bordro programına aktarım uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.95.0.1'

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
    clientIp = `10.95.${String((tenantCount += 1))}.1`
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
  async function payRate(t: Tenant, body: Json) {
    ok(await call('POST', RATES, t.admin, body), 201)
  }
  const hoursBody = (membershipId: string, overrides: Json = {}): Json => ({
    membershipId,
    month: '2026-10',
    lessonType: 'extra',
    hours: 10,
    ...overrides,
  })
  const createHours = (cookie: string, body: Json, headers: Record<string, string> = {}) =>
    call('POST', HOURS, cookie, body, headers)
  const preview = (cookie: string, month = '2026-10') => get(`${PREVIEW}?month=${month}`, cookie)
  const exportFile = (cookie: string, month = '2026-10', target: App = app) =>
    call('POST', EXPORTS, cookie, { month }, {}, target)
  const hoursRows = (institutionId: string) =>
    db.select().from(payrollLessonHours).where(eq(payrollLessonHours.institutionId, institutionId))
  const exportRows = (institutionId: string) =>
    db.select().from(payrollExports).where(eq(payrollExports.institutionId, institutionId))
  const auditOf = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  /** Selin: Ekim ortasında zam (iki ana ücret satırı), yemek yan hakkı ve ek ders ücreti. */
  async function staffed() {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    await payRate(t, {
      component: 'wage',
      membershipId: selin,
      rateType: 'monthly_gross',
      amountCents: 4_500_000,
      startDate: '2026-01-01',
    })
    await payRate(t, {
      component: 'wage',
      membershipId: selin,
      rateType: 'monthly_gross',
      amountCents: 5_000_000,
      startDate: '2026-10-15',
    })
    await payRate(t, {
      component: 'benefit',
      membershipId: selin,
      rateType: 'meal',
      amountCents: 300_000,
      benefitForm: 'cash',
      taxable: true,
      startDate: '2026-09-01',
    })
    await payRate(t, {
      component: 'lesson',
      membershipId: selin,
      rateType: 'extra',
      amountCents: 35_000,
      startDate: '2026-09-01',
    })
    return { ...t, selin }
  }

  test('kimliksiz istek 401', async () => {
    const url = `${HOURS}/${randomUUID()}`
    assertError(await get(`${PREVIEW}?month=2026-10`, null), 401)
    assertError(await call('POST', EXPORTS, null, { month: '2026-10' }), 401)
    assertError(await get(EXPORTS, null), 401)
    assertError(await call('POST', HOURS, null, hoursBody('m-1')), 401)
    assertError(await call('PATCH', url, null, { hours: 2 }, ifMatch(1)), 401)
    assertError(await call('DELETE', url, null, undefined, ifMatch(1)), 401)
    assertError(await get(PROFILE, null), 401)
    assertError(await call('PATCH', PROFILE, null, { profile: null }, ifMatch(1)), 401)
  })

  test('DOM-FIN-105: ön büro, öğretmen, veli ve öğrenci 403; kayıt ve denetim yazılmaz (K-338)', async () => {
    const t = await staffed()
    const entry = ok(await createHours(t.admin, hoursBody(t.selin)), 201)
    const url = `${HOURS}/${String(entry.id)}`
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await preview(cookie), 403)
      assertError(await exportFile(cookie), 403)
      assertError(await get(EXPORTS, cookie), 403)
      assertError(await createHours(cookie, hoursBody(t.selin, { lessonType: 'duty' })), 403)
      assertError(await call('PATCH', url, cookie, { hours: 2 }, ifMatch(1)), 403)
      assertError(await call('DELETE', url, cookie, undefined, ifMatch(1)), 403)
      assertError(await get(PROFILE, cookie), 403)
      assertError(await call('PATCH', PROFILE, cookie, { profile: null }, ifMatch(1)), 403)
    }
    const rows = await hoursRows(t.id)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.hours, 10)
    assert.equal(rows[0]?.version, 1)
    assert.equal((await exportRows(t.id)).length, 0)
    assert.equal((await auditOf(t.id, 'finance.payroll_export.read')).length, 0)
  })

  test('DOM-FIN-105: finance modülü kapalıyken bordro aktarım uçları 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await preview(closed.admin), 403, 'module_disabled')
    assertError(await exportFile(closed.admin), 403, 'module_disabled')
    assertError(await get(EXPORTS, closed.admin), 403, 'module_disabled')
    assertError(await createHours(closed.admin, hoursBody('m-1')), 403, 'module_disabled')
    assertError(await get(PROFILE, closed.admin), 403, 'module_disabled')
  })

  test('DOM-FIN-105: önizleme kalem başına satır, gün bilgisi, ek ders saat × ücret; okuma denetime düşer (K-336, K-337)', async () => {
    const t = await staffed()
    ok(await createHours(t.admin, hoursBody(t.selin, { hours: 12, note: 'Yedek ders dahil' })), 201)
    ok(await createHours(t.admin, hoursBody(t.selin, { lessonType: 'duty', hours: 4 })), 201)
    const data = ok(await preview(t.admin))
    assert.equal(data.from, '2026-10-01')
    assert.equal(data.to, '2026-10-31')
    const lines = data.lines as Json[]
    assert.deepEqual(
      lines.map((line) => [
        line.itemCode,
        line.startDate,
        line.endDate,
        line.days,
        line.rateCents,
        line.quantity,
        line.totalCents,
        line.warnings,
      ]),
      [
        [
          'wage.monthly_gross',
          '2026-10-01',
          '2026-10-14',
          14,
          4_500_000,
          null,
          null,
          ['partial_month'],
        ],
        [
          'wage.monthly_gross',
          '2026-10-15',
          '2026-10-31',
          17,
          5_000_000,
          null,
          null,
          ['partial_month'],
        ],
        ['lesson.extra', null, null, null, 35_000, 12, 420_000, []],
        ['lesson.duty', null, null, null, null, 4, null, ['lesson_rate_missing']],
        ['benefit.meal', '2026-10-01', '2026-10-31', 31, 300_000, null, 300_000, []],
      ],
    )
    assert.equal(lines[2]?.note, 'Yedek ders dahil')
    assert.equal(lines[2]?.staffName, 'Selin Kaya')
    assert.deepEqual(data.totals, {
      lineCount: 5,
      staffCount: 1,
      earningCents: 720_000,
      deductionCents: 0,
      missingTotalCount: 3,
    })
    const audits = await auditOf(t.id, 'finance.payroll_export.read')
    assert.equal(audits.length, 1)
    assert.equal(audits[0]?.entityId, '2026-10')
    assert.deepEqual(audits[0]?.changes, { fields: ['rateCents', 'totalCents', 'quantity'] })
    // Ayla kesişmeyen ay: yalnız sürenler; ücretsiz ay boş.
    const empty = ok(await preview(t.admin, '2025-12'))
    assert.deepEqual(empty.lines, [])
    assertError(await preview(t.admin, '2026-13'), 400)
    assertError(await get(`${PREVIEW}?month=2026-10&institutionId=x`, t.admin), 400)
  })

  test('DOM-FIN-105: ek ders saati girişi, mükerrer 409, düzeltme, silme ve yeniden giriş (K-337)', async () => {
    const t = await staffed()
    const created = ok(await createHours(t.admin, hoursBody(t.selin, { note: ' Not ' })), 201)
    assert.equal(created.month, '2026-10')
    assert.equal(created.note, 'Not')
    assert.equal(created.version, 1)
    assertError(
      await createHours(t.admin, hoursBody(t.selin, { hours: 3 })),
      409,
      'payroll_lesson_hours_exist',
    )
    const url = `${HOURS}/${String(created.id)}`
    assertError(
      await call('PATCH', url, t.admin, { hours: 10, note: 'Not' }, ifMatch(1)),
      422,
      'payroll_lesson_hours_unchanged',
    )
    assertError(await call('PATCH', url, t.admin, { hours: 0 }, ifMatch(1)), 400)
    assertError(await call('PATCH', url, t.admin, { hours: 11 }), 400, 'if_match_required')
    const updated = ok(await call('PATCH', url, t.admin, { hours: 11 }, ifMatch(1)))
    assert.equal(updated.hours, 11)
    assert.equal(updated.note, 'Not')
    assert.equal(updated.version, 2)
    assertError(await call('PATCH', url, t.admin, { hours: 12 }, ifMatch(1)), 409)
    assertError(await call('DELETE', url, t.admin, undefined, ifMatch(1)), 409)
    ok(await call('DELETE', url, t.admin, undefined, ifMatch(2)))
    assertError(await call('PATCH', url, t.admin, { hours: 12 }, ifMatch(3)), 404)
    const again = ok(await createHours(t.admin, hoursBody(t.selin, { hours: 5 })), 201)
    assert.equal(again.hours, 5)
    const rows = await hoursRows(t.id)
    assert.equal(rows.length, 2)
    assert.equal(rows.filter((row) => row.archivedAt === null).length, 1)
    const fields = (await auditOf(t.id, 'finance.payroll_lesson_hours.create'))[0]?.changes
    assert.deepEqual(fields, { fields: ['membershipId', 'month', 'lessonType', 'hours', 'note'] })
    assert.equal((await auditOf(t.id, 'finance.payroll_lesson_hours.update')).length, 1)
    assert.equal((await auditOf(t.id, 'finance.payroll_lesson_hours.archive')).length, 1)
  })

  test('DOM-FIN-105: geçersiz ek ders girişi 400/422, kayıt yazılmaz; Idempotency-Key tekrarı tek kayıt', async () => {
    const t = await staffed()
    const parent = await person(t, 'veli', 'Ayşe Yılmaz')
    assertError(await createHours(t.admin, hoursBody(t.selin, { hours: 0 })), 400)
    assertError(await createHours(t.admin, hoursBody(t.selin, { lessonType: 'lesson_hour' })), 400)
    assertError(await createHours(t.admin, hoursBody(t.selin, { month: '2026-10-01' })), 400)
    assertError(
      await createHours(t.admin, hoursBody(parent)),
      422,
      'payroll_lesson_hours_not_staff',
    )
    assertError(
      await createHours(t.admin, hoursBody('m-yok')),
      422,
      'payroll_lesson_hours_staff_not_found',
    )
    assertError(
      await createHours(t.admin, hoursBody(t.selin, { month: '2026-11' })),
      422,
      'payroll_lesson_hours_future_month',
    )
    assert.equal((await hoursRows(t.id)).length, 0)
    const key = { 'idempotency-key': randomUUID() }
    const first = await createHours(t.admin, hoursBody(t.selin), key)
    const second = await createHours(t.admin, hoursBody(t.selin), key)
    assert.equal(first.statusCode, 201)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal((await hoursRows(t.id)).length, 1)
  })

  test('DOM-FIN-105: dosya genel CSV; özet satırı, SHA-256 ve denetim; aynı ay yeniden üretilir (K-338)', async () => {
    const t = await staffed()
    ok(await createHours(t.admin, hoursBody(t.selin, { hours: 12 })), 201)
    const file = await exportFile(t.admin)
    assert.equal(file.statusCode, 200, file.body)
    assert.match(String(file.headers['content-type']), /text\/csv/)
    assert.match(String(file.headers['content-disposition']), /bordro-girdi-2026-10\.csv/)
    assert.ok(file.body.startsWith(BOM))
    const lines = file.body.slice(1).split('\r\n')
    assert.equal(lines.length, 5)
    assert.ok(lines[0]?.startsWith('"Dönem";"Personel no";"Personel";"Görev";"Kalem kodu"'))
    assert.ok(
      lines[3]?.includes(
        `"lesson.extra";"Ek ders ücreti · Ek ders";"Kazanç";"Saat";350,00;12;4200,00;`,
      ),
    )
    const rows = await exportRows(t.id)
    assert.equal(rows.length, 1)
    const row = rows[0]!
    assert.equal(row.id, file.headers['x-kampus-export-id'])
    assert.equal(row.monthStart, '2026-10-01')
    assert.equal(row.format, 'standard')
    assert.deepEqual(
      [row.lineCount, row.staffCount, row.earningCents, row.deductionCents, row.missingTotalCount],
      [4, 1, 720_000, 0, 2],
    )
    assert.equal(row.contentSha256, createHash('sha256').update(file.body, 'utf8').digest('hex'))
    assert.equal(row.createdByUserId.length > 0, true)
    const audits = await auditOf(t.id, 'finance.payroll_export.create')
    assert.deepEqual(
      audits.map((audit) => [audit.entityId, audit.changes]),
      [[row.id, { fields: ['month:2026-10'] }]],
    )
    // Dönem kilidi yok: saat değişince aynı ay yeniden üretilir, ikinci özet satırı açılır.
    const [entry] = await hoursRows(t.id)
    ok(await call('PATCH', `${HOURS}/${entry!.id}`, t.admin, { hours: 2 }, ifMatch(1)))
    assert.equal((await exportFile(t.admin)).statusCode, 200)
    const history = await get(`${EXPORTS}?month=2026-10`, t.admin)
    assert.equal(history.statusCode, 200, history.body)
    const items = history.json().data as Json[]
    assert.equal(history.json().meta.total, 2)
    // İki üretim aynı anda (FIXED_NOW); sıra yalnız ana göredir.
    assert.deepEqual(items.map((item) => [item.month, item.earningCents, item.format]).sort(), [
      ['2026-10', 370_000, 'standard'],
      ['2026-10', 720_000, 'standard'],
    ])
    assert.equal(items[0]?.createdByName, 'Test Yönetici')
    assert.equal((await get(`${EXPORTS}?month=2026-09`, t.admin)).json().meta.total, 0)
    // Özet satırı değişmez (kampus_reject_immutable_change).
    await assert.rejects(
      db.execute(sql`update payroll_exports set line_count = 0 where id = ${row.id}`),
    )
    await assert.rejects(db.execute(sql`delete from payroll_exports where id = ${row.id}`))
    assertError(await exportFile(t.admin, '2026-13'), 400)
    assertError(await call('POST', EXPORTS, t.admin, { month: '2026-10', institutionId: 'x' }), 400)
  })

  test('DOM-FIN-105: eski oturumla dosya 403 reauthentication_required, özet yazılmaz; önizleme açık', async () => {
    const t = await staffed()
    const later = await buildTestApp(db, { clock: () => new Date(Date.now() + 16 * 60 * 1000) })
    try {
      assertError(await exportFile(t.admin, '2026-10', later), 403, 'reauthentication_required')
      assert.equal(
        (await call('GET', `${PREVIEW}?month=2026-10`, t.admin, undefined, {}, later)).statusCode,
        200,
      )
    } finally {
      await later.close()
    }
    assert.equal((await exportRows(t.id)).length, 0)
  })

  test('DOM-FIN-105: sütun eşleme şablonu dosyayı biçimler; sürüm 409, geçersiz 400, null genel dosyaya döner (K-339)', async () => {
    const t = await staffed()
    const initial = ok(await get(PROFILE, t.admin))
    assert.deepEqual(initial, { profile: null, version: 1 })
    const profile = {
      separator: ',',
      dateFormat: 'tr',
      decimal: '.',
      columns: [
        { source: 'fixed', header: 'Sube', value: 'MERKEZ' },
        { source: 'staffNumber', header: 'Sicil' },
        { source: 'itemCode', header: 'Kod' },
        { source: 'startDate', header: 'Giris' },
        { source: 'total', header: 'Tutar' },
      ],
    }
    assertError(
      await call('PATCH', PROFILE, t.admin, { profile: { ...profile, decimal: ',' } }, ifMatch(1)),
      400,
    )
    assertError(
      await call(
        'PATCH',
        PROFILE,
        t.admin,
        { profile: { ...profile, columns: [{ source: 'iban', header: 'IBAN' }] } },
        ifMatch(1),
      ),
      400,
    )
    assert.equal(
      (
        await db
          .select()
          .from(payrollExportProfiles)
          .where(eq(payrollExportProfiles.institutionId, t.id))
      ).length,
      0,
    )
    const saved = ok(await call('PATCH', PROFILE, t.admin, { profile }, ifMatch(1)))
    assert.equal(saved.version, 2)
    assertError(await call('PATCH', PROFILE, t.admin, { profile: null }, ifMatch(1)), 409)
    const file = await exportFile(t.admin)
    assert.equal(file.statusCode, 200, file.body)
    const lines = file.body.slice(1).split('\r\n')
    assert.equal(lines[0], '"Sube","Sicil","Kod","Giris","Tutar"')
    assert.equal(lines[1], `"MERKEZ","${t.selin}","wage.monthly_gross","01.10.2026",`)
    assert.equal(lines[3], `"MERKEZ","${t.selin}","benefit.meal","01.10.2026",3000.00`)
    assert.equal((await exportRows(t.id))[0]?.format, 'profile')
    const reset = ok(await call('PATCH', PROFILE, t.admin, { profile: null }, ifMatch(2)))
    assert.deepEqual(reset, { profile: null, version: 3 })
    assert.equal((await auditOf(t.id, 'finance.payroll_export_profile')).length, 2)
  })

  test('DOM-FIN-105: başka kurumun ek ders saati ve dosyası 404 ve B değişmez', async () => {
    const a = await staffed()
    const b = await staffed()
    const bEntry = ok(await createHours(b.admin, hoursBody(b.selin, { hours: 7 })), 201)
    const bUrl = `${HOURS}/${String(bEntry.id)}`
    assert.equal((await exportFile(b.admin)).statusCode, 200)
    assertError(await call('PATCH', bUrl, a.admin, { hours: 1 }, ifMatch(1)), 404)
    assertError(await call('DELETE', bUrl, a.admin, undefined, ifMatch(1)), 404)
    // Gövdedeki B personeli A'da bulunmaz; `institutionId` alanı şemada yok.
    assertError(
      await createHours(a.admin, hoursBody(b.selin)),
      422,
      'payroll_lesson_hours_staff_not_found',
    )
    assertError(await createHours(a.admin, { ...hoursBody(a.selin), institutionId: b.id }), 400)
    const [bRow] = await hoursRows(b.id)
    assert.equal(bRow?.hours, 7)
    assert.equal(bRow?.version, 1)
    assert.equal(bRow?.archivedAt, null)
    // A'nın önizlemesi, geçmişi ve şablonu B'yi görmez.
    const lines = ok(await preview(a.admin)).lines as Json[]
    assert.equal(
      lines.every((line) => line.membershipId === a.selin),
      true,
    )
    assert.equal(
      lines.some((line) => line.lessonHoursId === bEntry.id),
      false,
    )
    assert.equal((await get(EXPORTS, a.admin)).json().meta.total, 0)
    ok(await call('PATCH', PROFILE, b.admin, { profile: null }, ifMatch(1)))
    assert.deepEqual(ok(await get(PROFILE, a.admin)), { profile: null, version: 1 })
    assertError(
      await call('PATCH', PROFILE, a.admin, { profile: null, institutionId: b.id }, ifMatch(1)),
      400,
    )
    assert.equal((await exportRows(a.id)).length, 0)
    // A'nın dosyası B'nin personelini ve saatini taşımaz; B'nin özet satırı tek kalır.
    const aFile = await exportFile(a.admin)
    assert.equal(aFile.statusCode, 200, aFile.body)
    assert.equal(aFile.body.includes(b.selin), false)
    assert.equal((await exportRows(a.id)).length, 1)
    assert.equal((await exportRows(b.id)).length, 1)
  })
})
