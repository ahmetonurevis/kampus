import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { createSeed } from '@kampus/school-core/data/seed.ts'
import type { WithdrawalBreakdown } from '@kampus/school-core/lib/withdrawals.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { applyFeeTariffPublish } from '../src/db/fee-tariffs.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { insertWithdrawal } from '../src/db/withdrawals.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  type InstitutionOverrides,
} from './support/app.ts'
import { checkFinanceMirrorAfterEach } from './support/finance-mirror.ts'
import { contractTerms, insertTestTariff, TEST_TARIFF_ID } from './support/finance-terms.ts'

/**
 * Gelir ve nakit akışı tahmini (ON-246, ON-247; DOM-FIN-063). Her test kendi kurumunu kurar: iki
 * öğrenci, biri yeni kayıt (liste 100.000 ₺, kardeş indirimi 10.000 ₺, iki taksit), öteki yenileme
 * (80.000 ₺, tek taksit); dört kapanmış ve bir açık aday; yayımlı 2026 tarifesi. FIXED_NOW
 * 2026-10-06, kayıt yılı 2026.
 */

const SEED = createSeed(FIXED_NOW)
const [FIRST, SECOND] = SEED.students.filter((item) => item.classId === 'c1')
const REVENUE = '/api/v1/finance/forecasts/revenue'
const CASH_FLOW = '/api/v1/finance/forecasts/cash-flow'

const invoice = (id: string, studentId: string, amount: number, dueDay: string) => ({
  id,
  studentId,
  installment: 1,
  amount,
  dueDate: `${dueDay}T09:00:00.000Z`,
  paidAt: null,
  method: null,
  reminderAt: null,
  feeKind: 'tuition',
  academicYear: 2026,
})

