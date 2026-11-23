import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'

import { createSeed } from '../packages/school-core/src/data/seed.ts'
import * as payments from '../packages/school-core/src/lib/payments.ts'
import {
  LEGACY_DEMO_PAYMENT_METHODS,
  payInvoice,
} from '../packages/school-core/src/lib/payments-demo.ts'
import { isDomainError } from './support/domain-error.ts'

const ROOT = join(import.meta.dirname, '..')
const NOW = '2026-10-06T09:00:00.000Z'

function unpaidInvoice() {
  const state = createSeed(new Date(NOW))
  const invoice = state.invoices.find((item) => !item.paidAt)
  assert.ok(invoice, 'örnek veride ödenmemiş taksit olmalı')
  return { state, invoice }
}

/** Kaynak dosyaları (`node_modules`, derleme çıktısı ve testler hariç) kök göreli yoluyla döndürür. */
function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name))
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)))
    .filter((path) => !/(^|\/)(node_modules|dist|build)\//.test(path))
}

/** Yorumları atar: belge yorumlarında işlemin adının anılması bağlantı sayılmaz. */
const withoutComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

// API ve React (ve ikisinin ortak paketleri) demo ödeme yoluna ad, dosya ya da değerle bağlanamaz.
const PLATFORM_SOURCES = [
  'apps/api/src',
  'apps/web-react/src',
  'packages/api-client/src',
  'packages/react-shared/src',
]
const DEMO_PATH_REFERENCES = [
  /payments-demo/,
  /\bpayInvoice\b/,
  /\bLEGACY_DEMO_PAYMENT_METHODS\b/,
  ...LEGACY_DEMO_PAYMENT_METHODS.map(
    (method) => new RegExp(method.replace(/[()]/g, (char) => `\\${char}`)),
  ),
]

test('DOM-FIN-030: demo yolu taksiti tam ödenmiş işaretler ve eski demo yöntemlerini kabul eder (ON-037)', () => {
  for (const method of LEGACY_DEMO_PAYMENT_METHODS) {
    const { state, invoice } = unpaidInvoice()
    payInvoice(state, invoice.id, method, NOW)
    assert.equal(invoice.paidAt, NOW)
    assert.equal(invoice.method, method)
  }
  const { state, invoice } = unpaidInvoice()
  payInvoice(state, invoice.id, 'Nakit', NOW)
  assert.equal(invoice.method, 'Nakit')
})

test('DOM-FIN-031: demo yolu geçersiz yöntemi ve mükerrer ödemeyi kaydı değiştirmeden reddeder (ON-037)', () => {
  const { state, invoice } = unpaidInvoice()
  assert.throws(
    () => payInvoice(state, invoice.id, 'Çek', NOW),
    isDomainError('invalid_payment_method'),
  )
  assert.equal(invoice.paidAt, null)
  assert.equal(invoice.method, null)
  assert.throws(
    () => payInvoice(state, 'missing', 'Nakit', NOW),
    isDomainError('invoice_not_found', 'not_found'),
  )
  payInvoice(state, invoice.id, 'Demo Sanal POS', NOW)
  assert.throws(
    () => payInvoice(state, invoice.id, 'Nakit', '2026-10-07T09:00:00.000Z'),
    isDomainError('invoice_already_paid', 'conflict'),
  )
  assert.equal(invoice.paidAt, NOW)
  assert.equal(invoice.method, 'Demo Sanal POS')
})

test('ON-037: lib/payments.ts köprüsü aynı demo işlevidir; demo yöntem listesini dışa aktarmaz', () => {
  assert.equal(payments.payInvoice, payInvoice)
  assert.equal('LEGACY_DEMO_PAYMENT_METHODS' in payments, false)
  for (const method of LEGACY_DEMO_PAYMENT_METHODS)
    assert.equal((payments.PAYMENT_METHODS as readonly string[]).includes(method), false)
})

test('DOM-FIN-030: API ve React tahsilat şemaları eski demo yöntemlerini reddeder (ON-037)', () => {
  const state = createSeed(new Date(NOW))
  const studentId = state.students[0]!.id
  const context: payments.PaymentContext = {
    allocated: new Map(),
    cashEnabled: true,
    referenceInUse: false,
    bankAccountIds: [],
    now: NOW,
  }
  for (const method of LEGACY_DEMO_PAYMENT_METHODS) {
    assert.equal(payments.paymentInputSchema.safeParse({ method }).success, false)
    assert.equal(
      payments.recordPaymentSchema.safeParse({ studentId, amountCents: 1_000, method }).success,
      false,
    )
    assert.equal(
      payments.paymentFormSchema.safeParse({
        amount: '10,00',
        method,
        reference: 'POS-1',
        paidDate: '2026-10-06',
        bankAccountId: '',
      }).success,
      false,
    )
    const before = structuredClone(state.invoices)
    assert.throws(
      () =>
        payments.planPayment(
          state,
          { studentId, amountCents: 1_000, method, reference: 'POS-1' },
          context,
        ),
      (error: unknown) => error instanceof Error && error.name === 'ZodError',
    )
    assert.deepEqual(state.invoices, before)
  }
})

test('ON-037: API, React, api-client ve react-shared demo ödeme yoluna ulaşmaz', () => {
  const offenders = PLATFORM_SOURCES.flatMap(sourceFiles).flatMap((path) => {
    const text = withoutComments(readFileSync(join(ROOT, path), 'utf8'))
    return DEMO_PATH_REFERENCES.filter((pattern) => pattern.test(text)).map(
      (pattern) => `${path}: ${pattern}`,
    )
  })
  assert.deepEqual(offenders, [])
})

test('ON-037: core içinde demo ödeme yolunu yalnız lib/payments.ts köprüsü içe aktarır', () => {
  const importers = sourceFiles('packages/school-core/src').filter(
    (path) =>
      !path.endsWith('lib/payments-demo.ts') &&
      /from '[^']*payments-demo\.ts'/.test(readFileSync(join(ROOT, path), 'utf8')),
  )
  assert.deepEqual(importers, ['packages/school-core/src/lib/payments.ts'])
})
