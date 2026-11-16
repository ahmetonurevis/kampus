import assert from 'node:assert/strict'
import test from 'node:test'

import {
  cancelWindowEndsOn,
  createRefundInvoiceSchema,
  daysBetween,
  planRefundInvoice,
  planRefundInvoiceComplete,
  planRefundInvoiceDiscard,
  planRefundInvoiceReady,
  refundInvoiceActions,
  refundInvoicesCsv,
  splitVat,
  suggestRefundDocumentKind,
  type RefundInvoiceRecord,
} from '../packages/school-core/src/lib/finance-refund-invoices.ts'

import { isDomainError } from './support/domain-error.ts'

// İade faturası ve iptal isteği (DOM-FIN-096; ON-266; IST-110; K-292…K-295).

const ZodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'
const WITHDRAWAL_ID = '00000000-0000-4000-8000-000000000096'
const TODAY = '2026-10-06'
const ORIGINAL = {
  number: 'KMP2026000000012',
  date: '2026-10-01',
  type: 'e_archive',
  totalCents: 1_100_000,
  vatRateBasisPoints: 1000,
} as const
const PAID = { refundCents: 2_000_000, refundPaidDate: '2026-10-05' }
const CONTEXT = { withdrawal: PAID, hasActiveDocument: false, today: TODAY }
const input = (overrides: Record<string, unknown> = {}) => ({
  withdrawalId: WITHDRAWAL_ID,
  originalInvoice: ORIGINAL,
  amountCents: ORIGINAL.totalCents,
  ...overrides,
})
const record = (overrides: Partial<RefundInvoiceRecord> = {}): RefundInvoiceRecord => ({
  kind: 'return_invoice',
  status: 'ready',
  originalInvoiceNumber: ORIGINAL.number,
  originalInvoiceDate: ORIGINAL.date,
  originalInvoiceType: 'e_archive',
  ...overrides,
})

test('DOM-FIN-096, K-292: iptal penceresi e-Arşivde 7, e-Faturada 8 takvim günüdür; son gün dahil', () => {
  assert.equal(cancelWindowEndsOn({ date: '2026-10-01', type: 'e_archive' }), '2026-10-08')
  assert.equal(cancelWindowEndsOn({ date: '2026-10-01', type: 'e_invoice' }), '2026-10-09')
  assert.equal(cancelWindowEndsOn({ date: '2026-12-28', type: 'e_archive' }), '2027-01-04')
  assert.equal(daysBetween('2026-10-01', '2026-10-08'), 7)
  const suggest = (today: string, amountCents = ORIGINAL.totalCents, type = ORIGINAL.type) =>
    suggestRefundDocumentKind({ original: { ...ORIGINAL, type }, amountCents, today })
  assert.equal(suggest('2026-10-08'), 'cancellation')
  assert.equal(suggest('2026-10-09'), 'return_invoice')
  assert.equal(suggest('2026-10-09', ORIGINAL.totalCents, 'e_invoice'), 'cancellation')
  // Kısmi iade pencerede bile iade faturasıdır: fatura kısmen iptal edilmez.
  assert.equal(suggest('2026-10-02', 500_000), 'return_invoice')
})

test('DOM-FIN-096, K-293: KDV dahil tutar asıl faturanın oranıyla ayrılır, toplam korunur', () => {
  assert.deepEqual(splitVat(1_100_000, 1000), { netCents: 1_000_000, vatCents: 100_000 })
  assert.deepEqual(splitVat(1_000, 2000), { netCents: 833, vatCents: 167 })
  assert.deepEqual(splitVat(999, 0), { netCents: 999, vatCents: 0 })
  for (const total of [1, 7, 101, 123_457, 9_999_999])
    for (const rate of [0, 100, 1000, 2000]) {
      const { netCents, vatCents } = splitVat(total, rate)
      assert.equal(netCents + vatCents, total)
      assert.ok(vatCents >= 0)
    }
})

test('DOM-FIN-096: tam iade pencerede iptal isteği, sonrasında iade faturası olarak önerilir', () => {
  const cancellation = planRefundInvoice(input(), CONTEXT)
  assert.equal(cancellation.kind, 'cancellation')
  assert.equal(cancellation.netCents, 1_000_000)
  assert.equal(cancellation.vatCents, 100_000)
  assert.equal(cancellation.note, null)
  const late = planRefundInvoice(input(), { ...CONTEXT, today: '2026-10-09' })
  assert.equal(late.kind, 'return_invoice')
  // Pencerede de iade faturası seçilebilir.
  assert.equal(planRefundInvoice(input({ kind: 'return_invoice' }), CONTEXT).kind, 'return_invoice')
})

test('DOM-FIN-096, K-293: kısmi iade faturası; numara büyük harfe çevrilir, not kırpılır', () => {
  const plan = planRefundInvoice(
    input({
      amountCents: 550_000,
      note: '  Kısmi iade  ',
      originalInvoice: { ...ORIGINAL, number: 'kmp2026000000012' },
    }),
    CONTEXT,
  )
  assert.equal(plan.kind, 'return_invoice')
  assert.equal(plan.originalInvoice.number, 'KMP2026000000012')
  assert.deepEqual([plan.netCents, plan.vatCents], [500_000, 50_000])
  assert.equal(plan.note, 'Kısmi iade')
})

