import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, like } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { financeDayClosings } from '../src/db/schema/finance-day-closings.ts'
import {
  supplierInvoiceInstallments,
  supplierInvoices,
  supplierPayments,
} from '../src/db/schema/finance-supplier-ledger.ts'
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
 * Tedarikçi carisi ve ödeme planı uçları (DOM-FIN-076; ON-143). Her test kendi kurumunu kurar:
 * IBAN'lı şirket tedarikçi, IBAN'sız ikinci tedarikçi ve kurum banka hesabı. FIXED_NOW 2026-10-06
 * (Europe/Istanbul günü de 2026-10-06).
 */

const FINANCE = '/api/v1/finance'
const INVOICES = `${FINANCE}/supplier-invoices`
const PAYMENTS = `${FINANCE}/supplier-payments`
const LEDGER = `${FINANCE}/supplier-ledger`
const INSTRUCTION = `${PAYMENTS}/instruction-file`
const TODAY = '2026-10-06'
const YESTERDAY = '2026-10-05'
const SUPPLIER_IBAN = 'TR330006100519786457841326'
const ACCOUNT_IBAN = 'TR320010009999901234567890'

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-076: tedarikçi carisi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.76.0.1'

  before(async () => {
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
  const get = (url: string, cookie: string | null) => call('GET', url, cookie)
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
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
    clientIp = `10.76.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    const admin = await signInAs(app, created.admin)
    if (overrides.enabledModules?.finance === false) return { id: created.id, admin } as Tenant
    const post = async (url: string, body: Json) =>
      ok(await call('POST', url, admin, body, key()), 201)
    const supplier = (name: string, taxNumber: string, extra: Json = {}) =>
      post(`${FINANCE}/suppliers`, {
        name,
        type: 'company',
        taxNumber,
        taxOffice: 'Kadıköy',
        categories: ['it'],
        ...extra,
      })
    const alpha = await supplier('Alfa Bilişim A.Ş.', '1234567890', { iban: SUPPLIER_IBAN })
    const beta = await supplier('Beta Teknoloji Ltd.', '1111111114')
    const account = await post('/api/v1/bank-accounts', {
      bankName: 'Örnek Bankası',
      iban: ACCOUNT_IBAN,
      accountHolder: 'Akademi Özel Okulları',
    })
    return { id: created.id, admin, alpha, beta, account }
  }
  type Tenant = { id: string; admin: string; alpha: Json; beta: Json; account: Json }

  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))
  const invoiceBody = (t: Pick<Tenant, 'alpha'>, overrides: Json = {}) => ({
    supplierId: t.alpha.id,
    invoiceNumber: 'abc 2026 0001',
    invoiceDate: '2026-09-01',
    dueDate: '2026-10-31',
    amountCents: 120_000,
    amountIncludesVat: true,
    vatCents: 20_000,
    ...overrides,
  })
  const createInvoice = (cookie: string, body: unknown, headers: Record<string, string> = key()) =>
    call('POST', INVOICES, cookie, body, headers)
  const payBody = (t: Tenant, installment: Json, overrides: Json = {}) => ({
    installmentId: installment.id,
    paidDate: TODAY,
    amountCents: 10_000,
    method: 'eft',
    bankAccountId: t.account.id,
    ...overrides,
  })
  const pay = (cookie: string, body: unknown, headers: Record<string, string> = key()) =>
    call('POST', PAYMENTS, cookie, body, headers)
  const installmentsOf = (invoice: Json) => invoice.installments as Json[]
  const rows = async (institutionId: string) => ({
    invoices: await db
      .select()
      .from(supplierInvoices)
      .where(eq(supplierInvoices.institutionId, institutionId)),
    installments: await db
      .select()
      .from(supplierInvoiceInstallments)
      .where(eq(supplierInvoiceInstallments.institutionId, institutionId)),
    payments: await db
      .select()
      .from(supplierPayments)
      .where(eq(supplierPayments.institutionId, institutionId)),
  })

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    assertError(await get(INVOICES, null), 401)
    assertError(await createInvoice(null as unknown as string, {}), 401)
    assertError(await get(`${INVOICES}/${id}`, null), 401)
    assertError(await call('POST', `${INVOICES}/${id}/plan`, null, {}, ifMatch(1)), 401)
    assertError(await call('POST', `${INVOICES}/${id}/cancel`, null, {}, ifMatch(1)), 401)
    assertError(await get(PAYMENTS, null), 401)
    assertError(await call('POST', PAYMENTS, null, {}, key()), 401)
    assertError(await call('POST', `${PAYMENTS}/${id}/cancel`, null, {}, ifMatch(1)), 401)
    assertError(await call('POST', INSTRUCTION, null, { paymentIds: [id] }), 401)
    assertError(await get(LEDGER, null), 401)
    assertError(await get(`${LEDGER}/${id}`, null), 401)
  })

  test('DOM-FIN-076: ön büro, öğretmen, veli ve öğrenci 403; finance modülü kapalıyken 403 (K-160)', async () => {
    const t = await institution()
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(INVOICES, cookie), 403)
      assertError(await createInvoice(cookie, invoiceBody(t)), 403)
      assertError(await get(LEDGER, cookie), 403)
      assertError(await get(PAYMENTS, cookie), 403)
    }
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(INVOICES, closed.admin), 403, 'module_disabled')
    assertError(await get(LEDGER, closed.admin), 403, 'module_disabled')
    assert.equal((await rows(t.id)).invoices.length, 0)
  })

  test('DOM-FIN-076: fatura ve tek vadeli plan kaydedilir; numara tedarikçide tekil, aynı anahtar yanıtı tekrarlar (K-161)', async () => {
    const t = await institution()
    const headers = key()
    const created = ok(await createInvoice(t.admin, invoiceBody(t), headers), 201)
    assert.equal(created.invoiceNumber, 'ABC20260001')
    assert.deepEqual(
      [created.netCents, created.vatCents, created.grossCents, created.remainingCents],
      [100_000, 20_000, 120_000, 120_000],
    )
    assert.equal(created.status, 'open')
    assert.equal(created.dueDate, '2026-10-31')
    assert.deepEqual(
      installmentsOf(created).map((item) => [item.dueDate, item.amountCents]),
      [['2026-10-31', 120_000]],
    )
    assert.deepEqual(created.actions, { pay: true, replan: true, cancel: true })
    assert.equal(created.createdByName, 'Test Yönetici')
    const replay = await createInvoice(t.admin, invoiceBody(t), headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((replay.json().data as Json).id, created.id)
    assertError(
      await createInvoice(t.admin, invoiceBody(t, { invoiceNumber: 'ABC2026 0001' })),
      409,
      'supplier_invoice_number_exists',
    )
    // Başka tedarikçide aynı numara serbesttir.
    ok(await createInvoice(t.admin, invoiceBody(t, { supplierId: t.beta.id })), 201)
    const stored = await rows(t.id)
    assert.equal(stored.invoices.length, 2)
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'supplier_invoice.create')))
    assert.ok(audit)
    assert.equal(JSON.stringify(audit.changes).includes('ABC2026'), false)
  })

  test('DOM-FIN-076: geçersiz fatura 400/422 ve hiçbir kayıt yazılmaz', async () => {
    const t = await institution()
    assertError(await createInvoice(t.admin, invoiceBody(t), {}), 400, 'idempotency_key_required')
    assertError(await createInvoice(t.admin, invoiceBody(t, { dueDate: undefined })), 400)
    assertError(await createInvoice(t.admin, invoiceBody(t, { vatCents: 120_000 })), 400)
    assertError(await createInvoice(t.admin, invoiceBody(t, { institutionId: t.id })), 400)
    assertError(
      await createInvoice(t.admin, invoiceBody(t, { invoiceDate: '2026-10-07' })),
      422,
      'supplier_invoice_date_in_future',
    )
    assertError(
      await createInvoice(
        t.admin,
        invoiceBody(t, {
          dueDate: undefined,
          installments: [{ dueDate: '2026-10-31', amountCents: 100_000 }],
        }),
      ),
      422,
      'supplier_invoice_plan_total_mismatch',
    )
    assertError(
      await createInvoice(t.admin, invoiceBody(t, { supplierId: randomUUID() })),
      422,
      'supplier_invoice_supplier_not_found',
    )
    assertError(
      await createInvoice(t.admin, invoiceBody(t, { purchaseOrderId: randomUUID() })),
      422,
      'supplier_invoice_order_not_found',
    )
    const stored = await rows(t.id)
    assert.deepEqual([stored.invoices.length, stored.installments.length], [0, 0])
  })

  /** Gönderilmiş sipariş: 10 klavye × 200 TL + %20 KDV = 2.400 TL. */
  async function sentOrder(t: Tenant, supplier: Json) {
    const post = async (url: string, body: Json, headers: Record<string, string> = {}) =>
      ok(await call('POST', `${FINANCE}${url}`, t.admin, body, headers), 201)
    const center = await post('/cost-centers', { code: 'BT', name: 'Bilgi İşlem', type: 'unit' })
    const expense = await post('/budget-items', { code: 'G-200', name: 'Malzeme', kind: 'expense' })
    const period = await post('/budget-periods', { name: '2026–2027', academicYear: 2026 })
    ok(
      await call(
        'POST',
        `${FINANCE}/budget-periods/${String(period.id)}/open`,
        t.admin,
        undefined,
        ifMatch(period.version),
      ),
    )
    await post(`/budget-periods/${String(period.id)}/lines`, {
      costCenterId: center.id,
      itemId: expense.id,
      amountCents: 1_000_000,
    })
    const request = await post('/purchase-requests', {
      costCenterId: center.id,
      periodId: period.id,
      budgetItemId: expense.id,
      justification: 'Bilgisayar laboratuvarı için klavye',
      items: [{ name: 'Klavye', quantity: 10, unit: 'piece', estimatedUnitPriceCents: 25_000 }],
    })
    const url = `${FINANCE}/purchase-requests/${String(request.id)}`
    const submitted = ok(await call('POST', `${url}/submit`, t.admin, undefined, ifMatch(1)))
    ok(await call('POST', `${url}/approve`, t.admin, {}, ifMatch(submitted.version)))
    const board = ok(
      await call('POST', `${url}/quotes`, t.admin, {
        supplierId: supplier.id,
        deliveryDays: 5,
        validUntil: '2026-10-31',
        items: [
          {
            requestItemId: (request.items as Json[])[0]?.id,
            unitPriceCents: 20_000,
            vatRate: 20,
          },
        ],
      }),
      201,
    )
    const quote = (board.quotes as Json[])[0] as Json
    ok(
      await call(
        'POST',
        `${url}/quotes/${String(quote.id)}/select`,
        t.admin,
        {},
        ifMatch(quote.version),
      ),
    )
    const order = await post('/purchase-orders', { quoteId: quote.id }, key())
    return order
  }

  test('DOM-FIN-076, DOM-FIN-073: siparişe bağlı fatura; sipariş tutarı aşılırsa açık onay (K-162)', async () => {
    const t = await institution()
    const draft = await sentOrder(t, t.alpha)
    assertError(
      await createInvoice(t.admin, invoiceBody(t, { purchaseOrderId: draft.id })),
      422,
      'supplier_invoice_order_not_open',
    )
    const sent = ok(
      await call(
        'POST',
        `${FINANCE}/purchase-orders/${String(draft.id)}/send`,
        t.admin,
        undefined,
        ifMatch(draft.version),
      ),
    )
    assertError(
      await createInvoice(
        t.admin,
        invoiceBody(t, { supplierId: t.beta.id, purchaseOrderId: sent.id }),
      ),
      422,
      'supplier_invoice_order_supplier_mismatch',
    )
    const first = ok(
      await createInvoice(
        t.admin,
        invoiceBody(t, { purchaseOrderId: sent.id, amountCents: 200_000, vatCents: 40_000 }),
      ),
      201,
    )
    assert.deepEqual(first.purchaseOrder, { id: sent.id, number: sent.number })
    // 2.000 + 1.200 TL > 2.400 TL: uyarı, kayıt yok.
    const over = invoiceBody(t, { invoiceNumber: 'ABC-2', purchaseOrderId: sent.id })
    const warning = await createInvoice(t.admin, over)
    assertError(warning, 409, 'supplier_invoice_exceeds_order_warning')
    assert.match(warning.json().message as string, /800,00/)
    assert.equal((await rows(t.id)).invoices.length, 1)
    ok(await createInvoice(t.admin, { ...over, confirmOverOrder: true }), 201)
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'supplier_invoice.create')))
    assert.equal(
      audits.filter((row) => JSON.stringify(row.changes).includes('confirmOverOrder')).length,
      1,
    )
    const listed = (
      await get(`${INVOICES}?purchaseOrderId=${String(sent.id)}`, t.admin)
    ).json() as {
      meta: { total: number }
    }
    assert.equal(listed.meta.total, 2)
  })

  test('DOM-FIN-076: kısmi ödeme taksite yazılır, kalanı aşan ödeme 422; plan ve iptal ödemeyle kilitlenir', async () => {
    const t = await institution()
    const invoice = ok(
      await createInvoice(
        t.admin,
        invoiceBody(t, {
          dueDate: undefined,
          installments: [
            { dueDate: '2026-11-01', amountCents: 70_000 },
            { dueDate: '2026-10-01', amountCents: 50_000 },
          ],
        }),
      ),
      201,
    )
    const [firstDue, secondDue] = installmentsOf(invoice)
    assert.deepEqual(
      [firstDue?.dueDate, firstDue?.overdue, secondDue?.dueDate],
      ['2026-10-01', true, '2026-11-01'],
    )
    assert.equal(invoice.status, 'overdue')
    assert.equal(invoice.overdueCents, 50_000)
    const headers = key()
    const paid = ok(
      await pay(t.admin, payBody(t, firstDue as Json, { amountCents: 20_000 }), headers),
      201,
    )
    assert.equal(paid.description, 'Fatura ABC20260001 ödemesi')
    assert.deepEqual(paid.bankAccount, { id: t.account.id, label: 'Örnek Bankası ·7890' })
    const replay = await pay(
      t.admin,
      payBody(t, firstDue as Json, { amountCents: 20_000 }),
      headers,
    )
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(
      await pay(t.admin, payBody(t, firstDue as Json, { amountCents: 30_001 })),
      422,
      'supplier_payment_exceeds_installment',
    )
    assertError(await pay(t.admin, payBody(t, firstDue as Json, { bankAccountId: null })), 400)
    assertError(
      await pay(t.admin, payBody(t, firstDue as Json, { bankAccountId: randomUUID() })),
      422,
      'supplier_payment_bank_account_not_found',
    )
    assertError(
      await pay(t.admin, payBody(t, firstDue as Json, { paidDate: '2026-10-07' })),
      422,
      'supplier_payment_date_in_future',
    )
    assertError(
      await pay(t.admin, payBody(t, firstDue as Json, { paidDate: '2026-08-31' })),
      422,
      'supplier_payment_before_invoice',
    )
    assert.equal((await rows(t.id)).payments.length, 1)
    const detail = ok(await get(`${INVOICES}/${String(invoice.id)}`, t.admin))
    assert.deepEqual(
      [detail.paidCents, detail.remainingCents, detail.overdueCents, detail.status],
      [20_000, 100_000, 30_000, 'overdue'],
    )
    assert.deepEqual(detail.actions, { pay: true, replan: false, cancel: false })
    assertError(
      await call(
        'POST',
        `${INVOICES}/${String(invoice.id)}/plan`,
        t.admin,
        { installments: [{ dueDate: '2026-12-01', amountCents: 120_000 }] },
        ifMatch(detail.version),
      ),
      422,
      'supplier_invoice_plan_locked',
    )
    assertError(
      await call(
        'POST',
        `${INVOICES}/${String(invoice.id)}/cancel`,
        t.admin,
        { reason: 'Yanlış giriş' },
        ifMatch(detail.version),
      ),
      422,
      'supplier_invoice_has_payments',
    )
    // Ödeme iptali taksiti yeniden açar; sonra plan değişir ve fatura iptal edilir.
    assertError(
      await call(
        'POST',
        `${PAYMENTS}/${String(paid.id)}/cancel`,
        t.admin,
        { reason: 'x' },
        ifMatch(paid.version),
      ),
      400,
    )
    assertError(
      await call(
        'POST',
        `${PAYMENTS}/${String(paid.id)}/cancel`,
        t.admin,
        { reason: 'Hatalı tutar' },
        ifMatch(99),
      ),
      409,
    )
    const cancelled = ok(
      await call(
        'POST',
        `${PAYMENTS}/${String(paid.id)}/cancel`,
        t.admin,
        { reason: 'Hatalı tutar' },
        ifMatch(paid.version),
      ),
    )
    assert.equal(cancelled.cancelReason, 'Hatalı tutar')
    assert.deepEqual(cancelled.actions, { cancel: false })
    assertError(
      await call(
        'POST',
        `${PAYMENTS}/${String(paid.id)}/cancel`,
        t.admin,
        { reason: 'Hatalı tutar' },
        ifMatch(cancelled.version),
      ),
      422,
      'supplier_payment_cancelled',
    )
    const replanned = ok(
      await call(
        'POST',
        `${INVOICES}/${String(invoice.id)}/plan`,
        t.admin,
        { installments: [{ dueDate: '2026-12-01', amountCents: 120_000 }] },
        ifMatch(detail.version),
      ),
    )
    assert.equal(replanned.status, 'open')
    assert.equal(replanned.dueDate, '2026-12-01')
    const voided = ok(
      await call(
        'POST',
        `${INVOICES}/${String(invoice.id)}/cancel`,
        t.admin,
        { reason: 'Mükerrer giriş' },
        ifMatch(replanned.version),
      ),
    )
    assert.equal(voided.status, 'cancelled')
    assert.equal(voided.remainingCents, 0)
    assertError(
      await pay(t.admin, payBody(t, installmentsOf(replanned)[0] as Json)),
      422,
      'supplier_invoice_cancelled',
    )
    // İptal edilen faturanın numarası yeniden kullanılır.
    ok(await createInvoice(t.admin, invoiceBody(t)), 201)
  })

  const dayReport = async (cookie: string, day = TODAY) =>
    ok(await get(`${FINANCE}/day-closings/${day}`, cookie))
  const cashRow = (report: Json) =>
    ((report.summary as Json).methods as Json[]).find((item) => item.method === 'Nakit') as Json
  const closeDay = (cookie: string, body: Json, day = TODAY) =>
    call('POST', `${FINANCE}/day-closings/${day}/close`, cookie, body, key())
  const cancelPayment = (cookie: string, payment: Json) =>
    call(
      'POST',
      `${PAYMENTS}/${String(payment.id)}/cancel`,
      cookie,
      { reason: 'Hatalı tutar' },
      ifMatch(payment.version),
    )
  const closingRow = async (institutionId: string, day: string) => {
    const [row] = await db
      .select()
      .from(financeDayClosings)
      .where(
        and(
          eq(financeDayClosings.institutionId, institutionId),
          eq(financeDayClosings.closingDate, day),
        ),
      )
    return row
  }

  test('K-166, DOM-FIN-036, DOM-FIN-076: nakit ödeme gün sonu kasasına girer; kapanıştan sonra o güne ödeme ve iptal 422', async () => {
    const t = await institution()
    const invoice = ok(await createInvoice(t.admin, invoiceBody(t)), 201)
    const installment = installmentsOf(invoice)[0] as Json
    const cashBody = payBody(t, installment, { method: 'cash', bankAccountId: null })
    const cash = ok(await pay(t.admin, cashBody), 201)
    // Banka ödemesi kasaya dokunmaz, gün sonuna girmez.
    ok(await pay(t.admin, payBody(t, installment, { amountCents: 25_000 })), 201)
    const report = await dayReport(t.admin)
    assert.deepEqual(
      [
        cashRow(report).supplierPaidCount,
        cashRow(report).supplierPaidCents,
        cashRow(report).netCents,
      ],
      [1, 10_000, -10_000],
    )
    const summary = report.summary as Json
    assert.deepEqual(
      [summary.supplierPaidCount, summary.supplierPaidCents, summary.netCents],
      [1, 10_000, -10_000],
    )
    assert.equal(report.reportStamp, '0:0:0:1:-10000')
    assert.equal(report.cashNetCents, -10_000)
    assert.equal(report.cashCountRequired, true)
    assert.deepEqual(report.supplierPayments, [
      {
        paymentId: cash.id,
        supplierName: 'Alfa Bilişim A.Ş.',
        invoiceNumber: 'ABC20260001',
        amountCents: 10_000,
        paidDate: TODAY,
      },
    ])
    assert.equal(JSON.stringify(report).includes(SUPPLIER_IBAN), false)
    // Nakit hareketi olan gün sayımsız kapanmaz; beklenen nakit tedarikçi ödemesi düşülmüş tutardır.
    assertError(
      await closeDay(t.admin, { reportStamp: report.reportStamp }),
      422,
      'cash_count_required',
    )
    const closed = ok(
      await closeDay(t.admin, {
        reportStamp: report.reportStamp,
        openingCashCents: 50_000,
        countedCashCents: 40_000,
      }),
      201,
    )
    assert.deepEqual(closed.cash, {
      openingCents: 50_000,
      countedCents: 40_000,
      expectedCents: 40_000,
      differenceCents: 0,
    })
    const row = await closingRow(t.id, TODAY)
    assert.deepEqual(
      [row?.supplierPaidCount, row?.supplierPaidCents, row?.netCents, row?.expectedCashCents],
      [1, 10_000, -10_000, 40_000],
    )
    assert.deepEqual(
      row?.methodTotals.find((item) => item.method === 'cash'),
      {
        method: 'cash',
        collectedCount: 0,
        collectedCents: 0,
        reversedCount: 0,
        reversedCents: 0,
        refundPaidCount: 0,
        refundPaidCents: 0,
        supplierPaidCount: 1,
        supplierPaidCents: 10_000,
        netCents: -10_000,
      },
    )
    assertError(await pay(t.admin, cashBody), 422, 'finance_day_closed')
    assertError(await cancelPayment(t.admin, cash), 422, 'finance_day_closed')
    // Banka ödemesi kapalı günde de yazılır; kapanış özeti değişmez.
    ok(await pay(t.admin, payBody(t, installment)), 201)
    assert.equal((await rows(t.id)).payments.length, 3)
    assert.equal((await dayReport(t.admin)).reportStamp, '0:0:0:1:-10000')
  })

  test('K-166, K-190, DOM-FIN-036: açık günün nakit ödemesi bugün kapalıyken de iptal edilir, o günün gün sonundan çıkar', async () => {
    const t = await institution()
    const invoice = ok(await createInvoice(t.admin, invoiceBody(t)), 201)
    const installment = installmentsOf(invoice)[0] as Json
    const yesterday = ok(
      await pay(
        t.admin,
        payBody(t, installment, { method: 'cash', bankAccountId: null, paidDate: YESTERDAY }),
      ),
      201,
    )
    const before = await dayReport(t.admin, YESTERDAY)
    assert.equal(cashRow(before).supplierPaidCents, 10_000)
    // Bugün kapatılır; dünün ödemesi bugünün kasasına girmez.
    const todayReport = await dayReport(t.admin)
    assert.equal((todayReport.summary as Json).supplierPaidCount, 0)
    ok(
      await closeDay(t.admin, {
        reportStamp: todayReport.reportStamp,
        openingCashCents: 0,
        countedCashCents: 0,
      }),
      201,
    )
    const cancelled = ok(await cancelPayment(t.admin, yesterday))
    assert.notEqual(cancelled.cancelledAt, null)
    const after = await dayReport(t.admin, YESTERDAY)
    assert.deepEqual(
      [cashRow(after).supplierPaidCount, cashRow(after).supplierPaidCents, after.cashNetCents],
      [0, 0, 0],
    )
    assert.deepEqual(after.supplierPayments, [])
    assert.notEqual(after.reportStamp, before.reportStamp)
    // Ekrandaki eski raporla kapanış reddedilir: iptal görülmeden mühürlenmez.
    assertError(
      await closeDay(t.admin, { reportStamp: before.reportStamp, countedCashCents: 0 }, YESTERDAY),
      409,
      'finance_day_report_changed',
    )
  })

  test('K-191, K-160, DOM-FIN-036: ön büro gün sonunda tedarikçi ödemesinin tutarını görür, satırlarını görmez', async () => {
    const t = await institution()
    const invoice = ok(await createInvoice(t.admin, invoiceBody(t)), 201)
    const installment = installmentsOf(invoice)[0] as Json
    ok(await pay(t.admin, payBody(t, installment, { method: 'cash', bankAccountId: null })), 201)
    const frontDesk = await member(t.id, 'onburo')
    const report = await dayReport(frontDesk)
    assert.equal(report.supplierPayments, null)
    assert.deepEqual(
      [cashRow(report).supplierPaidCount, cashRow(report).supplierPaidCents],
      [1, 10_000],
    )
    assert.equal(JSON.stringify(report).includes('Alfa'), false)
    // Ön büro günü kapatır; kapanış tedarikçi ödemesini taşır.
    ok(
      await closeDay(frontDesk, {
        reportStamp: report.reportStamp,
        openingCashCents: 10_000,
        countedCashCents: 0,
      }),
      201,
    )
    assert.equal((await closingRow(t.id, TODAY))?.supplierPaidCents, 10_000)
  })

  test('DOM-FIN-076: cari özet ve ekstre: bakiye, vadesi geçmiş, iptaller iptal gününe; IBAN maskeli', async () => {
    const t = await institution()
    const overdue = ok(
      await createInvoice(t.admin, invoiceBody(t, { invoiceNumber: 'A-1', dueDate: '2026-09-30' })),
      201,
    )
    ok(
      await createInvoice(
        t.admin,
        invoiceBody(t, {
          invoiceNumber: 'A-2',
          invoiceDate: '2026-10-01',
          amountCents: 60_000,
          vatCents: 10_000,
        }),
      ),
      201,
    )
    ok(
      await createInvoice(t.admin, invoiceBody(t, { supplierId: t.beta.id, invoiceNumber: 'B-1' })),
      201,
    )
    ok(
      await pay(
        t.admin,
        payBody(t, installmentsOf(overdue)[0] as Json, {
          amountCents: 20_000,
          paidDate: '2026-10-02',
        }),
      ),
      201,
    )
    const ledger = (await get(LEDGER, t.admin)).json() as {
      data: Json[]
      meta: { total: number; totals: Json }
    }
    assert.equal(ledger.meta.total, 2)
    assert.deepEqual(ledger.meta.totals, {
      invoicedCents: 300_000,
      paidCents: 20_000,
      balanceCents: 280_000,
      overdueCents: 100_000,
    })
    const [first, second] = ledger.data
    assert.equal((first?.supplier as Json).id, t.alpha.id)
    assert.deepEqual(
      [first?.invoiceCount, first?.balanceCents, first?.overdueCents, first?.nextDueDate],
      [2, 160_000, 100_000, '2026-09-30'],
    )
    assert.equal(second?.overdueCents, 0)
    const overdueOnly = (await get(`${LEDGER}?balance=overdue`, t.admin)).json() as {
      meta: { total: number }
    }
    assert.equal(overdueOnly.meta.total, 1)
    const search = (await get(`${LEDGER}?q=beta`, t.admin)).json() as { data: Json[] }
    assert.deepEqual(
      search.data.map((row) => (row.supplier as Json).name),
      ['Beta Teknoloji Ltd.'],
    )
    const statement = (await get(`${LEDGER}/${String(t.alpha.id)}`, t.admin)).json() as {
      data: Json
      meta: { total: number }
    }
    assert.equal((statement.data.supplier as Json).iban, 'TR********************1326')
    assert.equal(statement.data.balanceCents, 160_000)
    assert.deepEqual(
      (statement.data.movements as Json[]).map((m) => [m.kind, m.date, m.balanceCents]),
      [
        ['payment', '2026-10-02', 160_000],
        ['invoice', '2026-10-01', 180_000],
        ['invoice', '2026-09-01', 120_000],
      ],
    )
    const statuses = async (status: string) =>
      ((await get(`${INVOICES}?status=${status}`, t.admin)).json() as { data: Json[] }).data.map(
        (row) => row.invoiceNumber,
      )
    assert.deepEqual(await statuses('overdue'), ['A-1'])
    assert.deepEqual((await statuses('open')).sort(), ['A-2', 'B-1'])
    assert.deepEqual(await statuses('paid'), [])
    assert.deepEqual(await statuses('cancelled'), [])
    assert.deepEqual(
      ((await get(`${INVOICES}?q=b-1`, t.admin)).json() as { data: Json[] }).data.map(
        (row) => row.invoiceNumber,
      ),
      ['B-1'],
    )
    assertError(await get(`${INVOICES}?unknown=1`, t.admin), 400)
  })

  test('DOM-FIN-076: talimat dosyası yalnız havale/EFT; IBAN açık, işaretlenir, yeniden alma onay ister (K-164, K-165)', async () => {
    const t = await institution()
    const alpha = ok(await createInvoice(t.admin, invoiceBody(t)), 201)
    const beta = ok(
      await createInvoice(t.admin, invoiceBody(t, { supplierId: t.beta.id, invoiceNumber: 'B-1' })),
      201,
    )
    const installment = installmentsOf(alpha)[0] as Json
    const eft = ok(
      await pay(t.admin, payBody(t, installment, { amountCents: 12_345, description: '=SUM(A1)' })),
      201,
    )
    const cash = ok(
      await pay(t.admin, payBody(t, installment, { method: 'cash', bankAccountId: null })),
      201,
    )
    const noIban = ok(await pay(t.admin, payBody(t, installmentsOf(beta)[0] as Json)), 201)
    const pending = (await get(`${PAYMENTS}?instruction=pending`, t.admin)).json() as {
      meta: { total: number }
    }
    assert.equal(pending.meta.total, 2)
    assertError(
      await call('POST', INSTRUCTION, t.admin, { paymentIds: [cash.id] }),
      422,
      'supplier_payment_instruction_method',
    )
    assertError(
      await call('POST', INSTRUCTION, t.admin, { paymentIds: [noIban.id] }),
      422,
      'supplier_payment_instruction_iban_missing',
    )
    assertError(await call('POST', INSTRUCTION, t.admin, { paymentIds: [] }), 400)
    const file = await call('POST', INSTRUCTION, t.admin, { paymentIds: [eft.id] })
    assert.equal(file.statusCode, 200, file.body)
    assert.match(String(file.headers['content-type']), /text\/csv/)
    assert.match(String(file.headers['content-disposition']), /odeme-talimati-2026-10-06\.csv/)
    assert.equal(
      file.body,
      [
        '\uFEFF"Alıcı unvanı";"Alıcı IBAN";"Tutar";"Para birimi";"Açıklama";"Ödeme günü";"Gönderen IBAN"',
        `"Alfa Bilişim A.Ş.";"${SUPPLIER_IBAN}";123,45;"TRY";"'=SUM(A1)";"${TODAY}";"${ACCOUNT_IBAN}"`,
      ].join('\r\n'),
    )
    const marked = ok(await get(`${INVOICES}/${String(alpha.id)}`, t.admin))
    const exported = (marked.payments as Json[]).find((row) => row.id === eft.id) as Json
    assert.equal(exported.instructionExportCount, 1)
    assert.equal(typeof exported.instructionExportedAt, 'string')
    assertError(
      await call('POST', INSTRUCTION, t.admin, { paymentIds: [eft.id] }),
      409,
      'supplier_payment_instruction_exported_warning',
    )
    const again = await call('POST', INSTRUCTION, t.admin, {
      paymentIds: [eft.id],
      confirmReexport: true,
    })
    assert.equal(again.statusCode, 200, again.body)
    const [row] = await db
      .select()
      .from(supplierPayments)
      .where(eq(supplierPayments.id, String(eft.id)))
    assert.equal(row?.instructionExportCount, 2)
    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.id),
          like(auditLog.action, 'supplier_payment.instruction_export'),
        ),
      )
    assert.equal(audits.length, 2)
    assert.equal(JSON.stringify(audits).includes(SUPPLIER_IBAN), false)
  })

  test('DOM-FIN-076: başka kurumun faturası, ödemesi ve carisi 404 ve B değişmez; listede yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bInvoice = ok(await createInvoice(b.admin, invoiceBody(b)), 201)
    const bInstallment = installmentsOf(bInvoice)[0] as Json
    const bPayment = ok(await pay(b.admin, payBody(b, bInstallment)), 201)
    const bUrl = `${INVOICES}/${String(bInvoice.id)}`
    assertError(await get(bUrl, a.admin), 404)
    assertError(
      await call(
        'POST',
        `${bUrl}/plan`,
        a.admin,
        { installments: [{ dueDate: '2026-12-01', amountCents: 120_000 }] },
        ifMatch(1),
      ),
      404,
    )
    assertError(
      await call('POST', `${bUrl}/cancel`, a.admin, { reason: 'Sızma denemesi' }, ifMatch(1)),
      404,
    )
    assertError(
      await call(
        'POST',
        `${PAYMENTS}/${String(bPayment.id)}/cancel`,
        a.admin,
        { reason: 'Sızma denemesi' },
        ifMatch(1),
      ),
      404,
    )
    assertError(await get(`${LEDGER}/${String(b.alpha.id)}`, a.admin), 404)
    assertError(
      await createInvoice(a.admin, invoiceBody(a, { supplierId: b.alpha.id })),
      422,
      'supplier_invoice_supplier_not_found',
    )
    assertError(await createInvoice(a.admin, { ...invoiceBody(a), institutionId: b.id }), 400)
    assertError(
      await pay(a.admin, payBody(a as Tenant, bInstallment)),
      422,
      'supplier_payment_installment_not_found',
    )
    const aInvoice = ok(await createInvoice(a.admin, invoiceBody(a)), 201)
    assertError(
      await pay(
        a.admin,
        payBody(a as Tenant, installmentsOf(aInvoice)[0] as Json, { bankAccountId: b.account.id }),
      ),
      422,
      'supplier_payment_bank_account_not_found',
    )
    assertError(
      await call('POST', INSTRUCTION, a.admin, { paymentIds: [bPayment.id] }),
      422,
      'supplier_payment_not_found',
    )
    const lists = await Promise.all([
      get(INVOICES, a.admin),
      get(PAYMENTS, a.admin),
      get(LEDGER, a.admin),
    ])
    assert.deepEqual(
      lists.map((response) => (response.json() as { meta: { total: number } }).meta.total),
      [1, 0, 1],
    )
    const bRows = await rows(b.id)
    assert.deepEqual(
      [bRows.invoices[0]?.version, bRows.invoices[0]?.cancelledAt, bRows.payments[0]?.cancelledAt],
      [1, null, null],
    )
    assert.equal(bRows.payments[0]?.instructionExportCount, 0)
  })
})
