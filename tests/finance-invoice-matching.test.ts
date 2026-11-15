import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertInvoicePayable,
  checkSupplierInvoiceLines,
  INVOICE_MATCH_CSV_HEADER,
  invoiceLinesNetCents,
  invoiceMatchCsv,
  matchesFilter,
  matchIssueCounts,
  matchOrderInvoices,
  matchUnitLabel,
  orderMatchSummary,
  planInvoiceMatchApproval,
  supplierInvoiceLinesSchema,
  worstMatchStatus,
  type MatchInvoice,
  type MatchOrderItem,
} from '../packages/school-core/src/lib/finance-invoice-matching.ts'
import {
  planSupplierInvoice,
  planSupplierPayment,
  type SupplierPaymentContext,
} from '../packages/school-core/src/lib/finance-supplier-ledger.ts'

import { isDomainError } from './support/domain-error.ts'

// Tedarikçi faturası üçlü eşleştirmesi (DOM-FIN-095; ON-277, K-280…K-283).

const ZodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'
const KEYBOARD = '00000000-0000-4000-8000-0000000000e1'
const MOUSE = '00000000-0000-4000-8000-0000000000e2'
const SUPPLIER = '00000000-0000-4000-8000-0000000000a1'
const ORDER = '00000000-0000-4000-8000-0000000000b1'
const ACCOUNT = '00000000-0000-4000-8000-0000000000d1'
const INSTALLMENT = '00000000-0000-4000-8000-0000000000c1'

/** Sipariş: 10 klavye × 200 TL, 4 fare × 50 TL (KDV hariç). */
const ITEMS: MatchOrderItem[] = [
  { id: KEYBOARD, name: 'Klavye', unit: 'piece', quantity: 10, unitPriceCents: 20_000 },
  { id: MOUSE, name: 'Fare', unit: 'piece', quantity: 4, unitPriceCents: 5_000 },
]
const invoice = (id: string, overrides: Partial<MatchInvoice> = {}): MatchInvoice => ({
  id,
  invoiceDate: '2026-10-01',
  createdAt: '2026-10-01T09:00:00.000Z',
  cancelled: false,
  lines: [{ orderItemId: KEYBOARD, description: null, quantity: 5, unitPriceCents: 20_000 }],
  approvedStatus: null,
  ...overrides,
})
const match = (invoices: MatchInvoice[], accepted: [string, number][] = [[KEYBOARD, 5]]) =>
  matchOrderInvoices({ items: ITEMS, accepted: new Map(accepted), invoices })

test('DOM-FIN-095: kalem şeması — siparişte olmayan kalem ad ister, sipariş kalemi bir kez yazılır (K-280)', () => {
  const parsed = supplierInvoiceLinesSchema.parse([
    { orderItemId: KEYBOARD, description: 'yok sayılır', quantity: 2, unitPriceCents: 100 },
    { description: ' Kargo ', quantity: 1, unitPriceCents: 5_000 },
  ])
  assert.deepEqual(
    parsed.map((line) => [line.orderItemId, line.description]),
    [
      [KEYBOARD, null],
      [null, 'Kargo'],
    ],
  )
  assert.throws(
    () => supplierInvoiceLinesSchema.parse([{ quantity: 1, unitPriceCents: 100 }]),
    ZodError,
  )
  assert.throws(
    () =>
      supplierInvoiceLinesSchema.parse([
        { orderItemId: KEYBOARD, quantity: 1, unitPriceCents: 100 },
        { orderItemId: KEYBOARD, quantity: 1, unitPriceCents: 100 },
      ]),
    ZodError,
  )
  assert.throws(() => supplierInvoiceLinesSchema.parse([]), ZodError)
  assert.throws(
    () =>
      supplierInvoiceLinesSchema.parse([
        { orderItemId: KEYBOARD, quantity: 1.5, unitPriceCents: 100 },
      ]),
    ZodError,
  )
})

