import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertScholarshipAward } from '../src/db/finance-scholarships.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'

/** Burs programı uçları (DOM-FIN-025). Atama senaryoları `prospects.test.ts`'tedir. */

const PROGRAM = {
  academicYear: 2026,
  name: 'Başarı Bursu',
  conditions: 'Sınav puanı 90 ve üstü.',
  terminationConditions: 'Disiplin cezası alan öğrencinin bursu kesilir.',
  durationNote: 'Bir eğitim yılı',
  percentBasisPoints: 2500,
  capacity: 2,
}
const LIST = '/api/v1/finance/scholarship-programs'

describe('burs programı uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  const institution = async (overrides = {}) => {
    const created = await createInstitution(app, overrides)
    return { ...created, cookie: await signInAs(app, created.admin) }
  }
  const member = async (id: string, role: Role) =>
    signInAs(app, await createMember(app, id, role, []))
  const send = (url: string, cookie: string | null, body: unknown, version: number | null = null) =>
    app.inject({
      method: 'POST',
      url,
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        ...(cookie === null ? {} : { cookie }),
        ...(version === null ? {} : { 'if-match': `"${String(version)}"` }),
      },
      payload: JSON.stringify(body),
    })
  const get = (cookie: string | null, url: string) =>
    app.inject({
      method: 'GET',
      url,
      headers: { origin: TEST_ORIGIN, ...(cookie === null ? {} : { cookie }) },
    })
  function assertError(
    response: Awaited<ReturnType<typeof get>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  test('DOM-FIN-052: oturumsuz 401; yazma yalnız yönetici, okuma ön büroda da; diğer roller 403; modül kapalı 403', async () => {
    assertError(await get(null, LIST), 401)
    assertError(await send(LIST, null, PROGRAM), 401)
    const a = await institution()
    const desk = await member(a.id, 'onburo')
    assert.equal((await get(desk, LIST)).statusCode, 200)
    assertError(await send(LIST, desk, PROGRAM), 403, 'forbidden')
    for (const role of ['ogretmen', 'ogrenci', 'veli'] as const) {
      const cookie = await member(a.id, role)
      assertError(await get(cookie, LIST), 403, 'forbidden')
      assertError(await get(cookie, '/api/v1/finance/scholarship-awards'), 403, 'forbidden')
      assertError(await send(LIST, cookie, PROGRAM), 403, 'forbidden')
    }
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(closed.cookie, LIST), 403, 'module_disabled')
    assertError(await send(LIST, closed.cookie, PROGRAM), 403, 'module_disabled')
  })

  test('DOM-FIN-025: program açılır, bildirim günü bir kez işlenir; aynı ad, gelecek gün ve eski sürüm reddedilir; denetim kaydı yazılır', async () => {
    const a = await institution()
    const made = await send(LIST, a.cookie, PROGRAM)
    assert.equal(made.statusCode, 201, made.body)
    const { id, version, notifiedDate, awardedCount } = made.json().data
    assert.equal(notifiedDate, null)
    assert.equal(awardedCount, 0)
    assert.equal(made.headers.location, `${LIST}/${id as string}`)
    assertError(await send(LIST, a.cookie, PROGRAM), 409, 'scholarship_program_exists')
    for (const bad of [
      { ...PROGRAM, name: 'x' },
      { ...PROGRAM, amountCents: 1000 },
      { ...PROGRAM, capacity: 0 },
      { ...PROGRAM, institutionId: 'baska' },
    ])
      assertError(await send(LIST, a.cookie, bad), 400)
    const notify = `${LIST}/${id as string}/notify`
    assertError(
      await send(notify, a.cookie, { notifiedDate: '2026-09-01' }),
      400,
      'if_match_required',
    )
    assertError(
      await send(notify, a.cookie, { notifiedDate: '2026-12-01' }, version),
      422,
      'scholarship_date_future',
    )
    assertError(await send(notify, a.cookie, { notifiedDate: '2026-09-01' }, version + 5), 409)
    const done = await send(notify, a.cookie, { notifiedDate: '2026-09-01' }, version)
    assert.equal(done.statusCode, 200, done.body)
    assert.equal(done.json().data.notifiedDate, '2026-09-01')
    assertError(
      await send(notify, a.cookie, { notifiedDate: '2026-09-02' }, done.json().data.version),
      409,
      'scholarship_already_notified',
    )
    assertError(
      await send(
        `${LIST}/00000000-0000-4000-8000-00000000000a/notify`,
        a.cookie,
        { notifiedDate: '2026-09-01' },
        1,
      ),
      404,
    )
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'scholarship.notify')))
    assert.equal(audit.length, 1)
  })

  test('DOM-FIN-025: liste yıla göre süzülür ve sayfalanır; MEBBİS günü atamaya bir kez yazılır', async () => {
    const a = await institution()
    const made = await send(LIST, a.cookie, PROGRAM)
    await send(LIST, a.cookie, { ...PROGRAM, academicYear: 2027 })
    const filtered = await get(a.cookie, `${LIST}?academicYear=2027`)
    assert.equal(filtered.json().meta.total, 1)
    assert.equal(filtered.json().data[0].academicYear, 2027)
    assertError(await get(a.cookie, `${LIST}?bilinmeyen=1`), 400)
    const awardId = '00000000-0000-4000-8000-0000000000b1'
    await insertScholarshipAward(db, a.id, {
      id: awardId,
      programId: made.json().data.id,
      studentId: 's1',
      academicYear: 2026,
      amountCents: 1_000,
      awardedByUserId: 'u-test',
      now: FIXED_NOW,
    })
    const url = `/api/v1/finance/scholarship-awards/${awardId}/mebbis-record`
    assertError(await send(url, a.cookie, { recordedDate: '2026-09-01' }), 400, 'if_match_required')
    assertError(
      await send(url, await member(a.id, 'onburo'), { recordedDate: '2026-09-01' }, 1),
      403,
      'forbidden',
    )
    const done = await send(url, a.cookie, { recordedDate: '2026-09-01' }, 1)
    assert.equal(done.statusCode, 200, done.body)
    assert.equal(done.json().data.mebbisRecordedDate, '2026-09-01')
    assertError(
      await send(url, a.cookie, { recordedDate: '2026-09-02' }, 2),
      409,
      'scholarship_mebbis_recorded',
    )
    // Bir öğrenciye aynı yılda ikinci burs veritabanı düzeyinde de yazılamaz.
    await assert.rejects(
      insertScholarshipAward(db, a.id, {
        id: '00000000-0000-4000-8000-0000000000b2',
        programId: made.json().data.id,
        studentId: 's1',
        academicYear: 2026,
        amountCents: 1_000,
        awardedByUserId: 'u-test',
        now: FIXED_NOW,
      }),
    )
  })
})
