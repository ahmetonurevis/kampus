import assert from 'node:assert/strict'
import test from 'node:test'

import {
  invoicesCsv,
  paymentsCsv,
  refundsCsv,
  type InvoiceLine,
  type PaymentLine,
  type RefundLine,
} from '../packages/school-core/src/lib/finance-export.ts'
import {
  defaultFinanceExportProfile,
  financeExportProfileSchema,
  profiledInvoicesCsv,
  profiledPaymentsCsv,
  profiledRefundsCsv,
  setFinanceExportProfileSchema,
} from '../packages/school-core/src/lib/finance-export-profile.ts'

const PAYMENT: PaymentLine = {
  date: '2026-10-05',
  type: 'Tahsilat',
  receipt: '2026-7',
  studentName: '=Deniz Yılmaz',
  studentNumber: '712',
  method: 'Senet',
  reference: 'SNT-1',
  amountCents: 123_456,
}
const REFUND: RefundLine = {
  date: '2026-10-06',
  withdrawalDate: '2026-10-01',
  studentName: 'Deniz',
  studentNumber: '712',
  accountHolder: 'Ayşe',
  maskedIban: 'TR** 26',
  amountCents: 5_000,
}
const INVOICE = {
  date: '2026-10-15',
  studentName: 'Deniz',
  studentNumber: '712',
  installment: 1,
  feeKind: 'Öğrenim ücreti',
  status: 'Kısmi',
  amountCents: 10_000,
  paidCents: 2_550,
} as InvoiceLine

test('ON-024: varsayılan profil standart dosyayı bayt bayt üretir', () => {
  const profile = defaultFinanceExportProfile()
  assert.equal(profiledPaymentsCsv([PAYMENT], profile), paymentsCsv([PAYMENT]))
  assert.equal(profiledRefundsCsv([REFUND], profile), refundsCsv([REFUND]))
  assert.equal(profiledInvoicesCsv([INVOICE], profile), invoicesCsv([INVOICE]))
})

test('ON-024: sütun adı, sırası, biçim ve sabit hesap kodu profilden gelir; tutar değişmez', () => {
  const profile = financeExportProfileSchema.parse({
    ...defaultFinanceExportProfile(),
    separator: '\t',
    dateFormat: 'tr',
    decimal: '.',
    columns: {
      ...defaultFinanceExportProfile().columns,
      payments: [
        { source: 'amount', header: 'Borç' },
        { source: 'fixed', header: 'Hesap Kodu', value: '120.01' },
        { source: 'date', header: 'Fiş Tarihi' },
      ],
    },
  })
  assert.equal(
    profiledPaymentsCsv([PAYMENT], profile),
    '"Borç"\t"Hesap Kodu"\t"Fiş Tarihi"\r\n1234.56\t"120.01"\t"05.10.2026"',
  )
})

test('ON-024: formül kaçışı profilde de korunur; başlık ve sabit değer dahil', () => {
  const profile = defaultFinanceExportProfile()
  profile.columns.payments = [
    { source: 'studentName', header: '=Öğrenci' },
    { source: 'fixed', header: 'Kod', value: '@SUM(1)' },
  ]
  const csv = profiledPaymentsCsv([PAYMENT], profile)
  assert.ok(csv.includes(`"'=Öğrenci"`))
  assert.ok(csv.includes(`"'=Deniz Yılmaz"`))
  assert.ok(csv.includes(`"'@SUM(1)"`))
})

test('ON-024: geçersiz profil reddedilir', () => {
  const base = defaultFinanceExportProfile()
  const invalid = (columns: unknown, extra: object = {}) =>
    financeExportProfileSchema.safeParse({
      ...base,
      ...extra,
      columns: { ...base.columns, payments: columns },
    }).success
  assert.equal(invalid([]), false)
  assert.equal(invalid([{ source: 'paid', header: 'Ödenen' }]), false)
  assert.equal(invalid([{ source: 'fixed', header: 'Kod' }]), false)
  assert.equal(invalid([{ source: 'date', header: '  ' }]), false)
  assert.equal(
    invalid([
      { source: 'date', header: 'Tarih' },
      { source: 'type', header: 'TARİH' },
    ]),
    false,
  )
  assert.equal(invalid(base.columns.payments, { separator: ',', decimal: ',' }), false)
  assert.equal(invalid(base.columns.payments), true)
  assert.equal(setFinanceExportProfileSchema.safeParse({ profile: null }).success, true)
  assert.equal(setFinanceExportProfileSchema.safeParse({}).success, false)
})
