import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  supplierInvoiceLines,
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
 * Tedarikçi faturası üçlü eşleştirmesi uçları (DOM-FIN-095; ON-277). Her test kendi kurumunu kurar:
 * tedarikçi, kurum banka hesabı ve gönderilmiş sipariş (10 klavye × 200,00 + 4 fare × 50,00, %20
 * KDV). FIXED_NOW 2026-10-06.
 */

const FINANCE = '/api/v1/finance'
const INVOICES = `${FINANCE}/supplier-invoices`
const PAYMENTS = `${FINANCE}/supplier-payments`
const MATCHES = `${FINANCE}/supplier-invoice-matches`
const ORDERS = `${FINANCE}/purchase-orders`
const TODAY = '2026-10-06'
const REASON = 'Eksik teslim tedarikçiyle konuşuldu'

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-095: tedarikçi faturası üçlü eşleştirme uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.95.0.1'

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
    target: App = app,
  ) {
    return target.inject({
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

  type Tenant = {
    id: string
    admin: string
    supplier: Json
    account: Json
    order: Json
    keyboard: string
    mouse: string
  }

  /** Kurum, tedarikçi, banka hesabı ve gönderilmiş sipariş. */
  async function institution(overrides: Partial<InstitutionOverrides> = {}): Promise<Tenant> {
    clientIp = `10.95.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    const admin = await signInAs(app, created.admin)
    if (overrides.enabledModules?.finance === false)
      return { id: created.id, admin } as unknown as Tenant
    const post = async (url: string, body: Json, headers: Record<string, string> = key()) =>
      ok(await call('POST', url, admin, body, headers), 201)
    const supplier = await post(`${FINANCE}/suppliers`, {
      name: 'Alfa Bilişim A.Ş.',
      type: 'company',
      taxNumber: '1234567890',
      taxOffice: 'Kadıköy',
      categories: ['it'],
    })
    const account = await post('/api/v1/bank-accounts', {
      bankName: 'Örnek Bankası',
      iban: 'TR320010009999901234567890',
      accountHolder: 'Akademi Özel Okulları',
    })
    const center = await post(`${FINANCE}/cost-centers`, {
      code: 'BT',
      name: 'Bilgi İşlem',
      type: 'unit',
    })
    const expense = await post(`${FINANCE}/budget-items`, {
      code: 'G-200',
      name: 'Malzeme',
      kind: 'expense',
    })
    const period = await post(`${FINANCE}/budget-periods`, {
      name: '2026–2027',
      academicYear: 2026,
    })
    ok(
      await call(
        'POST',
        `${FINANCE}/budget-periods/${String(period.id)}/open`,
        admin,
        undefined,
        ifMatch(period.version),
      ),
    )
    await post(`${FINANCE}/budget-periods/${String(period.id)}/lines`, {
      costCenterId: center.id,
      itemId: expense.id,
      amountCents: 1_000_000,
    })
    const request = await post(`${FINANCE}/purchase-requests`, {
      costCenterId: center.id,
      periodId: period.id,
      budgetItemId: expense.id,
      justification: 'Bilgisayar laboratuvarı için klavye ve fare',
      items: [
        { name: 'Klavye', quantity: 10, unit: 'piece', estimatedUnitPriceCents: 25_000 },
        { name: 'Fare', quantity: 4, unit: 'piece', estimatedUnitPriceCents: 6_000 },
      ],
    })
    const url = `${FINANCE}/purchase-requests/${String(request.id)}`
    const submitted = ok(await call('POST', `${url}/submit`, admin, undefined, ifMatch(1)))
    ok(await call('POST', `${url}/approve`, admin, {}, ifMatch(submitted.version)))
    const [keyboardItem, mouseItem] = request.items as Json[]
    const board = await post(`${url}/quotes`, {
      supplierId: supplier.id,
      deliveryDays: 5,
      validUntil: '2026-10-31',
      items: [
        { requestItemId: keyboardItem?.id, unitPriceCents: 20_000, vatRate: 20 },
        { requestItemId: mouseItem?.id, unitPriceCents: 5_000, vatRate: 20 },
      ],
    })
    const quote = (board.quotes as Json[])[0] as Json
    ok(
      await call(
        'POST',
        `${url}/quotes/${String(quote.id)}/select`,
        admin,
        {},
        ifMatch(quote.version),
      ),
    )
    const draft = await post(`${ORDERS}`, { quoteId: quote.id })
    const order = ok(
      await call(
        'POST',
        `${ORDERS}/${String(draft.id)}/send`,
        admin,
        undefined,
        ifMatch(draft.version),
      ),
    )
    const items = order.items as Json[]
    return {
      id: created.id,
      admin,
      supplier,
      account,
      order,
      keyboard: String(items[0]?.id),
      mouse: String(items[1]?.id),
    }
  }

  const receive = (t: Tenant, lines: [string, number][]) =>
    call(
      'POST',
      `${ORDERS}/${String(t.order.id)}/receipts`,
      t.admin,
      {
        receiptDate: TODAY,
        receivedBy: 'Hasan Usta',
        lines: lines.map(([orderItemId, acceptedQuantity]) => ({ orderItemId, acceptedQuantity })),
      },
      key(),
    )
  type Line = {
    orderItemId?: string | null
    description?: string
    quantity: number
    unitPriceCents: number
  }
  /** KDV hariç tutar kalemlerden; KDV %20. */
  const invoiceBody = (t: Tenant, number: string, lines: Line[], overrides: Json = {}) => {
    const net = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0)
    return {
      supplierId: t.supplier.id,
      invoiceNumber: number,
      invoiceDate: '2026-10-02',
      dueDate: '2026-10-31',
      amountCents: net,
      amountIncludesVat: false,
      vatCents: net / 5,
      purchaseOrderId: t.order.id,
      lines,
      ...overrides,
    }
  }
  const createInvoice = (cookie: string, body: unknown, headers: Record<string, string> = key()) =>
    call('POST', INVOICES, cookie, body, headers)
  const pay = (t: Tenant, invoice: Json, headers: Record<string, string> = key()) =>
    call(
      'POST',
      PAYMENTS,
      t.admin,
      {
        installmentId: (invoice.installments as Json[])[0]?.id,
        paidDate: TODAY,
        amountCents: 10_000,
        method: 'eft',
        bankAccountId: t.account.id,
      },
      headers,
    )
  const approve = (
    cookie: string,
    invoice: Json,
    body: unknown = { reason: REASON },
    headers: Record<string, string> = {},
  ) =>
    call('POST', `${INVOICES}/${String(invoice.id)}/approve-match`, cookie, body, {
      ...ifMatch(invoice.version),
      ...headers,
    })
  const matching = (invoice: Json) => invoice.matching as Json
  const rows = async (institutionId: string) => ({
    invoices: await db
      .select()
      .from(supplierInvoices)
      .where(eq(supplierInvoices.institutionId, institutionId)),
    lines: await db
      .select()
      .from(supplierInvoiceLines)
      .where(eq(supplierInvoiceLines.institutionId, institutionId)),
    payments: await db
      .select()
      .from(supplierPayments)
      .where(eq(supplierPayments.institutionId, institutionId)),
  })

  test('DOM-FIN-095: kimliksiz istek 401', async () => {
    const id = randomUUID()
    assertError(await get(MATCHES, null), 401)
    assertError(await get(`${ORDERS}/${id}/invoice-matching`, null), 401)
    assertError(
      await call('POST', `${INVOICES}/${id}/approve-match`, null, { reason: REASON }, ifMatch(1)),
      401,
    )
  })

  test('DOM-FIN-095: ön büro, öğretmen, veli ve öğrenci 403; finance modülü kapalıyken 403', async () => {
    const t = await institution()
    const invoice = ok(
      await createInvoice(
        t.admin,
        invoiceBody(t, 'R-1', [{ orderItemId: t.keyboard, quantity: 1, unitPriceCents: 20_000 }]),
      ),
      201,
    )
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await signInAs(app, await createMember(app, t.id, role))
      assertError(await get(MATCHES, cookie), 403)
      assertError(await get(`${ORDERS}/${String(t.order.id)}/invoice-matching`, cookie), 403)
      assertError(await approve(cookie, invoice), 403)
    }
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(MATCHES, closed.admin), 403, 'module_disabled')
    assertError(
      await get(`${ORDERS}/${String(t.order.id)}/invoice-matching`, closed.admin),
      403,
      'module_disabled',
    )
    const [stored] = (await rows(t.id)).invoices
    assert.equal(stored?.matchApprovedAt, null)
  })

  test('DOM-FIN-095: kalem girişi — siparişin kalemi olmalı, toplam fatura netine eşit; hata kayıt yazmaz (K-280)', async () => {
    const t = await institution()
    const line = { orderItemId: t.keyboard, quantity: 5, unitPriceCents: 20_000 }
    assertError(
      await createInvoice(t.admin, invoiceBody(t, 'K-1', [line], { lines: undefined })),
      400,
    )
    assertError(
      await createInvoice(t.admin, invoiceBody(t, 'K-1', [line], { purchaseOrderId: null })),
      400,
    )
    assertError(await createInvoice(t.admin, invoiceBody(t, 'K-1', [line, line])), 400)
    assertError(
      await createInvoice(t.admin, invoiceBody(t, 'K-1', [{ quantity: 1, unitPriceCents: 100 }])),
      400,
    )
    assertError(
      await createInvoice(t.admin, invoiceBody(t, 'K-1', [{ ...line, orderItemId: randomUUID() }])),
      422,
      'supplier_invoice_line_item_not_in_order',
    )
    assertError(
      await createInvoice(t.admin, invoiceBody(t, 'K-1', [line], { amountCents: 100_101 })),
      422,
      'supplier_invoice_lines_total_mismatch',
    )
    const stored = await rows(t.id)
    assert.deepEqual([stored.invoices.length, stored.lines.length], [0, 0])
    // 1 TL'ye kadar yuvarlama farkı kabul edilir.
    const created = ok(
      await createInvoice(
        t.admin,
        invoiceBody(t, 'K-1', [line], { amountCents: 100_100, vatCents: 20_000 }),
      ),
      201,
    )
    assert.equal((await rows(t.id)).lines.length, 1)
    assert.equal(matching(created).status, 'quantity_mismatch')
  })

  test('DOM-FIN-095: kabul edilen kadar faturalanan eşleşir, ödeme uyarısız girilir; siparişsiz faturada eşleştirme yok', async () => {
    const t = await institution()
    ok(await receive(t, [[t.keyboard, 5]]), 201)
    const created = ok(
      await createInvoice(
        t.admin,
        invoiceBody(t, 'E-1', [{ orderItemId: t.keyboard, quantity: 5, unitPriceCents: 20_000 }]),
      ),
      201,
    )
    const result = matching(created)
    assert.equal(result.status, 'matched')
    assert.equal(result.approvalRequired, false)
    assert.equal(result.toleranceCents, 100)
    assert.deepEqual(
      (result.lines as Json[]).map((line) => [
        line.name,
        line.orderedQuantity,
        line.acceptedQuantity,
        line.invoicedQuantity,
        line.status,
      ]),
      [['Klavye', 10, 5, 5, 'matched']],
    )
    ok(await pay(t, created), 201)
    const unlinked = ok(
      await createInvoice(t.admin, {
        ...invoiceBody(t, 'S-1', []),
        amountCents: 50_000,
        vatCents: 0,
        purchaseOrderId: null,
        lines: undefined,
      }),
      201,
    )
    assert.equal(unlinked.matching, null)
    ok(await pay(t, unlinked), 201)
    assertError(await approve(t.admin, unlinked), 422, 'supplier_invoice_match_not_applicable')
    assertError(await approve(t.admin, created), 422, 'supplier_invoice_match_already_matched')
  })

  test('DOM-FIN-095: miktar farkında ödeme 409 uyarı; gerekçeli onay sonrası ödenir, sapma değişirse yeniden onay (K-281, K-282)', async () => {
    const t = await institution()
    ok(await receive(t, [[t.keyboard, 5]]), 201)
    const first = ok(
      await createInvoice(
        t.admin,
        invoiceBody(t, 'M-1', [{ orderItemId: t.keyboard, quantity: 5, unitPriceCents: 20_000 }]),
      ),
      201,
    )
    const second = ok(
      await createInvoice(
        t.admin,
        invoiceBody(t, 'M-2', [{ orderItemId: t.keyboard, quantity: 3, unitPriceCents: 20_000 }], {
          invoiceDate: '2026-10-03',
        }),
      ),
      201,
    )
    assert.equal(matching(first).status, 'matched')
    const line = (matching(second).lines as Json[])[0] as Json
    assert.deepEqual(
      [matching(second).status, line.previouslyInvoicedQuantity, line.quantityExcess],
      ['quantity_mismatch', 5, 3],
    )
    const warning = await pay(t, second)
    assertError(warning, 409, 'supplier_payment_invoice_mismatch_warning')
    assert.match(warning.json().message as string, /miktar farkı/)
    assert.equal((await rows(t.id)).payments.length, 0)
    // Doğrulama ve sürüm hataları kaydı değiştirmez.
    assertError(await approve(t.admin, second, { reason: 'kısa' }), 400)
    assertError(await approve(t.admin, second, { reason: REASON, institutionId: t.id }), 400)
    assertError(
      await call(
        'POST',
        `${INVOICES}/${String(second.id)}/approve-match`,
        t.admin,
        { reason: REASON },
        ifMatch(Number(second.version) + 1),
      ),
      409,
      'version_conflict',
    )
    const before = (await rows(t.id)).invoices.find((row) => row.id === second.id)
    assert.equal(before?.matchApprovedAt, null)
    const headers = key()
    const approved = ok(await approve(t.admin, second, undefined, headers))
    assert.deepEqual(
      [matching(approved).approved, matching(approved).approvalRequired],
      [true, false],
    )
    const approval = matching(approved).approval as Json
    assert.deepEqual(
      [approval.status, approval.reason, approval.approvedByName],
      ['quantity_mismatch', REASON, 'Test Yönetici'],
    )
    const replay = await approve(t.admin, second, undefined, headers)
    assert.equal(replay.statusCode, 200)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(await approve(t.admin, approved), 422, 'supplier_invoice_match_already_approved')
    const [audit, ...others] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.id),
          eq(auditLog.action, 'supplier_invoice.approve_match'),
        ),
      )
    assert.ok(audit)
    assert.equal(others.length, 0)
    assert.equal(JSON.stringify(audit.changes).includes('tedarikçiyle'), false)
    ok(await pay(t, approved), 201)
    // Kabul gelince fatura kendiliğinden eşleşir; eski onay artık gerekmez.
    ok(await receive(t, [[t.keyboard, 3]]), 201)
    const later = ok(await get(`${INVOICES}/${String(second.id)}`, t.admin))
    assert.deepEqual([matching(later).status, matching(later).approved], ['matched', false])
  })

  test('DOM-FIN-095: fiyat farkı, siparişte olmayan kalem; eşleşmeyen faturalar listesi, CSV ve sipariş özeti', async () => {
    const t = await institution()
    ok(
      await receive(t, [
        [t.keyboard, 10],
        [t.mouse, 4],
      ]),
      201,
    )
    const priced = ok(
      await createInvoice(
        t.admin,
        invoiceBody(t, 'F-1', [{ orderItemId: t.keyboard, quantity: 4, unitPriceCents: 21_000 }]),
      ),
      201,
    )
    const extra = ok(
      await createInvoice(
        t.admin,
        invoiceBody(
          t,
          'F-2',
          [
            { orderItemId: t.mouse, quantity: 4, unitPriceCents: 5_000 },
            { orderItemId: null, description: '=Kargo', quantity: 1, unitPriceCents: 3_000 },
          ],
          { invoiceDate: '2026-10-03' },
        ),
      ),
      201,
    )
    const fine = ok(
      await createInvoice(
        t.admin,
        invoiceBody(t, 'F-3', [{ orderItemId: t.keyboard, quantity: 2, unitPriceCents: 20_010 }], {
          invoiceDate: '2026-10-04',
        }),
      ),
      201,
    )
    assert.deepEqual(
      [matching(priced).status, matching(extra).status, matching(fine).status],
      ['price_mismatch', 'unmatched', 'matched'],
    )
    const list = (await get(MATCHES, t.admin)).json() as { data: Json[]; meta: Json }
    assert.equal(list.meta.total, 2)
    assert.deepEqual(
      list.data.map((row) => [row.invoiceNumber, row.status, row.priceLines, row.unmatchedLines]),
      [
        ['F-2', 'unmatched', 0, 1],
        ['F-1', 'price_mismatch', 1, 0],
      ],
    )
    assert.equal(list.data[1]?.priceDifferenceCents, 4_000)
    const only = (await get(`${MATCHES}?status=price_mismatch`, t.admin)).json() as {
      data: Json[]
    }
    assert.deepEqual(
      only.data.map((row) => row.invoiceNumber),
      ['F-1'],
    )
    const all = (await get(`${MATCHES}?status=matched`, t.admin)).json() as { data: Json[] }
    assert.deepEqual(
      all.data.map((row) => row.invoiceNumber),
      ['F-3'],
    )
    ok(await approve(t.admin, extra))
    const pending = (await get(`${MATCHES}?approval=pending`, t.admin)).json() as { data: Json[] }
    assert.deepEqual(
      pending.data.map((row) => row.invoiceNumber),
      ['F-1'],
    )
    const searched = (await get(`${MATCHES}?q=f-2`, t.admin)).json() as { data: Json[] }
    assert.deepEqual(
      searched.data.map((row) => row.invoiceNumber),
      ['F-2'],
    )
    assertError(await get(`${MATCHES}?status=bilinmeyen`, t.admin), 400)
    assertError(await get(`${MATCHES}?sort=x`, t.admin), 400)

    const file = await call('GET', MATCHES, t.admin, undefined, { accept: 'text/csv' })
    assert.equal(file.statusCode, 200, file.body)
    assert.match(String(file.headers['content-type']), /text\/csv/)
    assert.match(String(file.headers['content-disposition']), /fatura-eslestirme-2026-10-06\.csv/)
    const lines = file.body.replace('﻿', '').split('\r\n')
    assert.equal(lines.length, 3)
    assert.ok(lines[1]?.startsWith('"F-2";"2026-10-03";"Alfa Bilişim A.Ş.";'))
    assert.ok(lines[1]?.endsWith('"Siparişte yok";0;0;1;0,00;"Onaylandı"'))
    const exports = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.id),
          eq(auditLog.action, 'finance.invoice_matching_export'),
        ),
      )
    assert.equal(exports.length, 1)
    // Oturum tazeliği gerçek saatle tutulur (satın alma raporu testiyle aynı).
    const later = await buildTestApp(db, { clock: () => new Date(Date.now() + 16 * 60 * 1000) })
    try {
      assertError(
        await call('GET', MATCHES, t.admin, undefined, { accept: 'text/csv' }, later),
        403,
        'reauthentication_required',
      )
    } finally {
      await later.close()
    }

    const summary = ok(await get(`${ORDERS}/${String(t.order.id)}/invoice-matching`, t.admin))
    assert.equal(summary.status, 'unmatched')
    assert.deepEqual(
      (summary.items as Json[]).map((item) => [
        item.name,
        item.orderedQuantity,
        item.acceptedQuantity,
        item.invoicedQuantity,
        item.differenceQuantity,
      ]),
      [
        ['Klavye', 10, 10, 6, -4],
        ['Fare', 4, 4, 4, 0],
      ],
    )
    assert.deepEqual(
      (summary.invoices as Json[]).map((item) => [item.invoiceNumber, item.status, item.approved]),
      [
        ['F-1', 'price_mismatch', false],
        ['F-2', 'unmatched', true],
        ['F-3', 'matched', false],
      ],
    )
  })

  test('DOM-FIN-095: başka kurumun faturası ve siparişi 404 ve B değişmez; listede B yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    ok(await receive(b, [[b.keyboard, 1]]), 201)
    const bInvoice = ok(
      await createInvoice(
        b.admin,
        invoiceBody(b, 'B-1', [{ orderItemId: b.keyboard, quantity: 3, unitPriceCents: 20_000 }]),
      ),
      201,
    )
    assertError(await approve(a.admin, bInvoice), 404)
    assertError(await get(`${ORDERS}/${String(b.order.id)}/invoice-matching`, a.admin), 404)
    assertError(await get(`${ORDERS}/${randomUUID()}/invoice-matching`, a.admin), 404)
    // A'nın faturası B'nin sipariş kalemine bağlanamaz.
    assertError(
      await createInvoice(
        a.admin,
        invoiceBody(a, 'A-1', [{ orderItemId: b.keyboard, quantity: 1, unitPriceCents: 20_000 }]),
      ),
      422,
      'supplier_invoice_line_item_not_in_order',
    )
    assertError(
      await createInvoice(a.admin, {
        ...invoiceBody(a, 'A-2', [
          { orderItemId: a.keyboard, quantity: 1, unitPriceCents: 20_000 },
        ]),
        institutionId: b.id,
      }),
      400,
    )
    const listed = (await get(MATCHES, a.admin)).json() as { data: Json[]; meta: Json }
    assert.equal(listed.meta.total, 0)
    const stored = (await rows(b.id)).invoices.find((row) => row.id === bInvoice.id)
    assert.deepEqual([stored?.matchApprovedAt, stored?.version], [null, bInvoice.version])
    assert.equal((await rows(a.id)).lines.length, 0)
  })
})
