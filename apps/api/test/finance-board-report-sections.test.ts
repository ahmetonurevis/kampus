import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { checkFinanceMirrorAfterEach } from './support/finance-mirror.ts'

/**
 * Yönetim kurulu raporunun bütçe, maliyet ve tahmin bölümleri (`GET /api/v1/finance/board-report`;
 * DOM-FIN-064, ON-329). Bölümlerin rakamı kendi uçlarının (DOM-FIN-066, DOM-FIN-065, DOM-FIN-063)
 * rakamıyla aynıdır. FIXED_NOW 2026-10-06; yıl kaydı yok → rapor dönemi 2026-09-01 … bugün.
 */

const SEED = createSeed(FIXED_NOW)
const [KADIKOY, ATASEHIR] = SEED.branches
const CLASS_KAD = SEED.classes.find((item) => item.branchId === KADIKOY?.id && item.grade === 7)
const CLASS_ATA = SEED.classes.find((item) => item.branchId === ATASEHIR?.id && item.grade === 7)
const BASE_STUDENT = SEED.students[0]
const BOARD = '/api/v1/finance/board-report'

type Json = Record<string, unknown>

const student = (id: string, classId: string) => ({
  collection: 'students' as const,
  id,
  data: {
    ...BASE_STUDENT,
    id,
    name: `Kurul Öğrencisi ${id}`,
    number: id,
    email: `${id}@kampus.example`,
    classId,
    joinedAt: '2025-09-01T09:00:00.000Z',
  },
})
const invoice = (id: string, studentId: string, amount: number, dueDay: string, year = 2026) => ({
  collection: 'invoices' as const,
  id,
  data: {
    id,
    studentId,
    installment: 1,
    amount,
    dueDate: `${dueDay}T09:00:00.000Z`,
    paidAt: null,
    method: null,
    reminderAt: null,
    feeKind: 'tuition',
    academicYear: year,
  },
})

