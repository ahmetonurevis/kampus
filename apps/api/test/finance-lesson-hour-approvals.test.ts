import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { approvedLessonHoursFor } from '../src/db/finance-lesson-hour-approvals.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  lessonHourApprovals,
  lessonHourConfirmations,
} from '../src/db/schema/finance-lesson-hour-approvals.ts'
import { payrollLessonHours } from '../src/db/schema/finance-payroll-exports.ts'
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
 * Ek ders çizelgesi onayı uçları (DOM-FIN-120; ON-196; K-409…K-411; dönem onayı engeli K-424,
 * ON-348). Her test kendi kurumunu kurar; saat bordro aktarımı ucuyla (DOM-FIN-105), dönem kilidi
 * bordro dönemi uçlarıyla (DOM-FIN-108) yazılır. FIXED_NOW 2026-10-06: Ekim cari ay.
 */

const FINANCE = '/api/v1/finance'
const HOURS = `${FINANCE}/payroll-lesson-hours`
const SHEETS = `${FINANCE}/lesson-hour-sheets`
const PREVIEW = `${FINANCE}/payroll-exports/preview`
const RATES = `${FINANCE}/pay-rates`
const PERIODS = `${FINANCE}/payroll-periods`
const MONTH = '2026-10'
const SHEET = `${SHEETS}/${MONTH}`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-120: ek ders çizelgesi onayı uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.96.0.1'

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
    clientIp = `10.96.${String((tenantCount += 1))}.1`
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

  /** Selin (ek ders ücreti tanımlı) ve Ece (öğretmen); Ekim'de ikisine ek ders saati. */
  async function staffed() {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const ece = await person(t, 'ogretmen', 'Ece Yılmaz')
    ok(
      await call('POST', RATES, t.admin, {
        component: 'lesson',
        membershipId: selin,
        rateType: 'extra',
        amountCents: 35_000,
        startDate: '2026-09-01',
      }),
      201,
    )
    const selinEntry = ok(
      await call('POST', HOURS, t.admin, {
        membershipId: selin,
        month: MONTH,
        lessonType: 'extra',
        hours: 12,
      }),
      201,
    )
    const eceEntry = ok(
      await call('POST', HOURS, t.admin, {
        membershipId: ece,
        month: MONTH,
        lessonType: 'duty',
        hours: 4,
      }),
      201,
    )
    return { ...t, selin, ece, selinEntry, eceEntry }
  }
  type Staffed = Awaited<ReturnType<typeof staffed>>

  const sheetOf = (cookie: string | null, month = MONTH) =>
    call('GET', `${SHEETS}/${month}`, cookie)
  const submit = (cookie: string, month = MONTH) =>
    call('POST', `${SHEETS}/${month}/submit`, cookie, {}, key())
  const respond = (cookie: string, body: Json, month = MONTH) =>
    call('POST', `${SHEETS}/${month}/confirmations`, cookie, body, key())
  const confirm = (cookie: string, membershipId: string, channel = 'phone') =>
    respond(cookie, { membershipId, outcome: 'confirmed', channel })
  const approve = (cookie: string, entriesHash: unknown, month = MONTH) =>
    call('POST', `${SHEETS}/${month}/approve`, cookie, { entriesHash }, key())
  const reopen = (cookie: string, reason = 'Saat yanlış girildi', month = MONTH) =>
    call('POST', `${SHEETS}/${month}/reopen`, cookie, { reason }, key())
  const sheetRows = (institutionId: string) =>
    db
      .select()
      .from(lessonHourApprovals)
      .where(eq(lessonHourApprovals.institutionId, institutionId))
  const confirmationRows = (institutionId: string) =>
    db
      .select()
      .from(lessonHourConfirmations)
      .where(eq(lessonHourConfirmations.institutionId, institutionId))
  const auditOf = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  const stateOf = (sheet: Json, membershipId: string) =>
    (sheet.staff as Json[]).find((item) => item.membershipId === membershipId)?.state

  /** Gönder, ikisini teyit et, onayla. */
  async function approved(t: Staffed) {
    ok(await submit(t.admin))
    ok(await confirm(t.admin, t.selin))
    const sheet = ok(await confirm(t.admin, t.ece))
    return ok(await approve(t.admin, sheet.entriesHash))
  }

  test('kimliksiz istek 401', async () => {
    assertError(await sheetOf(null), 401)
    assertError(await call('POST', `${SHEET}/submit`, null, {}, key()), 401)
    assertError(
      await call(
        'POST',
        `${SHEET}/confirmations`,
        null,
        { membershipId: 'm', outcome: 'confirmed', channel: 'phone' },
        key(),
      ),
      401,
    )
    assertError(await call('POST', `${SHEET}/approve`, null, { entriesHash: 'a' }, key()), 401)
    assertError(await call('POST', `${SHEET}/reopen`, null, { reason: 'Gerekçe' }, key()), 401)
  })

  test('DOM-FIN-120: öğretmen, veli ve öğrenci 403; ön büro onaylayamaz ve yeniden açamaz (K-409)', async () => {
    const t = await staffed()
    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await sheetOf(cookie), 403)
      assertError(await submit(cookie), 403)
      assertError(await confirm(cookie, t.selin), 403)
      assertError(await approve(cookie, 'a'.repeat(64)), 403)
      assertError(await reopen(cookie), 403)
    }
    const desk = await member(t.id, 'onburo')
    ok(await submit(desk))
    ok(await confirm(desk, t.selin))
    const sheet = ok(await confirm(desk, t.ece))
    assertError(await approve(desk, sheet.entriesHash), 403)
    assertError(await reopen(desk), 403)
    const [row] = await sheetRows(t.id)
    assert.equal(row?.status, 'teacher_review')
    assert.equal(row?.approvalCount, 0)
  })

  test('DOM-FIN-120: finance modülü kapalıyken çizelge uçları 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await sheetOf(closed.admin), 403, 'module_disabled')
    assertError(await submit(closed.admin), 403, 'module_disabled')
    assertError(await approve(closed.admin, 'a'.repeat(64)), 403, 'module_disabled')
    assertError(await reopen(closed.admin), 403, 'module_disabled')
  })

  test('DOM-FIN-120: taslak → öğretmen kontrolü → teyit → müdür onayı; onaylı ay kilitli, aktarım tutarlı (K-409…K-411)', async () => {
    const t = await staffed()
    const draft = ok(await sheetOf(t.admin))
    assert.equal(draft.status, 'draft')
    assert.equal(draft.version, null)
    assert.equal(draft.payrollLocked, false)
    assert.match(String(draft.entriesHash), /^[0-9a-f]{64}$/)
    assert.deepEqual(
      (draft.staff as Json[]).map((item) => [item.staffName, item.state, item.totalHours]),
      [
        ['Ece Yılmaz', 'pending', 4],
        ['Selin Kaya', 'pending', 12],
      ],
    )
    assert.equal((draft.entries as Json[]).length, 2)
    // Onaysız ayın ek ders satırı "onay bekliyor", tutarsız (K-411).
    const pending = ok(await call('GET', `${PREVIEW}?month=${MONTH}`, t.admin))
    const selinLine = (pending.lines as Json[]).find((line) => line.membershipId === t.selin)
    assert.equal(selinLine?.totalCents, null)
    assert.deepEqual(selinLine?.warnings, ['lesson_hours_pending'])
    assert.equal((pending.totals as Json).earningCents, 0)
    // Teyit yalnız kontrolde.
    assertError(await confirm(t.admin, t.selin), 409, 'lesson_sheet_not_in_review')

    const sent = ok(await submit(t.admin))
    assert.equal(sent.status, 'teacher_review')
    assert.equal(sent.submittedByName, 'Test Yönetici')
    assertError(await submit(t.admin), 409, 'lesson_sheet_not_draft')
    const first = ok(await confirm(t.admin, t.selin, 'signed_sheet'))
    assert.equal(stateOf(first, t.selin), 'confirmed')
    assert.equal(stateOf(first, t.ece), 'pending')
    assertError(await approve(t.admin, first.entriesHash), 422, 'lesson_sheet_unconfirmed')
    // Kontrol sırasında düzeltme Selin'in teyidini geçersiz kılar.
    ok(
      await call(
        'PATCH',
        `${HOURS}/${String(t.selinEntry.id)}`,
        t.admin,
        { hours: 10 },
        ifMatch(1),
      ),
    )
    const changed = ok(await confirm(t.admin, t.ece))
    assert.equal(stateOf(changed, t.selin), 'pending')
    const selinStaff = (changed.staff as Json[]).find((item) => item.membershipId === t.selin)
    assert.equal((selinStaff?.lastResponse as Json).current, false)
    assert.equal((selinStaff?.lastResponse as Json).channel, 'signed_sheet')
    assertError(await approve(t.admin, changed.entriesHash), 422, 'lesson_sheet_unconfirmed')
    const ready = ok(await confirm(t.admin, t.selin))
    assert.equal(stateOf(ready, t.selin), 'confirmed')
    // Onaylayanın gördüğü damga eskiyse 409.
    assertError(await approve(t.admin, first.entriesHash), 409, 'lesson_hours_changed')

    const done = ok(await approve(t.admin, ready.entriesHash))
    assert.equal(done.status, 'approved')
    assert.equal(done.approvalCount, 1)
    assert.equal(done.approvedByName, 'Test Yönetici')
    assertError(await approve(t.admin, ready.entriesHash), 409, 'lesson_sheet_not_in_review')
    // Kilit: saat yazılamaz (K-410).
    assertError(
      await call('POST', HOURS, t.admin, {
        membershipId: t.selin,
        month: MONTH,
        lessonType: 'duty',
        hours: 2,
      }),
      409,
      'lesson_hours_locked',
    )
    assertError(
      await call(
        'PATCH',
        `${HOURS}/${String(t.selinEntry.id)}`,
        t.admin,
        { hours: 11 },
        ifMatch(2),
      ),
      409,
      'lesson_hours_locked',
    )
    assertError(
      await call('DELETE', `${HOURS}/${String(t.eceEntry.id)}`, t.admin, undefined, ifMatch(1)),
      409,
      'lesson_hours_locked',
    )
    const rows = await db
      .select()
      .from(payrollLessonHours)
      .where(eq(payrollLessonHours.institutionId, t.id))
    assert.deepEqual(rows.map((row) => [row.hours, row.version, row.archivedAt]).sort(), [
      [10, 2, null],
      [4, 1, null],
    ])
    // Onaylı ayın ek dersi tutarıyla (K-411).
    const paid = ok(await call('GET', `${PREVIEW}?month=${MONTH}`, t.admin))
    const paidLine = (paid.lines as Json[]).find((line) => line.membershipId === t.selin)
    assert.equal(paidLine?.totalCents, 350_000)
    assert.deepEqual(paidLine?.warnings, [])

    // Yeniden açma (K-410): gerekçe zorunlu; taslağa döner, saat yazılır.
    assertError(await reopen(t.admin, 'kısa'), 400)
    const opened = ok(await reopen(t.admin, 'Ece nöbeti eksik'))
    assert.equal(opened.status, 'draft')
    assert.equal(opened.reopenReason, 'Ece nöbeti eksik')
    assert.equal(opened.reopenedByName, 'Test Yönetici')
    assertError(await reopen(t.admin), 409, 'lesson_sheet_not_approved')
    ok(await call('PATCH', `${HOURS}/${String(t.eceEntry.id)}`, t.admin, { hours: 6 }, ifMatch(1)))
    // Yeniden onay: Selin'in teyidi hâlâ günceldir, Ece'ninki yenilenir; sayaç artar.
    const again = ok(await submit(t.admin))
    assert.equal(stateOf(again, t.selin), 'confirmed')
    assert.equal(stateOf(again, t.ece), 'pending')
    const reconfirmed = ok(await confirm(t.admin, t.ece, 'email'))
    const second = ok(await approve(t.admin, reconfirmed.entriesHash))
    assert.equal(second.approvalCount, 2)

    const actions = [
      'finance.lesson_hour_sheet.submit',
      'finance.lesson_hour_sheet.confirmation',
      'finance.lesson_hour_sheet.approve',
      'finance.lesson_hour_sheet.reopen',
    ]
    assert.deepEqual(
      await Promise.all(actions.map(async (action) => (await auditOf(t.id, action)).length)),
      [2, 4, 2, 1],
    )
    const [reopenAudit] = await auditOf(t.id, 'finance.lesson_hour_sheet.reopen')
    assert.deepEqual(reopenAudit?.changes, {
      fields: ['status', 'reopenedAt', 'reopenReason'],
    })
    // Yanıt satırı değişmez.
    const [response] = await confirmationRows(t.id)
    await assert.rejects(
      db.execute(
        sql`update lesson_hour_confirmations set channel = 'email' where id = ${response!.id}`,
      ),
    )
    await assert.rejects(
      db.execute(sql`delete from lesson_hour_confirmations where id = ${response!.id}`),
    )
  })

  test('DOM-FIN-120: itiraz gerekçeyle çizelgeyi taslağa döndürür; düzeltip yeniden gönderilir (K-409)', async () => {
    const t = await staffed()
    ok(await submit(t.admin))
    assertError(
      await respond(t.admin, { membershipId: t.ece, outcome: 'disputed', channel: 'phone' }),
      400,
    )
    const disputed = ok(
      await respond(t.admin, {
        membershipId: t.ece,
        outcome: 'disputed',
        channel: 'message',
        reason: 'Nöbet 6 saat olmalı',
      }),
    )
    assert.equal(disputed.status, 'draft')
    assert.equal(stateOf(disputed, t.ece), 'disputed')
    const ece = (disputed.staff as Json[]).find((item) => item.membershipId === t.ece)
    assert.deepEqual(
      [
        (ece?.lastResponse as Json).outcome,
        (ece?.lastResponse as Json).reason,
        (ece?.lastResponse as Json).recordedByName,
      ],
      ['disputed', 'Nöbet 6 saat olmalı', 'Test Yönetici'],
    )
    assertError(await confirm(t.admin, t.ece), 409, 'lesson_sheet_not_in_review')
    ok(await call('PATCH', `${HOURS}/${String(t.eceEntry.id)}`, t.admin, { hours: 6 }, ifMatch(1)))
    const resent = ok(await submit(t.admin))
    assert.equal(resent.status, 'teacher_review')
    assert.equal(stateOf(resent, t.ece), 'pending')
    const [audit] = await auditOf(t.id, 'finance.lesson_hour_sheet.confirmation')
    assert.deepEqual(audit?.changes, {
      fields: ['membershipId', 'outcome', 'channel', 'reason', 'status'],
    })
    const [stored] = await confirmationRows(t.id)
    assert.equal(stored?.reason, 'Nöbet 6 saat olmalı')
    assert.match(stored?.entriesHash ?? '', /^[0-9a-f]{64}$/)
  })

  test('DOM-FIN-120: geçersiz istek 400/422, kayıt yazılmaz; Idempotency-Key zorunlu ve tekrarı tek kayıt', async () => {
    const t = await staffed()
    const empty = await institution()
    assertError(await submit(empty.admin), 422, 'lesson_sheet_empty')
    assert.equal((await sheetRows(empty.id)).length, 0)
    assertError(await call('POST', `${SHEET}/submit`, t.admin, {}), 400)
    assertError(await call('POST', `${SHEETS}/2026-13/submit`, t.admin, {}, key()), 400)
    assertError(await call('POST', `${SHEET}/submit`, t.admin, { note: 'x' }, key()), 400)
    assertError(await sheetOf(t.admin, '2026-1'), 400)
    assert.equal((await sheetRows(t.id)).length, 0)
    const idem = key()
    const once = await call('POST', `${SHEET}/submit`, t.admin, {}, idem)
    const twice = await call('POST', `${SHEET}/submit`, t.admin, {}, idem)
    assert.equal(once.statusCode, 200, once.body)
    assert.equal(twice.statusCode, 200)
    assert.equal(twice.headers['idempotent-replayed'], 'true')
    assert.equal((await sheetRows(t.id)).length, 1)
    const outsider = await person(t, 'ogretmen', 'Saati Olmayan')
    assertError(await confirm(t.admin, outsider), 422, 'lesson_confirmation_no_hours')
    assertError(
      await respond(t.admin, {
        membershipId: t.selin,
        outcome: 'confirmed',
        channel: 'phone',
        reason: 'Gerekçe yazıldı',
      }),
      400,
    )
    assertError(await approve(t.admin, 'abc'), 400)
    assertError(
      await call(
        'POST',
        `${SHEET}/approve`,
        t.admin,
        { entriesHash: 'a'.repeat(64) },
        {
          ...key(),
          ...ifMatch(1),
        },
      ),
      400,
    )
    assert.equal((await confirmationRows(t.id)).length, 0)
    const [row] = await sheetRows(t.id)
    assert.equal(row?.status, 'teacher_review')
    assert.equal(row?.version, 1)
  })

  /** Ayın bordro dönemi onayı (DOM-FIN-108): listedeki güncel damgayla. */
  async function approvePeriod(t: Tenant) {
    const year = ok(await call('GET', `${PERIODS}?year=2026`, t.admin)) as {
      months: { month: string; current: { inputsHash: string } | null }[]
    }
    const current = year.months.find((item) => item.month === MONTH)?.current
    assert.ok(current)
    return call(
      'POST',
      `${PERIODS}/${MONTH}/approve`,
      t.admin,
      { inputsHash: current.inputsHash },
      key(),
    )
  }

  test('DOM-FIN-120, DOM-FIN-108: onay bekleyen ek ders saati varken bordro dönemi onaylanmaz (K-424)', async () => {
    const t = await staffed()
    // Taslak ve öğretmen kontrolündeki çizelge dönemi engeller.
    assertError(await approvePeriod(t), 409, 'payroll_lesson_hours_pending')
    ok(await submit(t.admin))
    ok(await confirm(t.admin, t.selin))
    const sheet = ok(await confirm(t.admin, t.ece))
    const blocked = await approvePeriod(t)
    assertError(blocked, 409, 'payroll_lesson_hours_pending')
    assert.match(blocked.json().message as string, /ek ders çizelgesi müdür onayı bekliyor/)
    assert.equal(ok(await sheetOf(t.admin)).payrollLocked, false)
    // Müdür onayından sonra dönem onaylanır.
    ok(await approve(t.admin, sheet.entriesHash))
    ok(await approvePeriod(t), 201)
    assert.equal(ok(await sheetOf(t.admin)).payrollLocked, true)
    // Saat kaydı olmayan ay serbesttir.
    ok(await approvePeriod(await institution()), 201)
  })

  test('DOM-FIN-120: kilitli bordro döneminde saat, müdür onayı ve yeniden açma 409 payroll_period_locked (K-410)', async () => {
    const t = await staffed()
    ok(await submit(t.admin))
    ok(await confirm(t.admin, t.selin))
    const sheet = ok(await confirm(t.admin, t.ece))
    ok(await approve(t.admin, sheet.entriesHash))
    ok(await approvePeriod(t), 201)
    // K-424 öncesinde onay bekleyen çizelgeyle kilitlenmiş dönem: çizelge öğretmen kontrolünde.
    await db
      .update(lessonHourApprovals)
      .set({ status: 'teacher_review' })
      .where(eq(lessonHourApprovals.institutionId, t.id))
    assert.equal(ok(await sheetOf(t.admin)).payrollLocked, true)
    assertError(
      await call('POST', HOURS, t.admin, {
        membershipId: t.selin,
        month: MONTH,
        lessonType: 'duty',
        hours: 2,
      }),
      409,
      'payroll_period_locked',
    )
    assertError(
      await call('PATCH', `${HOURS}/${String(t.selinEntry.id)}`, t.admin, { hours: 3 }, ifMatch(1)),
      409,
      'payroll_period_locked',
    )
    assertError(await approve(t.admin, sheet.entriesHash), 409, 'payroll_period_locked')
    const [row] = await sheetRows(t.id)
    assert.equal(row?.status, 'teacher_review')
    // Çizelge önce onaylanmışsa yeniden açılmaz.
    const other = await staffed()
    await approved(other)
    ok(await approvePeriod(other), 201)
    assertError(await reopen(other.admin), 409, 'payroll_period_locked')
    assert.equal((await sheetRows(other.id))[0]?.status, 'approved')
  })

  test('DOM-FIN-120: bordro hesabı yalnız onaylı ayın saatlerini okur (ON-198, K-411)', async () => {
    const t = await staffed()
    const before = await approvedLessonHoursFor(db, t.id, MONTH)
    assert.equal(before.status, 'draft')
    assert.deepEqual(before.entries, [])
    await approved(t)
    const after = await approvedLessonHoursFor(db, t.id, MONTH)
    assert.equal(after.status, 'approved')
    assert.deepEqual(after.entries.map((entry) => entry.hours).sort(), [12, 4])
    assert.deepEqual((await approvedLessonHoursFor(db, t.id, '2026-09')).entries, [])
  })

  test('DOM-FIN-120: başka kurumun çizelgesi ve personeli görünmez, işlenmez ve B değişmez', async () => {
    const a = await staffed()
    const b = await staffed()
    ok(await submit(b.admin))
    // A'nın çizelgesi B'nin saatlerini ve personelini taşımaz.
    const aSheet = ok(await sheetOf(a.admin))
    assert.equal(aSheet.status, 'draft')
    assert.equal(
      (aSheet.entries as Json[]).some((entry) => entry.membershipId === b.selin),
      false,
    )
    // A'nın gönderimi, yanıtı, onayı ve yeniden açması B'nin kaydına dokunmaz.
    ok(await submit(a.admin))
    assertError(await confirm(a.admin, b.selin), 422, 'lesson_confirmation_no_hours')
    assertError(
      await respond(a.admin, {
        membershipId: a.selin,
        outcome: 'confirmed',
        channel: 'phone',
        institutionId: b.id,
      }),
      400,
    )
    ok(await confirm(a.admin, a.selin))
    const ready = ok(await confirm(a.admin, a.ece))
    ok(await approve(a.admin, ready.entriesHash))
    ok(await reopen(a.admin, 'Kurum A yeniden açtı'))
    const [bRow] = await sheetRows(b.id)
    assert.equal(bRow?.status, 'teacher_review')
    assert.equal(bRow?.version, 1)
    assert.equal(bRow?.reopenReason, null)
    assert.equal((await confirmationRows(b.id)).length, 0)
    const bSheet = ok(await sheetOf(b.admin))
    assert.equal(bSheet.status, 'teacher_review')
    assert.equal(stateOf(bSheet, b.selin), 'pending')
  })
})