test('DOM-FIN-096, K-293: tutar iadeyi ve asıl faturayı aşamaz', () => {
  assert.throws(
    () =>
      planRefundInvoice(input(), {
        ...CONTEXT,
        withdrawal: { ...PAID, refundCents: 1_000_000 },
      }),
    isDomainError('refund_invoice_amount_exceeds_refund'),
  )
  assert.throws(
    () => planRefundInvoice(input({ amountCents: ORIGINAL.totalCents + 1 }), CONTEXT),
    isDomainError('refund_invoice_amount_exceeds_invoice'),
  )
})

test('DOM-FIN-096, K-292: iptal isteği yalnız tam iadede ve pencerede seçilir', () => {
  assert.throws(
    () => planRefundInvoice(input({ kind: 'cancellation', amountCents: 500_000 }), CONTEXT),
    isDomainError('refund_invoice_cancel_partial'),
  )
  assert.throws(
    () => planRefundInvoice(input({ kind: 'cancellation' }), { ...CONTEXT, today: '2026-10-09' }),
    isDomainError('refund_invoice_cancel_window_closed'),
  )
})

test('DOM-FIN-096: iade ödenmeden ya da iadesi olmayan ayrılışta belge yok; ikinci belge 409', () => {
  assert.throws(
    () =>
      planRefundInvoice(input(), {
        ...CONTEXT,
        withdrawal: { refundCents: 2_000_000, refundPaidDate: null },
      }),
    isDomainError('refund_invoice_refund_not_paid'),
  )
  assert.throws(
    () =>
      planRefundInvoice(input(), {
        ...CONTEXT,
        withdrawal: { refundCents: 0, refundPaidDate: null },
      }),
    isDomainError('refund_invoice_no_refund'),
  )
  assert.throws(
    () => planRefundInvoice(input(), { ...CONTEXT, hasActiveDocument: true }),
    isDomainError('refund_invoice_exists', 'conflict'),
  )
})

test('DOM-FIN-096: asıl fatura bugünden ve iade ödemesinden sonra olamaz', () => {
  assert.throws(
    () =>
      planRefundInvoice(input({ originalInvoice: { ...ORIGINAL, date: '2026-10-07' } }), CONTEXT),
    isDomainError('refund_invoice_original_date_future'),
  )
  assert.throws(
    () =>
      planRefundInvoice(input({ originalInvoice: { ...ORIGINAL, date: '2026-10-06' } }), CONTEXT),
    isDomainError('refund_invoice_original_after_refund'),
  )
})

test('DOM-FIN-096: şema numara biçimini, numara yılını, oranı ve bilinmeyen alanı reddeder', () => {
  const issues = (value: unknown) => {
    const parsed = createRefundInvoiceSchema.safeParse(value)
    assert.equal(parsed.success, false)
    return parsed.error?.issues.map((issue) => issue.path.join('.')) ?? []
  }
  assert.deepEqual(issues(input({ originalInvoice: { ...ORIGINAL, number: 'AB12' } })), [
    'originalInvoice.number',
  ])
  assert.deepEqual(
    issues(input({ originalInvoice: { ...ORIGINAL, number: 'KMP2025000000012' } })),
    ['originalInvoice.number'],
  )
  assert.deepEqual(issues(input({ originalInvoice: { ...ORIGINAL, vatRateBasisPoints: 800 } })), [
    'originalInvoice.vatRateBasisPoints',
  ])
  assert.deepEqual(issues(input({ amountCents: 0 })), ['amountCents'])
  assert.deepEqual(issues(input({ institutionId: 'x' })), [''])
  assert.throws(() => planRefundInvoice(input({ amountCents: -1 }), CONTEXT), ZodError)
})

test('DOM-FIN-096, K-294: taslak hazır olur; iptal isteğinde pencere yeniden denetlenir', () => {
  assert.doesNotThrow(() => planRefundInvoiceReady(record({ status: 'draft' }), TODAY))
  assert.throws(
    () => planRefundInvoiceReady(record({ status: 'ready' }), TODAY),
    isDomainError('refund_invoice_not_draft'),
  )
  const cancellation = record({ status: 'draft', kind: 'cancellation' })
  assert.doesNotThrow(() => planRefundInvoiceReady(cancellation, '2026-10-08'))
  assert.throws(
    () => planRefundInvoiceReady(cancellation, '2026-10-09'),
    isDomainError('refund_invoice_cancel_window_closed'),
  )
})

