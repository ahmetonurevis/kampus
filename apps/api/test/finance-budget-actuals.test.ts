import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { createSeed } from '@kampus/school-core/data/seed.ts'
import { courseNameKey } from '@kampus/school-core/lib/courses.ts'
import { groupNameKey } from '@kampus/school-core/lib/language-groups.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { courses } from '../src/db/schema/courses.ts'
import { languageGroupMembers, languageGroups } from '../src/db/schema/language-groups.ts'
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
import { checkFinanceMirrorAfterEach } from './support/finance-mirror.ts'
import { contractTerms, insertTestTariff } from './support/finance-terms.ts'

/**
 * Bütçe–gerçekleşen raporu (ON-244; DOM-FIN-066). Her test kendi kurumunu kurar: 7. sınıftaki (c1,
 * Kadıköy kampüsü) bir öğrenci, sözleşme ve vadesi 15 Eylül 2026 olan iki öğrenim taksiti (50.000 ₺),
 * vadesi 15 Kasım olan yemek taksiti; kampüs merkezi, öğrenim ve gider kalemi, 2026 eğitim yılı
 * dönemi. FIXED_NOW 2026-10-06.
 */

const SEED = createSeed(FIXED_NOW)
const STUDENT = SEED.students.find((item) => item.classId === 'c1')
const CLASS = SEED.classes.find((item) => item.id === 'c1')
const CAMPUS = CLASS?.branchId ?? ''
const HALF = 5_000_000
const PERIODS = '/api/v1/finance/budget-periods'

const invoice = (id: string, installment: number, extra: Record<string, unknown> = {}) => ({
  id,
  studentId: STUDENT?.id,
  installment,
  amount: HALF,
  dueDate: '2026-09-15T09:00:00.000Z',
  paidAt: null,
  method: null,
  reminderAt: null,
  feeKind: 'tuition',
  contractId: 'test-contract',
  ...extra,
})

type Json = Record<string, unknown>
type Row = {
  itemCode: string
  costCenterCode: string | null
  plannedCents: number
  actualCents: number | null
  varianceCents: number | null
  realizationBasisPoints: number | null
  status: string
  months: { month: string; actualCents: number | null; plannedCents: number | null }[]
}
type Report = {
  basis: string
  asOfDate: string | null
  expenseData: string
  rows: Row[]
  unmatched: { feeKind: string | null; actualCents: number }[]
  totals: { income: Json; expense: Json; net: Json }
}

