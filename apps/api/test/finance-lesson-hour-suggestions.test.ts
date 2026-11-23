import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { lessonHourSuggestions } from '../src/db/schema/finance-lesson-hour-suggestions.ts'
import { payrollLessonHours } from '../src/db/schema/finance-payroll-exports.ts'
import { schoolCalendarEvents } from '../src/db/schema/finance-school-calendar.ts'
import { ensureMember, ensureMembershipLinks } from '../src/services/identity.ts'
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
 * Programdan ek ders önerisi uçları (DOM-FIN-165; ON-195; K-550…K-552). Her test kendi kurumunu
 * kurar; ders programı, öğretmenler ve yoklama `records`'a yazılır. FIXED_NOW 2026-10-06; ay
 * Eylül 2026 (bitti). 7–11 Eylül haftası: Selin (t1, aylık) pazartesi 2, salı 2 ders; çarşamba
 * tatil; perşembe biri iptal, biri izin günü; cuma Ece'nin (t2, saat ücretli) dersine yedek.
 * Maaş karşılığı 2 saatle Selin'in önerisi 3 saattir.
 */

const FINANCE = '/api/v1/finance'
const BASE = `${FINANCE}/lesson-hour-suggestions`
const HOURS = `${FINANCE}/payroll-lesson-hours`
const SHEETS = `${FINANCE}/lesson-hour-sheets`
const RATES = `${FINANCE}/pay-rates`
const PROFILES = `${FINANCE}/leave-profiles`
const LEAVE_RECORDS = `${FINANCE}/leave-records`
const PERIODS = `${FINANCE}/payroll-periods`
const MONTH = '2026-09'
const PARAMS = '?weeklyLoad=2&weeklyCap=30'
const SUGGESTION = `${BASE}/${MONTH}${PARAMS}`
const TRANSFER = `${BASE}/${MONTH}/transfers`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

const at = (day: string, period: number) =>
  new Date(Date.parse(`${day}T06:00:00.000Z`) + period * 50 * 60_000).toISOString()
const lesson = (id: string, day: string, period: number, extra: Json = {}) => ({
  collection: 'schedule' as const,
  id,
  data: {
    id,
    classId: 'c1',
    teacherId: 't1',
    subjectId: 'mat',
    date: at(day, period),
    duration: 40,
    title: 'Matematik',
    room: '101',
    ...extra,
  },
})
const teacher = (id: string, name: string) => ({
  collection: 'teachers' as const,
  id,
  data: {
    id,
    name,
    subjectId: 'mat',
    branchId: 'b1',
    email: `${id}@ornek.test`,
    phone: '05550000000',
    isActive: true,
  },
})
const attendance = (id: string, classId: string, day: string) => ({
  collection: 'attendance' as const,
  id,
  data: { id, studentId: `s-${id}`, classId, date: day, status: 'present', reason: '' },
})
const SAMPLE = [
  teacher('t1', 'Selin Kaya'),
  teacher('t2', 'Ece Yılmaz'),
  teacher('t3', 'Murat Demir'),
  {
    collection: 'classes' as const,
    id: 'c1',
    data: { id: 'c1', name: '9-A', grade: 9, section: 'A' },
  },
  lesson('l-mon-1', '2026-09-07', 0),
  lesson('l-mon-2', '2026-09-07', 1),
  lesson('l-tue-1', '2026-09-08', 0),
  lesson('l-tue-2', '2026-09-08', 1),
  lesson('l-wed', '2026-09-09', 0),
  lesson('l-thu-cancel', '2026-09-10', 0, { cancelledAt: '2026-09-01T08:00:00.000Z' }),
  lesson('l-thu-leave', '2026-09-10', 1),
  lesson('l-fri-sub', '2026-09-11', 0, { originalTeacherId: 't2' }),
  lesson('l-ece', '2026-09-07', 2, { teacherId: 't2', classId: 'c2' }),
  lesson('l-murat', '2026-09-08', 3, { teacherId: 't3', classId: 'c3' }),
  attendance('a1', 'c1', '2026-09-07'),
]

