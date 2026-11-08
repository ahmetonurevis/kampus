import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'
import { courseNameKey } from '@kampus/school-core/lib/courses.ts'
import { evenMonthlySplit } from '@kampus/school-core/lib/finance-budget.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { academicYears } from '../src/db/schema/academic-years.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { courses } from '../src/db/schema/courses.ts'
import {
  budgetItems,
  budgetLines,
  budgetPeriods,
  costCenters,
} from '../src/db/schema/finance-budget.ts'
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
 * Maliyet merkezi, bütçe kalemi, bütçe dönemi ve bütçe satırı uçları (DOM-FIN-062; ON-241,
 * ON-242). Her test kendi kurumunu kurar; okulda seed kampüsleri, dil okulunda bir kur vardır.
 * FIXED_NOW 2026-10-06.
 */

const SEED = createSeed(FIXED_NOW)
const CAMPUS = SEED.branches[0]?.id ?? ''
const CAMPUS_2 = SEED.branches[1]?.id ?? ''
const CENTERS = '/api/v1/finance/cost-centers'
const ITEMS = '/api/v1/finance/budget-items'
const PERIODS = '/api/v1/finance/budget-periods'

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-062: bütçe ve maliyet merkezi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.62.0.1'

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
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
  async function ok(response: Response, status = 200): Promise<Json> {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.62.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      created.id,
      SEED.branches.map((data) => ({ collection: 'branches' as const, id: data.id, data })),
      FIXED_NOW,
    )
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))

  const center = async (t: Tenant, body: Json) =>
    ok(await call('POST', CENTERS, t.admin, body), 201)
  const item = async (t: Tenant, body: Json) => ok(await call('POST', ITEMS, t.admin, body), 201)
  const period = async (t: Tenant, body: Json = { name: '2026–2027', academicYear: 2026 }) =>
    ok(await call('POST', PERIODS, t.admin, body), 201)
  const line = (t: Tenant, periodId: unknown, body: Json) =>
    call('POST', `${PERIODS}/${String(periodId)}/lines`, t.admin, body)
  const setStatus = (t: Tenant, p: Json, verb: 'open' | 'close') =>
    call('POST', `${PERIODS}/${String(p.id)}/${verb}`, t.admin, undefined, ifMatch(p.version))

  /** Kampüs merkezi, gelir ve gider kalemi, taslak dönem. */
  async function ready() {
    const t = await institution()
    const campus = await center(t, {
      code: 'kad',
      name: 'Kadıköy',
      type: 'campus',
      campusId: CAMPUS,
    })
    const income = await item(t, {
      code: 'G-100',
      name: 'Öğrenim geliri',
      kind: 'income',
      feeKind: 'tuition',
    })
    const expense = await item(t, { code: 'P-100', name: 'Personel', kind: 'expense' })
    const draft = await period(t)
    return { ...t, campus, income, expense, draft }
  }
  const tableRows = (
    table: typeof costCenters | typeof budgetItems | typeof budgetPeriods | typeof budgetLines,
    institutionId: string,
  ) => db.select().from(table).where(eq(table.institutionId, institutionId))
  const audits = (institutionId: string, action: string) =>
    db
      .select({ entityId: auditLog.entityId })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  test('kimliksiz istek 401', async () => {
    assertError(await get(CENTERS, null), 401)
    assertError(await call('POST', ITEMS, null, {}), 401)
    assertError(await get(PERIODS, null), 401)
  })

  test('DOM-FIN-062: bütçeyi yalnız yönetici görür; ön büro, öğretmen, veli, öğrenci 403 (K-60)', async () => {
    const t = await ready()
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(CENTERS, cookie), 403)
      assertError(await get(`${PERIODS}/${String(t.draft.id)}/lines`, cookie), 403)
      assertError(
        await call('POST', ITEMS, cookie, { code: 'X', name: 'Gelir', kind: 'income' }),
        403,
      )
    }
    assert.equal((await tableRows(budgetItems, t.id)).length, 2)
  })

  test('DOM-FIN-062: finance modülü kapalıyken bütçe uçları 403 module_disabled (K-59)', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(CENTERS, closed.admin), 403, 'module_disabled')
    assertError(await get(PERIODS, closed.admin), 403, 'module_disabled')
    assertError(
      await call('POST', ITEMS, closed.admin, { code: 'X', name: 'Gelir', kind: 'income' }),
      403,
      'module_disabled',
    )
  })

  test('DOM-FIN-062: maliyet merkezi hiyerarşisi kurulur, listelenir, düzeltilir; denetime yazılır', async () => {
    const t = await institution()
    const campus = await center(t, {
      code: 'kad',
      name: 'Kadıköy Kampüsü',
      type: 'campus',
      campusId: CAMPUS,
    })
    assert.equal(campus.code, 'KAD')
    assert.equal(campus.campusName, SEED.branches[0]?.name)
    const middle = await center(t, {
      code: 'ORT',
      name: 'Ortaokul',
      type: 'program',
      parentId: campus.id,
    })
    const grade = await center(t, {
      code: 'ORT-7',
      name: '7. sınıflar',
      type: 'program',
      parentId: middle.id,
      gradeLevel: 7,
    })
    assert.equal(grade.path, 'KAD / ORT / ORT-7')
    await center(t, { code: 'BT', name: 'Bilgi İşlem', type: 'unit' })

    const list = (await get(`${CENTERS}?pageSize=2`, t.admin)).json()
    assert.equal(list.meta.total, 4)
    assert.deepEqual(
      (list.data as Json[]).map((row) => row.code),
      ['BT', 'KAD'],
    )
    const programs = (await get(`${CENTERS}?type=program&q=sinif`, t.admin)).json()
    assert.deepEqual(
      (programs.data as Json[]).map((row) => row.code),
      ['ORT-7'],
    )
    assertError(await get(`${CENTERS}?bilinmeyen=1`, t.admin), 400)

    assertError(
      await call(
        'PATCH',
        `${CENTERS}/${String(campus.id)}`,
        t.admin,
        { isActive: false },
        ifMatch(campus.version),
      ),
      422,
      'cost_center_has_active_children',
    )
    assertError(
      await call(
        'PATCH',
        `${CENTERS}/${String(campus.id)}`,
        t.admin,
        { parentId: grade.id },
        ifMatch(campus.version),
      ),
      422,
      'cost_center_cycle',
    )
    assertError(
      await call(
        'PATCH',
        `${CENTERS}/${String(campus.id)}`,
        t.admin,
        { name: 'Eski' },
        ifMatch(99),
      ),
      409,
      'version_conflict',
    )
    assertError(
      await call(
        'PATCH',
        `${CENTERS}/${String(campus.id)}`,
        t.admin,
        { type: 'unit' },
        ifMatch(campus.version),
      ),
      400,
    )
    const renamed = await ok(
      await call(
        'PATCH',
        `${CENTERS}/${String(grade.id)}`,
        t.admin,
        { name: '7. sınıf düzeyi', isActive: false },
        ifMatch(grade.version),
      ),
    )
    assert.equal(renamed.isActive, false)
    assert.equal(renamed.version, 2)
    const inactive = (await get(`${CENTERS}?status=inactive`, t.admin)).json()
    assert.deepEqual(
      (inactive.data as Json[]).map((row) => row.id),
      [grade.id],
    )
    assert.equal((await audits(t.id, 'cost_center.create')).length, 4)
    assert.deepEqual(await audits(t.id, 'cost_center.update'), [{ entityId: grade.id }])
  })

  test('DOM-FIN-062: kampüs, kod ve bağ kuralları; reddedilen istek kayıt açmaz', async () => {
    const t = await institution()
    await center(t, { code: 'KAD', name: 'Kadıköy', type: 'campus', campusId: CAMPUS })
    const before = await tableRows(costCenters, t.id)
    assertError(
      await call('POST', CENTERS, t.admin, {
        code: 'KAD2',
        name: 'Kadıköy',
        type: 'campus',
        campusId: CAMPUS,
      }),
      409,
      'cost_center_campus_taken',
    )
    assertError(
      await call('POST', CENTERS, t.admin, { code: 'kad', name: 'Başka', type: 'unit' }),
      409,
      'cost_center_code_taken',
    )
    assertError(
      await call('POST', CENTERS, t.admin, {
        code: 'YOK',
        name: 'Yok',
        type: 'campus',
        campusId: 'yok',
      }),
      422,
      'cost_center_campus_not_found',
    )
    assertError(
      await call('POST', CENTERS, t.admin, {
        code: 'K',
        name: 'Kur',
        type: 'program',
        courseId: randomUUID(),
      }),
      422,
      'cost_center_link_unavailable',
    )
    assertError(
      await call('POST', CENTERS, t.admin, { code: 'K', name: 'Kampüs', type: 'campus' }),
      400,
    )
    assertError(
      await call('POST', CENTERS, t.admin, {
        code: 'K',
        name: 'Alt',
        type: 'unit',
        parentId: randomUUID(),
      }),
      422,
      'cost_center_parent_not_found',
    )
    assert.deepEqual(await tableRows(costCenters, t.id), before)
    await center(t, { code: 'ATA', name: 'Ataşehir', type: 'campus', campusId: CAMPUS_2 })
  })

  test('DOM-FIN-062: dil okulunda program kura bağlanır, sınıf düzeyi 422', async () => {
    const t = await institution({ type: 'language_school' })
    const courseId = randomUUID()
    await db.insert(courses).values({
      institutionId: t.id,
      id: courseId,
      name: 'Genel İngilizce B1',
      nameKey: courseNameKey('Genel İngilizce B1'),
      language: 'en',
      level: 'B1',
      totalHours: 120,
      weeklyHours: 6,
      sessionMinutes: 45,
      minLearners: 4,
      maxLearners: 12,
      certified: false,
      status: 'draft',
      eOzelApproval: 'not_submitted',
    })
    const program = await center(t, { code: 'B1', name: 'B1 kurları', type: 'program', courseId })
    assert.equal(program.courseName, 'Genel İngilizce B1')
    assertError(
      await call('POST', CENTERS, t.admin, {
        code: 'B1-2',
        name: 'B1 tekrar',
        type: 'program',
        courseId,
      }),
      409,
      'cost_center_program_taken',
    )
    assertError(
      await call('POST', CENTERS, t.admin, {
        code: 'D7',
        name: 'Düzey',
        type: 'program',
        gradeLevel: 7,
      }),
      422,
      'cost_center_link_unavailable',
    )
  })

  test('DOM-FIN-062: bütçe kalemleri; ücret türü tekil, kullanılan kalemin türü değişmez (K-65)', async () => {
    const t = await ready()
    assertError(
      await call('POST', ITEMS, t.admin, {
        code: 'G-101',
        name: 'Öğrenim 2',
        kind: 'income',
        feeKind: 'tuition',
      }),
      409,
      'budget_item_fee_kind_taken',
    )
    assertError(
      await call('POST', ITEMS, t.admin, {
        code: 'x',
        name: 'Gider',
        kind: 'expense',
        feeKind: 'meal',
      }),
      400,
    )
    const list = (await get(`${ITEMS}?kind=expense`, t.admin)).json()
    assert.deepEqual(
      (list.data as Json[]).map((row) => row.code),
      ['P-100'],
    )
    await ok(
      await line(t, t.draft.id, {
        costCenterId: t.campus.id,
        itemId: t.income.id,
        amountCents: 100,
      }),
      201,
    )
    assertError(
      await call(
        'PATCH',
        `${ITEMS}/${String(t.income.id)}`,
        t.admin,
        { kind: 'expense', feeKind: null },
        ifMatch(t.income.version),
      ),
      422,
      'budget_item_in_use',
    )
    const updated = await ok(
      await call(
        'PATCH',
        `${ITEMS}/${String(t.expense.id)}`,
        t.admin,
        { name: 'Personel gideri', isActive: false },
        ifMatch(t.expense.version),
      ),
    )
    assert.equal(updated.isActive, false)
    assertError(
      await line(t, t.draft.id, {
        costCenterId: t.campus.id,
        itemId: t.expense.id,
        amountCents: 100,
      }),
      422,
      'budget_item_inactive',
    )
  })

  test('DOM-FIN-062: dönem eğitim yılının günlerini kopyalar (K-63); ad tekil, ters ve uzun dönem 422', async () => {
    const t = await institution()
    await db
      .insert(academicYears)
      .values({
        institutionId: t.id,
        startYear: 2030,
        startDate: '2030-09-09',
        endDate: '2031-08-31',
        status: 'planned',
      })
      .onConflictDoNothing()
    const fromYear = await period(t, { name: '2030 bütçesi', academicYear: 2030 })
    assert.deepEqual([fromYear.startDate, fromYear.endDate], ['2030-09-09', '2031-08-31'])
    const fallback = await period(t, { name: '2031 bütçesi', academicYear: 2031 })
    assert.deepEqual([fallback.startDate, fallback.endDate], ['2031-09-01', '2032-08-31'])
    assert.equal((fallback.months as string[]).length, 12)
    assert.equal(fallback.status, 'draft')
    const ranged = await period(t, {
      name: 'Mali yıl 2027',
      startDate: '2027-01-01',
      endDate: '2027-12-31',
    })
    assert.equal(ranged.academicYear, null)
    const before = await tableRows(budgetPeriods, t.id)
    assertError(
      await call('POST', PERIODS, t.admin, { name: '2030 bütçesi', academicYear: 2032 }),
      409,
      'budget_period_name_taken',
    )
    assertError(
      await call('POST', PERIODS, t.admin, {
        name: 'Ters',
        startDate: '2027-02-01',
        endDate: '2027-01-01',
      }),
      422,
      'budget_period_dates_invalid',
    )
    assertError(
      await call('POST', PERIODS, t.admin, {
        name: 'Uzun',
        startDate: '2027-01-01',
        endDate: '2028-01-02',
      }),
      422,
      'budget_period_too_long',
    )
    assertError(await call('POST', PERIODS, t.admin, { name: 'Boş' }), 400)
    assert.deepEqual(await tableRows(budgetPeriods, t.id), before)
    const list = (await get(`${PERIODS}?status=draft`, t.admin)).json()
    assert.equal(list.meta.total, 3)
  })

  test('DOM-FIN-062: dönem taslak → açık → kapalı; açık dönemler örtüşmez, kapalı dönem değişmez (K-61, K-62)', async () => {
    const t = await ready()
    const lineRow = await ok(
      await line(t, t.draft.id, {
        costCenterId: t.campus.id,
        itemId: t.income.id,
        amountCents: 1_000_000,
      }),
      201,
    )
    const opened = await ok(await setStatus(t, t.draft, 'open'))
    assert.equal(opened.status, 'open')
    assert.equal(opened.openedAt, FIXED_NOW.toISOString())
    assertError(await setStatus(t, opened, 'open'), 422, 'budget_period_not_draft')

    const overlapping = await period(t, {
      name: 'Takvim yılı',
      startDate: '2027-01-01',
      endDate: '2027-12-31',
    })
    assertError(await setStatus(t, overlapping, 'open'), 422, 'budget_period_overlap')
    assertError(
      await call(
        'PATCH',
        `${PERIODS}/${String(opened.id)}`,
        t.admin,
        { academicYear: 2027 },
        ifMatch(opened.version),
      ),
      422,
      'budget_period_not_draft',
    )
    const renamed = await ok(
      await call(
        'PATCH',
        `${PERIODS}/${String(opened.id)}`,
        t.admin,
        { name: '2026–2027 ana bütçe' },
        ifMatch(opened.version),
      ),
    )

    const closed = await ok(await setStatus(t, renamed, 'close'))
    assert.equal(closed.status, 'closed')
    assertError(await setStatus(t, closed, 'close'), 422, 'budget_period_not_open')
    const linesBefore = await tableRows(budgetLines, t.id)
    assertError(
      await line(t, closed.id, { costCenterId: t.campus.id, itemId: t.expense.id, amountCents: 5 }),
      422,
      'budget_period_closed',
    )
    const lineUrl = `${PERIODS}/${String(closed.id)}/lines/${String(lineRow.id)}`
    assertError(
      await call('PATCH', lineUrl, t.admin, { amountCents: 5 }, ifMatch(lineRow.version)),
      422,
      'budget_period_closed',
    )
    assertError(
      await call('DELETE', lineUrl, t.admin, undefined, ifMatch(lineRow.version)),
      422,
      'budget_period_closed',
    )
    assertError(
      await call(
        'PATCH',
        `${PERIODS}/${String(closed.id)}`,
        t.admin,
        { name: 'Değişmez' },
        ifMatch(closed.version),
      ),
      422,
      'budget_period_closed',
    )
    assert.deepEqual(await tableRows(budgetLines, t.id), linesBefore)
    // Kapanan dönem artık örtüşmeye sayılmaz.
    assert.equal((await ok(await setStatus(t, overlapping, 'open'))).status, 'open')
    assert.deepEqual(
      (await audits(t.id, 'budget_period.close')).map((row) => row.entityId),
      [closed.id],
    )
  })

  test('DOM-FIN-062: dönemi yalnız yönetici açar ve kapatır', async () => {
    const t = await ready()
    const cookie = await member(t.id, 'onburo')
    assertError(
      await call(
        'POST',
        `${PERIODS}/${String(t.draft.id)}/open`,
        cookie,
        undefined,
        ifMatch(t.draft.version),
      ),
      403,
    )
    assertError(
      await call('POST', `${PERIODS}/${String(t.draft.id)}/open`, t.admin),
      400,
      'if_match_required',
    )
  })

  test('DOM-FIN-062: satır planlanan tutar ve aylık dağılım taşır; toplamlar hesaplanır (K-64)', async () => {
    const t = await ready()
    const periodId = String(t.draft.id)
    const monthly = evenMonthlySplit(1_200_001, 12)
    const income = await ok(
      await line(t, periodId, {
        costCenterId: t.campus.id,
        itemId: t.income.id,
        amountCents: 1_200_001,
        monthlyCents: monthly,
      }),
      201,
    )
    assert.deepEqual(income.monthlyCents, monthly)
    assert.equal(income.itemKind, 'income')
    assert.equal(income.costCenterCode, 'KAD')
    await ok(
      await line(t, periodId, {
        costCenterId: t.campus.id,
        itemId: t.expense.id,
        amountCents: 400_000,
      }),
      201,
    )
    assertError(
      await line(t, periodId, { costCenterId: t.campus.id, itemId: t.expense.id, amountCents: 1 }),
      409,
      'budget_line_exists',
    )
    assertError(
      await line(t, periodId, {
        costCenterId: t.campus.id,
        itemId: t.income.id,
        amountCents: 1,
        monthlyCents: [1],
      }),
      409,
    )
    const unit = await center(t, { code: 'BT', name: 'Bilgi İşlem', type: 'unit' })
    assertError(
      await line(t, periodId, {
        costCenterId: unit.id,
        itemId: t.expense.id,
        amountCents: 10,
        monthlyCents: [10],
      }),
      422,
      'budget_line_months_mismatch',
    )
    assertError(
      await line(t, periodId, {
        costCenterId: unit.id,
        itemId: t.expense.id,
        amountCents: 10,
        monthlyCents: evenMonthlySplit(11, 12),
      }),
      422,
      'budget_line_monthly_sum',
    )
    assertError(
      await line(t, periodId, {
        costCenterId: randomUUID(),
        itemId: t.expense.id,
        amountCents: 10,
      }),
      422,
      'cost_center_not_found',
    )
    assertError(
      await line(t, periodId, { costCenterId: unit.id, itemId: t.expense.id, amountCents: -1 }),
      400,
    )

    const detail = await ok(await get(`${PERIODS}/${periodId}`, t.admin))
    assert.equal(detail.incomeCents, 1_200_001)
    assert.equal(detail.expenseCents, 400_000)
    assert.equal(detail.balanceCents, 800_001)
    assert.equal(detail.lineCount, 2)

    const lines = (await get(`${PERIODS}/${periodId}/lines?kind=income`, t.admin)).json()
    assert.equal(lines.meta.total, 1)
    const searched = (await get(`${PERIODS}/${periodId}/lines?q=personel`, t.admin)).json()
    assert.deepEqual(
      (searched.data as Json[]).map((row) => row.itemCode),
      ['P-100'],
    )

    // Dağılımlı satır varken taslağın günleri değişmez.
    assertError(
      await call(
        'PATCH',
        `${PERIODS}/${periodId}`,
        t.admin,
        { academicYear: 2027 },
        ifMatch(t.draft.version),
      ),
      422,
      'budget_period_has_distribution',
    )
    const lineUrl = `${PERIODS}/${periodId}/lines/${String(income.id)}`
    assertError(
      await call('PATCH', lineUrl, t.admin, { amountCents: 5 }, ifMatch(income.version)),
      422,
      'budget_line_monthly_sum',
    )
    const updated = await ok(
      await call(
        'PATCH',
        lineUrl,
        t.admin,
        { amountCents: 5, monthlyCents: null },
        ifMatch(income.version),
      ),
    )
    assert.equal(updated.amountCents, 5)
    assert.equal(updated.monthlyCents, null)
    assertError(
      await call('DELETE', lineUrl, t.admin, undefined, ifMatch(income.version)),
      409,
      'version_conflict',
    )
    await ok(await call('DELETE', lineUrl, t.admin, undefined, ifMatch(updated.version)))
    assertError(await call('PATCH', lineUrl, t.admin, { amountCents: 6 }, ifMatch(3)), 404)
    // Kaldırılan satırın yerine aynı merkez ve kalemle yenisi eklenir.
    await ok(
      await line(t, periodId, { costCenterId: t.campus.id, itemId: t.income.id, amountCents: 7 }),
      201,
    )
    const after = await ok(await get(`${PERIODS}/${periodId}`, t.admin))
    assert.equal(after.incomeCents, 7)
    const moved = await ok(
      await call(
        'PATCH',
        `${PERIODS}/${periodId}`,
        t.admin,
        { startDate: '2027-01-01', endDate: '2027-12-31' },
        ifMatch(t.draft.version),
      ),
    )
    assert.equal(moved.academicYear, null)
    assert.deepEqual(
      (await audits(t.id, 'budget_line.remove')).map((row) => row.entityId),
      [income.id],
    )
  })

  test('DOM-FIN-062: aynı Idempotency-Key ilk yanıtı tekrarlar, ikinci kayıt açılmaz', async () => {
    const t = await institution()
    const headers = { 'idempotency-key': randomUUID() }
    const body = { code: 'G-1', name: 'Gelir', kind: 'income' }
    const first = await call('POST', ITEMS, t.admin, body, headers)
    const second = await call('POST', ITEMS, t.admin, body, headers)
    assert.equal(first.statusCode, 201, first.body)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.deepEqual(second.json(), first.json())
    assert.equal((await tableRows(budgetItems, t.id)).length, 1)
  })

  test('IST-002: başka kurumun merkezi, kalemi, dönemi ve satırı 404, listede yok, B değişmez', async () => {
    const a = await ready()
    const b = await ready()
    const bLine = await ok(
      await line(b, b.draft.id, {
        costCenterId: b.campus.id,
        itemId: b.income.id,
        amountCents: 50,
      }),
      201,
    )
    const snapshot = async () =>
      Promise.all([
        tableRows(costCenters, b.id),
        tableRows(budgetItems, b.id),
        tableRows(budgetPeriods, b.id),
        tableRows(budgetLines, b.id),
      ])
    const bBefore = await snapshot()
    const bCenter = `${CENTERS}/${String(b.campus.id)}`
    const bItem = `${ITEMS}/${String(b.income.id)}`
    const bPeriod = `${PERIODS}/${String(b.draft.id)}`
    const bLineUrl = `${bPeriod}/lines/${String(bLine.id)}`

    assertError(await call('PATCH', bCenter, a.admin, { name: 'Ele geçir' }, ifMatch(1)), 404)
    assertError(await call('PATCH', bItem, a.admin, { name: 'Ele geçir' }, ifMatch(1)), 404)
    assertError(await get(bPeriod, a.admin), 404)
    assertError(await call('PATCH', bPeriod, a.admin, { name: 'Ele geçir' }, ifMatch(1)), 404)
    assertError(await call('POST', `${bPeriod}/open`, a.admin, undefined, ifMatch(1)), 404)
    assertError(await call('POST', `${bPeriod}/close`, a.admin, undefined, ifMatch(1)), 404)
    assertError(await get(`${bPeriod}/lines`, a.admin), 404)
    assertError(
      await call('POST', `${bPeriod}/lines`, a.admin, {
        costCenterId: a.campus.id,
        itemId: a.income.id,
        amountCents: 1,
      }),
      404,
    )
    assertError(await call('PATCH', bLineUrl, a.admin, { amountCents: 1 }, ifMatch(1)), 404)
    assertError(await call('DELETE', bLineUrl, a.admin, undefined, ifMatch(1)), 404)
    // A dönemine B'nin merkezi ve kalemi bağlanamaz.
    assertError(
      await line(a, a.draft.id, { costCenterId: b.campus.id, itemId: a.income.id, amountCents: 1 }),
      422,
      'cost_center_not_found',
    )
    assertError(
      await line(a, a.draft.id, { costCenterId: a.campus.id, itemId: b.income.id, amountCents: 1 }),
      422,
      'budget_item_not_found',
    )
    assertError(
      await call('POST', ITEMS, a.admin, {
        code: 'Z',
        name: 'Gelir',
        kind: 'income',
        institutionId: b.id,
      }),
      400,
    )
    // Gövdede B'nin merkezi üst merkez seçilemez; gövdedeki kurum kimliği 400.
    assertError(
      await call('POST', CENTERS, a.admin, {
        code: 'Z',
        name: 'Alt',
        type: 'unit',
        parentId: b.campus.id,
      }),
      422,
      'cost_center_parent_not_found',
    )
    assertError(
      await call('POST', PERIODS, a.admin, {
        name: 'Sızma',
        academicYear: 2026,
        institutionId: b.id,
      }),
      400,
    )
    const ids = (url: string) =>
      get(url, a.admin).then((response) => (response.json().data as Json[]).map((row) => row.id))
    assert.equal((await ids(CENTERS)).includes(b.campus.id), false)
    assert.equal((await ids(ITEMS)).includes(b.income.id), false)
    assert.equal((await ids(PERIODS)).includes(b.draft.id), false)
    assert.deepEqual(await snapshot(), bBefore)
  })
})