test('DOM-FIN-095: kalem sipariş kalemi olmalı, kalem toplamı fatura netinden en çok 1 TL sapar (K-280)', () => {
  const lines = supplierInvoiceLinesSchema.parse([
    { orderItemId: KEYBOARD, quantity: 5, unitPriceCents: 20_000 },
  ])
  assert.equal(invoiceLinesNetCents(lines), 100_000)
  const context = { orderItemIds: [KEYBOARD, MOUSE], netCents: 100_000 }
  assert.deepEqual(checkSupplierInvoiceLines(lines, context), lines)
  assert.deepEqual(checkSupplierInvoiceLines(lines, { ...context, netCents: 100_100 }), lines)
  assert.throws(
    () => checkSupplierInvoiceLines(lines, { ...context, netCents: 100_101 }),
    isDomainError('supplier_invoice_lines_total_mismatch'),
  )
  assert.throws(
    () => checkSupplierInvoiceLines(lines, { ...context, orderItemIds: [MOUSE] }),
    isDomainError('supplier_invoice_line_item_not_in_order'),
  )
})

test('DOM-FIN-095: siparişe bağlı fatura kalem ister, siparişsiz fatura kalem almaz; plan kalemleri döndürür', () => {
  const body = (overrides: Record<string, unknown>) => ({
    supplierId: SUPPLIER,
    invoiceNumber: 'A-1',
    invoiceDate: '2026-10-01',
    dueDate: '2026-10-31',
    amountCents: 120_000,
    amountIncludesVat: true,
    vatCents: 20_000,
    ...overrides,
  })
  const context = {
    supplier: { id: SUPPLIER },
    numberTaken: false,
    today: '2026-10-06',
    order: {
      supplierId: SUPPLIER,
      status: 'sent' as const,
      grossCents: 240_000,
      invoicedCents: 0,
      itemIds: [KEYBOARD],
    },
  }
  const line = { orderItemId: KEYBOARD, quantity: 5, unitPriceCents: 20_000 }
  assert.throws(() => planSupplierInvoice(body({ purchaseOrderId: ORDER }), context), ZodError)
  assert.throws(() => planSupplierInvoice(body({ lines: [line] }), context), ZodError)
  const plan = planSupplierInvoice(body({ purchaseOrderId: ORDER, lines: [line] }), context)
  assert.deepEqual(plan.lines, [{ ...line, description: null }])
  assert.deepEqual(planSupplierInvoice(body({}), context).lines, [])
  assert.throws(
    () =>
      planSupplierInvoice(
        body({ purchaseOrderId: ORDER, lines: [{ ...line, quantity: 4 }] }),
        context,
      ),
    isDomainError('supplier_invoice_lines_total_mismatch'),
  )
})

test('DOM-FIN-095: kabul edilen kadar, sipariş fiyatıyla faturalanan kalem eşleşir', () => {
  const result = match([invoice('f1')]).get('f1')
  assert.equal(result?.status, 'matched')
  assert.deepEqual(result?.lines[0], {
    orderItemId: KEYBOARD,
    name: 'Klavye',
    unit: 'piece',
    orderedQuantity: 10,
    orderUnitPriceCents: 20_000,
    acceptedQuantity: 5,
    previouslyInvoicedQuantity: 0,
    invoicedQuantity: 5,
    invoiceUnitPriceCents: 20_000,
    quantityExcess: 0,
    unitPriceDifferenceCents: 0,
    lineDifferenceCents: 0,
    status: 'matched',
  })
  assert.equal(result?.approvalRequired, false)
})

