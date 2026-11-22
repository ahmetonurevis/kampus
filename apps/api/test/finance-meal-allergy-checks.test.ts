import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { mealAllergyChecks } from '../src/db/schema/finance-meal-allergy-checks.ts'
import { healthAccessReasons } from '../src/db/schema/finance-health-access.ts'
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
 * Yemekhane alerji uyarısı uçları (DOM-FIN-162; ON-151; K-541…K-543; H-117). Her test kendi
 * kurumunu kurar. FIXED_NOW 2026-10-06T09:00Z: Europe/Istanbul günü 2026-10-06 salı, hafta
 * 2026-10-05.
 */

const BASE = '/api/v1/finance/meal-allergy-checks'
const OPTIONS = `${BASE}/options`
const ACKS = `${BASE}/acknowledgements`
const MENUS = '/api/v1/finance/meal-menus'
const TODAY = '2026-10-06'
const WEEK = '2026-10-05'
const SECRETS = ['Kivi', 'Penisilin', 'Astım', 'Ventolin']

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-162: yemekhane alerji uyarısı uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.151.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST' | 'PATCH',
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
  /** Servis listesi erişim gerekçesi ister (DOM-FIN-156). */
  const roster = (query: string, cookie: string, code = 'other', note = 'Yemek servisi kontrolü') =>
    call('GET', `${BASE}?${query}`, cookie, undefined, {
      'x-access-reason': code,
      ...(code === 'other' ? { 'x-access-reason-note': encodeURIComponent(note) } : {}),
    })
  const post = (url: string, cookie: string | null, body: unknown, key: string = randomUUID()) =>
    call('POST', url, cookie, body, { 'idempotency-key': key })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  /**
   * Kurum: kampüs `b-1` (7-A, 8-A) ve `b-2` (7-B). Deniz (`s-1`, 7-A), Ece (`s-2`, 7-A), Mert
   * (`s-3`, 7-B), ayrılmış Can (`s-4`, 7-A), Elif (`s-5`, 8-A). Bütün kampüs menüsü bugün öğlen
   * mercimek çorbası (kereviz), sütlü pilav (süt) ve fındıklı kek (gluten, yumurta, fındık).
   */
  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.151.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    const student = (id: string, name: string, classId: string, isActive = true) => ({
      collection: 'students' as const,
      id,
      data: { id, name, classId, isActive },
    })
    const classroom = (id: string, grade: number, branchId: string) => ({
      collection: 'classes' as const,
      id,
      data: { id, name: id, grade, level: `${String(grade)}. Sınıf`, branchId, teacherId: 't-1' },
    })
    await insertMissingRecords(
      db,
      created.id,
      [
        { collection: 'branches' as const, id: 'b-1', data: { id: 'b-1', name: 'Kadıköy' } },
        { collection: 'branches' as const, id: 'b-2', data: { id: 'b-2', name: 'Beşiktaş' } },
        classroom('7-A', 7, 'b-1'),
        classroom('7-B', 7, 'b-2'),
        classroom('8-A', 8, 'b-1'),
        student('s-1', 'Deniz Yılmaz', '7-A'),
        student('s-2', 'Ece Yılmaz', '7-A'),
        student('s-3', 'Mert Kaya', '7-B'),
        student('s-4', 'Can Ayrılan', '7-A', false),
        student('s-5', 'Elif Demir', '8-A'),
      ],
      FIXED_NOW,
    )
    const admin = await signInAs(app, created.admin)
    const deskMember = await createMember(app, created.id, 'onburo')
    return {
      id: created.id,
      admin,
      desk: await signInAs(app, deskMember),
      teacher: await signInAs(app, await createMember(app, created.id, 'ogretmen')),
      parent: await signInAs(
        app,
        await createMember(app, created.id, 'veli', [{ kind: 'child', recordId: 's-1' }]),
      ),
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  const soup = { name: 'Mercimek çorbası', allergens: ['celery'], nutrition: null }
  const pilaf = { name: 'Sütlü pilav', allergens: ['milk'], nutrition: null }
  const cake = { name: 'Fındıklı kek', allergens: ['gluten', 'eggs', 'nuts'], nutrition: null }

  /** Bütün kampüs (ya da verilen kampüs) için bugünün öğle yemeğini yayımlar. */
  async function publishMenu(t: Tenant, items: Json[] = [soup, pilaf, cake], branchId?: string) {
    const created = ok(
      await post(MENUS, t.admin, {
        weekStart: WEEK,
        ...(branchId === undefined ? {} : { branchId }),
      }),
      201,
    )
    const filled = ok(
      await call(
        'PATCH',
        `${MENUS}/${String(created.id)}`,
        t.admin,
        { slots: [{ menuDate: TODAY, mealKind: 'lunch', items }] },
        { 'if-match': `"${String(created.version)}"` },
      ),
    )
    return ok(
      await call('POST', `${MENUS}/${String(created.id)}/publish`, t.admin, undefined, {
        'if-match': `"${String(filled.version)}"`,
      }),
    )
  }
  const profile = (t: Tenant, studentId: string, body: Json) =>
    call('PATCH', `/api/v1/students/${studentId}/health-profile`, t.admin, {
      legalBasis: 'explicit_consent',
      version: 1,
      ...body,
    })
  async function allergies(t: Tenant) {
    ok(
      await profile(t, 's-1', {
        allergies: [
          { name: 'Süt', severity: 'moderate' },
          { name: 'Kivi', severity: 'mild' },
          { name: 'Penisilin', severity: 'severe' },
        ],
        chronicConditions: [{ name: 'Astım' }],
        medications: [{ name: 'Ventolin' }],
      }),
    )
    ok(await profile(t, 's-2', { allergies: [{ name: 'Balık', severity: 'severe' }] }))
    ok(await profile(t, 's-3', { allergies: [{ name: 'Fındık', severity: 'severe' }] }))
    ok(await profile(t, 's-4', { allergies: [{ name: 'Süt', severity: 'severe' }] }))
    ok(await profile(t, 's-5', { allergies: [{ name: 'Yumurta', severity: 'mild' }] }))
  }
  const acknowledge = (t: Tenant, extra: Json = {}, key?: string, cookie = t.desk) =>
    post(ACKS, cookie, { studentId: 's-1', serviceDate: TODAY, mealKind: 'lunch', ...extra }, key)
  const checkRows = (institutionId: string) =>
    db.select().from(mealAllergyChecks).where(eq(mealAllergyChecks.institutionId, institutionId))
  const audits = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  test('kimliksiz istek 401', async () => {
    assertError(await get(OPTIONS, null), 401)
    assertError(await get(`${BASE}?mealKind=lunch&classId=7-A`, null), 401)
    assertError(await post(ACKS, null, {}), 401)
  })

  test('DOM-FIN-162: rol süzgeci; öğretmen ve aile 403; finance ya da meals kapalı 403 (K-543)', async () => {
    const t = await institution()
    for (const cookie of [t.teacher, t.parent]) {
      assertError(await get(OPTIONS, cookie), 403)
      assertError(await roster('mealKind=lunch&classId=7-A', cookie), 403)
      assertError(await acknowledge(t, {}, undefined, cookie), 403)
    }
    ok(await get(OPTIONS, t.desk))
    for (const modules of [{ finance: false }, { meals: false }] as Record<string, boolean>[]) {
      const closed = await institution({ enabledModules: modules })
      assertError(await get(OPTIONS, closed.admin), 403, 'module_disabled')
      assertError(await roster('mealKind=lunch&classId=7-A', closed.desk), 403, 'module_disabled')
      assertError(await acknowledge(closed), 403, 'module_disabled')
      assert.equal((await checkRows(closed.id)).length, 0)
    }
  })

  test('DOM-FIN-162: seçenekler sınıf, düzey, öğün ve gün aralığı döner; sağlık bilgisi yok', async () => {
    const t = await institution()
    const options = ok(await get(OPTIONS, t.desk))
    assert.equal(options.today, TODAY)
    assert.equal(options.lastDate, '2026-10-13')
    assert.deepEqual(options.mealKinds, ['lunch'])
    assert.deepEqual(options.grades, [7, 8])
    assert.deepEqual(
      (options.classes as Json[]).map((item) => [item.classId, item.grade]),
      [
        ['7-A', 7],
        ['7-B', 7],
        ['8-A', 8],
      ],
    )
    assert.equal((await audits(t.id, 'finance.meal_allergy.roster_read')).length, 0)
  })

  test('DOM-FIN-162: liste gerekçe ister; sorgu ve gün doğrulanır (K-541)', async () => {
    const t = await institution()
    assertError(
      await get(`${BASE}?mealKind=lunch&classId=7-A`, t.desk),
      400,
      'health_access_reason_required',
    )
    assertError(await roster('mealKind=lunch', t.desk), 400)
    assertError(await roster('mealKind=lunch&classId=7-A&grade=7', t.desk), 400)
    assertError(await roster('mealKind=dinner&classId=7-A', t.desk), 400)
    assertError(await roster('mealKind=lunch&classId=7-A&x=1', t.desk), 400)
    assertError(
      await roster('mealKind=lunch&classId=7-A&serviceDate=2026-10-05', t.desk),
      422,
      'meal_allergy_date_past',
    )
    assertError(
      await roster('mealKind=lunch&classId=7-A&serviceDate=2026-10-14', t.desk),
      422,
      'meal_allergy_date_too_far',
    )
    assertError(await roster('mealKind=lunch&classId=yok', t.desk), 404)
    assert.equal((await audits(t.id, 'finance.meal_allergy.roster_read')).length, 0)
  })

  test('DOM-FIN-162: yalnız uyarılı öğrenciler; kalem başına alerjen; eşlenemeyen elle kontrol; ek sağlık ayrıntısı yok (K-541, K-542)', async () => {
    const t = await institution()
    await allergies(t)
    await publishMenu(t)
    const response = await roster('mealKind=lunch&classId=7-A', t.desk, 'first_aid')
    assert.equal(response.headers['cache-control'], 'no-store')
    const data = ok(response)
    assert.equal(data.serviceDate, TODAY)
    assert.equal(data.className, '7-A')
    assert.equal(data.studentCount, 2)
    assert.equal(data.studentsWithoutMenu, 0)
    const students = data.students as Json[]
    // Ece'nin balık alerjisi menüde yok; ayrılmış Can listelenmez.
    assert.deepEqual(
      students.map((row) => row.studentId),
      ['s-1'],
    )
    const [deniz] = students
    assert.equal(deniz?.studentName, 'Deniz Yılmaz')
    assert.equal(deniz?.severity, 'moderate')
    assert.deepEqual(deniz?.conflicts, [
      { itemName: 'Sütlü pilav', position: 1, allergens: ['milk'], severity: 'moderate' },
    ])
    assert.deepEqual(deniz?.unmatched, [{ allergyName: 'Kivi', severity: 'mild', partial: false }])
    assert.equal(deniz?.acknowledgement, null)
    const raw = JSON.stringify(data)
    for (const secret of ['Penisilin', 'Astım', 'Ventolin', 'Süt"'])
      assert.ok(!raw.includes(secret))

    const reads = await audits(t.id, 'finance.meal_allergy.roster_read')
    assert.equal(reads.length, 1)
    assert.equal(reads[0]?.entityId, 's-1')
    assert.deepEqual(reads[0]?.changes, { fields: ['conflicts', 'unmatched'] })
    for (const secret of SECRETS) assert.ok(!JSON.stringify(reads).includes(secret), secret)
    const reasons = await db
      .select()
      .from(healthAccessReasons)
      .where(eq(healthAccessReasons.institutionId, t.id))
    assert.deepEqual(
      reasons.map((row) => [row.studentId, row.reasonCode]),
      [['s-1', 'first_aid']],
    )
  })

  test('DOM-FIN-162: sınıf düzeyi seçimi; kampüs menüsü öncelikli; menüsü olmayan sayılır', async () => {
    const t = await institution()
    await allergies(t)
    // Beşiktaş (7-B) kendi menüsünde fındıksız yemek yer; Kadıköy'de menü yok.
    await publishMenu(t, [soup], 'b-2')
    const onlyB2 = ok(await roster('mealKind=lunch&grade=7', t.admin))
    assert.equal(onlyB2.grade, 7)
    assert.equal(onlyB2.classId, null)
    assert.equal(onlyB2.studentCount, 3)
    assert.equal(onlyB2.studentsWithoutMenu, 2)
    assert.deepEqual(onlyB2.students, [])
    // Kimse listelenmese de okuma liste başına denetimdedir.
    const empty = await audits(t.id, 'finance.meal_allergy.roster_read')
    assert.equal(empty.length, 1)
    assert.equal(empty[0]?.entityType, 'meal_allergy_rosters')
    assert.equal(empty[0]?.entityId, `${TODAY}:lunch:grade-7`)

    await publishMenu(t)
    const both = ok(await roster('mealKind=lunch&grade=7', t.admin))
    assert.equal(both.studentsWithoutMenu, 0)
    assert.deepEqual(
      (both.students as Json[]).map((row) => [row.className, row.studentId]),
      [['7-A', 's-1']],
    )
    assert.deepEqual(
      (both.menus as Json[]).map((menu) => menu.branchName),
      [null, 'Beşiktaş'],
    )
    const eighth = ok(await roster('mealKind=lunch&grade=8', t.admin))
    assert.deepEqual(
      (eighth.students as Json[]).map((row) => [row.studentId, row.severity, row.conflicts]),
      [
        [
          's-5',
          'mild',
          [{ itemName: 'Fındıklı kek', position: 2, allergens: ['eggs'], severity: 'mild' }],
        ],
      ],
    )
    // Gelecek gün ve başka öğünde yemek yok.
    const tomorrow = ok(await roster('mealKind=lunch&classId=7-A&serviceDate=2026-10-07', t.admin))
    assert.equal(tomorrow.studentsWithoutMenu, 2)
    assert.deepEqual(ok(await roster('mealKind=snack&classId=7-A', t.admin)).students, [])
  })

  test('DOM-FIN-162: okunamayan sağlık profili sessizce düşmez, elle kontrol işaretlenir', async () => {
    const t = await institution()
    await allergies(t)
    await publishMenu(t)
    await db.execute(
      sql`update student_health_profiles set content_ciphertext = 'bozuk' where institution_id = ${t.id} and student_id = 's-2'`,
    )
    const data = ok(await roster('mealKind=lunch&classId=7-A', t.desk))
    const ece = (data.students as Json[]).find((row) => row.studentId === 's-2')
    assert.equal(ece?.profileUnreadable, true)
    assert.equal(ece?.severity, null)
    assert.deepEqual(ece?.conflicts, [])
    const reads = await audits(t.id, 'finance.meal_allergy.roster_read')
    assert.deepEqual(reads.find((row) => row.entityId === 's-2')?.changes, {
      fields: ['profileUnreadable'],
    })
    ok(await acknowledge(t, { studentId: 's-2' }), 201)
  })

  test('DOM-FIN-162: taslak menü karşılaştırılmaz', async () => {
    const t = await institution()
    await allergies(t)
    const draft = ok(await post(MENUS, t.admin, { weekStart: WEEK }), 201)
    ok(
      await call(
        'PATCH',
        `${MENUS}/${String(draft.id)}`,
        t.admin,
        { slots: [{ menuDate: TODAY, mealKind: 'lunch', items: [pilaf] }] },
        { 'if-match': `"${String(draft.version)}"` },
      ),
    )
    const data = ok(await roster('mealKind=lunch&classId=7-A', t.desk))
    assert.equal(data.studentsWithoutMenu, 2)
    assert.deepEqual(data.students, [])
    assertError(await acknowledge(t), 422, 'meal_allergy_ack_no_warning')
  })

  test('DOM-FIN-162: görevli onayı bir kez yazılır, değişmez, listede görünür; mükerrer istek tek satır (K-543)', async () => {
    const t = await institution()
    await allergies(t)
    await publishMenu(t)
    const key = randomUUID()
    const first = await acknowledge(t, {}, key)
    const created = ok(first, 201)
    assert.equal(created.studentId, 's-1')
    assert.equal(created.serviceDate, TODAY)
    assert.equal(created.mealKind, 'lunch')
    assert.equal(created.acknowledgedAt, FIXED_NOW.toISOString())
    assert.equal(typeof created.acknowledgedByName, 'string')
    const replay = await acknowledge(t, {}, key)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(await acknowledge(t, {}, undefined, t.admin), 409, 'meal_allergy_ack_exists')
    const rows = await checkRows(t.id)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.id, created.id)

    const listed = ok(await roster('mealKind=lunch&classId=7-A', t.admin))
    const ack = (listed.students as Json[])[0]?.acknowledgement as Json
    assert.equal(ack.id, created.id)
    assert.equal(ack.acknowledgedByName, created.acknowledgedByName)

    const audit = await audits(t.id, 'finance.meal_allergy.acknowledge')
    assert.equal(audit.length, 1)
    assert.deepEqual(audit[0]?.changes, { fields: ['studentId', 'serviceDate', 'mealKind'] })
    for (const secret of SECRETS) assert.ok(!JSON.stringify(audit).includes(secret), secret)

    // Kayıt değiştirilmez ve silinmez (tetikleyici).
    await assert.rejects(
      db.execute(sql`update meal_allergy_checks set meal_kind = 'snack' where id = ${created.id}`),
    )
    await assert.rejects(db.execute(sql`delete from meal_allergy_checks where id = ${created.id}`))
    assert.equal((await checkRows(t.id))[0]?.mealKind, 'lunch')
  })

  test('DOM-FIN-162: onay doğrulaması 400 ve 422; kayıt açılmaz (K-543)', async () => {
    const t = await institution()
    await allergies(t)
    await publishMenu(t)
    assertError(await acknowledge(t, { note: 'verildi' }), 400)
    assertError(await acknowledge(t, { mealKind: 'dinner' }), 400)
    assertError(
      await call('POST', ACKS, t.desk, { studentId: 's-1', serviceDate: TODAY, mealKind: 'lunch' }),
      400,
    )
    assertError(await acknowledge(t, { studentId: 'yok' }), 422, 'meal_allergy_student_not_found')
    assertError(await acknowledge(t, { studentId: 's-4' }), 422, 'meal_allergy_student_inactive')
    assertError(
      await acknowledge(t, { serviceDate: '2026-10-07' }),
      422,
      'meal_allergy_ack_not_today',
    )
    assertError(await acknowledge(t, { studentId: 's-2' }), 422, 'meal_allergy_ack_no_warning')
    assertError(await acknowledge(t, { mealKind: 'snack' }), 422, 'meal_allergy_ack_no_warning')
    assert.equal((await checkRows(t.id)).length, 0)
  })

  test('DOM-FIN-162: başka kurumun sınıfı ve öğrencisi 404/422; B değişmez; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    await insertMissingRecords(
      db,
      b.id,
      [
        {
          collection: 'classes' as const,
          id: '9-Z',
          data: {
            id: '9-Z',
            name: '9-Z',
            grade: 9,
            level: '9. Sınıf',
            branchId: 'b-1',
            teacherId: 't-1',
          },
        },
        {
          collection: 'students' as const,
          id: 's-b',
          data: { id: 's-b', name: 'B Öğrencisi', classId: '9-Z', isActive: true },
        },
      ],
      FIXED_NOW,
    )
    await allergies(b)
    ok(await profile(b, 's-b', { allergies: [{ name: 'Süt', severity: 'severe' }] }))
    await publishMenu(b)
    const bCheck = ok(await acknowledge(b), 201)

    assertError(await roster('mealKind=lunch&classId=9-Z', a.admin), 404)
    const aGrade = ok(await roster('mealKind=lunch&grade=9', a.admin))
    assert.deepEqual(aGrade.students, [])
    assert.equal(aGrade.studentCount, 0)
    const aClass = ok(await roster('mealKind=lunch&classId=7-A', a.admin))
    assert.deepEqual(aClass.students, [])
    assert.deepEqual(aClass.menus, [])
    const aOptions = ok(await get(OPTIONS, a.admin))
    assert.ok(!(aOptions.classes as Json[]).some((item) => item.classId === '9-Z'))
    assertError(await acknowledge(a, { studentId: 's-b' }), 422, 'meal_allergy_student_not_found')
    assertError(await acknowledge(a, { institutionId: b.id }), 400)
    assert.equal((await checkRows(a.id)).length, 0)
    const bRows = await checkRows(b.id)
    assert.equal(bRows.length, 1)
    assert.equal(bRows[0]?.id, bCheck.id)
  })
})
