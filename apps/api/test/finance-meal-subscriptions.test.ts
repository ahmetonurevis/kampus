import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  mealSubscriptionCancellations,
  mealSubscriptions,
  mealSubscriptionSettings,
} from '../src/db/schema/finance-meal-subscriptions.ts'
import { schoolCalendarEvents } from '../src/db/schema/finance-school-calendar.ts'
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
 * Yemek aboneliği ve gün iptali uçları (DOM-FIN-164; ON-150; IST-099; K-547…K-549). Her test kendi
 * kurumunu kurar. FIXED_NOW 2026-10-06T09:00Z: Europe/Istanbul 2026-10-06 salı 12:00; varsayılan
 * kesim bir gün önce 15:00 (yarının kesimi bugün 15:00, bugününki geçti).
 */

const BASE = '/api/v1/finance/meal-subscriptions'
const MY = `${BASE}/my`
const DAILY = '/api/v1/finance/meal-daily-counts'
const MONTHLY = '/api/v1/finance/meal-monthly-summary'
const SETTINGS = '/api/v1/finance/meal-subscription-settings'
const TODAY = '2026-10-06'
const TOMORROW = '2026-10-07'
const THURSDAY = '2026-10-08'
const HOLIDAY = '2026-10-29'

const SEED = createSeed(FIXED_NOW)

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-164: yemek aboneliği uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.150.0.1'

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
  const get = (url: string, cookie: string | null) => call('GET', url, cookie)
  const post = (url: string, cookie: string | null, body: unknown, key = randomUUID()) =>
    call('POST', url, cookie, body, { 'idempotency-key': key })
  const patch = (url: string, cookie: string | null, body: unknown, version: unknown) =>
    call('PATCH', url, cookie, body, { 'if-match': `"${String(version)}"` })
  const remove = (url: string, cookie: string | null, version: unknown) =>
    call('DELETE', url, cookie, undefined, { 'if-match': `"${String(version)}"` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.150.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    const classes = SEED.classes.filter((row) => ['c1', 'c9'].includes(row.id))
    const students = SEED.students.filter((row) => ['s1', 's9'].includes(row.id))
    await insertMissingRecords(
      db,
      created.id,
      [
        ...classes.map((row) => ({ collection: 'classes' as const, id: row.id, data: { ...row } })),
        ...students.map((row) => ({
          collection: 'students' as const,
          id: row.id,
          data: { ...row },
        })),
      ],
      FIXED_NOW,
    )
    return {
      id: created.id,
      admin: await signInAs(app, created.admin),
      desk: await signInAs(app, await createMember(app, created.id, 'onburo')),
      parent: await signInAs(
        app,
        await createMember(app, created.id, 'veli', [{ kind: 'child', recordId: 's1' }]),
      ),
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  const url = (id: unknown) => `${BASE}/${String(id)}`
  const cancelUrl = (id: unknown) => `${url(id)}/cancellations`
  const body = (extra: Json = {}) => ({
    studentId: 's1',
    mealKind: 'lunch',
    startDate: TODAY,
    endDate: '2026-12-31',
    weekdays: [1, 2, 3, 4, 5],
    dietType: 'standard',
    ...extra,
  })
  const subscribe = async (t: Tenant, extra: Json = {}) =>
    ok(await post(BASE, t.admin, body(extra)), 201)
  const subscriptionRows = (institutionId: string) =>
    db.select().from(mealSubscriptions).where(eq(mealSubscriptions.institutionId, institutionId))
  const cancellationRows = (institutionId: string) =>
    db
      .select()
      .from(mealSubscriptionCancellations)
      .where(eq(mealSubscriptionCancellations.institutionId, institutionId))
  async function holiday(institutionId: string, day: string) {
    await db.insert(schoolCalendarEvents).values({
      institutionId,
      id: randomUUID(),
      title: 'Cumhuriyet Bayramı',
      kind: 'holiday',
      allDay: true,
      startDate: day,
      endDate: day,
      audienceKind: 'institution',
      status: 'published',
      publishedAt: FIXED_NOW,
      publishedByUserId: 'test-admin',
      createdByUserId: 'test-admin',
    })
  }

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    assertError(await get(BASE, null), 401)
    assertError(await post(BASE, null, body()), 401)
    assertError(await get(MY, null), 401)
    assertError(await get(url(id), null), 401)
    assertError(await post(cancelUrl(id), null, { dates: [TOMORROW] }), 401)
    assertError(await get(DAILY, null), 401)
    assertError(await get(MONTHLY, null), 401)
    assertError(await get(SETTINGS, null), 401)
  })

  test('DOM-FIN-164: rol ve modül; öğretmen ve aile yönetim uçlarına 403, kesim ayarı yöneticide; meals kapalı 403 (K-547, K-548)', async () => {
    const t = await institution()
    const teacher = await signInAs(app, await createMember(app, t.id, 'ogretmen'))
    const student = await signInAs(
      app,
      await createMember(app, t.id, 'ogrenci', [{ kind: 'student', recordId: 's1' }]),
    )
    const created = await subscribe(t)
    assertError(await get(BASE, teacher), 403)
    assertError(await get(BASE, t.parent), 403)
    assertError(await post(BASE, t.parent, body({ startDate: TOMORROW })), 403)
    assertError(await get(url(created.id), t.parent), 403)
    assertError(await get(DAILY, t.parent), 403)
    assertError(await get(MONTHLY, teacher), 403)
    assertError(await get(MY, t.admin), 403)
    assertError(await get(MY, teacher), 403)
    assertError(await post(cancelUrl(created.id), student, { dates: [THURSDAY] }), 403)
    assertError(await post(cancelUrl(created.id), teacher, { dates: [THURSDAY] }), 403)
    assertError(await patch(SETTINGS, t.desk, { cutoffDaysBefore: 0, cutoffTime: '09:00' }, 1), 403)
    ok(await get(BASE, t.desk))
    ok(await get(DAILY, t.desk))
    assert.equal((await cancellationRows(t.id)).length, 0)

    const closed = await institution({ enabledModules: { meals: false } })
    assertError(await get(BASE, closed.admin), 403, 'module_disabled')
    assertError(await post(BASE, closed.admin, body()), 403, 'module_disabled')
    assertError(await get(MY, closed.parent), 403, 'module_disabled')
    assertError(await get(DAILY, closed.admin), 403, 'module_disabled')
    assertError(await get(SETTINGS, closed.admin), 403, 'module_disabled')
    assert.equal((await subscriptionRows(closed.id)).length, 0)
  })

  test('DOM-FIN-164: abonelik açma, doğrulama, çakışma ve mükerrer istek (K-547)', async () => {
    const t = await institution()
    assertError(await post(BASE, t.admin, body({ dietType: 'other' })), 400)
    assertError(await post(BASE, t.admin, body({ weekdays: [] })), 400)
    assertError(await post(BASE, t.admin, body({ institutionId: 'x' })), 400)
    assertError(
      await post(BASE, t.admin, body({ startDate: '2026-10-05' })),
      422,
      'meal_subscription_start_past',
    )
    assertError(
      await post(BASE, t.admin, body({ mealKind: 'breakfast' })),
      422,
      'meal_kind_disabled',
    )
    assertError(
      await post(BASE, t.admin, body({ studentId: 'test-yok' })),
      422,
      'meal_subscription_student_not_found',
    )
    assert.equal((await subscriptionRows(t.id)).length, 0)

    const key = randomUUID()
    const first = await post(
      BASE,
      t.admin,
      body({ dietType: 'other', dietNote: 'Domuz eti içermeyen', weekdays: [5, 1, 3] }),
      key,
    )
    const created = ok(first, 201)
    assert.equal(first.headers.location, url(created.id))
    assert.equal(created.studentName, SEED.students.find((row) => row.id === 's1')?.name)
    assert.equal(created.classId, 'c1')
    assert.deepEqual(created.weekdays, [1, 3, 5])
    assert.equal(created.status, 'active')
    assert.deepEqual(created.cutoff, { cutoffDaysBefore: 1, cutoffTime: '15:00' })
    assert.equal((created.days as Json[])[0]?.mealDate, TOMORROW)
    const replay = await post(
      BASE,
      t.admin,
      body({ dietType: 'other', dietNote: 'Domuz eti içermeyen', weekdays: [5, 1, 3] }),
      key,
    )
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((await subscriptionRows(t.id)).length, 1)
    const [row] = await subscriptionRows(t.id)
    assert.equal(row?.dietNote, 'Domuz eti içermeyen')

    assertError(
      await post(BASE, t.admin, body({ startDate: '2026-12-01', endDate: '2027-01-31' })),
      409,
      'meal_subscription_overlap',
    )
    ok(
      await post(
        BASE,
        t.admin,
        body({ startDate: '2027-01-01', endDate: '2027-06-30', dietType: 'vegetarian' }),
      ),
      201,
    )
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.id),
          eq(auditLog.action, 'finance.meal_subscription.create'),
          eq(auditLog.entityId, String(created.id)),
        ),
      )
    assert.ok(audit)
    assert.equal(JSON.stringify(audit.changes).includes('Domuz'), false)

    const list = await get(`${BASE}?status=active&q=${encodeURIComponent('Den')}`, t.desk)
    assert.equal(list.statusCode, 200, list.body)
    assert.equal(list.json().meta.total, 1)
    assert.equal(ok(await get(`${BASE}?dietType=vegetarian`, t.admin)).length, 1)
    assert.equal(ok(await get(`${BASE}?classId=c9`, t.admin)).length, 0)
    assertError(await get(`${BASE}?sort=name`, t.admin), 400)
  })

  test('DOM-FIN-164: düzenleme başlamış abonelikte yalnız bitiş günü; arşiv yalnız başlamamışta (K-547)', async () => {
    const t = await institution()
    const active = await subscribe(t)
    assertError(
      await patch(url(active.id), t.admin, { dietType: 'vegetarian' }, active.version),
      422,
      'meal_subscription_started',
    )
    assertError(
      await patch(url(active.id), t.admin, { endDate: '2026-10-05' }, active.version),
      422,
      'meal_subscription_end_past',
    )
    assertError(await patch(url(active.id), t.admin, { endDate: TODAY }, 99), 409)
    const ended = ok(
      await patch(url(active.id), t.admin, { endDate: '2026-10-31' }, active.version),
    )
    assert.equal(ended.endDate, '2026-10-31')
    assert.equal(ended.version, 2)
    assertError(
      await patch(url(active.id), t.admin, { endDate: '2026-10-31' }, 2),
      422,
      'meal_subscription_unchanged',
    )
    assertError(await remove(url(active.id), t.admin, 2), 422, 'meal_subscription_started')

    const upcoming = await subscribe(t, { startDate: '2026-11-02', endDate: '2026-11-30' })
    const changed = ok(
      await patch(
        url(upcoming.id),
        t.desk,
        { dietType: 'gluten_free', weekdays: [1, 2] },
        upcoming.version,
      ),
    )
    assert.equal(changed.dietType, 'gluten_free')
    assert.deepEqual(changed.weekdays, [1, 2])
    ok(await remove(url(upcoming.id), t.desk, changed.version))
    assertError(await get(url(upcoming.id), t.admin), 404)
    assert.equal((await subscriptionRows(t.id)).filter((row) => row.archivedAt === null).length, 1)
  })

  test('DOM-FIN-164: veli kesimden önce iptal eder ve geri alır; kesim sonrası okul geç iptal yazar (K-548)', async () => {
    const t = await institution()
    const created = await subscribe(t)
    // Yarının kesimi bugün 15:00: veli iptal eder.
    const cancelled = ok(
      await post(cancelUrl(created.id), t.parent, { dates: [TOMORROW, THURSDAY] }),
      201,
    )
    const rows = cancelled.cancellations as Json[]
    assert.deepEqual(
      rows.map((row) => [row.mealDate, row.late, row.cancelledBy]),
      [
        [TOMORROW, false, 'family'],
        [THURSDAY, false, 'family'],
      ],
    )
    // Bugünün kesimi dün 15:00'te geçti: veli reddedilir, okul geç iptal yazar.
    assertError(
      await post(cancelUrl(created.id), t.parent, { dates: [TODAY] }),
      422,
      'meal_cancellation_cutoff_passed',
    )
    const late = ok(await post(cancelUrl(created.id), t.desk, { dates: [TODAY] }), 201)
    assert.equal((late.cancellations as Json[])[0]?.late, true)
    assertError(
      await post(cancelUrl(created.id), t.admin, { dates: [TOMORROW] }),
      409,
      'meal_day_already_cancelled',
    )
    assertError(
      await post(cancelUrl(created.id), t.admin, { dates: ['2026-10-10'] }),
      422,
      'meal_day_not_subscribed',
    )
    assertError(
      await post(cancelUrl(created.id), t.admin, { dates: ['2026-10-05'] }),
      422,
      'meal_day_not_subscribed',
    )
    await holiday(t.id, HOLIDAY)
    assertError(
      await post(cancelUrl(created.id), t.admin, { dates: [HOLIDAY] }),
      422,
      'meal_day_holiday',
    )
    assert.equal((await cancellationRows(t.id)).length, 3)

    const thursday = rows[1] ?? {}
    const restoreUrl = (row: Json) => `${cancelUrl(created.id)}/${String(row.id)}`
    assertError(await remove(restoreUrl(thursday), t.parent, 9), 409)
    ok(await remove(restoreUrl(thursday), t.parent, thursday.version))
    const todayRow = (late.cancellations as Json[])[0] ?? {}
    assertError(
      await remove(restoreUrl(todayRow), t.parent, todayRow.version),
      422,
      'meal_cancellation_cutoff_passed',
    )
    ok(await remove(restoreUrl(todayRow), t.admin, todayRow.version))
    const live = (await cancellationRows(t.id)).filter((row) => row.archivedAt === null)
    assert.deepEqual(
      live.map((row) => row.mealDate),
      [TOMORROW],
    )
    const restored = (await cancellationRows(t.id)).filter((row) => row.archivedAt !== null)
    assert.ok(restored.every((row) => row.restoredByUserId !== null))

    const detail = ok(await get(url(created.id), t.admin))
    const days = detail.days as Json[]
    assert.deepEqual(
      days.slice(0, 3).map((day) => [day.mealDate, day.status, day.canCancel, day.canRestore]),
      [
        [TODAY, 'scheduled', true, false],
        [TOMORROW, 'cancelled', false, true],
        [THURSDAY, 'scheduled', true, false],
      ],
    )
    assert.equal(days.find((day) => day.mealDate === HOLIDAY)?.status, 'holiday')
  })

  test('DOM-FIN-164: veli ve öğrenci yalnız kendi aboneliğini görür; başka çocuğun aboneliği 404 (K-548)', async () => {
    const t = await institution()
    const mine = await subscribe(t)
    const other = await subscribe(t, { studentId: 's9' })
    const student = await signInAs(
      app,
      await createMember(app, t.id, 'ogrenci', [{ kind: 'student', recordId: 's1' }]),
    )
    const parentView = ok(await get(MY, t.parent))
    assert.equal(parentView.today, TODAY)
    const subscriptions = parentView.subscriptions as Json[]
    assert.deepEqual(
      subscriptions.map((row) => row.id),
      [mine.id],
    )
    const days = (subscriptions[0]?.days ?? []) as Json[]
    assert.deepEqual(
      days.slice(0, 2).map((day) => [day.mealDate, day.canCancel]),
      [
        [TODAY, false],
        [TOMORROW, true],
      ],
    )
    const studentView = ok(await get(MY, student))
    const studentDays = ((studentView.subscriptions as Json[])[0]?.days ?? []) as Json[]
    assert.ok(studentDays.every((day) => day.canCancel === false))

    const before = await cancellationRows(t.id)
    assertError(await post(cancelUrl(other.id), t.parent, { dates: [TOMORROW] }), 404)
    const adminCancel = ok(await post(cancelUrl(other.id), t.admin, { dates: [TOMORROW] }), 201)
    const row = (adminCancel.cancellations as Json[])[0] ?? {}
    assertError(
      await remove(`${cancelUrl(other.id)}/${String(row.id)}`, t.parent, row.version),
      404,
    )
    assert.equal((await cancellationRows(t.id)).length, before.length + 1)
  })

  test('DOM-FIN-164: günlük mutfak sayısı öğün × diyet, iptaller düşülür, sınıf kırılımı; tatilde sıfır (K-549)', async () => {
    const t = await institution()
    await subscribe(t)
    const veggie = await subscribe(t, { studentId: 's9', dietType: 'vegetarian' })
    await subscribe(t, {
      studentId: 's9',
      mealKind: 'lunch',
      startDate: '2027-01-01',
      endDate: '2027-01-31',
    })
    ok(await post(cancelUrl(veggie.id), t.admin, { dates: [TOMORROW] }), 201)

    const today = ok(await get(`${DAILY}?date=${TODAY}`, t.desk))
    const lunch = (today.meals as Json[]).find((row) => row.mealKind === 'lunch') ?? {}
    assert.equal(lunch.total, 2)
    assert.deepEqual(
      (lunch.diets as Json[]).filter((row) => Number(row.count) > 0),
      [
        { dietType: 'standard', count: 1 },
        { dietType: 'vegetarian', count: 1 },
      ],
    )
    const classes = today.classes as Json[]
    assert.deepEqual(
      classes.map((row) => row.classId),
      ['c1', 'c9'],
    )
    assert.equal(JSON.stringify(today).includes('studentName'), false)

    const tomorrow = ok(await get(`${DAILY}?date=${TOMORROW}`, t.admin))
    const tomorrowLunch = (tomorrow.meals as Json[])[0] ?? {}
    assert.equal(tomorrowLunch.total, 1)
    assert.equal(tomorrowLunch.cancelled, 1)

    await holiday(t.id, HOLIDAY)
    const off = ok(await get(`${DAILY}?date=${HOLIDAY}`, t.admin))
    assert.equal(off.holidayTitle, 'Cumhuriyet Bayramı')
    assert.equal(((off.meals as Json[])[0] ?? {}).total, 0)
    assertError(await get(`${DAILY}?date=2026-02-30`, t.admin), 400)
  })

  test('DOM-FIN-164: aylık özet abone, tatil, iptal, geç iptal ve iade günü; tutar yok (K-549)', async () => {
    const t = await institution()
    const created = await subscribe(t)
    await subscribe(t, { studentId: 's9', startDate: '2026-11-02', endDate: '2026-11-30' })
    await holiday(t.id, HOLIDAY)
    ok(await post(cancelUrl(created.id), t.parent, { dates: [TOMORROW, THURSDAY] }), 201)
    ok(await post(cancelUrl(created.id), t.admin, { dates: [TODAY] }), 201)

    const response = await get(`${MONTHLY}?month=2026-10`, t.admin)
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().meta.total, 1)
    const [row] = response.json().data as Json[]
    assert.deepEqual(
      {
        subscribedDays: row?.subscribedDays,
        holidayDays: row?.holidayDays,
        cancelledDays: row?.cancelledDays,
        lateCancelledDays: row?.lateCancelledDays,
        mealDays: row?.mealDays,
        refundableDays: row?.refundableDays,
      },
      {
        subscribedDays: 18,
        holidayDays: 1,
        cancelledDays: 2,
        lateCancelledDays: 1,
        mealDays: 15,
        refundableDays: 2,
      },
    )
    assert.equal(JSON.stringify(row).includes('amount'), false)
    const november = await get(`${MONTHLY}?month=2026-11&classId=c9`, t.desk)
    assert.equal(november.json().meta.total, 1)
    assertError(await get(`${MONTHLY}?month=2026-13`, t.admin), 400)
  })

  test('DOM-FIN-164: kesim ayarı yöneticide; yeni kesim veli iptaline uygulanır (K-548)', async () => {
    const t = await institution()
    assert.deepEqual(ok(await get(SETTINGS, t.desk)), {
      cutoffDaysBefore: 1,
      cutoffTime: '15:00',
      version: 1,
    })
    assertError(
      await patch(SETTINGS, t.admin, { cutoffDaysBefore: 1, cutoffTime: '15:00' }, 1),
      422,
      'meal_subscription_settings_unchanged',
    )
    assertError(
      await patch(SETTINGS, t.admin, { cutoffDaysBefore: 9, cutoffTime: '15:00' }, 1),
      400,
    )
    const saved = ok(
      await patch(SETTINGS, t.admin, { cutoffDaysBefore: 0, cutoffTime: '13:00' }, 1),
    )
    assert.equal(saved.version, 2)
    assertError(
      await patch(SETTINGS, t.admin, { cutoffDaysBefore: 0, cutoffTime: '14:00' }, 1),
      409,
    )
    const [row] = await db
      .select()
      .from(mealSubscriptionSettings)
      .where(eq(mealSubscriptionSettings.institutionId, t.id))
    assert.equal(row?.cutoffTime, '13:00')
    const created = await subscribe(t)
    const today = ok(await post(cancelUrl(created.id), t.parent, { dates: [TODAY] }), 201)
    assert.equal((today.cancellations as Json[])[0]?.late, false)
  })

  test('DOM-FIN-164: başka kurumun aboneliği 404, B değişmez; listede, sayımda ve özette B yok; institutionId ve B öğrencisi etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const theirs = await subscribe(b)
    const cancelledB = ok(await post(cancelUrl(theirs.id), b.admin, { dates: [TOMORROW] }), 201)
    const cancellation = (cancelledB.cancellations as Json[])[0] ?? {}
    const beforeSubscriptions = await subscriptionRows(b.id)
    const beforeCancellations = await cancellationRows(b.id)

    assertError(await get(url(theirs.id), a.admin), 404)
    assertError(await patch(url(theirs.id), a.admin, { endDate: TODAY }, theirs.version), 404)
    assertError(await remove(url(theirs.id), a.admin, theirs.version), 404)
    assertError(await post(cancelUrl(theirs.id), a.admin, { dates: [THURSDAY] }), 404)
    assertError(await post(cancelUrl(theirs.id), a.parent, { dates: [THURSDAY] }), 404)
    assertError(
      await remove(
        `${cancelUrl(theirs.id)}/${String(cancellation.id)}`,
        a.admin,
        cancellation.version,
      ),
      404,
    )
    assert.deepEqual(await subscriptionRows(b.id), beforeSubscriptions)
    assert.deepEqual(await cancellationRows(b.id), beforeCancellations)

    assert.equal(ok(await get(BASE, a.admin)).length, 0)
    assert.equal(((ok(await get(MY, a.parent)).subscriptions as Json[]) ?? []).length, 0)
    const count = ok(await get(`${DAILY}?date=${TODAY}`, a.admin))
    assert.equal(((count.meals as Json[])[0] ?? {}).total, 0)
    const summary = await get(`${MONTHLY}?month=2026-10`, a.admin)
    assert.equal(summary.json().meta.total, 0)
    // Gövdedeki kurum kimliği şemada yok (400); A'da olmayan öğrenci B'nin kaydına bağlanmaz.
    assertError(await post(BASE, a.admin, body({ institutionId: b.id })), 400)
    const s1 = SEED.students.find((row) => row.id === 's1')
    await insertMissingRecords(
      db,
      b.id,
      [
        {
          collection: 'students' as const,
          id: 'test-b-ogrenci',
          data: { ...s1, id: 'test-b-ogrenci' },
        },
      ],
      FIXED_NOW,
    )
    assertError(
      await post(BASE, a.admin, body({ studentId: 'test-b-ogrenci' })),
      422,
      'meal_subscription_student_not_found',
    )
    assert.equal((await subscriptionRows(a.id)).length, 0)

    // Kesim ayarı kurumundur: B'nin ayarı A'ya görünmez, gövdedeki B kimliği A'yı değiştirmez.
    ok(await patch(SETTINGS, b.admin, { cutoffDaysBefore: 0, cutoffTime: '10:00' }, 1))
    assert.deepEqual(ok(await get(SETTINGS, a.admin)), {
      cutoffDaysBefore: 1,
      cutoffTime: '15:00',
      version: 1,
    })
    const crossSettings = { cutoffDaysBefore: 2, cutoffTime: '11:00', institutionId: b.id }
    assertError(await patch(SETTINGS, a.admin, crossSettings, 1), 400)
    const [bSettings] = await db
      .select()
      .from(mealSubscriptionSettings)
      .where(eq(mealSubscriptionSettings.institutionId, b.id))
    assert.equal(bSettings?.cutoffTime, '10:00')
  })
})