test('DOM-FIN-095: faturalanan kabul edileni aşarsa miktar farkı; önceki etkin faturalar sayılır, iptal edilen sayılmaz (K-281)', () => {
  const second = invoice('f2', { invoiceDate: '2026-10-02' })
  const results = match([second, invoice('f1')])
  assert.equal(results.get('f1')?.status, 'matched')
  assert.equal(results.get('f2')?.status, 'quantity_mismatch')
  assert.equal(results.get('f2')?.lines[0]?.previouslyInvoicedQuantity, 5)
  assert.equal(results.get('f2')?.lines[0]?.quantityExcess, 5)
  assert.equal(results.get('f2')?.approvalRequired, true)
  // İlk fatura iptal edilince ikincisi eşleşir; iptal edilen fatura onay istemez.
  const afterCancel = match([second, invoice('f1', { cancelled: true })])
  assert.equal(afterCancel.get('f2')?.status, 'matched')
  assert.equal(afterCancel.get('f1')?.approvalRequired, false)
  // Kabul sonradan gelirse fatura kendiliğinden eşleşir (sonuç saklanmaz).
  assert.equal(match([invoice('f1')], []).get('f1')?.status, 'quantity_mismatch')
  // Aynı günde giriş sırası belirler.
  const sameDay = match([
    invoice('b', { createdAt: '2026-10-01T10:00:00.000Z' }),
    invoice('a', { createdAt: '2026-10-01T10:00:00.000Z' }),
  ])
  assert.deepEqual(
    [sameDay.get('a')?.status, sameDay.get('b')?.status],
    ['matched', 'quantity_mismatch'],
  )
})

test('DOM-FIN-095: birim fiyat farkının kalem etkisi 1 TL’yi aşarsa fiyat farkı (K-281)', () => {
  const priced = (unitPriceCents: number) =>
    invoice('f1', {
      lines: [{ orderItemId: KEYBOARD, description: null, quantity: 5, unitPriceCents }],
    })
  const within = match([priced(20_020)]).get('f1')
  assert.equal(within?.status, 'matched')
  assert.equal(within?.lines[0]?.lineDifferenceCents, 100)
  const over = match([priced(20_021)]).get('f1')
  assert.equal(over?.status, 'price_mismatch')
  assert.equal(over?.lines[0]?.unitPriceDifferenceCents, 21)
  assert.equal(match([priced(19_900)]).get('f1')?.status, 'price_mismatch')
  // Miktar farkı fiyat farkından ağırdır.
  const both = match([priced(25_000)], [[KEYBOARD, 2]]).get('f1')
  assert.equal(both?.status, 'quantity_mismatch')
})

test('DOM-FIN-095: siparişte olmayan kalem ve kalemsiz fatura eşleşmez; en ağır durum faturanın durumudur', () => {
  const extra = invoice('f1', {
    lines: [
      { orderItemId: KEYBOARD, description: null, quantity: 5, unitPriceCents: 25_000 },
      { orderItemId: null, description: 'Kargo', quantity: 1, unitPriceCents: 5_000 },
    ],
  })
  const result = match([extra]).get('f1')
  assert.equal(result?.status, 'unmatched')
  assert.deepEqual(
    result?.lines.map((line) => [line.name, line.status, line.orderedQuantity]),
    [
      ['Klavye', 'price_mismatch', 10],
      ['Kargo', 'unmatched', null],
    ],
  )
  assert.deepEqual(matchIssueCounts(result ?? { lines: [] }), {
    quantityLines: 0,
    priceLines: 1,
    unmatchedLines: 1,
    priceDifferenceCents: 25_000,
  })
  assert.equal(match([invoice('f0', { lines: [] })]).get('f0')?.status, 'unmatched')
  assert.equal(worstMatchStatus([]), 'matched')
  assert.equal(worstMatchStatus(['price_mismatch', 'matched']), 'price_mismatch')
})

