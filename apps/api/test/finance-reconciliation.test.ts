import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'
import { defaultFinanceExportProfile } from '@kampus/school-core/lib/finance-export-profile.ts'
import { OPENING_IMPORT_METHOD } from '@kampus/school-core/lib/payments.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import { insertAcademicYear } from '../src/db/academic-years.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
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
import {
  contractTerms,
  insertTestScholarshipProgram,
  insertTestTariff,
  TEST_SCHOLARSHIP_PROGRAM_ID,
} from './support/finance-terms.ts'

/**
 * Yıl sonu mutabakatı (ON-085, IST-111; DOM-FIN-056). Her test kendi kurumunu kurar: bir öğrenci,
 * sözleşme (net 100.000 ₺) ve vadesi 15 Eylül 2026 olan iki taksit. FIXED_NOW 2026-10-06; 2026 yılının
 * dönemi 1 Eylül – 6 Ekim'dir.
 */

const SEED = createSeed(FIXED_NOW)
const STUDENT = SEED.students.find((item) => item.classId === 'c1')
const PARENT_NAME = 'Test Ödeyici Veli'
const NET = 10_000_000
const HALF = NET / 2
const URL_2026 = '/api/v1/finance/reconciliation?year=2026'
const EXPORT_2026 = '/api/v1/finance/reconciliation/export?year=2026'

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
  ...extra,
})

const WITHDRAW = {
  withdrawalDate: '2026-10-01',
  termStartDate: '2026-09-07',
  attendedUnits: 18,
  totalUnits: 180,
  reason: 'relocation',
  targetSchool: 'Test Okulu',
}
const REFUND = {
  paidDate: '2026-10-05',
  iban: 'TR330006100519786457841326',
  accountHolder: PARENT_NAME,
}

type Amounts = {
  openingCents: number
  accruedCents: number
  withdrawalAdjustmentCents: number
  collectedCents: number
  openingImportCents: number
  reversedCents: number
  refundedCents: number
  scholarshipCents: number
  discountCents: number
  closingCents: number
  expectedClosingCents: number
  differenceCents: number
}