describe('DOM-FIN-066: bütçe–gerçekleşen ucu', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-bg-${String(++serial).padStart(5, '0')}` })
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    assert.ok(STUDENT && CLASS)
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function send(
    method: 'GET' | 'POST',
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
  async function created(response: Awaited<ReturnType<typeof send>>): Promise<Json> {
    assert.equal(response.statusCode, 201, response.body)
    return response.json().data as Json
  }
  function assertError(response: Awaited<ReturnType<typeof send>>, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    const made = await createInstitution(app, overrides)
    assert.ok(STUDENT && CLASS)
    await insertTestTariff(db, made.id)
    const invoices = [
      invoice('test-inv-1', 1),
      invoice('test-inv-2', 2),
      invoice('test-inv-meal', 3, {
        feeKind: 'meal',
        amount: 300_000,
        dueDate: '2026-11-15T09:00:00.000Z',
      }),
    ]
    await insertMissingRecords(
      db,
      made.id,
      [
        ...SEED.branches.map((data) => ({ collection: 'branches' as const, id: data.id, data })),
        { collection: 'classes' as const, id: CLASS.id, data: { ...CLASS } },
        { collection: 'students' as const, id: STUDENT.id, data: { ...STUDENT } },
        {
          collection: 'parents' as const,
          id: STUDENT.parentId,
          data: { id: STUDENT.parentId, name: 'Test Veli', studentIds: [STUDENT.id] },
        },
        {
          collection: 'contracts' as const,
          id: 'test-contract',
          data: {
            id: 'test-contract',
            studentId: STUDENT.id,
            date: '2026-01-01T09:00:00.000Z',
            amount: 2 * HALF + 300_000,
            title: 'Sözleşme',
            academicYear: 2026,
            invoiceIds: invoices.map((item) => item.id),
            ...contractTerms({ grossCents: 2 * HALF + 300_000, netCents: 2 * HALF + 300_000 }),
          },
        },
        ...invoices.map((item) => ({ collection: 'invoices' as const, id: item.id, data: item })),
      ],
      FIXED_NOW,
    )
    const cookie = await signInAs(app, made.admin)
    const campus = await created(
      await send('POST', '/api/v1/finance/cost-centers', cookie, {
        code: 'kad',
        name: 'Kadıköy',
        type: 'campus',
        campusId: CAMPUS,
      }),
    )
    const tuition = await created(
      await send('POST', '/api/v1/finance/budget-items', cookie, {
        code: 'G-100',
        name: 'Öğrenim geliri',
        kind: 'income',
        feeKind: 'tuition',
      }),
    )
    const expense = await created(
      await send('POST', '/api/v1/finance/budget-items', cookie, {
        code: 'P-100',
        name: 'Personel',
        kind: 'expense',
      }),
    )
    const period = await created(
      await send('POST', PERIODS, cookie, { name: '2026–2027', academicYear: 2026 }),
    )
    const months = period.months as string[]
    await created(
      await send('POST', `${PERIODS}/${String(period.id)}/lines`, cookie, {
        costCenterId: campus.id,
        itemId: tuition.id,
        amountCents: 12_000_000,
        monthlyCents: months.map((_, index) => (index === 0 ? 12_000_000 : 0)),
      }),
    )
    await created(
      await send('POST', `${PERIODS}/${String(period.id)}/lines`, cookie, {
        costCenterId: campus.id,
        itemId: expense.id,
        amountCents: 4_000_000,
      }),
    )
    return { ...made, cookie, url: `${PERIODS}/${String(period.id)}/actuals` }
  }
  const member = async (id: string, role: Role) =>
    signInAs(app, await createMember(app, id, role, []))
  async function report(cookie: string, url: string): Promise<Report> {
    const response = await send('GET', url, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json().data as Report
  }
  const pay = (cookie: string, amountCents: number, reference: string) =>
    send(
      'POST',
      '/api/v1/payments',
      cookie,
      { studentId: STUDENT?.id, amountCents, method: 'Banka havalesi', reference },
      key(),
    )

  test('DOM-FIN-066: oturumsuz 401; yalnız yönetici okur; modül kapalı 403', async () => {
    const a = await institution()
    assertError(await send('GET', a.url, null), 401)
    for (const role of ['onburo', 'ogretmen', 'ogrenci', 'veli'] as const)
      assertError(await send('GET', a.url, await member(a.id, role)), 403, 'forbidden')
    const closed = await createInstitution(app, { enabledModules: { finance: false } })
    assertError(await send('GET', a.url, await signInAs(app, closed.admin)), 403, 'module_disabled')
  })

  test('DOM-FIN-066: geçersiz esas, dönem ve parametre 400; olmayan dönem 404; kayıt değişmez', async () => {
    const a = await institution()
    const before = await loadRecords(db, a.id, ['invoices', 'contracts'])
    for (const query of ['?basis=nakit', '?basis=cash&x=1', '?institutionId=x'])
      assertError(await send('GET', `${a.url}${query}`, a.cookie), 400)
    assertError(await send('GET', `${PERIODS}/bozuk/actuals`, a.cookie), 400)
    assertError(
      await send('GET', `${PERIODS}/00000000-0000-4000-8000-000000000000/actuals`, a.cookie),
      404,
      'not_found',
    )
    assert.deepEqual(await loadRecords(db, a.id, ['invoices', 'contracts']), before)
  })

  test('DOM-FIN-066: başka kurumun dönemi 404, taksiti ve tahsilatı raporda yok', async () => {
    const a = await institution()
    const b = await institution()
    assertError(await send('GET', b.url, a.cookie), 404, 'not_found')
    assert.equal((await pay(b.cookie, 777_777, 'TR-B1')).statusCode, 201)
    const own = await report(a.cookie, `${a.url}?basis=cash`)
    assert.equal(own.totals.income.actualCents, 0)
    assert.equal((await report(b.cookie, `${b.url}?basis=cash`)).totals.income.actualCents, 777_777)
  })

  test('DOM-FIN-066: tahakkuk varsayılan; gelmemiş ay boş, gider "gerçekleşen verisi yok"', async () => {
    const a = await institution()
    const data = await report(a.cookie, a.url)
    assert.equal(data.basis, 'accrual')
    assert.equal(data.asOfDate, '2026-10-06')
    assert.equal(data.expenseData, 'none')
    const tuition = data.rows.find((row) => row.itemCode === 'G-100')
    assert.ok(tuition)
    assert.equal(tuition.costCenterCode, 'KAD')
    assert.equal(tuition.actualCents, 2 * HALF)
    assert.equal(tuition.varianceCents, 2 * HALF - 12_000_000)
    assert.equal(tuition.realizationBasisPoints, 8333)
    assert.equal(tuition.months[0]?.actualCents, 2 * HALF)
    assert.equal(tuition.months[2]?.actualCents, null)
    const expense = data.rows.find((row) => row.itemCode === 'P-100')
    assert.equal(expense?.status, 'no_expense_data')
    assert.equal(expense?.actualCents, null)
    assert.equal(data.totals.expense.actualCents, null)
    assert.equal(data.totals.net.actualCents, null)
    // Yemek taksiti Kasım vadeli ve kaleme eşlenmemiş: henüz eşlenmemiş gelirde de görünmez.
    assert.deepEqual(data.unmatched, [])
  })

  test('DOM-FIN-066: tahsilat esası ödeme ve iptal gününde; dağıtılmamış kısım eşlenmemiş', async () => {
    const a = await institution()
    const payment = (await pay(a.cookie, 3_000_000, 'TR-1')).json().data as Json
    const cash = await report(a.cookie, `${a.url}?basis=cash`)
    assert.equal(cash.rows.find((row) => row.itemCode === 'G-100')?.actualCents, 3_000_000)
    const reversed = await send(
      'POST',
      `/api/v1/payments/${String(payment.id)}/reverse`,
      a.cookie,
      { reason: 'Yanlış öğrenciye girildi' },
      { 'if-match': `"${String(payment.version)}"`, ...key() },
    )
    assert.equal(reversed.statusCode, 200, reversed.body)
    const after = await report(a.cookie, `${a.url}?basis=cash`)
    const row = after.rows.find((item) => item.itemCode === 'G-100')
    assert.equal(row?.actualCents, 0)
    assert.equal(row?.months[1]?.actualCents, 0)
    // Kasım vadeli yemek taksitine alınan avans ödeme gününde sayılır; kalemi olmadığı için
    // eşlenmemiş gelirdedir. Bütün taksitleri aşan kısım dağıtılmaz: kalemi belirsiz tahsilat.
    assert.equal((await pay(a.cookie, 2 * HALF + 300_000 + 100, 'TR-2')).statusCode, 201)
    const extra = await report(a.cookie, `${a.url}?basis=cash`)
    assert.equal(extra.rows.find((item) => item.itemCode === 'G-100')?.actualCents, 2 * HALF)
    assert.deepEqual(
      extra.unmatched.map((entry) => [entry.feeKind, entry.actualCents]),
      [
        ['meal', 300_000],
        [null, 100],
      ],
    )
    assert.equal(extra.totals.income.unmatchedCents, 300_100)
  })

  test('DOM-FIN-066: dil okulunda kursiyerin tek kuru program merkezini seçer', async () => {
    const a = await institution({ type: 'language_school' })
    const courseId = randomUUID()
    await db.insert(courses).values({
      institutionId: a.id,
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
    const groupId = randomUUID()
    await db.insert(languageGroups).values({
      institutionId: a.id,
      id: groupId,
      courseId,
      name: 'B1 Akşam',
      nameKey: groupNameKey('B1 Akşam'),
      ageBand: 'adult',
      delivery: 'online',
      schedule: [{ weekday: 1, startTime: '18:00' }],
      startDate: '2026-09-01',
      endDate: '2026-12-31',
      capacity: 10,
      state: 'planned',
    })
    await db.insert(languageGroupMembers).values({
      institutionId: a.id,
      id: randomUUID(),
      groupId,
      studentId: STUDENT?.id ?? '',
      status: 'active',
      joinedAt: FIXED_NOW,
    })
    await created(
      await send('POST', '/api/v1/finance/cost-centers', a.cookie, {
        code: 'b1',
        name: 'B1 kurları',
        type: 'program',
        courseId,
      }),
    )
    const data = await report(a.cookie, a.url)
    const program = data.rows.find((row) => row.costCenterCode === 'B1')
    assert.equal(program?.actualCents, 2 * HALF)
    assert.equal(program?.plannedCents, 0)
    assert.equal(data.rows.find((row) => row.costCenterCode === 'KAD')?.actualCents, 0)
  })
})
