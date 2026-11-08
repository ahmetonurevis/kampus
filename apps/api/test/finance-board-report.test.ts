import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { createSeed } from '@kampus/school-core/data/seed.ts'
import type { WithdrawalBreakdown } from '@kampus/school-core/lib/withdrawals.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { studentWithdrawals } from '../src/db/schema/withdrawals.ts'
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
 * Yönetim kurulu raporu (`GET /api/v1/finance/board-report`; DOM-FIN-064, ON-251). Her test kendi
 * kurumunu kurar. FIXED_NOW 2026-10-06; yıl kaydı yok → dönem 2026-09-01 … bugün.
 */

const SEED = createSeed(FIXED_NOW)
const [STUDENT, LEAVER, NEWBIE] = SEED.students.filter((item) => item.classId === 'c1')
const NET = 10_000_000
const URL_BASE = '/api/v1/finance/board-report'
const LIST = ['contracts', 'invoices', 'students', 'renewals', 'prospects'] as const

const invoice = (id: string, studentId: string, installment: number, dueDate: string) => ({
  id,
  studentId,
  installment,
  amount: NET / 2,
  dueDate,
  paidAt: null,
  method: null,
  reminderAt: null,
  feeKind: 'tuition',
  academicYear: 2026,
})
const prospect = (id: string, stage: string, studentId: string | null = null) => ({
  id,
  name: `Aday ${id}`,
  phone: '05559990001',
  source: 'Web sitesi',
  stage,
  studentId,
  trialAt: null,
  notes: [],
  createdAt: '2026-09-10T08:00:00.000Z',
})