test('DOM-FIN-095: fark onayı yalnız onaylanan sapma için geçerli; sapma değişirse yeniden onay (K-282)', () => {
  const approved = match([invoice('f1', { approvedStatus: 'quantity_mismatch' })], []).get('f1')
  assert.deepEqual([approved?.approved, approved?.approvalRequired], [true, false])
  const changed = match([
    invoice('f1', {
      approvedStatus: 'quantity_mismatch',
      lines: [{ orderItemId: KEYBOARD, description: null, quantity: 5, unitPriceCents: 1 }],
    }),
  ]).get('f1')
  assert.deepEqual([changed?.status, changed?.approved], ['price_mismatch', false])
  // Eşleşen faturada eski onay "onaylandı" sayılmaz.
  const matched = match([invoice('f1', { approvedStatus: 'quantity_mismatch' })]).get('f1')
  assert.deepEqual([matched?.status, matched?.approved], ['matched', false])
})

test('DOM-FIN-095: ödeme kontrolü — onaysız sapma 409 uyarı, onaylı sapma ve siparişsiz fatura geçer (K-282)', () => {
  assert.throws(
    () => assertInvoicePayable({ status: 'price_mismatch', approved: false }),
    (error: unknown) =>
      isDomainError('supplier_payment_invoice_mismatch_warning', 'conflict')(error) &&
      (error as Error).message.includes('fiyat farkı'),
  )
  assert.doesNotThrow(() => assertInvoicePayable({ status: 'price_mismatch', approved: true }))
  assert.doesNotThrow(() => assertInvoicePayable({ status: 'matched', approved: false }))
  assert.doesNotThrow(() => assertInvoicePayable(null))
  const context: SupplierPaymentContext = {
    installment: {
      amountCents: 60_000,
      paidCents: 0,
      invoiceDate: '2026-10-01',
      invoiceCancelled: false,
    },
    bankAccountIds: [ACCOUNT],
    dayClosed: false,
    today: '2026-10-06',
    invoiceMatch: { status: 'unmatched', approved: false },
  }
  const body = {
    installmentId: INSTALLMENT,
    paidDate: '2026-10-06',
    amountCents: 10_000,
    method: 'eft',
    bankAccountId: ACCOUNT,
  }
  assert.throws(
    () => planSupplierPayment(body, context),
    isDomainError('supplier_payment_invoice_mismatch_warning', 'conflict'),
  )
  // Öteki kurallar önce: kalanı aşan ödeme 422 kalır.
  assert.throws(
    () => planSupplierPayment({ ...body, amountCents: 70_000 }, context),
    isDomainError('supplier_payment_exceeds_installment'),
  )
  assert.equal(
    planSupplierPayment(body, { ...context, invoiceMatch: { status: 'unmatched', approved: true } })
      .amountCents,
    10_000,
  )
})

test('DOM-FIN-095: fark onayı gerekçe ister; siparişsiz, eşleşen, iptal edilmiş ya da onaylı faturada reddedilir (K-282)', () => {
  const pending = {
    cancelled: false,
    match: { status: 'quantity_mismatch' as const, approved: false },
  }
  assert.deepEqual(
    planInvoiceMatchApproval(pending, { reason: ' Eksik teslim iadeyle kapanacak ' }),
    {
      reason: 'Eksik teslim iadeyle kapanacak',
      status: 'quantity_mismatch',
    },
  )
  assert.throws(() => planInvoiceMatchApproval(pending, { reason: 'kısa' }), ZodError)
  assert.throws(() => planInvoiceMatchApproval(pending, {}), ZodError)
  assert.throws(
    () => planInvoiceMatchApproval({ ...pending, cancelled: true }, { reason: 'Geçerli gerekçe' }),
    isDomainError('supplier_invoice_cancelled'),
  )
  assert.throws(
    () =>
      planInvoiceMatchApproval({ cancelled: false, match: null }, { reason: 'Geçerli gerekçe' }),
    isDomainError('supplier_invoice_match_not_applicable'),
  )
  assert.throws(
    () =>
      planInvoiceMatchApproval(
        { cancelled: false, match: { status: 'matched', approved: false } },
        { reason: 'Geçerli gerekçe' },
      ),
    isDomainError('supplier_invoice_match_already_matched'),
  )
  assert.throws(
    () =>
      planInvoiceMatchApproval(
        { cancelled: false, match: { status: 'price_mismatch', approved: true } },
        { reason: 'Geçerli gerekçe' },
      ),
    isDomainError('supplier_invoice_match_already_approved'),
  )
})