test('DOM-FIN-096, K-294: iade faturası numarasıyla gönderildi olur', () => {
  assert.deepEqual(
    planRefundInvoiceComplete(
      record(),
      { completedDate: '2026-10-06', documentNumber: 'kmp2026000000040' },
      TODAY,
    ),
    { status: 'sent', completedDate: '2026-10-06', documentNumber: 'KMP2026000000040' },
  )
  const fail = (body: Record<string, unknown>, code: string, rec = record()) =>
    assert.throws(() => planRefundInvoiceComplete(rec, body, TODAY), isDomainError(code))
  fail({ completedDate: TODAY }, 'refund_invoice_number_required')
  fail(
    { completedDate: TODAY, documentNumber: 'KMP2025000000040' },
    'refund_invoice_number_year_mismatch',
  )
  fail(
    { completedDate: TODAY, documentNumber: ORIGINAL.number },
    'refund_invoice_number_same_as_original',
  )
  fail(
    { completedDate: '2026-10-07', documentNumber: 'KMP2026000000040' },
    'refund_invoice_completed_date_future',
  )
  fail(
    { completedDate: '2026-09-30', documentNumber: 'KMP2026000000040' },
    'refund_invoice_completed_before_original',
  )
  fail(
    { completedDate: TODAY, documentNumber: 'KMP2026000000040' },
    'refund_invoice_not_ready',
    record({ status: 'draft' }),
  )
  assert.throws(
    () => planRefundInvoiceComplete(record(), { completedDate: 'dün' }, TODAY),
    ZodError,
  )
})

test('DOM-FIN-096, K-294: iptal isteği numarasız ve pencere içinde iptal edildi olur', () => {
  const cancellation = record({ kind: 'cancellation' })
  assert.deepEqual(planRefundInvoiceComplete(cancellation, { completedDate: TODAY }, TODAY), {
    status: 'cancelled',
    completedDate: TODAY,
    documentNumber: null,
  })
  assert.throws(
    () =>
      planRefundInvoiceComplete(
        cancellation,
        { completedDate: TODAY, documentNumber: 'KMP2026000000040' },
        TODAY,
      ),
    isDomainError('refund_invoice_number_not_applicable'),
  )
  assert.throws(
    () => planRefundInvoiceComplete(cancellation, { completedDate: '2026-10-09' }, '2026-10-10'),
    isDomainError('refund_invoice_cancel_window_closed'),
  )
})

test('DOM-FIN-096, K-294: taslaktan ve hazır belgeden gerekçeyle vazgeçilir, işlenmişten vazgeçilmez', () => {
  assert.deepEqual(planRefundInvoiceDiscard({ status: 'draft' }, { reason: '  Yanlış fatura  ' }), {
    reason: 'Yanlış fatura',
  })
  assert.doesNotThrow(() => planRefundInvoiceDiscard({ status: 'ready' }, { reason: 'Reddedildi' }))
  for (const status of ['sent', 'cancelled'] as const)
    assert.throws(
      () => planRefundInvoiceDiscard({ status }, { reason: 'Vazgeçtim' }),
      isDomainError('refund_invoice_completed'),
    )
  assert.throws(() => planRefundInvoiceDiscard({ status: 'draft' }, { reason: 'kısa' }), ZodError)
})

test('DOM-FIN-096, K-295: eylemler yalnız yöneticiye ve duruma göre açılır', () => {
  const admin = { role: 'yonetici' }
  assert.deepEqual(refundInvoiceActions({ status: 'draft' }, admin), {
    ready: true,
    complete: false,
    discard: true,
  })
  assert.deepEqual(refundInvoiceActions({ status: 'ready' }, admin), {
    ready: false,
    complete: true,
    discard: true,
  })
  assert.deepEqual(refundInvoiceActions({ status: 'sent' }, admin), {
    ready: false,
    complete: false,
    discard: false,
  })
  for (const role of ['onburo', 'ogretmen', 'veli'])
    assert.deepEqual(refundInvoiceActions({ status: 'draft' }, { role }), {
      ready: false,
      complete: false,
      discard: false,
    })
})

test('DOM-FIN-096, K-294: CSV ayırıcı, ondalık virgül, oran ve formül kaçışıyla yazılır', () => {
  const csv = refundInvoicesCsv([
    {
      kind: 'return_invoice',
      status: 'ready',
      studentName: '=Deniz',
      withdrawalDate: '2026-10-01',
      refundPaidDate: '2026-10-05',
      refundCents: 2_000_000,
      originalInvoice: { ...ORIGINAL, vatRateBasisPoints: 100 },
      amountCents: 550_050,
      netCents: 544_604,
      vatCents: 5_446,
      documentNumber: null,
      completedDate: null,
      note: null,
    },
  ])
  const [header, row] = csv.split('\r\n')
  assert.ok(header?.startsWith('"Belge türü";"Durum";"Öğrenci"'))
  assert.equal(
    row,
    [
      '"İade faturası"',
      '"Gönderime hazır"',
      `"'=Deniz"`,
      '"2026-10-01"',
      '"2026-10-05"',
      '20000,00',
      '"e-Arşiv fatura"',
      '"KMP2026000000012"',
      '"2026-10-01"',
      '11000,00',
      '1',
      '5500,50',
      '5446,04',
      '54,46',
      '""',
      '""',
      '""',
    ].join(';'),
  )
})
