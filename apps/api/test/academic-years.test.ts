import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { academicTerms, academicYears } from '../src/db/schema/academic-years.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { institutionSettings } from '../src/db/schema/institution-settings.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'

/**
 * Eğitim yılı ve dönem uçları (IST-011; DOM-YTK-063…067). Kural core `lib/academic-years.ts`'tedir;
 * burada rol (beş rol okur, yalnız yönetici yazar), başka kurum, sürüm (`If-Match`), mükerrer
 * işlem (`Idempotency-Key`), tek etkin yıl ve yıl geçişi, kurum ayarının eşitlenmesi ve öğrenci/veli
 * yanıtının daralması denetlenir. Saat `FIXED_NOW` (2026-10-06).
 */

type Json = ReturnType<typeof JSON.parse>
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

const TERMS = [
  { name: 'Güz', startDate: '2026-09-14', endDate: '2027-01-22' },
  { name: 'Bahar', startDate: '2027-02-08', endDate: '2027-06-25' },
]

describe('eğitim yılı ve dönem uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let now = FIXED_NOW
  let tenantCount = 0
  let clientIp = '127.0.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => now })
  })
  after(async () => {
    await app.close()
    await close()
  })

  /**
   * Varsayılan kurum ayarsız ve yılsız açılır (`academicYear: null`): testler yılları uçlardan
   * kurar. Ayarlı açılış (kurum açılış yolu) varsayılan etkin yılı da yazar; ayrı testte.
   */
  async function tenant(
    type: 'school' | 'language_school' = 'school',
    academicYear: number | null = null,
  ) {
    now = FIXED_NOW
    clientIp = `10.7.${(tenantCount += 1)}.1`
    const institution = await createInstitution(app, { type, academicYear })
    const users = {
      frontDesk: await createMember(app, institution.id, 'onburo'),
      teacher: await createMember(app, institution.id, 'ogretmen'),
      student: await createMember(app, institution.id, 'ogrenci'),
      parent: await createMember(app, institution.id, 'veli'),
    }
    const cookies = {
      admin: await signInAs(app, institution.admin),
      frontDesk: await signInAs(app, users.frontDesk),
      teacher: await signInAs(app, users.teacher),
      student: await signInAs(app, users.student),
      parent: await signInAs(app, users.parent),
    }
    return { institution, cookies }
  }

  function call(
    method: Method,
    url: string,
    cookie?: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url: `/api/v1${url}`,
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie ? { cookie } : {}),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const key = () => ({ 'idempotency-key': randomUUID() })
  const match = (value: number) => ({ 'if-match': `"${value}"` })
  async function ok(response: Awaited<ReturnType<typeof call>>, status = 200) {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function fails(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
    assert.equal(response.statusCode, status, response.body)
    assert.equal(response.json().code, code, response.body)
  }

  const create = (cookie: string, body: unknown, headers: Record<string, string> = key()) =>
    call('POST', '/academic-years', cookie, body, headers)
  const command = (cookie: string, path: string, version: number, method: Method = 'POST') =>
    call(
      method,
      `/academic-years/${path}`,
      cookie,
      method === 'POST' ? {} : undefined,
      match(version),
    )

  const yearRows = (institutionId: string) =>
    db.select().from(academicYears).where(eq(academicYears.institutionId, institutionId))
  const termRows = (institutionId: string) =>
    db.select().from(academicTerms).where(eq(academicTerms.institutionId, institutionId))
  async function settingsYear(institutionId: string) {
    const [row] = await db
      .select({ academicYear: institutionSettings.academicYear })
      .from(institutionSettings)
      .where(eq(institutionSettings.institutionId, institutionId))
    return row?.academicYear
  }

  test('401: oturumsuz okuma ve yazma reddedilir', async () => {
    fails(await call('GET', '/academic-years'), 401, 'unauthenticated')
    fails(await call('GET', '/academic-years/current'), 401, 'unauthenticated')
    fails(await create('', { startYear: 2026 }), 401, 'unauthenticated')
  })

  test('DOM-YTK-067: beş rol okur; yazma yalnız yöneticide, rol reddi gövdeden önce', async () => {
    const { institution, cookies } = await tenant()
    for (const cookie of Object.values(cookies))
      await ok(await call('GET', '/academic-years', cookie))
    for (const cookie of [cookies.frontDesk, cookies.teacher, cookies.student, cookies.parent]) {
      fails(await create(cookie, { startYear: 2026 }), 403, 'forbidden')
      // Bozuk gövde de 403: rol `preValidation`'da denetlenir.
      fails(await create(cookie, { startYear: 'x' }), 403, 'forbidden')
      fails(await command(cookie, '2026/activate', 1), 403, 'forbidden')
    }
    assert.equal((await yearRows(institution.id)).length, 0)
  })

  test('DOM-YTK-063: yönetici yıl açar; varsayılan aralık, 201 + Location, denetimde yalnız alan adları', async () => {
    const { institution, cookies } = await tenant()
    const response = await create(cookies.admin, { startYear: 2026, terms: TERMS })
    const year = await ok(response, 201)
    assert.equal(response.headers.location, '/api/v1/academic-years/2026')
    assert.equal(year.name, '2026–2027')
    assert.equal(year.startDate, '2026-09-01')
    assert.equal(year.endDate, '2027-08-31')
    assert.equal(year.status, 'planned')
    assert.equal(year.isActive, false)
    assert.equal(year.rowVersion, 1)
    assert.deepEqual(
      year.terms.map((term: Json) => [term.name, term.sequence]),
      [
        ['Güz', 1],
        ['Bahar', 2],
      ],
    )
    assert.equal((await yearRows(institution.id)).length, 1)
    assert.equal((await termRows(institution.id)).length, 2)
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, institution.id),
          eq(auditLog.action, 'academic_year.create'),
        ),
      )
    assert.deepEqual(audit?.changes, { fields: ['startYear', 'startDate', 'endDate', 'terms'] })
    assert.equal(audit?.entityId, '2026')

    const read = await ok(await call('GET', '/academic-years/2026', cookies.teacher))
    assert.equal(read.rowVersion, 1)
    assert.equal(read.terms.length, 2)
  })

  test('mükerrer işlem: aynı Idempotency-Key ilk yanıtı tekrarlar, farklı gövde 422', async () => {
    const { institution, cookies } = await tenant()
    const headers = key()
    const first = await create(cookies.admin, { startYear: 2026 }, headers)
    const again = await create(cookies.admin, { startYear: 2026 }, headers)
    assert.equal(again.statusCode, 201, again.body)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assert.deepEqual(again.json(), first.json())
    fails(await create(cookies.admin, { startYear: 2027 }, headers), 422, 'idempotency_key_reused')
    assert.equal((await yearRows(institution.id)).length, 1)
    // Anahtarsız aynı yıl yeniden açılmaz.
    fails(await create(cookies.admin, { startYear: 2026 }), 409, 'academic_year_exists')
  })

  test('400: geçersiz gövde, gövdede institutionId, anahtarsız oluşturma ve If-Match eksikliği kayıt değiştirmez', async () => {
    const { institution, cookies } = await tenant()
    const other = await createInstitution(app, { academicYear: null })
    fails(await create(cookies.admin, { startYear: 1999 }), 400, 'validation_failed')
    fails(
      await create(cookies.admin, { startYear: 2026, startDate: '2026-02-30' }),
      400,
      'validation_failed',
    )
    fails(
      await create(cookies.admin, { startYear: 2026, institutionId: other.id }),
      400,
      'validation_failed',
    )
    fails(await create(cookies.admin, { startYear: 2026 }, {}), 400, 'idempotency_key_required')
    fails(
      await create(cookies.admin, { startYear: 2026 }, { ...key(), ...match(1) }),
      400,
      'if_match_not_supported',
    )
    assert.equal((await yearRows(institution.id)).length, 0)
    assert.equal((await yearRows(other.id)).length, 0)

    await ok(await create(cookies.admin, { startYear: 2026 }), 201)
    fails(
      await call('PATCH', '/academic-years/2026', cookies.admin, { endDate: '2027-07-31' }),
      400,
      'if_match_required',
    )
    fails(
      await call('PATCH', '/academic-years/2026', cookies.admin, {}, match(1)),
      400,
      'validation_failed',
    )
    fails(
      await call('GET', '/academic-years?status=active', cookies.admin),
      400,
      'validation_failed',
    )
    const [row] = await yearRows(institution.id)
    assert.equal(row?.version, 1)
    assert.equal(row?.endDate, '2027-08-31')
  })

  test('409: bayat If-Match sürümü reddedilir ve yıl değişmez', async () => {
    const { institution, cookies } = await tenant()
    await ok(await create(cookies.admin, { startYear: 2026 }), 201)
    const updated = await ok(
      await call(
        'PATCH',
        '/academic-years/2026',
        cookies.admin,
        { endDate: '2027-07-31' },
        match(1),
      ),
    )
    assert.equal(updated.rowVersion, 2)
    assert.equal(updated.endDate, '2027-07-31')
    fails(
      await call(
        'PATCH',
        '/academic-years/2026',
        cookies.admin,
        { endDate: '2027-06-30' },
        match(1),
      ),
      409,
      'version_conflict',
    )
    fails(
      await call('POST', '/academic-years/2026/terms', cookies.admin, TERMS[0], match(1)),
      409,
      'version_conflict',
    )
    const [row] = await yearRows(institution.id)
    assert.equal(row?.version, 2)
    assert.equal(row?.endDate, '2027-07-31')
    assert.equal((await termRows(institution.id)).length, 0)
  })

  test('başka kurum: yılı 404, yazma B yılını değiştirmez, listede görünmez', async () => {
    const a = await tenant()
    const b = await tenant()
    await ok(await create(b.cookies.admin, { startYear: 2028, terms: [] }), 201)
    fails(await call('GET', '/academic-years/2028', a.cookies.admin), 404, 'not_found')
    fails(
      await call(
        'PATCH',
        '/academic-years/2028',
        a.cookies.admin,
        { endDate: '2029-06-30' },
        match(1),
      ),
      404,
      'not_found',
    )
    fails(await command(a.cookies.admin, '2028/activate', 1), 404, 'not_found')
    const list = await call('GET', '/academic-years', a.cookies.admin)
    assert.equal(list.json().meta.total, 0)
    const [row] = await yearRows(b.institution.id)
    assert.equal(row?.version, 1)
    assert.equal(row?.endDate, '2029-08-31')
    assert.equal(row?.status, 'planned')
  })

  test('DOM-YTK-064: örtüşen ya da yıl dışı dönem 422, aynı ad 409; geçerli dönem 201 ve sırası hesaplanır', async () => {
    const { institution, cookies } = await tenant()
    await ok(await create(cookies.admin, { startYear: 2026, terms: [TERMS[0]] }), 201)
    const add = (body: unknown, version: number) =>
      call('POST', '/academic-years/2026/terms', cookies.admin, body, match(version))
    fails(
      await add({ name: 'Ara', startDate: '2027-01-10', endDate: '2027-02-01' }, 1),
      422,
      'academic_term_overlap',
    )
    fails(
      await add({ name: 'Yaz', startDate: '2027-08-01', endDate: '2027-09-10' }, 1),
      422,
      'academic_term_outside_year',
    )
    fails(
      await add({ name: 'güz', startDate: '2027-02-08', endDate: '2027-06-25' }, 1),
      409,
      'academic_term_name_exists',
    )
    assert.equal((await termRows(institution.id)).length, 1)
    assert.equal((await yearRows(institution.id))[0]?.version, 1)

    // Bahar Güz'den önce eklense de sıra başlangıç gününden hesaplanır.
    const response = await add({ name: 'Ön', startDate: '2026-09-01', endDate: '2026-09-11' }, 1)
    const year = await ok(response, 201)
    assert.equal(year.rowVersion, 2)
    assert.deepEqual(
      year.terms.map((term: Json) => [term.name, term.sequence]),
      [
        ['Ön', 1],
        ['Güz', 2],
      ],
    )
    const guz = year.terms.find((term: Json) => term.name === 'Güz')
    const renamed = await ok(
      await call(
        'PATCH',
        `/academic-years/2026/terms/${guz.id}`,
        cookies.admin,
        { name: 'Birinci dönem' },
        match(2),
      ),
    )
    assert.equal(renamed.rowVersion, 3)
    assert.ok(renamed.terms.some((term: Json) => term.name === 'Birinci dönem'))
    fails(
      await call(
        'PATCH',
        `/academic-years/2026/terms/${guz.id}`,
        cookies.admin,
        { endDate: '2027-09-30' },
        match(3),
      ),
      422,
      'academic_term_outside_year',
    )
    fails(await command(cookies.admin, `2026/terms/${randomUUID()}`, 3, 'DELETE'), 404, 'not_found')
    const removed = await ok(await command(cookies.admin, `2026/terms/${guz.id}`, 3, 'DELETE'))
    assert.deepEqual(
      removed.terms.map((term: Json) => term.name),
      ['Ön'],
    )
    const rows = await termRows(institution.id)
    assert.equal(rows.length, 2)
    assert.equal(rows.filter((row) => row.archivedAt !== null).length, 1)
  })

  test('DOM-YTK-065: etkinleştirme tek etkin yılı korur, önceki yılı kapatır ve kurum yılını eşitler', async () => {
    const { institution, cookies } = await tenant()
    await ok(await create(cookies.admin, { startYear: 2026 }), 201)
    fails(await command(cookies.admin, '2026/activate', 1), 422, 'academic_terms_required')
    const withTerms = await ok(
      await call('POST', '/academic-years/2026/terms', cookies.admin, TERMS[0], match(1)),
      201,
    )
    const active = await ok(await command(cookies.admin, '2026/activate', withTerms.rowVersion))
    assert.equal(active.status, 'active')
    assert.equal(active.isActive, true)
    assert.equal(active.activatedAt, FIXED_NOW.toISOString())
    assert.equal(await settingsYear(institution.id), 2026)
    fails(
      await command(cookies.admin, '2026/activate', active.rowVersion),
      409,
      'academic_year_already_active',
    )

    await ok(
      await create(cookies.admin, {
        startYear: 2027,
        terms: [{ name: 'Güz', startDate: '2027-09-13', endDate: '2028-01-21' }],
      }),
      201,
    )
    // Başlangıçtan 60 günden önce etkinleşmez; 2026 etkin kalır, kurum yılı değişmez.
    fails(
      await command(cookies.admin, '2027/activate', 1),
      422,
      'academic_year_activation_too_early',
    )
    assert.equal(await settingsYear(institution.id), 2026)
    assert.deepEqual(
      (await yearRows(institution.id)).map((row) => [row.startYear, row.status, row.version]),
      [
        [2026, 'active', active.rowVersion],
        [2027, 'planned', 1],
      ],
    )
    // 2 Temmuz 21.00 UTC = 3 Temmuz 00.00 İstanbul: başlangıçtan tam 60 gün önce.
    now = new Date('2027-07-02T21:00:00.000Z')
    const next = await ok(await command(cookies.admin, '2027/activate', 1))
    assert.equal(next.status, 'active')
    assert.equal(await settingsYear(institution.id), 2027)
    const rows = await yearRows(institution.id)
    assert.deepEqual(
      rows.filter((row) => row.status === 'active').map((row) => row.startYear),
      [2027],
    )
    const previous = rows.find((row) => row.startYear === 2026)
    assert.equal(previous?.status, 'closed')
    assert.equal(previous?.closedAt?.toISOString(), now.toISOString())
    const closes = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, institution.id), eq(auditLog.action, 'academic_year.close')),
      )
    assert.deepEqual(
      closes.map((row) => [row.entityId, row.changes]),
      [['2026', { fields: ['status', 'closedAt'] }]],
    )
    // Kapanan yıl yeniden açılmaz ve değişmez.
    fails(
      await command(cookies.admin, '2026/activate', previous!.version),
      409,
      'academic_year_closed',
    )
    fails(
      await call(
        'PATCH',
        '/academic-years/2026',
        cookies.admin,
        { endDate: '2027-07-31' },
        match(previous!.version),
      ),
      409,
      'academic_year_closed',
    )
    // Okulda etkin yılın son dönemi kaldırılamaz.
    const termId = next.terms[0].id
    fails(
      await command(cookies.admin, `2027/terms/${termId}`, next.rowVersion, 'DELETE'),
      422,
      'academic_terms_required',
    )
  })

  test('DOM-YTK-065: daha yeni yıl etkinken eski yıl etkinleşmez; dil okulunda dönemsiz yıl etkinleşir', async () => {
    const { cookies } = await tenant('language_school')
    await ok(await create(cookies.admin, { startYear: 2026 }), 201)
    await ok(await create(cookies.admin, { startYear: 2027 }), 201)
    now = new Date('2027-07-10T09:00:00.000Z')
    await ok(await command(cookies.admin, '2027/activate', 1))
    fails(await command(cookies.admin, '2026/activate', 1), 422, 'academic_year_activation_order')
  })

  test('DOM-YTK-065: iki eşzamanlı etkinleştirmeden biri başarılı, diğeri 409; tek etkin yıl kalır', async () => {
    const { institution, cookies } = await tenant()
    await ok(await create(cookies.admin, { startYear: 2026, terms: TERMS }), 201)
    const responses = await Promise.all([
      call('POST', '/academic-years/2026/activate', cookies.admin, {}, { ...key(), ...match(1) }),
      call('POST', '/academic-years/2026/activate', cookies.admin, {}, { ...key(), ...match(1) }),
    ])
    assert.deepEqual(responses.map((response) => response.statusCode).sort(), [200, 409])
    const rows = await yearRows(institution.id)
    assert.deepEqual(
      rows.map((row) => [row.startYear, row.status, row.version]),
      [[2026, 'active', 2]],
    )
    const activations = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, institution.id),
          eq(auditLog.action, 'academic_year.activate'),
        ),
      )
    assert.equal(activations.length, 1)
  })

  test('DOM-YTK-066: yalnız etkin yıl ve yalnız son gününden itibaren kapanır', async () => {
    const { institution, cookies } = await tenant()
    await ok(await create(cookies.admin, { startYear: 2026, terms: TERMS }), 201)
    fails(await command(cookies.admin, '2026/close', 1), 422, 'academic_year_not_active')
    const active = await ok(await command(cookies.admin, '2026/activate', 1))
    fails(
      await command(cookies.admin, '2026/close', active.rowVersion),
      422,
      'academic_year_not_ended',
    )
    now = new Date('2027-08-31T09:00:00.000Z')
    const closed = await ok(await command(cookies.admin, '2026/close', active.rowVersion))
    assert.equal(closed.status, 'closed')
    assert.equal(closed.isActive, false)
    assert.equal(closed.closedAt, now.toISOString())
    const [row] = await yearRows(institution.id)
    assert.equal(row?.status, 'closed')
    fails(
      await call(
        'POST',
        '/academic-years/2026/terms',
        cookies.admin,
        TERMS[0],
        match(closed.rowVersion),
      ),
      409,
      'academic_year_closed',
    )
  })

  test('DOM-YTK-067: öğrenci ve veli yalnız ad, tarih ve etkinlik görür; /current bugünün dönemini verir', async () => {
    const { cookies } = await tenant()
    await ok(await create(cookies.admin, { startYear: 2026, terms: TERMS }), 201)
    await ok(await command(cookies.admin, '2026/activate', 1))

    for (const cookie of [cookies.student, cookies.parent]) {
      const response = await call('GET', '/academic-years', cookie)
      const [year] = await ok(response)
      assert.deepEqual(Object.keys(year).sort(), [
        'endDate',
        'isActive',
        'name',
        'startDate',
        'startYear',
        'terms',
      ])
      assert.deepEqual(Object.keys(year.terms[0]).sort(), [
        'endDate',
        'name',
        'sequence',
        'startDate',
      ])
      assert.equal(year.isActive, true)
      const current = await ok(await call('GET', '/academic-years/current', cookie))
      assert.equal(current.date, '2026-10-06')
      assert.equal(current.year.startYear, 2026)
      assert.equal(current.year.status, undefined)
      assert.deepEqual(current.term, {
        name: 'Güz',
        sequence: 1,
        startDate: '2026-09-14',
        endDate: '2027-01-22',
      })
    }

    const staff = await ok(await call('GET', '/academic-years/current', cookies.frontDesk))
    assert.equal(staff.year.status, 'active')
    assert.equal(staff.year.rowVersion, 2)
    assert.equal(typeof staff.term.id, 'string')

    // Dönem arası tatilde dönem boştur.
    now = new Date('2027-02-01T09:00:00.000Z')
    const holiday = await ok(await call('GET', '/academic-years/current', cookies.teacher))
    assert.equal(holiday.year.startYear, 2026)
    assert.equal(holiday.term, null)
  })

  test('DOM-YTK-067: /current günü Europe/Istanbul gününe göre seçer (UTC 21.00–24.00)', async () => {
    const { cookies } = await tenant()
    await ok(await create(cookies.admin, { startYear: 2026, terms: TERMS }), 201)
    await ok(await command(cookies.admin, '2026/activate', 1))
    await ok(await create(cookies.admin, { startYear: 2027 }), 201)
    const at = async (instant: string) => {
      now = new Date(instant)
      return ok(await call('GET', '/academic-years/current', cookies.student))
    }
    // UTC 13 Eylül 20.59 = İstanbul 13 Eylül 23.59: Güz henüz başlamadı.
    const before = await at('2026-09-13T20:59:59.999Z')
    assert.equal(before.date, '2026-09-13')
    assert.equal(before.term, null)
    // UTC 13 Eylül 21.30 = İstanbul 14 Eylül 00.30: Güz'ün ilk günü.
    const first = await at('2026-09-13T21:30:00.000Z')
    assert.equal(first.date, '2026-09-14')
    assert.equal(first.term?.name, 'Güz')
    // UTC'de hâlâ 31 Ağustos, İstanbul'da 1 Eylül: gün 2027 planlı yılına düşer.
    const lastUtc = await at('2027-08-31T23:59:59.999Z')
    assert.equal(lastUtc.date, '2027-09-01')
    assert.equal(lastUtc.year.startYear, 2027)
    assert.equal(lastUtc.year.isActive, false)
    const lastDay = await at('2027-08-31T20:59:59.999Z')
    assert.equal(lastDay.date, '2027-08-31')
    assert.equal(lastDay.year.startYear, 2026)
    assert.equal(lastDay.year.isActive, true)
  })

  test('DOM-YTK-064: dönem adı tekilliği core ile aynı anahtar; "I." ile "ı." aynı, "i." ayrı ad', async () => {
    const { institution, cookies } = await tenant()
    await ok(
      await create(cookies.admin, {
        startYear: 2026,
        terms: [{ name: 'I. dönem', startDate: '2026-09-14', endDate: '2027-01-22' }],
      }),
      201,
    )
    const add = (name: string, version: number) =>
      call(
        'POST',
        '/academic-years/2026/terms',
        cookies.admin,
        { name, startDate: '2027-02-08', endDate: '2027-06-25' },
        match(version),
      )
    fails(await add('ı. DÖNEM', 1), 409, 'academic_term_name_exists')
    // `lower()` ile çakışırdı (genel 409); Türkçe anahtarda ayrı addır ve yazılır.
    const year = await ok(await add('i. dönem', 1), 201)
    assert.deepEqual(
      year.terms.map((term: Json) => term.name),
      ['I. dönem', 'i. dönem'],
    )
    assert.deepEqual((await termRows(institution.id)).map((row) => row.nameKey).sort(), [
      'i. dönem',
      'ı. dönem',
    ])
  })

  test('DOM-YTK-063, 065: kurum ayarla açılınca güncel yıl dönemsiz ve etkin yazılır', async () => {
    const { institution, cookies } = await tenant('school', 2026)
    const current = await ok(await call('GET', '/academic-years/current', cookies.teacher))
    assert.equal(current.year.startYear, 2026)
    assert.equal(current.year.startDate, '2026-09-01')
    assert.equal(current.year.endDate, '2027-08-31')
    assert.equal(current.year.status, 'active')
    assert.equal(current.year.rowVersion, 1)
    assert.deepEqual(current.year.terms, [])
    assert.equal(await settingsYear(institution.id), 2026)
    // Yönetici dönemleri sonradan ekler.
    const withTerm = await ok(
      await call('POST', '/academic-years/2026/terms', cookies.admin, TERMS[0], match(1)),
      201,
    )
    assert.equal(withTerm.status, 'active')
  })

  test('/current yıl tanımlı değilse boş döner', async () => {
    const { cookies } = await tenant()
    const current = await ok(await call('GET', '/academic-years/current', cookies.student))
    assert.deepEqual(current, { date: '2026-10-06', year: null, term: null })
  })
})