describe('yıl sonu mutabakatı', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-mt-${String(++serial).padStart(5, '0')}` })
  // ON-046e: her testten sonra taksit ve sözleşme aynası kaynakla aynıdır.
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    assert.ok(STUDENT)
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(
    overrides: Partial<InstitutionOverrides> = {},
    options: { contract?: Record<string, unknown>; invoices?: unknown[] } = {},
  ) {
    const created = await createInstitution(app, overrides)
    assert.ok(STUDENT)
    await insertTestTariff(db, created.id)
    await insertTestScholarshipProgram(db, created.id)
    const invoices = (options.invoices ?? [invoice('test-inv-1', 1), invoice('test-inv-2', 2)]) as {
      id: string
    }[]
    await insertMissingRecords(
      db,
      created.id,
      [
        {
          collection: 'classes' as const,
          id: 'c1',
          data: { ...SEED.classes.find((item) => item.id === 'c1') },
        },
        { collection: 'students' as const, id: STUDENT.id, data: { ...STUDENT } },
        {
          collection: 'parents' as const,
          id: STUDENT.parentId,
          data: { id: STUDENT.parentId, name: PARENT_NAME, studentIds: [STUDENT.id] },
        },
        {
          collection: 'contracts' as const,
          id: 'test-contract',
          data: {
            id: 'test-contract',
            studentId: STUDENT.id,
            date: '2026-01-01T09:00:00.000Z',
            amount: NET,
            title: 'Sözleşme',
            academicYear: 2026,
            invoiceIds: invoices.map((item) => item.id),
            ...contractTerms({ grossCents: NET, netCents: NET }),
            ...options.contract,
          },
        },
        ...invoices.map((item) => ({
          collection: 'invoices' as const,
          id: item.id,
          data: { ...item },
        })),
      ],
      FIXED_NOW,
    )
    return { ...created, cookie: await signInAs(app, created.admin) }
  }
  const member = async (id: string, role: Role) =>
    signInAs(app, await createMember(app, id, role, []))
  function send(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    cookie: string | null,
    body?: unknown,
    headers: Record<string, string> = {},
    target: App = app,
  ) {
    return target.inject({
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
  const report = (cookie: string | null, url = URL_2026) => send('GET', url, cookie)
  const pay = (cookie: string, amountCents: number, reference: string) =>
    send(
      'POST',
      '/api/v1/payments',
      cookie,
      { studentId: STUDENT?.id, amountCents, method: 'Banka havalesi', reference },
      key(),
    )
  const reverse = (cookie: string, id: string, version: number) =>
    send(
      'POST',
      `/api/v1/payments/${id}/reverse`,
      cookie,
      { reason: 'Yanlış öğrenciye girildi' },
      { 'if-match': `"${String(version)}"`, ...key() },
    )
  const withdraw = (cookie: string) =>
    send('POST', `/api/v1/students/${STUDENT?.id ?? ''}/withdraw`, cookie, WITHDRAW, key())
  const payRefund = (cookie: string, id: string, version: number) =>
    send('POST', `/api/v1/withdrawals/${id}/pay-refund`, cookie, REFUND, {
      'if-match': `"${String(version)}"`,
      ...key(),
    })
  function assertError(
    response: Awaited<ReturnType<typeof send>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  /** Formül her satırda ve toplamda tutar; toplamlar aynı dönemin aktarım özetine eşittir. */
  async function balanced(cookie: string): Promise<Amounts> {
    const response = await report(cookie)
    assert.equal(response.statusCode, 200, response.body)
    const { data } = response.json() as {
      data: {
        from: string
        to: string
        mismatchCount: number
        totals: Amounts
        rows: Amounts[]
      }
    }
    assert.equal(data.mismatchCount, 0)
    for (const amounts of [...data.rows, data.totals]) {
      assert.equal(amounts.differenceCents, 0)
      assert.equal(
        amounts.openingCents +
          amounts.accruedCents -
          amounts.withdrawalAdjustmentCents -
          amounts.collectedCents -
          amounts.openingImportCents +
          amounts.reversedCents +
          amounts.refundedCents,
        amounts.closingCents,
      )
    }
    const summary = await send(
      'GET',
      `/api/v1/finance/summary?from=${data.from}&to=${data.to}`,
      cookie,
    )
    const totals = summary.json().data
    assert.equal(data.totals.collectedCents - data.totals.reversedCents, totals.payments.totalCents)
    assert.equal(data.totals.refundedCents, totals.refunds.totalCents)
    assert.equal(data.totals.accruedCents, totals.invoices.totalCents)
    return data.totals
  }

  test('DOM-FIN-052: oturumsuz 401; yalnız yönetici okur ve indirir; modül kapalı 403', async () => {
    assertError(await report(null), 401)
    assertError(await report(null, EXPORT_2026), 401)
    const a = await institution()
    for (const role of ['onburo', 'ogretmen', 'ogrenci', 'veli'] as const) {
      const cookie = await member(a.id, role)
      assertError(await report(cookie), 403, 'forbidden')
      assertError(await report(cookie, EXPORT_2026), 403, 'forbidden')
    }
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await report(closed.cookie), 403, 'module_disabled')
    assertError(await report(closed.cookie, EXPORT_2026), 403, 'module_disabled')
  })

  test('guvenlik-kvkk: eski oturumla dosya 403 reauthentication_required; rapor açık', async () => {
    const a = await institution()
    const later = await buildTestApp(db, {
      clock: () => new Date(Date.now() + 16 * 60 * 1000),
    })
    try {
      assertError(
        await send('GET', EXPORT_2026, a.cookie, undefined, {}, later),
        403,
        'reauthentication_required',
      )
      assert.equal((await send('GET', URL_2026, a.cookie, undefined, {}, later)).statusCode, 200)
    } finally {
      await later.close()
    }
  })

  test('IST-111: geçersiz yıl ve parametre 400; başlamamış yıl 422; kayıt değişmez', async () => {
    const a = await institution()
    const before = await loadRecords(db, a.id, ['invoices', 'contracts'])
    for (const query of [
      '',
      '?year=abc',
      '?year=1999',
      '?year=2101',
      '?year=2026&status=hepsi',
      '?year=2026&pageSize=1000',
      '?year=2026&institutionId=x',
    ])
      assertError(await report(a.cookie, `/api/v1/finance/reconciliation${query}`), 400)
    assertError(await report(a.cookie, '/api/v1/finance/reconciliation/export'), 400)
    assertError(
      await report(a.cookie, '/api/v1/finance/reconciliation/export?year=2026&status=mismatch'),
      400,
    )
    assertError(
      await report(a.cookie, '/api/v1/finance/reconciliation?year=2027'),
      422,
      'reconciliation_year_not_started',
    )
    assert.deepEqual(await loadRecords(db, a.id, ['invoices', 'contracts']), before)
  })

  test('IST-002 başka kurumun öğrencisi ve tutarı raporda ve dosyada yok', async () => {
    const a = await institution()
    const b = await institution()
    assert.equal((await pay(b.cookie, 777_777, 'TR-B1')).statusCode, 201)
    const { data } = (
      await send('GET', '/api/v1/finance/reconciliation?year=2026', a.cookie)
    ).json() as { data: { totals: Amounts } }
    assert.equal(data.totals.collectedCents, 0)
    const file = await send('GET', '/api/v1/finance/reconciliation/export?year=2026', a.cookie)
    assert.equal(file.statusCode, 200, file.body)
    assert.equal(file.body.includes('7777,77'), false)
    const own = (await report(b.cookie)).json() as { data: { totals: Amounts } }
    assert.equal(own.data.totals.collectedCents, 777_777)
  })

  test('DOM-FIN-056: kısmi ödemede kalan kısım kapanışa kalır, açılış sıfırdır', async () => {
    const a = await institution()
    assert.equal((await pay(a.cookie, 3_000_000, 'TR-K1')).statusCode, 201)
    const totals = await balanced(a.cookie)
    assert.equal(totals.openingCents, 0)
    assert.equal(totals.accruedCents, NET)
    assert.equal(totals.collectedCents, 3_000_000)
    assert.equal(totals.closingCents, NET - 3_000_000)
  })

  test('DOM-FIN-033: tahsilat iptali borcu geri açar, iki yönde sayılır', async () => {
    const a = await institution()
    const { id, version } = (await pay(a.cookie, 5_000_000, 'TR-I1')).json().data
    assert.equal((await reverse(a.cookie, id, version)).statusCode, 200)
    const totals = await balanced(a.cookie)
    assert.equal(totals.collectedCents, 5_000_000)
    assert.equal(totals.reversedCents, 5_000_000)
    assert.equal(totals.closingCents, NET)
  })

  test('DOM-FIN-041: iade ödenene kadar kapanış eksidir, ödenince sıfırdır', async () => {
    const a = await institution()
    assert.equal((await pay(a.cookie, HALF, 'TR-D1')).statusCode, 201)
    const left = await withdraw(a.cookie)
    assert.equal(left.statusCode, 201, left.body)
    const { id, version, refundCents } = left.json().data
    assert.equal(refundCents, 3_000_000)

    const unpaid = await balanced(a.cookie)
    assert.equal(unpaid.accruedCents, HALF)
    assert.equal(unpaid.withdrawalAdjustmentCents, 3_000_000)
    assert.equal(unpaid.refundedCents, 0)
    assert.equal(unpaid.closingCents, -3_000_000)

    assert.equal((await payRefund(a.cookie, id, version)).statusCode, 200)
    const paid = await balanced(a.cookie)
    assert.equal(paid.refundedCents, 3_000_000)
    assert.equal(paid.closingCents, 0)
  })

  test('DOM-FIN-041: iptal edilen taksite alınan kısmi ödeme ayrılışta mahsup edilir', async () => {
    const a = await institution()
    assert.equal((await pay(a.cookie, 6_000_000, 'TR-D2')).statusCode, 201)
    const left = await withdraw(a.cookie)
    assert.equal(left.statusCode, 201, left.body)
    const { id, version, refundCents } = left.json().data
    assert.equal(refundCents, 4_000_000)
    assert.equal((await balanced(a.cookie)).closingCents, -4_000_000)
    assert.equal((await payRefund(a.cookie, id, version)).statusCode, 200)
    const paid = await balanced(a.cookie)
    assert.equal(paid.withdrawalAdjustmentCents, 3_000_000)
    assert.equal(paid.closingCents, 0)
  })

  test('DOM-FIN-041: ayrılışta kalan borç taksitte açık kalır', async () => {
    const a = await institution()
    assert.equal((await pay(a.cookie, 1_000_000, 'TR-D3')).statusCode, 201)
    const left = await withdraw(a.cookie)
    assert.equal(left.statusCode, 201, left.body)
    assert.equal(left.json().data.debtCents, 1_000_000)
    const open = await balanced(a.cookie)
    assert.equal(open.accruedCents, 1_000_000)
    assert.equal(open.withdrawalAdjustmentCents, -1_000_000)
    assert.equal(open.closingCents, 1_000_000)
    assert.equal((await pay(a.cookie, 1_000_000, 'TR-D4')).statusCode, 201)
    assert.equal((await balanced(a.cookie)).closingCents, 0)
  })

  test('DOM-FIN-025: burs ve indirim bilgi sütunudur; burslu ayrılışta toplam tutar', async () => {
    const a = await institution(
      {},
      {
        contract: {
          ...contractTerms({ grossCents: NET + 1_500_000, netCents: NET }),
          discounts: [{ kind: 'early_registration', amountCents: 500_000 }],
          scholarship: { programId: TEST_SCHOLARSHIP_PROGRAM_ID, amountCents: 1_000_000 },
        },
      },
    )
    assert.equal((await pay(a.cookie, 1_000_000, 'TR-B2')).statusCode, 201)
    const running = await balanced(a.cookie)
    assert.equal(running.scholarshipCents, 1_000_000)
    assert.equal(running.discountCents, 500_000)
    assert.equal(running.accruedCents, NET)

    // Burslu ayrılışta öğrenim için ödenenden fazlası istenmez: borç doğmaz, iade de yok.
    const left = await withdraw(a.cookie)
    assert.equal(left.statusCode, 201, left.body)
    assert.equal(left.json().data.debtCents, 0)
    assert.equal(left.json().data.refundCents, 0)
    const closed = await balanced(a.cookie)
    assert.equal(closed.scholarshipCents, 1_000_000)
    assert.equal(closed.closingCents, 0)
  })

  test('DOM-FIN-056: önceki yılın borcu bu yılın açılışıdır; yıl dönemi kurum aralığından gelir', async () => {
    const a = await institution(
      {},
      {
        invoices: [
          invoice('test-inv-1', 1, { dueDate: '2026-05-15T09:00:00.000Z' }),
          invoice('test-inv-2', 2),
        ],
      },
    )
    assert.equal((await balanced(a.cookie)).openingCents, HALF)

    const previous = (await report(a.cookie, '/api/v1/finance/reconciliation?year=2025')).json()
    assert.equal(previous.data.from, '2025-09-01')
    assert.equal(previous.data.to, '2026-08-31')
    assert.equal(previous.data.totals.accruedCents, HALF)
    assert.equal(previous.data.totals.closingCents, HALF)

    await insertAcademicYear(
      db,
      a.id,
      {
        startYear: 2024,
        startDate: '2024-08-15',
        endDate: '2025-07-31',
        status: 'closed',
        activatedAt: '2024-08-15T09:00:00.000Z',
        closedAt: '2025-07-31T09:00:00.000Z',
        terms: [],
      },
      FIXED_NOW,
    )
    const custom = (await report(a.cookie, '/api/v1/finance/reconciliation?year=2024')).json()
    assert.equal(custom.data.from, '2024-08-15')
    assert.equal(custom.data.to, '2025-07-31')
  })

  test('DOM-FIN-056: tahsilat kaydı olmadan ödenmiş taksit tutmayan listesine düşer; süzgeç ve sayfa', async () => {
    const a = await institution(
      {},
      {
        invoices: [
          invoice('test-inv-1', 1, {
            paidAt: '2026-09-16T09:00:00.000Z',
            method: 'Banka havalesi',
          }),
          invoice('test-inv-2', 2),
        ],
      },
    )
    const all = (await report(a.cookie)).json()
    assert.equal(all.data.mismatchCount, 1)
    assert.equal(all.meta.total, 1)
    const [row] = all.data.rows
    assert.equal(row.studentId, STUDENT?.id)
    assert.equal(row.studentName, STUDENT?.name)
    assert.equal(row.mismatchReason, 'unrecorded_payment')
    assert.equal(row.differenceCents, -HALF)
    assert.equal(row.closingCents, HALF)
    assert.equal(row.expectedClosingCents, NET)

    const filtered = (await report(a.cookie, `${URL_2026}&status=mismatch`)).json()
    assert.equal(filtered.meta.total, 1)
    assert.equal(filtered.data.rows.length, 1)
    const beyond = (await report(a.cookie, `${URL_2026}&page=2&pageSize=1`)).json()
    assert.equal(beyond.meta.total, 1)
    assert.equal(beyond.data.rows.length, 0)
    // Toplamlar sayfadan ve süzgeçten bağımsızdır.
    assert.equal(beyond.data.totals.accruedCents, NET)

    const clean = await institution()
    const none = (await report(clean.cookie, `${URL_2026}&status=mismatch`)).json()
    assert.equal(none.meta.total, 0)
    assert.equal(none.data.mismatchCount, 0)
    assert.equal(none.data.totals.accruedCents, NET)
  })

  const importedInvoice = (id: string, installment: number) =>
    invoice(id, installment, {
      paidAt: '2026-09-14T09:00:00.000Z',
      method: OPENING_IMPORT_METHOD,
    })

  test('DOM-FIN-056 DOM-FIN-014: açılış aktarımı tahsilat sayılmaz, tutmayan çıkmaz; dosyada ayrı sütun', async () => {
    const a = await institution(
      {},
      { invoices: [importedInvoice('test-inv-1', 1), invoice('test-inv-2', 2)] },
    )
    const totals = await balanced(a.cookie)
    assert.equal(totals.accruedCents, NET)
    assert.equal(totals.collectedCents, 0)
    assert.equal(totals.openingImportCents, HALF)
    assert.equal(totals.closingCents, HALF)

    const listed = (await report(a.cookie, `${URL_2026}&status=mismatch`)).json()
    assert.equal(listed.meta.total, 0)
    const [row] = (await report(a.cookie)).json().data.rows
    assert.equal(row.openingImportCents, HALF)
    assert.equal(row.mismatchReason, null)

    const file = await send('GET', EXPORT_2026, a.cookie)
    assert.equal(file.statusCode, 200, file.body)
    assert.match(file.body, /"Tahsilat \(₺\)";"Açılış aktarımı \(₺\)";/)
    assert.match(file.body, /;0,00;50000,00;0,00;0,00;0,00;0,00;50000,00;50000,00;0,00;"Tutuyor"/)
  })

  test('DOM-FIN-014 DOM-FIN-041: aktarılmış ödemeyle ayrılışta iade ödenince formül tutar', async () => {
    const a = await institution(
      {},
      { invoices: [importedInvoice('test-inv-1', 1), invoice('test-inv-2', 2)] },
    )
    const left = await withdraw(a.cookie)
    assert.equal(left.statusCode, 201, left.body)
    const { id, version, refundCents } = left.json().data
    assert.equal(refundCents, 3_000_000)

    const unpaid = await balanced(a.cookie)
    assert.equal(unpaid.accruedCents, HALF)
    assert.equal(unpaid.openingImportCents, HALF)
    assert.equal(unpaid.collectedCents, 0)
    assert.equal(unpaid.closingCents, -3_000_000)

    assert.equal((await payRefund(a.cookie, id, version)).statusCode, 200)
    const paid = await balanced(a.cookie)
    assert.equal(paid.refundedCents, 3_000_000)
    assert.equal(paid.closingCents, 0)
  })

  test('DOM-FIN-056: aktarım dışında tahsilatsız ödenmiş taksit tutmayan kalır', async () => {
    const a = await institution(
      {},
      {
        invoices: [
          invoice('test-inv-1', 1, {
            paidAt: '2026-09-14T09:00:00.000Z',
            method: 'Banka havalesi',
          }),
          importedInvoice('test-inv-2', 2),
        ],
      },
    )
    const { data } = (await report(a.cookie)).json()
    assert.equal(data.mismatchCount, 1)
    assert.equal(data.totals.openingImportCents, HALF)
    assert.equal(data.totals.differenceCents, -HALF)
    assert.equal(data.rows[0].mismatchReason, 'unrecorded_payment')
  })

  test('IST-111: dosya BOM, ad ve kaçışla iner; satır toplamı rapora eşittir', async () => {
    const a = await institution()
    await pay(a.cookie, 3_000_000, 'TR-F1')
    const file = await send('GET', EXPORT_2026, a.cookie)
    assert.equal(file.statusCode, 200, file.body)
    assert.match(String(file.headers['content-type']), /^text\/csv/)
    assert.equal(
      file.headers['content-disposition'],
      'attachment; filename="reconciliation-2026-09-01-2026-10-06.csv"',
    )
    assert.equal(file.body.startsWith('﻿"Öğrenci";"Okul no";"Açılış (₺)"'), true)
    assert.equal(file.body.includes(`"${STUDENT?.name ?? 'yok'}"`), true)
    assert.equal(file.body.includes('100000,00;0,00;30000,00;0,00'), true)
    assert.equal(file.body.includes('"Tutuyor"'), true)
  })

  test('DOM-FIN-055: kurum profili biçimi ve sütunları dosyaya uygular; eski profil de çalışır', async () => {
    const a = await institution()
    const profile = defaultFinanceExportProfile()
    const saved = await send(
      'PATCH',
      '/api/v1/finance/export-profile',
      a.cookie,
      {
        profile: {
          ...profile,
          separator: ',',
          decimal: '.',
          columns: {
            ...profile.columns,
            reconciliation: [
              { source: 'studentName', header: 'Ad' },
              { source: 'fixed', header: 'Hesap kodu', value: '120.01' },
              { source: 'accrued', header: 'Borç' },
            ],
          },
        },
      },
      { 'if-match': '"1"', ...key() },
    )
    assert.equal(saved.statusCode, 200, saved.body)
    const file = await send('GET', EXPORT_2026, a.cookie)
    assert.equal(file.statusCode, 200, file.body)
    assert.equal(file.body.startsWith('﻿"Ad","Hesap kodu","Borç"\r\n'), true)
    assert.equal(file.body.includes('"120.01",100000.00'), true)

    const { reconciliation, ...oldColumns } = profile.columns
    assert.ok(reconciliation)
    const old = await send(
      'PATCH',
      '/api/v1/finance/export-profile',
      a.cookie,
      { profile: { ...profile, separator: ',', decimal: '.', columns: oldColumns } },
      { 'if-match': '"2"', ...key() },
    )
    assert.equal(old.statusCode, 200, old.body)
    const standard = await send('GET', EXPORT_2026, a.cookie)
    assert.equal(standard.body.startsWith('﻿"Öğrenci","Okul no"'), true)
  })

  test('DOM-YTK-053: dosya denetime yıl ve dönemle düşer, tutar taşımaz; rapor okuması düşmez', async () => {
    const a = await institution()
    await pay(a.cookie, 5_000, 'TR-A1')
    assert.equal((await report(a.cookie)).statusCode, 200)
    const exported = () =>
      db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'finance.export')))
    assert.equal((await exported()).length, 0)
    assert.equal((await send('GET', EXPORT_2026, a.cookie)).statusCode, 200)
    const rows = await exported()
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.entityId, 'reconciliation:2026:2026-09-01:2026-10-06')
    assert.deepEqual(rows[0]?.changes, { fields: [] })
    assert.equal(JSON.stringify(rows[0]).includes('TR-A1'), false)
  })
})