test('DOM-FIN-095: sipariş özeti kalem bazında sipariş, kabul ve etkin faturalanan miktar', () => {
  const invoices = [
    invoice('f1'),
    invoice('f2', { invoiceDate: '2026-10-02', cancelled: true }),
    invoice('f3', {
      invoiceDate: '2026-10-03',
      lines: [{ orderItemId: MOUSE, description: null, quantity: 4, unitPriceCents: 5_000 }],
    }),
  ]
  const input = { items: ITEMS, accepted: new Map([[KEYBOARD, 7]]), invoices }
  const summary = orderMatchSummary(input, matchOrderInvoices(input))
  assert.deepEqual(
    summary.items.map((item) => [
      item.name,
      item.orderedQuantity,
      item.acceptedQuantity,
      item.invoicedQuantity,
      item.differenceQuantity,
    ]),
    [
      ['Klavye', 10, 7, 5, -2],
      ['Fare', 4, 0, 4, 4],
    ],
  )
  assert.equal(summary.status, 'quantity_mismatch')
  const none = { items: ITEMS, accepted: new Map<string, number>(), invoices: [] }
  assert.equal(orderMatchSummary(none, new Map()).status, null)
})

test('DOM-FIN-095: eşleşmeyen faturalar süzgeci ve onay süzgeci', () => {
  const pending = { status: 'price_mismatch' as const, approved: false }
  const approved = { status: 'unmatched' as const, approved: true }
  const matched = { status: 'matched' as const, approved: false }
  assert.equal(matchesFilter(pending, { status: 'mismatched' }), true)
  assert.equal(matchesFilter(matched, { status: 'mismatched' }), false)
  assert.equal(matchesFilter(matched, { status: 'matched' }), true)
  assert.equal(matchesFilter(pending, { status: 'quantity_mismatch' }), false)
  assert.equal(matchesFilter(pending, { status: 'mismatched', approval: 'pending' }), true)
  assert.equal(matchesFilter(approved, { status: 'mismatched', approval: 'pending' }), false)
  assert.equal(matchesFilter(approved, { status: 'mismatched', approval: 'approved' }), true)
  assert.equal(matchesFilter(matched, { status: 'matched', approval: 'approved' }), false)
})

test('DOM-FIN-095: CSV başlıkları, ondalık virgül ve formül kaçışı', () => {
  const csv = invoiceMatchCsv([
    {
      invoiceNumber: 'A-1',
      invoiceDate: '2026-10-01',
      supplierName: '=Alfa',
      orderNumber: 'SA-2026-0001',
      grossCents: 123_456,
      remainingCents: 0,
      status: 'price_mismatch',
      approved: false,
      quantityLines: 0,
      priceLines: 1,
      unmatchedLines: 0,
      priceDifferenceCents: -250,
    },
    {
      invoiceNumber: 'A-2',
      invoiceDate: '2026-10-02',
      supplierName: 'Beta',
      orderNumber: 'SA-2026-0002',
      grossCents: 100,
      remainingCents: 100,
      status: 'matched',
      approved: false,
      quantityLines: 0,
      priceLines: 0,
      unmatchedLines: 0,
      priceDifferenceCents: 0,
    },
  ])
  const [header, first, second] = csv.split('\r\n')
  assert.equal(header?.split(';').length, INVOICE_MATCH_CSV_HEADER.length)
  assert.equal(
    first,
    '"A-1";"2026-10-01";"\'=Alfa";"SA-2026-0001";1234,56;0,00;"Fiyat farkı";0;1;0;-2,50;"Bekliyor"',
  )
  assert.ok(second?.endsWith('"Eşleşti";0;0;0;0,00;""'))
  assert.equal(matchUnitLabel('piece'), 'adet')
  assert.equal(matchUnitLabel(null), '')
})