const prospect = (id: string, stage: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Aday ${id}`,
  phone: '05559990001',
  source: 'Web sitesi',
  stage,
  studentId: null,
  trialAt: null,
  notes: [],
  interest: '7. Sınıf · Ortaokul',
  createdAt: '2026-06-01T08:00:00.000Z',
  ...extra,
})

describe('gelir ve nakit akışı tahmini (DOM-FIN-063)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    assert.ok(FIRST && SECOND)
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(
    overrides: Partial<InstitutionOverrides> = {},
    options: { prospects?: Record<string, unknown>[] } = {},
  ) {
    assert.ok(FIRST && SECOND)
    const created = await createInstitution(app, overrides)
    await insertTestTariff(db, created.id)
    const published = await applyFeeTariffPublish(db, created.id, {
      id: TEST_TARIFF_ID,
      academicYear: 2026,
      expectedVersion: 1,
      announcedDate: '2026-01-15',
      mebbisRecordedDate: null,
      publishedByUserId: created.admin.id,
      now: FIXED_NOW,
    })
    assert.ok(published)
    const prospects = options.prospects ?? [
      prospect('fc-p1', 'Kayıt oldu', { studentId: 'fc-x1' }),
      prospect('fc-p2', 'Kayıt oldu', { studentId: 'fc-x2' }),
      prospect('fc-p3', 'Vazgeçti'),
      prospect('fc-p4', 'Vazgeçti'),
      prospect('fc-p5', 'Yeni aday', { createdAt: '2026-09-20T08:00:00.000Z' }),
    ]
    await insertMissingRecords(
      db,
      created.id,
      [
        {
          collection: 'classes' as const,
          id: 'c1',
          data: { ...SEED.classes.find((item) => item.id === 'c1') },
        },
        { collection: 'students' as const, id: FIRST.id, data: { ...FIRST } },
        { collection: 'students' as const, id: SECOND.id, data: { ...SECOND } },
        {
          collection: 'contracts' as const,
          id: 'fc-contract-1',
          data: {
            id: 'fc-contract-1',
            studentId: FIRST.id,
            date: '2026-05-01T09:00:00.000Z',
            amount: 9_000_000,
            title: 'Sözleşme',
            academicYear: 2026,
            invoiceIds: ['fc-inv-1', 'fc-inv-2'],
            ...contractTerms({ grossCents: 10_000_000, netCents: 9_000_000 }),
            discounts: [{ kind: 'sibling', amountCents: 1_000_000 }],
          },
        },
        {
          collection: 'contracts' as const,
          id: 'fc-contract-2',
          data: {
            id: 'fc-contract-2',
            studentId: SECOND.id,
            date: '2026-06-01T09:00:00.000Z',
            amount: 8_000_000,
            title: 'Yenileme sözleşmesi',
            academicYear: 2026,
            invoiceIds: ['fc-inv-3'],
            ...contractTerms({ grossCents: 8_000_000, netCents: 8_000_000 }),
          },
        },
        {
          collection: 'invoices' as const,
          id: 'fc-inv-1',
          data: invoice('fc-inv-1', FIRST.id, 4_500_000, '2026-09-15'),
        },
        {
          collection: 'invoices' as const,
          id: 'fc-inv-2',
          data: { ...invoice('fc-inv-2', FIRST.id, 4_500_000, '2026-11-15'), installment: 2 },
        },
        {
          collection: 'invoices' as const,
          id: 'fc-inv-3',
          data: invoice('fc-inv-3', SECOND.id, 8_000_000, '2026-12-15'),
        },
        {
          collection: 'renewals' as const,
          id: 'fc-renewal',
          data: {
            id: 'fc-renewal',
            studentId: SECOND.id,
            year: 2026,
            status: 'Etkin',
            mode: 'promote',
            targetClassId: 'c1',
            fromClassId: 'c1',
            amount: 8_000_000,
            contractId: 'fc-contract-2',
          },
        },
        ...prospects.map((data) => ({
          collection: 'prospects' as const,
          id: String(data.id),
          data,
        })),
      ],
      FIXED_NOW,
    )
    return { ...created, cookie: await signInAs(app, created.admin) }
  }

  const get = (url: string, cookie: string | null) =>
    app.inject({ method: 'GET', url, headers: cookie === null ? {} : { cookie } })

  test('DOM-FIN-063: oturumsuz 401; yönetici dışı roller 403; finance kapalıyken 403 module_disabled', async () => {
    assert.equal((await get(REVENUE, null)).statusCode, 401)
    assert.equal((await get(CASH_FLOW, null)).statusCode, 401)
    const a = await institution()
    for (const role of ['onburo', 'ogretmen'] as const) {
      const cookie = await signInAs(app, await createMember(app, a.id, role))
      for (const url of [REVENUE, CASH_FLOW]) {
        const response = await get(url, cookie)
        assert.equal(response.statusCode, 403, `${role} ${url}: ${response.body}`)
        assert.equal(response.json().data, undefined)
      }
    }
    const closed = await institution({ enabledModules: { finance: false } })
    for (const url of [REVENUE, CASH_FLOW]) {
      const response = await get(url, closed.cookie)
      assert.equal(response.statusCode, 403)
      assert.equal(response.json().code, 'module_disabled')
    }
  })

  test('DOM-FIN-063: bilinmeyen parametre, sorgudaki institutionId ve sınır dışı değer 400', async () => {
    const a = await institution()
    for (const url of [
      `${REVENUE}?institutionId=x`,
      `${REVENUE}?year=1999`,
      `${CASH_FLOW}?months=25`,
      `${CASH_FLOW}?months=0`,
      `${CASH_FLOW}?monthlyExpenseCents=-5`,
      `${CASH_FLOW}?institutionId=x`,
    ]) {
      const response = await get(url, a.cookie)
      assert.equal(response.statusCode, 400, `${url}: ${response.body}`)
      assert.equal(response.json().code, 'validation_failed', url)
    }
  })

  test('DOM-FIN-063 gelir tahmini: kesin gelir, indirim etkisi, huni beklentisi ve varsayımlar', async () => {
    const a = await institution()
    const response = await get(REVENUE, a.cookie)
    assert.equal(response.statusCode, 200, response.body)
    const { data } = response.json()
    assert.equal(data.year, 2026)
    assert.equal(data.enrollmentYear, 2026)
    assert.deepEqual(data.committed, {
      totalCents: 17_000_000,
      newEnrollmentCents: 9_000_000,
      renewalCents: 8_000_000,
      students: 2,
      newStudents: 1,
      renewalStudents: 1,
    })
    assert.deepEqual(data.contracts, {
      count: 2,
      listCents: 18_000_000,
      discountCents: 1_000_000,
      scholarshipCents: 0,
      netCents: 17_000_000,
    })
    // Aday adımı: 4 kapanmıştan 2 kayıt → %50; fiyat tarife ortalaması 100.000 ₺; indirim 1M/18M.
    const [first] = data.pipeline.steps
    assert.equal(first.step, 'prospect')
    assert.equal(first.prospects, 1)
    assert.equal(first.sampleSize, 4)
    assert.equal(first.rateBasisPoints, 5000)
    assert.equal(first.grossCents, 5_000_000)
    assert.equal(first.discountCents, 278_000)
    assert.deepEqual(
      data.pipeline.steps.map((step: { step: string }) => step.step),
      ['prospect', 'meeting'],
    )
    assert.equal(data.expectedTotalCents, 17_000_000 + 4_722_000)
    assert.deepEqual(data.assumptions, {
      pipelineStatus: 'included',
      historyFrom: '2024-10-06',
      historyTo: '2026-10-06',
      historyClosedProspects: 4,
      tariffYear: 2026,
      tariffCarriedOver: false,
      discountReferenceYear: 2026,
      discountRateBasisPoints: 556,
      contractAverageCents: 9_000_000,
      priceSources: { tariffLevel: 0, tariffAverage: 1, contractAverage: 0, none: 0 },
    })
    // Yanıt kişi verisi taşımaz.
    assert.doesNotMatch(response.body, /Aday fc-|05559990001|fc-x1/)

    const next = (await get(`${REVENUE}?year=2027`, a.cookie)).json().data
    assert.equal(next.committed.totalCents, 0)
    assert.equal(next.assumptions.tariffYear, 2026)
    assert.equal(next.assumptions.tariffCarriedOver, true)
    assert.equal(next.assumptions.discountReferenceYear, 2026)
    const past = (await get(`${REVENUE}?year=2025`, a.cookie)).json().data
    assert.equal(past.pipeline, null)
    assert.equal(past.assumptions.pipelineStatus, 'past_year')
  })

  test('DOM-FIN-063 gelir tahmini: crm kapalıyken huni okunmaz; dil okulunda deneme adımı vardır', async () => {
    const closed = await institution({ enabledModules: { crm: false } })
    const response = await get(REVENUE, closed.cookie)
    assert.equal(response.statusCode, 200, response.body)
    const { data } = response.json()
    assert.equal(data.pipeline, null)
    assert.equal(data.assumptions.pipelineStatus, 'crm_disabled')
    assert.equal(data.expectedTotalCents, 17_000_000)

    const language = await institution(
      { type: 'language_school' },
      {
        prospects: [
          prospect('fc-l1', 'Kayıt oldu', { studentId: 'fc-x1', trialLesson: { lessonId: 'l1' } }),
          prospect('fc-l2', 'Vazgeçti', { trialLesson: { lessonId: 'l1' } }),
          prospect('fc-l3', 'Görüşme planlandı', {
            interest: 'Genel İngilizce B1',
            trialLesson: { lessonId: 'l1' },
          }),
        ],
      },
    )
    const languageData = (await get(REVENUE, language.cookie)).json().data
    const trial = languageData.pipeline.steps.find(
      (step: { step: string }) => step.step === 'trial',
    )
    assert.equal(trial.prospects, 1)
    assert.equal(trial.rateBasisPoints, 5000)
    assert.equal(trial.grossCents, 5_000_000)
  })

  test('DOM-FIN-063 nakit akışı: aylık planlanan tahsilat, gecikmiş alacak, ödenmemiş iade ve elle gider', async () => {
    const a = await institution()
    assert.ok(FIRST)
    await insertWithdrawal(db, a.id, {
      id: randomUUID(),
      studentId: FIRST.id,
      contractId: 'fc-contract-1',
      withdrawalDate: '2026-10-01',
      reason: 'relocation',
      targetSchool: null,
      breakdown: { refundCents: 300_000, debtCents: 0, creditCents: 0 } as WithdrawalBreakdown,
      refundDueDate: '2026-11-10',
      approvedByUserId: a.admin.id,
      now: FIXED_NOW,
    })
    const response = await get(`${CASH_FLOW}?months=3`, a.cookie)
    assert.equal(response.statusCode, 200, response.body)
    const { data } = response.json()
    assert.equal(data.from, '2026-10')
    assert.equal(data.to, '2026-12')
    assert.deepEqual(
      data.months.map((month: { month: string; scheduledCents: number; refundCents: number }) => [
        month.month,
        month.scheduledCents,
        month.refundCents,
      ]),
      [
        ['2026-10', 0, 0],
        ['2026-11', 4_500_000, 300_000],
        ['2026-12', 8_000_000, 0],
      ],
    )
    assert.equal(data.overdueOpenCents, 4_500_000)
    assert.equal(data.pendingRefundCents, 300_000)
    assert.equal(data.assumptions.onTimeRateSource, 'default')
    assert.equal(data.assumptions.expenseSource, 'none')
    assert.equal(data.totals.expenseCents, null)
    assert.equal(data.totals.netCents, 4_500_000 - 300_000 + 8_000_000)

    const withExpense = (
      await get(`${CASH_FLOW}?months=2&monthlyExpenseCents=1000000`, a.cookie)
    ).json().data
    assert.equal(withExpense.assumptions.expenseSource, 'manual')
    assert.equal(withExpense.months[0].netCents, -1_000_000)
    assert.equal(withExpense.months[1].cumulativeNetCents, -1_000_000 + 4_200_000 - 1_000_000)
    assert.equal(withExpense.beyondHorizonCents, 8_000_000)
  })

  test('DOM-FIN-063: başka kurumun taksiti, sözleşmesi, adayı ve iadesi tahminde yok', async () => {
    const b = await institution()
    await insertWithdrawal(db, b.id, {
      id: randomUUID(),
      studentId: FIRST?.id ?? '',
      contractId: 'fc-contract-1',
      withdrawalDate: '2026-10-01',
      reason: 'relocation',
      targetSchool: null,
      breakdown: { refundCents: 500_000, debtCents: 0, creditCents: 0 } as WithdrawalBreakdown,
      refundDueDate: '2026-10-20',
      approvedByUserId: b.admin.id,
      now: FIXED_NOW,
    })
    const a = await institution({}, { prospects: [] })
    const revenue = (await get(`${REVENUE}?year=2026`, a.cookie)).json().data
    // A yalnız kendi iki sözleşmesini görür; B'nin aynı kimlikli kayıtları ve adayları sayılmaz.
    assert.equal(revenue.committed.totalCents, 17_000_000)
    assert.equal(revenue.contracts.count, 2)
    assert.equal(revenue.pipeline.prospects, 0)
    assert.equal(revenue.assumptions.historyClosedProspects, 0)
    const cash = (await get(CASH_FLOW, a.cookie)).json().data
    assert.equal(cash.pendingRefundCents, 0)
    assert.equal(cash.overdueOpenCents, 4_500_000)
    const own = (await get(CASH_FLOW, b.cookie)).json().data
    assert.equal(own.pendingRefundCents, 500_000)
  })
})