describe('DOM-FIN-165: programdan ek ders önerisi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.195.0.1'
  // Aktarımlar yeniden eskiye sıralanır; aynı anda yazılanlar ayırt edilsin diye saat ilerletilir.
  let now = FIXED_NOW
  const tick = () => {
    now = new Date(now.getTime() + 60_000)
  }

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => now })
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
    clientIp = `10.195.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(db, created.id, SAMPLE, FIXED_NOW)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  async function person(t: Tenant, role: Role, name: string, teacherId?: string) {
    const user = await createUser(app, { name })
    const membership = await ensureMember(app.auth, db, {
      institutionId: t.id,
      userId: user.id,
      role,
    })
    if (teacherId !== undefined)
      await ensureMembershipLinks(db, t.id, membership.id, [
        { kind: 'teacher', recordId: teacherId },
      ])
    return membership.id
  }
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))

  /** Selin aylık, Ece saat ücretli; Selin 10 Eylül'de izinli; 9 Eylül kurum tatili. */
  async function staffed(overrides: Partial<InstitutionOverrides> = {}) {
    const t = await institution(overrides)
    const selin = await person(t, 'ogretmen', 'Selin Kaya', 't1')
    const ece = await person(t, 'ogretmen', 'Ece Yılmaz', 't2')
    for (const [membershipId, rateType] of [
      [selin, 'monthly_gross'],
      [ece, 'hourly'],
    ] as const)
      ok(
        await call('POST', RATES, t.admin, {
          component: 'wage',
          membershipId,
          rateType,
          amountCents: 4_500_000,
          startDate: '2026-01-01',
        }),
        201,
      )
    ok(
      await call('POST', PROFILES, t.admin, {
        membershipId: selin,
        seniorityStartDate: '2020-03-15',
      }),
      201,
    )
    ok(
      await call(
        'POST',
        LEAVE_RECORDS,
        t.admin,
        {
          membershipId: selin,
          typeCode: 'annual',
          startDate: '2026-09-10',
          endDate: '2026-09-10',
          days: 1,
        },
        key(),
      ),
      201,
    )
    await db.insert(schoolCalendarEvents).values({
      institutionId: t.id,
      id: randomUUID(),
      title: 'Okul kuruluş günü',
      kind: 'holiday',
      allDay: true,
      startDate: '2026-09-09',
      endDate: '2026-09-09',
      audienceKind: 'institution',
      status: 'published',
      publishedAt: FIXED_NOW,
      publishedByUserId: 'test-admin',
      createdByUserId: 'test-admin',
    })
    return { ...t, selin, ece }
  }

  const transferBody = (membershipId: string, extra: Json = {}) => ({
    weeklyLoad: 2,
    weeklyCap: 30,
    items: [{ membershipId, suggestedHours: 3, hours: 3, ...extra }],
  })
  const transfer = (t: Tenant, payload: unknown, headers: Record<string, string> = key()) =>
    call('POST', TRANSFER, t.admin, payload, headers)
  const hourRows = (institutionId: string) =>
    db.select().from(payrollLessonHours).where(eq(payrollLessonHours.institutionId, institutionId))
  const transferRows = (institutionId: string) =>
    db
      .select()
      .from(lessonHourSuggestions)
      .where(eq(lessonHourSuggestions.institutionId, institutionId))
  const teacherRow = (data: Json, membershipId: string) =>
    (data.teachers as Json[]).find((item) => item.membershipId === membershipId) ?? {}

  test('kimliksiz istek 401', async () => {
    assertError(await call('GET', SUGGESTION, null), 401)
    assertError(await call('GET', `${BASE}/${MONTH}/teachers/x`, null), 401)
    assertError(await call('POST', TRANSFER, null, transferBody('x'), key()), 401)
  })

  test('ön büro, öğretmen ve veli 403; modül kapalı 403; dil okulunda 404', async () => {
    const t = await staffed()
    for (const role of ['onburo', 'ogretmen', 'veli'] as const) {
      const cookie = await member(t.id, role)
      assertError(await call('GET', SUGGESTION, cookie), 403)
      assertError(await call('POST', TRANSFER, cookie, transferBody(t.selin), key()), 403)
    }
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await call('GET', SUGGESTION, closed.admin), 403)
    const language = await institution({ type: 'language_school' })
    assertError(await call('GET', SUGGESTION, language.admin), 404)
    assertError(await call('POST', TRANSFER, language.admin, transferBody('x'), key()), 404)
    assert.equal((await hourRows(t.id)).length, 0)
  })

  test('DOM-FIN-165 K-550 K-551: öneri, sayım özeti, hafta ve bağlı olmayan öğretmen', async () => {
    const t = await staffed()
    const data = ok(await call('GET', SUGGESTION, t.admin))
    assert.equal(data.weeklyLoad, 2)
    assert.equal(data.weeklyCap, 30)
    assert.equal(data.monthComplete, true)
    assert.equal(data.attendanceKnown, true)
    assert.equal(data.sheetStatus, 'draft')
    assert.equal(data.transferable, true)
    const selin = teacherRow(data, t.selin)
    assert.equal(selin.staffName, 'Selin Kaya')
    assert.equal(selin.payBasis, 'monthly')
    assert.equal(selin.suggestedHours, 3)
    assert.equal(selin.currentHours, null)
    assert.equal(selin.difference, -3)
    assert.deepEqual(selin.warnings, ['attendance_missing'])
    const totals = selin.totals as Json
    assert.deepEqual(
      [
        totals.countedHours,
        totals.ownHours,
        totals.substituteHours,
        totals.loadHours,
        totals.extraHours,
        totals.cancelledHours,
        totals.holidayHours,
        totals.leaveHours,
      ],
      [5, 4, 1, 2, 3, 1, 1, 1],
    )
    assert.deepEqual(
      (selin.weeks as Json[]).map((week) => [week.startDate, week.extraInMonth]),
      [['2026-09-07', 3]],
    )
    const ece = teacherRow(data, t.ece)
    assert.equal(ece.payBasis, 'hourly')
    assert.equal(ece.applicable, false)
    assert.equal(ece.suggestedHours, null)
    assert.equal((ece.totals as Json).substitutedOutHours, 1)
    assert.deepEqual(data.unlinked, [
      { teacherId: 't3', teacherName: 'Murat Demir', countedHours: 1 },
    ])
    assert.deepEqual(data.totals, { teacherCount: 2, suggestedHours: 3, currentHours: 0 })
    // Varsayılan 15/30: beş derslik haftada ek ders yok.
    const defaults = ok(await call('GET', `${BASE}/${MONTH}`, t.admin))
    assert.equal(teacherRow(defaults, t.selin).suggestedHours, 0)
    // Okuma denetime düşmez (tutar yok).
    const audits = await db.select().from(auditLog).where(eq(auditLog.institutionId, t.id))
    assert.equal(
      audits.some((row) => row.action.startsWith('finance.lesson_hour_suggestion')),
      false,
    )
  })

  test('DOM-FIN-165 K-550: öğretmenin gün dökümü nedeniyle', async () => {
    const t = await staffed()
    const detail = ok(await call('GET', `${BASE}/${MONTH}/teachers/${t.selin}${PARAMS}`, t.admin))
    assert.equal(detail.suggestedHours, 3)
    const items = (detail.days as Json[]).flatMap((day) => day.items as Json[])
    assert.deepEqual(
      items.map((item) => [item.lessonId, item.status, item.kind, item.extraHours]),
      [
        ['l-mon-1', 'counted', 'own', 0],
        ['l-mon-2', 'counted', 'own', 0],
        ['l-tue-1', 'counted', 'own', 1],
        ['l-tue-2', 'counted', 'own', 1],
        ['l-wed', 'holiday', 'own', 0],
        ['l-thu-cancel', 'cancelled', 'own', 0],
        ['l-thu-leave', 'leave', 'own', 0],
        ['l-fri-sub', 'counted', 'substitute', 1],
      ],
    )
    assert.equal(items[0]?.attendanceMissing, false)
    assert.equal(items[2]?.attendanceMissing, true)
    assert.equal(items[4]?.holidayTitle, 'Okul kuruluş günü')
    assert.deepEqual(detail.transfers, [])
    const ece = ok(await call('GET', `${BASE}/${MONTH}/teachers/${t.ece}${PARAMS}`, t.admin))
    assert.deepEqual(
      (ece.days as Json[]).flatMap((day) => (day.items as Json[]).map((item) => item.status)),
      ['counted', 'substituted_out'],
    )
    assertError(await call('GET', `${BASE}/${MONTH}/teachers/yok${PARAMS}`, t.admin), 404)
  })

  test('400: geçersiz ay, parametre, gövde; kayıt değişmez', async () => {
    const t = await staffed()
    assertError(await call('GET', `${BASE}/2026-13`, t.admin), 400)
    assertError(await call('GET', `${BASE}/${MONTH}?weeklyLoad=20&weeklyCap=10`, t.admin), 400)
    assertError(await call('GET', `${BASE}/${MONTH}?other=1`, t.admin), 400)
    assertError(await transfer(t, transferBody(t.selin), {}), 400)
    assertError(await transfer(t, { ...transferBody(t.selin), institutionId: 'baska' }), 400)
    assertError(await transfer(t, transferBody(t.selin, { reason: 'kısa', hours: 4 })), 400)
    assertError(await transfer(t, { weeklyLoad: 2, weeklyCap: 30, items: [] }), 400)
    assert.equal((await hourRows(t.id)).length, 0)
    assert.equal((await transferRows(t.id)).length, 0)
  })

  test('DOM-FIN-165 K-552: aktarım kaydı açar, mükerrer istek yinelenmez, düzeltme gerekçeli', async () => {
    const t = await staffed()
    const idem = key()
    const first = await transfer(t, transferBody(t.selin), idem)
    const data = ok(first)
    const selin = teacherRow(data, t.selin)
    assert.equal(selin.currentHours, 3)
    assert.equal(selin.difference, 0)
    assert.equal((selin.lastTransfer as Json).previousHours, null)
    const replay = await transfer(t, transferBody(t.selin), idem)
    assert.equal(replay.statusCode, 200)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    const [entry] = await hourRows(t.id)
    assert.equal((await hourRows(t.id)).length, 1)
    assert.deepEqual(
      [entry?.membershipId, entry?.lessonType, entry?.hours, entry?.monthStart],
      [t.selin, 'extra', 3, '2026-09-01'],
    )
    assert.equal((await transferRows(t.id)).length, 1)

    // Aynı saat yeniden aktarılmaz; öneriden farklı saat gerekçesiz yazılmaz.
    assertError(await transfer(t, transferBody(t.selin)), 422, 'lesson_suggestion_unchanged')
    assertError(
      await transfer(t, transferBody(t.selin, { hours: 4 })),
      422,
      'lesson_suggestion_reason_required',
    )
    assertError(
      await transfer(t, transferBody(t.selin, { suggestedHours: 2, hours: 2 })),
      409,
      'lesson_suggestion_changed',
    )
    assertError(
      await transfer(t, transferBody(t.ece, { suggestedHours: 0, hours: 1, reason: 'Ek ders' })),
      422,
      'lesson_suggestion_not_found',
    )
    // Toplu aktarımda biri reddedilirse hiçbiri yazılmaz.
    assertError(
      await transfer(t, {
        weeklyLoad: 2,
        weeklyCap: 30,
        items: [
          { membershipId: t.selin, suggestedHours: 3, hours: 4, reason: 'Gezi dersi eklendi' },
          { membershipId: t.ece, suggestedHours: 0, hours: 1, reason: 'Ek ders' },
        ],
      }),
      422,
      'lesson_suggestion_not_found',
    )
    assert.equal((await hourRows(t.id))[0]?.hours, 3)
    assert.equal((await transferRows(t.id)).length, 1)

    tick()
    const corrected = ok(
      await transfer(t, transferBody(t.selin, { hours: 4, reason: 'Gezi dersi eklendi' })),
    )
    assert.equal(teacherRow(corrected, t.selin).currentHours, 4)
    assert.equal(teacherRow(corrected, t.selin).difference, 1)
    const [updated] = await hourRows(t.id)
    assert.deepEqual([updated?.id, updated?.hours, updated?.version], [entry?.id, 4, 2])
    const rows = await transferRows(t.id)
    const latest = rows.find((row) => row.hours === 4)
    assert.deepEqual(
      [latest?.suggestedHours, latest?.previousHours, latest?.reason, latest?.lessonHoursId],
      [3, 3, 'Gezi dersi eklendi', entry?.id],
    )
    const detail = ok(await call('GET', `${BASE}/${MONTH}/teachers/${t.selin}${PARAMS}`, t.admin))
    assert.deepEqual(
      (detail.transfers as Json[]).map((item) => [item.hours, item.previousHours, item.reason]),
      [
        [4, 3, 'Gezi dersi eklendi'],
        [3, null, null],
      ],
    )
    // Denetime alan adları yazılır; saat ve gerekçe yazılmaz.
    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.id),
          eq(auditLog.action, 'finance.lesson_hour_suggestion.transfer'),
        ),
      )
    assert.equal(audits.length, 2)
    const text = JSON.stringify(audits.map((row) => row.changes))
    assert.equal(text.includes('Gezi dersi'), false)
    assert.ok(audits.every((row) => row.entityId === entry?.id))
  })

  test('DOM-FIN-165 K-552: aktarım satırı değişmez', async () => {
    const t = await staffed()
    ok(await transfer(t, transferBody(t.selin)))
    await assert.rejects(
      db.execute(sql`update lesson_hour_suggestions set hours = 9 where institution_id = ${t.id}`),
    )
    await assert.rejects(
      db.execute(sql`delete from lesson_hour_suggestions where institution_id = ${t.id}`),
    )
    assert.equal((await transferRows(t.id))[0]?.hours, 3)
  })

  test('DOM-FIN-165 K-410: müdür onaylı ve bordro dönemi kilitli ayda aktarım yok', async () => {
    const t = await staffed()
    ok(await transfer(t, transferBody(t.selin)))
    ok(await call('POST', `${SHEETS}/${MONTH}/submit`, t.admin, {}, key()))
    const sheet = ok(
      await call(
        'POST',
        `${SHEETS}/${MONTH}/confirmations`,
        t.admin,
        { membershipId: t.selin, outcome: 'confirmed', channel: 'phone' },
        key(),
      ),
    )
    ok(
      await call(
        'POST',
        `${SHEETS}/${MONTH}/approve`,
        t.admin,
        { entriesHash: sheet.entriesHash },
        key(),
      ),
    )
    const locked = ok(await call('GET', SUGGESTION, t.admin))
    assert.equal(locked.transferable, false)
    assert.equal(locked.sheetStatus, 'approved')
    assertError(
      await transfer(t, transferBody(t.selin, { hours: 4, reason: 'Gezi dersi eklendi' })),
      409,
      'lesson_hours_locked',
    )
    assert.equal((await hourRows(t.id))[0]?.hours, 3)

    const other = await staffed()
    const year = ok(await call('GET', `${PERIODS}?year=2026`, other.admin)) as {
      months: { month: string; current: { inputsHash: string } | null }[]
    }
    const current = year.months.find((item) => item.month === MONTH)?.current
    assert.ok(current)
    ok(
      await call(
        'POST',
        `${PERIODS}/${MONTH}/approve`,
        other.admin,
        { inputsHash: current.inputsHash },
        key(),
      ),
      201,
    )
    const period = ok(await call('GET', SUGGESTION, other.admin))
    assert.equal(period.payrollLocked, true)
    assertError(await transfer(other, transferBody(other.selin)), 409, 'payroll_period_locked')
    assert.equal((await hourRows(other.id)).length, 0)
  })

  test('DOM-FIN-165 K-552: aktarım teyidi geçersizleştirir (çizelge öğretmen kontrolünde)', async () => {
    const t = await staffed()
    ok(await transfer(t, transferBody(t.selin)))
    ok(await call('POST', `${SHEETS}/${MONTH}/submit`, t.admin, {}, key()))
    ok(
      await call(
        'POST',
        `${SHEETS}/${MONTH}/confirmations`,
        t.admin,
        { membershipId: t.selin, outcome: 'confirmed', channel: 'phone' },
        key(),
      ),
    )
    ok(await transfer(t, transferBody(t.selin, { hours: 5, reason: 'Gezi dersleri eklendi' })))
    const sheet = ok(await call('GET', `${SHEETS}/${MONTH}`, t.admin))
    const staff = (sheet.staff as Json[]).find((item) => item.membershipId === t.selin)
    assert.equal(staff?.state, 'pending')
  })

  test('gelecek ay aktarılmaz; elle giriş öneriyle birlikte görünür', async () => {
    const t = await staffed()
    const future = await call(
      'POST',
      `${BASE}/2026-11/transfers`,
      t.admin,
      transferBody(t.selin),
      key(),
    )
    assertError(future, 422, 'lesson_suggestion_not_found')
    ok(
      await call(
        'POST',
        HOURS,
        t.admin,
        { membershipId: t.selin, month: MONTH, lessonType: 'extra', hours: 6 },
        key(),
      ),
      201,
    )
    const data = ok(await call('GET', SUGGESTION, t.admin))
    assert.equal(teacherRow(data, t.selin).currentHours, 6)
    assert.equal(teacherRow(data, t.selin).difference, 3)
    ok(await transfer(t, transferBody(t.selin)))
    const [entry] = await hourRows(t.id)
    assert.equal(entry?.hours, 3)
    assert.equal((await transferRows(t.id))[0]?.previousHours, 6)
  })

  test('DOM-FIN-165: başka kurumun öğretmeni 404 ve aktarılamaz, B değişmez; listede B yok', async () => {
    const a = await staffed()
    const b = await staffed()
    ok(await transfer(b, transferBody(b.selin)))
    const before = await hourRows(b.id)
    assertError(await call('GET', `${BASE}/${MONTH}/teachers/${b.selin}${PARAMS}`, a.admin), 404)
    assertError(await transfer(a, transferBody(b.selin)), 422, 'lesson_suggestion_not_found')
    assert.deepEqual(await hourRows(b.id), before)
    const list = ok(await call('GET', SUGGESTION, a.admin))
    assert.equal(
      (list.teachers as Json[]).some((item) => item.membershipId === b.selin),
      false,
    )
    assert.equal((await hourRows(a.id)).length, 0)
  })
})
