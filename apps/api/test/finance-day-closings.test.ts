import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { financeDayClosings } from '../src/db/schema/finance-day-closings.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type InstitutionOverrides,
} from './support/app.ts'

/**
 * Kasa ve gün sonu uçları (IST-113; docs/domain/finans.md DOM-FIN-036, DOM-FIN-052). Her test kendi
 * kurumunu kurar: s1 öğrencisi ve açık taksitler. Saat FIXED_NOW (2026-10-06 12:00 İstanbul); gün
 * değiştiren test saati kendisi ilerletir ve sonunda geri alır.
 */

const SEED = createSeed(FIXED_NOW)
const STUDENT = SEED.students.find((item) => item.classId === 'c1')
const INVOICES = [1, 2, 3, 4].map((installment) => ({
  id: `test-inv-${String(installment)}`,
  studentId: STUDENT?.id,
  installment,
  amount: 100_000,
  dueDate: `2026-1${String(installment - 1)}-15T09:00:00.000Z`,
  paidAt: null,
  method: null,
  reminderAt: null,
}))
const TODAY = '2026-10-06'
const YESTERDAY = '2026-10-05'
const REASON = { reason: 'Sayım yanlış girildi' }

describe('kasa ve gün sonu uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  let now = FIXED_NOW
  const logs: string[] = []
  const key = () => ({ 'idempotency-key': `test-day-${String(++serial).padStart(5, '0')}` })
  const ifMatch = (version: number) => ({ 'if-match': `"${String(version)}"` })

  before(async () => {
    assert.ok(STUDENT)
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => now, logs })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function send(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    cookie: string | null,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url,
      headers: {
        origin: TEST_ORIGIN,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie === null ? {} : { cookie }),
        ...headers,
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    })
  }
  function assertError(
    response: Awaited<ReturnType<typeof send>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}, cash = true) {
    const created = await createInstitution(app, overrides)
    const row = (collection: 'classes' | 'students' | 'invoices', data: { id: string }) => ({
      collection,
      id: data.id,
      data: { ...data },
    })
    await insertMissingRecords(
      db,
      created.id,
      [
        ...SEED.classes.filter((item) => item.id === 'c1').map((item) => row('classes', item)),
        ...(STUDENT ? [row('students', STUDENT)] : []),
        ...INVOICES.map((item) => row('invoices', item)),
      ],
      FIXED_NOW,
    )
    const adminCookie = await signInAs(app, created.admin)
    if (cash && overrides.enabledModules?.finance !== false) {
      const opened = await send(
        'PATCH',
        '/api/v1/payment-settings',
        adminCookie,
        { cashPaymentsEnabled: true },
        { ...ifMatch(1), ...key() },
      )
      assert.equal(opened.statusCode, 200, opened.body)
    }
    return { ...created, adminCookie }
  }
  async function member(institutionId: string, role: Role) {
    const links =
      role === 'ogrenci'
        ? [{ kind: 'student' as const, recordId: STUDENT?.id ?? '' }]
        : role === 'veli'
          ? [{ kind: 'child' as const, recordId: STUDENT?.id ?? '' }]
          : role === 'ogretmen'
            ? [{ kind: 'teacher' as const, recordId: 't1' }]
            : []
    return signInAs(app, await createMember(app, institutionId, role, links))
  }

  const report = (cookie: string | null, date = TODAY) =>
    send('GET', `/api/v1/finance/day-closings/${date}`, cookie)
  const closeDay = (
    cookie: string | null,
    body: unknown,
    date = TODAY,
    headers: Record<string, string> = key(),
  ) => send('POST', `/api/v1/finance/day-closings/${date}/close`, cookie, body, headers)
  const reopen = (
    cookie: string | null,
    version: number,
    body: unknown = REASON,
    date = TODAY,
    headers: Record<string, string> = { ...ifMatch(version), ...key() },
  ) => send('POST', `/api/v1/finance/day-closings/${date}/reopen`, cookie, body, headers)
  const pay = (cookie: string, amountCents: number, extra: Record<string, unknown> = {}) =>
    send(
      'POST',
      '/api/v1/payments',
      cookie,
      { studentId: STUDENT?.id, amountCents, method: 'Nakit', ...extra },
      key(),
    )
  const payCard = (cookie: string, amountCents: number, extra: Record<string, unknown> = {}) =>
    pay(cookie, amountCents, {
      method: 'Kredi kartı',
      reference: `POS-${String(++serial)}`,
      ...extra,
    })
  const reverse = (cookie: string, id: string, version: number) =>
    send(
      'POST',
      `/api/v1/payments/${id}/reverse`,
      cookie,
      { reason: 'Yanlış öğrenciye girildi' },
      { ...ifMatch(version), ...key() },
    )
  /** Kapanış gövdesi: rapor damgası güncel rapordan okunur. */
  async function closeBody(
    cookie: string,
    extra: Record<string, unknown> = {},
    date = TODAY,
  ): Promise<Record<string, unknown>> {
    const read = await report(cookie, date)
    assert.equal(read.statusCode, 200, read.body)
    return { reportStamp: read.json().data.reportStamp, ...extra }
  }
  const closingRows = (institutionId: string) =>
    db.select().from(financeDayClosings).where(eq(financeDayClosings.institutionId, institutionId))
  const actions = async (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  // --- Kimlik, rol, modül, kurum -----------------------------------------------------------------

  test('DOM-FIN-052: oturumsuz 401; veli, öğrenci ve öğretmen 403; yeniden açma ön büroya kapalı', async () => {
    const a = await institution()
    assertError(await report(null), 401)
    assertError(await closeDay(null, { reportStamp: '0:0:0' }), 401)
    assertError(await reopen(null, 1), 401)
    for (const role of ['veli', 'ogrenci', 'ogretmen'] as const) {
      const cookie = await member(a.id, role)
      assertError(await report(cookie), 403, 'forbidden')
      assertError(await closeDay(cookie, { reportStamp: '0:0:0' }), 403, 'forbidden')
      assertError(await reopen(cookie, 1), 403, 'forbidden')
    }
    const desk = await member(a.id, 'onburo')
    const closed = await closeDay(desk, await closeBody(desk, { countedCashCents: 0 }))
    assert.equal(closed.statusCode, 201, closed.body)
    assertError(await reopen(desk, 1), 403, 'forbidden')
    assert.equal((await closingRows(a.id))[0]?.reopenedAt, null)
  })

  test('DOM-YTK-040: finance modülü kapalıyken gün sonu uçları 403 module_disabled', async () => {
    const a = await institution({ enabledModules: { finance: false } })
    assertError(await report(a.adminCookie), 403, 'module_disabled')
    assertError(await closeDay(a.adminCookie, { reportStamp: '0:0:0' }), 403, 'module_disabled')
    assertError(await reopen(a.adminCookie, 1), 403, 'module_disabled')
    assert.equal((await closingRows(a.id)).length, 0)
  })

  test('DOM-YTK-001: başka kurumun gün sonu görünmez; yeniden açma 404, kapanış ve B değişmez', async () => {
    const a = await institution()
    const b = await institution()
    assert.equal((await pay(b.adminCookie, 30_000)).statusCode, 201)
    const closedB = await closeDay(
      b.adminCookie,
      await closeBody(b.adminCookie, { countedCashCents: 30_000 }),
    )
    assert.equal(closedB.statusCode, 201, closedB.body)
    const seen = (await report(a.adminCookie)).json().data
    assert.equal(seen.status, 'open')
    assert.equal(seen.summary.collectedCount, 0)
    assert.deepEqual(seen.collected, [])
    assert.equal(seen.closing, null)
    assert.equal(seen.suggestedOpeningCents, null)
    assertError(await reopen(a.adminCookie, 1), 404)
    const [row] = await closingRows(b.id)
    assert.equal(row?.reopenedAt, null)
    assert.equal(row?.version, 1)
    // A kendi gününü kapatır; B'nin kapanışı A'yı engellemez, gövdedeki kurum kimliği reddedilir.
    assertError(await closeDay(a.adminCookie, { reportStamp: '0:0:0', institutionId: b.id }), 400)
    assertError(await closeDay(a.adminCookie, await closeBody(a.adminCookie, {})), 422)
    const closedA = await closeDay(
      a.adminCookie,
      await closeBody(a.adminCookie, { countedCashCents: 0 }),
    )
    assert.equal(closedA.statusCode, 201, closedA.body)
    assert.equal((await closingRows(b.id)).length, 1)
  })

  // --- Rapor -------------------------------------------------------------------------------------

  test('IST-113, DOM-FIN-036: rapor yöntem bazında özet, satırlar ve iptal; ileri gün 422', async () => {
    const a = await institution()
    const cash = await pay(a.adminCookie, 30_000)
    assert.equal(cash.statusCode, 201, cash.body)
    assert.equal((await payCard(a.adminCookie, 20_000)).statusCode, 201)
    const { id, version } = cash.json().data
    assert.equal((await reverse(a.adminCookie, id, version)).statusCode, 200)
    const desk = await member(a.id, 'onburo')
    const read = await report(desk)
    assert.equal(read.statusCode, 200, read.body)
    const data = read.json().data
    assert.equal(data.status, 'open')
    assert.equal(data.summary.collectedCount, 2)
    assert.equal(data.summary.collectedCents, 50_000)
    assert.equal(data.summary.reversedCents, 30_000)
    assert.equal(data.summary.netCents, 20_000)
    const by = (method: string) =>
      data.summary.methods.find((item: { method: string }) => item.method === method)
    assert.equal(by('Nakit').netCents, 0)
    assert.equal(by('Kredi kartı').netCents, 20_000)
    assert.equal(by('Senet').collectedCount, 0)
    assert.equal(data.collected.length, 2)
    assert.equal(data.collected[0].studentName, STUDENT?.name)
    assert.equal(data.collected[0].reversedAt, null, 'tahsilat satırı iptali göstermez')
    assert.equal(data.reversed.length, 1)
    assert.equal(data.reversed[0].reversalReason, 'Yanlış öğrenciye girildi')
    assert.equal(data.cashNetCents, 0)
    assert.equal(data.cashCountRequired, true)
    assertError(await report(desk, '2026-10-07'), 422, 'finance_day_in_future')
    assertError(await report(desk, '2026-13-40'), 400)
  })

  // --- Kapatma -----------------------------------------------------------------------------------

  test('IST-113, DOM-FIN-036: ön büro kapatır; kim, ne zaman, kasa farkı ve denetim kaydı', async () => {
    const a = await institution()
    assert.equal((await pay(a.adminCookie, 30_000)).statusCode, 201)
    assert.equal((await payCard(a.adminCookie, 20_000)).statusCode, 201)
    const desk = await member(a.id, 'onburo')
    const closed = await closeDay(
      desk,
      await closeBody(desk, {
        openingCashCents: 5_000,
        countedCashCents: 34_000,
        note: 'Bozuk para eksik çıktı',
      }),
    )
    assert.equal(closed.statusCode, 201, closed.body)
    const data = closed.json().data
    assert.equal(data.closedAt, FIXED_NOW.toISOString())
    assert.ok(data.closedByName)
    assert.deepEqual(data.cash, {
      openingCents: 5_000,
      countedCents: 34_000,
      expectedCents: 35_000,
      differenceCents: -1_000,
    })
    assert.equal(data.summary.netCents, 50_000)
    const read = (await report(a.adminCookie)).json().data
    assert.equal(read.status, 'closed')
    assert.equal(read.closing.id, data.id)
    assert.equal(read.closing.note, 'Bozuk para eksik çıktı')
    const [audit] = await actions(a.id, 'finance_day.close')
    assert.equal(audit?.entityId, data.id)
    assert.deepEqual(audit?.changes, { fields: ['closingDate', 'summary', 'cash', 'note'] })
    assert.ok(!logs.some((line) => line.includes('Bozuk para')), 'açıklama loglanmaz (DOM-FIN-036)')
  })

  test('DOM-FIN-031, DOM-FIN-036: aynı anahtarla tekrar ikinci kapanış açmaz, kapalı gün 409', async () => {
    const a = await institution()
    const headers = key()
    const body = await closeBody(a.adminCookie, { countedCashCents: 0 })
    const first = await closeDay(a.adminCookie, body, TODAY, headers)
    assert.equal(first.statusCode, 201, first.body)
    const again = await closeDay(a.adminCookie, body, TODAY, headers)
    assert.equal(again.statusCode, 201)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assert.equal(again.json().data.id, first.json().data.id)
    assertError(await closeDay(a.adminCookie, body), 409, 'finance_day_already_closed')
    assert.equal((await closingRows(a.id)).length, 1)
    assert.equal((await actions(a.id, 'finance_day.close')).length, 1)
  })

  test('DOM-FIN-036: geçersiz kapanış kayıt açmaz: damga, sayım, açıklama, ileri gün, If-Match, anahtar', async () => {
    const a = await institution()
    assert.equal((await pay(a.adminCookie, 30_000)).statusCode, 201)
    const body = await closeBody(a.adminCookie)
    assertError(await closeDay(a.adminCookie, {}), 400)
    assertError(
      await closeDay(a.adminCookie, { reportStamp: '9:9:9', countedCashCents: 30_000 }),
      409,
      'finance_day_report_changed',
    )
    assertError(await closeDay(a.adminCookie, body), 422, 'cash_count_required')
    assertError(
      await closeDay(a.adminCookie, { ...body, countedCashCents: 29_000 }),
      422,
      'cash_difference_note_required',
    )
    assertError(
      await closeDay(a.adminCookie, { ...body, countedCashCents: 0 }, '2026-10-07'),
      422,
      'finance_day_in_future',
    )
    assertError(
      await closeDay(a.adminCookie, { ...body, countedCashCents: 30_000 }, TODAY, {
        ...key(),
        ...ifMatch(1),
      }),
      400,
      'if_match_not_supported',
    )
    assertError(
      await closeDay(a.adminCookie, { ...body, countedCashCents: 30_000 }, TODAY, {}),
      400,
    )
    assert.equal((await closingRows(a.id)).length, 0)
    assert.equal((await actions(a.id, 'finance_day.close')).length, 0)
  })

  test('DOM-FIN-032, DOM-FIN-036: nakit kapalı ve hareketsiz günde sayımsız kapanır', async () => {
    const a = await institution({}, false)
    assert.equal((await payCard(a.adminCookie, 20_000)).statusCode, 201)
    const read = (await report(a.adminCookie)).json().data
    assert.equal(read.cashCountRequired, false)
    const closed = await closeDay(a.adminCookie, { reportStamp: read.reportStamp })
    assert.equal(closed.statusCode, 201, closed.body)
    assert.equal(closed.json().data.cash, null)
  })

  test('DOM-FIN-036: önceki kapanışın sayımı açılış önerisidir; farklı açılış açıklama ister', async () => {
    const a = await institution()
    assert.equal((await pay(a.adminCookie, 7_000)).statusCode, 201)
    const closed = await closeDay(
      a.adminCookie,
      await closeBody(a.adminCookie, { countedCashCents: 7_000 }),
    )
    assert.equal(closed.statusCode, 201, closed.body)
    now = new Date('2026-10-07T09:00:00.000Z')
    try {
      const next = (await report(a.adminCookie, '2026-10-07')).json().data
      assert.equal(next.suggestedOpeningCents, 7_000)
      assertError(
        await closeDay(
          a.adminCookie,
          { reportStamp: next.reportStamp, openingCashCents: 0, countedCashCents: 0 },
          '2026-10-07',
        ),
        422,
        'opening_cash_note_required',
      )
      const done = await closeDay(
        a.adminCookie,
        {
          reportStamp: next.reportStamp,
          openingCashCents: 0,
          countedCashCents: 0,
          note: 'Kasa bankaya yatırıldı',
        },
        '2026-10-07',
      )
      assert.equal(done.statusCode, 201, done.body)
      assert.equal(done.json().data.cash.differenceCents, 0)
    } finally {
      now = FIXED_NOW
    }
  })

  // --- Kapatılmış gün değişmez -------------------------------------------------------------------

  test('IST-113: kapatılmış güne tahsilat girilemez; bugün ve geçmiş gün için 422, kayıt açılmaz', async () => {
    const a = await institution()
    const closedToday = await closeDay(
      a.adminCookie,
      await closeBody(a.adminCookie, { countedCashCents: 0 }),
    )
    assert.equal(closedToday.statusCode, 201, closedToday.body)
    const denied = await pay(a.adminCookie, 1_000)
    assertError(denied, 422, 'finance_day_closed')
    assert.deepEqual(denied.json().issues[0].path, ['paidDate'])
    const closedPast = await closeDay(
      a.adminCookie,
      await closeBody(a.adminCookie, { countedCashCents: 0 }, YESTERDAY),
      YESTERDAY,
    )
    assert.equal(closedPast.statusCode, 201, closedPast.body)
    assertError(await pay(a.adminCookie, 1_000, { paidDate: YESTERDAY }), 422, 'finance_day_closed')
    const list = await send('GET', '/api/v1/payments', a.adminCookie)
    assert.equal(list.json().meta.total, 0)
    // Kapatılmamış geçmiş güne tahsilat serbesttir.
    const open = await pay(a.adminCookie, 1_000, { paidDate: '2026-10-01' })
    assert.equal(open.statusCode, 201, open.body)
  })

  test('IST-113, DOM-FIN-033: düzeltme kaydı istisnadır: dünün tahsilatı bugün iptal edilir, kapatılmış gün değişmez', async () => {
    const a = await institution()
    const paid = await pay(a.adminCookie, 30_000, { paidDate: YESTERDAY })
    assert.equal(paid.statusCode, 201, paid.body)
    const closed = await closeDay(
      a.adminCookie,
      await closeBody(a.adminCookie, { countedCashCents: 30_000 }, YESTERDAY),
      YESTERDAY,
    )
    assert.equal(closed.statusCode, 201, closed.body)
    const before = (await report(a.adminCookie, YESTERDAY)).json().data

    const { id, version } = paid.json().data
    const reversed = await reverse(a.adminCookie, id, version)
    assert.equal(reversed.statusCode, 200, reversed.body)

    const after = (await report(a.adminCookie, YESTERDAY)).json().data
    assert.deepEqual(after.summary, before.summary, 'kapatılmış özet aynı')
    assert.deepEqual(after.collected, before.collected, 'kapatılmış günün satırları aynı')
    assert.equal(after.reversed.length, 0)
    const today = (await report(a.adminCookie)).json().data
    assert.equal(today.summary.reversedCents, 30_000)
    assert.equal(today.summary.netCents, -30_000)
    assert.equal(today.cashNetCents, -30_000)
  })

  test('DOM-FIN-036: bugün kapalıyken iptal 422; tahsilat kaydı değişmez', async () => {
    const a = await institution()
    const paid = await pay(a.adminCookie, 30_000)
    assert.equal(paid.statusCode, 201, paid.body)
    const closed = await closeDay(
      a.adminCookie,
      await closeBody(a.adminCookie, { countedCashCents: 30_000 }),
    )
    assert.equal(closed.statusCode, 201, closed.body)
    const { id, version } = paid.json().data
    assertError(await reverse(a.adminCookie, id, version), 422, 'finance_day_closed')
    const read = await send('GET', `/api/v1/payments/${String(id)}`, a.adminCookie)
    assert.equal(read.json().data.reversedAt, null)
  })

  test('DOM-FIN-036: kapanış satırı değişmez; yalnız yeniden açma kolonları bir kez yazılır', async () => {
    const a = await institution()
    const closed = await closeDay(
      a.adminCookie,
      await closeBody(a.adminCookie, { countedCashCents: 0 }),
    )
    assert.equal(closed.statusCode, 201, closed.body)
    const id = closed.json().data.id as string
    const rejected = async (work: Promise<unknown>) =>
      assert.rejects(work, (error: { cause?: { code?: string }; code?: string }) => {
        assert.equal(error.cause?.code ?? error.code, '55000')
        return true
      })
    const where = and(eq(financeDayClosings.institutionId, a.id), eq(financeDayClosings.id, id))
    await rejected(
      db.update(financeDayClosings).set({ netCents: 1, collectedCents: 1 }).where(where),
    )
    await rejected(db.delete(financeDayClosings).where(where))
    await rejected(db.execute(sql`truncate finance_day_closings`))
    // Yeniden açarken özet de değiştirilemez.
    await rejected(
      db
        .update(financeDayClosings)
        .set({
          reopenedAt: FIXED_NOW,
          reopenedByUserId: 'u',
          reopenReason: 'gerekçe',
          note: 'değişti',
        })
        .where(where),
    )
    assert.equal((await closingRows(a.id))[0]?.reopenedAt, null)
  })

  // --- Yeniden açma ------------------------------------------------------------------------------

  test('DOM-FIN-036: yönetici gerekçeyle açar; eski kapanış kayıtta kalır, tahsilat girilir, yeni kapanış yeni kayıttır', async () => {
    const a = await institution()
    const closed = await closeDay(
      a.adminCookie,
      await closeBody(a.adminCookie, { countedCashCents: 0 }),
    )
    assert.equal(closed.statusCode, 201, closed.body)
    const { id, version } = closed.json().data
    assertError(await pay(a.adminCookie, 1_000), 422, 'finance_day_closed')

    const opened = await reopen(a.adminCookie, version)
    assert.equal(opened.statusCode, 200, opened.body)
    const data = opened.json().data
    assert.equal(data.id, id)
    assert.equal(data.reopenedAt, FIXED_NOW.toISOString())
    assert.equal(data.reopenReason, REASON.reason)
    assert.ok(data.reopenedByName)
    const [audit] = await actions(a.id, 'finance_day.reopen')
    assert.equal(audit?.entityId, id)
    assert.deepEqual(audit?.changes, { fields: ['reopenedAt', 'reopenReason'] })

    assert.equal((await pay(a.adminCookie, 1_000)).statusCode, 201)
    const open = (await report(a.adminCookie)).json().data
    assert.equal(open.status, 'open')
    assert.equal(open.summary.netCents, 1_000)
    assert.equal(open.history.length, 1)
    assert.equal(open.history[0].id, id)
    assert.equal(open.history[0].summary.netCents, 0, 'eski kapanışın özeti değişmez')

    const again = await closeDay(
      a.adminCookie,
      await closeBody(a.adminCookie, { countedCashCents: 1_000 }),
    )
    assert.equal(again.statusCode, 201, again.body)
    assert.notEqual(again.json().data.id, id)
    assert.equal((await closingRows(a.id)).length, 2)
    const final = (await report(a.adminCookie)).json().data
    assert.equal(final.status, 'closed')
    assert.equal(final.summary.netCents, 1_000)
    assert.equal(final.history.length, 1)
  })

  test('DOM-FIN-036: yeniden açma: gerekçe, If-Match, sürüm, kapanışsız ve açık gün; kayıt değişmez', async () => {
    const a = await institution()
    assertError(await reopen(a.adminCookie, 1), 404)
    const closed = await closeDay(
      a.adminCookie,
      await closeBody(a.adminCookie, { countedCashCents: 0 }),
    )
    assert.equal(closed.statusCode, 201, closed.body)
    assertError(await reopen(a.adminCookie, 1, { reason: 'kısa' }), 400)
    assertError(await reopen(a.adminCookie, 1, REASON, TODAY, key()), 400, 'if_match_required')
    assertError(await reopen(a.adminCookie, 9), 409, 'version_conflict')
    assert.equal((await closingRows(a.id))[0]?.reopenedAt, null)
    const headers = { ...ifMatch(1), ...key() }
    assert.equal((await reopen(a.adminCookie, 1, REASON, TODAY, headers)).statusCode, 200)
    const replay = await reopen(a.adminCookie, 1, REASON, TODAY, headers)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((await actions(a.id, 'finance_day.reopen')).length, 1)
    assertError(await reopen(a.adminCookie, 2), 409, 'finance_day_not_closed')
  })
})