describe('DOM-FIN-064: yönetim kurulu raporunun bütçe, maliyet ve tahmin bölümleri', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenants = 0
  let clientIp = '10.64.0.1'
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    assert.ok(KADIKOY && ATASEHIR && CLASS_KAD && CLASS_ATA && BASE_STUDENT)
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
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
  async function ok(response: Awaited<ReturnType<App['inject']>>, status = 200): Promise<Json> {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  const get = async (url: string, cookie: string) => ok(await call('GET', url, cookie))
  const post = async (url: string, cookie: string, body: Json) =>
    ok(await call('POST', url, cookie, body), 201)

  /** Kurum: Kadıköy 6, Ataşehir 3 öğrenci; taksitler; merkezler, kalemler. Dönem kurulmaz. */
  async function institution() {
    assert.ok(KADIKOY && ATASEHIR && CLASS_KAD && CLASS_ATA)
    clientIp = `10.64.${String((tenants += 1))}.1`
    const created = await createInstitution(app)
    const admin = await signInAs(app, created.admin)
    await insertMissingRecords(
      db,
      created.id,
      [
        ...SEED.branches.map((data) => ({ collection: 'branches' as const, id: data.id, data })),
        { collection: 'classes' as const, id: CLASS_KAD.id, data: { ...CLASS_KAD } },
        { collection: 'classes' as const, id: CLASS_ATA.id, data: { ...CLASS_ATA } },
        ...Array.from({ length: 6 }, (_, i) => student(`kr-k${String(i + 1)}`, CLASS_KAD.id)),
        ...Array.from({ length: 3 }, (_, i) => student(`kr-a${String(i + 1)}`, CLASS_ATA.id)),
        invoice('kr-i1', 'kr-k1', 1_000_000, '2026-09-15'),
        invoice('kr-i2', 'kr-a1', 400_000, '2026-10-01'),
        invoice('kr-i3', 'kr-k2', 300_000, '2026-12-15'),
        invoice('kr-i4', 'kr-k3', 700_000, '2027-09-15', 2027),
      ],
      FIXED_NOW,
    )
    const centers = '/api/v1/finance/cost-centers'
    const gen = await post(centers, admin, { code: 'GEN', name: 'Genel', type: 'unit' })
    const kad = await post(centers, admin, {
      code: 'KAD',
      name: 'Kadıköy',
      type: 'campus',
      campusId: KADIKOY.id,
    })
    const ata = await post(centers, admin, {
      code: 'ATA',
      name: 'Ataşehir',
      type: 'campus',
      campusId: ATASEHIR.id,
    })
    const items = '/api/v1/finance/budget-items'
    const expense = await post(items, admin, { code: 'P-100', name: 'Personel', kind: 'expense' })
    const income = await post(items, admin, {
      code: 'G-100',
      name: 'Öğrenim geliri',
      kind: 'income',
      feeKind: 'tuition',
    })
    /** Bütçe dönemi ve satırları; `open` ise dönem açılır. */
    async function budgetPeriod(name: string, body: Json, open: boolean) {
      const period = await post('/api/v1/finance/budget-periods', admin, { name, ...body })
      const lines = `/api/v1/finance/budget-periods/${String(period.id)}/lines`
      for (const [center, item, amountCents] of [
        [gen, expense, 1_000_000],
        [kad, expense, 700_000],
        [ata, expense, 300_000],
        [kad, income, 9_000_000],
        [ata, income, 3_000_000],
      ] as const)
        await post(lines, admin, { costCenterId: center.id, itemId: item.id, amountCents })
      if (!open) return period
      return ok(
        await call(
          'POST',
          `/api/v1/finance/budget-periods/${String(period.id)}/open`,
          admin,
          {},
          {
            'if-match': `"${String(period.version)}"`,
          },
        ),
      )
    }
    return { id: created.id, admin, budgetPeriod }
  }

  test('DOM-FIN-064: bütçe dönemi yoksa bütçe ve maliyet bölümü yok, tahmin her zaman var', async () => {
    const t = await institution()
    const data = await get(`${BOARD}?year=2026`, t.admin)
    assert.deepEqual(data.budgetPeriods, [])
    assert.equal(data.budgetPeriod, null)
    assert.equal(data.budget, null)
    assert.equal(data.costs, null)
    const forecast = data.forecast as Json
    assert.equal((forecast.revenue as Json).year, 2027)
    assert.equal(((forecast.cashFlow as Json).months as Json[]).length, 12)
  })

  test('DOM-FIN-064: bölümler kendi uçlarının rakamıdır (DOM-FIN-066, DOM-FIN-065, DOM-FIN-063)', async () => {
    const t = await institution()
    const period = await t.budgetPeriod('2026–2027', { academicYear: 2026 }, true)
    const data = await get(`${BOARD}?year=2026`, t.admin)
    assert.deepEqual(data.budgetPeriod, {
      id: period.id,
      name: '2026–2027',
      status: 'open',
      startDate: '2026-09-01',
      endDate: '2027-08-31',
      selection: 'matched',
    })

    const actuals = await get(
      `/api/v1/finance/budget-periods/${String(period.id)}/actuals`,
      t.admin,
    )
    const budget = data.budget as Json
    const totals = actuals.totals as Json
    const withoutToDate = (value: unknown) =>
      Object.fromEntries(
        Object.entries(value as Json).filter(([key]) => key !== 'plannedToDateCents'),
      )
    assert.deepEqual(withoutToDate(budget.income), totals.income)
    assert.deepEqual(withoutToDate(budget.expense), totals.expense)
    assert.equal((budget.income as Json).plannedToDateCents, null, 'dağılımsız satır (K-64)')
    assert.deepEqual(budget.net, totals.net)
    assert.equal(budget.expenseData, 'none')
    assert.equal((budget.expense as Json).actualCents, null)
    // Tahakkuk: Eylül 1.000.000 + Ekim 400.000 (bugün 6 Ekim); gelir kalemi merkezlerden toplanır.
    assert.equal((budget.income as Json).actualCents, 1_400_000)
    assert.deepEqual(
      (budget.topVariances as Json[]).map((item) => [item.itemCode, item.actualCents]),
      [['G-100', 1_400_000]],
    )

    const consolidation = await get(
      `/api/v1/finance/campus-consolidation?periodId=${String(period.id)}`,
      t.admin,
    )
    const costs = data.costs as Json
    const consolidationTotals = consolidation.totals as Json
    for (const field of [
      'studentCount',
      'accruedCents',
      'netCollectedCents',
      'budgetExpenseCents',
      'budgetExpensePerStudentCents',
      'suppressed',
    ])
      assert.equal((costs.totals as Json)[field], consolidationTotals[field], field)
    const ata = (costs.campuses as Json[]).find((row) => row.campusId === ATASEHIR?.id)
    assert.equal(ata?.studentCount, 3)
    assert.equal(ata?.budgetExpensePerStudentCents, null, 'küçük grup (K-102)')
    assert.equal(ata?.suppressed, true)
    const kad = (costs.campuses as Json[]).find((row) => row.campusId === KADIKOY?.id)
    assert.equal(kad?.suppressed, false)
    assert.equal(typeof kad?.budgetExpensePerStudentCents, 'number')

    const revenue = await get('/api/v1/finance/forecasts/revenue?year=2027', t.admin)
    const cashFlow = await get('/api/v1/finance/forecasts/cash-flow?months=12', t.admin)
    const forecast = data.forecast as Json
    assert.equal((forecast.revenue as Json).expectedTotalCents, revenue.expectedTotalCents)
    assert.equal((forecast.revenue as Json).committedCents, (revenue.committed as Json).totalCents)
    assert.equal(
      ((forecast.cashFlow as Json).totals as Json).netCents,
      (cashFlow.totals as Json).netCents,
    )
    assert.equal((forecast.cashFlow as Json).from, cashFlow.from)

    // Yanıt kişi adı ve öğrenci kimliği taşımaz.
    const body = JSON.stringify(data)
    assert.doesNotMatch(body, /Kurul Öğrencisi|kr-k\d|kr-a\d/)
  })

  test('DOM-FIN-064: açık dönem taslağa yeğlenir, yönetici başka dönemi seçebilir', async () => {
    const t = await institution()
    const draft = await t.budgetPeriod('Taslak plan', { academicYear: 2026 }, false)
    const matchedDraft = await get(`${BOARD}?year=2026`, t.admin)
    assert.equal((matchedDraft.budgetPeriod as Json).id, draft.id)
    assert.equal((matchedDraft.budgetPeriod as Json).status, 'draft')

    const open = await t.budgetPeriod(
      'Güz bütçesi',
      { startDate: '2026-09-01', endDate: '2026-12-31' },
      true,
    )
    const matched = await get(`${BOARD}?year=2026`, t.admin)
    assert.equal((matched.budgetPeriod as Json).id, open.id)
    assert.deepEqual(
      (matched.budgetPeriods as Json[]).map((item) => item.id).sort(),
      [draft.id, open.id].sort(),
    )

    const chosen = await get(`${BOARD}?year=2026&budgetPeriodId=${String(draft.id)}`, t.admin)
    assert.equal((chosen.budgetPeriod as Json).id, draft.id)
    assert.equal((chosen.budgetPeriod as Json).selection, 'chosen')
    // Seçilen dönem bütçe ve maliyet bölümünün dönemidir.
    assert.equal((chosen.costs as Json).to, '2027-08-31')
  })

  test('DOM-FIN-064: başka kurumun ya da olmayan bütçe dönemi 422, geçersiz kimlik 400', async () => {
    const a = await institution()
    const b = await institution()
    const foreign = await b.budgetPeriod('B dönemi', { academicYear: 2026 }, true)
    for (const id of [String(foreign.id), randomUUID()]) {
      const response = await call('GET', `${BOARD}?year=2026&budgetPeriodId=${id}`, a.admin)
      assert.equal(response.statusCode, 422, response.body)
      assert.equal(response.json().code, 'board_report_budget_period_not_found')
      assert.equal(response.json().data, undefined)
    }
    const invalid = await call('GET', `${BOARD}?year=2026&budgetPeriodId=x`, a.admin)
    assert.equal(invalid.statusCode, 400, invalid.body)
    // B'nin raporu A'nın dönemini görmez.
    const own = await get(`${BOARD}?year=2026`, a.admin)
    assert.deepEqual(own.budgetPeriods, [])
  })

  test('DOM-FIN-064: bütçe dönemi seçimi de yalnız yöneticiye açıktır', async () => {
    const t = await institution()
    const period = await t.budgetPeriod('2026–2027', { academicYear: 2026 }, true)
    for (const role of ['onburo', 'ogretmen', 'veli'] as const satisfies readonly Role[]) {
      const cookie = await signInAs(app, await createMember(app, t.id, role, []))
      const response = await call(
        'GET',
        `${BOARD}?year=2026&budgetPeriodId=${String(period.id)}`,
        cookie,
      )
      assert.equal(response.statusCode, 403, `${role}: ${response.body}`)
      assert.equal(response.json().data, undefined)
    }
  })
})
