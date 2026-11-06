import assert from 'node:assert/strict'
import test from 'node:test'

import {
  defaultFinanceExportProfile,
  financeExportProfileSchema,
  FIXED_COLUMN_SOURCE,
  profiledInvoicesSheet,
  profiledPaymentsSheet,
  profiledRefundsSheet,
} from '../packages/school-core/src/lib/finance-export-profile.ts'
import {
  FINANCE_EXPORT_TEMPLATES,
  financeExportTemplate,
} from '../packages/school-core/src/lib/finance-export-templates.ts'
import {
  financeExportQuerySchema,
  FINANCE_EXPORT_KINDS,
  type InvoiceLine,
  type PaymentLine,
  type RefundLine,
} from '../packages/school-core/src/lib/finance-export.ts'
import { dateSheetCell } from '../packages/school-core/src/lib/finance-sheet.ts'

const PAYMENT: PaymentLine = {
  date: '2026-10-05',
  type: 'Tahsilat',
  receipt: '2026-7',
  studentName: '=Deniz Yılmaz',
  studentNumber: '0712',
  method: 'Senet',
  reference: '',
  amountCents: -123_456,
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
const INVOICE: InvoiceLine = {
  date: '2026-10-15',
  studentName: 'Deniz',
  studentNumber: '712',
  installment: 4,
  feeKind: 'Öğrenim ücreti',
  status: 'Kısmi',
  amountCents: 10_000,
  paidCents: 2_550,
}

test('ON-094: varsayılan profilin sayfası standart dosyanın başlığını ve sırasını taşır', () => {
  const profile = defaultFinanceExportProfile()
  const sheet = profiledPaymentsSheet([PAYMENT], profile)
  assert.equal(sheet.name, 'Tahsilat')
  assert.equal(sheet.dateFormat, 'iso')
  assert.deepEqual(sheet.headers, [
    'Tarih',
    'Hareket',
    'Dekont no',
    'Öğrenci',
    'Okul no',
    'Yöntem',
    'İşlem referansı',
    'Tutar (₺)',
  ])
  assert.deepEqual(sheet.rows, [
    [
      { kind: 'date', day: '2026-10-05' },
      { kind: 'text', value: 'Tahsilat' },
      { kind: 'text', value: '2026-7' },
      { kind: 'text', value: '=Deniz Yılmaz' },
      { kind: 'text', value: '0712' },
      { kind: 'text', value: 'Senet' },
      { kind: 'text', value: '' },
      { kind: 'amount', cents: -123_456 },
    ],
  ])
})

test('ON-094: iade ve taksit satırında iki tarih ve tam sayı doğru türdedir', () => {
  const profile = defaultFinanceExportProfile()
  const refund = profiledRefundsSheet([REFUND], profile)
  assert.equal(refund.name, 'İade')
  assert.deepEqual(refund.rows[0]?.slice(0, 2), [
    { kind: 'date', day: '2026-10-06' },
    { kind: 'date', day: '2026-10-01' },
  ])
  const invoice = profiledInvoicesSheet([INVOICE], profile)
  assert.equal(invoice.name, 'Taksit')
  assert.deepEqual(invoice.rows[0]?.[3], { kind: 'integer', value: 4 })
  assert.deepEqual(invoice.rows[0]?.slice(-2), [
    { kind: 'amount', cents: 10_000 },
    { kind: 'amount', cents: 2_550 },
  ])
})

test('DOM-FIN-055: profilin başlığı, sırası, sabit değeri ve tarih biçimi sayfaya geçer', () => {
  const profile = financeExportProfileSchema.parse({
    ...defaultFinanceExportProfile(),
    dateFormat: 'tr',
    columns: {
      ...defaultFinanceExportProfile().columns,
      payments: [
        { source: 'amount', header: 'Borç' },
        { source: FIXED_COLUMN_SOURCE, header: 'Sabit', value: '=120.01' },
        { source: 'date', header: 'Fiş Tarihi' },
      ],
    },
  })
  const sheet = profiledPaymentsSheet([PAYMENT], profile)
  assert.equal(sheet.dateFormat, 'tr')
  assert.deepEqual(sheet.headers, ['Borç', 'Sabit', 'Fiş Tarihi'])
  assert.deepEqual(sheet.rows[0], [
    { kind: 'amount', cents: -123_456 },
    { kind: 'text', value: '=120.01' },
    { kind: 'date', day: '2026-10-05' },
  ])
})

test('ON-094: gün biçiminde olmayan tarih metin kalır', () => {
  assert.deepEqual(dateSheetCell('2026-10-05'), { kind: 'date', day: '2026-10-05' })
  assert.deepEqual(dateSheetCell('bilinmiyor'), { kind: 'text', value: 'bilinmiyor' })
})

test('ON-094: bütün hazır şablonlar geçerli profildir; satır ve toplam bilgisi kaybolmaz', () => {
  assert.ok(FINANCE_EXPORT_TEMPLATES.length >= 2)
  assert.equal(
    new Set(FINANCE_EXPORT_TEMPLATES.map((item) => item.id)).size,
    FINANCE_EXPORT_TEMPLATES.length,
  )
  for (const template of FINANCE_EXPORT_TEMPLATES) {
    const parsed = financeExportProfileSchema.safeParse({
      ...defaultFinanceExportProfile(),
      columns: template.columns,
    })
    assert.equal(parsed.success, true, template.id)
    for (const kind of FINANCE_EXPORT_KINDS) {
      const sources = template.columns[kind].map((column) => column.source)
      assert.ok(sources.includes('date'), `${template.id}.${kind} tarih`)
      assert.ok(sources.includes('amount'), `${template.id}.${kind} tutar`)
    }
  }
  assert.equal(financeExportTemplate('ledger')?.label, 'Genel kayıt')
  assert.equal(financeExportTemplate('yok'), undefined)
})

test('ON-094 M-11: şablon hesap kodu, KDV ve program uyumu iddiası taşımaz', () => {
  const forbidden = /hesap kod|kdv|logo|mikro|luca|netsis|parasut|paraşüt|uyumlu/i
  for (const template of FINANCE_EXPORT_TEMPLATES) {
    assert.doesNotMatch(`${template.id} ${template.label} ${template.description}`, forbidden)
    for (const kind of FINANCE_EXPORT_KINDS)
      for (const column of template.columns[kind]) {
        assert.notEqual(column.source, FIXED_COLUMN_SOURCE, `${template.id}: sabit sütun yok`)
        assert.doesNotMatch(column.header, forbidden)
      }
  }
})

test('ON-094: standart şablon standart dosyanın sütunlarıdır', () => {
  assert.deepEqual(
    financeExportTemplate('standard')?.columns,
    defaultFinanceExportProfile().columns,
  )
})

test('ON-094: biçim varsayılan CSV; yalnız csv ve xlsx kabul edilir', () => {
  const base = { from: '2026-10-01', to: '2026-10-31', kind: 'payments' }
  assert.equal(financeExportQuerySchema.parse(base).format, 'csv')
  assert.equal(financeExportQuerySchema.parse({ ...base, format: 'xlsx' }).format, 'xlsx')
  assert.equal(financeExportQuerySchema.safeParse({ ...base, format: 'pdf' }).success, false)
})
