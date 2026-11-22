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
  mealMenuCorrections,
  mealMenuItems,
  mealMenus,
  mealMenuSettings,
} from '../src/db/schema/finance-meal-menus.ts'
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
 * Yemek menüsü uçları (DOM-FIN-157; ON-090, ON-149; IST-099; K-526…K-528). Her test kendi kurumunu
 * kurar. FIXED_NOW 2026-10-06T09:00Z: Europe/Istanbul günü 2026-10-06 salı, hafta 2026-10-05.
 */

const BASE = '/api/v1/finance/meal-menus'
const MY = `${BASE}/my`
const SETTINGS = '/api/v1/finance/meal-menu-settings'
const WEEK = '2026-10-05'
const NEXT = '2026-10-12'

const SEED = createSeed(FIXED_NOW)

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-157: yemek menüsü uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.149.0.1'

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
  const command = (url: string, cookie: string, version: unknown) =>
    call('POST', url, cookie, undefined, { 'if-match': `"${String(version)}"` })
  const remove = (url: string, cookie: string, version: unknown) =>
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
    clientIp = `10.149.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    const classes = SEED.classes.filter((row) => ['c1', 'c9'].includes(row.id))
    const students = SEED.students.filter((row) => ['s1', 's9'].includes(row.id))
    await insertMissingRecords(
      db,
      created.id,
      [
        ...SEED.branches.map((branch) => ({
          collection: 'branches' as const,
          id: branch.id,
          data: { ...branch },
        })),
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
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  const menuUrl = (id: unknown) => `${BASE}/${String(id)}`
  const nutrition = (energyKcal: number) => ({
    energyKcal,
    proteinDg: 85,
    fatDg: 42,
    carbohydrateDg: 260,
    fiberDg: 31,
    saltDg: 9,
  })
  const lunch = (menuDate: string, items: Json[]) => ({ menuDate, mealKind: 'lunch', items })
  const soup = { name: 'Mercimek çorbası', allergens: ['celery'], nutrition: nutrition(180) }
  const rice = { name: 'Pirinç pilavı', allergens: ['milk'], nutrition: nutrition(250) }
  const yogurt = { name: 'Yoğurt', allergens: ['milk'], nutrition: null }

  /** Taslak menü açar ve bir günün öğle yemeğini yazar. */
  async function menuWith(t: Tenant, weekStart = WEEK, extra: Json = {}, days = [WEEK]) {
    const created = ok(await post(BASE, t.admin, { weekStart, ...extra }), 201)
    return ok(
      await patch(
        menuUrl(created.id),
        t.admin,
        { slots: days.map((day) => lunch(day, [soup, rice])) },
        created.version,
      ),
    )
  }
  const menuRows = (institutionId: string) =>
    db.select().from(mealMenus).where(eq(mealMenus.institutionId, institutionId))
  const itemRows = (institutionId: string) =>
    db.select().from(mealMenuItems).where(eq(mealMenuItems.institutionId, institutionId))

  test('kimliksiz istek 401', async () => {
    assertError(await get(BASE, null), 401)
    assertError(await post(BASE, null, { weekStart: WEEK }), 401)
    assertError(await get(MY, null), 401)
    assertError(await get(SETTINGS, null), 401)
  })

  test('DOM-FIN-157: rol ve modül; öğretmen ve aile yönetim uçlarına 403, öğün ayarı yöneticide; meals kapalı 403 (K-526, K-527)', async () => {
    const t = await institution()
    const teacher = await signInAs(app, await createMember(app, t.id, 'ogretmen'))
    const parent = await signInAs(app, await createMember(app, t.id, 'veli'))
    assertError(await get(BASE, teacher), 403)
    assertError(await get(BASE, parent), 403)
    assertError(await post(BASE, parent, { weekStart: WEEK }), 403)
    assertError(await get(MY, t.admin), 403)
    assertError(await get(MY, teacher), 403)
    ok(await post(BASE, t.desk, { weekStart: WEEK }), 201)
    assertError(await patch(SETTINGS, t.desk, { mealKinds: ['lunch', 'snack'] }, 1), 403)
    const closed = await institution({ enabledModules: { meals: false } })
    assertError(await get(BASE, closed.admin), 403, 'module_disabled')
    assertError(await post(BASE, closed.admin, { weekStart: WEEK }), 403, 'module_disabled')
    assertError(await get(SETTINGS, closed.admin), 403, 'module_disabled')
    assert.equal((await menuRows(closed.id)).length, 0)
  })

  test('DOM-FIN-157: menü açma, hafta ve kampüs tekilliği, önceki haftadan kopya (K-526)', async () => {
    const t = await institution()
    assertError(await post(BASE, t.admin, { weekStart: '2026-10-06' }), 400)
    assertError(await post(BASE, t.admin, { weekStart: '2026-09-28' }), 422, 'meal_menu_week_past')
    assertError(
      await post(BASE, t.admin, { weekStart: WEEK, branchId: 'test-yok' }),
      422,
      'meal_menu_branch_not_found',
    )
    assertError(
      await post(BASE, t.admin, { weekStart: NEXT, copyFromMenuId: randomUUID() }),
      422,
      'meal_menu_source_not_found',
    )
    assertError(
      await call('POST', BASE, t.admin, { weekStart: WEEK }),
      400,
      'idempotency_key_required',
    )
    assert.equal((await menuRows(t.id)).length, 0)

    const key = randomUUID()
    const created = ok(await post(BASE, t.admin, { weekStart: WEEK }, key), 201)
    assert.equal(created.status, 'draft')
    assert.equal(created.weekEnd, '2026-10-11')
    assert.equal((created.days as Json[]).length, 7)
    const replay = await post(BASE, t.admin, { weekStart: WEEK }, key)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(await post(BASE, t.admin, { weekStart: WEEK }), 409, 'meal_menu_exists')
    const kadikoy = ok(await post(BASE, t.admin, { weekStart: WEEK, branchId: 'b1' }), 201)
    assert.equal(kadikoy.branchName, 'Kadıköy Kampüsü')

    const filled = ok(
      await patch(
        menuUrl(created.id),
        t.admin,
        { slots: [lunch(WEEK, [soup, rice]), lunch('2026-10-09', [yogurt])] },
        created.version,
      ),
    )
    const copy = ok(await post(BASE, t.admin, { weekStart: NEXT, copyFromMenuId: filled.id }), 201)
    const days = copy.days as { menuDate: string; meals: { items: Json[] }[] }[]
    assert.deepEqual(
      days[0]?.meals[0]?.items.map((item) => item.name),
      ['Mercimek çorbası', 'Pirinç pilavı'],
    )
    assert.equal(days[4]?.menuDate, '2026-10-16')
    assert.equal(days[4]?.meals[0]?.items[0]?.name, 'Yoğurt')
    assert.equal(copy.status, 'draft')

    const list = await get(`${BASE}?branchId=all`, t.admin)
    assert.equal(list.json().meta.total, 2)
    const row = (list.json().data as Json[]).find((menu) => menu.id === filled.id)
    assert.equal(row?.itemCount, 3)
    assert.equal(row?.dayCount, 2)
    assert.equal((await get(`${BASE}?from=${NEXT}`, t.admin)).json().meta.total, 1)
    assertError(await get(`${BASE}?bilinmeyen=1`, t.admin), 400)
  })

  test('DOM-FIN-157: hücre yazma, alerjen ve besin değeri, günlük toplam; kapalı öğün ve sürüm (K-526, K-528)', async () => {
    const t = await institution()
    const created = ok(await post(BASE, t.admin, { weekStart: WEEK }), 201)
    const url = menuUrl(created.id)
    assertError(
      await patch(
        url,
        t.admin,
        { slots: [lunch(WEEK, [{ ...soup, nutrition: { ...nutrition(180), proteinDg: 8.5 } }])] },
        created.version,
      ),
      400,
    )
    assertError(
      await patch(
        url,
        t.admin,
        { slots: [lunch(WEEK, [{ ...soup, allergens: ['peanut'] }])] },
        created.version,
      ),
      400,
    )
    assertError(
      await patch(
        url,
        t.admin,
        { slots: [{ menuDate: WEEK, mealKind: 'breakfast', items: [yogurt] }] },
        created.version,
      ),
      422,
      'meal_kind_disabled',
    )
    assertError(
      await patch(url, t.admin, { slots: [lunch(NEXT, [soup])] }, created.version),
      422,
      'meal_menu_date_outside_week',
    )
    assert.equal((await itemRows(t.id)).length, 0)

    const settings = ok(await get(SETTINGS, t.admin))
    assert.deepEqual(settings, { mealKinds: ['lunch'], version: 1 })
    const saved = ok(
      await patch(SETTINGS, t.admin, { mealKinds: ['snack', 'breakfast', 'lunch'] }, 1),
    )
    assert.deepEqual(saved.mealKinds, ['breakfast', 'lunch', 'snack'])
    assertError(await patch(SETTINGS, t.admin, { mealKinds: ['lunch'] }, 1), 409)
    assertError(
      await patch(SETTINGS, t.admin, { mealKinds: ['lunch', 'snack', 'breakfast'] }, saved.version),
      422,
      'meal_menu_settings_unchanged',
    )

    const written = ok(
      await patch(
        url,
        t.desk,
        {
          slots: [
            lunch(WEEK, [soup, rice, yogurt]),
            {
              menuDate: WEEK,
              mealKind: 'breakfast',
              items: [{ name: 'Simit', allergens: ['sesame', 'gluten'], nutrition: null }],
            },
          ],
        },
        created.version,
      ),
    )
    const monday = (
      written.days as { meals: { mealKind: string; items: Json[] }[]; totals: Json }[]
    )[0]
    assert.deepEqual(
      monday?.meals.map((meal) => meal.mealKind),
      ['breakfast', 'lunch'],
    )
    assert.deepEqual(monday?.meals[0]?.items[0]?.allergens, ['gluten', 'sesame'])
    assert.deepEqual(monday?.totals, {
      itemCount: 4,
      missingNutrition: 2,
      energyKcal: 430,
      proteinDg: 170,
      fatDg: 84,
      carbohydrateDg: 520,
      fiberDg: 62,
      missingFiber: 0,
      saltDg: 18,
      missingSalt: 0,
    })
    assertError(await patch(url, t.admin, { slots: [lunch(WEEK, [soup])] }, created.version), 409)
    assertError(
      await patch(url, t.admin, { slots: [lunch(WEEK, [soup, rice, yogurt])] }, written.version),
      422,
      'meal_menu_unchanged',
    )
    const shorter = ok(await patch(url, t.admin, { slots: [lunch(WEEK, [rice])] }, written.version))
    const rows = await itemRows(t.id)
    assert.equal(rows.filter((row) => row.archivedAt === null).length, 2)
    assert.equal(rows.filter((row) => row.archivedAt !== null).length, 3)
    assert.equal(
      ((shorter.days as { meals: { items: Json[] }[] }[])[0]?.meals[1]?.items ?? []).length,
      1,
    )
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.entityType, 'meal_menus')))
    assert.deepEqual(audits.map((row) => row.action).sort(), [
      'finance.meal_menu.create',
      'finance.meal_menu.update',
      'finance.meal_menu.update',
    ])
    assert.ok(!JSON.stringify(audits).includes('Pirinç'))
  })

  test('DOM-FIN-157: yayım, geçmiş gün yalnız yöneticinin gerekçeli düzeltmesi, yayımdan kaldırma ve arşiv (K-527)', async () => {
    const t = await institution()
    const empty = ok(await post(BASE, t.admin, { weekStart: NEXT }), 201)
    assertError(
      await command(`${menuUrl(empty.id)}/publish`, t.admin, empty.version),
      422,
      'meal_menu_empty',
    )
    const menu = await menuWith(t, WEEK, {}, [WEEK, '2026-10-06'])
    const url = menuUrl(menu.id)
    assertError(
      await command(`${url}/unpublish`, t.admin, menu.version),
      422,
      'meal_menu_not_published',
    )
    const published = ok(await command(`${url}/publish`, t.desk, menu.version))
    assert.equal(published.status, 'published')
    assert.equal(typeof published.publishedAt, 'string')
    assertError(
      await command(`${url}/publish`, t.admin, published.version),
      422,
      'meal_menu_not_draft',
    )
    // Bugün (salı) ön büroca değişir.
    const today = ok(
      await patch(url, t.desk, { slots: [lunch('2026-10-06', [yogurt])] }, published.version),
    )
    // Pazartesi geçmişte: gerekçe ve yönetici ister.
    const past = { slots: [lunch(WEEK, [soup, yogurt])] }
    assertError(await patch(url, t.admin, past, today.version), 422, 'meal_menu_day_past')
    const reason = { ...past, correctionReason: 'Mutfak pilav yerine yoğurt verdi.' }
    assertError(
      await patch(url, t.desk, reason, today.version),
      403,
      'meal_menu_correction_forbidden',
    )
    assertError(
      await patch(
        url,
        t.admin,
        { slots: [lunch('2026-10-07', [soup])], correctionReason: 'Gereksiz bir gerekçe.' },
        today.version,
      ),
      422,
      'meal_menu_correction_not_needed',
    )
    assert.equal(
      (await db.select().from(mealMenuCorrections)).filter((r) => r.institutionId === t.id).length,
      0,
    )
    const corrected = ok(await patch(url, t.admin, reason, today.version))
    const corrections = corrected.corrections as Json[]
    assert.equal(corrections.length, 1)
    assert.equal(corrections[0]?.menuDate, WEEK)
    assert.equal(corrections[0]?.reason, 'Mutfak pilav yerine yoğurt verdi.')
    const archived = (await itemRows(t.id)).filter(
      (row) => row.menuDate === WEEK && row.archivedAt !== null,
    )
    assert.deepEqual(archived.map((row) => row.name).sort(), ['Mercimek çorbası', 'Pirinç pilavı'])
    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'finance.meal_menu.correct')),
      )
    assert.equal(audits.length, 1)
    assert.ok(!JSON.stringify(audits).includes('yoğurt verdi'))

    assertError(
      await command(`${url}/unpublish`, t.admin, corrected.version),
      422,
      'meal_menu_week_started',
    )
    assertError(await remove(url, t.admin, corrected.version), 422, 'meal_menu_published')

    const next = await menuWith(t, NEXT, { branchId: 'b2' }, [NEXT])
    const nextPublished = ok(await command(`${menuUrl(next.id)}/publish`, t.admin, next.version))
    const draft = ok(await command(`${menuUrl(next.id)}/unpublish`, t.admin, nextPublished.version))
    assert.equal(draft.status, 'draft')
    assert.equal(draft.publishedAt, null)
    ok(await remove(menuUrl(next.id), t.admin, draft.version))
    assertError(await get(menuUrl(next.id), t.admin), 404)
    ok(await post(BASE, t.admin, { weekStart: NEXT, branchId: 'b2' }), 201)
  })

  test('DOM-FIN-157: veli ve öğrenci yalnız yayımlanmış menüyü kampüsüne göre görür; taslak görünmez (K-526)', async () => {
    const t = await institution()
    const parent = await signInAs(
      app,
      await createMember(app, t.id, 'veli', [{ kind: 'child', recordId: 's1' }]),
    )
    const student = await signInAs(
      app,
      await createMember(app, t.id, 'ogrenci', [{ kind: 'student', recordId: 's9' }]),
    )
    assert.deepEqual(ok(await get(MY, parent)), {
      weekStart: WEEK,
      weekEnd: '2026-10-11',
      menus: [],
    })
    const all = await menuWith(t)
    const kadikoy = await menuWith(t, WEEK, { branchId: 'b1' })
    assert.deepEqual((ok(await get(MY, parent)).menus as Json[]).length, 0)
    ok(await command(`${menuUrl(all.id)}/publish`, t.admin, all.version))
    // Kadıköy menüsü taslakken s1 bütün kampüs menüsünü görür.
    const before = ok(await get(MY, parent)).menus as Json[]
    assert.equal(before.length, 1)
    assert.equal(before[0]?.id, all.id)
    ok(await command(`${menuUrl(kadikoy.id)}/publish`, t.admin, kadikoy.version))
    const mine = ok(await get(`${MY}?weekStart=2026-10-08`, parent))
    assert.equal(mine.weekStart, WEEK)
    const menus = mine.menus as Json[]
    assert.equal(menus.length, 1)
    assert.equal(menus[0]?.id, kadikoy.id)
    assert.equal(menus[0]?.branchName, 'Kadıköy Kampüsü')
    assert.deepEqual(menus[0]?.students, [{ studentId: 's1', studentName: 'Deniz Yılmaz' }])
    const monday = (menus[0]?.days as { meals: { items: Json[] }[]; totals: Json }[])[0]
    assert.deepEqual(monday?.meals[0]?.items[0]?.allergens, ['celery'])
    assert.equal(monday?.totals.energyKcal, 430)
    // Beşiktaş öğrencisi (s9) kendi kampüs menüsü olmadığından bütün kampüs menüsünü görür.
    const own = ok(await get(MY, student)).menus as Json[]
    assert.deepEqual(
      own.map((menu) => menu.id),
      [all.id],
    )
    assert.deepEqual(ok(await get(`${MY}?weekStart=${NEXT}`, student)).menus, [])
    assertError(await get(`${MY}?weekStart=2026-13-01`, student), 400)
  })

  test('DOM-FIN-157: başka kurumun menüsü 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bMenu = await menuWith(b)
    const bUrl = menuUrl(bMenu.id)
    assertError(await get(bUrl, a.admin), 404)
    assertError(await patch(bUrl, a.admin, { slots: [lunch(WEEK, [yogurt])] }, bMenu.version), 404)
    assertError(await command(`${bUrl}/publish`, a.admin, bMenu.version), 404)
    assertError(await command(`${bUrl}/unpublish`, a.admin, bMenu.version), 404)
    assertError(await remove(bUrl, a.admin, bMenu.version), 404)
    assert.equal((await get(BASE, a.admin)).json().meta.total, 0)
    assertError(await post(BASE, a.admin, { weekStart: WEEK, institutionId: b.id }), 400)
    assertError(
      await post(BASE, a.admin, { weekStart: NEXT, copyFromMenuId: bMenu.id }),
      422,
      'meal_menu_source_not_found',
    )
    assertError(
      await patch(SETTINGS, a.admin, { mealKinds: ['lunch', 'snack'], institutionId: b.id }, 1),
      400,
    )
    ok(await patch(SETTINGS, a.admin, { mealKinds: ['lunch', 'snack'] }, 1))
    assert.deepEqual(ok(await get(SETTINGS, b.admin)).mealKinds, ['lunch'])
    assert.equal(
      (await db.select().from(mealMenuSettings).where(eq(mealMenuSettings.institutionId, b.id)))
        .length,
      0,
    )
    ok(await command(`${bUrl}/publish`, b.admin, bMenu.version))
    // Aynı öğrenci kimliği (s1) B'de de var; A'nın velisi B'nin menüsünü görmez.
    const aParent = await signInAs(
      app,
      await createMember(app, a.id, 'veli', [{ kind: 'child', recordId: 's1' }]),
    )
    assert.deepEqual(ok(await get(MY, aParent)).menus, [])
    const [bRow] = await menuRows(b.id)
    assert.equal(bRow?.status, 'published')
    assert.equal(bRow?.archivedAt, null)
    assert.equal((await itemRows(b.id)).filter((row) => row.archivedAt === null).length, 2)
  })
})