describe('yönetim kurulu raporu', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-br-${String(++serial).padStart(5, '0')}` })
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    assert.ok(STUDENT && LEAVER && NEWBIE)
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  /**
   * Kurum: eski öğrenci (sözleşme, 1. taksit 2026-09-15 gecikmiş, 2027'ye yenileme planı), dönemde
   * kesin kayıt olan öğrenci, dönemde ayrılan öğrenci (taşınma) ve dönemde açılan iki aday.
   */
  async function institution(overrides: Partial<InstitutionOverrides> = {}, prefix = 'test') {
    const created = await createInstitution(app, overrides)
    assert.ok(STUDENT && LEAVER && NEWBIE)
    await insertTestTariff(db, created.id)
    const contractId = `${prefix}-contract`
    await insertMissingRecords(
      db,
      created.id,
      [
        { collection: 'classes', id: 'c1', data: { ...SEED.classes.find((c) => c.id === 'c1') } },
        {
          collection: 'students',
          id: STUDENT.id,
          data: { ...STUDENT, joinedAt: '2025-09-01T09:00:00.000Z', name: `${prefix} Öğrenci` },
        },
        {
          collection: 'students',
          id: NEWBIE.id,
          data: { ...NEWBIE, joinedAt: '2026-09-15T09:00:00.000Z', name: `${prefix} Yeni` },
        },
        {
          collection: 'students',
          id: LEAVER.id,
          data: {
            ...LEAVER,
            isActive: false,
            joinedAt: '2025-09-01T09:00:00.000Z',
            name: `${prefix} Ayrılan`,
          },
        },
        {
          collection: 'contracts',
          id: contractId,
          data: {
            id: contractId,
            studentId: STUDENT.id,
            date: '2026-08-20T09:00:00.000Z',
            amount: NET,
            title: 'Sözleşme',
            academicYear: 2026,
            invoiceIds: [`${prefix}-inv-1`, `${prefix}-inv-2`],
            ...contractTerms({ grossCents: NET, netCents: NET }),
          },
        },
        {
          collection: 'invoices',
          id: `${prefix}-inv-1`,
          data: invoice(`${prefix}-inv-1`, STUDENT.id, 1, '2026-09-15T09:00:00.000Z'),
        },
        {
          collection: 'invoices',
          id: `${prefix}-inv-2`,
          data: invoice(`${prefix}-inv-2`, STUDENT.id, 2, '2026-11-15T09:00:00.000Z'),
        },
        {
          collection: 'renewals',
          id: `${prefix}-renewal`,
          data: {
            id: `${prefix}-renewal`,
            studentId: STUDENT.id,
            mode: 'renew',
            status: 'Planlandı',
            year: 2027,
            fromClassId: 'c1',
            targetClassId: 'c1',
            amount: NET,
            createdAt: '2026-10-01T09:00:00.000Z',
            updatedAt: '2026-10-01T09:00:00.000Z',
          },
        },
        {
          collection: 'prospects',
          id: `${prefix}-p1`,
          data: prospect(`${prefix}-p1`, 'Kayıt oldu', NEWBIE.id),
        },
        {
          collection: 'prospects',
          id: `${prefix}-p2`,
          data: prospect(`${prefix}-p2`, 'Yeni aday'),
        },
      ],
      FIXED_NOW,
    )
    await db.insert(studentWithdrawals).values({
      institutionId: created.id,
      id: randomUUID(),
      studentId: LEAVER.id,
      contractId: `${prefix}-leaver-contract`,
      withdrawalDate: '2026-09-20',
      reason: 'relocation',
      targetSchool: null,
      breakdown: {
        refundCents: 0,
        debtCents: 0,
        paidCents: 0,
        creditCents: 0,
        extras: [],
      } as unknown as WithdrawalBreakdown,
      refundCents: 0,
      debtCents: 0,
      refundDueDate: '2026-10-20',
      approvedByUserId: created.admin.id,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    return { ...created, cookie: await signInAs(app, created.admin) }
  }
  const member = async (id: string, role: Role) =>
    signInAs(app, await createMember(app, id, role, []))
  const get = (cookie: string | null, query = 'year=2026') =>
    app.inject({
      method: 'GET',
      url: `${URL_BASE}${query === '' ? '' : `?${query}`}`,
      headers: { origin: TEST_ORIGIN, ...(cookie === null ? {} : { cookie }) },
    })
  const pay = (cookie: string, amountCents: number) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json', cookie, ...key() },
      payload: JSON.stringify({
        studentId: STUDENT?.id,
        amountCents,
        method: 'Banka havalesi',
        reference: `TR-BR-${String(serial)}`,
      }),
    })
  function assertError(response: Awaited<ReturnType<typeof get>>, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  test('DOM-FIN-064: oturumsuz 401; yalnız yönetici okur, diğer roller 403; modül kapalı 403', async () => {
    assertError(await get(null), 401)
    const a = await institution()
    assert.equal((await get(a.cookie)).statusCode, 200)
    for (const role of ['onburo', 'ogretmen', 'ogrenci', 'veli'] as const)
      assertError(await get(await member(a.id, role)), 403, 'forbidden')
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(closed.cookie), 403, 'module_disabled')
  })

  test('DOM-FIN-064: finans ve kayıt özeti mevcut hesaplardan, kişi adı olmadan', async () => {
    const a = await institution()
    assert.equal((await pay(a.cookie, 1_000_000)).statusCode, 201)
    const before = await loadRecords(db, a.id, [...LIST])
    const response = await get(a.cookie)
    assert.equal(response.statusCode, 200, response.body)
    const data = response.json().data
    assert.deepEqual(data.period, {
      kind: 'year',
      year: 2026,
      from: '2026-09-01',
      to: '2026-10-06',
      endDate: '2027-08-31',
      complete: false,
      termId: null,
      termName: null,
    })
    assert.equal(data.minGroupSize, 5)

    // Mutabakat toplamları aynı dönemin `/finance/reconciliation` toplamıdır (DOM-FIN-056).
    const reconciliation = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/finance/reconciliation?year=2026',
        headers: { origin: TEST_ORIGIN, cookie: a.cookie },
      })
    ).json().data
    assert.deepEqual(data.finance.totals, reconciliation.totals)
    assert.equal(data.finance.totals.accruedCents, NET / 2)
    assert.equal(data.finance.totals.collectedCents, 1_000_000)

    // Tek kişilik yöntem hücresi gizli; toplam görünür (K-77).
    assert.equal(data.finance.methods.collectedCents, 1_000_000)
    const transfer = data.finance.methods.rows.find(
      (row: { method: string }) => row.method === 'Banka havalesi',
    )
    assert.deepEqual(transfer, {
      method: 'Banka havalesi',
      studentCount: null,
      collectedCents: null,
      reversedCents: null,
      netCents: null,
      suppressed: true,
    })

    // Yaşlandırma bugünün gecikmiş tutarıdır; `/finance/totals` ile aynı (K-76).
    const totals = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/finance/totals',
        headers: { origin: TEST_ORIGIN, cookie: a.cookie },
      })
    ).json().data
    assert.equal(data.finance.aging.overdueCents, totals.overdueCents)
    assert.equal(data.finance.aging.overdueCents, NET / 2 - 1_000_000)
    assert.equal(data.finance.aging.studentCount, 1)
    assert.equal(data.finance.aging.rows[0].suppressed, true)
    assert.equal(data.finance.packages, null)

    assert.deepEqual(
      [
        data.enrollment.startCount,
        data.enrollment.newCount,
        data.enrollment.withdrawnCount,
        data.enrollment.graduatedCount,
        data.enrollment.endCount,
      ],
      [2, 1, 1, 0, 2],
    )
    assert.deepEqual(
      data.enrollment.reasons.find((row: { reason: string }) => row.reason === 'relocation'),
      { reason: 'relocation', count: null, suppressed: true },
    )
    assert.deepEqual(data.enrollment.renewal, {
      targetYear: 2027,
      eligibleCount: 2,
      renewedCount: 1,
      rate: 50,
    })
    assert.equal(data.funnel.prospects, 2)
    assert.equal(data.funnel.conversionRate, 50)

    // Ad, öğrenci kimliği ve taksit kimliği yanıtta yok; okuma hiçbir kaydı değiştirmez.
    for (const text of ['test Öğrenci', 'test Ayrılan', 'test-inv-1', `"${STUDENT?.id ?? ''}"`])
      assert.equal(response.body.includes(text), false, text)
    assert.deepEqual(await loadRecords(db, a.id, [...LIST]), before)
  })

  test('DOM-FIN-064: dönem sorgusu; geçersiz sorgu 400, hatalı dönem 422', async () => {
    const a = await institution()
    const narrow = (await get(a.cookie, 'year=2026&from=2026-09-01&to=2026-09-10')).json().data
    assert.equal(narrow.period.kind, 'custom')
    assert.equal(narrow.period.complete, true)
    assert.equal(narrow.enrollment.withdrawnCount, 0)
    assert.equal(narrow.finance.totals.accruedCents, 0)
    assertError(await get(a.cookie, ''), 400)
    assertError(await get(a.cookie, 'year=2026&from=2026-09-01'), 400)
    assertError(await get(a.cookie, 'year=2026&termId=t1&from=2026-09-01&to=2026-09-02'), 400)
    assertError(await get(a.cookie, 'year=2026&page=1'), 400)
    assertError(await get(a.cookie, 'year=2027'), 422, 'board_report_period_not_started')
    assertError(await get(a.cookie, 'year=2026&termId=yok'), 422, 'board_report_term_not_found')
    assertError(
      await get(a.cookie, 'year=2026&from=2026-09-10&to=2026-09-01'),
      422,
      'export_period_invalid',
    )
    assertError(
      await get(a.cookie, 'year=2026&from=2025-01-01&to=2026-06-01'),
      422,
      'export_period_too_long',
    )
  })

  test('DOM-FIN-064: dil okulunda paket toplamı var, yenileme oranı yok; crm kapalıysa huni yok', async () => {
    const language = (await get((await institution({ type: 'language_school' })).cookie)).json()
      .data
    assert.equal(language.institutionType, 'language_school')
    assert.equal(language.finance.packages.saleCount, 0)
    assert.equal(language.enrollment.renewal, null)
    const noCrm = await institution({ enabledModules: { crm: false } })
    const data = (await get(noCrm.cookie)).json().data
    assert.equal(data.funnel, null)
    assert.equal(data.enrollment.newCount, 1)
  })

  test('DOM-YTK-001: başka kurumun kayıtları raporda sayılmaz; institutionId sorgusu 400', async () => {
    const a = await institution({}, 'a')
    const b = await institution({}, 'b')
    assert.equal((await pay(b.cookie, 2_000_000)).statusCode, 201)
    const own = (await get(a.cookie)).json().data
    assert.equal(own.finance.totals.collectedCents, 0)
    assert.equal(own.finance.aging.overdueCents, NET / 2)
    assert.equal(own.funnel.prospects, 2)
    assert.equal(own.enrollment.withdrawnCount, 1)
    assertError(await get(a.cookie, `year=2026&institutionId=${b.id}`), 400)
  })
})
